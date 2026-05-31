@echo off
setlocal
cd /d "%~dp0"

set NODE_USE_ENV_PROXY=1
set HTTP_PROXY=http://127.0.0.1:7897
set HTTPS_PROXY=http://127.0.0.1:7897
set APPDATA=%~dp0.netlify-cli-appdata
set LOCALAPPDATA=%~dp0.netlify-cli-local

echo Starting OAC local preview...
echo This will build the app and start a detached local server.
echo.

call npm run start:local
if errorlevel 1 (
  echo.
  echo Start failed. Please send the error text above to Codex.
  echo.
  pause
  exit /b 1
)

echo.
echo Local server is ready. The address above is the one to open.
echo You can close this window; the local server will keep running.
echo To stop it, run stop-local.cmd.
echo.
pause
