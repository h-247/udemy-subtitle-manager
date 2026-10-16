from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, UniqueConstraint, func
from sqlalchemy.orm import relationship
from app.database import Base


class Subtitle(Base):
    __tablename__ = "subtitles"

    id = Column(Integer, primary_key=True, index=True)
    lecture_id = Column(Integer, ForeignKey("lectures.id", ondelete="CASCADE"), nullable=False, index=True)
    language = Column(String(32), default="en", nullable=False)
    subtitle_type = Column(String(32), default="NONE", nullable=False)  # MANUAL, AUTO, IMPORTED, NONE
    status = Column(String(32), default="PENDING", nullable=False, index=True)  # PENDING, PROCESSING, COMPLETED, NO_SUBTITLES, FAILED

    # Google Drive metadata
    drive_file_id = Column(String(256), nullable=True)
    drive_file_url = Column(String(1024), nullable=True)

    # Error details
    error_message = Column(Text, nullable=True)
    error_category = Column(String(64), nullable=True)  # RATE_LIMIT, ACCESS_DENIED, NO_SUBTITLES, DRIVE_ERROR, etc.

    last_processed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    lecture = relationship("Lecture", back_populates="subtitles")

    __table_args__ = (
        UniqueConstraint("lecture_id", "language", name="uq_lecture_language"),
    )
