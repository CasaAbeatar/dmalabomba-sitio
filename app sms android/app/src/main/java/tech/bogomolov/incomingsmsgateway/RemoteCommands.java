package tech.bogomolov.incomingsmsgateway;

import org.json.JSONArray;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * La Bomba 2.7.0: órdenes remotas. Lógica pura (se prueba en la JVM).
 *
 * Reglas de seguridad:
 *  - Solo se leen de la respuesta a un latido que la app misma inició (nunca hay un puerto abierto).
 *  - Lista CERRADA de órdenes; cualquier otra se ignora (no se ejecuta ni se confirma).
 *  - La respuesta es de confianza si va firmada (X-Signature = HMAC-SHA256 del cuerpo con la misma clave
 *    de la regla) o, sin firma, solo si la conexión fue https con certificado verificado.
 *    Si trae firma y no coincide, se descarta todo.
 *  - Cada id se ejecuta una sola vez (CommandLog).
 */
public final class RemoteCommands {

    public static final String REINICIAR_SERVICIO = "reiniciar_servicio";
    public static final String LATIDO_YA = "latido_ya";
    public static final String REENVIAR_HISTORIAL = "reenviar_historial";
    public static final String REINICIAR_TELEFONO = "reiniciar_telefono";

    public static final Set<String> PERMITIDOS = Collections.unmodifiableSet(new LinkedHashSet<>(
            Arrays.asList(REINICIAR_SERVICIO, LATIDO_YA, REENVIAR_HISTORIAL, REINICIAR_TELEFONO)));

    /** Tope de órdenes que se leen de una sola respuesta. */
    public static final int MAX_POR_RESPUESTA = 5;
    /** Cuántos ids ejecutados se recuerdan. */
    public static final int MAX_RECORDADOS = 200;

    private RemoteCommands() {
    }

    public static final class Command {
        public final long id;
        public final String cmd;

        public Command(long id, String cmd) {
            this.id = id;
            this.cmd = cmd;
        }
    }

    /** Lee {"comandos":[{"id":n,"cmd":"..."}]}. Nunca lanza: lo malformado devuelve lista vacía. */
    public static List<Command> parse(String body) {
        List<Command> out = new ArrayList<>();
        if (body == null || body.isEmpty()) return out;
        try {
            JSONObject root = new JSONObject(body);
            JSONArray arr = root.optJSONArray("comandos");
            if (arr == null) return out;
            Set<Long> vistos = new LinkedHashSet<>();
            for (int i = 0; i < arr.length() && out.size() < MAX_POR_RESPUESTA; i++) {
                JSONObject o = arr.optJSONObject(i);
                if (o == null) continue;
                Object idRaw = o.opt("id");
                if (!(idRaw instanceof Number)) continue;
                long id = ((Number) idRaw).longValue();
                if (id < 0 || ((Number) idRaw).doubleValue() != (double) id) continue;
                Object cmdRaw = o.opt("cmd");
                if (!(cmdRaw instanceof String)) continue;
                String cmd = (String) cmdRaw;
                if (!PERMITIDOS.contains(cmd)) continue;   // lista cerrada: lo demás se ignora
                if (!vistos.add(id)) continue;
                out.add(new Command(id, cmd));
            }
        } catch (Exception e) {
            // cuerpo que no es JSON: no hay órdenes
        }
        return out;
    }

    /** Las órdenes cuyo id aún no se ha ejecutado. */
    public static List<Command> nuevas(List<Command> todas, CommandLog log) {
        List<Command> out = new ArrayList<>();
        for (Command c : todas) {
            if (!log.contains(c.id)) out.add(c);
        }
        return out;
    }

    /**
     * ¿Se puede confiar en esta respuesta? Con firma: debe coincidir. Sin firma: solo si es https y 2xx.
     */
    public static boolean respuestaConfiable(String url, int httpCode, String body, String firmaHex, String secret) {
        if (httpCode < 200 || httpCode >= 300 || body == null) return false;
        if (firmaHex != null && !firmaHex.trim().isEmpty()) {
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
        return url != null && url.toLowerCase().startsWith("https://");
    }

    /** Registro acotado de ids ya ejecutados; se guarda como texto "1,2,3". */
    public static final class CommandLog {
        private final LinkedHashSet<Long> ids = new LinkedHashSet<>();

        public static CommandLog fromString(String s) {
            CommandLog l = new CommandLog();
            if (s != null) {
                for (String p : s.split(",")) {
                    p = p.trim();
                    if (p.isEmpty()) continue;
                    try {
                        l.ids.add(Long.parseLong(p));
                    } catch (NumberFormatException ignored) {
                    }
                }
            }
            return l;
        }

        public boolean contains(long id) {
            return ids.contains(id);
        }

        /** @return false si ya estaba. */
        public boolean add(long id) {
            boolean nuevo = ids.add(id);
            while (ids.size() > MAX_RECORDADOS) {
                ids.remove(ids.iterator().next());   // se olvida el más viejo
            }
            return nuevo;
        }

        public int size() {
            return ids.size();
        }

        @Override
        public String toString() {
            StringBuilder b = new StringBuilder();
            for (Long id : ids) {
                if (b.length() > 0) b.append(',');
                b.append(id);
            }
            return b.toString();
        }
    }
}
