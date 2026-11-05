# Copia el kit a C:\PantallaCliente, crea el acceso del escritorio y lo pone en el inicio de Windows.
. "$PSScriptRoot\config.ps1"
New-Item -ItemType Directory -Force -Path $Carpeta | Out-Null
Get-ChildItem -Path $PSScriptRoot -File | Where-Object { $_.Extension -in ".ps1", ".bat" } |
  ForEach-Object { Copy-Item $_.FullName -Destination $Carpeta -Force }
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
$inicio = [Environment]::GetFolderPath("Startup")
$escr   = [Environment]::GetFolderPath("Desktop")
Hacer-Acceso "$inicio\Pantalla del cliente.lnk" "0 abrir caja y pantalla.ps1" "Abre la caja y la pantalla del cliente"
Hacer-Acceso "$escr\Abrir caja y pantalla del cliente.lnk" "0 abrir caja y pantalla.ps1" "Abre la caja y la pantalla del cliente"
Hacer-Acceso "$escr\Reparar pantalla del cliente.lnk" "6 reparar.ps1" "Cierra y vuelve a abrir las dos ventanas"
Write-Host "Listo. Accesos creados en el escritorio y en el inicio de Windows."
