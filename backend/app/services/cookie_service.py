import os
import re
import json
import tempfile
import logging
from typing import Dict, List, Tuple, Optional

logger = logging.getLogger(__name__)

MAX_COOKIE_FILE_SIZE = 2 * 1024 * 1024  # 2MB
VALID_UDEMY_DOMAINS = (".udemy.com", "www.udemy.com", "udemy.com")


def is_udemy_domain(domain: str) -> bool:
    """Checks whether the domain belongs to Udemy (including business/enterprise subdomains)."""
    clean = (domain or "").strip().lstrip(".").lower()
    return clean == "udemy.com" or clean.endswith(".udemy.com")


class CookieValidationError(Exception):
    """Raised when uploaded cookie file is malformed, invalid, or unsafe."""
    pass


class CookieService:
    @staticmethod
    def extract_business_domain(cookie_content: str) -> Optional[str]:
        """
        Inspects cookie content (Netscape text or JSON) and extracts the Udemy Business
        subdomain (e.g. 'ifg.udemy.com') if present, or None for standard consumer udemy.com.
        """
        if not cookie_content:
            return None

        # Check comment if recorded during parsing
        match = re.search(r"#\s*Udemy Business Domain:\s*([a-zA-Z0-9_\-\.]+)", cookie_content)
        if match:
            return match.group(1).strip().lower()

        # Try parsing JSON if starts with [ or {
        trimmed = cookie_content.strip()
        if trimmed.startswith("[") or trimmed.startswith("{"):
            try:
                data = json.loads(trimmed)
                items = data if isinstance(data, list) else data.get("cookies", [data])
                for item in items:
                    if isinstance(item, dict):
                        d = str(item.get("domain", "")).strip().lstrip(".").lower()
                        if d.endswith(".udemy.com") and d not in ("udemy.com", "www.udemy.com"):
                            return d
            except Exception:
                pass

        # Try line-by-line Netscape lines
        for line in cookie_content.splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = re.split(r"\t+", line)
            if len(parts) < 7:
                parts = line.split(None, 6)
            if len(parts) >= 7:
                d = parts[0].strip().lstrip(".").lower()
                if d.endswith(".udemy.com") and d not in ("udemy.com", "www.udemy.com"):
                    return d

        return None

    @classmethod
    def validate_and_parse_netscape(cls, cookie_content: str) -> Tuple[bool, str, Dict[str, str]]:
        """
        Validates cookie content in Netscape cookies.txt or JSON array format.
        Sanitizes and converts to standardized Netscape format.
        Returns: (is_valid, sanitized_content, cookies_dict)
        Raises CookieValidationError on invalid or unsafe content.
        """
        if not cookie_content or not cookie_content.strip():
            raise CookieValidationError("Cookie file is empty.")

        if len(cookie_content.encode("utf-8")) > MAX_COOKIE_FILE_SIZE:
            raise CookieValidationError("Cookie file exceeds the maximum allowed size of 2MB.")

        # Check for binary or null bytes
        if "\x00" in cookie_content:
            raise CookieValidationError("Cookie file contains invalid binary content.")

        trimmed = cookie_content.strip()
        parsed_cookies: Dict[str, str] = {}
        valid_lines: List[str] = []
        has_udemy_cookie = False
        business_domain: Optional[str] = None

        # 1. Try parsing as JSON (Cookie-Editor, EditThisCookie, browser exports)
        if trimmed.startswith("[") or trimmed.startswith("{"):
            try:
                data = json.loads(trimmed)
                items = data if isinstance(data, list) else data.get("cookies", [data])
                if isinstance(items, list):
                    for item in items:
                        if not isinstance(item, dict):
                            continue
                        name = str(item.get("name", "")).strip()
                        value = str(item.get("value", "")).strip()
                        domain = str(item.get("domain", "")).strip()
                        path = str(item.get("path") or "/").strip()
                        secure_bool = bool(item.get("secure", False))
                        host_only = bool(item.get("hostOnly", False))

                        exp = item.get("expirationDate") or item.get("expires") or 0
                        try:
                            exp_val = str(int(float(exp))) if exp else "0"
                        except (ValueError, TypeError):
                            exp_val = "0"

                        if not name or not is_udemy_domain(domain):
                            continue

                        has_udemy_cookie = True
                        parsed_cookies[name] = value

                        # Detect business subdomain
                        d_clean = domain.lstrip(".").lower()
                        if d_clean.endswith(".udemy.com") and d_clean not in ("udemy.com", "www.udemy.com"):
                            business_domain = d_clean

                        subdomain_flag = "FALSE" if host_only else "TRUE"
                        secure_flag = "TRUE" if secure_bool else "FALSE"

                        valid_lines.append(f"{domain}\t{subdomain_flag}\t{path}\t{secure_flag}\t{exp_val}\t{name}\t{value}")
            except json.JSONDecodeError:
                logger.debug("Content started with bracket/brace but failed JSON decode; falling back to Netscape parser.")

        # 2. If not parsed as JSON or no cookies extracted, parse line-by-line Netscape format
        if not parsed_cookies:
            lines = cookie_content.splitlines()
            for line_num, line in enumerate(lines, 1):
                raw_line = line.strip()
                if not raw_line:
                    continue

                # Preserve comment lines
                if raw_line.startswith("#"):
                    if not raw_line.startswith("# Netscape"):
                        valid_lines.append(raw_line)
                    continue

                parts = re.split(r"\t+", raw_line)
                if len(parts) < 7:
                    parts = raw_line.split(None, 6)

                if len(parts) < 7:
                    logger.debug(f"Skipping malformed cookie line {line_num}: insufficient columns")
                    continue

                domain, flag, path, secure, expiration, name, value = parts[:7]
                domain = domain.strip()
                name = name.strip()
                value = value.strip()

                if is_udemy_domain(domain):
                    has_udemy_cookie = True
                    parsed_cookies[name] = value

                    d_clean = domain.lstrip(".").lower()
                    if d_clean.endswith(".udemy.com") and d_clean not in ("udemy.com", "www.udemy.com"):
                        business_domain = d_clean

                    valid_lines.append(f"{domain}\t{flag}\t{path}\t{secure}\t{expiration}\t{name}\t{value}")

        if not has_udemy_cookie or not parsed_cookies:
            raise CookieValidationError(
                "No valid Udemy cookies found. The file or text must contain cookies for udemy.com "
                "or *.udemy.com (in Netscape cookies.txt or JSON array format)."
            )

        header_lines = ["# Netscape HTTP Cookie File"]
        if business_domain:
            header_lines.append(f"# Udemy Business Domain: {business_domain}")
        sanitized_content = "\n".join(header_lines + valid_lines) + "\n"

        return True, sanitized_content, parsed_cookies

    @staticmethod
    def create_temp_cookie_file(cookie_content: str) -> str:
        """
        Safely writes Netscape cookie content to a secure temporary file.
        Returns the absolute path to the temporary file.
        """
        fd, path = tempfile.mkstemp(prefix="udemy_cookies_", suffix=".txt")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(cookie_content)
            # Restrict permissions on POSIX systems if applicable
            try:
                os.chmod(path, 0o600)
            except Exception:
                pass
            return path
        except Exception:
            try:
                os.close(fd)
            except Exception:
                pass
            if os.path.exists(path):
                os.remove(path)
            raise

    @staticmethod
    def cleanup_temp_file(path: Optional[str]) -> None:
        """Securely removes temporary cookie file from disk."""
        if path and os.path.exists(path):
            try:
                os.remove(path)
            except Exception as e:
                logger.warning(f"Failed to remove temp cookie file {path}: {e}")


cookie_service = CookieService()
