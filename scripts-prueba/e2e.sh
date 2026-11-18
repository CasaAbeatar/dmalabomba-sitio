#!/bin/bash
# Prueba de punta a punta: regla de reenvio -> SMS simulado -> servidor de prueba recibe el JSON
P=tech.bogomolov.incomingsmsgateway
PREF=$(grep -o 'key_phones_preference">[^<]*' app/src/main/res/values/strings.xml | sed 's/.*>//')
echo "preferencias: $PREF"
python3 ../scripts-prueba/servidor-prueba.py & echo $! > srv.pid
sleep 2
REGLA='{"key":"r1","sender":"BCR","is_sender_regex":false,"sms_filter":"","url":"http://10.0.2.2:8099/sinpe","sim_slot":0,"template":"{\"from\":\"%from%\",\"text\":\"%text%\"}","headers":"{\"X-Prueba\":\"si\"}","retries_number":3,"ignore_ssl":false,"chunked_mode":true,"is_sms_enabled":true,"sign_hmac_sha256":false,"store_failed":true,"local_mode":true}'
adb shell am force-stop $P
printf '<?xml version="1.0" encoding="utf-8" standalone="yes" ?>\n<map>\n<string name="r1">%s</string>\n</map>\n' "$(echo "$REGLA" | sed 's/&/\&amp;/g;s/"/\&quot;/g')" > prefs.xml
adb push prefs.xml /data/local/tmp/prefs.xml
adb shell run-as $P mkdir -p shared_prefs
adb shell "run-as $P cp /data/local/tmp/prefs.xml shared_prefs/$PREF.xml"
adb shell am start -n $P/.MainActivity; sleep 5
adb exec-out screencap -p > pantalla-con-regla.png
adb logcat -c
adb emu sms send BCR "Recibiste un SINPE Movil por 5000 colones de JUAN PEREZ. Detalle: prueba uno"
sleep 8
adb emu sms send OTRO "Mensaje de otro remitente que no debe reenviarse"
sleep 8
adb emu sms send BCR "Recibiste un SINPE Movil por 12500 colones de MARIA SOTO. Detalle: acentos y ñ prueba dos"
sleep 8
adb logcat -d > registro-e2e.txt
kill $(cat srv.pid)
echo "--- recibidos por el servidor ---"
cat recibidos.jsonl 2>/dev/null || echo "NADA RECIBIDO"
