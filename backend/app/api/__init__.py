from fastapi import APIRouter
from app.api.auth import router as auth_router
from app.api.drive import router as drive_router
from app.api.udemy import router as udemy_router
from app.api.courses import router as courses_router
from app.api.subtitles import router as subtitles_router
from app.api.jobs import router as jobs_router

api_router = APIRouter(prefix="/api")
api_router.include_router(auth_router)
api_router.include_router(drive_router)
api_router.include_router(udemy_router)
api_router.include_router(courses_router)
api_router.include_router(subtitles_router)
api_router.include_router(jobs_router)

__all__ = ["api_router"]
