# Hard-restart CacheMainDesktop with renderer accessibility forced on (2026-10-06
# correction round: verifies whether windows-mcp's UIA Snapshot can see Electron
# web content when a11y is enabled). ASCII-only; run from the repo root.
Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
"=== before ==="
Get-Process CacheMainDesktop -ErrorAction SilentlyContinue | Select-Object Id,MainWindowTitle | Format-Table -AutoSize | Out-String
Get-CimInstance Win32_Process -Filter "Name='php.exe'" | Where-Object { $_.ExecutablePath -like '*CacheMainDesktop*' } | ForEach-Object { "killing bundled php pid $($_.ProcessId)"; Stop-Process -Id $_.ProcessId -Force }
Stop-Process -Name CacheMainDesktop -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
$exe = Join-Path $PWD 'dist\win-unpacked\CacheMainDesktop.exe'
Start-Process -FilePath $exe -ArgumentList '--remote-debugging-port=19233','--force-renderer-accessibility'
"started at $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), args: --remote-debugging-port=19233 --force-renderer-accessibility"
