param(
  [switch]$InstallDepsIfMissing = $true
)

$ErrorActionPreference = 'Stop'

$appDir = Split-Path -Parent $PSScriptRoot
Set-Location $appDir

if ($InstallDepsIfMissing -and -not (Test-Path (Join-Path $appDir 'node_modules'))) {
  Write-Host "[launcher] node_modules not found, running npm install..."
  npm install
}

$existing = Get-NetTCPConnection -LocalPort 5180 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($existing) {
  Write-Host "[launcher] stopping existing process on :5180 (PID=$($existing.OwningProcess))"
  Stop-Process -Id $existing.OwningProcess -Force -ErrorAction SilentlyContinue
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$log = Join-Path $appDir "launcher-dev-$stamp.log"
$err = Join-Path $appDir "launcher-dev-$stamp.err.log"

Write-Host "[launcher] starting dev server..."
Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', "npm run dev -- --host 127.0.0.1 --port 5180 1> `"$log`" 2> `"$err`"" -WorkingDirectory $appDir | Out-Null

Start-Sleep -Seconds 3
Start-Process 'http://127.0.0.1:5180'

Write-Host "[launcher] app opened: http://127.0.0.1:5180"
Write-Host "[launcher] logs:"
Write-Host "  $log"
Write-Host "  $err"
