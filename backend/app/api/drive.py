import json
import logging
from typing import Optional
from urllib.parse import urlencode
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.config import settings
from app.models.user import User
from app.api.deps import get_current_user
from app.services.drive_service import drive_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/drive", tags=["drive"])


def dashboard_redirect(**params: str) -> RedirectResponse:
    """Redirect OAuth outcomes back to the dashboard with safe URL parameters."""
    query = urlencode(params)
    return RedirectResponse(url=f"{settings.FRONTEND_URL}/dashboard?{query}")


@router.get("/status")
def get_drive_status(current_user: User = Depends(get_current_user)):
    return {
        "is_configured": drive_service.is_configured(),
        "is_connected": bool(current_user.drive_credentials),
    }


@router.get("/auth-url")
def get_auth_url(current_user: User = Depends(get_current_user)):
    if not drive_service.is_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google Drive OAuth is not configured on the server. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
        )
    state = str(current_user.id)
    auth_url, _ = drive_service.get_authorization_url(state=state)
    return {"url": auth_url}


@router.get("/callback")
def oauth_callback(
    code: Optional[str] = Query(None, description="OAuth authorization code"),
    state: Optional[str] = Query(None, description="State passing user_id"),
    oauth_error: Optional[str] = Query(None, alias="error", description="OAuth provider error"),
    db: Session = Depends(get_db),
):
    """
    Handles Google OAuth redirect callback, saves credentials to user record,
    and redirects user safely back to frontend dashboard.
    """
    if oauth_error:
        return dashboard_redirect(drive_error="Google Drive authorization was cancelled or denied.")

    if not code:
        return dashboard_redirect(drive_error="Start Google Drive connection from the dashboard.")

    if not state or not state.isdigit():
        return dashboard_redirect(drive_error="Google Drive authorization state could not be verified.")

    user = db.query(User).filter(User.id == int(state)).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")

    try:
        tokens = drive_service.exchange_code_for_tokens(code)
        user.drive_credentials = json.dumps(tokens)
        db.commit()
    except Exception as exc:
        logger.error(
            "Google OAuth token exchange failed: %s (%s)",
            exc.__class__.__name__,
            str(exc),
            exc_info=True,
        )
        return dashboard_redirect(
            drive_error="Google Drive configuration or token exchange failed. Please verify server OAuth settings."
        )

    return dashboard_redirect(drive_connected="true")


@router.post("/disconnect")
def disconnect_drive(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    current_user.drive_credentials = None
    db.commit()
    return {"message": "Google Drive disconnected successfully"}
