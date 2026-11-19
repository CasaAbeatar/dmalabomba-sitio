#!/bin/bash
# Prueba de punta a punta del Guardian 2.7.0 en emulador (se corre desde "app sms android").
# 1) instala la 2.6.0 y la actualiza ENCIMA con la 2.7.1   2) regla + latido apuntando al servidor falso (10.0.2.2:8099)
# 3) SMS simulado de 4066   4) pantalla Salud (por toques reales)   5) mata el proceso y espera que reviva solo
P=tech.bogomolov.incomingsmsgateway
NUEVO=app/build/outputs/apk/debug/app-debug.apk
VIEJO=../viejo-2.6.0.apk
rm -f guardian-recibidos.jsonl guardian-t-muerte.txt
PREF=$(grep -o 'key_phones_preference">[^<]*' app/src/main/res/values/strings.xml | sed 's/.*>//')

nota() { echo "=== $(date +%H:%M:%S) $*"; }
sacar() { adb shell "run-as $P cat shared_prefs/$1.xml" 2>/dev/null; }
tap_id() {  # toca el centro de la vista con ese resource-id (via uiautomator dump)
  adb shell uiautomator dump /sdcard/u.xml >/dev/null 2>&1
  adb pull /sdcard/u.xml u.xml >/dev/null 2>&1
  python3 - "$1" <<'PY' > xy.txt
import re,sys
s=open('u.xml',encoding='utf8').read()
m=re.search(r'resource-id="[^"]*:id/%s"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"'%sys.argv[1],s)
print("%d %d"%((int(m[1])+int(m[3]))//2,(int(m[2])+int(m[4]))//2) if m else "")
PY
  read X Y < xy.txt
  if [ -n "$X" ]; then adb shell input tap $X $Y; echo "toque en $1 ($X,$Y)"; else echo "NO ENCONTRADO $1"; fi
}

python3 ../scripts-prueba/guardian-mock.py & echo $! > srv.pid
sleep 2

nota "1. instalar 2.6.0 (versionCode 15) y actualizar encima con 2.7.0 (versionCode 17)"
{
adb install -r "$VIEJO" 2>&1 | tail -1 | sed 's/^/instala-2.6.0: /'
adb shell dumpsys package $P | grep -E "versionCode|versionName" | head -2 | sed 's/^ */antes: /'
} | tee guardian-instalacion.txt
adb shell pm grant $P android.permission.RECEIVE_SMS
adb shell pm grant $P android.permission.READ_SMS
adb shell pm grant $P android.permission.POST_NOTIFICATIONS 2>/dev/null
# SMS ya en la bandeja antes de configurar (para el historial)
adb emu sms send 4066 "Recibiste un SINPE Movil por 3000 colones de ANA PRUEBA. Comprobante 111 historico"
sleep 3
{
adb install -r "$NUEVO" 2>&1 | tail -1 | sed 's/^/actualiza-a-2.7.1-encima: /'
adb shell dumpsys package $P | grep -E "versionCode|versionName" | head -2 | sed 's/^ */despues: /'
} | tee -a guardian-instalacion.txt
sleep 5

nota "2. regla firmada (empresa soda, remitente 4066) y latido cada 1 min hacia el servidor falso"
adb shell am force-stop $P
REGLA='{"key":"r1","sender":"4066","is_sender_regex":false,"sms_filter":"SINPE","url":"http://10.0.2.2:8099/sms","sim_slot":0,"template":"{\"from\":\"%from%\",\"text\":\"%text%\",\"sentStamp\":\"%sentStamp%\",\"empresa\":\"soda\"}","headers":"{\"Content-Type\":\"application/json\"}","retries_number":3,"ignore_ssl":false,"chunked_mode":false,"is_sms_enabled":true,"sign_hmac_sha256":true,"sign_hmac_sha256_secret":"claveprueba","store_failed":true,"local_mode":true}'
printf '<?xml version="1.0" encoding="utf-8" standalone="yes" ?>\n<map>\n<string name="r1">%s</string>\n</map>\n' "$(echo "$REGLA" | sed 's/&/\&amp;/g;s/"/\&quot;/g')" > prefs.xml
printf '<?xml version="1.0" encoding="utf-8" standalone="yes" ?>\n<map>\n<boolean name="enabled" value="true" />\n<string name="url">http://10.0.2.2:8099/latido</string>\n<int name="interval_minutes" value="1" />\n</map>\n' > hb.xml
adb push prefs.xml /data/local/tmp/prefs.xml >/dev/null
adb push hb.xml /data/local/tmp/hb.xml >/dev/null
adb shell run-as $P mkdir -p shared_prefs
adb shell "run-as $P cp /data/local/tmp/prefs.xml shared_prefs/$PREF.xml"
adb shell "run-as $P cp /data/local/tmp/hb.xml shared_prefs/heartbeat.xml"
adb logcat -c
adb shell am start -n $P/.MainActivity >/dev/null
sleep 8
adb exec-out screencap -p > guardian-principal.png
nota "espera del primer latido, de las ordenes y de la confirmacion (50 s)"
sleep 50

nota "3. SMS simulado de 4066"
adb emu sms send 4066 "Recibiste un SINPE Movil por 5000 colones de TEST UNO. Comprobante 222"
sleep 15

nota "4. pantalla Salud (toques reales)"
tap_id btn_health
sleep 3
adb exec-out screencap -p > guardian-salud-1.png
adb shell uiautomator dump /sdcard/u.xml >/dev/null 2>&1; adb pull /sdcard/u.xml guardian-salud-1.xml >/dev/null 2>&1
read W H <<< "$(adb shell wm size | grep -o '[0-9]*x[0-9]*' | tail -1 | tr x ' ')"
X=$((W/2)); Y1=$((H*80/100)); Y2=$((H*25/100))
adb shell input swipe $X $Y1 $X $Y2 400; sleep 1
adb exec-out screencap -p > guardian-salud-2.png
adb shell input swipe $X $Y1 $X $Y2 400; sleep 1
adb exec-out screencap -p > guardian-salud-3.png
adb shell input swipe $X $Y1 $X $Y2 400; sleep 1
adb exec-out screencap -p > guardian-salud-4.png
adb shell input keyevent KEYCODE_BACK
sleep 2

nota "5. matar el proceso (como lo haria el fabricante) y esperar que reviva solo"
OLD=$(adb shell pidof $P | tr -d '\r')
echo "pid antes: $OLD"
python3 -c "import time;open('guardian-t-muerte.txt','w').write(str(time.time()))"
adb shell run-as $P kill -9 $OLD
for i in $(seq 1 24); do
  sleep 5
  NEW=$(adb shell pidof $P | tr -d '\r')
  [ -n "$NEW" ] && [ "$NEW" != "$OLD" ] && { echo "revivio: pid nuevo $NEW tras ~$((i*5)) s"; break; }
done
echo "pid despues: ${NEW:-ninguno}"
sleep 75   # al menos un latido mas tras revivir (intervalo 1 min)
adb exec-out screencap -p > guardian-final.png

nota "6. recoger estado"
sacar guardian > guardian-estado.xml
sacar heartbeat > guardian-heartbeat.xml
adb shell dumpsys activity services $P > guardian-servicios.txt 2>&1
adb shell dumpsys alarm | grep -B1 -A3 "$P" | head -40 > guardian-alarmas.txt 2>&1
adb shell dumpsys jobscheduler | grep -A6 "$P" | head -30 > guardian-trabajos.txt 2>&1
adb logcat -d > guardian-logcat.txt
kill $(cat srv.pid) 2>/dev/null
cat guardian-estado.xml
echo "--- verificacion ---"
python3 ../scripts-prueba/guardian-verifica.py guardian-estado.xml | tee guardian-resultado.txt
RC=${PIPESTATUS[0]}
echo "codigo de salida de la verificacion: $RC" | tee -a guardian-resultado.txt
exit 0
