# v3.4: sitios visitados en la PC de caja (SOLO dominios) para saber si se sale del sistema.
# Lee el historial de Chrome y Edge de las ultimas 24 horas y manda al panel un resumen por dia y sitio y el detalle de cada visita.
# Ademas manda cada visita con direccion completa, titulo de la pagina y, si es un buscador, lo que se busco (decision de Emil, 19 nov; el aviso a las empleadas se hace por escrito aparte).
# NO lee archivos ni toma capturas de pantalla.
# Lo lanza el latido cada 30 minutos en un proceso aparte. Los sitios permitidos se definen en config.ps1 ($SitiosPermitidos).
function Arranque($t) { foreach ($d in @("C:\PantallaCliente\datos", $env:TEMP)) { try { Add-Content -LiteralPath "$d\arranque.txt" -Value ("{0:yyyy-MM-dd HH:mm:ss}  [navegacion pid {1}] {2}" -f (Get-Date), $PID, $t) -ErrorAction Stop; break } catch { $null = 1 } } }
trap { Arranque ("ERROR " + $_.Exception.GetType().Name + ": " + $_.Exception.Message + " (linea " + $_.InvocationInfo.ScriptLineNumber + ")"); break }
. "$PSScriptRoot\config.ps1"
. "$PSScriptRoot\funciones.ps1"

if (-not ([System.Management.Automation.PSTypeName]'LbSqlite').Type) {
  Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class LbSqlite {
  const string L = "winsqlite3.dll";
  [DllImport(L, CallingConvention = CallingConvention.Cdecl)] static extern int sqlite3_open_v2([MarshalAs(UnmanagedType.LPStr)] string f, out IntPtr db, int flags, IntPtr vfs);
  [DllImport(L, CallingConvention = CallingConvention.Cdecl)] static extern int sqlite3_prepare_v2(IntPtr db, [MarshalAs(UnmanagedType.LPStr)] string sql, int n, out IntPtr st, IntPtr tail);
  [DllImport(L, CallingConvention = CallingConvention.Cdecl)] static extern int sqlite3_step(IntPtr st);
  [DllImport(L, CallingConvention = CallingConvention.Cdecl)] static extern IntPtr sqlite3_column_text(IntPtr st, int i);
  [DllImport(L, CallingConvention = CallingConvention.Cdecl)] static extern int sqlite3_column_bytes(IntPtr st, int i);
  [DllImport(L, CallingConvention = CallingConvention.Cdecl)] static extern int sqlite3_column_count(IntPtr st);
  [DllImport(L, CallingConvention = CallingConvention.Cdecl)] static extern int sqlite3_finalize(IntPtr st);
  [DllImport(L, CallingConvention = CallingConvention.Cdecl)] static extern int sqlite3_close(IntPtr db);
  [DllImport(L, CallingConvention = CallingConvention.Cdecl)] static extern int sqlite3_exec(IntPtr db, [MarshalAs(UnmanagedType.LPStr)] string sql, IntPtr cb, IntPtr arg, out IntPtr err);
  public static List<string[]> Query(string file, string sql, bool soloLectura) {
    var filas = new List<string[]>();
    IntPtr db;
    if (sqlite3_open_v2(file, out db, soloLectura ? 1 : 6, IntPtr.Zero) != 0) { if (db != IntPtr.Zero) sqlite3_close(db); throw new Exception("no se pudo abrir la base"); }
    try {
      IntPtr st;
      if (sqlite3_prepare_v2(db, sql, -1, out st, IntPtr.Zero) != 0) throw new Exception("consulta no valida");
      try {
        int n = sqlite3_column_count(st);
        while (sqlite3_step(st) == 100) {
          var f = new string[n];
          for (int i = 0; i < n; i++) {
            IntPtr p = sqlite3_column_text(st, i);
            if (p == IntPtr.Zero) { f[i] = null; continue; }
            int len = sqlite3_column_bytes(st, i);
            var b = new byte[len]; Marshal.Copy(p, b, 0, len);
            f[i] = Encoding.UTF8.GetString(b);
          }
          filas.Add(f);
        }
      } finally { sqlite3_finalize(st); }
    } finally { sqlite3_close(db); }
    return filas;
  }
  public static void Exec(string file, string sql) {
    IntPtr db, err;
    if (sqlite3_open_v2(file, out db, 6, IntPtr.Zero) != 0) throw new Exception("no se pudo abrir la base");
    try { if (sqlite3_exec(db, sql, IntPtr.Zero, IntPtr.Zero, out err) != 0) throw new Exception("no se pudo ejecutar"); } finally { sqlite3_close(db); }
  }
}
"@
}

function Es-Permitido($sitio) {
  foreach ($d in @($SitiosPermitidos)) { if ($sitio -eq $d -or $sitio.EndsWith("." + $d)) { return $true } }
  return $false
}
function Archivos-Historial {
  # Historial de Chrome y Edge de cada cuenta de Windows de la PC y del perfil propio del kit (los que esta cuenta pueda leer).
  $r = New-Object System.Collections.Generic.List[string]
  foreach ($u in @(Get-ChildItem -LiteralPath "C:\Users" -Directory -ErrorAction SilentlyContinue)) {
    foreach ($rel in @("AppData\Local\Google\Chrome\User Data", "AppData\Local\Microsoft\Edge\User Data")) {
      $base = Join-Path $u.FullName $rel
      if (-not (Test-Path -LiteralPath $base)) { continue }
      foreach ($p in @(Get-ChildItem -LiteralPath $base -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq "Default" -or $_.Name -like "Profile *" })) {
        $h = Join-Path $p.FullName "History"
        if (Test-Path -LiteralPath $h) { $r.Add($h) }
      }
    }
  }
  $hk = Join-Path $Perfil "Default\History"
  if (Test-Path -LiteralPath $hk) { $r.Add($hk) }
  return @($r | Select-Object -Unique)
}
function Busqueda-De($url, $sitio) {
  # Si la visita es una busqueda en un buscador conocido, devuelve lo que se busco (parametro q, query, p o search_query).
  if ($sitio -notmatch '(^|\.)(google|bing|duckduckgo|yahoo|youtube|ecosia|brave)\.' -and $sitio -notmatch '^search\.') { return "" }
  if ($url -match '[?&#](q|query|p|search_query|text)=([^&#]*)') {
    try { return [Uri]::UnescapeDataString(($Matches[2] -replace '\+', ' ')) } catch { return $Matches[2] }
  }
  return ""
}
function Sitios-Visitados($horas = 24) {
  # Devuelve una lista de { dia, sitio, veces, ultima, permitido } sumando todos los historiales.
  $tz = $null; try { $tz = [TimeZoneInfo]::FindSystemTimeZoneById("Central America Standard Time") } catch { $tz = [TimeZoneInfo]::Local }
  $desdeUtc = [DateTime]::UtcNow.AddHours(-$horas)
  $desdeChrome = [long](($desdeUtc - [DateTime]::new(1601, 1, 1, 0, 0, 0, [DateTimeKind]::Utc)).TotalMilliseconds * 1000)
  $acum = @{}
  $revisados = 0
  $visitas = New-Object System.Collections.Generic.List[object]
  foreach ($h in @(Archivos-Historial)) {
    $copia = Join-Path $Datos "historial-copia.db"
    try {
      Remove-Item -LiteralPath $copia, "$copia-journal", "$copia-wal" -Force -ErrorAction SilentlyContinue
      $fs = [IO.File]::Open($h, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete)
      try { $o = [IO.File]::Create($copia); try { $fs.CopyTo($o) } finally { $o.Dispose() } } finally { $fs.Dispose() }
      $filas = [LbSqlite]::Query($copia, "select u.url, v.visit_time, u.title from visits v join urls u on u.id = v.url where v.visit_time > $desdeChrome order by v.visit_time desc limit 6000", $true)
      $revisados++
    } catch { continue } finally { Remove-Item -LiteralPath $copia, "$copia-journal", "$copia-wal" -Force -ErrorAction SilentlyContinue }
    foreach ($f in $filas) {
      $url = [string]$f[0]
      if ($url -notmatch '^https?://') { continue }
      $host_ = ""
      try { $host_ = ([Uri]$url).Host.ToLowerInvariant() } catch { continue }
      if (-not $host_ -or $host_ -notmatch '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$') { continue }
      if ($host_.StartsWith("www.")) { $host_ = $host_.Substring(4) }
      $utc = [DateTime]::new(1601, 1, 1, 0, 0, 0, [DateTimeKind]::Utc).AddTicks([long]$f[1] * 10)
      $cr = [TimeZoneInfo]::ConvertTimeFromUtc($utc, $tz)
      $visitas.Add([ordered]@{ t = $utc.ToString("yyyy-MM-ddTHH:mm:ssZ"); url = $url; titulo = [string]$f[2]; sitio = $host_; busqueda = (Busqueda-De $url $host_); permitido = (Es-Permitido $host_) })
      $dia = $cr.ToString("yyyy-MM-dd"); $k = $dia + "|" + $host_
      if (-not $acum.ContainsKey($k)) { $acum[$k] = @{ dia = $dia; sitio = $host_; veces = 0; ultima = $utc } }
      $acum[$k].veces++
      if ($utc -gt $acum[$k].ultima) { $acum[$k].ultima = $utc }
    }
  }
  $lista = @($acum.Values | ForEach-Object { [ordered]@{ dia = $_.dia; sitio = $_.sitio; veces = $_.veces; ultima = $_.ultima.ToString("yyyy-MM-ddTHH:mm:ssZ"); permitido = (Es-Permitido $_.sitio) } })
  return [pscustomobject]@{ Sitios = @($lista | Sort-Object { -[int]$_.veces } | Select-Object -First 250); Visitas = @($visitas | Sort-Object { $_.t }); Historiales = $revisados }
}

# Solo se ejecuta cuando se lanza el archivo (no cuando otro programa lo carga para usar sus funciones).
if ($MyInvocation.InvocationName -ne ".") {
  $c = Crear-Mutex "Local\NavegacionLB"; $m = $c.Mutex
  if (-not $c.Tengo) { exit }
  try { (Get-Process -Id $PID).PriorityClass = "BelowNormal" } catch { Write-Verbose "sin prioridad baja" }
  $log = "$Datos\navegacion.txt"
  function Anotar($t) { try { if ((Test-Path $log) -and ((Get-Item $log).Length -gt 100KB)) { Move-Item $log "$log.old" -Force }; Add-Content -Path $log -Value ("{0:yyyy-MM-dd HH:mm:ss}  {1}" -f (Get-Date), $t) } catch { Write-Verbose "sin registro" } }
  $id = Leer-Identidad
  if (-not $id) { Anotar "Sin identidad: no se envia la navegacion."; exit }
  try {
    $res = Sitios-Visitados 24
    $fuera = @($res.Sitios | Where-Object { -not $_.permitido }).Count
    $r = Llamar-Rpc "equipo_navegacion" ([ordered]@{ p_estacion = $id.estacion; p_token = $id.token; p_sitios = @($res.Sitios) }) 30
    # Detalle de cada visita: solo las que no se enviaron antes (marca de tiempo en datos\navegacion_ultima.txt), en tandas de 200.
    $marca = "$Datos\navegacion_ultima.txt"; $desde = [DateTime]::UtcNow.AddDays(-2)
    try { if (Test-Path $marca) { $desde = [DateTime]::Parse((Get-Content $marca -Raw).Trim(), [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind) } } catch { $desde = [DateTime]::UtcNow.AddDays(-2) }
    $nuevas = @($res.Visitas | Where-Object { [DateTime]::Parse($_.t, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind) -gt $desde.AddMinutes(-1) })
    $enviadas = 0; $ultima = $desde; $ok = $true
    for ($i = 0; $i -lt $nuevas.Count -and $i -lt 1000 -and $ok; $i += 200) {
      $tanda = @($nuevas[$i..([Math]::Min($i + 199, $nuevas.Count - 1))])
      $rd = Llamar-Rpc "equipo_navegacion_detalle" ([ordered]@{ p_estacion = $id.estacion; p_token = $id.token; p_visitas = $tanda }) 30
      if ($rd.ok) { $enviadas += $tanda.Count; $ult = [DateTime]::Parse($tanda[-1].t, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind); if ($ult -gt $ultima) { $ultima = $ult } } else { $ok = $false }
    }
    if ($enviadas -gt 0) { try { Set-Content -Path $marca -Value $ultima.ToUniversalTime().ToString("o") } catch { Write-Verbose "sin marca" } }
    Anotar ("Detalle de visitas: {0} enviadas de {1} nuevas." -f $enviadas, $nuevas.Count)
    if ($r.ok) { Anotar ("Navegacion enviada: {0} sitios ({1} fuera del sistema), {2} historiales leidos, {3} nuevos fuera hoy." -f @($res.Sitios).Count, $fuera, $res.Historiales, $r.nuevos_fuera) }
    else { Anotar ("La base no acepto la navegacion: {0}" -f $r.motivo) }
  } catch { Anotar ("No se pudo enviar la navegacion: {0}" -f $_.Exception.Message) }
}
