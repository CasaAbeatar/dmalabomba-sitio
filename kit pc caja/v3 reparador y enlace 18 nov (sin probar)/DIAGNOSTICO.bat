@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "10 diagnostico.ps1" -AbrirPoliticas
