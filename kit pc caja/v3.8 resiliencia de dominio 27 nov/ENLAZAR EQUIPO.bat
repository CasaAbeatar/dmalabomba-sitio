@echo off
cd /d "%~dp0"
if not exist "13 identidad del equipo.ps1" (
  echo Falta el archivo "13 identidad del equipo.ps1" en esta carpeta.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "13 identidad del equipo.ps1"
