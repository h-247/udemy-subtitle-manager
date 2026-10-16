import pytest
from app.models.course import Course
from app.models.section import Section
from app.models.lecture import Lecture


def test_update_learning_status(client, user_a, user_a_headers, db_session):
    c = Course(user_id=user_a.id, course_id="c_stat", title="Status Test Course", url="https://udemy.com/course/status/")
    db_session.add(c)
    db_session.commit()
    sec = Section(course_id=c.id, title="Section 1", position=1)
    db_session.add(sec)
    db_session.commit()
    lec = Lecture(section_id=sec.id, lecture_id="lec_stat", title="Lecture 1", url="https://udemy.com/lec/stat", position=1)
    db_session.add(lec)
    db_session.commit()

    # Default is NOT_STARTED
    assert lec.learning_status == "NOT_STARTED"

    # Update to IN_PROGRESS
    res = client.patch(
        f"/api/courses/lectures/{lec.id}",
        json={"learning_status": "IN_PROGRESS"},
        headers=user_a_headers,
    )
    assert res.status_code == 200
    assert res.json()["learning_status"] == "IN_PROGRESS"

    # Update to COMPLETED
    res2 = client.patch(
        f"/api/courses/lectures/{lec.id}",
        json={"learning_status": "COMPLETED"},
        headers=user_a_headers,
    )
    assert res2.status_code == 200
    assert res2.json()["learning_status"] == "COMPLETED"


def test_update_learning_status_invalid(client, user_a, user_a_headers, db_session):
    c = Course(user_id=user_a.id, course_id="c_stat2", title="Status Test Course", url="https://udemy.com/course/status2/")
    db_session.add(c)
    db_session.commit()
    sec = Section(course_id=c.id, title="Section 1", position=1)
    db_session.add(sec)
    db_session.commit()
    lec = Lecture(section_id=sec.id, lecture_id="lec_stat2", title="Lecture 2", url="https://udemy.com/lec/stat2", position=1)
    db_session.add(lec)
    db_session.commit()

    res = client.patch(
        f"/api/courses/lectures/{lec.id}",
        json={"learning_status": "INVALID_STATUS"},
        headers=user_a_headers,
    )
    assert res.status_code == 400
    assert "Invalid learning status" in res.json()["detail"]


def test_chatgpt_link_management(client, user_a, user_a_headers, db_session):
    c = Course(user_id=user_a.id, course_id="c_gpt", title="GPT Course", url="https://udemy.com/course/gpt/")
    db_session.add(c)
    db_session.commit()
    sec = Section(course_id=c.id, title="Section 1", position=1)
    db_session.add(sec)
    db_session.commit()
    lec = Lecture(section_id=sec.id, lecture_id="lec_gpt", title="Lecture GPT", url="https://udemy.com/lec/gpt", position=1)
    db_session.add(lec)
    db_session.commit()

    # Add ChatGPT link
    chat_url = "https://chatgpt.com/c/6789-abcd-1234"
    res = client.patch(
        f"/api/courses/lectures/{lec.id}",
        json={"chatgpt_url": chat_url},
        headers=user_a_headers,
    )
    assert res.status_code == 200
    assert res.json()["chatgpt_url"] == chat_url

    # Clear ChatGPT link
    res_clear = client.patch(
        f"/api/courses/lectures/{lec.id}",
        json={"chatgpt_url": ""},
        headers=user_a_headers,
    )
    assert res_clear.status_code == 200
    assert res_clear.json()["chatgpt_url"] is None


def test_chatgpt_link_validation_rejects_non_chatgpt(client, user_a, user_a_headers, db_session):
    c = Course(user_id=user_a.id, course_id="c_gpt2", title="GPT Course 2", url="https://udemy.com/course/gpt2/")
    db_session.add(c)
    db_session.commit()
    sec = Section(course_id=c.id, title="Section 1", position=1)
    db_session.add(sec)
    db_session.commit()
    lec = Lecture(section_id=sec.id, lecture_id="lec_gpt2", title="Lecture GPT 2", url="https://udemy.com/lec/gpt2", position=1)
    db_session.add(lec)
    db_session.commit()

    res = client.patch(
        f"/api/courses/lectures/{lec.id}",
        json={"chatgpt_url": "https://malicious-site.com/fake"},
        headers=user_a_headers,
    )
    assert res.status_code == 400
    assert "URL must point to ChatGPT" in res.json()["detail"]
