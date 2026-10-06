# Verify the app started: window title, php.exe child + its command line,
# userData runtime.json / connections.json (count only), DevTools endpoint.
# Writes app-verify.txt and php-backend.log next to this script.
$outDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'

$out = @()
$out += "=== verified at $stamp ==="
$app = Get-Process CacheMainDesktop -ErrorAction SilentlyContinue
if ($app) {
    $app | ForEach-Object {
        $out += "CacheMainDesktop pid=$($_.Id) MainWindowTitle='$($_.MainWindowTitle)' MainWindowHandle=$($_.MainWindowHandle) Responding=$($_.Responding)"
    }
} else {
    $out += "CacheMainDesktop process NOT FOUND"
}

$out += ""
$out += "=== php.exe processes ==="
$phpLines = @()
$php = @(Get-CimInstance Win32_Process -Filter "Name='php.exe'" -ErrorAction SilentlyContinue)
if ($php.Count -gt 0) {
    foreach ($p in $php) {
        $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($p.ParentProcessId)" -ErrorAction SilentlyContinue
        $phpLines += "[$stamp] php.exe pid=$($p.ProcessId) parent=$($p.ParentProcessId)($($parent.Name))"
        $phpLines += "[$stamp] cmdline: $($p.CommandLine)"
        $phpLines += "[$stamp] exe path: $($p.ExecutablePath)"
    }
    $out += $phpLines
} else {
    $phpLines += "[$stamp] php.exe NOT FOUND"
    $out += "php.exe NOT FOUND"
}

$out += ""
$out += "=== userData (%APPDATA%\CacheMainDesktop) ==="
$ud = Join-Path $env:APPDATA 'CacheMainDesktop'
foreach ($f in @('runtime.json', 'connections.json', 'settings.json', 'window-state.json')) {
    $p = Join-Path $ud $f
    if (Test-Path $p) {
        $item = Get-Item $p
        if ($f -eq 'runtime.json') {
            $out += "$f (last write $($item.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss'))):"
            $out += (Get-Content $p -Raw)
        } elseif ($f -eq 'connections.json') {
            # Count records only. Contents may hold real credentials and must
            # never be copied into logs or the report.
            try {
                $n = @((Get-Content $p -Raw) -as [string] | ConvertFrom-Json).Count
                $out += "$f exists, last write $($item.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')), record count: $n (contents withheld)"
            } catch {
                $out += "$f exists but could not be parsed (contents withheld)"
            }
        } else {
            $out += "$f exists (last write $($item.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')))"
        }
    } else {
        $out += "$f : NOT FOUND"
    }
}

$out += ""
$out += "=== DevTools endpoint http://127.0.0.1:19233/json/version ==="
try {
    $r = Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:19233/json/version' -TimeoutSec 5
    $out += "HTTP $($r.StatusCode): $($r.Content)"
} catch {
    $out += "DevTools endpoint FAILED: $($_.Exception.Message)"
}

$out | Out-File -FilePath (Join-Path $outDir 'app-verify.txt') -Encoding utf8
$phpLines | Out-File -FilePath (Join-Path $outDir 'php-backend.log') -Encoding utf8
Get-Content (Join-Path $outDir 'app-verify.txt')
