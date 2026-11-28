# Prueba del kit v3.9 (respaldo ante fallas del DNS) en Windows PowerShell 5.1 real (ejecutor de GitHub, administrador).
# Imita el caso del 28 nov con un DNS FALSO en 127.0.0.1 que contesta NXDOMAIN (con el SOA de dns.jomax.net) para facturacion.dmalabomba.com y reenvia lo demas al DNS real.
# No toca ninguna PC de caja ni ningun DNS real: todo ocurre en el ejecutor de pruebas, que se descarta al terminar.
$ErrorActionPreference = "Continue"
$aqui = Split-Path -Parent $MyInvocation.MyCommand.Path
$origen = (Resolve-Path (Join-Path $aqui "..\kit pc caja\v3.9 respaldo DNS 28 nov")).Path
$res = Join-Path $aqui "resultados"; New-Item -ItemType Directory -Force $res | Out-Null
$sal = Join-Path $res "prueba kit v3.9.txt"
$script:Fallos = 0; $script:Pasos = 0
function Dice($t) { $l = "{0:HH:mm:ss}  {1}" -f (Get-Date), $t; Write-Host $l; Add-Content -LiteralPath $sal -Value $l }
function Ok($cond, $texto) { $script:Pasos++; if ($cond) { Dice ("  OK    " + $texto) } else { $script:Fallos++; Dice ("  FALLO " + $texto) } }
function Volcar($titulo, $ruta, $ult = 60) { Dice ("--- " + $titulo + " (" + $ruta + ")"); if (Test-Path -LiteralPath $ruta) { foreach ($x in @(Get-Content -LiteralPath $ruta -Tail $ult -ErrorAction SilentlyContinue)) { Dice ("    " + $x) } } else { Dice "    (no existe)" } }
function Texto-Seguro($ruta) { $fs = $null; try { $fs = New-Object IO.FileStream($ruta, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite); $sr = New-Object IO.StreamReader($fs); return [string]$sr.ReadToEnd() } catch { return "" } finally { if ($fs) { $fs.Dispose() } } }
Dice ("Windows PowerShell " + $PSVersionTable.PSVersion + " en " + [Environment]::OSVersion.VersionString + "; kit: " + $origen)
Dice ("Administrador: " + ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))

# 0) sintaxis con el parser de 5.1 y que no queden caracteres raros
$malos = 0
foreach ($f in Get-ChildItem $origen -Filter *.ps1) { $e = $null; $t = $null; [void][System.Management.Automation.Language.Parser]::ParseFile($f.FullName, [ref]$t, [ref]$e); if ($e.Count) { $malos++; Dice ("SINTAXIS " + $f.Name + ": " + $e[0].Message + " L" + $e[0].Extent.StartLineNumber) } }
Ok ($malos -eq 0) "0) Ningun script del kit v3.9 tiene errores de sintaxis en 5.1"
foreach ($n in @("funciones dns.ps1", "22 dns publico.ps1", "FIJAR DNS PUBLICO.bat", "RESTAURAR DNS.bat")) { Ok (Test-Path -LiteralPath (Join-Path $origen $n)) ("0) existe " + $n) }

# 1) cuenta normal y instalacion REAL (paso 1 del kit) en C:\PantallaCliente
$clave = "Kp-2026-xZ9!q"
$r = net user cajaprueba $clave /add 2>&1; Dice ("1) net user: " + ($r -join " "))
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $origen "1 crear accesos y arranque automatico.ps1") -Silencioso 2>&1 | ForEach-Object { Dice ("   paso1: " + $_) }
foreach ($n in @("funciones dns.ps1", "22 dns publico.ps1", "FIJAR DNS PUBLICO.bat", "RESTAURAR DNS.bat", "funciones contingencia.ps1")) { Ok (Test-Path -LiteralPath (Join-Path "C:\PantallaCliente" $n)) ("1) el instalador copio " + $n) }
$perm = (& icacls.exe "C:\PantallaCliente\funciones dns.ps1" 2>&1) -join " "
Ok ($perm -match "S-1-5-32-545|BUILTIN\\Users|Usuarios") "1) la cuenta de la caja puede leer funciones dns.ps1"
Set-Service seclogon -StartupType Manual -ErrorAction SilentlyContinue; Start-Service seclogon -ErrorAction SilentlyContinue
function Lanzar-Normal($nombre, $comando) {
  $bat = "C:\Windows\Temp\corre-$nombre.cmd"
  Set-Content -LiteralPath $bat -Value ('@echo off' + "`r`n" + $comando)
  icacls.exe $bat /grant "cajaprueba:(RX)" 2>&1 | Out-Null
  icacls.exe C:\Windows\Temp /grant "cajaprueba:(OI)(CI)M" 2>&1 | Out-Null
  $cred = New-Object System.Management.Automation.PSCredential(($env:COMPUTERNAME + "\cajaprueba"), (ConvertTo-SecureString $clave -AsPlainText -Force))
  return (Start-Process -FilePath "cmd.exe" -ArgumentList ('/c "' + $bat + '"') -Credential $cred -WorkingDirectory "C:\Windows\Temp" -LoadUserProfile -WindowStyle Hidden -PassThru -ErrorAction Stop)
}

# 2) DNS falso como DNS del adaptador activo
. "C:\PantallaCliente\config.ps1"; . "C:\PantallaCliente\funciones.ps1"
. "C:\PantallaCliente\funciones dns.ps1"
$ad = Adaptador-Activo
Ok ($null -ne $ad) ("2) Adaptador-Activo encuentra el adaptador de salida: " + $(if ($ad) { $ad.Name + " (indice " + $ad.ifIndex + ")" } else { "ninguno" }))
$dnsOrig = Dns-Del-Adaptador $ad
Dice ("   DNS original del adaptador: " + ($dnsOrig.servidores -join ", ") + "; lo da el DHCP: " + $dnsOrig.dhcp)
$upstream = @($dnsOrig.servidores)[0]
New-Item -ItemType Directory -Force C:\dnsfalso | Out-Null
$ctl = "C:\dnsfalso\bloqueos.txt"; Set-Content -LiteralPath $ctl -Value "" -Encoding ASCII
$py = Start-Process -FilePath "python" -ArgumentList @("`"" + (Join-Path $aqui "dns falso.py") + "`"", "--upstream", $upstream, "--control", $ctl, "--log", "C:\dnsfalso\consultas.log") -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 3
$cx = Consulta-Dns-Cruda "127.0.0.1" "www.dmalabomba.com" 4000
Ok ($cx.ok) ("2) el DNS falso reenvia al DNS real: www.dmalabomba.com -> " + ($cx.ips -join ", "))
function Poner-Dns-Falso { Set-DnsClientServerAddress -InterfaceIndex $ad.ifIndex -ServerAddresses "127.0.0.1" -ErrorAction Stop; & ipconfig.exe /flushdns 2>&1 | Out-Null; Clear-DnsClientCache -ErrorAction SilentlyContinue }
function Restaurar-Dns-Original {
  try { if ($dnsOrig.dhcp) { Set-DnsClientServerAddress -InterfaceIndex $ad.ifIndex -ResetServerAddresses -ErrorAction Stop } else { Set-DnsClientServerAddress -InterfaceIndex $ad.ifIndex -ServerAddresses @($dnsOrig.servidores) -ErrorAction Stop } } catch { Dice ("   no se pudo restaurar el DNS: " + $_.Exception.Message) }
  & ipconfig.exe /flushdns 2>&1 | Out-Null
}
function Bloquear([string[]]$lineas) { Set-Content -LiteralPath $ctl -Value ($lineas -join "`r`n") -Encoding ASCII; & ipconfig.exe /flushdns 2>&1 | Out-Null; Clear-DnsClientCache -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 800 }
$NOMBRE = "facturacion.dmalabomba.com"
$fwReglas = @()
function Cortar-Dns-Publicos { # cierra 1.1.1.1 y 8.8.8.8 (DoH y UDP) y bloquea en el DNS falso los nombres de los DoH por nombre: el DNS publico queda inalcanzable
  New-NetFirewallRule -DisplayName "prueba-kit-corte-dns-publicos" -Direction Outbound -RemoteAddress "1.1.1.1", "8.8.8.8" -Action Block -Protocol Any -ErrorAction Stop | Out-Null
}
function Abrir-Dns-Publicos { Get-NetFirewallRule -DisplayName "prueba-kit-corte-dns-publicos" -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue }
try {
  Poner-Dns-Falso
  Dice ("   DNS del adaptador ahora: " + ((Dns-Del-Adaptador $ad).servidores -join ", "))

  # 3) funciones del kit con el DNS falso (entorno minimo como el supervisor)
  Dice "3) Diagnostico y decisiones (funciones dns.ps1 y funciones contingencia.ps1) con el DNS falso"
  $script:Ev = @(); $script:Lg = @()
  function Anotar($t) { $script:Lg += $t }
  function Servidor-Vivo { return $true }
  . "C:\PantallaCliente\funciones contingencia.ps1"
  function Registrar-Evento($tipo, $detalle) { $script:Ev += ($tipo + "|" + $detalle) }
  $urlCajaAbrir = $UrlCaja
  $ipsMem = "$Datos\facturador ips.json"; Remove-Item $ipsMem -Force -ErrorAction SilentlyContinue
  Remove-Item "$Datos\facturador.json" -Force -ErrorAction SilentlyContinue

  # 3a) sin bloqueo: todo normal y se recuerdan las IP buenas
  Bloquear @()
  $d0 = Diagnosticar-Dns $NOMBRE "www.dmalabomba.com"
  Ok ($d0.local_ok -and (-not $d0.dns_local_falla) -and (-not $d0.zona_falla)) "3a) sin bloqueo: el DNS de la red resuelve y no hay falla (local_ok, sin dns_local_falla)"
  $script:ModoFacturador = "normal"
  $u = Decidir-Apertura
  Ok (($u -eq $urlCajaAbrir) -and $script:ModoFacturador -eq "normal") "3a) facturador alcanzable: se abre la direccion normal, modo normal"
  $mem = @(Leer-Ips-Recordadas $ipsMem $NOMBRE)
  Ok ($mem.Count -ge 1) ("3a) se recordaron las IP buenas del facturador: " + ($mem -join ", "))
  Ok (@($mem | Where-Object { -not (Es-Ip-Publica-V4 $_) }).Count -eq 0) "3a) solo se recuerdan IPv4 publicas"

  # 3b) el caso del 28 nov: NXDOMAIN solo para facturacion.dmalabomba.com (con SOA de dns.jomax.net)
  Bloquear @("exacto:$NOMBRE")
  $l = Resolver-Local $NOMBRE 4000
  Ok (-not $l.ok) "3b) con el bloqueo, el DNS de la red NO resuelve facturacion.dmalabomba.com"
  Ok ((Resolver-Local "www.dmalabomba.com" 4000).ok -and (Resolver-Local "dwlbcbtwdungyrykgahm.supabase.co" 4000).ok) "3b) www.dmalabomba.com y Supabase si resuelven (igual que en la red de la tienda)"
  $s = Sondear-Facturador -Url $UrlCaja -Marca $MarcaFacturador
  Ok ((-not $s.ok) -and $s.motivo -eq "dns") ("3b) el sondeo del kit dice motivo dns (es: " + $s.motivo + ")")
  $lc = Dns-Local-Cruda $NOMBRE
  Ok ($lc -and $lc.rcode -eq 3 -and $lc.soa -eq "dns.jomax.net") ("3b) la consulta cruda al DNS de la red ve NXDOMAIN y el SOA dns.jomax.net (rcode " + $lc.rcode + ", soa '" + $lc.soa + "')")
  foreach ($srv in @("https://1.1.1.1/dns-query", "https://8.8.8.8/resolve", "https://cloudflare-dns.com/dns-query", "https://dns.google/resolve")) { $x = Consulta-Doh $NOMBRE $srv 5000; Dice ("   DoH " + $srv + ": ok=" + $x.ok + " estado=" + $x.estado + " ips=" + ($x.ips -join ",")) }
  $cu = Consulta-Udp $NOMBRE "1.1.1.1"; Dice ("   UDP directo a 1.1.1.1: ok=" + $cu.ok + " ips=" + ($cu.ips -join ","))
  $dd = Diagnosticar-Dns $NOMBRE "www.dmalabomba.com"
  Dice ("   diagnostico: " + ($dd | ConvertTo-Json -Compress))
  Ok ((-not $dd.local_ok) -and $dd.dns_local_falla -and (-not $dd.zona_falla) -and $dd.publico -eq "resuelve" -and $dd.ips.Count -ge 1) "3b) Diagnosticar-Dns: dns_local_falla = true, los DNS publicos resuelven, sin falla de la zona"
  Ok (($dd.rcode_local -eq "nxdomain") -and ($dd.soa -eq "dns.jomax.net")) ("3b) el diagnostico reporta que el DNS local contesta nxdomain con el SOA dns.jomax.net (" + $dd.rcode_local + " / " + $dd.soa + ")")
  Ok ($dd.alterna_dns_ok -eq $true) "3b) la direccion alterna (www) si resuelve en el DNS de la red"
  Ok (($dd.doh_ok -or $dd.udp_ok)) ("3b) el DNS publico se consulto por " + $(if ($dd.doh_ok) { "DoH" } else { "UDP" }))
  $ipBuena = [string]$dd.ips[0]
  $pi1 = Sondear-Por-Ip $ipBuena $NOMBRE $MarcaFacturador
  Ok ($pi1.ok) ("3b) Sondear-Por-Ip: la IP " + $ipBuena + " sirve el facturador con TLS validado contra el nombre (motivo " + $pi1.motivo + ")")
  $pi2 = Sondear-Por-Ip "1.1.1.1" $NOMBRE $MarcaFacturador
  Ok ((-not $pi2.ok)) ("3b) una IP que NO es del facturador (1.1.1.1) se rechaza (motivo " + $pi2.motivo + ")")
  $pi3 = Sondear-Por-Ip "192.0.2.1" $NOMBRE $MarcaFacturador 2000
  Ok ((-not $pi3.ok) -and $pi3.motivo -in @("tiempo", "conexion")) ("3b) una IP que no responde se rechaza sin colgarse (motivo " + $pi3.motivo + ")")
  $script:Ev = @(); $script:CaidasSeguidas = 0; $script:CaidoDesde = $null; $script:CaidaAvisada = $false; $script:ModoFacturador = "normal"
  $u = Decidir-Apertura
  Ok (($u -eq $urlCajaAbrir) -and $script:ModoFacturador -eq "pin" -and (Es-Ip-Publica-V4 $script:PinIp)) ("3b) Decidir-Apertura: modo pin, se abre la MISMA direccion normal, IP " + $script:PinIp)
  $arg = @(Argumentos-Ruta)
  Ok (($arg.Count -eq 1) -and $arg[0] -eq ("--host-resolver-rules=`"MAP " + $NOMBRE + " " + $script:PinIp + "`"")) ("3b) argumento del navegador: " + ($arg -join " "))
  Ok (Puede-Abrir-Cliente) "3b) en modo pin la pantalla del cliente SI se abre"
  Ok ((Url-Cliente-Activa) -eq $UrlCliente) "3b) la pantalla del cliente va en el mismo origen que la caja (el subdominio)"
  $st = (Get-Content "$Datos\facturador.json" -Raw) | ConvertFrom-Json
  Ok (($st.modo -eq "pin") -and ($st.dns_local_falla -eq $true) -and ($st.doh_ok -eq $true) -and ($st.alterna_ok -eq $true) -and $st.soa -eq "dns.jomax.net" -and $st.rcode -eq "nxdomain" -and $st.ip) ("3b) el estado que lee el latido: " + ((Get-Content "$Datos\facturador.json" -Raw).Trim()))
  $js = (Leer-Estado-Facturador "$Datos\facturador.json") | ConvertFrom-Json
  Ok (($js.modo -eq "pin") -and ($js.dns_local_falla -eq $true) -and ($js.alterna_ok -eq $true)) "3b) la pantalla local recibe tambien dns_local_falla y alterna_ok"
  $u = Decidir-Apertura
  $ev = @($script:Ev | Where-Object { $_ -match "no alcanzable desde esta caja" })
  Ok (($ev.Count -eq 1) -and $ev[0] -match "dns_local_falla" -and $ev[0] -match "dns\.jomax\.net" -and $ev[0] -match "pin" -and $ev[0] -match "mismo origen") ("3b) un solo aviso por la caida, con causa y ruta: " + ($ev -join " // "))
  Ok ($ev[0].Length -lt 600) ("3b) el aviso es corto (" + $ev[0].Length + " caracteres)")

  # 3c) zona entera cortada (como una delegacion vieja guardada por el DNS de la red): www tampoco resuelve; el DNS publico si
  Bloquear @("zona:dmalabomba.com")
  $dz = Diagnosticar-Dns $NOMBRE "www.dmalabomba.com"
  Ok ($dz.dns_local_falla -and ($dz.alterna_dns_ok -eq $false)) "3c) con toda la zona cortada: dns_local_falla y la alterna tampoco resuelve en el DNS de la red"
  $script:ModoFacturador = "normal"; $script:CaidasSeguidas = 0; $script:CaidoDesde = $null; $script:CaidaAvisada = $false
  $u = Decidir-Apertura
  Ok ($script:ModoFacturador -eq "pin") ("3c) aun asi hay ruta por IP (la alterna no sirve aqui, la IP si): modo " + $script:ModoFacturador + ", alterna_ok=" + $script:AlternaOk)
  Ok ($script:AlternaOk -ne $true) "3c) alterna_ok = false (www no resuelve)"

  # 3d) DNS publicos inalcanzables (firewall + nombres de DoH cortados): la ruta sale de la memoria de IP
  Bloquear @("exacto:$NOMBRE", "exacto:cloudflare-dns.com", "exacto:dns.google")
  Cortar-Dns-Publicos
  $dm = Diagnosticar-Dns $NOMBRE "www.dmalabomba.com"
  Ok ((-not $dm.dns_local_falla) -and $dm.publico -eq "sin_respuesta") ("3d) sin acceso a los DNS publicos el diagnostico lo dice (publico = " + $dm.publico + ") y no inventa dns_local_falla")
  $script:ModoFacturador = "normal"; $script:CaidasSeguidas = 0; $script:CaidoDesde = $null; $script:CaidaAvisada = $false
  $u = Decidir-Apertura
  $hm = Buscar-Ruta-Ip $NOMBRE $MarcaFacturador $dm $ipsMem
  Ok (($script:ModoFacturador -eq "pin") -and $hm -and $hm.origen -eq "memoria") ("3d) ruta por IP con la ultima IP buena recordada (origen: " + $(if ($hm) { $hm.origen } else { "ninguno" }) + ")")
  # sin memoria y sin DNS publico: alterna (www si resuelve)
  Remove-Item $ipsMem -Force
  $script:ModoFacturador = "normal"; $script:CaidasSeguidas = 0; $script:CaidoDesde = $null; $script:CaidaAvisada = $false
  $u = Decidir-Apertura
  Ok (($script:ModoFacturador -eq "alterna") -and $u -eq "http://127.0.0.1:$PuertoPublicidad/alterna/") ("3d) sin IP y sin copia, con www resolviendo: modo alterna, se abre el aviso local (es: " + $script:ModoFacturador + " / " + $u + ")")
  Ok ((Url-Cliente-Activa) -eq $UrlClienteAlterna) "3d) en la alterna la pantalla del cliente tambien va en la alterna (mismo origen que la caja)"
  Ok (Puede-Abrir-Cliente) "3d) en la alterna la pantalla del cliente SI se abre"
  Ok ((Url-Alterna-Abrir) -eq $UrlCajaAlterna) "3d) la direccion alterna que se abre es la configurada"
  $pg = Pagina-Alterna $UrlCajaAlterna $UrlCaja
  Ok (($pg -match 'var DEST = "https://www\.dmalabomba\.com/facturacion/";') -and ($pg -match "Se abrir&aacute; la direcci&oacute;n alterna") -and ($pg -match "otra vez la empresa, el usuario y el PIN") -and ($pg -match "Entrar ahora") -and ($pg -match "location\.replace")) "3d) el aviso local explica el cambio, que puede pedir ingresar de nuevo y tiene el boton Entrar ahora"
  Ok ($pg -notmatch 'https?://(?!www\.dmalabomba\.com/facturacion/)[a-z]') "3d) el aviso local no referencia otro sitio externo"
  # con copia guardada en el perfil y sin IP: copia antes que alterna
  $pf = Join-Path "C:\dnsfalso" "perfil-con-copia"
  New-Item -ItemType Directory -Force "$pf\Default\Service Worker\CacheStorage\abc\def", "$pf\Default\Service Worker\Database" | Out-Null
  [IO.File]::WriteAllBytes("$pf\Default\Service Worker\CacheStorage\abc\def\0_0", (New-Object byte[] 5000))
  [IO.File]::WriteAllBytes("$pf\Default\Service Worker\Database\000003.log", [Text.Encoding]::ASCII.GetBytes("xxREG:https://facturacion.dmalabomba.com/yy"))
  $perfilReal = $Perfil; $Perfil = $pf
  $script:ModoFacturador = "normal"; $script:CaidasSeguidas = 0; $script:CaidoDesde = $null; $script:CaidaAvisada = $false
  $u = Decidir-Apertura
  Ok (($script:ModoFacturador -eq "copia") -and $u -eq $urlCajaAbrir) "3d) con copia guardada (y sin IP) se prefiere la copia, que conserva el origen, a la alterna"
  Abrir-Dns-Publicos
  Bloquear @("exacto:$NOMBRE")
  $script:ModoFacturador = "normal"; $script:CaidasSeguidas = 0; $script:CaidoDesde = $null; $script:CaidaAvisada = $false
  $u = Decidir-Apertura
  Ok ($script:ModoFacturador -eq "pin") "3d) con DNS publico disponible y copia guardada, la ruta por IP (mismo origen y pagina fresca) va primero"
  $Perfil = $perfilReal
  # contingencia total: todo cortado, sin memoria, sin copia
  Bloquear @("zona:dmalabomba.com", "exacto:cloudflare-dns.com", "exacto:dns.google"); Cortar-Dns-Publicos; Remove-Item $ipsMem -Force -ErrorAction SilentlyContinue
  $script:ModoFacturador = "normal"; $script:CaidasSeguidas = 0; $script:CaidoDesde = $null; $script:CaidaAvisada = $false
  $u = Decidir-Apertura
  Ok (($script:ModoFacturador -eq "contingencia") -and $u -eq "http://127.0.0.1:$PuertoPublicidad/contingencia/") ("3d) sin ninguna ruta: pantalla local de contingencia como en la v3.8 (es: " + $script:ModoFacturador + ")")
  Ok (-not (Puede-Abrir-Cliente)) "3d) y sin ruta no se abre la pantalla del cliente"
  Abrir-Dns-Publicos
  # apagado: $RutaPorIp = $false y $AlternaFacturador = $false (como la v3.8)
  Bloquear @("exacto:$NOMBRE")
  $RutaPorIp = $false; $AlternaFacturador = $false
  $script:ModoFacturador = "normal"; $script:CaidasSeguidas = 0; $script:CaidoDesde = $null; $script:CaidaAvisada = $false
  $u = Decidir-Apertura
  Ok ($script:ModoFacturador -eq "contingencia") "3e) con RutaPorIp y AlternaFacturador apagados se comporta como la v3.8 (contingencia)"
  $RutaPorIp = $true; $AlternaFacturador = $true
  Bloquear @()
  $script:ModoFacturador = "contingencia"
  $s2 = Sondear-Facturador -Url $UrlCaja -Marca $MarcaFacturador
  Notar-Facturador $s2 "normal"
  Ok ($script:ModoFacturador -eq "normal") "3f) al volver el facturador el modo pasa a normal"
  $script:ModoFacturador = "alterna"; $script:CaidoDesde = Get-Date; $script:CaidaAvisada = $true
  Notar-Facturador $s2 "alterna"
  Ok ($script:ModoFacturador -eq "alterna") "3f) pero si la ventana esta en la alterna NO se vuelve sola al subdominio (se hace en la proxima apertura)"
  $u = Decidir-Apertura
  Ok (($script:ModoFacturador -eq "normal") -and $u -eq $urlCajaAbrir) "3f) en la proxima apertura (icono Facturador o reinicio diario) vuelve al subdominio"
  Dice ("   registro de la prueba (Anotar): " + ($script:Lg -join " | "))

  # 4) 22 dns publico.ps1 (REAL, como administrador): fijar, comprobar, revertir
  Dice "4) DNS publicos de respaldo en el adaptador (22 dns publico.ps1)"
  Bloquear @("exacto:$NOMBRE")
  Remove-Item "$Datos\dns respaldo.json" -Force -ErrorAction SilentlyContinue
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\PantallaCliente\22 dns publico.ps1" -Estado -Silencioso 2>&1 | ForEach-Object { Dice ("   22 estado: " + $_) }
  $o = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\PantallaCliente\22 dns publico.ps1" -Aplicar -Silencioso 2>&1 | ForEach-Object { Dice ("   22 aplicar: " + $_); $_ }
  $ahora = (Dns-Del-Adaptador $ad)
  Ok ((@($ahora.servidores) -join ",") -eq "1.1.1.1,8.8.8.8") ("4a) el adaptador quedo con 1.1.1.1 y 8.8.8.8 (es: " + (@($ahora.servidores) -join ",") + ")")
  Ok ((Resolver-Local $NOMBRE 6000).ok) "4a) con los DNS publicos fijados facturacion.dmalabomba.com resuelve aunque el DNS falso siga bloqueandolo"
  $g = (Get-Content "$Datos\dns respaldo.json" -Raw) | ConvertFrom-Json
  Ok (($g.aplicado -eq $true) -and (@($g.anterior.servidores) -join ",") -eq "127.0.0.1" -and ($g.anterior.dhcp -eq $false)) ("4a) quedo guardado como estaba (antes: " + (@($g.anterior.servidores) -join ",") + ", DHCP " + $g.anterior.dhcp + ")")
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\PantallaCliente\22 dns publico.ps1" -Aplicar -Silencioso 2>&1 | Out-Null
  $g2 = (Get-Content "$Datos\dns respaldo.json" -Raw) | ConvertFrom-Json
  Ok ((@($g2.anterior.servidores) -join ",") -eq "127.0.0.1") "4a') aplicar dos veces no pisa el DNS original guardado"
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\PantallaCliente\22 dns publico.ps1" -Revertir -Silencioso 2>&1 | ForEach-Object { Dice ("   22 revertir: " + $_) }
  Ok ((@((Dns-Del-Adaptador $ad).servidores) -join ",") -eq "127.0.0.1") "4b) RESTAURAR: el DNS vuelve a como estaba (fijo 127.0.0.1)"
  $g3 = (Get-Content "$Datos\dns respaldo.json" -Raw) | ConvertFrom-Json
  Ok ($g3.aplicado -eq $false) "4b) el archivo guardado marca aplicado = false"
  # el DNS original venia del DHCP del router: la reversa debe devolverlo a DHCP
  Set-DnsClientServerAddress -InterfaceIndex $ad.ifIndex -ResetServerAddresses; & ipconfig.exe /flushdns 2>&1 | Out-Null
  $antesDhcp = Dns-Del-Adaptador $ad
  Ok ($antesDhcp.dhcp -eq $true) ("4c) punto de partida: DNS por DHCP (" + (@($antesDhcp.servidores) -join ",") + ")")
  Remove-Item "$Datos\dns respaldo.json" -Force
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\PantallaCliente\22 dns publico.ps1" -Aplicar -Silencioso 2>&1 | Out-Null
  Ok ((@((Dns-Del-Adaptador $ad).servidores) -join ",") -eq "1.1.1.1,8.8.8.8") "4c) con DHCP: tambien se fijan los publicos"
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\PantallaCliente\22 dns publico.ps1" -Revertir -Silencioso 2>&1 | Out-Null
  $despDhcp = Dns-Del-Adaptador $ad
  Ok (($despDhcp.dhcp -eq $true) -and ((@($despDhcp.servidores) -join ",") -eq (@($antesDhcp.servidores) -join ","))) ("4c) la reversa lo devuelve a DHCP con los mismos servidores (" + (@($despDhcp.servidores) -join ",") + ")")
  # aplicar con una lista que NO resuelve: se deshace solo
  Poner-Dns-Falso
  New-Item -ItemType Directory -Force C:\kit-dns-malo | Out-Null; Copy-Item "C:\PantallaCliente\*" C:\kit-dns-malo -Include *.ps1 -ErrorAction SilentlyContinue
  $cfgm = Get-Content "C:\kit-dns-malo\config.ps1" -Raw; Set-Content "C:\kit-dns-malo\config.ps1" -Value ($cfgm -replace '\$DnsPublicoLista\s*=\s*@\([^)]*\)', '$DnsPublicoLista = @("192.0.2.1")') -Encoding UTF8
  Remove-Item "$Datos\dns respaldo.json" -Force -ErrorAction SilentlyContinue
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\kit-dns-malo\22 dns publico.ps1" -Aplicar -Silencioso 2>&1 | ForEach-Object { Dice ("   22 (lista mala): " + $_) }
  Ok ((@((Dns-Del-Adaptador $ad).servidores) -join ",") -eq "127.0.0.1") "4d) si con los DNS publicos el facturador NO resuelve, el kit deja el DNS como estaba solo"
  Remove-Item "$Datos\dns respaldo.json" -Force -ErrorAction SilentlyContinue
  Remove-Item C:\kit-dns-malo -Recurse -Force -ErrorAction SilentlyContinue
  $rcfg = Get-Content "C:\PantallaCliente\config.ps1" -Raw
  Ok (($rcfg -match '\$DnsPublicoRespaldo\s*=\s*\$false') -and ($rcfg -match '\$RutaPorIp\s*=\s*\$true')) "4e) por defecto DnsPublicoRespaldo = false (apagado) y RutaPorIp = true"

  # 5) REPARAR (script real, como administrador): vacia la memoria DNS y anota; con DnsPublicoRespaldo apagado no toca el adaptador
  Dice "5) 6 reparar.ps1"
  Poner-Dns-Falso
  Remove-Item "$Datos\registro.txt" -Force -ErrorAction SilentlyContinue
  $pr = Start-Process powershell.exe -WindowStyle Hidden -PassThru -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File "C:\PantallaCliente\6 reparar.ps1" -Silencioso'
  if (-not $pr.WaitForExit(60000)) { Dice "   (Reparar sigue corriendo tras 60 s por el dialogo de identidad; se cierra)"; Stop-Process -Id $pr.Id -Force -ErrorAction SilentlyContinue }
  Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match "PantallaCliente" -and $_.ProcessId -ne $PID } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Volcar "registro.txt tras Reparar" "$Datos\registro.txt" 20
  Ok ((Texto-Seguro "$Datos\registro.txt") -match "Reparar: limpieza de la memoria DNS de Windows: hecha") "5a) Reparar vacio la memoria DNS de Windows (ipconfig /flushdns) y lo anoto"
  Ok ((@((Dns-Del-Adaptador $ad).servidores) -join ",") -eq "127.0.0.1") "5b) con DnsPublicoRespaldo apagado Reparar NO toco el DNS del adaptador"
  Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  # Reparar con DnsPublicoRespaldo = true y como administrador, con el DNS de la red fallando para el facturador: aplica los DNS publicos
  Dice "5c) 6 reparar.ps1 con DnsPublicoRespaldo = true (copia de prueba del kit)"
  New-Item -ItemType Directory -Force C:\kit-dns-reparar | Out-Null; Copy-Item "C:\PantallaCliente\*" C:\kit-dns-reparar -Include *.ps1, *.bat -ErrorAction SilentlyContinue
  $cfgr = Get-Content "C:\kit-dns-reparar\config.ps1" -Raw; Set-Content "C:\kit-dns-reparar\config.ps1" -Value ($cfgr -replace '\$DnsPublicoRespaldo\s*=\s*\$false', '$DnsPublicoRespaldo = $true') -Encoding UTF8
  Bloquear @("exacto:$NOMBRE"); Remove-Item "$Datos\dns respaldo.json" -Force -ErrorAction SilentlyContinue
  $pr2 = Start-Process powershell.exe -WindowStyle Hidden -PassThru -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File "C:\kit-dns-reparar\6 reparar.ps1" -Silencioso'
  if (-not $pr2.WaitForExit(90000)) { Stop-Process -Id $pr2.Id -Force -ErrorAction SilentlyContinue }
  Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match "PantallaCliente|kit-dns-reparar" -and $_.ProcessId -ne $PID } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Volcar "registro.txt tras Reparar (respaldo de DNS activado)" "$Datos\registro.txt" 25
  Ok ((@((Dns-Del-Adaptador $ad).servidores) -join ",") -eq "1.1.1.1,8.8.8.8") "5c) con DnsPublicoRespaldo = true, administrador y el DNS de la red fallando, Reparar fijo los DNS publicos"
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\PantallaCliente\22 dns publico.ps1" -Revertir -Silencioso 2>&1 | Out-Null
  Ok ((@((Dns-Del-Adaptador $ad).servidores) -join ",") -eq "127.0.0.1") "5c) y RESTAURAR DNS lo devuelve como estaba"
  Remove-Item C:\kit-dns-reparar -Recurse -Force -ErrorAction SilentlyContinue
  Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

  # 6) Chrome REAL: ruta por IP (mismo origen) y direccion alterna (otro origen), con el DNS falso
  Dice "6) Chrome real"
  Bloquear @()
  Remove-Item "C:\perfil-ruta*" -Recurse -Force -ErrorAction SilentlyContinue
  Push-Location $aqui
  $nodoOk = (Get-Command node -ErrorAction SilentlyContinue) -and (Test-Path (Join-Path $aqui "node_modules\playwright"))
  if (-not $nodoOk) { Dice "   (falta node o playwright: se omite Chrome real)"; Ok $false "6) Chrome real disponible" }
  else {
    & node "prueba chrome ruta dns.mjs" preparar C:\perfil-ruta 2>&1 | ForEach-Object { Dice ("   " + $_) }; Ok ($LASTEXITCODE -eq 0) "6a) Chrome real con DNS normal: abre el facturador, el service worker guarda la copia y queda una marca en el almacenamiento local"
    Bloquear @("exacto:$NOMBRE")
    $ipChrome = [string]((Diagnosticar-Dns $NOMBRE).ips[0])
    & node "prueba chrome ruta dns.mjs" pin C:\perfil-ruta $ipChrome $SupabaseClave 2>&1 | ForEach-Object { Dice ("   " + $_) }; Ok ($LASTEXITCODE -eq 0) "6b) Chrome real con el DNS fallando: sin la ruta no resuelve; con la IP fijada abre el mismo origen con la sesion y los datos intactos"
    & node "prueba chrome ruta dns.mjs" alterna C:\perfil-ruta $SupabaseClave 2>&1 | ForEach-Object { Dice ("   " + $_) }; Ok ($LASTEXITCODE -eq 0) "6c) Chrome real: la direccion alterna abre, es otro origen y Supabase acepta su origen"
  }
  Pop-Location
  Bloquear @()

  # 7) el latido REAL manda el bloque fac a la base (Supabase falso en 127.0.0.1)
  Dice "7) 11 latido.ps1 real con el estado del facturador"
  $srvPy = @'
import http.server, json, sys
class H(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0)); cuerpo = self.rfile.read(n).decode("utf-8", "replace")
        open(r"C:\dnsfalso\latido-cuerpos.jsonl", "a", encoding="utf-8").write(self.path + " " + cuerpo + "\n")
        r = b'{"ok":true}'; self.send_response(200); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(r))); self.end_headers(); self.wfile.write(r)
    def log_message(self, *a): pass
http.server.HTTPServer(("127.0.0.1", 8777), H).serve_forever()
'@
  Set-Content -LiteralPath "C:\dnsfalso\srv_rpc.py" -Value $srvPy -Encoding UTF8
  Remove-Item "C:\dnsfalso\latido-cuerpos.jsonl" -Force -ErrorAction SilentlyContinue
  $rpc = Start-Process python -ArgumentList @("C:\dnsfalso\srv_rpc.py") -PassThru -WindowStyle Hidden
  Start-Sleep -Seconds 2
  $cfgOrig = [IO.File]::ReadAllBytes("C:\PantallaCliente\config.ps1")
  $cfgT = [Text.Encoding]::UTF8.GetString($cfgOrig).TrimStart([char]0xFEFF) -replace '\$SupabaseUrl\s*=\s*"[^"]*"', '$SupabaseUrl      = "http://127.0.0.1:8777"'
  [IO.File]::WriteAllText("C:\PantallaCliente\config.ps1", $cfgT, (New-Object Text.UTF8Encoding($true)))
  Set-Content -LiteralPath "$Datos\equipo.json" -Value ('{"estacion":"caja-pollos","token":"prueba","enlazada":"2026-11-28T10:00:00","pc":"' + $env:COMPUTERNAME + '"}') -Encoding UTF8
  Guardar-Estado-Facturador ([pscustomobject]@{ ok = $false; motivo = "dns" }) "pin" "$Datos\facturador.json" ([ordered]@{ dns_local_falla = $true; doh_ok = $true; soa = "dns.jomax.net"; rcode = "nxdomain"; alterna_ok = $false; ip = "172.66.47.125" })
  $pl = Lanzar-Normal "latido39" 'powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "C:\PantallaCliente\11 latido.ps1"'
  $t = 0; while ($t -lt 90 -and -not (Test-Path "C:\dnsfalso\latido-cuerpos.jsonl")) { Start-Sleep -Seconds 3; $t += 3 }
  Dice ("   el latido llego a la base falsa tras ~" + $t + " s")
  $cuerpo = Texto-Seguro "C:\dnsfalso\latido-cuerpos.jsonl"
  Dice ("   cuerpo: " + $cuerpo.Substring(0, [Math]::Min(1500, $cuerpo.Length)))
  Ok ($cuerpo -match "equipo_latido") "7a) el latido llamo a equipo_latido"
  Ok ($cuerpo -match '"fac":\{"ok":false,"modo":"pin","motivo":"dns","edad_s":\d+,"dns_local_falla":true,"doh_ok":true,"alterna_ok":false,"soa":"dns\.jomax\.net","rcode":"nxdomain","ip":"172\.66\.47\.125"\}') "7b) el detalle del latido trae fac con modo, motivo, dns_local_falla, doh_ok, alterna_ok, soa, rcode e ip"
  $ult = ($cuerpo -split "`n" | Where-Object { $_ -like "*equipo_latido*" } | Select-Object -First 1)
  $jsonL = ($ult -replace '^\S+\s+', '') | ConvertFrom-Json
  $bytesDet = [Text.Encoding]::UTF8.GetByteCount(($jsonL.p_datos.detalle | ConvertTo-Json -Depth 6 -Compress))
  Ok ($bytesDet -lt 3000) ("7c) el detalle del latido sigue por debajo del limite de la base (" + $bytesDet + " de 3000 bytes)")
  Stop-Process -Id $pl.Id -Force -ErrorAction SilentlyContinue
  Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match "PantallaCliente" -and $_.ProcessId -ne $PID } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Stop-Process -Id $rpc.Id -Force -ErrorAction SilentlyContinue
  [IO.File]::WriteAllBytes("C:\PantallaCliente\config.ps1", $cfgOrig)
  Remove-Item "$Datos\equipo.json" -Force -ErrorAction SilentlyContinue
  . "C:\PantallaCliente\config.ps1"
  Ok ($SupabaseUrl -like "https://dwlbcbtwdungyrykgahm.supabase.co") "7d) config.ps1 quedo como estaba tras la prueba"

  # 8) el SUPERVISOR REAL como cuenta normal: contingencia -> aparece la ruta -> se reabre con la IP fijada; luego alterna
  Dice "8) Supervisor real (0 abrir caja y pantalla.ps1) como cuenta normal"
  foreach ($f in @("registro.txt", "arranque.txt", "facturador.json", "eventos pendientes.jsonl", "abrir.flag", "facturador ips.json", "dns respaldo.json")) { Remove-Item (Join-Path $Datos $f) -Force -ErrorAction SilentlyContinue }
  Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match "PantallaCliente" -and $_.ProcessId -ne $PID } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 2
  function Pide($metodo, $ruta) {
    $c = New-Object Net.Sockets.TcpClient("127.0.0.1", $PuertoPublicidad); $c.ReceiveTimeout = 8000
    $s = $c.GetStream(); $b = [Text.Encoding]::ASCII.GetBytes($metodo + " " + $ruta + " HTTP/1.1`r`nHost: 127.0.0.1:" + $PuertoPublicidad + "`r`nConnection: close`r`n`r`n"); $s.Write($b, 0, $b.Length)
    $ms = New-Object IO.MemoryStream; $buf = New-Object byte[] 8192
    try { while (($n = $s.Read($buf, 0, 8192)) -gt 0) { $ms.Write($buf, 0, $n) } } catch { $null = 1 }
    $c.Close(); $raw = [Text.Encoding]::UTF8.GetString($ms.ToArray()); $p = $raw -split "`r`n`r`n", 2
    $codigo = 0; if ($raw -match 'HTTP/1\.1 (\d+)') { $codigo = [int]$Matches[1] }
    return [pscustomobject]@{ Codigo = $codigo; Cuerpo = $(if ($p.Count -gt 1) { $p[1] } else { "" }) }
  }
  # todo cortado: DNS de la red para el facturador, DNS publicos (firewall y nombres de DoH), sin memoria de IP
  Bloquear @("exacto:$NOMBRE", "exacto:cloudflare-dns.com", "exacto:dns.google", "exacto:www.dmalabomba.com"); Cortar-Dns-Publicos
  $pn = Lanzar-Normal "supervisor39" 'powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "C:\PantallaCliente\0 abrir caja y pantalla.ps1"'
  $t = 0; $reg = ""
  while ($t -lt 150 -and $reg -notmatch "se abre en modo contingencia") { Start-Sleep -Seconds 3; $t += 3; $reg = Texto-Seguro "$Datos\registro.txt" }
  Dice ("   el supervisor decidio tras ~" + $t + " s")
  Volcar "registro.txt" "$Datos\registro.txt" 25
  Ok ($reg -match "Facturador NO alcanzable \(dns\)\. Modo: contingencia") "8a) sin ninguna ruta (DNS de la red y DNS publicos caidos, sin IP recordada, www cortado): anota la caida y abre en contingencia"
  $e1 = Pide "GET" "/facturador"
  Ok (($e1.Cuerpo -match '"modo":"contingencia"') -and ($e1.Cuerpo -match '"ok":false')) ("8a) /facturador del servidor local: " + $e1.Cuerpo)
  $pc = Pide "GET" "/contingencia/"
  Ok (($pc.Codigo -eq 200) -and ($pc.Cuerpo -match 'id="dnsx"')) "8a) la pantalla de contingencia trae el aviso de falla de DNS"
  # primero la memoria de IP: la ultima IP buena (se escribe como lo haria un sondeo bueno) y se abren los DNS publicos: aparece una ruta
  Abrir-Dns-Publicos
  Bloquear @("exacto:$NOMBRE")
  $t = 0; while ($t -lt 240 -and $reg -notmatch "Se reabre la caja por la ruta nueva") { Start-Sleep -Seconds 5; $t += 5; $reg = Texto-Seguro "$Datos\registro.txt" }
  Dice ("   la vigilancia reabrio tras ~" + $t + " s")
  Volcar "registro.txt (tras abrir los DNS publicos)" "$Datos\registro.txt" 25
  Ok ($reg -match "Aparecio una ruta al facturador \((pin|alterna)") "8b) en contingencia, al aparecer una ruta la vigilancia lo detecta"
  Ok ($reg -match "Se reabre la caja por la ruta nueva") "8b) y reabre la caja sola (solo hay la pantalla local, nada de la cajera)"
  Start-Sleep -Seconds 20; $reg = Texto-Seguro "$Datos\registro.txt"
  Ok ($reg -match "Ruta por IP: facturacion\.dmalabomba\.com fijado a \d+\.\d+\.\d+\.\d+") "8b) al reabrir, el navegador se abre con el nombre fijado a la IP (mismo origen)"
  $e2 = Pide "GET" "/facturador"
  Ok (($e2.Cuerpo -match '"modo":"pin"') -and ($e2.Cuerpo -match '"dns_local_falla":true')) ("8b) /facturador: modo pin y dns_local_falla (" + $e2.Cuerpo + ")")
  $chr = @(Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*PantallaCliente*" })
  if ($chr.Count) { Ok (@($chr | Where-Object { $_.CommandLine -like '*--host-resolver-rules="MAP facturacion.dmalabomba.com *' }).Count -ge 1) ("8b) el Chrome del kit corre con --host-resolver-rules (" + $chr.Count + " procesos)") }
  else { Dice "   (Chrome no quedo corriendo para la cuenta normal sin escritorio: la linea de comandos se verifica en las pruebas de funciones y en el Chrome real de 6b)" }
  # eventos al panel
  $t = 0; $ev = ""; while ($t -lt 60 -and ($ev -notmatch "no alcanzable desde esta caja")) { Start-Sleep -Seconds 3; $t += 3; $ev = Texto-Seguro "$Datos\eventos pendientes.jsonl" }
  Volcar "eventos pendientes.jsonl" "$Datos\eventos pendientes.jsonl" 6
  Ok (@([regex]::Matches($ev, "no alcanzable desde esta caja")).Count -eq 1) "8c) un solo aviso para el panel por toda la caida"
  # vuelve el DNS de la red: el estado pasa a ok y avisa una vez (la ventana pinned sigue sin tocarse)
  Bloquear @()
  $t = 0; $ok2 = $false; while ($t -lt 90 -and -not $ok2) { Start-Sleep -Seconds 3; $t += 3; $ok2 = ((Pide "GET" "/facturador").Cuerpo -match '"ok":true') }
  Ok $ok2 ("8d) al volver el DNS de la red el estado del facturador pasa a ok (tras ~" + $t + " s)")
  Ok ((Texto-Seguro "$Datos\eventos pendientes.jsonl") -match "alcanzable de nuevo desde esta caja") "8d) aviso de restablecido"
  Stop-Process -Id $pn.Id -Force -ErrorAction SilentlyContinue
  Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match "PantallaCliente" -and $_.ProcessId -ne $PID } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

  # 8e) supervisor: ruta alterna (DNS publicos caidos, sin IP, www si resuelve)
  Dice "8e) Supervisor real: direccion alterna"
  foreach ($f in @("registro.txt", "arranque.txt", "facturador.json", "eventos pendientes.jsonl", "facturador ips.json")) { Remove-Item (Join-Path $Datos $f) -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 2
  Bloquear @("exacto:$NOMBRE", "exacto:cloudflare-dns.com", "exacto:dns.google"); Cortar-Dns-Publicos
  $pn2 = Lanzar-Normal "supervisor39b" 'powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "C:\PantallaCliente\0 abrir caja y pantalla.ps1"'
  $t = 0; $reg = ""
  while ($t -lt 150 -and $reg -notmatch "Direccion alterna: se abre") { Start-Sleep -Seconds 3; $t += 3; $reg = Texto-Seguro "$Datos\registro.txt" }
  Volcar "registro.txt (alterna)" "$Datos\registro.txt" 20
  Ok ($reg -match "Facturador NO alcanzable \(dns\)\. Modo: alterna") "8e) sin IP y con www resolviendo: modo alterna"
  Ok ($reg -match "Direccion alterna: se abre https://www\.dmalabomba\.com/facturacion/") "8e) abre la direccion alterna"
  $pa = Pide "GET" "/alterna/"
  Ok (($pa.Codigo -eq 200) -and ($pa.Cuerpo -match "Se abrir&aacute; la direcci&oacute;n alterna") -and ($pa.Cuerpo -match 'var DEST = "https://www\.dmalabomba\.com/facturacion/";')) "8e) el servidor local sirve el aviso /alterna/ con el destino correcto"
  $e3 = Pide "GET" "/facturador"
  Ok (($e3.Cuerpo -match '"modo":"alterna"') -and ($e3.Cuerpo -match '"alterna_ok":true') -and ($e3.Cuerpo -match '"dns_local_falla":false')) ("8e) /facturador: modo alterna y alterna_ok (" + $e3.Cuerpo + ")")
  # el DNS de la red vuelve: la caja sigue en la alterna hasta la proxima apertura (no se toca la ventana)
  Abrir-Dns-Publicos; Bloquear @()
  $t = 0; $ok3 = $false; while ($t -lt 90 -and -not $ok3) { Start-Sleep -Seconds 3; $t += 3; $ok3 = ((Pide "GET" "/facturador").Cuerpo -match '"ok":true') }
  $e4 = Pide "GET" "/facturador"
  Ok ($ok3 -and ($e4.Cuerpo -match '"modo":"alterna"')) ("8f) el subdominio vuelve a responder pero la ventana sigue en la alterna sin tocarse (" + $e4.Cuerpo + ")")
  # proxima apertura: el icono Facturador (abrir.flag): vuelve al subdominio
  Set-Content -LiteralPath "$Datos\abrir.flag" -Value (Get-Date).ToString("s")
  $t = 0; $ok4 = $false; while ($t -lt 90 -and -not $ok4) { Start-Sleep -Seconds 3; $t += 3; $ok4 = ((Pide "GET" "/facturador").Cuerpo -match '"modo":"normal"') }
  Volcar "registro.txt (vuelta al subdominio)" "$Datos\registro.txt" 12
  Ok $ok4 ("8g) con el icono Facturador (proxima apertura) la caja vuelve al subdominio (modo normal) tras ~" + $t + " s")
  Stop-Process -Id $pn2.Id -Force -ErrorAction SilentlyContinue
} catch { Ok $false ("EXCEPCION: " + $_.Exception.Message + " (linea " + $_.InvocationInfo.ScriptLineNumber + ")") }
finally {
  Abrir-Dns-Publicos
  Restaurar-Dns-Original
  Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match "PantallaCliente" -and $_.ProcessId -ne $PID } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  if ($py) { Stop-Process -Id $py.Id -Force -ErrorAction SilentlyContinue }
  Volcar "consultas del DNS falso (ultimas)" "C:\dnsfalso\consultas.log" 15
  Dice ("DNS del adaptador al terminar: " + ((Dns-Del-Adaptador $ad).servidores -join ", "))
}
Dice ("RESULTADO: " + ($script:Pasos - $script:Fallos) + " de " + $script:Pasos + " comprobaciones correctas; fallos: " + $script:Fallos)
if ($script:Fallos -gt 0 -or $malos -gt 0) { exit 1 }
exit 0
