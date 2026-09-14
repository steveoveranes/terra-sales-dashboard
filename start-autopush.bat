@echo off
rem ============================================================
rem  Start the Terra Sales Dashboard auto-push watcher.
rem  Double-click this ONCE and leave the window open. Then just
rem  tell Claude "github commit go!" and your changes are committed
rem  and pushed to GitHub automatically - no clicking, no copy-paste.
rem ============================================================
setlocal
cd /d "%~dp0"

where git >nul 2>nul
if errorlevel 1 (
  echo.
  echo Git is not installed or not on PATH. Install Git for Windows from https://git-scm.com and run this again.
  echo.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0git-autopush.ps1"
pause
