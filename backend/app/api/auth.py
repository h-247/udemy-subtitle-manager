from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User
from app.models.udemy_session import UdemySession
from app.schemas.user import UserCreate, UserLogin, UserRead, Token
from app.services.auth_service import verify_password, get_password_hash, create_access_token
from app.api.deps import get_current_user

router = APIRouter(prefix="/auth", tags=["auth"])


def _build_user_read(user: User, db: Session) -> UserRead:
    session = db.query(UdemySession).filter(UdemySession.user_id == user.id).first()
    has_udemy = bool(session and session.encrypted_cookie_data)
    udemy_status = session.status if session else "DISCONNECTED"
    udemy_account_name = session.account_name if session else None
    business_domain = None
    if session and session.encrypted_cookie_data:
        try:
            from app.services.crypto_service import crypto_service
            from app.services.cookie_service import cookie_service
            decrypted = crypto_service.decrypt_text(session.encrypted_cookie_data)
            business_domain = cookie_service.extract_business_domain(decrypted)
        except Exception:
            pass

    return UserRead(
        id=user.id,
        email=user.email,
        is_active=user.is_active,
        has_drive_connected=bool(user.drive_credentials),
        has_udemy_connected=has_udemy,
        udemy_status=udemy_status,
        udemy_account_name=udemy_account_name,
        udemy_business_domain=business_domain,
        created_at=user.created_at,
    )


@router.post("/register", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def register(user_in: UserCreate, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.email == user_in.email).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A user with this email already exists."
        )

    user = User(
        email=user_in.email,
        hashed_password=get_password_hash(user_in.password),
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    return _build_user_read(user, db)


@router.post("/login", response_model=Token)
def login(user_in: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == user_in.email).first()
    if not user or not verify_password(user_in.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Inactive user"
        )

    access_token = create_access_token(subject=user.id)
    user_read = _build_user_read(user, db)

    return Token(
        access_token=access_token,
        token_type="bearer",
        user=user_read,
    )


@router.get("/me", response_model=UserRead)
def get_me(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _build_user_read(current_user, db)


@router.post("/logout")
def logout(current_user: User = Depends(get_current_user)):
    return {"message": "Logged out successfully"}
