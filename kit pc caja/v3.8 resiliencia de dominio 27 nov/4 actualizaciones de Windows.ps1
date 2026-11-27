# Windows no reinicia dentro del horario de atencion. En Windows Home solo valen las horas activas (los demas ajustes los ignora).
param([switch]$Silencioso)
. "$PSScriptRoot\config.ps1"
. "$PSScriptRoot\funciones.ps1"
Pedir-Admin $MyInvocation.MyCommand.Path
$edicion = (Get-CimInstance Win32_OperatingSystem).Caption
$esHome = $edicion -like "*Home*"
# Horas activas que sirven en todas las ediciones (las mismas de Configuracion > Windows Update > Opciones avanzadas > Horas activas)
$ux = "HKLM:\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings"
New-Item -Path $ux -Force | Out-Null
Set-ItemProperty $ux -Name ActiveHoursStart -Value $HorarioDesde -Type DWord
Set-ItemProperty $ux -Name ActiveHoursEnd   -Value $HorarioHasta -Type DWord
Set-ItemProperty $ux -Name SmartActiveHoursState -Value 2 -Type DWord   # 2 = horas manuales, no las "inteligentes"
if (-not $esHome) {
  $k = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate"
  New-Item -Path $k -Force | Out-Null
  Set-ItemProperty $k -Name SetActiveHours   -Value 1 -Type DWord
  Set-ItemProperty $k -Name ActiveHoursStart -Value $HorarioDesde -Type DWord
  Set-ItemProperty $k -Name ActiveHoursEnd   -Value $HorarioHasta -Type DWord
  $au = "$k\AU"
  New-Item -Path $au -Force | Out-Null
  Set-ItemProperty $au -Name AUOptions -Value 4 -Type DWord               # descargar e instalar en horario programado
  Set-ItemProperty $au -Name ScheduledInstallTime -Value 3 -Type DWord    # 3 a. m.
  Write-Host "Edicion: $edicion. Directivas de Windows Update aplicadas, horas activas de $HorarioDesde a $HorarioHasta."
} else {
  Write-Host "Edicion: $edicion (Home). Solo se fijaron las horas activas de $HorarioDesde a $HorarioHasta."
  Write-Host "Home ignora las directivas de instalacion programada. Revise Configuracion > Windows Update > Opciones avanzadas > Horas activas: deben decir $HorarioDesde y $HorarioHasta."
  Write-Host "Si Windows pide reiniciar, lo hara fuera de esas horas; con el inicio de sesion automatico la caja vuelve sola."
}
Pausa
