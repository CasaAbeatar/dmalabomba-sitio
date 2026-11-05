# Ajustes de la pantalla del cliente. Cambie solo lo que haga falta.
$UrlCaja        = "https://dmalabomba.com/facturacion/"
$UrlCliente     = "https://dmalabomba.com/facturacion/cliente/"
$Sitio          = "https://dmalabomba.com"         # origen al que se le concede el manejo de ventanas, ventanas emergentes y pantalla completa
$Carpeta        = "C:\PantallaCliente"
$Perfil         = "C:\PantallaCliente\perfil"      # el MISMO perfil para las dos ventanas (perfil normal, no InPrivate)
$UsuarioCaja    = ""                               # cuenta de Windows de la caja, por ejemplo "Caja". Vacio = cualquier cuenta que inicie sesion
$CajaEnPantalla = "principal"                      # "principal" o "otra": en que pantalla va la caja (el AON). Recomendado: el AON como pantalla principal
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
$SegundosVigilar = 15                              # cada cuanto se revisa; mas alto = menos CPU (la HP tiene un Celeron)
