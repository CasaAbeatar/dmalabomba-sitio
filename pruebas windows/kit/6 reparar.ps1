# Cierra todo y vuelve a abrir la caja y la pantalla del cliente.
. "$PSScriptRoot\config.ps1"
. "$PSScriptRoot\funciones.ps1"
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
  Where-Object { $_.CommandLine -like "*0 abrir caja y pantalla.ps1*" -and $_.ProcessId -ne $PID } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Cerrar-Navegador $Perfil
Start-Sleep -Seconds 2
Extender-Pantallas
Start-Process powershell.exe -WindowStyle Hidden -ArgumentList "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSScriptRoot\0 abrir caja y pantalla.ps1`""
