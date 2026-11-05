# Pantalla extendida y permiso para que la caja coloque la ventana del cliente (Window Management API).
. "$PSScriptRoot\funciones.ps1"
Pedir-Admin $MyInvocation.MyCommand.Path
Extender-Pantallas
$sitio = "https://dmalabomba.com"
foreach ($ruta in @("HKLM:\SOFTWARE\Policies\Google\Chrome\WindowManagementAllowedForUrls",
                    "HKLM:\SOFTWARE\Policies\Microsoft\Edge\WindowManagementAllowedForUrls")) {
  New-Item -Path $ruta -Force | Out-Null
  New-ItemProperty -Path $ruta -Name "1" -Value $sitio -PropertyType String -Force | Out-Null
}
Write-Host "Permiso de manejo de ventanas concedido a $sitio. Reinicie el navegador y revise chrome://policy"
Write-Host ""
Write-Host "Pantallas detectadas:"
[System.Windows.Forms.Screen]::AllScreens | ForEach-Object {
  "{0}  principal={1}  {2}x{3}  posicion {4},{5}" -f $_.DeviceName, $_.Primary, $_.Bounds.Width, $_.Bounds.Height, $_.Bounds.X, $_.Bounds.Y }
Read-Host "Presione Entrar para cerrar"
