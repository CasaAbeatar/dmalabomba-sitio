# Revisa los scripts del kit en un Windows real: sintaxis, analizador y datos del equipo.
$ErrorActionPreference = 'Continue'
$out = Join-Path $PWD 'resultados'
New-Item -ItemType Directory -Force $out | Out-Null
$r = New-Object System.Collections.Generic.List[string]
$malos = 0
foreach ($f in Get-ChildItem (Join-Path $PWD 'kit') -Filter *.ps1) {
  $err = $null; $tok = $null
  [void][System.Management.Automation.Language.Parser]::ParseFile($f.FullName, [ref]$tok, [ref]$err)
  if ($err.Count -gt 0) { $malos++; $r.Add("FALLA sintaxis: $($f.Name)"); $err | ForEach-Object { $r.Add("   linea $($_.Extent.StartLineNumber): $($_.Message)") } }
  else { $r.Add("OK sintaxis: $($f.Name)") }
}
# Codificacion: los .ps1 con BOM UTF-8 y saltos de Windows; los .bat en ASCII con saltos de Windows
foreach ($f in Get-ChildItem (Join-Path $PWD 'kit') -File) {
  $b = [IO.File]::ReadAllBytes($f.FullName)
  if ($f.Extension -eq '.ps1') {
    if (-not ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF)) { $malos++; $r.Add("FALLA codificacion (falta BOM UTF-8): $($f.Name)") }
  } elseif ($f.Extension -eq '.bat') {
    if ($b | Where-Object { $_ -gt 127 }) { $malos++; $r.Add("FALLA codificacion (el .bat debe ser ASCII): $($f.Name)") }
  }
  $texto = [Text.Encoding]::UTF8.GetString($b)
  if ($texto -match "(?<!\r)\n") { $malos++; $r.Add("FALLA saltos de linea (deben ser de Windows, CRLF): $($f.Name)") }
}
Install-Module PSScriptAnalyzer -Force -Scope CurrentUser -ErrorAction SilentlyContinue
if (Get-Command Invoke-ScriptAnalyzer -ErrorAction SilentlyContinue) {
  $r.Add('--- PSScriptAnalyzer (errores y advertencias) ---')
  Invoke-ScriptAnalyzer -Path (Join-Path $PWD 'kit') -Severity Error,Warning -ExcludeRule PSAvoidUsingWriteHost,PSUseApprovedVerbs,PSAvoidUsingPlainTextForPassword,PSReviewUnusedParameter,PSUseDeclaredVarsMoreThanAssignments,PSUseSingularNouns |
    ForEach-Object { $r.Add("$($_.Severity) $($_.ScriptName):$($_.Line) $($_.RuleName) $($_.Message)") }
}
$r.Add('--- Equipo de prueba ---')
$r.Add((Get-CimInstance Win32_OperatingSystem | ForEach-Object { "$($_.Caption) $($_.Version)" }))
$chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$r.Add("Chrome en la ruta que usa el kit: $(Test-Path $chrome)")
if (Test-Path $chrome) { $r.Add("Version de Chrome: $((Get-Item $chrome).VersionInfo.ProductVersion)") }
$r.Add("Pantallas vistas por Windows: $((Get-CimInstance Win32_VideoController | Measure-Object).Count) adaptador(es)")
$r | Set-Content -Encoding UTF8 (Join-Path $out 'informe kit.txt')
$r | ForEach-Object { Write-Host $_ }
if ($malos -gt 0) { exit 1 }
