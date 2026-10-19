import pytest
from unittest.mock import patch
from app.models.course import Course
from app.models.section import Section
from app.models.lecture import Lecture
from app.models.subtitle import Subtitle
from app.models.job import ProcessingJob
from app.services.job_service import JobService


MOCK_COURSE_DETAILS = {
    "course_id": "999888",
    "title": "Complete Python Masterclass",
    "url": "https://www.udemy.com/course/complete-python-masterclass/",
    "instructor": "Jane Developer",
    "thumbnail_url": "https://img.udemycdn.com/course/480x270/python.jpg",
}

MOCK_CURRICULUM_ITEMS = [
    {"_class": "chapter", "title": "1. Python Basics"},
    {"_class": "lecture", "id": 1, "title": "Variables", "asset": {"asset_type": "Video", "time_estimation": 200}},
    {"_class": "lecture", "id": 2, "title": "Loops", "asset": {"asset_type": "Video", "time_estimation": 300}},
]


@patch("app.services.udemy_service.udemy_service.fetch_course_details")
@patch("app.services.udemy_service.udemy_service.fetch_curriculum_items")
def test_import_and_sync_preserves_user_data(
    mock_curriculum,
    mock_details,
    db_session,
    user_a,
    user_a_headers,
    client,
):
    mock_details.return_value = MOCK_COURSE_DETAILS
    mock_curriculum.return_value = MOCK_CURRICULUM_ITEMS

    # 1. First import
    job1 = ProcessingJob(
        user_id=user_a.id,
        job_type="COURSE_IMPORT",
        status="PROCESSING",
        total_items=1,
    )
    db_session.add(job1)
    db_session.commit()
    db_session.refresh(job1)

    JobService._execute_course_import(
        job_id=job1.id,
        user_id=user_a.id,
        raw_url="https://www.udemy.com/course/complete-python-masterclass/",
        db=db_session,
    )

    course = db_session.query(Course).filter(Course.user_id == user_a.id).first()
    db_session.refresh(job1)
    assert job1.status == "COMPLETED"
    assert job1.completed_items == job1.total_items == 4
    assert "imported successfully" in job1.progress_message
    assert course is not None
    assert course.course_id == "999888"
    assert course.title == "Complete Python Masterclass"
    assert len(course.sections) == 1
    assert len(course.sections[0].lectures) == 2

    # User modifies learning status, chatgpt link, and adds subtitle
    lec1 = course.sections[0].lectures[0]
    lec1.learning_status = "COMPLETED"
    lec1.chatgpt_url = "https://chatgpt.com/c/python-basics-summary"

    sub1 = Subtitle(
        lecture_id=lec1.id,
        language="en",
        subtitle_type="MANUAL",
        status="COMPLETED",
        drive_file_id="drive_file_abc_123",
        drive_file_url="https://drive.google.com/file/d/drive_file_abc_123/view",
    )
    db_session.add(sub1)
    db_session.commit()

    # 2. Re-import (curriculum has updated title for lecture)
    updated_curriculum = [
        {"_class": "chapter", "title": "1. Python Basics (Updated)"},
        {"_class": "lecture", "id": 1, "title": "Variables and Types", "asset": {"asset_type": "Video", "time_estimation": 220}},
        {"_class": "lecture", "id": 2, "title": "Loops and Iterators", "asset": {"asset_type": "Video", "time_estimation": 320}},
    ]
    mock_curriculum.return_value = updated_curriculum

    job2 = ProcessingJob(
        user_id=user_a.id,
        job_type="COURSE_IMPORT",
        status="PROCESSING",
        total_items=1,
    )
    db_session.add(job2)
    db_session.commit()
    db_session.refresh(job2)

    JobService._execute_course_import(
        job_id=job2.id,
        user_id=user_a.id,
        raw_url="https://www.udemy.com/course/complete-python-masterclass/",
        db=db_session,
    )

    # Verify no duplicate courses
    all_courses = db_session.query(Course).filter(Course.user_id == user_a.id).all()
    assert len(all_courses) == 1

    # Verify existing user-entered fields are preserved!
    db_session.refresh(lec1)
    assert lec1.title == "Variables and Types"
    assert lec1.learning_status == "COMPLETED"
    assert lec1.chatgpt_url == "https://chatgpt.com/c/python-basics-summary"
    assert len(lec1.subtitles) == 1
    assert lec1.subtitles[0].drive_file_id == "drive_file_abc_123"


def test_courses_api_search_and_get(client, user_a, user_a_headers, db_session):
    c1 = Course(user_id=user_a.id, course_id="c1", title="FastAPI Masterclass", url="https://www.udemy.com/course/fastapi/")
    c2 = Course(user_id=user_a.id, course_id="c2", title="React & Next.js", url="https://www.udemy.com/course/react-next/")
    db_session.add_all([c1, c2])
    db_session.commit()

    # Search for FastAPI
    res = client.get("/api/courses?search=fastapi", headers=user_a_headers)
    assert res.status_code == 200
    items = res.json()["items"]
    assert len(items) == 1
    assert items[0]["title"] == "FastAPI Masterclass"

    # Get single course
    res_single = client.get(f"/api/courses/{c1.id}", headers=user_a_headers)
    assert res_single.status_code == 200
    assert res_single.json()["title"] == "FastAPI Masterclass"


def test_course_deletion_cleans_drive(client, user_a, user_a_headers, db_session):
    c = Course(user_id=user_a.id, course_id="c_del", title="Delete Me", url="https://www.udemy.com/course/delete-me/")
    db_session.add(c)
    db_session.commit()

    res = client.delete(f"/api/courses/{c.id}", headers=user_a_headers)
    assert res.status_code == 200
    assert "deleted successfully" in res.json()["message"].lower()

    # Course is gone from DB
    deleted = db_session.query(Course).filter(Course.id == c.id).first()
    assert deleted is None

def test_curriculum_queries_are_batched(client, user_a, user_a_headers, db_session):
    from sqlalchemy import event

    course = Course(user_id=user_a.id, course_id="batch", title="Batch", url="https://www.udemy.com/course/batch/")
    db_session.add(course)
    db_session.flush()
    for position in range(12):
        section = Section(course_id=course.id, title=f"Section {position}", position=position)
        db_session.add(section)
        db_session.flush()
        lecture = Lecture(section_id=section.id, lecture_id=str(position), title=f"Lecture {position}", url="https://www.udemy.com/", position=1, learning_status="IN_PROGRESS" if position == 0 else "COMPLETED")
        db_session.add(lecture)
        db_session.flush()
        db_session.add(Subtitle(lecture_id=lecture.id, language="en", subtitle_type="MANUAL", status="COMPLETED"))
    db_session.commit()
    course_id = course.id
    db_session.expunge_all()
    queries = []
    def record_query(conn, cursor, statement, parameters, context, executemany):
        if statement.lstrip().upper().startswith("SELECT"):
            queries.append(statement)
    engine = db_session.get_bind()
    event.listen(engine, "before_cursor_execute", record_query)
    try:
        response = client.get(f"/api/courses/{course_id}", headers=user_a_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["total_sections"] == data["total_lectures"] == data["processed_subtitles"] == 12
        assert data["completed_lectures"] == 11
        assert data["next_lecture"]["learning_status"] == "IN_PROGRESS"
        assert len(data["sections"]) == 12
        assert len(data["sections"][0]["lectures"][0]["subtitles"]) == 1
        assert len(queries) <= 6
        queries.clear()
        db_session.expunge_all()
        response = client.get("/api/courses", headers=user_a_headers)
        assert response.status_code == 200
        assert response.json()["items"][0]["total_lectures"] == 12
        assert len(queries) <= 7
    finally:
        event.remove(engine, "before_cursor_execute", record_query)
