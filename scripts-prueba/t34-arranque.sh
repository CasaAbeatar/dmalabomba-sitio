#!/bin/bash
# Prueba de la rama targetSdk 34 (se corre desde "app sms android", DESPUES de guardian-e2e.sh: la app sigue instalada con su regla).
# 1) el servicio de reenvio corre en primer plano con el tipo specialUse   2) reinicio del telefono: BOOT_COMPLETED lo vuelve a arrancar
# 3) tras reiniciar llega un SMS y se reenvia al servidor falso   4) ningun error de tipo de servicio / arranque prohibido en el log
P=tech.bogomolov.incomingsmsgateway
SALIDA=t34-arranque.txt
: > "$SALIDA"
FALLAS=0
bien() { echo "BIEN: $*" | tee -a "$SALIDA"; }
mal()  { echo "MAL:  $*" | tee -a "$SALIDA"; FALLAS=$((FALLAS+1)); }
nota() { echo "=== $(date +%H:%M:%S) $*" | tee -a "$SALIDA"; }
servicio_en_primer_plano() { adb shell dumpsys activity services $P/.SmsReceiverService 2>/dev/null | tr -d '\r'; }
esperar_servicio() {  # $1 = segundos
  for i in $(seq 1 $(( $1 / 5 ))); do
    if servicio_en_primer_plano | grep -q "isForeground=true"; then return 0; fi
    sleep 5
  done
  return 1
}

SDK=$(adb shell getprop ro.build.version.sdk | tr -d '\r')
nota "API $SDK, targetSdk de la app: $(adb shell dumpsys package $P | grep -m1 -o 'targetSdk=[0-9]*')"
adb shell dumpsys package $P | grep -m1 -o 'targetSdk=[0-9]*' | grep -q 'targetSdk=34' && bien "la app instalada declara targetSdk=34" || mal "la app instalada no declara targetSdk=34"

nota "1. servicio en primer plano y su tipo"
adb shell am start -n $P/.MainActivity >/dev/null 2>&1; sleep 3
if esperar_servicio 60; then bien "SmsReceiverService en primer plano (isForeground=true)"; else mal "SmsReceiverService no esta en primer plano"; fi
servicio_en_primer_plano > t34-servicio-antes.txt
if [ "$SDK" -lt 34 ]; then bien "API $SDK: el tipo de servicio lo entiende Android 14+; aqui se ignora (el servicio arranca igual)"; elif grep -qiE "types=(0x)?40000000|foregroundServiceType=0x40000000|specialUse" t34-servicio-antes.txt; then bien "tipo de servicio en primer plano: specialUse"; else mal "no se ve el tipo specialUse en dumpsys: $(grep -iE "isForeground|types=" t34-servicio-antes.txt | head -2)"; fi

nota "2. reiniciar el telefono (BOOT_COMPLETED debe volver a arrancar el servicio en primer plano)"
python3 ../scripts-prueba/guardian-mock.py & echo $! > srv-t34.pid
sleep 2
adb logcat -c
adb reboot
adb wait-for-device
for i in $(seq 1 60); do [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ] && break; sleep 5; done
sleep 10
adb shell input keyevent KEYCODE_WAKEUP; adb shell wm dismiss-keyguard
if esperar_servicio 180; then bien "tras reiniciar, el servicio volvio solo a primer plano (sin abrir la app)"; else mal "tras reiniciar el servicio no volvio a primer plano"; fi
servicio_en_primer_plano > t34-servicio-despues.txt
{ [ "$SDK" -lt 34 ] || grep -qiE "types=(0x)?40000000|foregroundServiceType=0x40000000|specialUse" t34-servicio-despues.txt; } && bien "tras reiniciar sigue con el tipo specialUse" || mal "tras reiniciar no se ve el tipo specialUse"

nota "3. SMS despues del reinicio: debe llegar al servidor falso"
sleep 5
adb emu sms send 4066 "Recibiste un SINPE Movil por 7000 colones de DESPUES REINICIO. Comprobante 333"
for i in $(seq 1 12); do grep -q "DESPUES REINICIO" guardian-recibidos.jsonl 2>/dev/null && break; sleep 5; done
grep -q "DESPUES REINICIO" guardian-recibidos.jsonl 2>/dev/null && bien "el SMS recibido tras reiniciar se reenvio al servidor" || mal "el SMS posterior al reinicio no llego al servidor"

nota "4. errores propios de targetSdk 34 en el log"
adb logcat -d > t34-logcat.txt
if grep -E "MissingForegroundServiceTypeException|InvalidForegroundServiceTypeException|ForegroundServiceStartNotAllowedException|SecurityException.*(FOREGROUND_SERVICE|foreground service)|One of RECEIVER_EXPORTED or RECEIVER_NOT_EXPORTED" t34-logcat.txt | grep -i "$P\|tech.bogomolov" ; then mal "hay errores de servicio en primer plano o de receptor en el log"; else bien "sin errores de tipo de servicio, arranque prohibido ni receptor sin bandera"; fi

kill $(cat srv-t34.pid) 2>/dev/null
echo "fallas: $FALLAS" | tee -a "$SALIDA"
echo "$FALLAS" > t34-rc.txt
exit 0
