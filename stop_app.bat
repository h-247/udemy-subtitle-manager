@echo off
chcp 65001 >nul
title Udemy Subtitle Manager - Shutdown
cd /d "%~dp0"

echo ===================================================================
echo              UDEMY SUBTITLE MANAGER - STOPPING SERVICES
echo ===================================================================
echo.
echo Stopping Udemy Subtitle Manager (Vite on port 5173)...

powershell -NoProfile -Command "$ports = 5173; foreach ($p in $ports) { try { (Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue).OwningProcess | ForEach-Object { $proc = Get-Process -Id $_ -ErrorAction SilentlyContinue; if ($proc) { Write-Host ('Stopping process ' + $proc.Name + ' (PID: ' + $proc.Id + ') on port ' + $p); Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } } } catch {} }"

taskkill /F /FI "WINDOWTITLE eq Udemy Subtitle Manager - Vite*" >nul 2>&1

echo.
echo [Done] Udemy Subtitle Manager services have been stopped.
timeout /t 3 >nul
