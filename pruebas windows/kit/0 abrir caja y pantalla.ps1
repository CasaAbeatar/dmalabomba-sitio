# Abre la caja (pantalla del cajero) y la pantalla del cliente, las acomoda en su monitor y las vigila.
. "$PSScriptRoot\config.ps1"
. "$PSScriptRoot\funciones.ps1"
if ($UsuarioCaja -and ($env:USERNAME -ne $UsuarioCaja)) { exit }   # esta sesion de Windows no es la de la caja
$m = New-Object Threading.Mutex($false, "Global\PantallaClienteLB")
$tengo = $false
try { $tengo = $m.WaitOne(0) } catch [Threading.AbandonedMutexException] { $tengo = $true }   # la copia anterior se cerro a la fuerza (REPARAR): se retoma
if (-not $tengo) { exit }   # ya hay una copia corriendo
try { (Get-Process -Id $PID).PriorityClass = "BelowNormal" } catch { Write-Verbose "sin prioridad baja" }   # la vigilancia nunca le quita CPU al navegador
New-Item -ItemType Directory -Force -Path $Carpeta | Out-Null
$log = "$Carpeta\registro.txt"
function Anotar($t) { Add-Content -Path $log -Value ("{0:yyyy-MM-dd HH:mm:ss}  {1}" -f (Get-Date), $t) }
if ((Test-Path $log) -and ((Get-Item $log).Length -gt 500KB)) { Remove-Item $log -Force }
Afinar-Usuario

# Esperar red hasta 3 minutos (si no hay, abre igual: la pantalla guarda lo ultimo que vio)
for ($i = 0; $i -lt 36; $i++) {
  if ([System.Net.NetworkInformation.NetworkInterface]::GetIsNetworkAvailable()) { break }
  Start-Sleep -Seconds 5
}
# Esperar al segundo monitor hasta 45 segundos (algunos monitores tardan en despertar despues de encender)
Extender-Pantallas
for ($i = 0; $i -lt 15; $i++) {
  if ([System.Windows.Forms.Screen]::AllScreens.Count -ge 2) { break }
  Start-Sleep -Seconds 3
}
Start-Sleep -Seconds 2

$urlCajaAbrir = $UrlCaja
if ($AbrirClienteDesdeKit) { $urlCajaAbrir = $UrlCaja + "?kit=1" }   # con ?kit=1 la caja no abre la pantalla del cliente por su cuenta (no se duplica)
$ultimoReinicio = (Get-Date).Date
$sinClienteDesde = $null
$ultimasPantallas = -1

function Abrir-Todo {
  $exe = Buscar-Navegador
  if (-not $exe) { Anotar "No se encontro Chrome ni Edge."; return }
  Cerrar-Navegador $Perfil
  Start-Sleep -Seconds 2
  Arreglar-Cierre $Perfil
  New-Item -ItemType Directory -Force -Path $Perfil | Out-Null
  $p = Elegir-Pantallas $CajaEnPantalla
  Anotar ("Pantallas detectadas: {0}. Navegador: {1}" -f $p.Cuantas, $exe)
  [void](Abrir-Ventana $exe $urlCajaAbrir $Perfil $p.Caja $CajaPantallaCompleta)
  if ($AbrirClienteDesdeKit -and $p.Cliente) { [void](Abrir-Ventana $exe $UrlCliente $Perfil $p.Cliente) }
  elseif ($AbrirClienteDesdeKit) { Anotar "Solo hay una pantalla: se abrio solo la caja." }
}
$cajaVista = $false   # la caja ya se vio abierta alguna vez (para saber si la cerraron a proposito)
Abrir-Todo
while ($true) {
  Start-Sleep -Seconds $SegundosVigilar
  try {
    $procs = @(Procesos-Navegador $Perfil)   # una sola consulta por vuelta: es lo mas caro de la vigilancia
    $p = Elegir-Pantallas $CajaEnPantalla
    if ($p.Cuantas -ne $ultimasPantallas) {
      if ($ultimasPantallas -ne -1) { Anotar ("Cambio de pantallas: {0} -> {1}" -f $ultimasPantallas, $p.Cuantas); $script:IntentosF11.Clear() }
      $ultimasPantallas = $p.Cuantas
    }
    if ($HoraReinicioDiario -and ((Get-Date).Date -gt $ultimoReinicio) -and ((Get-Date).ToString("HH:mm") -ge $HoraReinicioDiario)) {
      $ultimoReinicio = (Get-Date).Date; Anotar "Reinicio diario del navegador."
      Extender-Pantallas; Start-Sleep -Seconds 2; Abrir-Todo; continue
    }
    if ($procs.Count -eq 0) {
      if ($cajaVista -and -not $ReabrirCajaSiSeCierra) { Anotar "El navegador se cerro. El kit no lo reabre y termina (para volver: acceso Abrir caja y pantalla del cliente)."; break }
      Anotar "El navegador se cerro. Se reabre."; Extender-Pantallas; Start-Sleep -Seconds 2; Abrir-Todo; continue
    }
    $hs = @(Ventanas-Nuestras $Perfil $procs)
    $hayCaja = $false; $hayCliente = $false
    foreach ($h in $hs) {
      $t = [W32]::Titulo($h)
      if ($t -like "*$TituloCliente*") { $hayCliente = $true } else { $hayCaja = $true }   # cualquier otra ventana nuestra es la caja, aunque este en Clientes, Anular o Administracion (el titulo cambia por modulo)
    }
    if ($hayCaja) { $cajaVista = $true }
    $exe = Buscar-Navegador
    if (-not $hayCaja -and $exe) {
      if ($cajaVista -and -not $ReabrirCajaSiSeCierra) { Anotar "Se cerro la caja con la X. El kit no la reabre y termina (para volver: acceso Abrir caja y pantalla del cliente)."; break }
      Anotar "Falta la ventana de la caja. Se abre."; [void](Abrir-Ventana $exe $urlCajaAbrir $Perfil $p.Caja $CajaPantallaCompleta)
    }
    if ($p.Cliente -and $exe) {
      if ($hayCliente) { $sinClienteDesde = $null }
      elseif ($AbrirClienteDesdeKit) { Anotar "Falta la ventana del cliente. Se abre."; [void](Abrir-Ventana $exe $UrlCliente $Perfil $p.Cliente) }
      else {
        # La abre la caja (Window Management API). El kit espera un tiempo y, si no aparece, la abre el mismo.
        if (-not $sinClienteDesde) { $sinClienteDesde = Get-Date }
        elseif (((Get-Date) - $sinClienteDesde).TotalSeconds -ge $EsperaRespaldoSeg) {
          Anotar "La caja no abrio la pantalla del cliente en $EsperaRespaldoSeg s. La abre el kit (respaldo)."
          [void](Abrir-Ventana $exe $UrlCliente $Perfil $p.Cliente); $sinClienteDesde = $null
        }
      }
    } else { $sinClienteDesde = $null }
    if ($hayCaja -or $hayCliente) { Afinar-Ventanas $p $Perfil $procs }
    # Cursor: si quedo sobre la pantalla del cliente, se lleva a su esquina
    if ($p.Cliente) {
      $pos = [System.Windows.Forms.Cursor]::Position; $b = $p.Cliente.Bounds
      if ($b.Contains($pos)) { [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(($b.Right - 1), ($b.Bottom - 1)) }
    }
  } catch { Anotar "Error: $($_.Exception.Message)" }
}
Anotar "El kit termino."
