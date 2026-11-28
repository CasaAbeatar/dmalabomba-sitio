# Sin suspension, sin apagar pantalla, sin protector de pantalla, sin bloqueo (en corriente alterna) y sin adornos que pesen.
param([switch]$Silencioso)
. "$PSScriptRoot\funciones.ps1"
Pedir-Admin $MyInvocation.MyCommand.Path
& powercfg.exe /change monitor-timeout-ac 0
& powercfg.exe /change standby-timeout-ac 0
& powercfg.exe /change hibernate-timeout-ac 0
& powercfg.exe /change disk-timeout-ac 0
& powercfg.exe /hibernate off     # tambien desactiva el inicio rapido, que a veces estorba al iniciar sesion solo
# Pantalla de bloqueo al apagarse la pantalla (ajuste oculto, esta en el grupo de video) y suspension selectiva de USB (el tacto va por USB)
& powercfg.exe /setacvalueindex SCHEME_CURRENT SUB_VIDEO CONSOLELOCK 0 2>$null
& powercfg.exe /setacvalueindex SCHEME_CURRENT 2a737441-1930-4402-8d77-b2bebba308a3 48e6b7a6-50f5-4782-a5d4-53bb8f07e226 0
& powercfg.exe /setactive SCHEME_CURRENT
# Protector de pantalla por directiva y adornos de Windows para el usuario que instala (los demas usuarios los recibe el script 0 al iniciar sesion)
$k = "HKCU:\Software\Policies\Microsoft\Windows\Control Panel\Desktop"
New-Item -Path $k -Force | Out-Null
Set-ItemProperty $k -Name ScreenSaveActive -Value "0" -Type String
Afinar-Usuario
Write-Host "Energia lista. Para revisar: powercfg /query SCHEME_CURRENT SUB_VIDEO"
Pausa
