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

    @Override
    public void onListenerConnected() {
        super.onListenerConnected();
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

    private void arrancar() {
        try {
            if (!SmsReceiverService.isRunning()) Guardian.startServiceSafely(getApplicationContext());
            Guardian.scheduleWatchers(getApplicationContext());
        } catch (Throwable ignored) {
            // nunca debe tumbar el enlace
        }
    }
}
