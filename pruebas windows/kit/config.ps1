# Ajustes de la pantalla del cliente. Cambie solo lo que haga falta.
$UrlCaja        = "https://dmalabomba.com/facturacion/"
$UrlCliente     = "https://dmalabomba.com/facturacion/cliente/"
$Carpeta        = "C:\PantallaCliente"
$Perfil         = "C:\PantallaCliente\perfil"      # el MISMO perfil para las dos ventanas
$CajaEnPantalla = "principal"                      # "principal" o "otra": en que pantalla va la caja (el AON)
$AbrirClienteDesdeKit = $true                      # ponga $false si la caja ya abre sola la pantalla del cliente
$HoraReinicioDiario   = "04:30"                    # el navegador se cierra y abre solo a esa hora (vacio = no)
$HorarioDesde   = 6                                # horas de atencion: Windows no reinicia dentro de este horario
$HorarioHasta   = 22                               # (maximo 18 horas entre desde y hasta)
$SegundosVigilar = 10
