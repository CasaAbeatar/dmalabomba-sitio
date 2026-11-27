#!/usr/bin/env bash
# Configurar el telefono de la Soda (HONOR) igual que el de Pollos: instala la app 2.12.1 y concede por comando
# todos los permisos y ajustes que Android deja dar por adb. Grupo DMA La Bomba.
#
# Uso normal (Mac, telefono por USB con la depuracion USB aceptada):
#   cd ~/Downloads/platform-tools && bash configurar-telefono-soda.sh
#
# Variables opcionales (casi nunca hacen falta):
#   ADB=/ruta/adb          adb a usar (por defecto ./adb, ~/Downloads/platform-tools/adb o el del PATH)
#   SERIAL=xxxx            serial del telefono si hay mas de uno conectado
#   APK_LOCAL=/ruta.apk    usar este APK en vez de descargarlo (igual se verifica el SHA-256)
#   SIN_TCPIP=1            no dejar listo adb por Wi-Fi (puerto 5555)
#   FORZAR=1               seguir aunque el telefono parezca ser el de Pollos (NO recomendado)
#
# No usa sudo, no desinstala ni borra nada del telefono, no toca otras apps ni datos, no lee ni escribe reglas ni claves.
# Es repetible: se puede correr las veces que haga falta y deja el mismo resultado.
# Reversa: ver el final de este archivo.

set -u

PKG="tech.bogomolov.incomingsmsgateway"
VERSION="2.12.1"
URL="https://pagos.dmalabomba.com/instalar/reenviador-sms-la-bomba-2.12.1.apk"
SHA_ESPERADO="6610c3f92f98569b27b2a06596d2f016143c8471e900c5e790d59f76b8f87109"
ANCLA="$PKG/$PKG.GuardianListenerService"
PANTALLA="$PKG/$PKG.PantallaRemotaService"

HECHO=""
NOPUDO=""
MANUAL=""

linea() { printf '%s\n' "$*"; }
paso() { printf '\n==> %s\n' "$*"; }
ok() { printf '    [hecho] %s\n' "$*"; }
mal() { printf '    [no se pudo] %s\n' "$*"; }
aviso() { printf '    [aviso] %s\n' "$*"; }

# Los comandos de adb nunca leen el teclado ni el guion (por si el guion llega por tuberia).
A() { "$ADB" -s "$SER" "$@" </dev/null 2>&1 | tr -d '\r'; }
SH() { A shell "$@"; }

reg_h() { HECHO="${HECHO}  - $1
"; }
reg_n() { NOPUDO="${NOPUDO}  - $1
"; }
reg_m() { MANUAL="${MANUAL}  - $1
"; }
# resultado SI/NO DESCRIPCION
res() { if [ "$1" = "si" ]; then reg_h "$2"; else reg_n "$2"; fi; }

terminar() {
  printf '\n%s\n' "$*" >&2
  exit 1
}

# ---------------------------------------------------------------------------------------------- adb
if [ -z "${ADB:-}" ]; then
  if [ -x "./adb" ]; then ADB="./adb"
  elif [ -x "$HOME/Downloads/platform-tools/adb" ]; then ADB="$HOME/Downloads/platform-tools/adb"
  elif command -v adb >/dev/null 2>&1; then ADB="$(command -v adb)"
  else terminar "No encuentro adb. Abra la Terminal en la carpeta platform-tools (cd ~/Downloads/platform-tools) y vuelva a pegar el comando."
  fi
fi

paso "Buscando el telefono conectado por USB"
"$ADB" start-server </dev/null >/dev/null 2>&1
LISTA="$("$ADB" devices </dev/null 2>&1 | tr -d '\r' | awk 'NR>1 && NF>=2')"
LISTOS="$(printf '%s\n' "$LISTA" | awk '$2=="device"{print $1}')"
N_LISTOS="$(printf '%s\n' "$LISTOS" | grep -c . )"
if [ "$N_LISTOS" -eq 0 ]; then
  linea "Estado de adb:"; linea "${LISTA:-  (no hay ningun dispositivo)}"
  if printf '%s' "$LISTA" | grep -q unauthorized; then
    terminar "El telefono esta conectado pero falta aceptar el aviso «Permitir depuracion USB» en su pantalla (marque «Permitir siempre»). Acepte y vuelva a pegar el comando."
  fi
  terminar "No veo ningun telefono. Revise el cable USB (que sea de datos), que la depuracion USB este activa y vuelva a pegar el comando."
fi

SER=""
if [ -n "${SERIAL:-}" ]; then
  printf '%s\n' "$LISTOS" | grep -qx "$SERIAL" || terminar "El serial $SERIAL no esta entre los dispositivos listos:
$LISTOS"
  SER="$SERIAL"
elif [ "$N_LISTOS" -eq 1 ]; then
  SER="$LISTOS"
else
  # Varios: si son el mismo telefono (por USB y por Wi-Fi a la vez) se elige el de USB; si son telefonos distintos, se detiene.
  PRIMERO=""; DISTINTOS=""
  for s in $LISTOS; do
    n="$("$ADB" -s "$s" shell getprop ro.serialno </dev/null 2>/dev/null | tr -d '\r')"
    [ -z "$n" ] && n="$s"
    case " $DISTINTOS " in *" $n "*) ;; *) DISTINTOS="$DISTINTOS $n";; esac
    case "$s" in *:*) ;; *) [ -z "$PRIMERO" ] && PRIMERO="$s";; esac
  done
  if [ "$(printf '%s\n' $DISTINTOS | grep -c .)" -eq 1 ] && [ -n "$PRIMERO" ]; then
    SER="$PRIMERO"
  else
    linea "Hay varios dispositivos conectados:"; linea "$LISTOS"
    terminar "Desconecte los que no sean el telefono de la Soda, o vuelva a pegar el comando con SERIAL=<serial> delante."
  fi
fi

MARCA="$(SH getprop ro.product.brand)"
MODELO="$(SH getprop ro.product.model)"
RELEASE="$(SH getprop ro.build.version.release)"
SDK="$(SH getprop ro.build.version.sdk)"
case "$SDK" in ''|*[!0-9]*) terminar "No pude leer la version de Android del telefono ($SER). Respuesta: $SDK";; esac
linea "    Telefono: $MARCA $MODELO, Android $RELEASE (API $SDK), serial $SER"
case "$MODELO" in
  *BLK-L03*|*Fortune*)
    if [ "${FORZAR:-0}" != "1" ]; then
      terminar "Este parece ser el telefono de POLLOS ($MODELO), no el de la Soda. No hago nada. Conecte el HONOR de la Soda."
    fi
    aviso "FORZAR=1: sigo aunque parezca el telefono de Pollos."
    ;;
esac

# ---------------------------------------------------------------------------------------------- 1. APK
paso "Preparando la app $VERSION"
if [ -n "${APK_LOCAL:-}" ]; then
  APK="$APK_LOCAL"
  [ -f "$APK" ] || terminar "No existe el archivo APK_LOCAL: $APK"
  linea "    Uso el APK local: $APK"
else
  CARPETA="$(mktemp -d "${TMPDIR:-/tmp}/paquete-soda.XXXXXX")" || terminar "No pude crear una carpeta temporal."
  APK="$CARPETA/reenviador-sms-la-bomba-$VERSION.apk"
  linea "    Descargando de pagos.dmalabomba.com ..."
  curl -fsSL --retry 3 --connect-timeout 20 -o "$APK" "$URL" </dev/null || terminar "No pude descargar el APK. Revise la conexion a internet y vuelva a pegar el comando."
fi
if command -v shasum >/dev/null 2>&1; then
  SHA="$(shasum -a 256 "$APK" | awk '{print $1}')"
elif command -v sha256sum >/dev/null 2>&1; then
  SHA="$(sha256sum "$APK" | awk '{print $1}')"
else
  terminar "No encuentro shasum ni sha256sum para verificar el APK. No instalo nada."
fi
if [ "$SHA" != "$SHA_ESPERADO" ]; then
  terminar "La huella SHA-256 del APK NO coincide.
  esperada: $SHA_ESPERADO
  obtenida: $SHA
No instalo nada. Avise a Emil."
fi
ok "SHA-256 verificado: $SHA"

# ---------------------------------------------------------------------------------------------- 2. instalar
VERSION_ANTES="$(SH dumpsys package "$PKG" | grep -m1 versionName= | sed 's/.*versionName=//')"
if [ -n "$VERSION_ANTES" ]; then linea "    Ya estaba instalada la version $VERSION_ANTES: se instala encima y se conservan sus ajustes."; else linea "    La app no estaba instalada: se instala nueva."; fi
paso "Instalando encima (si el telefono muestra un aviso para instalar por USB, acepte)"
SALIDA="$(A install -r -g "$APK")"
linea "$SALIDA" | sed 's/^/    /'
if ! printf '%s' "$SALIDA" | grep -q "Success"; then
  case "$SALIDA" in
    *UPDATE_INCOMPATIBLE*|*SIGNATURES*) terminar "La app instalada en el telefono tiene otra firma. No la desinstalo (se perderian sus ajustes). Avise a Emil.";;
    *USER_RESTRICTED*|*canceled*|*Canceled*|*cancel*) terminar "El telefono bloqueo la instalacion por USB. Acepte el aviso que aparece en la pantalla del HONOR (o en Opciones de desarrollador active «Instalar via USB») y vuelva a pegar el comando.";;
    *DOWNGRADE*) terminar "El telefono ya tiene una version mas nueva que la $VERSION. No instalo nada.";;
    *) terminar "No se pudo instalar el APK. No sigo.";;
  esac
fi
VERSION_AHORA="$(SH dumpsys package "$PKG" | grep -m1 versionName= | sed 's/.*versionName=//')"
ok "Instalada la version $VERSION_AHORA"

# ---------------------------------------------------------------------------------------------- 3. permisos
conceder() { # permiso de ejecucion normal por pm grant
  SALIDA="$(SH pm grant "$PKG" "android.permission.$1")"
  if [ -n "$SALIDA" ]; then aviso "$1: $SALIDA"; fi
}
permiso_op() { # appops
  SALIDA="$(SH cmd appops set "$PKG" "$1" allow)"
  if [ -n "$SALIDA" ]; then aviso "$1: $SALIDA"; fi
}

paso "Ajustes restringidos (Android 13 o mas)"
if [ "$SDK" -ge 33 ]; then
  permiso_op ACCESS_RESTRICTED_SETTINGS
  ok "Pedido el permiso de ajustes restringidos"
else
  linea "    No aplica en Android $RELEASE."
fi

paso "Permisos de la app (SMS, avisos, ubicacion, telefono)"
conceder RECEIVE_SMS
conceder READ_SMS
[ "$SDK" -ge 33 ] && conceder POST_NOTIFICATIONS
if [ "$SDK" -ge 23 ]; then
  conceder ACCESS_FINE_LOCATION
  conceder ACCESS_COARSE_LOCATION
  conceder READ_PHONE_STATE
fi
[ "$SDK" -ge 29 ] && conceder ACCESS_BACKGROUND_LOCATION
ok "Pedidos los permisos de ejecucion"

paso "Ajustes seguros (WRITE_SECURE_SETTINGS, solo se puede por adb)"
conceder WRITE_SECURE_SETTINGS
ok "Pedido WRITE_SECURE_SETTINGS"

paso "Permisos especiales (uso de apps, superposicion, ajustes del sistema, segundo plano, instalar)"
permiso_op GET_USAGE_STATS
[ "$SDK" -ge 23 ] && permiso_op SYSTEM_ALERT_WINDOW
[ "$SDK" -ge 23 ] && permiso_op WRITE_SETTINGS
[ "$SDK" -ge 23 ] && permiso_op RUN_IN_BACKGROUND
[ "$SDK" -ge 28 ] && permiso_op RUN_ANY_IN_BACKGROUND
[ "$SDK" -ge 31 ] && permiso_op SCHEDULE_EXACT_ALARM
permiso_op REQUEST_INSTALL_PACKAGES
ok "Pedidos los permisos especiales"

paso "No molestar (acceso a la politica de notificaciones)"
if [ "$SDK" -ge 23 ]; then
  SALIDA="$(SH cmd notification allow_dnd "$PKG")"
  [ -n "$SALIDA" ] && aviso "allow_dnd: $SALIDA"
  ok "Pedido el acceso a No molestar"
fi

paso "Ancla (acceso a notificaciones) y pantalla remota (accesibilidad)"
if [ "$SDK" -ge 24 ]; then
  ACTUAL="$(SH settings get secure enabled_notification_listeners)"
  case "$ACTUAL" in
    *"$ANCLA"*) linea "    El ancla ya figuraba activada.";;
    *)
      if [ "$SDK" -ge 29 ]; then SALIDA="$(SH cmd notification allow_listener "$ANCLA")"; [ -n "$SALIDA" ] && aviso "allow_listener: $SALIDA"; fi
      ACTUAL="$(SH settings get secure enabled_notification_listeners)"
      case "$ACTUAL" in
        *"$ANCLA"*) ;;
        *)
          if [ -z "$ACTUAL" ] || [ "$ACTUAL" = "null" ]; then NUEVA="$ANCLA"; else NUEVA="$ACTUAL:$ANCLA"; fi
          SH settings put secure enabled_notification_listeners "$NUEVA" >/dev/null
          ;;
      esac
      ;;
  esac
  ok "Pedida el ancla"
else
  linea "    No aplica en Android $RELEASE."
fi
if [ "$SDK" -ge 30 ]; then
  ACTUAL="$(SH settings get secure enabled_accessibility_services)"
  case "$ACTUAL" in
    *"$PANTALLA"*) linea "    La pantalla remota ya figuraba activada.";;
    *)
      if [ -z "$ACTUAL" ] || [ "$ACTUAL" = "null" ]; then NUEVA="$PANTALLA"; else NUEVA="$ACTUAL:$PANTALLA"; fi
      SH settings put secure enabled_accessibility_services "$NUEVA" >/dev/null
      ;;
  esac
  SH settings put secure accessibility_enabled 1 >/dev/null
  ok "Pedida la pantalla remota"
else
  linea "    La pantalla remota necesita Android 11 o mas: en Android $RELEASE no aplica."
fi

paso "Bateria: sin restriccion, segundo plano y datos sin limite"
SALIDA="$(SH cmd deviceidle whitelist "+$PKG")"
printf '%s\n' "$SALIDA" | sed 's/^/    /'
UID_APP="$(SH dumpsys package "$PKG" | grep -m1 'userId=' | sed 's/.*userId=\([0-9]*\).*/\1/')"
if [ -n "$UID_APP" ] && [ "$SDK" -ge 24 ]; then
  SALIDA="$(SH cmd netpolicy add restrict-background-whitelist "$UID_APP")"
  [ -n "$SALIDA" ] && aviso "netpolicy: $SALIDA"
fi
ok "Pedida la lista blanca de bateria y de datos"

paso "Depuracion: quitar el tiempo de espera de la autorizacion de ADB"
if [ "$SDK" -ge 30 ]; then
  SH settings put global adb_allowed_connection_time 0 >/dev/null
  ok "Pedido: la autorizacion de ADB no caduca"
else
  linea "    No aplica en Android $RELEASE (la autorizacion no caduca)."
fi

paso "Abriendo la app"
SALIDA="$(SH am start -n "$PKG/$PKG.MainActivity")"
case "$SALIDA" in
  *rror*) SALIDA="$(SH monkey -p "$PKG" -c android.intent.category.LAUNCHER 1)";;
esac
sleep 4
ok "App abierta"

# ---------------------------------------------------------------------------------------------- 4. comprobacion real
paso "Comprobando lo que de verdad quedo (lectura del estado real del telefono)"
VOL="$(mktemp "${TMPDIR:-/tmp}/estado-soda.XXXXXX")"
SH dumpsys package "$PKG" > "$VOL"
perm_ok() { grep -q "android.permission.$1: granted=true" "$VOL"; }
op_ok() { SH cmd appops get "$PKG" "$1" | grep -qi ": allow"; }
perm() { if perm_ok "$1"; then res si "$2"; else res no "$2"; fi; }
opx() { if op_ok "$1"; then res si "$2"; else res no "$2"; fi; }

perm RECEIVE_SMS "Permiso para recibir SMS"
perm READ_SMS "Permiso para leer SMS anteriores"
if [ "$SDK" -ge 33 ]; then perm POST_NOTIFICATIONS "Avisos (notificaciones)"; fi
if [ "$SDK" -ge 23 ]; then
  perm ACCESS_FINE_LOCATION "Ubicacion (fina)"
  perm ACCESS_COARSE_LOCATION "Ubicacion (aproximada)"
  perm READ_PHONE_STATE "Estado del telefono y de la SIM"
fi
if [ "$SDK" -ge 29 ]; then perm ACCESS_BACKGROUND_LOCATION "Ubicacion «siempre»"; fi
perm WRITE_SECURE_SETTINGS "Ajustes seguros (reactivacion automatica de permisos)"
opx GET_USAGE_STATS "Acceso al uso de aplicaciones"
if [ "$SDK" -ge 23 ]; then
  opx SYSTEM_ALERT_WINDOW "Mostrarse sobre otras apps"
  opx WRITE_SETTINGS "Modificar ajustes del sistema"
  opx RUN_IN_BACKGROUND "Segundo plano permitido"
fi
if [ "$SDK" -ge 28 ]; then opx RUN_ANY_IN_BACKGROUND "Segundo plano sin restriccion"; fi
opx REQUEST_INSTALL_PACKAGES "Instalar apps desconocidas (actualizacion sin pantalla de confirmacion)"
if [ "$SDK" -ge 33 ]; then
  if op_ok ACCESS_RESTRICTED_SETTINGS; then res si "Ajustes restringidos permitidos"; else res no "Ajustes restringidos permitidos"; fi
fi

# Bateria
if SH cmd deviceidle whitelist | grep -q "$PKG"; then res si "Bateria sin restriccion (lista blanca de Doze)"; else res no "Bateria sin restriccion (lista blanca de Doze)"; fi
if [ -n "$UID_APP" ] && [ "$SDK" -ge 24 ]; then
  if SH cmd netpolicy list restrict-background-whitelist | grep -qw "$UID_APP"; then res si "Datos sin restriccion con el ahorro de datos"; else res no "Datos sin restriccion con el ahorro de datos"; fi
fi
if [ "$(SH settings get global low_power)" = "1" ]; then
  reg_n "Ahorro de batería encendido en el telefono (apagarlo a mano en Ajustes > Bateria)"
else
  reg_h "Ahorro de bateria apagado"
fi

# No molestar
if [ "$SDK" -ge 23 ]; then
  if SH dumpsys notification | grep -i -A3 "policy access\|Approved DND\|dnd" | grep -q "$PKG"; then res si "Acceso a «No molestar»"; else
    if SH settings get secure enabled_notification_policy_access_packages | grep -q "$PKG"; then res si "Acceso a «No molestar»"; else res no "Acceso a «No molestar»"; fi
  fi
fi

# Ancla y pantalla
if [ "$SDK" -ge 24 ]; then
  if SH settings get secure enabled_notification_listeners | grep -q "$ANCLA"; then
    res si "Ancla (acceso a notificaciones) activada"
  else res no "Ancla (acceso a notificaciones) activada"; fi
fi
if [ "$SDK" -ge 30 ]; then
  if SH settings get secure enabled_accessibility_services | grep -q "$PANTALLA" && [ "$(SH settings get secure accessibility_enabled)" = "1" ]; then
    res si "Pantalla remota (accesibilidad) activada"
  else res no "Pantalla remota (accesibilidad) activada"; fi
fi

# ADB
if [ "$SDK" -ge 30 ]; then
  if [ "$(SH settings get global adb_allowed_connection_time)" = "0" ]; then res si "Autorizacion de ADB sin tiempo de espera"; else res no "Autorizacion de ADB sin tiempo de espera"; fi
fi

# La app
if SH pidof "$PKG" | grep -q '[0-9]' || SH ps -A | grep -q "$PKG"; then reg_h "La app esta abierta y corriendo"; else reg_n "La app no aparece corriendo (abrala una vez en el telefono)"; fi

# Lo que no se puede por adb
reg_m "Inicio automático de la app (HONOR: Ajustes > Aplicaciones > Inicio de aplicaciones > SMS Reenviador La Bomba > Administrar manualmente, y activar los tres)"
reg_m "Datos de red en espera / Wi-Fi activo con la pantalla apagada (HONOR: Ajustes > Batería > Más ajustes de batería, o en la app Salud del teléfono)"
reg_m "Tocar «Ya lo hice» en la app (Salud del teléfono) para esos dos puntos: la app no puede leerlos"
reg_m "La regla de reenvio y la clave HMAC de la Soda se cargan por otro medio (no las toca este paquete)"

# ---------------------------------------------------------------------------------------------- 5. adb por Wi-Fi
IP=""
if [ "${SIN_TCPIP:-0}" != "1" ]; then
  paso "Dejando ADB listo por Wi-Fi (puerto 5555)"
  IP="$(SH ip -f inet addr show wlan0 | grep -m1 'inet ' | sed 's/.*inet \([0-9.]*\).*/\1/')"
  SALIDA="$(A tcpip 5555)"
  linea "    $SALIDA"
  sleep 3
  "$ADB" -s "$SER" wait-for-device </dev/null >/dev/null 2>&1
  PUERTO="$("$ADB" -s "$SER" shell getprop service.adb.tcp.port </dev/null 2>/dev/null | tr -d '\r')"
  if [ "$PUERTO" = "5555" ]; then reg_h "ADB por Wi-Fi listo en el puerto 5555 (hasta que se reinicie el telefono)"; else reg_n "ADB por Wi-Fi (puerto 5555): $SALIDA"; fi
fi

# ---------------------------------------------------------------------------------------------- resumen
rm -f "$VOL"
printf '\n=====================================================================\n'
printf ' RESULTADO en %s %s (Android %s)\n' "$MARCA" "$MODELO" "$RELEASE"
printf '=====================================================================\n'
printf '\nHECHO (comprobado en el telefono):\n%s' "${HECHO:-  (nada)
}"
printf '\nNO SE PUDO:\n%s' "${NOPUDO:-  (nada, todo lo que se pidio quedo concedido)
}"
printf '\nFALTA MANUAL (del HONOR, no se puede por adb):\n%s' "$MANUAL"
if [ -n "$IP" ]; then
  printf '\nPara volver por Wi-Fi mas tarde (Mac y telefono en la misma red):\n  ./adb connect %s:5555\n' "$IP"
fi
printf '\n'
[ -z "$NOPUDO" ]

# ----------------------------------------------------------------------------------------------
# REVERSA (todo es reversible, desde adb; la app y sus datos no se tocan):
#   permisos de ejecucion:   adb shell pm revoke tech.bogomolov.incomingsmsgateway android.permission.<PERMISO>
#   permisos especiales:     adb shell cmd appops set tech.bogomolov.incomingsmsgateway <OP> default
#   bateria:                 adb shell cmd deviceidle whitelist -tech.bogomolov.incomingsmsgateway
#   datos sin limite:        adb shell cmd netpolicy remove restrict-background-whitelist <uid>
#   No molestar:             adb shell cmd notification disallow_dnd tech.bogomolov.incomingsmsgateway
#   ancla:                   adb shell cmd notification disallow_listener tech.bogomolov.incomingsmsgateway/tech.bogomolov.incomingsmsgateway.GuardianListenerService
#   pantalla remota:         quitar la entrada de enabled_accessibility_services (adb shell settings get/put secure ...)
#   tiempo de espera de ADB: adb shell settings put global adb_allowed_connection_time 604800000
#   ADB por Wi-Fi:           adb usb
