# Abre la caja (pantalla del cajero) y la pantalla del cliente, y las vigila.
. "$PSScriptRoot\config.ps1"
. "$PSScriptRoot\funciones.ps1"
$m = New-Object Threading.Mutex($false, "Global\PantallaClienteLB")
if (-not $m.WaitOne(0)) { exit }   # ya hay una copia corriendo
New-Item -ItemType Directory -Force -Path $Carpeta | Out-Null
$log = "$Carpeta\registro.txt"
function Anotar($t) { Add-Content -Path $log -Value ("{0:yyyy-MM-dd HH:mm:ss}  {1}" -f (Get-Date), $t) }
if ((Test-Path $log) -and ((Get-Item $log).Length -gt 500KB)) { Remove-Item $log -Force }

# Esperar red hasta 3 minutos (si no hay, abre igual: la pantalla guarda lo ultimo que vio)
for ($i = 0; $i -lt 36; $i++) {
  if ([System.Net.NetworkInformation.NetworkInterface]::GetIsNetworkAvailable()) { break }
  Start-Sleep -Seconds 5
}
Extender-Pantallas
Start-Sleep -Seconds 3

$ultimoReinicio = (Get-Date).Date
function Abrir-Todo {
  $exe = Buscar-Navegador
  if (-not $exe) { Anotar "No se encontro Chrome ni Edge."; return }
  Cerrar-Navegador $Perfil
  Start-Sleep -Seconds 2
  Arreglar-Cierre $Perfil
  New-Item -ItemType Directory -Force -Path $Perfil | Out-Null
  $p = Elegir-Pantallas $CajaEnPantalla
  Anotar ("Pantallas detectadas: {0}. Navegador: {1}" -f $p.Cuantas, $exe)
  [void](Abrir-Ventana $exe $UrlCaja $Perfil $p.Caja)
  if ($AbrirClienteDesdeKit -and $p.Cliente) { [void](Abrir-Ventana $exe $UrlCliente $Perfil $p.Cliente) }
  elseif ($AbrirClienteDesdeKit) { Anotar "Solo hay una pantalla: se abrio solo la caja." }
}
Abrir-Todo
while ($true) {
  Start-Sleep -Seconds $SegundosVigilar
  try {
    $p = Elegir-Pantallas $CajaEnPantalla
    $quiero = 1; if ($AbrirClienteDesdeKit -and $p.Cliente) { $quiero = 2 }
    $hay = (Ventanas-Nuestras $Perfil).Count
    $toca = $false
    if ($HoraReinicioDiario -and ((Get-Date).Date -gt $ultimoReinicio) -and ((Get-Date).ToString("HH:mm") -ge $HoraReinicioDiario)) {
      $ultimoReinicio = (Get-Date).Date; $toca = $true; Anotar "Reinicio diario del navegador."
    }
    if ($hay -lt $quiero -and $AbrirClienteDesdeKit) { $toca = $true; Anotar "Faltan ventanas ($hay de $quiero). Se reabren." }
    elseif ((Procesos-Navegador $Perfil).Count -eq 0) { $toca = $true; Anotar "El navegador se cerro. Se reabre." }
    if ($toca) { Extender-Pantallas; Start-Sleep -Seconds 2; Abrir-Todo }
    # Cursor: si quedo sobre la pantalla del cliente, se lleva a su esquina
    if ($p.Cliente) {
      $pos = [System.Windows.Forms.Cursor]::Position; $b = $p.Cliente.Bounds
      if ($b.Contains($pos)) { [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(($b.Right - 1), ($b.Bottom - 1)) }
    }
  } catch { Anotar "Error: $($_.Exception.Message)" }
}
