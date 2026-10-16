from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User
from app.models.job import ProcessingJob
from app.schemas.job import JobRead
from app.api.deps import get_current_user
from app.services.job_service import cancel_job_in_memory

router = APIRouter(prefix="/jobs", tags=["jobs"])


@router.get("", response_model=List[JobRead])
def list_jobs(
    course_id: Optional[int] = Query(None, description="Filter jobs by course"),
    limit: int = Query(10, ge=1, le=50),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(ProcessingJob).filter(ProcessingJob.user_id == current_user.id)
    if course_id:
        query = query.filter(ProcessingJob.course_id == course_id)

    jobs = query.order_by(ProcessingJob.created_at.desc()).limit(limit).all()
    return [JobRead.model_validate(j) for j in jobs]


@router.get("/{job_id}", response_model=JobRead)
def get_job(
    job_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    job = (
        db.query(ProcessingJob)
        .filter(ProcessingJob.id == job_id, ProcessingJob.user_id == current_user.id)
        .first()
    )
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    return JobRead.model_validate(job)


@router.post("/{job_id}/cancel", response_model=JobRead)
def cancel_job(
    job_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    job = (
        db.query(ProcessingJob)
        .filter(ProcessingJob.id == job_id, ProcessingJob.user_id == current_user.id)
        .first()
    )
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")

    if job.status in ("COMPLETED", "FAILED", "CANCELLED"):
        return JobRead.model_validate(job)

    cancel_job_in_memory(job.id)
    job.status = "CANCELLED"
    job.progress_message = "Cancellation requested."
    db.commit()
    db.refresh(job)
    return JobRead.model_validate(job)
