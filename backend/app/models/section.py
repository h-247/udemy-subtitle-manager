from sqlalchemy import Column, Integer, String, ForeignKey
from sqlalchemy.orm import relationship
from app.database import Base


class Section(Base):
    __tablename__ = "sections"

    id = Column(Integer, primary_key=True, index=True)
    course_id = Column(Integer, ForeignKey("courses.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(512), nullable=False)
    position = Column(Integer, default=1, nullable=False)

    course = relationship("Course", back_populates="sections")
    lectures = relationship("Lecture", back_populates="section", cascade="all, delete-orphan", order_by="Lecture.position")
