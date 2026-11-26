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
        // ---- 2.8.0: mediciones para entender por qué el teléfono se duerme o se cae ----
        /** Intensidad de la señal en dBm (negativa) si Android la da sin permisos especiales; 0 = desconocida. */
        public int senalNivel;
        /** Nombre del operador de la red (sin número de teléfono). */
        public String operador = "";
        /** listo | ausente | bloqueado | desconocido */
        public String simEstado = "desconocido";
        public boolean modoAvion;
        /** Memoria libre del teléfono en MB; -1 = desconocida. */
        public int memoriaLibreMb = -1;
        /** Hora (ms) en que arrancó el teléfono; 0 = desconocida. */
        public long arranqueTs;
        /** Cubeta de espera de Android: 10 activa, 20 en uso, 30 frecuente, 40 rara, 45 restringida; -1 desconocida. */
        public int bucketStandby = -1;
        /** true si Android está en modo Doze (reposo profundo). */
        public boolean doze;
        /** Cuánto se atrasó el último latido periódico frente a lo planeado (ms); -1 = sin dato. Un atraso grande es el teléfono dormido. */
        public long latidoRetrasoMs = -1;
        /** Cuántas veces ha arrancado el servicio de la app desde que se instaló. */
        public int reiniciosServicio;
        // ---- 2.9.0: Wi-Fi y permisos extra ----
        /** true si el Wi-Fi del teléfono está encendido. */
        public boolean wifiEncendido;
        /** Señal del Wi-Fi en dBm (negativa); 0 = sin dato o no conectado al Wi-Fi. */
        public int wifiRssi;
        /** Velocidad del enlace Wi-Fi en Mbps; -1 = sin dato. */
        public int wifiMbps = -1;
        /** Frecuencia del Wi-Fi en MHz (2400 o 5000); 0 = sin dato. */
        public int wifiMhz;
        /** Nombre del Wi-Fi si Android lo entrega (necesita ubicación); vacío si no. */
        public String wifiNombre = "";
        /** Permisos extra de la 2.9.0 que están dados, separados por coma (ubicacion,telefono,uso,superposicion,ajustes,no_molestar). */
        public String permisosExtra = "";
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
                    .append(",\"marca_modelo\":\"").append(esc(d.marcaModelo)).append('"')
                    .append(",\"senal_nivel\":").append(d.senalNivel)
                    .append(",\"operador\":\"").append(esc(d.operador)).append('"')
                    .append(",\"sim_estado\":\"").append(esc(d.simEstado)).append('"')
                    .append(",\"modo_avion\":").append(d.modoAvion)
                    .append(",\"memoria_libre_mb\":").append(d.memoriaLibreMb)
                    .append(",\"arranque_ts\":").append(d.arranqueTs)
                    .append(",\"bucket_standby\":").append(d.bucketStandby)
                    .append(",\"doze\":").append(d.doze)
                    .append(",\"latido_retraso_ms\":").append(d.latidoRetrasoMs)
                    .append(",\"reinicios_servicio\":").append(d.reiniciosServicio)
                    .append(",\"wifi_encendido\":").append(d.wifiEncendido)
                    .append(",\"wifi_rssi\":").append(d.wifiRssi)
                    .append(",\"wifi_mbps\":").append(d.wifiMbps)
                    .append(",\"wifi_mhz\":").append(d.wifiMhz)
                    .append(",\"wifi_nombre\":\"").append(esc(d.wifiNombre)).append('"')
                    .append(",\"permisos_extra\":\"").append(esc(d.permisosExtra)).append('"');
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
