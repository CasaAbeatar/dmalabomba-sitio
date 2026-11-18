# Prueba del kit v3 en Windows PowerShell 5.1 real (ejecutor de GitHub). Simula la PC de caja: administrador instala, cuenta normal usa.
$ErrorActionPreference = "Continue"
$aqui = Split-Path -Parent $MyInvocation.MyCommand.Path
$origen = (Resolve-Path (Join-Path $aqui "..\kit pc caja\v3 reparador y enlace 18 nov (sin probar)")).Path
$res = Join-Path $aqui "resultados"; New-Item -ItemType Directory -Force $res | Out-Null
$sal = Join-Path $res "prueba kit.txt"
function Dice($t) { $l = "{0:HH:mm:ss}  {1}" -f (Get-Date), $t; Write-Host $l; Add-Content -LiteralPath $sal -Value $l }
function Volcar($titulo, $ruta) { Dice ("--- " + $titulo + " (" + $ruta + ")"); if (Test-Path -LiteralPath $ruta) { foreach ($x in @(Get-Content -LiteralPath $ruta -ErrorAction SilentlyContinue)) { Dice ("    " + $x) } } else { Dice "    (no existe)" } }
Dice ("Windows PowerShell " + $PSVersionTable.PSVersion + " en " + [Environment]::OSVersion.VersionString)
Dice ("Usuario del ejecutor: " + $env:USERNAME + " administrador: " + ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))

# 1) sintaxis con el parser de 5.1
$malos = 0
foreach ($f in Get-ChildItem $origen -Filter *.ps1) { $e = $null; $t = $null; [void][System.Management.Automation.Language.Parser]::ParseFile($f.FullName, [ref]$t, [ref]$e); if ($e.Count) { $malos++; Dice ("SINTAXIS " + $f.Name + ": " + $e[0].Message + " L" + $e[0].Extent.StartLineNumber) } }
Dice ("1) Archivos con error de sintaxis en 5.1: " + $malos)

# 2) cuenta normal de prueba (la cajera)
$clave = "Kit-Prueba-2026-xZ9!"
net user cajaprueba $clave /add 2>&1 | Out-Null
Dice ("2) Cuenta normal creada: " + (net localgroup Users | Select-String cajaprueba))

# 3) instalar la copia y los permisos con el script REAL del kit, como administrador
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $origen "1 crear accesos y arranque automatico.ps1") -Silencioso 2>&1 | ForEach-Object { Dice ("   paso1: " + $_) }
Dice ("3) Archivos copiados a C:\PantallaCliente: " + @(Get-ChildItem C:\PantallaCliente -File -ErrorAction SilentlyContinue).Count)
Dice ("   ACL de la raiz: " + ((& icacls.exe C:\PantallaCliente 2>&1) -join " | "))
Dice ("   ACL de datos:   " + ((& icacls.exe C:\PantallaCliente\datos 2>&1) -join " | "))
Dice ("   ACL de 11 latido: " + ((& icacls.exe "C:\PantallaCliente\11 latido.ps1" 2>&1) -join " | "))

# ayudante: correr algo como la cuenta normal (tarea programada, sin privilegios)
function Como-Normal($nombre, $comando, $segundos) {
  $o = "C:\Windows\Temp\salida-$nombre.txt"; Remove-Item $o -Force -ErrorAction SilentlyContinue
  $bat = "C:\Windows\Temp\corre-$nombre.cmd"
  Set-Content -LiteralPath $bat -Value ('@echo off' + "`r`n" + $comando + ' > "' + $o + '" 2>&1')
  icacls.exe $bat /grant "cajaprueba:(RX)" 2>&1 | Out-Null
  icacls.exe C:\Windows\Temp /grant "cajaprueba:(OI)(CI)M" 2>&1 | Out-Null
  schtasks.exe /Create /TN "kit$nombre" /TR "`"$bat`"" /SC ONCE /ST 23:59 /RU cajaprueba /RP $clave /RL LIMITED /F 2>&1 | Out-Null
  schtasks.exe /Run /TN "kit$nombre" 2>&1 | Out-Null
  $t = 0; while ($t -lt $segundos) { Start-Sleep -Seconds 2; $t += 2; $est = (schtasks.exe /Query /TN "kit$nombre" /FO CSV /NH 2>&1) -join ""; if ($est -notmatch "Running|En ejecuci") { break } }
  Dice ("   [" + $nombre + "] terminado tras ~" + $t + " s")
  schtasks.exe /End /TN "kit$nombre" 2>&1 | Out-Null
  schtasks.exe /Delete /TN "kit$nombre" /F 2>&1 | Out-Null
  if (Test-Path $o) { foreach ($x in @(Get-Content $o)) { Dice ("      " + $x) } }
}

# 4) lo que puede hacer la cuenta normal en los archivos del kit
Dice "4) Cuenta normal: quien es, que puede leer y escribir"
Como-Normal "perm" 'whoami /groups /fo csv /nh | findstr /i "Administrators Users" & echo escribe-datos: & (echo x > C:\PantallaCliente\datos\prueba-normal.txt) && echo SI || echo NO & type "C:\PantallaCliente\config.ps1" | find /c /v "" & icacls "C:\PantallaCliente\datos\prueba-normal.txt"' 60

# 5) EL CANDADO: una copia con privilegios de administrador lo crea; la cuenta normal intenta usarlo
Dice "5) Candado creado por administrador (estilo VIEJO Global con permisos por defecto) y abierto por la cuenta normal"
$viejo = Start-Process powershell.exe -WindowStyle Hidden -PassThru -ArgumentList '-NoProfile -Command "$m = New-Object Threading.Mutex($false, ''Global\PruebaViejo''); [void]$m.WaitOne(0); Start-Sleep 90"'
Start-Sleep -Seconds 6
Como-Normal "mviejo" 'powershell -NoProfile -Command "try { $m = New-Object Threading.Mutex($false, ''Global\PruebaViejo''); \"abrio: $($m.WaitOne(0))\" } catch { \"EXCEPCION: \" + $_.Exception.GetType().Name + \" \" + $_.Exception.Message }"' 60
Dice "5b) Candado NUEVO (Crear-Mutex de la v3.2c) creado por administrador y abierto por la cuenta normal"
$nuevo = Start-Process powershell.exe -WindowStyle Hidden -PassThru -ArgumentList '-NoProfile -ExecutionPolicy Bypass -Command ". C:\PantallaCliente\config.ps1; $c = Crear-Mutex ''Local\PruebaNuevo''; Start-Sleep 90"'
Start-Sleep -Seconds 8
Como-Normal "mnuevo" 'powershell -NoProfile -ExecutionPolicy Bypass -Command ". C:\PantallaCliente\config.ps1; $c = Crear-Mutex ''Local\PruebaNuevo''; \"tengo=$($c.Tengo) motivo=$($c.Motivo)\""' 60
Stop-Process -Id $viejo.Id, $nuevo.Id -Force -ErrorAction SilentlyContinue

# 6) el latido como cuenta normal, 30 s: debe dejar arranque.txt y latido.txt
Dice "6) 11 latido.ps1 como cuenta normal"
Remove-Item C:\PantallaCliente\datos\latido.txt, C:\PantallaCliente\datos\arranque.txt -Force -ErrorAction SilentlyContinue
Como-Normal "latido" 'powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "C:\PantallaCliente\11 latido.ps1"' 30
Volcar "arranque.txt" "C:\PantallaCliente\datos\arranque.txt"
Volcar "latido.txt" "C:\PantallaCliente\datos\latido.txt"

# 7) abrir caja como cuenta normal, 40 s: no hay pantalla ni sesion, pero debe llegar a su registro
Dice "7) 0 abrir caja y pantalla.ps1 como cuenta normal"
Remove-Item C:\PantallaCliente\datos\arranque.txt, C:\PantallaCliente\datos\registro.txt -Force -ErrorAction SilentlyContinue
Como-Normal "caja" 'powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "C:\PantallaCliente\0 abrir caja y pantalla.ps1"' 40
Volcar "arranque.txt" "C:\PantallaCliente\datos\arranque.txt"
Volcar "registro.txt" "C:\PantallaCliente\datos\registro.txt"
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match "PantallaCliente" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Dice "FIN"
