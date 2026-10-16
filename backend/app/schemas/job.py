from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict


class JobRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    course_id: Optional[int] = None
    job_type: str
    status: str
    total_items: int
    completed_items: int
    failed_items: int
    progress_message: Optional[str] = None
    error_message: Optional[str] = None
    created_at: datetime
    updated_at: datetime
