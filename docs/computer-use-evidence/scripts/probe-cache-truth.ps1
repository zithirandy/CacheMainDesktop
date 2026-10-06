# Ground truth for the two local cache servers, straight over TCP (no app
# in the middle): Redis KEYS/DBSIZE/EXISTS, Memcached version + metadump.
# Writes redis-keys-truth.txt and memcached-keys-truth.txt next to this file.
$outDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Read-UntilEnd($stream, $marker, $ms) {
    $buf = New-Object System.Collections.Generic.List[byte]
    $chunk = New-Object byte[] 16384
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    while ($sw.ElapsedMilliseconds -lt $ms) {
        if ($stream.DataAvailable) {
            $n = $stream.Read($chunk, 0, $chunk.Length)
            if ($n -le 0) { break }
            for ($i = 0; $i -lt $n; $i++) { $buf.Add($chunk[$i]) }
            $text = [System.Text.Encoding]::ASCII.GetString($buf.ToArray())
            if ($text.Contains($marker)) { break }
        } else {
            Start-Sleep -Milliseconds 100
        }
    }
    return [System.Text.Encoding]::ASCII.GetString($buf.ToArray())
}

# --- Redis 127.0.0.1:6379 (no auth, db 0) ---
$redis = @()
try {
    $c = New-Object System.Net.Sockets.TcpClient('127.0.0.1', 6379)
    $s = $c.GetStream()
    $w = New-Object System.IO.StreamWriter($s)
    $w.NewLine = "`r`n"
    $w.AutoFlush = $true
    $w.WriteLine('DBSIZE')
    $w.WriteLine('KEYS *')
    $w.WriteLine('EXISTS session:tmp')
    $w.WriteLine('EXISTS cache:page:home')
    $w.WriteLine('TTL session:tmp')
    $w.WriteLine('QUIT')
    $redis += (Read-UntilEnd $s 'OK' 1500)
    $c.Close()
} catch {
    $redis += "Redis TCP probe failed: $($_.Exception.Message)"
}
$redis | Out-File (Join-Path $outDir 'redis-keys-truth.txt') -Encoding utf8

# --- Memcached 127.0.0.1:11211 ---
$mc = @()
try {
    $c = New-Object System.Net.Sockets.TcpClient('127.0.0.1', 11211)
    $s = $c.GetStream()
    $w = New-Object System.IO.StreamWriter($s)
    $w.NewLine = "`r`n"
    $w.AutoFlush = $true
    $w.WriteLine('version')
    $mc += (Read-UntilEnd $s 'VERSION' 800)
    $w.WriteLine('lru_crawler metadump all')
    $mc += (Read-UntilEnd $s 'END' 2500)
    $w.WriteLine('quit')
    $c.Close()
} catch {
    $mc += "Memcached TCP probe failed: $($_.Exception.Message)"
}
$mc | Out-File (Join-Path $outDir 'memcached-keys-truth.txt') -Encoding utf8

"--- redis-keys-truth.txt ---"
Get-Content (Join-Path $outDir 'redis-keys-truth.txt')
"--- memcached-keys-truth.txt ---"
Get-Content (Join-Path $outDir 'memcached-keys-truth.txt')
