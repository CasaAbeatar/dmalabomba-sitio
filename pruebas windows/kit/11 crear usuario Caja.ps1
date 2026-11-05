# Crea una cuenta local estandar para la caja (recomendado: no usar una cuenta personal ni de Microsoft para el inicio automatico).
param([switch]$Silencioso, [string]$Nombre = "Caja")
. "$PSScriptRoot\funciones.ps1"
Pedir-Admin $MyInvocation.MyCommand.Path
if (Get-LocalUser -Name $Nombre -ErrorAction SilentlyContinue) {
  Write-Host "La cuenta '$Nombre' ya existe."
} else {
  $c1 = Read-Host "Clave para la cuenta '$Nombre'" -AsSecureString
  $c2 = Read-Host "Repita la clave" -AsSecureString
  $a = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($c1))
  $b = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($c2))
  if ((-not $a) -or ($a -ne $b)) { Write-Host "Las claves no coinciden o estan vacias. No se creo la cuenta."; Pausa; exit }
  New-LocalUser -Name $Nombre -Password $c1 -FullName "Caja La Bomba" -PasswordNeverExpires -UserMayNotChangePassword | Out-Null
  Add-LocalGroupMember -SID "S-1-5-32-545" -Member $Nombre   # grupo Usuarios (cuenta estandar), sin importar el idioma de Windows
  Write-Host "Cuenta '$Nombre' creada como usuario estandar."
}
Write-Host "Ponga `$UsuarioCaja = `"$Nombre`" en config.ps1, cierre sesion, entre con '$Nombre' una vez y siga con el inicio de sesion automatico."
Pausa
