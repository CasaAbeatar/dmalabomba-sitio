# Ajustes de la pantalla del cliente. Cambie solo lo que haga falta.
$UrlCaja        = "https://dmalabomba.com/facturacion/"
$UrlCliente     = "https://dmalabomba.com/facturacion/cliente/"
$Sitio          = "https://dmalabomba.com"         # origen al que se le concede el manejo de ventanas, ventanas emergentes y pantalla completa
$Carpeta        = "C:\PantallaCliente"
$CarpetaPublicidad = Join-Path ([Environment]::GetFolderPath("Desktop")) "Publicidad"   # carpeta Publicidad en el Escritorio de la PC: adentro van las subcarpetas que se quieran (redes sociales, videos, productos, promociones...). Una subcarpeta llamada Soda se ve solo en Soda; Pollos o Papea, solo en Pollos; las demas, en las dos
$CarpetaPublicidadVieja = "C:\PantallaCliente\publicidad"   # ubicacion anterior: si existe, se copia a la carpeta nueva
$PuertoPublicidad  = 8766                            # puerto del servidor local de publicidad (solo esta computadora). Si se cambia, tambien hay que cambiarlo en la pagina
$Datos          = "C:\PantallaCliente\datos"   # lo unico que la cuenta de la caja puede escribir (perfil, registros, identidad, cola); el resto de la carpeta es solo lectura para ella
$Perfil         = "C:\PantallaCliente\datos\perfil"   # el MISMO perfil para las dos ventanas (perfil normal, no InPrivate)
# --- Equipo estandar (Soda y Pollos): una sola cuenta de Windows, la PC es solo para facturar. El kit NUNCA crea cuentas.
# Roles FIJOS de las pantallas. El kit los reaplica al instalar, al abrir sesion y al reparar.
# Equipo: AMD Athlon 3000G + Skitphrati tactil 18.5" + LG 24MK430H-B (este kit es solo para ese equipo; el del HP + AON esta en su propia carpeta)
$NombreEquipo    = "Estandar: Athlon 3000G + Skitphrati tactil + LG"
$NombreCaja      = "Skitphrati tactil 18.5 pulgadas"
$NombreCliente   = "LG 24MK430H-B (24 pulgadas, sin tacto)"
$PantallaCaja    = @{ Ancho = 1366; Alto = 768  }   # Pantalla 1: Skitphrati (cajera). Siempre PRINCIPAL, en la posicion 0,0.
$PantallaCliente = @{ Ancho = 1920; Alto = 1080 }   # Pantalla 2: LG (cliente). Siempre a la DERECHA de la caja, extendida.
$FijarPantallas  = $true                            # $true = el kit fija principal, posicion y resolucion cada vez. $false = solo lee
$CajaEnPantalla  = "principal"                      # la caja va en la principal (la tactil); no cambiar
# Quien abre la pantalla del cliente:
#   $false = la caja la abre sola (Window Management API, ver pantalla_ventana.js). El kit solo la acomoda y, si pasan
#            $EsperaRespaldoSeg segundos sin ventana del cliente, la abre el mismo (respaldo).
#   $true  = la abre el kit y la caja se abre con ?kit=1 para no abrir otra.
$AbrirClienteDesdeKit = $false
$EsperaRespaldoSeg    = 60
$CajaPantallaCompleta   = $false  # $false = la caja va MAXIMIZADA (se ve la barra de titulo con la X y la barra de tareas de Windows, para poder usar la computadora); $true = pantalla completa (F11). La pantalla del cliente siempre va en pantalla completa.
$ReabrirCajaSiSeCierra  = $true   # $true = si Chrome se cae por completo, el kit reabre la caja solo a los pocos segundos (para mantenimiento se usa "Salir", que detiene el kit); $false = no la reabre
$TituloCaja     = "Facturaci"                      # parte del titulo de la ventana de la caja (sin tilde para evitar problemas de codificacion)
$TituloCliente  = "Pantalla del cliente"           # parte del titulo de la ventana del cliente
$HoraReinicioDiario   = "04:30"                    # el navegador se cierra y abre solo a esa hora (vacio = no)
$HorarioDesde   = 6                                # horas de atencion: Windows no reinicia dentro de este horario
$HorarioHasta   = 22                               # (maximo 18 horas entre desde y hasta)
$SegundosVigilar = 15                              # cada cuanto se revisa; mas alto = menos CPU (equipo modesto: Athlon 3000G)

# --- v2 (16 nov): identidad de la computadora y latido hacia el panel ---
# La identidad (Soda o Pollos) se guarda UNA vez en esta PC y no depende de la empresa que se use en el facturador.
$VersionKit       = "3.4 19nov"
# v3.4: sitios que NO cuentan como salir del sistema (el kit solo registra dominios visitados; ver 19 navegacion.ps1). Emil puede agregar o quitar.
$SitiosPermitidos = @("dmalabomba.com", "polloslabomba.com", "sodalabomba.com", "supabase.co", "localhost", "127.0.0.1", "hacienda.go.cr", "remotedesktop.google.com", "google.com")
$SupabaseUrl      = "https://dwlbcbtwdungyrykgahm.supabase.co"
$SupabaseClave    = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR3bGJjYnR3ZHVuZ3lyeWtnYWhtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIxNjQ5NjcsImV4cCI6MjEwNzc0MDk2N30.GTLrTIQQ9ZIcKMpcxRRBkC6n1dZpCUAwmHb4ZeC4u-w"   # clave PUBLICA (anon): solo permite llamar a las funciones abiertas; no da acceso a datos
$ArchivoIdentidad = "C:\PantallaCliente\datos\equipo.json"   # estacion + clave propia de esta PC (solo permite enviar latidos de esta caja)
$SegundosLatido   = 60                                        # cada cuanto se avisa al panel
$CajaCerradaAvisaDesde = 6                                    # solo se avisa caja cerrada dentro de este horario (hora de Costa Rica)
$CajaCerradaAvisaHasta = 21
$CajaCerradaMinutos    = 3                                    # la ventana de la caja debe llevar estos minutos cerrada para avisar

# --- v3 (18 nov): reparador, enlace y plan B ---
$IconosEscritorio       = @("Facturador", "Reparar", "Control remoto")   # los UNICOS iconos del kit en el Escritorio (comun a todos los usuarios)
$ArchivoPendienteEnlace = "C:\PantallaCliente\datos\pendiente enlace.txt" # existe mientras la PC siga sin identidad valida (el usuario eligio enlazar despues)
$MinutosAvisoPendiente  = 30                                  # cada cuantos minutos se vuelve a mostrar el recordatorio mientras falte el enlace
$CarpetaKitAnterior     = "C:\PantallaCliente\datos\kit anterior"   # aqui se APARTAN (no se borran) los archivos de versiones viejas del kit
$ReabrirTrasCierreDeliberado = $false                         # $false = si la cajera cierra la ventana 1, se cierra la 2 y NO se reabre sola: se vuelve con el icono Facturador. $true = se reabre sola a los pocos segundos

# --- v3.2c: candado de "una sola copia" abierto a todos los usuarios y con constancia de lo que pasa ---
function Crear-Mutex($nombre) {
  $r = @{ Mutex = $null; Tengo = $false; Motivo = "" }
  try {
    $seg = New-Object System.Security.AccessControl.MutexSecurity
    $todos = New-Object System.Security.Principal.SecurityIdentifier([System.Security.Principal.WellKnownSidType]::WorldSid, $null)
    $seg.AddAccessRule((New-Object System.Security.AccessControl.MutexAccessRule($todos, [System.Security.AccessControl.MutexRights]::FullControl, [System.Security.AccessControl.AccessControlType]::Allow)))
    $creado = $false
    $m = New-Object System.Threading.Mutex($false, $nombre, [ref]$creado, $seg)
    $r.Mutex = $m
    try { $r.Tengo = $m.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $r.Tengo = $true; $r.Motivo = "se retoma (la copia anterior se cerro a la fuerza)" }
    if (-not $r.Tengo) { $r.Motivo = "otra copia ya esta corriendo" }
  } catch [System.UnauthorizedAccessException] {
    $r.Tengo = $false; $r.Motivo = "el candado es de una copia con otros privilegios (UnauthorizedAccess)"
  } catch {
    $r.Tengo = $true; $r.Motivo = "no se pudo crear el candado (" + $_.Exception.GetType().Name + ": " + $_.Exception.Message + "); se sigue sin candado"
  }
  return $r
}
