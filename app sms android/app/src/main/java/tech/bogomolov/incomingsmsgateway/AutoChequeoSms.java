package tech.bogomolov.incomingsmsgateway;

import java.util.List;

/**
 * La Bomba 2.12.0: autochequeo gratuito «el teléfono recibe SMS pero la app no los reenvía». Lógica pura (JVM).
 *
 * En lugar de que el servidor mande un SMS «canario» (necesitaría un proveedor de pago), la propia app compara su
 * bandeja de entrada con lo que ya reenvió: cuenta los SMS que las reglas de reenvío cubren, que llegaron en las
 * últimas 48 h y DESPUÉS del último reenvío exitoso. Solo lee (nunca manda ni borra nada) y no cuesta nada.
 *
 * Para no dar falsas alarmas: un SMS recién llegado (menos de GRACIA_MS) todavía puede estar reenviándose y no cuenta.
 */
public final class AutoChequeoSms {

    /** Ventana hacia atrás que se mira (48 h). */
    public static final long VENTANA_MS = 48L * 3600_000L;
    /** Un SMS más nuevo que esto aún puede estar en camino al servidor: no cuenta. */
    public static final long GRACIA_MS = 60_000L;
    public static final int TOPE = 999;

    private AutoChequeoSms() {
    }

    /** Decide si una regla de reenvío cubre este SMS (remitente y filtro). En producción usa las reglas de ForwardingConfig. */
    public interface Cubre {
        boolean cubre(String remitente, String texto);
    }

    public static final class Sms {
        public final String remitente;
        public final String texto;
        public final long fechaMs;

        public Sms(String remitente, String texto, long fechaMs) {
            this.remitente = remitente;
            this.texto = texto;
            this.fechaMs = fechaMs;
        }
    }

    /**
     * @param bandeja            SMS de la bandeja (cualquier orden)
     * @param ultimoReenvioOkMs  hora (ms) del último reenvío exitoso; 0 si nunca
     * @param ahoraMs            hora actual (ms)
     * @return cuántos SMS cubiertos por las reglas no tienen reenvío posterior (0..TOPE)
     */
    public static int contar(List<Sms> bandeja, long ultimoReenvioOkMs, long ahoraMs, Cubre cubre) {
        if (bandeja == null || cubre == null) return 0;
        long desde = Math.max(ultimoReenvioOkMs, ahoraMs - VENTANA_MS);
        long hasta = ahoraMs - GRACIA_MS;
        int n = 0;
        for (Sms s : bandeja) {
            if (s == null || s.remitente == null || s.texto == null) continue;
            if (s.fechaMs <= desde || s.fechaMs > hasta) continue;
            if (!cubre.cubre(s.remitente, s.texto)) continue;
            n++;
            if (n >= TOPE) return TOPE;
        }
        return n;
    }

    /** Fecha (ms) del SMS más nuevo de la bandeja; 0 si está vacía. */
    public static long masNuevo(List<Sms> bandeja) {
        long m = 0;
        if (bandeja == null) return 0;
        for (Sms s : bandeja) {
            if (s != null && s.fechaMs > m) m = s.fechaMs;
        }
        return m;
    }
}
