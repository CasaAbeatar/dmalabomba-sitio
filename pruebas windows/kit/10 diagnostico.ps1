# Reune en un archivo lo que hay que mirar en la HP real: pantallas, tacto, navegador, directivas, energia, inicio automatico, ventanas.
param([switch]$Silencioso, [switch]$AbrirPoliticas)
. "$PSScriptRoot\config.ps1"
. "$PSScriptRoot\funciones.ps1"
New-Item -ItemType Directory -Force -Path $Carpeta | Out-Null
$sal = New-Object System.Collections.Generic.List[string]
$os = Get-CimInstance Win32_OperatingSystem
$sal.Add("Equipo: $env:COMPUTERNAME   Usuario: $env:USERNAME   Windows: $($os.Caption) $($os.Version)")
$sal.Add("Procesador: $((Get-CimInstance Win32_Processor | Select-Object -First 1).Name)   RAM: $([math]::Round($os.TotalVisibleMemorySize / 1MB, 1)) GB")
$sal.Add("--- Pantallas ---")
[System.Windows.Forms.Screen]::AllScreens | ForEach-Object { $sal.Add(("{0}  principal={1}  {2}x{3}  en {4},{5}" -f $_.DeviceName, $_.Primary, $_.Bounds.Width, $_.Bounds.Height, $_.Bounds.X, $_.Bounds.Y)) }
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
foreach ($h in (Ventanas-Nuestras $Perfil $procs)) {
  $r = New-Object W32+RECT; [void][W32]::GetWindowRect($h, [ref]$r)
  $sal.Add(("'{0}'  en {1},{2}  tamano {3}x{4}" -f [W32]::Titulo($h), $r.Left, $r.Top, ($r.Right - $r.Left), ($r.Bottom - $r.Top)))
}
$sal.Add("--- Registro del kit (ultimas 15 lineas) ---")
if (Test-Path "$Carpeta\registro.txt") { Get-Content "$Carpeta\registro.txt" -Tail 15 | ForEach-Object { $sal.Add($_) } }
$sal | Set-Content -Encoding UTF8 "$Carpeta\diagnostico.txt"
$sal | ForEach-Object { Write-Host $_ }
Write-Host ""
Write-Host "Guardado en $Carpeta\diagnostico.txt"
if ($AbrirPoliticas -and $exe) { Start-Process $exe -ArgumentList @("--user-data-dir=`"$Perfil`"", "chrome://policy") }
Pausa
