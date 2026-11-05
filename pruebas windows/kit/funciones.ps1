# Funciones comunes. No se ejecuta solo.
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class W32 {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int w, int hh, uint f);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern long SetDisplayConfig(uint a, IntPtr b, uint c, IntPtr d, uint f);
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
[void][W32]::SetProcessDPIAware()   # coordenadas en pixeles reales

function Es-Admin {
  $p = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}
function Pedir-Admin($ruta) {
  if (-not (Es-Admin)) {
    Start-Process powershell.exe -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$ruta`""
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
  # Evita el aviso "Chrome no se cerro correctamente / Restaurar paginas".
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
function Abrir-Ventana($exe, $url, $perfil, $pantalla) {
  $b = $pantalla.Bounds
  $args = @("--app=$url", "--user-data-dir=`"$perfil`"",
    "--window-position=$($b.X),$($b.Y)", "--window-size=$($b.Width),$($b.Height)",
    "--no-first-run", "--no-default-browser-check", "--noerrdialogs", "--disable-infobars",
    "--disable-session-crashed-bubble", "--hide-crash-restore-bubble",
    "--disable-features=Translate,TranslateUI", "--autoplay-policy=no-user-gesture-required",
    "--overscroll-history-navigation=0", "--disable-pinch")
  $antes = Ventanas-Nuestras $perfil
  Start-Process -FilePath $exe -ArgumentList $args
  $h = $null
  for ($i = 0; $i -lt 40 -and -not $h; $i++) {
    Start-Sleep -Milliseconds 500
    $h = (Ventanas-Nuestras $perfil) | Where-Object { $antes -notcontains $_ } | Select-Object -First 1
  }
  if ($h) {
    # Respaldo exacto: la ventana se coloca en los pixeles de su pantalla aunque Chrome haya ignorado --window-position.
    [void][W32]::ShowWindow($h, 1)
    [void][W32]::SetWindowPos($h, [IntPtr]::Zero, $b.X, $b.Y, $b.Width, $b.Height, 0x0044)
    Start-Sleep -Milliseconds 400
    [void][W32]::SetForegroundWindow($h)
    [System.Windows.Forms.SendKeys]::SendWait("{F11}")   # pantalla completa en ese monitor
    Start-Sleep -Milliseconds 600
  }
  return $h
}
function Ventanas-Nuestras($perfil) {
  $pids = @(Procesos-Navegador $perfil | ForEach-Object { [uint32]$_.ProcessId })
  if ($pids.Count -eq 0) { return @() }
  return @([W32]::Ventanas("Chrome_WidgetWin_1", [uint32[]]$pids))
}
