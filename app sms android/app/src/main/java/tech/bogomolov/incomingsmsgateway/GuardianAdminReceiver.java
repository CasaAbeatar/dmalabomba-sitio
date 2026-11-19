package tech.bogomolov.incomingsmsgateway;

import android.app.admin.DeviceAdminReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * La Bomba 2.7.0: receptor mínimo para el modo «teléfono dedicado» (Device Owner). No hace nada por sí solo:
 * solo cobra efecto si el dueño ejecuta `dpm set-device-owner` con adb (ver «Guia telefono dedicado SINPE.md»).
 * No declara ninguna política en res/xml/device_admin.xml; las acciones de Device Owner no las necesitan.
 */
public class GuardianAdminReceiver extends DeviceAdminReceiver {
    @Override
    public void onEnabled(Context context, Intent intent) {
        Guardian.aplicarPoliticasDedicado(context);
    }
}
