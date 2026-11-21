# Funciones nuevas de la v3 (reparador y enlace). Se cargan DESPUES de funciones.ps1: lo que se repita aqui reemplaza a lo de funciones.ps1.
# Solo ASCII en el codigo (el signo de apertura de pregunta se arma con [char]0xBF).
if (-not ([System.Management.Automation.PSTypeName]'W32b').Type) {
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class W32b {
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
}
"@
}
function Cerrar-Ventana($h) { [void][W32b]::PostMessage($h, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) }   # WM_CLOSE: cierra la ventana como si se tocara la X

function Pedir-Admin($ruta) {
  # Igual que la de funciones.ps1, pero conserva -Estacion al pedir permiso de administrador.
  if (-not (Es-Admin)) {
    $extra = ""
    if ($Silencioso) { $extra += " -Silencioso" }
    if ($Estacion) { $extra += " -Estacion `"$Estacion`"" }
    Start-Process powershell.exe -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$ruta`"$extra"
    exit
  }
}

# ===== Resumen que se muestra al final de la instalacion =====
$script:RHecho = New-Object System.Collections.Generic.List[string]
$script:RBien  = New-Object System.Collections.Generic.List[string]
$script:RFalta = New-Object System.Collections.Generic.List[string]
function Hecho($t) { $script:RHecho.Add([string]$t) }
function Bien($t)  { $script:RBien.Add([string]$t) }
function Falta($t) { $script:RFalta.Add([string]$t) }

# ===== Ventanas de pregunta (grandes, para pantalla tactil, con botones que dicen lo que hacen) =====
function Dialogo($titulo, $texto, $botones, [switch]$Campo, $segundos = 0, $tam = 13) {
  # Devuelve @{ Boton = <texto del boton tocado>; Texto = <lo escrito en el campo> }; $null si no se pudo mostrar la ventana.
  $script:DlgResp = $null; $script:DlgTexto = ""; $script:DlgTb = $null; $script:DlgForm = $null
  try {
    $f = New-Object System.Windows.Forms.Form
    $script:DlgForm = $f
    $f.Text = [string]$titulo; $f.StartPosition = "CenterScreen"; $f.TopMost = $true
    $f.FormBorderStyle = "FixedDialog"; $f.MaximizeBox = $false; $f.MinimizeBox = $false; $f.ControlBox = $false
    $f.BackColor = [System.Drawing.Color]::FromArgb(250, 246, 238)
    $f.Font = New-Object System.Drawing.Font("Arial", $tam)
    $ancho = 700
    $medida = [System.Windows.Forms.TextRenderer]::MeasureText([string]$texto, $f.Font, (New-Object System.Drawing.Size(($ancho - 56), 3000)), [System.Windows.Forms.TextFormatFlags]::WordBreak)
    $l = New-Object System.Windows.Forms.Label
    $l.Text = [string]$texto; $l.AutoSize = $false; $l.Left = 28; $l.Top = 22; $l.Width = $ancho - 56; $l.Height = $medida.Height + 8
    $f.Controls.Add($l)
    $y = $l.Top + $l.Height + 16
    if ($Campo) {
      $tb = New-Object System.Windows.Forms.TextBox
      $tb.Left = 28; $tb.Top = $y; $tb.Width = $ancho - 56; $tb.MaxLength = 16; $tb.CharacterCasing = "Upper"
      $tb.Font = New-Object System.Drawing.Font("Consolas", 20)
      $f.Controls.Add($tb)
      $script:DlgTb = $tb
      $y = $tb.Top + $tb.Height + 16
    }
    $n = @($botones).Count
    $sep = 12; $bw = [int](($ancho - 56 - ($sep * ($n - 1))) / $n); $bh = 56
    for ($i = 0; $i -lt $n; $i++) {
      $b = New-Object System.Windows.Forms.Button
      $b.Text = [string]$botones[$i]; $b.Tag = [string]$botones[$i]
      $b.Left = 28 + ($i * ($bw + $sep)); $b.Top = $y; $b.Width = $bw; $b.Height = $bh
      $b.FlatStyle = "Flat"
      if ($i -eq 0) { $b.BackColor = [System.Drawing.Color]::FromArgb(46, 94, 62); $b.ForeColor = [System.Drawing.Color]::White }
      else { $b.BackColor = [System.Drawing.Color]::FromArgb(222, 205, 172); $b.ForeColor = [System.Drawing.Color]::FromArgb(70, 55, 40) }
      $b.Add_Click({ param($s, $e) $script:DlgResp = [string]$s.Tag; if ($script:DlgTb) { $script:DlgTexto = $script:DlgTb.Text }; $s.FindForm().Close() })
      $f.Controls.Add($b)
      if (($i -eq 0) -and $Campo) { $f.AcceptButton = $b }
    }
    $f.ClientSize = New-Object System.Drawing.Size($ancho, ($y + $bh + 24))
    $f.Add_Shown({ param($s, $e) $s.Activate() })
    $t = $null
    if ($segundos -gt 0) {
      $t = New-Object System.Windows.Forms.Timer
      $t.Interval = [int]($segundos * 1000)
      $t.Add_Tick({ param($s, $e) $s.Stop(); if ($script:DlgForm) { $script:DlgForm.Close() } })
      $t.Start()
    }
    [void]$f.ShowDialog()
    if ($t) { $t.Dispose() }
    $f.Dispose()
    return @{ Boton = $script:DlgResp; Texto = $script:DlgTexto }
  } catch {
    Write-Host ([string]$texto)
    return $null
  }
}
function Corto($est) { if ($est -eq "caja-soda") { return "SODA" } else { return "POLLOS" } }

# ===== Pendiente de enlace: recordatorio visible mientras la PC no tenga identidad valida =====
function Hay-Pendiente { return (Test-Path -LiteralPath $ArchivoPendienteEnlace) }
function Marcar-Pendiente($motivo) {
  try {
    New-Item -ItemType Directory -Force -Path (Split-Path $ArchivoPendienteEnlace) | Out-Null
    Set-Content -LiteralPath $ArchivoPendienteEnlace -Encoding UTF8 -Value @("PENDIENTE: enlazar esta computadora con el panel (Soda o Pollos).", [string]$motivo, ("Desde: " + (Get-Date).ToString("s")), "Para resolverlo: tocar el icono Reparar, o abrir ENLAZAR EQUIPO.bat con un codigo nuevo.")
  } catch { Write-Verbose "no se pudo marcar el pendiente" }
}
function Quitar-Pendiente { Remove-Item -LiteralPath $ArchivoPendienteEnlace -Force -ErrorAction SilentlyContinue }
function Mostrar-Aviso-Pendiente {
  # Ventana aparte (no frena la vigilancia) que se cierra sola a los 45 segundos.
  try { Lanzar-Oculto ("-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Carpeta\15 aviso pendiente.ps1`"") }
  catch { Write-Verbose "no se pudo mostrar el aviso" }
}

# ===== Identidad: Soda o Pollos, siempre verificada =====
function Pista-Estacion($declarada) {
  # Lo que se sabe de antemano sobre la PC: lo que se declaro al instalar (-Estacion) o lo que dice el nombre de la computadora.
  if ($declarada -match '^(?i)(s|soda|caja-soda)$') { return "caja-soda" }
  if ($declarada -match '^(?i)(p|pollos|caja-pollos)$') { return "caja-pollos" }
  $n = [string]$env:COMPUTERNAME
  $s = ($n -match '(?i)soda'); $p = ($n -match '(?i)poll')
  if ($s -and -not $p) { return "caja-soda" }
  if ($p -and -not $s) { return "caja-pollos" }
  return $null
}
function Estado-Identidad {
  # Estado: ok | falta | danado | otra_pc. Id = la identidad valida (solo si ok). Restaurada = se tuvo que leer la copia .bak.
  $okObj = $null; $restaurada = $false; $hay = $false; $malo = $false; $otra = $false
  foreach ($f in @($ArchivoIdentidad, "$ArchivoIdentidad.bak")) {
    if (-not (Test-Path -LiteralPath $f)) { continue }
    $hay = $true
    try {
      $o = Get-Content -LiteralPath $f -Raw -Encoding UTF8 | ConvertFrom-Json
      if (-not ($o -and ($o.estacion -in @("caja-soda", "caja-pollos")) -and $o.token)) { $malo = $true; continue }
      if ($o.pc -ne $env:COMPUTERNAME) { $otra = $true; continue }
      if (-not $okObj) { $okObj = $o; $restaurada = ($f -ne $ArchivoIdentidad) }
    } catch { $malo = $true }
  }
  $estado = "falta"
  if ($okObj) { $estado = "ok" }
  elseif ($otra) { $estado = "otra_pc" }
  elseif ($malo) { $estado = "danado" }
  return [pscustomobject]@{ Estado = $estado; Id = $okObj; Restaurada = $restaurada }
}
function Verificar-En-Base($id) {
  # Manda una senal y mira si la base reconoce la clave. Devuelve: ok | rechazada | sin_red | error_base
  try {
    $datos = [ordered]@{ version_kit = $VersionKit; pantallas = [System.Windows.Forms.Screen]::AllScreens.Count; ventanas = 0; internet_ok = $true; detalle = [ordered]@{ pc = $env:COMPUTERNAME; verificacion_kit = $true } }
    $r = Llamar-Rpc "equipo_latido" ([ordered]@{ p_estacion = $id.estacion; p_token = $id.token; p_datos = $datos }) 20
    if ($r.ok) { return "ok" } else { return "rechazada" }
  } catch {
    $ex = $_.Exception
    $sinRed = ($ex -is [Net.WebException]) -and ($ex.Status -ne [Net.WebExceptionStatus]::ProtocolError)
    if ($sinRed) { return "sin_red" }
    return "error_base"
  }
}
function Apartar-Identidad {
  # La identidad que no corresponde NO se borra: se renombra, para que el latido no avise con una identidad equivocada.
  $sello = (Get-Date).ToString("yyyyMMdd-HHmmss")
  foreach ($f in @($ArchivoIdentidad, "$ArchivoIdentidad.bak")) {
    if (Test-Path -LiteralPath $f) { try { Move-Item -LiteralPath $f -Destination ("$f.apartada " + $sello) -Force } catch { Write-Verbose "no se pudo apartar la identidad" } }
  }
}
function Enlazar-Interactivo($motivo, $pista) {
  # Pregunta en pantalla Soda o Pollos, pide confirmar y pide el codigo de un solo uso. Devuelve "enlazada" o "despues".
  $q = [string][char]0xBF
  while ($true) {
    $t1 = [string]$motivo + "`r`n`r`n" + $q + "Esta computadora es de SODA o de POLLOS?"
    if ($pista) { $t1 += "`r`n`r`n(El nombre de esta computadora, " + $env:COMPUTERNAME + ", sugiere " + (Corto $pista) + ".)" }
    $r = Dialogo "Enlazar esta computadora" $t1 @("SODA", "POLLOS", "Enlazar despues")
    if ((-not $r) -or (-not $r.Boton) -or ($r.Boton -eq "Enlazar despues")) { return "despues" }
    if ($r.Boton -eq "SODA") { $est = "caja-soda" } else { $est = "caja-pollos" }
    $nombre = Nombre-Estacion $est
    $si = "Si, es " + (Corto $est)
    $c = Dialogo "Confirmar" ("Confirme: esta computadora es " + $nombre + ".`r`n`r`nLa identidad es de ESTA computadora fisica: no cambia aunque en el facturador se use otra empresa, y para cambiarla despues hace falta un codigo nuevo.") @($si, "No, volver a elegir")
    if ((-not $c) -or ($c.Boton -ne $si)) { continue }
    while ($true) {
      $k = Dialogo "Codigo de enlace" ("Escriba el codigo de enlace de 8 letras y numeros para " + $nombre + ".`r`n`r`nSirve una sola vez y vence en 12 horas.") @("Enlazar", "Enlazar despues", "Volver") -Campo
      if ((-not $k) -or (-not $k.Boton) -or ($k.Boton -eq "Enlazar despues")) { return "despues" }
      if ($k.Boton -eq "Volver") { break }
      $codigo = (([string]$k.Texto) -replace '[^A-Za-z0-9]', '').ToUpper()
      if ($codigo.Length -ne 8) { [void](Dialogo "Codigo incompleto" "El codigo debe tener 8 letras y numeros. Revise y escribalo de nuevo." @("Aceptar")); continue }
      try { $rr = Llamar-Rpc "equipo_enrolar" ([ordered]@{ p_codigo = $codigo; p_estacion = $est; p_pc = $env:COMPUTERNAME }) 20 }
      catch { [void](Dialogo "Sin conexion" ("No se pudo hablar con el panel. Revise el internet y vuelva a intentar.`r`n`r`n" + $_.Exception.Message) @("Aceptar")); continue }
      if (-not $rr.ok) { [void](Dialogo "No se enlazo" ("El panel no acepto el codigo: " + $rr.motivo + "`r`n`r`nPida un codigo nuevo o revise que sea para " + $nombre + ".") @("Aceptar")); continue }
      Guardar-Identidad $rr.estacion $rr.token
      return "enlazada"
    }
  }
}
function Asegurar-Identidad($modo, $declarada) {
  # modo: instalar o enlazar (siempre piden confirmar la identidad) | reparar (solo pregunta si algo no cuadra).
  # Resultado: @{ Resultado = ok | pendiente ; Estacion }. Nunca termina "bien" sin identidad valida, salvo que el usuario elija enlazar despues.
  $pista = Pista-Estacion $declarada
  $e = Estado-Identidad
  $motivo = $null; $apartar = $false
  switch ($e.Estado) {
    "falta"   { $motivo = "Esta computadora todavia no esta enlazada con el panel." }
    "danado"  { $motivo = "El archivo de identidad de esta computadora esta danado o incompleto."; $apartar = $true }
    "otra_pc" { $motivo = "La identidad guardada pertenece a otra computadora (el disco pudo clonarse)."; $apartar = $true }
    "ok" {
      $id = $e.Id
      if ($e.Restaurada) { Copy-Item -LiteralPath "$ArchivoIdentidad.bak" -Destination $ArchivoIdentidad -Force -ErrorAction SilentlyContinue; Hecho "Identidad restaurada desde la copia de respaldo" }
      $nom = Nombre-Estacion $id.estacion
      $v = Verificar-En-Base $id
      if ($v -eq "rechazada") { $motivo = "El panel no reconoce la clave guardada de esta computadora (pudo haberse renovado)."; $apartar = $true }
      elseif ($pista -and ($pista -ne $id.estacion)) {
        $a1 = "Es correcta: " + (Corto $id.estacion)
        $r = Dialogo "Verificar la computadora" ("El nombre de esta computadora (" + $env:COMPUTERNAME + ") sugiere " + (Nombre-Estacion $pista) + ", pero esta enlazada como " + $nom + ".`r`n`r`n" + [string][char]0xBF + "Cual es la correcta?") @($a1, "No, enlazar de nuevo")
        if ($r -and ($r.Boton -eq "No, enlazar de nuevo")) { $motivo = "Se pidio enlazarla de nuevo porque el nombre de la PC y la identidad no coinciden."; $apartar = $true }
        else { Bien ("Identidad confirmada por el usuario: " + $nom + " (el nombre de la PC sugeria otra cosa)") }
      }
      elseif ($modo -ne "reparar") {
        $a1 = "Si, es " + (Corto $id.estacion)
        $r = Dialogo "Verificar la computadora" ("Esta computadora esta enlazada como " + $nom + ".`r`n`r`n" + [string][char]0xBF + "Es correcto?") @($a1, "No, enlazar de nuevo")
        if ($r -and ($r.Boton -eq "No, enlazar de nuevo")) { $motivo = "Se pidio enlazarla de nuevo."; $apartar = $true }
        else { Bien ("Identidad confirmada: " + $nom) }
      }
      else { Bien ("Identidad correcta: " + $nom) }
      if (-not $motivo) {
        if ($v -eq "ok") { Bien "El panel reconoce la clave de esta computadora" }
        elseif ($v -eq "sin_red") { Falta "No se pudo comprobar la clave con el panel (sin internet en este momento). Revisar con DIAGNOSTICO.bat cuando haya internet" }
        else { Falta ("El panel respondio con un error al comprobar la clave (" + $v + "). Revisar con DIAGNOSTICO.bat") }
        Quitar-Pendiente
        return @{ Resultado = "ok"; Estacion = $id.estacion }
      }
    }
  }
  $res = Enlazar-Interactivo $motivo $pista
  if ($res -eq "enlazada") {
    $e2 = Estado-Identidad
    Quitar-Pendiente
    if ($e2.Id) {
      Hecho ("Computadora enlazada como " + (Nombre-Estacion $e2.Id.estacion))
      $v2 = Verificar-En-Base $e2.Id
      if ($v2 -eq "ok") { Hecho "El panel ya ve la caja (primera senal recibida)" } else { Falta ("Enlazada, pero la primera senal no llego (" + $v2 + "); el latido la reintenta solo cada minuto") }
      return @{ Resultado = "ok"; Estacion = $e2.Id.estacion }
    }
    Falta "Se recibio el enlace pero el archivo de identidad no quedo legible. Repetir con ENLAZAR EQUIPO.bat"
    return @{ Resultado = "pendiente"; Estacion = $null }
  }
  if ($apartar) { Apartar-Identidad; Hecho "Se aparto la identidad que no correspondia (no se borra: queda como equipo.json.apartada ...)" }
  Marcar-Pendiente $motivo
  Falta ("SIN ENLAZAR: " + $motivo + " Queda un recordatorio visible y el icono Reparar vuelve a preguntar.")
  return @{ Resultado = "pendiente"; Estacion = $null }
}

# ===== Deteccion y limpieza de lo que dejaron las versiones anteriores =====
$script:ArchivosKit = @("config.ps1", "funciones.ps1", "funciones v3.ps1", "0 abrir caja y pantalla.ps1", "1 crear accesos y arranque automatico.ps1", "2 energia y pantalla.ps1",
  "3 inicio de sesion automatico.ps1", "4 actualizaciones de Windows.ps1", "5 pantallas y permiso de ventanas.ps1", "6 reparar.ps1", "7 salir.ps1",
  "8 olvidar sesion del navegador.ps1", "9 tacto de la pantalla de caja.ps1", "10 diagnostico.ps1", "11 latido.ps1", "12 fijar pantallas.ps1",
  "13 identidad del equipo.ps1", "14 control remoto.ps1", "15 aviso pendiente.ps1", "16 bloquear instalaciones.ps1", "17 ficha del equipo.ps1", "18 enviar ficha.ps1", "19 navegacion.ps1", "servidor publicidad.ps1",
  "instalar todo.ps1", "INSTALAR TODO.bat", "ENLAZAR EQUIPO.bat", "REPARAR.bat")
function Verificar-Paquete {
  # Devuelve la lista de archivos que FALTAN en la carpeta desde la que se instala (por ejemplo si solo se copiaron algunos).
  $faltan = New-Object System.Collections.Generic.List[string]
  foreach ($n in $script:ArchivosKit) { if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot $n))) { $faltan.Add($n) } }
  return @($faltan)
}
function Perfiles-Usuario {
  Get-ChildItem -LiteralPath "$env:SystemDrive\Users" -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -notin @("Public", "Default", "Default User", "All Users") }
}
function Carpetas-Escritorio {
  $sal = New-Object System.Collections.Generic.List[string]
  $sal.Add([Environment]::GetFolderPath("CommonDesktopDirectory"))
  foreach ($u in @(Perfiles-Usuario)) {
    $bases = New-Object System.Collections.Generic.List[string]
    $bases.Add($u.FullName)
    foreach ($od in @(Get-ChildItem -LiteralPath $u.FullName -Directory -Filter "OneDrive*" -ErrorAction SilentlyContinue)) { $bases.Add($od.FullName) }
    foreach ($b in $bases) {
      foreach ($r in @("Desktop", "Escritorio")) { $c = Join-Path $b $r; if (Test-Path -LiteralPath $c) { $sal.Add($c) } }
    }
  }
  return @($sal | Select-Object -Unique)
}
function Carpetas-Inicio {
  $sal = New-Object System.Collections.Generic.List[string]
  $sal.Add([Environment]::GetFolderPath("CommonStartup"))
  foreach ($u in @(Perfiles-Usuario)) { $c = Join-Path $u.FullName "AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup"; if (Test-Path -LiteralPath $c) { $sal.Add($c) } }
  return @($sal | Select-Object -Unique)
}
function Es-Acceso-Del-Kit($a) {
  # Un acceso es del kit si apunta a C:\PantallaCliente o al control remoto de Google.
  $txt = [string]$a.TargetPath + " " + [string]$a.Arguments
  return (($txt -match 'PantallaCliente') -or ($txt -match 'remotedesktop\.google\.com'))
}
function Limpiar-Accesos {
  # Deja en el Escritorio solo los iconos permitidos, una sola vez y solo en el Escritorio comun; quita los viejos y los repetidos.
  $ws = New-Object -ComObject WScript.Shell
  $comun = [Environment]::GetFolderPath("CommonDesktopDirectory")
  $quitados = 0
  foreach ($dir in @(Carpetas-Escritorio)) {
    foreach ($f in @(Get-ChildItem -LiteralPath $dir -Filter "*.lnk" -File -ErrorAction SilentlyContinue)) {
      $a = $null
      try { $a = $ws.CreateShortcut($f.FullName) } catch { continue }
      if (-not (Es-Acceso-Del-Kit $a)) { continue }
      if (($dir -eq $comun) -and ($IconosEscritorio -contains $f.BaseName)) { continue }
      try { Remove-Item -LiteralPath $f.FullName -Force -ErrorAction Stop; $quitados++; Hecho ("Se quito el icono sobrante o repetido: " + $f.Name + " (en " + $dir + ")") }
      catch { Falta ("No se pudo quitar el icono " + $f.FullName) }
    }
  }
  if ($quitados -eq 0) { Bien "No habia iconos sobrantes ni repetidos del kit" }
  foreach ($n in $IconosEscritorio) {
    if (Test-Path -LiteralPath (Join-Path $comun ($n + ".lnk"))) { Bien ("Icono del Escritorio presente: " + $n) } else { Falta ("Falta el icono " + $n + " en el Escritorio") }
  }
}
function Limpiar-Inicio {
  # En el inicio de Windows solo deben quedar Latido y Facturador (carpeta comun); lo demas del kit se quita.
  $ws = New-Object -ComObject WScript.Shell
  $comun = [Environment]::GetFolderPath("CommonStartup")
  $quitados = 0
  foreach ($dir in @(Carpetas-Inicio)) {
    foreach ($f in @(Get-ChildItem -LiteralPath $dir -Filter "*.lnk" -File -ErrorAction SilentlyContinue)) {
      $a = $null
      try { $a = $ws.CreateShortcut($f.FullName) } catch { continue }
      if (-not (Es-Acceso-Del-Kit $a)) { continue }
      if (($dir -eq $comun) -and (@("Latido", "Facturador") -contains $f.BaseName)) { continue }
      try { Remove-Item -LiteralPath $f.FullName -Force -ErrorAction Stop; $quitados++; Hecho ("Se quito un arranque automatico viejo o repetido: " + $f.Name) }
      catch { Falta ("No se pudo quitar el arranque " + $f.FullName) }
    }
  }
  if ($quitados -eq 0) { Bien "El inicio de Windows no tenia arranques viejos ni repetidos" }
}
function Limpiar-Run {
  # Entradas de inicio por registro que apunten al kit (el kit arranca por accesos del inicio, no por registro).
  $quitadas = 0
  foreach ($k in @("HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run", "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Run", "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run")) {
    if (-not (Test-Path $k)) { continue }
    $p = Get-ItemProperty -Path $k -ErrorAction SilentlyContinue
    if (-not $p) { continue }
    foreach ($n in @($p.PSObject.Properties.Name)) {
      if ($n -in @("PSPath", "PSParentPath", "PSChildName", "PSDrive", "PSProvider")) { continue }
      if ([string]$p.$n -match 'PantallaCliente') {
        try { Remove-ItemProperty -Path $k -Name $n -Force -ErrorAction Stop; $quitadas++; Hecho ("Se quito una entrada de inicio vieja del registro: " + $n) } catch { Falta ("No se pudo quitar la entrada de registro " + $n) }
      }
    }
  }
  if ($quitadas -eq 0) { Bien "Sin entradas de inicio viejas en el registro" }
}
function Limpiar-Tareas {
  # Tareas programadas que apunten al kit (versiones viejas pudieron crearlas). No se tocan las de Microsoft.
  if (-not (Get-Command Get-ScheduledTask -ErrorAction SilentlyContinue)) { Falta "No se pudieron revisar las tareas programadas (Windows no ofrece la consulta)"; return }
  $vistas = 0
  foreach ($t in @(Get-ScheduledTask -ErrorAction SilentlyContinue)) {
    if ($t.TaskPath -like "\Microsoft\*") { continue }
    $txt = (@($t.Actions) | ForEach-Object { [string]$_.Execute + " " + [string]$_.Arguments }) -join " "
    if ($txt -match 'PantallaCliente') {
      $vistas++
      try { Unregister-ScheduledTask -TaskName $t.TaskName -TaskPath $t.TaskPath -Confirm:$false -ErrorAction Stop; Hecho ("Se quito la tarea programada vieja del kit: " + $t.TaskName) }
      catch { Falta ("No se pudo quitar la tarea programada " + $t.TaskName) }
    }
  }
  if ($vistas -eq 0) { Bien "Sin tareas programadas viejas del kit" }
}
function Apartar-Archivos-Viejos($vigentes) {
  # Los scripts y .bat de la carpeta del kit que NO son de esta version se APARTAN (no se borran) para poder volver atras.
  # Importante: la version del HP + AON traia un script que creaba un usuario de Windows; ese ya no debe quedar.
  $sello = (Get-Date).ToString("yyyyMMdd-HHmmss"); $dest = Join-Path $CarpetaKitAnterior $sello; $n = 0
  foreach ($f in @(Get-ChildItem -LiteralPath $Carpeta -File -ErrorAction SilentlyContinue)) {
    if ($f.Extension -notin @(".ps1", ".bat")) { continue }
    if ($vigentes -contains $f.Name) { continue }
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    try { Move-Item -LiteralPath $f.FullName -Destination $dest -Force -ErrorAction Stop; $n++; Hecho ("Archivo de una version anterior apartado: " + $f.Name) }
    catch { Falta ("No se pudo apartar " + $f.Name) }
  }
  if ($n -eq 0) { Bien "No habia archivos de versiones anteriores que apartar" }
}
function Detener-Kit {
  # Detiene vigilancia, latido, servidor de publicidad y avisos de cualquier version (quedan en memoria con el codigo viejo).
  $n = 0
  foreach ($p in @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'")) {
    if ($p.ProcessId -eq $PID) { continue }
    $c = [string]$p.CommandLine
    if ($c -match '0 abrir caja y pantalla|servidor publicidad|11 latido|15 aviso pendiente|18 enviar ficha|19 navegacion') { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue; $n++ }
  }
  return $n
}
function Detectar-Instalacion {
  # Mira lo que hay en la PC (sin cambiar nada) y devuelve las lineas para mostrar.
  $lineas = New-Object System.Collections.Generic.List[string]
  $existe = Test-Path -LiteralPath $Carpeta
  $version = "ninguna (instalacion nueva)"
  $archivos = @()
  if ($existe) {
    $archivos = @(Get-ChildItem -LiteralPath $Carpeta -File -ErrorAction SilentlyContinue | ForEach-Object { $_.Name })
    $v = $null
    try { $m = Select-String -LiteralPath "$Carpeta\config.ps1" -Pattern '^\$VersionKit\s*=\s*"([^"]*)"' -ErrorAction Stop | Select-Object -First 1; if ($m) { $v = $m.Matches[0].Groups[1].Value } } catch { Write-Verbose "sin config" }
    if ($v) { $version = "kit " + $v }
    elseif ($archivos -contains "11 latido.ps1") { $version = "v2 (con latido, sin numero de version)" }
    elseif ($archivos -contains "0 abrir caja y pantalla.ps1") { $version = "v1 del 14 nov o v2 propuesta del 15 nov (sin identidad ni latido)" }
    else { $version = "carpeta sin kit reconocible" }
  }
  $lineas.Add("Version encontrada: " + $version)
  $lineas.Add("Carpeta " + $Carpeta + ": " + $(if ($existe) { "existe (" + $archivos.Count + " archivos)" } else { "no existe" }))
  $e = Estado-Identidad
  $lineas.Add("Identidad (equipo.json): " + $e.Estado + $(if ($e.Id) { " (" + $e.Id.estacion + ")" } else { "" }))
  $tareas = 0
  if (Get-Command Get-ScheduledTask -ErrorAction SilentlyContinue) {
    foreach ($t in @(Get-ScheduledTask -ErrorAction SilentlyContinue)) {
      if ($t.TaskPath -like "\Microsoft\*") { continue }
      $txt = (@($t.Actions) | ForEach-Object { [string]$_.Execute + " " + [string]$_.Arguments }) -join " "
      if ($txt -match 'PantallaCliente') { $tareas++ }
    }
  }
  $lineas.Add("Tareas programadas del kit: " + $tareas)
  $ws = New-Object -ComObject WScript.Shell
  $iconos = New-Object System.Collections.Generic.List[string]
  foreach ($dir in @(Carpetas-Escritorio)) {
    foreach ($f in @(Get-ChildItem -LiteralPath $dir -Filter "*.lnk" -File -ErrorAction SilentlyContinue)) {
      try { if (Es-Acceso-Del-Kit ($ws.CreateShortcut($f.FullName))) { $iconos.Add($f.BaseName) } } catch { Write-Verbose "acceso ilegible" }
    }
  }
  $lineas.Add("Iconos del kit en el Escritorio: " + $(if ($iconos.Count -gt 0) { $iconos -join ", " } else { "ninguno" }))
  $lineas.Add("Pantallas conectadas: " + [System.Windows.Forms.Screen]::AllScreens.Count)
  return [pscustomobject]@{ Existe = $existe; Version = $version; Archivos = $archivos; Lineas = @($lineas) }
}
function Revisar-Cuentas {
  # Solo informa (el kit nunca crea ni cambia cuentas). Si la cuenta de la caja es administradora, la cajera podria instalar programas.
  try {
    $usuarioConsola = ""
    try { $usuarioConsola = [string](Get-CimInstance Win32_ComputerSystem).UserName } catch { Write-Verbose "sin usuario de consola" }
    $admins = @(Get-LocalGroupMember -SID "S-1-5-32-544" -ErrorAction Stop | ForEach-Object { [string]$_.Name })
    if ($usuarioConsola) {
      if ($admins -contains $usuarioConsola) { Falta ("La cuenta de la caja (" + $usuarioConsola + ") es ADMINISTRADORA de Windows: la cajera podria instalar programas. Recomendacion (Emil decide): dejarla como usuario estandar y que el administrador sea otra cuenta que solo se use para mantenimiento. El kit no crea ni cambia cuentas.") }
      else { Bien ("La cuenta de la caja (" + $usuarioConsola + ") es de usuario estandar: no puede instalar programas") }
    } else { Falta "No se pudo saber que cuenta de Windows usa la caja (nadie con sesion abierta). Revisar a mano que no sea administradora" }
  } catch { Falta ("No se pudieron revisar las cuentas de Windows: " + $_.Exception.Message) }
}
function Revisar-Pantallas {
  $t = [System.Windows.Forms.Screen]::AllScreens
  if ($t.Count -ge 2) {
    $caja = $t | Where-Object { (Rol-Pantalla $_) -eq "caja" } | Select-Object -First 1
    if ($caja -and $caja.Primary) { Bien "Pantallas: la tactil es la 1 (principal) y la LG la 2 (cliente)" }
    else { Falta "Las 2 pantallas estan conectadas pero no se pudieron fijar como tactil = 1 y LG = 2 (revisar resolucion: tactil 1366x768, LG 1920x1080)" }
  } else { Falta "Hay UNA sola pantalla: el kit trabaja en plan B (solo el facturador, sin pantalla del cliente). Si no es a proposito, revisar el cable de la tactil" }
}
function Texto-Resumen($maxCorregido = 0) {
  $s = New-Object System.Text.StringBuilder
  [void]$s.AppendLine("FALTA O REVISAR (" + $script:RFalta.Count + ")")
  if ($script:RFalta.Count -eq 0) { [void]$s.AppendLine("  Nada: todo quedo en orden.") }
  foreach ($x in $script:RFalta) { [void]$s.AppendLine("  - " + $x) }
  [void]$s.AppendLine("")
  [void]$s.AppendLine("CORREGIDO O INSTALADO (" + $script:RHecho.Count + ")")
  $i = 0
  foreach ($x in $script:RHecho) { $i++; if (($maxCorregido -gt 0) -and ($i -gt $maxCorregido)) { [void]$s.AppendLine("  ... y " + ($script:RHecho.Count - $maxCorregido) + " mas (vea el archivo de resumen)"); break }; [void]$s.AppendLine("  - " + $x) }
  [void]$s.AppendLine("")
  [void]$s.AppendLine("YA ESTABA BIEN (" + $script:RBien.Count + ")")
  if ($maxCorregido -eq 0) { foreach ($x in $script:RBien) { [void]$s.AppendLine("  - " + $x) } }
  return $s.ToString()
}
