@echo off
rem ============================================================
rem  Start the Terra Sales Dashboard auto build & restart watcher.
rem  Double-click this ONCE and leave the window open. It builds and
rem  starts the dashboard, and rebuilds/restarts automatically whenever
rem  new code is delivered. No more manual Ctrl-C + restart.
rem ============================================================
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js is not installed. Install Node.js LTS from https://nodejs.org and run this again.
  echo.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0dev-autorun.ps1"
pause
