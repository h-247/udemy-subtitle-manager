# ==============================================================================
# Udemy Subtitle Manager - Local Development Startup Script
# ==============================================================================

Write-Host "🚀 Starting Udemy Subtitle Manager..." -ForegroundColor Cyan

# 1. Check or create .env files
if (-not (Test-Path ".env")) {
    Write-Host "⚙️ Creating .env from .env.example..." -ForegroundColor Yellow
    Copy-Item .env.example .env
}
if (-not (Test-Path "backend\.env")) {
    Copy-Item .env.example backend\.env
}
if (-not (Test-Path "frontend\.env.local")) {
    Set-Content -Path "frontend\.env.local" -Value "NEXT_PUBLIC_API_URL=http://localhost:8000/api"
}

# 2. Run database migrations
Write-Host "📦 Applying database migrations..." -ForegroundColor Cyan
Set-Location backend
.\venv\Scripts\alembic upgrade head
Set-Location ..

# 3. Start Backend in a new window
Write-Host "⚡ Launching FastAPI Backend on http://localhost:8000..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot\backend'; .\venv\Scripts\Activate.ps1; uvicorn app.main:app --reload --host 0.0.0.0 --port 8000"

# 4. Start Frontend in a new window
Write-Host "🎨 Launching Next.js Frontend on http://localhost:3000..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot\frontend'; npm run dev"

Write-Host ""
Write-Host "✅ Both services launched!" -ForegroundColor Green
Write-Host "🌐 Frontend: http://localhost:3000" -ForegroundColor Cyan
Write-Host "📚 API Docs: http://localhost:8000/docs" -ForegroundColor Cyan
