# v3.3: ficha completa de la computadora (equipo, discos, pantallas, impresoras, USB, red, seguridad, errores recientes).
# Solo se LEE; nunca cambia nada ni lleva claves, contrasenas ni datos de la cajera. El latido la manda al panel al arrancar y cada 6 horas.
# Cada dato va en su propio intento: si Windows no ofrece uno, se anota "sin dato" y se sigue con los demas.
function Dato($bloque) { try { return (& $bloque) } catch { return $null } }
function Redondear($v, $d = 1) { try { return [math]::Round([double]$v, $d) } catch { return $null } }
function Texto-Corto($t, $n = 80) { $s = [string]$t; if ($s.Length -gt $n) { return $s.Substring(0, $n) } return $s.Trim() }

function Ficha-Equipo {
  $f = [ordered]@{}
  $f["version_kit"] = $VersionKit
  $f["hecha_en"] = (Get-Date).ToString("s")
  $f["equipo"] = $env:COMPUTERNAME

  # --- Sistema y equipo ---
  $so = Dato { Get-CimInstance Win32_OperatingSystem -ErrorAction Stop }
  $cs = Dato { Get-CimInstance Win32_ComputerSystem -ErrorAction Stop }
  $bios = Dato { Get-CimInstance Win32_BIOS -ErrorAction Stop }
  $bb = Dato { Get-CimInstance Win32_BaseBoard -ErrorAction Stop }
  $cpu = Dato { @(Get-CimInstance Win32_Processor -ErrorAction Stop) | Select-Object -First 1 }
  $sis = [ordered]@{}
  if ($so) {
    $sis["windows"] = Texto-Corto $so.Caption; $sis["version"] = [string]$so.Version; $sis["build"] = [string]$so.BuildNumber
    $sis["arquitectura"] = [string]$so.OSArchitecture
    $sis["instalado"] = Dato { $so.InstallDate.ToString("yyyy-MM-dd") }
    $sis["ultimo_arranque"] = Dato { $so.LastBootUpTime.ToString("s") }
  }
  $sis["zona_horaria"] = Dato { (Get-TimeZone).Id }
  $sis["idioma"] = Dato { (Get-Culture).Name }
  if ($cs) { $sis["dominio_o_grupo"] = Texto-Corto $cs.Domain; $sis["en_dominio"] = [bool]$cs.PartOfDomain }
  $f["sistema"] = $sis
  $hw = [ordered]@{}
  if ($cs) { $hw["fabricante"] = Texto-Corto $cs.Manufacturer; $hw["modelo"] = Texto-Corto $cs.Model }
  if ($bios) { $hw["bios_version"] = Texto-Corto $bios.SMBIOSBIOSVersion; $hw["bios_fecha"] = Dato { $bios.ReleaseDate.ToString("yyyy-MM-dd") }; $hw["numero_serie"] = Texto-Corto $bios.SerialNumber }
  if ($bb) { $hw["placa"] = Texto-Corto ($bb.Manufacturer + " " + $bb.Product) }
  if ($cpu) { $hw["procesador"] = Texto-Corto $cpu.Name; $hw["nucleos"] = $cpu.NumberOfCores; $hw["hilos"] = $cpu.NumberOfLogicalProcessors; $hw["mhz"] = $cpu.MaxClockSpeed }
  if ($cs) { $hw["ram_gb"] = Redondear ($cs.TotalPhysicalMemory / 1GB) 1 }
  $hw["ram_modulos"] = Dato { @(Get-CimInstance Win32_PhysicalMemory -ErrorAction Stop | ForEach-Object { [ordered]@{ gb = [int]($_.Capacity / 1GB); mhz = $_.Speed; tipo = Texto-Corto $_.Manufacturer 20 } }) }
  $hw["gpu"] = Dato { @(Get-CimInstance Win32_VideoController -ErrorAction Stop | ForEach-Object { [ordered]@{ nombre = Texto-Corto $_.Name; driver = [string]$_.DriverVersion; fecha_driver = Dato { $_.DriverDate.ToString("yyyy-MM-dd") }; resolucion = ([string]$_.CurrentHorizontalResolution + "x" + [string]$_.CurrentVerticalResolution); hz = $_.CurrentRefreshRate } }) }
  $f["hardware"] = $hw

  # --- Discos ---
  $f["discos_fisicos"] = Dato { @(Get-PhysicalDisk -ErrorAction Stop | ForEach-Object { [ordered]@{ modelo = Texto-Corto $_.FriendlyName; tipo = [string]$_.MediaType; gb = Redondear ($_.Size / 1GB) 0; salud = [string]$_.HealthStatus; estado = [string]$_.OperationalStatus } }) }
  $f["volumenes"] = Dato { @(Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" -ErrorAction Stop | ForEach-Object { [ordered]@{ unidad = $_.DeviceID; gb = Redondear ($_.Size / 1GB) 0; libre_gb = Redondear ($_.FreeSpace / 1GB) 1 } }) }

  # --- Pantallas: Windows y modelos reales de monitor ---
  $pan = @()
  try {
    foreach ($s in [System.Windows.Forms.Screen]::AllScreens) { $pan += [ordered]@{ nombre = [string]$s.DeviceName; principal = [bool]$s.Primary; ancho = $s.Bounds.Width; alto = $s.Bounds.Height; x = $s.Bounds.X; y = $s.Bounds.Y } }
  } catch { $pan = @() }
  $f["pantallas_windows"] = $pan
  $f["monitores"] = Dato { @(Get-CimInstance -Namespace root\wmi -ClassName WmiMonitorID -ErrorAction Stop | ForEach-Object {
      $n = ""; if ($_.UserFriendlyName) { $n = -join ($_.UserFriendlyName | Where-Object { $_ -gt 0 } | ForEach-Object { [char]$_ }) }
      $m = ""; if ($_.ManufacturerName) { $m = -join ($_.ManufacturerName | Where-Object { $_ -gt 0 } | ForEach-Object { [char]$_ }) }
      $sn = ""; if ($_.SerialNumberID) { $sn = -join ($_.SerialNumberID | Where-Object { $_ -gt 0 } | ForEach-Object { [char]$_ }) }
      [ordered]@{ fabricante = $m; modelo = $n; serie = $sn; semana = $_.WeekOfManufacture; anio = $_.YearOfManufacture; activo = $_.Active } }) }

  # --- Tacto, impresoras y USB (cajon, lector de codigos, etc.) ---
  $f["tacto"] = Dato { @(Get-PnpDevice -PresentOnly -ErrorAction Stop | Where-Object { $_.FriendlyName -match 'touch|tactil|pen' -and $_.Class -in 'HIDClass','Mouse' } | Select-Object -First 6 | ForEach-Object { [ordered]@{ nombre = Texto-Corto $_.FriendlyName; estado = [string]$_.Status } }) }
  $f["impresoras"] = Dato { @(Get-CimInstance Win32_Printer -ErrorAction Stop | ForEach-Object { [ordered]@{ nombre = Texto-Corto $_.Name; puerto = Texto-Corto $_.PortName 40; driver = Texto-Corto $_.DriverName; predeterminada = [bool]$_.Default; fuera_de_linea = [bool]$_.WorkOffline; estado = [string]$_.PrinterStatus } }) }
  $f["usb_conectados"] = Dato { @(Get-PnpDevice -PresentOnly -ErrorAction Stop | Where-Object { $_.InstanceId -like 'USB\*' } | Select-Object -First 25 | ForEach-Object { [ordered]@{ nombre = Texto-Corto $_.FriendlyName 60; clase = [string]$_.Class; estado = [string]$_.Status } }) }
  $f["dispositivos_con_problema"] = Dato { @(Get-PnpDevice -ErrorAction Stop | Where-Object { $_.Status -eq 'Error' } | Select-Object -First 10 | ForEach-Object { Texto-Corto $_.FriendlyName 60 }) }

  # --- Red ---
  $red = [ordered]@{}
  $red["adaptadores"] = Dato { @(Get-NetAdapter -Physical -ErrorAction Stop | Where-Object { $_.Status -eq 'Up' } | ForEach-Object { [ordered]@{ nombre = Texto-Corto $_.Name 40; tipo = Texto-Corto $_.InterfaceDescription 60; velocidad = [string]$_.LinkSpeed } }) }
  $red["configuracion_ip"] = Dato { @(Get-NetIPConfiguration -ErrorAction Stop | Where-Object { $_.IPv4DefaultGateway } | ForEach-Object { [ordered]@{ interfaz = $_.InterfaceAlias; ip = (@($_.IPv4Address) | Select-Object -First 1).IPAddress; puerta = (@($_.IPv4DefaultGateway) | Select-Object -First 1).NextHop; dns = @($_.DnsServer.ServerAddresses) } }) }
  $red["wifi"] = Dato { $w = (netsh wlan show interfaces 2>$null) -join "`n"; if ($w -match 'SSID\s+:\s+(.+)') { $ss = $Matches[1].Trim(); $sg = ""; if ($w -match 'Signal\s+:\s+(\d+)') { $sg = $Matches[1] }; [ordered]@{ red = $ss; senal_pct = $sg } } else { $null } }

  # --- Seguridad y mantenimiento de Windows ---
  $seg = [ordered]@{}
  $df = Dato { Get-MpComputerStatus -ErrorAction Stop }
  if ($df) { $seg["defender_activo"] = [bool]$df.AntivirusEnabled; $seg["proteccion_tiempo_real"] = [bool]$df.RealTimeProtectionEnabled; $seg["firmas_version"] = [string]$df.AntivirusSignatureVersion; $seg["firmas_edad_dias"] = $df.AntivirusSignatureAge; $seg["ultimo_analisis_rapido"] = Dato { if ($df.QuickScanEndTime) { $df.QuickScanEndTime.ToString("yyyy-MM-dd") } } }
  $seg["firewall"] = Dato { @(Get-NetFirewallProfile -ErrorAction Stop | ForEach-Object { $_.Name + "=" + $_.Enabled }) }
  $seg["uac"] = Dato { [int](Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System" -ErrorAction Stop).EnableLUA }
  $seg["bitlocker"] = Dato { @(Get-BitLockerVolume -ErrorAction Stop | ForEach-Object { $_.MountPoint + "=" + $_.ProtectionStatus }) }
  $seg["administradores_locales"] = Dato { @(Get-LocalGroupMember -SID "S-1-5-32-544" -ErrorAction Stop | ForEach-Object { Texto-Corto $_.Name 40 }) }
  $seg["cuentas_locales_activas"] = Dato { @(Get-LocalUser -ErrorAction Stop | Where-Object { $_.Enabled } | ForEach-Object { Texto-Corto $_.Name 40 }) }
  $seg["actualizaciones_recientes"] = Dato { @(Get-HotFix -ErrorAction Stop | Sort-Object InstalledOn -Descending | Select-Object -First 5 | ForEach-Object { [string]$_.HotFixID + " " + (Dato { $_.InstalledOn.ToString("yyyy-MM-dd") }) }) }
  $seg["reinicio_pendiente"] = Dato { [bool](Test-Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired") }
  $seg["plan_de_energia"] = Dato { ((powercfg /getactivescheme 2>$null) -join " ") -replace '^.*\((.*)\).*$', '$1' }
  $seg["hora_sincronizada"] = Dato { $r = (w32tm /query /status 2>$null) -join "|"; $o = [ordered]@{}; if ($r -match 'Source:\s*([^|]+)') { $o["fuente"] = $Matches[1].Trim() }; if ($r -match 'Last Successful Sync Time:\s*([^|]+)') { $o["ultima"] = $Matches[1].Trim() }; $o }

  # --- Navegadores, kit y servicios ---
  $sw = [ordered]@{}
  foreach ($par in @(@("chrome", "C:\Program Files\Google\Chrome\Application\chrome.exe"), @("chrome_x86", "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"), @("edge", "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"))) {
    if (Test-Path -LiteralPath $par[1]) { $sw[$par[0]] = Dato { (Get-Item -LiteralPath $par[1]).VersionInfo.ProductVersion } }
  }
  $sw["powershell"] = [string]$PSVersionTable.PSVersion
  $sw["terminal_predeterminada"] = Dato { [string](Get-ItemProperty "HKCU:\Console\%%Startup" -ErrorAction Stop).DelegationTerminal }
  $sw["programas_instalados"] = Dato { $n = 0; foreach ($k in @("HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*", "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*")) { $n += @(Get-ItemProperty $k -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName }).Count }; $n }
  $sw["programas_lista"] = Dato { @(@("HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*", "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*") | ForEach-Object { Get-ItemProperty $_ -ErrorAction SilentlyContinue } | Where-Object { $_.DisplayName -and $_.DisplayName -notmatch '^(Microsoft Visual C|Update for|Security Update|Microsoft Edge WebView)' } | ForEach-Object { Texto-Corto ($_.DisplayName + " " + $_.DisplayVersion) 60 } | Sort-Object -Unique | Select-Object -First 60) }
  $f["software"] = $sw
  $kit = [ordered]@{}
  $kit["carpeta_ok"] = Test-Path -LiteralPath $Carpeta
  $kit["archivos"] = Dato { @(Get-ChildItem -LiteralPath $Carpeta -File -ErrorAction Stop).Count }
  $kit["registro_kb"] = Dato { [int]((Get-Item "$Datos\registro.txt" -ErrorAction Stop).Length / 1KB) }
  $kit["ultimas_lineas_registro"] = Dato { @(Get-Content "$Datos\registro.txt" -Tail 6 -ErrorAction Stop | ForEach-Object { Texto-Corto $_ 160 }) }
  $kit["inicio_con_windows"] = Dato { @(Get-ChildItem ([Environment]::GetFolderPath("CommonStartup")) -Filter *.lnk -ErrorAction Stop | ForEach-Object { $_.Name }) }

  # --- Errores recientes (7 dias) ---
  $ev = [ordered]@{}
  $ev["apagados_inesperados_7d"] = Dato { @(Get-WinEvent -FilterHashtable @{ LogName = "System"; Id = 41; StartTime = (Get-Date).AddDays(-7) } -MaxEvents 20 -ErrorAction SilentlyContinue).Count }
  $ev["errores_sistema_24h"] = Dato { @(Get-WinEvent -FilterHashtable @{ LogName = "System"; Level = 1, 2; StartTime = (Get-Date).AddHours(-24) } -MaxEvents 50 -ErrorAction SilentlyContinue).Count }
  $ev["errores_aplicacion_24h"] = Dato { @(Get-WinEvent -FilterHashtable @{ LogName = "Application"; Level = 1, 2; StartTime = (Get-Date).AddHours(-24) } -MaxEvents 50 -ErrorAction SilentlyContinue).Count }
  $ev["ultimos_errores"] = Dato { @(Get-WinEvent -FilterHashtable @{ LogName = "System", "Application"; Level = 1, 2; StartTime = (Get-Date).AddHours(-24) } -MaxEvents 6 -ErrorAction SilentlyContinue | ForEach-Object { (Texto-Corto $_.ProviderName 30) + " #" + $_.Id + " " + $_.TimeCreated.ToString("MM-dd HH:mm") }) }
  $f["eventos"] = $ev

  # --- v3.4: historial de encendidos, fallos, impresion, servicios, arranque e integridad del kit ---
  $enc = [ordered]@{}
  $enc["historial_7d"] = Dato { @(Get-WinEvent -FilterHashtable @{ LogName = "System"; Id = 6005, 6006, 6008, 41, 1074; StartTime = (Get-Date).AddDays(-7) } -MaxEvents 60 -ErrorAction SilentlyContinue | Sort-Object TimeCreated | ForEach-Object { $t = switch ($_.Id) { 6005 { "enciende" } 6006 { "apaga" } 6008 { "apagado inesperado" } 41 { "reinicio sin apagar" } 1074 { "apagado pedido" } default { [string]$_.Id } }; $_.TimeCreated.ToString("MM-dd HH:mm") + " " + $t }) }
  $enc["fallos_navegador_7d"] = Dato { @(Get-WinEvent -FilterHashtable @{ LogName = "Application"; Id = 1000; StartTime = (Get-Date).AddDays(-7) } -MaxEvents 300 -ErrorAction SilentlyContinue | Where-Object { $_.Message -match 'chrome\.exe|msedge\.exe' }).Count }
  $enc["fallos_powershell_7d"] = Dato { @(Get-WinEvent -FilterHashtable @{ LogName = "Application"; Id = 1000; StartTime = (Get-Date).AddDays(-7) } -MaxEvents 300 -ErrorAction SilentlyContinue | Where-Object { $_.Message -match 'powershell\.exe' }).Count }
  $f["encendidos_y_fallos"] = $enc
  $f["cola_impresion"] = Dato { @(Get-Printer -ErrorAction Stop | ForEach-Object { $j = @(Get-PrintJob -PrinterName $_.Name -ErrorAction SilentlyContinue); [ordered]@{ impresora = Texto-Corto $_.Name 40; trabajos = $j.Count; con_error = @($j | Where-Object { [string]$_.JobStatus -match 'Error|Offline|Paper' }).Count } }) }
  $f["servicios"] = Dato { @("Spooler", "wuauserv", "WinDefend", "W32Time", "Schedule", "Dnscache", "BITS" | ForEach-Object { $s = Get-Service -Name $_ -ErrorAction SilentlyContinue; if ($s) { $_ + "=" + $s.Status + "/" + $s.StartType } }) }
  $f["arranque_de_windows"] = Dato { @(@("HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run", "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run") | ForEach-Object { $k = Get-Item $_ -ErrorAction SilentlyContinue; if ($k) { $k.GetValueNames() } } | Sort-Object -Unique) }
  $f["tareas_programadas_no_microsoft"] = Dato { @(Get-ScheduledTask -ErrorAction Stop | Where-Object { $_.TaskPath -notlike "\Microsoft\*" } | ForEach-Object { Texto-Corto $_.TaskName 50 } | Select-Object -First 25) }
  $f["energia"] = Dato { [ordered]@{ bateria_o_ups = [bool](Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue); estados_de_suspension = ((powercfg /a 2>$null | Select-String -Pattern 'Standby|En espera|Hibern' | Select-Object -First 4 | ForEach-Object { Texto-Corto $_.Line.Trim() 60 }) -join " | ") } }
  $kit["servicios_del_kit"] = Dato { @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction Stop | Where-Object { $_.CommandLine -match 'PantallaCliente' } | ForEach-Object { if ($_.CommandLine -match '(\d+ [a-z ]+|servidor publicidad)\.ps1') { $Matches[1] } }) }
  $kit["integridad_archivos"] = Dato { $h = [ordered]@{}; foreach ($a in @(Get-ChildItem -LiteralPath $Carpeta -File -ErrorAction Stop | Where-Object { $_.Extension -in ".ps1", ".bat" } | Sort-Object Name)) { $h[$a.Name] = (Get-FileHash -LiteralPath $a.FullName -Algorithm SHA256).Hash.Substring(0, 8) }; $h }
  $kit["perfil_navegador_mb"] = Dato { Redondear ((Get-ChildItem -LiteralPath $Perfil -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum / 1MB) 0 }
  $kit["carpeta_temp_mb"] = Dato { Redondear ((Get-ChildItem -LiteralPath $env:TEMP -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum / 1MB) 0 }
  $kit["estado_supervisor"] = Dato { Get-Content -LiteralPath "$Datos\estado.json" -Raw -ErrorAction Stop | ConvertFrom-Json }
  $seg["tpm"] = Dato { $t = Get-Tpm -ErrorAction Stop; "presente=" + $t.TpmPresent + " listo=" + $t.TpmReady }
  $seg["arranque_seguro"] = Dato { Confirm-SecureBootUEFI -ErrorAction Stop }
  $seg["windows_activado"] = Dato { [bool](@(Get-CimInstance SoftwareLicensingProduct -Filter "PartialProductKey IS NOT NULL" -ErrorAction Stop | Where-Object { $_.Name -like "Windows*" -and $_.LicenseStatus -eq 1 }).Count) }
  $red["mac"] = Dato { @(Get-NetAdapter -Physical -ErrorAction Stop | Where-Object { $_.Status -eq 'Up' } | ForEach-Object { [string]$_.MacAddress }) }

  $f["red"] = $red
  $f["seguridad"] = $seg
  $f["kit"] = $kit

  # --- Variables (cambian siempre; no cuentan como cambio de la ficha) ---
  $va = [ordered]@{}
  $va["encendida_horas"] = Dato { if ($so) { Redondear (((Get-Date) - $so.LastBootUpTime).TotalHours) 1 } }
  $va["ram_libre_gb"] = Dato { if ($so) { Redondear ($so.FreePhysicalMemory / 1MB) 2 } }
  $va["cpu_pct"] = Dato { $x = (Get-CimInstance Win32_Processor -ErrorAction Stop | Measure-Object -Property LoadPercentage -Average).Average; Redondear $x 0 }
  $va["navegador_ram_mb"] = Dato { Redondear ((@(Get-Process chrome, msedge -ErrorAction SilentlyContinue) | Measure-Object WorkingSet64 -Sum).Sum / 1MB) 0 }
  $va["procesos_pesados"] = Dato { @(Get-Process -ErrorAction Stop | Sort-Object WorkingSet64 -Descending | Select-Object -First 5 | ForEach-Object { $_.ProcessName + " " + [int]($_.WorkingSet64 / 1MB) + "MB" }) }
  $va["ping_panel_ms"] = Dato { $sw2 = [Diagnostics.Stopwatch]::StartNew(); $c = New-Object Net.Sockets.TcpClient; $a = $c.BeginConnect(([Uri]$SupabaseUrl).Host, 443, $null, $null); $ok = $a.AsyncWaitHandle.WaitOne(3000); $sw2.Stop(); try { $c.Close() } catch { $null = 1 }; if ($ok) { [int]$sw2.ElapsedMilliseconds } else { $null } }
  $va["calidad_red"] = Dato { @(([Uri]$SupabaseUrl).Host, "1.1.1.1", "8.8.8.8" | ForEach-Object { $h = $_; $ms = @(); $perd = 0; for ($i = 0; $i -lt 5; $i++) { $sw3 = [Diagnostics.Stopwatch]::StartNew(); $c3 = New-Object Net.Sockets.TcpClient; try { $a3 = $c3.BeginConnect($h, 443, $null, $null); if ($a3.AsyncWaitHandle.WaitOne(1500) -and $c3.Connected) { $ms += [int]$sw3.ElapsedMilliseconds } else { $perd++ } } catch { $perd++ } finally { try { $c3.Close() } catch { $null = 1 } } }; [ordered]@{ destino = $h; prom_ms = $(if ($ms.Count) { [int](($ms | Measure-Object -Average).Average) } else { $null }); max_ms = $(if ($ms.Count) { ($ms | Measure-Object -Maximum).Maximum } else { $null }); perdidos_de_5 = $perd } }) }
  $va["dns_ms"] = Dato { [int](Measure-Command { [void][Net.Dns]::GetHostAddresses(([Uri]$SupabaseUrl).Host) }).TotalMilliseconds }
  $va["sesiones_abiertas"] = Dato { @(quser 2>$null).Count - 1 }
  $va["temperatura_c"] = Dato { $tz = @(Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction Stop); if ($tz.Count) { [int]([math]::Round(($tz[0].CurrentTemperature / 10) - 273.15, 0)) } }
  $f["variables"] = $va
  return $f
}

# ===== v3.4: metricas rapidas (cada latido) y version del facturador =====
function Metricas-Rapidas {
  $m = [ordered]@{}
  $so = Dato { Get-CimInstance Win32_OperatingSystem -ErrorAction Stop }
  $m["cpu_pct"] = Dato { [int]((Get-CimInstance Win32_Processor -ErrorAction Stop | Measure-Object -Property LoadPercentage -Average).Average) }
  if ($so) { $m["ram_libre_mb"] = [int]($so.FreePhysicalMemory / 1KB); $m["encendida_min"] = [int](((Get-Date) - $so.LastBootUpTime).TotalMinutes) }
  $m["disco_libre_gb"] = Dato { Redondear ((Get-PSDrive -Name C -ErrorAction Stop).Free / 1GB) 1 }
  $nav = Dato { @(Get-Process chrome, msedge -ErrorAction SilentlyContinue) }
  if ($nav) { $m["nav_procesos"] = $nav.Count; $m["nav_ram_mb"] = [int](($nav | Measure-Object WorkingSet64 -Sum).Sum / 1MB) } else { $m["nav_procesos"] = 0 }
  $m["temperatura_c"] = Dato { $tz = @(Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction Stop); if ($tz.Count) { [int]([math]::Round(($tz[0].CurrentTemperature / 10) - 273.15, 0)) } }
  # Ventanas de consola a la vista (deben ser 0): permite comprobar desde el panel que Latido y Facturador no se ven.
  $m["consolas_visibles"] = Dato { @(Get-Process powershell, pwsh, cmd, conhost, WindowsTerminal, OpenConsole -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }).Count }
  return $m
}
$script:VersionFactCache = $null; $script:VersionFactHora = [DateTime]::MinValue
function Version-Facturador {
  # Huella corta de la pagina que sirve el facturador (cambia con cada version publicada) mas la version de su service worker.
  if ($script:VersionFactCache -and (((Get-Date) - $script:VersionFactHora).TotalMinutes -lt 60)) { return $script:VersionFactCache }
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $base = ([string]$UrlCaja).Split("?")[0]
    $r = Invoke-WebRequest -Uri $base -UseBasicParsing -TimeoutSec 8 -ErrorAction Stop
    $sha = [Security.Cryptography.SHA256]::Create()
    $hx = -join ($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes([string]$r.Content)) | Select-Object -First 4 | ForEach-Object { $_.ToString("x2") })
    $sw = ""
    try { $s = Invoke-WebRequest -Uri ((New-Object Uri((New-Object Uri($base)), "sw.js")).AbsoluteUri) -UseBasicParsing -TimeoutSec 8 -ErrorAction Stop; if ([string]$s.Content -match "PREFIJO \+ '(v\d+)'|const V = '([^']+)'") { $sw = "sw-" + ($Matches[1] + $Matches[2]) + " " } } catch { $sw = "" }
    $script:VersionFactCache = ($sw + "pag-" + $hx); $script:VersionFactHora = Get-Date
  } catch { if (-not $script:VersionFactCache) { return $null } }
  return $script:VersionFactCache
}
