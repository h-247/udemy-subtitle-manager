import os
import tempfile
import pytest
from unittest.mock import patch, MagicMock
from app.services.drive_service import drive_service, sanitize_filename


def test_sanitize_filename():
    assert sanitize_filename("Section 01: Introduction & Overview?") == "Section 01 Introduction & Overview"
    assert sanitize_filename("What/Why/How*<>|") == "WhatWhyHow"
    assert sanitize_filename("") == "Untitled"


def test_drive_status_api(client, user_a, user_a_headers):
    res = client.get("/api/drive/status", headers=user_a_headers)
    assert res.status_code == 200
    data = res.json()
    assert "is_configured" in data
    assert data["is_connected"] is False


@patch.object(drive_service, "is_configured", return_value=True)
@patch.object(drive_service, "get_authorization_url", return_value=("https://accounts.google.com/o/oauth2/auth?state=1", "1"))
def test_drive_auth_url(mock_auth, mock_conf, client, user_a_headers):
    res = client.get("/api/drive/auth-url", headers=user_a_headers)
    assert res.status_code == 200
    assert "url" in res.json()


def test_drive_callback_success(client, db_session, user_a):
    with patch.object(drive_service, "exchange_code_for_tokens") as mock_exchange:
        mock_exchange.return_value = {
            "token": "mock_access_token",
            "refresh_token": "mock_refresh_token",
        }
        res = client.get(
            f"/api/drive/callback?code=mock_code&state={user_a.id}",
            follow_redirects=False,
        )
        assert res.status_code == 307
        assert "drive_connected=true" in res.headers["location"]

        db_session.refresh(user_a)
        assert user_a.drive_credentials is not None
        assert "mock_access_token" in user_a.drive_credentials


def test_drive_disconnect(client, db_session, user_a, user_a_headers):
    user_a.drive_credentials = '{"token": "xyz"}'
    db_session.commit()

    res = client.post("/api/drive/disconnect", headers=user_a_headers)
    assert res.status_code == 200

    db_session.refresh(user_a)
    assert user_a.drive_credentials is None


def test_conditional_file_deletion_on_success():
    """Temporary file must be deleted strictly only after confirmed successful upload."""
    fd, temp_path = tempfile.mkstemp(suffix=".vtt")
    os.write(fd, b"WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello\n")
    os.close(fd)

    assert os.path.exists(temp_path)

    mock_service = MagicMock()
    mock_files = MagicMock()
    mock_create = MagicMock()
    mock_create.execute.return_value = {
        "id": "drive_uploaded_id_123",
        "webViewLink": "https://drive.google.com/file/d/drive_uploaded_id_123/view",
    }
    mock_files.create.return_value = mock_create
    mock_files.list.return_value.execute.return_value = {"files": [{"id": "folder_1"}]}
    mock_service.files.return_value = mock_files

    with patch.object(drive_service, "get_service_from_credentials", return_value=mock_service):
        result = drive_service.upload_subtitle(
            file_path=temp_path,
            upload_filename="001 - Hello.vtt",
            folder_hierarchy=["Udemy Subtitles", "Course", "Section 01"],
            credentials_data={"token": "fake"},
            delete_on_success=True,
        )

        assert result["drive_file_id"] == "drive_uploaded_id_123"
        # Crucial check: file was deleted because upload was confirmed!
        assert not os.path.exists(temp_path)


def test_conditional_file_preservation_on_failure():
    """Temporary file must NOT be deleted if upload encounters an error!"""
    fd, temp_path = tempfile.mkstemp(suffix=".vtt")
    os.write(fd, b"WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello\n")
    os.close(fd)

    assert os.path.exists(temp_path)

    mock_service = MagicMock()
    mock_files = MagicMock()
    mock_create = MagicMock()
    mock_create.execute.side_effect = RuntimeError("Google Drive API rate limited (503)")
    mock_files.create.return_value = mock_create
    mock_files.list.return_value.execute.return_value = {"files": [{"id": "folder_1"}]}
    mock_service.files.return_value = mock_files

    with patch.object(drive_service, "get_service_from_credentials", return_value=mock_service):
        with pytest.raises(RuntimeError):
            drive_service.upload_subtitle(
                file_path=temp_path,
                upload_filename="001 - Hello.vtt",
                folder_hierarchy=["Udemy Subtitles", "Course", "Section 01"],
                credentials_data={"token": "fake"},
                delete_on_success=True,
            )

        # Crucial check: file was PRESERVED on disk so user data is not lost!
        assert os.path.exists(temp_path)

    # Cleanup temp file
    if os.path.exists(temp_path):
        os.remove(temp_path)
