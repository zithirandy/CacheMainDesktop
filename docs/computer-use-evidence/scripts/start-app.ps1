# Launch the packaged app with the DevTools port open. ASCII-only.
Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$exe = Join-Path $PWD 'dist\win-unpacked\CacheMainDesktop.exe'
"started at $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), ELECTRON_RUN_AS_NODE was: [$env:ELECTRON_RUN_AS_NODE]"
Start-Process -FilePath $exe -ArgumentList '--remote-debugging-port=19233'
"Start-Process issued for: $exe"
