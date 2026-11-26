package tech.bogomolov.incomingsmsgateway;

import android.Manifest;
import android.content.Context;
import android.util.Log;

import tech.bogomolov.incomingsmsgateway.SmsDespertar.Resultado;

/**
 * La Bomba 2.11.0: pegamento con Android del SMS de despertar (la lógica pura está en SmsDespertar). Valida con la
 * clave de la primera regla con firma HMAC, guarda el contador (con commit, ANTES de ejecutar: un SMS repetido nunca se
 * ejecuta dos veces ni aunque el teléfono se reinicie a mitad), ejecuta la orden de la lista cerrada, manda un latido
 * forzado (lo que el servidor espera) y deja el resultado anotado en GuardianState y en el log. Se llama desde un hilo
 * de fondo (no del principal).
 *
 * Qué NO hace: no reinicia el teléfono, no toca ajustes ni pantalla remota, no habla con nadie más que con el servidor
 * de la regla (el latido). El remitente del SMS no se mira: puede falsificarse; solo vale la firma.
 */
final class SmsDespertarEjecutor {

    private SmsDespertarEjecutor() {
    }

    /** @return el resultado (OK si se ejecutó). */
    static Resultado procesar(Context ctx, String cuerpo) {
        final Context app = ctx.getApplicationContext() != null ? ctx.getApplicationContext() : ctx;
        long ahora = System.currentTimeMillis();
        GuardianState st = new GuardianState(app);
        SmsDespertar.Orden previa = SmsDespertar.analizar(cuerpo);   // solo para anotar (sanitizado al guardar)
        Resultado r;
        SmsDespertar.Orden[] sal = new SmsDespertar.Orden[1];
        try {
            SigningRule regla = SigningRule.find(app);
            r = SmsDespertar.validarOrden(cuerpo, regla == null ? null : regla.secret, st.getSmsContador(), sal);
            if (r == Resultado.OK && !st.aceptarContadorSms(sal[0].contador)) {
                r = Resultado.CONTADOR_REPETIDO;   // otro SMS igual lo ganó entre la lectura y el guardado
            }
        } catch (Throwable e) {
            r = Resultado.ERROR_INTERNO;
            Log.e(Guardian.TAG, "sms despertar: " + e);
        }
        String cmd = sal[0] != null ? sal[0].cmd : previa != null ? previa.cmd : null;
        long contador = sal[0] != null ? sal[0].contador : previa != null ? previa.contador : 0;
        st.registrarSmsDespertar(ahora, cmd, contador, r.name());
        Log.i(Guardian.TAG, "sms despertar: " + r + (cmd != null ? " cmd=" + cmd : "") + " contador=" + contador);
        if (r != Resultado.OK) return r;

        Notificaciones.mostrarReconectando(app);
        try {
            ejecutar(app, sal[0].cmd);
        } catch (Throwable e) {
            Log.e(Guardian.TAG, "sms despertar ejecutar: " + e);
        } finally {
            Notificaciones.ocultarReconectando(app);
        }
        return r;
    }

    private static void ejecutar(Context app, String cmd) {
        switch (cmd) {
            case SmsDespertar.CMD_LATIDO_YA:
                Guardian.startServiceSafely(app);   // con el freno central
                break;
            case SmsDespertar.CMD_REINICIAR_SERVICIO:
                Guardian.reiniciarServicio(app);
                break;
            case SmsDespertar.CMD_REENVIAR_HISTORIAL:
                if (Guardian.tienePermiso(app, Manifest.permission.READ_SMS)) Guardian.reenviarHistorial(app);
                else Log.w(Guardian.TAG, "sms despertar: reenviar_historial sin permiso de leer SMS");
                break;
            default:
                return;   // inalcanzable: la lista cerrada ya filtró
        }
        // El latido forzado es lo que el servidor espera: confirma que el teléfono despertó.
        Log.i(Guardian.TAG, "sms despertar: latido -> " + Guardian.sendHeartbeat(app, true));
    }
}
