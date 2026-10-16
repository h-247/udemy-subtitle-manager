from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, Field, ConfigDict
from app.schemas.subtitle import SubtitleRead


class LectureUpdate(BaseModel):
    learning_status: Optional[str] = Field(None, description="NOT_STARTED, IN_PROGRESS, or COMPLETED")
    chatgpt_url: Optional[str] = Field(None, description="URL of user ChatGPT conversation")


class LectureRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    section_id: int
    lecture_id: str
    title: str
    url: str
    lecture_type: str
    duration: int
    position: int
    learning_status: str
    chatgpt_url: Optional[str] = None
    subtitles: List[SubtitleRead] = []


class SectionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    course_id: int
    title: str
    position: int
    lectures: List[LectureRead] = []


class CourseRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    course_id: str
    title: str
    url: str
    instructor: Optional[str] = None
    thumbnail_url: Optional[str] = None
    total_sections: int = 0
    total_lectures: int = 0
    completed_lectures: int = 0
    processed_subtitles: int = 0
    failed_subtitles: int = 0
    next_lecture: Optional[LectureRead] = None
    last_synced_at: datetime
    created_at: datetime
    sections: Optional[List[SectionRead]] = None


class CourseListResponse(BaseModel):
    items: List[CourseRead]
    total: int
