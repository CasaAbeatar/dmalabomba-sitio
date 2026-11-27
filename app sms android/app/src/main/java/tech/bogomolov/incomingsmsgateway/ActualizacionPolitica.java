package tech.bogomolov.incomingsmsgateway;

import org.json.JSONObject;

import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashSet;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * La Bomba 2.12.0: reglas de la actualización automática de la app. Lógica pura, sin Android, para probarla en la JVM.
 *
 * La oferta viaja en la respuesta al latido, dentro de «actualizacion», con una firma propia (ver CONTRATO-2.12.md,
 * fe de erratas del servidor):
 *   firma = HMAC-SHA256 hex minúsculas, con la clave de la regla, del texto  ACT1|v|vc|url|sha256|ts|eco
 * donde «eco» es el ts que ESTA app mandó en el latido (así una respuesta vieja o repetida no sirve).
 * Todas las reglas siguientes se cumplen, o no se instala nada:
 *   firma válida (tiempo constante) y eco = ts enviado; https y host exacto pagos.dmalabomba.com (ruta /instalar/*.apk,
 *   sin usuario, puerto, consulta ni fragmento); versionCode mayor que el instalado; ts de hace 24 h como máximo;
 *   sha256 del archivo igual; mismo certificado de firma que la app instalada; hasta 3 intentos por versión con espera
 *   creciente; como máximo 3 descargas en 24 h en total (de cualquier versión); vc de 1 a 10.000.000 (el servidor aplica el
 *   mismo límite: ver CONTRATO-2.12.md); y nunca con cola de reenvío pendiente ni un SMS recibido hace menos de 60 s.
 * El archivo (sha256, certificado, versión) se comprueba en Actualizador, que usa estas mismas funciones.
 */
public final class ActualizacionPolitica {

    public static final String HOST = "pagos.dmalabomba.com";
    /** Antigüedad máxima del ts de la oferta (y adelanto máximo permitido: 5 min). */
    public static final long VIGENCIA_MS = 24L * 3600_000L;
    public static final long ADELANTO_MAX_MS = 5L * 60_000L;
    public static final int MAX_INTENTOS = 3;
    /**
     * Auditoría 2.12.0: tope GLOBAL de descargas de actualización, sin importar la versión: como máximo 3 en 24 h. Se suma al
     * límite por versión (que una oferta con otro vc cada vez no puede esquivar) y evita que un servidor, o quien lo suplante,
     * gaste los datos del chip pidiendo versiones distintas sin parar.
     */
    public static final int TOPE_DESCARGAS_DIA = 3;
    public static final long VENTANA_TOPE_MS = 24L * 3600_000L;
    /** Cuántas descargas recientes se recuerdan como máximo (el tope real es mucho menor). */
    public static final int MAX_DESCARGAS_RECORDADAS = 20;
    /** Espera tras el intento 1, 2 y 3 fallidos (1 h, 6 h, 24 h). Tras el tercero ya no se reintenta esa versión. */
    static final long[] ESPERAS_MS = {3600_000L, 6L * 3600_000L, 24L * 3600_000L};
    /** Un SMS recibido hace menos que esto frena la instalación (se espera al siguiente latido). */
    public static final long SMS_RECIENTE_MS = 60_000L;
    /** Tope de tamaño del APK descargado. */
    public static final long BYTES_MAX = 40L * 1024 * 1024;

    private static final Pattern VERSION = Pattern.compile("^\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}$");
    private static final Pattern SHA256 = Pattern.compile("^[0-9a-f]{64}$");
    private static final Pattern RUTA = Pattern.compile("^/instalar/[A-Za-z0-9._-]{1,100}\\.apk$");
    private static final Pattern URL_SEGURA = Pattern.compile("^[\\x21-\\x7e&&[^\\\\]]{1,300}$");

    private ActualizacionPolitica() {
    }

    public static final class Oferta {
        public final String v;
        public final int vc;
        public final String url;
        public final String sha256;
        public final long ts;

        Oferta(String v, int vc, String url, String sha256, long ts) {
            this.v = v;
            this.vc = vc;
            this.url = url;
            this.sha256 = sha256;
            this.ts = ts;
        }
    }

    /** Resultado de leer la respuesta: o hay oferta válida, o un motivo (solo para el registro; null = no había oferta). */
    public static final class Lectura {
        public final Oferta oferta;
        public final String rechazo;

        Lectura(Oferta o, String r) {
            this.oferta = o;
            this.rechazo = r;
        }
    }

    /**
     * Lee y valida la oferta de la respuesta de un latido. La respuesta ya debe haberse tenido por confiable
     * (RemoteCommands.respuestaConfiable); aquí además se exige la firma propia de la oferta y el eco.
     *
     * @param depuracion true solo en compilaciones de depuración (pruebas): acepta además un servidor de pruebas local
     */
    public static Lectura leer(String body, String secreto, long tsEnviado, long ahoraMs, boolean depuracion) {
        if (body == null || body.isEmpty()) return new Lectura(null, null);
        try {
            JSONObject root = new JSONObject(body);
            JSONObject a = root.optJSONObject("actualizacion");
            if (a == null) return new Lectura(null, null);
            if (secreto == null || secreto.isEmpty()) return new Lectura(null, "sin_clave");
            long eco = entero(root.opt("eco"));
            if (eco < 0 || eco != tsEnviado) return new Lectura(null, "eco_distinto");
            Object vRaw = a.opt("v"), vcRaw = a.opt("vc"), urlRaw = a.opt("url"), shaRaw = a.opt("sha256"),
                    tsRaw = a.opt("ts"), firmaRaw = a.opt("firma");
            if (!(vRaw instanceof String) || !VERSION.matcher((String) vRaw).matches()) return new Lectura(null, "version_invalida");
            long vcL = entero(vcRaw);
            if (vcL < 1 || vcL > 10_000_000L) return new Lectura(null, "vc_invalido");
            if (!(urlRaw instanceof String) || !urlPermitida((String) urlRaw, depuracion)) return new Lectura(null, "url_no_permitida");
            if (!(shaRaw instanceof String) || !SHA256.matcher((String) shaRaw).matches()) return new Lectura(null, "sha256_invalido");
            long ts = entero(tsRaw);
            if (ts < 0) return new Lectura(null, "ts_invalido");
            if (!(firmaRaw instanceof String) || !((String) firmaRaw).matches("^[0-9a-fA-F]{64}$")) return new Lectura(null, "firma_invalida");
            String texto = "ACT1|" + vRaw + "|" + vcL + "|" + urlRaw + "|" + shaRaw + "|" + ts + "|" + eco;
            String esperada = Request.computeHmacSha256Hex(secreto, texto);
            if (!MessageDigest.isEqual(esperada.getBytes(StandardCharsets.UTF_8),
                    ((String) firmaRaw).toLowerCase().getBytes(StandardCharsets.UTF_8))) {
                return new Lectura(null, "firma_invalida");
            }
            if (!vigente(ts, ahoraMs)) return new Lectura(null, "ts_fuera_de_vigencia");
            return new Lectura(new Oferta((String) vRaw, (int) vcL, (String) urlRaw, (String) shaRaw, ts), null);
        } catch (Exception e) {
            return new Lectura(null, "malformada");
        }
    }

    /** ts de la oferta: de hace 24 h como máximo y no más de 5 min en el futuro. */
    public static boolean vigente(long tsOferta, long ahoraMs) {
        return tsOferta >= ahoraMs - VIGENCIA_MS && tsOferta <= ahoraMs + ADELANTO_MAX_MS;
    }

    /**
     * Solo https://pagos.dmalabomba.com/instalar/<archivo>.apk (host exacto, sin usuario, puerto, consulta ni fragmento).
     * En depuración se admite también http hacia el servidor de pruebas del emulador/ejecutor (10.0.2.2, 127.0.0.1 o localhost);
     * en la compilación de producción {@code depuracion} es false y eso NO existe.
     */
    public static boolean urlPermitida(String url, boolean depuracion) {
        if (url == null || !URL_SEGURA.matcher(url).matches()) return false;
        try {
            URL u = new URL(url);
            if (u.getUserInfo() != null || u.getQuery() != null || u.getRef() != null) return false;
            String path = u.getPath();
            if (path == null || !RUTA.matcher(path).matches()) return false;
            String host = u.getHost() == null ? "" : u.getHost().toLowerCase();
            if ("https".equals(u.getProtocol())) {
                return host.equals(HOST) && (u.getPort() == -1 || u.getPort() == 443);
            }
            if (depuracion && "http".equals(u.getProtocol())) {
                return host.equals("10.0.2.2") || host.equals("127.0.0.1") || host.equals("localhost");
            }
            return false;
        } catch (Exception e) {
            return false;
        }
    }

    /** ¿La oferta es de una versión más nueva que la instalada? */
    public static boolean esMasNueva(int vcOferta, long vcInstalado) {
        return vcOferta > vcInstalado;
    }

    // ------------------------------------------------------------------ intentos y momento seguro

    /** @return true si ya se puede (o se debe) intentar otra vez esta versión. {@code cuenta} = intentos ya hechos de ESTA versión. */
    public static boolean puedeIntentar(int cuenta, long ultimoIntentoMs, long ahoraMs) {
        if (cuenta <= 0) return true;
        if (cuenta >= MAX_INTENTOS) return false;
        if (ultimoIntentoMs > ahoraMs) return true;   // el reloj retrocedió: no se bloquea para siempre
        return ahoraMs - ultimoIntentoMs >= ESPERAS_MS[cuenta - 1];
    }

    /** Cuánto falta (ms) para el siguiente intento; 0 si ya se puede; -1 si se agotaron los intentos. */
    public static long faltaParaIntentar(int cuenta, long ultimoIntentoMs, long ahoraMs) {
        if (cuenta <= 0) return 0;
        if (cuenta >= MAX_INTENTOS) return -1;
        if (ultimoIntentoMs > ahoraMs) return 0;
        return Math.max(0, ESPERAS_MS[cuenta - 1] - (ahoraMs - ultimoIntentoMs));
    }

    /** ¿Cuántas de estas descargas caen en las últimas 24 h? (las del «futuro», por un reloj retrocedido, no cuentan). */
    public static int descargasEnLaVentana(long[] descargasMs, long ahoraMs) {
        if (descargasMs == null) return 0;
        int n = 0;
        for (long t : descargasMs) {
            if (t > ahoraMs - VENTANA_TOPE_MS && t <= ahoraMs + ADELANTO_MAX_MS) n++;
        }
        return n;
    }

    /** ¿Todavía se puede descargar otra? (menos de {@code tope} descargas en las últimas 24 h, de cualquier versión). */
    public static boolean dentroDelTopeDiario(long[] descargasMs, long ahoraMs, int tope) {
        return descargasEnLaVentana(descargasMs, ahoraMs) < tope;
    }

    /** Deja solo las descargas de las últimas 24 h (y a lo más las más recientes MAX_DESCARGAS_RECORDADAS), en orden. */
    public static long[] podarDescargas(long[] descargasMs, long ahoraMs) {
        if (descargasMs == null) return new long[0];
        long[] tmp = new long[descargasMs.length];
        int n = 0;
        for (long t : descargasMs) {
            if (t > ahoraMs - VENTANA_TOPE_MS && t <= ahoraMs + ADELANTO_MAX_MS) tmp[n++] = t;
        }
        int ini = Math.max(0, n - MAX_DESCARGAS_RECORDADAS);
        long[] out = new long[n - ini];
        System.arraycopy(tmp, ini, out, 0, out.length);
        return out;
    }

    /** Nunca se instala con una cola de reenvío pendiente ni con un SMS recibido hace menos de 60 s. */
    public static boolean momentoSeguro(int fallidosPendientes, long ultimoSmsMs, long ahoraMs) {
        if (fallidosPendientes > 0) return false;
        if (ultimoSmsMs <= 0) return true;
        return Math.abs(ahoraMs - ultimoSmsMs) >= SMS_RECIENTE_MS;
    }

    // ------------------------------------------------------------------ archivo descargado

    public static boolean sha256Coincide(String esperadoHex, String obtenidoHex) {
        if (esperadoHex == null || obtenidoHex == null) return false;
        return MessageDigest.isEqual(esperadoHex.toLowerCase().getBytes(StandardCharsets.UTF_8),
                obtenidoHex.toLowerCase().getBytes(StandardCharsets.UTF_8));
    }

    /**
     * ¿Los certificados de firma son IDÉNTICOS? Se comparan los SHA-256 de cada certificado como conjuntos; ambos
     * deben tener al menos uno. Es la misma garantía que aplica Android al actualizar, comprobada antes de instalar.
     */
    public static boolean mismosFirmantes(byte[][] instalada, byte[][] archivo) {
        if (instalada == null || archivo == null || instalada.length == 0 || archivo.length == 0) return false;
        try {
            Set<String> a = huellas(instalada), b = huellas(archivo);
            return a.equals(b);
        } catch (Exception e) {
            return false;
        }
    }

    private static Set<String> huellas(byte[][] certs) throws Exception {
        Set<String> s = new HashSet<>();
        for (byte[] c : certs) {
            if (c == null || c.length == 0) throw new IllegalArgumentException("certificado vacio");
            s.add(hex(MessageDigest.getInstance("SHA-256").digest(c)));
        }
        return s;
    }

    static String hex(byte[] b) {
        StringBuilder o = new StringBuilder(b.length * 2);
        for (byte x : b) o.append(String.format("%02x", x & 0xff));
        return o.toString();
    }

    /** Entero >= 0 y exacto; -1 si no lo es. */
    private static long entero(Object v) {
        if (!(v instanceof Number)) return -1;
        double d = ((Number) v).doubleValue();
        if (Double.isNaN(d) || d < 0 || d >= 9_000_000_000_000_000.0 || d != Math.rint(d)) return -1;
        return ((Number) v).longValue();
    }
}
