package tech.bogomolov.incomingsmsgateway;

/**
 * La Bomba 2.7.0: decisiones puras del vigilante (WorkManager cada 15 min y alarma cada ~5 min).
 * Sin Android, para probarlas en la JVM.
 */
public final class Watchdog {

    private Watchdog() {
    }

    /** Dos latidos de cualquier origen a menos de esto se consideran el mismo (se omite el segundo). */
    public static final long DEDUPE_MS = 30_000L;
    /** Primer latido tras arrancar el servicio, como mínimo. */
    public static final long PRIMER_LATIDO_MIN_MS = 15_000L;
    /** Cada cuánto el vigilante por alarma revisa. */
    public static final long ALARMA_MS = 5 * 60_000L;

    public static final class Decision {
        public final boolean levantarServicio;
        public final boolean mandarLatido;

        Decision(boolean levantarServicio, boolean mandarLatido) {
            this.levantarServicio = levantarServicio;
            this.mandarLatido = mandarLatido;
        }
    }

    /**
     * @param servicioCorre   el servicio en primer plano está vivo
     * @param latidoActivo    el latido está encendido en Ajustes y hay dirección
     * @param ahora           reloj (ms)
     * @param ultimoIntento   último intento de latido (ms, 0 si nunca)
     * @param intervaloMs     intervalo configurado
     */
    public static Decision decidir(boolean servicioCorre, boolean latidoActivo, long ahora, long ultimoIntento, long intervaloMs) {
        boolean levantar = !servicioCorre;
        boolean latido = false;
        if (latidoActivo) {
            // Si el servicio no corre, el latido lo manda el vigilante por su cuenta.
            // Si corre pero se atrasó más de 1,5 intervalos, el servicio está colgado o dormido: se manda igual.
            latido = !servicioCorre || (ahora - ultimoIntento) >= (intervaloMs * 3) / 2;
        }
        return new Decision(levantar, latido);
    }

    /** ¿Conviene mandar ahora un latido disparado por un evento (red, carga...)? */
    public static boolean pasaDedupe(long ahora, long ultimoIntento, boolean forzar) {
        return forzar || ultimoIntento <= 0 || (ahora - ultimoIntento) >= DEDUPE_MS || ahora < ultimoIntento;
    }

    /** Espera hasta el próximo latido periódico: lo que falte del intervalo, entre 15 s y el intervalo. */
    public static long siguienteLatidoEn(long ahora, long ultimoIntento, long intervaloMs) {
        if (ultimoIntento <= 0 || ahora < ultimoIntento) return PRIMER_LATIDO_MIN_MS;
        long falta = ultimoIntento + intervaloMs - ahora;
        if (falta < PRIMER_LATIDO_MIN_MS) falta = PRIMER_LATIDO_MIN_MS;
        if (falta > intervaloMs) falta = intervaloMs;
        return falta;
    }

    /** Semáforo del último latido: verde si el último OK es de menos de 2 intervalos + 1 min. */
    public static boolean latidoReciente(long ahora, long ultimoOk, long intervaloMs) {
        if (ultimoOk <= 0) return false;
        long edad = ahora - ultimoOk;
        return edad >= 0 && edad <= 2 * intervaloMs + 60_000L;
    }
}
