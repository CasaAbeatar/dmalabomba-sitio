package tech.bogomolov.incomingsmsgateway;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** La Bomba 2.11.0: el freno central contra el rebote (JVM pura). */
public class AntiReboteTest {

    private static final long T = 1_800_000_000_000L;

    @Test
    public void elServicioNoSeLanzaDosVecesDentroDeLaVentana() {
        assertTrue("nunca se lanzo", AntiRebote.puedeLanzar(T, 0));
        assertFalse(AntiRebote.puedeLanzar(T + 1, T));
        assertFalse(AntiRebote.puedeLanzar(T + 29_999, T));
        assertTrue(AntiRebote.puedeLanzar(T + 30_000, T));
        assertTrue(AntiRebote.puedeLanzar(T + 600_000, T));
    }

    @Test
    public void unRelojQueRetrocedeNoDejaSordaALaApp() {
        assertTrue("el reloj salto hacia atras: se deja lanzar", AntiRebote.puedeLanzar(T - 5_000_000, T));
    }

    @Test
    public void faltaParaLanzarEsLoQueQuedaDeLaVentana() {
        assertEquals(0, AntiRebote.faltaParaLanzar(T + 40_000, T));
        assertEquals(20_000, AntiRebote.faltaParaLanzar(T + 10_000, T));
        assertEquals("nunca menos de 1 s (evita alarmas pegadas)", 1_000, AntiRebote.faltaParaLanzar(T + 29_999, T));
    }

    @Test
    public void unaSolaAlarmaGanaLaMasProxima() {
        // sin alarma pendiente: la pedida
        assertEquals(T + 300_000, AntiRebote.alarmaEfectiva(T, 0, T + 300_000));
        // pendiente la de 10 s (onDestroy) y llega un scheduleWatchers que pide 5 min: se queda la de 10 s
        assertEquals(T + 10_000, AntiRebote.alarmaEfectiva(T, T + 10_000, T + 300_000));
        // pendiente lejana y se pide una cercana: gana la cercana
        assertEquals(T + 10_000, AntiRebote.alarmaEfectiva(T, T + 300_000, T + 10_000));
        // misma hora: la misma
        assertEquals(T + 10_000, AntiRebote.alarmaEfectiva(T, T + 10_000, T + 10_000));
    }

    @Test
    public void unaAlarmaQueYaPasoNoCuentaComoPendiente() {
        assertEquals(T + 300_000, AntiRebote.alarmaEfectiva(T, T - 1, T + 300_000));
        assertEquals(T + 300_000, AntiRebote.alarmaEfectiva(T, T, T + 300_000));
    }

    @Test
    public void unaAlarmaPedidaEnElPasadoSeAdelantaAAhora() {
        assertEquals(T, AntiRebote.alarmaEfectiva(T, 0, T - 5_000));
    }

    @Test
    public void programarLosVigilantesSeLimitaACadaTreintaSegundos() {
        assertTrue(AntiRebote.puedeProgramar(T, 0));
        assertFalse(AntiRebote.puedeProgramar(T + 1_000, T));
        assertTrue(AntiRebote.puedeProgramar(T + 30_000, T));
        assertTrue(AntiRebote.puedeProgramar(T - 1, T));
    }

    @Test
    public void reactivarUnPermisoSeLimitaACadaMinuto() {
        assertTrue(AntiRebote.puedeReactivar(T, 0));
        assertFalse(AntiRebote.puedeReactivar(T + 59_999, T));
        assertTrue(AntiRebote.puedeReactivar(T + 60_000, T));
    }

    @Test
    public void unaRafagaDeDiezPedidosDejaUnSoloArranqueYUnaSolaAlarma() {
        // simula: 10 vias piden resucitar el servicio en 2 s
        long ultimo = 0;
        int arranques = 0;
        long pendiente = 0;
        int alarmasMovidas = 0;
        for (int i = 0; i < 10; i++) {
            long ahora = T + i * 200L;
            if (AntiRebote.puedeLanzar(ahora, ultimo)) {
                ultimo = ahora;
                arranques++;
            } else {
                long pedido = ahora + AntiRebote.faltaParaLanzar(ahora, ultimo);
                long ef = AntiRebote.alarmaEfectiva(ahora, pendiente, pedido);
                if (ef != pendiente) {
                    pendiente = ef;
                    alarmasMovidas++;
                }
            }
        }
        assertEquals(1, arranques);
        assertEquals("la alarma de reintento se arma una vez y no se mueve", 1, alarmasMovidas);
    }
}
