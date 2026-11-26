# ENLAZAR EQUIPO (v3). Verifica la identidad de esta computadora (Soda o Pollos): si falta, esta danada, es de otra PC o no coincide, pregunta en pantalla y pide el codigo de un solo uso.
# Se puede repetir las veces que haga falta. La identidad queda en C:\PantallaCliente\datos\equipo.json y no cambia aunque en el facturador se cambie de empresa.
param([switch]$Silencioso, [string]$Estacion = "")
. "$PSScriptRoot\config.ps1"
. "$PSScriptRoot\funciones.ps1"
. "$PSScriptRoot\funciones v3.ps1"
New-Item -ItemType Directory -Force -Path $Datos | Out-Null
try {
  Write-Host ""
  Write-Host "=== ENLAZAR ESTA COMPUTADORA CON EL PANEL ==="
  $r = Asegurar-Identidad "enlazar" $Estacion
  if ($r.Resultado -eq "ok") { Write-Host ("LISTO: esta computadora esta enlazada como " + (Nombre-Estacion $r.Estacion) + ".") -ForegroundColor Green }
  else { Write-Host "PENDIENTE: esta computadora sigue SIN enlazar. Queda un recordatorio visible; el icono Reparar o este mismo archivo vuelven a preguntar." -ForegroundColor Yellow }
  $texto = Texto-Resumen 0
  Write-Host ""
  Write-Host $texto
  [void](Dialogo "Enlace de la computadora" ($texto.Replace("`r`n", "`n").Replace("`n", "`r`n")) @("Aceptar") -tam 11)
} catch {
  Write-Host ("ERROR: {0}" -f $_.Exception.Message) -ForegroundColor Red
  throw
} finally {
  Pausa
}
