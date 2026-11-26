#!/bin/bash
# Prueba de punta a punta de la app 2.12.0 en emulador (se corre desde "app sms android"):
#   - latido con la salud ampliada, autochequeo «recibe pero no reenvia» y su recuperacion con reenviar_historial
#   - ordenes abrir_adb / cerrar_adb
#   - actualizacion automatica REAL (PackageInstaller): rechazos (firma de la oferta mala, sha256 malo, APK de otro certificado)
#     y dos instalaciones buenas: sin confirmacion y, forzando la confirmacion, con el boton pulsado por accesibilidad.
# Necesita en act-apks/: apk-22.apk (esta version), apk-23.apk (vc 23, 2.12.1), apk-24-otra.apk (vc 24, 2.12.2, OTRO certificado),
# apk-27.apk (vc 27, 2.12.3), todos del mismo certificado de depuracion salvo el de «otra».
P=tech.bogomolov.incomingsmsgateway
D=$(pwd)
SCRIPTS="$D/../scripts-prueba"
export APKS="$D/act-apks"
rm -f act-recibidos.jsonl act-descargas.log act-modo.json act-sms-falla act-resultado.txt
echo '{}' > act-modo.json
FALLOS=0
PREF=$(grep -o 'key_phones_preference">[^<]*' app/src/main/res/values/strings.xml | sed 's/.*>//')

nota() { echo "=== $(date +%H:%M:%S) $*"; }
bien() { echo "OK    $*" | tee -a act-resultado.txt; }
mal() { echo "FALLA $*" | tee -a act-resultado.txt; FALLOS=$((FALLOS+1)); }
vc_instalado() { adb shell dumpsys package $P | grep -m1 versionCode | sed 's/.*versionCode=\([0-9]*\).*/\1/'; }

consulta() { python3 "$SCRIPTS/actualizacion-consulta.py" "$@"; }

# espera a que «consulta <args>» imprima exactamente <esperado>   (esperar_val <segundos> <esperado> <args...>)
esperar_val() {
  local lim=$1 esp=$2; shift 2
  local t=0
  while [ $t -lt $lim ]; do
    [ "$(consulta "$@")" = "$esp" ] && return 0
    sleep 5; t=$((t+5))
  done
  return 1
}
# espera a que el numero de «consulta <args>» sea >= <minimo> (o == 0 con modo eq)
esperar_ge() {
  local lim=$1 min=$2; shift 2
  local t=0
  while [ $t -lt $lim ]; do
    [ "$(consulta "$@")" -ge "$min" ] 2>/dev/null && return 0
    sleep 5; t=$((t+5))
  done
  return 1
}
esperar_cero() {
  local lim=$1; shift
  local t=0
  while [ $t -lt $lim ]; do
    [ "$(consulta "$@")" = "0" ] && return 0
    sleep 5; t=$((t+5))
  done
  return 1
}
esperar_vc() {
  local lim=$1 vc=$2
  local t=0
  while [ $t -lt $lim ]; do
    [ "$(vc_instalado)" = "$vc" ] && return 0
    sleep 5; t=$((t+5))
  done
  return 1
}
# deja pasar N latidos mas
pasar_latidos() {
  local n=$1 lim=${2:-240}
  local base; base=$(consulta latidos)
  esperar_ge $lim $((base+n)) latidos
}

modo() { echo "$1" > act-modo.json; }

python3 "$SCRIPTS/actualizacion-mock.py" & echo $! > act-srv.pid
sleep 2

nota "0. instalar la 2.12.0 (vc 22), permisos y permiso de «instalar apps desconocidas»"
adb uninstall $P >/dev/null 2>&1
adb install -r act-apks/apk-22.apk 2>&1 | tail -1 | sed 's/^/instala: /'
adb shell pm grant $P android.permission.RECEIVE_SMS
adb shell pm grant $P android.permission.READ_SMS
adb shell pm grant $P android.permission.POST_NOTIFICATIONS 2>/dev/null
adb shell pm grant $P android.permission.WRITE_SECURE_SETTINGS
adb shell appops set $P REQUEST_INSTALL_PACKAGES allow
adb shell appops get $P REQUEST_INSTALL_PACKAGES | sed 's/^/appop: /'

REGLA='{"key":"r1","sender":"4066","is_sender_regex":false,"sms_filter":"SINPE","url":"http://10.0.2.2:8099/sms","sim_slot":0,"template":"{\"from\":\"%from%\",\"text\":\"%text%\",\"sentStamp\":\"%sentStamp%\",\"empresa\":\"soda\"}","headers":"{\"Content-Type\":\"application/json\"}","retries_number":1,"ignore_ssl":false,"chunked_mode":false,"is_sms_enabled":true,"sign_hmac_sha256":true,"sign_hmac_sha256_secret":"claveprueba","store_failed":true,"local_mode":true}'
printf '<?xml version="1.0" encoding="utf-8" standalone="yes" ?>\n<map>\n<string name="r1">%s</string>\n</map>\n' "$(echo "$REGLA" | sed 's/&/\&amp;/g;s/"/\&quot;/g')" > act-prefs.xml
printf '<?xml version="1.0" encoding="utf-8" standalone="yes" ?>\n<map>\n<boolean name="enabled" value="true" />\n<string name="url">http://10.0.2.2:8099/latido</string>\n<int name="interval_minutes" value="1" />\n</map>\n' > act-hb.xml
adb push act-prefs.xml /data/local/tmp/act-prefs.xml >/dev/null
adb push act-hb.xml /data/local/tmp/act-hb.xml >/dev/null
adb shell run-as $P mkdir -p shared_prefs
adb shell "run-as $P cp /data/local/tmp/act-prefs.xml shared_prefs/$PREF.xml"
adb shell "run-as $P cp /data/local/tmp/act-hb.xml shared_prefs/heartbeat.xml"
adb logcat -c
adb shell am start -n $P/.MainActivity >/dev/null

nota "1. salud ampliada en el latido"
if esperar_val 150 '"2.12.0"' detalle app; then bien "el latido llega con app=2.12.0"; else mal "no llego el latido de la 2.12.0"; fi
for k in sms_inbox_ultimo_ms sms_sin_reenviar adb_activo adb_puerto actualizacion_estado; do
  v=$(consulta detalle $k)
  if [ -n "$v" ]; then bien "latido trae $k=$v"; else mal "el latido no trae $k"; fi
done
[ "$(consulta detalle actualizacion_estado)" = '"ninguna"' ] && bien "actualizacion_estado=ninguna al inicio" || mal "actualizacion_estado inicial: $(consulta detalle actualizacion_estado)"
[ "$(consulta firmas_malas)" = "0" ] && bien "todos los latidos llegaron con firma valida" || mal "hubo latidos con firma invalida"

nota "2. autochequeo: el servidor se cae, entra un SMS, y la app avisa sms_sin_reenviar >= 1"
touch act-sms-falla
adb emu sms send 4066 "Recibiste un SINPE Movil por 7000 colones de PRUEBA AUTOCHEQUEO. Comprobante 901"
if esperar_ge 300 1 detalle_num sms_sin_reenviar; then bien "sms_sin_reenviar=$(consulta detalle_num sms_sin_reenviar) con el servidor caido"; else mal "sms_sin_reenviar no subio (valor $(consulta detalle sms_sin_reenviar))"; fi
rm -f act-sms-falla
modo '{"comandos":[{"id":301,"cmd":"reenviar_historial"}]}'
if esperar_cero 240 detalle_num sms_sin_reenviar; then bien "tras reenviar_historial, sms_sin_reenviar=0"; else mal "sms_sin_reenviar no volvio a 0 (valor $(consulta detalle sms_sin_reenviar))"; fi
[ "$(consulta resultado 301)" = '"ok"' ] && bien "reenviar_historial confirmado ok" || mal "reenviar_historial resultado: $(consulta resultado 301)"

nota "3. depuracion inalambrica a pedido"
modo '{"comandos":[{"id":401,"cmd":"abrir_adb"}]}'
if esperar_val 200 '"ok"' resultado 401; then bien "abrir_adb confirmado ok"; else mal "abrir_adb resultado: $(consulta resultado 401)"; fi
# El emulador no tiene una red wifi conocida y Android apaga solo la depuracion inalambrica unos segundos despues:
# por eso se mira si ALGUN latido la vio encendida, no el valor actual.
# (en Android 14+ el sistema la apaga aun antes del siguiente latido: entonces vale el registro de la propia app)
if esperar_val 100 'true' alguna_vez adb_activo true; then bien "el latido reporta adb_activo=true (puerto $(consulta detalle adb_puerto))";
elif adb logcat -d -s AdbInalambrico | grep -q "abrir: depuracion inalambrica activa=true"; then bien "la app dejo la depuracion inalambrica activa (el sistema la apago antes del siguiente latido)";
else mal "ni el latido ni el registro muestran la depuracion inalambrica activa"; fi
modo '{"comandos":[{"id":401,"cmd":"abrir_adb"},{"id":402,"cmd":"cerrar_adb"}]}'
if esperar_val 200 '"ok"' resultado 402; then bien "cerrar_adb confirmado ok"; else mal "cerrar_adb resultado: $(consulta resultado 402)"; fi
[ "$(adb shell settings get global adb_wifi_enabled | tr -d '\r')" = "0" ] && bien "Settings.Global.adb_wifi_enabled=0" || mal "adb_wifi_enabled no quedo en 0"
if esperar_val 150 'false' detalle adb_activo; then bien "el latido reporta adb_activo=false"; else mal "el latido no reporta adb_activo=false"; fi
[ "$(consulta veces_ejecutada 401)" = "1" ] && bien "abrir_adb (id 401) se ejecuto una sola vez" || mal "id 401 ejecutado $(consulta veces_ejecutada 401) veces"
modo '{}'

nota "4. actualizacion: oferta con firma MALA (no debe ni descargar)"
DL0=$(consulta descargas)
modo '{"actualizacion":{"v":"2.12.1","vc":26,"archivo":"apk-23.apk","firma":"mala"}}'
pasar_latidos 2
[ "$(consulta descargas)" = "$DL0" ] && bien "firma mala: no se descargo nada" || mal "con firma mala la app descargo el archivo"
[ "$(vc_instalado)" = "22" ] && bien "sigue instalada la vc 22" || mal "cambio la version con una oferta de firma mala"
modo '{"actualizacion":{"v":"2.12.1","vc":26,"archivo":"apk-23.apk","firma":"sin"}}'
pasar_latidos 2
[ "$(consulta descargas)" = "$DL0" ] && bien "oferta sin firma: no se descargo nada" || mal "sin firma la app descargo el archivo"
modo '{"actualizacion":{"v":"2.12.1","vc":26,"archivo":"apk-23.apk","eco":1}}'
pasar_latidos 2
[ "$(consulta descargas)" = "$DL0" ] && bien "eco distinto: no se descargo nada" || mal "con eco distinto la app descargo el archivo"
modo '{"actualizacion":{"v":"2.12.1","vc":26,"archivo":"apk-23.apk","ts":1700000000000}}'
pasar_latidos 2
[ "$(consulta descargas)" = "$DL0" ] && bien "oferta vencida (ts de 2023): no se descargo nada" || mal "con ts vencido la app descargo el archivo"
modo '{"actualizacion":{"v":"2.12.1","vc":26,"archivo":"apk-23.apk","url":"http://10.0.2.2:8099/otra/apk-23.apk"}}'
pasar_latidos 2
[ "$(consulta descargas)" = "$DL0" ] && bien "url fuera de /instalar/: no se descargo nada" || mal "con url ajena la app descargo"

nota "5. actualizacion: sha256 MALO (descarga, rechaza y reporta fallo)"
modo '{"actualizacion":{"v":"2.12.1","vc":25,"archivo":"apk-23.apk","sha256":"0000000000000000000000000000000000000000000000000000000000000000"}}'
if esperar_val 240 '"sha256_distinto"' detalle actualizacion_detalle; then bien "fallo reportado: sha256_distinto"; else mal "no se reporto sha256_distinto (estado $(consulta detalle actualizacion_estado) / $(consulta detalle actualizacion_detalle))"; fi
[ "$(consulta detalle actualizacion_estado)" = '"fallo"' ] && bien "actualizacion_estado=fallo" || mal "estado tras sha malo: $(consulta detalle actualizacion_estado)"
[ "$(vc_instalado)" = "22" ] && bien "sigue la vc 22 tras el sha malo" || mal "se instalo algo con sha malo"

nota "6. actualizacion: APK firmado con OTRO certificado (sha256 correcto)"
modo '{"actualizacion":{"v":"2.12.2","vc":24,"archivo":"apk-24-otra.apk"}}'
if esperar_val 240 '"firma_distinta"' detalle actualizacion_detalle; then bien "fallo reportado: firma_distinta"; else mal "no se reporto firma_distinta (estado $(consulta detalle actualizacion_estado) / $(consulta detalle actualizacion_detalle))"; fi
[ "$(vc_instalado)" = "22" ] && bien "sigue la vc 22 con el certificado ajeno" || mal "se instalo un APK de otro certificado"

nota "7. actualizacion buena SIN confirmacion (vc 23)"
modo '{"actualizacion":{"v":"2.12.1","vc":23,"archivo":"apk-23.apk"}}'
if esperar_vc 330 23; then bien "la app se actualizo sola a la vc 23"; else mal "no se actualizo a la vc 23 (vc instalada $(vc_instalado), estado $(consulta detalle actualizacion_estado) / $(consulta detalle actualizacion_detalle))"; fi
if esperar_val 240 '"2.12.1"' detalle app; then bien "la app nueva arranco sola y manda latidos (app=2.12.1)"; else mal "la app nueva no mando latidos"; fi
if esperar_val 120 '"ninguna"' detalle actualizacion_estado; then bien "la app nueva reporta actualizacion_estado=ninguna"; else mal "estado tras actualizar: $(consulta detalle actualizacion_estado)"; fi
adb shell dumpsys package $P | grep -m1 installerPackageName | sed 's/^ */instalador: /'

nota "8. actualizacion buena CON confirmacion forzada (vc 27): el pulsador de accesibilidad"
modo '{}'
adb shell run-as $P touch files/prueba_confirmacion
SERV="$P/$P.PantallaRemotaService"
LISTA=$(adb shell settings get secure enabled_accessibility_services | tr -d '\r')
if [ "$LISTA" = "null" ] || [ -z "$LISTA" ]; then NUEVA="$SERV"; else NUEVA="$LISTA:$SERV"; fi
case "$LISTA" in *$SERV*) ;; *) adb shell settings put secure enabled_accessibility_services "$NUEVA";; esac
adb shell settings put secure accessibility_enabled 1
adb shell input keyevent KEYCODE_WAKEUP; adb shell wm dismiss-keyguard
sleep 10
modo '{"actualizacion":{"v":"2.12.3","vc":27,"archivo":"apk-27.apk"}}'
if esperar_vc 360 27; then bien "con confirmacion forzada la app se actualizo a la vc 27 (pulsador de accesibilidad)"; else mal "no se actualizo a la vc 27 (vc instalada $(vc_instalado), estado $(consulta detalle actualizacion_estado) / $(consulta detalle actualizacion_detalle))"; fi
adb exec-out screencap -p > act-final.png
adb logcat -d > act-logcat.txt
grep -E "Actualizador|boton del instalador|diag instalador|PantallaRemota" act-logcat.txt | tail -80 > act-logcat-actualizador.txt
grep -q "boton del instalador pulsado" act-logcat.txt && bien "el log confirma «boton del instalador pulsado»" || mal "el log no muestra que el pulsador actuara"
if esperar_val 240 '"2.12.3"' detalle app; then bien "la app 2.12.3 manda latidos"; else mal "no hay latidos de la 2.12.3"; fi

kill $(cat act-srv.pid) 2>/dev/null
echo "--- resumen ---"
cat act-resultado.txt
echo "fallos: $FALLOS" | tee -a act-resultado.txt
exit $FALLOS
