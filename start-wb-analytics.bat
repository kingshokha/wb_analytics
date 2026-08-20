@echo off
chcp 65001 >nul
setlocal

cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js не найден. Установите Node.js версии 20 или новее.
  pause
  exit /b 1
)

set "WB_ANALYTICS_URL=http://127.0.0.1:4173/"

start "WB Analytics Server" /min cmd /c "node server.js"
ping 127.0.0.1 -n 3 >nul
start "" "%WB_ANALYTICS_URL%"

endlocal
