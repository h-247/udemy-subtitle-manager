from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, func
from sqlalchemy.orm import relationship
from app.database import Base


class UdemySession(Base):
    __tablename__ = "udemy_sessions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False, index=True)
    encrypted_cookie_data = Column(Text, nullable=True)  # Fernet-encrypted Netscape cookie text
    status = Column(String(32), default="DISCONNECTED", nullable=False, index=True)
    account_name = Column(String(256), nullable=True)
    error_message = Column(Text, nullable=True)
    last_validated_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    user = relationship("User", back_populates="udemy_session")
