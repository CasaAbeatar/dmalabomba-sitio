@echo off
cd /d "%~dp0"
if not exist "instalar todo.ps1" (
  echo Falta el archivo "instalar todo.ps1" en esta carpeta.
  echo Extraiga TODO el contenido del zip en una carpeta y abra de nuevo INSTALAR TODO.bat desde esa carpeta.
  pause
  exit /b 1
)
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Se pedira permiso de administrador. Diga que si.
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
powershell -NoProfile -ExecutionPolicy Bypass -File "instalar todo.ps1"
if errorlevel 1 pause
