from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, Field, ConfigDict


class SubtitleRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    lecture_id: int
    language: str
    subtitle_type: str
    status: str
    drive_file_id: Optional[str] = None
    drive_file_url: Optional[str] = None
    error_message: Optional[str] = None
    error_category: Optional[str] = None
    last_processed_at: Optional[datetime] = None


class SubtitleBatchProcessRequest(BaseModel):
    lecture_ids: Optional[List[int]] = Field(None, description="List of lecture IDs to process.")
    course_id: Optional[int] = Field(None, description="Course ID to process")
    section_id: Optional[int] = Field(None, description="Section ID to process")
    language: str = Field("en", description="Target subtitle language code (default: en)")


class ManualSubtitleUploadResponse(BaseModel):
    subtitle: SubtitleRead
    message: str
