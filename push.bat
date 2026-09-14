@echo off
REM ============================================================================
REM  Terra Sales Dashboard - one-click GitHub push
REM
REM  Dubbelklik dit bestand om ALLE wijzigingen te committen en te pushen.
REM  Optioneel een eigen bericht meegeven vanaf de terminal:
REM      push.bat "mijn commit bericht"
REM
REM  (.env, build-logs en RESTART.trigger worden automatisch overgeslagen -
REM   die staan in .gitignore.)
REM ============================================================================
setlocal
cd /d "%~dp0"

set "MSG=%*"
if "%MSG%"=="" set "MSG=Update Terra Sales Dashboard (dev session)"

echo.
echo === Wijzigingen die gepusht worden ===
git status --short
echo.

git add -A
git commit -m "%MSG%" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01QQwUvoZQken6e3k9BnMeNW"
if errorlevel 1 (
  echo.
  echo Niets te committen ^(of commit mislukt^) - ik probeer alsnog te pushen...
)

echo.
echo === Pushen naar GitHub ===
git push

echo.
if errorlevel 1 (
  echo *** PUSH MISLUKT - zie de melding hierboven. ***
) else (
  echo Klaar! Alles staat op GitHub.
)
echo.
pause
