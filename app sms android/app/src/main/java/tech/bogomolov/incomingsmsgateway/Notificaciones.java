package tech.bogomolov.incomingsmsgateway;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.os.Build;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

/**
 * La Bomba 2.11.0: las dos notificaciones nuevas, cada una en su propio canal (importancia baja: sin sonido, pero VISIBLES).
 *
 *  - «Reconectando...»: la muestra el despertar por FCM. Es obligatoria: si un mensaje de prioridad alta no produce una
 *    notificación visible, FCM le baja la prioridad a las siguientes del app y un mensaje degradado ya no puede arrancar
 *    un servicio en primer plano. Se cancela al terminar el despertar (y se vence sola a los 60 s por si algo falla).
 *  - «Control remoto activo»: fija mientras hay una sesión de pantalla remota abierta (que se vea siempre que alguien
 *    puede ver y tocar el teléfono).
 *
 * Sin el permiso de notificaciones (Android 13+) Android simplemente no las muestra; nada de esto debe tumbar al app.
 */
final class Notificaciones {

    static final String CANAL_DESPERTAR = "Despertar";
    static final String CANAL_CONTROL = "ControlRemoto";
    static final int ID_DESPERTAR = 2;
    static final int ID_CONTROL = 3;

    private Notificaciones() {
    }

    private static void crearCanal(Context ctx, String id, int nombre) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null) return;
        NotificationChannel c = new NotificationChannel(id, ctx.getText(nombre), NotificationManager.IMPORTANCE_LOW);
        c.setShowBadge(false);
        nm.createNotificationChannel(c);
    }

    private static void mostrar(Context ctx, String canal, int idCanalNombre, int id, int titulo, int texto, boolean fija, long vencerMs) {
        try {
            crearCanal(ctx, canal, idCanalNombre);
            NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, canal)
                    .setSmallIcon(R.drawable.ic_f)
                    .setContentTitle(ctx.getText(titulo))
                    .setPriority(NotificationCompat.PRIORITY_LOW)
                    .setCategory(NotificationCompat.CATEGORY_STATUS)
                    .setOnlyAlertOnce(true)
                    .setOngoing(fija);
            if (texto != 0) b.setContentText(ctx.getText(texto));
            if (vencerMs > 0 && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) b.setTimeoutAfter(vencerMs);
            NotificationManagerCompat.from(ctx).notify(id, b.build());
        } catch (Throwable e) {
            Log.e(Guardian.TAG, "notificacion " + id + ": " + e);
        }
    }

    private static void ocultar(Context ctx, int id) {
        try {
            NotificationManagerCompat.from(ctx).cancel(id);
        } catch (Throwable ignored) {
        }
    }

    static void mostrarReconectando(Context ctx) {
        mostrar(ctx, CANAL_DESPERTAR, R.string.wake_channel, ID_DESPERTAR, R.string.wake_notification, 0, false, 60_000L);
    }

    static void ocultarReconectando(Context ctx) {
        ocultar(ctx, ID_DESPERTAR);
    }

    static void mostrarControlRemoto(Context ctx) {
        mostrar(ctx, CANAL_CONTROL, R.string.remote_channel, ID_CONTROL, R.string.remote_notification,
                R.string.remote_notification_text, true, 0);
    }

    static void ocultarControlRemoto(Context ctx) {
        ocultar(ctx, ID_CONTROL);
    }
}
