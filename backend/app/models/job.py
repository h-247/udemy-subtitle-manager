from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, func
from sqlalchemy.orm import relationship
from app.database import Base


class ProcessingJob(Base):
    __tablename__ = "processing_jobs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    course_id = Column(Integer, ForeignKey("courses.id", ondelete="CASCADE"), nullable=True, index=True)

    job_type = Column(String(64), nullable=False)  # COURSE_IMPORT, SUBTITLE_BATCH, SUBTITLE_SINGLE
    status = Column(String(32), default="PENDING", nullable=False, index=True)  # PENDING, PROCESSING, COMPLETED, FAILED, CANCELLED

    total_items = Column(Integer, default=0, nullable=False)
    completed_items = Column(Integer, default=0, nullable=False)
    failed_items = Column(Integer, default=0, nullable=False)

    progress_message = Column(Text, nullable=True)
    error_message = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    user = relationship("User", back_populates="jobs")
    course = relationship("Course", back_populates="jobs")
