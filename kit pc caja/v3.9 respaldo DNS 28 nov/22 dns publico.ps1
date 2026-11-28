# v3.9 (28 nov): DNS publicos de respaldo en el adaptador de red activo. OPCIONAL: apagado por defecto ($DnsPublicoRespaldo en config.ps1) y solo lo decide Emil.
# Por que existe: si el DNS de la red de la tienda falla para el facturador (caso del 28 nov: contesta NXDOMAIN con una zona vieja) pero los DNS publicos resuelven bien, la solucion de fondo es
# que esta PC consulte directo a 1.1.1.1 y 8.8.8.8. Sin esto el kit ya tiene la "ruta por IP" (no necesita administrador); esto cambia el DNS de TODA la PC.
#   -Aplicar   guarda como estaba el DNS del adaptador (datos\dns respaldo.json), pone los DNS publicos, comprueba que el facturador resuelva y, si no resuelve, lo deja todo como estaba.
#   -Revertir  devuelve el DNS como estaba: si lo daba el DHCP del router vuelve a DHCP; si estaba fijo, vuelve a los servidores anteriores.
#   -Estado    muestra el adaptador, sus DNS y lo guardado.   (sin parametros = -Estado)
# Necesita administrador para -Aplicar y -Revertir (pide permiso solo). Se puede usar con FIJAR DNS PUBLICO.bat y RESTAURAR DNS.bat.
param([switch]$Aplicar, [switch]$Revertir, [switch]$Estado, [switch]$Silencioso)
. "$PSScriptRoot\config.ps1"
. "$PSScriptRoot\funciones.ps1"
. "$PSScriptRoot\funciones dns.ps1"
if (-not ($Aplicar -or $Revertir -or $Estado)) { $Estado = $true }
New-Item -ItemType Directory -Force -Path $Datos -ErrorAction SilentlyContinue | Out-Null
$archivo = "$Datos\dns respaldo.json"
function Dice($t) { Write-Host $t; try { Add-Content -LiteralPath "$Datos\registro.txt" -Value ("{0:yyyy-MM-dd HH:mm:ss}  [dns publico] {1}" -f (Get-Date), $t) -ErrorAction Stop } catch { $null = 1 } }
function Leer-Guardado { try { if (Test-Path -LiteralPath $archivo) { return (([IO.File]::ReadAllText($archivo, [Text.Encoding]::UTF8).TrimStart([char]0xFEFF)) | ConvertFrom-Json) } } catch { $null = 1 }; return $null }
function Guardar-Datos($o) { ($o | ConvertTo-Json -Depth 5) | Set-Content -LiteralPath $archivo -Encoding ASCII }
function Adaptador-Por-Datos($a) {
  $ad = $null
  try { if ($a.guid) { $ad = Get-NetAdapter -ErrorAction Stop | Where-Object { $_.InterfaceGuid -eq [string]$a.guid } | Select-Object -First 1 } } catch { $null = 1 }
  if (-not $ad) { try { $ad = Get-NetAdapter -InterfaceIndex ([int]$a.indice) -ErrorAction Stop } catch { $null = 1 } }
  return $ad
}

if (($Aplicar -or $Revertir) -and -not (Es-Admin)) {
  $sw = $(if ($Aplicar) { "-Aplicar" } else { "-Revertir" })
  Start-Process powershell.exe -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" $sw"
  exit
}

if ($Estado) {
  $ad = Adaptador-Activo
  if ($ad) { $d = Dns-Del-Adaptador $ad; Dice ("Adaptador activo: " + $d.alias + " (indice " + $d.indice + "). DNS: " + ($d.servidores -join ", ") + ". Lo da el DHCP del router: " + $d.dhcp) } else { Dice "No se encontro el adaptador activo." }
  $g = Leer-Guardado
  if ($g) { Dice ("Guardado (dns respaldo.json): aplicado=" + $g.aplicado + "; antes: " + (@($g.anterior.servidores) -join ", ") + " (DHCP: " + $g.anterior.dhcp + "); desde " + $g.ts) } else { Dice "El kit no ha fijado DNS publicos en esta PC." }
}

if ($Aplicar) {
  $ad = Adaptador-Activo
  if (-not $ad) { Dice "No se encontro el adaptador activo: no se cambia nada."; Pausa; exit 1 }
  $ant = Dns-Del-Adaptador $ad
  $g = Leer-Guardado
  if ($g -and $g.aplicado) { $ant = $g.anterior; Dice "Ya estaba aplicado: se conserva el DNS original guardado." }
  $lista = @($DnsPublicoLista | ForEach-Object { [string]$_ } | Where-Object { Es-Ip-Publica-V4 $_ })
  if ($lista.Count -eq 0) { Dice "La lista DnsPublicoLista de config.ps1 no tiene IP validas: no se cambia nada."; Pausa; exit 1 }
  # primero se guarda como estaba (asi la reversa siempre es posible), despues se cambia
  Guardar-Datos ([ordered]@{ ts = (Get-Date).ToString("s"); aplicado = $true; anterior = $ant; publicos = $lista })
  try {
    Set-DnsClientServerAddress -InterfaceIndex $ad.ifIndex -ServerAddresses $lista -ErrorAction Stop
    & ipconfig.exe /flushdns 2>&1 | Out-Null
  } catch { Dice ("No se pudo cambiar el DNS: " + $_.Exception.Message); }
  $nombre = ([Uri]$UrlCaja).DnsSafeHost
  $res = Resolver-Local $nombre 6000
  if ($res.ok) {
    Dice ("DNS publicos fijados en " + $ad.Name + ": " + ($lista -join ", ") + ". " + $nombre + " resuelve. Para devolver el DNS como estaba: RESTAURAR DNS.bat.")
    try { Registrar-Evento "reparacion" ("DNS publicos de respaldo fijados en el adaptador " + $ad.Name + " (antes: " + $(if ($ant.dhcp) { "DHCP " } else { "fijo " }) + (@($ant.servidores) -join ",") + ")") } catch { $null = 1 }
  } else {
    Dice ($nombre + " NO resuelve con los DNS publicos: se deja el DNS como estaba.")
    $g2 = Leer-Guardado; if ($g2) { $g2.aplicado = $true; Guardar-Datos $g2 }
    $Revertir = $true
  }
}

if ($Revertir) {
  $g = Leer-Guardado
  if (-not $g -or -not $g.aplicado) { Dice "No hay DNS publicos fijados por el kit: nada que devolver." }
  else {
    $ad = Adaptador-Por-Datos $g.anterior
    if (-not $ad) { Dice "No se encontro el adaptador que se cambio; no se pudo devolver el DNS." ; Pausa; exit 1 }
    try {
      if ($g.anterior.dhcp) { Set-DnsClientServerAddress -InterfaceIndex $ad.ifIndex -ResetServerAddresses -ErrorAction Stop }
      else { Set-DnsClientServerAddress -InterfaceIndex $ad.ifIndex -ServerAddresses @($g.anterior.servidores) -ErrorAction Stop }
      & ipconfig.exe /flushdns 2>&1 | Out-Null
      $g.aplicado = $false
      $g | Add-Member -NotePropertyName revertido -NotePropertyValue (Get-Date).ToString("s") -Force
      Guardar-Datos $g
      Dice ("DNS devuelto como estaba en " + $ad.Name + " (" + $(if ($g.anterior.dhcp) { "DHCP del router" } else { "fijo: " + (@($g.anterior.servidores) -join ", ") }) + ").")
      try { Registrar-Evento "reparacion" ("DNS del adaptador " + $ad.Name + " devuelto como estaba") } catch { $null = 1 }
    } catch { Dice ("No se pudo devolver el DNS: " + $_.Exception.Message) }
  }
}
Pausa
