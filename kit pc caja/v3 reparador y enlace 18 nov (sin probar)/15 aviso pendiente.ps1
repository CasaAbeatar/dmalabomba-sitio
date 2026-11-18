# Recordatorio visible: esta computadora todavia no esta enlazada con el panel. Se cierra solo a los 45 segundos.
. "$PSScriptRoot\config.ps1"
. "$PSScriptRoot\funciones.ps1"
. "$PSScriptRoot\funciones v3.ps1"
if (-not (Hay-Pendiente)) { exit }
$c = Crear-Mutex "Local\AvisoPendienteLB"; $m = $c.Mutex; $tengo = $c.Tengo
if (-not $tengo) { exit }
$texto = "Esta computadora todavia NO esta enlazada con el panel de La Bomba (Soda o Pollos)." + "`r`n`r`n" + "El facturador funciona normal. Para enlazarla, toque el icono Reparar del Escritorio y siga las preguntas. Si no tiene el codigo de enlace, avise a Emil."
[void](Dialogo "Falta enlazar esta computadora" $texto @("Entendido") -segundos 45)
