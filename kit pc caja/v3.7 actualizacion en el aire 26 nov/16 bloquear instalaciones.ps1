# La cajera no puede instalar nada: solo administra la cuenta con permisos de administrador (Windows pide credenciales de administrador).
# Este paso suma tres cierres que no dependen de la cuenta: sin instalaciones por usuario (MSI), sin extensiones nuevas en Chrome/Edge y sin Microsoft Store.
# v3.5 (19 nov 2026, por orden de Emil): en Chrome se permite SOLO la extension Chrome Remote Desktop (lista de permitidas); todas las demas siguen bloqueadas. Edge sigue con bloqueo total.
# No toca el UAC (Emil debe poder seguir instalando el kit desde la misma cuenta) ni crea cuentas.
param([switch]$Silencioso)
. "$PSScriptRoot\config.ps1"
. "$PSScriptRoot\funciones.ps1"
Pedir-Admin $MyInvocation.MyCommand.Path
# 1) Windows Installer: nada de instalaciones por usuario
$k = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\Installer"
New-Item -Path $k -Force | Out-Null
Set-ItemProperty -Path $k -Name DisableUserInstalls -Value 1 -Type DWord
# 2) Chrome y Edge: ninguna extension nueva (la lista bloquea todas). Excepcion unica (v3.5): Chrome Remote Desktop en Chrome, por la lista de permitidas, que prevalece sobre el bloqueo "*".
$ExtensionControlRemoto = "inomeogfingihgjfjlpeplalcfajhgai"   # Chrome Remote Desktop (Google Ireland, Chrome Web Store)
foreach ($marca in @("Google\Chrome", "Microsoft\Edge")) {
  $ruta = "HKLM:\SOFTWARE\Policies\$marca\ExtensionInstallBlocklist"
  New-Item -Path $ruta -Force | Out-Null
  New-ItemProperty -Path $ruta -Name "1" -Value "*" -PropertyType String -Force | Out-Null
}
$permitidas = "HKLM:\SOFTWARE\Policies\Google\Chrome\ExtensionInstallAllowlist"
New-Item -Path $permitidas -Force | Out-Null
New-ItemProperty -Path $permitidas -Name "1" -Value $ExtensionControlRemoto -PropertyType String -Force | Out-Null
# 3) Microsoft Store apagada (solo tiene efecto en Windows Pro/Enterprise/Education; en Home Windows lo ignora)
$s = "HKLM:\SOFTWARE\Policies\Microsoft\WindowsStore"
New-Item -Path $s -Force | Out-Null
Set-ItemProperty -Path $s -Name RemoveWindowsStore -Value 1 -Type DWord
Write-Host "Instalaciones bloqueadas para el usuario: Installer por usuario, extensiones del navegador (solo Chrome Remote Desktop permitida en Chrome) y Microsoft Store."
Pausa
