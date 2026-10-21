@echo off
chcp 65001 >nul
title Udemy Subtitle Manager - Launcher
cd /d "%~dp0"

echo ===================================================================
echo              UDEMY SUBTITLE MANAGER - LOCAL LAUNCHER
echo ===================================================================
echo.

if not exist "chatgpt-sites\udemy-subtitle-manager\node_modules\.bin\vite.cmd" (
    echo [Info] Installing Node.js and Vite dependencies...
    npm.cmd --prefix "chatgpt-sites\udemy-subtitle-manager" run install:ci
    if errorlevel 1 exit /b 1
)

echo [Info] Applying committed D1 migrations to local Wrangler state...
npm.cmd --prefix "chatgpt-sites\udemy-subtitle-manager" run db:migrate:local
if errorlevel 1 exit /b 1

echo [1/2] Starting the Vite and TypeScript app on http://localhost:5173...
start "Udemy Subtitle Manager - Vite" /min cmd /c "cd /d "%~dp0chatgpt-sites\udemy-subtitle-manager" && npm.cmd run dev"

echo [2/2] Opening the local app in your browser...
timeout /t 7 /nobreak >nul
start http://localhost:5173

echo.
echo The app is running at http://localhost:5173
echo To stop it, run stop_app.bat.
timeout /t 3 >nul
