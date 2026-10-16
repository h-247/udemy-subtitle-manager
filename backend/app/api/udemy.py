import logging
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User
from app.models.udemy_session import UdemySession
from app.schemas.udemy import UdemySessionStatusRead, CookieUploadRequest
from app.api.deps import get_current_user
from app.services.cookie_service import cookie_service, CookieValidationError
from app.services.crypto_service import crypto_service
from app.services.udemy_service import udemy_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/udemy", tags=["udemy"])


def replace_udemy_domain(url: str, new_domain: str) -> str:
    """Replaces host in any Udemy URL with the new domain."""
    if not url or not new_domain:
        return url
    clean_domain = new_domain.replace("http://", "").replace("https://", "").strip().rstrip("/")
    try:
        from urllib.parse import urlparse, urlunparse
        parsed = urlparse(url)
        if "udemy.com" in parsed.netloc.lower():
            return urlunparse((parsed.scheme or "https", clean_domain, parsed.path, parsed.params, parsed.query, parsed.fragment))
    except Exception:
        pass
    import re
    return re.sub(r"https?://(?:[a-zA-Z0-9_\-]+\.)?udemy\.com", f"https://{clean_domain}", url, flags=re.IGNORECASE)


@router.get("/status", response_model=UdemySessionStatusRead)
def get_udemy_status(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Returns current Udemy session connection status without exposing cookie data."""
    session_rec = db.query(UdemySession).filter(UdemySession.user_id == current_user.id).first()
    if not session_rec or not session_rec.encrypted_cookie_data:
        return UdemySessionStatusRead(
            status="DISCONNECTED",
            account_name=None,
            business_domain=None,
            last_validated_at=None,
            error_message=None,
        )

    business_domain = None
    try:
        cookie_text = crypto_service.decrypt_text(session_rec.encrypted_cookie_data)
        business_domain = cookie_service.extract_business_domain(cookie_text)
    except Exception:
        pass

    return UdemySessionStatusRead(
        status=session_rec.status,
        account_name=session_rec.account_name,
        business_domain=business_domain,
        last_validated_at=session_rec.last_validated_at,
        error_message=session_rec.error_message,
    )


@router.post("/cookies", response_model=UdemySessionStatusRead)
async def upload_cookies(
    file: Optional[UploadFile] = File(None),
    cookie_text: Optional[str] = Form(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Accepts Netscape cookies.txt file upload or raw string.
    Validates format, domains, encrypts, and performs live connection test.
    Never exposes raw cookies in responses.
    """
    raw_content = ""
    if file:
        content_bytes = await file.read()
        try:
            raw_content = content_bytes.decode("utf-8")
        except UnicodeDecodeError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cookie file must be valid UTF-8 plain text.",
            )
    elif cookie_text:
        raw_content = cookie_text
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A cookies.txt file or plain text content must be provided.",
        )

    try:
        is_valid, sanitized_content, _ = cookie_service.validate_and_parse_netscape(raw_content)
    except CookieValidationError as cve:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(cve),
        )

    # Encrypt cookies before storing
    encrypted_data = crypto_service.encrypt_text(sanitized_content)

    # Perform live connection test
    test_status, account_name, error_msg = udemy_service.validate_session(sanitized_content)

    business_domain = cookie_service.extract_business_domain(sanitized_content)
    target_domain = business_domain or "www.udemy.com"

    session_rec = db.query(UdemySession).filter(UdemySession.user_id == current_user.id).first()
    now = datetime.now(timezone.utc)

    if not session_rec:
        session_rec = UdemySession(
            user_id=current_user.id,
            encrypted_cookie_data=encrypted_data,
            status=test_status,
            account_name=account_name,
            error_message=error_msg,
            last_validated_at=now,
        )
        db.add(session_rec)
    else:
        session_rec.encrypted_cookie_data = encrypted_data
        session_rec.status = test_status
        session_rec.account_name = account_name
        session_rec.error_message = error_msg
        session_rec.last_validated_at = now

    # Automatically sync existing course and lecture URLs to the updated domain
    try:
        from app.models.course import Course
        user_courses = db.query(Course).filter(Course.user_id == current_user.id).all()
        for c in user_courses:
            c.url = replace_udemy_domain(c.url, target_domain)
            for sec in c.sections:
                for lec in sec.lectures:
                    lec.url = replace_udemy_domain(lec.url, target_domain)
    except Exception as exc:
        logger.warning(f"Error auto-syncing course domains on cookie upload: {exc}")

    db.commit()
    db.refresh(session_rec)

    return UdemySessionStatusRead(
        status=session_rec.status,
        account_name=session_rec.account_name,
        business_domain=business_domain,
        last_validated_at=session_rec.last_validated_at,
        error_message=session_rec.error_message,
    )


@router.post("/test-connection", response_model=UdemySessionStatusRead)
def test_connection(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Re-validates currently stored Udemy session credentials against Udemy API."""
    session_rec = db.query(UdemySession).filter(UdemySession.user_id == current_user.id).first()
    if not session_rec or not session_rec.encrypted_cookie_data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No Udemy cookies have been uploaded. Please upload a cookies.txt file first.",
        )

    business_domain = None
    try:
        cookie_text = crypto_service.decrypt_text(session_rec.encrypted_cookie_data)
        business_domain = cookie_service.extract_business_domain(cookie_text)
    except Exception as e:
        session_rec.status = "INVALID_COOKIES"
        session_rec.error_message = f"Decryption failed: {str(e)}"
        db.commit()
        return UdemySessionStatusRead(status="INVALID_COOKIES", error_message="Could not decrypt stored credentials.")

    test_status, account_name, error_msg = udemy_service.validate_session(cookie_text)

    session_rec.status = test_status
    if account_name:
        session_rec.account_name = account_name
    session_rec.error_message = error_msg
    session_rec.last_validated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(session_rec)

    return UdemySessionStatusRead(
        status=session_rec.status,
        account_name=session_rec.account_name,
        business_domain=business_domain,
        last_validated_at=session_rec.last_validated_at,
        error_message=session_rec.error_message,
    )


@router.post("/sync-domains")
def sync_udemy_domains(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Synchronizes all courses and lectures URLs to the active Udemy domain
    extracted from the current session cookies.
    """
    session_rec = db.query(UdemySession).filter(UdemySession.user_id == current_user.id).first()
    if not session_rec or not session_rec.encrypted_cookie_data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No Udemy cookies found. Please upload cookies first.",
        )

    try:
        cookie_text = crypto_service.decrypt_text(session_rec.encrypted_cookie_data)
        business_domain = cookie_service.extract_business_domain(cookie_text) or "www.udemy.com"
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Could not read cookies: {e}",
        )

    from app.models.course import Course
    courses = db.query(Course).filter(Course.user_id == current_user.id).all()
    courses_updated = 0
    lectures_updated = 0

    for c in courses:
        new_c_url = replace_udemy_domain(c.url, business_domain)
        if new_c_url != c.url:
            c.url = new_c_url
            courses_updated += 1
        for sec in c.sections:
            for lec in sec.lectures:
                new_l_url = replace_udemy_domain(lec.url, business_domain)
                if new_l_url != lec.url:
                    lec.url = new_l_url
                    lectures_updated += 1

    db.commit()

    return {
        "status": "success",
        "domain": business_domain,
        "courses_updated": courses_updated,
        "lectures_updated": lectures_updated,
    }


@router.post("/disconnect")
def disconnect_udemy(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Clears stored Udemy cookies and sets status to DISCONNECTED."""
    session_rec = db.query(UdemySession).filter(UdemySession.user_id == current_user.id).first()
    if session_rec:
        session_rec.encrypted_cookie_data = None
        session_rec.status = "DISCONNECTED"
        session_rec.account_name = None
        session_rec.error_message = None
        session_rec.last_validated_at = None
        db.commit()

    return {"message": "Udemy session disconnected and cookies deleted successfully."}
