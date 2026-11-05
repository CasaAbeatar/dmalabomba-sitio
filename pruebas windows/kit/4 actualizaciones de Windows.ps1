# Windows no reinicia dentro del horario de atencion. Instala y reinicia fuera de ese horario.
. "$PSScriptRoot\config.ps1"
. "$PSScriptRoot\funciones.ps1"
Pedir-Admin $MyInvocation.MyCommand.Path
$k = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate"
New-Item -Path $k -Force | Out-Null
Set-ItemProperty $k -Name SetActiveHours   -Value 1 -Type DWord
Set-ItemProperty $k -Name ActiveHoursStart -Value $HorarioDesde -Type DWord
Set-ItemProperty $k -Name ActiveHoursEnd   -Value $HorarioHasta -Type DWord
$au = "$k\AU"
New-Item -Path $au -Force | Out-Null
Set-ItemProperty $au -Name AUOptions -Value 4 -Type DWord               # descargar e instalar en horario programado
Set-ItemProperty $au -Name ScheduledInstallTime -Value 3 -Type DWord    # 3 a. m.
Write-Host "Horario de atencion: de $HorarioDesde a $HorarioHasta. Instalacion programada a las 3 a. m."
Write-Host "Si su Windows es Home y no respeta esto, use Configuracion > Windows Update > Cambiar horas activas."
Read-Host "Presione Entrar para cerrar"
