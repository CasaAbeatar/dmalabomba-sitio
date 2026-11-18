# REPARAR (v3). Lo usa la cajera (sin permisos de administrador). Deja una sola copia de cada ventana, fija las pantallas,
# revisa el latido y VERIFICA la identidad de la computadora (si falta, pregunta Soda o Pollos).
param([switch]$Silencioso)
. "$PSScriptRoot\config.ps1"
. "$PSScriptRoot\funciones.ps1"
. "$PSScriptRoot\funciones v3.ps1"
# 1) Detener la vigilancia, el servidor de publicidad y cualquier aviso viejo (el latido no se toca)
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
  Where-Object { ($_.CommandLine -like "*0 abrir caja y pantalla.ps1*" -or $_.CommandLine -like "*servidor publicidad.ps1*" -or $_.CommandLine -like "*15 aviso pendiente.ps1*") -and $_.ProcessId -ne $PID } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Registrar-Evento "reparacion" "Se uso el icono Reparar"
# 2) Cerrar el navegador del kit (asi no queda mas de una ventana 2), limpiar marcas y volver a extender y fijar las pantallas
Cerrar-Navegador $Perfil
Start-Sleep -Seconds 2
Arreglar-Cierre $Perfil
Remove-Item "$Datos\mantenimiento.txt" -Force -ErrorAction SilentlyContinue
Remove-Item "$Datos\abrir.flag" -Force -ErrorAction SilentlyContinue
Extender-Pantallas
# 3) Abrir de nuevo el facturador y la pantalla del cliente
Start-Process powershell.exe -WindowStyle Hidden -ArgumentList "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSScriptRoot\0 abrir caja y pantalla.ps1`""
# 4) El latido debe seguir vivo: si no corre, se arranca
$lat = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -like "*11 latido.ps1*" } | Select-Object -First 1
if (-not $lat) { Start-Process powershell.exe -WindowStyle Hidden -ArgumentList "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSScriptRoot\11 latido.ps1`"" }
# 5) Identidad: si falta, esta danada, es de otra PC o el panel no la reconoce, pregunta Soda o Pollos (la cajera puede elegir Enlazar despues)
try { [void](Asegurar-Identidad "reparar" "") } catch { Add-Content -Path "$Datos\registro.txt" -Value ("{0:yyyy-MM-dd HH:mm:ss}  Reparar: error al verificar la identidad: {1}" -f (Get-Date), $_.Exception.Message) }
