# Vuelve a abrir el latido y el facturador despues de una actualizacion en el aire (lo inicia la tarea programada "La Bomba Kit - Relanzar", que corre con la cuenta de la caja).
# Autosuficiente: no depende de funciones.ps1 (si una version mala lo dana, esto igual puede relanzar la version restaurada).
$Carpeta = Split-Path -Parent $MyInvocation.MyCommand.Path
$Datos = Join-Path $Carpeta "datos"
function Lanzar($archivo) {
  $ps = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
  $ch = Join-Path $env:SystemRoot "System32\conhost.exe"
  $args2 = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Carpeta\$archivo`""
  if (Test-Path -LiteralPath $ch) { Start-Process -FilePath $ch -ArgumentList ("--headless `"" + $ps + "`" " + $args2) -WindowStyle Hidden }
  else { Start-Process -FilePath $ps -ArgumentList $args2 -WindowStyle Hidden }
}
try { Add-Content -LiteralPath (Join-Path $Datos "arranque.txt") -Value ("{0:yyyy-MM-dd HH:mm:ss}  [relanzar pid {1}] usuario {2}" -f (Get-Date), $PID, $env:USERNAME) -ErrorAction Stop } catch { $null = 1 }
Lanzar "11 latido.ps1"
Start-Sleep -Seconds 2
Lanzar "0 abrir caja y pantalla.ps1"
