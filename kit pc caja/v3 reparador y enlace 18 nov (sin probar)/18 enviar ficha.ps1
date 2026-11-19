# v3.4: calcula la ficha completa de la computadora y la manda al panel. Lo lanza el latido (al arrancar y cada 6 horas) en un proceso aparte,
# para que la ficha, que tarda decenas de segundos, no retrase los latidos. Solo lee; no cambia nada.
function Arranque($t) { foreach ($d in @("C:\PantallaCliente\datos", $env:TEMP)) { try { Add-Content -LiteralPath "$d\arranque.txt" -Value ("{0:yyyy-MM-dd HH:mm:ss}  [ficha pid {1}] {2}" -f (Get-Date), $PID, $t) -ErrorAction Stop; break } catch { $null = 1 } } }
trap { Arranque ("ERROR " + $_.Exception.GetType().Name + ": " + $_.Exception.Message + " (linea " + $_.InvocationInfo.ScriptLineNumber + ")"); break }
. "$PSScriptRoot\config.ps1"
. "$PSScriptRoot\funciones.ps1"
. "$PSScriptRoot\17 ficha del equipo.ps1"
$c = Crear-Mutex "Local\FichaLB"; $m = $c.Mutex
if (-not $c.Tengo) { exit }
try { (Get-Process -Id $PID).PriorityClass = "BelowNormal" } catch { Write-Verbose "sin prioridad baja" }
$log = "$Datos\ficha.txt"
function Anotar($t) { try { if ((Test-Path $log) -and ((Get-Item $log).Length -gt 100KB)) { Move-Item $log "$log.old" -Force }; Add-Content -Path $log -Value ("{0:yyyy-MM-dd HH:mm:ss}  {1}" -f (Get-Date), $t) } catch { Write-Verbose "sin registro" } }
$id = Leer-Identidad
if (-not $id) { Anotar "Sin identidad: no se envia la ficha."; exit }
try {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $ficha = Ficha-Equipo
  $sw.Stop()
  $json = $ficha | ConvertTo-Json -Depth 8 -Compress
  $bytes = [Text.Encoding]::UTF8.GetByteCount($json)
  $r = Llamar-Rpc "equipo_ficha" ([ordered]@{ p_estacion = $id.estacion; p_token = $id.token; p_ficha = $ficha }) 40
  if ($r.ok) { Anotar ("Ficha enviada: {0} bytes, calculada en {1} s{2}." -f $bytes, [int]($sw.ElapsedMilliseconds / 1000), $(if ($r.cambio) { ", con cambios" } else { "" })) }
  else { Anotar ("La base no acepto la ficha ({0} bytes): {1}" -f $bytes, $r.motivo) }
} catch { Anotar ("No se pudo enviar la ficha: {0}" -f $_.Exception.Message) }
