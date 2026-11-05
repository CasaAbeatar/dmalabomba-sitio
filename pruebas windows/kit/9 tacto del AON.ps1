# Comprueba que Windows ve el tacto del AON y abre la herramienta que lo asocia a la pantalla correcta.
# La HP no es tactil: el AON es el unico dispositivo tactil, y aun asi hay que verificar que el toque cae en el AON.
param([switch]$Silencioso)
. "$PSScriptRoot\funciones.ps1"
Write-Host "Dispositivos tactiles que ve Windows:"
$tactiles = @(Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object { $_.FriendlyName -match "touch|t.ctil|digitiz" -and $_.Class -in @("HIDClass", "Mouse", "Touch") })
if ($tactiles.Count -eq 0) { Write-Host "  Ninguno. Revise el cable USB del tacto del AON (debe ir a un USB de la HP, aparte del cable de video)." }
$tactiles | ForEach-Object { Write-Host ("  {0}  [{1}]  estado {2}" -f $_.FriendlyName, $_.Class, $_.Status) }
Write-Host ""
Write-Host "Pantallas:"
[System.Windows.Forms.Screen]::AllScreens | ForEach-Object { "  {0}  principal={1}  {2}x{3}" -f $_.DeviceName, $_.Primary, $_.Bounds.Width, $_.Bounds.Height }
Write-Host ""
Write-Host "Se abre Configuracion de Tablet PC. En la pestana Pantalla pulse Configurar y toque el AON cuando diga 'Toque esta pantalla'."
Write-Host "En la otra pantalla (la de la HP, que no es tactil) no se puede tocar: pulse Entrar con un teclado para saltarla."
$mdm = Join-Path $env:SystemRoot "System32\MultiDigiMon.exe"
if (Test-Path $mdm) { Start-Process $mdm -ArgumentList "-touch" }
else { Start-Process control.exe -ArgumentList "tabletpc.cpl" }
Pausa
