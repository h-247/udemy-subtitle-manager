$ErrorActionPreference = "Stop"

$siteRoot = Join-Path $PSScriptRoot "chatgpt-sites\udemy-subtitle-manager"
$viteCommand = Join-Path $siteRoot "node_modules\.bin\vite.cmd"

if (-not (Test-Path $viteCommand)) {
    Write-Host "Installing the TypeScript/Vite development dependencies..." -ForegroundColor Cyan
    npm.cmd --prefix $siteRoot run install:ci
    if ($LASTEXITCODE -ne 0) {
        throw "Dependency installation failed with exit code $LASTEXITCODE."
    }
}

Write-Host "Applying the committed D1 migrations to local Wrangler state..." -ForegroundColor Cyan
npm.cmd --prefix $siteRoot run db:migrate:local
if ($LASTEXITCODE -ne 0) {
    throw "The local D1 migration command failed with exit code $LASTEXITCODE."
}

Write-Host "Starting Udemy Subtitle Manager on http://localhost:5173" -ForegroundColor Green
npm.cmd --prefix $siteRoot run dev
if ($LASTEXITCODE -ne 0) {
    throw "The Vite development server exited with code $LASTEXITCODE."
}
