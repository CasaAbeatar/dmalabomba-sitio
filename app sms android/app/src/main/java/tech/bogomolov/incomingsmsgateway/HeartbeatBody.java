package tech.bogomolov.incomingsmsgateway;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * La Bomba 2.7.0 («Guardián»): arma el cuerpo JSON del latido. Es Java puro (sin Android) para poder
 * probarlo en la JVM. El cuerpo se arma a mano, con orden fijo, y la firma HMAC se calcula sobre ESE texto
 * exacto (Request.computeHmacSha256Hex); nunca se vuelve a serializar después de firmar.
 *
 * Contrato con el servidor (/latido): tipo, ts, empresa, telefono, bateria (como en 2.5.0) y además
 * "detalle" con el estado del teléfono. El servidor ignora los campos que no conoce.
 */
public final class HeartbeatBody {

    private HeartbeatBody() {
    }

    /** Estado del teléfono que viaja en "detalle". */
    public static final class Detalle {
        public String app = "";
        public boolean cargando;
        public boolean ahorroBateria;
        public boolean sinRestriccionBateria;
        public boolean redValidada;
        /** wifi | datos | ninguna */
        public String tipoRed = "ninguna";
        public long ultimoSmsTs;
        public long ultimoReenvioOkTs;
        public int fallidosPendientes;
        public boolean permisoSms;
        public boolean notificaciones;
        public int android;
        public String marcaModelo = "";
        /** Ids de órdenes ya procesadas, que el servidor aún no ha visto confirmadas. */
        public long[] comandosHechos = new long[0];
        /** id de la orden -> resultado ("ok", "comando_no_soportado", "falta_permiso_sms"...). */
        public Map<Long, String> comandosResultado = new LinkedHashMap<>();
    }

    public static String tipoRed(boolean wifi, boolean datos) {
        if (wifi) return "wifi";
        if (datos) return "datos";
        return "ninguna";
    }

    public static String build(long ts, String empresa, String telefono, int bateria, Detalle d) {
        StringBuilder b = new StringBuilder(512);
        b.append("{\"tipo\":\"latido\",\"ts\":").append(ts)
                .append(",\"empresa\":\"").append(esc(empresa))
                .append("\",\"telefono\":\"").append(esc(telefono))
                .append("\",\"bateria\":").append(bateria);
        if (d != null) {
            b.append(",\"detalle\":{")
                    .append("\"app\":\"").append(esc(d.app)).append('"')
                    .append(",\"cargando\":").append(d.cargando)
                    .append(",\"ahorro_bateria\":").append(d.ahorroBateria)
                    .append(",\"sin_restriccion_bateria\":").append(d.sinRestriccionBateria)
                    .append(",\"red_validada\":").append(d.redValidada)
                    .append(",\"tipo_red\":\"").append(esc(d.tipoRed)).append('"')
                    .append(",\"ultimo_sms_ts\":").append(d.ultimoSmsTs)
                    .append(",\"ultimo_reenvio_ok_ts\":").append(d.ultimoReenvioOkTs)
                    .append(",\"fallidos_pendientes\":").append(d.fallidosPendientes)
                    .append(",\"permiso_sms\":").append(d.permisoSms)
                    .append(",\"notificaciones\":").append(d.notificaciones)
                    .append(",\"android\":").append(d.android)
                    .append(",\"marca_modelo\":\"").append(esc(d.marcaModelo)).append('"');
            if (d.comandosHechos != null && d.comandosHechos.length > 0) {
                b.append(",\"comandos_hechos\":[");
                for (int i = 0; i < d.comandosHechos.length; i++) {
                    if (i > 0) b.append(',');
                    b.append(d.comandosHechos[i]);
                }
                b.append(']');
                if (d.comandosResultado != null && !d.comandosResultado.isEmpty()) {
                    b.append(",\"comandos_resultado\":{");
                    boolean first = true;
                    for (Map.Entry<Long, String> e : d.comandosResultado.entrySet()) {
                        if (!first) b.append(',');
                        first = false;
                        b.append('"').append(e.getKey()).append("\":\"").append(esc(e.getValue())).append('"');
                    }
                    b.append('}');
                }
            }
            b.append('}');
        }
        b.append('}');
        return b.toString();
    }

    /** Escapa lo mínimo que exige JSON para texto entre comillas. */
    static String esc(String s) {
        if (s == null) return "";
        StringBuilder o = new StringBuilder(s.length() + 8);
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': o.append("\\\""); break;
                case '\\': o.append("\\\\"); break;
                case '\n': o.append("\\n"); break;
                case '\r': o.append("\\r"); break;
                case '\t': o.append("\\t"); break;
                default:
                    if (c < 0x20) o.append(String.format("\\u%04x", (int) c));
                    else o.append(c);
            }
        }
        return o.toString();
    }
}
