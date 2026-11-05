# Sin suspension, sin apagar pantalla, sin protector de pantalla, sin bloqueo (en corriente alterna).
. "$PSScriptRoot\funciones.ps1"
Pedir-Admin $MyInvocation.MyCommand.Path
powercfg /change monitor-timeout-ac 0
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /change disk-timeout-ac 0
powercfg /hibernate off     # tambien desactiva el inicio rapido, que a veces estorba al iniciar sesion solo
# Pantalla de bloqueo al apagarse la pantalla (ajuste oculto) y suspension selectiva de USB (el tacto va por USB)
powercfg /setacvalueindex SCHEME_CURRENT SUB_NONE CONSOLELOCK 0
powercfg /setacvalueindex SCHEME_CURRENT 2a737441-1930-4402-8d77-b2bebba308a3 48e6b7a6-50f5-4782-a5d4-53bb8f07e226 0
powercfg /setactive SCHEME_CURRENT
# Protector de pantalla
Set-ItemProperty "HKCU:\Control Panel\Desktop" -Name ScreenSaveActive -Value "0" -ErrorAction SilentlyContinue
Remove-ItemProperty "HKCU:\Control Panel\Desktop" -Name "SCRNSAVE.EXE" -ErrorAction SilentlyContinue
$k = "HKCU:\Software\Policies\Microsoft\Windows\Control Panel\Desktop"
New-Item -Path $k -Force | Out-Null
Set-ItemProperty $k -Name ScreenSaveActive -Value "0" -Type String
Write-Host "Energia lista. Para revisar: powercfg /query SCHEME_CURRENT SUB_VIDEO"
Read-Host "Presione Entrar para cerrar"
