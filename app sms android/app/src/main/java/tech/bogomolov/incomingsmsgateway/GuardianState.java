package tech.bogomolov.incomingsmsgateway;

import android.content.Context;
import android.content.SharedPreferences;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * La Bomba 2.7.0: memoria local del Guardián (horas del último SMS, último reenvío, último latido,
 * órdenes ya ejecutadas y confirmaciones manuales de la pantalla Salud). Archivo propio de preferencias,
 * separado de las reglas (ForwardingConfig.getAll lee otro archivo) y sin secretos.
 */
public class GuardianState {

    private static final String PREFERENCE = "guardian";
    private static final String K_ULTIMO_SMS = "ultimo_sms_ts";
    private static final String K_ULTIMO_REENVIO_OK = "ultimo_reenvio_ok_ts";
    private static final String K_HB_INTENTO = "hb_intento_ts";
    private static final String K_HB_OK = "hb_ok_ts";
    private static final String K_CMD_LOG = "cmd_log";
    private static final String K_ACKS = "acks";
    private static final String K_EJECUCIONES = "ejecuciones";
    private static final String K_CONFIRMA_PREFIX = "confirma_";
    private static final int MAX_EJECUCIONES = 50;

    private final SharedPreferences pref;

    public GuardianState(Context context) {
        this.pref = context.getApplicationContext().getSharedPreferences(PREFERENCE, Context.MODE_PRIVATE);
    }

    public long getUltimoSms() { return pref.getLong(K_ULTIMO_SMS, 0); }
    public long getUltimoReenvioOk() { return pref.getLong(K_ULTIMO_REENVIO_OK, 0); }
    public long getUltimoLatidoIntento() { return pref.getLong(K_HB_INTENTO, 0); }
    public long getUltimoLatidoOk() { return pref.getLong(K_HB_OK, 0); }

    public void marcarSmsRecibido(long ahora) { pref.edit().putLong(K_ULTIMO_SMS, ahora).apply(); }
    public void marcarReenvioOk(long ahora) { pref.edit().putLong(K_ULTIMO_REENVIO_OK, ahora).apply(); }
    public void marcarLatidoIntento(long ahora) { pref.edit().putLong(K_HB_INTENTO, ahora).commit(); }
    public void marcarLatidoOk(long ahora) { pref.edit().putLong(K_HB_OK, ahora).apply(); }

    // ---- órdenes remotas ----

    public synchronized RemoteCommands.CommandLog getCommandLog() {
        return RemoteCommands.CommandLog.fromString(pref.getString(K_CMD_LOG, ""));
    }

    /**
     * Registra (con commit, antes de ejecutar: si la orden reinicia el teléfono el registro ya quedó) que
     * la orden se va a ejecutar, y deja su confirmación pendiente para el siguiente latido.
     */
    public synchronized void registrarOrden(long id, String cmd, String resultado, long ahora) {
        RemoteCommands.CommandLog log = getCommandLog();
        log.add(id);
        Map<Long, String> acks = getAcksPendientes();
        acks.put(id, resultado);
        String ej = pref.getString(K_EJECUCIONES, "");
        ej = (ej.isEmpty() ? "" : ej + "\n") + id + "|" + cmd + "|" + resultado + "|" + ahora;
        String[] lineas = ej.split("\n");
        if (lineas.length > MAX_EJECUCIONES) {
            StringBuilder b = new StringBuilder();
            for (int i = lineas.length - MAX_EJECUCIONES; i < lineas.length; i++) {
                if (b.length() > 0) b.append('\n');
                b.append(lineas[i]);
            }
            ej = b.toString();
        }
        pref.edit().putString(K_CMD_LOG, log.toString())
                .putString(K_ACKS, serializarAcks(acks))
                .putString(K_EJECUCIONES, ej).commit();
    }

    /** Cuántas veces se registró la ejecución de este id (debe ser 0 o 1). Para diagnóstico y pruebas. */
    public int vecesEjecutada(long id) {
        int n = 0;
        for (String l : pref.getString(K_EJECUCIONES, "").split("\n")) {
            if (l.startsWith(id + "|")) n++;
        }
        return n;
    }

    public String getEjecuciones() { return pref.getString(K_EJECUCIONES, ""); }

    public synchronized Map<Long, String> getAcksPendientes() {
        Map<Long, String> m = new LinkedHashMap<>();
        String s = pref.getString(K_ACKS, "");
        for (String p : s.split(",")) {
            int i = p.indexOf('=');
            if (i <= 0) continue;
            try {
                m.put(Long.parseLong(p.substring(0, i)), p.substring(i + 1));
            } catch (NumberFormatException ignored) {
            }
        }
        return m;
    }

    /** Quita las confirmaciones que un latido ya llevó al servidor (2xx). */
    public synchronized void quitarAcks(Iterable<Long> ids) {
        Map<Long, String> acks = getAcksPendientes();
        for (Long id : ids) acks.remove(id);
        pref.edit().putString(K_ACKS, serializarAcks(acks)).commit();
    }

    private static String serializarAcks(Map<Long, String> acks) {
        StringBuilder b = new StringBuilder();
        for (Map.Entry<Long, String> e : acks.entrySet()) {
            if (b.length() > 0) b.append(',');
            b.append(e.getKey()).append('=').append(e.getValue().replaceAll("[^a-z0-9_]", "_"));
        }
        return b.toString();
    }

    // ---- confirmaciones manuales de la pantalla Salud (lo que Android no deja leer) ----

    public boolean confirmado(String clave) { return pref.getBoolean(K_CONFIRMA_PREFIX + clave, false); }
    public void confirmar(String clave, boolean valor) { pref.edit().putBoolean(K_CONFIRMA_PREFIX + clave, valor).apply(); }
}
