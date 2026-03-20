@echo off
setlocal
set "APP_DIR=%~dp0"
set "PS_SCRIPT=%APP_DIR%scripts\start-automation-client.ps1"

if not exist "%PS_SCRIPT%" exit /b 1

REM Run PowerShell with better logging - NOT hidden so user can see startup status
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%"
endlocal
