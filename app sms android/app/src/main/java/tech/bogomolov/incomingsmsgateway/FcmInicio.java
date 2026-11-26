package tech.bogomolov.incomingsmsgateway;

import android.content.Context;
import android.os.Build;
import android.os.UserManager;
import android.util.Log;

import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import com.google.firebase.messaging.FirebaseMessaging;

/**
 * La Bomba 2.11.0: arranque de Firebase Cloud Messaging SIN el plugin de google-services (el app no lleva
 * google-services.json): FirebaseApp se inicia a mano con FirebaseOptions. Proyecto «la-bomba-sms».
 *
 * La llave de API de un app Android de Firebase NO es un secreto (va en todo APK; Google la acota por paquete y por
 * firma). La llave de cuenta de servicio, esa sí secreta, vive solo en la bóveda del servidor.
 *
 * Todo va en try/catch: sin Google Play Services (o con un Android sin FCM) el app sigue funcionando igual, solo que
 * sin despertar por FCM (queda el SMS de despertar y los vigilantes).
 */
final class FcmInicio {

    private static final String PROJECT_ID = "la-bomba-sms";
    private static final String APPLICATION_ID = "1:948031627454:android:c2783ea7de4719982a3eef";
    private static final String API_KEY = "AIzaSyDQBQzkzyeokrFgf3wGwTGgDuhnIso-JPk";
    private static final String GCM_SENDER_ID = "948031627454";

    private FcmInicio() {
    }

    /** Inicia FirebaseApp (una sola vez) y pide el token. Seguro de repetir; nunca lanza. */
    static void iniciar(Context ctx) {
        try {
            Context app = ctx.getApplicationContext() != null ? ctx.getApplicationContext() : ctx;
            // Con el teléfono bloqueado desde el arranque (LOCKED_BOOT_COMPLETED) no hay almacenamiento del app: se espera.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                UserManager um = (UserManager) app.getSystemService(Context.USER_SERVICE);
                if (um != null && !um.isUserUnlocked()) return;
            }
            if (FirebaseApp.getApps(app).isEmpty()) {
                FirebaseOptions o = new FirebaseOptions.Builder()
                        .setProjectId(PROJECT_ID)
                        .setApplicationId(APPLICATION_ID)
                        .setApiKey(API_KEY)
                        .setGcmSenderId(GCM_SENDER_ID)
                        .build();
                FirebaseApp.initializeApp(app, o);
            }
            final Context fin = app;
            FirebaseMessaging.getInstance().getToken().addOnCompleteListener(tarea -> {
                try {
                    if (tarea.isSuccessful() && tarea.getResult() != null) {
                        alTokenDeFirebase(fin, tarea.getResult());
                    } else {
                        Log.w(Guardian.TAG, "FCM: sin token (¿sin Google Play Services?): " + tarea.getException());
                    }
                } catch (Throwable e) {
                    Log.w(Guardian.TAG, "FCM token: " + e);
                }
            });
        } catch (Throwable e) {
            Log.w(Guardian.TAG, "FCM no disponible: " + e);
        }
    }

    /**
     * Solo para las pruebas instrumentadas: Firebase entrega el token REAL en cualquier momento y eso manda un latido
     * forzado que ensuciaría el conteo de latidos del servidor falso. Con true se ignora el token que llega de Firebase
     * (alNuevoToken, llamado a mano por la prueba, sigue funcionando). En producción nunca se activa.
     */
    static volatile boolean ignorarTokenDeFirebase = false;

    /** Punto de entrada de los tokens que entrega Firebase (getToken y onNewToken). */
    static void alTokenDeFirebase(Context ctx, String token) {
        if (ignorarTokenDeFirebase) return;
        alNuevoToken(ctx, token);
    }

    /** Guarda el token y, si cambió, fuerza un latido para que el servidor lo conozca de inmediato. */
    static void alNuevoToken(final Context ctx, String token) {
        final Context app = ctx.getApplicationContext() != null ? ctx.getApplicationContext() : ctx;
        try {
            if (!DespertarFcm.tokenValido(token)) {
                Log.w(Guardian.TAG, "FCM: token con forma inesperada, se ignora");
                return;
            }
            if (new GuardianState(app).guardarFcmToken(token)) {
                Log.i(Guardian.TAG, "FCM: token nuevo guardado; latido forzado");
                new Thread(() -> {
                    try {
                        Guardian.sendHeartbeat(app, true);
                    } catch (Throwable e) {
                        Log.w(Guardian.TAG, "latido por token: " + e);
                    }
                }, "FcmToken").start();
            }
        } catch (Throwable e) {
            Log.w(Guardian.TAG, "FCM nuevo token: " + e);
        }
    }
}
