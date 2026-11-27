# v3.8 (27 nov): contingencia cuando el facturador no es alcanzable (dominio o DNS caidos).
# Principio: NUNCA se cambia de origen (otro dominio = otro localStorage, otra sesion, otro CORS de Supabase) y NUNCA se actua sobre una ventana de caja ya abierta.
# Solo se decide QUE se abre al iniciar la caja o cuando falta su ventana:
#   - facturador alcanzable            -> se abre normal
#   - no alcanzable, pero el perfil ya guarda su copia (service worker) -> se abre normal: el navegador sirve la copia guardada y los datos (Supabase) siguen funcionando
#   - no alcanzable y sin copia guardada -> pantalla local "sin conexion al facturador" (127.0.0.1) que reintenta sola y vuelve al facturador cuando responde
# Ante la duda (error inesperado al sondear) se abre normal: la contingencia solo se activa con prueba de que no hay facturador.

function Sondear-Facturador {
  # Resultado: @{ ok; motivo; ms }. motivo: ok | dns | conexion | tiempo | tls | http_NNN | contenido | desconocido
  param([string]$Url, [string]$Marca = "Facturaci", [int]$MsDns = 4000, [int]$MsHttp = 7000)
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $r = Sondear-Facturador-Interno $Url $Marca $MsDns $MsHttp
  $r.ms = [int]$sw.ElapsedMilliseconds
  return $r
}
function Sondear-Facturador-Interno([string]$Url, [string]$Marca, [int]$MsDns, [int]$MsHttp) {
  $r = [pscustomobject][ordered]@{ ok = $false; motivo = "desconocido"; ms = 0 }
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
      } catch { $r.motivo = "dns"; return $r }
    }
    try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { $null = 1 }
    $req = [Net.HttpWebRequest]::Create($Url)
    $req.Method = "GET"; $req.Timeout = $MsHttp; $req.ReadWriteTimeout = $MsHttp; $req.AllowAutoRedirect = $false
    $req.UserAgent = "KitCaja/3.8 sondeo"; $req.Headers.Add("Cache-Control", "no-cache")
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

function Guardar-Estado-Facturador($s, [string]$modo, [string]$archivo) {
  try {
    ([ordered]@{ ts = (Get-Date).ToString("s"); ok = [bool]$s.ok; motivo = [string]$s.motivo; modo = $modo } | ConvertTo-Json -Compress) | Set-Content -LiteralPath $archivo -Encoding ASCII
  } catch { Write-Verbose "sin estado del facturador" }
}

function Leer-Estado-Facturador([string]$archivo) {
  # Para el servidor local: devuelve JSON con la edad en segundos (la pagina decide si el dato esta vigente)
  $edad = -1; $ok = "null"; $motivo = "sin_dato"; $modo = ""
  try {
    if (Test-Path -LiteralPath $archivo) {
      $j = (Get-Content -LiteralPath $archivo -Raw -Encoding ASCII) | ConvertFrom-Json
      $edad = [int]((Get-Date) - [DateTime]::Parse($j.ts)).TotalSeconds
      $ok = $(if ($j.ok) { "true" } else { "false" }); $motivo = ([string]$j.motivo -replace '[^a-z0-9_]', ''); $modo = ([string]$j.modo -replace '[^a-z]', '')
    }
  } catch { $edad = -1; $ok = "null"; $motivo = "sin_dato" }
  return ('{{"ok":{0},"motivo":"{1}","modo":"{2}","edad":{3}}}' -f $ok, $motivo, $modo, $edad)
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

# ---------------- Estado y decisiones (las usa 0 abrir caja y pantalla.ps1; necesitan Anotar, Registrar-Evento y Servidor-Vivo de ese script o de funciones.ps1) ----------------
$ArchivoEstadoFacturador = "$Datos\facturador.json"
$script:ModoFacturador = "normal"            # normal | copia (sin internet al facturador pero el perfil guarda su copia) | contingencia (pantalla local)
$script:CaidasSeguidas = 0
$script:CaidoDesde = $null
$script:CaidaAvisada = $false
$script:UltimoSondeo = [DateTime]::MinValue
function Notar-Facturador($s, $modo) {
  # Estado para la pantalla local y eventos al panel: UN aviso por caida (despues de 2 sondeos seguidos fallidos) y UN aviso al restablecerse.
  Guardar-Estado-Facturador $s $modo $ArchivoEstadoFacturador
  if (Es-Caida-Probada $s) {
    $script:CaidasSeguidas++
    if (-not $script:CaidoDesde) { $script:CaidoDesde = Get-Date; Anotar ("Facturador NO alcanzable (" + $s.motivo + "). Modo: " + $modo + ".") }
    if ($script:CaidasSeguidas -ge 2 -and -not $script:CaidaAvisada) {
      $script:CaidaAvisada = $true
      $otras = "no se pudo comprobar"
      try { $otras = $(if (Resuelve-Dns ([Uri]$SupabaseUrl).DnsSafeHost 3000) { "si resuelven (la falla es del dominio del facturador)" } else { "tampoco resuelven (puede ser internet de la tienda)" }) } catch { $null = 1 }
      Registrar-Evento "otro" ("Facturador no alcanzable desde esta caja: " + $s.motivo + ". Modo: " + $modo + ". Otras direcciones (supabase): " + $otras + ".")
    }
  } elseif ($s.ok) {
    if ($script:CaidoDesde) {
      $min = [int]((Get-Date) - $script:CaidoDesde).TotalMinutes
      Anotar ("Facturador alcanzable de nuevo tras " + $min + " min.")
      if ($script:CaidaAvisada) { Registrar-Evento "otro" ("Facturador alcanzable de nuevo desde esta caja tras " + $min + " min.") }
    }
    $script:CaidasSeguidas = 0; $script:CaidoDesde = $null; $script:CaidaAvisada = $false
    if ($script:ModoFacturador -ne "normal") { $script:ModoFacturador = "normal" }
  }
}
function Decidir-Apertura {
  # Devuelve la URL que se abre en la ventana de la caja y fija $script:ModoFacturador.
  if (-not $ContingenciaFacturador) { return $script:UrlCajaAbrir }
  try {
    $s = Sondear-Facturador -Url $UrlCaja -Marca $MarcaFacturador -MsDns 4000 -MsHttp 7000
    $script:UltimoSondeo = Get-Date
    $modo = "normal"
    if (Es-Caida-Probada $s) { $modo = $(if (Perfil-Tiene-Copia $Perfil ([Uri]$UrlCaja).DnsSafeHost) { "copia" } else { "contingencia" }) }
    $script:ModoFacturador = $modo
    Notar-Facturador $s $modo
    if ($modo -eq "contingencia") {
      for ($i = 0; $i -lt 10 -and -not (Servidor-Vivo); $i++) { Start-Sleep -Seconds 1 }
      return "http://127.0.0.1:$PuertoPublicidad/contingencia/"
    }
  } catch { Anotar ("No se pudo decidir la apertura (se abre normal): " + $_.Exception.Message); $script:ModoFacturador = "normal" }
  return $script:UrlCajaAbrir
}
function Vigilar-Facturador {
  # Solo observa (no toca ventanas): cada $SondeoFacturadorMin min, y cada vuelta mientras este caido (para volver a avisar el restablecimiento y dejar el estado fresco a la pantalla local).
  if (-not $ContingenciaFacturador) { return }
  $cada = $(if ($script:CaidasSeguidas -gt 0) { 10 } else { [Math]::Max(1, $SondeoFacturadorMin) * 60 })
  if (((Get-Date) - $script:UltimoSondeo).TotalSeconds -lt $cada) { return }
  try {
    $s = Sondear-Facturador -Url $UrlCaja -Marca $MarcaFacturador -MsDns 3000 -MsHttp 5000
    $script:UltimoSondeo = Get-Date
    Notar-Facturador $s $script:ModoFacturador
  } catch { Anotar ("Error al sondear el facturador: " + $_.Exception.Message) }
}
function Puede-Abrir-Cliente { return ($script:ModoFacturador -ne "contingencia") }   # sin facturador no hay pantalla del cliente que abrir (mostraria un error de red)
