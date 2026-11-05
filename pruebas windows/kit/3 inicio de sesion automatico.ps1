# Inicio de sesion automatico con Autologon de Sysinternals (Microsoft). Guarda la clave cifrada, no en texto.
# Descargue Autologon.zip de Microsoft Sysinternals y deje Autologon64.exe en esta misma carpeta.
. "$PSScriptRoot\funciones.ps1"
Pedir-Admin $MyInvocation.MyCommand.Path
$exe = Join-Path $PSScriptRoot "Autologon64.exe"
if (-not (Test-Path $exe)) {
  Write-Host "Falta Autologon64.exe en esta carpeta. Vea la seccion 'Inicio de sesion automatico' de INSTALACION WINDOWS."
  Read-Host "Presione Entrar para cerrar"; exit
}
$usuario = Read-Host "Usuario de Windows de esta computadora (el de la pantalla)"
$clave = Read-Host "Clave de ese usuario" -AsSecureString
$dom = $env:COMPUTERNAME
$plano = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($clave))
& $exe /accepteula $usuario $dom $plano
$plano = $null
Write-Host "Listo. Reinicie la computadora para probar."
Read-Host "Presione Entrar para cerrar"
