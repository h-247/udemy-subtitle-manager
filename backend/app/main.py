import re
import logging
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.config import settings
from app.database import engine, Base
from app.api import api_router

# Setup logging
logging.basicConfig(
    level=logging.INFO if not settings.DEBUG else logging.DEBUG,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# Ensure tables exist in dev/sqlite
Base.metadata.create_all(bind=engine)


class LogRedactionMiddleware(BaseHTTPMiddleware):
    """
    Sanitizes access logs to ensure sensitive parameters such as OAuth authorization codes
    are redacted from server logs.
    """
    async def dispatch(self, request: Request, call_next):
        url_str = str(request.url)
        if "code=" in url_str:
            sanitized_url = re.sub(r"code=[^&]+", "code=[REDACTED]", url_str)
            logger.info(f"Incoming request: {request.method} {sanitized_url}")
        return await call_next(request)


app = FastAPI(
    title=settings.PROJECT_NAME,
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# Add middlewares
app.add_middleware(LogRedactionMiddleware)

allowed_origins = [
    settings.FRONTEND_URL,
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3050",
    "http://127.0.0.1:3050",
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount API
app.include_router(api_router)


@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "app": settings.PROJECT_NAME,
        "environment": settings.ENVIRONMENT,
    }
