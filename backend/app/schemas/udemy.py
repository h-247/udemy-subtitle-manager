from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field, ConfigDict


class CookieUploadRequest(BaseModel):
    cookie_text: Optional[str] = Field(None, description="Netscape cookies.txt plain text content")


class UdemySessionStatusRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    status: str
    account_name: Optional[str] = None
    business_domain: Optional[str] = None
    last_validated_at: Optional[datetime] = None
    error_message: Optional[str] = None


class CourseImportRequest(BaseModel):
    url: str = Field(..., description="Udemy course landing or learning page URL")
