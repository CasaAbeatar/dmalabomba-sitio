#!/bin/bash
# Prueba de actualizacion REAL con los APK firmados de produccion: 2.9.0 instalada y trabajando -> 2.11.0 instalada ENCIMA (adb install -r).
# Comprueba: la firma coincide (si no, Android rechaza), la regla y el estado de las ordenes se conservan, el contador de latidos
# sigue, las ordenes ya ejecutadas NO se repiten, la 2.11.0 arranca sola y manda latidos firmados con app=2.11.0.
# Se corre desde la raiz del repositorio. Usa adb root (imagen google_apis) porque el APK de produccion no es depurable (no hay run-as).
P=tech.bogomolov.incomingsmsgateway
V=apk-firmados/reenviador-sms-la-bomba-2.9.0.apk
N=apk-firmados/reenviador-sms-la-bomba-2.11.0.apk
OUT=act-resultados; mkdir -p $OUT; rm -f guardian-recibidos.jsonl
nota() { echo "=== $(date +%H:%M:%S) $*"; }
PREF=$(grep -o 'key_phones_preference">[^<]*' "app sms android/app/src/main/res/values/strings.xml" | sed 's/.*>//')
raiz() { adb shell "$@"; }
adb root >/dev/null 2>&1; sleep 3; adb wait-for-device
echo "adb root: $(adb shell id | tr -d '\r')"
cp scripts-prueba/guardian-mock.py . 
python3 guardian-mock.py & echo $! > srv.pid; sleep 2
{
nota "1. instalar la 2.9.0 firmada"
adb install -r "$V" 2>&1 | tail -1 | sed 's/^/instala-2.9.0: /'
adb shell dumpsys package $P | grep -E "versionCode|versionName" | head -2 | sed 's/^ */antes: /'
} | tee $OUT/instalacion.txt
for p in RECEIVE_SMS READ_SMS POST_NOTIFICATIONS; do adb shell pm grant $P android.permission.$p 2>/dev/null; done
adb shell am start -n $P/.MainActivity >/dev/null; sleep 4; adb shell am force-stop $P
UID_APP=$(adb shell stat -c %u /data/data/$P | tr -d '\r'); echo "uid de la app: $UID_APP"
REGLA='{"key":"r1","sender":"4066","is_sender_regex":false,"sms_filter":"SINPE","url":"http://10.0.2.2:8099/sms","sim_slot":0,"template":"{\"from\":\"%from%\",\"text\":\"%text%\",\"sentStamp\":\"%sentStamp%\",\"empresa\":\"soda\"}","headers":"{\"Content-Type\":\"application/json\"}","retries_number":3,"ignore_ssl":false,"chunked_mode":false,"is_sms_enabled":true,"sign_hmac_sha256":true,"sign_hmac_sha256_secret":"claveprueba","store_failed":true,"local_mode":true}'
printf '<?xml version="1.0" encoding="utf-8" standalone="yes" ?>\n<map>\n<string name="r1">%s</string>\n</map>\n' "$(echo "$REGLA" | sed 's/&/\&amp;/g;s/"/\&quot;/g')" > prefs.xml
printf '<?xml version="1.0" encoding="utf-8" standalone="yes" ?>\n<map>\n<boolean name="enabled" value="true" />\n<string name="url">http://10.0.2.2:8099/latido</string>\n<int name="interval_minutes" value="1" />\n</map>\n' > hb.xml
adb push prefs.xml /data/local/tmp/prefs.xml >/dev/null; adb push hb.xml /data/local/tmp/hb.xml >/dev/null
adb shell "mkdir -p /data/data/$P/shared_prefs; cp /data/local/tmp/prefs.xml /data/data/$P/shared_prefs/$PREF.xml; cp /data/local/tmp/hb.xml /data/data/$P/shared_prefs/heartbeat.xml; chown -R $UID_APP:$UID_APP /data/data/$P/shared_prefs; chmod 660 /data/data/$P/shared_prefs/*.xml; restorecon -R /data/data/$P/shared_prefs"
adb logcat -c
adb shell am start -n $P/.MainActivity >/dev/null
nota "2. la 2.9.0 trabaja (latidos y ordenes) 150 s"
sleep 150
adb shell "cat /data/data/$P/shared_prefs/$PREF.xml" > $OUT/regla-antes.xml
adb shell "cat /data/data/$P/shared_prefs/guardian.xml" > $OUT/guardian-antes.xml 2>/dev/null
adb shell "cat /data/data/$P/shared_prefs/heartbeat.xml" > $OUT/heartbeat-antes.xml 2>/dev/null
adb shell "ls -la /data/data/$P/shared_prefs" > $OUT/prefs-lista-antes.txt
LAT_ANTES=$(grep -c '"ruta": "/latido' guardian-recibidos.jsonl)
echo "latidos recibidos con la 2.9.0: $LAT_ANTES"; date +%s > $OUT/t-actualiza.txt

nota "3. instalar la 2.11.0 firmada ENCIMA (sin desinstalar)"
{
adb install -r "$N" 2>&1 | tail -1 | sed 's/^/actualiza-a-2.11.0-encima: /'
adb shell dumpsys package $P | grep -E "versionCode|versionName" | head -2 | sed 's/^ */despues: /'
} | tee -a $OUT/instalacion.txt
adb shell am start -n $P/.MainActivity >/dev/null
nota "4. la 2.11.0 trabaja 150 s (debe seguir latiendo con la regla guardada)"
sleep 150
adb shell "cat /data/data/$P/shared_prefs/$PREF.xml" > $OUT/regla-despues.xml
adb shell "cat /data/data/$P/shared_prefs/guardian.xml" > $OUT/guardian-despues.xml 2>/dev/null
adb shell "cat /data/data/$P/shared_prefs/heartbeat.xml" > $OUT/heartbeat-despues.xml 2>/dev/null
adb shell "ls -la /data/data/$P/shared_prefs" > $OUT/prefs-lista-despues.txt
adb shell pidof $P > $OUT/pid.txt
adb shell dumpsys activity services $P > $OUT/servicios.txt 2>&1
adb logcat -d > $OUT/logcat.txt
cp guardian-recibidos.jsonl $OUT/
kill $(cat srv.pid) 2>/dev/null
python3 scripts-prueba/actualizacion-verifica.py $OUT | tee $OUT/resultado.txt
exit 0
