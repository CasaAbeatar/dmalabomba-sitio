# Avisa al panel cada minuto que esta computadora esta viva y como esta (pantallas, ventanas, internet, tiempo de respuesta).
# Corre aparte de la vigilancia de la caja: sigue avisando aunque la caja este cerrada. Si no hay internet, guarda los eventos y los manda al volver.
function Arranque($t) { foreach ($d in @("C:\PantallaCliente\datos", $env:TEMP)) { try { Add-Content -LiteralPath "$d\arranque.txt" -Value ("{0:yyyy-MM-dd HH:mm:ss}  [latido pid {1}] {2}" -f (Get-Date), $PID, $t) -ErrorAction Stop; return } catch { $null = 1 } } }
trap { Arranque ("ERROR " + $_.Exception.GetType().Name + ": " + $_.Exception.Message + " (linea " + $_.InvocationInfo.ScriptLineNumber + ")"); break }
$esAdminArr = $false; try { $esAdminArr = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) } catch { $null = 1 }
Arranque ("inicio. usuario " + $env:USERNAME + ", con privilegios de administrador: " + $esAdminArr)
. "$PSScriptRoot\config.ps1"
. "$PSScriptRoot\funciones.ps1"
if (Test-Path -LiteralPath "$PSScriptRoot\17 ficha del equipo.ps1") { . "$PSScriptRoot\17 ficha del equipo.ps1" }
$c = Crear-Mutex "Local\LatidoLB"; $m = $c.Mutex; $tengo = $c.Tengo
Arranque ("candado LatidoLB: " + $(if ($tengo) { "obtenido" } else { "NO obtenido" }) + ". " + $c.Motivo)
if (-not $tengo) { exit }
try { (Get-Process -Id $PID).PriorityClass = "BelowNormal" } catch { Write-Verbose "sin prioridad baja" }
New-Item -ItemType Directory -Force -Path $Datos | Out-Null
$log = "$Datos\latido.txt"
function Anotar($t) {
  try {
    if ((Test-Path $log) -and ((Get-Item $log).Length -gt 300KB)) { Move-Item $log "$log.old" -Force }
    Add-Content -Path $log -Value ("{0:yyyy-MM-dd HH:mm:ss}  {1}" -f (Get-Date), $t)
  } catch { Write-Verbose "no se pudo escribir el registro" }
}
Anotar ("Latido iniciado. Kit {0}" -f $VersionKit)

$ultPantallas = -1
$huboCaja = $false
$cajaCerradaDesde = $null
$cajaCerradaAvisada = $false
$nuncaAbrioAvisado = $false
$sinConexionDesde = $null
$huboEnvioOk = $false
$erroresHttp = 0
$avisoIdentidad = $null
$script:UltimaLatencia = $null
$pantallasBajas = 0
$telemetria = $null; $telemetriaHora = [DateTime]::MinValue
$fichaHora = [DateTime]::MinValue; $inicioLatido = Get-Date   # v3.3: ficha completa al arrancar (a los 2 minutos, sin frenar el encendido) y cada 6 horas
while ($true) {
  try {
    $id = Leer-Identidad
    if (-not $id) {
      if (-not $avisoIdentidad -or ((Get-Date) - $avisoIdentidad).TotalMinutes -ge 30) { Anotar "Esta computadora todavia no esta enlazada (falta ENLAZAR EQUIPO.bat o el icono Reparar). No se envia latido."; $avisoIdentidad = Get-Date }
      Start-Sleep -Seconds 60; continue
    }
    # --- Estado de la PC ---
    $pantallas = [System.Windows.Forms.Screen]::AllScreens.Count
    $procs = @(Procesos-Navegador $Perfil)
    $ventanas = 0; $hayCaja = $false; $ventanasCliente = 0
    foreach ($h in @(Ventanas-Nuestras $Perfil $procs)) {
      $t = [W32]::Titulo($h)
      if ([string]::IsNullOrWhiteSpace($t)) { continue }
      $ventanas++
      if (Es-Titulo-Cliente $t) { $ventanasCliente++ } else { $hayCaja = $true }
    }
    $kitCorre = [bool](Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -like "*0 abrir caja y pantalla.ps1*" } | Select-Object -First 1)
    $arranque = [int]((Get-Date) - (Get-CimInstance Win32_OperatingSystem).LastBootUpTime).TotalMinutes
    # Hora de Costa Rica (no la del reloj de la PC, por si la zona horaria quedo mal)
    try { $hora = ([TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTime]::UtcNow, "Central America Standard Time")).Hour } catch { $hora = (Get-Date).Hour }
    $dentro = ($hora -ge $CajaCerradaAvisaDesde -and $hora -lt $CajaCerradaAvisaHasta)
    # --- Eventos por cambio de estado ---
    # Pantalla perdida: debe verse baja en 2 revisiones seguidas (evita falsos avisos por un parpadeo de Windows).
    if ($ultPantallas -ge 2 -and $pantallas -lt 2) { $pantallasBajas++ } else { $pantallasBajas = 0 }
    if ($pantallasBajas -eq 2) { Registrar-Evento "pantalla_perdida" ("Se detectan {0} pantalla(s); antes {1}. Si se desconecto la tactil a proposito, es el plan B (una sola pantalla)" -f $pantallas, $ultPantallas) }
    if ($pantallasBajas -eq 0 -or $pantallasBajas -ge 2) { if ($pantallasBajas -eq 0) { $ultPantallas = $pantallas } }
    # Mantenimiento: si Salir.bat dejo su marca hace menos de 4 horas, el cierre de la caja es intencional y no se avisa.
    $enMantenimiento = $false
    try { $mt = "$Datos\mantenimiento.txt"; if ((Test-Path $mt) -and (((Get-Date) - (Get-Item $mt).LastWriteTime).TotalHours -lt 4)) { $enMantenimiento = $true } } catch { Write-Verbose "sin marca" }
    if (-not $dentro -or $enMantenimiento) { $huboCaja = $false; $cajaCerradaDesde = $null; $cajaCerradaAvisada = $false; $nuncaAbrioAvisado = $false }   # fuera del horario no se avisa de nada
    elseif ($hayCaja) { $huboCaja = $true; $cajaCerradaDesde = $null; $cajaCerradaAvisada = $false; $nuncaAbrioAvisado = $true }
    elseif ($huboCaja) {
      if (-not $cajaCerradaDesde) { $cajaCerradaDesde = Get-Date }
      if (-not $cajaCerradaAvisada -and ((Get-Date) - $cajaCerradaDesde).TotalMinutes -ge $CajaCerradaMinutos) {
        Registrar-Evento "caja_cerrada" ("La ventana de la caja lleva {0} minutos cerrada" -f [int]((Get-Date) - $cajaCerradaDesde).TotalMinutes)
        $cajaCerradaAvisada = $true
      }
    }
    elseif (-not $nuncaAbrioAvisado -and $arranque -ge 10) {
      Registrar-Evento "caja_cerrada" ("La caja no se ha abierto desde que se encendio la PC (hace {0} minutos)" -f $arranque)
      $nuncaAbrioAvisado = $true
    }
    # --- Envio ---
    $cola = Leer-Eventos 5
    $eventos = @($cola.Eventos)
    if (((Get-Date) - $telemetriaHora).TotalMinutes -ge 30) { try { $telemetria = Telemetria-Lenta } catch { $telemetria = $null }; $telemetriaHora = Get-Date }
    $detalle = [ordered]@{ pc = $env:COMPUTERNAME; caja_abierta = $hayCaja; ventanas_cliente = $ventanasCliente; modo_pantallas = $(if ($pantallas -ge 2) { "dos" } else { "una (plan B)" }); vigilancia_kit_corre = $kitCorre; arranque_hace_min = $arranque }
    if ($telemetria) { foreach ($k in $telemetria.Keys) { $detalle[$k] = $telemetria[$k] } }
    $paquete = [ordered]@{
      version_kit = $VersionKit; pantallas = $pantallas; ventanas = $ventanas; internet_ok = (Probar-Internet)
      detalle = $detalle
      eventos = $eventos
    }
    if ($null -ne $script:UltimaLatencia) { $paquete["latencia_ms"] = $script:UltimaLatencia }
    $reloj = [Diagnostics.Stopwatch]::StartNew()
    try {
      $r = Llamar-Rpc "equipo_latido" ([ordered]@{ p_estacion = $id.estacion; p_token = $id.token; p_datos = $paquete }) 20
      $reloj.Stop()
      $erroresHttp = 0
      if ($r.ok) {
        $huboEnvioOk = $true
        if (-not $r.omitido) { Quitar-Eventos $cola.Lineas }
        if ($sinConexionDesde) {
          $min = [int]((Get-Date) - $sinConexionDesde).TotalMinutes
          Anotar ("Conexion recuperada tras {0} min (desde {1:HH:mm})." -f $min, $sinConexionDesde)
          if ($min -ge 2) { Registrar-Evento "caida_internet" ("Sin conexion con la base durante unos {0} minutos, desde las {1:HH:mm}" -f $min, $sinConexionDesde) }
          $sinConexionDesde = $null
        }
      } elseif ("$($r.motivo)" -match "grande") { Quitar-Eventos 1; Anotar "El paquete era demasiado grande para la base: se descarto un evento." }
      else { Anotar "La base no reconoce esta computadora (clave o estacion). Hay que enlazarla de nuevo con ENLAZAR EQUIPO.bat o el icono Reparar." }
      Anotar ("Latido {0}: pantallas={1} ventanas={2} kit={3} {4} ms{5}" -f $id.estacion, $pantallas, $ventanas, $kitCorre, $reloj.ElapsedMilliseconds, $(if ($r.omitido) { " (omitido)" } else { "" }))
      $script:UltimaLatencia = [int]$reloj.ElapsedMilliseconds
    } catch {
      $ex = $_.Exception
      $sinRed = ($ex -is [Net.WebException]) -and ($ex.Status -ne [Net.WebExceptionStatus]::ProtocolError)
      if ($sinRed) {
        if ($huboEnvioOk -and -not $sinConexionDesde) { $sinConexionDesde = Get-Date }   # una caida solo cuenta si antes hubo conexion (no al encender la PC)
      } else {
        # La base respondio con un error HTTP: no es falta de internet. Si es 400 (dato mal formado) varias veces, se descarta el primer evento para que la cola no se trabe.
        $codigo = 0; try { $codigo = [int]$ex.Response.StatusCode } catch { Write-Verbose "sin codigo" }
        if ($codigo -eq 400) { $erroresHttp++ } else { $erroresHttp = 0 }
        if ($erroresHttp -ge 3 -and $eventos.Count -gt 0) {
          # Se prueba UNA vez sin eventos: si asi pasa, el culpable era un evento y se descarta; si no, se conserva la cola.
          try {
            $datos2 = [ordered]@{ version_kit = $VersionKit; pantallas = $pantallas; ventanas = $ventanas; internet_ok = $true; eventos = @() }
            $r2 = Llamar-Rpc "equipo_latido" ([ordered]@{ p_estacion = $id.estacion; p_token = $id.token; p_datos = $datos2 }) 20
            if ($r2.ok) { Quitar-Eventos 1; $erroresHttp = 0; Anotar "Se descarto un evento que la base rechazaba." }
          } catch { Write-Verbose "tampoco sin eventos" }
        }
      }
      Anotar ("No se pudo enviar{0}: {1}" -f $(if ($sinRed) { " (sin red)" } else { " (error de la base)" }), $ex.Message)
    }
    # --- Ficha completa del equipo (v3.3) ---
    if ((Get-Command Ficha-Equipo -ErrorAction SilentlyContinue) -and (((Get-Date) - $inicioLatido).TotalMinutes -ge 2) -and (((Get-Date) - $fichaHora).TotalHours -ge 6)) {
      $fichaHora = (Get-Date).AddMinutes(-345)   # si falla, se reintenta en 15 minutos
      try {
        $ficha = Ficha-Equipo
        $rf = Llamar-Rpc "equipo_ficha" ([ordered]@{ p_estacion = $id.estacion; p_token = $id.token; p_ficha = $ficha }) 40
        if ($rf.ok) { $fichaHora = Get-Date; Anotar ("Ficha del equipo enviada{0}." -f $(if ($rf.cambio) { " (hubo cambios)" } else { "" })) }
        else { Anotar ("La base no acepto la ficha: {0}" -f $rf.motivo) }
      } catch { Anotar ("No se pudo enviar la ficha: {0}" -f $_.Exception.Message) }
    }
  } catch { Anotar "Error: $($_.Exception.Message)" }
  Start-Sleep -Seconds $SegundosLatido
}
