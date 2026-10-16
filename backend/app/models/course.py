from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, UniqueConstraint, func
from sqlalchemy.orm import relationship
from app.database import Base


class Course(Base):
    __tablename__ = "courses"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    course_id = Column(String(64), nullable=False, index=True)  # Udemy's numerical or slug identifier
    title = Column(String(512), nullable=False)
    url = Column(String(512), nullable=False)
    instructor = Column(String(256), nullable=True)
    thumbnail_url = Column(String(1024), nullable=True)
    last_synced_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    user = relationship("User", back_populates="courses")
    sections = relationship("Section", back_populates="course", cascade="all, delete-orphan", order_by="Section.position")
    jobs = relationship("ProcessingJob", back_populates="course", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("user_id", "course_id", name="uq_user_course"),
    )
