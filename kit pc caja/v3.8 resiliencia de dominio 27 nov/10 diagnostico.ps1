# Reune en un archivo lo que hay que mirar en el equipo real: pantallas, tacto, navegador, directivas, energia, inicio automatico, ventanas, identidad.
param([switch]$Silencioso, [switch]$AbrirPoliticas)
. "$PSScriptRoot\config.ps1"
. "$PSScriptRoot\funciones.ps1"
. "$PSScriptRoot\funciones v3.ps1"
New-Item -ItemType Directory -Force -Path $Datos | Out-Null
$sal = New-Object System.Collections.Generic.List[string]
$os = Get-CimInstance Win32_OperatingSystem
$sal.Add("Equipo: $env:COMPUTERNAME   Usuario: $env:USERNAME   Windows: $($os.Caption) $($os.Version)")
$sal.Add("Procesador: $((Get-CimInstance Win32_Processor | Select-Object -First 1).Name)   RAM: $([math]::Round($os.TotalVisibleMemorySize / 1MB, 1)) GB")
$sal.Add("Version del kit: $VersionKit")
$sal.Add("--- Pantallas ---")
[System.Windows.Forms.Screen]::AllScreens | ForEach-Object { $sal.Add(("{0}  rol={6}  principal={1}  {2}x{3}  en {4},{5}" -f $_.DeviceName, $_.Primary, $_.Bounds.Width, $_.Bounds.Height, $_.Bounds.X, $_.Bounds.Y, (Rol-Pantalla $_))) }
if ([System.Windows.Forms.Screen]::AllScreens.Count -lt 2) { $sal.Add("MODO: una sola pantalla (plan B): solo el facturador, sin pantalla del cliente") }
$sal.Add("--- Tacto ---")
Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object { $_.FriendlyName -match "touch|t.ctil|digitiz" } | ForEach-Object { $sal.Add("$($_.FriendlyName) [$($_.Class)] $($_.Status)") }
$exe = Buscar-Navegador
$sal.Add("--- Navegador ---")
$sal.Add("Ruta: $exe   Version: $(if ($exe) { (Get-Item $exe).VersionInfo.ProductVersion })")
foreach ($marca in @("Google\Chrome", "Microsoft\Edge")) {
  foreach ($lista in @("WindowManagementAllowedForUrls", "PopupsAllowedForUrls", "AutomaticFullscreenAllowedForUrls")) {
    $v = (Get-ItemProperty "HKLM:\SOFTWARE\Policies\$marca\$lista" -ErrorAction SilentlyContinue)."1"
    $sal.Add("Registro $marca $lista = $v")
  }
}
$sal.Add("--- Energia (corriente alterna) ---")
& powercfg.exe /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE | Select-String "CA actual|AC Power" | ForEach-Object { $sal.Add("Suspension: $($_.Line.Trim())") }
& powercfg.exe /query SCHEME_CURRENT SUB_VIDEO VIDEOIDLE | Select-String "CA actual|AC Power" | ForEach-Object { $sal.Add("Apagar pantalla: $($_.Line.Trim())") }
$sal.Add("--- Inicio de sesion automatico ---")
$w = Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" -ErrorAction SilentlyContinue
$sal.Add("AutoAdminLogon=$($w.AutoAdminLogon)  DefaultUserName=$($w.DefaultUserName)  clave en texto plano: $([bool]$w.DefaultPassword)")
$sal.Add("--- Ventanas del navegador de la caja ---")
$procs = @(Procesos-Navegador $Perfil)
$sal.Add("Procesos del perfil: $($procs.Count)")
$nCaja = 0; $nCli = 0
foreach ($h in (Ventanas-Nuestras $Perfil $procs)) {
  $r = New-Object W32+RECT; [void][W32]::GetWindowRect($h, [ref]$r)
  $t = [W32]::Titulo($h)
  if (Es-Titulo-Cliente $t) { $nCli++ } else { $nCaja++ }
  $sal.Add(("'{0}'  en {1},{2}  tamano {3}x{4}" -f $t, $r.Left, $r.Top, ($r.Right - $r.Left), ($r.Bottom - $r.Top)))
}
$sal.Add("Ventanas de caja: $nCaja   Ventanas del cliente: $nCli (debe haber como maximo 1)")
$sal.Add("Perfil de equipo: $NombreEquipo (caja: $NombreCaja; cliente: $NombreCliente)")
$sal.Add("--- Identidad y latido ---")
$est = Estado-Identidad
$sal.Add("Estado de la identidad: $($est.Estado)")
if ($est.Id) { $sal.Add("Enlazada como: $($est.Id.estacion) desde $($est.Id.enlazada) (la clave no se muestra)") } else { $sal.Add("SIN ENLAZAR VALIDAMENTE: usar ENLAZAR EQUIPO.bat o el icono Reparar") }
if (Hay-Pendiente) { $sal.Add("RECORDATORIO ACTIVO (enlace pendiente): " + ((Get-Content -LiteralPath $ArchivoPendienteEnlace -Encoding UTF8 | Select-Object -Skip 1 -First 1))) }
$lat = "$Datos\latido.txt"
if (Test-Path $lat) { $sal.Add("Ultimas lineas del latido:"); Get-Content $lat -Tail 3 | ForEach-Object { $sal.Add("  $_") } } else { $sal.Add("Sin registro de latido todavia") }
$sal.Add("--- Iconos y arranque ---")
$ws = New-Object -ComObject WScript.Shell
foreach ($dir in @(Carpetas-Escritorio)) { foreach ($f in @(Get-ChildItem -LiteralPath $dir -Filter "*.lnk" -File -ErrorAction SilentlyContinue)) { try { if (Es-Acceso-Del-Kit ($ws.CreateShortcut($f.FullName))) { $sal.Add("Icono del kit: $($f.BaseName)  en $dir") } } catch { Write-Verbose "acceso ilegible" } } }
$sal.Add("--- Identificacion del hardware (guardar para detectar cambios de unidad) ---")
try {
  Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object { $_.InstanceId -like "HID\VID_*" -and $_.FriendlyName -match "touch|t.ctil|digitiz" } | ForEach-Object {
    $cid = (Get-PnpDeviceProperty -InstanceId $_.InstanceId -KeyName DEVPKEY_Device_ContainerId -ErrorAction SilentlyContinue).Data
    $ub = (Get-PnpDeviceProperty -InstanceId $_.InstanceId -KeyName DEVPKEY_Device_LocationPaths -ErrorAction SilentlyContinue).Data
    $sal.Add("Tacto: $($_.FriendlyName)  id $($_.InstanceId)  contenedor $cid  puerto $($ub -join ' | ')")
  }
  Get-CimInstance -Namespace root\wmi -ClassName WmiMonitorID -ErrorAction SilentlyContinue | ForEach-Object {
    $n = -join ($_.UserFriendlyName | Where-Object { $_ -ne 0 } | ForEach-Object { [char]$_ })
    $sal.Add("Monitor (EDID): $n  fabricante $(-join ($_.ManufacturerName | Where-Object { $_ -ne 0 } | ForEach-Object { [char]$_ }))")
  }
} catch { $sal.Add("No se pudo leer el hardware: $($_.Exception.Message)") }
$sal.Add("--- Publicidad de la pantalla del cliente ---")
try {
  $r = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$PuertoPublicidad/salud" -Headers @{ Origin = @($Sitios)[0] } -TimeoutSec 3   # v3.6: se prueba con el primer origen de la lista
  $sal.Add("Servidor local: funcionando (puerto $PuertoPublicidad), probado con el origen " + @($Sitios)[0])
} catch { $sal.Add("Servidor local: NO responde ($($_.Exception.Message)). Use REPARAR.") }
$sal.Add("Carpeta: $CarpetaPublicidad")
$n = @(Get-ChildItem -LiteralPath $CarpetaPublicidad -File -Recurse -Depth 4 -ErrorAction SilentlyContinue | Where-Object { $_.Extension.ToLower() -in ".jpg", ".jpeg", ".png", ".webp", ".gif", ".mp4", ".webm" }).Count
$sal.Add("Fotos y videos encontrados (con subcarpetas): $n")
$sal.Add("--- Registro del kit (ultimas 15 lineas) ---")
if (Test-Path "$Datos\registro.txt") { Get-Content "$Datos\registro.txt" -Tail 15 | ForEach-Object { $sal.Add($_) } }
try { $sal | Set-Content -Encoding UTF8 "$Datos\diagnostico.txt" -ErrorAction Stop } catch { $sal | Set-Content -Encoding UTF8 (Join-Path $env:TEMP "kit-v3 diagnostico.txt"); Write-Host "No se pudo escribir en $Datos; el diagnostico quedo en $env:TEMP" }
$sal | ForEach-Object { Write-Host $_ }
Write-Host ""
Write-Host "Guardado en $Datos\diagnostico.txt"
if ($AbrirPoliticas -and $exe) { Start-Process $exe -ArgumentList @("--user-data-dir=`"$Perfil`"", "chrome://policy") }
Pausa
