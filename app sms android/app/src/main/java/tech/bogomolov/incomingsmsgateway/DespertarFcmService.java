package tech.bogomolov.incomingsmsgateway;

import android.content.Context;
import android.os.Build;
import android.util.Log;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

/**
 * La Bomba 2.11.0: despertar por FCM. El servidor manda un mensaje SOLO de datos y de prioridad alta:
 * {tipo:"despertar", despertar_id, titulo:"Reconectando...", ts}. (Sin bloque «notification»: con él Android no llamaría
 * a onMessageReceived con el app en segundo plano.) El teléfono:
 *
 *   1. valida (DespertarFcm.analizar): tipo exacto «despertar», id y ts numéricos, ts reciente; lo demás se ignora;
 *   2. muestra la notificación visible «Reconectando...» (si un mensaje de prioridad alta no deja una notificación
 *      visible, FCM degrada la prioridad de los siguientes y un mensaje degradado ya no puede arrancar un servicio en
 *      primer plano);
 *   3. levanta el servicio SOLO si el mensaje llegó con prioridad ALTA (getPriority() == HIGH) o el Android es anterior a
 *      el 12: con prioridad normal Android 12+ lanza ForegroundServiceStartNotAllowedException; se atrapa, y el latido
 *      sale igual (la ventana de un mensaje FCM alcanza para un latido corto);
 *   4. manda un latido forzado con detalle.despertar_id (la confirmación que espera el servidor);
 *   5. cancela la notificación.
 *
 * El despertar NO relanza nada más que el servicio (con el freno central de AntiRebote): su trabajo es el latido.
 */
public class DespertarFcmService extends FirebaseMessagingService {

    /** Tope de espera del latido dentro de onMessageReceived (Android da ~20 s a FCM). */
    static final long LATIDO_MAX_MS = 15_000L;

    @Override
    public void onNewToken(String token) {
        super.onNewToken(token);
        FcmInicio.alNuevoToken(getApplicationContext(), token);
    }

    @Override
    public void onMessageReceived(RemoteMessage mensaje) {
        boolean alta = false;
        try {
            alta = mensaje.getPriority() == RemoteMessage.PRIORITY_HIGH;
        } catch (Throwable ignored) {
        }
        atender(getApplicationContext(), mensaje.getData(), alta, System.currentTimeMillis());
    }

    /** Resultado de atender un mensaje (para las pruebas y el log). */
    enum Resultado { ATENDIDO, ATENDIDO_SIN_SERVICIO, IGNORADO, REPETIDO, ERROR }

    /**
     * Todo el despertar, separado de FirebaseMessagingService para poder probarlo sin FCM.
     * @param alta true si el mensaje llegó con prioridad ALTA (getPriority() == PRIORITY_HIGH)
     */
    static Resultado atender(final Context app, java.util.Map<String, String> datos, boolean alta, long ahora) {
        try {
            DespertarFcm.Orden orden = DespertarFcm.analizar(datos, ahora);
            if (orden == null) {
                Log.i(Guardian.TAG, "FCM: mensaje ignorado (no es un despertar valido y reciente)");
                return Resultado.IGNORADO;
            }
            GuardianState st = new GuardianState(app);
            if (!DespertarFcm.debeAtender(st.getDespertarIdUltimo(), st.getDespertarTsUltimo(), orden.despertarId, ahora)) {
                Log.i(Guardian.TAG, "FCM: despertar " + orden.despertarId + " repetido, se ignora");
                return Resultado.REPETIDO;
            }
            st.marcarDespertar(orden.despertarId, ahora);
            Log.i(Guardian.TAG, "FCM: despertar " + orden.despertarId);
            Notificaciones.mostrarReconectando(app);
            Resultado r = Resultado.ATENDIDO;
            try {
                if (alta || Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
                    // startServiceSafely atrapa ForegroundServiceStartNotAllowedException; con el freno central no relanza de más.
                    Guardian.startServiceSafely(app);
                } else {
                    r = Resultado.ATENDIDO_SIN_SERVICIO;
                    Log.w(Guardian.TAG, "FCM: prioridad degradada: no se arranca el servicio en primer plano, solo el latido");
                }
                latidoConEspera(app, orden.despertarId);
            } finally {
                Notificaciones.ocultarReconectando(app);
            }
            return r;
        } catch (Throwable e) {
            // nunca debe tumbar el proceso de FCM
            Log.e(Guardian.TAG, "FCM onMessageReceived: " + e);
            try {
                Notificaciones.ocultarReconectando(app);
            } catch (Throwable ignored) {
            }
            return Resultado.ERROR;
        }
    }

    /** Manda el latido del despertar en un hilo y espera como mucho LATIDO_MAX_MS (FCM da unos 20 s). */
    private static void latidoConEspera(final Context app, final long despertarId) {
        Thread t = new Thread(() -> {
            try {
                Log.i(Guardian.TAG, "FCM: latido del despertar " + despertarId + " -> " + Guardian.sendHeartbeatDespertar(app, despertarId));
            } catch (Throwable e) {
                Log.e(Guardian.TAG, "FCM latido: " + e);
            }
        }, "FcmDespertar");
        t.start();
        try {
            t.join(LATIDO_MAX_MS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
