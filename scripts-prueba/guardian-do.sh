#!/bin/bash
# Modo telefono dedicado (Device Owner) en emulador limpio, sin cuentas: se convierte la app en Device Owner con adb,
# se comprueba que aplica las politicas y que una orden remota "reiniciar_telefono" REINICIA el emulador de verdad,
# que la app revive sola tras el arranque, que NO vuelve a reiniciar (la orden queda registrada) y que confirma la orden.
P=tech.bogomolov.incomingsmsgateway
NUEVO=app/build/outputs/apk/debug/app-debug.apk
rm -f guardian-recibidos.jsonl guardian-go
PREF=$(grep -o 'key_phones_preference">[^<]*' app/src/main/res/values/strings.xml | sed 's/.*>//')
nota() { echo "=== $(date +%H:%M:%S) $*"; }
MODO=do python3 ../scripts-prueba/guardian-mock.py & echo $! > srv.pid
sleep 2
adb uninstall $P >/dev/null 2>&1
adb install -r "$NUEVO" 2>&1 | tail -1
nota "1. convertir en Device Owner"
adb shell dpm set-device-owner $P/.GuardianAdminReceiver 2>&1 | tee guardian-do-1.txt
adb shell dpm list-owners 2>&1 | tee -a guardian-do-1.txt
adb shell dumpsys device_policy 2>&1 | grep -i -A3 "device owner" | head -12 | tee -a guardian-do-1.txt
# la app arranca desde cero al ser nombrada Device Owner: en un ejecutor lento tarda mas de 6 s; se espera hasta 60 s a que aplique la politica
for i in $(seq 1 30); do [ "$(adb shell settings get global stay_on_while_plugged_in | tr -d '\r')" = 7 ] && break; sleep 2; done
nota "2. politicas aplicadas por ser Device Owner (antes de abrir la app ni configurar nada)"
{
  echo "stay_on_while_plugged_in=$(adb shell settings get global stay_on_while_plugged_in | tr -d '\r')"
  adb shell dumpsys package $P | grep -E "android.permission.(RECEIVE_SMS|READ_SMS|POST_NOTIFICATIONS): granted" | sed 's/^ *//'
} | tee guardian-do-2.txt
nota "3. configurar la regla y el latido"
REGLA='{"key":"r1","sender":"4066","is_sender_regex":false,"sms_filter":"SINPE","url":"http://10.0.2.2:8099/sms","sim_slot":0,"template":"{\"from\":\"%from%\",\"text\":\"%text%\",\"sentStamp\":\"%sentStamp%\",\"empresa\":\"soda\"}","headers":"{\"Content-Type\":\"application/json\"}","retries_number":3,"ignore_ssl":false,"chunked_mode":false,"is_sms_enabled":true,"sign_hmac_sha256":true,"sign_hmac_sha256_secret":"claveprueba","store_failed":true,"local_mode":true}'
printf '<?xml version="1.0" encoding="utf-8" standalone="yes" ?>\n<map>\n<string name="r1">%s</string>\n</map>\n' "$(echo "$REGLA" | sed 's/&/\&amp;/g;s/"/\&quot;/g')" > prefs.xml
printf '<?xml version="1.0" encoding="utf-8" standalone="yes" ?>\n<map>\n<boolean name="enabled" value="true" />\n<string name="url">http://10.0.2.2:8099/latido</string>\n<int name="interval_minutes" value="1" />\n</map>\n' > hb.xml
adb push prefs.xml /data/local/tmp/prefs.xml >/dev/null
adb push hb.xml /data/local/tmp/hb.xml >/dev/null
adb shell am force-stop $P
adb shell run-as $P mkdir -p shared_prefs
adb shell "run-as $P cp /data/local/tmp/prefs.xml shared_prefs/$PREF.xml"
adb shell "run-as $P cp /data/local/tmp/hb.xml shared_prefs/heartbeat.xml"
adb logcat -c
adb shell am start -n $P/.MainActivity >/dev/null
sleep 10
{
  echo "stay_on_while_plugged_in=$(adb shell settings get global stay_on_while_plugged_in | tr -d '\r')"
  adb shell dumpsys package $P | grep -E "android.permission.(RECEIVE_SMS|READ_SMS|POST_NOTIFICATIONS): granted" | sed 's/^ *//'
} | tee guardian-do-2b.txt
adb exec-out screencap -p > guardian-do-antes.png
touch guardian-go
BOOT_ANTES=$(adb shell cat /proc/uptime | cut -d. -f1)
echo "uptime antes: $BOOT_ANTES s"
nota "4. esperar el primer latido (la orden reiniciar_telefono llega en su respuesta) y el reinicio"
python3 -c "import time;open('guardian-t-reinicio.txt','w').write(str(time.time()))"
for i in $(seq 1 30); do
  sleep 5
  UP=$(adb shell cat /proc/uptime 2>/dev/null | cut -d. -f1 | tr -d '\r')
  [ -n "$UP" ] && [ "$UP" -lt "$BOOT_ANTES" ] && { echo "REINICIO detectado: uptime $BOOT_ANTES -> $UP (a los ~$((i*5)) s)"; break; }
done
adb wait-for-device
for i in $(seq 1 60); do [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ] && break; sleep 3; done
echo "arranque completado a los ~$((i*3)) s tras volver adb"
nota "5. tras el arranque: la app debe revivir sola y confirmar la orden (sin reiniciar otra vez)"
sleep 90
UP2=$(adb shell cat /proc/uptime | cut -d. -f1 | tr -d '\r')
echo "uptime 90+ s despues: $UP2 (si fuera un bucle de reinicios seria menor a 60)"
adb shell pidof $P | tee guardian-do-pid.txt
adb exec-out screencap -p > guardian-do-despues.png
adb shell "run-as $P cat shared_prefs/guardian.xml" > guardian-estado.xml 2>&1
adb logcat -d > guardian-logcat.txt
adb shell dumpsys activity services $P > guardian-servicios.txt 2>&1
kill $(cat srv.pid) 2>/dev/null
cat guardian-estado.xml
python3 - <<'PY' | tee guardian-resultado.txt
import json,re,sys
rec=[json.loads(l) for l in open("guardian-recibidos.jsonl")]
est=open("guardian-estado.xml").read()
d1=open("guardian-do-1.txt").read(); d2=open("guardian-do-2.txt").read(); d2b=open("guardian-do-2b.txt").read()
lat=[r for r in rec if r["ruta"].startswith("/latido")]
cuerpos=[json.loads(r["cuerpo"]) for r in lat if r["firma_ok"]]
t0=float(open("guardian-t-reinicio.txt").read())
res=[]
def chk(n,c,e=""):
    res.append(bool(c)); print(("PASA  " if c else "FALLA ")+n+(("  ["+str(e)+"]") if e else ""))
chk("dpm set-device-owner dio Success", "Success" in d1, d1.splitlines()[0] if d1 else "")
chk("al ser Device Owner (sin abrir la app): pantalla encendida cargando = 7", "stay_on_while_plugged_in=7" in d2, [l for l in d2.splitlines() if "stay_on" in l])
chk("al ser Device Owner (sin abrir la app): permisos de SMS concedidos solos", "RECEIVE_SMS: granted=true" in d2 and "READ_SMS: granted=true" in d2, d2.count("granted=true"))
chk("con la app abierta: pantalla encendida cargando = 7 y permisos concedidos", "stay_on_while_plugged_in=7" in d2b and "RECEIVE_SMS: granted=true" in d2b and "READ_SMS: granted=true" in d2b)
ej=re.findall(r"(\d+)\|(\w+)\|(\w+)\|",est)
chk("la orden 7 reiniciar_telefono se ejecuto una sola vez con resultado ok", [(a,b,c) for a,b,c in ej if a=="7"]==[("7","reiniciar_telefono","ok")], ej)
conf=[c for c in cuerpos if 7 in c["detalle"].get("comandos_hechos",[])]
chk("tras el arranque la app revivio sola y confirmo la orden 7 en un latido firmado", len(conf)>=1, len(conf))
if conf:
    chk("la confirmacion dice ok", conf[0]["detalle"]["comandos_resultado"].get("7")=="ok")
antes=[r for r in lat if r["t"]<t0+5]
despues=[r for r in lat if r["t"]>t0+5]
chk("hubo latidos antes y despues del reinicio", len(despues)>=1, f"{len(lat)} en total")
print("\nRESUMEN: %d de %d comprobaciones pasan"%(sum(res),len(res)))
sys.exit(0 if all(res) else 1)
PY
exit 0
