from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, func
from sqlalchemy.orm import relationship
from app.database import Base


class Lecture(Base):
    __tablename__ = "lectures"

    id = Column(Integer, primary_key=True, index=True)
    section_id = Column(Integer, ForeignKey("sections.id", ondelete="CASCADE"), nullable=False, index=True)
    lecture_id = Column(String(64), nullable=False, index=True)
    title = Column(String(512), nullable=False)
    url = Column(String(512), nullable=False)
    lecture_type = Column(String(32), default="video", nullable=False)
    duration = Column(Integer, default=0, nullable=False)  # in seconds
    position = Column(Integer, default=1, nullable=False)

    # Learning status: NOT_STARTED, IN_PROGRESS, COMPLETED
    learning_status = Column(String(32), default="NOT_STARTED", nullable=False, index=True)

    # ChatGPT conversation URL saved by user
    chatgpt_url = Column(String(1024), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    section = relationship("Section", back_populates="lectures")
    subtitles = relationship("Subtitle", back_populates="lecture", cascade="all, delete-orphan")
