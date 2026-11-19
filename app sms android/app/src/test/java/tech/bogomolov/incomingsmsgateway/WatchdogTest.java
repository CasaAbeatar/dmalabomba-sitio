package tech.bogomolov.incomingsmsgateway;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** La Bomba 2.7.0: decisiones del vigilante (cuando levantar el servicio y cuando mandar latido). */
public class WatchdogTest {

    private static final long MIN = 60_000L;
    private static final long INT = 15 * MIN;
    private static final long T = 1_000_000_000_000L;

    @Test
    public void servicioMuertoSeLevantaYElVigilanteMandaElLatidoPorSuCuenta() {
        Watchdog.Decision d = Watchdog.decidir(false, true, T, T - MIN, INT);
        assertTrue(d.levantarServicio);
        assertTrue(d.mandarLatido);
    }

    @Test
    public void servicioVivoYLatidoAlDiaNoHaceNada() {
        Watchdog.Decision d = Watchdog.decidir(true, true, T, T - 5 * MIN, INT);
        assertFalse(d.levantarServicio);
        assertFalse(d.mandarLatido);
    }

    @Test
    public void servicioVivoPeroLatidoAtrasadoMasDeUnoYMedioIntervalosManda() {
        // 22,5 min = 1,5 intervalos de 15 min: justo en el limite ya manda
        assertTrue(Watchdog.decidir(true, true, T, T - (INT * 3) / 2, INT).mandarLatido);
        assertFalse(Watchdog.decidir(true, true, T, T - (INT * 3) / 2 + 1, INT).mandarLatido);
        assertFalse(Watchdog.decidir(true, true, T, T - (INT * 3) / 2 + 1, INT).levantarServicio);
    }

    @Test
    public void conElLatidoApagadoNuncaMandaPeroSiLevantaElServicio() {
        Watchdog.Decision d = Watchdog.decidir(false, false, T, 0, INT);
        assertTrue(d.levantarServicio);
        assertFalse(d.mandarLatido);
        assertFalse(Watchdog.decidir(true, false, T, 0, INT).mandarLatido);
    }

    @Test
    public void nuncaHuboLatidoYElServicioVivoManda() {
        assertTrue(Watchdog.decidir(true, true, T, 0, INT).mandarLatido);
    }

    @Test
    public void dedupeEvitaDosLatidosSeguidosSalvoForzado() {
        assertFalse(Watchdog.pasaDedupe(T, T - 10_000, false));
        assertTrue(Watchdog.pasaDedupe(T, T - 10_000, true));
        assertTrue(Watchdog.pasaDedupe(T, T - Watchdog.DEDUPE_MS, false));
        assertTrue(Watchdog.pasaDedupe(T, 0, false));
        // si el reloj retrocedio (ultimo intento "en el futuro") no se bloquea para siempre
        assertTrue(Watchdog.pasaDedupe(T, T + 5 * MIN, false));
    }

    @Test
    public void siguienteLatidoEnRespetaElIntervaloYElMinimo() {
        assertEquals(Watchdog.PRIMER_LATIDO_MIN_MS, Watchdog.siguienteLatidoEn(T, 0, INT));
        assertEquals(INT, Watchdog.siguienteLatidoEn(T, T, INT));
        assertEquals(10 * MIN, Watchdog.siguienteLatidoEn(T, T - 5 * MIN, INT));
        // atrasado: manda pronto, no de golpe
        assertEquals(Watchdog.PRIMER_LATIDO_MIN_MS, Watchdog.siguienteLatidoEn(T, T - 40 * MIN, INT));
        assertEquals(Watchdog.PRIMER_LATIDO_MIN_MS, Watchdog.siguienteLatidoEn(T, T + MIN, INT));
    }

    @Test
    public void semaforoDelUltimoLatido() {
        assertFalse(Watchdog.latidoReciente(T, 0, INT));
        assertTrue(Watchdog.latidoReciente(T, T - 10 * MIN, INT));
        assertTrue(Watchdog.latidoReciente(T, T - 31 * MIN, INT));
        assertFalse(Watchdog.latidoReciente(T, T - 32 * MIN, INT));
        assertFalse(Watchdog.latidoReciente(T, T + MIN, INT));
    }
}
