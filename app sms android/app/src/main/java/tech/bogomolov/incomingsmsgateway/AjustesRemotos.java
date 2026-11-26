package tech.bogomolov.incomingsmsgateway;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * La Bomba 2.12.0: lista CERRADA de pantallas de Ajustes que la acción «abrir_ajuste» de la pantalla remota puede abrir,
 * con los intents candidatos de cada una (en orden: se usa el primero que el teléfono resuelve). Lógica pura (tabla):
 * PantallaRemotaService arma los Intent de verdad con esta tabla.
 *
 * Para qué sirve: ciertos ajustes (inicio automático de HONOR, exención de batería, acceso a notificaciones) no se pueden
 * cambiar desde la app, pero sí abrir; con la pantalla remota Emil llega a ellos y los toca sin ir al teléfono.
 * Es solo ABRIR la pantalla: no cambia ningún ajuste por sí sola, y no acepta ningún dato libre del servidor.
 */
public final class AjustesRemotos {

    public static final String BATERIA = "bateria";
    public static final String APP = "app";
    public static final String ACCESO_NOTIFICACIONES = "acceso_notificaciones";
    public static final String ACCESIBILIDAD = "accesibilidad";
    public static final String INICIO_APPS = "inicio_apps";
    public static final String AHORRO_ENERGIA = "ahorro_energia";
    /**
     * Extra de la app (no está en la lista del contrato del servidor, que no lo manda todavía): la pantalla «Instalar apps
     * desconocidas» de ESTA app. La actualización automática sin confirmación necesita ese permiso (REQUEST_INSTALL_PACKAGES).
     */
    public static final String INSTALAR_APPS = "instalar_apps";

    public static final Set<String> QUE = Collections.unmodifiableSet(new LinkedHashSet<>(Arrays.asList(
            BATERIA, APP, ACCESO_NOTIFICACIONES, ACCESIBILIDAD, INICIO_APPS, AHORRO_ENERGIA, INSTALAR_APPS)));

    /** Código con que se confirma el último recurso (detalles de la app) y cuando no hay ninguno. */
    public static final String RESPALDO = "detalles_app_respaldo";
    public static final String NO_DISPONIBLE = "no_disponible";

    /** Un intent candidato: o una acción de Ajustes, o un componente explícito de otro paquete (gestor del fabricante). */
    public static final class Candidato {
        /** [a-z0-9_]{1,40}: lo que viaja en «ok:<código>». */
        public final String codigo;
        public final String accion;     // null si es un componente explícito
        public final String paquete;    // componente explícito: paquete
        public final String clase;      // componente explícito: clase
        /** true: el intent lleva «package:<este paquete>» como dato (detalles de la aplicación). */
        public final boolean conPaqueteDeLaApp;

        Candidato(String codigo, String accion, String paquete, String clase, boolean conPaqueteDeLaApp) {
            this.codigo = codigo;
            this.accion = accion;
            this.paquete = paquete;
            this.clase = clase;
            this.conPaqueteDeLaApp = conPaqueteDeLaApp;
        }
    }

    private AjustesRemotos() {
    }

    private static Candidato accion(String codigo, String accion, boolean conPaquete) {
        return new Candidato(codigo, accion, null, null, conPaquete);
    }

    private static Candidato componente(String codigo, String paquete, String clase) {
        return new Candidato(codigo, null, paquete, clase, false);
    }

    private static Candidato respaldo() {
        return accion(RESPALDO, "android.settings.APPLICATION_DETAILS_SETTINGS", true);
    }

    /** Candidatos de {@code que}, en orden; vacío si {@code que} no está en la lista cerrada. */
    public static List<Candidato> candidatos(String que) {
        List<Candidato> l = new ArrayList<>();
        if (que == null || !QUE.contains(que)) return l;
        switch (que) {
            case BATERIA:
                l.add(accion("bateria", "android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS", false));
                l.add(accion("bateria_uso", "android.intent.action.POWER_USAGE_SUMMARY", false));
                break;
            case APP:
                l.add(accion("detalles_app", "android.settings.APPLICATION_DETAILS_SETTINGS", true));
                break;
            case ACCESO_NOTIFICACIONES:
                l.add(accion("acceso_notif", "android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS", false));
                break;
            case ACCESIBILIDAD:
                l.add(accion("accesibilidad", "android.settings.ACCESSIBILITY_SETTINGS", false));
                break;
            case INICIO_APPS:
                // Gestores de HONOR (MagicOS) y de Huawei: «inicio de aplicaciones» / «protegidas». Los nombres cambian según la
                // versión; se prueban en orden y, si ninguno abre, se cae a los detalles de la app.
                l.add(componente("inicio_honor_lista", "com.hihonor.systemmanager", "com.hihonor.systemmanager.startupmgr.ui.StartupNormalAppListActivity"));
                l.add(componente("inicio_honor_control", "com.hihonor.systemmanager", "com.hihonor.systemmanager.appcontrol.activity.StartupAppControlActivity"));
                l.add(componente("inicio_honor_proteg", "com.hihonor.systemmanager", "com.hihonor.systemmanager.optimize.process.ProtectActivity"));
                l.add(componente("inicio_huawei_lista", "com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"));
                l.add(componente("inicio_huawei_control", "com.huawei.systemmanager", "com.huawei.systemmanager.appcontrol.activity.StartupAppControlActivity"));
                l.add(componente("inicio_huawei_proteg", "com.huawei.systemmanager", "com.huawei.systemmanager.optimize.process.ProtectActivity"));
                break;
            case AHORRO_ENERGIA:
                l.add(accion("ahorro_energia", "android.settings.BATTERY_SAVER_SETTINGS", false));
                l.add(accion("bateria_uso", "android.intent.action.POWER_USAGE_SUMMARY", false));
                break;
            case INSTALAR_APPS:
                l.add(accion("instalar_apps", "android.settings.MANAGE_UNKNOWN_APP_SOURCES", true));
                break;
            default:
                return l;
        }
        l.add(respaldo());
        return l;
    }

    /** El resultado que se confirma al servidor cuando se abrió el candidato con ese código. */
    public static String resultadoOk(String codigo) {
        return "ok:" + codigo;
    }
}
