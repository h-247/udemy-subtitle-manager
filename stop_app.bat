@echo off
chcp 65001 >nul
title Udemy Subtitle Manager - Shutdown
cd /d "%~dp0"

echo ===================================================================
echo              UDEMY SUBTITLE MANAGER - STOPPING SERVICES
echo ===================================================================
echo.
echo Stopping Udemy Subtitle Manager (Port 8050 and Port 3050 only)...

powershell -NoProfile -Command "$ports = 8050, 3050; foreach ($p in $ports) { try { (Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue).OwningProcess | ForEach-Object { $proc = Get-Process -Id $_ -ErrorAction SilentlyContinue; if ($proc) { Write-Host ('Stopping process ' + $proc.Name + ' (PID: ' + $proc.Id + ') on port ' + $p); Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } } } catch {} }"

taskkill /F /FI "WINDOWTITLE eq Udemy Subtitle Manager - Backend*" >nul 2>&1
taskkill /F /FI "WINDOWTITLE eq Udemy Subtitle Manager - Frontend*" >nul 2>&1

echo.
echo [Done] Udemy Subtitle Manager services have been stopped.
timeout /t 3 >nul
