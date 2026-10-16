import io
import pytest
from app.services.subtitle_processor import subtitle_processor, srt_to_vtt_text
from app.models.course import Course
from app.models.section import Section
from app.models.lecture import Lecture
from app.models.subtitle import Subtitle


def test_subtitle_selection_preference():
    captions = [
        {"locale_id": "en_US", "source": "auto", "label": "English [Auto]", "url": "https://cdn.udemy/auto_en.vtt"},
        {"locale_id": "en_US", "source": "manual", "label": "English", "url": "https://cdn.udemy/manual_en.vtt"},
        {"locale_id": "es_ES", "source": "manual", "label": "Spanish", "url": "https://cdn.udemy/es.vtt"},
    ]

    # Preference: manual English should be chosen over auto
    selected, sub_type, lang = subtitle_processor.select_subtitle(captions, "en")
    assert selected["url"] == "https://cdn.udemy/manual_en.vtt"
    assert sub_type == "MANUAL"
    assert lang == "en_US"


def test_subtitle_selection_fallback_to_auto():
    captions = [
        {"locale_id": "en_US", "source": "auto", "label": "English [Auto]", "url": "https://cdn.udemy/auto_en.vtt"},
        {"locale_id": "fr_FR", "source": "manual", "label": "French", "url": "https://cdn.udemy/fr.vtt"},
    ]

    selected, sub_type, lang = subtitle_processor.select_subtitle(captions, "en")
    assert selected["url"] == "https://cdn.udemy/auto_en.vtt"
    assert sub_type == "AUTO"  # Never falsely labeled as MANUAL


def test_subtitle_selection_custom_language():
    captions = [
        {"locale_id": "en_US", "source": "manual", "label": "English", "url": "https://cdn.udemy/manual_en.vtt"},
        {"locale_id": "es_ES", "source": "manual", "label": "Spanish", "url": "https://cdn.udemy/es.vtt"},
    ]

    selected, sub_type, lang = subtitle_processor.select_subtitle(captions, "es")
    assert selected["url"] == "https://cdn.udemy/es.vtt"
    assert sub_type == "MANUAL"
    assert lang == "es_ES"


def test_subtitle_selection_none_available():
    selected, sub_type, lang = subtitle_processor.select_subtitle([], "en")
    assert selected is None
    assert sub_type == "NONE"


def test_srt_to_vtt_conversion():
    srt_sample = """1
00:00:01,000 --> 00:00:04,500
Hello and welcome to this lecture.

2
00:00:05,200 --> 00:00:08,800
Let's learn how subtitles work.
"""
    vtt = srt_to_vtt_text(srt_sample)
    assert vtt.startswith("WEBVTT")
    assert "00:00:01.000 --> 00:00:04.500" in vtt
    assert "00:00:05.200 --> 00:00:08.800" in vtt
    assert "Hello and welcome to this lecture." in vtt


def test_manual_subtitle_upload_api(client, user_a, user_a_headers, db_session):
    # Setup course, section, lecture
    c = Course(user_id=user_a.id, course_id="c_sub", title="Sub Course", url="https://www.udemy.com/course/sub-course/")
    db_session.add(c)
    db_session.commit()
    sec = Section(course_id=c.id, title="Sec 1", position=1)
    db_session.add(sec)
    db_session.commit()
    lec = Lecture(section_id=sec.id, lecture_id="lec_1", title="Lecture 1", url="https://udemy.com/lec/1", position=1)
    db_session.add(lec)
    db_session.commit()

    srt_content = "1\n00:00:01,000 --> 00:00:02,000\nTesting upload\n"
    file_obj = io.BytesIO(srt_content.encode("utf-8"))

    res = client.post(
        f"/api/subtitles/lectures/{lec.id}/upload",
        files={"file": ("lecture_sub.srt", file_obj, "text/plain")},
        data={"language": "en"},
        headers=user_a_headers,
    )

    assert res.status_code == 200
    data = res.json()
    assert data["subtitle"]["status"] == "COMPLETED"
    assert data["subtitle"]["subtitle_type"] == "IMPORTED"
    assert data["subtitle"]["language"] == "en"

    # Verify in DB
    sub = db_session.query(Subtitle).filter(Subtitle.lecture_id == lec.id).first()
    assert sub is not None
    assert sub.status == "COMPLETED"
    assert sub.subtitle_type == "IMPORTED"


def test_manual_subtitle_upload_invalid_extension(client, user_a, user_a_headers, db_session):
    c = Course(user_id=user_a.id, course_id="c_sub2", title="Sub Course", url="https://www.udemy.com/course/sub-course2/")
    db_session.add(c)
    db_session.commit()
    sec = Section(course_id=c.id, title="Sec 1", position=1)
    db_session.add(sec)
    db_session.commit()
    lec = Lecture(section_id=sec.id, lecture_id="lec_2", title="Lecture 2", url="https://udemy.com/lec/2", position=1)
    db_session.add(lec)
    db_session.commit()

    file_obj = io.BytesIO(b"fake video bytes")
    res = client.post(
        f"/api/subtitles/lectures/{lec.id}/upload",
        files={"file": ("video.mp4", file_obj, "video/mp4")},
        headers=user_a_headers,
    )
    assert res.status_code == 400
    assert "Unsupported subtitle file format" in res.json()["detail"]


def test_delete_subtitle(client, user_a_headers, db_session):
    course = Course(user_id=1, course_id="103", title="Course 3", url="https://udemy.com/course/3")
    db_session.add(course)
    db_session.commit()
    sec = Section(course_id=course.id, title="Section 1", position=1)
    db_session.add(sec)
    db_session.commit()
    lec = Lecture(section_id=sec.id, lecture_id="lec_3", title="Lecture 3", url="https://udemy.com/lec/3", position=1)
    db_session.add(lec)
    db_session.commit()
    sub = Subtitle(lecture_id=lec.id, language="en", status="COMPLETED", subtitle_type="MANUAL")
    db_session.add(sub)
    db_session.commit()

    res = client.delete(f"/api/subtitles/{sub.id}", headers=user_a_headers)
    assert res.status_code == 200
    assert res.json()["id"] == sub.id

    check = db_session.query(Subtitle).filter(Subtitle.id == sub.id).first()
    assert check is None


def test_delete_lecture_subtitles(client, user_a_headers, db_session):
    course = Course(user_id=1, course_id="104", title="Course 4", url="https://udemy.com/course/4")
    db_session.add(course)
    db_session.commit()
    sec = Section(course_id=course.id, title="Section 1", position=1)
    db_session.add(sec)
    db_session.commit()
    lec = Lecture(section_id=sec.id, lecture_id="lec_4", title="Lecture 4", url="https://udemy.com/lec/4", position=1)
    db_session.add(lec)
    db_session.commit()
    sub1 = Subtitle(lecture_id=lec.id, language="en", status="COMPLETED", subtitle_type="MANUAL")
    sub2 = Subtitle(lecture_id=lec.id, language="vi", status="COMPLETED", subtitle_type="AUTO")
    db_session.add_all([sub1, sub2])
    db_session.commit()

    res = client.delete(f"/api/subtitles/lectures/{lec.id}", headers=user_a_headers)
    assert res.status_code == 200
    assert res.json()["lecture_id"] == lec.id

    subs = db_session.query(Subtitle).filter(Subtitle.lecture_id == lec.id).all()
    assert len(subs) == 0
