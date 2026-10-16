import json
import logging
from datetime import datetime, timezone
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.config import settings
from app.models.user import User
from app.models.course import Course
from app.models.section import Section
from app.models.lecture import Lecture
from app.models.subtitle import Subtitle
from app.schemas.subtitle import SubtitleRead, SubtitleBatchProcessRequest, ManualSubtitleUploadResponse
from app.schemas.job import JobRead
from app.api.deps import get_current_user
from app.services.subtitle_processor import subtitle_processor
from app.services.drive_service import drive_service
from app.services.job_service import job_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/subtitles", tags=["subtitles"])


@router.post("/process", response_model=JobRead, status_code=status.HTTP_202_ACCEPTED)
def process_subtitles(
    payload: SubtitleBatchProcessRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Triggers batch subtitle processing for selected lectures, an entire section, or a course.
    """
    target_lecture_ids: List[int] = []

    if payload.lecture_ids:
        # Validate that all lecture_ids belong to current user
        valid_lecs = (
            db.query(Lecture.id)
            .join(Section)
            .join(Course)
            .filter(Lecture.id.in_(payload.lecture_ids), Course.user_id == current_user.id)
            .all()
        )
        target_lecture_ids = [r[0] for r in valid_lecs]
    elif payload.section_id:
        valid_lecs = (
            db.query(Lecture.id)
            .join(Section)
            .join(Course)
            .filter(
                Section.id == payload.section_id,
                Course.user_id == current_user.id,
                Lecture.lecture_type == "video",
            )
            .order_by(Lecture.position)
            .all()
        )
        target_lecture_ids = [r[0] for r in valid_lecs]
    elif payload.course_id:
        valid_lecs = (
            db.query(Lecture.id)
            .join(Section)
            .join(Course)
            .filter(
                Course.id == payload.course_id,
                Course.user_id == current_user.id,
                Lecture.lecture_type == "video",
            )
            .order_by(Section.position, Lecture.position)
            .all()
        )
        target_lecture_ids = [r[0] for r in valid_lecs]

    if not target_lecture_ids:
        raise HTTPException(
            status_code=400,
            detail="No eligible video lectures found to process.",
        )

    job = job_service.queue_subtitle_batch(
        user_id=current_user.id,
        lecture_ids=target_lecture_ids,
        course_id=payload.course_id,
        language=payload.language or "en",
    )
    return JobRead.model_validate(job)


@router.post("/lectures/{lecture_id}/process", response_model=JobRead, status_code=status.HTTP_202_ACCEPTED)
def process_single_lecture_subtitle(
    lecture_id: int,
    language: str = "en",
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Triggers subtitle extraction for a single lecture."""
    lecture = (
        db.query(Lecture)
        .join(Section)
        .join(Course)
        .filter(Lecture.id == lecture_id, Course.user_id == current_user.id)
        .first()
    )
    if not lecture:
        raise HTTPException(status_code=404, detail="Lecture not found.")

    job = job_service.queue_subtitle_batch(
        user_id=current_user.id,
        lecture_ids=[lecture.id],
        course_id=lecture.section.course_id,
        language=language,
    )
    return JobRead.model_validate(job)


@router.post("/lectures/{lecture_id}/upload", response_model=ManualSubtitleUploadResponse)
async def upload_manual_subtitle(
    lecture_id: int,
    file: UploadFile = File(...),
    language: str = Form("en"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Manual fallback workflow: upload a .vtt or .srt file directly for a lecture.
    Converts .srt to .vtt if needed, uploads to Google Drive if connected, and saves record.
    """
    lecture = (
        db.query(Lecture)
        .join(Section)
        .join(Course)
        .filter(Lecture.id == lecture_id, Course.user_id == current_user.id)
        .first()
    )
    if not lecture:
        raise HTTPException(status_code=404, detail="Lecture not found.")

    section = lecture.section
    course = section.course

    orig_name = file.filename or "subtitle.vtt"
    ext = orig_name.rsplit(".", 1)[-1].lower() if "." in orig_name else ""
    if ext not in ("vtt", "srt"):
        raise HTTPException(
            status_code=400,
            detail="Unsupported subtitle file format. Only .vtt and .srt are supported.",
        )

    content_bytes = await file.read()
    if not content_bytes or len(content_bytes) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File cannot be empty or larger than 5MB.")

    # Target upload filename
    sec_num = f"{section.position:02d}"
    lec_num = f"{lecture.position:03d}"
    target_filename = f"{lec_num} - {lecture.title}.vtt"

    temp_path, sub_type = subtitle_processor.process_and_save_upload(
        raw_content=content_bytes,
        original_filename=orig_name,
        target_filename=f"{lecture.lecture_id}_{target_filename}",
    )

    # Get or create subtitle record
    sub_rec = (
        db.query(Subtitle)
        .filter(Subtitle.lecture_id == lecture.id, Subtitle.language == language)
        .first()
    )
    if not sub_rec:
        sub_rec = Subtitle(
            lecture_id=lecture.id,
            language=language,
            subtitle_type="IMPORTED",
            status="COMPLETED",
        )
        db.add(sub_rec)
    else:
        sub_rec.subtitle_type = "IMPORTED"
        sub_rec.status = "COMPLETED"
        sub_rec.error_message = None
        sub_rec.error_category = None

    sub_rec.last_processed_at = datetime.now(timezone.utc)

    # Google Drive upload if connected
    drive_creds = None
    if current_user.drive_credentials:
        try:
            drive_creds = json.loads(current_user.drive_credentials)
        except Exception:
            pass

    if drive_creds:
        folder_hierarchy = [
            settings.GOOGLE_DRIVE_FOLDER_NAME,
            course.title,
            f"Section {sec_num} - {section.title}",
        ]
        try:
            upload_res = drive_service.upload_subtitle(
                file_path=temp_path,
                upload_filename=target_filename,
                folder_hierarchy=folder_hierarchy,
                credentials_data=drive_creds,
                delete_on_success=True,
            )
            sub_rec.drive_file_id = upload_res["drive_file_id"]
            sub_rec.drive_file_url = upload_res["drive_file_url"]
        except Exception as drive_err:
            logger.error(f"Google Drive upload failed during manual subtitle import: {drive_err}")
            sub_rec.error_message = f"Saved locally. Drive upload failed: {str(drive_err)}"
            sub_rec.error_category = "DRIVE_ERROR"

    db.commit()
    db.refresh(sub_rec)

    return ManualSubtitleUploadResponse(
        subtitle=SubtitleRead.model_validate(sub_rec),
        message="Subtitle imported and processed successfully.",
    )


@router.delete("/{subtitle_id}", status_code=status.HTTP_200_OK)
def delete_subtitle(
    subtitle_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Deletes a subtitle record and removes the file from Google Drive if synced.
    """
    sub = (
        db.query(Subtitle)
        .join(Lecture)
        .join(Section)
        .join(Course)
        .filter(Subtitle.id == subtitle_id, Course.user_id == current_user.id)
        .first()
    )
    if not sub:
        raise HTTPException(status_code=404, detail="Subtitle not found.")

    if sub.drive_file_id and current_user.drive_credentials:
        try:
            creds = json.loads(current_user.drive_credentials)
            drive_service.delete_file(sub.drive_file_id, creds)
        except Exception as e:
            logger.warning(f"Error deleting file from Google Drive: {e}")

    db.delete(sub)
    db.commit()
    return {"message": "Subtitle deleted successfully.", "id": subtitle_id}


@router.delete("/lectures/{lecture_id}", status_code=status.HTTP_200_OK)
def delete_lecture_subtitles(
    lecture_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Deletes all subtitles associated with a specific lecture and removes them from Google Drive.
    """
    lecture = (
        db.query(Lecture)
        .join(Section)
        .join(Course)
        .filter(Lecture.id == lecture_id, Course.user_id == current_user.id)
        .first()
    )
    if not lecture:
        raise HTTPException(status_code=404, detail="Lecture not found.")

    subs = db.query(Subtitle).filter(Subtitle.lecture_id == lecture_id).all()
    drive_creds = None
    if current_user.drive_credentials:
        try:
            drive_creds = json.loads(current_user.drive_credentials)
        except Exception:
            pass

    for sub in subs:
        if sub.drive_file_id and drive_creds:
            try:
                drive_service.delete_file(sub.drive_file_id, drive_creds)
            except Exception as e:
                logger.warning(f"Error deleting file from Google Drive: {e}")
        db.delete(sub)

    db.commit()
    return {"message": "Subtitles deleted successfully for lecture.", "lecture_id": lecture_id}
