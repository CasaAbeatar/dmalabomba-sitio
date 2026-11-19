# Cierra las dos ventanas y la vigilancia (para mantenimiento). Para volver: icono "Facturador".
. "$PSScriptRoot\config.ps1"
. "$PSScriptRoot\funciones.ps1"
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
  Where-Object { ($_.CommandLine -like "*0 abrir caja y pantalla.ps1*" -or $_.CommandLine -like "*servidor publicidad.ps1*") -and $_.ProcessId -ne $PID } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
New-Item -ItemType Directory -Force -Path $Datos | Out-Null
Set-Content -Path "$Datos\mantenimiento.txt" -Value (Get-Date).ToString("s")
Cerrar-Navegador $Perfil
