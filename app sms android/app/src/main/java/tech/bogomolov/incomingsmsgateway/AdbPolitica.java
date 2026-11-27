package tech.bogomolov.incomingsmsgateway;

/**
 * La Bomba 2.12.0 (auditoría): decisiones puras (sin Android, se prueban en la JVM) de la depuración inalámbrica a pedido.
 *
 *  - Si ya está abierta por la app y no venció, otro abrir_adb NO extiende el plazo (el cierre automático sigue a los 30 min
 *    desde la primera apertura): un servidor o un atacante no pueden mantenerla abierta repitiendo la orden.
 *  - Si ya está abierta a mano (la app no anotó hora de cierre), no se toca: ni se cierra ni se le pone plazo.
 *  - Si la app encendió «opciones de desarrollador» para poder abrirla, al cerrar las vuelve a apagar; si ya estaban
 *    encendidas, quedan como estaban.
 *  - El puerto solo se reporta mientras está abierta (y, si la abrió la app, antes de su hora de cierre).
 */
public final class AdbPolitica {

    public enum Apertura {
        /** No está abierta: se abre y se anota la hora de cierre. */
        ABRIR,
        /** La abrió la app y aún no vence: no se hace nada (no se extiende el plazo). */
        YA_ABIERTA_POR_APP,
        /** Abierta a mano (sin hora de cierre anotada): no se toca. */
        YA_ABIERTA_A_MANO,
        /** La abrió la app y ya venció (el cierre no llegó a correr): se cierra y se abre de nuevo con plazo nuevo. */
        CERRAR_VENCIDA_Y_ABRIR
    }

    private AdbPolitica() {
    }

    public static Apertura decidirApertura(boolean activa, long cierraTs, long ahora) {
        if (!activa) return Apertura.ABRIR;
        if (cierraTs <= 0) return Apertura.YA_ABIERTA_A_MANO;
        return ahora < cierraTs ? Apertura.YA_ABIERTA_POR_APP : Apertura.CERRAR_VENCIDA_Y_ABRIR;
    }

    /** ¿La app debe encender «opciones de desarrollador»? Solo si están apagadas (entonces las apaga ella al cerrar). */
    public static boolean encenderDesarrollo(boolean desarrolloEncendido) {
        return !desarrolloEncendido;
    }

    /** ¿Al cerrar hay que apagar «opciones de desarrollador»? Solo si las encendió la app. */
    public static boolean apagarDesarrolloAlCerrar(boolean laEncendioLaApp) {
        return laEncendioLaApp;
    }

    /** ¿Se puede reportar el puerto ahora? Solo con la depuración abierta y, si la abrió la app, dentro de su plazo. */
    public static boolean puertoReportable(boolean activa, long cierraTs, long ahora) {
        if (!activa) return false;
        return cierraTs <= 0 || ahora < cierraTs;
    }
}
