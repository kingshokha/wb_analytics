@echo off
setlocal

set "PORT=4173"
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%PORT% .*LISTENING"') do (
  echo Останавливаю процесс %%P на порту %PORT%...
  taskkill /PID %%P /F >nul 2>&1
  if errorlevel 1 (
    echo Не удалось остановить процесс %%P.
  ) else (
    echo Сервер на порту %PORT% остановлен.
  )
)

echo Готово.
pause
