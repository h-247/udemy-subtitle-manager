$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$desktop = [Environment]::GetFolderPath("Desktop")

$mainExe = Join-Path $projectRoot "UdemySubtitleManager.exe"
$stopExe = Join-Path $projectRoot "StopUdemySubtitleManager.exe"
$iconPath = Join-Path $projectRoot "app_icon.ico"

$wshShell = New-Object -ComObject WScript.Shell

# 1. Desktop shortcut for Udemy Subtitle Manager
$shortcutPath1 = Join-Path $desktop "Udemy Subtitle Manager.lnk"
$shortcut1 = $wshShell.CreateShortcut($shortcutPath1)
$shortcut1.TargetPath = $mainExe
$shortcut1.WorkingDirectory = $projectRoot
$shortcut1.Description = "Launch Udemy Subtitle Manager (Backend & Frontend)"
if (Test-Path $iconPath) {
    $shortcut1.IconLocation = "$iconPath,0"
}
$shortcut1.Save()
Write-Host "Created Desktop shortcut: $shortcutPath1" -ForegroundColor Green

# 2. Desktop shortcut for Stop
$shortcutPath2 = Join-Path $desktop "Stop Udemy Subtitle Manager.lnk"
$shortcut2 = $wshShell.CreateShortcut($shortcutPath2)
$shortcut2.TargetPath = $stopExe
$shortcut2.WorkingDirectory = $projectRoot
$shortcut2.Description = "Stop Udemy Subtitle Manager services"
$shortcut2.IconLocation = "%SystemRoot%\System32\shell32.dll,27"
$shortcut2.Save()
Write-Host "Created Desktop Stop shortcut: $shortcutPath2" -ForegroundColor Green

# 3. Project folder shortcut
$shortcutPath3 = Join-Path $projectRoot "Udemy Subtitle Manager.lnk"
$shortcut3 = $wshShell.CreateShortcut($shortcutPath3)
$shortcut3.TargetPath = $mainExe
$shortcut3.WorkingDirectory = $projectRoot
$shortcut3.Description = "Launch Udemy Subtitle Manager"
if (Test-Path $iconPath) {
    $shortcut3.IconLocation = "$iconPath,0"
}
$shortcut3.Save()
Write-Host "Created Folder shortcut: $shortcutPath3" -ForegroundColor Green
