# INSTALAR TODO (v3.1 reparador y enlace).
# Se puede correr ENCIMA de cualquier version anterior (v1 14 nov, v2 propuesta 15 nov, Kit v2 15 nov, v2 identidad y latido 16 nov) y las veces que haga falta:
# detecta lo que hay, lo corrige y deja la PC en el estado final. Al terminar muestra que corrigio y que falta.
# La identidad (Soda o Pollos) se verifica SIEMPRE aqui mismo, sin depender de otro archivo.
param([switch]$Silencioso, [string]$Estacion = "")
. "$PSScriptRoot\config.ps1"
. "$PSScriptRoot\funciones.ps1"
. "$PSScriptRoot\funciones v3.ps1"
Pedir-Admin $MyInvocation.MyCommand.Path

# 0) El paquete debe estar completo (si solo se copiaron algunos archivos, no se instala a medias)
$faltan = @(Verificar-Paquete)
if ($faltan.Count -gt 0) {
  Write-Host "FALTAN ARCHIVOS DEL KIT en esta carpeta, no se instala nada:" -ForegroundColor Red
  $faltan | ForEach-Object { Write-Host ("  - " + $_) }
  Write-Host "Extraiga TODO el contenido del zip (Kit v3 PC de caja) en una carpeta y vuelva a abrir INSTALAR TODO.bat desde ella."
  [void](Dialogo "Faltan archivos del kit" ("No se instalo nada porque faltan archivos en esta carpeta:`r`n`r`n" + ($faltan -join "`r`n") + "`r`n`r`nExtraiga todo el contenido del zip en una carpeta y abra de nuevo INSTALAR TODO.bat.") @("Aceptar") -tam 11)
  Pausa
  exit 1
}

# ===== Registro a prueba de fallos y permisos de la carpeta de datos (v3.1) =====
$script:RegistroTemp = Join-Path $env:TEMP "kit-v3-registro.txt"
function Anotar-Registro($texto) {
  # Nunca falla: si no se puede escribir en la carpeta de datos, deja el texto en %TEMP%\kit-v3-registro.txt.
  $t = [string]$texto
  try { Add-Content -LiteralPath $registro -Value $t -Encoding UTF8 -ErrorAction Stop }
  catch { try { Add-Content -LiteralPath $script:RegistroTemp -Value $t -Encoding UTF8 -ErrorAction Stop } catch { $null = 1 } }
}
function Escribir-Archivo($ruta, $lineas) {
  # Escribe un archivo de texto; si la carpeta de datos no deja, lo deja en %TEMP% con el mismo nombre. Devuelve $true si quedo en su lugar.
  try { Set-Content -LiteralPath $ruta -Value $lineas -Encoding UTF8 -ErrorAction Stop; return $true }
  catch {
    try { Set-Content -LiteralPath (Join-Path $env:TEMP ("kit-v3 " + (Split-Path $ruta -Leaf))) -Value $lineas -Encoding UTF8 -ErrorAction Stop } catch { $null = 1 }
    return $false
  }
}
function Preparar-Datos {
  # Como administrador: restablece los permisos de C:\PantallaCliente\datos (una instalacion vieja pudo dejarlos cerrados) para poder escribir el registro.
  # Administradores y SYSTEM: control total; Usuarios (la cuenta de la caja): modificar. Solo toca la carpeta de datos (y la raiz sin recursion).
  try { New-Item -ItemType Directory -Force -Path $Carpeta -ErrorAction Stop | Out-Null; New-Item -ItemType Directory -Force -Path $Datos -ErrorAction Stop | Out-Null } catch { $null = 1 }
  if (-not (Es-Admin)) { return }
  try {
    & takeown.exe /F $Datos /R /D Y 2>&1 | Out-Null
    & icacls.exe $Datos /reset /T /C 2>&1 | Out-Null
    & icacls.exe $Datos /remove:d "*S-1-5-32-544" "*S-1-5-32-545" "*S-1-1-0" /T /C 2>&1 | Out-Null
    & icacls.exe $Datos /grant "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" "*S-1-5-32-545:(OI)(CI)M" /T /C 2>&1 | Out-Null
    & icacls.exe $Carpeta /grant "*S-1-5-18:F" "*S-1-5-32-544:F" "*S-1-5-32-545:RX" /C 2>&1 | Out-Null
  } catch { $null = 1 }
  $prueba = Join-Path $Datos "prueba escritura.tmp"
  try { Set-Content -LiteralPath $prueba -Value "ok" -ErrorAction Stop; Remove-Item -LiteralPath $prueba -Force -ErrorAction SilentlyContinue; return $true } catch { return $false }
}

$ErrorActionPreference = "Continue"
$datosListo = Preparar-Datos
$registro = "$Datos\instalacion.txt"
function Paso($nombre, [scriptblock]$bloque) {
  # Todo lo que diga el paso (incluidos errores) va al registro, no a la pantalla en rojo.
  try { $salida = (& $bloque 2>&1 | Out-String); if ($salida.Trim()) { Anotar-Registro $salida.TrimEnd() }; Hecho $nombre }
  catch { Falta ("FALLO: " + $nombre + " (" + $_.Exception.Message + ")"); Anotar-Registro ("FALLO " + $nombre + ": " + $_.Exception.Message) }
}
Anotar-Registro ("==== {0:yyyy-MM-dd HH:mm:ss} instalacion v3.1 en {1} ====" -f (Get-Date), $env:COMPUTERNAME)
if (-not $datosListo) { Falta ("No se pudo escribir en " + $Datos + " (permisos). El registro de esta instalacion queda en " + $script:RegistroTemp) }

# 1) Detectar lo que hay
Write-Host "Revisando lo que ya hay en esta computadora..."
$det = Detectar-Instalacion
foreach ($l in $det.Lineas) { Write-Host ("  " + $l); Anotar-Registro $l }
if ($det.Existe) { Hecho ("Instalacion previa detectada: " + $det.Version + ". Se actualiza encima") } else { Hecho "Instalacion nueva (no habia kit anterior)" }

# 2) Detener lo que corre con codigo viejo y limpiar tareas, arranques y accesos que dejaron las versiones anteriores
$paradas = Detener-Kit
if ($paradas -gt 0) { Hecho ("Se detuvieron " + $paradas + " proceso(s) del kit viejo que seguian corriendo") }
Paso "Quitar tareas programadas y entradas de inicio viejas del kit" { Limpiar-Tareas; Limpiar-Run }

# 3) Chrome: si no esta, se intenta con winget (viene con Windows 11). Si no se puede, el kit usa Edge.
if (-not (Buscar-Navegador)) {
  Paso "Instalar Google Chrome (winget)" { & winget.exe install -e --id Google.Chrome --silent --accept-package-agreements --accept-source-agreements }
}

# 4) Copiar el kit, migrar datos viejos, permisos y accesos
Paso "1 Copiar el kit, migrar datos y crear accesos" { & "$PSScriptRoot\1 crear accesos y arranque automatico.ps1" -Silencioso }
[void](Preparar-Datos)
$vigentes = @(Get-ChildItem -LiteralPath $PSScriptRoot -File | Where-Object { $_.Extension -in ".ps1", ".bat" } | ForEach-Object { $_.Name })
Paso "Apartar archivos de versiones anteriores (no se borran)" { Apartar-Archivos-Viejos $vigentes }

# 5) IDENTIDAD: Soda o Pollos. Siempre se verifica; pregunta en pantalla si falta, esta danada, es de otra PC, no coincide o el panel no la reconoce.
Write-Host ""
Write-Host "Verificando la identidad de la computadora (Soda o Pollos)..."
$idr = Asegurar-Identidad "instalar" $Estacion

# 6) Resto de la configuracion de Windows (idempotente)
Paso "2 Energia y adornos de Windows"       { & "$PSScriptRoot\2 energia y pantalla.ps1" -Silencioso }
Paso "4 Actualizaciones (horas activas)"    { & "$PSScriptRoot\4 actualizaciones de Windows.ps1" -Silencioso }
Paso "5 Pantallas y permisos del navegador" { & "$PSScriptRoot\5 pantallas y permiso de ventanas.ps1" -Silencioso }
Paso "12 Fijar pantallas (tactil = 1 principal, LG = 2 cliente)" { & "$PSScriptRoot\12 fijar pantallas.ps1" -Silencioso }
Paso "16 Bloquear instalaciones para la cajera" { & "$PSScriptRoot\16 bloquear instalaciones.ps1" -Silencioso }
Paso "10 Diagnostico inicial"               { & "$PSScriptRoot\10 diagnostico.ps1" -Silencioso }
Paso "14 Control remoto (Chrome Remote Desktop)" { & "$PSScriptRoot\14 control remoto.ps1" -Silencioso }

# 7) Accesos: solo Facturador, Reparar y Control remoto en el Escritorio; en el inicio solo Latido y Facturador
Paso "Dejar solo los iconos permitidos y quitar repetidos" { Limpiar-Accesos; Limpiar-Inicio }

# 8) Latido: se arranca con el codigo nuevo y se comprueba que de verdad arranco
Paso "11 Iniciar el latido hacia el panel" {
  if (-not (Test-Path "$Carpeta\11 latido.ps1")) { throw "No se copio 11 latido.ps1 a $Carpeta" }
  Remove-Item "$Datos\latido.txt" -Force -ErrorAction SilentlyContinue
  # Se lanza SIN privilegios de administrador (por el explorador, via el acceso de inicio): el latido solo necesita la cuenta normal de la caja.
  $lnk = Join-Path ([Environment]::GetFolderPath("CommonStartup")) "Latido.lnk"
  if (Test-Path $lnk) { Start-Process -FilePath "$env:SystemRoot\explorer.exe" -ArgumentList "`"$lnk`"" }
  else { Start-Process -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -ArgumentList "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Carpeta\11 latido.ps1`"" -WindowStyle Hidden }
  $t = 0; while (-not (Test-Path "$Datos\latido.txt") -and $t -lt 30) { Start-Sleep -Seconds 1; $t++ }
  if (-not (Test-Path "$Datos\latido.txt")) { throw "El latido no arranco (no escribio su registro)" }
}

# 9) Abrir el facturador y la pantalla del cliente (estado final) y comprobar que quedo UNA ventana 1 y UNA ventana 2
Paso "0 Abrir el facturador y la pantalla del cliente" {
  $lnk = Join-Path ([Environment]::GetFolderPath("CommonStartup")) "Facturador.lnk"
  if (-not (Test-Path $lnk)) { throw "No esta el acceso Facturador" }
  Start-Process -FilePath "$env:SystemRoot\explorer.exe" -ArgumentList "`"$lnk`""
}
$pantallasN = [System.Windows.Forms.Screen]::AllScreens.Count
$nCaja = 0; $nCli = 0
$hasta = (Get-Date).AddSeconds(90)
while ((Get-Date) -lt $hasta) {
  Start-Sleep -Seconds 3
  $nCaja = 0; $nCli = 0
  foreach ($h in @(Ventanas-Nuestras $Perfil @(Procesos-Navegador $Perfil))) {
    $t = [W32]::Titulo($h)
    if ([string]::IsNullOrWhiteSpace($t)) { continue }
    if (Es-Titulo-Cliente $t) { $nCli++ } else { $nCaja++ }
  }
  if (($nCaja -ge 1) -and (($nCli -ge 1) -or ($pantallasN -lt 2))) { break }
}
if ($nCaja -eq 1) { Bien "Ventana 1 (facturador): una sola, abierta" } elseif ($nCaja -eq 0) { Falta "La ventana 1 (facturador) no se abrio en 90 segundos. Tocar el icono Reparar" } else { Falta ("Hay " + $nCaja + " ventanas de facturador abiertas; el kit cierra las sobrantes en la siguiente vuelta, o tocar Reparar") }
if ($pantallasN -ge 2) {
  if ($nCli -eq 1) { Bien "Ventana 2 (pantalla del cliente): una sola, abierta" } elseif ($nCli -eq 0) { Falta "La ventana 2 (pantalla del cliente) todavia no abrio (el kit la abre solo en hasta 1 minuto; si no, tocar Reparar)" } else { Falta ("Hay " + $nCli + " ventanas del cliente; el kit cierra las sobrantes solo") }
}
Revisar-Pantallas
Revisar-Cuentas
Falta "Pendiente de Emil, una sola vez por PC: vincular el control remoto (abrir el icono Control remoto, Configurar acceso remoto, poner el PIN). El kit nunca pide ni guarda cuentas ni PIN"
if ($idr.Resultado -ne "ok") { Falta "SIN IDENTIDAD VALIDA: abrir ENLAZAR EQUIPO.bat (o tocar Reparar) con un codigo nuevo cuando lo tenga" }

# 10) Resumen
[void](Escribir-Archivo "$Datos\version kit.txt" @($VersionKit, ("Instalada: " + (Get-Date).ToString("s")), ("Equipo: " + $env:COMPUTERNAME)))
$completo = Texto-Resumen 0
[void](Escribir-Archivo "$Datos\resumen instalacion.txt" $completo)
Anotar-Registro $completo
Write-Host ""
Write-Host "================ RESUMEN DE LA INSTALACION (kit $VersionKit) ================"
Write-Host $completo
Write-Host "Resumen guardado en $Datos\resumen instalacion.txt   Registro completo: $registro (si no se pudo escribir ahi: $script:RegistroTemp)"
$corto = Texto-Resumen 8
if ($corto.Length -gt 1500) { $corto = $corto.Substring(0, 1500) + "..." }
[void](Dialogo ("Resumen de la instalacion (kit " + $VersionKit + ")") ($corto.Replace("`r`n", "`n").Replace("`n", "`r`n")) @("Aceptar") -tam 11)
Pausa
