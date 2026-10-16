import os
import re
import logging
from typing import Optional, Dict, Any, Tuple, List
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload
from google.auth.transport.requests import Request

from app.config import settings

logger = logging.getLogger(__name__)

SCOPES = [
    "https://www.googleapis.com/auth/drive.file",
]


def sanitize_filename(name: str) -> str:
    """Sanitize directory or file name for Google Drive and local paths."""
    clean = re.sub(r'[\\/*?:"<>|\x00]', "", name)
    clean = re.sub(r"\s+", " ", clean).strip(". ")
    return clean or "Untitled"


class GoogleDriveService:
    """
    Google Drive OAuth and hierarchical folder upload service.
    Handles token management, nested folder creation, and verifies upload
    before conditionally cleaning up temporary subtitle files.
    """

    def __init__(self):
        self.client_id = settings.GOOGLE_CLIENT_ID
        self.client_secret = settings.GOOGLE_CLIENT_SECRET
        self.redirect_uri = settings.GOOGLE_REDIRECT_URI

    def is_configured(self) -> bool:
        return bool(self.client_id and self.client_secret)

    def get_client_config(self) -> Dict[str, Any]:
        return {
            "web": {
                "client_id": self.client_id,
                "client_secret": self.client_secret,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "redirect_uris": [self.redirect_uri],
            }
        }

    def get_authorization_url(self, state: Optional[str] = None) -> Tuple[str, str]:
        if not self.is_configured():
            raise ValueError("Google Drive OAuth is not configured with CLIENT_ID and CLIENT_SECRET.")

        flow = Flow.from_client_config(
            self.get_client_config(),
            scopes=SCOPES,
            redirect_uri=self.redirect_uri,
            autogenerate_code_verifier=False,
        )
        auth_url, state = flow.authorization_url(
            access_type="offline",
            include_granted_scopes="true",
            prompt="consent",
            state=state,
        )
        return auth_url, state

    def exchange_code_for_tokens(self, code: str) -> Dict[str, Any]:
        if not self.is_configured():
            raise ValueError("Google Drive OAuth is not configured.")

        flow = Flow.from_client_config(
            self.get_client_config(),
            scopes=SCOPES,
            redirect_uri=self.redirect_uri,
            autogenerate_code_verifier=False,
        )
        flow.fetch_token(code=code)
        creds = flow.credentials

        return {
            "token": creds.token,
            "refresh_token": creds.refresh_token,
            "token_uri": creds.token_uri,
            "client_id": creds.client_id,
            "client_secret": creds.client_secret,
            "scopes": creds.scopes,
        }

    def get_service_from_credentials(self, credentials_data: Dict[str, Any]):
        creds = Credentials(
            token=credentials_data.get("token"),
            refresh_token=credentials_data.get("refresh_token"),
            token_uri=credentials_data.get("token_uri", "https://oauth2.googleapis.com/token"),
            client_id=credentials_data.get("client_id") or self.client_id,
            client_secret=credentials_data.get("client_secret") or self.client_secret,
            scopes=credentials_data.get("scopes", SCOPES),
        )

        if creds.expired and creds.refresh_token:
            creds.refresh(Request())

        return build("drive", "v3", credentials=creds, cache_discovery=False)

    def get_or_create_subfolder(self, service, folder_name: str, parent_id: Optional[str] = None) -> Optional[str]:
        """Finds or creates a folder under parent_id."""
        try:
            safe_name = sanitize_filename(folder_name)
            escaped_name = safe_name.replace("'", "\\'")
            query = f"mimeType = 'application/vnd.google-apps.folder' and name = '{escaped_name}' and trashed = false"
            if parent_id:
                query += f" and '{parent_id}' in parents"

            response = service.files().list(q=query, spaces="drive", fields="files(id, name)").execute()
            files = response.get("files", [])
            if files:
                return files[0]["id"]

            file_metadata = {
                "name": safe_name,
                "mimeType": "application/vnd.google-apps.folder",
            }
            if parent_id:
                file_metadata["parents"] = [parent_id]

            folder = service.files().create(body=file_metadata, fields="id").execute()
            return folder.get("id")
        except Exception as e:
            logger.warning(f"Failed to get or create folder '{folder_name}' under parent {parent_id}: {e}")
            return parent_id

    def get_or_create_folder_hierarchy(self, service, path_parts: List[str]) -> Optional[str]:
        """
        Creates a nested folder hierarchy on Google Drive:
        root -> path_parts[0] -> path_parts[1] -> ...
        Uses in-memory cache to minimize redundant Drive API calls during batch operations.
        """
        if not hasattr(self, "_folder_cache"):
            self._folder_cache = {}

        cache_key = tuple(path_parts)
        if cache_key in self._folder_cache:
            return self._folder_cache[cache_key]

        parent_id = None
        for part in path_parts:
            if not part:
                continue
            parent_id = self.get_or_create_subfolder(service, part, parent_id)

        if parent_id:
            self._folder_cache[cache_key] = parent_id
        return parent_id

    def upload_subtitle(
        self,
        file_path: str,
        upload_filename: str,
        folder_hierarchy: List[str],
        credentials_data: Dict[str, Any],
        delete_on_success: bool = True,
    ) -> Dict[str, Any]:
        """
        Uploads a subtitle file to Google Drive in the specified folder hierarchy.
        Deletes the temporary local file STRICTLY ONLY after confirmed upload.
        """
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"Subtitle file does not exist: {file_path}")

        service = self.get_service_from_credentials(credentials_data)
        parent_folder_id = self.get_or_create_folder_hierarchy(service, folder_hierarchy)

        safe_filename = sanitize_filename(upload_filename)
        ext = os.path.splitext(file_path)[1].lower()
        if not safe_filename.lower().endswith(ext):
            safe_filename += ext

        file_metadata: Dict[str, Any] = {
            "name": safe_filename,
        }
        if parent_folder_id:
            file_metadata["parents"] = [parent_folder_id]

        mime_type = "text/vtt" if ext == ".vtt" else "text/plain"
        media = MediaFileUpload(file_path, mimetype=mime_type, resumable=True)

        try:
            uploaded_file = (
                service.files()
                .create(body=file_metadata, media_body=media, fields="id, webViewLink, webContentLink")
                .execute()
            )

            file_id = uploaded_file.get("id")
            web_view_link = uploaded_file.get("webViewLink") or f"https://drive.google.com/file/d/{file_id}/view"

            if hasattr(media, "_fd") and media._fd and not media._fd.closed:
                try:
                    media._fd.close()
                except Exception:
                    pass

            # Confirmed upload successful -> delete temporary file strictly only now
            if delete_on_success and os.path.exists(file_path):
                try:
                    os.remove(file_path)
                except OSError as rm_err:
                    logger.warning(f"Could not remove temporary file after confirmed upload: {rm_err}")

            return {
                "drive_file_id": file_id,
                "drive_file_url": web_view_link,
            }
        except Exception as upload_err:
            if hasattr(media, "_fd") and media._fd and not media._fd.closed:
                try:
                    media._fd.close()
                except Exception:
                    pass
            # On failure, DO NOT delete file so local artifact is preserved
            logger.error(f"Failed to upload subtitle file {file_path}: {upload_err}")
            raise upload_err

    def delete_file(self, file_id: str, credentials_data: Dict[str, Any]) -> bool:
        """
        Deletes a file from Google Drive using user credentials.
        """
        try:
            service = self.get_service_from_credentials(credentials_data)
            service.files().delete(fileId=file_id).execute()
            return True
        except Exception as e:
            logger.warning(f"Could not delete Google Drive file {file_id}: {e}")
            return False


drive_service = GoogleDriveService()
