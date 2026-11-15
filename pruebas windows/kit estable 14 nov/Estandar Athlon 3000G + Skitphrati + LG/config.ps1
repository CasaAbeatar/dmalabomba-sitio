# Ajustes de la pantalla del cliente. Cambie solo lo que haga falta.
$UrlCaja        = "https://dmalabomba.com/facturacion/"
$UrlCliente     = "https://dmalabomba.com/facturacion/cliente/"
$Sitio          = "https://dmalabomba.com"         # origen al que se le concede el manejo de ventanas, ventanas emergentes y pantalla completa
$Carpeta        = "C:\PantallaCliente"
$CarpetaPublicidad = Join-Path ([Environment]::GetFolderPath("Desktop")) "Publicidad"   # carpeta «Publicidad» en el Escritorio de la PC: adentro van las subcarpetas que se quieran (redes sociales, videos, productos, promociones...). Una subcarpeta llamada Soda se ve solo en Soda; Pollos o Papea, solo en Pollos; las demas, en las dos
$CarpetaPublicidadVieja = "C:\PantallaCliente\publicidad"   # ubicacion anterior: si existe, se copia a la carpeta nueva
$PuertoPublicidad  = 8766                            # puerto del servidor local de publicidad (solo esta computadora). Si se cambia, tambien hay que cambiarlo en la pagina
$Perfil         = "C:\PantallaCliente\perfil"      # el MISMO perfil para las dos ventanas (perfil normal, no InPrivate)
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
$ReabrirCajaSiSeCierra  = $false  # $false = si se cierra la caja con la X, el kit NO la vuelve a abrir y termina (para volver: acceso "Abrir caja y pantalla del cliente"); $true = la reabre sola a los pocos segundos
$TituloCaja     = "Facturaci"                      # parte del titulo de la ventana de la caja (sin tilde para evitar problemas de codificacion)
$TituloCliente  = "Pantalla del cliente"           # parte del titulo de la ventana del cliente
$HoraReinicioDiario   = "04:30"                    # el navegador se cierra y abre solo a esa hora (vacio = no)
$HorarioDesde   = 6                                # horas de atencion: Windows no reinicia dentro de este horario
$HorarioHasta   = 22                               # (maximo 18 horas entre desde y hasta)
$SegundosVigilar = 15                              # cada cuanto se revisa; mas alto = menos CPU (equipo modesto: Athlon 3000G)
