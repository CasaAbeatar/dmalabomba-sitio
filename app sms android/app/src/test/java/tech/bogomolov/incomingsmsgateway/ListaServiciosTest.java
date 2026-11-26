package tech.bogomolov.incomingsmsgateway;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** La Bomba 2.11.0: listas «a:b:c» de Ajustes seguros (JVM pura). */
public class ListaServiciosTest {

    private static final String P = "tech.bogomolov.incomingsmsgateway";
    private static final String C = "tech.bogomolov.incomingsmsgateway.GuardianListenerService";

    @Test
    public void contieneConLaFormaLargaYLaCorta() {
        assertTrue(ListaServicios.contiene(P + "/" + C, P, C));
        assertTrue(ListaServicios.contiene("otro.app/otro.Servicio:" + P + "/.GuardianListenerService", P, C));
        assertTrue(ListaServicios.contiene(" " + P + "/" + C + " ", P, C));
    }

    @Test
    public void noContieneEnListasVaciasNulasOAjenas() {
        assertFalse(ListaServicios.contiene(null, P, C));
        assertFalse(ListaServicios.contiene("", P, C));
        assertFalse(ListaServicios.contiene("otro.app/otro.Servicio", P, C));
        assertFalse(ListaServicios.contiene(P + "/" + C + "X", P, C));
        assertFalse(ListaServicios.contiene("basura::sin-barra:", P, C));
        assertFalse(ListaServicios.contiene(P + "/", P, C));
    }

    @Test
    public void agregarNoDuplicaNiToca() {
        assertEquals(P + "/" + C, ListaServicios.agregar(null, P, C));
        assertEquals(P + "/" + C, ListaServicios.agregar("", P, C));
        assertEquals("otro.app/otro.S:" + P + "/" + C, ListaServicios.agregar("otro.app/otro.S", P, C));
        String ya = "otro.app/otro.S:" + P + "/.GuardianListenerService";
        assertEquals("no duplica aunque venga en forma corta", ya, ListaServicios.agregar(ya, P, C));
    }
}
