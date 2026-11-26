package tech.bogomolov.incomingsmsgateway;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * La Bomba 2.11.0: SMS de despertar. Un SMS del servidor con el formato
 *
 *     LB1 &lt;orden&gt; &lt;contador&gt; &lt;firma&gt;
 *
 * le dice al teléfono que se levante aunque la app esté dormida o su proceso haya muerto (SMS_RECEIVED arranca el
 * proceso). Java puro, sin Android, para probarlo en la JVM.
 *
 *  - firma: primeros caracteres hex (mínimo 10, hasta 64) de HMAC-SHA256(clave de la regla, "LB1 &lt;orden&gt; &lt;contador&gt;").
 *    La orden va en minúsculas y el contador en decimal sin ceros a la izquierda: se reconstruye el texto firmado a
 *    partir de lo analizado, así mayúsculas, espacios de más o ceros a la izquierda no cambian la firma.
 *  - el remitente NO autentica nada (puede falsificarse): solo cuenta la firma.
 *  - contador: estrictamente creciente y guardado (GuardianState). Un SMS repetido o viejo no vale. Una ventana de
 *    SALTO_MAX evita que un contador absurdo deje sorda a la app; con contador guardado 0 (instalación nueva) vale cualquiera.
 *  - órdenes cerradas e inofensivas: latido_ya, reiniciar_servicio, reenviar_historial. Nada que cambie ajustes ni reinicie el teléfono.
 *  - todo mensaje que EMPIEZA con «LB1 » se consume (nunca se reenvía como aviso de pago), sea válido o no.
 */
public final class SmsDespertar {

    private SmsDespertar() {
    }

    public static final String PREFIJO = "LB1";
    public static final String CMD_LATIDO_YA = RemoteCommands.LATIDO_YA;
    public static final String CMD_REINICIAR_SERVICIO = RemoteCommands.REINICIAR_SERVICIO;
    public static final String CMD_REENVIAR_HISTORIAL = RemoteCommands.REENVIAR_HISTORIAL;
    public static final long SALTO_MAX = 1000L;
    /** Tope del cuerpo (el SMS real mide ~40-60; deja cabida a la orden más larga con la firma completa de 64). */
    public static final int LARGO_MAX = 120;
    public static final int FIRMA_MIN = 10;
    public static final int FIRMA_MAX = 64;

    private static final Pattern CMD = Pattern.compile("[a-z_]{1,24}");
    private static final Pattern CONTADOR = Pattern.compile("[0-9]{1,15}");
    private static final Pattern FIRMA = Pattern.compile("[0-9a-fA-F]{" + FIRMA_MIN + "," + FIRMA_MAX + "}");
    private static final Pattern ESPACIOS = Pattern.compile("\\s+");

    public enum Resultado {
        OK,
        /** No empieza con LB1: es un SMS normal, sigue su camino. */
        NO_ES_LB1,
        /** Empieza con LB1 pero no tiene la forma (se consume y se ignora). */
        FORMATO,
        SIN_CLAVE,
        FIRMA_MALA,
        ORDEN_DESCONOCIDA,
        CONTADOR_REPETIDO,
        CONTADOR_SALTO,
        ERROR_INTERNO
    }

    public static final class Orden {
        public final String cmd;
        public final long contador;
        /** Firma recibida, en minúsculas. */
        public final String firma;

        Orden(String cmd, long contador, String firma) {
            this.cmd = cmd;
            this.contador = contador;
            this.firma = firma;
        }
    }

    /** ¿Este cuerpo es un SMS de despertar (empieza con «LB1» y luego espacio o fin)? Si sí, NUNCA se reenvía. */
    public static boolean esLB1(String cuerpo) {
        if (cuerpo == null) return false;
        int i = 0, n = cuerpo.length();
        while (i < n && Character.isWhitespace(cuerpo.charAt(i))) i++;
        if (!cuerpo.regionMatches(true, i, PREFIJO, 0, PREFIJO.length())) return false;
        int j = i + PREFIJO.length();
        return j >= n || Character.isWhitespace(cuerpo.charAt(j));
    }

    /** Analiza la forma. null si no es LB1 con cuatro campos válidos. */
    public static Orden analizar(String cuerpo) {
        if (!esLB1(cuerpo)) return null;
        String t = cuerpo.trim();
        if (t.length() > LARGO_MAX) return null;
        String[] p = ESPACIOS.split(t);
        if (p.length != 4 || !PREFIJO.equalsIgnoreCase(p[0])) return null;
        String cmd = p[1].toLowerCase(Locale.ROOT);
        if (!CMD.matcher(cmd).matches()) return null;
        if (!CONTADOR.matcher(p[2]).matches()) return null;
        long contador;
        try {
            contador = Long.parseLong(p[2]);
        } catch (NumberFormatException e) {
            return null;
        }
        if (contador <= 0) return null;
        if (!FIRMA.matcher(p[3]).matches()) return null;
        return new Orden(cmd, contador, p[3].toLowerCase(Locale.ROOT));
    }

    public static boolean ordenPermitida(String cmd) {
        return CMD_LATIDO_YA.equals(cmd) || CMD_REINICIAR_SERVICIO.equals(cmd) || CMD_REENVIAR_HISTORIAL.equals(cmd);
    }

    /** Texto que se firma: «LB1 cmd contador». */
    public static String mensajeFirmado(String cmd, long contador) {
        return PREFIJO + " " + cmd + " " + contador;
    }

    /** Firma completa (64 hex) que el servidor calcularía; sirve a las pruebas y al servidor de ejemplo. */
    public static String firmaCompleta(String secreto, String cmd, long contador) throws Exception {
        return Request.computeHmacSha256Hex(secreto, mensajeFirmado(cmd, contador));
    }

    /** Comparación en tiempo constante de la firma recibida con el mismo número de caracteres de la esperada. */
    static boolean firmaCoincide(String secreto, Orden o) {
        try {
            String esperada = firmaCompleta(secreto, o.cmd, o.contador);
            if (o.firma.length() > esperada.length()) return false;
            byte[] a = esperada.substring(0, o.firma.length()).getBytes(StandardCharsets.US_ASCII);
            byte[] b = o.firma.getBytes(StandardCharsets.US_ASCII);
            return MessageDigest.isEqual(a, b);
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Valida un cuerpo contra la clave de la regla y el último contador aceptado. NO guarda nada: quien lo llama
     * debe guardar el contador (de forma atómica) antes de ejecutar la orden.
     */
    public static Resultado validar(String cuerpo, String secreto, long ultimoContador) {
        return validarOrden(cuerpo, secreto, ultimoContador, null);
    }

    /** Igual que validar(); si sale OK deja la orden en salida[0] (salida puede ser null). */
    public static Resultado validarOrden(String cuerpo, String secreto, long ultimoContador, Orden[] salida) {
        if (!esLB1(cuerpo)) return Resultado.NO_ES_LB1;
        Orden o = analizar(cuerpo);
        if (o == null) return Resultado.FORMATO;
        if (secreto == null || secreto.isEmpty()) return Resultado.SIN_CLAVE;
        try {
            // La firma va PRIMERO: sin ella no se revela nada más (ni siquiera si la orden existe o si el contador sirve).
            if (!firmaCoincide(secreto, o)) return Resultado.FIRMA_MALA;
        } catch (RuntimeException e) {
            return Resultado.ERROR_INTERNO;
        }
        if (!ordenPermitida(o.cmd)) return Resultado.ORDEN_DESCONOCIDA;
        if (o.contador <= ultimoContador) return Resultado.CONTADOR_REPETIDO;
        if (ultimoContador > 0 && o.contador > ultimoContador + SALTO_MAX) return Resultado.CONTADOR_SALTO;
        if (salida != null && salida.length > 0) salida[0] = o;
        return Resultado.OK;
    }
}
