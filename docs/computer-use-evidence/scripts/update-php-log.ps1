# Append the CURRENT php.exe / app state to php-backend.log (history kept:
# boot -> save#1 restart -> save#2 restart).
$outDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
$lines = @()

$app = Get-Process CacheMainDesktop -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }
if ($app) {
    $lines += "[$stamp] CacheMainDesktop main window: pid=$($app.Id) title='$($app.MainWindowTitle)'"
} else {
    $lines += "[$stamp] CacheMainDesktop main window NOT FOUND"
}

$php = @(Get-CimInstance Win32_Process -Filter "Name='php.exe'" -ErrorAction SilentlyContinue)
if ($php.Count -gt 0) {
    foreach ($p in $php) {
        $lines += "[$stamp] php.exe pid=$($p.ProcessId) parent=$($p.ParentProcessId) cmdline: $($p.CommandLine)"
    }
} else {
    $lines += "[$stamp] php.exe NOT FOUND"
}

$lines += $lines | Out-String
Add-Content -Path (Join-Path $outDir 'php-backend.log') -Value ($lines -join "`r`n")
"appended:"
$lines
