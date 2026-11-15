# Funciones comunes. No se ejecuta solo.
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
if (-not ([System.Management.Automation.PSTypeName]'W32').Type) {
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class W32 {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int w, int hh, uint f);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)] public struct DEVMODE {
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string dmDeviceName;
    public short dmSpecVersion, dmDriverVersion, dmSize, dmDriverExtra;
    public int dmFields; public int dmPositionX, dmPositionY; public int dmDisplayOrientation, dmDisplayFixedOutput;
    public short dmColor, dmDuplex, dmYResolution, dmTTOption, dmCollate;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string dmFormName;
    public short dmLogPixels; public int dmBitsPerPel, dmPelsWidth, dmPelsHeight, dmDisplayFlags, dmDisplayFrequency;
    public int dmICMMethod, dmICMIntent, dmMediaType, dmDitherType, dmReserved1, dmReserved2, dmPanningWidth, dmPanningHeight;
  }
  [DllImport("user32.dll", CharSet=CharSet.Ansi)] public static extern bool EnumDisplaySettings(string dev, int modo, ref DEVMODE dm);
  [DllImport("user32.dll", CharSet=CharSet.Ansi)] public static extern int ChangeDisplaySettingsEx(string dev, ref DEVMODE dm, IntPtr hwnd, uint flags, IntPtr p);
  [DllImport("user32.dll", CharSet=CharSet.Ansi)] public static extern int ChangeDisplaySettingsEx(string dev, IntPtr dm, IntPtr hwnd, uint flags, IntPtr p);
  [DllImport("user32.dll")] public static extern long SetDisplayConfig(uint a, IntPtr b, uint c, IntPtr d, uint f);
  public static string Titulo(IntPtr h) { var t = new StringBuilder(512); GetWindowText(h, t, 512); return t.ToString(); }
  // Pantalla completa de Chrome: la ventana ocupa exactamente el monitor y no tiene barra de titulo (Chrome le quita WS_CAPTION).
  public static bool EsCompleta(IntPtr h, int x, int y, int w, int hh) {
    RECT r; if (!GetWindowRect(h, out r)) return false;
    bool tam = Math.Abs(r.Left - x) <= 2 && Math.Abs(r.Top - y) <= 2 && Math.Abs((r.Right - r.Left) - w) <= 2 && Math.Abs((r.Bottom - r.Top) - hh) <= 2;
    bool sinTitulo = (GetWindowLong(h, -16) & 0xC00000) == 0;
    return tam && sinTitulo;
  }
  // El centro de la ventana cae dentro del monitor indicado.
  public static bool EstaEn(IntPtr h, int x, int y, int w, int hh) {
    RECT r; if (!GetWindowRect(h, out r)) return false;
    int cx = (r.Left + r.Right) / 2, cy = (r.Top + r.Bottom) / 2;
    return cx >= x && cx < x + w && cy >= y && cy < y + hh;
  }
  public static List<IntPtr> Ventanas(string clase, uint[] pids) {
    var r = new List<IntPtr>();
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      var c = new StringBuilder(256); GetClassName(h, c, 256);
      if (c.ToString() != clase) return true;
      var t = new StringBuilder(512); GetWindowText(h, t, 512);
      if (t.Length == 0) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (Array.IndexOf(pids, pid) < 0) return true;
      r.Add(h); return true;
    }, IntPtr.Zero);
    return r;
  }
}
"@
}
[void][W32]::SetProcessDPIAware()   # coordenadas en pixeles reales
$script:IntentosF11 = @{}           # cuantas veces se pulso F11 en cada ventana (maximo 2: nunca se deja una ventana saltando entre modos)

function Pausa {
  # Los scripts se pueden correr con -Silencioso (lo hace INSTALAR TODO) para que no se detengan a esperar una tecla.
  if (-not $Silencioso) { [void](Read-Host "Presione Entrar para cerrar") }
}
function Es-Admin {
  $p = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}
function Pedir-Admin($ruta) {
  if (-not (Es-Admin)) {
    $extra = ""; if ($Silencioso) { $extra = " -Silencioso" }
    Start-Process powershell.exe -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$ruta`"$extra"
    exit
  }
}
function Extender-Pantallas {
  # SDC_TOPOLOGY_EXTEND (0x4) + SDC_APPLY (0x80). Funciona igual en Windows 10 y 11. Despues se fijan los roles (principal, posicion, resolucion).
  [void][W32]::SetDisplayConfig(0, [IntPtr]::Zero, 0, [IntPtr]::Zero, 0x84)
  Start-Sleep -Milliseconds 800
  try { [void](Fijar-Pantallas) } catch { Write-Verbose "Fijar-Pantallas: $($_.Exception.Message)" }
}
function Buscar-Navegador {
  $c = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
         "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
         "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
         "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
         "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe")
  foreach ($x in $c) { if (Test-Path $x) { return $x } }
  return $null
}
function Procesos-Navegador($perfil) {
  Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine -like "*$perfil*" }
}
function Cerrar-Navegador($perfil) {
  Procesos-Navegador $perfil | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}
function Arreglar-Cierre($perfil) {
  # Evita el aviso "Chrome no se cerro correctamente / Restaurar paginas" y un cerrojo viejo del perfil.
  Remove-Item "$perfil\lockfile" -Force -ErrorAction SilentlyContinue
  foreach ($f in @("$perfil\Default\Preferences", "$perfil\Local State")) {
    if (Test-Path $f) {
      $t = [IO.File]::ReadAllText($f)
      $n = $t -replace '"exit_type"\s*:\s*"Crashed"', '"exit_type":"Normal"' -replace '"exited_cleanly"\s*:\s*false', '"exited_cleanly":true'
      if ($n -ne $t) { [IO.File]::WriteAllText($f, $n) }
    }
  }
}
function Rol-Pantalla($s) {
  # Quien es quien se decide por la resolucion nativa, no por el orden que le de Windows: 1366x768 = caja tactil, 1920x1080 = cliente.
  if (($s.Bounds.Width -eq $PantallaCaja.Ancho) -and ($s.Bounds.Height -eq $PantallaCaja.Alto)) { return "caja" }
  if (($s.Bounds.Width -eq $PantallaCliente.Ancho) -and ($s.Bounds.Height -eq $PantallaCliente.Alto)) { return "cliente" }
  return "otra"
}
function Fijar-Pantallas {
  # Ancla los roles: la tactil es la PRINCIPAL en 0,0 (Windows manda el toque a la pantalla principal) y la LG va extendida a su derecha.
  # Los cambios se guardan en el registro de Windows (sobreviven al reinicio); el kit los reaplica solo si algo se movio.
  # Devuelve $true si ya estaba bien o quedo bien.
  if (-not $FijarPantallas) { return $true }
  $todas = [System.Windows.Forms.Screen]::AllScreens
  if ($todas.Count -lt 2) { return $false }
  $caja = $todas | Where-Object { (Rol-Pantalla $_) -eq "caja" } | Select-Object -First 1
  $cli  = $todas | Where-Object { (Rol-Pantalla $_) -eq "cliente" } | Select-Object -First 1
  if ((-not $caja) -or (-not $cli)) { return $false }   # no son las pantallas estandar (otra resolucion): no se toca nada
  $okCaja = $caja.Primary -and ($caja.Bounds.X -eq 0) -and ($caja.Bounds.Y -eq 0)
  $okCli  = ($cli.Bounds.X -eq $caja.Bounds.Width) -and ($cli.Bounds.Y -eq 0)
  if ($okCaja -and $okCli) { return $true }
  function Modo($dev) { $m = New-Object W32+DEVMODE; $m.dmSize = [int16][Runtime.InteropServices.Marshal]::SizeOf([type]'W32+DEVMODE'); [void][W32]::EnumDisplaySettings($dev, -1, [ref]$m); return $m }
  $mc = Modo $caja.DeviceName; $ml = Modo $cli.DeviceName
  # DM_POSITION 0x20 | DM_PELSWIDTH 0x80000 | DM_PELSHEIGHT 0x100000
  $mc.dmFields = 0x20 -bor 0x80000 -bor 0x100000; $mc.dmPositionX = 0; $mc.dmPositionY = 0
  $mc.dmPelsWidth = $PantallaCaja.Ancho; $mc.dmPelsHeight = $PantallaCaja.Alto
  $ml.dmFields = 0x20 -bor 0x80000 -bor 0x100000; $ml.dmPositionX = $PantallaCaja.Ancho; $ml.dmPositionY = 0
  $ml.dmPelsWidth = $PantallaCliente.Ancho; $ml.dmPelsHeight = $PantallaCliente.Alto
  # CDS_UPDATEREGISTRY 1 | CDS_NORESET 0x10000000 | CDS_SET_PRIMARY 0x10
  $r1 = [W32]::ChangeDisplaySettingsEx($caja.DeviceName, [ref]$mc, [IntPtr]::Zero, (1 -bor 0x10 -bor 0x10000000), [IntPtr]::Zero)
  $r2 = [W32]::ChangeDisplaySettingsEx($cli.DeviceName,  [ref]$ml, [IntPtr]::Zero, (1 -bor 0x10000000), [IntPtr]::Zero)
  $r3 = [W32]::ChangeDisplaySettingsEx($null, [IntPtr]::Zero, [IntPtr]::Zero, 0, [IntPtr]::Zero)   # aplica todo de una vez, sin aviso de "conservar cambios"
  Start-Sleep -Seconds 2
  if (Get-Command Anotar -ErrorAction SilentlyContinue) { Anotar "Fijar pantallas: codigos de Windows $r1 / $r2 / $r3 (0 = bien)" }
  $n = [System.Windows.Forms.Screen]::AllScreens
  $c2 = $n | Where-Object { (Rol-Pantalla $_) -eq "caja" } | Select-Object -First 1
  return [bool]($c2 -and $c2.Primary)
}
function Elegir-Pantallas($caja) {
  $todas = [System.Windows.Forms.Screen]::AllScreens
  # Con las pantallas estandar, los roles mandan sobre el orden de Windows.
  $rc = $todas | Where-Object { (Rol-Pantalla $_) -eq "caja" } | Select-Object -First 1
  $rl = $todas | Where-Object { (Rol-Pantalla $_) -eq "cliente" } | Select-Object -First 1
  if ($rc -and $rl) { return @{ Caja = $rc; Cliente = $rl; Cuantas = $todas.Count } }
  $prin = $todas | Where-Object { $_.Primary } | Select-Object -First 1
  $otra = $todas | Where-Object { -not $_.Primary } | Select-Object -First 1
  if ($caja -eq "otra" -and $otra) { return @{ Caja = $otra; Cliente = $prin; Cuantas = $todas.Count } }
  return @{ Caja = $prin; Cliente = $otra; Cuantas = $todas.Count }
}
function Ventanas-Nuestras($perfil, $procesos) {
  if (-not $procesos) { $procesos = @(Procesos-Navegador $perfil) }
  $pids = @($procesos | ForEach-Object { [uint32]$_.ProcessId })
  if ($pids.Count -eq 0) { return @() }
  return @([W32]::Ventanas("Chrome_WidgetWin_1", [uint32[]]$pids))
}
function Traer-Al-Frente($h) {
  # Windows no deja pasar una ventana al frente a un programa en segundo plano; pulsar Alt un instante lo permite.
  [W32]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
  [void][W32]::SetForegroundWindow($h)
  [W32]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 150
  return ([W32]::GetForegroundWindow() -eq $h)
}
function Poner-En-Pantalla($h, $pantalla) {
  # Deja la ventana en los pixeles exactos de su monitor y en pantalla completa. Devuelve $true si quedo asi.
  $b = $pantalla.Bounds
  if ([W32]::EsCompleta($h, $b.X, $b.Y, $b.Width, $b.Height)) { return $true }
  [void][W32]::ShowWindow($h, 9)
  [void][W32]::SetWindowPos($h, [IntPtr]::Zero, $b.X, $b.Y, $b.Width, $b.Height, 0x0044)
  Start-Sleep -Milliseconds 300
  if ([W32]::EsCompleta($h, $b.X, $b.Y, $b.Width, $b.Height)) { return $true }
  $k = [string]$h
  $n = 0; if ($script:IntentosF11.ContainsKey($k)) { $n = $script:IntentosF11[$k] }
  if ($n -ge 2) { return $false }
  $script:IntentosF11[$k] = $n + 1
  if (Traer-Al-Frente $h) {
    [System.Windows.Forms.SendKeys]::SendWait("{F11}")   # pantalla completa en ese monitor
    Start-Sleep -Milliseconds 600
  }
  return [W32]::EsCompleta($h, $b.X, $b.Y, $b.Width, $b.Height)
}
function Poner-Maximizada($h, $pantalla, $forzar) {
  # La caja va maximizada y NO en pantalla completa: se ve la barra de titulo con la X y la barra de tareas de Windows.
  # $forzar = al abrir; si no, solo se corrige cuando la ventana esta fuera de su monitor.
  if ([W32]::IsIconic($h)) { return $true }   # la cajera la minimizo para usar Windows: no se toca
  $b = $pantalla.Bounds
  if ([W32]::EsCompleta($h, $b.X, $b.Y, $b.Width, $b.Height)) {
    # venia en pantalla completa (F11): se sale de ella, maximo 2 intentos
    $k = "max" + [string]$h
    $n = 0; if ($script:IntentosF11.ContainsKey($k)) { $n = $script:IntentosF11[$k] }
    if ($n -lt 2) {
      $script:IntentosF11[$k] = $n + 1
      if (Traer-Al-Frente $h) { [System.Windows.Forms.SendKeys]::SendWait("{F11}"); Start-Sleep -Milliseconds 600 }
    }
  }
  if ((-not $forzar) -and [W32]::EstaEn($h, $b.X, $b.Y, $b.Width, $b.Height)) { return $true }
  [void][W32]::ShowWindow($h, 9)
  [void][W32]::SetWindowPos($h, [IntPtr]::Zero, ($b.X + 40), ($b.Y + 40), [Math]::Max(400, ($b.Width - 80)), [Math]::Max(300, ($b.Height - 80)), 0x0044)
  Start-Sleep -Milliseconds 200
  [void][W32]::ShowWindow($h, 3)   # maximizada en el monitor donde quedo
  return $true
}
function Abrir-Ventana($exe, $url, $perfil, $pantalla, $completa = $true) {
  $b = $pantalla.Bounds
  $argumentos = @("--app=$url", "--user-data-dir=`"$perfil`"",
    "--window-position=$($b.X),$($b.Y)", "--window-size=$($b.Width),$($b.Height)",
    "--no-first-run", "--no-default-browser-check", "--noerrdialogs", "--disable-infobars",
    "--disable-session-crashed-bubble", "--hide-crash-restore-bubble",
    "--disable-features=Translate,TranslateUI", "--autoplay-policy=no-user-gesture-required",
    "--overscroll-history-navigation=0", "--disable-pinch")
  $antes = Ventanas-Nuestras $perfil
  Start-Process -FilePath $exe -ArgumentList $argumentos
  $h = $null
  for ($i = 0; $i -lt 40 -and -not $h; $i++) {
    Start-Sleep -Milliseconds 500
    $h = (Ventanas-Nuestras $perfil) | Where-Object { $antes -notcontains $_ } | Select-Object -First 1
  }
  if ($h) {
    if ($completa) { [void](Poner-En-Pantalla $h $pantalla) } else { [void](Poner-Maximizada $h $pantalla $true) }
  }
  return $h
}
function Es-Titulo-Cliente($t) {
  # La ventana del cliente: por su titulo, o por la direccion que muestra Chrome mientras la pagina todavia carga (sin eso se confundia con la caja).
  return (($t -like "*$TituloCliente*") -or ($t -like "*facturacion/cliente*"))
}
function Afinar-Ventanas($pantallas, $perfil, $procesos) {
  # Cada ventana nuestra (por el titulo) va a su monitor: el cliente en pantalla completa y la caja maximizada (o completa si $CajaPantallaCompleta). Otras ventanas del navegador no se tocan.
  foreach ($h in (Ventanas-Nuestras $perfil $procesos)) {
    $t = [W32]::Titulo($h)
    if ([string]::IsNullOrWhiteSpace($t)) { continue }
    if (Es-Titulo-Cliente $t) {
      if ($pantallas.Cliente) { [void](Poner-En-Pantalla $h $pantallas.Cliente) }
    } else {   # la ventana que no es del cliente es la caja, en el modulo que este (el titulo cambia por modulo)
      if ($CajaPantallaCompleta) { [void](Poner-En-Pantalla $h $pantallas.Caja) } else { [void](Poner-Maximizada $h $pantallas.Caja $false) }
    }
  }
}
function Afinar-Usuario {
  # Ajustes por usuario (HKCU) para que un equipo modesto (Athlon 3000G) no gaste en adornos. Se aplican al iniciar sesion, son seguros de repetir.
  $reg = @(
    @("HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\VisualEffects", "VisualFXSetting", 2),
    @("HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize", "EnableTransparency", 0),
    @("HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced", "TaskbarAnimations", 0),
    @("HKCU:\Software\Microsoft\Windows\CurrentVersion\PushNotifications", "ToastEnabled", 0),
    @("HKCU:\Control Panel\Desktop", "ScreenSaveActive", "0")
  )
  foreach ($r in $reg) {
    try {
      if (-not (Test-Path $r[0])) { New-Item -Path $r[0] -Force | Out-Null }
      $tipo = "DWord"; if ($r[2] -is [string]) { $tipo = "String" }
      Set-ItemProperty -Path $r[0] -Name $r[1] -Value $r[2] -Type $tipo -ErrorAction Stop
    } catch { Write-Verbose "No se pudo ajustar $($r[1])" }
  }
  try { Set-ItemProperty "HKCU:\Control Panel\Desktop\WindowMetrics" -Name MinAnimate -Value "0" -Type String -ErrorAction Stop } catch { Write-Verbose "MinAnimate" }
}
