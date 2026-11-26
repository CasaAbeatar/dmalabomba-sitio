package tech.bogomolov.incomingsmsgateway;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.HashMap;
import java.util.Map;

/** La Bomba 2.11.0: reglas del mensaje de despertar de FCM (JVM pura). */
public class DespertarFcmTest {

    private static final long AHORA = 1_800_000_000_000L;

    private static Map<String, String> msg(String tipo, String id, String ts) {
        Map<String, String> m = new HashMap<>();
        if (tipo != null) m.put("tipo", tipo);
        if (id != null) m.put("despertar_id", id);
        if (ts != null) m.put("ts", ts);
        m.put("titulo", "Reconectando...");
        return m;
    }

    @Test
    public void despertarValidoYReciente() {
        DespertarFcm.Orden o = DespertarFcm.analizar(msg("despertar", "77", String.valueOf(AHORA - 5_000)), AHORA);
        assertNotNull(o);
        assertEquals(77, o.despertarId);
        assertEquals(AHORA - 5_000, o.ts);
    }

    @Test
    public void tipoDebeSerExactamenteDespertar() {
        for (String t : new String[]{"Despertar", "despertar ", " despertar", "DESPERTAR", "latido", "", "despertar\n"}) {
            assertNull("tipo " + t, DespertarFcm.analizar(msg(t, "1", String.valueOf(AHORA)), AHORA));
        }
        assertNull(DespertarFcm.analizar(msg(null, "1", String.valueOf(AHORA)), AHORA));
    }

    @Test
    public void idYTsDebenSerNumerosEnterosPositivos() {
        String ts = String.valueOf(AHORA);
        for (String id : new String[]{null, "", "0", "-3", "abc", "1.5", "1e3", " 4", "4 ", "+4", "12345678901234567890"}) {
            assertNull("id " + id, DespertarFcm.analizar(msg("despertar", id, ts), AHORA));
        }
        for (String t : new String[]{null, "", "0", "-1", "ayer", "1.5e12", String.valueOf(AHORA) + "0000"}) {
            assertNull("ts " + t, DespertarFcm.analizar(msg("despertar", "1", t), AHORA));
        }
    }

    @Test
    public void tsViejoOFuturoSeIgnora() {
        assertNotNull(DespertarFcm.analizar(msg("despertar", "1", String.valueOf(AHORA - DespertarFcm.VENTANA_PASADO_MS)), AHORA));
        assertNull(DespertarFcm.analizar(msg("despertar", "1", String.valueOf(AHORA - DespertarFcm.VENTANA_PASADO_MS - 1)), AHORA));
        assertNotNull(DespertarFcm.analizar(msg("despertar", "1", String.valueOf(AHORA + DespertarFcm.VENTANA_FUTURO_MS)), AHORA));
        assertNull(DespertarFcm.analizar(msg("despertar", "1", String.valueOf(AHORA + DespertarFcm.VENTANA_FUTURO_MS + 1)), AHORA));
        assertNull("un mensaje de hace una hora (repetido por FCM o reenviado)",
                DespertarFcm.analizar(msg("despertar", "1", String.valueOf(AHORA - 3_600_000)), AHORA));
    }

    @Test
    public void mensajesSinDatosOConOtrasCosasSeIgnoran() {
        assertNull(DespertarFcm.analizar(null, AHORA));
        assertNull(DespertarFcm.analizar(new HashMap<>(), AHORA));
        Map<String, String> otro = new HashMap<>();
        otro.put("tipo", "promo");
        otro.put("texto", "compre ya");
        assertNull(DespertarFcm.analizar(otro, AHORA));
    }

    @Test
    public void camposExtraNoImportan() {
        Map<String, String> m = msg("despertar", "5", String.valueOf(AHORA));
        m.put("cmd", "reiniciar_telefono");
        m.put("url", "http://malo.example");
        assertNotNull(DespertarFcm.analizar(m, AHORA));
    }

    @Test
    public void elMismoDespertarEntregadoDosVecesSeratiendeUnaVez() {
        assertTrue(DespertarFcm.debeAtender(0, 0, 5, AHORA));
        assertFalse(DespertarFcm.debeAtender(5, AHORA, 5, AHORA + 3_000));
        assertTrue("otro despertar", DespertarFcm.debeAtender(5, AHORA, 6, AHORA + 3_000));
        assertTrue("pasada la ventana (reintento real del servidor)", DespertarFcm.debeAtender(5, AHORA, 5, AHORA + DespertarFcm.REPETIDO_MS));
        assertTrue("el reloj retrocedio", DespertarFcm.debeAtender(5, AHORA, 5, AHORA - 1));
    }

    @Test
    public void tokenValido() {
        assertTrue(DespertarFcm.tokenValido("a".repeat(20)));
        assertTrue(DespertarFcm.tokenValido("fA3:APA91bE_x-" + "z".repeat(40)));
        assertFalse(DespertarFcm.tokenValido("a".repeat(19)));
        assertFalse(DespertarFcm.tokenValido("a".repeat(256)));
        assertFalse(DespertarFcm.tokenValido("a".repeat(20) + "\n"));
        assertFalse(DespertarFcm.tokenValido("a".repeat(19) + " "));
        assertFalse(DespertarFcm.tokenValido(null));
    }
}
