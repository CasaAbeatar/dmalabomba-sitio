# Prueba del kit v3 en Windows PowerShell 5.1 real (ejecutor de GitHub). Simula la PC de caja: administrador instala, cuenta normal usa.
$ErrorActionPreference = "Continue"
$aqui = Split-Path -Parent $MyInvocation.MyCommand.Path
$origen = (Resolve-Path (Join-Path $aqui "..\kit pc caja\v3 reparador y enlace 18 nov (sin probar)")).Path
$res = Join-Path $aqui "resultados"; New-Item -ItemType Directory -Force $res | Out-Null
$sal = Join-Path $res "prueba kit.txt"
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
$cB = Valor-Reg "HKLM:\SOFTWARE\Policies\Google\Chrome\ExtensionInstallBlocklist"
$cA = Valor-Reg "HKLM:\SOFTWARE\Policies\Google\Chrome\ExtensionInstallAllowlist"
$eB = Valor-Reg "HKLM:\SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallBlocklist"
$eA = Valor-Reg "HKLM:\SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallAllowlist"
Dice ("   Chrome Blocklist: " + ($cB -join ", ") + " | Chrome Allowlist: " + ($cA -join ", "))
Dice ("   Edge Blocklist: " + ($eB -join ", ") + " | Edge Allowlist: " + ($eA -join ", "))
if (-not (($cB.Count -eq 1) -and ($cB[0] -eq "1=*"))) { $fallos16++; Dice "   FALLO: Chrome Blocklist debe ser exactamente 1=*" }
if (-not (($cA.Count -eq 1) -and ($cA[0] -eq ("1=" + $id)))) { $fallos16++; Dice "   FALLO: Chrome Allowlist debe ser exactamente 1=<Chrome Remote Desktop>" }
if (-not (($eB.Count -eq 1) -and ($eB[0] -eq "1=*"))) { $fallos16++; Dice "   FALLO: Edge Blocklist debe ser exactamente 1=*" }
if (-not ($eA.Count -eq 1 -and $eA[0] -eq "(no existe)")) { $fallos16++; Dice "   FALLO: Edge no debe tener Allowlist" }
Dice ("16) Extensiones: " + $(if ($fallos16 -eq 0) { "OK (Chrome permite solo Chrome Remote Desktop y bloquea el resto; Edge bloqueo total)" } else { "FALLO (" + $fallos16 + ")" }))
Dice "FIN"
if ($fallos16 -gt 0) { exit 1 }
