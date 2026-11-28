# v3.9 (28 nov): diagnostico del DNS de la red y rutas de respaldo para llegar al facturador SIN cambiar de origen.
# Caso real (28 nov, caja de Pollos): el DNS de la red de la tienda contesto NXDOMAIN para facturacion.dmalabomba.com con el SOA de una zona vieja (dns.jomax.net),
# mientras los DNS publicos (1.1.1.1, 8.8.8.8) lo resolvian bien. Otros sitios (Facebook, Supabase) resolvian normal: la falla era del DNS de la red, no del facturador.
# Todo lo de este archivo es de solo lectura sobre el equipo (consultas de red); lo unico que cambia algo es la ruta por IP del navegador (se decide en funciones contingencia.ps1)
# y, si Emil lo decide, "22 dns publico.ps1". Los ajustes viven en config.ps1; si faltaran se usan los valores de abajo.

function Valor-Config([string]$nombre, $porDefecto) {
  try { $v = Get-Variable -Name $nombre -ValueOnly -Scope Script -ErrorAction Stop; if ($null -ne $v) { return $v } } catch { $null = 1 }
  try { $v = Get-Variable -Name $nombre -ValueOnly -ErrorAction Stop; if ($null -ne $v) { return $v } } catch { $null = 1 }
  return $porDefecto
}

function Es-Ip-Publica-V4([string]$s) {
  # Solo direcciones IPv4 publicas: se descartan 0.x, 10.x, 127.x, 169.254.x, 172.16-31.x, 192.168.x, 100.64-127.x (CGNAT) y multicast/reservadas
  if ($s -notmatch '^\d{1,3}(\.\d{1,3}){3}$') { return $false }
  $b = @($s.Split(".") | ForEach-Object { [int]$_ })
  foreach ($x in $b) { if ($x -gt 255) { return $false } }
  if ($b[0] -eq 0 -or $b[0] -eq 10 -or $b[0] -eq 127 -or $b[0] -ge 224) { return $false }
  if ($b[0] -eq 169 -and $b[1] -eq 254) { return $false }
  if ($b[0] -eq 172 -and $b[1] -ge 16 -and $b[1] -le 31) { return $false }
  if ($b[0] -eq 192 -and $b[1] -eq 168) { return $false }
  if ($b[0] -eq 100 -and $b[1] -ge 64 -and $b[1] -le 127) { return $false }
  return $true
}

function Resolver-Local([string]$nombre, [int]$ms = 3000) {
  # Lo que contesta el DNS de la red (el que usa Windows): @{ ok; ips (solo IPv4) }
  $r = [pscustomobject][ordered]@{ ok = $false; ips = @() }
  try {
    $a = [Net.Dns]::BeginGetHostAddresses($nombre, $null, $null)
    if (-not $a.AsyncWaitHandle.WaitOne($ms)) { return $r }
    $todas = @([Net.Dns]::EndGetHostAddresses($a))
    $r.ips = @($todas | Where-Object { $_.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork } | ForEach-Object { $_.ToString() })
    $r.ok = ($todas.Count -gt 0)
  } catch { $null = 1 }
  return $r
}

function Servidores-Dns-Locales {
  # Los DNS que usa esta PC (IPv4), para dejarlos en el diagnostico
  try { return @(Get-DnsClientServerAddress -AddressFamily IPv4 -ErrorAction Stop | ForEach-Object { $_.ServerAddresses } | Where-Object { $_ } | Select-Object -Unique | Select-Object -First 4) } catch { return @() }
}

function Consulta-Doh([string]$nombre, [string]$servidor, [int]$ms = 3000) {
  # DNS sobre HTTPS (formato JSON de Cloudflare y Google). estado: -1 sin respuesta, 0 correcto, 3 el nombre no existe. Solo se usa para diagnosticar y para saber a que IP conectar.
  $r = [pscustomobject][ordered]@{ ok = $false; estado = -1; ips = @(); servidor = $servidor }
  try {
    try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { $null = 1 }
    $req = [Net.HttpWebRequest]::Create($servidor + "?name=" + [Uri]::EscapeDataString($nombre) + "&type=A")
    $req.Method = "GET"; $req.Timeout = $ms; $req.ReadWriteTimeout = $ms; $req.Accept = "application/dns-json"; $req.UserAgent = "KitCaja/3.9 diagnostico"
    $resp = $req.GetResponse()
    $txt = ""
    try { $sr = New-Object IO.StreamReader($resp.GetResponseStream(), [Text.Encoding]::UTF8); $txt = $sr.ReadToEnd() } finally { try { $resp.Close() } catch { $null = 1 } }
    $j = $txt | ConvertFrom-Json
    $r.estado = [int]$j.Status
    if ($r.estado -eq 0 -and $j.Answer) {
      $r.ips = @($j.Answer | Where-Object { $_.type -eq 1 } | ForEach-Object { [string]$_.data } | Where-Object { Es-Ip-Publica-V4 $_ })
      $r.ok = ($r.ips.Count -gt 0)
    }
  } catch { $null = 1 }
  return $r
}

function Consulta-Doh-Cualquiera([string]$nombre) {
  # Prueba los servidores DoH de config.ps1 en orden (primero por IP, que no depende del DNS de la red); el primero que contesta algo definitivo manda
  $lista = @(Valor-Config "ServidoresDoh" @("https://1.1.1.1/dns-query", "https://8.8.8.8/resolve", "https://cloudflare-dns.com/dns-query", "https://dns.google/resolve"))
  $ultimo = $null
  foreach ($s in $lista) {
    $r = Consulta-Doh $nombre ([string]$s) 3000
    if ($r.ok) { return $r }
    if ($r.estado -eq 3) { return $r }   # el DNS publico dice que el nombre NO existe: es la respuesta
    $ultimo = $r
  }
  if ($ultimo) { return $ultimo }
  return [pscustomobject][ordered]@{ ok = $false; estado = -1; ips = @(); servidor = "" }
}

function Nombre-Dns-Bytes([string]$n) {
  $ms = New-Object IO.MemoryStream
  foreach ($l in $n.TrimEnd(".").Split(".")) { $b = [Text.Encoding]::ASCII.GetBytes($l); $ms.WriteByte([byte]$b.Length); $ms.Write($b, 0, $b.Length) }
  $ms.WriteByte(0)
  return ,$ms.ToArray()
}
function Leer-Nombre-Dns([byte[]]$b, [ref]$pos) {
  # Lee un nombre de un mensaje DNS (con compresion por punteros) y deja $pos justo despues de el
  $partes = @(); $p = $pos.Value; $salto = $false; $guarda = 0
  while ($guarda -lt 60) {
    $guarda++
    $len = [int]$b[$p]
    if ($len -eq 0) { $p++; break }
    if (($len -band 0xC0) -eq 0xC0) { $off = (($len -band 0x3F) -shl 8) -bor [int]$b[$p + 1]; if (-not $salto) { $pos.Value = $p + 2 }; $salto = $true; $p = $off; continue }
    $partes += [Text.Encoding]::ASCII.GetString($b, $p + 1, $len); $p += 1 + $len
  }
  if (-not $salto) { $pos.Value = $p }
  return ($partes -join ".")
}
function Consulta-Dns-Cruda([string]$servidor, [string]$nombre, [int]$ms = 2500) {
  # Consulta DNS normal (UDP 53, tipo A) directo a un servidor. Devuelve @{ respondio; rcode (0 bien, 2 servfail, 3 nxdomain, 5 refused); ips; soa (servidor primario del SOA de la seccion de autoridad, si lo manda); ok }
  $r = [pscustomobject][ordered]@{ ok = $false; respondio = $false; rcode = -1; ips = @(); soa = ""; servidor = $servidor }
  $u = $null
  try {
    $id = Get-Random -Minimum 1 -Maximum 65535
    $q = New-Object IO.MemoryStream
    $q.WriteByte([byte]($id -shr 8)); $q.WriteByte([byte]($id -band 255))
    foreach ($x in @(1, 0, 0, 1, 0, 0, 0, 0, 0, 0)) { $q.WriteByte([byte]$x) }
    $nb = Nombre-Dns-Bytes $nombre; $q.Write($nb, 0, $nb.Length)
    foreach ($x in @(0, 1, 0, 1)) { $q.WriteByte([byte]$x) }
    $u = New-Object Net.Sockets.UdpClient
    $u.Client.ReceiveTimeout = $ms; $u.Client.SendTimeout = $ms
    $u.Connect($servidor, 53)
    $pq = $q.ToArray(); [void]$u.Send($pq, $pq.Length)
    $ep = New-Object Net.IPEndPoint([Net.IPAddress]::Any, 0)
    $b = $u.Receive([ref]$ep)
    if ($b.Length -lt 12) { return $r }
    $r.respondio = $true
    $r.rcode = [int]$b[3] -band 15
    $qd = ([int]$b[4] -shl 8) -bor [int]$b[5]; $an = ([int]$b[6] -shl 8) -bor [int]$b[7]; $ns = ([int]$b[8] -shl 8) -bor [int]$b[9]
    $pos = 12
    for ($i = 0; $i -lt $qd; $i++) { [void](Leer-Nombre-Dns $b ([ref]$pos)); $pos += 4 }
    $ips = @()
    for ($i = 0; $i -lt ($an + $ns); $i++) {
      [void](Leer-Nombre-Dns $b ([ref]$pos))
      $tp = ([int]$b[$pos] -shl 8) -bor [int]$b[$pos + 1]
      $rdlen = ([int]$b[$pos + 8] -shl 8) -bor [int]$b[$pos + 9]
      $rd = $pos + 10
      if ($tp -eq 1 -and $rdlen -eq 4 -and $i -lt $an) { $ips += ([string]$b[$rd] + "." + [string]$b[$rd + 1] + "." + [string]$b[$rd + 2] + "." + [string]$b[$rd + 3]) }
      elseif ($tp -eq 6 -and $i -ge $an -and -not $r.soa) { $p2 = $rd; $r.soa = (Leer-Nombre-Dns $b ([ref]$p2)).ToLower() }
      $pos = $rd + $rdlen
    }
    $r.ips = @($ips | Where-Object { Es-Ip-Publica-V4 $_ })
    $r.ok = ($r.rcode -eq 0 -and $r.ips.Count -gt 0)
  } catch { $null = 1 }
  finally { try { if ($u) { $u.Close() } } catch { $null = 1 } }
  return $r
}
function Dns-Local-Cruda([string]$nombre) {
  # Lo que contesta, a la consulta cruda, el primer DNS de la red que responde (para ver el rcode y el SOA con que contesta; por ejemplo NXDOMAIN con dns.jomax.net)
  foreach ($s in @(Servidores-Dns-Locales)) {
    $c = Consulta-Dns-Cruda ([string]$s) $nombre 2000
    if ($c.respondio) { return $c }
  }
  return $null
}
function Consulta-Udp([string]$nombre, [string]$servidor) {
  # Consulta directo a un DNS publico, sin pasar por el de la red (respaldo si el 443 hacia los servidores DoH estuviera cerrado)
  return (Consulta-Dns-Cruda $servidor $nombre 2500)
}

function Diagnosticar-Dns([string]$nombre, [string]$nombreAlterna = "") {
  # Distingue "el DNS de la red falla pero el publico resuelve" (dns_local_falla) de "ni el publico lo resuelve" (zona_falla) y de "no se pudo consultar el publico" (publico = sin_respuesta).
  $d = [ordered]@{ ts = (Get-Date).ToString("s"); nombre = $nombre; local_ok = $false; doh_ok = $false; udp_ok = $false; publico = "no_consultado"; dns_local_falla = $false; zona_falla = $false; soa = ""; rcode_local = ""; servidores = ((Servidores-Dns-Locales) -join ","); ips = @(); alterna_dns_ok = $null }
  $l = Resolver-Local $nombre 3500
  $d.local_ok = [bool]$l.ok
  if ($nombreAlterna) { $d.alterna_dns_ok = [bool](Resolver-Local $nombreAlterna 3000).ok }
  if ($l.ok) { $d.ips = @($l.ips | Where-Object { Es-Ip-Publica-V4 $_ }); return [pscustomobject]$d }
  $lc = Dns-Local-Cruda $nombre
  if ($lc) { $d.soa = [string]$lc.soa; $d.rcode_local = $(switch ($lc.rcode) { 0 { "sin_datos" } 2 { "servfail" } 3 { "nxdomain" } 5 { "refused" } default { "rcode_" + $lc.rcode } }) } else { $d.rcode_local = "sin_respuesta" }
  $h = Consulta-Doh-Cualquiera $nombre
  if ($h.ok) { $d.doh_ok = $true; $d.ips = @($h.ips); $d.publico = "resuelve" }
  elseif ($h.estado -eq 3) { $d.publico = "no_existe" }
  elseif ($h.estado -eq 0) { $d.publico = "sin_datos" }
  else { $d.publico = "sin_respuesta" }
  if (-not $d.doh_ok) {
    foreach ($s in @(Valor-Config "DnsPublicosUdp" @("1.1.1.1", "8.8.8.8"))) {
      $u = Consulta-Udp $nombre ([string]$s)
      if ($u.ok) { $d.udp_ok = $true; $d.ips = @($u.ips); $d.publico = "resuelve"; break }
    }
  }
  $d.dns_local_falla = ($d.doh_ok -or $d.udp_ok)
  $d.zona_falla = (($d.publico -eq "no_existe") -or ($d.publico -eq "sin_datos"))
  return [pscustomobject]$d
}

function Sondear-Por-Ip([string]$ip, [string]$nombre, [string]$marca = "Facturaci", [int]$ms = 4000) {
  # Se conecta a la IP indicada (sin usar el DNS) pero valida TLS contra el NOMBRE del facturador (SNI y certificado) y comprueba que la pagina sea la del facturador.
  # Es la misma prueba que hara el navegador con la direccion fijada a esa IP. Resultado: @{ ok; motivo; ip }
  $r = [pscustomobject][ordered]@{ ok = $false; motivo = "conexion"; ip = $ip }
  $tcp = $null; $ssl = $null
  try {
    $tcp = New-Object Net.Sockets.TcpClient
    $a = $tcp.BeginConnect($ip, 443, $null, $null)
    if (-not $a.AsyncWaitHandle.WaitOne($ms)) { $r.motivo = "tiempo"; return $r }
    try { $tcp.EndConnect($a) } catch { $r.motivo = "conexion"; return $r }
    $ssl = New-Object Net.Security.SslStream($tcp.GetStream(), $false)
    $ssl.ReadTimeout = $ms; $ssl.WriteTimeout = $ms
    try { $ssl.AuthenticateAsClient($nombre, (New-Object Security.Cryptography.X509Certificates.X509CertificateCollection), [Security.Authentication.SslProtocols]::Tls12, $false) } catch { $r.motivo = "tls"; return $r }
    $pet = "GET / HTTP/1.1`r`nHost: " + $nombre + "`r`nUser-Agent: KitCaja/3.9 sondeo ip`r`nAccept: text/html`r`nCache-Control: no-cache`r`nConnection: close`r`n`r`n"
    $b = [Text.Encoding]::ASCII.GetBytes($pet); $ssl.Write($b, 0, $b.Length); $ssl.Flush()
    $buf = New-Object byte[] 16384; $n = 0
    $sw = [Diagnostics.Stopwatch]::StartNew()
    while ($n -lt $buf.Length -and $sw.ElapsedMilliseconds -lt ($ms * 2)) {
      $x = 0
      try { $x = $ssl.Read($buf, $n, $buf.Length - $n) } catch { break }
      if ($x -le 0) { break }
      $n += $x
    }
    $txt = [Text.Encoding]::UTF8.GetString($buf, 0, $n)
    if ($txt -notmatch '^HTTP/1\.[01] 200') { $r.motivo = "http"; return $r }
    if ($txt -match ('(?is)<title>[^<]*' + [regex]::Escape($marca))) { $r.ok = $true; $r.motivo = "ok" } else { $r.motivo = "contenido" }
  } catch { $r.motivo = "conexion" }
  finally { try { if ($ssl) { $ssl.Dispose() } } catch { $null = 1 }; try { if ($tcp) { $tcp.Close() } } catch { $null = 1 } }
  return $r
}

# ---- Memoria de las ultimas IP buenas del facturador (se guardan solo si el sondeo normal salio bien y son IPv4 publicas) ----
function Leer-Ips-Recordadas([string]$archivo, [string]$nombre) {
  try {
    if (-not (Test-Path -LiteralPath $archivo)) { return @() }
    $j = ([IO.File]::ReadAllText($archivo, [Text.Encoding]::UTF8).TrimStart([char]0xFEFF)) | ConvertFrom-Json
    if ([string]$j.nombre -ne $nombre) { return @() }
    return @(@($j.ips) | ForEach-Object { [string]$_ } | Where-Object { Es-Ip-Publica-V4 $_ } | Select-Object -First 6)
  } catch { return @() }
}
function Recordar-Ips([string]$archivo, [string]$nombre, $ips) {
  try {
    $buenas = @(@($ips) | ForEach-Object { [string]$_ } | Where-Object { Es-Ip-Publica-V4 $_ } | Select-Object -First 6)
    if ($buenas.Count -eq 0) { return }
    $antes = @(Leer-Ips-Recordadas $archivo $nombre)
    $igual = ($antes.Count -eq $buenas.Count) -and (@($buenas | Where-Object { $antes -notcontains $_ }).Count -eq 0)
    if ($igual -and (Test-Path -LiteralPath $archivo) -and (((Get-Date) - (Get-Item -LiteralPath $archivo).LastWriteTime).TotalHours -lt 6)) { return }
    ([ordered]@{ ts = (Get-Date).ToString("s"); nombre = $nombre; ips = $buenas } | ConvertTo-Json -Compress) | Set-Content -LiteralPath $archivo -Encoding ASCII
  } catch { Write-Verbose "sin memoria de IP" }
}

function Buscar-Ruta-Ip([string]$nombre, [string]$marca, $diag, [string]$archivoIps) {
  # Candidatas: primero las IP que dio el DNS publico y despues las recordadas. Cada una se comprueba con TLS real contra el nombre; la primera buena se usa. Maximo 4 intentos.
  $cand = New-Object System.Collections.ArrayList; $origen = @{}
  if ($diag) { foreach ($ip in @($diag.ips)) { if ($ip -and -not $cand.Contains([string]$ip)) { [void]$cand.Add([string]$ip); $origen[[string]$ip] = "dns_publico" } } }
  foreach ($ip in @(Leer-Ips-Recordadas $archivoIps $nombre)) { if (-not $cand.Contains($ip)) { [void]$cand.Add($ip); $origen[$ip] = "memoria" } }
  $n = 0
  foreach ($ip in $cand) {
    if ($n -ge 4) { break }
    $n++
    $s = Sondear-Por-Ip $ip $nombre $marca 4000
    if ($s.ok) { return [pscustomobject]@{ ip = $ip; origen = $origen[$ip] } }
  }
  return $null
}

# ---- Adaptador de red activo (las usa "22 dns publico.ps1"; necesitan administrador solo para cambiar algo) ----
function Adaptador-Activo {
  # El adaptador por el que sale a internet: la ruta predeterminada de menor costo cuyo adaptador esta arriba
  try {
    $rutas = @(Get-NetRoute -DestinationPrefix "0.0.0.0/0" -ErrorAction Stop | Sort-Object { $_.RouteMetric + $_.InterfaceMetric })
    foreach ($ru in $rutas) {
      $ad = Get-NetAdapter -InterfaceIndex $ru.InterfaceIndex -ErrorAction SilentlyContinue
      if ($ad -and $ad.Status -eq "Up") { return $ad }
    }
  } catch { $null = 1 }
  return $null
}
function Dns-Del-Adaptador($ad) {
  # Como esta el DNS del adaptador: si lo da el DHCP del router (dhcp = true) o esta fijo, y los servidores IPv4
  $est = [ordered]@{ indice = [int]$ad.ifIndex; alias = [string]$ad.Name; guid = [string]$ad.InterfaceGuid; dhcp = $true; servidores = @() }
  try { $est.servidores = @(@((Get-DnsClientServerAddress -InterfaceIndex $ad.ifIndex -AddressFamily IPv4 -ErrorAction Stop).ServerAddresses) | Where-Object { $_ }) } catch { $null = 1 }
  try {
    $k = "HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces\" + $ad.InterfaceGuid
    $ns = [string](Get-ItemProperty -LiteralPath $k -ErrorAction Stop).NameServer
    $est.dhcp = [string]::IsNullOrWhiteSpace($ns)
  } catch { $null = 1 }
  return $est
}
