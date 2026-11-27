package tech.bogomolov.incomingsmsgateway;

import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Set;

/**
 * La Bomba 2.12.0 (auditoría): reglas puras (sin Android, se prueban en la JVM) de cuándo el servicio de accesibilidad
 * puede pulsar «Instalar/Actualizar» en el diálogo del instalador del sistema durante la actualización automática.
 *
 *  1. Solo en un paquete de LISTA CERRADA de instaladores del sistema (nunca «cualquier app con FLAG_SYSTEM»).
 *  2. Solo durante 90 s desde que la app abrió su sesión de instalación (PackageInstaller.createSession).
 *  3. Solo si el texto de la ventana del instalador contiene el nombre (label) de esta app: si el diálogo es de otra
 *     app, no se pulsa nada.
 *  4. Solo un botón cuyo texto sea EXACTAMENTE uno de TEXTOS_BOTON.
 *
 * Instaladores: en teléfonos con servicios de Google (HONOR y Huawei con GMS incluidos) el diálogo es de
 * com.google.android.packageinstaller; en AOSP y sin GMS, com.android.packageinstaller; Samsung usa el suyo. Los nombres
 * de HONOR/Huawei propios figuran por si algún firmware los usa (no hay documentación pública que los confirme).
 */
public final class InstaladorPolitica {

    public static final Set<String> PAQUETES = Collections.unmodifiableSet(new LinkedHashSet<>(Arrays.asList(
            "com.google.android.packageinstaller",
            "com.android.packageinstaller",
            "com.samsung.android.packageinstaller",
            "com.huawei.android.packageinstaller",
            "com.hihonor.android.packageinstaller")));

    /** Cuánto dura la posibilidad de pulsar, contada desde que la app abrió la sesión de instalación. */
    public static final long VENTANA_MS = 90_000L;

    /** Textos EXACTOS (sin distinguir mayúsculas) de los botones que se pueden pulsar. */
    public static final String[] TEXTOS_BOTON = {"Instalar", "Actualizar", "Update", "Install"};

    private InstaladorPolitica() {
    }

    public static boolean paqueteValido(String pkg) {
        return pkg != null && PAQUETES.contains(pkg);
    }

    /**
     * ¿Seguimos dentro de la ventana de 90 s? Reloj monótono (SystemClock.elapsedRealtime). {@code inicioMs <= 0} = no hay
     * sesión abierta por la app: no se pulsa nada.
     */
    public static boolean dentroDeVentana(long inicioMs, long ahoraMs) {
        if (inicioMs <= 0) return false;
        long t = ahoraMs - inicioMs;
        return t >= 0 && t < VENTANA_MS;
    }

    /** ¿Algún texto de la ventana contiene el nombre de la app (sin distinguir mayúsculas)? Con nombre vacío: false. */
    public static boolean contieneNombreDeApp(Iterable<? extends CharSequence> textos, String nombreApp) {
        if (textos == null || nombreApp == null) return false;
        String n = nombreApp.trim().toLowerCase(Locale.ROOT);
        if (n.isEmpty()) return false;
        for (CharSequence t : textos) {
            if (t != null && t.toString().toLowerCase(Locale.ROOT).contains(n)) return true;
        }
        return false;
    }

    /** ¿El texto del botón es exactamente «Instalar», «Actualizar», «Update» o «Install»? */
    public static boolean textoDeBotonValido(CharSequence texto) {
        if (texto == null) return false;
        String t = texto.toString().trim();
        for (String ok : TEXTOS_BOTON) {
            if (t.equalsIgnoreCase(ok)) return true;
        }
        return false;
    }
}
