# Instala todo el kit de una vez, sin detenerse: cada paso anota su resultado y al final se muestra un resumen.
param([switch]$Silencioso)
. "$PSScriptRoot\config.ps1"
. "$PSScriptRoot\funciones.ps1"
Pedir-Admin $MyInvocation.MyCommand.Path
New-Item -ItemType Directory -Force -Path $Carpeta | Out-Null
$registro = "$Carpeta\instalacion.txt"
$resumen = New-Object System.Collections.Generic.List[string]
function Paso($nombre, [scriptblock]$bloque) {
  try { & $bloque *>> $registro; $resumen.Add("OK     $nombre") }
  catch { $resumen.Add("FALLO  ${nombre}: $($_.Exception.Message)"); Add-Content $registro "FALLO ${nombre}: $($_.Exception.Message)" }
}
Add-Content $registro ("==== {0:yyyy-MM-dd HH:mm:ss} instalacion en {1} ====" -f (Get-Date), $env:COMPUTERNAME)

# Chrome: si no esta, se intenta con winget (viene con Windows 11). Si no se puede, el kit usa Edge.
if (-not (Buscar-Navegador)) {
  Paso "Instalar Google Chrome (winget)" { & winget.exe install -e --id Google.Chrome --silent --accept-package-agreements --accept-source-agreements }
}
Paso "1 Copiar el kit y crear accesos"      { & "$PSScriptRoot\1 crear accesos y arranque automatico.ps1" -Silencioso }
Paso "2 Energia y adornos de Windows"       { & "$PSScriptRoot\2 energia y pantalla.ps1" -Silencioso }
Paso "4 Actualizaciones (horas activas)"    { & "$PSScriptRoot\4 actualizaciones de Windows.ps1" -Silencioso }
Paso "5 Pantallas y permisos del navegador" { & "$PSScriptRoot\5 pantallas y permiso de ventanas.ps1" -Silencioso }
Paso "12 Fijar roles de pantallas (tactil=1 principal, LG=2 cliente)" { & "$PSScriptRoot\12 fijar pantallas.ps1" -Silencioso }
Paso "10 Diagnostico inicial"               { & "$PSScriptRoot\10 diagnostico.ps1" -Silencioso }

$exe = Buscar-Navegador
$resumen.Add("Navegador: $(if ($exe) { $exe } else { 'NO HAY. Instale Google Chrome.' })")
$resumen.Add("Pantallas: $([System.Windows.Forms.Screen]::AllScreens.Count) (deben ser 2)")
$resumen | ForEach-Object { Write-Host $_ }
$resumen | Add-Content $registro
Write-Host ""
Write-Host "Opcional: inicio de sesion automatico (3) y comprobar el tacto (ASOCIAR TACTO.bat). El kit no crea cuentas: la PC usa su unica cuenta."
Write-Host "Registro completo en $registro"
Pausa
