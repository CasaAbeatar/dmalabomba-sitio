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
 *  - Coordenadas normalizadas 0..1, duraciones y largo del texto con límites; lo que se sale se descarta
 *    (el texto inválido se confirma como «texto_invalido»).
 *  - 2.11.0: solo https (ver urlPantalla); acciones atadas al cuadro (cuadro_seq, ver resultadoPrevio).
 *  - Una sesión dura como máximo MAX_RESTA_S = 900 s (15 min) en el protocolo, y el teléfono además la corta a los
 *    15 min con PantallaRemotaService.TOPE_SESION_MS, diga lo que diga el servidor: los dos topes deben ser el mismo.
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
    public static final long SIN_CUADRO_SEQ = -1;
    public static final long CUADRO_SEQ_INVALIDO = -2;
    public static final String OBSOLETA = "obsoleta";
    public static final String TEXTO_INVALIDO = "texto_invalido";
    /** Cuántos ids ejecutados se recuerdan. */
    public static final int MAX_RECORDADOS = 200;

    private static final Pattern SID = Pattern.compile("^[0-9A-Za-z-]{1,64}$");
    private static final Pattern RESULTADO = Pattern.compile("^[a-z_]{1,30}$");

    private PantallaProtocolo() {
    }

    // ------------------------------------------------------------------ dirección

    /**
     * La dirección de pantalla es la de la regla de reenvío con la ruta cambiada a /pantalla; null si no es una URL.
     *
     * 2.11.0 (auditoría de 2.10.0): /pantalla SOLO por https. Una captura de pantalla (y el teclado remoto) por http
     * viajaría en claro y, además, un http permitiría a un intermediario ver el cuadro aunque no pudiera firmar la
     * respuesta. Se rechaza todo http, salvo el bucle local del propio teléfono (127.0.0.1, localhost, [::1]),
     * cuyo tráfico nunca sale del aparato y que usan las pruebas instrumentadas con un servidor falso. Tampoco se
     * aplica a /pantalla el «ignorar errores de certificado» de la regla (ver PantallaRemotaService.enviar).
     */
    public static String urlPantalla(String urlRegla) {
        if (urlRegla == null || urlRegla.trim().isEmpty()) return null;
        try {
            URL u = new URL(urlRegla.trim());
            String p = u.getProtocol();
            if (!"http".equals(p) && !"https".equals(p)) return null;
            String host = u.getHost();
            if (host == null || host.isEmpty()) return null;
            if ("http".equals(p) && !esBucleLocal(host)) return null;
            return p + "://" + host + (u.getPort() >= 0 ? ":" + u.getPort() : "") + "/pantalla";
        } catch (Exception e) {
            return null;
        }
    }

    /** 127.0.0.1, localhost o ::1: el tráfico no sale del teléfono. */
    static boolean esBucleLocal(String host) {
        if (host == null) return false;
        String h = host.toLowerCase();
        return h.equals("127.0.0.1") || h.equals("localhost") || h.equals("[::1]") || h.equals("::1");
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
        /**
         * 2.11.0: seq del cuadro que vio el administrador al mandar la acción. SIN_CUADRO_SEQ (-1) si la respuesta no lo
         * trae (servidor viejo: se ejecuta como antes); CUADRO_SEQ_INVALIDO (-2) si viene pero no es un entero válido
         * (se trata como obsoleta: presente y distinto del último enviado).
         */
        public long cuadroSeq = SIN_CUADRO_SEQ;
        /** Motivo si la acción es válida en su id pero hay que confirmarla SIN ejecutar (p. ej. «texto_invalido»); null si no. */
        public String rechazo = null;

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
        /** «eco» del servidor: el ts de la petición a la que responde; -1 si falta o no es un entero. */
        public long eco = -1;
        /** Hora del servidor en ms (informativa); -1 si falta. */
        public long tsServidor = -1;

        /** ¿Es la respuesta a ESTA petición (y no una repetida o vieja)? */
        public boolean ecoCoincide(long tsEnviado) {
            return eco >= 0 && eco == tsEnviado;
        }
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
            r.eco = entero(root.opt("eco"));
            r.tsServidor = entero(root.opt("ts"));
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
                if (o.has("cuadro_seq")) {
                    long cs = entero(o.opt("cuadro_seq"));
                    a.cuadroSeq = cs >= 0 ? cs : CUADRO_SEQ_INVALIDO;
                }
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

    /** Entero >= 0 y exacto (sin decimales ni desbordes); -1 si no lo es. */
    private static long entero(Object v) {
        if (!(v instanceof Number)) return -1;
        double d = ((Number) v).doubleValue();
        if (Double.isNaN(d) || d < 0 || d >= 9_000_000_000_000_000.0 || d != Math.rint(d)) return -1;
        return (long) d;
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
                if (t instanceof String && textoValido((String) t)) {
                    return new Accion(id, a, 0, 0, 0, 0, 0, 0, 0, (String) t, 0);
                }
                // 2.11.0: un texto que no cumple NO se deja sin respuesta: se confirma con «texto_invalido» sin escribir nada.
                Accion mala = new Accion(id, a, 0, 0, 0, 0, 0, 0, 0, null, 0);
                mala.rechazo = TEXTO_INVALIDO;
                return mala;
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

    /**
     * Texto permitido: de 1 a MAX_TEXTO (200) UNIDADES UTF-16 (el largo de String.length(), no los puntos de código:
     * un emoji cuenta 2), con saltos de línea (\n) pero sin otros caracteres de control, y sin sustitutos (surrogates)
     * sueltos que dejarían un texto mal formado.
     */
    public static boolean textoValido(String s) {
        if (s == null || s.isEmpty() || s.length() > MAX_TEXTO) return false;
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c < 0x20 && c != '\n') return false;
            if (c == 0x7f) return false;
            if (Character.isHighSurrogate(c)) {
                if (i + 1 >= s.length() || !Character.isLowSurrogate(s.charAt(i + 1))) return false;
                i++;
            } else if (Character.isLowSurrogate(c)) {
                return false;
            }
        }
        return true;
    }

    /** Margen tras cambiar de imagen en el que todavía vale la acción hecha sobre la imagen anterior (pantallas con animación). */
    public static final long MARGEN_IMAGEN_MS = 2000L;

    /**
     * 2.11.0: qué imágenes mandó la sesión. La «seq» que guarda el servidor SOLO cambia con cuadros que traen imagen
     * (jpg); los cuadros «sin_cambio» no la cambian, y el visor manda como cuadro_seq la seq de la ÚLTIMA IMAGEN que
     * mostró. Por eso aquí NO se compara con el último seq de cualquier cuadro (en una pantalla estática, donde casi
     * todos los cuadros son sin_cambio, todas las acciones saldrían obsoletas).
     */
    public static final class SeqImagen {
        /** seq del último cuadro enviado CON jpg; -1 si todavía no se envió ninguno. */
        public long ultima = -1;
        /** seq de la imagen anterior a la última; -1 si no hay. */
        public long previa = -1;
        /** Hora (ms, reloj monótono de quien llama) en que «ultima» reemplazó a «previa». */
        public long cambioMs;

        public void registrarImagen(long seq, long ahoraMs) {
            previa = ultima;
            ultima = seq;
            cambioMs = ahoraMs;
        }
    }

    /**
     * 2.11.0: ¿hay que confirmar esta acción como «obsoleta» sin ejecutarla?
     *  - Si todavía no se envió ningún cuadro de la sesión: sí, TODA acción (las que llegan en la respuesta de «escucha»
     *    no se apoyan en nada que el administrador haya visto).
     *  - «encender» queda exenta de la regla de la imagen (con la pantalla apagada puede no haber imagen).
     *  - Sin cuadro_seq (servidor viejo): se ejecuta como antes.
     *  - Con cuadro_seq: se ejecuta si es igual a la seq de la última imagen enviada; o si es igual a la de la imagen
     *    anterior y la última cambió hace menos de MARGEN_IMAGEN_MS (margen de una imagen para pantallas animadas).
     *    Cualquier otro valor (incluido uno mal formado, o uno cuando aún no hubo imagen) es obsoleta.
     * @return "obsoleta" o null si se puede ejecutar.
     */
    public static String resultadoPrevio(Accion a, boolean cuadroEnviado, SeqImagen img, long ahoraMs) {
        if (!cuadroEnviado) return OBSOLETA;
        if (ENCENDER.equals(a.a)) return null;
        if (a.cuadroSeq == SIN_CUADRO_SEQ) return null;
        if (a.cuadroSeq < 0 || img == null || img.ultima < 0) return OBSOLETA;
        if (a.cuadroSeq == img.ultima) return null;
        if (img.previa >= 0 && a.cuadroSeq == img.previa && ahoraMs >= img.cambioMs && ahoraMs - img.cambioMs < MARGEN_IMAGEN_MS) return null;
        return OBSOLETA;
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
