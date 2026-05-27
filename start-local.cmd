@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

set NODE_USE_ENV_PROXY=1
set HTTP_PROXY=http://127.0.0.1:7897
set HTTPS_PROXY=http://127.0.0.1:7897
set APPDATA=%~dp0.netlify-cli-appdata
set LOCALAPPDATA=%~dp0.netlify-cli-local

echo Starting nb-bo local server...
echo Logs: %~dp0local-netlify-dev.log

set PORT=
for %%P in (8888 9891 9892 9893 9999 10088 18088) do (
  set TRY_PORT=%%P
  set LISTEN_PID=
  for /f "tokens=5" %%p in ('netstat -ano ^| findstr /R /C:"127\.0\.0\.1:%%P .*LISTENING"') do set LISTEN_PID=%%p
  if not defined LISTEN_PID (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $l=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Parse('127.0.0.1'), %%P); $l.Start(); $l.Stop(); exit 0 } catch { exit 1 }"
    if not errorlevel 1 if not defined PORT set PORT=%%P
  )
)

if not defined PORT (
  echo.
  echo No usable local port found from 8888, 9891, 9892, 9893, 9999, 10088, 18088.
  echo Please restart Windows or check whether these ports are reserved by security software.
  echo.
  pause
  exit /b 1
)

echo Open http://localhost:%PORT% after the server is ready.
echo Selected port: %PORT%

call npm run build > ".\local-netlify-dev.log" 2>&1
if errorlevel 1 (
  echo.
  echo Build failed. See local-netlify-dev.log:
  echo ------------------------------------------------------------
  type ".\local-netlify-dev.log"
  echo ------------------------------------------------------------
  pause
  exit /b 1
)

node ".\local-server.mjs"
if errorlevel 1 (
  echo.
  echo Local server exited with an error.
  echo If the message says EADDRINUSE, run stop-local.cmd and start again.
  echo.
  pause
  exit /b 1
)
