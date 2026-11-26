package tech.bogomolov.incomingsmsgateway;

/**
 * La Bomba 2.11.0: el freno central contra el «rebote» (decisiones puras, sin Android, probadas en la JVM).
 *
 * POR QUÉ EXISTE. En MagicOS 9 (HONOR) el sistema le quitó la exención de batería a una app que se resucitaba
 * por muchas vías a la vez: servicio en primer plano, alarma, WorkManager, servicio de acceso a notificaciones,
 * servicio de accesibilidad, receptor de SMS, FCM... Cada vía era razonable sola; juntas, cada caída producía una
 * ráfaga de arranques y de alarmas, y el fabricante la leyó como una app que «se agarra» al teléfono.
 * Con 2.11.0 se suma FCM y el SMS de despertar, así que las vías de resurrección son más, no menos. El criterio:
 *
 *  1. UN SOLO arranque del servicio por ventana (LANZAR_MIN_MS = 30 s): si ya corre, o se intentó hace menos de
 *     30 s, no se vuelve a lanzar; en su lugar se deja UNA alarma para reintentar cuando se cumpla la ventana.
 *     Lo pedido a mano (botón de Salud, orden remota «reiniciar_servicio») salta el freno: es una orden, no un reflejo.
 *  2. UN SOLO programador de alarmas: hay una única alarma pendiente (mismo PendingIntent) y gana la MÁS PRÓXIMA.
 *     Así la alarma corta de 10 s que deja onDestroy() no la pisa después un «scheduleWatchers» que pide 5 min,
 *     ni diez llamadas seguidas a scheduleAlarm() mueven la alarma una y otra vez.
 *  3. Programar los vigilantes (WorkManager + alarma) como mucho una vez cada 30 s (el WorkManager ya es único y
 *     KEEP, pero cada llamada tocaba también la alarma).
 *  4. Reactivar un permiso de Ajustes seguros (accesibilidad, acceso a notificaciones) como mucho una vez por minuto:
 *     si Android lo rechaza o la persona lo apaga a propósito, no se pelea en bucle.
 *  5. Un despertar por FCM/SMS NO relanza nada más que lo anterior: manda su latido, que es lo que el servidor espera.
 */
public final class AntiRebote {

    private AntiRebote() {
    }

    /** Separación mínima entre dos arranques automáticos del servicio. */
    public static final long LANZAR_MIN_MS = 30_000L;
    /** Separación mínima entre dos llamadas a programar los vigilantes. */
    public static final long PROGRAMAR_MIN_MS = 30_000L;
    /** Separación mínima entre dos reactivaciones de un servicio por Ajustes seguros. */
    public static final long REACTIVAR_MIN_MS = 60_000L;

    /** ¿Se puede lanzar el servicio ahora? Falso si el último intento fue hace menos de LANZAR_MIN_MS (y el reloj no retrocedió). */
    public static boolean puedeLanzar(long ahora, long ultimoLanzamiento) {
        return ultimoLanzamiento <= 0 || ahora < ultimoLanzamiento || (ahora - ultimoLanzamiento) >= LANZAR_MIN_MS;
    }

    /** Cuánto falta para que se pueda volver a lanzar (0 si ya se puede). */
    public static long faltaParaLanzar(long ahora, long ultimoLanzamiento) {
        if (puedeLanzar(ahora, ultimoLanzamiento)) return 0;
        return Math.max(1_000L, LANZAR_MIN_MS - (ahora - ultimoLanzamiento));
    }

    /**
     * Hora en que debe quedar la ÚNICA alarma: la pendiente si todavía no llega y es igual o más próxima que la pedida;
     * si no, la pedida. Una pendiente que ya pasó (o 0) no cuenta.
     */
    public static long alarmaEfectiva(long ahora, long pendiente, long pedido) {
        long p = Math.max(pedido, ahora);
        if (pendiente > ahora && pendiente <= p) return pendiente;
        return p;
    }

    public static boolean puedeProgramar(long ahora, long ultimaProgramacion) {
        return ultimaProgramacion <= 0 || ahora < ultimaProgramacion || (ahora - ultimaProgramacion) >= PROGRAMAR_MIN_MS;
    }

    public static boolean puedeReactivar(long ahora, long ultimoIntento) {
        return ultimoIntento <= 0 || ahora < ultimoIntento || (ahora - ultimoIntento) >= REACTIVAR_MIN_MS;
    }
}
