# Borra el perfil del navegador de la pantalla (cierra la sesion de la caja y los datos guardados). Pide confirmacion.
. "$PSScriptRoot\config.ps1"
. "$PSScriptRoot\funciones.ps1"
$r = Read-Host "Esto cierra la sesion de la caja y borra el perfil. Escriba SI para continuar"
if ($r -ne "SI") { exit }
& "$PSScriptRoot\7 salir.ps1"
Start-Sleep -Seconds 2
Remove-Item -Recurse -Force $Perfil -ErrorAction SilentlyContinue
Write-Host "Listo. Abra de nuevo con el acceso del escritorio y entre a la caja con su usuario."
Read-Host "Presione Entrar para cerrar"
