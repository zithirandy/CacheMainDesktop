# Generates build/icon.png (256x256) for electron-builder.
# Design: dark rounded square, diagonal accent gradient, white "CM" wordmark,
# with a red (Redis) and a blue (Memcached) dot as the cache marker.
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$outDir = Join-Path $root '..\build'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$outPath = Join-Path $outDir 'icon.png'

$size = 256
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)

# Rounded-square background: #1b1d24 -> #2a2d38 vertical gradient.
$bgRect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
$bgPath = New-Object System.Drawing.Drawing2D.GraphicsPath
$r = 56
$bgPath.AddArc(0, 0, $r, $r, 180, 90)
$bgPath.AddArc($size - $r, 0, $r, $r, 270, 90)
$bgPath.AddArc($size - $r, $size - $r, $r, $r, 0, 90)
$bgPath.AddArc(0, $size - $r, $r, $r, 90, 90)
$bgPath.CloseFigure()

$bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $bgRect,
    [System.Drawing.Color]::FromArgb(27, 29, 36),
    [System.Drawing.Color]::FromArgb(42, 45, 56),
    [System.Drawing.Drawing2D.LinearGradientMode]::Vertical)
$g.FillPath($bgBrush, $bgPath)

# Thin accent bar along the top edge: Redis red -> Memcached blue.
$accentHeight = 14
$accentRect = New-Object System.Drawing.Rectangle(0, 0, $size, $accentHeight)
$accentPath = New-Object System.Drawing.Drawing2D.GraphicsPath
$accentPath.AddArc(0, 0, $r, $r, 180, 90)
$accentPath.AddArc($size - $r, 0, $r, $r, 270, 90)
$accentPath.AddLine($size, $accentHeight, 0, $accentHeight)
$accentPath.CloseFigure()
$accentBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $accentRect,
    [System.Drawing.Color]::FromArgb(238, 81, 69),
    [System.Drawing.Color]::FromArgb(47, 129, 247),
    [System.Drawing.Drawing2D.LinearGradientMode]::Horizontal)
$g.FillPath($accentBrush, $accentPath)

# Wordmark.
$font = New-Object System.Drawing.Font('Segoe UI', 84, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$format = New-Object System.Drawing.StringFormat
$format.Alignment = [System.Drawing.StringAlignment]::Center
$format.LineAlignment = [System.Drawing.StringAlignment]::Center
$textRect = New-Object System.Drawing.RectangleF(0, 10, $size, $size)
$g.DrawString('CM', $font, [System.Drawing.Brushes]::White, $textRect, $format)

# The two cache dots under the wordmark: red + blue.
$dotBrushRed = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(238, 81, 69))
$dotBrushBlue = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(47, 129, 247))
$g.FillEllipse($dotBrushRed, 92, 176, 22, 22)
$g.FillEllipse($dotBrushBlue, 142, 176, 22, 22)

$g.Dispose()
$bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

Write-Host "icon written: $outPath"
