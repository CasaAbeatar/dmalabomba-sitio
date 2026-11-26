# Pruebas del actualizador OTA del kit de caja en Windows PowerShell 5.1 real (ejecutor de GitHub, administrador).
# No toca ninguna PC de caja: todo ocurre en carpetas de prueba y con una llave de prueba.
$ErrorActionPreference = "Continue"
$aqui = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = (Resolve-Path (Join-Path $aqui "..\..")).Path
$kitReal = (Get-ChildItem -LiteralPath (Join-Path $repo "kit pc caja") -Directory | Where-Object { $_.Name -like "v3.7*" } | Select-Object -First 1).FullName
$llavePriv = Join-Path $aqui "llave-prueba-NO-USAR-EN-PRODUCCION.txt"
$llavePub = Join-Path $aqui "llave-prueba.xml"
$crear = Join-Path $repo "ota-kit\crear_lanzamiento.py"
$res = Join-Path $aqui "resultados"; New-Item -ItemType Directory -Force $res | Out-Null
$sal = Join-Path $res "prueba ota.txt"
$base = "C:\ota-prueba"; if (Test-Path $base) { Remove-Item $base -Recurse -Force }; New-Item -ItemType Directory -Force $base | Out-Null
$env:PATH = $env:PATH + ";C:\Program Files\Git\usr\bin"
$script:Fallos = 0; $script:Pasos = 0
function Dice($t) { $l = "{0:HH:mm:ss}  {1}" -f (Get-Date), $t; Write-Host $l; Add-Content -LiteralPath $sal -Value $l }
function Ok($cond, $texto) { $script:Pasos++; if ($cond) { Dice ("  OK    " + $texto) } else { $script:Fallos++; Dice ("  FALLO " + $texto) } }
Dice ("Windows PowerShell " + $PSVersionTable.PSVersion + " en " + [Environment]::OSVersion.VersionString + "; kit real: " + $kitReal)
Dice ("python: " + ((& python --version 2>&1) -join " ") + "; openssl: " + ((& openssl version 2>&1) -join " "))

# ---------- utilidades ----------
function Detener-Pruebas($raiz) {
  foreach ($p in @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)) {
    if ($p.ProcessId -eq $PID) { continue }
    if (([string]$p.CommandLine -like ("*" + $raiz + "*")) -and ($p.Name -in @("powershell.exe", "conhost.exe"))) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
  }
}
function Nuevo-Kit($dir, $version, $serie, $modo = "normal") {
  if (Test-Path $dir) { Remove-Item $dir -Recurse -Force }
  New-Item -ItemType Directory -Force $dir | Out-Null
  Set-Content -LiteralPath "$dir\config.ps1" -Value ('$VersionKit = "' + $version + '"') -Encoding UTF8
  Set-Content -LiteralPath "$dir\funciones.ps1" -Value '# stub' -Encoding UTF8
  Set-Content -LiteralPath "$dir\ota serie.ps1" -Value ('$OtaSerie = ' + $serie) -Encoding UTF8
  foreach ($n in @("20 actualizador.ps1", "21 relanzar.ps1", "ota llave publica.ps1")) { Copy-Item -LiteralPath (Join-Path $kitReal $n) -Destination $dir }
  $latido = '. "$PSScriptRoot\config.ps1"' + "`r`n" + '$d = Join-Path $PSScriptRoot "datos"; New-Item -Force -ItemType Directory $d | Out-Null' + "`r`n" + 'Add-Content -LiteralPath "$d\latido.txt" -Value ("{0:yyyy-MM-dd HH:mm:ss}  Latido iniciado. Kit {1}" -f (Get-Date), $VersionKit)' + "`r`n" + 'Start-Sleep 300'
  if ($modo -eq "latido-roto") { $latido = 'Start-Sleep 300' }
  Set-Content -LiteralPath "$dir\11 latido.ps1" -Value $latido -Encoding UTF8
  Set-Content -LiteralPath "$dir\0 abrir caja y pantalla.ps1" -Value 'Start-Sleep 300' -Encoding UTF8
  if ($modo -eq "sintaxis") { Set-Content -LiteralPath "$dir\99 roto.ps1" -Value 'function {{{ esto no es powershell ((' -Encoding UTF8 }
  if ($modo -eq "con-nuevo") { Set-Content -LiteralPath "$dir\22 archivo nuevo.ps1" -Value '# nuevo' -Encoding UTF8 }
}
function Instalar-Raiz($raiz, $version, $serie) {
  Detener-Pruebas $raiz
  Nuevo-Kit $raiz $version $serie
  Set-Content -LiteralPath "$raiz\viejo-que-ya-no-va.ps1" -Value '# se debe quitar' -Encoding UTF8
  New-Item -ItemType Directory -Force "$raiz\datos" | Out-Null
  Set-Content -LiteralPath "$raiz\datos\equipo.json" -Value '{"estacion":"caja-pollos","token":"x","pc":"' -Encoding UTF8
  Set-Content -LiteralPath "$raiz\datos\dato-del-negocio.txt" -Value "no tocar" -Encoding UTF8
  # mismo trato de permisos que el instalador: la raiz hereda, Usuarios solo leen
  & icacls.exe $raiz /inheritance:r /grant "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" "*S-1-5-32-545:(OI)(CI)RX" 2>&1 | Out-Null
  & icacls.exe "$raiz\datos" /grant "*S-1-5-32-545:(OI)(CI)M" 2>&1 | Out-Null
}
function Servidor($carpeta, $kitDir, $estaciones = "caja-pollos", $extra = @()) {
  $args2 = @($crear, $kitDir, "--llave", $llavePriv, "--salida", $carpeta, "--estaciones", $estaciones, "--relativa") + $extra
  $o = & python @args2 2>&1
  Dice ("   servidor de prueba: " + ($o -join " "))
}
function Correr($raiz, $manifiesto, $extra = @(), $est = "caja-pollos", $espera = "40") {
  $a = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "$raiz\20 actualizador.ps1", "-Raiz", $raiz, "-Prueba", "-Manifiesto", $manifiesto, "-LlavePublica", $llavePub, "-Estacion", $est, "-EsperaSaludSeg", $espera) + $extra
  $o = & powershell.exe @a 2>&1 | Out-String
  foreach ($l in ($o -split "`r?`n")) { if ($l.Trim()) { Dice ("      | " + $l.Trim()) } }
  return $LASTEXITCODE
}
function Version-De($raiz) { $m = [regex]::Match((Get-Content -LiteralPath "$raiz\config.ps1" -Raw), '"([^"]+)"'); return $m.Groups[1].Value }
function Estado-De($raiz) { try { return (Get-Content -LiteralPath "$raiz\ota\estado.json" -Raw | ConvertFrom-Json) } catch { return $null } }
function Eventos-De($raiz) { $f = "$raiz\datos\eventos pendientes.jsonl"; if (Test-Path $f) { return @(Get-Content $f) } else { return @() } }

# ---------- 0) sintaxis de todos los scripts del kit v3.7 con el parser de 5.1 ----------
$malos = 0
foreach ($f in Get-ChildItem $kitReal -Filter *.ps1) { $e = $null; $t = $null; [void][System.Management.Automation.Language.Parser]::ParseFile($f.FullName, [ref]$t, [ref]$e); if ($e.Count) { $malos++; Dice ("SINTAXIS " + $f.Name + ": " + $e[0].Message + " L" + $e[0].Extent.StartLineNumber) } }
Ok ($malos -eq 0) "0) Ningun script del kit v3.7 tiene errores de sintaxis en 5.1"

# ---------- 1) firma: cruce openssl -> .NET con la llave de PRODUCCION no se puede (privada fuera); se prueba con la de prueba ----------
$k1 = Join-Path $base "kit-a"; Nuevo-Kit $k1 "T-100" 100
$k2 = Join-Path $base "kit-b"; Nuevo-Kit $k2 "T-101" 101

# ---------- 2) camino feliz ----------
Dice "2) Camino feliz: de T-100 a T-101"
$raiz = Join-Path $base "pc1"; Instalar-Raiz $raiz "T-100" 100
$hEquipo = (Get-FileHash "$raiz\datos\equipo.json").Hash
$srv = Join-Path $base "srv1"; Servidor $srv $k2
$cod = Correr $raiz (Join-Path $srv "manifiesto.json") @("-Ahora")
Ok ($cod -eq 0) "2a) el actualizador termino sin error (codigo $cod)"
Ok ((Version-De $raiz) -eq "T-101") "2b) la version instalada es T-101 (es: $(Version-De $raiz))"
Ok (-not (Test-Path "$raiz\viejo-que-ya-no-va.ps1")) "2c) el script viejo que ya no esta en el paquete se quito"
Ok ((Get-Content "$raiz\datos\dato-del-negocio.txt" -Raw).Trim() -eq "no tocar") "2d) la carpeta datos quedo intacta"
Ok ((Get-FileHash "$raiz\datos\equipo.json").Hash -eq $hEquipo) "2d') la identidad de la PC (datos\equipo.json) se conservo byte por byte"
$st = Estado-De $raiz
Ok ($st -and $st.ultimo_resultado -eq "ok") "2e) estado.json dice ok (es: $($st.ultimo_resultado) / $($st.ultimo_mensaje))"
Ok ((@(Eventos-De $raiz) -join "`n") -match "reparacion.*OTA kit: actualizado de T-100 a T-101") "2f) quedo el evento de actualizacion para el panel"
Ok ((Test-Path "$raiz\datos\ota estado.json") -and ((Get-Content "$raiz\datos\ota estado.json" -Raw) -match '"r":"ok"')) "2g) la copia de estado para el latido existe y dice ok"
$dj = Get-Content "$raiz\ota\diario.json" -Raw | ConvertFrom-Json
Ok ($dj.estado -eq "confirmada") "2h) el diario quedo confirmado (es: $($dj.estado))"
Ok (Test-Path $dj.respaldo) "2i) hay respaldo de la version anterior"
Ok ((Get-Content (Join-Path $dj.respaldo "config.ps1") -Raw) -match "T-100") "2j) el respaldo contiene la version T-100"
# permisos: Usuarios pueden LEER los archivos nuevos; la carpeta ota esta cerrada para Usuarios
function Tiene-Usuarios($ruta) { foreach ($r in (Get-Acl -LiteralPath $ruta).GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) { if ($r.IdentityReference.Value -eq "S-1-5-32-545") { return $true } }; return $false }
Ok (Tiene-Usuarios "$raiz\config.ps1") "2k) config.ps1 nuevo es legible para Usuarios (no quedo con permisos vacios)"
Ok (Tiene-Usuarios "$raiz\11 latido.ps1") "2l) 11 latido.ps1 nuevo es legible para Usuarios"
Ok (-not (Tiene-Usuarios "$raiz\ota")) "2m) la carpeta ota NO es accesible para Usuarios"
Ok (-not (Tiene-Usuarios "$raiz\ota\preparado")) "2n) la carpeta ota\preparado NO es accesible para Usuarios"
Detener-Pruebas $raiz

# ---------- 3) ya esta al dia ----------
Dice "3) Segunda corrida: ya esta al dia"
$antes = (Get-Item "$raiz\config.ps1").LastWriteTime
$cod = Correr $raiz (Join-Path $srv "manifiesto.json") @("-Ahora")
Ok ($cod -eq 0 -and ((Get-Item "$raiz\config.ps1").LastWriteTime -eq $antes)) "3a) no cambio nada"
Detener-Pruebas $raiz

# ---------- 4) firma invalida ----------
Dice "4) Manifiesto alterado (firma invalida)"
$raiz = Join-Path $base "pc2"; Instalar-Raiz $raiz "T-100" 100
$srv2 = Join-Path $base "srv2"; Servidor $srv2 $k2
$txt = Get-Content (Join-Path $srv2 "manifiesto.json") -Raw
Set-Content -LiteralPath (Join-Path $srv2 "manifiesto.json") -Value ($txt -replace '"serie": 101', '"serie": 102') -NoNewline -Encoding ASCII
$cod = Correr $raiz (Join-Path $srv2 "manifiesto.json") @("-Ahora")
Ok ((Version-De $raiz) -eq "T-100") "4a) no se instalo nada (version sigue T-100)"
Ok ((Estado-De $raiz).ultimo_resultado -eq "firma_invalida") "4b) el estado dice firma_invalida"
Ok ((@(Eventos-De $raiz) -join "`n") -match "firma invalida") "4c) hay evento de alerta por la firma invalida"
# firma hecha con OTRA llave
Dice "4') Manifiesto firmado con otra llave"
$srv2b = Join-Path $base "srv2b"; Servidor $srv2b $k2
& openssl genrsa -out "$base\otra.pem" 2048 2>&1 | Out-Null
& openssl dgst -sha256 -sign "$base\otra.pem" -out "$base\otra.sig" (Join-Path $srv2b "manifiesto.json") 2>&1 | Out-Null
Set-Content -LiteralPath (Join-Path $srv2b "manifiesto.json.firma") -Value ([Convert]::ToBase64String([IO.File]::ReadAllBytes("$base\otra.sig"))) -Encoding ASCII
Remove-Item "$raiz\datos\eventos pendientes.jsonl" -Force -ErrorAction SilentlyContinue
$cod = Correr $raiz (Join-Path $srv2b "manifiesto.json") @("-Ahora")
Ok ((Version-De $raiz) -eq "T-100" -and (Estado-De $raiz).ultimo_resultado -eq "firma_invalida") "4'a) firma de otra llave: rechazada"
Detener-Pruebas $raiz

# ---------- 5) huella (sha256) del paquete no coincide ----------
Dice "5) Paquete cambiado despues de firmar el manifiesto"
$raiz = Join-Path $base "pc3"; Instalar-Raiz $raiz "T-100" 100
$srv3 = Join-Path $base "srv3"; Servidor $srv3 $k2
$zp = Join-Path $srv3 "paquetes\kit-101.zip"; $zb = [IO.File]::ReadAllBytes($zp); $zb[100] = $zb[100] -bxor 0xFF; [IO.File]::WriteAllBytes($zp, $zb)   # mismo tamano, un byte distinto
$cod = Correr $raiz (Join-Path $srv3 "manifiesto.json") @("-Ahora")
Ok ((Version-De $raiz) -eq "T-100") "5a) no se instalo (version sigue T-100)"
Ok ((Estado-De $raiz).ultimo_resultado -eq "rechazado") "5b) estado: rechazado (es: $((Estado-De $raiz).ultimo_resultado) / $((Estado-De $raiz).ultimo_mensaje))"
Detener-Pruebas $raiz

# ---------- 6) el kit nuevo no arranca bien: vuelta atras automatica ----------
Dice "6) Kit nuevo con latido roto: debe volver a T-100"
$raiz = Join-Path $base "pc4"; Instalar-Raiz $raiz "T-100" 100
$k3 = Join-Path $base "kit-c"; Nuevo-Kit $k3 "T-102" 102 "latido-roto"
$srv4 = Join-Path $base "srv4"; Servidor $srv4 $k3
$cod = Correr $raiz (Join-Path $srv4 "manifiesto.json") @("-Ahora")
Ok ((Version-De $raiz) -eq "T-100") "6a) volvio a T-100 (es: $(Version-De $raiz))"
Ok (Test-Path "$raiz\viejo-que-ya-no-va.ps1") "6b) el archivo que se habia quitado volvio con el respaldo"
$st = Estado-De $raiz
Ok ($st.ultimo_resultado -eq "revertida") "6c) estado: revertida (es: $($st.ultimo_resultado) / $($st.ultimo_mensaje))"
Ok ((@(Eventos-De $raiz) -join "`n") -match "otro.*OTA kit: fallo la actualizacion a T-102") "6d) hay evento de alerta de la vuelta atras"
Ok (@($st.fallidas | Where-Object { $_.serie -eq 102 }).Count -eq 1) "6e) la serie 102 quedo anotada como fallida (no se reintenta enseguida)"
$cod = Correr $raiz (Join-Path $srv4 "manifiesto.json") @("-Ahora")
Ok ((Version-De $raiz) -eq "T-100") "6f) una segunda corrida no la reintenta enseguida (espera 1 h)"
Detener-Pruebas $raiz

# ---------- 7) corte de luz a la mitad ----------
Dice "7) Actualizacion interrumpida (diario 'aplicando'): al volver, se revierte sola"
$raiz = Join-Path $base "pc5"; Instalar-Raiz $raiz "T-100" 100
$resp = Join-Path $raiz "ota\respaldo\100-prueba"; New-Item -ItemType Directory -Force $resp | Out-Null
foreach ($f in Get-ChildItem $raiz -File) { Copy-Item $f.FullName $resp }
Set-Content -LiteralPath "$raiz\config.ps1" -Value '$VersionKit = "T-101"' -Encoding UTF8      # la mitad ya cambiada
Set-Content -LiteralPath "$raiz\22 archivo nuevo.ps1" -Value '# medio copiado' -Encoding UTF8
Remove-Item "$raiz\viejo-que-ya-no-va.ps1" -Force
$diario = [ordered]@{ estado = "aplicando"; de_version = "T-100"; de_serie = 100; a_version = "T-101"; a_serie = 101; respaldo = $resp; nuevos = @("config.ps1", "22 archivo nuevo.ps1"); inicio = "2026-11-26T09:00:00Z"; verificar_hasta = "" }
Set-Content -LiteralPath "$raiz\ota\diario.json" -Value ($diario | ConvertTo-Json) -Encoding UTF8
$cod = Correr $raiz (Join-Path $srv "manifiesto.json") @("-Ahora")
Ok ((Version-De $raiz) -eq "T-100") "7a) config.ps1 restaurado a T-100"
Ok (-not (Test-Path "$raiz\22 archivo nuevo.ps1")) "7b) el archivo medio copiado se quito"
Ok (Test-Path "$raiz\viejo-que-ya-no-va.ps1") "7c) el archivo que se habia quitado volvio"
Ok ((Estado-De $raiz).ultimo_resultado -eq "revertida") "7d) estado: revertida"
Detener-Pruebas $raiz

# ---------- 8) anillos por estacion, fecha, ventana horaria, serie vieja, vencimiento ----------
Dice "8) Anillos y ventana"
$raiz = Join-Path $base "pc6"; Instalar-Raiz $raiz "T-100" 100
$srv5 = Join-Path $base "srv5"; Servidor $srv5 $k2 "caja-soda"
$cod = Correr $raiz (Join-Path $srv5 "manifiesto.json") @("-Ahora")
Ok ((Version-De $raiz) -eq "T-100") "8a) un lanzamiento solo para caja-soda NO se instala en caja-pollos"
$srvP = Join-Path $base "srv5p"; Servidor $srvP $k2 "caja-pollos"
$cod = Correr $raiz (Join-Path $srvP "manifiesto.json") @("-Ahora") "caja-soda"
Ok ((Version-De $raiz) -eq "T-100") "8a') el anillo de Pollos (estaciones caja-pollos) NO se instala en la caja de Soda"
$cod = Correr $raiz (Join-Path $srvP "manifiesto.json") @("-Ahora") "caja-otra"
Ok ((Version-De $raiz) -eq "T-100") "8a'') el anillo de Pollos NO se instala en una estacion desconocida"
$srv6 = Join-Path $base "srv6"; Servidor $srv6 $k2 "caja-pollos" @("--desde", "2099-01-01T00:00:00Z")
$cod = Correr $raiz (Join-Path $srv6 "manifiesto.json") @("-Ahora")
Ok ((Version-De $raiz) -eq "T-100") "8b) un lanzamiento con fecha futura NO se instala todavia"
$srvAll = Join-Path $base "srv8"; Servidor $srvAll $k2 "caja-pollos" @("--desde", "2020-01-01T00:00:00Z")
$cod = Correr $raiz (Join-Path $srvAll "manifiesto.json") @("-AhoraUtc", "2026-11-26T15:00:00Z")
Ok ((Version-De $raiz) -eq "T-100") "8c) fuera de la ventana (09:00 hora de Costa Rica) no se instala"
$cod = Correr $raiz (Join-Path $srvAll "manifiesto.json") @("-AhoraUtc", "2099-01-01T09:30:00Z")
Ok ((Version-De $raiz) -eq "T-100") "8d) manifiesto vencido (caduco hace anos) no se instala"
$srvSerie = Join-Path $base "srv7"; $k0 = Join-Path $base "kit-viejo"; Nuevo-Kit $k0 "T-099" 99; Servidor $srvSerie $k0
$cod = Correr $raiz (Join-Path $srvSerie "manifiesto.json") @("-Ahora")
Ok ((Version-De $raiz) -eq "T-100") "8e) un lanzamiento con serie MENOR (retroceso) no se instala"
$hoyUtc = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd") + "T09:30:00Z"   # 03:30 hora de Costa Rica
$cod = Correr $raiz (Join-Path $srvAll "manifiesto.json") @("-AhoraUtc", $hoyUtc)
Ok ((Version-De $raiz) -eq "T-101") "8f) dentro de la ventana (03:30 CR), anillo caja-pollos, en la caja de Pollos SI se instala (es: $(Version-De $raiz))"
Detener-Pruebas $raiz

# ---------- 9) paquetes peligrosos ----------
Dice "9) Paquetes peligrosos o danados"
$raiz = Join-Path $base "pc7"; Instalar-Raiz $raiz "T-100" 100
$srvT = Join-Path $base "srv9"; Servidor $srvT $k2 "caja-pollos" @("--extra-entrada", "../evil.ps1")
$cod = Correr $raiz (Join-Path $srvT "manifiesto.json") @("-Ahora")
Ok ((Version-De $raiz) -eq "T-100" -and -not (Test-Path (Join-Path $base "evil.ps1"))) "9a) un zip con '../evil.ps1' se rechaza y no escribe fuera"
Ok ((Estado-De $raiz).ultimo_mensaje -match "no permitido") "9b) el motivo dice nombre no permitido (es: $((Estado-De $raiz).ultimo_mensaje))"
$kS = Join-Path $base "kit-sintaxis"; Nuevo-Kit $kS "T-103" 103 "sintaxis"
$srvS = Join-Path $base "srv10"; Servidor $srvS $kS
$cod = Correr $raiz (Join-Path $srvS "manifiesto.json") @("-Ahora")
Ok ((Version-De $raiz) -eq "T-100") "9c) un paquete con un script con error de sintaxis se rechaza ANTES de instalar"
Ok ((Estado-De $raiz).ultimo_mensaje -match "sintaxis") "9d) el motivo menciona sintaxis"
$srvX = Join-Path $base "srv11"; Servidor $srvX $k2 "caja-pollos" @("--extra-entrada", "carpeta/dentro.ps1")
$cod = Correr $raiz (Join-Path $srvX "manifiesto.json") @("-Ahora")
Ok ((Version-De $raiz) -eq "T-100") "9e) un zip con subcarpetas se rechaza"
Detener-Pruebas $raiz

# ---------- 10) con SYSTEM de verdad (tarea programada) y tareas reales del instalador ----------
Dice "10) Corrida como SYSTEM por tarea programada"
$raiz = Join-Path $base "pc8"; Instalar-Raiz $raiz "T-100" 100
$srvY = Join-Path $base "srv12"; Servidor $srvY $k2
$ps = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$arg = "-NoProfile -ExecutionPolicy Bypass -File `"$raiz\20 actualizador.ps1`" -Raiz `"$raiz`" -Prueba -Manifiesto `"$srvY\manifiesto.json`" -LlavePublica `"$llavePub`" -Estacion caja-pollos -Ahora -EsperaSaludSeg 40"
try {
  $acc = New-ScheduledTaskAction -Execute $ps -Argument $arg
  $pri = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
  Register-ScheduledTask -TaskName "prueba-ota-system" -Action $acc -Principal $pri -Force | Out-Null
  Start-ScheduledTask -TaskName "prueba-ota-system"
  $t = 0; while ($t -lt 120) { Start-Sleep -Seconds 3; $t += 3; if ((Version-De $raiz) -eq "T-101" -and (Get-ScheduledTask -TaskName "prueba-ota-system").State -ne "Running") { break } }
  Ok ((Version-De $raiz) -eq "T-101") "10a) como SYSTEM se actualizo a T-101 (es: $(Version-De $raiz))"
  Ok (Tiene-Usuarios "$raiz\config.ps1") "10b) los archivos que deja SYSTEM son legibles para Usuarios"
  Ok (-not (Tiene-Usuarios "$raiz\ota")) "10c) la carpeta ota sigue cerrada para Usuarios"
  Dice ("   log del actualizador: " + ((@(Get-Content "$raiz\ota\actualizador.log" -Tail 6 -ErrorAction SilentlyContinue)) -join " | "))
} catch { Ok $false ("10) la tarea como SYSTEM no se pudo probar: " + $_.Exception.Message) }
finally { Unregister-ScheduledTask -TaskName "prueba-ota-system" -Confirm:$false -ErrorAction SilentlyContinue; Detener-Pruebas $raiz }

Dice "11) Tareas programadas reales que crea el instalador"
try {
  $Carpeta = "C:\PantallaCliente"
  Set-Location $kitReal
  . "$kitReal\config.ps1"; . "$kitReal\funciones.ps1"; . "$kitReal\funciones v3.ps1"
  $r = Registrar-Tareas-OTA
  Dice ("   " + $r)
  $t1 = Get-ScheduledTask -TaskName "La Bomba Kit - Actualizador" -TaskPath "\La Bomba\"
  $t2 = Get-ScheduledTask -TaskName "La Bomba Kit - Relanzar" -TaskPath "\La Bomba\"
  Ok ($t1.Principal.UserId -match "SYSTEM") "11a) el actualizador corre como SYSTEM (es: $($t1.Principal.UserId))"
  Ok (@($t1.Triggers).Count -ge 1 -and $t1.Triggers[0].Repetition.Interval -eq "PT30M") "11b) se repite cada 30 minutos (es: $($t1.Triggers[0].Repetition.Interval) por $($t1.Triggers[0].Repetition.Duration))"
  Ok ($t2.Principal.GroupId -eq "S-1-5-32-545" -or $t2.Principal.GroupId -match "Users|Usuarios") "11c) el relanzador corre como el grupo Usuarios (es: $($t2.Principal.GroupId))"
  Ok ($t2.Principal.RunLevel -eq "Limited") "11d) el relanzador corre SIN privilegios"
  # Limpiar-Tareas del instalador no debe borrar estas tareas
  Limpiar-Tareas
  Ok ($null -ne (Get-ScheduledTask -TaskName "La Bomba Kit - Actualizador" -TaskPath "\La Bomba\" -ErrorAction SilentlyContinue)) "11e) Limpiar-Tareas no borra la tarea del actualizador"
} catch { Ok $false ("11) tareas reales: " + $_.Exception.Message) }
finally { Unregister-ScheduledTask -TaskName "La Bomba Kit - Actualizador" -TaskPath "\La Bomba\" -Confirm:$false -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName "La Bomba Kit - Relanzar" -TaskPath "\La Bomba\" -Confirm:$false -ErrorAction SilentlyContinue }

# ---------- 12) la llave publica de PRODUCCION que viaja en el kit verifica una firma hecha con la llave privada de produccion ----------
Dice "12) Llave publica de produccion"
try {
  . "$kitReal\ota llave publica.ps1"
  $rsa = New-Object System.Security.Cryptography.RSACryptoServiceProvider; $rsa.FromXmlString($OtaLlavePublicaXml)
  Ok ($rsa.KeySize -eq 3072) "12a) la llave de produccion es RSA de 3072 bits (es: $($rsa.KeySize))"
  $dat = [Text.Encoding]::ASCII.GetBytes("muestra de firma OTA de produccion")
  $fir = [Convert]::FromBase64String((Get-Content (Join-Path $aqui "muestra-firma-produccion.firma") -Raw).Trim())
  Ok ($rsa.VerifyData($dat, "SHA256", $fir)) "12b) una firma hecha con la llave privada de produccion se verifica con la llave publica del kit"
  $dat2 = [byte[]]$dat.Clone(); $dat2[0] = $dat2[0] -bxor 1
  Ok (-not $rsa.VerifyData($dat2, "SHA256", $fir)) "12c) el mismo texto con un byte distinto NO se verifica"
} catch { Ok $false ("12) llave de produccion: " + $_.Exception.Message) }

# ---------- 13) direcciones permitidas y camino de produccion sin manifiesto publicado ----------
Dice "13) Direcciones permitidas"
try {
  $txtAct = Get-Content (Join-Path $kitReal "20 actualizador.ps1") -Raw
  $HostsPermitidos = @("www.dmalabomba.com", "dmalabomba.com"); $RutaPermitida = "/kit-caja/ota/"
  $fn = [regex]::Match($txtAct, '(?s)function Url-Permitida.*?\r?\n\}').Value
  Invoke-Expression $fn
  Ok (Url-Permitida "https://www.dmalabomba.com/kit-caja/ota/manifiesto.json") "13a) la direccion oficial se permite"
  Ok (-not (Url-Permitida "http://www.dmalabomba.com/kit-caja/ota/manifiesto.json")) "13b) http sin cifrar NO"
  Ok (-not (Url-Permitida "https://evil.com/kit-caja/ota/manifiesto.json")) "13c) otro dominio NO"
  Ok (-not (Url-Permitida "https://www.dmalabomba.com.evil.com/kit-caja/ota/x.zip")) "13d) dominio que solo empieza igual NO"
  Ok (-not (Url-Permitida "https://www.dmalabomba.com/otra-ruta/x.zip")) "13e) otra ruta del mismo sitio NO"
  Ok (-not (Url-Permitida "https://www.dmalabomba.com/kit-caja/ota/../x.zip")) "13f) ruta con .. NO"
  Ok (-not (Url-Permitida "https://usuario@www.dmalabomba.com/kit-caja/ota/x.zip")) "13g) direccion con usuario NO"
  Ok (-not (Url-Permitida "https://www.dmalabomba.com:8443/kit-caja/ota/x.zip")) "13h) otro puerto NO"
} catch { Ok $false ("13) direcciones: " + $_.Exception.Message) }
Dice "13') Produccion (sin -Prueba) mientras el manifiesto no esta publicado: no debe fallar ni alarmar"
$raiz = Join-Path $base "pc9"; Instalar-Raiz $raiz "T-100" 100
Set-Content -LiteralPath "$raiz\datos\equipo.json" -Value ('{"estacion":"caja-pollos","token":"x","pc":"' + $env:COMPUTERNAME + '"}') -Encoding UTF8
$o = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$raiz\20 actualizador.ps1" -Raiz $raiz -Ahora 2>&1 | Out-String
Dice ("   salida: " + ($o -replace "\s+", " "))
Ok ($LASTEXITCODE -eq 0) "13'a) termina sin error (codigo $LASTEXITCODE)"
Ok ((Version-De $raiz) -eq "T-100") "13'b) no cambia nada"
Ok ((@(Eventos-De $raiz) -join "`n") -notmatch "OTA kit") "13'c) no genera ningun aviso para Emil"
Dice ("   log: " + ((@(Get-Content "$raiz\ota\actualizador.log" -Tail 3 -ErrorAction SilentlyContinue)) -join " | "))
Detener-Pruebas $raiz


# ---------- 14) De la v3.6 de PRODUCCION (21 nov, subdominio) a la v3.7, con el kit REAL en C:\PantallaCliente ----------
Dice "14) Actualizar desde la v3.6 de produccion (zip servido en www.dmalabomba.com) a la v3.7"
$shaV36 = "f5bf29ddfa56d4ce6fc4c9582a89a664e656acc99a0d6ec8089a38767e9db77b"
$real = "C:\PantallaCliente"
$z36 = Join-Path $base "kit-v3.6-produccion.zip"; $d36 = Join-Path $base "v36-produccion"
function Instalar-V36-Produccion {
  Detener-Pruebas $real
  foreach ($t in @("La Bomba Kit - Actualizador", "La Bomba Kit - Relanzar")) { Unregister-ScheduledTask -TaskName $t -TaskPath "\La Bomba\" -Confirm:$false -ErrorAction SilentlyContinue }
  if (Test-Path $real) { & takeown.exe /F $real /R /D Y 2>&1 | Out-Null; & icacls.exe $real /reset /T /C 2>&1 | Out-Null; Remove-Item $real -Recurse -Force -ErrorAction SilentlyContinue }
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $d36 "1 crear accesos y arranque automatico.ps1") -Silencioso 2>&1 | Out-Null
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $d36 "5 pantallas y permiso de ventanas.ps1") -Silencioso 2>&1 | Out-Null
  New-Item -ItemType Directory -Force "$real\datos" | Out-Null
  Set-Content -LiteralPath "$real\datos\equipo.json" -Value ('{"estacion":"caja-pollos","token":"x","pc":"' + $env:COMPUTERNAME + '"}') -Encoding UTF8
  Set-Content -LiteralPath "$real\datos\dato-del-negocio.txt" -Value "no tocar" -Encoding UTF8
}
function Ps-Codificado([string]$cmd) { return [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($cmd)) }
function Cfg-De($raiz) {
  $o = & powershell.exe -NoProfile -EncodedCommand (Ps-Codificado ('. "' + $raiz + '\config.ps1"; "{0}|{1}|{2}|{3}" -f $UrlCaja, $UrlCliente, ($Sitios -join ","), $VersionKit')) 2>&1 | Select-Object -Last 1
  $p = ([string]$o).Split("|"); return [pscustomobject]@{ caja = $p[0]; cliente = $p[1]; sitios = $p[2]; version = $p[3] }
}
function Directivas-Ok {
  $mal = @()
  foreach ($marca in @("Google\Chrome", "Microsoft\Edge")) { foreach ($lista in @("WindowManagementAllowedForUrls", "PopupsAllowedForUrls", "AutomaticFullscreenAllowedForUrls", "LocalNetworkAccessAllowedForUrls")) {
    $ru = "HKLM:\SOFTWARE\Policies\$marca\$lista"; $v = @(); if (Test-Path $ru) { $p = Get-ItemProperty $ru; $v = @($p.PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' } | ForEach-Object { $_.Name + "=" + $_.Value }) }
    if (-not (($v.Count -eq 2) -and ($v -contains "1=https://facturacion.dmalabomba.com") -and ($v -contains "2=https://www.dmalabomba.com"))) { $mal += ($marca + "\" + $lista + ": " + ($v -join ",")) }
  } }
  return $mal
}
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -Uri "https://www.dmalabomba.com/kit-caja/kit-pc-de-caja-v3.6.zip" -OutFile $z36 -UseBasicParsing -Headers @{ "Cache-Control" = "no-cache" }
  $h = (Get-FileHash $z36 -Algorithm SHA256).Hash.ToLower()
  Ok ($h -eq $shaV36) "14a) el zip v3.6 bajado de produccion tiene el SHA-256 publicado del 21 nov (es: $h)"
  Expand-Archive -LiteralPath $z36 -DestinationPath $d36 -Force

  # 14M) Camino real de la primera vez: INSTALAR TODO de la v3.7 encima de una caja con la v3.6 (pasos 1, 5 y 20 del instalador, con los scripts reales)
  Dice "14M) Instalacion manual de la v3.7 encima de la v3.6 de produccion"
  Instalar-V36-Produccion
  $c0 = Cfg-De $real
  Ok (($c0.version -eq "3.6 21nov") -and ($c0.caja -eq "https://facturacion.dmalabomba.com/")) "14M-a) punto de partida: v3.6 21nov apuntando al subdominio (es: $($c0.version) / $($c0.caja))"
  $hEq = (Get-FileHash "$real\datos\equipo.json").Hash
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $kitReal "1 crear accesos y arranque automatico.ps1") -Silencioso 2>&1 | Out-Null
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $kitReal "5 pantallas y permiso de ventanas.ps1") -Silencioso 2>&1 | Out-Null
  $o20 = & powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand (Ps-Codificado ('Set-Location "' + $kitReal + '"; . ".\config.ps1"; . ".\funciones.ps1"; . ".\funciones v3.ps1"; Remove-Item "$Carpeta\ota\.acl-v1" -Force -ErrorAction SilentlyContinue; Registrar-Tareas-OTA; & powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$Carpeta\20 actualizador.ps1" -SoloComprobar -Ahora 2>&1 | Out-Null; Test-Path "$Carpeta\ota\.acl-v1"')) 2>&1 | Out-String
  Dice ("   paso 20: " + ($o20 -replace "\s+", " "))
  $c1 = Cfg-De $real
  Ok ($c1.version -eq "3.7 ota 26nov") "14M-b) quedo la v3.7 (es: $($c1.version))"
  Ok (($c1.caja -eq "https://facturacion.dmalabomba.com/") -and ($c1.cliente -eq "https://facturacion.dmalabomba.com/cliente/")) "14M-c) la caja sigue en facturacion.dmalabomba.com y el cliente en /cliente/ (es: $($c1.caja) / $($c1.cliente))"
  Ok ($c1.sitios -eq "https://facturacion.dmalabomba.com,https://www.dmalabomba.com") "14M-d) los dos origenes de la transicion se conservan (es: $($c1.sitios))"
  $dm = @(Directivas-Ok); Ok ($dm.Count -eq 0) ("14M-e) Chrome y Edge siguen con permisos para el subdominio y www en las cuatro directivas " + ($dm -join " ; "))
  Ok ((Get-FileHash "$real\datos\equipo.json").Hash -eq $hEq) "14M-f) la identidad de la PC se conservo"
  Ok ((Get-Content "$real\datos\dato-del-negocio.txt" -Raw).Trim() -eq "no tocar") "14M-g) la carpeta datos se conservo"
  Ok ((Test-Path "$real\20 actualizador.ps1") -and (Test-Path "$real\ota serie.ps1") -and ((Get-Content "$real\ota serie.ps1" -Raw) -match '\$OtaSerie = 37')) "14M-h) el actualizador y la serie 37 quedaron instalados"
  $t1 = Get-ScheduledTask -TaskName "La Bomba Kit - Actualizador" -TaskPath "\La Bomba\" -ErrorAction SilentlyContinue
  Ok ($t1 -and ($t1.Principal.UserId -match "SYSTEM") -and ($t1.Triggers[0].StartBoundary -match "T03:00")) "14M-i) la tarea del actualizador existe, como SYSTEM, desde las 03:00 (es: $($t1.Triggers[0].StartBoundary) cada $($t1.Triggers[0].Repetition.Interval) por $($t1.Triggers[0].Repetition.Duration))"
  Ok (Test-Path "$real\ota\.acl-v1") "14M-j) la carpeta segura ota quedo preparada"
  foreach ($t in @("La Bomba Kit - Actualizador", "La Bomba Kit - Relanzar")) { Unregister-ScheduledTask -TaskName $t -TaskPath "\La Bomba\" -Confirm:$false -ErrorAction SilentlyContinue }

  # 14A) El mismo salto por el AIRE con el kit real (paquete de la v3.7 real, firmado con la llave de prueba): latido real, comprobacion de salud real
  Dice "14A) Actualizacion en el aire de la v3.6 de produccion a la v3.7 real"
  Instalar-V36-Produccion
  Copy-Item -LiteralPath (Join-Path $kitReal "20 actualizador.ps1") -Destination $real -Force   # arranque: la v3.6 no trae actualizador
  $hEq = (Get-FileHash "$real\datos\equipo.json").Hash
  $srv37 = Join-Path $base "srv37"; Servidor $srv37 $kitReal "caja-pollos"
  $cod = Correr $real (Join-Path $srv37 "manifiesto.json") @("-Ahora") "caja-pollos" "120"
  $c2 = Cfg-De $real
  Ok ($c2.version -eq "3.7 ota 26nov") "14A-a) por el aire quedo la v3.7 (es: $($c2.version))"
  Ok ((Estado-De $real).ultimo_resultado -eq "ok") "14A-b) el latido REAL de la v3.7 arranco y la salud dio ok (estado: $((Estado-De $real).ultimo_resultado) / $((Estado-De $real).ultimo_mensaje))"
  Ok (($c2.caja -eq "https://facturacion.dmalabomba.com/") -and ($c2.sitios -eq "https://facturacion.dmalabomba.com,https://www.dmalabomba.com")) "14A-c) el subdominio facturacion.dmalabomba.com y los dos origenes se conservan (es: $($c2.caja) / $($c2.sitios))"
  $dm = @(Directivas-Ok); Ok ($dm.Count -eq 0) ("14A-d) las directivas del navegador no se tocaron " + ($dm -join " ; "))
  Ok ((Get-FileHash "$real\datos\equipo.json").Hash -eq $hEq) "14A-e) la identidad de la PC se conservo"
  Ok ((Get-Content "$real\datos\dato-del-negocio.txt" -Raw).Trim() -eq "no tocar") "14A-f) la carpeta datos se conservo"
  $difs = @(); foreach ($f in @(Get-ChildItem $kitReal -File | Where-Object { $_.Extension -in ".ps1", ".bat" })) { if ((Get-FileHash $f.FullName).Hash -ne (Get-FileHash (Join-Path $real $f.Name)).Hash) { $difs += $f.Name } }
  Ok ($difs.Count -eq 0) ("14A-g) cada script instalado es identico al de la v3.7 " + ($difs -join ", "))
  Ok (Tiene-Usuarios "$real\config.ps1") "14A-h) los archivos nuevos son legibles para la cuenta de la caja"
  Ok ((Test-Path "$real\datos\ota estado.json") -and ((Get-Content "$real\datos\ota estado.json" -Raw) -match '"s":37')) "14A-i) el latido tiene el estado ota con la serie 37"
  Detener-Pruebas $real

  # 14B) Siguiente salto por el aire desde la v3.7 (simula una v3.8 de prueba): se conserva la configuracion y el subdominio
  Dice "14B) Desde la v3.7 a una v3.8 de prueba por el aire"
  $k38 = Join-Path $base "kit-38"; if (Test-Path $k38) { Remove-Item $k38 -Recurse -Force }; Copy-Item $kitReal $k38 -Recurse
  $cf = [IO.File]::ReadAllText("$k38\config.ps1"); [IO.File]::WriteAllText("$k38\config.ps1", ($cf -replace '\$VersionKit\s*=\s*"3\.7 ota 26nov"', '$VersionKit       = "3.8 prueba"'), (New-Object Text.UTF8Encoding($true)))
  [IO.File]::WriteAllText("$k38\ota serie.ps1", ([IO.File]::ReadAllText("$k38\ota serie.ps1") -replace '\$OtaSerie = 37', '$OtaSerie = 38'), (New-Object Text.UTF8Encoding($true)))
  $srv38 = Join-Path $base "srv38"; Servidor $srv38 $k38 "caja-pollos"
  $cod = Correr $real (Join-Path $srv38 "manifiesto.json") @("-Ahora") "caja-pollos" "120"
  $c3 = Cfg-De $real
  Ok (($c3.version -eq "3.8 prueba") -and ((Estado-De $real).ultimo_resultado -eq "ok")) "14B-a) de la v3.7 a la v3.8 por el aire, salud ok (es: $($c3.version) / $((Estado-De $real).ultimo_resultado))"
  Ok (($c3.caja -eq "https://facturacion.dmalabomba.com/") -and ($c3.sitios -eq "https://facturacion.dmalabomba.com,https://www.dmalabomba.com")) "14B-b) se conservan el subdominio y los origenes"
  Ok ((Get-FileHash "$real\datos\equipo.json").Hash -eq $hEq) "14B-c) se conserva la identidad"
  Detener-Pruebas $real
} catch { Ok $false ("14) actualizacion desde la v3.6 de produccion: " + $_.Exception.Message + " (linea " + $_.InvocationInfo.ScriptLineNumber + ")") }
finally { Detener-Pruebas $real }

# ---------- 15) El lanzamiento que se va a publicar (serie 37), firmado con la llave de PRODUCCION ----------
Dice "15) Lanzamiento a publicar: ota-kit\lanzamientos\serie 37"
try {
  $carpL = Join-Path $repo "ota-kit\lanzamientos\serie 37"
  . "$kitReal\ota llave publica.ps1"
  $mb = [IO.File]::ReadAllBytes("$carpL\manifiesto.json")
  $fb = [Convert]::FromBase64String(([IO.File]::ReadAllText("$carpL\manifiesto.json.firma")).Trim())
  $rsa = New-Object System.Security.Cryptography.RSACryptoServiceProvider; $rsa.FromXmlString($OtaLlavePublicaXml)
  Ok ($rsa.VerifyData($mb, "SHA256", $fb)) "15a) la firma del manifiesto se verifica con la llave publica de produccion que trae el kit"
  $m = ([Text.Encoding]::UTF8.GetString($mb)) | ConvertFrom-Json
  $l = @($m.lanzamientos)
  Ok (($l.Count -eq 1) -and ([int]$l[0].serie -eq 37) -and ($l[0].version -eq "3.7 ota 26nov")) "15b) un solo lanzamiento: serie 37, version 3.7 ota 26nov"
  Ok ((@($l[0].estaciones).Count -eq 1) -and (@($l[0].estaciones)[0] -eq "caja-pollos")) "15c) el anillo es solo caja-pollos (es: $(@($l[0].estaciones) -join ','))"
  $ds = [DateTime]::Parse([string]$l[0].desde, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AdjustToUniversal -bor [Globalization.DateTimeStyles]::AssumeUniversal)
  $ca = [DateTime]::Parse([string]$m.caduca, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AdjustToUniversal -bor [Globalization.DateTimeStyles]::AssumeUniversal)
  Ok (($ds -le [DateTime]::UtcNow) -and ($ca -gt [DateTime]::UtcNow.AddDays(20))) "15d) la fecha de inicio ya esta vigente ($($l[0].desde)) y caduca $($m.caduca)"
  Ok ($l[0].url -eq "https://www.dmalabomba.com/kit-caja/ota/paquetes/kit-37.zip") "15e) la direccion del paquete es la oficial"
  $zp = "$carpL\paquetes\kit-37.zip"
  Ok (((Get-FileHash $zp -Algorithm SHA256).Hash.ToLower() -eq $l[0].sha256) -and ((Get-Item $zp).Length -eq [long]$l[0].bytes)) "15f) el paquete coincide en SHA-256 y tamano con el manifiesto firmado"
  $chk = Join-Path $base "chk37"; Expand-Archive -LiteralPath $zp -DestinationPath $chk -Force
  $difs = @(); foreach ($f in @(Get-ChildItem $kitReal -File | Where-Object { $_.Extension -in ".ps1", ".bat" })) { if (-not (Test-Path (Join-Path $chk $f.Name)) -or ((Get-FileHash $f.FullName).Hash -ne (Get-FileHash (Join-Path $chk $f.Name)).Hash)) { $difs += $f.Name } }
  Ok (($difs.Count -eq 0) -and (@(Get-ChildItem $chk -File).Count -eq @(Get-ChildItem $kitReal -File | Where-Object { $_.Extension -in ".ps1", ".bat" }).Count)) ("15g) el paquete trae exactamente los scripts de la v3.7 " + ($difs -join ", "))
} catch { Ok $false ("15) lanzamiento a publicar: " + $_.Exception.Message) }

# ---------- 16) (solo despues de publicar) camino de PRODUCCION sin -Prueba contra www.dmalabomba.com ----------
if ($env:OTA_EN_VIVO -eq "1") {
  Dice "16) En vivo: el actualizador de produccion (sin -Prueba) contra el manifiesto publicado"
  try {
    foreach ($caso in @(@{ est = "caja-soda"; espera = "3.6 21nov" }, @{ est = "caja-pollos"; espera = "3.7 ota 26nov" })) {
      Instalar-V36-Produccion
      Copy-Item -LiteralPath (Join-Path $kitReal "20 actualizador.ps1") -Destination $real -Force
      Copy-Item -LiteralPath (Join-Path $kitReal "ota llave publica.ps1") -Destination $real -Force
      Set-Content -LiteralPath "$real\datos\equipo.json" -Value ('{"estacion":"' + $caso.est + '","token":"x","pc":"' + $env:COMPUTERNAME + '"}') -Encoding UTF8
      # como deja la PC el INSTALAR TODO de la v3.7: tareas programadas reales (actualizador como SYSTEM y relanzar con el grupo Usuarios)
      $rt = & powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand (Ps-Codificado ('Set-Location "' + $kitReal + '"; . ".\config.ps1"; . ".\funciones.ps1"; . ".\funciones v3.ps1"; Registrar-Tareas-OTA')) 2>&1 | Out-String
      Dice ("   tareas: " + ($rt -replace "\s+", " ") + "; sesion de Windows (explorer): " + (@(Get-Process explorer -ErrorAction SilentlyContinue).Count))
      $o = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$real\20 actualizador.ps1" -Ahora 2>&1 | Out-String
      Dice ("   " + $caso.est + " log: " + ((@(Get-Content "$real\ota\actualizador.log" -Tail 14 -ErrorAction SilentlyContinue)) -join " | "))
      Dice ("   arranque.txt: " + ((@(Get-Content "$real\datos\arranque.txt" -Tail 8 -ErrorAction SilentlyContinue)) -join " | "))
      $cv = Cfg-De $real
      Ok ($cv.version -eq $caso.espera) ("16) " + $caso.est + ": queda " + $caso.espera + " (es: " + $cv.version + "; estado " + (Estado-De $real).ultimo_resultado + ")")
      if ($caso.est -eq "caja-pollos") { Ok ($cv.caja -eq "https://facturacion.dmalabomba.com/") "16b) caja-pollos en vivo: el subdominio se conserva" }
      Detener-Pruebas $real
    }
  } catch { Ok $false ("16) en vivo: " + $_.Exception.Message) }
}

Dice ("RESULTADO: " + ($script:Pasos - $script:Fallos) + " de " + $script:Pasos + " comprobaciones correctas; fallos: " + $script:Fallos)
Get-ChildItem $base -Recurse -Filter "actualizador.log" -ErrorAction SilentlyContinue | ForEach-Object { Copy-Item $_.FullName (Join-Path $res ("actualizador-" + $_.Directory.Parent.Name + ".log")) -ErrorAction SilentlyContinue }
if ($script:Fallos -gt 0) { exit 1 }
exit 0
