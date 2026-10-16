import io
import pytest
from unittest.mock import patch, MagicMock
from app.services.cookie_service import cookie_service, CookieValidationError
from app.services.crypto_service import crypto_service
from app.models.udemy_session import UdemySession

VALID_NETSCAPE_COOKIES = """# Netscape HTTP Cookie File
# http://curl.haxx.se/rfc/cookie_spec.html
.udemy.com\tTRUE\t/\tTRUE\t1759000000\taccess_token\tsome_secret_token_value_abc
.udemy.com\tTRUE\t/\tTRUE\t1759000000\tclient_id\tclient_id_12345
www.udemy.com\tFALSE\t/\tFALSE\t1759000000\tsession_id\tsess_xyz
"""

NON_UDEMY_COOKIES = """# Netscape HTTP Cookie File
.google.com\tTRUE\t/\tTRUE\t1759000000\tSID\tgoogle_token_123
"""


def test_cookie_validation_success():
    is_valid, sanitized, parsed = cookie_service.validate_and_parse_netscape(VALID_NETSCAPE_COOKIES)
    assert is_valid is True
    assert "access_token" in parsed
    assert parsed["access_token"] == "some_secret_token_value_abc"
    assert "client_id" in parsed
    assert "session_id" in parsed
    assert sanitized.startswith("# Netscape HTTP Cookie File")


def test_cookie_validation_empty():
    with pytest.raises(CookieValidationError, match="Cookie file is empty"):
        cookie_service.validate_and_parse_netscape("")


def test_cookie_validation_binary():
    with pytest.raises(CookieValidationError, match="invalid binary content"):
        cookie_service.validate_and_parse_netscape("abc\x00def")


def test_cookie_validation_non_udemy():
    with pytest.raises(CookieValidationError, match="No valid Udemy cookies found"):
        cookie_service.validate_and_parse_netscape(NON_UDEMY_COOKIES)


def test_crypto_service_round_trip():
    original = "secret_udemy_cookie_content"
    encrypted = crypto_service.encrypt_text(original)
    assert encrypted != original
    decrypted = crypto_service.decrypt_text(encrypted)
    assert decrypted == original


@patch("app.services.udemy_service.udemy_service.validate_session")
def test_upload_cookies_api(mock_validate, client, user_a_headers, db_session, user_a):
    mock_validate.return_value = ("CONNECTED", "John Doe", None)

    file_obj = io.BytesIO(VALID_NETSCAPE_COOKIES.encode("utf-8"))
    res = client.post(
        "/api/udemy/cookies",
        files={"file": ("cookies.txt", file_obj, "text/plain")},
        headers=user_a_headers,
    )
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "CONNECTED"
    assert data["account_name"] == "John Doe"
    # Never expose raw cookies in response
    assert "some_secret_token_value_abc" not in str(data)

    # Verify in DB that cookies are stored encrypted, not plaintext
    session_rec = db_session.query(UdemySession).filter(UdemySession.user_id == user_a.id).first()
    assert session_rec is not None
    assert session_rec.encrypted_cookie_data is not None
    assert "some_secret_token_value_abc" not in session_rec.encrypted_cookie_data
    # But can be decrypted
    decrypted = crypto_service.decrypt_text(session_rec.encrypted_cookie_data)
    assert "some_secret_token_value_abc" in decrypted


@patch("app.services.udemy_service.udemy_service.validate_session")
def test_test_connection_expired(mock_validate, client, user_a_headers, db_session, user_a):
    # Upload cookies first
    mock_validate.return_value = ("CONNECTED", "John Doe", None)
    client.post(
        "/api/udemy/cookies",
        data={"cookie_text": VALID_NETSCAPE_COOKIES},
        headers=user_a_headers,
    )

    # Re-test connection returning EXPIRED_SESSION
    mock_validate.return_value = ("EXPIRED_SESSION", None, "Udemy session has expired.")
    res = client.post("/api/udemy/test-connection", headers=user_a_headers)
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "EXPIRED_SESSION"
    assert "expired" in data["error_message"].lower()


def test_disconnect_udemy(client, user_a_headers, db_session, user_a):
    # Set session
    session_rec = UdemySession(
        user_id=user_a.id,
        encrypted_cookie_data=crypto_service.encrypt_text(VALID_NETSCAPE_COOKIES),
        status="CONNECTED",
        account_name="John Doe",
    )
    db_session.add(session_rec)
    db_session.commit()

    # Call disconnect
    res = client.post("/api/udemy/disconnect", headers=user_a_headers)
    assert res.status_code == 200

    # Verify session cleared
    db_session.refresh(session_rec)
    assert session_rec.encrypted_cookie_data is None
    assert session_rec.status == "DISCONNECTED"
    assert session_rec.account_name is None


def test_cookie_validation_json_format():
    json_cookies = """[
        {
            "domain": ".udemy.com",
            "name": "access_token",
            "value": "jwt_token_sample",
            "path": "/",
            "secure": true,
            "expirationDate": 1759000000
        },
        {
            "domain": ".udemy.com",
            "name": "client_id",
            "value": "cid_sample_123"
        }
    ]"""
    is_valid, sanitized, parsed = cookie_service.validate_and_parse_netscape(json_cookies)
    assert is_valid is True
    assert parsed["access_token"] == "jwt_token_sample"
    assert parsed["client_id"] == "cid_sample_123"
    assert sanitized.startswith("# Netscape HTTP Cookie File")
    assert ".udemy.com" in sanitized


def test_cookie_validation_business_domain():
    business_json = """[
        {
            "domain": ".ifg.udemy.com",
            "name": "access_token",
            "value": "business_token_456",
            "path": "/",
            "secure": true
        },
        {
            "domain": "ifg.udemy.com",
            "name": "dj_session_id",
            "value": "sess_456"
        }
    ]"""
    is_valid, sanitized, parsed = cookie_service.validate_and_parse_netscape(business_json)
    assert is_valid is True
    assert parsed["access_token"] == "business_token_456"
    assert parsed["dj_session_id"] == "sess_456"
    assert "ifg.udemy.com" in sanitized
    assert cookie_service.extract_business_domain(business_json) == "ifg.udemy.com"
    assert cookie_service.extract_business_domain(sanitized) == "ifg.udemy.com"
