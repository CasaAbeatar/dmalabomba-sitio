# Servidor de la publicidad de la pantalla del cliente. Entrega las fotos y videos de C:\PantallaCliente\publicidad
# SOLO a esta computadora (127.0.0.1) y SOLO a la pagina de La Bomba. No usa internet ni base de datos.
. "$PSScriptRoot\config.ps1"
$m = New-Object Threading.Mutex($false, "Global\ServidorPublicidadLB")
$tengo = $false
try { $tengo = $m.WaitOne(0) } catch [Threading.AbandonedMutexException] { $tengo = $true }
if (-not $tengo) { exit }   # ya hay un servidor corriendo
try { (Get-Process -Id $PID).PriorityClass = "BelowNormal" } catch { Write-Verbose "sin prioridad baja" }
$raiz = $CarpetaPublicidad
$carpetas = @("soda", "pollos", "todas")
foreach ($c in $carpetas) { New-Item -ItemType Directory -Force -Path (Join-Path $raiz $c) | Out-Null }
$log = "$Carpeta\registro.txt"
function Anotar($t) { Add-Content -Path $log -Value ("{0:yyyy-MM-dd HH:mm:ss}  [publicidad] {1}" -f (Get-Date), $t) }
$tipos = @{ ".jpg" = "image/jpeg"; ".jpeg" = "image/jpeg"; ".png" = "image/png"; ".webp" = "image/webp"; ".gif" = "image/gif"; ".mp4" = "video/mp4"; ".webm" = "video/webm" }
$MaxTrozo = 4MB   # cada respuesta de un video es de hasta 4 MB (el navegador pide el resto); asi una peticion nunca deja esperando a otra
function Json-Texto($t) { return '"' + ($t -replace '\\', '\\' -replace '"', '\"') + '"' }
function Responder($flujo, [int]$codigo, $estado, $tipo, [byte[]]$cuerpo, $extra) {
  $h = "HTTP/1.1 $codigo $estado`r`nContent-Type: $tipo`r`nContent-Length: $($cuerpo.Length)`r`nConnection: close`r`n" +
       "Access-Control-Allow-Origin: $Sitio`r`nVary: Origin`r`nAccess-Control-Allow-Private-Network: true`r`nAccess-Control-Allow-Methods: GET, OPTIONS`r`nAccess-Control-Allow-Headers: Range`r`nAccess-Control-Expose-Headers: Content-Range, Content-Length, Accept-Ranges`r`n" +
       "X-Content-Type-Options: nosniff`r`nCache-Control: no-cache`r`n$extra`r`n"
  $b = [Text.Encoding]::ASCII.GetBytes($h)
  $flujo.Write($b, 0, $b.Length)
  if ($cuerpo.Length -gt 0) { $flujo.Write($cuerpo, 0, $cuerpo.Length) }
}
function Texto($flujo, [int]$codigo, $estado, $texto) { Responder $flujo $codigo $estado "text/plain; charset=utf-8" ([Text.Encoding]::UTF8.GetBytes($texto)) "" }
function Archivos-De($carpeta) {
  $dir = Join-Path $raiz $carpeta
  if (-not (Test-Path $dir)) { return @() }
  Get-ChildItem -Path $dir -File -ErrorAction SilentlyContinue | Where-Object { $tipos.ContainsKey($_.Extension.ToLower()) } | Sort-Object Name
}
function Atender($cliente) {
  $flujo = $cliente.GetStream()
  $cliente.ReceiveTimeout = 5000; $cliente.SendTimeout = 15000
  # Leer la cabecera de la peticion (hasta 8 KB)
  $buf = New-Object byte[] 8192; $n = 0
  while ($n -lt 8192) {
    $r = $flujo.Read($buf, $n, 8192 - $n)
    if ($r -le 0) { break }
    $n += $r
    if ([Text.Encoding]::ASCII.GetString($buf, 0, $n).Contains("`r`n`r`n")) { break }
  }
  $texto = [Text.Encoding]::ASCII.GetString($buf, 0, $n)
  $lineas = $texto -split "`r`n"
  if (-not ($lineas[0] -match '^(GET|OPTIONS) (\S+) HTTP/1\.[01]$')) { Texto $flujo 400 "Bad Request" "Peticion no valida"; return }
  $metodo = $Matches[1]; $ruta = $Matches[2]
  $cab = @{}
  foreach ($l in $lineas | Select-Object -Skip 1) { $i = $l.IndexOf(":"); if ($i -gt 0) { $cab[$l.Substring(0, $i).Trim().ToLower()] = $l.Substring($i + 1).Trim() } }
  # Seguridad: solo se acepta el nombre local (contra ataques de rebinding de DNS) y solo el origen de La Bomba
  $host_ = $cab["host"]
  if ($host_ -ne "127.0.0.1:$PuertoPublicidad" -and $host_ -ne "localhost:$PuertoPublicidad") { Texto $flujo 403 "Forbidden" "Host no permitido"; return }
  if ($cab.ContainsKey("origin") -and $cab["origin"] -ne $Sitio) { Texto $flujo 403 "Forbidden" "Origen no permitido"; return }
  if ($metodo -eq "OPTIONS") { Responder $flujo 204 "No Content" "text/plain" ([byte[]]@()) ""; return }
  $partes = $ruta.Split("?", 2); $camino = $partes[0]; $consulta = if ($partes.Count -gt 1) { $partes[1] } else { "" }
  if ($camino -eq "/salud") { Texto $flujo 200 "OK" "ok"; return }
  if ($camino -eq "/lista") {
    $e = ""; if ($consulta -match '(?:^|&)e=([a-z]+)') { $e = $Matches[1] }
    $quiero = @("todas"); if ($e -eq "soda" -or $e -eq "pollos") { $quiero = @($e, "todas") }
    $items = @()
    foreach ($c in $quiero) {
      foreach ($f in (Archivos-De $c)) {
        $tipo = if ($tipos[$f.Extension.ToLower()] -like "video/*") { "video" } else { "imagen" }
        $items += ('{{"carpeta":{0},"nombre":{1},"tipo":"{2}","mod":{3},"tam":{4}}}' -f (Json-Texto $c), (Json-Texto $f.Name), $tipo, $f.LastWriteTimeUtc.Ticks, $f.Length)
      }
    }
    Responder $flujo 200 "OK" "application/json; charset=utf-8" ([Text.Encoding]::UTF8.GetBytes('{"anuncios":[' + ($items -join ",") + ']}')) ""
    return
  }
  if ($camino -match '^/a/([a-z]+)/([^/]+)$') {
    $c = $Matches[1]; $nombre = [Uri]::UnescapeDataString($Matches[2])
    if ($carpetas -notcontains $c) { Texto $flujo 404 "Not Found" "No existe"; return }
    if ($nombre -match '[\\/:*?"<>|]' -or $nombre.Contains("..")) { Texto $flujo 400 "Bad Request" "Nombre no valido"; return }
    $arch = Join-Path (Join-Path $raiz $c) $nombre
    $ext = [IO.Path]::GetExtension($arch).ToLower()
    if (-not $tipos.ContainsKey($ext) -or -not (Test-Path -LiteralPath $arch -PathType Leaf)) { Texto $flujo 404 "Not Found" "No existe"; return }
    $tipoMime = $tipos[$ext]
    $fs = [IO.File]::Open($arch, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
    try {
      $total = $fs.Length; $ini = 0; $fin = $total - 1; $parcial = $false
      if ($cab.ContainsKey("range") -and $cab["range"] -match '^bytes=(\d*)-(\d*)$') {
        if ($Matches[1] -ne "") { $ini = [long]$Matches[1]; if ($Matches[2] -ne "") { $fin = [long]$Matches[2] } }
        elseif ($Matches[2] -ne "") { $ini = [Math]::Max(0, $total - [long]$Matches[2]) }
        $parcial = $true
      }
      if ($ini -ge $total -or $fin -lt $ini) { Responder $flujo 416 "Range Not Satisfiable" "text/plain" ([byte[]]@()) "Content-Range: bytes */$total`r`n"; return }
      if ($fin -ge $total) { $fin = $total - 1 }
      if (($fin - $ini + 1) -gt $MaxTrozo) { $fin = $ini + $MaxTrozo - 1; $parcial = $true }
      $largo = [int]($fin - $ini + 1)
      $datos = New-Object byte[] $largo
      [void]$fs.Seek($ini, [IO.SeekOrigin]::Begin)
      $leido = 0
      while ($leido -lt $largo) { $r = $fs.Read($datos, $leido, $largo - $leido); if ($r -le 0) { break }; $leido += $r }
      if ($parcial) { Responder $flujo 206 "Partial Content" $tipoMime $datos "Accept-Ranges: bytes`r`nContent-Range: bytes $ini-$fin/$total`r`n" }
      else { Responder $flujo 200 "OK" $tipoMime $datos "Accept-Ranges: bytes`r`n" }
    } finally { $fs.Dispose() }
    return
  }
  Texto $flujo 404 "Not Found" "No existe"
}
try {
  $escucha = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $PuertoPublicidad)   # solo esta computadora: nunca la red
  $escucha.Start()
  Anotar "Servidor de publicidad escuchando en 127.0.0.1:$PuertoPublicidad (carpeta $raiz)."
} catch { Anotar "No se pudo abrir el puerto ${PuertoPublicidad}: $($_.Exception.Message)"; exit }
while ($true) {
  try {
    $cl = $escucha.AcceptTcpClient()
    try { Atender $cl } catch { Anotar "Peticion con error: $($_.Exception.Message)" } finally { $cl.Close() }
  } catch { Anotar "Error: $($_.Exception.Message)"; Start-Sleep -Seconds 1 }
}
