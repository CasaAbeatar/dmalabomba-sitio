# Pruebas del actualizador OTA del kit de caja v3.9 (respaldo ante fallas del DNS) en Windows PowerShell 5.1 real (ejecutor de GitHub, administrador).
# No toca ninguna PC de caja: todo ocurre en carpetas de prueba y con una llave de prueba.
$ErrorActionPreference = "Continue"
$aqui = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = (Resolve-Path (Join-Path $aqui "..\..")).Path
$kitReal = (Get-ChildItem -LiteralPath (Join-Path $repo "kit pc caja") -Directory | Where-Object { $_.Name -like "v3.9*" } | Select-Object -First 1).FullName
$kit38 = (Get-ChildItem -LiteralPath (Join-Path $repo "kit pc caja") -Directory | Where-Object { $_.Name -like "v3.8*" } | Select-Object -First 1).FullName
$kit37 = (Get-ChildItem -LiteralPath (Join-Path $repo "kit pc caja") -Directory | Where-Object { $_.Name -like "v3.7*" } | Select-Object -First 1).FullName
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

# ---------- 0) sintaxis de todos los scripts del kit v3.9 con el parser de 5.1 ----------
$malos = 0
foreach ($f in Get-ChildItem $kitReal -Filter *.ps1) { $e = $null; $t = $null; [void][System.Management.Automation.Language.Parser]::ParseFile($f.FullName, [ref]$t, [ref]$e); if ($e.Count) { $malos++; Dice ("SINTAXIS " + $f.Name + ": " + $e[0].Message + " L" + $e[0].Extent.StartLineNumber) } }
Ok ($malos -eq 0) "0) Ningun script del kit v3.9 tiene errores de sintaxis en 5.1"

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
  $HostsPermitidos = @("www.dmalabomba.com", "dma-sitio.pages.dev"); $RutaPermitida = "/kit-caja/ota/"
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
  Ok (Url-Permitida "https://dma-sitio.pages.dev/kit-caja/ota/manifiesto.json") "13i) el origen alterno oficial (dma-sitio.pages.dev) se permite"
  Ok (-not (Url-Permitida "https://dma-sitio.pages.dev.evil.com/kit-caja/ota/x.zip")) "13j) dominio que solo empieza como el alterno NO"
  Ok (-not (Url-Permitida "https://otro-proyecto.pages.dev/kit-caja/ota/x.zip")) "13k) otro proyecto de pages.dev NO"
  Ok (-not (Url-Permitida "https://dma-sitio.pages.dev/otra-ruta/x.zip")) "13l) otra ruta del origen alterno NO"
  Ok (-not (Url-Permitida "http://dma-sitio.pages.dev/kit-caja/ota/x.zip")) "13m) el origen alterno sin cifrar NO"
  $bloque = [regex]::Match($txtAct, '(?s)\$Origenes\s*=\s*@\((.*?)\r?\n\)').Groups[1].Value
  $lista = @([regex]::Matches($bloque, '(?m)^\s*"(https://[^"]+)"') | ForEach-Object { $_.Groups[1].Value })
  Ok (($lista.Count -eq 2) -and ($lista[0] -eq "https://www.dmalabomba.com") -and ($lista[1] -eq "https://dma-sitio.pages.dev")) "13n) la lista oficial de origenes es www.dmalabomba.com y dma-sitio.pages.dev, en ese orden, ambos https (es: $($lista -join ' , '))"
  Ok ($txtAct -notmatch '(?m)^\s*"https://[^"]*gitlab[^"]*"') "13o) el espejo de GitLab NO esta activado (no esta confirmado)"
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


# ---------- 14) De la v3.6 de PRODUCCION (21 nov, subdominio) a la v3.9, con el kit REAL en C:\PantallaCliente ----------
Dice "14) Actualizar desde la v3.6 de produccion (zip servido en www.dmalabomba.com) a la v3.9"
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

  # 14M) Camino real de la primera vez: INSTALAR TODO de la v3.9 encima de una caja con la v3.6 (pasos 1, 5 y 20 del instalador, con los scripts reales)
  Dice "14M) Instalacion manual de la v3.9 encima de la v3.6 de produccion"
  Instalar-V36-Produccion
  $c0 = Cfg-De $real
  Ok (($c0.version -eq "3.6 21nov") -and ($c0.caja -eq "https://facturacion.dmalabomba.com/")) "14M-a) punto de partida: v3.6 21nov apuntando al subdominio (es: $($c0.version) / $($c0.caja))"
  $hEq = (Get-FileHash "$real\datos\equipo.json").Hash
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $kitReal "1 crear accesos y arranque automatico.ps1") -Silencioso 2>&1 | Out-Null
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $kitReal "5 pantallas y permiso de ventanas.ps1") -Silencioso 2>&1 | Out-Null
  $o20 = & powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand (Ps-Codificado ('Set-Location "' + $kitReal + '"; . ".\config.ps1"; . ".\funciones.ps1"; . ".\funciones v3.ps1"; Remove-Item "$Carpeta\ota\.acl-v1" -Force -ErrorAction SilentlyContinue; Registrar-Tareas-OTA; & powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$Carpeta\20 actualizador.ps1" -SoloComprobar -Ahora 2>&1 | Out-Null; Test-Path "$Carpeta\ota\.acl-v1"')) 2>&1 | Out-String
  Dice ("   paso 20: " + ($o20 -replace "\s+", " "))
  $c1 = Cfg-De $real
  Ok ($c1.version -eq "3.9 respaldo DNS 28nov") "14M-b) quedo la v3.9 (es: $($c1.version))"
  Ok (($c1.caja -eq "https://facturacion.dmalabomba.com/") -and ($c1.cliente -eq "https://facturacion.dmalabomba.com/cliente/")) "14M-c) la caja sigue en facturacion.dmalabomba.com y el cliente en /cliente/ (es: $($c1.caja) / $($c1.cliente))"
  Ok ($c1.sitios -eq "https://facturacion.dmalabomba.com,https://www.dmalabomba.com") "14M-d) los dos origenes de la transicion se conservan (es: $($c1.sitios))"
  $dm = @(Directivas-Ok); Ok ($dm.Count -eq 0) ("14M-e) Chrome y Edge siguen con permisos para el subdominio y www en las cuatro directivas " + ($dm -join " ; "))
  Ok ((Get-FileHash "$real\datos\equipo.json").Hash -eq $hEq) "14M-f) la identidad de la PC se conservo"
  Ok ((Get-Content "$real\datos\dato-del-negocio.txt" -Raw).Trim() -eq "no tocar") "14M-g) la carpeta datos se conservo"
  Ok ((Test-Path "$real\20 actualizador.ps1") -and (Test-Path "$real\ota serie.ps1") -and ((Get-Content "$real\ota serie.ps1" -Raw) -match '\$OtaSerie = 39')) "14M-h) el actualizador y la serie 39 quedaron instalados"
  $t1 = Get-ScheduledTask -TaskName "La Bomba Kit - Actualizador" -TaskPath "\La Bomba\" -ErrorAction SilentlyContinue
  Ok ($t1 -and ($t1.Principal.UserId -match "SYSTEM") -and ($t1.Triggers[0].StartBoundary -match "T03:00")) "14M-i) la tarea del actualizador existe, como SYSTEM, desde las 03:00 (es: $($t1.Triggers[0].StartBoundary) cada $($t1.Triggers[0].Repetition.Interval) por $($t1.Triggers[0].Repetition.Duration))"
  Ok (Test-Path "$real\funciones contingencia.ps1") "14M-k) INSTALAR TODO copia tambien el archivo nuevo funciones contingencia.ps1"
  Ok (Test-Path "$real\ota\.acl-v1") "14M-j) la carpeta segura ota quedo preparada"
  foreach ($t in @("La Bomba Kit - Actualizador", "La Bomba Kit - Relanzar")) { Unregister-ScheduledTask -TaskName $t -TaskPath "\La Bomba\" -Confirm:$false -ErrorAction SilentlyContinue }

  # 14A) El mismo salto por el AIRE con el kit real (paquete de la v3.9 real, firmado con la llave de prueba): latido real, comprobacion de salud real
  Dice "14A) Actualizacion en el aire de la v3.6 de produccion a la v3.9 real"
  Instalar-V36-Produccion
  Copy-Item -LiteralPath (Join-Path $kitReal "20 actualizador.ps1") -Destination $real -Force   # arranque: la v3.6 no trae actualizador
  $hEq = (Get-FileHash "$real\datos\equipo.json").Hash
  $srv37 = Join-Path $base "srv37"; Servidor $srv37 $kitReal "caja-pollos"
  $cod = Correr $real (Join-Path $srv37 "manifiesto.json") @("-Ahora") "caja-pollos" "120"
  $c2 = Cfg-De $real
  Ok ($c2.version -eq "3.9 respaldo DNS 28nov") "14A-a) por el aire quedo la v3.9 (es: $($c2.version))"
  Ok ((Estado-De $real).ultimo_resultado -eq "ok") "14A-b) el latido REAL de la v3.9 arranco y la salud dio ok (estado: $((Estado-De $real).ultimo_resultado) / $((Estado-De $real).ultimo_mensaje))"
  Ok (($c2.caja -eq "https://facturacion.dmalabomba.com/") -and ($c2.sitios -eq "https://facturacion.dmalabomba.com,https://www.dmalabomba.com")) "14A-c) el subdominio facturacion.dmalabomba.com y los dos origenes se conservan (es: $($c2.caja) / $($c2.sitios))"
  $dm = @(Directivas-Ok); Ok ($dm.Count -eq 0) ("14A-d) las directivas del navegador no se tocaron " + ($dm -join " ; "))
  Ok ((Get-FileHash "$real\datos\equipo.json").Hash -eq $hEq) "14A-e) la identidad de la PC se conservo"
  Ok ((Get-Content "$real\datos\dato-del-negocio.txt" -Raw).Trim() -eq "no tocar") "14A-f) la carpeta datos se conservo"
  $difs = @(); foreach ($f in @(Get-ChildItem $kitReal -File | Where-Object { $_.Extension -in ".ps1", ".bat" })) { if ((Get-FileHash $f.FullName).Hash -ne (Get-FileHash (Join-Path $real $f.Name)).Hash) { $difs += $f.Name } }
  Ok ($difs.Count -eq 0) ("14A-g) cada script instalado es identico al de la v3.9 " + ($difs -join ", "))
  Ok (Tiene-Usuarios "$real\config.ps1") "14A-h) los archivos nuevos son legibles para la cuenta de la caja"
  Ok ((Test-Path "$real\datos\ota estado.json") -and ((Get-Content "$real\datos\ota estado.json" -Raw) -match '"s":39')) "14A-i) el latido tiene el estado ota con la serie 39"
  Ok ((Test-Path "$real\funciones dns.ps1") -and (Test-Path "$real\22 dns publico.ps1") -and (Test-Path "$real\FIJAR DNS PUBLICO.bat") -and (Test-Path "$real\RESTAURAR DNS.bat")) "14A-j) llegaron los archivos nuevos del respaldo DNS"
  Ok (((Get-Content "$real\config.ps1" -Raw) -match '\$RutaPorIp\s*=\s*\$true') -and ((Get-Content "$real\config.ps1" -Raw) -match '\$DnsPublicoRespaldo\s*=\s*\$false')) "14A-k) config.ps1: ruta por IP encendida y cambio de DNS del adaptador APAGADO"
  Ok ((Tiene-Usuarios "$real\funciones dns.ps1") -and (Tiene-Usuarios "$real\22 dns publico.ps1")) "14A-l) los archivos del respaldo DNS son legibles para la cuenta de la caja"
  Detener-Pruebas $real

  # 14B) Siguiente salto por el aire desde la v3.9 (simula una v4.0 de prueba): se conserva la configuracion y el subdominio
  Dice "14B) Desde la v3.9 a una v4.0 de prueba por el aire"
  $k40 = Join-Path $base "kit-40"; if (Test-Path $k40) { Remove-Item $k40 -Recurse -Force }; Copy-Item $kitReal $k40 -Recurse
  $cf = [IO.File]::ReadAllText("$k40\config.ps1"); [IO.File]::WriteAllText("$k40\config.ps1", ($cf -replace '\$VersionKit\s*=\s*"3\.9 respaldo DNS 28nov"', '$VersionKit       = "4.0 prueba"'), (New-Object Text.UTF8Encoding($true)))
  [IO.File]::WriteAllText("$k40\ota serie.ps1", ([IO.File]::ReadAllText("$k40\ota serie.ps1") -replace '\$OtaSerie = 39', '$OtaSerie = 40'), (New-Object Text.UTF8Encoding($true)))
  $srv40 = Join-Path $base "srv38"; Servidor $srv40 $k40 "caja-pollos"
  $cod = Correr $real (Join-Path $srv40 "manifiesto.json") @("-Ahora") "caja-pollos" "120"
  $c3 = Cfg-De $real
  Ok (($c3.version -eq "4.0 prueba") -and ((Estado-De $real).ultimo_resultado -eq "ok")) "14B-a) de la v3.9 a la v4.0 por el aire, salud ok (es: $($c3.version) / $((Estado-De $real).ultimo_resultado))"
  Ok (($c3.caja -eq "https://facturacion.dmalabomba.com/") -and ($c3.sitios -eq "https://facturacion.dmalabomba.com,https://www.dmalabomba.com")) "14B-b) se conservan el subdominio y los origenes"
  Ok ((Get-FileHash "$real\datos\equipo.json").Hash -eq $hEq) "14B-c) se conserva la identidad"
  Detener-Pruebas $real
} catch { Ok $false ("14) actualizacion desde la v3.6 de produccion: " + $_.Exception.Message + " (linea " + $_.InvocationInfo.ScriptLineNumber + ")") }
finally { Detener-Pruebas $real }


# ---------- 14C) Desde la v3.7 REAL instalada (actualizador version 1, que solo conoce www) a la v3.9 por el aire ----------
Dice "14C) Desde la v3.7 real instalada (actualizador viejo) a la v3.9 por el aire"
try {
  Instalar-V36-Produccion
  foreach ($f in @(Get-ChildItem $kit37 -File | Where-Object { $_.Extension -in ".ps1", ".bat" })) { Copy-Item -LiteralPath $f.FullName -Destination $real -Force }
  $hEq = (Get-FileHash "$real\datos\equipo.json").Hash
  $c7 = Cfg-De $real
  Ok ($c7.version -eq "3.7 ota 26nov") "14C-a) punto de partida: v3.7 real instalada (es: $($c7.version))"
  Ok ((Get-Content "$real\20 actualizador.ps1" -Raw) -notmatch 'dma-sitio\.pages\.dev') "14C-b) el actualizador instalado es el viejo (no conoce el origen alterno)"
  $srv38b = Join-Path $base "srv38b"; Servidor $srv38b $kitReal "caja-pollos"
  $cod = Correr $real (Join-Path $srv38b "manifiesto.json") @("-Ahora") "caja-pollos" "120"
  $c8 = Cfg-De $real
  Ok ($c8.version -eq "3.9 respaldo DNS 28nov") "14C-c) por el aire quedo la v3.9 (es: $($c8.version))"
  Ok ((Estado-De $real).ultimo_resultado -eq "ok") "14C-d) la salud dio ok con el kit v3.9 real (estado: $((Estado-De $real).ultimo_resultado) / $((Estado-De $real).ultimo_mensaje))"
  Ok ((Get-FileHash "$real\20 actualizador.ps1").Hash -eq (Get-FileHash (Join-Path $kitReal "20 actualizador.ps1")).Hash) "14C-e) el actualizador nuevo (version 2, con origenes alternos) quedo instalado"
  Ok ((Test-Path "$real\funciones contingencia.ps1") -and ((Get-Content "$real\config.ps1" -Raw) -match '\$ContingenciaFacturador\s*=\s*\$true')) "14C-f) llego el archivo nuevo de contingencia y su ajuste en config.ps1"
  Ok (($c8.caja -eq "https://facturacion.dmalabomba.com/") -and ($c8.sitios -eq "https://facturacion.dmalabomba.com,https://www.dmalabomba.com")) "14C-g) se conservan el subdominio y los dos origenes del navegador"
  Ok ((Get-FileHash "$real\datos\equipo.json").Hash -eq $hEq) "14C-h) se conserva la identidad de la PC"
  Ok ((Get-Content "$real\datos\dato-del-negocio.txt" -Raw).Trim() -eq "no tocar") "14C-i) se conserva la carpeta datos"
  $difs = @(); foreach ($f in @(Get-ChildItem $kitReal -File | Where-Object { $_.Extension -in ".ps1", ".bat" })) { if ((Get-FileHash $f.FullName).Hash -ne (Get-FileHash (Join-Path $real $f.Name)).Hash) { $difs += $f.Name } }
  Ok ($difs.Count -eq 0) ("14C-j) cada script instalado es identico al de la v3.9 " + ($difs -join ", "))
  Ok ((Test-Path "$real\datos\ota estado.json") -and ((Get-Content "$real\datos\ota estado.json" -Raw) -match '"s":39')) "14C-k) el latido tiene el estado ota con la serie 39"
  Detener-Pruebas $real
  # el actualizador NUEVO ya instalado: otra corrida = al dia
  $antes = (Get-Item "$real\config.ps1").LastWriteTime
  $cod = Correr $real (Join-Path $srv38b "manifiesto.json") @("-Ahora") "caja-pollos" "60"
  Ok ($cod -eq 0 -and ((Get-Item "$real\config.ps1").LastWriteTime -eq $antes)) "14C-l) el actualizador nuevo, ya instalado, dice al dia y no cambia nada"
} catch { Ok $false ("14C) de la v3.7 real a la v3.9: " + $_.Exception.Message + " (linea " + $_.InvocationInfo.ScriptLineNumber + ")") }
finally { Detener-Pruebas $real }

# ---------- 14D) Desde la v3.8 REAL instalada (produccion hoy, actualizador version 2) a la v3.9 por el aire, y 14E) la vuelta atras ----------
Dice "14D) Desde la v3.8 real instalada a la v3.9 por el aire"
try {
  Instalar-V36-Produccion
  foreach ($f in @(Get-ChildItem $kit38 -File | Where-Object { $_.Extension -in ".ps1", ".bat" })) { Copy-Item -LiteralPath $f.FullName -Destination $real -Force }
  $hEq = (Get-FileHash "$real\datos\equipo.json").Hash
  $c9 = Cfg-De $real
  Ok ($c9.version -eq "3.8 dominios 27nov") "14D-a) punto de partida: v3.8 real instalada (es: $($c9.version))"
  Ok ((Get-Content "$real\config.ps1" -Raw) -notmatch 'RutaPorIp') "14D-b) la v3.8 instalada no conoce la ruta por IP"
  $srv39d = Join-Path $base "srv39d"; Servidor $srv39d $kitReal "caja-pollos"
  $cod = Correr $real (Join-Path $srv39d "manifiesto.json") @("-Ahora") "caja-pollos" "120"
  $c10 = Cfg-De $real
  Ok ($c10.version -eq "3.9 respaldo DNS 28nov") "14D-c) por el aire quedo la v3.9 (es: $($c10.version))"
  Ok ((Estado-De $real).ultimo_resultado -eq "ok") "14D-d) la salud dio ok con el kit v3.9 real (estado: $((Estado-De $real).ultimo_resultado) / $((Estado-De $real).ultimo_mensaje))"
  Ok ((Test-Path "$real\funciones dns.ps1") -and (Test-Path "$real\22 dns publico.ps1") -and (Test-Path "$real\FIJAR DNS PUBLICO.bat") -and (Test-Path "$real\RESTAURAR DNS.bat")) "14D-e) llegaron los archivos nuevos del respaldo DNS"
  Ok (((Get-Content "$real\config.ps1" -Raw) -match '\$RutaPorIp\s*=\s*\$true') -and ((Get-Content "$real\config.ps1" -Raw) -match '\$DnsPublicoRespaldo\s*=\s*\$false')) "14D-f) config.ps1 nuevo: ruta por IP encendida y DNS del adaptador sin tocar (apagado)"
  Ok (($c10.caja -eq "https://facturacion.dmalabomba.com/") -and ($c10.sitios -eq "https://facturacion.dmalabomba.com,https://www.dmalabomba.com")) "14D-g) se conservan el subdominio y los dos origenes"
  Ok ((Get-FileHash "$real\datos\equipo.json").Hash -eq $hEq) "14D-h) se conserva la identidad de la PC"
  Ok ((Get-Content "$real\datos\dato-del-negocio.txt" -Raw).Trim() -eq "no tocar") "14D-i) se conserva la carpeta datos"
  $difs = @(); foreach ($f in @(Get-ChildItem $kitReal -File | Where-Object { $_.Extension -in ".ps1", ".bat" })) { if ((Get-FileHash $f.FullName).Hash -ne (Get-FileHash (Join-Path $real $f.Name)).Hash) { $difs += $f.Name } }
  Ok ($difs.Count -eq 0) ("14D-j) cada script instalado es identico al de la v3.9 " + ($difs -join ", "))
  Ok ((Test-Path "$real\datos\ota estado.json") -and ((Get-Content "$real\datos\ota estado.json" -Raw) -match '"s":39')) "14D-k) el latido tiene el estado ota con la serie 39"
  Ok ((Tiene-Usuarios "$real\funciones dns.ps1") -and (Tiene-Usuarios "$real\22 dns publico.ps1") -and (Tiene-Usuarios "$real\FIJAR DNS PUBLICO.bat")) "14D-l) los archivos nuevos son legibles para la cuenta de la caja"
  Detener-Pruebas $real

  # 14E) Vuelta atras: se reemite el kit v3.8 con una serie MAYOR (la serie nunca baja): la caja queda en la v3.8 y sigue sana
  Dice "14E) Vuelta atras: la v3.8 reemitida como serie 40"
  $k38r = Join-Path $base "kit-38-reemitido"; if (Test-Path $k38r) { Remove-Item $k38r -Recurse -Force }; Copy-Item $kit38 $k38r -Recurse
  [IO.File]::WriteAllText("$k38r\ota serie.ps1", ([IO.File]::ReadAllText("$k38r\ota serie.ps1") -replace '\$OtaSerie = 38', '$OtaSerie = 40'), (New-Object Text.UTF8Encoding($true)))
  $srv40r = Join-Path $base "srv40r"; Servidor $srv40r $k38r "caja-pollos"
  $cod = Correr $real (Join-Path $srv40r "manifiesto.json") @("-Ahora") "caja-pollos" "120"
  $c11 = Cfg-De $real
  Ok ($c11.version -eq "3.8 dominios 27nov") "14E-a) tras reemitir la v3.8 con serie 40, la caja vuelve a la v3.8 (es: $($c11.version))"
  Ok ((Estado-De $real).ultimo_resultado -eq "ok") "14E-b) la salud dio ok tras la vuelta atras (estado: $((Estado-De $real).ultimo_resultado) / $((Estado-De $real).ultimo_mensaje))"
  Ok ((Get-Content "$real\config.ps1" -Raw) -notmatch 'RutaPorIp') "14E-c) config.ps1 es otra vez el de la v3.8"
  Ok ((Get-FileHash "$real\datos\equipo.json").Hash -eq $hEq) "14E-d) la identidad de la PC se conserva tambien en la vuelta atras"
  Ok ((Test-Path "$real\datos\ota estado.json") -and ((Get-Content "$real\datos\ota estado.json" -Raw) -match '"s":40')) "14E-e) el latido tiene el estado ota con la serie 40"
  Dice ("   archivos de la v3.9 que quedan sin usar tras la vuelta atras (inofensivos, la v3.8 no los carga): " + ((@("funciones dns.ps1", "22 dns publico.ps1", "FIJAR DNS PUBLICO.bat", "RESTAURAR DNS.bat") | Where-Object { Test-Path (Join-Path $real $_) }) -join ", "))
  Detener-Pruebas $real
} catch { Ok $false ("14D) de la v3.8 real a la v3.9: " + $_.Exception.Message + " (linea " + $_.InvocationInfo.ScriptLineNumber + ")") }
finally { Detener-Pruebas $real }

# ---------- 15) El lanzamiento candidato (serie 39): paquete listo, SIN firma de produccion (la firma y la publicacion las decide Emil) ----------
Dice "15) Lanzamiento candidato: ota-kit\lanzamientos\serie 39 (sin firmar con la llave de produccion)"
try {
  $carpL = Join-Path $repo "ota-kit\lanzamientos\serie 39"
  Ok (Test-Path "$carpL\paquetes\kit-39.zip") "15a) existe el paquete kit-39.zip"
  Ok (-not (Test-Path "$carpL\manifiesto.json") -and -not (Test-Path "$carpL\manifiesto.json.firma")) "15b) NO hay manifiesto ni firma en la carpeta candidata (no se firma con la llave de produccion aqui)"
  $cand = ([IO.File]::ReadAllText("$carpL\candidato-lanzamiento.json")) | ConvertFrom-Json
  $zp = "$carpL\paquetes\kit-39.zip"
  Ok (((Get-FileHash $zp -Algorithm SHA256).Hash.ToLower() -eq $cand.sha256) -and ((Get-Item $zp).Length -eq [long]$cand.bytes)) "15c) el paquete coincide en SHA-256 y tamano con candidato-lanzamiento.json"
  Ok (($cand.serie -eq 39) -and ($cand.version -eq "3.9 respaldo DNS 28nov") -and ($cand.url -eq "https://www.dmalabomba.com/kit-caja/ota/paquetes/kit-39.zip")) "15d) serie 39, version 3.9 respaldo DNS 28nov, direccion oficial"
  $chk = Join-Path $base "chk39"; Expand-Archive -LiteralPath $zp -DestinationPath $chk -Force
  $difs = @(); foreach ($f in @(Get-ChildItem $kitReal -File | Where-Object { $_.Extension -in ".ps1", ".bat" })) { if (-not (Test-Path (Join-Path $chk $f.Name)) -or ((Get-FileHash $f.FullName).Hash -ne (Get-FileHash (Join-Path $chk $f.Name)).Hash)) { $difs += $f.Name } }
  Ok (($difs.Count -eq 0) -and (@(Get-ChildItem $chk -File).Count -eq @(Get-ChildItem $kitReal -File | Where-Object { $_.Extension -in ".ps1", ".bat" }).Count)) ("15e) el paquete trae exactamente los scripts de la carpeta v3.9 " + ($difs -join ", "))
  # el paquete se rearma igual (el zip es determinista): al firmarlo con la llave de produccion el SHA-256 sera el mismo
  $rearm = Join-Path $base "rearmado39"; New-Item -ItemType Directory -Force $rearm | Out-Null
  & python $crear $kitReal --llave $llavePriv --salida $rearm --estaciones caja-pollos 2>&1 | Out-Null
  $rz = Join-Path $base "rearmado39x"; Expand-Archive -LiteralPath "$rearm\paquetes\kit-39.zip" -DestinationPath $rz -Force
  $difR = @(); foreach ($f in @(Get-ChildItem $chk -File)) { if (-not (Test-Path (Join-Path $rz $f.Name)) -or ((Get-FileHash $f.FullName).Hash -ne (Get-FileHash (Join-Path $rz $f.Name)).Hash)) { $difR += $f.Name } }
  Ok (($difR.Count -eq 0) -and (@(Get-ChildItem $rz -File).Count -eq @(Get-ChildItem $chk -File).Count)) "15f) al rearmar el paquete con crear_lanzamiento.py salen exactamente los mismos archivos (el SHA-256 del zip puede variar segun la version de zlib: el que se firma es el del zip que arma quien firma) $($difR -join ', ')"
  $c38 = "$repo\ota-kit\lanzamientos\serie 38"
  Ok ((Test-Path "$c38\paquetes\kit-38.zip") -and (Test-Path "$c38\candidato-lanzamiento.json")) "15g0) el candidato de la serie 38 (v3.8) sigue intacto en el repositorio"
  $m37 = "$repo\ota-kit\lanzamientos\serie 37"
  Ok ((Test-Path "$m37\manifiesto.json") -and (Test-Path "$m37\manifiesto.json.firma") -and (Test-Path "$m37\paquetes\kit-37.zip")) "15g) la serie 37 publicada sigue intacta en el repositorio"
} catch { Ok $false ("15) lanzamiento candidato: " + $_.Exception.Message) }

# ---------- 17) Origenes alternos: servidores HTTP locales (127.0.0.1), mismas verificaciones en cada origen ----------
Dice "17) Origenes alternos con servidores locales"
$PuertoMuerto = 8199; $PuertoMuerto2 = 8198
$script:Webs = @()
function Servidor-Origen($nombre, $kitDir, $estaciones = "caja-pollos", $extra = @()) {
  $web = Join-Path $base $nombre; $otaW = Join-Path $web "kit-caja\ota"
  New-Item -ItemType Directory -Force $otaW | Out-Null
  $a2 = @($crear, $kitDir, "--llave", $llavePriv, "--salida", $otaW, "--estaciones", $estaciones) + $extra
  $o = & python @a2 2>&1
  Dice ("   origen '" + $nombre + "': " + ($o -join " "))
  return $web
}
function Levantar-Web($web, $puerto) {
  $p = Start-Process -FilePath "python" -ArgumentList @("-m", "http.server", "$puerto", "--bind", "127.0.0.1", "--directory", $web) -PassThru -WindowStyle Hidden
  for ($i = 0; $i -lt 30; $i++) { try { $c = New-Object Net.Sockets.TcpClient; $c.Connect("127.0.0.1", $puerto); $c.Close(); break } catch { Start-Sleep -Milliseconds 500 } }
  $script:Webs += $p
  return $p
}
function Parar-Webs { foreach ($p in @($script:Webs)) { try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch { $null = 1 } }; $script:Webs = @() }
function Correr-Origenes($raiz, $puertos, $extra = @(), $est = "caja-pollos", $espera = "40") {
  $orig = ((@($puertos) | ForEach-Object { "http://127.0.0.1:" + $_ }) -join ",")
  $a = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "$raiz\20 actualizador.ps1", "-Raiz", $raiz, "-Prueba", "-OrigenesPrueba", $orig, "-LlavePublica", $llavePub, "-Estacion", $est, "-EsperaSaludSeg", $espera) + $extra
  $o = & powershell.exe @a 2>&1 | Out-String
  foreach ($l in ($o -split "`r?`n")) { if ($l.Trim()) { Dice ("      | " + $l.Trim()) } }
  Dice ("      log: " + ((@(Get-Content "$raiz\ota\actualizador.log" -Tail 6 -ErrorAction SilentlyContinue)) -join " | "))
  return $LASTEXITCODE
}
function Fallidas-De($raiz) { $st = Estado-De $raiz; if ($st -and $st.fallidas) { return @($st.fallidas) } else { return @() } }
function Corte-Zip($web, [int]$serie) { $zp = Join-Path $web ("kit-caja\ota\paquetes\kit-" + $serie + ".zip"); $zb = [IO.File]::ReadAllBytes($zp); $zb[100] = $zb[100] -bxor 0xFF; [IO.File]::WriteAllBytes($zp, $zb) }
$hoyUtc = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd") + "T09:30:00Z"   # 03:30 hora de Costa Rica: dentro de la ventana
try {
  $webB = Servidor-Origen "web-b" $k2 "caja-pollos" @("--desde", "2020-01-01T00:00:00Z")          # origen sano con T-101 (vigente desde antes de la hora simulada de la ventana)
  [void](Levantar-Web $webB 8102)

  Dice "17a) El origen 1 no responde (conexion rechazada): se usa el 2 en la MISMA corrida, dentro de la ventana 03:00-05:00"
  $raiz = Join-Path $base "pcO1"; Instalar-Raiz $raiz "T-100" 100
  $cod = Correr-Origenes $raiz @($PuertoMuerto, 8102) @("-AhoraUtc", $hoyUtc)
  Ok ((Version-De $raiz) -eq "T-101") "17a) quedo T-101 por el origen 2 (es: $(Version-De $raiz))"
  Ok ((Estado-De $raiz).ultimo_resultado -eq "ok") "17a') estado ok (es: $((Estado-De $raiz).ultimo_resultado) / $((Estado-De $raiz).ultimo_mensaje))"
  Ok ((@(Eventos-De $raiz) -join "`n") -match "origen alterno 127\.0\.0\.1:8102") "17a'') el evento dice que se instalo por el origen alterno"
  Ok ((Test-Path "$raiz\ota\diario.json") -and ((Get-Content "$raiz\ota\diario.json" -Raw | ConvertFrom-Json).estado -eq "confirmada")) "17a''') el diario quedo confirmado (la reversion sigue disponible: hay respaldo)"
  Detener-Pruebas $raiz

  Dice "17a2) Mismo corte pero FUERA de la ventana (09:00 CR): no se instala"
  $raiz = Join-Path $base "pcO1f"; Instalar-Raiz $raiz "T-100" 100
  $cod = Correr-Origenes $raiz @($PuertoMuerto, 8102) @("-AhoraUtc", "2026-11-27T15:00:00Z")
  Ok ((Version-De $raiz) -eq "T-100") "17a2) fuera de la ventana no se instala aunque haya origen alterno"
  Detener-Pruebas $raiz

  Dice "17b) El origen 1 devuelve una pagina web en vez del manifiesto (dominio caido o estacionado)"
  $webL = Join-Path $base "web-lander"; New-Item -ItemType Directory -Force (Join-Path $webL "kit-caja\ota\paquetes") | Out-Null
  Set-Content -LiteralPath (Join-Path $webL "kit-caja\ota\manifiesto.json") -Value "<html><head><title>dmalabomba.com is for sale</title></head><body>comprar</body></html>" -Encoding ASCII
  Set-Content -LiteralPath (Join-Path $webL "kit-caja\ota\manifiesto.json.firma") -Value "<html>comprar</html>" -Encoding ASCII
  [void](Levantar-Web $webL 8103)
  $raiz = Join-Path $base "pcO2"; Instalar-Raiz $raiz "T-100" 100
  $cod = Correr-Origenes $raiz @(8103, 8102) @("-Ahora")
  Ok ((Version-De $raiz) -eq "T-101") "17b) con una pagina web en el origen 1, se usa el 2 y queda T-101 (es: $(Version-De $raiz))"
  Detener-Pruebas $raiz

  Dice "17c) El origen 1 sirve un manifiesto MANIPULADO (firma invalida): se rechaza, se alerta y se usa el origen 2"
  $webC = Servidor-Origen "web-c1" $k2
  $mc = Join-Path $webC "kit-caja\ota\manifiesto.json"
  Set-Content -LiteralPath $mc -Value ((Get-Content $mc -Raw) -replace '"serie": 101', '"serie": 102') -NoNewline -Encoding ASCII
  [void](Levantar-Web $webC 8104)
  $raiz = Join-Path $base "pcO3"; Instalar-Raiz $raiz "T-100" 100
  $cod = Correr-Origenes $raiz @(8104, 8102) @("-Ahora")
  Ok ((Version-De $raiz) -eq "T-101") "17c) se instalo T-101 desde el origen sano, NO la serie 102 manipulada (es: $(Version-De $raiz))"
  Ok ((@(Eventos-De $raiz) -join "`n") -match "firma invalida") "17c') quedo el evento de alerta por la firma invalida del origen 1"
  Detener-Pruebas $raiz

  Dice "17c2) Manifiesto manipulado en TODOS los origenes: no se instala nada"
  $raiz = Join-Path $base "pcO3b"; Instalar-Raiz $raiz "T-100" 100
  $cod = Correr-Origenes $raiz @(8104, 8104) @("-Ahora")
  Ok ((Version-De $raiz) -eq "T-100" -and (Estado-De $raiz).ultimo_resultado -eq "firma_invalida") "17c2) todos manipulados: nada se instala y el estado es firma_invalida (es: $((Estado-De $raiz).ultimo_resultado))"
  Detener-Pruebas $raiz

  Dice "17d) Manifiesto valido en el origen 1 pero PAQUETE ALTERADO: se descarta ese paquete, se alerta y se baja del origen 2"
  $webB2 = Servidor-Origen "web-b2" $k2        # sano, emitido primero
  Start-Sleep -Seconds 2
  $webD1 = Servidor-Origen "web-d1" $k2        # emitido despues (su manifiesto es el mas reciente) pero con el paquete alterado
  Corte-Zip $webD1 101
  [void](Levantar-Web $webD1 8105); [void](Levantar-Web $webB2 8106)
  $raiz = Join-Path $base "pcO4"; Instalar-Raiz $raiz "T-100" 100
  $cod = Correr-Origenes $raiz @(8105, 8106) @("-Ahora")
  Ok ((Version-De $raiz) -eq "T-101") "17d) se instalo T-101 con el paquete del origen 2 (es: $(Version-De $raiz))"
  $ev = (@(Eventos-De $raiz) -join "`n")
  Ok ($ev -match "sirvio un paquete") "17d') quedo el evento de alerta: el origen 1 sirvio un paquete que no coincide con la huella firmada"
  Ok (@(Fallidas-De $raiz).Count -eq 0) "17d'') la serie 101 NO quedo como fallida (un origen malo no bloquea las actualizaciones)"
  Ok ($ev -match "origen alterno 127\.0\.0\.1:8106") "17d''') el evento de exito dice que vino del origen alterno"
  Detener-Pruebas $raiz

  Dice "17e) Paquete alterado en TODOS los origenes: rechazado y la serie queda anotada"
  $webE2 = Servidor-Origen "web-e2" $k2; Corte-Zip $webE2 101; [void](Levantar-Web $webE2 8107)
  $raiz = Join-Path $base "pcO5"; Instalar-Raiz $raiz "T-100" 100
  $cod = Correr-Origenes $raiz @(8105, 8107) @("-Ahora")
  Ok ((Version-De $raiz) -eq "T-100" -and (Estado-De $raiz).ultimo_resultado -eq "rechazado") "17e) nada se instala y el estado es rechazado (es: $((Estado-De $raiz).ultimo_resultado))"
  Ok (@((Estado-De $raiz).fallidas | Where-Object { $_.serie -eq 101 }).Count -eq 1) "17e') la serie 101 quedo anotada como fallida (backoff)"
  Detener-Pruebas $raiz

  Dice "17f) Ningun origen responde (caida total o sin internet): no es fallo de la serie ni alarma"
  $raiz = Join-Path $base "pcO6"; Instalar-Raiz $raiz "T-100" 100
  $cod = Correr-Origenes $raiz @($PuertoMuerto, $PuertoMuerto2) @("-Ahora")
  Ok ($cod -eq 0 -and (Version-De $raiz) -eq "T-100") "17f) termina sin error y no cambia nada (codigo $cod)"
  Ok (@(Fallidas-De $raiz).Count -eq 0) "17f') no queda ninguna serie fallida"
  Ok ((@(Eventos-De $raiz) -join "`n") -notmatch "OTA kit") "17f'') no genera ningun aviso para Emil"
  Ok ((Get-Content "$raiz\ota\actualizador.log" -Raw) -match "de ningun origen") "17f''') el registro dice que ningun origen respondio"
  Detener-Pruebas $raiz

  Dice "17g) Dos manifiestos validos, uno atrasado en el origen 1: se usa el mas reciente (un origen atrasado no congela las actualizaciones)"
  $kG = Join-Path $base "kit-g"; Nuevo-Kit $kG "T-102" 102
  $webG1 = Servidor-Origen "web-g1" $k2        # T-101, emitido antes
  Start-Sleep -Seconds 2
  $webG2 = Servidor-Origen "web-g2" $kG        # T-102, emitido despues
  [void](Levantar-Web $webG1 8108); [void](Levantar-Web $webG2 8109)
  $raiz = Join-Path $base "pcO7"; Instalar-Raiz $raiz "T-100" 100
  $cod = Correr-Origenes $raiz @(8108, 8109) @("-Ahora")
  Ok ((Version-De $raiz) -eq "T-102") "17g) queda T-102 (el manifiesto mas reciente), no T-101 del origen atrasado (es: $(Version-De $raiz))"
  Detener-Pruebas $raiz

  Dice "17h) El kit nuevo llega por el origen alterno pero NO arranca: vuelta atras automatica"
  $kR = Join-Path $base "kit-r"; Nuevo-Kit $kR "T-103" 103 "latido-roto"
  $webR = Servidor-Origen "web-r" $kR; [void](Levantar-Web $webR 8110)
  $raiz = Join-Path $base "pcO8"; Instalar-Raiz $raiz "T-100" 100
  $cod = Correr-Origenes $raiz @($PuertoMuerto, 8110) @("-Ahora")
  $st = Estado-De $raiz
  Ok ((Version-De $raiz) -eq "T-100" -and $st.ultimo_resultado -eq "revertida") "17h) volvio a T-100 y el estado es revertida (es: $(Version-De $raiz) / $($st.ultimo_resultado))"
  Ok (Test-Path "$raiz\viejo-que-ya-no-va.ps1") "17h') el archivo que se habia quitado volvio con el respaldo"
  Detener-Pruebas $raiz

  Dice "17i) El origen 1 acepta la conexion y no contesta nunca (colgado): se espera el tiempo limite y se usa el 2"
  Set-Content -LiteralPath (Join-Path $base "colgado.py") -Value "import socket, time`ns = socket.socket()`ns.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)`ns.bind(('127.0.0.1', 8111))`ns.listen(20)`nwhile True: time.sleep(60)" -Encoding ASCII
  $pc = Start-Process -FilePath "python" -ArgumentList @((Join-Path $base "colgado.py")) -PassThru -WindowStyle Hidden; $script:Webs += $pc
  Start-Sleep -Seconds 2
  $raiz = Join-Path $base "pcO9"; Instalar-Raiz $raiz "T-100" 100
  $cr = [Diagnostics.Stopwatch]::StartNew()
  $cod = Correr-Origenes $raiz @(8111, 8102) @("-Ahora")
  Ok ((Version-De $raiz) -eq "T-101") "17i) con el origen colgado igual se instalo T-101 (es: $(Version-De $raiz); tardo $([int]$cr.Elapsed.TotalSeconds) s)"
  Ok ($cr.Elapsed.TotalSeconds -lt 150) "17i') la espera por el origen colgado esta acotada (tardo $([int]$cr.Elapsed.TotalSeconds) s)"
  Detener-Pruebas $raiz

  Dice "17j) Seguridad: -OrigenesPrueba sin -Prueba se ignora (produccion solo consulta los origenes de la lista oficial)"
  $logW = Join-Path $base "web-j.log"
  $pj = Start-Process -FilePath "python" -ArgumentList @("-u", "-m", "http.server", "8112", "--bind", "127.0.0.1", "--directory", $webB) -PassThru -WindowStyle Hidden -RedirectStandardError $logW; $script:Webs += $pj
  Start-Sleep -Seconds 2
  $raiz = Join-Path $base "pcO10"; Instalar-Raiz $raiz "T-100" 100
  Set-Content -LiteralPath "$raiz\datos\equipo.json" -Value ('{"estacion":"caja-pollos","token":"x","pc":"' + $env:COMPUTERNAME + '"}') -Encoding UTF8
  $o = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$raiz\20 actualizador.ps1" -Raiz $raiz -OrigenesPrueba "http://127.0.0.1:8112" -Ahora 2>&1 | Out-String
  Dice ("   salida: " + ($o -replace "\s+", " "))
  Dice ("   log: " + ((@(Get-Content "$raiz\ota\actualizador.log" -Tail 4 -ErrorAction SilentlyContinue)) -join " | "))
  $accesos = @(Get-Content $logW -ErrorAction SilentlyContinue | Where-Object { $_ -match "GET " })
  Ok ($accesos.Count -eq 0) "17j) el servidor local no recibio ninguna peticion (recibio $($accesos.Count))"
  Ok ((Version-De $raiz) -eq "T-100") "17j') la PC no se actualizo desde ese origen"
  Detener-Pruebas $raiz
} catch { Ok $false ("17) origenes alternos: " + $_.Exception.Message + " (linea " + $_.InvocationInfo.ScriptLineNumber + ")") }
finally { Parar-Webs }

# ---------- 18) En vivo, con corte de DNS simulado (archivo hosts): www.dmalabomba.com NO resuelve y el actualizador de PRODUCCION usa dma-sitio.pages.dev ----------
Dice "18) En vivo con corte de DNS: el actualizador de produccion (sin -Prueba, llave de produccion) contra los origenes reales"
$hostsRuta = "$env:SystemRoot\System32\drivers\etc\hosts"
$hostsOrig = [IO.File]::ReadAllBytes($hostsRuta)
function Cortar-Dns($nombres) {
  [IO.File]::WriteAllBytes($hostsRuta, $hostsOrig)
  $extra = ($nombres | ForEach-Object { "0.0.0.0 " + $_ }) -join "`r`n"
  Add-Content -LiteralPath $hostsRuta -Value ("`r`n" + $extra) -Encoding ASCII
  & ipconfig.exe /flushdns 2>&1 | Out-Null
}
function Sondear-Rapido($u) { try { Invoke-WebRequest -Uri $u -UseBasicParsing -TimeoutSec 15 | Out-Null; return $true } catch { return $false } }
function Restaurar-Dns { [IO.File]::WriteAllBytes($hostsRuta, $hostsOrig); & ipconfig.exe /flushdns 2>&1 | Out-Null }
try {
  Instalar-V36-Produccion
  Copy-Item -LiteralPath (Join-Path $kitReal "20 actualizador.ps1") -Destination $real -Force
  Copy-Item -LiteralPath (Join-Path $kitReal "ota llave publica.ps1") -Destination $real -Force
  # como deja la PC el INSTALAR TODO: tareas programadas reales (actualizador como SYSTEM y relanzar con el grupo Usuarios)
  $rt = & powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand (Ps-Codificado ('Set-Location "' + $kitReal + '"; . ".\config.ps1"; . ".\funciones.ps1"; . ".\funciones v3.ps1"; Registrar-Tareas-OTA')) 2>&1 | Out-String
  Dice ("   tareas: " + ($rt -replace "\s+", " "))
  $hEq = (Get-FileHash "$real\datos\equipo.json").Hash

  Cortar-Dns @("www.dmalabomba.com", "dmalabomba.com")
  $ips = @(); try { $ips = @([Net.Dns]::GetHostAddresses("www.dmalabomba.com") | ForEach-Object { $_.ToString() }) } catch { $ips = @("error: " + $_.Exception.Message) }
  Ok (($ips -contains "0.0.0.0") -or ($ips.Count -eq 1 -and $ips[0] -like "error:*")) "18a) el corte simulado funciona: www.dmalabomba.com ya no resuelve a una direccion real (es: $($ips -join ','))"
  $sw1 = Sondear-Rapido "https://www.dmalabomba.com/kit-caja/ota/manifiesto.json"
  Ok (-not $sw1) "18a') www.dmalabomba.com no se puede bajar con el corte"
  $o = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$real\20 actualizador.ps1" -Ahora -EsperaSaludSeg 120 2>&1 | Out-String
  Dice ("   salida: " + ($o -replace "\s+", " "))
  $logv = (@(Get-Content "$real\ota\actualizador.log" -Tail 30 -ErrorAction SilentlyContinue)) -join " | "
  Dice ("   log: " + $logv)
  $cv = Cfg-De $real
  Ok ($cv.version -eq "3.7 ota 26nov") "18b) con www caido, el actualizador de produccion instalo el lanzamiento publicado (3.7 ota 26nov) por dma-sitio.pages.dev (es: $($cv.version); estado $((Estado-De $real).ultimo_resultado) / $((Estado-De $real).ultimo_mensaje))"
  Ok ($logv -match "Origen www\.dmalabomba\.com: no se pudo bajar el manifiesto") "18c) el registro dice que www no respondio"
  Ok ($logv -match "Manifiesto de dma-sitio\.pages\.dev") "18d) el registro dice que se uso el manifiesto de dma-sitio.pages.dev (firma verificada con la llave de produccion)"
  Ok ((@(Eventos-De $real) -join "`n") -match "origen alterno dma-sitio\.pages\.dev") "18e) el evento al panel dice que se instalo por el origen alterno"
  Ok ((Get-FileHash "$real\datos\equipo.json").Hash -eq $hEq) "18f) la identidad de la PC se conservo"
  Detener-Pruebas $real

  Dice "18g) Corte de los DOS origenes: no se instala, no es fallo de la serie, no avisa"
  Instalar-V36-Produccion
  Copy-Item -LiteralPath (Join-Path $kitReal "20 actualizador.ps1") -Destination $real -Force
  Copy-Item -LiteralPath (Join-Path $kitReal "ota llave publica.ps1") -Destination $real -Force
  Cortar-Dns @("www.dmalabomba.com", "dmalabomba.com", "dma-sitio.pages.dev")
  $o = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$real\20 actualizador.ps1" -Ahora 2>&1 | Out-String
  $cv = Cfg-De $real
  Ok ($LASTEXITCODE -eq 0 -and $cv.version -eq "3.6 21nov") "18g) sin ningun origen la caja sigue en la v3.6 y el actualizador termina sin error (es: $($cv.version))"
  Ok (@((Estado-De $real).fallidas).Count -eq 0) "18g') no quedo ninguna serie fallida"
  Ok ((@(Eventos-De $real) -join "`n") -notmatch "OTA kit") "18g'') no genero ningun aviso"
  Ok ((Get-Content "$real\ota\actualizador.log" -Raw) -match "de ningun origen") "18g''') el registro dice que ningun origen respondio"
  Restaurar-Dns
} catch { Ok $false ("18) en vivo con corte de DNS: " + $_.Exception.Message + " (linea " + $_.InvocationInfo.ScriptLineNumber + ")") }
finally { Restaurar-Dns; foreach ($tt in @("La Bomba Kit - Actualizador", "La Bomba Kit - Relanzar")) { Unregister-ScheduledTask -TaskName $tt -TaskPath "\La Bomba\" -Confirm:$false -ErrorAction SilentlyContinue }; Detener-Pruebas $real }

# ---------- 19) Contingencia del facturador: funciones (sondeo, copia guardada, decision, avisos) ----------
Dice "19) Contingencia del facturador (funciones de funciones contingencia.ps1)"
$pEst = $null
try {
  Set-Content -LiteralPath (Join-Path $base "srv_estados.py") -Value (Get-Content (Join-Path $aqui "srv_estados.py") -Raw) -Encoding UTF8
  $pEst = Start-Process -FilePath "python" -ArgumentList @((Join-Path $base "srv_estados.py"), "8191") -PassThru -WindowStyle Hidden
  for ($i = 0; $i -lt 30; $i++) { try { $c = New-Object Net.Sockets.TcpClient; $c.Connect("127.0.0.1", 8191); $c.Close(); break } catch { Start-Sleep -Milliseconds 500 } }
  # entorno minimo (en el kit real lo da config.ps1; aqui se simula sin tocar nada de C:\PantallaCliente)
  $Datos = Join-Path $base "datos19"; New-Item -ItemType Directory -Force $Datos | Out-Null
  $ContingenciaFacturador = $true; $MarcaFacturador = "Facturaci"; $SondeoFacturadorMin = 5; $PuertoPublicidad = 8766
  $SupabaseUrl = "https://dwlbcbtwdungyrykgahm.supabase.co"; $UrlCaja = "http://127.0.0.1:8191/ok"; $urlCajaAbrir = "http://127.0.0.1:8191/ok"
  $Perfil = Join-Path $base "perfil19"
  $script:Ev = @(); $script:Lg = @()
  function Registrar-Evento($tipo, $detalle) { $script:Ev += ($tipo + "|" + $detalle) }
  function Anotar($t) { $script:Lg += $t }
  function Servidor-Vivo { return $true }
  . "$kitReal\funciones contingencia.ps1"

  $r = Sondear-Facturador -Url "http://127.0.0.1:8191/ok"
  Ok ($r.ok -and $r.motivo -eq "ok") "19a) pagina real del facturador (titulo con Facturaci...): ok"
  $r = Sondear-Facturador -Url "http://127.0.0.1:8191/lander"
  Ok ((-not $r.ok) -and $r.motivo -eq "contenido" -and (Es-Caida-Probada $r)) "19b) pagina de dominio estacionado (200 pero no es el facturador): contenido, cuenta como caida"
  $r = Sondear-Facturador -Url "http://127.0.0.1:8191/503"
  Ok ((-not $r.ok) -and $r.motivo -eq "http_503") "19c) 503 del proveedor: http_503"
  $r = Sondear-Facturador -Url "http://127.0.0.1:8191/404"
  Ok ((-not $r.ok) -and $r.motivo -eq "http_404") "19c') 404: http_404"
  $r = Sondear-Facturador -Url "http://127.0.0.1:8191/redir"
  Ok ((-not $r.ok) -and $r.motivo -eq "http_302") "19c'') redireccion: no se sigue (http_302)"
  $r = Sondear-Facturador -Url "http://127.0.0.1:8190/ok"
  Ok ((-not $r.ok) -and $r.motivo -eq "conexion") "19d) puerto cerrado: conexion"
  $r = Sondear-Facturador -Url "https://no-existe-la-bomba.invalid/"
  Ok ((-not $r.ok) -and $r.motivo -eq "dns") "19d') el nombre no resuelve (DNS caido): dns (es: $($r.motivo))"
  $r = Sondear-Facturador -Url "http://127.0.0.1:8191/colgado" -MsHttp 3000
  Ok ((-not $r.ok) -and $r.motivo -eq "tiempo" -and $r.ms -lt 15000) "19d'') servidor colgado: tiempo, acotado (es: $($r.motivo) en $($r.ms) ms)"
  Ok (-not (Es-Caida-Probada ([pscustomobject]@{ ok = $false; motivo = "desconocido" }))) "19e) un error propio del sondeo (desconocido) NO se toma como prueba de caida: se abre normal"
  # simulacion de DNS caido con el archivo hosts y la direccion real del facturador
  $hostsRuta = "$env:SystemRoot\System32\drivers\etc\hosts"; $hostsOrig19 = [IO.File]::ReadAllBytes($hostsRuta)
  try {
    Add-Content -LiteralPath $hostsRuta -Value "`r`n0.0.0.0 facturacion.dmalabomba.com" -Encoding ASCII; & ipconfig.exe /flushdns 2>&1 | Out-Null
    $r = Sondear-Facturador -Url "https://facturacion.dmalabomba.com/" -MsHttp 8000
    Ok ((-not $r.ok) -and (Es-Caida-Probada $r)) "19f) con facturacion.dmalabomba.com cortado (hosts -> 0.0.0.0) el sondeo da caida (es: $($r.motivo))"
  } finally { [IO.File]::WriteAllBytes($hostsRuta, $hostsOrig19); & ipconfig.exe /flushdns 2>&1 | Out-Null }
  $r = Sondear-Facturador -Url "https://facturacion.dmalabomba.com/"
  Ok ($r.ok) "19f') sin el corte, el facturador real responde y es la pagina del facturador (es: $($r.motivo))"

  # copia guardada del perfil (estructura de Chrome: Default\Service Worker)
  $pf = Join-Path $base "perfil-con-copia"
  New-Item -ItemType Directory -Force "$pf\Default\Service Worker\CacheStorage\abc\def", "$pf\Default\Service Worker\Database" | Out-Null
  [IO.File]::WriteAllBytes("$pf\Default\Service Worker\CacheStorage\abc\def\0_0", (New-Object byte[] 5000))
  [IO.File]::WriteAllBytes("$pf\Default\Service Worker\Database\000003.log", [Text.Encoding]::ASCII.GetBytes("xxREG:https://facturacion.dmalabomba.com/yy"))
  Ok (Perfil-Tiene-Copia $pf "facturacion.dmalabomba.com") "19g) perfil con CacheStorage y registro del service worker del dominio: hay copia"
  Ok (-not (Perfil-Tiene-Copia $pf "otro.dmalabomba.com")) "19g') el registro es de otro dominio: no hay copia"
  Ok (-not (Perfil-Tiene-Copia (Join-Path $base "no-existe") "facturacion.dmalabomba.com")) "19g'') perfil inexistente: no hay copia"
  $pf2 = Join-Path $base "perfil-sin-cache"; New-Item -ItemType Directory -Force "$pf2\Default\Service Worker\Database", "$pf2\Default\Service Worker\CacheStorage" | Out-Null
  [IO.File]::WriteAllBytes("$pf2\Default\Service Worker\Database\000003.log", [Text.Encoding]::ASCII.GetBytes("REG:https://facturacion.dmalabomba.com/"))
  Ok (-not (Perfil-Tiene-Copia $pf2 "facturacion.dmalabomba.com")) "19g''') registro sin cache guardada: no hay copia"

  # decision de apertura
  $UrlCaja = "http://127.0.0.1:8191/ok"; $script:ModoFacturador = "normal"
  $u = Decidir-Apertura
  Ok (($u -eq $urlCajaAbrir) -and $script:ModoFacturador -eq "normal") "19h) facturador alcanzable: se abre la direccion normal, modo normal"
  $UrlCaja = "http://127.0.0.1:8191/503"; $Perfil = Join-Path $base "perfil-vacio19"; New-Item -ItemType Directory -Force $Perfil | Out-Null
  $u = Decidir-Apertura
  Ok (($u -eq "http://127.0.0.1:8766/contingencia/") -and $script:ModoFacturador -eq "contingencia") "19h') caido y sin copia: se abre la pantalla local de contingencia (es: $u / $($script:ModoFacturador))"
  Ok (-not (Puede-Abrir-Cliente)) "19h'') en contingencia NO se abre la pantalla del cliente"
  $UrlCaja = "http://127.0.0.1:8191/503"; $Perfil = $pf
  $script:ModoFacturador = "normal"
  $dbTmp = "$pf\Default\Service Worker\Database\000003.log"; [IO.File]::WriteAllBytes($dbTmp, [Text.Encoding]::ASCII.GetBytes("REG:http://127.0.0.1:8191/"))
  $u = Decidir-Apertura
  Ok (($u -eq $urlCajaAbrir) -and $script:ModoFacturador -eq "copia") "19h''') caido pero con copia guardada: se abre la direccion normal (el navegador sirve la copia), modo copia (es: $u / $($script:ModoFacturador))"
  Ok (Puede-Abrir-Cliente) "19h'''') en modo copia la pantalla del cliente SI se abre"
  $ContingenciaFacturador = $false; $script:ModoFacturador = "normal"; $Perfil = Join-Path $base "perfil-vacio19"
  $u = Decidir-Apertura
  Ok (($u -eq $urlCajaAbrir) -and $script:ModoFacturador -eq "normal") "19i) con `$ContingenciaFacturador = `$false se comporta como la v3.7 aunque este caido"
  $ContingenciaFacturador = $true
  $UrlCaja = "http://127.0.0.1:8190/ok"; $script:ModoFacturador = "normal"
  $u = Decidir-Apertura
  Ok ((($u -eq "http://127.0.0.1:8766/contingencia/") -and $script:ModoFacturador -eq "contingencia")) "19i') puerto cerrado tambien activa la contingencia"

  # avisos: uno por caida (despues de 2 comprobaciones seguidas) y uno al restablecerse
  $script:Ev = @(); $script:CaidasSeguidas = 0; $script:CaidoDesde = $null; $script:CaidaAvisada = $false; $script:ModoFacturador = "contingencia"
  $caido = [pscustomobject]@{ ok = $false; motivo = "dns"; ms = 1 }; $bueno = [pscustomobject]@{ ok = $true; motivo = "ok"; ms = 1 }
  Notar-Facturador $caido "contingencia"
  Ok ($script:Ev.Count -eq 0) "19j) una sola comprobacion fallida NO avisa (puede ser un tropiezo)"
  Notar-Facturador $bueno "normal"
  Ok (($script:Ev.Count -eq 0) -and $script:ModoFacturador -eq "normal") "19j') si la siguiente responde, no hubo aviso y se vuelve a modo normal"
  Notar-Facturador $caido "normal"; Notar-Facturador $caido "normal"
  Ok (($script:Ev.Count -eq 1) -and $script:Ev[0] -match "^otro\|Facturador no alcanzable desde esta caja: dns") "19k) dos fallidas seguidas: UN aviso (es: $($script:Ev -join ' // '))"
  Notar-Facturador $caido "normal"; Notar-Facturador $caido "normal"
  Ok ($script:Ev.Count -eq 1) "19k') mas fallidas de la misma caida no repiten el aviso"
  Notar-Facturador $bueno "normal"
  Ok (($script:Ev.Count -eq 2) -and $script:Ev[1] -match "alcanzable de nuevo") "19l) al volver el facturador: UN aviso de restablecido (es: $($script:Ev -join ' // '))"
  Notar-Facturador $bueno "normal"
  Ok ($script:Ev.Count -eq 2) "19l') mientras siga bien no hay mas avisos"
  # estado para la pantalla local
  $arch = Join-Path $Datos "facturador.json"
  Guardar-Estado-Facturador $caido "contingencia" $arch
  $j = (Leer-Estado-Facturador $arch) | ConvertFrom-Json
  Ok (($j.ok -eq $false) -and $j.motivo -eq "dns" -and $j.modo -eq "contingencia" -and $j.edad -ge 0 -and $j.edad -lt 10) "19m) el estado que lee la pantalla local: caido, motivo dns, edad reciente"
  $viejo = (Get-Content $arch -Raw | ConvertFrom-Json); $viejo.ts = (Get-Date).AddMinutes(-5).ToString("s"); ($viejo | ConvertTo-Json -Compress) | Set-Content $arch -Encoding ASCII
  $j = (Leer-Estado-Facturador $arch) | ConvertFrom-Json
  Ok ($j.edad -ge 290) "19m') un estado viejo se reporta con su edad (la pagina lo descarta si pasa de 90 s)"
  Remove-Item $arch -Force
  $j = (Leer-Estado-Facturador $arch) | ConvertFrom-Json
  Ok (($j.edad -eq -1) -and $j.motivo -eq "sin_dato") "19m'') sin archivo: sin_dato"
  # la pagina
  $pg = Pagina-Contingencia "https://facturacion.dmalabomba.com/"
  Ok (($pg -match 'var DEST = "https://facturacion\.dmalabomba\.com/";') -and ($pg -match 'Sin conexi&oacute;n al facturador') -and ($pg -match 'fetch\("/facturador"')) "19n) la pagina trae el destino, el titulo y consulta /facturador"
  Ok ($pg -notmatch 'https?://(?!facturacion\.dmalabomba\.com)[a-z]') "19n') la pagina no referencia ningun otro sitio externo"
} catch { Ok $false ("19) contingencia: " + $_.Exception.Message + " (linea " + $_.InvocationInfo.ScriptLineNumber + ")") }
finally { if ($pEst) { Stop-Process -Id $pEst.Id -Force -ErrorAction SilentlyContinue } }

Dice ("RESULTADO: " + ($script:Pasos - $script:Fallos) + " de " + $script:Pasos + " comprobaciones correctas; fallos: " + $script:Fallos)
Get-ChildItem $base -Recurse -Filter "actualizador.log" -ErrorAction SilentlyContinue | ForEach-Object { Copy-Item $_.FullName (Join-Path $res ("actualizador-" + $_.Directory.Parent.Name + ".log")) -ErrorAction SilentlyContinue }
if ($script:Fallos -gt 0) { exit 1 }
exit 0
