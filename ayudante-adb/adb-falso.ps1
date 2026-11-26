# adb simulado SOLO PARA PRUEBAS: registra los argumentos en $env:ADB_FALSO_LOG y contesta como un telefono.
param([Parameter(ValueFromRemainingArguments)][string[]]$A)
$pkg = 'tech.bogomolov.incomingsmsgateway'
Add-Content -LiteralPath $env:ADB_FALSO_LOG -Value ($A -join ' ')
$t = $A -join ' '
$falla = $env:ADB_FALSO_FALLA
if ($A[0] -eq 'pair') { if ($A[2] -eq '000000') { 'error: wrong password or connection closed' } else { "Successfully paired to $($A[1]) [guid=adb-SIM]" }; exit 0 }
if ($A[0] -eq 'connect') { "connected to $($A[1])"; exit 0 }
if ($A[0] -eq 'disconnect') { "disconnected $($A[1])"; exit 0 }
if ($t -match 'getprop ro.product.model') { 'HONOR-SIM'; exit 0 }
if ($t -match 'getprop ro.build.version.release') { '13'; exit 0 }
if ($t -match "pm path $pkg") { 'package:/data/app/sim/base.apk'; exit 0 }
if ($t -match "dumpsys package $pkg") { "versionName=2.11.0`n    android.permission.WRITE_SECURE_SETTINGS: granted=$(if ($falla -eq 'grant') {'false'} else {'true'})"; exit 0 }
if ($t -match 'pm grant .*WRITE_SECURE_SETTINGS' -and $falla -eq 'grant') { 'java.lang.SecurityException: grant denied for permission'; exit 0 }
if ($t -match 'dumpsys deviceidle whitelist \+') { "Added: $pkg"; exit 0 }
if ($t -match 'dumpsys deviceidle whitelist$') { "user,$pkg,10234"; exit 0 }
exit 0
