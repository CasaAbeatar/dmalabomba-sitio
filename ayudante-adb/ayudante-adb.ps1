<#
.SYNOPSIS
  BORRADOR (no entregado) - Ayudante para dejar el telefono de SINPE de La Bomba con control total, desde la PC de la caja de la Soda.
.DESCRIPTION
  Empareja la depuracion inalambrica del telefono, concede a la app el permiso WRITE_SECURE_SETTINGS (con el que se reactiva sola),
  la exime de la optimizacion de bateria, le permite trabajar en segundo plano y deja su prioridad en "activa".
  Al terminar apaga la depuracion inalambrica y desconecta. No instala nada en la PC, no manda ningun dato por internet y no guarda el codigo de emparejamiento.
  Solo habla con el telefono por la red local (adb). Pide confirmacion antes de tocar el telefono (se salta con -Si).
.PARAMETER AdbPath        Ruta de adb.exe (por defecto: .\platform-tools\adb.exe o el que haya en el PATH).
.PARAMETER Emparejar      IP:puerto que muestra el telefono en "Emparejar dispositivo con codigo". Si ya esta emparejado, omitir.
.PARAMETER Codigo         Codigo de 6 digitos del emparejamiento (no se guarda en ningun archivo).
.PARAMETER Conectar       IP:puerto que muestra la pantalla principal de "Depuracion inalambrica".
.PARAMETER Paquete        Paquete de la app (por defecto tech.bogomolov.incomingsmsgateway).
.PARAMETER Si             No preguntar confirmaciones.
.PARAMETER Registro       Archivo de registro (por defecto ayudante-adb.log junto al script).
.EXAMPLE
  .\ayudante-adb.ps1 -Emparejar 192.168.1.50:37001 -Codigo 123456 -Conectar 192.168.1.50:41234
#>
[CmdletBinding()]
param(
  [string]$AdbPath,
  [string]$Emparejar,
  [string]$Codigo,
  [string]$Conectar,
  [string]$Paquete = 'tech.bogomolov.incomingsmsgateway',
  [switch]$Si,
  [string]$Registro = (Join-Path $PSScriptRoot 'ayudante-adb.log')
)
$ErrorActionPreference = 'Stop'
$script:Fallos = 0

function Anotar([string]$m) {
  $linea = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m
  Write-Host $linea
  Add-Content -LiteralPath $Registro -Value $linea -Encoding UTF8
}
function Pedir([string]$pregunta, [string]$actual) {
  if ($actual) { return $actual }
  return (Read-Host $pregunta).Trim()
}
function HostPuerto([string]$v, [string]$que) {
  # Solo direcciones de la red local (192.168.x.x, 10.x.x.x, 172.16-31.x.x) con puerto: nunca se acepta un nombre ni una IP publica.
  if ($v -notmatch '^(?<ip>(?:192\.168\.\d{1,3}\.\d{1,3})|(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3})|(?:172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})):(?<p>\d{2,5})$') {
    throw "$que debe ser una IP local con puerto, por ejemplo 192.168.1.50:41234 (recibi: '$v')"
  }
  if ([int]$Matches.p -gt 65535) { throw "$que tiene un puerto invalido." }
  return $v
}

# ---- 1. localizar adb ----
if (-not $AdbPath) {
  $local = Join-Path $PSScriptRoot 'platform-tools\adb.exe'
  if (Test-Path -LiteralPath $local) { $AdbPath = $local }
  else { $cmd = Get-Command adb -ErrorAction SilentlyContinue; if ($cmd) { $AdbPath = $cmd.Source } }
}
if (-not $AdbPath -or -not (Test-Path -LiteralPath $AdbPath)) {
  throw 'No encuentro adb. Copie la carpeta platform-tools (de Google: developer.android.com/tools/releases/platform-tools) junto a este script, o indique -AdbPath.'
}
function Adb {
  param([Parameter(ValueFromRemainingArguments)][string[]]$Argumentos)
  $salida = & $AdbPath @Argumentos 2>&1
  return ($salida | Out-String).Trim()
}
Anotar "Inicio. adb: $AdbPath. Paquete: $Paquete"

if ($Paquete -notmatch '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$') { throw 'Paquete invalido.' }
if (-not $Si) {
  $r = Read-Host 'Esto cambia permisos de la app en el telefono de SINPE. Escriba SI para continuar'
  if ($r.Trim().ToUpper() -ne 'SI') { Anotar 'Cancelado por la persona.'; return }
}

# ---- 2. emparejar (una sola vez por PC) ----
if ($Emparejar -or -not $Conectar) {
  $e = HostPuerto (Pedir 'IP:puerto de "Emparejar dispositivo con codigo" (o Enter si ya esta emparejado)' $Emparejar) 'El emparejamiento'
  $c = Pedir 'Codigo de 6 digitos' $Codigo
  if ($c -notmatch '^\d{6}$') { throw 'El codigo son 6 digitos.' }
  $salidaPar = & $AdbPath pair $e $c 2>&1 | Out-String
  # No se anota el codigo: solo el resultado.
  if ($salidaPar -notmatch 'Successfully paired') { throw ('No se pudo emparejar: ' + ($salidaPar -replace '\d{6}', '******').Trim()) }
  Anotar "Emparejado con $e"
}

# ---- 3. conectar ----
$con = HostPuerto (Pedir 'IP:puerto de la pantalla principal de Depuracion inalambrica' $Conectar) 'La conexion'
$sc = Adb connect $con
if ($sc -notmatch 'connected to') { throw "No se pudo conectar: $sc" }
Anotar "Conectado a $con"
function Tel { param([Parameter(ValueFromRemainingArguments)][string[]]$Cmd) return (Adb -s $con shell @Cmd) }

$modelo = Tel getprop ro.product.model
$andr = Tel getprop ro.build.version.release
Anotar "Telefono: $modelo (Android $andr)"
$instalada = Tel pm path $Paquete
if ($instalada -notmatch 'package:') { throw "La app $Paquete no esta instalada en ese telefono." }
$ver = (Tel dumpsys package $Paquete) -match 'versionName=(\S+)'
if ($ver) { Anotar ('Version de la app: ' + $Matches[1]) }

# ---- 4. permisos y exenciones (cada paso se anota; uno que falle no frena a los demas) ----
function Paso([string]$nombre, [scriptblock]$accion) {
  try {
    $r = & $accion
    if ($r -match 'Exception|Error|Unknown|not found|denied') { throw $r }
    Anotar "OK   $nombre"
  } catch { $script:Fallos++; Anotar ("FALLO $nombre : " + ($_.Exception.Message -replace '\s+', ' ')) }
}
Paso 'Permiso WRITE_SECURE_SETTINGS (la app se reactiva sola)' { Tel pm grant $Paquete android.permission.WRITE_SECURE_SETTINGS }
Paso 'Exencion de optimizacion de bateria' { Tel dumpsys deviceidle whitelist "+$Paquete" }
Paso 'Segundo plano: RUN_IN_BACKGROUND' { Tel cmd appops set $Paquete RUN_IN_BACKGROUND allow }
Paso 'Segundo plano: RUN_ANY_IN_BACKGROUND' { Tel cmd appops set $Paquete RUN_ANY_IN_BACKGROUND allow }
Paso 'Mantener despierto: WAKE_LOCK' { Tel cmd appops set $Paquete WAKE_LOCK allow }
Paso 'Prioridad de la app en "activa"' { Tel am set-standby-bucket $Paquete active }
Paso 'Acceso a notificaciones' { Tel cmd notification allow_listener "$Paquete/$Paquete.GuardianListenerService" }
Paso 'Permiso de notificaciones (Android 13+)' { Tel pm grant $Paquete android.permission.POST_NOTIFICATIONS }
Paso 'Permiso de SMS (recibir y leer)' { Tel pm grant $Paquete android.permission.RECEIVE_SMS; Tel pm grant $Paquete android.permission.READ_SMS }

# ---- 5. comprobar y cerrar ----
$wl = Tel dumpsys deviceidle whitelist
if ($wl -match [regex]::Escape($Paquete)) { Anotar 'Comprobado: la app esta en la lista de exentas de bateria.' } else { $script:Fallos++; Anotar 'AVISO: la app NO aparece como exenta de bateria.' }
$perm = Tel dumpsys package $Paquete
if ($perm -match 'android.permission.WRITE_SECURE_SETTINGS: granted=true') { Anotar 'Comprobado: WRITE_SECURE_SETTINGS concedido.' } else { $script:Fallos++; Anotar 'AVISO: WRITE_SECURE_SETTINGS no aparece concedido.' }

Paso 'Apagar la depuracion inalambrica' { Tel settings put global adb_wifi_enabled 0 }
[void](Adb disconnect $con)
Anotar "Desconectado. Pasos con problema: $script:Fallos"
if ($script:Fallos -gt 0) { Write-Host 'Terminado con avisos: revise el registro.'; exit 2 }
Write-Host 'Listo: el telefono quedo con control total.'
exit 0
