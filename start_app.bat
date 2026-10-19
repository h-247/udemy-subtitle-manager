@echo off
chcp 65001 >nul
title Udemy Subtitle Manager - Launcher
cd /d "%~dp0"

echo ===================================================================
echo              UDEMY SUBTITLE MANAGER - LOCAL LAUNCHER
echo ===================================================================
echo.

:: 1. Check or prepare environment files
if not exist ".env" (
    echo [Info] Creating .env from .env.example ...
    copy /y .env.example .env >nul
)
if not exist "backend\.env" (
    copy /y .env.example backend\.env >nul
)
if not exist "frontend\.env.local" (
    echo NEXT_PUBLIC_API_URL=http://127.0.0.1:8050/api > frontend\.env.local
)

:: 2. Launch Backend (FastAPI on http://127.0.0.1:8050)
echo [1/3] Starting Backend Server (FastAPI on http://127.0.0.1:8050)...
start "Udemy Subtitle Manager - Backend" /min cmd /c "cd /d "%~dp0backend" && .\venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8050"

:: 3. Launch Frontend (Next.js on http://localhost:3050)
echo [2/3] Starting Frontend Server (Next.js on http://localhost:3050)...
start "Udemy Subtitle Manager - Frontend" /min cmd /c "cd /d "%~dp0frontend" && npm run dev"

:: 4. Wait for servers to initialize and open web browser
echo [3/3] Opening application in default web browser...
timeout /t 4 /nobreak >nul
start http://localhost:3050

echo.
echo ===================================================================
echo   Udemy Subtitle Manager is running!
echo   - Web App:      http://localhost:3050
echo   - Backend Docs: http://127.0.0.1:8050/docs
echo.
echo   To stop the application, run 'stop_app.bat' or close the windows.
echo ===================================================================
echo.
timeout /t 5 >nul
