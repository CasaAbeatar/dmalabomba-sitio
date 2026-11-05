# Copia el kit a C:\PantallaCliente, crea los accesos del escritorio y lo pone en el inicio de Windows.
param([switch]$Silencioso)
. "$PSScriptRoot\config.ps1"
. "$PSScriptRoot\funciones.ps1"
New-Item -ItemType Directory -Force -Path $Carpeta | Out-Null
if ($PSScriptRoot -ne $Carpeta) {
  Get-ChildItem -Path $PSScriptRoot -File | Where-Object { $_.Extension -in ".ps1", ".bat", ".exe" } |
    ForEach-Object { Copy-Item $_.FullName -Destination $Carpeta -Force }
}
# La carpeta la crea el administrador: se le da permiso de modificar a todos los usuarios para que la cuenta de la caja pueda escribir el perfil y el registro.
if (Es-Admin) { & icacls.exe $Carpeta /grant "*S-1-5-32-545:(OI)(CI)M" /T /C | Out-Null }
$ws = New-Object -ComObject WScript.Shell
function Hacer-Acceso($ruta, $archivo, $texto) {
  $a = $ws.CreateShortcut($ruta)
  $a.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
  $a.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Carpeta\$archivo`""
  $a.WorkingDirectory = $Carpeta
  $a.WindowStyle = 7
  $a.Description = $texto
  $a.Save()
}
# Inicio para todos los usuarios: el script mismo se sale si la sesion no es la de $UsuarioCaja.
$inicio = [Environment]::GetFolderPath("CommonStartup")
$escr   = [Environment]::GetFolderPath("CommonDesktopDirectory")
Hacer-Acceso "$inicio\Pantalla del cliente.lnk" "0 abrir caja y pantalla.ps1" "Abre la caja y la pantalla del cliente"
Hacer-Acceso "$escr\Abrir caja y pantalla del cliente.lnk" "0 abrir caja y pantalla.ps1" "Abre la caja y la pantalla del cliente"
Hacer-Acceso "$escr\Reparar pantalla del cliente.lnk" "6 reparar.ps1" "Cierra y vuelve a abrir las dos ventanas"
Write-Host "Listo. Accesos creados en el escritorio y en el inicio de Windows (para todos los usuarios)."
