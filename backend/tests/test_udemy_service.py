import pytest
from app.services.udemy_service import normalize_udemy_url, extract_course_slug, udemy_service


def test_url_normalization_valid_formats():
    urls = [
        "https://www.udemy.com/course/the-complete-web-development-bootcamp/",
        "https://www.udemy.com/course/the-complete-web-development-bootcamp/learn/",
        "https://www.udemy.com/course/the-complete-web-development-bootcamp/learn/lecture/123456",
        "https://udemy.com/course/the-complete-web-development-bootcamp?couponCode=DISCOUNT",
        "udemy.com/course/the-complete-web-development-bootcamp",
    ]
    expected = "https://www.udemy.com/course/the-complete-web-development-bootcamp/"
    for u in urls:
        assert normalize_udemy_url(u) == expected
        assert extract_course_slug(u) == "the-complete-web-development-bootcamp"


def test_url_normalization_business_domains():
    biz_urls = [
        "https://ifg.udemy.com/course/communication-skills/",
        "https://ifg.udemy.com/course/communication-skills/learn/",
        "https://ifg.udemy.com/course/communication-skills/learn/lecture/998877",
        "ifg.udemy.com/course/communication-skills",
    ]
    expected = "https://ifg.udemy.com/course/communication-skills/"
    for u in biz_urls:
        assert normalize_udemy_url(u) == expected
        assert extract_course_slug(u) == "communication-skills"



def test_url_normalization_invalid():
    with pytest.raises(ValueError, match="Invalid domain"):
        normalize_udemy_url("https://youtube.com/watch?v=dQw4w9WgXcQ")

    with pytest.raises(ValueError, match="Could not identify a Udemy course"):
        normalize_udemy_url("https://www.udemy.com/user/edit-profile/")

    with pytest.raises(ValueError, match="URL cannot be empty"):
        normalize_udemy_url("   ")


def test_parse_curriculum_ordering():
    raw_items = [
        {
            "_class": "chapter",
            "title": "Getting Started",
        },
        {
            "_class": "lecture",
            "id": 101,
            "title": "Welcome to the Course",
            "asset": {"asset_type": "Video", "time_estimation": 180},
        },
        {
            "_class": "lecture",
            "id": 102,
            "title": "Course Syllabus",
            "asset": {"asset_type": "Article", "time_estimation": 60},
        },
        {
            "_class": "chapter",
            "title": "Deep Dive",
        },
        {
            "_class": "lecture",
            "id": 103,
            "title": "Core Architecture",
            "asset": {"asset_type": "Video", "time_estimation": 600},
        },
    ]

    sections = udemy_service.parse_curriculum(
        raw_items,
        "https://www.udemy.com/course/test-course/"
    )

    assert len(sections) == 2
    # Section 1
    assert sections[0]["title"] == "Getting Started"
    assert sections[0]["position"] == 1
    assert len(sections[0]["lectures"]) == 2
    assert sections[0]["lectures"][0]["title"] == "Welcome to the Course"
    assert sections[0]["lectures"][0]["position"] == 1
    assert sections[0]["lectures"][0]["lecture_type"] == "video"
    assert sections[0]["lectures"][0]["duration"] == 180

    assert sections[0]["lectures"][1]["title"] == "Course Syllabus"
    assert sections[0]["lectures"][1]["position"] == 2
    assert sections[0]["lectures"][1]["lecture_type"] == "article"

    # Section 2
    assert sections[1]["title"] == "Deep Dive"
    assert sections[1]["position"] == 2
    assert len(sections[1]["lectures"]) == 1
    assert sections[1]["lectures"][0]["title"] == "Core Architecture"
    assert sections[1]["lectures"][0]["position"] == 1
