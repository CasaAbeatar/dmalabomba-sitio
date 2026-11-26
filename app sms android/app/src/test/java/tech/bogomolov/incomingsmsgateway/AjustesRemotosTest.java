package tech.bogomolov.incomingsmsgateway;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.json.JSONObject;
import org.junit.Test;

import java.util.List;

/** La Bomba 2.12.0: abrir_ajuste de la pantalla remota y órdenes abrir_adb/cerrar_adb (JVM pura). */
public class AjustesRemotosTest {

    private static PantallaProtocolo.Accion unaAccion(String cuerpoAccion) {
        PantallaProtocolo.Respuesta r = PantallaProtocolo.parsear(
                "{\"ok\":true,\"sesion\":true,\"sid\":\"s1\",\"resta_s\":600,\"acciones\":[" + cuerpoAccion + "]}");
        return r.acciones.isEmpty() ? null : r.acciones.get(0);
    }

    @Test
    public void loSeisDelContratoYElExtra() {
        String[] seis = {"bateria", "app", "acceso_notificaciones", "accesibilidad", "inicio_apps", "ahorro_energia"};
        for (String q : seis) {
            assertTrue(q, AjustesRemotos.QUE.contains(q));
            List<AjustesRemotos.Candidato> c = AjustesRemotos.candidatos(q);
            assertFalse(q, c.isEmpty());
            // el último recurso siempre son los detalles de la app
            assertEquals(AjustesRemotos.RESPALDO.equals(c.get(c.size() - 1).codigo) || q.equals("app"), true);
        }
        assertEquals(7, AjustesRemotos.QUE.size());
    }

    @Test
    public void unaListaCerradaNadaMas() {
        assertTrue(AjustesRemotos.candidatos("wifi").isEmpty());
        assertTrue(AjustesRemotos.candidatos("../../etc").isEmpty());
        assertTrue(AjustesRemotos.candidatos(null).isEmpty());
        assertTrue(AjustesRemotos.candidatos("").isEmpty());
    }

    @Test
    public void losCodigosCabenEnElResultado() {
        for (String q : AjustesRemotos.QUE) {
            for (AjustesRemotos.Candidato c : AjustesRemotos.candidatos(q)) {
                assertTrue(c.codigo, c.codigo.matches("^[a-z0-9_]{1,40}$"));
                // cada candidato es una acción de Ajustes o un componente explícito, no ambos
                assertTrue((c.accion != null) ^ (c.paquete != null && c.clase != null));
                // el resultado que se confirma lo acepta el protocolo de la pantalla
                String res = AjustesRemotos.resultadoOk(c.codigo);
                String cuerpo = PantallaProtocolo.cuadro(1L, "soda", "s1", 1, 100, 100, null, true, true, false, null,
                        new long[]{5}, java.util.Collections.singletonMap(5L, res));
                try {
                    assertEquals(res, new JSONObject(cuerpo).getJSONObject("resultados").getString("5"));
                } catch (Exception e) {
                    throw new AssertionError(e);
                }
            }
        }
        // y «no_disponible» también
        String cuerpo = PantallaProtocolo.cuadro(1L, "soda", "s1", 1, 100, 100, null, true, true, false, null,
                new long[]{5}, java.util.Collections.singletonMap(5L, AjustesRemotos.NO_DISPONIBLE));
        assertTrue(cuerpo.contains("\"5\":\"no_disponible\""));
    }

    @Test
    public void inicioDeAppsProbariaLosGestoresDeHonorYHuawei() {
        List<AjustesRemotos.Candidato> c = AjustesRemotos.candidatos("inicio_apps");
        boolean honor = false, huawei = false;
        for (AjustesRemotos.Candidato x : c) {
            if ("com.hihonor.systemmanager".equals(x.paquete)) honor = true;
            if ("com.huawei.systemmanager".equals(x.paquete)) huawei = true;
        }
        assertTrue(honor);
        assertTrue(huawei);
        assertEquals("android.settings.APPLICATION_DETAILS_SETTINGS", c.get(c.size() - 1).accion);
        assertTrue(c.get(c.size() - 1).conPaqueteDeLaApp);
    }

    @Test
    public void laAccionSeLeeConSuQue() {
        PantallaProtocolo.Accion a = unaAccion("{\"id\":9,\"a\":\"abrir_ajuste\",\"que\":\"bateria\",\"cuadro_seq\":4}");
        assertNotNull(a);
        assertEquals("abrir_ajuste", a.a);
        assertEquals("bateria", a.que);
        assertNull(a.rechazo);
        assertEquals(4, a.cuadroSeq);
        assertTrue(PantallaProtocolo.ACCIONES.contains("abrir_ajuste"));
    }

    @Test
    public void unQueFueraDeLaListaSeConfirmaSinAbrirNada() {
        for (String malo : new String[]{"\"que\":\"wifi\"", "\"que\":\"\"", "\"que\":7", "\"x\":1", "\"que\":\"bateria; rm -rf\""}) {
            PantallaProtocolo.Accion a = unaAccion("{\"id\":9,\"a\":\"abrir_ajuste\"," + malo + "}");
            assertNotNull(malo, a);
            assertNull(malo, a.que);
            assertEquals(malo, "ajuste_invalido", a.rechazo);
        }
    }

    @Test
    public void laAccionSigueAtadaAlCuadro() {
        PantallaProtocolo.Accion a = unaAccion("{\"id\":9,\"a\":\"abrir_ajuste\",\"que\":\"app\",\"cuadro_seq\":4}");
        PantallaProtocolo.SeqImagen img = new PantallaProtocolo.SeqImagen();
        img.registrarImagen(7, 1000);
        assertEquals(PantallaProtocolo.OBSOLETA, PantallaProtocolo.resultadoPrevio(a, true, img, 99_000));
        img.registrarImagen(4, 2000);
        assertNull(PantallaProtocolo.resultadoPrevio(a, true, img, 2500));
        assertEquals(PantallaProtocolo.OBSOLETA, PantallaProtocolo.resultadoPrevio(a, false, img, 2500));
    }

    @Test
    public void elResultadoSigueSiendoSanitizado() {
        // «ok:...» válido pasa; mayúsculas, espacios o largo excesivo se vuelven «fallo»
        java.util.Map<Long, String> m = new java.util.LinkedHashMap<>();
        m.put(1L, "ok:bateria");
        m.put(2L, "ok:Bateria");
        m.put(3L, "ok:" + "a".repeat(41));
        m.put(4L, "ok:a b");
        m.put(5L, "ok:");
        m.put(6L, "obsoleta");
        String c = PantallaProtocolo.cuadro(1L, "soda", "s1", 1, 100, 100, null, true, true, false, null, new long[]{1, 2, 3, 4, 5, 6}, m);
        assertTrue(c.contains("\"1\":\"ok:bateria\""));
        assertTrue(c.contains("\"2\":\"fallo\""));
        assertTrue(c.contains("\"3\":\"fallo\""));
        assertTrue(c.contains("\"4\":\"fallo\""));
        assertTrue(c.contains("\"5\":\"fallo\""));
        assertTrue(c.contains("\"6\":\"obsoleta\""));
    }

    @Test
    public void ordenesDeDepuracionInalambrica() {
        assertTrue(RemoteCommands.PERMITIDOS.contains("abrir_adb"));
        assertTrue(RemoteCommands.PERMITIDOS.contains("cerrar_adb"));
        java.util.List<RemoteCommands.Command> l = RemoteCommands.parse(
                "{\"comandos\":[{\"id\":1,\"cmd\":\"abrir_adb\"},{\"id\":2,\"cmd\":\"cerrar_adb\"},{\"id\":3,\"cmd\":\"abrir_adb_y_mas\"},{\"id\":4,\"cmd\":\"latido_ya\"}]}");
        assertEquals(3, l.size());
        assertEquals("abrir_adb", l.get(0).cmd);
        assertEquals("cerrar_adb", l.get(1).cmd);
        assertEquals("latido_ya", l.get(2).cmd);
    }
}
