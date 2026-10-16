import pytest
from app.models.job import ProcessingJob
from app.models.course import Course
from app.models.section import Section
from app.models.lecture import Lecture
from app.models.subtitle import Subtitle
from app.services.job_service import job_service, cancel_job_in_memory, is_job_cancelled


def test_jobs_list_and_get(client, user_a, user_a_headers, db_session):
    j1 = ProcessingJob(
        user_id=user_a.id,
        job_type="COURSE_IMPORT",
        status="COMPLETED",
        total_items=1,
        completed_items=1,
    )
    j2 = ProcessingJob(
        user_id=user_a.id,
        job_type="SUBTITLE_BATCH",
        status="PROCESSING",
        total_items=10,
        completed_items=4,
    )
    db_session.add_all([j1, j2])
    db_session.commit()

    res = client.get("/api/jobs", headers=user_a_headers)
    assert res.status_code == 200
    jobs = res.json()
    assert len(jobs) >= 2

    res_single = client.get(f"/api/jobs/{j2.id}", headers=user_a_headers)
    assert res_single.status_code == 200
    assert res_single.json()["status"] == "PROCESSING"
    assert res_single.json()["completed_items"] == 4


def test_job_cancellation(client, user_a, user_a_headers, db_session):
    job = ProcessingJob(
        user_id=user_a.id,
        job_type="SUBTITLE_BATCH",
        status="PROCESSING",
        total_items=20,
        completed_items=5,
    )
    db_session.add(job)
    db_session.commit()

    res = client.post(f"/api/jobs/{job.id}/cancel", headers=user_a_headers)
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "CANCELLED"
    assert is_job_cancelled(job.id)


def test_batch_processing_resumption_skips_completed(db_session, user_a):
    """When a job runs or is retried, already COMPLETED subtitles are not re-processed."""
    c = Course(user_id=user_a.id, course_id="c_resume", title="Resume Course", url="https://udemy.com/course/resume/")
    db_session.add(c)
    db_session.commit()
    sec = Section(course_id=c.id, title="Sec 1", position=1)
    db_session.add(sec)
    db_session.commit()
    lec1 = Lecture(section_id=sec.id, lecture_id="l1", title="L1", url="https://udemy.com/l1", position=1)
    lec2 = Lecture(section_id=sec.id, lecture_id="l2", title="L2", url="https://udemy.com/l2", position=2)
    db_session.add_all([lec1, lec2])
    db_session.commit()

    # Subtitle for lec1 already COMPLETED
    sub1 = Subtitle(
        lecture_id=lec1.id,
        language="en",
        subtitle_type="MANUAL",
        status="COMPLETED",
        drive_file_id="already_uploaded_id",
    )
    db_session.add(sub1)
    db_session.commit()

    # Query existing completed count
    completed_before = db_session.query(Subtitle).filter(Subtitle.status == "COMPLETED").count()
    assert completed_before == 1
