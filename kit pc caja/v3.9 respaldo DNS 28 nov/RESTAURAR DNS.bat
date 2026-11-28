@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "22 dns publico.ps1" -Revertir
