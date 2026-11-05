# Pantalla extendida y permisos del sitio en Chrome y Edge: manejo de ventanas (Window Management API), ventanas emergentes y pantalla completa sin gesto.
param([switch]$Silencioso)
. "$PSScriptRoot\config.ps1"
. "$PSScriptRoot\funciones.ps1"
Pedir-Admin $MyInvocation.MyCommand.Path
Extender-Pantallas
# Listas de origenes (valores "1", "2"...). Solo cuenta el origen, la ruta se ignora.
$listas = @("WindowManagementAllowedForUrls", "PopupsAllowedForUrls", "AutomaticFullscreenAllowedForUrls", "LocalNetworkAccessAllowedForUrls")   # la ultima deja que la pagina lea la publicidad del servidor local sin preguntar
foreach ($marca in @("Google\Chrome", "Microsoft\Edge")) {
  foreach ($lista in $listas) {
    $ruta = "HKLM:\SOFTWARE\Policies\$marca\$lista"
    New-Item -Path $ruta -Force | Out-Null
    New-ItemProperty -Path $ruta -Name "1" -Value $Sitio -PropertyType String -Force | Out-Null
  }
  # Menos avisos y menos trabajo de fondo en un equipo modesto
  $base = "HKLM:\SOFTWARE\Policies\$marca"
  foreach ($d in @(@("TranslateEnabled", 0), @("DefaultBrowserSettingEnabled", 0), @("BackgroundModeEnabled", 0), @("MetricsReportingEnabled", 0))) {
    New-ItemProperty -Path $base -Name $d[0] -Value $d[1] -PropertyType DWord -Force | Out-Null
  }
}
Write-Host "Permisos concedidos a ${Sitio}: manejo de ventanas, ventanas emergentes y pantalla completa sin gesto."
Write-Host "Cierre Chrome por completo y abra chrome://policy: debe listar las tres directivas con 'Estado: OK'."
Write-Host "Si no aparecen (equipo sin dominio), el kit sigue funcionando: acomoda y pone en pantalla completa las ventanas por su cuenta."
Write-Host ""
Write-Host "Pantallas detectadas:"
[System.Windows.Forms.Screen]::AllScreens | ForEach-Object {
  "{0}  principal={1}  {2}x{3}  posicion {4},{5}" -f $_.DeviceName, $_.Primary, $_.Bounds.Width, $_.Bounds.Height, $_.Bounds.X, $_.Bounds.Y }
Pausa
