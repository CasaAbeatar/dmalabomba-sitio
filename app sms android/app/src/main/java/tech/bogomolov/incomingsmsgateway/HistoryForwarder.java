package tech.bogomolov.incomingsmsgateway;

import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * La Bomba 2.6.0: «Reenviar mensajes anteriores».
 * Lee la bandeja de entrada (solo lectura) desde el 1 de enero de 2026, se queda con los mensajes que
 * pasan el MISMO filtro de remitente y de texto de la regla de reenvio (primera regla con firma HMAC),
 * y los manda por el mismo canal firmado (misma URL, misma clave, misma empresa de la plantilla) en lotes
 * pequenos con reintento. Cada lote lleva "historico":true y la fecha ORIGINAL de cada SMS en sentStamp.
 * El servidor deduplica por comprobante del banco: repetir la operacion no duplica nada.
 */
public class HistoryForwarder {

    // 2026-01-01 00:00 hora de Costa Rica (UTC-6) en milisegundos
    public static final long DESDE_MS = 1767247200000L;
    private static final int LOTE_MAX = 20;
    private static final int LOTE_BYTES = 12000;   // el servidor acepta hasta 16 KB por cuerpo
    private static final int INTENTOS = 4;
    private static final int LOTES_FALLIDOS_SEGUIDOS_MAX = 3;

    public interface Listener {
        void onProgress(String texto);
        void onDone(Result r);
    }

    public static class Result {
        public int leidos;        // mensajes de la bandeja desde el 1 de enero
        public int aEnviar;       // los que pasan el filtro de la regla
        public int nuevos;        // guardados por primera vez
        public int repetidos;     // ya estaban (no se duplican)
        public int omitidos;      // el servidor los dejo pasar sin guardar (no son pagos)
        public int fallidos;      // no se pudieron enviar tras los reintentos
        public int sinDetalle;    // enviados pero sin conteo legible en la respuesta
        public boolean cancelado;
        public String error;      // texto para mostrar si no pudo ni empezar
    }

    private volatile boolean cancelar = false;

    public void cancel() {
        cancelar = true;
    }

    private static class Msg {
        final String from, text;
        final long date;
        Msg(String f, String t, long d) { from = f; text = t; date = d; }
    }

    // Se ejecuta en un hilo de fondo (no en el principal).
    public void run(Context ctx, Listener l) {
        Result r = new Result();
        try {
            ForwardingConfig rule = null;
            String empresa = "";
            for (ForwardingConfig c : ForwardingConfig.getAll(ctx)) {
                String k = c.getSignHmacSha256Secret();
                if (c.getSignHmacSha256() && k != null && !k.isEmpty()) {
                    rule = c;
                    Matcher m = Pattern.compile("\"empresa\"\\s*:\\s*\"([A-Za-z]{0,10})\"")
                            .matcher(c.getTemplate() == null ? "" : c.getTemplate());
                    if (m.find()) empresa = m.group(1).toLowerCase();
                    break;
                }
            }
            if (rule == null) { r.error = ctx.getString(R.string.history_no_rule); l.onDone(r); return; }
            if (!empresa.equals("soda") && !empresa.equals("pollos")) { r.error = ctx.getString(R.string.history_no_company); l.onDone(r); return; }

            l.onProgress(ctx.getString(R.string.history_reading));
            String asterisk = ctx.getString(R.string.asterisk);
            ArrayList<Msg> lista = new ArrayList<>();
            Cursor cur = ctx.getContentResolver().query(Uri.parse("content://sms/inbox"),
                    new String[]{"address", "body", "date"}, "date >= ?",
                    new String[]{String.valueOf(DESDE_MS)}, "date ASC");
            if (cur != null) {
                try {
                    while (cur.moveToNext()) {
                        String from = cur.getString(0);
                        String body = cur.getString(1);
                        long date = cur.getLong(2);
                        if (from == null || body == null) continue;
                        r.leidos++;
                        if (SmsBroadcastReceiver.matchesSender(rule, from, asterisk)
                                && SmsBroadcastReceiver.matchesFilter(rule.getSmsFilter(), body)) {
                            lista.add(new Msg(from, body, date));
                        }
                    }
                } finally {
                    cur.close();
                }
            }
            r.aEnviar = lista.size();
            progreso(ctx, l, r, 0);

            int i = 0, seguidos = 0;
            while (i < lista.size() && !cancelar) {
                JSONArray arr = new JSONArray();
                int bytes = 0, n = 0;
                while (i + n < lista.size() && n < LOTE_MAX) {
                    Msg m = lista.get(i + n);
                    int b = m.text.getBytes(StandardCharsets.UTF_8).length + 120;
                    if (n > 0 && bytes + b > LOTE_BYTES) break;
                    JSONObject o = new JSONObject();
                    o.put("from", m.from);
                    o.put("text", m.text.length() > 2000 ? m.text.substring(0, 2000) : m.text);
                    o.put("sentStamp", String.valueOf(m.date));
                    arr.put(o);
                    bytes += b;
                    n++;
                }
                boolean ok = enviarLote(rule, empresa, arr, r);
                if (!ok) {
                    r.fallidos += n;
                    seguidos++;
                } else {
                    seguidos = 0;
                }
                i += n;
                progreso(ctx, l, r, i);
                if (seguidos >= LOTES_FALLIDOS_SEGUIDOS_MAX) {
                    // sin conexion o servidor caido: no tiene caso seguir; lo que falta se cuenta como no enviado
                    r.fallidos += lista.size() - i;
                    break;
                }
            }
            r.cancelado = cancelar;
        } catch (SecurityException e) {
            r.error = ctx.getString(R.string.history_need_permission);
        } catch (Exception e) {
            Log.e("SmsGateway", "history error: " + e);
            r.error = "Error: " + e.getMessage();
        }
        l.onDone(r);
    }

    private void progreso(Context ctx, Listener l, Result r, int procesados) {
        l.onProgress("Mensajes leídos en la bandeja: " + r.leidos
                + "\nDel banco (filtro de la regla): " + r.aEnviar
                + "\nProcesados: " + procesados + " de " + r.aEnviar
                + "\n\nEnviados nuevos: " + r.nuevos
                + "\nRepetidos (ya estaban): " + r.repetidos
                + "\nNo eran pagos: " + r.omitidos
                + "\nFallidos: " + r.fallidos);
    }

    // true si el servidor aceptó el lote (2xx); reintenta con espera creciente y firma nueva cada vez (el ts vale 5 minutos).
    private boolean enviarLote(ForwardingConfig rule, String empresa, JSONArray arr, Result r) {
        for (int intento = 1; intento <= INTENTOS && !cancelar; intento++) {
            try {
                JSONObject cuerpo = new JSONObject();
                cuerpo.put("tipo", "historico");
                cuerpo.put("historico", true);
                cuerpo.put("ts", System.currentTimeMillis());
                cuerpo.put("empresa", empresa);
                cuerpo.put("mensajes", arr);
                String body = cuerpo.toString();
                Request req = new Request(rule.getUrl(), body);
                req.setUseChunkedMode(false);
                req.setIgnoreSsl(rule.getIgnoreSsl());
                req.setSignatureHeader(rule.getSignHmacSha256Secret(), body);
                String res = req.execute();
                if (Request.RESULT_SUCCESS.equals(res)) {
                    try {
                        JSONObject resp = new JSONObject(req.getResponseBody());
                        r.nuevos += resp.optInt("nuevos", 0);
                        r.repetidos += resp.optInt("repetidos", 0);
                        r.omitidos += resp.optInt("omitidos", 0);
                        int f = resp.optInt("fallidos", 0);
                        if (f > 0 && intento < INTENTOS) {
                            // alguno no se guardó: se reintenta el lote (lo ya guardado sale como repetido; no se cuenta dos veces)
                            r.nuevos -= resp.optInt("nuevos", 0);
                            r.repetidos -= resp.optInt("repetidos", 0);
                            r.omitidos -= resp.optInt("omitidos", 0);
                            pausa(intento);
                            continue;
                        }
                        r.fallidos += f;
                    } catch (Exception e) {
                        r.sinDetalle += arr.length();
                    }
                    return true;
                }
                if (req.getResponseCode() >= 400 && req.getResponseCode() < 500 && req.getResponseCode() != 408 && req.getResponseCode() != 429) {
                    return false;   // el servidor lo rechazó (firma, empresa, fecha): reintentar igual no sirve
                }
            } catch (Exception e) {
                Log.e("SmsGateway", "history batch error: " + e);
            }
            pausa(intento);
        }
        return false;
    }

    private void pausa(int intento) {
        try {
            Thread.sleep(2000L * intento);
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        }
    }
}
