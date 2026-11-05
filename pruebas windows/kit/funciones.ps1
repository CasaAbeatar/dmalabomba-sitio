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
  [DllImport("user32.dll")] public static extern long SetDisplayConfig(uint a, IntPtr b, uint c, IntPtr d, uint f);
  public static string Titulo(IntPtr h) { var t = new StringBuilder(512); GetWindowText(h, t, 512); return t.ToString(); }
  // Pantalla completa de Chrome: la ventana ocupa exactamente el monitor y no tiene barra de titulo (Chrome le quita WS_CAPTION).
  public static bool EsCompleta(IntPtr h, int x, int y, int w, int hh) {
    RECT r; if (!GetWindowRect(h, out r)) return false;
    bool tam = Math.Abs(r.Left - x) <= 2 && Math.Abs(r.Top - y) <= 2 && Math.Abs((r.Right - r.Left) - w) <= 2 && Math.Abs((r.Bottom - r.Top) - hh) <= 2;
    bool sinTitulo = (GetWindowLong(h, -16) & 0xC00000) == 0;
    return tam && sinTitulo;
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
  # SDC_TOPOLOGY_EXTEND (0x4) + SDC_APPLY (0x80). Funciona igual en Windows 10 y 11.
  [void][W32]::SetDisplayConfig(0, [IntPtr]::Zero, 0, [IntPtr]::Zero, 0x84)
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
function Elegir-Pantallas($caja) {
  $todas = [System.Windows.Forms.Screen]::AllScreens
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
function Abrir-Ventana($exe, $url, $perfil, $pantalla) {
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
  if ($h) { [void](Poner-En-Pantalla $h $pantalla) }
  return $h
}
function Afinar-Ventanas($pantallas, $perfil, $procesos) {
  # Cada ventana nuestra (por el titulo) va a su monitor en pantalla completa. Otras ventanas del navegador no se tocan.
  foreach ($h in (Ventanas-Nuestras $perfil $procesos)) {
    $t = [W32]::Titulo($h)
    if ($pantallas.Cliente -and $t -like "*$TituloCliente*") { [void](Poner-En-Pantalla $h $pantallas.Cliente) }
    elseif ($t -like "*$TituloCaja*") { [void](Poner-En-Pantalla $h $pantallas.Caja) }
  }
}
function Afinar-Usuario {
  # Ajustes por usuario (HKCU) para que un equipo modesto (Celeron) no gaste en adornos. Se aplican al iniciar sesion, son seguros de repetir.
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
