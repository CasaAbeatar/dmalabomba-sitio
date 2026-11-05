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
Install-Module PSScriptAnalyzer -Force -Scope CurrentUser -ErrorAction SilentlyContinue
if (Get-Command Invoke-ScriptAnalyzer -ErrorAction SilentlyContinue) {
  $r.Add('--- PSScriptAnalyzer (errores y advertencias) ---')
  Invoke-ScriptAnalyzer -Path (Join-Path $PWD 'kit') -Severity Error,Warning -ExcludeRule PSAvoidUsingWriteHost,PSUseApprovedVerbs,PSAvoidUsingPlainTextForPassword |
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
