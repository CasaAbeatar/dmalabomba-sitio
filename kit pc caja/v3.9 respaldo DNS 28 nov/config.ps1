# Ajustes de la pantalla del cliente. Cambie solo lo que haga falta.
$UrlCaja        = "https://facturacion.dmalabomba.com/"          # v3.6 (21 nov): el facturador vive en el subdominio facturacion.dmalabomba.com
$UrlCliente     = "https://facturacion.dmalabomba.com/cliente/"
# Origenes (esquema + dominio, sin ruta) a los que se les concede el manejo de ventanas, ventanas emergentes, pantalla completa y la publicidad local.
# Durante la transicion van los dos: el subdominio nuevo y www (la direccion anterior de la caja). Cuando todas las cajas esten en el subdominio se puede quitar www.
$Sitios         = @("https://facturacion.dmalabomba.com", "https://www.dmalabomba.com")
$Sitio          = $Sitios[0]                       # compatibilidad: el primero de la lista
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
$VersionKit       = "3.9 respaldo DNS 28nov"
# v3.4: sitios que NO cuentan como salir del sistema (el kit solo registra dominios visitados; ver 19 navegacion.ps1). Emil puede agregar o quitar.
$SitiosPermitidos = @("dmalabomba.com", "polloslabomba.com", "sodalabomba.com", "supabase.co", "localhost", "127.0.0.1", "hacienda.go.cr", "remotedesktop.google.com", "google.com")
$SupabaseUrl      = "https://dwlbcbtwdungyrykgahm.supabase.co"
$SupabaseClave    = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR3bGJjYnR3ZHVuZ3lyeWtnYWhtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIxNjQ5NjcsImV4cCI6MjEwNzc0MDk2N30.GTLrTIQQ9ZIcKMpcxRRBkC6n1dZpCUAwmHb4ZeC4u-w"   # clave PUBLICA (anon): solo permite llamar a las funciones abiertas; no da acceso a datos
$ArchivoIdentidad = "C:\PantallaCliente\datos\equipo.json"   # estacion + clave propia de esta PC (solo permite enviar latidos de esta caja)
$SegundosLatido   = 60                                        # cada cuanto se avisa al panel
$CajaCerradaAvisaDesde = 6                                    # solo se avisa caja cerrada dentro de este horario (hora de Costa Rica)
$CajaCerradaAvisaHasta = 21
$CajaCerradaMinutos    = 3                                    # la ventana de la caja debe llevar estos minutos cerrada para avisar

# --- v3.8 (27 nov): contingencia si el facturador no es alcanzable (dominio o DNS caidos). Ver "funciones contingencia.ps1" ---
$ContingenciaFacturador = $true     # $false = el kit abre siempre el facturador sin sondear (comportamiento de la v3.7)
$MarcaFacturador        = "Facturaci"   # texto que debe tener el <title> de la pagina del facturador para darla por buena (si fuera otra pagina, p. ej. de dominio estacionado, cuenta como caida)
$SondeoFacturadorMin    = 5          # cada cuantos minutos se comprueba el facturador mientras todo va bien (cada 10 s si esta caido)

# --- v3.9 (28 nov): respaldo ante fallas del DNS de la red. Ver "funciones dns.ps1" y "funciones contingencia.ps1" ---
# Caso real del 28 nov: el DNS de la red de la tienda contesto NXDOMAIN para facturacion.dmalabomba.com (con el SOA de una zona vieja) y los DNS publicos si lo resolvian.
$RutaPorIp              = $true      # $true = si el DNS de la red falla, el navegador de la caja se abre con facturacion.dmalabomba.com FIJADO a una IP buena (la da un DNS publico por HTTPS, o la ultima que funciono). MISMO origen: misma sesion y datos. No necesita administrador. $false = no se usa
$AlternaFacturador      = $true      # ultimo recurso antes de la pantalla de contingencia: abrir la direccion alterna (OTRO origen: la cajera debe ingresar de nuevo). $false = no se usa
$UrlCajaAlterna         = "https://www.dmalabomba.com/facturacion/"
$UrlClienteAlterna      = "https://www.dmalabomba.com/facturacion/cliente/"
$ServidoresDoh          = @("https://1.1.1.1/dns-query", "https://8.8.8.8/resolve", "https://cloudflare-dns.com/dns-query", "https://dns.google/resolve")   # DNS por HTTPS solo para diagnosticar y para saber a que IP conectar (los dos primeros van por IP: no dependen del DNS de la red)
$DnsPublicosUdp         = @("1.1.1.1", "8.8.8.8")   # respaldo del diagnostico si el puerto 443 hacia los servidores anteriores estuviera cerrado
# DNS publicos fijos en el adaptador de red activo: APAGADO por defecto y SOLO lo decide Emil. Necesita administrador. Si se activa, REPARAR (corrido como administrador) los fija cuando el DNS de la red falla y los publicos no.
# Se puede fijar o quitar a mano con FIJAR DNS PUBLICO.bat y RESTAURAR DNS.bat (22 dns publico.ps1). Reversa: RESTAURAR DNS.bat devuelve el DNS como estaba (DHCP o los servidores anteriores, guardados en datos\dns respaldo.json).
$DnsPublicoRespaldo     = $false
$DnsPublicoLista        = @("1.1.1.1", "8.8.8.8")

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
