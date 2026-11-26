package tech.bogomolov.incomingsmsgateway;

import org.json.JSONArray;
import org.json.JSONObject;

import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * La Bomba 2.10.0: protocolo de la pantalla remota (ver PROTOCOLO.md). Lógica pura, sin Android, para probarla
 * en la JVM. Los cuerpos se arman a mano, con orden fijo, y la firma HMAC se calcula sobre ESE texto exacto.
 *
 * Reglas de seguridad:
 *  - Las acciones SOLO se ejecutan si la respuesta trae X-Signature válido (HMAC-SHA256 del cuerpo de la
 *    respuesta con la clave de la regla). Aquí NO basta con https, a diferencia de las órdenes del latido.
 *  - Lista CERRADA de acciones; cualquier otra se ignora. Tope de 5 por respuesta.
 *  - Cada id se ejecuta una sola vez por sesión (IdsHechos).
 *  - Coordenadas normalizadas 0..1, duraciones y largo del texto con límites; lo que se sale se descarta.
 */
public final class PantallaProtocolo {

    public static final String TOQUE = "toque";
    public static final String LARGO = "largo";
    public static final String DESLIZAR = "deslizar";
    public static final String ATRAS = "atras";
    public static final String INICIO = "inicio";
    public static final String RECIENTES = "recientes";
    public static final String NOTIFICACIONES = "notificaciones";
    public static final String TEXTO = "texto";
    public static final String BORRAR = "borrar";
    public static final String ENCENDER = "encender";

    public static final Set<String> ACCIONES = Collections.unmodifiableSet(new LinkedHashSet<>(Arrays.asList(
            TOQUE, LARGO, DESLIZAR, ATRAS, INICIO, RECIENTES, NOTIFICACIONES, TEXTO, BORRAR, ENCENDER)));

    /** Tope de acciones que se leen de una sola respuesta. */
    public static final int MAX_ACCIONES = 5;
    public static final int MAX_TEXTO = 200;
    public static final int MAX_BORRAR = 200;
    public static final int MIN_MS = 100;
    public static final int MAX_MS = 1500;
    public static final int MS_LARGO_POR_DEFECTO = 800;
    /** Una sesión nunca dura más que esto en el teléfono, diga lo que diga el servidor. */
    public static final int MAX_RESTA_S = 900;
    /** Cuántos ids ejecutados se recuerdan. */
    public static final int MAX_RECORDADOS = 200;

    private static final Pattern SID = Pattern.compile("^[0-9A-Za-z-]{1,64}$");
    private static final Pattern RESULTADO = Pattern.compile("^[a-z_]{1,30}$");

    private PantallaProtocolo() {
    }

    // ------------------------------------------------------------------ dirección

    /** La dirección de pantalla es la de la regla de reenvío con la ruta cambiada a /pantalla; null si no es una URL. */
    public static String urlPantalla(String urlRegla) {
        if (urlRegla == null || urlRegla.trim().isEmpty()) return null;
        try {
            URL u = new URL(urlRegla.trim());
            String p = u.getProtocol();
            if (!"http".equals(p) && !"https".equals(p)) return null;
            if (u.getHost() == null || u.getHost().isEmpty()) return null;
            return p + "://" + u.getHost() + (u.getPort() >= 0 ? ":" + u.getPort() : "") + "/pantalla";
        } catch (Exception e) {
            return null;
        }
    }

    // ------------------------------------------------------------------ cuerpos que manda el teléfono

    public static String escucha(long ts, String empresa, String app, boolean encendida, boolean bloqueada) {
        StringBuilder b = new StringBuilder(160);
        b.append("{\"tipo\":\"pantalla\",\"fase\":\"escucha\",\"ts\":").append(ts)
                .append(",\"empresa\":\"").append(HeartbeatBody.esc(empresa))
                .append("\",\"app\":\"").append(HeartbeatBody.esc(app))
                .append("\",\"pantalla_encendida\":").append(encendida)
                .append(",\"bloqueada\":").append(bloqueada)
                .append('}');
        return b.toString();
    }

    /**
     * @param jpgBase64 imagen JPEG en base64 (sin saltos de línea); null o vacío si no hay imagen nueva
     * @param error     motivo corto si no se pudo capturar (opcional, null = sin campo)
     */
    public static String cuadro(long ts, String empresa, String sid, int seq, int w, int h, String jpgBase64,
                                boolean sinCambio, boolean encendida, boolean bloqueada, String error,
                                long[] confirmadas, Map<Long, String> resultados) {
        boolean conImagen = !sinCambio && jpgBase64 != null && !jpgBase64.isEmpty();
        StringBuilder b = new StringBuilder(conImagen ? jpgBase64.length() + 400 : 400);
        b.append("{\"tipo\":\"pantalla\",\"fase\":\"cuadro\",\"ts\":").append(ts)
                .append(",\"empresa\":\"").append(HeartbeatBody.esc(empresa))
                .append("\",\"sid\":\"").append(HeartbeatBody.esc(sid))
                .append("\",\"seq\":").append(seq)
                .append(",\"w\":").append(w)
                .append(",\"h\":").append(h)
                .append(",\"sin_cambio\":").append(!conImagen)
                .append(",\"pantalla_encendida\":").append(encendida)
                .append(",\"bloqueada\":").append(bloqueada);
        if (error != null && !error.isEmpty()) {
            b.append(",\"error\":\"").append(HeartbeatBody.esc(error.length() > 40 ? error.substring(0, 40) : error)).append('"');
        }
        b.append(",\"confirmadas\":[");
        if (confirmadas != null) {
            for (int i = 0; i < confirmadas.length; i++) {
                if (i > 0) b.append(',');
                b.append(confirmadas[i]);
            }
        }
        b.append("],\"resultados\":{");
        if (resultados != null) {
            boolean primero = true;
            for (Map.Entry<Long, String> e : resultados.entrySet()) {
                String r = e.getValue();
                if (r == null || !RESULTADO.matcher(r).matches()) r = "fallo";
                if (!primero) b.append(',');
                primero = false;
                b.append('"').append(e.getKey()).append("\":\"").append(r).append('"');
            }
        }
        b.append('}');
        if (conImagen) b.append(",\"jpg\":\"").append(jpgBase64).append('"');
        b.append('}');
        return b.toString();
    }

    public static String fin(long ts, String empresa, String sid) {
        return "{\"tipo\":\"pantalla\",\"fase\":\"fin\",\"ts\":" + ts
                + ",\"empresa\":\"" + HeartbeatBody.esc(empresa)
                + "\",\"sid\":\"" + HeartbeatBody.esc(sid) + "\"}";
    }

    // ------------------------------------------------------------------ respuesta del servidor

    public static final class Accion {
        public final long id;
        public final String a;
        public final double x, y, x1, y1, x2, y2;
        public final int ms;
        public final String t;
        public final int n;

        Accion(long id, String a, double x, double y, double x1, double y1, double x2, double y2, int ms, String t, int n) {
            this.id = id;
            this.a = a;
            this.x = x;
            this.y = y;
            this.x1 = x1;
            this.y1 = y1;
            this.x2 = x2;
            this.y2 = y2;
            this.ms = ms;
            this.t = t;
            this.n = n;
        }
    }

    public static final class Respuesta {
        public boolean ok;
        /** true si hay una sesión activa y el teléfono debe seguir mandando cuadros. */
        public boolean sesion;
        public String sid = "";
        /** Segundos que le quedan a la sesión (0..MAX_RESTA_S). */
        public int restaS;
        public List<Accion> acciones = new ArrayList<>();
    }

    /** ¿Se puede confiar en esta respuesta? Exige firma y que coincida; sin firma NUNCA (ni siquiera con https). */
    public static boolean respuestaFirmada(int httpCode, String body, String firmaHex, String secret) {
        if (httpCode < 200 || httpCode >= 300 || body == null) return false;
        if (firmaHex == null || firmaHex.trim().isEmpty()) return false;
        if (secret == null || secret.isEmpty()) return false;
        try {
            String esperado = Request.computeHmacSha256Hex(secret, body);
            return MessageDigest.isEqual(
                    esperado.getBytes(StandardCharsets.UTF_8),
                    firmaHex.trim().toLowerCase().getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            return false;
        }
    }

    /** Lee la respuesta. Nunca lanza: lo malformado devuelve una Respuesta con ok=false y sin sesión. */
    public static Respuesta parsear(String body) {
        Respuesta r = new Respuesta();
        if (body == null || body.isEmpty()) return r;
        try {
            JSONObject root = new JSONObject(body);
            r.ok = root.optBoolean("ok", false);
            r.sesion = r.ok && root.optBoolean("sesion", false);
            if (!r.sesion) return r;
            String sid = root.optString("sid", "");
            if (!SID.matcher(sid).matches()) {
                r.sesion = false;
                return r;
            }
            r.sid = sid;
            Object resta = root.opt("resta_s");
            int s = resta instanceof Number ? (int) Math.max(0, Math.min(MAX_RESTA_S, ((Number) resta).doubleValue())) : 0;
            r.restaS = s;
            JSONArray arr = root.optJSONArray("acciones");
            if (arr == null) return r;
            Set<Long> vistos = new LinkedHashSet<>();
            for (int i = 0; i < arr.length() && r.acciones.size() < MAX_ACCIONES; i++) {
                JSONObject o = arr.optJSONObject(i);
                if (o == null) continue;
                Accion a = leerAccion(o);
                if (a == null) continue;
                if (!vistos.add(a.id)) continue;
                r.acciones.add(a);
            }
        } catch (Exception e) {
            r.ok = false;
            r.sesion = false;
            r.acciones.clear();
        }
        return r;
    }

    private static Accion leerAccion(JSONObject o) {
        Object idRaw = o.opt("id");
        if (!(idRaw instanceof Number)) return null;
        double idD = ((Number) idRaw).doubleValue();
        long id = ((Number) idRaw).longValue();
        if (id <= 0 || id >= 9_000_000_000_000_000L || idD != (double) id) return null;
        Object aRaw = o.opt("a");
        if (!(aRaw instanceof String)) return null;
        String a = (String) aRaw;
        if (!ACCIONES.contains(a)) return null;   // lista cerrada
        switch (a) {
            case TOQUE: {
                double x = norm(o.opt("x")), y = norm(o.opt("y"));
                if (Double.isNaN(x) || Double.isNaN(y)) return null;
                return new Accion(id, a, x, y, 0, 0, 0, 0, 0, null, 0);
            }
            case LARGO: {
                double x = norm(o.opt("x")), y = norm(o.opt("y"));
                if (Double.isNaN(x) || Double.isNaN(y)) return null;
                int ms = o.has("ms") ? duracion(o.opt("ms")) : MS_LARGO_POR_DEFECTO;
                if (ms < 0) return null;
                return new Accion(id, a, x, y, 0, 0, 0, 0, ms, null, 0);
            }
            case DESLIZAR: {
                double x1 = norm(o.opt("x1")), y1 = norm(o.opt("y1")), x2 = norm(o.opt("x2")), y2 = norm(o.opt("y2"));
                if (Double.isNaN(x1) || Double.isNaN(y1) || Double.isNaN(x2) || Double.isNaN(y2)) return null;
                int ms = duracion(o.opt("ms"));
                if (ms < 0) return null;
                return new Accion(id, a, 0, 0, x1, y1, x2, y2, ms, null, 0);
            }
            case TEXTO: {
                Object t = o.opt("t");
                if (!(t instanceof String)) return null;
                String s = (String) t;
                if (s.isEmpty() || s.length() > MAX_TEXTO) return null;
                for (int i = 0; i < s.length(); i++) {
                    char c = s.charAt(i);
                    if (c < 0x20 && c != '\n') return null;   // nada de caracteres de control
                }
                return new Accion(id, a, 0, 0, 0, 0, 0, 0, 0, s, 0);
            }
            case BORRAR: {
                Object nRaw = o.opt("n");
                int n = 1;
                if (o.has("n")) {
                    if (!(nRaw instanceof Number)) return null;
                    double d = ((Number) nRaw).doubleValue();
                    if (d != Math.rint(d) || d < 1 || d > MAX_BORRAR) return null;
                    n = (int) d;
                }
                return new Accion(id, a, 0, 0, 0, 0, 0, 0, 0, null, n);
            }
            default:   // atras, inicio, recientes, notificaciones, encender: sin parámetros
                return new Accion(id, a, 0, 0, 0, 0, 0, 0, 0, null, 0);
        }
    }

    /** Número entre 0 y 1; NaN si no lo es. */
    private static double norm(Object v) {
        if (!(v instanceof Number)) return Double.NaN;
        double d = ((Number) v).doubleValue();
        if (Double.isNaN(d) || Double.isInfinite(d) || d < 0 || d > 1) return Double.NaN;
        return d;
    }

    /** Milisegundos entre MIN_MS y MAX_MS; -1 si falta o se sale. */
    private static int duracion(Object v) {
        if (!(v instanceof Number)) return -1;
        double d = ((Number) v).doubleValue();
        if (Double.isNaN(d) || d < MIN_MS || d > MAX_MS) return -1;
        return (int) d;
    }

    // ------------------------------------------------------------------ ids ya ejecutados

    /** Registro acotado de ids de acciones ya ejecutadas en la sesión. */
    public static final class IdsHechos {
        private final LinkedHashSet<Long> ids = new LinkedHashSet<>();

        /** @return true si es la primera vez que se ve (hay que ejecutarla); false si ya se había ejecutado. */
        public boolean registrar(long id) {
            boolean nuevo = ids.add(id);
            while (ids.size() > MAX_RECORDADOS) {
                ids.remove(ids.iterator().next());
            }
            return nuevo;
        }

        public boolean contiene(long id) {
            return ids.contains(id);
        }

        public int size() {
            return ids.size();
        }
    }
}
