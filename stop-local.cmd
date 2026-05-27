@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

set FOUND=
set PORTS=8888 9891 9892 9893 9999 10088 18088

if exist ".\local-server-ready.txt" (
  for /f "tokens=3 delims=:" %%p in (.\local-server-ready.txt) do (
    for /f "tokens=1 delims=/" %%q in ("%%p") do (
      set PORTS=%%q %PORTS%
    )
  )
)

echo Stopping nb-bo local server...
for %%P in (%PORTS%) do (
  for /f "tokens=5" %%p in ('netstat -ano ^| findstr /R /C:"127\.0\.0\.1:%%P .*LISTENING"') do (
    set FOUND=1
    echo Killing process %%p on port %%P
    taskkill /PID %%p /F
  )
)

if not defined FOUND (
  echo No nb-bo local server is listening on the known local ports.
)

echo.
pause
