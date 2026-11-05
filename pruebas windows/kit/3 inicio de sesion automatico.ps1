# Inicio de sesion automatico con Autologon de Sysinternals (Microsoft). Guarda la clave cifrada (secreto de LSA), no en texto.
# Descargue Autologon.zip de Microsoft Sysinternals y deje Autologon64.exe en esta misma carpeta.
param([switch]$Silencioso)
. "$PSScriptRoot\config.ps1"
. "$PSScriptRoot\funciones.ps1"
Pedir-Admin $MyInvocation.MyCommand.Path
$exe = Join-Path $PSScriptRoot "Autologon64.exe"
if (-not (Test-Path $exe)) {
  Write-Host "Falta Autologon64.exe en esta carpeta. Vea la seccion 'Inicio de sesion automatico' de INSTALACION WINDOWS."
  Pausa; exit
}
$sugerido = "Caja"; if ($UsuarioCaja) { $sugerido = $UsuarioCaja }
$usuario = Read-Host "Cuenta de Windows de la caja (Enter para '$sugerido'; debe ser una cuenta LOCAL con clave)"
if (-not $usuario) { $usuario = $sugerido }
$clave = Read-Host "Clave de esa cuenta" -AsSecureString
$dom = $env:COMPUTERNAME
$plano = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($clave))
if (-not $plano) { Write-Host "La clave esta vacia: Windows no puede iniciar solo con una cuenta sin clave de forma confiable. Cree una clave y repita."; Pausa; exit }
# Windows 11 solo deja iniciar con clave si no obliga a Windows Hello en este equipo.
$pl = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\PasswordLess\Device"
if (Test-Path $pl) { Set-ItemProperty $pl -Name DevicePasswordLessBuildVersion -Value 0 -Type DWord -ErrorAction SilentlyContinue }
& $exe /accepteula $usuario $dom $plano | Out-Null
$plano = $null
$w = Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" -ErrorAction SilentlyContinue
Write-Host ("Estado: AutoAdminLogon={0}  DefaultUserName={1}  DefaultDomainName={2}" -f $w.AutoAdminLogon, $w.DefaultUserName, $w.DefaultDomainName)
if ($w.DefaultPassword) { Write-Host "AVISO: hay una clave en texto plano en el registro (DefaultPassword). Repita con Autologon o quitela." }
Write-Host "Listo. Reinicie la computadora para probar. Para desactivarlo: ejecute Autologon64.exe y pulse Disable."
Pausa
