@echo off
setlocal
cd /d "%~dp0"
set "DEST=%LOCALAPPDATA%\terra-sales-dashboard"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js is not installed. Install Node.js LTS from https://nodejs.org and run this again.
  echo.
  pause
  exit /b 1
)

echo ============================================================
echo   Copying SOURCE ONLY to a local folder (node_modules must
echo   not live on the H: shared drive):
echo   %DEST%
echo ============================================================
echo.

if not exist "%DEST%\server\src"  mkdir "%DEST%\server\src"
if not exist "%DEST%\web\src"     mkdir "%DEST%\web\src"
if not exist "%DEST%\web\public"  mkdir "%DEST%\web\public"
if not exist "%DEST%\web\scripts" mkdir "%DEST%\web\scripts"

rem --- copy only the source we need, never node_modules/dist ---
rem NOTE: web\scripts is copied (build-number generator) but the build counter
rem file web\.buildcounter.json is deliberately NOT purged, so it keeps counting.
robocopy "%CD%\server\src"  "%DEST%\server\src"  /E /PURGE /NFL /NDL /NJH /NJS /NP >nul
robocopy "%CD%\web\src"     "%DEST%\web\src"     /E /PURGE /NFL /NDL /NJH /NJS /NP >nul
robocopy "%CD%\web\public"  "%DEST%\web\public"  /E /NFL /NDL /NJH /NJS /NP >nul
robocopy "%CD%\web\scripts" "%DEST%\web\scripts" /E /PURGE /NFL /NDL /NJH /NJS /NP >nul
copy /y "%CD%\server\package.json"  "%DEST%\server\"  >nul
copy /y "%CD%\server\tsconfig.json" "%DEST%\server\"  >nul
copy /y "%CD%\web\package.json"     "%DEST%\web\"      >nul
copy /y "%CD%\web\tsconfig.json"    "%DEST%\web\"      >nul
copy /y "%CD%\web\vite.config.ts"   "%DEST%\web\"      >nul
copy /y "%CD%\web\index.html"       "%DEST%\web\"      >nul
if exist "%CD%\.env" copy /y "%CD%\.env" "%DEST%\" >nul
copy /y "%CD%\.env.example" "%DEST%\" >nul

if not exist "%DEST%\server\package.json" (
  echo Copy failed: server\package.json not found in %DEST%.
  pause
  exit /b 1
)

cd /d "%DEST%"

echo === Installing backend dependencies (first run can take a few minutes) ===
pushd server
call npm install || goto :err
call npm run build || goto :err
popd

echo === Installing frontend dependencies ===
pushd web
call npm install || goto :err
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
