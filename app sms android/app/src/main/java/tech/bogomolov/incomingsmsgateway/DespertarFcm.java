package tech.bogomolov.incomingsmsgateway;

import java.util.Map;
import java.util.regex.Pattern;

/**
 * La Bomba 2.11.0: reglas puras del mensaje de despertar de FCM (JVM, sin Android).
 * Contrato con el servidor: mensaje SOLO de datos, valores texto: tipo="despertar", despertar_id="n", titulo="Reconectando...",
 * ts="ms", prioridad alta, vida 120 s. Todo lo demás se ignora. El «titulo» que llegue NO se muestra: la app usa su propio texto.
 */
public final class DespertarFcm {

    private DespertarFcm() {
    }

    public static final String TIPO = "despertar";
    /** ts hacia atrás: la vida del mensaje es 120 s; se deja margen por relojes y demoras. */
    public static final long VENTANA_PASADO_MS = 5 * 60_000L;
    /** ts hacia adelante: tolerancia de reloj. */
    public static final long VENTANA_FUTURO_MS = 2 * 60_000L;
    /** Un mismo despertar entregado dos veces seguidas (reintento de FCM) no se atiende dos veces. */
    public static final long REPETIDO_MS = 10_000L;

    private static final Pattern NUM = Pattern.compile("[0-9]{1,15}");
    private static final Pattern TOKEN = Pattern.compile("^[A-Za-z0-9:_-]{20,255}$");

    public static final class Orden {
        public final long despertarId;
        public final long ts;

        Orden(long despertarId, long ts) {
            this.despertarId = despertarId;
            this.ts = ts;
        }
    }

    /** @return la orden si el mensaje es un despertar válido y reciente; null si hay que ignorarlo. */
    public static Orden analizar(Map<String, String> datos, long ahoraMs) {
        if (datos == null) return null;
        if (!TIPO.equals(datos.get("tipo"))) return null;
        String id = datos.get("despertar_id");
        String ts = datos.get("ts");
        if (id == null || ts == null || !NUM.matcher(id).matches() || !NUM.matcher(ts).matches()) return null;
        long i, t;
        try {
            i = Long.parseLong(id);
            t = Long.parseLong(ts);
        } catch (NumberFormatException e) {
            return null;
        }
        if (i <= 0 || t <= 0) return null;
        if (ahoraMs - t > VENTANA_PASADO_MS || t - ahoraMs > VENTANA_FUTURO_MS) return null;
        return new Orden(i, t);
    }

    /** false si es el mismo despertar que se atendió hace menos de REPETIDO_MS. */
    public static boolean debeAtender(long idUltimo, long ahoraUltimo, long id, long ahora) {
        return !(id == idUltimo && ahoraUltimo > 0 && ahora >= ahoraUltimo && ahora - ahoraUltimo < REPETIDO_MS);
    }

    /** El token de FCM tal como lo exige el servidor: ^[A-Za-z0-9:_-]{20,255}$. */
    public static boolean tokenValido(String token) {
        return token != null && TOKEN.matcher(token).matches();
    }
}
