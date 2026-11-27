package tech.bogomolov.incomingsmsgateway;

import java.net.URL;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.regex.Pattern;

/**
 * La Bomba 2.12.0 (27 nov 2026, caída de los dominios): rutas de respaldo cuando falla el nombre de dominio.
 *
 * El 27 nov 2026 Microsoft canceló por error el registro de dmalabomba.com y el DNS dejó de resolver pagos.dmalabomba.com
 * (el teléfono mandaba SMS, latidos y pantalla por ahí, y la actualización también). Esta clase define, en lógica pura
 * (se prueba en la JVM), una lista CERRADA de caminos equivalentes que ya existen y que no dependen del DNS de dmalabomba.com:
 *
 *   mensajes (SMS /sms, latido /latido, pantalla /pantalla) — tres anfitriones, todos https, mismas firmas HMAC:
 *     1. pagos.dmalabomba.com                 (Cloudflare Pages + worker; el nombre usual)
 *     2. sinpe-pagos.pages.dev                (el MISMO proyecto de Cloudflare Pages, nombre propio de Cloudflare)
 *     3. dwlbcbtwdungyrykgahm.supabase.co     (las funciones de la base, directo: /functions/v1/sinpe-recibir[/latido], /sinpe-pantalla)
 *   actualización (/instalar/<archivo>.apk) — pagos.dmalabomba.com y sinpe-pagos.pages.dev (Supabase no aloja el APK).
 *
 * Reglas: solo https, puerto 443, sin usuario, consulta ni fragmento; solo las rutas de la tabla; ningún anfitrión se
 * toma del servidor (la oferta de actualización puede traer cualquiera de los dos de la lista, pero solo de la lista).
 * Los alternos se usan SOLO si el principal falla a nivel de red (no resuelve, no conecta, el certificado no corresponde)
 * o contesta una página que no es nuestra (HTML con 2xx, p. ej. la página «parked» del registrador): nunca por una
 * respuesta legítima del servidor. Un archivo de actualización sigue pasando por huella sha256, certificado y versión.
 */
final class RutasAlternas {

    static final String HOST_PAGOS = "pagos.dmalabomba.com";
    static final String HOST_PAGES = "sinpe-pagos.pages.dev";
    static final String HOST_SUPABASE = "dwlbcbtwdungyrykgahm.supabase.co";

    private static final String FN = "/functions/v1";
    /** {ruta en pagos/pages, ruta directa en Supabase}. */
    private static final String[][] RUTAS = {
            {"/sms", FN + "/sinpe-recibir"},
            {"/latido", FN + "/sinpe-recibir/latido"},
            {"/pantalla", FN + "/sinpe-pantalla"},
    };
    private static final Pattern RUTA_INSTALAR = Pattern.compile("^/instalar/[A-Za-z0-9._-]{1,100}\\.apk$");

    /** Solo para pruebas: reemplaza el cálculo de caminos (null = el real). */
    interface Resolutor {
        List<String> de(String url);
    }

    static volatile Resolutor paraPrueba = null;

    private RutasAlternas() {
    }

    /** ¿El anfitrión es uno de los tres nuestros? (para vigilar que una respuesta 2xx sea de nuestro servidor). */
    static boolean esAnfitrionPropio(String url) {
        String[] p = partes(url);
        return p != null;
    }

    /**
     * Caminos para un mensaje (SMS, latido o pantalla): el que se pidió primero y después los equivalentes. Si la URL no es
     * una de las nuestras (otro servidor del usuario, una ruta que no está en la tabla, http, etc.) devuelve solo la misma.
     */
    static List<String> candidatasMensaje(String url) {
        Resolutor r = paraPrueba;
        if (r != null) return r.de(url);
        List<String> out = new ArrayList<>();
        out.add(url);
        String[] p = partes(url);   // {host, ruta lógica índice}
        if (p == null) return out;
        int i = Integer.parseInt(p[1]);
        List<String> hosts = new ArrayList<>(Arrays.asList(HOST_PAGOS, HOST_PAGES, HOST_SUPABASE));
        hosts.remove(p[0]);
        for (String h : hosts) {
            String ruta = h.equals(HOST_SUPABASE) ? RUTAS[i][1] : RUTAS[i][0];
            out.add("https://" + h + ruta);
        }
        return out;
    }

    /** Caminos para descargar una actualización: la URL de la oferta y el otro anfitrión de Pages con la misma ruta. */
    static List<String> candidatasInstalador(String url) {
        Resolutor r = paraPrueba;
        if (r != null) return r.de(url);
        List<String> out = new ArrayList<>();
        out.add(url);
        try {
            URL u = new URL(url);
            if (!"https".equals(u.getProtocol()) || u.getUserInfo() != null || u.getQuery() != null || u.getRef() != null) return out;
            if (u.getPort() != -1 && u.getPort() != 443) return out;
            String host = u.getHost() == null ? "" : u.getHost().toLowerCase();
            String path = u.getPath() == null ? "" : u.getPath();
            if (!RUTA_INSTALAR.matcher(path).matches()) return out;
            if (host.equals(HOST_PAGOS)) out.add("https://" + HOST_PAGES + path);
            else if (host.equals(HOST_PAGES)) out.add("https://" + HOST_PAGOS + path);
        } catch (Exception ignored) {
            // URL mal formada: solo ella misma
        }
        return out;
    }

    /** {host, índice de ruta} si es una URL de mensajes nuestra; null si no. */
    private static String[] partes(String url) {
        if (url == null) return null;
        try {
            URL u = new URL(url.trim());
            if (!"https".equals(u.getProtocol()) || u.getUserInfo() != null || u.getQuery() != null || u.getRef() != null) return null;
            if (u.getPort() != -1 && u.getPort() != 443) return null;
            String host = u.getHost() == null ? "" : u.getHost().toLowerCase();
            String path = u.getPath() == null ? "" : u.getPath();
            while (path.endsWith("/") && path.length() > 1) path = path.substring(0, path.length() - 1);
            boolean propio = host.equals(HOST_PAGOS) || host.equals(HOST_PAGES) || host.equals(HOST_SUPABASE);
            if (!propio) return null;
            for (int i = 0; i < RUTAS.length; i++) {
                String esperada = host.equals(HOST_SUPABASE) ? RUTAS[i][1] : RUTAS[i][0];
                if (path.equals(esperada)) return new String[]{host, String.valueOf(i)};
            }
            return null;
        } catch (Exception e) {
            return null;
        }
    }

    /** Un cuerpo que empieza con «<» (HTML) no es una respuesta de nuestras funciones (que siempre contestan JSON). */
    static boolean pareceHtml(String cuerpo) {
        if (cuerpo == null) return false;
        String t = cuerpo.trim();
        return t.startsWith("<");
    }

    /**
     * ¿Este error de E/S ocurrió ANTES de que el servidor recibiera nada? Solo entonces se prueba otro camino (así un
     * mensaje nunca se manda dos veces por una respuesta perdida): nombre que no resuelve, conexión rechazada o sin ruta,
     * tiempo agotado al conectar, o certificado que no corresponde (un nombre secuestrado).
     */
    static boolean esFalloDeRed(java.io.IOException e) {
        if (e instanceof java.net.UnknownHostException
                || e instanceof java.net.ConnectException
                || e instanceof java.net.NoRouteToHostException
                || e instanceof javax.net.ssl.SSLHandshakeException
                || e instanceof javax.net.ssl.SSLPeerUnverifiedException) {
            return true;
        }
        if (e instanceof java.net.SocketTimeoutException) {
            String m = e.getMessage() == null ? "" : e.getMessage().toLowerCase();
            return m.contains("connect") && !m.contains("read");
        }
        return false;
    }
}
