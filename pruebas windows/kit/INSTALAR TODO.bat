@echo off
cd /d "%~dp0"
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Se pedira permiso de administrador. Diga que si.
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
powershell -NoProfile -ExecutionPolicy Bypass -File "1 crear accesos y arranque automatico.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -File "2 energia y pantalla.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -File "4 actualizaciones de Windows.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -File "5 pantallas y permiso de ventanas.ps1"
echo.
echo Falta solo el paso 3 (inicio de sesion automatico). Vea INSTALACION WINDOWS.
pause
