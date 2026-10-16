Add-Type -AssemblyName System.Drawing

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$icoPath = Join-Path $projectRoot "app_icon.ico"

# Create a 256x256 high-res bitmap
$size = 256
$bmp = New-Object System.Drawing.Bitmap $size, $size
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

# 1. Background dark rounded rectangle (Dark theme #212121)
$rect = New-Object System.Drawing.Rectangle 8, 8, ($size - 16), ($size - 16)
$radius = 48
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$path.AddArc($rect.X, $rect.Y, $radius, $radius, 180, 90)
$path.AddArc($rect.Right - $radius, $rect.Y, $radius, $radius, 270, 90)
$path.AddArc($rect.Right - $radius, $rect.Bottom - $radius, $radius, $radius, 0, 90)
$path.AddArc($rect.X, $rect.Bottom - $radius, $radius, $radius, 90, 90)
$path.CloseFigure()

$bgBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(33, 33, 33)) # #212121
$g.FillPath($bgBrush, $path)

# Border (#383838)
$borderPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(60, 60, 60)), 4
$g.DrawPath($borderPen, $path)

# 2. Draw stylish "U" with subtitle symbol underneath
$fontU = New-Object System.Drawing.Font "Segoe UI", 92, "Bold", ([System.Drawing.GraphicsUnit]::Pixel)
$textBrush = [System.Drawing.Brushes]::White
$sf = New-Object System.Drawing.StringFormat
$sf.Alignment = [System.Drawing.StringAlignment]::Center
$sf.LineAlignment = [System.Drawing.StringAlignment]::Center

$uRect = New-Object System.Drawing.RectangleF 0, 30, $size, 110
$g.DrawString("U", $fontU, $textBrush, $uRect, $sf)

# 3. Draw Subtitles badge [CC] or [SUB]
$subBadgeRect = New-Object System.Drawing.Rectangle 68, 155, 120, 44
$badgePath = New-Object System.Drawing.Drawing2D.GraphicsPath
$bRadius = 16
$badgePath.AddArc($subBadgeRect.X, $subBadgeRect.Y, $bRadius, $bRadius, 180, 90)
$badgePath.AddArc($subBadgeRect.Right - $bRadius, $subBadgeRect.Y, $bRadius, $bRadius, 270, 90)
$badgePath.AddArc($subBadgeRect.Right - $bRadius, $subBadgeRect.Bottom - $bRadius, $bRadius, $bRadius, 0, 90)
$badgePath.AddArc($subBadgeRect.X, $subBadgeRect.Bottom - $bRadius, $bRadius, $bRadius, 90, 90)
$badgePath.CloseFigure()

$badgeBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(50, 50, 50))
$g.FillPath($badgeBrush, $badgePath)
$badgeBorderPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(90, 90, 90)), 2
$g.DrawPath($badgeBorderPen, $badgePath)

$fontSub = New-Object System.Drawing.Font "Segoe UI", 22, "Bold", ([System.Drawing.GraphicsUnit]::Pixel)
$subRectF = New-Object System.Drawing.RectangleF $subBadgeRect.X, ($subBadgeRect.Y + 6), $subBadgeRect.Width, $subBadgeRect.Height
$g.DrawString("SUB", $fontSub, $textBrush, $subRectF, $sf)

# Save Icon
$hIcon = $bmp.GetHicon()
$icon = [System.Drawing.Icon]::FromHandle($hIcon)

$fs = New-Object System.IO.FileStream $icoPath, ([System.IO.FileMode]::Create)
$icon.Save($fs)
$fs.Close()

$icon.Dispose()
$bmp.Dispose()
$g.Dispose()

Write-Host "Created icon at: $icoPath" -ForegroundColor Green
