package tech.bogomolov.incomingsmsgateway;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** La Bomba 2.12.0 (auditoría): reglas de la depuración inalámbrica a pedido (JVM pura). */
public class AdbPoliticaTest {

    private static final long T0 = 1_000_000_000_000L;
    private static final long CIERRE = T0 + AdbInalambrico.AUTOCIERRE_MS;

    @Test
    public void apagadaSeAbreConPlazoNuevo() {
        assertEquals(AdbPolitica.Apertura.ABRIR, AdbPolitica.decidirApertura(false, 0, T0));
        // quedó una hora de cierre vieja pero el sistema ya la había apagado: se abre de nuevo
        assertEquals(AdbPolitica.Apertura.ABRIR, AdbPolitica.decidirApertura(false, CIERRE, T0 + 5_000));
    }

    @Test
    public void otroAbrirMientrasEstaAbiertaPorLaAppNoExtiendeElPlazo() {
        assertEquals(AdbPolitica.Apertura.YA_ABIERTA_POR_APP, AdbPolitica.decidirApertura(true, CIERRE, T0 + 60_000));
        assertEquals(AdbPolitica.Apertura.YA_ABIERTA_POR_APP, AdbPolitica.decidirApertura(true, CIERRE, CIERRE - 1));
    }

    @Test
    public void abiertaAManoNoSeToca() {
        assertEquals(AdbPolitica.Apertura.YA_ABIERTA_A_MANO, AdbPolitica.decidirApertura(true, 0, T0));
    }

    @Test
    public void vencidaSeCierraYSeAbreConPlazoNuevo() {
        assertEquals(AdbPolitica.Apertura.CERRAR_VENCIDA_Y_ABRIR, AdbPolitica.decidirApertura(true, CIERRE, CIERRE));
        assertEquals(AdbPolitica.Apertura.CERRAR_VENCIDA_Y_ABRIR, AdbPolitica.decidirApertura(true, CIERRE, CIERRE + 3_600_000L));
    }

    @Test
    public void opcionesDeDesarrolloloSoloSeApaganSiLasEncendioLaApp() {
        assertTrue(AdbPolitica.encenderDesarrollo(false));
        assertFalse(AdbPolitica.encenderDesarrollo(true));
        assertTrue(AdbPolitica.apagarDesarrolloAlCerrar(true));
        assertFalse(AdbPolitica.apagarDesarrolloAlCerrar(false));
    }

    @Test
    public void elPuertoSoloSeReportaMientrasEstaAbierta() {
        assertFalse(AdbPolitica.puertoReportable(false, 0, T0));
        assertFalse(AdbPolitica.puertoReportable(false, CIERRE, T0));
        assertTrue(AdbPolitica.puertoReportable(true, CIERRE, T0 + 1));        // abierta por la app, dentro del plazo
        assertTrue(AdbPolitica.puertoReportable(true, 0, T0));                 // abierta a mano
        assertFalse(AdbPolitica.puertoReportable(true, CIERRE, CIERRE));       // vencida: ya no se reporta
        assertFalse(AdbPolitica.puertoReportable(true, CIERRE, CIERRE + 1));
    }
}
