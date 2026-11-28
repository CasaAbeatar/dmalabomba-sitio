# REGRESION: la prueba completa del kit v3.8 aplicada al kit v3.9 (todo lo anterior debe seguir igual). Prueba del kit v3 en Windows PowerShell 5.1 real (ejecutor de GitHub). Simula la PC de caja: administrador instala, cuenta normal usa.
$ErrorActionPreference = "Continue"
$aqui = Split-Path -Parent $MyInvocation.MyCommand.Path
$origen = (Resolve-Path (Join-Path $aqui "..\kit pc caja\v3.9 respaldo DNS 28 nov")).Path
$res = Join-Path $aqui "resultados"; New-Item -ItemType Directory -Force $res | Out-Null
$sal = Join-Path $res "prueba kit regresion v3.9.txt"
function Dice($t) { $l = "{0:HH:mm:ss}  {1}" -f (Get-Date), $t; Write-Host $l; Add-Content -LiteralPath $sal -Value $l }
function Volcar($titulo, $ruta) { Dice ("--- " + $titulo + " (" + $ruta + ")"); if (Test-Path -LiteralPath $ruta) { foreach ($x in @(Get-Content -LiteralPath $ruta -ErrorAction SilentlyContinue)) { Dice ("    " + $x) } } else { Dice "    (no existe)" } }
Dice ("Windows PowerShell " + $PSVersionTable.PSVersion + " en " + [Environment]::OSVersion.VersionString)
Dice ("Usuario del ejecutor: " + $env:USERNAME + " administrador: " + ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))

# 1) sintaxis con el parser de 5.1
$malos = 0
foreach ($f in Get-ChildItem $origen -Filter *.ps1) { $e = $null; $t = $null; [void][System.Management.Automation.Language.Parser]::ParseFile($f.FullName, [ref]$t, [ref]$e); if ($e.Count) { $malos++; Dice ("SINTAXIS " + $f.Name + ": " + $e[0].Message + " L" + $e[0].Extent.StartLineNumber) } }
Dice ("1) Archivos con error de sintaxis en 5.1: " + $malos)

# 2) cuenta normal de prueba (la cajera)
$clave = "Kp-2026-xZ9!q"
$r = net user cajaprueba $clave /add 2>&1; Dice ("2) net user: " + ($r -join " "))
Dice ("   existe: " + ((net user cajaprueba 2>&1) -join " ").Substring(0, 120))
Dice ("   servicio Programador de tareas: " + (Get-Service Schedule).Status + "; seclogon: " + (Get-Service seclogon).Status)

# 3) instalar la copia y los permisos con el script REAL del kit, como administrador
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $origen "1 crear accesos y arranque automatico.ps1") -Silencioso 2>&1 | ForEach-Object { Dice ("   paso1: " + $_) }
Dice ("3) Archivos copiados a C:\PantallaCliente: " + @(Get-ChildItem C:\PantallaCliente -File -ErrorAction SilentlyContinue).Count)
Dice ("   ACL de la raiz: " + ((& icacls.exe C:\PantallaCliente 2>&1) -join " | "))
Dice ("   ACL de datos:   " + ((& icacls.exe C:\PantallaCliente\datos 2>&1) -join " | "))
Dice ("   ACL de 11 latido: " + ((& icacls.exe "C:\PantallaCliente\11 latido.ps1" 2>&1) -join " | "))

# ayudante: correr algo como la cuenta normal (tarea programada, sin privilegios)
function Como-Normal($nombre, $comando, $segundos) {
  $o = "C:\Windows\Temp\salida-$nombre.txt"; Remove-Item $o -Force -ErrorAction SilentlyContinue
  $bat = "C:\Windows\Temp\corre-$nombre.cmd"
  Set-Content -LiteralPath $bat -Value ('@echo off' + "`r`n" + $comando + ' > "' + $o + '" 2>&1')
  icacls.exe $bat /grant "cajaprueba:(RX)" 2>&1 | Out-Null
  icacls.exe C:\Windows\Temp /grant "cajaprueba:(OI)(CI)M" 2>&1 | Out-Null
  Set-Service seclogon -StartupType Manual -ErrorAction SilentlyContinue; Start-Service seclogon -ErrorAction SilentlyContinue
  $cred = New-Object System.Management.Automation.PSCredential(($env:COMPUTERNAME + "\cajaprueba"), (ConvertTo-SecureString $clave -AsPlainText -Force))
  $t = 0
  try {
    $pr = Start-Process -FilePath "cmd.exe" -ArgumentList ('/c "' + $bat + '"') -Credential $cred -WorkingDirectory "C:\Windows\Temp" -LoadUserProfile -WindowStyle Hidden -PassThru -ErrorAction Stop
    if (-not $pr.WaitForExit($segundos * 1000)) { Dice "   (sigue corriendo tras el tiempo; se cierra)"; Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $pr.Id } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; Stop-Process -Id $pr.Id -Force -ErrorAction SilentlyContinue }
    $t = $segundos
  } catch { Dice ("   NO SE PUDO LANZAR COMO CUENTA NORMAL: " + $_.Exception.Message) }
  Dice ("   [" + $nombre + "] terminado tras ~" + $t + " s")
  if (Test-Path $o) { foreach ($x in @(Get-Content $o)) { Dice ("      " + $x) } }
}

# 4) lo que puede hacer la cuenta normal en los archivos del kit
Dice "4) Cuenta normal: quien es, que puede leer y escribir"
Como-Normal "perm" 'whoami /groups /fo csv /nh | findstr /i "Administrators Users" & echo escribe-datos: & (echo x > C:\PantallaCliente\datos\prueba-normal.txt) && echo SI || echo NO & type "C:\PantallaCliente\config.ps1" | find /c /v "" & icacls "C:\PantallaCliente\datos\prueba-normal.txt"' 60

# 5) EL CANDADO: una copia con privilegios de administrador lo crea; la cuenta normal intenta usarlo
Dice "5) Candado creado por administrador (estilo VIEJO Global con permisos por defecto) y abierto por la cuenta normal"
$viejo = Start-Process powershell.exe -WindowStyle Hidden -PassThru -ArgumentList '-NoProfile -Command "$m = New-Object Threading.Mutex($false, ''Global\PruebaViejo''); [void]$m.WaitOne(0); Start-Sleep 90"'
Start-Sleep -Seconds 6
Como-Normal "mviejo" 'powershell -NoProfile -Command "try { $m = New-Object Threading.Mutex($false, ''Global\PruebaViejo''); \"abrio: $($m.WaitOne(0))\" } catch { \"EXCEPCION: \" + $_.Exception.GetType().Name + \" \" + $_.Exception.Message }"' 60
Dice "5b) Candado NUEVO (Crear-Mutex de la v3.2c) creado por administrador y abierto por la cuenta normal"
$nuevo = Start-Process powershell.exe -WindowStyle Hidden -PassThru -ArgumentList '-NoProfile -ExecutionPolicy Bypass -Command ". C:\PantallaCliente\config.ps1; $c = Crear-Mutex ''Local\PruebaNuevo''; Start-Sleep 90"'
Start-Sleep -Seconds 8
Como-Normal "mnuevo" 'powershell -NoProfile -ExecutionPolicy Bypass -Command ". C:\PantallaCliente\config.ps1; $c = Crear-Mutex ''Local\PruebaNuevo''; \"tengo=$($c.Tengo) motivo=$($c.Motivo)\""' 60
Stop-Process -Id $viejo.Id, $nuevo.Id -Force -ErrorAction SilentlyContinue

# 6) el latido como cuenta normal, 30 s: debe dejar arranque.txt y latido.txt
Dice "6) 11 latido.ps1 como cuenta normal"
Remove-Item C:\PantallaCliente\datos\latido.txt, C:\PantallaCliente\datos\arranque.txt -Force -ErrorAction SilentlyContinue
Como-Normal "latido" 'powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "C:\PantallaCliente\11 latido.ps1"' 30
Volcar "arranque.txt" "C:\PantallaCliente\datos\arranque.txt"
Volcar "latido.txt" "C:\PantallaCliente\datos\latido.txt"

# 7) abrir caja como cuenta normal, 40 s: no hay pantalla ni sesion, pero debe llegar a su registro
Dice "7) 0 abrir caja y pantalla.ps1 como cuenta normal"
Remove-Item C:\PantallaCliente\datos\arranque.txt, C:\PantallaCliente\datos\registro.txt -Force -ErrorAction SilentlyContinue
Como-Normal "caja" 'powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "C:\PantallaCliente\0 abrir caja y pantalla.ps1"' 40
Volcar "arranque.txt" "C:\PantallaCliente\datos\arranque.txt"
Volcar "registro.txt" "C:\PantallaCliente\datos\registro.txt"
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match "PantallaCliente" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

# 8) v3.3: ventanas ocultas, terminal predeterminada, accesos, ficha del equipo
Dice "8) v3.3"
. "C:\PantallaCliente\config.ps1"; . "C:\PantallaCliente\funciones.ps1"; . "C:\PantallaCliente\17 ficha del equipo.ps1"
Dice ("   version del kit: " + $VersionKit)
Dice ("   terminal predeterminada: " + (Arreglar-Terminal-Predeterminada) + " | segunda vez: " + (Arreglar-Terminal-Predeterminada))
Dice ("   conhost existe: " + (Test-Path "$env:SystemRoot\System32\conhost.exe"))
foreach ($l in @("Latido.lnk", "Facturador.lnk")) { $lnk = Join-Path ([Environment]::GetFolderPath("CommonStartup")) $l; if (Test-Path $lnk) { $a = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk); Dice ("   acceso " + $l + ": " + $a.TargetPath + " " + $a.Arguments) } else { Dice ("   FALTA el acceso " + $l) } }
$marca = "C:\Windows\Temp\oculto-prueba.txt"; Remove-Item $marca -Force -ErrorAction SilentlyContinue
Set-Content -LiteralPath "C:\Windows\Temp\oculto-prueba.ps1" -Value '"viva " + (Get-Date).ToString("s") | Set-Content C:\Windows\Temp\oculto-prueba.txt; Start-Sleep -Seconds 12'
$pr = Lanzar-Oculto "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File C:\Windows\Temp\oculto-prueba.ps1" -PassThru
$t = 0; while (-not (Test-Path $marca) -and $t -lt 20) { Start-Sleep -Seconds 1; $t++ }
Dice ("   Lanzar-Oculto: el script corrio = " + (Test-Path $marca) + " (en " + $t + " s)")
$ps = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -like "*oculto-prueba.ps1*" } | Select-Object -First 1
if ($ps) { $gp = Get-Process -Id $ps.ProcessId -ErrorAction SilentlyContinue; Dice ("   powershell oculto: pid " + $ps.ProcessId + ", ventana principal = " + $gp.MainWindowHandle + ", padre = " + (Get-Process -Id $ps.ParentProcessId -ErrorAction SilentlyContinue).ProcessName) } else { Dice "   no se vio el powershell oculto" }
Dice "   Ficha-Equipo:"
$sw = [Diagnostics.Stopwatch]::StartNew()
$ficha = Ficha-Equipo
$sw.Stop()
$json = $ficha | ConvertTo-Json -Depth 8 -Compress
Dice ("   ficha lista en " + $sw.ElapsedMilliseconds + " ms, " + [Text.Encoding]::UTF8.GetByteCount($json) + " bytes (limite de la base 32768)")
foreach ($k in $ficha.Keys) { $v = $ficha[$k]; $n = $null; if ($v -is [System.Collections.IDictionary]) { $n = @($v.Keys | Where-Object { $null -eq $v[$_] }).Count; Dice ("     " + $k + ": " + $v.Count + " datos, " + $n + " vacios") } else { Dice ("     " + $k + ": " + $(if ($null -eq $v) { "VACIO" } elseif ($v -is [array]) { "" + $v.Count + " elementos" } else { $v })) } }
Set-Content -LiteralPath (Join-Path $res "ficha-ejemplo.json") -Value $json -Encoding UTF8
Dice ("   Cliente-cerrado y cursor: el supervisor ya no mueve el mouse = " + (-not (Select-String -LiteralPath "C:\PantallaCliente\0 abrir caja y pantalla.ps1" -Pattern 'Cursor\]::Position = ' -Quiet)))
Dice ("   Supervisor reconoce cierre a mano = " + (Select-String -LiteralPath "C:\PantallaCliente\0 abrir caja y pantalla.ps1" -Pattern 'clienteCerradoAMano' -Quiet))
Stop-Process -Id $pr.Id -Force -ErrorAction SilentlyContinue
Dice "   v3.4: metricas por latido, version del facturador, ficha en proceso aparte"
$swm = [Diagnostics.Stopwatch]::StartNew(); $met = Metricas-Rapidas; $swm.Stop()
Dice ("   Metricas-Rapidas (" + $swm.ElapsedMilliseconds + " ms): " + ($met | ConvertTo-Json -Compress))
Dice ("   Version-Facturador: " + (Version-Facturador))
foreach ($k in @("encendidos_y_fallos", "cola_impresion", "servicios", "arranque_de_windows", "tareas_programadas_no_microsoft", "energia")) { Dice ("   " + $k + ": " + ($ficha[$k] | ConvertTo-Json -Compress -Depth 4)) }
Dice ("   kit.integridad_archivos: " + @($ficha["kit"]["integridad_archivos"].Keys).Count + " archivos con huella; servicios_del_kit: " + (($ficha["kit"]["servicios_del_kit"]) -join ", "))
Dice ("   variables.calidad_red: " + ($ficha["variables"]["calidad_red"] | ConvertTo-Json -Compress -Depth 4))
Remove-Item "C:\PantallaCliente\datos\ficha.txt" -Force -ErrorAction SilentlyContinue
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\PantallaCliente\18 enviar ficha.ps1" 2>&1 | ForEach-Object { Dice ("   18: " + $_) }
Volcar "ficha.txt (sin identidad, debe decirlo)" "C:\PantallaCliente\datos\ficha.txt"
$lat = Get-Content "C:\PantallaCliente\11 latido.ps1" -Raw
Dice ("   latido usa 18 enviar ficha en proceso aparte = " + ($lat -match '18 enviar ficha') + "; manda version_facturador = " + ($lat -match 'version_facturador'))
Dice "   v3.4: navegacion (solo la prueba, con un historial de Chrome inventado)"
. "C:\PantallaCliente\19 navegacion.ps1"
$hf = Join-Path $Perfil "Default\History"
New-Item -ItemType Directory -Force -Path (Split-Path $hf) | Out-Null
Remove-Item -LiteralPath $hf -Force -ErrorAction SilentlyContinue
$ahora = [long](([DateTime]::UtcNow - [DateTime]::new(1601, 1, 1, 0, 0, 0, [DateTimeKind]::Utc)).TotalMilliseconds * 1000)
[LbSqlite]::Exec($hf, "create table urls(id integer primary key, url text, title text, visit_count integer, last_visit_time integer); create table visits(id integer primary key, url integer, visit_time integer); insert into urls values (1,'https://www.facebook.com/marketplace?x=1','Marketplace',3,$ahora),(2,'https://dmalabomba.com/facturacion/','Facturador',9,$ahora),(3,'https://www.google.com/search?q=pollos+baratos+heredia&hl=es','pollos baratos heredia - Google',1,$ahora),(4,'chrome://settings','Config',1,$ahora); insert into visits values (1,1,$ahora),(2,1,$ahora-1000000),(3,2,$ahora-2000000),(4,3,$ahora-3000000),(5,4,$ahora-4000000)")
$rn = Sitios-Visitados 24
Dice ("   historiales leidos: " + $rn.Historiales + "; sitios: " + (($rn.Sitios | ForEach-Object { $_.sitio + "=" + $_.veces + $(if ($_.permitido) { " (permitido)" } else { " (FUERA)" }) }) -join ", "))
Dice ("   visitas con detalle: " + @($rn.Visitas).Count + " | " + (($rn.Visitas | ForEach-Object { $_.url + " [" + $_.titulo + "] busqueda='" + $_.busqueda + "'" }) -join " ; "))
Remove-Item -LiteralPath $hf -Force -ErrorAction SilentlyContinue
Remove-Item "C:\PantallaCliente\datos\navegacion.txt" -Force -ErrorAction SilentlyContinue
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\PantallaCliente\19 navegacion.ps1" 2>&1 | ForEach-Object { Dice ("   19: " + $_) }
Volcar "navegacion.txt (sin identidad, debe decirlo)" "C:\PantallaCliente\datos\navegacion.txt"
Dice ("   latido lanza 19 navegacion = " + ($lat -match '19 navegacion'))
Dice "   v3.5: extensiones del navegador (paso 16 con el script REAL, dos veces para comprobar que es idempotente)"
$id = "inomeogfingihgjfjlpeplalcfajhgai"
$fallos16 = 0
foreach ($vuelta in 1..2) { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $origen "16 bloquear instalaciones.ps1") -Silencioso 2>&1 | ForEach-Object { Dice ("   16 (vuelta " + $vuelta + "): " + $_) } }
function Valor-Reg($ruta) { if (Test-Path $ruta) { $p = Get-ItemProperty -Path $ruta; @($p.PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' } | ForEach-Object { $_.Name + "=" + $_.Value }) } else { @("(no existe)") } }
$cB = @(Valor-Reg "HKLM:\SOFTWARE\Policies\Google\Chrome\ExtensionInstallBlocklist")
$cA = @(Valor-Reg "HKLM:\SOFTWARE\Policies\Google\Chrome\ExtensionInstallAllowlist")
$eB = @(Valor-Reg "HKLM:\SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallBlocklist")
$eA = @(Valor-Reg "HKLM:\SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallAllowlist")
Dice ("   Chrome Blocklist: " + ($cB -join ", ") + " | Chrome Allowlist: " + ($cA -join ", "))
Dice ("   Edge Blocklist: " + ($eB -join ", ") + " | Edge Allowlist: " + ($eA -join ", "))
if (-not (($cB.Count -eq 1) -and ($cB[0] -eq "1=*"))) { $fallos16++; Dice "   FALLO: Chrome Blocklist debe ser exactamente 1=*" }
if (-not (($cA.Count -eq 1) -and ($cA[0] -eq ("1=" + $id)))) { $fallos16++; Dice "   FALLO: Chrome Allowlist debe ser exactamente 1=<Chrome Remote Desktop>" }
if (-not (($eB.Count -eq 1) -and ($eB[0] -eq "1=*"))) { $fallos16++; Dice "   FALLO: Edge Blocklist debe ser exactamente 1=*" }
if (-not ($eA.Count -eq 1 -and $eA[0] -eq "(no existe)")) { $fallos16++; Dice "   FALLO: Edge no debe tener Allowlist" }
Dice ("16) Extensiones: " + $(if ($fallos16 -eq 0) { "OK (Chrome permite solo Chrome Remote Desktop y bloquea el resto; Edge bloqueo total)" } else { "FALLO (" + $fallos16 + ")" }))
Dice "v3.6: el kit apunta al subdominio facturacion.dmalabomba.com (21 nov)"
$script:fallos36 = 0
function Chequea($nombre, $ok, $detalle) { if ($ok) { Dice ("   OK     " + $nombre + $(if ($detalle) { " : " + $detalle } else { "" })) } else { $script:fallos36++; Dice ("   FALLO  " + $nombre + $(if ($detalle) { " : " + $detalle } else { "" })) } }
# a) config.ps1 instalado (el que usa la caja)
Chequea "UrlCaja" ($UrlCaja -eq "https://facturacion.dmalabomba.com/") $UrlCaja
Chequea "UrlCliente" ($UrlCliente -eq "https://facturacion.dmalabomba.com/cliente/") $UrlCliente
Chequea "Sitios (dos origenes, subdominio primero)" ((@($Sitios).Count -eq 2) -and ($Sitios[0] -eq "https://facturacion.dmalabomba.com") -and ($Sitios[1] -eq "https://www.dmalabomba.com")) (@($Sitios) -join " ; ")
Chequea "Sitio es el primero de Sitios" ($Sitio -eq $Sitios[0]) $Sitio
Chequea "VersionKit" ($VersionKit -eq "3.9 respaldo DNS 28nov") $VersionKit
$cfgTexto = Get-Content -LiteralPath (Join-Path $origen "config.ps1") -Raw
Chequea "config.ps1 ya no nombra la direccion vieja dmalabomba.com/facturacion" (-not ($cfgTexto -match 'https://(www\.)?dmalabomba\.com/facturacion')) ""
$leeme = Get-Content -LiteralPath (Join-Path $origen "LEEME v3.txt") -Raw -Encoding UTF8
Chequea "LEEME dice v3.9, conserva lo de la v3.8, conserva lo de la v3.7 y lo de la v3.6 (subdominio y que la cajera vuelve a entrar)" (($leeme -match 'KIT v3\.9') -and ($leeme -match 'KIT v3\.8') -and ($leeme -match 'KIT v3\.7') -and ($leeme -match 'KIT v3\.6') -and ($leeme -match 'facturacion\.dmalabomba\.com') -and ($leeme -match 'volver a entrar')) ""
# ningun script ni .bat del kit debe quedar con la direccion vieja
$viejos = @(Get-ChildItem $origen -Include *.ps1, *.bat -Recurse | Where-Object { (Get-Content -LiteralPath $_.FullName -Raw) -match 'https?://(www\.)?dmalabomba\.com/facturacion' } | ForEach-Object { $_.Name })
Chequea "Ningun archivo del kit apunta a dmalabomba.com/facturacion" ($viejos.Count -eq 0) ($viejos -join ", ")
# b) titulo de la ventana del cliente mientras carga
Chequea "Es-Titulo-Cliente reconoce la direccion nueva mientras carga" ((Es-Titulo-Cliente "facturacion.dmalabomba.com/cliente/") -and (Es-Titulo-Cliente "Pantalla del cliente - Soda La Bomba") -and (Es-Titulo-Cliente "dmalabomba.com/facturacion/cliente/")) ""
Chequea "Es-Titulo-Cliente NO toma la caja por cliente" (-not (Es-Titulo-Cliente "Facturacion - Soda La Bomba")) ""
# c) sitios permitidos (no cuentan como salir del sistema)
Chequea "SitiosPermitidos cubre facturacion.dmalabomba.com, www y el apex" ((Es-Permitido "facturacion.dmalabomba.com") -and (Es-Permitido "www.dmalabomba.com") -and (Es-Permitido "dmalabomba.com")) ""
Chequea "SitiosPermitidos NO cubre sitios ajenos ni parecidos" ((-not (Es-Permitido "ejemplo.com")) -and (-not (Es-Permitido "evildmalabomba.com")) -and (-not (Es-Permitido "dmalabomba.com.ejemplo.com"))) ""
# d) directivas de Chrome y Edge: se simula una caja con la v3.5 (un solo origen, el apex, y un valor sobrante) y se instala encima con el paso 5 REAL
$listas36 = @("WindowManagementAllowedForUrls", "PopupsAllowedForUrls", "AutomaticFullscreenAllowedForUrls", "LocalNetworkAccessAllowedForUrls")
foreach ($marca in @("Google\Chrome", "Microsoft\Edge")) { foreach ($lista in $listas36) { $ru = "HKLM:\SOFTWARE\Policies\$marca\$lista"; New-Item -Path $ru -Force | Out-Null; New-ItemProperty -Path $ru -Name "1" -Value "https://dmalabomba.com" -PropertyType String -Force | Out-Null; New-ItemProperty -Path $ru -Name "3" -Value "https://sobrante.ejemplo.com" -PropertyType String -Force | Out-Null } }
Dice ("   estado simulado de una caja con v3.5: Chrome WindowManagementAllowedForUrls = " + ((Valor-Reg "HKLM:\SOFTWARE\Policies\Google\Chrome\WindowManagementAllowedForUrls") -join ", "))
foreach ($vuelta in 1..2) { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $origen "5 pantallas y permiso de ventanas.ps1") -Silencioso 2>&1 | ForEach-Object { Dice ("   5 (vuelta " + $vuelta + "): " + $_) } }
$esperado = @("1=https://facturacion.dmalabomba.com", "2=https://www.dmalabomba.com")
foreach ($marca in @("Google\Chrome", "Microsoft\Edge")) { foreach ($lista in $listas36) {
  $v = @(Valor-Reg "HKLM:\SOFTWARE\Policies\$marca\$lista")
  Chequea ("Directiva " + $marca + "\" + $lista) (($v.Count -eq 2) -and ($v[0] -eq $esperado[0]) -and ($v[1] -eq $esperado[1])) ($v -join ", ")
} }
$otras = @(Valor-Reg "HKLM:\SOFTWARE\Policies\Google\Chrome" | Where-Object { ($_ -eq "TranslateEnabled=0") -or ($_ -eq "MetricsReportingEnabled=0") })
Chequea "El paso 5 sigue dejando los ajustes de menos avisos de Chrome" ($otras.Count -eq 2) ($otras -join ", ")
# e) servidor de publicidad local: 200 a los dos origenes, 403 a uno ajeno, con el CORS correcto
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -like "*servidor publicidad*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2
Remove-Item "C:\PantallaCliente\datos\arranque.txt" -Force -ErrorAction SilentlyContinue
$srv = Start-Process powershell.exe -WindowStyle Hidden -PassThru -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File "C:\PantallaCliente\servidor publicidad.ps1"'
$t = 0; $arriba = $false
while (-not $arriba -and $t -lt 40) { try { $tc = New-Object Net.Sockets.TcpClient; $tc.Connect("127.0.0.1", $PuertoPublicidad); $arriba = $tc.Connected; $tc.Close() } catch { Start-Sleep -Seconds 1; $t++ } }
Chequea "El servidor de publicidad abre el puerto $PuertoPublicidad" $arriba ("en " + $t + " s")
if (-not $arriba) { Volcar "arranque.txt (el servidor no arranco)" "C:\PantallaCliente\datos\arranque.txt" }
function Http-Crudo($texto) {
  $c = New-Object Net.Sockets.TcpClient("127.0.0.1", $PuertoPublicidad); $c.ReceiveTimeout = 8000
  $s = $c.GetStream(); $b = [Text.Encoding]::ASCII.GetBytes($texto); $s.Write($b, 0, $b.Length)
  $ms = New-Object IO.MemoryStream; $buf = New-Object byte[] 8192
  try { while (($n = $s.Read($buf, 0, 8192)) -gt 0) { $ms.Write($buf, 0, $n) } } catch { $null = 1 }
  $c.Close()
  $raw = [Text.Encoding]::UTF8.GetString($ms.ToArray())
  $partes = $raw -split "`r`n`r`n", 2
  $lin = $partes[0] -split "`r`n"
  $h = @{}; foreach ($l in ($lin | Select-Object -Skip 1)) { $i = $l.IndexOf(":"); if ($i -gt 0) { $h[$l.Substring(0, $i).Trim().ToLower()] = $l.Substring($i + 1).Trim() } }
  $codigo = 0; if ($lin[0] -match 'HTTP/1\.1 (\d+)') { $codigo = [int]$Matches[1] }
  return [pscustomobject]@{ Codigo = $codigo; Cab = $h; Cuerpo = $(if ($partes.Count -gt 1) { $partes[1] } else { "" }) }
}
function Pide($metodo, $ruta, $origenHttp, $host_) {
  $p = $metodo + " " + $ruta + " HTTP/1.1`r`nHost: " + $host_ + "`r`n"
  if ($origenHttp) { $p += "Origin: " + $origenHttp + "`r`n" }
  $p += "Connection: close`r`n`r`n"
  return (Http-Crudo $p)
}
$hostOk = "127.0.0.1:" + $PuertoPublicidad
$nuevoSitio = "https://facturacion.dmalabomba.com"; $viejoSitio = "https://www.dmalabomba.com"; $ajeno = "https://ejemplo.com"
$r1 = Pide "GET" "/salud" $nuevoSitio $hostOk
Chequea "GET /salud con Origin del subdominio: 200 y CORS = ese origen" (($r1.Codigo -eq 200) -and ($r1.Cab["access-control-allow-origin"] -eq $nuevoSitio) -and ($r1.Cuerpo -eq "ok")) ("codigo " + $r1.Codigo + ", ACAO " + $r1.Cab["access-control-allow-origin"] + ", vary " + $r1.Cab["vary"])
$r2 = Pide "GET" "/salud" $viejoSitio $hostOk
Chequea "GET /salud con Origin www: 200 y CORS = ese origen" (($r2.Codigo -eq 200) -and ($r2.Cab["access-control-allow-origin"] -eq $viejoSitio)) ("codigo " + $r2.Codigo + ", ACAO " + $r2.Cab["access-control-allow-origin"])
$r3 = Pide "GET" "/salud" $ajeno $hostOk
Chequea "GET /salud con Origin ajeno: 403 y sin CORS para ese origen" (($r3.Codigo -eq 403) -and ($r3.Cab["access-control-allow-origin"] -ne $ajeno)) ("codigo " + $r3.Codigo + ", ACAO " + $r3.Cab["access-control-allow-origin"])
$r4 = Pide "GET" "/salud" "http://facturacion.dmalabomba.com" $hostOk
Chequea "Origin con http (no https) del subdominio: 403" ($r4.Codigo -eq 403) ("codigo " + $r4.Codigo)
$r5 = Pide "GET" "/salud" "https://facturacion.dmalabomba.com.ejemplo.com" $hostOk
Chequea "Origin parecido (subdominio como prefijo de otro dominio): 403" ($r5.Codigo -eq 403) ("codigo " + $r5.Codigo)
$r6 = Pide "OPTIONS" "/lista" $nuevoSitio $hostOk
Chequea "OPTIONS (preflight) desde el subdominio: 204 y CORS correcto" (($r6.Codigo -eq 204) -and ($r6.Cab["access-control-allow-origin"] -eq $nuevoSitio) -and ($r6.Cab["access-control-allow-private-network"] -eq "true")) ("codigo " + $r6.Codigo + ", ACAO " + $r6.Cab["access-control-allow-origin"] + ", PNA " + $r6.Cab["access-control-allow-private-network"])
$r7 = Pide "OPTIONS" "/lista" $ajeno $hostOk
Chequea "OPTIONS (preflight) desde un origen ajeno: 403" ($r7.Codigo -eq 403) ("codigo " + $r7.Codigo)
New-Item -ItemType Directory -Force -Path (Join-Path $CarpetaPublicidad "Soda") | Out-Null
[IO.File]::WriteAllBytes((Join-Path $CarpetaPublicidad "Soda\prueba-v36.png"), [byte[]](0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0))
$r8 = Pide "GET" "/lista?e=soda" $nuevoSitio $hostOk
Chequea "GET /lista desde el subdominio: 200, JSON con la imagen de prueba y CORS correcto" (($r8.Codigo -eq 200) -and ($r8.Cuerpo -match 'prueba-v36\.png') -and ($r8.Cab["access-control-allow-origin"] -eq $nuevoSitio)) ("codigo " + $r8.Codigo + ", cuerpo " + $r8.Cuerpo.Substring(0, [Math]::Min(120, $r8.Cuerpo.Length)))
$r9 = Pide "GET" "/lista?e=soda" $viejoSitio $hostOk
Chequea "GET /lista desde www: 200 y CORS = www" (($r9.Codigo -eq 200) -and ($r9.Cab["access-control-allow-origin"] -eq $viejoSitio)) ("codigo " + $r9.Codigo)
$r10 = Pide "GET" "/lista?e=soda" $nuevoSitio "ejemplo.com:8766"
Chequea "Host ajeno (rebinding de DNS): 403" ($r10.Codigo -eq 403) ("codigo " + $r10.Codigo)
$r11 = Pide "GET" "/salud" $null $hostOk
Chequea "Sin cabecera Origin (imagen o video directo): 200" ($r11.Codigo -eq 200) ("codigo " + $r11.Codigo + ", ACAO " + $r11.Cab["access-control-allow-origin"])
# f) diagnostico con el servidor funcionando
Remove-Item "C:\PantallaCliente\datos\diagnostico.txt" -Force -ErrorAction SilentlyContinue
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\PantallaCliente\10 diagnostico.ps1" -Silencioso 2>&1 | Out-Null
$diag = @(Get-Content "C:\PantallaCliente\datos\diagnostico.txt" -ErrorAction SilentlyContinue)
$lineaSrv = @($diag | Where-Object { $_ -like "Servidor local:*" })
Chequea "10 diagnostico: servidor local funcionando, probado con el origen del subdominio" (($lineaSrv.Count -eq 1) -and ($lineaSrv[0] -like "*funcionando*") -and ($lineaSrv[0] -like "*https://facturacion.dmalabomba.com*")) ($lineaSrv -join " ")
Chequea "10 diagnostico muestra la version 3.9 respaldo DNS 28nov" (@($diag | Where-Object { $_ -eq "Version del kit: 3.9 respaldo DNS 28nov" }).Count -eq 1) ""
Remove-Item (Join-Path $CarpetaPublicidad "Soda\prueba-v36.png") -Force -ErrorAction SilentlyContinue
# g) v3.8: pantalla local de contingencia y estado del facturador (rutas del servidor local) + el supervisor REAL como cuenta normal con el DNS del facturador cortado
Dice "v3.8) Contingencia del facturador"
$script:fallos38 = 0
function Chequea38($nombre, $ok, $detalle) { if ($ok) { Dice ("   OK     " + $nombre + $(if ($detalle) { " : " + $detalle } else { "" })) } else { $script:fallos38++; Dice ("   FALLO  " + $nombre + $(if ($detalle) { " : " + $detalle } else { "" })) } }
$estFac = "C:\PantallaCliente\datos\facturador.json"
Remove-Item $estFac -Force -ErrorAction SilentlyContinue
$g1 = Pide "GET" "/contingencia/" $null $hostOk
$csp = [string]$g1.Cab["content-security-policy"]
Chequea38 "GET /contingencia/: 200, html, titulo y destino correctos" (($g1.Codigo -eq 200) -and ($g1.Cab["content-type"] -like "text/html*") -and ($g1.Cuerpo -match "Sin conexi&oacute;n al facturador") -and ($g1.Cuerpo -match 'var DEST = "https://facturacion\.dmalabomba\.com/";')) ("codigo " + $g1.Codigo + ", " + $g1.Cab["content-type"])
Chequea38 "La pagina de contingencia lleva una CSP restrictiva (solo 'self' y el facturador para conectarse)" (($csp -match "default-src 'none'") -and ($csp -match "connect-src 'self' https://facturacion\.dmalabomba\.com") -and ($csp -match "base-uri 'none'")) $csp
$g2 = Pide "GET" "/facturador" $null $hostOk
Chequea38 "GET /facturador sin sondeo previo: sin_dato y edad -1" (($g2.Codigo -eq 200) -and ($g2.Cuerpo -match '"motivo":"sin_dato"') -and ($g2.Cuerpo -match '"edad":-1')) $g2.Cuerpo
. "C:\PantallaCliente\funciones contingencia.ps1"
Guardar-Estado-Facturador ([pscustomobject]@{ ok = $false; motivo = "dns" }) "contingencia" $estFac
$g3 = Pide "GET" "/facturador" $null $hostOk
Chequea38 "GET /facturador con un sondeo reciente: ok false, motivo dns, modo contingencia" (($g3.Codigo -eq 200) -and ($g3.Cuerpo -match '"ok":false') -and ($g3.Cuerpo -match '"motivo":"dns"') -and ($g3.Cuerpo -match '"modo":"contingencia"')) $g3.Cuerpo
$g4 = Pide "GET" "/facturador" $ajeno $hostOk
Chequea38 "GET /facturador desde un origen ajeno: 403" ($g4.Codigo -eq 403) ("codigo " + $g4.Codigo)
$g5 = Pide "GET" "/contingencia/" $null "ejemplo.com:8766"
Chequea38 "GET /contingencia/ con Host ajeno (rebinding): 403" ($g5.Codigo -eq 403) ("codigo " + $g5.Codigo)
$g6 = Pide "GET" "/facturador" "http://127.0.0.1:8766" $hostOk
Chequea38 "GET /facturador desde el origen propio del servidor (la pagina de contingencia): 200 y CORS = ese origen" (($g6.Codigo -eq 200) -and ($g6.Cab["access-control-allow-origin"] -eq "http://127.0.0.1:8766")) ("codigo " + $g6.Codigo + ", ACAO " + $g6.Cab["access-control-allow-origin"])
$g7 = Pide "GET" "/lista?e=soda" "http://127.0.0.1:8766" $hostOk
Chequea38 "Lo de la publicidad no cambio: /lista desde el subdominio sigue 200" ((Pide "GET" "/lista?e=soda" $nuevoSitio $hostOk).Codigo -eq 200) ""
Remove-Item $estFac -Force -ErrorAction SilentlyContinue

# h) el supervisor REAL (0 abrir caja y pantalla.ps1) como cuenta normal, con facturacion.dmalabomba.com cortado por el archivo hosts
Dice "v3.8) Supervisor real como cuenta normal con el DNS del facturador cortado"
Stop-Process -Id $srv.Id -Force -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -like "*servidor publicidad*" -or $_.CommandLine -like "*0 abrir caja*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2
foreach ($f in @("registro.txt", "arranque.txt", "facturador.json", "eventos pendientes.jsonl", "abrir.flag")) { Remove-Item (Join-Path "C:\PantallaCliente\datos" $f) -Force -ErrorAction SilentlyContinue }
$hostsRuta = "$env:SystemRoot\System32\drivers\etc\hosts"; $hostsOrig = [IO.File]::ReadAllBytes($hostsRuta)
function Texto-Seguro($ruta) { $fs = $null; try { $fs = New-Object IO.FileStream($ruta, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite); $sr = New-Object IO.StreamReader($fs); return [string]$sr.ReadToEnd() } catch { return "" } finally { if ($fs) { $fs.Dispose() } } }
function Lanzar-Normal($nombre, $comando) {
  $bat = "C:\Windows\Temp\corre-$nombre.cmd"
  Set-Content -LiteralPath $bat -Value ('@echo off' + "`r`n" + $comando)
  icacls.exe $bat /grant "cajaprueba:(RX)" 2>&1 | Out-Null
  $cred = New-Object System.Management.Automation.PSCredential(($env:COMPUTERNAME + "\cajaprueba"), (ConvertTo-SecureString $clave -AsPlainText -Force))
  return (Start-Process -FilePath "cmd.exe" -ArgumentList ('/c "' + $bat + '"') -Credential $cred -WorkingDirectory "C:\Windows\Temp" -LoadUserProfile -WindowStyle Hidden -PassThru -ErrorAction Stop)
}
try {
  # v3.9: para que el resultado siga siendo "contingencia" (como en la v3.8) se corta tambien la direccion alterna (www) y los DNS publicos (firewall y nombres de DoH): no queda ninguna ruta
  Add-Content -LiteralPath $hostsRuta -Value "`r`n0.0.0.0 facturacion.dmalabomba.com`r`n0.0.0.0 www.dmalabomba.com`r`n0.0.0.0 cloudflare-dns.com`r`n0.0.0.0 dns.google" -Encoding ASCII; & ipconfig.exe /flushdns 2>&1 | Out-Null
  New-NetFirewallRule -DisplayName "prueba-kit-corte-dns-publicos" -Direction Outbound -RemoteAddress "1.1.1.1", "8.8.8.8" -Action Block -Protocol Any -ErrorAction Stop | Out-Null
  $sondeoCorte = Sondear-Facturador -Url "https://facturacion.dmalabomba.com/"
  Chequea38 "Con el corte, el sondeo del kit da caida" ((-not $sondeoCorte.ok) -and (Es-Caida-Probada $sondeoCorte)) $sondeoCorte.motivo
  $pn = Lanzar-Normal "supervisor38" 'powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "C:\PantallaCliente\0 abrir caja y pantalla.ps1"'
  $t = 0; $hay = $false
  while ($t -lt 75 -and -not $hay) { Start-Sleep -Seconds 3; $t += 3; $hay = (Test-Path $estFac) -and ((Get-Content "C:\PantallaCliente\datos\registro.txt" -Raw -ErrorAction SilentlyContinue) -match "NO alcanzable") }
  Dice ("   el supervisor dejo su estado tras ~" + $t + " s")
  Volcar "arranque.txt" "C:\PantallaCliente\datos\arranque.txt"
  Volcar "registro.txt" "C:\PantallaCliente\datos\registro.txt"
  $reg = (Get-Content "C:\PantallaCliente\datos\registro.txt" -Raw -ErrorAction SilentlyContinue)
  Chequea38 "El supervisor (cuenta normal) anoto que el facturador no es alcanzable" ($reg -match "Facturador NO alcanzable") ""
  Chequea38 "...y que abre en modo contingencia (no hay copia guardada en este perfil)" ($reg -match "se abre en modo contingencia") ""
  Chequea38 "...y no intento abrir la pantalla del cliente (no hay facturador)" ($reg -notmatch "Falta la ventana del cliente") ""
  # la pantalla local, servida por el servidor que levanto el supervisor (cuenta normal)
  $gA = Pide "GET" "/contingencia/" $null $hostOk
  Chequea38 "El servidor local del supervisor sirve la pagina de contingencia" (($gA.Codigo -eq 200) -and ($gA.Cuerpo -match "Sin conexi&oacute;n al facturador")) ("codigo " + $gA.Codigo)
  $gB = Pide "GET" "/facturador" $null $hostOk
  Chequea38 "/facturador devuelve el sondeo del supervisor: ok false, modo contingencia, edad reciente" (($gB.Cuerpo -match '"ok":false') -and ($gB.Cuerpo -match '"modo":"contingencia"')) $gB.Cuerpo
  # un solo aviso por caida: se espera a la segunda comprobacion (cada 10 s mientras este caido)
  $t = 0; $ev = ""; while ($t -lt 90 -and ($ev -notmatch "no alcanzable desde esta caja")) { Start-Sleep -Seconds 3; $t += 3; $ev = Texto-Seguro "C:\PantallaCliente\datos\eventos pendientes.jsonl" }
  Volcar "registro.txt (tras esperar el aviso)" "C:\PantallaCliente\datos\registro.txt"
  Volcar "eventos pendientes.jsonl" "C:\PantallaCliente\datos\eventos pendientes.jsonl"
  $nAvisos = @([regex]::Matches("$ev", "no alcanzable desde esta caja")).Count
  Chequea38 "Quedo UN aviso para el panel (tipo otro) por la caida" (($nAvisos -eq 1) -and ($ev -match '"tipo":"otro"')) ("avisos: " + $nAvisos + " tras ~" + $t + " s")
  Start-Sleep -Seconds 25
  $nAvisos2 = @([regex]::Matches((Texto-Seguro "C:\PantallaCliente\datos\eventos pendientes.jsonl"), "no alcanzable desde esta caja")).Count
  Chequea38 "Mas comprobaciones fallidas de la misma caida no repiten el aviso" ($nAvisos2 -eq 1) ("avisos: " + $nAvisos2)
  # vuelve el DNS: el supervisor lo nota solo, avisa una vez y deja el estado en ok
  [IO.File]::WriteAllBytes($hostsRuta, $hostsOrig); & ipconfig.exe /flushdns 2>&1 | Out-Null
  $t = 0; $ok2 = $false; while ($t -lt 60 -and -not $ok2) { Start-Sleep -Seconds 3; $t += 3; $ok2 = ((Pide "GET" "/facturador" $null $hostOk).Cuerpo -match '"ok":true') }
  Chequea38 "Al volver el DNS el estado del facturador pasa a ok" $ok2 ("tras ~" + $t + " s")
  $ev3 = Texto-Seguro "C:\PantallaCliente\datos\eventos pendientes.jsonl"
  Chequea38 "Quedo el aviso de restablecido (uno solo)" (@([regex]::Matches($ev3, "alcanzable de nuevo desde esta caja")).Count -eq 1) ""
  Volcar "registro.txt (final)" "C:\PantallaCliente\datos\registro.txt"
} catch { $script:fallos38++; Dice ("   FALLO v3.8 supervisor: " + $_.Exception.Message + " (linea " + $_.InvocationInfo.ScriptLineNumber + ")") }
finally {
  [IO.File]::WriteAllBytes($hostsRuta, $hostsOrig); & ipconfig.exe /flushdns 2>&1 | Out-Null
  Get-NetFirewallRule -DisplayName "prueba-kit-corte-dns-publicos" -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
  Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match "PantallaCliente" -and $_.ProcessId -ne $PID } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  if ($pn) { Stop-Process -Id $pn.Id -Force -ErrorAction SilentlyContinue }
}
Dice ("v3.8) Comprobaciones de la contingencia: " + $(if ($script:fallos38 -eq 0) { "TODAS OK" } else { "FALLARON " + $script:fallos38 }))
Stop-Process -Id $srv.Id -Force -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -like "*servidor publicidad*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Dice ("v3.6) Comprobaciones del subdominio: " + $(if ($script:fallos36 -eq 0) { "TODAS OK" } else { "FALLARON " + $script:fallos36 }))
Dice "FIN"
if (($fallos16 -gt 0) -or ($script:fallos36 -gt 0) -or ($script:fallos38 -gt 0) -or ($malos -gt 0)) { exit 1 }
