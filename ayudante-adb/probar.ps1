# Pruebas del ayudante con el adb simulado (corre en Windows y en Linux con PowerShell 7).
$ErrorActionPreference = 'Stop'
$aqui = $PSScriptRoot
$fallos = 0
function Check([string]$n, [bool]$c, [string]$extra = '') { if ($c) { Write-Host "PASS $n $extra" } else { Write-Host "FAIL $n $extra"; $script:fallos++ } }
$pw = (Get-Process -Id $PID).Path
function Correr([string[]]$args2, [string]$falla = '') {
  $env:ADB_FALSO_LOG = Join-Path $aqui 'adb-falso.log'; Remove-Item -LiteralPath $env:ADB_FALSO_LOG -ErrorAction SilentlyContinue
  $env:ADB_FALSO_FALLA = $falla
  $reg = Join-Path $aqui 'ayudante-prueba.log'; Remove-Item -LiteralPath $reg -ErrorAction SilentlyContinue
  $viejo = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  $salida = & $pw -NoProfile -File (Join-Path $aqui 'ayudante-adb.ps1') -AdbPath (Join-Path $aqui 'adb-falso.ps1') -Registro $reg -Si @args2 2>&1 | Out-String
  $codigo = $LASTEXITCODE; $ErrorActionPreference = $viejo
  return @{ Codigo = $codigo; Salida = $salida; Registro = $(if (Test-Path $reg) { Get-Content -Raw $reg } else { '' }); Adb = $(if (Test-Path $env:ADB_FALSO_LOG) { Get-Content -Raw $env:ADB_FALSO_LOG } else { '' }) }
}
# 1. camino feliz
$r = Correr @('-Emparejar', '192.168.1.50:37001', '-Codigo', '123456', '-Conectar', '192.168.1.50:41234')
Check 'camino feliz: sale con 0' ($r.Codigo -eq 0) "codigo=$($r.Codigo)"
Check 'empareja con el codigo' ($r.Adb -match 'pair 192\.168\.1\.50:37001 123456')
Check 'concede WRITE_SECURE_SETTINGS' ($r.Adb -match 'pm grant tech\.bogomolov\.incomingsmsgateway android\.permission\.WRITE_SECURE_SETTINGS')
Check 'exime de la bateria' ($r.Adb -match 'dumpsys deviceidle whitelist \+tech\.bogomolov\.incomingsmsgateway')
Check 'segundo plano' ($r.Adb -match 'appops set tech\.bogomolov\.incomingsmsgateway RUN_ANY_IN_BACKGROUND allow')
Check 'prioridad activa' ($r.Adb -match 'am set-standby-bucket tech\.bogomolov\.incomingsmsgateway active')
Check 'apaga la depuracion inalambrica y desconecta' ($r.Adb -match 'settings put global adb_wifi_enabled 0' -and $r.Adb -match 'disconnect 192\.168\.1\.50:41234')
Check 'el registro NO guarda el codigo' ($r.Registro -notmatch '123456')
Check 'el registro anota las comprobaciones' ($r.Registro -match 'Comprobado: WRITE_SECURE_SETTINGS')
# 2. un permiso falla: termina con 2 y lo dice
$r = Correr @('-Emparejar', '192.168.1.50:37001', '-Codigo', '123456', '-Conectar', '192.168.1.50:41234') 'grant'
Check 'permiso denegado: sale con 2' ($r.Codigo -eq 2) "codigo=$($r.Codigo)"
Check 'anota el FALLO y sigue con los demas pasos' ($r.Registro -match 'FALLO Permiso WRITE_SECURE_SETTINGS' -and $r.Adb -match 'am set-standby-bucket')
# 3. IP publica rechazada, sin tocar nada
$r = Correr @('-Emparejar', '8.8.8.8:37001', '-Codigo', '123456', '-Conectar', '192.168.1.50:41234')
Check 'IP publica: rechazada' ($r.Codigo -ne 0 -and $r.Adb -notmatch 'pair')
$r = Correr @('-Emparejar', '192.168.1.50:37001', '-Codigo', '123456', '-Conectar', 'telefono.local:41234')
Check 'nombre en vez de IP: rechazado' ($r.Codigo -ne 0 -and $r.Adb -notmatch 'connect')
# 4. codigo mal escrito / emparejamiento fallido
$r = Correr @('-Emparejar', '192.168.1.50:37001', '-Codigo', '12ab56', '-Conectar', '192.168.1.50:41234')
Check 'codigo no numerico: rechazado' ($r.Codigo -ne 0 -and $r.Adb -notmatch 'pair')
$r = Correr @('-Emparejar', '192.168.1.50:37001', '-Codigo', '000000', '-Conectar', '192.168.1.50:41234')
Check 'emparejamiento fallido: no sigue' ($r.Codigo -ne 0 -and $r.Adb -notmatch 'pm grant' -and $r.Registro -notmatch '000000')
# 5. paquete raro
$r = Correr @('-Emparejar', '192.168.1.50:37001', '-Codigo', '123456', '-Conectar', '192.168.1.50:41234', '-Paquete', 'x; rm -rf')
Check 'paquete invalido: rechazado' ($r.Codigo -ne 0 -and $r.Adb -notmatch 'pm grant')
# 6. ya emparejado (solo conectar)
$r = Correr @('-Conectar', '10.0.0.7:5555') 
Check 'ya emparejado: solo conecta' ($r.Codigo -eq 0 -and $r.Adb -notmatch 'pair')
Write-Host ("{0} fallos" -f $fallos)
exit $(if ($fallos) { 1 } else { 0 })
