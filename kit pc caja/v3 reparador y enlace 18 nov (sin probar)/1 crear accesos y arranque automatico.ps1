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
if ($PSScriptRoot -ne $Carpeta) {
  Get-ChildItem -Path $PSScriptRoot -File | Where-Object { $_.Extension -in ".ps1", ".bat", ".exe" } |
    ForEach-Object { Copy-Item $_.FullName -Destination $Carpeta -Force }
}
# La carpeta la crea el administrador: se le da permiso de modificar a todos los usuarios para que la cuenta de la PC pueda escribir el perfil y el registro.
# Seguridad: la cuenta de la caja solo LEE el kit (para que nadie con acceso a la caja cambie los scripts que corren con permisos altos) y solo ESCRIBE en la subcarpeta datos.
if (Es-Admin) {
  & icacls.exe $Carpeta /inheritance:r /grant "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" "*S-1-5-32-545:(OI)(CI)RX" /T /C | Out-Null
  & icacls.exe $Datos /grant "*S-1-5-32-545:(OI)(CI)M" /T /C | Out-Null
}
$ws = New-Object -ComObject WScript.Shell
function Hacer-Acceso($ruta, $archivo, $texto) {
  $a = $ws.CreateShortcut($ruta)
  $a.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
  $a.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Carpeta\$archivo`""
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
