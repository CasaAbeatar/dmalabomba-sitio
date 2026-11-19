# Copia el kit a C:\PantallaCliente, crea los accesos del escritorio y lo pone en el inicio de Windows.
param([switch]$Silencioso)
. "$PSScriptRoot\config.ps1"
. "$PSScriptRoot\funciones.ps1"
New-Item -ItemType Directory -Force -Path $Carpeta | Out-Null
New-Item -ItemType Directory -Force -Path $Datos | Out-Null
# Migracion desde versiones anteriores: perfil, identidad y registros pasan a la subcarpeta datos.
foreach ($n in @("perfil", "equipo.json", "equipo.json.bak", "eventos pendientes.jsonl", "registro.txt", "latido.txt")) {
  $o = Join-Path $Carpeta $n; $d = Join-Path $Datos $n
  if ((Test-Path -LiteralPath $o) -and -not (Test-Path -LiteralPath $d)) { try { Move-Item -LiteralPath $o -Destination $d -Force } catch { Write-Verbose "no se pudo migrar $n" } }
}
New-Item -ItemType Directory -Force -Path $CarpetaPublicidad | Out-Null
# Si existia la carpeta anterior (C:\PantallaCliente\publicidad), su contenido se copia a la nueva sin borrar nada ni pisar lo que ya haya
if ((Test-Path $CarpetaPublicidadVieja) -and ([IO.Path]::GetFullPath($CarpetaPublicidadVieja) -ne [IO.Path]::GetFullPath($CarpetaPublicidad))) {
  foreach ($d in Get-ChildItem -Path $CarpetaPublicidadVieja -Directory -ErrorAction SilentlyContinue) {
    $dest = Join-Path $CarpetaPublicidad $d.Name
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    Get-ChildItem -Path $d.FullName -File | ForEach-Object { if (-not (Test-Path (Join-Path $dest $_.Name))) { Copy-Item $_.FullName -Destination $dest } }
  }
}
Set-Content -Path "$CarpetaPublicidad\LEEME.txt" -Encoding UTF8 -Value @("PUBLICIDAD DE LA PANTALLA DEL CLIENTE","","Esta carpeta es la que usa la pantalla del cliente. Ponga aqui fotos (jpg, png, webp, gif) y videos (mp4, webm), sueltos o dentro de las subcarpetas que quiera: redes sociales, videos, productos, promociones...","  Una subcarpeta llamada Soda se ve solo en la caja de Soda La Bomba.","  Una subcarpeta llamada Pollos (o Papea) se ve solo en la caja de Pollos La Bomba.","  Todo lo demas se ve en las dos.","Se pasan en orden alfabetico de subcarpeta y de nombre (01 promo.jpg, 02 combo.jpg...). Cada foto dura 10 segundos; el video dura lo que dura.","Lo que agregue o quite se actualiza solo en un minuto. No hace falta reiniciar nada.")
$fallosCopia = @()
if ($PSScriptRoot -ne $Carpeta) {
  # v3.2: una instalacion vieja pudo dejar archivos con permisos cerrados. Como administrador se recuperan los permisos de los archivos sueltos de la raiz (sin tocar el perfil del navegador).
  if (Es-Admin) {
    & takeown.exe /F "$Carpeta\*" 2>&1 | Out-Null
    & icacls.exe "$Carpeta\*" /reset /C 2>&1 | Out-Null
    & attrib.exe -R -S -H "$Carpeta\*.*" 2>&1 | Out-Null
  }
  foreach ($a in @(Get-ChildItem -Path $PSScriptRoot -File | Where-Object { $_.Extension -in ".ps1", ".bat", ".exe" })) {
    $dest = Join-Path $Carpeta $a.Name
    $ok = $false
    try { Copy-Item -LiteralPath $a.FullName -Destination $dest -Force -ErrorAction Stop; $ok = $true } catch { Write-Output ("Copia de " + $a.Name + " fallo: " + $_.Exception.Message) }
    if (-not $ok) {
      # Segundo intento: tomar el archivo, darse control total, y si sigue sin dejar, apartarlo con otro nombre y copiar el nuevo.
      try {
        if (Es-Admin) { & takeown.exe /F $dest 2>&1 | Out-Null; & icacls.exe $dest /grant "*S-1-5-32-544:F" "*S-1-5-18:F" 2>&1 | Out-Null }
        & attrib.exe -R -S -H $dest 2>&1 | Out-Null
        Copy-Item -LiteralPath $a.FullName -Destination $dest -Force -ErrorAction Stop; $ok = $true
      } catch {
        try { Rename-Item -LiteralPath $dest -NewName ($a.Name + ".viejo-" + (Get-Date -Format "yyyyMMddHHmmss")) -Force -ErrorAction Stop; Copy-Item -LiteralPath $a.FullName -Destination $dest -Force -ErrorAction Stop; $ok = $true } catch { Write-Output ("Segundo intento de " + $a.Name + " fallo: " + $_.Exception.Message) }
      }
    }
    if (-not $ok) {
      $fallosCopia += $a.Name
      try { Write-Output ("Permisos de " + $dest + ": " + ((& icacls.exe $dest 2>&1) -join " | ") + "  Atributos: " + (Get-Item -LiteralPath $dest -Force -ErrorAction SilentlyContinue).Attributes) } catch { $null = 1 }
    }
  }
}
# La carpeta la crea el administrador: se le da permiso de modificar a todos los usuarios para que la cuenta de la PC pueda escribir el perfil y el registro.
# Seguridad: la cuenta de la caja solo LEE el kit (para que nadie con acceso a la caja cambie los scripts que corren con permisos altos) y solo ESCRIBE en la subcarpeta datos.
if (Es-Admin) {
  # v3.2c (CAUSA RAIZ del fallo de latido y facturador, probada en Windows real): "/inheritance:r ... /T" con permisos (OI)(CI) dejaba cada ARCHIVO con la lista de permisos VACIA
  # y la cuenta de la caja no podia ni leer los scripts. Ahora los hijos se limpian primero (heredan) y solo la carpeta raiz se protege, SIN /T.
  & icacls.exe $Carpeta /reset /T /C 2>&1 | Out-Null
  & icacls.exe $Carpeta /inheritance:r /grant "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" "*S-1-5-32-545:(OI)(CI)RX" /C 2>&1 | Out-Null
  & icacls.exe $Datos /grant "*S-1-5-32-545:(OI)(CI)M" /C 2>&1 | Out-Null
  # Comprobacion: cada script debe quedar legible para el grupo Usuarios (se mira por SID, sirve en cualquier idioma de Windows).
  $sinAcceso = @()
  foreach ($a2 in @(Get-ChildItem -LiteralPath $Carpeta -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -in ".ps1", ".bat" })) {
    $ok2 = $false
    try { foreach ($r2 in (Get-Acl -LiteralPath $a2.FullName).GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) { if ($r2.IdentityReference.Value -eq "S-1-5-32-545") { $ok2 = $true } } } catch { $null = 1 }
    if (-not $ok2) { $sinAcceso += $a2.Name }
  }
  if ($sinAcceso.Count -gt 0) {
    & icacls.exe "$Carpeta\*.*" /reset /C 2>&1 | Out-Null
    Write-Output ("Se repararon los permisos de " + $sinAcceso.Count + " archivo(s) que habian quedado sin acceso para la cuenta de la caja: " + ($sinAcceso -join ", "))
  }
}
# v3.3: la terminal predeterminada pasa a ser la clasica de Windows (si no, Windows Terminal muestra una ventana por cada script, aunque se pida oculta).
try { Write-Output ("Terminal predeterminada: " + (Arreglar-Terminal-Predeterminada)) } catch { Write-Output ("No se pudo revisar la terminal predeterminada: " + $_.Exception.Message) }
$ws = New-Object -ComObject WScript.Shell
function Hacer-Acceso($ruta, $archivo, $texto) {
  $a = $ws.CreateShortcut($ruta)
  # v3.3: sin ventana de consola, aunque Windows Terminal sea la terminal predeterminada (conhost --headless).
  $c = Comando-Oculto ("-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Carpeta\$archivo`"")
  $a.TargetPath = $c.Exe
  $a.Arguments = $c.Args
  $a.WorkingDirectory = $Carpeta
  $a.WindowStyle = 7
  $a.Description = $texto
  $a.Save()
}
# Inicio de Windows (la PC tiene una sola cuenta; el acceso queda en el inicio comun).
$inicio = [Environment]::GetFolderPath("CommonStartup")
$escr   = [Environment]::GetFolderPath("CommonDesktopDirectory")
# v2: iconos con nombre corto; se quitan los de la version anterior.
foreach ($viejo in @("$inicio\Pantalla del cliente.lnk","$escr\Abrir caja y pantalla del cliente.lnk","$escr\Reparar pantalla del cliente.lnk")) { if (Test-Path $viejo) { Remove-Item $viejo -Force -ErrorAction SilentlyContinue } }
Hacer-Acceso "$inicio\Latido.lnk" "11 latido.ps1" "Avisa al panel que esta computadora esta viva"
Hacer-Acceso "$inicio\Facturador.lnk" "0 abrir caja y pantalla.ps1" "Abre el facturador y la pantalla del cliente"
Hacer-Acceso "$escr\Facturador.lnk" "0 abrir caja y pantalla.ps1" "Abre el facturador y la pantalla del cliente"
Hacer-Acceso "$escr\Reparar.lnk" "6 reparar.ps1" "Cierra y vuelve a abrir las dos ventanas"
Write-Host "Listo. Accesos creados en el escritorio y en el inicio de Windows (para todos los usuarios)."
if ($fallosCopia.Count -gt 0) { throw ("No se pudo copiar: " + ($fallosCopia -join ", ") + " (los demas archivos y los accesos si quedaron)") }
