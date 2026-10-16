import json
import logging
from urllib.parse import urlparse
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.database import get_db
from app.models.user import User
from app.models.course import Course
from app.models.section import Section
from app.models.lecture import Lecture
from app.models.subtitle import Subtitle
from app.schemas.course import CourseRead, CourseListResponse, SectionRead, LectureRead, LectureUpdate
from app.schemas.udemy import CourseImportRequest
from app.schemas.job import JobRead
from app.api.deps import get_current_user
from app.services.udemy_service import normalize_udemy_url
from app.services.job_service import job_service
from app.services.drive_service import drive_service, sanitize_filename

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/courses", tags=["courses"])


def _calculate_course_stats(course: Course, db: Session) -> dict:
    total_sections = db.query(func.count(Section.id)).filter(Section.course_id == course.id).scalar() or 0

    lectures = (
        db.query(Lecture)
        .join(Section)
        .filter(Section.course_id == course.id)
        .order_by(Section.position.asc(), Lecture.position.asc())
        .all()
    )
    total_lectures = len(lectures)
    completed_lectures = sum(1 for l in lectures if l.learning_status == "COMPLETED")

    next_lecture = None
    # 1. Search for first IN_PROGRESS
    for l in lectures:
        if l.learning_status == "IN_PROGRESS":
            next_lecture = l
            break
    # 2. If no IN_PROGRESS, search for first NOT_STARTED
    if not next_lecture:
        for l in lectures:
            if l.learning_status == "NOT_STARTED":
                next_lecture = l
                break

    lecture_ids = [l.id for l in lectures]
    processed_subtitles = 0
    failed_subtitles = 0
    if lecture_ids:
        processed_subtitles = (
            db.query(func.count(Subtitle.id))
            .filter(Subtitle.lecture_id.in_(lecture_ids), Subtitle.status == "COMPLETED")
            .scalar() or 0
        )
        failed_subtitles = (
            db.query(func.count(Subtitle.id))
            .filter(Subtitle.lecture_id.in_(lecture_ids), Subtitle.status == "FAILED")
            .scalar() or 0
        )

    return {
        "total_sections": total_sections,
        "total_lectures": total_lectures,
        "completed_lectures": completed_lectures,
        "processed_subtitles": processed_subtitles,
        "failed_subtitles": failed_subtitles,
        "next_lecture": LectureRead.model_validate(next_lecture) if next_lecture else None,
    }


def _build_course_read(course: Course, db: Session, include_sections: bool = False) -> CourseRead:
    stats = _calculate_course_stats(course, db)
    sections_read = None

    if include_sections:
        sections_read = []
        for sec in course.sections:
            lectures_read = []
            for lec in sec.lectures:
                lectures_read.append(LectureRead.model_validate(lec))
            sec_dict = {
                "id": sec.id,
                "course_id": sec.course_id,
                "title": sec.title,
                "position": sec.position,
                "lectures": lectures_read,
            }
            sections_read.append(SectionRead.model_validate(sec_dict))

    return CourseRead(
        id=course.id,
        course_id=course.course_id,
        title=course.title,
        url=course.url,
        instructor=course.instructor,
        thumbnail_url=course.thumbnail_url,
        total_sections=stats["total_sections"],
        total_lectures=stats["total_lectures"],
        completed_lectures=stats["completed_lectures"],
        processed_subtitles=stats["processed_subtitles"],
        failed_subtitles=stats["failed_subtitles"],
        next_lecture=stats["next_lecture"],
        last_synced_at=course.last_synced_at,
        created_at=course.created_at,
        sections=sections_read,
    )


@router.post("/import", response_model=JobRead, status_code=status.HTTP_202_ACCEPTED)
def import_course(
    payload: CourseImportRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Validates course URL and queues asynchronous curriculum import job.
    """
    try:
        normalized_url = normalize_udemy_url(payload.url)
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))

    job = job_service.queue_course_import(current_user.id, normalized_url)
    return JobRead.model_validate(job)


@router.get("", response_model=CourseListResponse)
def list_courses(
    search: Optional[str] = Query(None, description="Search term for course title"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Lists courses belonging to the current authenticated user."""
    query = db.query(Course).filter(Course.user_id == current_user.id)

    if search and search.strip():
        term = f"%{search.strip()}%"
        query = query.filter(Course.title.ilike(term))

    total = query.count()
    courses = (
        query.order_by(Course.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    items = [_build_course_read(c, db, include_sections=False) for c in courses]
    return CourseListResponse(items=items, total=total)


@router.get("/{course_id}", response_model=CourseRead)
def get_course(
    course_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Retrieves full details of a course including all sections, lectures, and subtitles."""
    course = (
        db.query(Course)
        .filter(Course.id == course_id, Course.user_id == current_user.id)
        .first()
    )
    if not course:
        raise HTTPException(status_code=404, detail="Course not found.")

    return _build_course_read(course, db, include_sections=True)


@router.post("/{course_id}/sync", response_model=JobRead, status_code=status.HTTP_202_ACCEPTED)
def sync_course(
    course_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Re-synchronizes course curriculum without losing existing user status or links."""
    course = (
        db.query(Course)
        .filter(Course.id == course_id, Course.user_id == current_user.id)
        .first()
    )
    if not course:
        raise HTTPException(status_code=404, detail="Course not found.")

    job = job_service.queue_course_import(current_user.id, course.url)
    return JobRead.model_validate(job)


@router.delete("/{course_id}")
def delete_course(
    course_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Deletes course from database and removes all uploaded subtitle files
    and course folders on Google Drive if connected.
    """
    course = (
        db.query(Course)
        .filter(Course.id == course_id, Course.user_id == current_user.id)
        .first()
    )
    if not course:
        raise HTTPException(status_code=404, detail="Course not found.")

    # Clean up Google Drive files if user connected Google Drive
    drive_creds = None
    if current_user.drive_credentials:
        try:
            drive_creds = json.loads(current_user.drive_credentials)
        except Exception:
            pass

    if drive_creds:
        # Collect all subtitle records under this course
        subs = (
            db.query(Subtitle)
            .join(Lecture)
            .join(Section)
            .filter(Section.course_id == course.id)
            .all()
        )
        for sub in subs:
            if sub.drive_file_id:
                try:
                    drive_service.delete_file(sub.drive_file_id, drive_creds)
                except Exception as e:
                    logger.warning(f"Error deleting subtitle file {sub.drive_file_id} from Drive: {e}")

        # Also search and delete the course folder on Google Drive
        try:
            service = drive_service.get_service_from_credentials(drive_creds)
            safe_course_title = sanitize_filename(course.title).replace("'", "\\'")
            query = f"mimeType = 'application/vnd.google-apps.folder' and name = '{safe_course_title}' and trashed = false"
            res = service.files().list(q=query, spaces="drive", fields="files(id)").execute()
            for f in res.get("files", []):
                try:
                    service.files().delete(fileId=f["id"]).execute()
                except Exception as err:
                    logger.warning(f"Error deleting course folder {f.get('id')} from Drive: {err}")
        except Exception as e:
            logger.warning(f"Error cleaning up course folder from Drive: {e}")

    db.delete(course)
    db.commit()
    return {"message": "Course and associated Google Drive files deleted successfully."}


@router.patch("/lectures/{lecture_id}", response_model=LectureRead)
def update_lecture(
    lecture_id: int,
    payload: LectureUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Updates lecture learning status and/or ChatGPT conversation link."""
    lecture = (
        db.query(Lecture)
        .join(Section)
        .join(Course)
        .filter(Lecture.id == lecture_id, Course.user_id == current_user.id)
        .first()
    )
    if not lecture:
        raise HTTPException(status_code=404, detail="Lecture not found.")

    if payload.learning_status is not None:
        raw_status = payload.learning_status.strip().upper()
        status_map = {
            "TO_DO": "NOT_STARTED",
            "TO DO": "NOT_STARTED",
            "NOT_STARTED": "NOT_STARTED",
            "DOING": "IN_PROGRESS",
            "IN_PROGRESS": "IN_PROGRESS",
            "DONE": "COMPLETED",
            "COMPLETED": "COMPLETED",
        }
        if raw_status not in status_map:
            raise HTTPException(
                status_code=400,
                detail="Invalid learning status. Must be To do, Doing, or Done.",
            )
        lecture.learning_status = status_map[raw_status]

    if payload.chatgpt_url is not None:
        url_clean = payload.chatgpt_url.strip()
        if url_clean:
            # Validate ChatGPT URL format
            parsed = urlparse(url_clean)
            if not parsed.scheme or not parsed.netloc:
                raise HTTPException(status_code=400, detail="Invalid URL format.")
            if "chatgpt.com" not in parsed.netloc and "chat.openai.com" not in parsed.netloc:
                raise HTTPException(
                    status_code=400,
                    detail="URL must point to ChatGPT (chatgpt.com or chat.openai.com).",
                )
            lecture.chatgpt_url = url_clean
        else:
            lecture.chatgpt_url = None

    db.commit()
    db.refresh(lecture)
    return LectureRead.model_validate(lecture)
