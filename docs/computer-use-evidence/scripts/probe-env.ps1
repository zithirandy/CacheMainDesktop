# Capability probe, run once. ASCII-only on purpose (PS 5.1 reads BOM-less
# scripts as ANSI; a Chinese char here would be mojibake). Outputs land next
# to this script under docs/computer-use-evidence/.
$outDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$lines = @()

$lines += "=== OS ==="
$os = Get-CimInstance Win32_OperatingSystem
$lines += "Caption: $($os.Caption)"
$lines += "Version: $($os.Version) Build $($os.BuildNumber)"

$lines += ""
$lines += "=== Display inventory (PowerShell equivalent; windows-mcp DisplayInventory unavailable) ==="
try {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.Screen]::AllScreens | ForEach-Object {
        $lines += "Screen $($_.DeviceName): $($_.Bounds.Width)x$($_.Bounds.Height) at ($($_.Bounds.X),$($_.Bounds.Y)) Primary=$($_.Primary)"
    }
} catch {
    $lines += "Screen enumeration failed: $($_.Exception.Message)"
}

$lines += ""
$lines += "=== GDI screen capture probe (equivalent of windows-mcp Screenshot) ==="
try {
    Add-Type -AssemblyName System.Drawing
    $vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $lines += "VirtualScreen: X=$($vs.X) Y=$($vs.Y) W=$($vs.Width) H=$($vs.Height)"
    $bmp = New-Object System.Drawing.Bitmap($vs.Width, $vs.Height)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($vs.X, $vs.Y, 0, 0, $bmp.Size)
    $g.Dispose()
    $bmp.Save((Join-Path $outDir 'gdi-probe.png'))
    $bmp.Dispose()
    $lines += "CopyFromScreen: OK, wrote gdi-probe.png"
} catch {
    $lines += "CopyFromScreen FAILED (original message): $($_.Exception.Message)"
    $lines += "Exception type: $($_.Exception.GetType().FullName)"
}

$lines | Out-File -FilePath (Join-Path $outDir 'probe-env.txt') -Encoding utf8
Get-Content (Join-Path $outDir 'probe-env.txt')
