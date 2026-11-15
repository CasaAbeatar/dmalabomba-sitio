# Comprueba que Windows ve el tacto de la pantalla de caja y abre la herramienta que lo asocia a la pantalla correcta.
# La pantalla del cliente no es tactil: la caja es el unico dispositivo tactil, y aun asi hay que verificar que el toque cae en ella.
param([switch]$Silencioso)
. "$PSScriptRoot\config.ps1"
. "$PSScriptRoot\funciones.ps1"
Write-Host "Equipo: $NombreEquipo"
Write-Host "Dispositivos tactiles que ve Windows:"
$tactiles = @(Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object { $_.FriendlyName -match "touch|t.ctil|digitiz" -and $_.Class -in @("HIDClass", "Mouse", "Touch") })
if ($tactiles.Count -eq 0) { Write-Host "  Ninguno. Revise el cable USB del tacto de $NombreCaja (debe ir a un USB del equipo, aparte del cable de video)." }
$tactiles | ForEach-Object { Write-Host ("  {0}  [{1}]  estado {2}" -f $_.FriendlyName, $_.Class, $_.Status) }
Write-Host ""
Write-Host "Pantallas:"
[System.Windows.Forms.Screen]::AllScreens | ForEach-Object { "  {0}  principal={1}  {2}x{3}" -f $_.DeviceName, $_.Primary, $_.Bounds.Width, $_.Bounds.Height }
Write-Host ""
Write-Host "Se abre Configuracion de Tablet PC. En la pestana Pantalla pulse Configurar y toque la pantalla de la caja ($NombreCaja) cuando diga 'Toque esta pantalla'."
Write-Host "En la otra pantalla ($NombreCliente, que no es tactil) no se puede tocar: pulse Entrar con un teclado para saltarla."
$mdm = Join-Path $env:SystemRoot "System32\MultiDigiMon.exe"
if (Test-Path $mdm) { Start-Process $mdm -ArgumentList "-touch" }
else { Start-Process control.exe -ArgumentList "tabletpc.cpl" }
Write-Host ""
Write-Host "Recomendaciones: deje el cable USB del tacto siempre en el mismo puerto trasero (si lo cambia, Windows puede perder la asociacion) y haga este paso con las dos pantallas ya conectadas. No use Calibrar salvo que el dedo quede desfasado."
Pausa
