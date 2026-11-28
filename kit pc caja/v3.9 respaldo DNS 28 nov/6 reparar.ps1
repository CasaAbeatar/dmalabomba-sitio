# REPARAR (v3). Lo usa la cajera (sin permisos de administrador). Deja una sola copia de cada ventana, fija las pantallas,
# revisa el latido y VERIFICA la identidad de la computadora (si falta, pregunta Soda o Pollos).
param([switch]$Silencioso)
. "$PSScriptRoot\config.ps1"
. "$PSScriptRoot\funciones.ps1"
. "$PSScriptRoot\funciones v3.ps1"
if (Test-Path -LiteralPath "$PSScriptRoot\funciones dns.ps1") { . "$PSScriptRoot\funciones dns.ps1" }   # v3.9
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
# 2b) v3.9: vaciar la memoria de nombres (DNS) de Windows, por si quedo guardada una respuesta mala. Sin permisos de administrador Windows puede no dejar: no pasa nada, se anota.
$limpieza = "no se pudo"
try { $salidaDns = (& ipconfig.exe /flushdns 2>&1 | Out-String).Trim(); if ($LASTEXITCODE -eq 0) { $limpieza = "hecha" } else { $limpieza = "no se pudo (" + $salidaDns.Substring(0, [Math]::Min(80, $salidaDns.Length)) + ")" } } catch { $limpieza = "no se pudo (" + $_.Exception.Message + ")" }
try { Add-Content -Path "$Datos\registro.txt" -Value ("{0:yyyy-MM-dd HH:mm:ss}  Reparar: limpieza de la memoria DNS de Windows: {1}" -f (Get-Date), $limpieza) } catch { $null = 1 }
# 2c) v3.9: DNS publicos en el adaptador activo, SOLO si Emil lo activo ($DnsPublicoRespaldo en config.ps1), si esto corre como administrador y si el DNS de la red falla pero el publico resuelve
if ($DnsPublicoRespaldo) {
  try {
    if (-not (Es-Admin)) { Add-Content -Path "$Datos\registro.txt" -Value ("{0:yyyy-MM-dd HH:mm:ss}  Reparar: DNS publicos de respaldo activados en config.ps1, pero Reparar no corre como administrador: no se cambia nada." -f (Get-Date)) }
    else {
      $dg = Diagnosticar-Dns ([Uri]$UrlCaja).DnsSafeHost
      if ($dg.dns_local_falla) { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$PSScriptRoot\22 dns publico.ps1" -Aplicar -Silencioso 2>&1 | ForEach-Object { Add-Content -Path "$Datos\registro.txt" -Value ("{0:yyyy-MM-dd HH:mm:ss}  Reparar/DNS: {1}" -f (Get-Date), $_) } }
    }
  } catch { Add-Content -Path "$Datos\registro.txt" -Value ("{0:yyyy-MM-dd HH:mm:ss}  Reparar: error en el respaldo de DNS: {1}" -f (Get-Date), $_.Exception.Message) }
}
# 3) Abrir de nuevo el facturador y la pantalla del cliente
Lanzar-Oculto ("-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSScriptRoot\0 abrir caja y pantalla.ps1`"")
# 4) El latido debe seguir vivo: si no corre, se arranca
$lat = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -like "*11 latido.ps1*" } | Select-Object -First 1
if (-not $lat) { Lanzar-Oculto ("-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSScriptRoot\11 latido.ps1`"") }
# 5) Identidad: si falta, esta danada, es de otra PC o el panel no la reconoce, pregunta Soda o Pollos (la cajera puede elegir Enlazar despues)
try { [void](Asegurar-Identidad "reparar" "") } catch { Add-Content -Path "$Datos\registro.txt" -Value ("{0:yyyy-MM-dd HH:mm:ss}  Reparar: error al verificar la identidad: {1}" -f (Get-Date), $_.Exception.Message) }
