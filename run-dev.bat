@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js is not installed.
  echo Please install Node.js LTS from https://nodejs.org  then run this script again.
  echo.
  pause
  exit /b 1
)

echo === Installing backend dependencies (first run can take a few minutes) ===
pushd server
call npm install || goto :err
echo === Building backend ===
call npm run build || goto :err
popd

echo === Installing frontend dependencies ===
pushd web
call npm install || goto :err
echo === Building frontend ===
call npm run build || goto :err
popd

echo === Copying frontend build into server ===
if exist "server\web-dist" rmdir /s /q "server\web-dist"
xcopy /e /i /y "web\dist" "server\web-dist" >nul

echo.
echo ============================================================
echo   Dashboard starting on http://localhost:8080
echo   Leave this window open. Press Ctrl+C to stop.
echo ============================================================
echo.
pushd server
call npm start
popd
goto :eof

:err
echo.
echo *** Something failed above. Copy the error text and send it to Claude. ***
pause
exit /b 1
