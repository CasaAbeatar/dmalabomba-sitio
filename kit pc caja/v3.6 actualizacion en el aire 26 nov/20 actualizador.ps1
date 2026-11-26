# ACTUALIZADOR EN EL AIRE (OTA) del kit de caja.
# Lo corre una tarea programada de Windows como SYSTEM, cada 30 minutos entre las 03:00 y las 05:00 (hora de Costa Rica). Fuera de esa ventana termina enseguida.
# Que hace: baja un manifiesto FIRMADO, comprueba la firma (RSA 3072, SHA-256) con la llave publica que ya trae esta PC, baja el paquete, comprueba su huella,
# lo prepara en una carpeta que la cuenta de la caja NO puede tocar, lo cambia archivo por archivo con diario y respaldo, vuelve a abrir latido y facturador
# y comprueba que funcionan. Si algo falla (o si se corta la luz a la mitad) vuelve solo a la version anterior y avisa al panel.
# Es AUTOSUFICIENTE: no usa config.ps1 ni funciones.ps1 (si una version mala los daña, este sigue pudiendo revertir).
# Los parametros -Prueba/-Manifiesto/-LlavePublica/-Raiz son SOLO para las pruebas automaticas; la tarea programada no los pasa.
param(
  [switch]$Ahora,                 # ignora la ventana horaria (mantenimiento manual de un administrador o pruebas)
  [switch]$SoloComprobar,         # baja y verifica, pero no instala
  [string]$Raiz = "C:\PantallaCliente",
  [switch]$Prueba,                # modo de pruebas automaticas
  [string]$Manifiesto = "",       # SOLO con -Prueba: ruta local del manifiesto (y de la firma: <ruta>.firma)
  [string]$LlavePublica = "",     # SOLO con -Prueba: llave publica de prueba (XML)
  [string]$Estacion = "",         # SOLO con -Prueba
  [int]$EsperaSaludSeg = 180,
  [string]$AhoraUtc = ""          # SOLO con -Prueba: fecha/hora simulada (ISO, UTC)
)
$ErrorActionPreference = "Stop"

# ---------------- Ajustes (se cambian actualizando este mismo archivo) ----------------
$VersionActualizador = 1
$UrlManifiesto   = "https://www.dmalabomba.com/kit-caja/ota/manifiesto.json"
$HostsPermitidos = @("www.dmalabomba.com", "dmalabomba.com")
$RutaPermitida   = "/kit-caja/ota/"
$VentanaDesde    = 3          # hora de Costa Rica (UTC-6, sin horario de verano)
$VentanaHasta    = 5
$MaxBytesPaquete = 25MB
$MaxIntentosPorSerie = 3
$HorasEntreIntentos  = @(1, 6, 24)
$TareaRelanzar   = "La Bomba Kit - Relanzar"
$TareaPath       = "\La Bomba\"

$Datos = Join-Path $Raiz "datos"
$Ota   = Join-Path $Raiz "ota"
$script:Fuera = $false

function Ahora-Utc {
  if ($Prueba -and $AhoraUtc) { return [DateTime]::Parse($AhoraUtc, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AdjustToUniversal -bor [Globalization.DateTimeStyles]::AssumeUniversal) }
  return [DateTime]::UtcNow
}
function Hora-CR { return (Ahora-Utc).AddHours(-6) }
function Iso($d) { return $d.ToString("yyyy-MM-ddTHH:mm:ssZ") }
function Leer-Texto($ruta) { return [IO.File]::ReadAllText($ruta, [Text.Encoding]::UTF8).TrimStart([char]0xFEFF) }
function Escribir-Atomico($ruta, $texto) {
  $tmp = $ruta + ".tmp"
  [IO.File]::WriteAllText($tmp, $texto, (New-Object Text.UTF8Encoding($false)))
  if (Test-Path -LiteralPath $ruta) { Move-Item -LiteralPath $tmp -Destination $ruta -Force } else { Move-Item -LiteralPath $tmp -Destination $ruta }
}
function Log($t) {
  try {
    $f = Join-Path $Ota "actualizador.log"
    if ((Test-Path -LiteralPath $f) -and ((Get-Item -LiteralPath $f).Length -gt 200KB)) { Move-Item -LiteralPath $f -Destination "$f.old" -Force }
    Add-Content -LiteralPath $f -Value ("{0:yyyy-MM-dd HH:mm:ss}  {1}" -f (Get-Date), $t) -Encoding UTF8
  } catch { $null = 1 }
  if ($Prueba) { Write-Host $t }
}
function Evento($tipo, $detalle) {
  # Cola de eventos del latido (el latido los manda al panel; los que no son "info" abren un aviso). No necesita red desde SYSTEM.
  try {
    $f = Join-Path $Datos "eventos pendientes.jsonl"
    if ((Test-Path -LiteralPath $f) -and ((Get-Item -LiteralPath $f).Length -gt 200KB)) { @(Get-Content -LiteralPath $f -Encoding UTF8 -Tail 100) | Set-Content -LiteralPath $f -Encoding UTF8 }
    $l = [ordered]@{ id = [guid]::NewGuid().ToString(); tipo = "$tipo"; detalle = "$detalle"; hora = (Get-Date).ToString("s") } | ConvertTo-Json -Compress
    Add-Content -LiteralPath $f -Value $l -Encoding UTF8
  } catch { Log ("no se pudo anotar el evento: " + $_.Exception.Message) }
}

# ---------------- Carpeta segura (solo SYSTEM y administradores) ----------------
function Preparar-Ota {
  if (-not (Test-Path -LiteralPath $Ota)) { New-Item -ItemType Directory -Force -Path $Ota | Out-Null }
  $marca = Join-Path $Ota ".acl-v1"
  if (-not (Test-Path -LiteralPath $marca)) {
    # Sin heredar: la cuenta de la caja (grupo Usuarios) no puede ni leer ni escribir aqui; asi nadie puede cambiar un paquete ya verificado.
    & icacls.exe $Ota /inheritance:r /grant "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" 2>&1 | Out-Null
    Set-Content -LiteralPath $marca -Value "acl aplicada" -Encoding ASCII
  }
}

# ---------------- Estado ----------------
function Leer-Estado {
  $f = Join-Path $Ota "estado.json"
  $e = [ordered]@{ ultimo_resultado = ""; ultimo_mensaje = ""; ultima_hora = ""; ultima_comprobacion = ""; disponible = ""; fallidas = @() }
  if (Test-Path -LiteralPath $f) {
    try {
      $o = (Leer-Texto $f) | ConvertFrom-Json
      foreach ($k in @("ultimo_resultado", "ultimo_mensaje", "ultima_hora", "ultima_comprobacion", "disponible")) { if ($null -ne $o.$k) { $e[$k] = [string]$o.$k } }
      if ($o.fallidas) { $e["fallidas"] = @($o.fallidas | ForEach-Object { [pscustomobject]@{ serie = [int]$_.serie; intentos = [int]$_.intentos; hasta = [string]$_.hasta; motivo = [string]$_.motivo } }) }
    } catch { Log ("estado.json ilegible, se parte de cero: " + $_.Exception.Message) }
  }
  return $e
}
function Guardar-Estado($e, $resultado, $mensaje) {
  if ($resultado) { $e["ultimo_resultado"] = $resultado; $e["ultimo_mensaje"] = $mensaje; $e["ultima_hora"] = Iso (Ahora-Utc) }
  $act = Version-Actual
  $e["version"] = $act.version; $e["serie"] = $act.serie; $e["actualizador"] = $VersionActualizador
  try { Escribir-Atomico (Join-Path $Ota "estado.json") (($e | ConvertTo-Json -Depth 5)) } catch { Log ("no se pudo guardar el estado: " + $_.Exception.Message) }
  # Copia corta para el latido (la cuenta de la caja la lee y la manda al panel)
  try {
    $m = $mensaje; if ($m -and $m.Length -gt 160) { $m = $m.Substring(0, 160) }
    $c = [ordered]@{ v = $act.version; s = $act.serie; r = $e["ultimo_resultado"]; h = $e["ultima_hora"]; m = $(if ($resultado) { $m } else { $e["ultimo_mensaje"] }); d = $e["disponible"] }
    Escribir-Atomico (Join-Path $Datos "ota estado.json") (($c | ConvertTo-Json -Compress))
  } catch { Log ("no se pudo copiar el estado para el latido: " + $_.Exception.Message) }
}

# ---------------- Version instalada ----------------
function Version-Actual {
  $v = "?"; $s = 0
  try { $m = [regex]::Match((Leer-Texto (Join-Path $Raiz "config.ps1")), '\$VersionKit\s*=\s*"([^"]+)"'); if ($m.Success) { $v = $m.Groups[1].Value } } catch { $null = 1 }
  try { $m = [regex]::Match((Leer-Texto (Join-Path $Raiz "ota serie.ps1")), '\$OtaSerie\s*=\s*(\d+)'); if ($m.Success) { $s = [int]$m.Groups[1].Value } } catch { $null = 1 }
  return [pscustomobject]@{ version = $v; serie = $s }
}
function Llave-Instalada {
  if ($Prueba -and $LlavePublica) { return (Leer-Texto $LlavePublica) }
  $t = Leer-Texto (Join-Path $Raiz "ota llave publica.ps1")
  $m = [regex]::Match($t, '<RSAKeyValue>.*?</RSAKeyValue>')
  if (-not $m.Success) { throw "La llave publica de esta PC no se pudo leer" }
  return $m.Value
}
function Estacion-Actual {
  if ($Prueba -and $Estacion) { return $Estacion }
  foreach ($f in @((Join-Path $Datos "equipo.json"), (Join-Path $Datos "equipo.json.bak"))) {
    if (-not (Test-Path -LiteralPath $f)) { continue }
    try { $o = (Leer-Texto $f) | ConvertFrom-Json; if ($o.estacion -and $o.token -and ($o.pc -eq $env:COMPUTERNAME)) { return [string]$o.estacion } } catch { $null = 1 }
  }
  return ""
}

# ---------------- Criptografia y descarga ----------------
function Huella([string]$ruta) {
  $h = [Security.Cryptography.SHA256]::Create()
  $fs = [IO.File]::OpenRead($ruta)
  try { return ([BitConverter]::ToString($h.ComputeHash($fs)) -replace "-", "").ToLower() } finally { $fs.Dispose(); $h.Dispose() }
}
function Firma-Valida([byte[]]$datos, [byte[]]$firma, [string]$xml) {
  $rsa = New-Object System.Security.Cryptography.RSACryptoServiceProvider
  try { $rsa.FromXmlString($xml); return [bool]$rsa.VerifyData($datos, "SHA256", $firma) } finally { $rsa.Dispose() }
}
function Url-Permitida([string]$url) {
  try { $u = New-Object Uri($url) } catch { return $false }
  return (($u.Scheme -eq "https") -and ($HostsPermitidos -contains $u.Host) -and $u.AbsolutePath.StartsWith($RutaPermitida) -and ($u.Port -eq 443) -and (-not $u.UserInfo))
}
function Bajar([string]$url, [string]$destino, [long]$maxBytes, [string]$baseLocal) {
  if (Test-Path -LiteralPath $destino) { Remove-Item -LiteralPath $destino -Force }
  if ($Prueba -and $Manifiesto) {
    # Modo de pruebas: el "servidor" es una carpeta local
    $orig = $url; if ($url -notmatch '^[A-Za-z]:\\|^/') { $orig = Join-Path $baseLocal $url }
    Copy-Item -LiteralPath $orig -Destination $destino -Force
  } else {
    if (-not (Url-Permitida $url)) { throw ("Direccion no permitida: " + $url) }
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $q = $url; if ($q -match '\.json$|\.firma$') { $q = $url + "?t=" + [DateTime]::UtcNow.Ticks }
    Invoke-WebRequest -Uri $q -OutFile $destino -UseBasicParsing -TimeoutSec 120 -MaximumRedirection 0 -Headers @{ "Cache-Control" = "no-cache" } | Out-Null
  }
  if ((Get-Item -LiteralPath $destino).Length -gt $maxBytes) { Remove-Item -LiteralPath $destino -Force; throw "El archivo bajado es mas grande de lo permitido" }
}

# ---------------- Procesos y sesion ----------------
function Detener-Kit {
  $n = 0
  foreach ($p in @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'")) {
    if ($p.ProcessId -eq $PID) { continue }
    $c = [string]$p.CommandLine
    if ($c -match '20 actualizador') { continue }
    if ($c -match '0 abrir caja y pantalla|servidor publicidad|11 latido|15 aviso pendiente|18 enviar ficha|19 navegacion|21 relanzar') { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue; $n++ }
  }
  return $n
}
function Hay-Sesion { return (@(Get-Process -Name explorer -ErrorAction SilentlyContinue).Count -gt 0) }
function Relanzar {
  if ($Prueba) {
    $s = Join-Path $Raiz "21 relanzar.ps1"
    if (Test-Path -LiteralPath $s) { Start-Process -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -ArgumentList "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$s`"" -WindowStyle Hidden }
    return "directo (pruebas)"
  }
  if (-not (Hay-Sesion)) { return "sin sesion abierta: el kit arrancara al iniciar sesion" }
  try { Start-ScheduledTask -TaskName $TareaRelanzar -TaskPath $TareaPath -ErrorAction Stop; return "tarea de relanzar iniciada" }
  catch { return ("no se pudo iniciar la tarea de relanzar: " + $_.Exception.Message) }
}
function Procesos-Vivos {
  $lat = $false; $sup = $false
  foreach ($p in @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue)) {
    $c = [string]$p.CommandLine
    if ($c -match '11 latido') { $lat = $true }
    if ($c -match '0 abrir caja y pantalla') { $sup = $true }
  }
  return [pscustomobject]@{ latido = $lat; supervisor = $sup }
}
function Comprobar-Salud($version, [DateTime]$desde, [int]$esperaSeg) {
  # "ok" si el latido nuevo escribio su arranque con la version nueva y (en produccion) latido y supervisor estan vivos; "indeterminado" si no hay sesion; "mal" si no.
  $fin = (Get-Date).AddSeconds($esperaSeg)
  while ($true) {
    $lineaOk = $false
    $f = Join-Path $Datos "latido.txt"
    if (Test-Path -LiteralPath $f) {
      try { foreach ($l in @(Get-Content -LiteralPath $f -Tail 40 -ErrorAction Stop)) { if ($l -like ("*Latido iniciado. Kit " + $version + "*")) { $lineaOk = $true } } } catch { $null = 1 }
      if ($lineaOk -and ((Get-Item -LiteralPath $f).LastWriteTime -lt $desde)) { $lineaOk = $false }
    }
    $pv = Procesos-Vivos
    if ($lineaOk -and $pv.latido -and ($pv.supervisor -or $Prueba)) { return "ok" }
    if ((Get-Date) -ge $fin) { break }
    Start-Sleep -Seconds 5
  }
  if ((-not $Prueba) -and (-not (Hay-Sesion))) { return "indeterminado" }
  return "mal"
}

# ---------------- Aplicar y revertir ----------------
function Archivos-Del-Kit {
  return @(Get-ChildItem -LiteralPath $Raiz -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -in ".ps1", ".bat", ".txt" -and $_.Name -notlike "*.ota-nuevo" } | Select-Object -ExpandProperty Name)
}
function Reparar-Permisos($ruta) { & icacls.exe $ruta /reset /C 2>&1 | Out-Null }
function Copiar-Con-Permisos-Heredados($origen, $destino) {
  # Se copia a un nombre temporal DENTRO de la carpeta del kit (hereda sus permisos: Usuarios solo leen) y luego se cambia el nombre. Mover desde la carpeta segura dejaria al archivo sin acceso para la cuenta de la caja.
  $tmp = $destino + ".ota-nuevo"
  Copy-Item -LiteralPath $origen -Destination $tmp -Force
  Move-Item -LiteralPath $tmp -Destination $destino -Force
  Reparar-Permisos $destino
}
function Escribir-Diario($d) { Escribir-Atomico (Join-Path $Ota "diario.json") (($d | ConvertTo-Json -Depth 5)) }
function Leer-Diario {
  $f = Join-Path $Ota "diario.json"
  if (-not (Test-Path -LiteralPath $f)) { return $null }
  try { return ((Leer-Texto $f) | ConvertFrom-Json) } catch { Log ("diario.json ilegible: " + $_.Exception.Message); return $null }
}
function Revertir($diario, $motivo) {
  Log ("REVIRTIENDO a " + $diario.de_version + ": " + $motivo)
  [void](Detener-Kit)
  $resp = [string]$diario.respaldo
  if (-not (Test-Path -LiteralPath $resp)) { throw ("No hay respaldo en " + $resp + ": no se puede revertir solo") }
  $antes = @(Get-ChildItem -LiteralPath $resp -File | Select-Object -ExpandProperty Name)
  foreach ($n in $antes) { Copiar-Con-Permisos-Heredados (Join-Path $resp $n) (Join-Path $Raiz $n) }
  foreach ($n in @($diario.nuevos)) { if (($antes -notcontains $n) -and (Test-Path -LiteralPath (Join-Path $Raiz $n))) { Remove-Item -LiteralPath (Join-Path $Raiz $n) -Force -ErrorAction SilentlyContinue } }
  foreach ($x in @(Get-ChildItem -LiteralPath $Raiz -File -Filter "*.ota-nuevo" -ErrorAction SilentlyContinue)) { Remove-Item -LiteralPath $x.FullName -Force -ErrorAction SilentlyContinue }
  $diario.estado = "revertida"; $diario | Add-Member -NotePropertyName motivo -NotePropertyValue $motivo -Force
  Escribir-Diario $diario
  $r = Relanzar
  Log ("Version anterior restaurada. Relanzar: " + $r)
}
function Registrar-Fallo($e, [int]$serie, $motivo) {
  $lista = @($e["fallidas"] | Where-Object { $_.serie -ne $serie })
  $previo = @($e["fallidas"] | Where-Object { $_.serie -eq $serie })
  $n = 1; if ($previo.Count -gt 0) { $n = $previo[0].intentos + 1 }
  $horas = $HorasEntreIntentos[[Math]::Min($n - 1, $HorasEntreIntentos.Count - 1)]
  $lista += [pscustomobject]@{ serie = $serie; intentos = $n; hasta = (Iso ((Ahora-Utc).AddHours($horas))); motivo = $motivo }
  $e["fallidas"] = @($lista)
  return $n
}
function Serie-Bloqueada($e, [int]$serie) {
  foreach ($f in @($e["fallidas"])) {
    if ($f.serie -ne $serie) { continue }
    if ($f.intentos -ge $MaxIntentosPorSerie) { return ("la serie " + $serie + " fallo " + $f.intentos + " veces; espera un lanzamiento nuevo") }
    if ([DateTime]::Parse($f.hasta, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AdjustToUniversal -bor [Globalization.DateTimeStyles]::AssumeUniversal) -gt (Ahora-Utc)) { return ("la serie " + $serie + " fallo hace poco; se reintenta despues de " + $f.hasta) }
  }
  return ""
}

# ---------------- Verificacion del paquete ----------------
$Requeridos = @("config.ps1", "funciones.ps1", "11 latido.ps1", "0 abrir caja y pantalla.ps1", "20 actualizador.ps1", "21 relanzar.ps1", "ota serie.ps1", "ota llave publica.ps1")
function Preparar-Paquete($zip, $lanz, $llaveXml) {
  $dir = Join-Path $Ota "preparado"
  if (Test-Path -LiteralPath $dir) { Remove-Item -LiteralPath $dir -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $za = [IO.Compression.ZipFile]::OpenRead($zip)
  try {
    if ($za.Entries.Count -gt 80) { throw "El paquete trae demasiados archivos" }
    $vistos = @{}; $total = 0L
    foreach ($en in $za.Entries) {
      $nom = $en.FullName
      if ($nom.EndsWith("/")) { throw ("El paquete trae una carpeta: " + $nom) }
      if (($nom -match '[\\/:*?"<>|]') -or ($nom -match '\.\.') -or ($nom.Length -gt 80) -or ($nom -ne $nom.Trim())) { throw ("Nombre de archivo no permitido en el paquete: " + $nom) }
      if ([IO.Path]::GetExtension($nom).ToLower() -notin @(".ps1", ".bat", ".txt")) { throw ("Tipo de archivo no permitido en el paquete: " + $nom) }
      if ($vistos.ContainsKey($nom.ToLower())) { throw ("Archivo repetido en el paquete: " + $nom) }
      $vistos[$nom.ToLower()] = $true
      if ($en.Length -gt 5MB) { throw ("Archivo demasiado grande: " + $nom) }
      $total += $en.Length; if ($total -gt 30MB) { throw "El paquete descomprimido pasa de 30 MB" }
      $dest = Join-Path $dir $nom
      $in = $en.Open(); $out = [IO.File]::Create($dest)
      try { $in.CopyTo($out) } finally { $out.Dispose(); $in.Dispose() }
    }
  } finally { $za.Dispose() }
  foreach ($r in $Requeridos) { if (-not (Test-Path -LiteralPath (Join-Path $dir $r))) { throw ("Al paquete le falta " + $r) } }
  # la version y la serie que declara el paquete deben ser las del manifiesto firmado
  $cfg = Leer-Texto (Join-Path $dir "config.ps1")
  $mv = [regex]::Match($cfg, '\$VersionKit\s*=\s*"([^"]+)"'); if ((-not $mv.Success) -or ($mv.Groups[1].Value -ne [string]$lanz.version)) { throw "La version del paquete no coincide con la del manifiesto firmado" }
  $ms = [regex]::Match((Leer-Texto (Join-Path $dir "ota serie.ps1")), '\$OtaSerie\s*=\s*(\d+)'); if ((-not $ms.Success) -or ([int]$ms.Groups[1].Value -ne [int]$lanz.serie)) { throw "La serie del paquete no coincide con la del manifiesto firmado" }
  # la llave no se puede cambiar por el aire
  if (-not ($Prueba -and $LlavePublica)) {
    $mk = [regex]::Match((Leer-Texto (Join-Path $dir "ota llave publica.ps1")), '<RSAKeyValue>.*?</RSAKeyValue>')
    if ((-not $mk.Success) -or ($mk.Value -ne $llaveXml)) { throw "El paquete trae otra llave publica: no se permite cambiarla por el aire" }
  }
  # ningun script con errores de sintaxis
  foreach ($f in @(Get-ChildItem -LiteralPath $dir -Filter "*.ps1")) {
    $err = $null; $tok = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile($f.FullName, [ref]$tok, [ref]$err)
    if ($err -and $err.Count -gt 0) { throw ("Error de sintaxis en " + $f.Name + ": " + $err[0].Message + " (linea " + $err[0].Extent.StartLineNumber + ")") }
  }
  return $dir
}

function Aplicar($dir, $act, $lanz, $e) {
  $stamp = (Get-Date).ToString("yyyyMMdd-HHmmss")
  $resp = Join-Path $Ota ("respaldo\" + $act.serie + "-" + $stamp)
  New-Item -ItemType Directory -Force -Path $resp | Out-Null
  $viejos = Archivos-Del-Kit
  foreach ($n in $viejos) { Copy-Item -LiteralPath (Join-Path $Raiz $n) -Destination (Join-Path $resp $n) -Force }
  $nuevos = @(Get-ChildItem -LiteralPath $dir -File | Select-Object -ExpandProperty Name)
  $diario = [pscustomobject]@{ estado = "aplicando"; de_version = $act.version; de_serie = $act.serie; a_version = [string]$lanz.version; a_serie = [int]$lanz.serie; respaldo = $resp; nuevos = $nuevos; inicio = (Iso (Ahora-Utc)); verificar_hasta = "" }
  Escribir-Diario $diario
  Log ("Aplicando " + $lanz.version + " (serie " + $lanz.serie + ") sobre " + $act.version + " (serie " + $act.serie + ")")
  [void](Detener-Kit)
  foreach ($n in $nuevos) { Copiar-Con-Permisos-Heredados (Join-Path $dir $n) (Join-Path $Raiz $n) }
  foreach ($n in $viejos) { if (($nuevos -notcontains $n) -and ($n -match '\.(ps1|bat)$')) { Remove-Item -LiteralPath (Join-Path $Raiz $n) -Force } }
  foreach ($n in $nuevos) {
    if ((Huella (Join-Path $dir $n)) -ne (Huella (Join-Path $Raiz $n))) { throw ("La copia de " + $n + " no coincide con el paquete verificado") }
  }
  $desde = Get-Date
  $diario.estado = "aplicada"; $diario.verificar_hasta = (Iso ((Ahora-Utc).AddHours(6)))
  Escribir-Diario $diario
  $r = Relanzar
  Log ("Archivos cambiados (" + $nuevos.Count + "). Relanzar: " + $r)
  $salud = Comprobar-Salud ([string]$lanz.version) $desde $EsperaSaludSeg
  Log ("Comprobacion de salud: " + $salud)
  return [pscustomobject]@{ diario = $diario; salud = $salud }
}

# ---------------- Programa principal ----------------
try {
  Preparar-Ota
  $mutex = New-Object Threading.Mutex($false, "Global\LaBombaKitOTA")
  if (-not $mutex.WaitOne(0)) { Log "Otro actualizador esta corriendo; se sale"; exit 0 }
  $script:Fuera = $true
  $e = Leer-Estado

  # 1) Una actualizacion que quedo a medias (corte de luz, proceso detenido): se revierte antes de hacer nada mas
  $d = Leer-Diario
  if ($d -and $d.estado -eq "aplicando") {
    Revertir $d "la actualizacion se interrumpio a la mitad (corte de luz o proceso detenido)"
    $n = Registrar-Fallo $e ([int]$d.a_serie) "interrumpida"
    Guardar-Estado $e "revertida" ("Actualizacion interrumpida; se volvio a " + $d.de_version)
    Evento "otro" ("OTA kit: la actualizacion a " + $d.a_version + " se interrumpio; se volvio a la version " + $d.de_version)
    exit 0
  }
  # 2) Una actualizacion aplicada cuya salud no se pudo juzgar (no habia sesion abierta): se juzga ahora
  if ($d -and $d.estado -eq "aplicada") {
    $s = Comprobar-Salud ([string]$d.a_version) ([DateTime]::Parse($d.inicio, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AdjustToUniversal).ToLocalTime()) 20
    if ($s -eq "ok") {
      $d.estado = "confirmada"; Escribir-Diario $d
      Guardar-Estado $e "ok" ("Actualizada a " + $d.a_version + " (confirmada despues)")
      Evento "reparacion" ("OTA kit: actualizado de " + $d.de_version + " a " + $d.a_version + " (serie " + $d.a_serie + ")")
    } elseif ($s -eq "mal") {
      Revertir $d "el kit nuevo no arranco bien (comprobacion tardia)"
      [void](Registrar-Fallo $e ([int]$d.a_serie) "salud")
      Guardar-Estado $e "revertida" ("El kit nuevo no arranco; se volvio a " + $d.de_version)
      Evento "otro" ("OTA kit: " + $d.a_version + " no arranco bien; se volvio a la version " + $d.de_version)
    }
    exit 0
  }

  # 3) Ventana horaria y condiciones
  $h = (Hora-CR).Hour
  if ((-not $Ahora) -and (($h -lt $VentanaDesde) -or ($h -ge $VentanaHasta))) { Log ("Fuera de la ventana (" + $VentanaDesde + ":00 a " + $VentanaHasta + ":00 CR, ahora " + $h + " h)"); exit 0 }
  $mt = Join-Path $Datos "mantenimiento.txt"; if ((Test-Path -LiteralPath $mt) -and (((Get-Date) - (Get-Item -LiteralPath $mt).LastWriteTime).TotalHours -lt 4)) { Log "El kit esta en mantenimiento (Salir): no se actualiza"; exit 0 }
  $act = Version-Actual
  $libre = 0; try { $libre = (New-Object IO.DriveInfo((Split-Path $Raiz -Qualifier))).AvailableFreeSpace } catch { $libre = [long]::MaxValue }
  if ($libre -lt 300MB) { Log "Poco espacio en disco: no se actualiza"; exit 0 }
  $est = Estacion-Actual
  if (-not $est) { Log "Esta PC no tiene identidad (Soda o Pollos): no se actualiza"; exit 0 }
  $llave = Llave-Instalada

  # 4) Manifiesto firmado
  New-Item -ItemType Directory -Force -Path (Join-Path $Ota "descarga") | Out-Null
  $fm = Join-Path $Ota "descarga\manifiesto.json"; $ff = Join-Path $Ota "descarga\manifiesto.json.firma"
  $base = ""
  try {
    if ($Prueba -and $Manifiesto) { $base = Split-Path -Parent $Manifiesto; Bajar $Manifiesto $fm (1MB) $base; Bajar ($Manifiesto + ".firma") $ff (64KB) $base }
    else { Bajar $UrlManifiesto $fm (1MB) ""; Bajar ($UrlManifiesto + ".firma") $ff (64KB) "" }
  } catch { Log ("No se pudo bajar el manifiesto (sin internet o sin publicar): " + $_.Exception.Message); $e["ultima_comprobacion"] = Iso (Ahora-Utc); Guardar-Estado $e "" ""; exit 0 }
  $bytesM = [IO.File]::ReadAllBytes($fm)
  $firma = $null; try { $firma = [Convert]::FromBase64String(((Leer-Texto $ff).Trim())) } catch { $firma = $null }
  $valida = $false; if ($firma) { try { $valida = Firma-Valida $bytesM $firma $llave } catch { Log ("Error al verificar la firma: " + $_.Exception.Message) } }
  if (-not $valida) {
    Log "FIRMA DEL MANIFIESTO INVALIDA: se ignora todo lo que diga"
    Guardar-Estado $e "firma_invalida" "El manifiesto de actualizaciones no tiene una firma valida; se ignoro"
    Evento "otro" "OTA kit: el manifiesto de actualizaciones tiene una firma invalida; no se instalo nada"
    exit 0
  }
  $m = ([Text.Encoding]::UTF8.GetString($bytesM).TrimStart([char]0xFEFF)) | ConvertFrom-Json
  $tAhora = Ahora-Utc
  $emitido = [DateTime]::Parse([string]$m.emitido, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AdjustToUniversal -bor [Globalization.DateTimeStyles]::AssumeUniversal)
  $caduca = [DateTime]::Parse([string]$m.caduca, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AdjustToUniversal -bor [Globalization.DateTimeStyles]::AssumeUniversal)
  if (([int]$m.formato -ne 1) -or ($emitido -gt $tAhora.AddDays(1)) -or ($caduca -lt $tAhora)) {
    Log "Manifiesto vencido o de otro formato: no se instala nada"
    Guardar-Estado $e "manifiesto_vencido" "El manifiesto de actualizaciones esta vencido; hay que volver a firmarlo"
    exit 0
  }

  # 5) Que lanzamiento le toca a esta PC (por estacion y fecha) y es nuevo de verdad
  $cands = @()
  foreach ($l in @($m.lanzamientos)) {
    $est2 = @($l.estaciones); if (($est2 -notcontains "*") -and ($est2 -notcontains $est)) { continue }
    $desdeL = [DateTime]::Parse([string]$l.desde, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AdjustToUniversal -bor [Globalization.DateTimeStyles]::AssumeUniversal)
    if ($desdeL -gt $tAhora) { continue }
    if ([int]$l.minimo_actualizador -gt $VersionActualizador) { continue }
    if ([int]$l.serie -le $act.serie) { continue }
    $cands += $l
  }
  $e["ultima_comprobacion"] = Iso $tAhora
  if ($cands.Count -eq 0) { $e["disponible"] = ""; Log ("Al dia: serie " + $act.serie + " (" + $act.version + ")"); Guardar-Estado $e "" ""; exit 0 }
  $lanz = @($cands | Sort-Object { [int]$_.serie } -Descending)[0]
  $e["disponible"] = [string]$lanz.version
  $bloq = Serie-Bloqueada $e ([int]$lanz.serie)
  if ($bloq) { Log ("No se intenta: " + $bloq); Guardar-Estado $e "" ""; exit 0 }
  if ($SoloComprobar) { Log ("Hay actualizacion disponible: " + $lanz.version + " (serie " + $lanz.serie + ")"); Guardar-Estado $e "disponible" ("Disponible " + $lanz.version); exit 0 }

  # 6) Bajar, verificar y preparar
  $zip = Join-Path $Ota "descarga\paquete.zip"
  try {
    if ([long]$lanz.bytes -le 0 -or [long]$lanz.bytes -gt $MaxBytesPaquete) { throw "Tamano del paquete fuera de lo permitido" }
    Bajar ([string]$lanz.url) $zip ([long]$lanz.bytes) $base
    if ((Get-Item -LiteralPath $zip).Length -ne [long]$lanz.bytes) { throw "El tamano del paquete bajado no coincide con el manifiesto firmado" }
    if ((Huella $zip) -ne ([string]$lanz.sha256).ToLower()) { throw "La huella SHA-256 del paquete no coincide con el manifiesto firmado" }
    $dir = Preparar-Paquete $zip $lanz $llave
  } catch {
    $msg = $_.Exception.Message
    Log ("Paquete rechazado: " + $msg)
    [void](Registrar-Fallo $e ([int]$lanz.serie) "paquete")
    Guardar-Estado $e "rechazado" ("Paquete " + $lanz.version + " rechazado: " + $msg)
    Evento "otro" ("OTA kit: el paquete " + $lanz.version + " fue rechazado (" + $msg + "); no se instalo")
    exit 0
  }

  # 7) Aplicar con diario, respaldo y comprobacion de salud
  $d = $null
  try {
    $r = Aplicar $dir $act $lanz $e
    $d = $r.diario
    if ($r.salud -eq "mal") { throw "El kit nuevo no arranco bien (latido o vigilancia no iniciaron)" }
    if ($r.salud -eq "indeterminado") {
      Guardar-Estado $e "aplicada_sin_comprobar" ("Instalada " + $lanz.version + "; falta comprobar cuando haya sesion abierta")
      Evento "reparacion" ("OTA kit: instalado " + $lanz.version + " (serie " + $lanz.serie + ") sobre " + $act.version + "; pendiente de comprobar cuando abra la sesion")
      exit 0
    }
    $d.estado = "confirmada"; Escribir-Diario $d
    $e["fallidas"] = @($e["fallidas"] | Where-Object { $_.serie -ne [int]$lanz.serie })
    $e["disponible"] = ""
    Guardar-Estado $e "ok" ("Actualizado de " + $act.version + " a " + $lanz.version)
    Evento "reparacion" ("OTA kit: actualizado de " + $act.version + " a " + $lanz.version + " (serie " + $act.serie + " a " + $lanz.serie + ")")
    # se guardan solo los 2 respaldos mas recientes
    foreach ($old in @(Get-ChildItem -LiteralPath (Join-Path $Ota "respaldo") -Directory | Sort-Object LastWriteTime -Descending | Select-Object -Skip 2)) { Remove-Item -LiteralPath $old.FullName -Recurse -Force -ErrorAction SilentlyContinue }
  } catch {
    $msg = $_.Exception.Message
    Log ("FALLO al actualizar: " + $msg)
    $dj = Leer-Diario
    $revertido = $false
    if ($dj -and ($dj.estado -in @("aplicando", "aplicada"))) {
      try { Revertir $dj $msg; $revertido = $true } catch { Log ("NO SE PUDO REVERTIR: " + $_.Exception.Message) }
    }
    [void](Registrar-Fallo $e ([int]$lanz.serie) $msg)
    if ($revertido) {
      Guardar-Estado $e "revertida" ("Fallo " + $lanz.version + " (" + $msg + "); se volvio a " + $act.version)
      Evento "otro" ("OTA kit: fallo la actualizacion a " + $lanz.version + " (" + $msg + "); se volvio a la version " + $act.version)
    } else {
      Guardar-Estado $e "fallo_sin_revertir" ("Fallo " + $lanz.version + " y no se pudo revertir solo: " + $msg)
      Evento "otro" ("OTA kit: fallo la actualizacion a " + $lanz.version + " y NO se pudo volver atras solo (" + $msg + "); hay que reinstalar el kit")
    }
  }
}
catch {
  Log ("ERROR inesperado del actualizador: " + $_.Exception.Message + " (linea " + $_.InvocationInfo.ScriptLineNumber + ")")
  try { Evento "otro" ("OTA kit: error inesperado del actualizador: " + $_.Exception.Message) } catch { $null = 1 }
  exit 1
}
finally {
  if ($script:Fuera -and $mutex) { try { $mutex.ReleaseMutex() } catch { $null = 1 } }
}
