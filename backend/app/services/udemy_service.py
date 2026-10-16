import re
import time
import json
import logging
from typing import Dict, Any, List, Optional, Tuple
from urllib.parse import urlparse, parse_qs
import httpx
import yt_dlp

from app.config import settings
from app.services.cookie_service import cookie_service, is_udemy_domain

logger = logging.getLogger(__name__)

UDEMY_SLUG_PATTERN = re.compile(r"udemy\.com/course/([a-zA-Z0-9_\-]+)", re.IGNORECASE)


def normalize_udemy_url(raw_url: str) -> str:
    """
    Validates and normalizes Udemy course URL.
    Supports standard udemy.com and enterprise subdomains (e.g. ifg.udemy.com).
    Returns standard format: https://[domain]/course/<course-slug>/
    Raises ValueError if URL is invalid or not a Udemy course.
    """
    url = raw_url.strip()
    if not url:
        raise ValueError("URL cannot be empty.")

    if not url.startswith("http://") and not url.startswith("https://"):
        url = "https://" + url

    parsed = urlparse(url)
    domain = parsed.netloc.lower()

    if not is_udemy_domain(domain):
        raise ValueError("Invalid domain. Only udemy.com and *.udemy.com URLs are supported.")

    match = UDEMY_SLUG_PATTERN.search(url)
    if not match:
        raise ValueError(
            "Could not identify a Udemy course in the URL. "
            "Expected format: https://www.udemy.com/course/<course-name>/ or https://<subdomain>.udemy.com/course/<course-name>/"
        )

    slug = match.group(1).lower()
    canonical_domain = domain if domain.endswith(".udemy.com") and domain != "udemy.com" else "www.udemy.com"
    return f"https://{canonical_domain}/course/{slug}/"


def extract_course_slug(url: str) -> str:
    """Extracts course slug from normalized or raw Udemy course URL."""
    match = UDEMY_SLUG_PATTERN.search(url)
    if not match:
        raise ValueError("Unable to extract course slug from URL.")
    return match.group(1).lower()


class UdemyService:
    def __init__(self):
        self.headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "en-US,en;q=0.9",
        }

    def _get_auth_headers(self, cookies_dict: Dict[str, str]) -> Dict[str, str]:
        """Prepares headers and authorization bearer if access_token cookie is present."""
        headers = dict(self.headers)
        access_token = cookies_dict.get("access_token")
        if access_token:
            headers["Authorization"] = f"Bearer {access_token}"
        return headers

    def validate_session(self, cookie_text: str) -> Tuple[str, Optional[str], Optional[str]]:
        """
        Validates Udemy cookies against Udemy's authenticated endpoints.
        Supports both standard Udemy and Udemy Business subdomains.
        Returns: (status, account_name, error_message)
        Statuses: CONNECTED, EXPIRED_SESSION, INVALID_COOKIES, ACCESS_DENIED, AUTH_REQUIRED
        """
        try:
            _, sanitized_content, cookies_dict = cookie_service.validate_and_parse_netscape(cookie_text)
        except Exception as e:
            return "INVALID_COOKIES", None, str(e)

        business_domain = (
            cookie_service.extract_business_domain(cookie_text)
            or cookie_service.extract_business_domain(sanitized_content)
        )

        endpoints = []
        if business_domain:
            endpoints.append(f"https://{business_domain}/api-2.0/users/me/")
        endpoints.append("https://www.udemy.com/api-2.0/users/me/")

        headers = self._get_auth_headers(cookies_dict)
        last_status_code = None
        last_error = None

        for url in endpoints:
            try:
                with httpx.Client(timeout=15.0, cookies=cookies_dict, headers=headers, follow_redirects=True) as client:
                    resp = client.get(url)
                    last_status_code = resp.status_code

                    if resp.status_code == 200:
                        data = resp.json()
                        name = data.get("title") or data.get("display_name") or data.get("name")
                        return "CONNECTED", name, None
                    elif resp.status_code == 401:
                        last_error = "Udemy session has expired. Please update your cookies."
                    elif resp.status_code == 403:
                        last_error = "Udemy denied access. The account may need verification or Cloudflare clearance."
                    else:
                        last_error = f"Udemy returned HTTP status {resp.status_code}."
            except httpx.RequestError as exc:
                logger.warning(f"Network error testing Udemy connection ({url}): {exc}")
                last_error = f"Could not connect to Udemy: {str(exc)}"

        if last_status_code == 401:
            return "EXPIRED_SESSION", None, last_error
        elif last_status_code == 403:
            return "ACCESS_DENIED", None, last_error
        else:
            return "INVALID_COOKIES", None, last_error

    def fetch_course_details(
        self,
        slug_or_id: str,
        cookies_dict: Optional[Dict[str, str]] = None,
        domain: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Fetches high-level course information (id, title, instructor, thumbnail).
        """
        domains = []
        if domain and is_udemy_domain(domain):
            domains.append(domain)
        if "www.udemy.com" not in domains:
            domains.append("www.udemy.com")

        params = {
            "fields[course]": "id,title,headline,image_480x270,visible_instructors,url",
        }
        headers = self._get_auth_headers(cookies_dict or {})

        max_retries = settings.UDEMY_MAX_RETRIES
        delay = settings.UDEMY_RETRY_DELAY

        last_exc = None
        for target_domain in domains:
            url = f"https://{target_domain}/api-2.0/courses/{slug_or_id}/"
            for attempt in range(max_retries + 1):
                try:
                    with httpx.Client(timeout=settings.UDEMY_REQUEST_TIMEOUT, cookies=cookies_dict or {}, headers=headers, follow_redirects=True) as client:
                        resp = client.get(url, params=params)

                        if resp.status_code == 200:
                            data = resp.json()
                            instructors = data.get("visible_instructors") or []
                            instructor_name = instructors[0].get("display_name") if instructors else None

                            course_path = data.get("url", "")
                            full_url = f"https://{target_domain}{course_path}" if course_path.startswith("/") else course_path

                            return {
                                "course_id": str(data.get("id")),
                                "title": data.get("title", ""),
                                "url": full_url,
                                "instructor": instructor_name,
                                "thumbnail_url": data.get("image_480x270"),
                            }
                        elif resp.status_code == 429 and attempt < max_retries:
                            time.sleep(delay * (2 ** attempt))
                            continue
                        elif resp.status_code in (401, 403):
                            last_exc = PermissionError(f"Access denied by Udemy on {target_domain} (HTTP {resp.status_code}).")
                            break
                        elif resp.status_code == 404:
                            last_exc = ValueError("Course not found on Udemy.")
                            break
                        else:
                            resp.raise_for_status()
                except (httpx.HTTPStatusError, httpx.RequestError) as e:
                    last_exc = e
                    if attempt < max_retries:
                        time.sleep(delay)

        if last_exc:
            raise last_exc
        raise RuntimeError("Failed to fetch course details after retries.")

    def fetch_curriculum_items(
        self,
        course_id: str,
        cookies_dict: Optional[Dict[str, str]] = None,
        domain: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        Retrieves course curriculum items (chapters and lectures) from Udemy API.
        Attempts subscriber curriculum first (contains full asset/caption links for enrolled users),
        falling back to public curriculum items if not enrolled.
        """
        headers = self._get_auth_headers(cookies_dict or {})

        domains = []
        if domain and is_udemy_domain(domain):
            domains.append(domain)
        if "www.udemy.com" not in domains:
            domains.append("www.udemy.com")

        endpoints = []
        for target_domain in domains:
            if cookies_dict:
                endpoints.append(f"https://{target_domain}/api-2.0/courses/{course_id}/subscriber-curriculum-items/")
            endpoints.append(f"https://{target_domain}/api-2.0/courses/{course_id}/public-curriculum-items/")

        all_items = []

        for endpoint in endpoints:
            try:
                next_url = endpoint
                params = {
                    "page_size": 100,
                    "fields[lecture]": "title,object_index,asset,sort_order",
                    "fields[asset]": "title,asset_type,time_estimation,length,captions",
                }

                with httpx.Client(timeout=30.0, cookies=cookies_dict or {}, headers=headers, follow_redirects=True) as client:
                    while next_url:
                        resp = client.get(next_url, params=params if next_url == endpoint else None)

                        if resp.status_code == 429:
                            time.sleep(2.0)
                            resp = client.get(next_url, params=params if next_url == endpoint else None)

                        if resp.status_code == 200:
                            data = resp.json()
                            results = data.get("results") or []
                            all_items.extend(results)
                            next_url = data.get("next")
                        else:
                            break

                if all_items:
                    break
            except Exception as e:
                logger.warning(f"Error fetching curriculum from {endpoint}: {e}")

        return all_items

    def parse_curriculum(self, raw_items: List[Dict[str, Any]], course_url: str) -> List[Dict[str, Any]]:
        """
        Parses raw Udemy curriculum items into structured sections and lectures.
        Preserves original section and lecture ordering.
        Structure:
        [
            {
                "title": "Section Title",
                "position": 1,
                "lectures": [
                    {
                        "lecture_id": "12345",
                        "title": "Lecture Title",
                        "url": "https://www.udemy.com/course/.../learn/lecture/12345",
                        "lecture_type": "video",
                        "duration": 300,
                        "position": 1,
                        "captions": [...]
                    }
                ]
            }
        ]
        """
        sections: List[Dict[str, Any]] = []
        current_section: Dict[str, Any] = {
            "title": "Introduction",
            "position": 1,
            "lectures": [],
        }
        section_position = 1
        lecture_position = 1

        base_course_url = course_url.rstrip("/")

        for item in raw_items:
            item_class = item.get("_class")

            if item_class == "chapter":
                # Start a new section
                if current_section["lectures"]:
                    sections.append(current_section)
                    section_position += 1

                current_section = {
                    "title": item.get("title") or f"Section {section_position}",
                    "position": section_position,
                    "lectures": [],
                }
                lecture_position = 1

            elif item_class == "lecture":
                lec_id = str(item.get("id"))
                lec_title = item.get("title") or f"Lecture {lecture_position}"
                asset = item.get("asset") or {}

                # Determine duration in seconds
                duration = (
                    asset.get("time_estimation")
                    or item.get("time_estimation")
                    or asset.get("length")
                    or 0
                )
                if isinstance(duration, float):
                    duration = int(duration)

                # Determine lecture type (video, article, quiz)
                asset_type = asset.get("asset_type") or item.get("asset_type") or "video"
                lecture_type = "video" if "video" in str(asset_type).lower() else "article"

                # Subtitle tracks in asset
                captions = asset.get("captions") or asset.get("subtitles") or []

                lecture_url = f"{base_course_url}/learn/lecture/{lec_id}"

                current_section["lectures"].append({
                    "lecture_id": lec_id,
                    "title": lec_title,
                    "url": lecture_url,
                    "lecture_type": lecture_type,
                    "duration": duration,
                    "position": lecture_position,
                    "captions": captions,
                })
                lecture_position += 1

        if current_section["lectures"]:
            sections.append(current_section)

        return sections

    def download_caption_direct(
        self,
        caption_url: str,
        cookies_dict: Optional[Dict[str, str]] = None,
    ) -> str:
        """
        Downloads a caption file (WebVTT) directly from its URL.
        """
        headers = self._get_auth_headers(cookies_dict or {})
        with httpx.Client(timeout=30.0, cookies=cookies_dict or {}, headers=headers, follow_redirects=True) as client:
            resp = client.get(caption_url)
            resp.raise_for_status()
            return resp.text


udemy_service = UdemyService()
