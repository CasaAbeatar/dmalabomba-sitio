# Abre la caja (pantalla del cajero) y la pantalla del cliente, las acomoda en su monitor y las vigila.
# v3: una sola ventana 2, cerrar la ventana 1 cierra la 2, plan B de una sola pantalla y recordatorio si falta el enlace.
. "$PSScriptRoot\config.ps1"
. "$PSScriptRoot\funciones.ps1"
. "$PSScriptRoot\funciones v3.ps1"
$m = New-Object Threading.Mutex($false, "Global\PantallaClienteLB")
$tengo = $false
try { $tengo = $m.WaitOne(0) } catch [Threading.AbandonedMutexException] { $tengo = $true }   # la copia anterior se cerro a la fuerza (REPARAR): se retoma
if (-not $tengo) {
  # Ya hay una vigilancia corriendo: se le pide abrir el facturador (si la cajera cerro la caja, vuelve) y esta copia termina.
  try { New-Item -ItemType Directory -Force -Path $Datos | Out-Null; Set-Content -LiteralPath "$Datos\abrir.flag" -Value (Get-Date).ToString("s") } catch { Write-Verbose "no se pudo pedir la apertura" }
  exit
}
try { (Get-Process -Id $PID).PriorityClass = "BelowNormal" } catch { Write-Verbose "sin prioridad baja" }   # la vigilancia nunca le quita CPU al navegador
New-Item -ItemType Directory -Force -Path $Datos | Out-Null
$log = "$Datos\registro.txt"
# Un error al escribir el registro (disco lleno, antivirus) nunca debe detener la vigilancia.
function Anotar($t) { try { Add-Content -Path $log -Value ("{0:yyyy-MM-dd HH:mm:ss}  {1}" -f (Get-Date), $t) } catch { Write-Verbose "no se pudo escribir el registro" } }
try { if ((Test-Path $log) -and ((Get-Item $log).Length -gt 500KB)) { Remove-Item $log -Force } } catch { Write-Verbose "registro" }
Remove-Item "$Datos\mantenimiento.txt" -Force -ErrorAction SilentlyContinue
Remove-Item "$Datos\abrir.flag" -Force -ErrorAction SilentlyContinue
Afinar-Usuario

# Identidad: si falta, esta danada o es de otra PC, queda un recordatorio visible hasta que se enlace (Reparar o ENLAZAR EQUIPO.bat).
$ultimoAviso = [DateTime]::MinValue
try {
  $e0 = Estado-Identidad
  if ($e0.Estado -ne "ok") {
    if (-not (Hay-Pendiente)) { Marcar-Pendiente ("La identidad de esta computadora esta en estado: " + $e0.Estado) }
    Anotar ("Identidad de la computadora: " + $e0.Estado + ". Queda el recordatorio de enlazar.")
  } elseif (Hay-Pendiente) { Quitar-Pendiente }
  if (Hay-Pendiente) { Mostrar-Aviso-Pendiente; $ultimoAviso = Get-Date }
} catch { Anotar "No se pudo revisar la identidad: $($_.Exception.Message)" }

# Servidor local de la publicidad (carpeta de la computadora). Si se cae, se levanta solo en la vigilancia.
function Levantar-Servidor {
  try { return Start-Process -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", "`"$Carpeta\servidor publicidad.ps1`"") -WindowStyle Hidden -PassThru }
  catch { Anotar "No se pudo iniciar el servidor de publicidad: $($_.Exception.Message)"; return $null }
}
function Servidor-Vivo {
  $c = $null
  try { $c = New-Object Net.Sockets.TcpClient; $a = $c.BeginConnect("127.0.0.1", $PuertoPublicidad, $null, $null); return ($a.AsyncWaitHandle.WaitOne(1500) -and $c.Connected) }
  catch { return $false } finally { if ($c) { try { $c.Close() } catch { Write-Verbose "cierre" } } }
}
$servidorPub = Levantar-Servidor
$ultimoIntentoServidor = Get-Date

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
$ultimoFijado = $null   # al menos 5 minutos entre reintentos de fijar los roles
$cierreDeliberado = $false   # la cajera cerro la ventana 1 a proposito: no se reabre sola (ver $ReabrirTrasCierreDeliberado)
$sinCajaVueltas = 0

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
  elseif ($AbrirClienteDesdeKit) { Anotar "Solo hay una pantalla: se abrio solo la caja (plan B)." }
}
$cajaVista = $false   # la caja ya se vio abierta alguna vez (para saber si la cerraron a proposito)
Abrir-Todo
while ($true) {
  Start-Sleep -Seconds $SegundosVigilar
  try {
    if (((Get-Date) - $ultimoIntentoServidor).TotalSeconds -ge 60) { $ultimoIntentoServidor = Get-Date; if (-not (Servidor-Vivo)) { Anotar "El servidor de publicidad no responde. Se levanta."; $servidorPub = Levantar-Servidor } }
    # El icono Facturador, con la vigilancia ya corriendo, deja este pedido.
    $bandera = "$Datos\abrir.flag"
    if (Test-Path -LiteralPath $bandera) {
      Remove-Item -LiteralPath $bandera -Force -ErrorAction SilentlyContinue
      Anotar "Se pidio abrir el facturador (icono Facturador)."
      $cierreDeliberado = $false; $sinCajaVueltas = 0
      Extender-Pantallas; Start-Sleep -Seconds 2; Abrir-Todo; continue
    }
    # Recordatorio de enlace pendiente (si ya quedo enlazada, se quita solo)
    if ((Hay-Pendiente) -and (((Get-Date) - $ultimoAviso).TotalMinutes -ge $MinutosAvisoPendiente)) {
      $ultimoAviso = Get-Date
      if ((Estado-Identidad).Estado -eq "ok") { Quitar-Pendiente } else { Mostrar-Aviso-Pendiente }
    }
    if ($HoraReinicioDiario -and ((Get-Date).Date -gt $ultimoReinicio) -and ((Get-Date).ToString("HH:mm") -ge $HoraReinicioDiario)) {
      $ultimoReinicio = (Get-Date).Date; Anotar "Reinicio diario del navegador."
      $cierreDeliberado = $false; $sinCajaVueltas = 0
      Extender-Pantallas; Start-Sleep -Seconds 2; Abrir-Todo; continue
    }
    if ($cierreDeliberado) { continue }   # la cajera cerro la caja: se espera el icono Facturador
    $procs = @(Procesos-Navegador $Perfil)   # una sola consulta por vuelta: es lo mas caro de la vigilancia
    $p = Elegir-Pantallas $CajaEnPantalla
    if ($FijarPantallas -and $p.Cuantas -ge 2 -and (-not $p.Caja.Primary) -and ((-not $ultimoFijado) -or (((Get-Date) - $ultimoFijado).TotalMinutes -ge 5))) { $ultimoFijado = Get-Date; Anotar "La caja ya no es la pantalla principal. Se vuelven a fijar los roles."; Extender-Pantallas; $p = Elegir-Pantallas $CajaEnPantalla }
    if ($p.Cuantas -ne $ultimasPantallas) {
      if ($ultimasPantallas -ne -1) { Anotar ("Cambio de pantallas: {0} -> {1}" -f $ultimasPantallas, $p.Cuantas); $script:IntentosF11.Clear() }
      if (($p.Cuantas -ge 2) -and ($ultimasPantallas -eq 1)) {
        # Plan B terminado: volvio la segunda pantalla. Se vuelve al modo de dos pantallas y se abre la ventana del cliente en unos segundos.
        Anotar "Volvio la segunda pantalla: se vuelve al modo de dos pantallas."
        Extender-Pantallas; $p = Elegir-Pantallas $CajaEnPantalla
        $sinClienteDesde = (Get-Date).AddSeconds(-($EsperaRespaldoSeg - 10))
      }
      if ($p.Cuantas -lt 2) { Anotar "Una sola pantalla: plan B, solo el facturador (sin ventana del cliente)." }
      $ultimasPantallas = $p.Cuantas
    }
    if ($procs.Count -eq 0) {
      if ($cajaVista -and -not $ReabrirCajaSiSeCierra) { Anotar "El navegador se cerro. El kit no lo reabre y termina (para volver: icono Facturador)."; break }
      Anotar "El navegador se cerro. Se reabre en 10 segundos."; Start-Sleep -Seconds 10; Extender-Pantallas; Start-Sleep -Seconds 2; Abrir-Todo; continue
    }
    $hs = @(Ventanas-Nuestras $Perfil $procs)
    $cajas = @(); $clientes = @()
    foreach ($h in $hs) {
      $t = [W32]::Titulo($h)
      if ([string]::IsNullOrWhiteSpace($t)) { continue }
      if (Es-Titulo-Cliente $t) { $clientes += $h } else { $cajas += $h }   # cualquier otra ventana nuestra es la caja, aunque este en Clientes, Anular o Administracion (el titulo cambia por modulo)
    }
    $hayCaja = ($cajas.Count -gt 0)
    if ($hayCaja) { $cajaVista = $true; $sinCajaVueltas = 0 }
    # UNA SOLA ventana 2: si hay mas de una, se cierran las sobrantes.
    if ($clientes.Count -gt 1) {
      Anotar ("Habia {0} ventanas del cliente: se cierran las sobrantes y queda una." -f $clientes.Count)
      foreach ($x in @($clientes | Select-Object -Skip 1)) { Cerrar-Ventana $x }
      $clientes = @($clientes[0])
    }
    $hayCliente = ($clientes.Count -gt 0)
    # CERRAR la ventana 1 CIERRA la 2 (dos vueltas seguidas sin ventana de caja, para no confundir una pagina que esta cargando).
    if ((-not $hayCaja) -and $cajaVista -and $hayCliente -and (-not $ReabrirTrasCierreDeliberado)) {
      $sinCajaVueltas++
      if ($sinCajaVueltas -ge 2) {
        Anotar "Se cerro la ventana de la caja: se cierra tambien la pantalla del cliente. Para volver: icono Facturador."
        foreach ($x in $clientes) { Cerrar-Ventana $x }
        $cierreDeliberado = $true; $sinCajaVueltas = 0
      }
      continue
    }
    $exe = Buscar-Navegador
    if ((-not $hayCaja) -and $exe) {
      if ($cajaVista -and -not $ReabrirCajaSiSeCierra) { Anotar "Se cerro la caja con la X. El kit no la reabre y termina (para volver: icono Facturador)."; break }
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
    } else {
      $sinClienteDesde = $null
      # Plan B (una sola pantalla): no debe haber ventana 2; si Windows paso una a la unica pantalla, se cierra para que no tape la caja.
      if ($hayCliente) { Anotar "Una sola pantalla: se cierra la ventana del cliente."; foreach ($x in $clientes) { Cerrar-Ventana $x } }
    }
    if ($hayCaja -or $hayCliente) { Afinar-Ventanas $p $Perfil $procs }
    # Cursor: si quedo sobre la pantalla del cliente, se lleva a su esquina
    if ($p.Cliente) {
      $pos = [System.Windows.Forms.Cursor]::Position; $b = $p.Cliente.Bounds
      if ($b.Contains($pos)) { [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(($b.Right - 1), ($b.Bottom - 1)) }
    }
  } catch { Anotar "Error: $($_.Exception.Message)" }
}
Anotar "El kit termino."
