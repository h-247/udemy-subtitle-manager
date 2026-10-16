import pytest
from app.models.course import Course
from app.models.section import Section
from app.models.lecture import Lecture
from app.models.udemy_session import UdemySession


def test_user_data_isolation(client, db_session, user_a, user_a_headers, user_b, user_b_headers):
    # Create course for user A
    course_a = Course(
        user_id=user_a.id,
        course_id="10101",
        title="User A's Secret Course",
        url="https://www.udemy.com/course/user-a-course/",
    )
    db_session.add(course_a)
    db_session.commit()
    db_session.refresh(course_a)

    sec_a = Section(course_id=course_a.id, title="Section 1", position=1)
    db_session.add(sec_a)
    db_session.commit()

    lec_a = Lecture(
        section_id=sec_a.id,
        lecture_id="555",
        title="Lecture 1",
        url="https://www.udemy.com/course/user-a-course/learn/lecture/555",
        duration=120,
        position=1,
    )
    db_session.add(lec_a)
    db_session.commit()

    # User A can see course
    res_a = client.get("/api/courses", headers=user_a_headers)
    assert res_a.status_code == 200
    assert any(c["id"] == course_a.id for c in res_a.json()["items"])

    # User B cannot see course in list
    res_b = client.get("/api/courses", headers=user_b_headers)
    assert res_b.status_code == 200
    assert not any(c["id"] == course_a.id for c in res_b.json()["items"])

    # User B cannot get course details
    res_b_detail = client.get(f"/api/courses/{course_a.id}", headers=user_b_headers)
    assert res_b_detail.status_code == 404

    # User B cannot delete User A's course
    res_b_del = client.delete(f"/api/courses/{course_a.id}", headers=user_b_headers)
    assert res_b_del.status_code == 404

    # User B cannot update User A's lecture
    res_b_patch = client.patch(
        f"/api/courses/lectures/{lec_a.id}",
        json={"learning_status": "COMPLETED"},
        headers=user_b_headers,
    )
    assert res_b_patch.status_code == 404
