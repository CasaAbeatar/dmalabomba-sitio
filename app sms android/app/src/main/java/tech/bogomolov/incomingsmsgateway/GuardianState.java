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
    private static final String K_RETRASO = "hb_retraso_ms";
    private static final String K_REINICIOS = "reinicios_servicio";
    private static final String K_CMD_LOG = "cmd_log";
    private static final String K_ACKS = "acks";
    private static final String K_EJECUCIONES = "ejecuciones";
    private static final String K_CONFIRMA_PREFIX = "confirma_";
    private static final int MAX_EJECUCIONES = 50;
    // 2.11.0
    private static final String K_FCM_TOKEN = "fcm_token";
    private static final String K_SMS_CONTADOR = "sms_despertar_contador";
    private static final String K_SMS_LOG = "sms_despertar_log";
    private static final String K_DESPERTAR_ID = "despertar_id_ultimo";
    private static final String K_DESPERTAR_TS = "despertar_ts_ultimo";
    private static final String K_APAGADO_PREFIX = "apagado_a_mano_";
    private static final int MAX_SMS_LOG = 20;
    /** Claves de «apagado a mano» (ver apagadoAMano). */
    public static final String AJUSTE_PANTALLA = "pantalla";
    public static final String AJUSTE_ANCLA = "ancla";

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

    /** 2.8.0: atraso (ms) del último latido periódico frente a lo planeado; -1 si aún no hay dato. */
    public long getLatidoRetrasoMs() { return pref.getLong(K_RETRASO, -1); }
    public void marcarLatidoRetraso(long ms) { pref.edit().putLong(K_RETRASO, Math.max(0, ms)).apply(); }
    /** 2.8.0: cuántas veces arrancó el servicio desde la instalación. */
    public int getReiniciosServicio() { return pref.getInt(K_REINICIOS, 0); }
    public void contarReinicioServicio() { pref.edit().putInt(K_REINICIOS, getReiniciosServicio() + 1).apply(); }

    // ---- 2.11.0: token de FCM ----

    public String getFcmToken() { return pref.getString(K_FCM_TOKEN, ""); }

    /** @return true si el token cambió (hay que avisarle al servidor con un latido). */
    public boolean guardarFcmToken(String token) {
        String nuevo = token == null ? "" : token;
        if (nuevo.equals(getFcmToken())) return false;
        pref.edit().putString(K_FCM_TOKEN, nuevo).commit();
        return true;
    }

    // ---- 2.11.0: despertar por FCM (último atendido, contra entregas repetidas) ----

    public long getDespertarIdUltimo() { return pref.getLong(K_DESPERTAR_ID, 0); }
    public long getDespertarTsUltimo() { return pref.getLong(K_DESPERTAR_TS, 0); }
    public void marcarDespertar(long id, long ahora) {
        pref.edit().putLong(K_DESPERTAR_ID, id).putLong(K_DESPERTAR_TS, ahora).commit();
    }

    // ---- 2.11.0: SMS de despertar ----

    public long getSmsContador() { return pref.getLong(K_SMS_CONTADOR, 0); }

    /**
     * Guarda (con commit y de forma atómica) el contador de un SMS de despertar ya validado, ANTES de ejecutar la orden.
     * @return false si el contador ya no es mayor que el guardado (otro SMS lo ganó): no se ejecuta.
     */
    public synchronized boolean aceptarContadorSms(long contador) {
        if (contador <= getSmsContador()) return false;
        return pref.edit().putLong(K_SMS_CONTADOR, contador).commit();
    }

    /** Anota el resultado de un SMS de despertar (acotado a los últimos MAX_SMS_LOG). Nunca guarda la firma ni la clave. */
    public synchronized void registrarSmsDespertar(long ahora, String cmd, long contador, String resultado) {
        String l = pref.getString(K_SMS_LOG, "");
        l = (l.isEmpty() ? "" : l + "\n") + ahora + "|" + (cmd == null ? "-" : cmd.replaceAll("[^a-z_]", "")) + "|" + contador + "|"
                + (resultado == null ? "-" : resultado.replaceAll("[^A-Za-z0-9_]", ""));
        String[] lineas = l.split("\n");
        if (lineas.length > MAX_SMS_LOG) {
            StringBuilder b = new StringBuilder();
            for (int i = lineas.length - MAX_SMS_LOG; i < lineas.length; i++) {
                if (b.length() > 0) b.append('\n');
                b.append(lineas[i]);
            }
            l = b.toString();
        }
        pref.edit().putString(K_SMS_LOG, l).commit();
    }

    public String getSmsLog() { return pref.getString(K_SMS_LOG, ""); }

    // ---- 2.11.0: respetar el apagado a mano de un servicio de Ajustes seguros ----

    /**
     * true si la persona apagó este servicio (accesibilidad de pantalla remota o acceso a notificaciones) a mano en
     * Ajustes. Mientras esté, la reactivación automática NO lo vuelve a encender. Se borra cuando se vuelve a conectar
     * (alguien lo encendió) o cuando el administrador lo reactiva a propósito desde «Salud del teléfono».
     */
    public boolean apagadoAMano(String ajuste) { return pref.getBoolean(K_APAGADO_PREFIX + ajuste, false); }
    public void marcarApagadoAMano(String ajuste, boolean valor) {
        pref.edit().putBoolean(K_APAGADO_PREFIX + ajuste, valor).commit();
    }

    // ---- 2.12.0: actualización automática de la app (ver Actualizador) ----

    private static final String K_UPD_ESTADO = "upd_estado";
    private static final String K_UPD_DETALLE = "upd_detalle";
    private static final String K_UPD_VERSION = "upd_version";
    private static final String K_UPD_TS = "upd_estado_ts";
    private static final String K_UPD_VC = "upd_vc";
    private static final String K_UPD_CUENTA = "upd_cuenta";
    private static final String K_UPD_ULTIMO = "upd_ultimo_ts";

    /** ninguna | descargando | instalando | fallo */
    public String getUpdEstado() { return pref.getString(K_UPD_ESTADO, "ninguna"); }
    public String getUpdDetalle() { return pref.getString(K_UPD_DETALLE, ""); }
    public String getUpdVersion() { return pref.getString(K_UPD_VERSION, ""); }
    public long getUpdEstadoTs() { return pref.getLong(K_UPD_TS, 0); }
    public int getUpdVc() { return pref.getInt(K_UPD_VC, 0); }
    public int getUpdCuenta() { return pref.getInt(K_UPD_CUENTA, 0); }
    public long getUpdUltimoIntento() { return pref.getLong(K_UPD_ULTIMO, 0); }

    public synchronized void setUpdEstado(String estado, String detalle, String version, long ahora) {
        pref.edit().putString(K_UPD_ESTADO, estado).putString(K_UPD_DETALLE, detalle == null ? "" : detalle)
                .putString(K_UPD_VERSION, version == null ? "" : version).putLong(K_UPD_TS, ahora).commit();
    }

    /** Anota un intento nuevo de instalar la versión {@code vc} (si es otra versión, la cuenta empieza de cero). @return intentos hechos de esa versión. */
    public synchronized int contarIntentoUpd(int vc, long ahora) {
        int cuenta = (getUpdVc() == vc ? getUpdCuenta() : 0) + 1;
        pref.edit().putInt(K_UPD_VC, vc).putInt(K_UPD_CUENTA, cuenta).putLong(K_UPD_ULTIMO, ahora).commit();
        return cuenta;
    }

    /** Intentos ya hechos de la versión {@code vc} (0 si es otra). */
    public int intentosUpd(int vc) { return getUpdVc() == vc ? getUpdCuenta() : 0; }

    /** Devuelve el intento (se abandonó antes de instalar por no ser momento seguro: no cuenta contra los 3). */
    public synchronized void devolverIntentoUpd(int vc) {
        if (getUpdVc() != vc) return;
        pref.edit().putInt(K_UPD_CUENTA, Math.max(0, getUpdCuenta() - 1)).commit();
    }

    // Auditoría 2.12.0: descargas de actualización de las últimas 24 h, de cualquier versión (tope global; ver ActualizacionPolitica).
    private static final String K_UPD_DESCARGAS = "upd_descargas_ts";

    public synchronized long[] getUpdDescargas() {
        String s = pref.getString(K_UPD_DESCARGAS, "");
        java.util.List<Long> l = new java.util.ArrayList<>();
        for (String p : s.split(",")) {
            try {
                if (!p.trim().isEmpty()) l.add(Long.parseLong(p.trim()));
            } catch (NumberFormatException ignored) {
            }
        }
        long[] out = new long[l.size()];
        for (int i = 0; i < out.length; i++) out[i] = l.get(i);
        return out;
    }

    /** Anota una descarga de actualización (se cuente o no el intento por versión) y olvida las de hace más de 24 h. */
    public synchronized void registrarDescargaUpd(long ahora) {
        long[] viejas = ActualizacionPolitica.podarDescargas(getUpdDescargas(), ahora);
        StringBuilder b = new StringBuilder();
        for (long t : viejas) b.append(t).append(',');
        b.append(ahora);
        pref.edit().putString(K_UPD_DESCARGAS, b.toString()).commit();
    }

    /** Quita la descarga más reciente del tope diario (un intento que no pudo conectar a nada no gastó datos ni cuenta). */
    public synchronized void quitarUltimaDescargaUpd() {
        long[] l = getUpdDescargas();
        if (l.length == 0) return;
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < l.length - 1; i++) b.append(l[i]).append(',');
        pref.edit().putString(K_UPD_DESCARGAS, b.toString()).commit();
    }

    // 27 nov 2026: última oferta de actualización ya verificada (ver ActualizacionPolitica.ofertaAJson).
    private static final String K_UPD_OFERTA = "upd_oferta_cache";

    public synchronized ActualizacionPolitica.Oferta getOfertaUpd(boolean depuracion) {
        return ActualizacionPolitica.ofertaDeJson(pref.getString(K_UPD_OFERTA, ""), depuracion);
    }

    public synchronized void guardarOfertaUpd(ActualizacionPolitica.Oferta o) {
        pref.edit().putString(K_UPD_OFERTA, ActualizacionPolitica.ofertaAJson(o)).commit();
    }

    public synchronized void limpiarOfertaUpd() {
        pref.edit().remove(K_UPD_OFERTA).commit();
    }

    public synchronized void limpiarIntentosUpd() {
        pref.edit().remove(K_UPD_VC).remove(K_UPD_CUENTA).remove(K_UPD_ULTIMO).commit();
    }

    // ---- 2.12.0: «reenviar historial» terminado sin fallos (cuenta como reenvío para el autochequeo de la bandeja) ----

    private static final String K_HISTORIAL_OK = "historial_ok_ts";
    public long getHistorialOkTs() { return pref.getLong(K_HISTORIAL_OK, 0); }
    public void marcarHistorialOk(long ahora) { pref.edit().putLong(K_HISTORIAL_OK, ahora).commit(); }

    // ---- 2.12.0: depuración inalámbrica a pedido (ver AdbInalambrico) ----

    private static final String K_ADB_CIERRA = "adb_cierra_ts";

    /** Hora (ms) en que la app debe apagar la depuración inalámbrica que ella encendió; 0 = no la encendió la app. */
    public long getAdbCierraTs() { return pref.getLong(K_ADB_CIERRA, 0); }
    public void setAdbCierraTs(long ts) { pref.edit().putLong(K_ADB_CIERRA, ts).commit(); }

    private static final String K_ADB_DESARROLLO = "adb_desarrollo_por_app";

    /** true si fue la app quien encendió «opciones de desarrollador» para abrir la depuración inalámbrica (al cerrar las apaga). */
    public boolean getAdbDesarrolloPorApp() { return pref.getBoolean(K_ADB_DESARROLLO, false); }
    public void setAdbDesarrolloPorApp(boolean v) { pref.edit().putBoolean(K_ADB_DESARROLLO, v).commit(); }

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
