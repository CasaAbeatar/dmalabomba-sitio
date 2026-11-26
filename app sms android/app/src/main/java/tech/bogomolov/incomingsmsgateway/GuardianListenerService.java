package tech.bogomolov.incomingsmsgateway;

import android.content.ComponentName;
import android.os.Build;
import android.service.notification.NotificationListenerService;

/**
 * La Bomba 2.9.0: ancla para que el app no se quede cerrado. Android mantiene enlazado a un servicio de
 * acceso a notificaciones y lo vuelve a levantar solo si el proceso muere (salvo «Forzar detención»).
 * No lee ni guarda ninguna notificación: solo se usa para revivir el servicio que reenvía los SMS.
 * Funciona únicamente si la persona activa «Acceso a notificaciones» para el app (una vez).
 */
public class GuardianListenerService extends NotificationListenerService {

    private static volatile boolean conectado = false;

    /** true mientras Android tiene enlazado este servicio (lo usa la reactivación automática y Salud). */
    public static boolean conectado() {
        return conectado;
    }

    @Override
    public void onListenerConnected() {
        super.onListenerConnected();
        conectado = true;
        // 2.11.0: si alguien lo encendió (persona o administrador), se borra la anotación de «apagado a mano».
        try {
            new GuardianState(getApplicationContext()).marcarApagadoAMano(GuardianState.AJUSTE_ANCLA, false);
        } catch (Throwable ignored) {
        }
        arrancar();
    }

    @Override
    public void onCreate() {
        super.onCreate();
        arrancar();
    }

    @Override
    public void onListenerDisconnected() {
        super.onListenerDisconnected();
        conectado = false;
        // 2.11.0: si ya no figura en Ajustes, la persona lo apagó a mano: se respeta (no se pide reenlace ni se reactiva).
        Guardian.alDesenlazarAncla(getApplicationContext());
        if (new GuardianState(getApplicationContext()).apagadoAMano(GuardianState.AJUSTE_ANCLA)) {
            arrancar();
            return;
        }
        // Pide a Android que lo vuelva a enlazar de inmediato (API 24+).
        try {
            if (Build.VERSION.SDK_INT >= 24) {
                NotificationListenerService.requestRebind(new ComponentName(this, GuardianListenerService.class));
            }
        } catch (Throwable ignored) {
            // sin efecto
        }
        arrancar();
    }

    // Con el freno central (AntiRebote): onCreate, onListenerConnected y onListenerDisconnected llaman a la vez a esto;
    // startServiceSafely lanza el servicio una sola vez por ventana de 30 s y scheduleWatchers programa como mucho cada 30 s.
    private void arrancar() {
        try {
            if (!SmsReceiverService.isRunning()) Guardian.startServiceSafely(getApplicationContext());
            Guardian.scheduleWatchers(getApplicationContext());
        } catch (Throwable ignored) {
            // nunca debe tumbar el enlace
        }
    }
}
