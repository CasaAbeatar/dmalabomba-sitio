package tech.bogomolov.incomingsmsgateway;

/**
 * La Bomba 2.11.0: manejo puro (sin Android) de las listas «a:b:c» de Ajustes seguros donde Android guarda los servicios
 * activados (enabled_notification_listeners, enabled_accessibility_services). Cada elemento es «paquete/clase», y
 * Android acepta también la forma corta «paquete/.Clase»: se comparan normalizados.
 */
public final class ListaServicios {

    private ListaServicios() {
    }

    /** «pkg/.Clase» -> «pkg/pkg.Clase»; «pkg/Clase» queda igual; null si no tiene la forma. */
    static String normalizar(String elemento) {
        if (elemento == null) return null;
        String e = elemento.trim();
        int i = e.indexOf('/');
        if (i <= 0 || i == e.length() - 1) return null;
        String pkg = e.substring(0, i), cls = e.substring(i + 1);
        if (cls.startsWith(".")) cls = pkg + cls;
        return pkg + "/" + cls;
    }

    public static boolean contiene(String lista, String paquete, String clase) {
        if (lista == null || lista.isEmpty()) return false;
        String buscado = normalizar(paquete + "/" + clase);
        for (String p : lista.split(":")) {
            String n = normalizar(p);
            if (n != null && n.equals(buscado)) return true;
        }
        return false;
    }

    /** Devuelve la lista con el servicio añadido al final (sin duplicarlo ni tocar los demás). */
    public static String agregar(String lista, String paquete, String clase) {
        if (contiene(lista, paquete, clase)) return lista;
        String nuevo = paquete + "/" + clase;
        return lista == null || lista.isEmpty() ? nuevo : lista + ":" + nuevo;
    }
}
