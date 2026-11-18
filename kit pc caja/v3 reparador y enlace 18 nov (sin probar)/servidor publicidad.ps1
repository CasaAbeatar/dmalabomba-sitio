# Servidor de la publicidad de la pantalla del cliente. Entrega las fotos y videos de la carpeta Publicidad del Escritorio (con todas sus subcarpetas)
# SOLO a esta computadora (127.0.0.1) y SOLO a la pagina de La Bomba. No usa internet ni base de datos.
. "$PSScriptRoot\config.ps1"
$m = New-Object Threading.Mutex($false, "Global\ServidorPublicidadLB")
$tengo = $false
try { $tengo = $m.WaitOne(0) } catch [Threading.AbandonedMutexException] { $tengo = $true }
if (-not $tengo) { exit }   # ya hay un servidor corriendo
try { (Get-Process -Id $PID).PriorityClass = "BelowNormal" } catch { Write-Verbose "sin prioridad baja" }
$raiz = $CarpetaPublicidad
New-Item -ItemType Directory -Force -Path $raiz | Out-Null
$raizCompleta = [IO.Path]::GetFullPath($raiz).TrimEnd("\") + "\"
$MaxArchivos = 400
$log = "$Datos\registro.txt"
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
function Sin-Tildes($s) { return (($s.Normalize([Text.NormalizationForm]::FormD) -replace '\p{Mn}', '')).ToLower() }
# A que negocio pertenece una subcarpeta: si alguna parte de su ruta se llama soda, pollos o papea; si no, a los dos
function Negocio-De($rel) {
  foreach ($p in ($rel -split '/')) {
    $n = Sin-Tildes $p
    if ($n -eq "soda") { return "soda" }
    if ($n -eq "pollos" -or $n -eq "papea") { return "pollos" }
  }
  return "todas"
}
# Todos los archivos de imagen y video de la carpeta Publicidad y sus subcarpetas (hasta 4 niveles). "~" = archivos sueltos en la carpeta principal
function Archivos-De($negocio) {
  $sal = @()
  $todos = Get-ChildItem -LiteralPath $raiz -File -Recurse -Depth 4 -ErrorAction SilentlyContinue | Where-Object { $tipos.ContainsKey($_.Extension.ToLower()) }
  foreach ($f in $todos) {
    $dir = $f.DirectoryName.TrimEnd("\") + "\"
    if (-not $dir.StartsWith($raizCompleta, [StringComparison]::OrdinalIgnoreCase)) { continue }
    $rel = $dir.Substring($raizCompleta.Length).TrimEnd("\").Replace("\", "/")
    $neg = if ($rel -eq "") { "todas" } else { Negocio-De $rel }
    if ($neg -ne "todas" -and $neg -ne $negocio) { continue }
    $sal += [pscustomobject]@{ Carpeta = $(if ($rel -eq "") { "~" } else { $rel }); Archivo = $f }
  }
  return @($sal | Sort-Object { $_.Carpeta }, { $_.Archivo.Name } | Select-Object -First $MaxArchivos)
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
    if ($e -ne "soda" -and $e -ne "pollos") { $e = "todas" }
    $items = @()
    foreach ($x in (Archivos-De $e)) {
      $f = $x.Archivo
      $tipo = if ($tipos[$f.Extension.ToLower()] -like "video/*") { "video" } else { "imagen" }
      $items += ('{{"carpeta":{0},"nombre":{1},"tipo":"{2}","mod":{3},"tam":{4}}}' -f (Json-Texto $x.Carpeta), (Json-Texto $f.Name), $tipo, $f.LastWriteTimeUtc.Ticks, $f.Length)
    }
    Responder $flujo 200 "OK" "application/json; charset=utf-8" ([Text.Encoding]::UTF8.GetBytes('{"anuncios":[' + ($items -join ",") + ']}')) ""
    return
  }
  if ($camino -match '^/a/([^/]+)/([^/]+)$') {
    $c = [Uri]::UnescapeDataString($Matches[1]); $nombre = [Uri]::UnescapeDataString($Matches[2])
    if ($nombre -match '[\\/:*?"<>|]' -or $nombre.Contains("..")) { Texto $flujo 400 "Bad Request" "Nombre no valido"; return }
    if ($c -ne "~" -and ($c -match '[\\:*?"<>|]' -or ($c -split '/') -contains ".." -or ($c -split '/') -contains "")) { Texto $flujo 400 "Bad Request" "Carpeta no valida"; return }
    $dirRel = if ($c -eq "~") { "" } else { $c.Replace('/', '\') }
    $arch = [IO.Path]::GetFullPath((Join-Path (Join-Path $raiz $dirRel) $nombre))
    if (-not $arch.StartsWith($raizCompleta, [StringComparison]::OrdinalIgnoreCase)) { Texto $flujo 400 "Bad Request" "Ruta no valida"; return }
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
      # El tope por respuesta solo aplica si el navegador pidio un rango (videos) o si el archivo es muy grande; una imagen sin rango se envia completa con 200.
      if (($parcial -or $total -gt 32MB) -and (($fin - $ini + 1) -gt $MaxTrozo)) { $fin = $ini + $MaxTrozo - 1; $parcial = $true }
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
