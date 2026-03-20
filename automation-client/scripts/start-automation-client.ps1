param(
  [switch]$InstallDepsIfMissing = $true
)

$ErrorActionPreference = 'Stop'

$appDir = Split-Path -Parent $PSScriptRoot
$launcherScript = $MyInvocation.MyCommand.Path
$powershellExe = Join-Path $env:WINDIR 'System32\\WindowsPowerShell\\v1.0\\powershell.exe'
Set-Location $appDir
$logoPng = Join-Path $appDir 'branding\logo.png'
$logoIco = Join-Path $appDir 'branding\logo.ico'
$desktopShortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Kapture Automation Agent.lnk'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

function Get-EnvVarValue {
  param(
    [Parameter(Mandatory = $true)][string]$Key,
    [Parameter(Mandatory = $true)][string[]]$Files
  )

  $escaped = [regex]::Escape($Key)
  foreach ($file in $Files) {
    if (-not (Test-Path $file)) { continue }
    foreach ($line in Get-Content -Path $file) {
      if ($line -match "^\s*$escaped\s*=\s*(.*)$") {
        return $matches[1].Trim().Trim('"').Trim("'")
      }
    }
  }
  return $null
}

function Get-WsPortOrDefault {
  param(
    [Parameter(Mandatory = $true)][string]$WsUrl,
    [int]$DefaultPort = 61822
  )
  try {
    $u = [uri]$WsUrl
    if ($u.Port -gt 0) { return $u.Port }
  } catch {
    # ignore parse errors
  }
  return $DefaultPort
}

function Test-PortListening {
  param([Parameter(Mandatory = $true)][int]$Port)
  $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  return [bool]$conn
}

function Resolve-BrowserPath {
  param([string]$PreferredPath)

  if ($PreferredPath -and (Test-Path $PreferredPath)) {
    return $PreferredPath
  }

  $candidates = @(
    'C:\Program Files\Google\Chrome\Application\chrome.exe',
    'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
    'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
    'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    'C:\Users\dshp3\AppData\Local\Yandex\YandexBrowser\Application\browser.exe'
  )

  foreach ($exe in $candidates) {
    if (Test-Path $exe) { return $exe }
  }

  return $null
}

if ($InstallDepsIfMissing -and -not (Test-Path (Join-Path $appDir 'node_modules'))) {
  Write-Host "[launcher] node_modules not found, running npm install..."
  npm install
}

if (Test-Path $logoPng) {
  Write-Host "[launcher] logo: $logoPng"
}

if ((Test-Path $logoIco) -and (Test-Path $launcherScript)) {
  try {
    $ws = New-Object -ComObject WScript.Shell
    $shortcut = $ws.CreateShortcut($desktopShortcut)
    $shortcut.TargetPath = $powershellExe
    $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcherScript`""
    $shortcut.WorkingDirectory = $appDir
    $shortcut.IconLocation = "$logoIco,0"
    $shortcut.Save()
    Write-Host "[launcher] desktop shortcut updated: $desktopShortcut"
  } catch {
    Write-Host "[launcher] shortcut update skipped: $($_.Exception.Message)"
  }
}

$envFiles = @(
  (Join-Path $appDir '.env.local'),
  (Join-Path $appDir '.env.example')
)

$mcpWsUrl = Get-EnvVarValue -Key 'VITE_KAPTURE_MCP_WS_URL' -Files $envFiles
if (-not $mcpWsUrl) { $mcpWsUrl = 'ws://localhost:61822/mcp' }
$mcpPort = Get-WsPortOrDefault -WsUrl $mcpWsUrl -DefaultPort 61822
$mcpLog = Join-Path $appDir "launcher-mcp-$stamp.log"
$mcpErr = Join-Path $appDir "launcher-mcp-$stamp.err.log"

if (Test-PortListening -Port $mcpPort) {
  Write-Host "[launcher] ✓ MCP already listening on :$mcpPort"
} else {
  Write-Host "[launcher] MCP not listening on :$mcpPort, starting..."
  $customMcpCmd = Get-EnvVarValue -Key 'KAPTURE_MCP_START_CMD' -Files $envFiles
  $commands = @()
  if ($customMcpCmd) {
    Write-Host "[launcher] Using custom MCP command: $customMcpCmd"
    $commands = @($customMcpCmd)
  } else {
    $commands = @(
      "npx -y kapture-mcp bridge",
      "npx -y kapture-mcp server",
      "kapture-mcp --transport websocket --port $mcpPort",
      "kapture mcp --transport websocket --port $mcpPort"
    )
  }

  $started = $false
  foreach ($cmd in $commands) {
    Write-Host "[launcher] Trying MCP: $cmd"
    $mcpProcess = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', "$cmd 1> `"$mcpLog`" 2> `"$mcpErr`"" -WorkingDirectory $appDir -WindowStyle Hidden -PassThru

    # Wait longer for MCP to start (up to 30 seconds)
    for ($i = 0; $i -lt 60; $i++) {
      Start-Sleep -Milliseconds 500
      if (Test-PortListening -Port $mcpPort) {
        Write-Host "[launcher] ✓ MCP started successfully on :$mcpPort (PID=$($mcpProcess.Id))"
        $started = $true
        break
      }
    }
    if ($started) { 
      # Log successful startup to file for debugging
      Add-Content -Path $mcpLog -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') - MCP process started with PID=$($mcpProcess.Id)"
      break 
    }
    
    # Check if process died quickly
    if ($mcpProcess.HasExited) {
      Write-Host "[launcher] MCP process exited quickly (check logs)"
    }
  }

  if (-not $started) {
    Write-Host "[launcher] ✗ MCP auto-start failed after all attempts"
    Write-Host "[launcher] Check MCP logs at:"
    Write-Host "  $mcpLog"
    Write-Host "  $mcpErr"
    Write-Host "[launcher] You can also try manually: $([string]$commands[0])"
    Write-Host ""
    # Show log content if available
    if (Test-Path $mcpLog) {
      Write-Host "[launcher] MCP log content:"
      Get-Content -Path $mcpLog | ForEach-Object { Write-Host "  $_" }
    }
    if (Test-Path $mcpErr) {
      Write-Host "[launcher] MCP error log content:"
      Get-Content -Path $mcpErr | ForEach-Object { Write-Host "  $_" }
    }
  }
}

$autoOpenBrowserRaw = Get-EnvVarValue -Key 'KAPTURE_AUTO_OPEN_BROWSER' -Files $envFiles
$autoOpenBrowser = if (-not $autoOpenBrowserRaw) { $true } else { @('1','true','yes','on') -contains $autoOpenBrowserRaw.ToLowerInvariant() }

if ($autoOpenBrowser) {
  $browserPathCfg = Get-EnvVarValue -Key 'KAPTURE_BROWSER_PATH' -Files $envFiles
  $browserTargetUrl = Get-EnvVarValue -Key 'KAPTURE_AUTOMATION_URL' -Files $envFiles
  if (-not $browserTargetUrl) { $browserTargetUrl = 'https://hh.ru' }

  $browserExe = Resolve-BrowserPath -PreferredPath $browserPathCfg
  if ($browserExe) {
    try {
      Start-Process -FilePath $browserExe -ArgumentList $browserTargetUrl | Out-Null
      Write-Host "[launcher] automation browser opened: $browserExe -> $browserTargetUrl"
    } catch {
      Write-Host "[launcher] failed to open automation browser: $($_.Exception.Message)"
    }
  } else {
    Write-Host "[launcher] no Chromium browser detected for auto-open (set KAPTURE_BROWSER_PATH in .env.local)"
  }
}

$existing = Get-NetTCPConnection -LocalPort 5180 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($existing) {
  Write-Host "[launcher] stopping existing process on :5180 (PID=$($existing.OwningProcess))"
  Stop-Process -Id $existing.OwningProcess -Force -ErrorAction SilentlyContinue
}

$log = Join-Path $appDir "launcher-dev-$stamp.log"
$err = Join-Path $appDir "launcher-dev-$stamp.err.log"

Write-Host "[launcher] starting dev server..."
Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', "npm run dev -- --host 127.0.0.1 --port 5180 1> `"$log`" 2> `"$err`"" -WorkingDirectory $appDir -WindowStyle Hidden | Out-Null

Write-Host "[launcher] waiting for dev server to start..."
Start-Sleep -Seconds 3

Write-Host ""
Write-Host "╔════════════════════════════════════════════════════════════╗"
Write-Host "║  ✓ Kapture Automation Client Starting                     ║"
Write-Host "║  ✓ MCP Bridge:   listening on :$mcpPort"
Write-Host "║  ✓ Dev Server:   http://127.0.0.1:5180                    ║"
Write-Host "║  ✓ Browser:      Opening...                              ║"
Write-Host "╚════════════════════════════════════════════════════════════╝"
Write-Host ""

Start-Process 'http://127.0.0.1:5180' -ErrorAction SilentlyContinue | Out-Null

Write-Host "[launcher] Web UI: http://127.0.0.1:5180"
Write-Host "[launcher] Server logs:"
Write-Host "  Dev:  $log"
Write-Host "  MCP:  $mcpLog"
Write-Host ""
Write-Host "[launcher] Automation Client is ready!"
Write-Host "[launcher] → Open your browser extension in the target page"
Write-Host "[launcher] → Fill in the form above and run the task"
Write-Host ""
Write-Host "=== This window can remain open to see logs, or you can close it. ==="
Write-Host ""
