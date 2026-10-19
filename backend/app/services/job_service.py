import os
import json
import logging
import threading
import time
from urllib.parse import urlparse
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.config import settings
from app.models.user import User
from app.models.udemy_session import UdemySession
from app.models.course import Course
from app.models.section import Section
from app.models.lecture import Lecture
from app.models.subtitle import Subtitle
from app.models.job import ProcessingJob
import httpx
from app.services.crypto_service import crypto_service
from app.services.cookie_service import cookie_service, is_udemy_domain
from app.services.udemy_service import udemy_service, normalize_udemy_url, extract_course_slug
from app.services.subtitle_processor import subtitle_processor
from app.services.drive_service import drive_service, sanitize_filename

logger = logging.getLogger(__name__)

# In-memory set of cancelled job IDs for rapid cooperative cancellation
_cancelled_job_ids = set()
_job_lock = threading.Lock()


def cancel_job_in_memory(job_id: int):
    with _job_lock:
        _cancelled_job_ids.add(job_id)


def is_job_cancelled(job_id: int) -> bool:
    with _job_lock:
        return job_id in _cancelled_job_ids


class JobService:
    @staticmethod
    def queue_course_import(user_id: int, course_url: str) -> ProcessingJob:
        """Creates a ProcessingJob record and starts background import thread."""
        db = SessionLocal()
        try:
            job = ProcessingJob(
                user_id=user_id,
                job_type="COURSE_IMPORT",
                status="PROCESSING",
                total_items=3,
                completed_items=0,
                failed_items=0,
                progress_message="Starting course import...",
            )
            db.add(job)
            db.commit()
            db.refresh(job)
            job_id = job.id

            thread = threading.Thread(
                target=JobService._execute_course_import,
                args=(job_id, user_id, course_url),
                daemon=True,
            )
            thread.start()
            return job
        finally:
            db.close()

    @staticmethod
    def _execute_course_import(job_id: int, user_id: int, raw_url: str, db: Optional[Session] = None):
        should_close = False
        if db is None:
            db = SessionLocal()
            should_close = True
        try:
            job = db.query(ProcessingJob).filter(ProcessingJob.id == job_id).first()
            if not job or is_job_cancelled(job_id):
                return

            normalized_url = normalize_udemy_url(raw_url)
            slug = extract_course_slug(normalized_url)
            course_domain = urlparse(normalized_url).netloc.lower()

            # Get user's Udemy cookies if available
            session_rec = db.query(UdemySession).filter(UdemySession.user_id == user_id).first()
            cookies_dict = None
            if session_rec and session_rec.encrypted_cookie_data:
                try:
                    cookie_text = crypto_service.decrypt_text(session_rec.encrypted_cookie_data)
                    _, _, cookies_dict = cookie_service.validate_and_parse_netscape(cookie_text)
                    business_domain = cookie_service.extract_business_domain(cookie_text)
                    if course_domain in ("udemy.com", "www.udemy.com") and business_domain:
                        course_domain = business_domain
                    if business_domain:
                        from app.api.udemy import replace_udemy_domain
                        normalized_url = replace_udemy_domain(normalized_url, business_domain)
                except Exception as e:
                    logger.warning(f"Could not decrypt/parse user cookies: {e}")

            job.progress_message = "Retrieving course metadata from Udemy..."
            db.commit()

            details = udemy_service.fetch_course_details(slug, cookies_dict, domain=course_domain)
            course_udemy_id = details["course_id"]

            job.completed_items = 1
            job.progress_message = "Retrieving curriculum items (sections & lectures)..."
            db.commit()

            curriculum_items = udemy_service.fetch_curriculum_items(course_udemy_id, cookies_dict, domain=course_domain)
            parsed_sections = udemy_service.parse_curriculum(curriculum_items, normalized_url)

            job.total_items = 3 + len(parsed_sections)
            job.completed_items = 2
            job.progress_message = f"Saving {len(parsed_sections)} sections and their lectures..."
            db.commit()

            # Check if course exists for user
            existing_course = (
                db.query(Course)
                .filter(Course.user_id == user_id, Course.course_id == course_udemy_id)
                .first()
            )

            if existing_course:
                # Synchronize without losing user data (AC10)
                course = existing_course
                course.title = details.get("title", course.title)
                course.instructor = details.get("instructor", course.instructor)
                course.thumbnail_url = details.get("thumbnail_url", course.thumbnail_url)
                course.url = normalized_url
                course.last_synced_at = datetime.now(timezone.utc)
                db.commit()

                # Sync sections and lectures
                # Build lookup of existing lectures by lecture_id
                existing_lectures = {}
                for sec in course.sections:
                    for lec in sec.lectures:
                        existing_lectures[lec.lecture_id] = lec

                # Update or add sections
                for sec_idx, sec_data in enumerate(parsed_sections, 1):
                    job.completed_items = 2 + sec_idx - 1
                    job.progress_message = f"Saving section {sec_idx}/{len(parsed_sections)}: {sec_data['title']}"
                    db.commit()
                    sec = (
                        db.query(Section)
                        .filter(Section.course_id == course.id, Section.position == sec_idx)
                        .first()
                    )
                    if not sec:
                        sec = Section(
                            course_id=course.id,
                            title=sec_data["title"],
                            position=sec_idx,
                        )
                        db.add(sec)
                        db.commit()
                        db.refresh(sec)
                    else:
                        sec.title = sec_data["title"]
                        db.commit()

                    for lec_idx, lec_data in enumerate(sec_data["lectures"], 1):
                        lec_id = lec_data["lecture_id"]
                        if lec_id in existing_lectures:
                            # Update metadata while preserving learning_status & chatgpt_url
                            lec = existing_lectures[lec_id]
                            lec.title = lec_data["title"]
                            lec.duration = lec_data["duration"]
                            lec.url = lec_data["url"]
                            lec.lecture_type = lec_data["lecture_type"]
                            lec.position = lec_idx
                            lec.section_id = sec.id
                        else:
                            lec = Lecture(
                                section_id=sec.id,
                                lecture_id=lec_id,
                                title=lec_data["title"],
                                url=lec_data["url"],
                                lecture_type=lec_data["lecture_type"],
                                duration=lec_data["duration"],
                                position=lec_idx,
                                learning_status="NOT_STARTED",
                            )
                            db.add(lec)
                        db.commit()
            else:
                # Create brand new course
                course = Course(
                    user_id=user_id,
                    course_id=course_udemy_id,
                    title=details.get("title") or slug.replace("-", " ").title(),
                    url=normalized_url,
                    instructor=details.get("instructor"),
                    thumbnail_url=details.get("thumbnail_url"),
                    last_synced_at=datetime.now(timezone.utc),
                )
                db.add(course)
                db.commit()
                db.refresh(course)

                for sec_idx, sec_data in enumerate(parsed_sections, 1):
                    job.completed_items = 2 + sec_idx - 1
                    job.progress_message = f"Saving section {sec_idx}/{len(parsed_sections)}: {sec_data['title']}"
                    db.commit()
                    sec = Section(
                        course_id=course.id,
                        title=sec_data["title"],
                        position=sec_idx,
                    )
                    db.add(sec)
                    db.commit()
                    db.refresh(sec)

                    for lec_idx, lec_data in enumerate(sec_data["lectures"], 1):
                        lec = Lecture(
                            section_id=sec.id,
                            lecture_id=lec_data["lecture_id"],
                            title=lec_data["title"],
                            url=lec_data["url"],
                            lecture_type=lec_data["lecture_type"],
                            duration=lec_data["duration"],
                            position=lec_idx,
                            learning_status="NOT_STARTED",
                        )
                        db.add(lec)
                    db.commit()

            job.course_id = course.id
            job.status = "COMPLETED"
            job.completed_items = job.total_items
            job.progress_message = f"Course '{course.title}' imported successfully with {len(parsed_sections)} sections."
            db.commit()

        except Exception as exc:
            logger.error(f"Course import failed: {exc}", exc_info=True)
            job = db.query(ProcessingJob).filter(ProcessingJob.id == job_id).first()
            if job:
                job.status = "FAILED"
                job.failed_items = 1
                job.error_message = str(exc)
                job.progress_message = f"Import failed: {str(exc)}"
                db.commit()
        finally:
            if should_close:
                db.close()

    @staticmethod
    def queue_subtitle_batch(
        user_id: int,
        lecture_ids: List[int],
        course_id: Optional[int] = None,
        language: str = "en",
    ) -> ProcessingJob:
        """Queues background batch subtitle processing for specified lectures."""
        db = SessionLocal()
        try:
            job = ProcessingJob(
                user_id=user_id,
                course_id=course_id,
                job_type="SUBTITLE_BATCH",
                status="PROCESSING",
                total_items=len(lecture_ids),
                completed_items=0,
                failed_items=0,
                progress_message="Starting subtitle processing batch...",
            )
            db.add(job)
            db.commit()
            db.refresh(job)
            job_id = job.id

            thread = threading.Thread(
                target=JobService._execute_subtitle_batch,
                args=(job_id, user_id, lecture_ids, language),
                daemon=True,
            )
            thread.start()
            return job
        finally:
            db.close()

    @staticmethod
    def _execute_subtitle_batch(
        job_id: int,
        user_id: int,
        lecture_ids: List[int],
        target_lang: str,
        db: Optional[Session] = None,
    ):
        should_close = False
        if db is None:
            db = SessionLocal()
            should_close = True
        try:
            job = db.query(ProcessingJob).filter(ProcessingJob.id == job_id).first()
            if not job:
                return

            # Get user & drive credentials
            user = db.query(User).filter(User.id == user_id).first()
            drive_creds = None
            if user and user.drive_credentials:
                try:
                    drive_creds = json.loads(user.drive_credentials)
                except Exception:
                    pass

            # Get user Udemy cookies & business domain
            session_rec = db.query(UdemySession).filter(UdemySession.user_id == user_id).first()
            cookies_dict = None
            business_domain = None
            if session_rec and session_rec.encrypted_cookie_data:
                try:
                    cookie_text = crypto_service.decrypt_text(session_rec.encrypted_cookie_data)
                    _, _, cookies_dict = cookie_service.validate_and_parse_netscape(cookie_text)
                    business_domain = cookie_service.extract_business_domain(cookie_text)
                except Exception as e:
                    logger.warning(f"Failed to decrypt user cookies for subtitles: {e}")

            # Preload captions map from subscriber curriculum if cookies available
            captions_cache: Dict[str, List[Dict[str, Any]]] = {}
            if cookies_dict:
                try:
                    job.progress_message = "Pre-fetching curriculum captions from Udemy..."
                    db.commit()
                    course_records = (
                        db.query(Course.course_id, Course.url)
                        .join(Section, Section.course_id == Course.id)
                        .join(Lecture, Lecture.section_id == Section.id)
                        .filter(Lecture.id.in_(lecture_ids))
                        .distinct()
                        .all()
                    )
                    for c_id, c_url in course_records:
                        c_domain = urlparse(c_url).netloc.lower() if c_url else None
                        fetch_domain = business_domain or c_domain
                        curric_items = udemy_service.fetch_curriculum_items(c_id, cookies_dict, domain=fetch_domain)
                        for item in curric_items:
                            if item.get("_class") == "lecture":
                                l_id = str(item.get("id"))
                                asset = item.get("asset") or {}
                                caps = asset.get("captions") or asset.get("subtitles") or []
                                if caps:
                                    captions_cache[l_id] = caps
                except Exception as e:
                    logger.warning(f"Could not preload curriculum captions: {e}")

            for idx, lec_id in enumerate(lecture_ids, 1):
                if is_job_cancelled(job_id):
                    job.status = "CANCELLED"
                    job.progress_message = f"Job cancelled. Processed {job.completed_items}/{job.total_items} items."
                    db.commit()
                    return

                lecture = (
                    db.query(Lecture)
                    .join(Section)
                    .join(Course)
                    .filter(Lecture.id == lec_id, Course.user_id == user_id)
                    .first()
                )
                if not lecture:
                    job.failed_items += 1
                    continue

                section = lecture.section
                course = section.course

                target_base = target_lang.lower().split("-")[0].split("_")[0]

                # Get or create subtitle record - match exact language or language prefix (e.g. en matching en_US)
                sub_rec = (
                    db.query(Subtitle)
                    .filter(
                        Subtitle.lecture_id == lecture.id,
                        or_(
                            Subtitle.language == target_lang,
                            Subtitle.language.startswith(f"{target_base}_"),
                            Subtitle.language.startswith(f"{target_base}-"),
                        ),
                    )
                    .first()
                )
                if not sub_rec:
                    # Also look up if any subtitle record already exists for this lecture
                    sub_rec = db.query(Subtitle).filter(Subtitle.lecture_id == lecture.id).first()

                if sub_rec and sub_rec.status == "COMPLETED" and (sub_rec.drive_file_id or not drive_creds):
                    job.completed_items += 1
                    continue

                if not sub_rec:
                    sub_rec = Subtitle(
                        lecture_id=lecture.id,
                        language=target_lang,
                        subtitle_type="NONE",
                        status="PROCESSING",
                    )
                    db.add(sub_rec)
                else:
                    sub_rec.status = "PROCESSING"
                    sub_rec.error_message = None
                    sub_rec.error_category = None
                db.commit()
                db.refresh(sub_rec)

                job.progress_message = f"Processing ({idx}/{job.total_items}): {lecture.title}"
                db.commit()

                # Process subtitle for this lecture
                try:
                    JobService._process_single_lecture_subtitle(
                        db=db,
                        lecture=lecture,
                        section=section,
                        course=course,
                        sub_rec=sub_rec,
                        target_lang=target_lang,
                        cookies_dict=cookies_dict,
                        drive_creds=drive_creds,
                        cached_captions=captions_cache.get(lecture.lecture_id),
                    )
                    if sub_rec.status == "COMPLETED":
                        job.completed_items += 1
                    else:
                        job.failed_items += 1
                except Exception as exc:
                    logger.error(f"Error processing subtitle for lecture {lec_id}: {exc}", exc_info=True)
                    db.rollback()
                    try:
                        failed_sub = db.query(Subtitle).filter(Subtitle.id == sub_rec.id).first()
                        if failed_sub:
                            failed_sub.status = "FAILED"
                            failed_sub.error_message = str(exc)
                            failed_sub.error_category = "PROCESSING_ERROR"
                            db.commit()
                    except Exception as rollback_err:
                        logger.error(f"Failed to record failure for subtitle: {rollback_err}")
                        db.rollback()
                    job.failed_items += 1

                # Polite throttle
                time.sleep(0.1)

            job.status = "COMPLETED"
            job.progress_message = (
                f"Batch completed: {job.completed_items} succeeded, {job.failed_items} failed or had no subtitles."
            )
            db.commit()

        except Exception as exc:
            logger.error(f"Batch subtitle processing job {job_id} encountered fatal error: {exc}", exc_info=True)
            db.rollback()
            try:
                job = db.query(ProcessingJob).filter(ProcessingJob.id == job_id).first()
                if job:
                    job.status = "FAILED"
                    job.error_message = str(exc)
                    db.commit()
            except Exception:
                pass
        finally:
            if should_close:
                db.close()

    @staticmethod
    def _process_single_lecture_subtitle(
        db: Session,
        lecture: Lecture,
        section: Section,
        course: Course,
        sub_rec: Subtitle,
        target_lang: str,
        cookies_dict: Optional[Dict[str, str]],
        drive_creds: Optional[Dict[str, Any]],
        cached_captions: Optional[List[Dict[str, Any]]] = None,
    ):
        """Processes subtitle extraction and conditional Google Drive upload for a single lecture."""
        if lecture.lecture_type != "video":
            sub_rec.status = "NO_SUBTITLES"
            sub_rec.subtitle_type = "NONE"
            sub_rec.error_category = "UNSUPPORTED_TYPE"
            sub_rec.error_message = f"Lecture is a {lecture.lecture_type}, not a video."
            sub_rec.last_processed_at = datetime.now(timezone.utc)
            db.commit()
            return

        captions: List[Dict[str, Any]] = cached_captions or []

        # Try fetching lecture asset captions if not preloaded and cookies available
        if not captions and cookies_dict:
            try:
                course_domain = urlparse(course.url).netloc.lower() if course.url else None
                domains_to_try = []
                if course_domain and is_udemy_domain(course_domain):
                    domains_to_try.append(course_domain)

                # Check if session has a business domain
                session_rec = db.query(UdemySession).filter(UdemySession.user_id == course.user_id).first()
                if session_rec and session_rec.encrypted_cookie_data:
                    try:
                        decrypted = crypto_service.decrypt_text(session_rec.encrypted_cookie_data)
                        b_dom = cookie_service.extract_business_domain(decrypted)
                        if b_dom and b_dom not in domains_to_try:
                            domains_to_try.append(b_dom)
                    except Exception:
                        pass

                if "www.udemy.com" not in domains_to_try:
                    domains_to_try.append("www.udemy.com")

                params = {
                    "fields[lecture]": "title,asset,transcript",
                    "fields[asset]": "@all",
                }
                headers = udemy_service._get_auth_headers(cookies_dict)

                with httpx.Client(timeout=15.0, cookies=cookies_dict, headers=headers, follow_redirects=True) as client:
                    for target_domain in domains_to_try:
                        asset_url = f"https://{target_domain}/api-2.0/users/me/subscribed-courses/{course.course_id}/lectures/{lecture.lecture_id}/"
                        resp = client.get(asset_url, params=params)
                        if resp.status_code == 200:
                            data = resp.json()
                            asset = data.get("asset") or {}
                            captions = asset.get("captions") or asset.get("subtitles") or []
                            # Update lecture duration if missing or 0
                            if (not lecture.duration or lecture.duration == 0) and asset:
                                dur = asset.get("time_estimation") or asset.get("length")
                                if dur:
                                    lecture.duration = int(dur)
                                    db.commit()
                            if captions:
                                break
            except Exception as e:
                logger.warning(f"Could not fetch lecture asset captions: {e}")

        selected_caption, sub_type, lang_code = subtitle_processor.select_subtitle(captions, target_lang)

        if not selected_caption or not selected_caption.get("url"):
            sub_rec.status = "NO_SUBTITLES"
            sub_rec.subtitle_type = "NONE"
            sub_rec.error_category = "NO_SUBTITLES"
            sub_rec.error_message = "No subtitles found for this lecture."
            sub_rec.last_processed_at = datetime.now(timezone.utc)
            db.commit()
            return

        # Download caption text
        caption_url = selected_caption["url"]
        caption_text = udemy_service.download_caption_direct(caption_url, cookies_dict)

        # Build clean filenames
        # Format: Section 01 - Introduction / 001 - Welcome.vtt
        sec_num = f"{section.position:02d}"
        lec_num = f"{lecture.position:03d}"
        safe_sec_title = sanitize_filename(section.title)
        safe_lec_title = sanitize_filename(lecture.title)
        filename = f"{lec_num} - {safe_lec_title}.vtt"
        temp_file_path = subtitle_processor.save_vtt_file(caption_text, f"{lecture.lecture_id}_{filename}")

        final_lang = lang_code or target_lang

        # Avoid UNIQUE constraint (lecture_id, language) violation if a duplicate record exists
        existing_duplicate = (
            db.query(Subtitle)
            .filter(
                Subtitle.lecture_id == lecture.id,
                Subtitle.language == final_lang,
                Subtitle.id != sub_rec.id,
            )
            .first()
        )
        if existing_duplicate:
            db.delete(sub_rec)
            db.commit()
            sub_rec = existing_duplicate

        sub_rec.subtitle_type = sub_type
        sub_rec.language = final_lang
        sub_rec.last_processed_at = datetime.now(timezone.utc)

        # Upload to Google Drive if connected
        if drive_creds:
            folder_hierarchy = [
                settings.GOOGLE_DRIVE_FOLDER_NAME,
                sanitize_filename(course.title),
                f"Section {sec_num} - {safe_sec_title}",
            ]
            try:
                upload_res = drive_service.upload_subtitle(
                    file_path=temp_file_path,
                    upload_filename=filename,
                    folder_hierarchy=folder_hierarchy,
                    credentials_data=drive_creds,
                    delete_on_success=True,  # Crucial requirement: deletes temp file ONLY after verified upload!
                )
                sub_rec.drive_file_id = upload_res["drive_file_id"]
                sub_rec.drive_file_url = upload_res["drive_file_url"]
                sub_rec.status = "COMPLETED"
                sub_rec.error_message = None
                sub_rec.error_category = None
            except Exception as drive_err:
                logger.error(f"Drive upload failed for lecture {lecture.id}: {drive_err}")
                sub_rec.status = "FAILED"
                sub_rec.error_category = "DRIVE_ERROR"
                sub_rec.error_message = f"Google Drive upload failed: {str(drive_err)}"
                # Temp file is preserved since upload failed
        else:
            # No Google Drive connected: mark as COMPLETED locally
            sub_rec.status = "COMPLETED"
            sub_rec.error_message = None
            sub_rec.error_category = None

        db.commit()


job_service = JobService()
