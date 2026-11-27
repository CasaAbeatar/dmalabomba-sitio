#!/usr/bin/env bash
# Comprobacion INDEPENDIENTE del paquete (no usa el resumen del propio guion): lee dumpsys, appops y settings del emulador
# y ademas abre la pantalla «Salud del telefono» de la app por toques reales y exige que la propia app diga que cada cosa esta bien.
# Se corre desde la raiz del repositorio con adb del emulador en el PATH.
P=tech.bogomolov.incomingsmsgateway
SDK=$(adb shell getprop ro.build.version.sdk | tr -d '\r')
FALLAS=0
pasa() { echo "PASA  $1"; }
falla() { echo "FALLA $1"; FALLAS=$((FALLAS+1)); }
chk() { if eval "$2"; then pasa "$1"; else falla "$1"; fi; }
mkdir -p resultados
adb shell dumpsys package $P | tr -d '\r' > resultados/dumpsys-package-api$SDK.txt
perm() { grep -q "android.permission.$1: granted=true" resultados/dumpsys-package-api$SDK.txt; }
op() { adb shell cmd appops get $P "$1" | tr -d '\r' | tee -a resultados/appops-api$SDK.txt | grep -qi ": allow"; }

echo "== API $SDK =="
adb shell dumpsys package $P | grep -m2 "versionName\|versionCode"
chk "version 2.12.1 instalada" "grep -q 'versionName=2.12.1' resultados/dumpsys-package-api$SDK.txt"
for p in RECEIVE_SMS READ_SMS ACCESS_FINE_LOCATION ACCESS_COARSE_LOCATION READ_PHONE_STATE ACCESS_BACKGROUND_LOCATION WRITE_SECURE_SETTINGS; do
  chk "permiso $p concedido" "perm $p"
done
[ "$SDK" -ge 33 ] && chk "permiso POST_NOTIFICATIONS concedido" "perm POST_NOTIFICATIONS"
for o in GET_USAGE_STATS SYSTEM_ALERT_WINDOW WRITE_SETTINGS RUN_IN_BACKGROUND RUN_ANY_IN_BACKGROUND REQUEST_INSTALL_PACKAGES; do
  chk "appop $o allow" "op $o"
done
[ "$SDK" -ge 33 ] && chk "appop ACCESS_RESTRICTED_SETTINGS allow" "op ACCESS_RESTRICTED_SETTINGS"
chk "bateria: en la lista blanca de Doze" "adb shell cmd deviceidle whitelist | grep -q $P"
UIDAPP=$(grep -m1 -E '(userId|appId)=[0-9]+' resultados/dumpsys-package-api$SDK.txt | sed -E 's/.*(userId|appId)=([0-9]+).*/\2/')
chk "datos: en la lista blanca de ahorro de datos (uid $UIDAPP)" "adb shell cmd netpolicy list restrict-background-whitelist | tr -d '\\r' | grep -qw $UIDAPP"
chk "ancla en enabled_notification_listeners" "adb shell settings get secure enabled_notification_listeners | grep -q $P/$P.GuardianListenerService"
[ "$SDK" -ge 30 ] && chk "pantalla remota en enabled_accessibility_services" "adb shell settings get secure enabled_accessibility_services | grep -q $P/$P.PantallaRemotaService"
[ "$SDK" -ge 30 ] && chk "accessibility_enabled = 1" "[ \"\$(adb shell settings get secure accessibility_enabled | tr -d '\\r')\" = 1 ]"
[ "$SDK" -ge 30 ] && chk "adb_allowed_connection_time = 0" "[ \"\$(adb shell settings get global adb_allowed_connection_time | tr -d '\\r')\" = 0 ]"
adb shell dumpsys notification | tr -d '\r' > resultados/dumpsys-notification-api$SDK.txt
adb shell dumpsys accessibility | tr -d '\r' > resultados/dumpsys-accessibility-api$SDK.txt
adb shell cmd appops get $P > resultados/appops-completo-api$SDK.txt 2>&1
chk "el sistema tiene ENLAZADA el ancla (servicio vivo)" "awk '/Live notification listeners/{f=1} f&&/GuardianListenerService/{print; exit}' resultados/dumpsys-notification-api$SDK.txt | grep -q ."
[ "$SDK" -ge 30 ] && chk "el sistema tiene enlazada la pantalla remota (accesibilidad)" "grep -q 'PantallaRemotaService' resultados/dumpsys-accessibility-api$SDK.txt"
chk "No molestar: lista de permitidos incluye el paquete" "awk '/Allowed condition providers:/{f=1;next} f&&/Has user set/{exit} f' resultados/dumpsys-notification-api$SDK.txt | grep -q $P"
chk "la app corre" "adb shell pidof $P | grep -q '[0-9]'"

echo "== Lo que dice la propia app en «Salud del telefono» =="
python3 -I - <<'PY'
import re, subprocess, sys, html, time, os
P = "tech.bogomolov.incomingsmsgateway"
def adb(*a):
    return subprocess.run(["adb", *a], capture_output=True, encoding="utf8", errors="replace").stdout
def dump():
    adb("shell", "uiautomator", "dump", "/sdcard/u.xml")
    return adb("shell", "cat", "/sdcard/u.xml")
def tap_id(rid):
    x = dump()
    m = re.search(r'resource-id="[^"]*:id/%s"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"' % rid, x)
    if not m: return False
    adb("shell", "input", "tap", str((int(m[1])+int(m[3]))//2), str((int(m[2])+int(m[4]))//2)); return True
sdk = int(adb("shell", "getprop", "ro.build.version.sdk").strip())
adb("shell", "am", "start", "-n", P + "/" + P + ".MainActivity"); time.sleep(3)
assert tap_id("btn_health"), "no encontre btn_health"
time.sleep(3)
size = re.findall(r"\d+x\d+", adb("shell", "wm", "size"))[-1].split("x"); W, H = int(size[0]), int(size[1])
textos = ""
previo = None
for i in range(25):
    x = html.unescape(dump())
    textos += x
    if x == previo: break
    previo = x
    if i < 8: os.system("adb exec-out screencap -p > resultados/salud-api%d-%d.png" % (sdk, i))
    adb("shell", "input", "swipe", str(W//2), str(H*80//100), str(W//2), str(H*25//100), "400"); time.sleep(1)
open("resultados/salud-api%d.txt" % sdk, "w").write(" | ".join(re.findall(r'text="([^"]+)"', textos)))
estr = open("app sms android/app/src/main/res/values/strings.xml", encoding="utf8").read()
def s(n):
    m = re.search(r'<string name="%s"[^>]*>(.*?)</string>' % n, estr, re.S)
    return html.unescape(m[1]).replace("\\'", "'").replace('\\"', '"').strip()
esperados = [("sms", "h_sms_ok", 0), ("leer sms", "h_read_ok", 0), ("ancla", "h_anchor_ok", 0), ("ajustes seguros", "h_secure_ok", 24),
             ("ubicacion", "h_loc_ok", 0), ("ubicacion siempre", "h_locbg_ok", 29), ("telefono", "h_phone_ok", 0), ("uso de apps", "h_usage_ok", 0),
             ("superposicion", "h_overlay_ok", 23), ("ajustes del sistema", "h_write_ok", 23), ("no molestar", "h_dnd_ok", 23),
             ("avisos", "h_notif_ok", 0), ("bateria", "h_bat_ok", 23), ("ahorro apagado", "h_saver_ok", 0),
             ("pantalla remota", "h_screen_ok", 30)]
if sdk >= 33: esperados.append(("ajustes restringidos", "h_restricted_ok", 33))
malos = 0
for nombre, clave, minsdk in esperados:
    if sdk < minsdk: continue
    t = s(clave)
    ok = t[:40] in textos
    print(("PASA  " if ok else "FALLA ") + "la app dice OK: " + nombre)
    malos += 0 if ok else 1
sys.exit(1 if malos else 0)
PY
[ $? -ne 0 ] && FALLAS=$((FALLAS+1))
adb exec-out screencap -p > resultados/final-api$SDK.png
echo "== fallas: $FALLAS =="
exit $FALLAS
