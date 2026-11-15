# Fija los roles de las pantallas: tactil Skitphrati = pantalla 1 (principal, cajera); LG = pantalla 2 (cliente). Seguro de repetir.
param([switch]$Silencioso)
. "$PSScriptRoot\config.ps1"
. "$PSScriptRoot\funciones.ps1"
Extender-Pantallas
$ok = Fijar-Pantallas
"Pantallas:"
[System.Windows.Forms.Screen]::AllScreens | ForEach-Object { "  {0}  rol={1}  principal={2}  {3}x{4}  en {5},{6}" -f $_.DeviceName, (Rol-Pantalla $_), $_.Primary, $_.Bounds.Width, $_.Bounds.Height, $_.Bounds.X, $_.Bounds.Y }
if ($ok) { Write-Host "Roles fijados: la tactil es la pantalla 1 (principal) y la LG la 2 (cliente)." }
else { Write-Host "No se pudo fijar: se necesitan las dos pantallas encendidas, la tactil a 1366x768 y la LG a 1920x1080. Vea el diagnostico." }
Pausa
