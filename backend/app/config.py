import os
from typing import Optional
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

    PROJECT_NAME: str = "Udemy Subtitle Manager"
    ENVIRONMENT: str = "development"
    DEBUG: bool = True

    # Database
    DATABASE_URL: str = "sqlite:///./udemy_subtitles.db"

    # Security
    SECRET_KEY: str = "udemy-subtitle-manager-secret-key-min-32-chars-long"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days

    # Google Drive OAuth & API
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    GOOGLE_REDIRECT_URI: str = "http://localhost:8000/api/drive/callback"
    GOOGLE_DRIVE_FOLDER_NAME: str = "Udemy Subtitles"

    # Frontend URL for CORS & OAuth redirects
    FRONTEND_URL: str = "http://localhost:3000"

    # Subtitles Local Temporary Storage
    SUBTITLE_STORAGE_DIR: str = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "temp_subtitles"
    )

    # Subtitle Rate Limiting & Retry Configuration
    SUBTITLE_MAX_RETRIES: int = 3
    SUBTITLE_RETRY_DELAY: float = 1.0
    SUBTITLE_RETRY_BACKOFF_FACTOR: float = 2.0

    # Udemy Network Request Configuration
    UDEMY_MAX_RETRIES: int = 3
    UDEMY_RETRY_DELAY: float = 1.5
    UDEMY_REQUEST_TIMEOUT: float = 20.0


settings = Settings()
