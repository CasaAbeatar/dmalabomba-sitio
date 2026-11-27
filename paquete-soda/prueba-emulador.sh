#!/usr/bin/env bash
# Corre el paquete de comandos en el emulador (API del matrix) y lo comprueba. Desde la raiz del repositorio.
P=tech.bogomolov.incomingsmsgateway
mkdir -p resultados
RC=0
echo "##### A. APK alterado: el guion debe DETENERSE sin instalar"
cp apk-real.apk apk-alterado.apk && printf 'x' >> apk-alterado.apk
ADB=adb APK_LOCAL=apk-alterado.apk bash paquete-soda/configurar-telefono-soda.sh; R=$?
echo "codigo de salida: $R"
if [ $R -ne 0 ] && ! adb shell pm path $P | grep -q package; then echo "PASA  se detuvo con SHA malo y no instalo"; else echo "FALLA: con SHA malo salio $R o se instalo"; RC=1; fi
echo "##### B. Primera corrida (instalacion nueva)"
ADB=adb APK_LOCAL=apk-real.apk bash paquete-soda/configurar-telefono-soda.sh | tee resultados/corrida1-api$(adb shell getprop ro.build.version.sdk | tr -d '\r').txt
echo "codigo de salida corrida 1: ${PIPESTATUS[0]}"
echo "##### B2. Verificacion independiente de la PRIMERA corrida (instalacion nueva)"
bash paquete-soda/verificar-emulador.sh || RC=1
echo "##### C. Segunda corrida, ahora por tuberia (cat | bash) y encima de la instalada: idempotencia"
cat paquete-soda/configurar-telefono-soda.sh | ADB=adb APK_LOCAL=apk-real.apk SIN_TCPIP=1 bash | tee resultados/corrida2-api$(adb shell getprop ro.build.version.sdk | tr -d '\r').txt
echo "codigo de salida corrida 2: ${PIPESTATUS[1]}"
echo "##### D. Verificacion independiente"
bash paquete-soda/verificar-emulador.sh || RC=1
exit $RC
