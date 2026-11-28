# v3.8 (27 nov): contingencia cuando el facturador no es alcanzable (dominio o DNS caidos).
# Principio: NUNCA se cambia de origen sin necesidad (otro dominio = otro localStorage, otra sesion, otro CORS de Supabase) y NUNCA se actua sobre una ventana de caja ya abierta.
# v3.9 (28 nov): ANTES de cambiar de origen se prueba llegar al MISMO origen por otra ruta (la IP fijada en el navegador, ver "funciones dns.ps1"); la direccion alterna (otro origen) queda como ultimo recurso antes de la pantalla local.
try { . "$PSScriptRoot\funciones dns.ps1" } catch { $null = 1 }
# Solo se decide QUE se abre al iniciar la caja o cuando falta su ventana:
#   - facturador alcanzable            -> se abre normal
#   - no alcanzable, pero el perfil ya guarda su copia (service worker) -> se abre normal: el navegador sirve la copia guardada y los datos (Supabase) siguen funcionando
#   - no alcanzable y sin copia guardada -> pantalla local "sin conexion al facturador" (127.0.0.1) que reintenta sola y vuelve al facturador cuando responde
# Ante la duda (error inesperado al sondear) se abre normal: la contingencia solo se activa con prueba de que no hay facturador.

function Sondear-Facturador {
  # Resultado: @{ ok; motivo; ms; ips }. motivo: ok | dns | conexion | tiempo | tls | http_NNN | contenido | desconocido
  param([string]$Url, [string]$Marca = "Facturaci", [int]$MsDns = 4000, [int]$MsHttp = 7000)
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $r = Sondear-Facturador-Interno $Url $Marca $MsDns $MsHttp
  $r.ms = [int]$sw.ElapsedMilliseconds
  return $r
}
function Sondear-Facturador-Interno([string]$Url, [string]$Marca, [int]$MsDns, [int]$MsHttp) {
  $r = [pscustomobject][ordered]@{ ok = $false; motivo = "desconocido"; ms = 0; ips = @() }
  try {
    $u = [Uri]$Url
    $esIp = $false; $ipx = $null
    if ([Net.IPAddress]::TryParse($u.DnsSafeHost, [ref]$ipx)) { $esIp = $true }
    if (-not $esIp) {
      try {
        $a = [Net.Dns]::BeginGetHostAddresses($u.DnsSafeHost, $null, $null)
        if (-not $a.AsyncWaitHandle.WaitOne($MsDns)) { $r.motivo = "dns"; return $r }
        $ips = @([Net.Dns]::EndGetHostAddresses($a))
        if ($ips.Count -eq 0) { $r.motivo = "dns"; return $r }
        $r.ips = @($ips | Where-Object { $_.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork } | ForEach-Object { $_.ToString() })
      } catch { $r.motivo = "dns"; return $r }
    }
    try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { $null = 1 }
    $req = [Net.HttpWebRequest]::Create($Url)
    $req.Method = "GET"; $req.Timeout = $MsHttp; $req.ReadWriteTimeout = $MsHttp; $req.AllowAutoRedirect = $false
    $req.UserAgent = "KitCaja/3.9 sondeo"; $req.Headers.Add("Cache-Control", "no-cache")
    $resp = $null
    try { $resp = $req.GetResponse() }
    catch [Net.WebException] {
      $we = $_.Exception
      if ($we.Response) { $r.motivo = "http_" + [int]$we.Response.StatusCode; try { $we.Response.Close() } catch { $null = 1 }; return $r }
      switch ($we.Status) {
        ([Net.WebExceptionStatus]::Timeout) { $r.motivo = "tiempo" }
        ([Net.WebExceptionStatus]::NameResolutionFailure) { $r.motivo = "dns" }
        ([Net.WebExceptionStatus]::TrustFailure) { $r.motivo = "tls" }
        ([Net.WebExceptionStatus]::SecureChannelFailure) { $r.motivo = "tls" }
        default { $r.motivo = "conexion" }
      }
      return $r
    }
    try {
      $codigo = [int]$resp.StatusCode
      if ($codigo -ne 200) { $r.motivo = "http_$codigo"; return $r }
      $sr = New-Object IO.StreamReader($resp.GetResponseStream(), [Text.Encoding]::UTF8)
      $buf = New-Object char[] 16384
      $n = $sr.Read($buf, 0, $buf.Length)
      $txt = if ($n -gt 0) { New-Object string(,$buf[0..($n - 1)]) } else { "" }
      # Debe ser la pagina real del facturador (no una pagina de dominio estacionado ni un aviso del proveedor)
      if ($txt -match ('(?is)<title>[^<]*' + [regex]::Escape($Marca))) { $r.ok = $true; $r.motivo = "ok" } else { $r.motivo = "contenido" }
    } finally { try { $resp.Close() } catch { $null = 1 } }
  } catch { $r.motivo = "desconocido" }
  return $r
}

function Resuelve-Dns([string]$nombre, [int]$ms = 3000) {
  # $true si el nombre resuelve (sirve para distinguir "cayo el dominio del facturador" de "no hay internet")
  try {
    $a = [Net.Dns]::BeginGetHostAddresses($nombre, $null, $null)
    if (-not $a.AsyncWaitHandle.WaitOne($ms)) { return $false }
    return (@([Net.Dns]::EndGetHostAddresses($a)).Count -gt 0)
  } catch { return $false }
}

function Es-Caida-Probada($s) {
  # Solo estos motivos son prueba de que NO hay facturador; "desconocido" (error propio del sondeo) no lo es.
  return ((-not $s.ok) -and ($s.motivo -ne "desconocido"))
}

function Perfil-Tiene-Copia([string]$perfil, [string]$hostWeb) {
  # El service worker del facturador guarda la cascara en la cache del perfil. Heuristica por la estructura de Chrome:
  # CacheStorage con contenido + registro del service worker que menciona el dominio. Si es dudoso, devuelve $false (se muestra la pantalla de contingencia, que tiene el boton para intentar con la copia).
  try {
    $sw = Join-Path $perfil "Default\Service Worker"
    $cache = Join-Path $sw "CacheStorage"
    if (-not (Test-Path -LiteralPath $cache)) { return $false }
    $grande = @(Get-ChildItem -LiteralPath $cache -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.Length -gt 1KB })
    if ($grande.Count -eq 0) { return $false }
    $db = Join-Path $sw "Database"
    if (-not (Test-Path -LiteralPath $db)) { return $false }
    $aguja = [Text.Encoding]::ASCII.GetBytes($hostWeb)
    foreach ($f in @(Get-ChildItem -LiteralPath $db -File -ErrorAction SilentlyContinue | Where-Object { $_.Length -gt 0 -and $_.Length -lt 8MB })) {
      $fs = $null
      try {
        $fs = [IO.File]::Open($f.FullName, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
        $b = New-Object byte[] ([int]$fs.Length); $leido = 0
        while ($leido -lt $b.Length) { $x = $fs.Read($b, $leido, $b.Length - $leido); if ($x -le 0) { break }; $leido += $x }
      } catch { continue } finally { if ($fs) { $fs.Dispose() } }
      $txt = [Text.Encoding]::GetEncoding(28591).GetString($b)
      if ($txt.IndexOf($hostWeb, [StringComparison]::OrdinalIgnoreCase) -ge 0) { return $true }
    }
    return $false
  } catch { return $false }
}

function Guardar-Estado-Facturador($s, [string]$modo, [string]$archivo, $extra = $null) {
  # v3.9: $extra (opcional) agrega al estado datos del diagnostico: dns_local_falla, doh_ok, soa, alterna_ok, ip (los lee la pantalla local y el latido)
  try {
    $o = [ordered]@{ ts = (Get-Date).ToString("s"); ok = [bool]$s.ok; motivo = [string]$s.motivo; modo = $modo }
    if ($extra) { foreach ($k in @($extra.Keys)) { $o[[string]$k] = $extra[$k] } }
    ($o | ConvertTo-Json -Compress) | Set-Content -LiteralPath $archivo -Encoding ASCII
  } catch { Write-Verbose "sin estado del facturador" }
}

function Leer-Estado-Facturador([string]$archivo) {
  # Para el servidor local: devuelve JSON con la edad en segundos (la pagina decide si el dato esta vigente)
  $edad = -1; $ok = "null"; $motivo = "sin_dato"; $modo = ""; $dl = "false"; $alt = "false"
  try {
    if (Test-Path -LiteralPath $archivo) {
      $j = (Get-Content -LiteralPath $archivo -Raw -Encoding ASCII) | ConvertFrom-Json
      $edad = [int]((Get-Date) - [DateTime]::Parse($j.ts)).TotalSeconds
      $ok = $(if ($j.ok) { "true" } else { "false" }); $motivo = ([string]$j.motivo -replace '[^a-z0-9_]', ''); $modo = ([string]$j.modo -replace '[^a-z]', '')
      if ($j.dns_local_falla) { $dl = "true" }; if ($j.alterna_ok) { $alt = "true" }
    }
  } catch { $edad = -1; $ok = "null"; $motivo = "sin_dato" }
  return ('{{"ok":{0},"motivo":"{1}","modo":"{2}","edad":{3},"dns_local_falla":{4},"alterna_ok":{5}}}' -f $ok, $motivo, $modo, $edad, $dl, $alt)
}

function Pagina-Contingencia([string]$urlCaja) {
  $u = [Uri]$urlCaja
  $hostTxt = [Net.WebUtility]::HtmlEncode($u.DnsSafeHost)
  $urlJs = ($urlCaja -replace '\\', '\\' -replace '"', '\"' -replace '<', '<')
  $html = @'
<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sin conexi&oacute;n al facturador</title>
<style>
html,body{margin:0;height:100%;background:#fbf8f2;color:#2a2118;font-family:Segoe UI,Arial,sans-serif}
main{max-width:760px;margin:0 auto;padding:28px 24px}
h1{font-size:34px;margin:0 0 8px}
p{font-size:20px;line-height:1.4;margin:10px 0}
.est{font-size:18px;color:#6b5a48;margin:14px 0}
.pun{display:inline-block;width:12px;height:12px;border-radius:6px;background:#c0392b;margin-right:8px}
.caja{background:#fff;border:1px solid #e5dccd;border-radius:10px;padding:14px 18px;margin:18px 0}
.caja li{font-size:19px;line-height:1.45;margin:4px 0}
button{font-size:20px;padding:14px 22px;margin:6px 10px 6px 0;border-radius:10px;border:1px solid #b9a98f;background:#fff;color:#2a2118;min-height:54px}
button.p{background:#2a2118;color:#fff;border-color:#2a2118}
small{color:#6b5a48;font-size:15px}
</style></head><body><main>
<h1>Sin conexi&oacute;n al facturador</h1>
<p>No se puede llegar a <b>@@HOST@@</b>. Puede ser la conexi&oacute;n a internet de la tienda o un problema de la propia p&aacute;gina del facturador; esta computadora est&aacute; bien.</p>
<p>Esta pantalla lo vuelve a intentar sola y, apenas el facturador responda, lo abre. No hace falta apagar nada.</p>
<div class="est"><span class="pun" id="pun"></span><span id="est">Comprobando...</span></div>
<p id="dnsx" style="display:none">Parece una falla del DNS de esta red, no del facturador. Esta computadora seguir&aacute; probando otras rutas y, si alguna responde, abrir&aacute; el facturador sola.</p>
<div class="caja"><b>Mientras tanto</b><ul>
<li>Anote cada venta en papel: hora, producto, monto y forma de pago, para digitarla cuando vuelva.</li>
<li>Desde aqu&iacute; no se pueden emitir facturas electr&oacute;nicas.</li>
<li>No cierre esta ventana. Si pasan m&aacute;s de 30 minutos, avise a Emil.</li>
</ul></div>
<button class="p" id="b1">Reintentar ahora</button>
<button id="b2">Intentar abrir con la copia guardada</button>
<p><small>La copia guardada solo existe si esta caja ya abri&oacute; el facturador antes con internet; si no, el navegador mostrar&aacute; un error y basta con cerrar esa ventana.</small></p>
</main>
<script>
(function () {
  var DEST = "@@URL@@";
  var intentos = 0;
  var el = document.getElementById("est"), pun = document.getElementById("pun");
  var MOT = { dns: "no se encuentra la direcci\u00f3n (DNS)", conexion: "no se puede conectar", tiempo: "no responde (tiempo agotado)", tls: "problema de seguridad del certificado", contenido: "la direcci\u00f3n responde otra p\u00e1gina", sin_dato: "sin dato todav\u00eda" };
  function motivo(m) { if (/^http_/.test(m)) return "el servidor respondi\u00f3 " + m.slice(5); return MOT[m] || m; }
  function ir() { location.replace(DEST); }
  function viaNavegador() { fetch(DEST, { mode: "no-cors", cache: "no-store" }).then(ir).catch(function () {}); }
  function revisar() {
    intentos++;
    fetch("/facturador", { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (j) {
      if (j.ok === true && j.edad >= 0 && j.edad < 90) { el.textContent = "El facturador volvi\u00f3. Abriendo..."; pun.style.background = "#27ae60"; ir(); return; }
      if (j.edad < 0 || j.edad >= 90) viaNavegador();
      document.getElementById("dnsx").style.display = (j.dns_local_falla === true && j.edad >= 0 && j.edad < 300) ? "block" : "none";
      el.textContent = "Sin conexi\u00f3n (" + motivo(j.motivo) + "). Intento n\u00famero " + intentos + ", pr\u00f3ximo en unos segundos.";
    }).catch(function () { viaNavegador(); el.textContent = "Sin conexi\u00f3n. Intento n\u00famero " + intentos + "."; });
  }
  document.getElementById("b1").onclick = function () { el.textContent = "Comprobando..."; revisar(); };
  document.getElementById("b2").onclick = function () { window.open(DEST, "_blank"); };
  revisar(); setInterval(revisar, 8000);
})();
</script></body></html>
'@
  return $html.Replace("@@HOST@@", $hostTxt).Replace("@@URL@@", $urlJs)
}

function Pagina-Alterna([string]$urlAlterna, [string]$urlNormal) {
  # Aviso local de unos segundos antes de abrir la direccion alterna (otro origen: el facturador puede pedir de nuevo empresa, usuario y PIN).
  $hostNormal = [Net.WebUtility]::HtmlEncode(([Uri]$urlNormal).DnsSafeHost)
  $a = [Uri]$urlAlterna
  $hostAlt = [Net.WebUtility]::HtmlEncode($a.DnsSafeHost + $a.AbsolutePath)
  $urlJs = ($urlAlterna -replace '\\', '\\' -replace '"', '\"' -replace '<', '<')
  $html = @'
<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Entrando por la direcci&oacute;n alterna</title>
<style>
html,body{margin:0;height:100%;background:#fbf8f2;color:#2a2118;font-family:Segoe UI,Arial,sans-serif}
main{max-width:760px;margin:0 auto;padding:28px 24px}
h1{font-size:32px;margin:0 0 8px}
p{font-size:20px;line-height:1.4;margin:10px 0}
.caja{background:#fff;border:1px solid #e5dccd;border-radius:10px;padding:14px 18px;margin:18px 0}
.caja li{font-size:19px;line-height:1.45;margin:4px 0}
button{font-size:20px;padding:14px 22px;margin:6px 10px 6px 0;border-radius:10px;border:1px solid #b9a98f;background:#2a2118;color:#fff;min-height:54px}
</style></head><body><main>
<h1>Se abrir&aacute; la direcci&oacute;n alterna del facturador</h1>
<p>Desde esta red no se puede llegar a <b>@@HOST@@</b>. Dentro de <b id="seg">6</b> segundos se abrir&aacute; <b>@@ALT@@</b>, que es el mismo facturador por otra direcci&oacute;n.</p>
<div class="caja"><b>Lo que puede notar</b><ul>
<li>Es posible que el facturador le pida otra vez la empresa, el usuario y el PIN.</li>
<li>Si esta caja ten&iacute;a ajustes de impresi&oacute;n hechos, es posible que haya que elegirlos de nuevo en esa direcci&oacute;n.</li>
<li>Cuando la direcci&oacute;n normal vuelva a responder, la caja la usar&aacute; en la pr&oacute;xima apertura del facturador (icono Facturador o reinicio de la ma&ntilde;ana).</li>
</ul></div>
<button id="b1">Entrar ahora</button>
</main>
<script>
(function () {
  var DEST = "@@URL@@";
  var s = 6, el = document.getElementById("seg");
  function ir() { location.replace(DEST); }
  document.getElementById("b1").onclick = ir;
  var t = setInterval(function () { s--; el.textContent = String(Math.max(s, 0)); if (s <= 0) { clearInterval(t); ir(); } }, 1000);
})();
</script></body></html>
'@
  return $html.Replace("@@HOST@@", $hostNormal).Replace("@@ALT@@", $hostAlt).Replace("@@URL@@", $urlJs)
}

# ---------------- Estado y decisiones (las usa 0 abrir caja y pantalla.ps1; necesitan Anotar, Registrar-Evento y Servidor-Vivo de ese script o de funciones.ps1) ----------------
# v3.9: la lista de rutas, de la mejor a la peor, cuando el facturador no responde por su direccion normal:
#   pin          -> el DNS de la red falla pero el DNS publico resuelve: el navegador se abre con facturacion.dmalabomba.com FIJADO a esa IP (--host-resolver-rules). MISMO origen: sesion, aparato, impresion y datos intactos. No necesita administrador.
#   copia        -> el perfil ya guarda la copia del facturador (service worker): se abre normal y el navegador sirve la copia
#   alterna      -> www.dmalabomba.com/facturacion/ (OTRO origen: la cajera debe ingresar de nuevo). Antes se muestra un aviso local de unos segundos
#   contingencia -> pantalla local "sin conexion al facturador" que reintenta sola
# Nunca se toca una ventana de caja que ya esta abierta; la ruta solo se decide al abrir la caja o cuando falta su ventana. En contingencia (la ventana solo muestra la pantalla local, sin datos de la cajera)
# la vigilancia SI reabre sola si aparece una ruta (pin o alterna).
$ArchivoEstadoFacturador = "$Datos\facturador.json"
$ArchivoIpsFacturador = "$Datos\facturador ips.json"
$script:ModoFacturador = "normal"            # normal | pin | copia | alterna | contingencia
$script:CaidasSeguidas = 0
$script:CaidoDesde = $null
$script:CaidaAvisada = $false
$script:UltimoSondeo = [DateTime]::MinValue
$script:UltimoDiag = $null                   # ultimo diagnostico del DNS (Diagnosticar-Dns)
$script:AlternaOk = $null                    # la direccion alterna respondio como el facturador (true/false; null si no se probo)
$script:PinIp = $null; $script:PinHost = ""  # IP a la que se fija el nombre del facturador en el navegador (modo pin)
$script:PinProceso = $null                   # IP con la que se abrio el navegador que esta corriendo (la fija el supervisor)
$script:UltimaEvaluacion = [DateTime]::MinValue
$script:ReabrirPorRuta = $false              # la vigilancia pide al supervisor reabrir la caja porque aparecio una ruta (solo desde contingencia)
function Extras-Estado {
  # Datos del diagnostico que se agregan al estado (facturador.json): los lee la pantalla local y el latido
  $e = [ordered]@{}
  if ($script:UltimoDiag) {
    $e["dns_local_falla"] = [bool]$script:UltimoDiag.dns_local_falla
    $e["doh_ok"] = [bool]($script:UltimoDiag.doh_ok -or $script:UltimoDiag.udp_ok)
    if ($script:UltimoDiag.soa) { $e["soa"] = [string]$script:UltimoDiag.soa }
    if ($script:UltimoDiag.rcode_local) { $e["rcode"] = [string]$script:UltimoDiag.rcode_local }
  }
  if ($null -ne $script:AlternaOk) { $e["alterna_ok"] = [bool]$script:AlternaOk }
  if ($script:PinIp) { $e["ip"] = [string]$script:PinIp }
  return $e
}
function Texto-Causa-Dns {
  $d = $script:UltimoDiag
  if (-not $d) { return "" }
  if ($d.dns_local_falla) { return (" Causa probable (dns_local_falla): el DNS de esta red no resuelve " + $d.nombre + " pero los DNS publicos si" + $(if ($d.rcode_local) { "; el DNS de la red contesta " + $d.rcode_local } else { "" }) + $(if ($d.soa) { " con el SOA " + $d.soa } else { "" }) + ".") }
  if ($d.zona_falla) { return (" Los DNS publicos tampoco resuelven " + $d.nombre + " (falla de la zona del dominio).") }
  if ($d.publico -eq "sin_respuesta") { return " No se pudo consultar a los DNS publicos." }
  return ""
}
function Texto-Ruta {
  switch ($script:ModoFacturador) {
    "pin" { return (" Ruta: el navegador abre " + $script:PinHost + " por la IP " + $script:PinIp + " (mismo origen: sesion y datos intactos).") }
    "alterna" { return " Ruta: direccion alterna (otro origen: la cajera debe ingresar de nuevo)." }
    "copia" { return " Ruta: copia guardada del navegador." }
    "contingencia" { return " Sin ruta: pantalla local de contingencia." }
  }
  return ""
}
function Notar-Facturador($s, $modo) {
  # Estado para la pantalla local y eventos al panel: UN aviso por caida (despues de 2 sondeos seguidos fallidos) y UN aviso al restablecerse.
  Guardar-Estado-Facturador $s $modo $ArchivoEstadoFacturador (Extras-Estado)
  if (Es-Caida-Probada $s) {
    $script:CaidasSeguidas++
    if (-not $script:CaidoDesde) { $script:CaidoDesde = Get-Date; Anotar ("Facturador NO alcanzable (" + $s.motivo + "). Modo: " + $modo + ".") }
    if ($script:CaidasSeguidas -ge 2 -and -not $script:CaidaAvisada) {
      $script:CaidaAvisada = $true
      $otras = "no se pudo comprobar"
      try { $otras = $(if (Resuelve-Dns ([Uri]$SupabaseUrl).DnsSafeHost 3000) { "si resuelven (la falla es del dominio del facturador o del DNS de esta red)" } else { "tampoco resuelven (puede ser internet de la tienda)" }) } catch { $null = 1 }
      Registrar-Evento "otro" ("Facturador no alcanzable desde esta caja: " + $s.motivo + ". Modo: " + $modo + ". Otras direcciones (supabase): " + $otras + "." + (Texto-Causa-Dns) + (Texto-Ruta))
    }
  } elseif ($s.ok) {
    if ($script:CaidoDesde) {
      $min = [int]((Get-Date) - $script:CaidoDesde).TotalMinutes
      Anotar ("Facturador alcanzable de nuevo tras " + $min + " min.")
      if ($script:CaidaAvisada) { Registrar-Evento "otro" ("Facturador alcanzable de nuevo desde esta caja tras " + $min + " min." + $(if ($script:ModoFacturador -eq "alterna") { " La caja sigue en la direccion alterna hasta la proxima apertura del facturador." } else { "" })) }
    }
    $script:CaidasSeguidas = 0; $script:CaidoDesde = $null; $script:CaidaAvisada = $false
    $script:UltimoDiag = $null; $script:AlternaOk = $null
    # copia, contingencia y pin vuelven a normal (la pantalla local vuelve sola; el pin sigue valiendo hasta la proxima apertura sin molestar). La alterna NO: la ventana esta en otro origen y no se toca hasta la proxima apertura.
    if ($script:ModoFacturador -in @("copia", "contingencia", "pin")) { $script:ModoFacturador = "normal" }
  }
}
function Recordar-Ips-Del-Sondeo($s) {
  try { if ($s.ok -and $s.ips -and (Get-Command Recordar-Ips -ErrorAction SilentlyContinue)) { Recordar-Ips $ArchivoIpsFacturador ([Uri]$UrlCaja).DnsSafeHost $s.ips } } catch { $null = 1 }
}
function Diagnosticar-Estado($s) {
  # Diagnostico del DNS (solo si el motivo es dns) y prueba de la direccion alterna. No cambia ninguna ruta ni modo.
  $nombre = ""; try { $nombre = ([Uri]$UrlCaja).DnsSafeHost } catch { $null = 1 }
  $nombreAlt = ""; if ($UrlCajaAlterna) { try { $nombreAlt = ([Uri]$UrlCajaAlterna).DnsSafeHost } catch { $null = 1 } }
  $script:UltimaEvaluacion = Get-Date
  $diag = $null
  try { if ($nombre -and ($s.motivo -eq "dns") -and (Get-Command Diagnosticar-Dns -ErrorAction SilentlyContinue)) { $diag = Diagnosticar-Dns $nombre $nombreAlt } }
  catch { Anotar ("El diagnostico de DNS fallo: " + $_.Exception.Message) }
  $script:UltimoDiag = $diag
  $script:AlternaOk = $null
  if ($UrlCajaAlterna) {
    try { $sa = Sondear-Facturador -Url $UrlCajaAlterna -Marca $MarcaFacturador -MsDns 3000 -MsHttp 6000; $script:AlternaOk = [bool]$sa.ok } catch { $script:AlternaOk = $null }
  }
  return $diag
}
function Elegir-Ruta($s) {
  # Solo se llama con una caida probada. Devuelve @{ modo; ip; origen } y deja en $script:PinIp la IP si el modo es pin.
  $ruta = [pscustomobject][ordered]@{ modo = "contingencia"; ip = $null; origen = "" }
  $script:PinIp = $null
  $nombre = ""; try { $nombre = ([Uri]$UrlCaja).DnsSafeHost } catch { $null = 1 }
  $diag = Diagnosticar-Estado $s
  try {
    # Se intenta siempre que el motivo sea dns: las IP salen del DNS publico y, si este no contesta (o la zona del dominio esta caida), de la memoria de las ultimas IP buenas
    if ($RutaPorIp -and $diag -and (Get-Command Buscar-Ruta-Ip -ErrorAction SilentlyContinue)) {
      $h = Buscar-Ruta-Ip $nombre $MarcaFacturador $diag $ArchivoIpsFacturador
      if ($h) { $script:PinIp = [string]$h.ip; $script:PinHost = $nombre; $ruta.modo = "pin"; $ruta.ip = $script:PinIp; $ruta.origen = [string]$h.origen }
    }
  } catch { Anotar ("No se pudo buscar la ruta por IP: " + $_.Exception.Message) }
  if ($ruta.modo -eq "contingencia") {
    if (Perfil-Tiene-Copia $Perfil ([Uri]$UrlCaja).DnsSafeHost) { $ruta.modo = "copia" }
    elseif ($AlternaFacturador -and $script:AlternaOk) { $ruta.modo = "alterna" }
  }
  return $ruta
}
function Url-Alterna-Abrir { return ($UrlCajaAlterna + $(if ($AbrirClienteDesdeKit) { "?kit=1" } else { "" })) }
function Decidir-Apertura {
  # Devuelve la URL que se abre en la ventana de la caja y fija $script:ModoFacturador (y $script:PinIp si el modo es pin).
  $script:PinIp = $null; $script:ReabrirPorRuta = $false
  if (-not $ContingenciaFacturador) { return $script:UrlCajaAbrir }
  try {
    $s = Sondear-Facturador -Url $UrlCaja -Marca $MarcaFacturador -MsDns 4000 -MsHttp 7000
    $script:UltimoSondeo = Get-Date
    $modo = "normal"
    if (Es-Caida-Probada $s) { $modo = (Elegir-Ruta $s).modo } else { Recordar-Ips-Del-Sondeo $s }
    $script:ModoFacturador = $modo
    Notar-Facturador $s $modo
    if ($modo -eq "contingencia") {
      for ($i = 0; $i -lt 10 -and -not (Servidor-Vivo); $i++) { Start-Sleep -Seconds 1 }
      return "http://127.0.0.1:$PuertoPublicidad/contingencia/"
    }
    if ($modo -eq "alterna") {
      # aviso claro de unos segundos (pagina local) y de ahi a la direccion alterna; si el servidor local no responde, directo a la alterna
      for ($i = 0; $i -lt 5 -and -not (Servidor-Vivo); $i++) { Start-Sleep -Seconds 1 }
      if (Servidor-Vivo) { return "http://127.0.0.1:$PuertoPublicidad/alterna/" }
      return (Url-Alterna-Abrir)
    }
  } catch { Anotar ("No se pudo decidir la apertura (se abre normal): " + $_.Exception.Message); $script:ModoFacturador = "normal"; $script:PinIp = $null }
  return $script:UrlCajaAbrir
}
function Vigilar-Facturador {
  # Solo observa (no toca ventanas): cada $SondeoFacturadorMin min, y cada vuelta mientras este caido (para volver a avisar el restablecimiento y dejar el estado fresco a la pantalla local).
  # v3.9: mientras este caido tambien refresca el diagnostico del DNS (para el panel); en contingencia, cada 90 s busca una ruta y, si aparece, pide reabrir la caja.
  if (-not $ContingenciaFacturador) { return }
  $cada = $(if ($script:CaidasSeguidas -gt 0) { 10 } else { [Math]::Max(1, $SondeoFacturadorMin) * 60 })
  if (((Get-Date) - $script:UltimoSondeo).TotalSeconds -lt $cada) { return }
  try {
    $s = Sondear-Facturador -Url $UrlCaja -Marca $MarcaFacturador -MsDns 3000 -MsHttp 5000
    $script:UltimoSondeo = Get-Date
    if (Es-Caida-Probada $s) {
      if ($script:ModoFacturador -eq "contingencia") {
        if (((Get-Date) - $script:UltimaEvaluacion).TotalSeconds -ge 90) {
          $r = Elegir-Ruta $s
          if ($r.modo -in @("pin", "alterna")) { $script:ReabrirPorRuta = $true; Anotar ("Aparecio una ruta al facturador (" + $r.modo + $(if ($r.ip) { " " + $r.ip } else { "" }) + "): se reabre la caja.") }
        }
      } elseif (((Get-Date) - $script:UltimaEvaluacion).TotalMinutes -ge 10) { [void](Diagnosticar-Estado $s) }
    } elseif ($s.ok) { Recordar-Ips-Del-Sondeo $s }
    Notar-Facturador $s $script:ModoFacturador
  } catch { Anotar ("Error al sondear el facturador: " + $_.Exception.Message) }
}
function Puede-Abrir-Cliente { return ($script:ModoFacturador -ne "contingencia") }   # sin facturador no hay pantalla del cliente que abrir (mostraria un error de red)
function Url-Cliente-Activa {
  # La pantalla del cliente debe ser del MISMO origen que la caja (se hablan por BroadcastChannel): en la direccion alterna es la de la alterna
  if ($script:ModoFacturador -eq "alterna" -and $UrlClienteAlterna) { return $UrlClienteAlterna }
  return $UrlCliente
}
function Argumentos-Ruta {
  # Argumentos extra del navegador para el modo pin: fija el nombre del facturador a la IP comprobada (solo ese nombre; el certificado se valida contra el nombre)
  if ($script:ModoFacturador -eq "pin" -and $script:PinIp -and $script:PinHost) { return @("--host-resolver-rules=`"MAP " + $script:PinHost + " " + $script:PinIp + "`"") }
  return @()
}
function Necesita-Reiniciar-Por-Ruta {
  # El navegador que ya corre (por ejemplo solo con la ventana del cliente) no tiene la IP fijada que ahora hace falta: solo un navegador nuevo la toma.
  return (($script:ModoFacturador -eq "pin") -and $script:PinIp -and ($script:PinProceso -ne $script:PinIp))
}
