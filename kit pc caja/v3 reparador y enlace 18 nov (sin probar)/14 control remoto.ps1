# Instala el anfitrion de Chrome Remote Desktop (descarga oficial de Google) y deja el icono "Control remoto" en el escritorio.
# El vinculo con la cuenta de Google y el PIN los pone Emil una sola vez (ver LEEME). Este script nunca pide ni guarda cuentas ni PIN.
param([switch]$Silencioso)
. "$PSScriptRoot\config.ps1"
. "$PSScriptRoot\funciones.ps1"
Pedir-Admin $MyInvocation.MyCommand.Path
$anfitrion = "${env:ProgramFiles(x86)}\Google\Chrome Remote Desktop\CurrentVersion\remoting_host.exe"
if (-not (Test-Path $anfitrion)) {
  $msi = Join-Path $env:TEMP "chromeremotedesktophost.msi"
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $ProgressPreference = "SilentlyContinue"
  Invoke-WebRequest -Uri "https://dl.google.com/edgedl/chrome-remote-desktop/chromeremotedesktophost.msi" -OutFile $msi -UseBasicParsing -TimeoutSec 180
  $f = Get-AuthenticodeSignature $msi
  if ($f.Status -ne "Valid" -or $f.SignerCertificate.Subject -notmatch "Google") { Remove-Item $msi -Force -ErrorAction SilentlyContinue; throw "El instalador descargado no tiene la firma de Google. No se instalo." }
  $p = Start-Process -FilePath "msiexec.exe" -ArgumentList "/i `"$msi`" /qn /norestart" -Wait -PassThru
  Remove-Item $msi -Force -ErrorAction SilentlyContinue
  if ($p.ExitCode -notin @(0, 3010)) { throw "No se pudo instalar el anfitrion de Chrome Remote Desktop (codigo $($p.ExitCode))" }
}
# Icono "Control remoto": abre la pagina de acceso remoto de Google en esta PC (sirve para revisar el estado o volver a vincularla).
$ws = New-Object -ComObject WScript.Shell
$escr = [Environment]::GetFolderPath("CommonDesktopDirectory")
$a = $ws.CreateShortcut("$escr\Control remoto.lnk")
$exe = Buscar-Navegador
if ($exe) { $a.TargetPath = $exe; $a.Arguments = "https://remotedesktop.google.com/access" } else { $a.TargetPath = "https://remotedesktop.google.com/access" }
$a.Description = "Control remoto de esta computadora (Chrome Remote Desktop)"
$a.Save()
if ($exe) { $a.IconLocation = $exe; $a.Save() }
$aviso = ""; if ($p -and $p.ExitCode -eq 3010) { $aviso = " (Windows pedira reiniciar)" }
Write-Host ("Control remoto: anfitrion instalado{0} e icono creado. Falta vincular la PC con la cuenta de Google (lo hace Emil una vez)." -f $aviso)
Pausa
