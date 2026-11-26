package tech.bogomolov.incomingsmsgateway;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.json.JSONObject;
import org.junit.Test;

import java.util.LinkedHashMap;
import java.util.Map;

/** La Bomba 2.10.0: pruebas JVM del protocolo de la pantalla remota (sin Android). */
public class PantallaProtocoloTest {

    private static final String CLAVE = "claveprueba";

    // ------------------------------------------------------------------ dirección

    @Test
    public void urlPantallaCambiaLaRutaYConservaPuerto() {
        assertEquals("https://pagos.dmalabomba.com/pantalla", PantallaProtocolo.urlPantalla("https://pagos.dmalabomba.com/sms"));
        assertEquals("http://127.0.0.1:8080/pantalla", PantallaProtocolo.urlPantalla("http://127.0.0.1:8080/latido?x=1"));
        assertEquals("https://pagos.dmalabomba.com/pantalla", PantallaProtocolo.urlPantalla(" https://pagos.dmalabomba.com "));
    }

    @Test
    public void urlPantallaRechazaLoQueNoEsUrlWeb() {
        assertNull(PantallaProtocolo.urlPantalla(null));
        assertNull(PantallaProtocolo.urlPantalla(""));
        assertNull(PantallaProtocolo.urlPantalla("no es url"));
        assertNull(PantallaProtocolo.urlPantalla("ftp://pagos.dmalabomba.com/sms"));
        assertNull(PantallaProtocolo.urlPantalla("file:///etc/passwd"));
    }

    // ------------------------------------------------------------------ cuerpos del teléfono

    @Test
    public void escuchaTieneOrdenFijoYEsJsonValido() throws Exception {
        String b = PantallaProtocolo.escucha(1700000000000L, "soda", "2.10.0", true, false);
        assertEquals("{\"tipo\":\"pantalla\",\"fase\":\"escucha\",\"ts\":1700000000000,\"empresa\":\"soda\","
                + "\"app\":\"2.10.0\",\"pantalla_encendida\":true,\"bloqueada\":false}", b);
        JSONObject o = new JSONObject(b);
        assertEquals("escucha", o.getString("fase"));
    }

    @Test
    public void cuadroConImagenLlevaJpgYConfirmaciones() throws Exception {
        Map<Long, String> res = new LinkedHashMap<>();
        res.put(7L, "ok");
        res.put(8L, "fallo");
        String b = PantallaProtocolo.cuadro(1700000000000L, "soda", "sid-1", 3, 540, 1170, "QUJD", false, true, false,
                null, new long[]{7, 8}, res);
        JSONObject o = new JSONObject(b);
        assertEquals("cuadro", o.getString("fase"));
        assertEquals("sid-1", o.getString("sid"));
        assertEquals(3, o.getInt("seq"));
        assertEquals(540, o.getInt("w"));
        assertEquals(1170, o.getInt("h"));
        assertFalse(o.getBoolean("sin_cambio"));
        assertEquals("QUJD", o.getString("jpg"));
        assertEquals(2, o.getJSONArray("confirmadas").length());
        assertEquals(7, o.getJSONArray("confirmadas").getLong(0));
        assertEquals("ok", o.getJSONObject("resultados").getString("7"));
        assertEquals("fallo", o.getJSONObject("resultados").getString("8"));
        assertFalse(o.has("error"));
        assertTrue("la imagen va al final para que lo chico se lea primero", b.indexOf("\"jpg\"") > b.indexOf("\"resultados\""));
    }

    @Test
    public void cuadroSinCambioNoLlevaJpgAunqueSePase() throws Exception {
        String b = PantallaProtocolo.cuadro(1L, "soda", "s", 1, 540, 1170, "QUJD", true, true, false, null, new long[0], null);
        JSONObject o = new JSONObject(b);
        assertTrue(o.getBoolean("sin_cambio"));
        assertFalse(o.has("jpg"));
        assertEquals(0, o.getJSONArray("confirmadas").length());
        assertEquals(0, o.getJSONObject("resultados").length());
    }

    @Test
    public void cuadroSinImagenQueNoEsSinCambioSeMarcaSinCambio() throws Exception {
        JSONObject o = new JSONObject(PantallaProtocolo.cuadro(1L, "soda", "s", 1, 0, 0, null, false, false, true, "captura_fallo", null, null));
        assertTrue("sin jpg no puede decir que hay imagen nueva", o.getBoolean("sin_cambio"));
        assertEquals("captura_fallo", o.getString("error"));
        assertFalse(o.getBoolean("pantalla_encendida"));
        assertTrue(o.getBoolean("bloqueada"));
    }

    @Test
    public void resultadoRaroSeCambiaAFalloParaNoRomperElJson() throws Exception {
        Map<Long, String> res = new LinkedHashMap<>();
        res.put(1L, "ok\",\"x\":\"1");
        JSONObject o = new JSONObject(PantallaProtocolo.cuadro(1L, "soda", "s", 1, 1, 1, null, true, true, false, null, new long[]{1}, res));
        assertEquals("fallo", o.getJSONObject("resultados").getString("1"));
    }

    @Test
    public void finEsJsonValido() throws Exception {
        JSONObject o = new JSONObject(PantallaProtocolo.fin(5L, "soda", "abc-1"));
        assertEquals("fin", o.getString("fase"));
        assertEquals("abc-1", o.getString("sid"));
    }

    @Test
    public void laFirmaDelCuerpoCoincideConLaEsperada() throws Exception {
        String b = PantallaProtocolo.escucha(1L, "soda", "2.10.0", true, false);
        String firma = Request.computeHmacSha256Hex(CLAVE, b);
        assertTrue(PantallaProtocolo.respuestaFirmada(200, b, firma, CLAVE));
    }

    // ------------------------------------------------------------------ firma de la respuesta

    @Test
    public void respuestaConFirmaValidaEsDeConfianza() throws Exception {
        String r = "{\"ok\":true,\"sesion\":false}";
        String f = Request.computeHmacSha256Hex(CLAVE, r);
        assertTrue(PantallaProtocolo.respuestaFirmada(200, r, f, CLAVE));
        assertTrue("mayusculas y espacios no importan", PantallaProtocolo.respuestaFirmada(200, r, " " + f.toUpperCase() + " ", CLAVE));
    }

    @Test
    public void respuestaSinFirmaNuncaEsDeConfianza() {
        String r = "{\"ok\":true,\"sesion\":true,\"sid\":\"a\",\"resta_s\":60,\"acciones\":[{\"id\":1,\"a\":\"atras\"}]}";
        assertFalse(PantallaProtocolo.respuestaFirmada(200, r, null, CLAVE));
        assertFalse(PantallaProtocolo.respuestaFirmada(200, r, "", CLAVE));
        assertFalse(PantallaProtocolo.respuestaFirmada(200, r, "   ", CLAVE));
    }

    @Test
    public void respuestaConFirmaMalaOClaveVaciaONo2xxNoEsDeConfianza() throws Exception {
        String r = "{\"ok\":true,\"sesion\":false}";
        String f = Request.computeHmacSha256Hex(CLAVE, r);
        assertFalse(PantallaProtocolo.respuestaFirmada(200, r, f, "otraclave"));
        assertFalse(PantallaProtocolo.respuestaFirmada(200, r + " ", f, CLAVE));
        assertFalse(PantallaProtocolo.respuestaFirmada(200, r, "00" + f.substring(2), CLAVE));
        assertFalse(PantallaProtocolo.respuestaFirmada(200, r, f, ""));
        assertFalse(PantallaProtocolo.respuestaFirmada(200, r, f, null));
        assertFalse(PantallaProtocolo.respuestaFirmada(500, r, f, CLAVE));
        assertFalse(PantallaProtocolo.respuestaFirmada(200, null, f, CLAVE));
    }

    // ------------------------------------------------------------------ lectura de la respuesta

    private static PantallaProtocolo.Respuesta sesionCon(String acciones) {
        return PantallaProtocolo.parsear("{\"ok\":true,\"sesion\":true,\"sid\":\"abc-123\",\"resta_s\":540,\"acciones\":" + acciones + "}");
    }

    @Test
    public void sinSesionNoHayAcciones() {
        PantallaProtocolo.Respuesta r = PantallaProtocolo.parsear("{\"ok\":true,\"sesion\":false,\"acciones\":[{\"id\":1,\"a\":\"atras\"}]}");
        assertTrue(r.ok);
        assertFalse(r.sesion);
        assertTrue(r.acciones.isEmpty());
    }

    @Test
    public void sesionActivaTraeSidYResta() {
        PantallaProtocolo.Respuesta r = sesionCon("[]");
        assertTrue(r.ok && r.sesion);
        assertEquals("abc-123", r.sid);
        assertEquals(540, r.restaS);
    }

    @Test
    public void restaSeLimitaAlTopeYNoPuedeSerNegativa() {
        assertEquals(PantallaProtocolo.MAX_RESTA_S, PantallaProtocolo.parsear("{\"ok\":true,\"sesion\":true,\"sid\":\"a\",\"resta_s\":999999}").restaS);
        assertEquals(0, PantallaProtocolo.parsear("{\"ok\":true,\"sesion\":true,\"sid\":\"a\",\"resta_s\":-50}").restaS);
        assertEquals(0, PantallaProtocolo.parsear("{\"ok\":true,\"sesion\":true,\"sid\":\"a\"}").restaS);
        assertEquals(0, PantallaProtocolo.parsear("{\"ok\":true,\"sesion\":true,\"sid\":\"a\",\"resta_s\":\"600\"}").restaS);
    }

    @Test
    public void sidInvalidoCierraLaSesion() {
        for (String sid : new String[]{"", "con espacio", "a/b", "a\\\"b", "x".repeat(65)}) {
            PantallaProtocolo.Respuesta r = PantallaProtocolo.parsear("{\"ok\":true,\"sesion\":true,\"sid\":\"" + sid + "\",\"resta_s\":60}");
            assertFalse("sid " + sid, r.sesion);
        }
        assertFalse(PantallaProtocolo.parsear("{\"ok\":true,\"sesion\":true,\"resta_s\":60}").sesion);
    }

    @Test
    public void okFalsoOJsonMaloNoDejanSesion() {
        assertFalse(PantallaProtocolo.parsear("{\"ok\":false,\"sesion\":true,\"sid\":\"a\",\"resta_s\":60}").sesion);
        assertFalse(PantallaProtocolo.parsear("no es json").ok);
        assertFalse(PantallaProtocolo.parsear("").ok);
        assertFalse(PantallaProtocolo.parsear(null).ok);
        assertFalse(PantallaProtocolo.parsear("[1,2]").ok);
    }

    @Test
    public void leeTodasLasAccionesValidas() {
        PantallaProtocolo.Respuesta r = sesionCon("[{\"id\":1,\"a\":\"toque\",\"x\":0.5,\"y\":0.3},"
                + "{\"id\":2,\"a\":\"largo\",\"x\":0.1,\"y\":0.9,\"ms\":1200},"
                + "{\"id\":3,\"a\":\"deslizar\",\"x1\":0.5,\"y1\":0.8,\"x2\":0.5,\"y2\":0.2,\"ms\":300},"
                + "{\"id\":4,\"a\":\"atras\"}]");
        assertEquals(4, r.acciones.size());
        PantallaProtocolo.Accion t = r.acciones.get(0);
        assertEquals(1, t.id);
        assertEquals(PantallaProtocolo.TOQUE, t.a);
        assertEquals(0.5, t.x, 1e-9);
        assertEquals(0.3, t.y, 1e-9);
        assertEquals(1200, r.acciones.get(1).ms);
        PantallaProtocolo.Accion d = r.acciones.get(2);
        assertEquals(0.8, d.y1, 1e-9);
        assertEquals(0.2, d.y2, 1e-9);
        assertEquals(300, d.ms);
        assertEquals(PantallaProtocolo.ATRAS, r.acciones.get(3).a);
    }

    @Test
    public void accionesSinParametrosSeAceptanTodas() {
        PantallaProtocolo.Respuesta r = sesionCon("[{\"id\":1,\"a\":\"atras\"},{\"id\":2,\"a\":\"inicio\"},{\"id\":3,\"a\":\"recientes\"},"
                + "{\"id\":4,\"a\":\"notificaciones\"},{\"id\":5,\"a\":\"encender\"}]");
        assertEquals(5, r.acciones.size());
    }

    @Test
    public void listaCerradaIgnoraLoDesconocido() {
        PantallaProtocolo.Respuesta r = sesionCon("[{\"id\":1,\"a\":\"borrar_todo\"},{\"id\":2,\"a\":\"apagar\"},{\"id\":3,\"a\":\"TOQUE\",\"x\":0.1,\"y\":0.1},"
                + "{\"id\":4,\"a\":\"atras\"},{\"id\":5},{\"a\":\"atras\"},{\"id\":6,\"a\":5}]");
        assertEquals(1, r.acciones.size());
        assertEquals(4, r.acciones.get(0).id);
    }

    @Test
    public void topeDeCincoAccionesPorRespuesta() {
        StringBuilder b = new StringBuilder("[");
        for (int i = 1; i <= 9; i++) b.append(i > 1 ? "," : "").append("{\"id\":").append(i).append(",\"a\":\"atras\"}");
        b.append("]");
        PantallaProtocolo.Respuesta r = sesionCon(b.toString());
        assertEquals(PantallaProtocolo.MAX_ACCIONES, r.acciones.size());
        assertEquals(5, r.acciones.get(4).id);
    }

    @Test
    public void idsRepetidosEnLaMismaRespuestaSeQuedanEnUno() {
        PantallaProtocolo.Respuesta r = sesionCon("[{\"id\":3,\"a\":\"atras\"},{\"id\":3,\"a\":\"inicio\"}]");
        assertEquals(1, r.acciones.size());
        assertEquals(PantallaProtocolo.ATRAS, r.acciones.get(0).a);
    }

    @Test
    public void idsInvalidosSeDescartan() {
        PantallaProtocolo.Respuesta r = sesionCon("[{\"id\":0,\"a\":\"atras\"},{\"id\":-4,\"a\":\"atras\"},{\"id\":1.5,\"a\":\"atras\"},"
                + "{\"id\":\"7\",\"a\":\"atras\"},{\"id\":9100000000000000,\"a\":\"atras\"},{\"id\":8,\"a\":\"atras\"}]");
        assertEquals(1, r.acciones.size());
        assertEquals(8, r.acciones.get(0).id);
    }

    @Test
    public void coordenadasFueraDeRangoOFaltantesSeDescartan() {
        PantallaProtocolo.Respuesta r = sesionCon("[{\"id\":1,\"a\":\"toque\",\"x\":1.2,\"y\":0.5},{\"id\":2,\"a\":\"toque\",\"x\":-0.1,\"y\":0.5},"
                + "{\"id\":3,\"a\":\"toque\",\"x\":0.5},{\"id\":4,\"a\":\"toque\",\"x\":\"0.5\",\"y\":0.5},"
                + "{\"id\":5,\"a\":\"toque\",\"x\":0,\"y\":1},{\"id\":6,\"a\":\"deslizar\",\"x1\":0,\"y1\":0,\"x2\":2,\"y2\":0,\"ms\":300}]");
        assertEquals(1, r.acciones.size());
        assertEquals(5, r.acciones.get(0).id);
    }

    @Test
    public void duracionesFueraDeLimiteSeDescartan() {
        PantallaProtocolo.Respuesta r = sesionCon("[{\"id\":1,\"a\":\"deslizar\",\"x1\":0,\"y1\":0,\"x2\":1,\"y2\":1,\"ms\":99},"
                + "{\"id\":2,\"a\":\"deslizar\",\"x1\":0,\"y1\":0,\"x2\":1,\"y2\":1,\"ms\":1501},"
                + "{\"id\":3,\"a\":\"deslizar\",\"x1\":0,\"y1\":0,\"x2\":1,\"y2\":1},"
                + "{\"id\":4,\"a\":\"largo\",\"x\":0.5,\"y\":0.5,\"ms\":5000},"
                + "{\"id\":5,\"a\":\"deslizar\",\"x1\":0,\"y1\":0,\"x2\":1,\"y2\":1,\"ms\":100},"
                + "{\"id\":6,\"a\":\"deslizar\",\"x1\":0,\"y1\":0,\"x2\":1,\"y2\":1,\"ms\":1500}]");
        assertEquals(2, r.acciones.size());
        assertEquals(5, r.acciones.get(0).id);
        assertEquals(6, r.acciones.get(1).id);
    }

    @Test
    public void largoSinDuracionUsaLaPorDefecto() {
        PantallaProtocolo.Respuesta r = sesionCon("[{\"id\":1,\"a\":\"largo\",\"x\":0.5,\"y\":0.5}]");
        assertEquals(1, r.acciones.size());
        assertEquals(PantallaProtocolo.MS_LARGO_POR_DEFECTO, r.acciones.get(0).ms);
    }

    @Test
    public void textoTieneLimiteDeLargoYSinCaracteresDeControlYElRechazoSeConfirma() {
        String doscientos = "a".repeat(200);
        String doscientosUno = "a".repeat(201);
        // (el tope es de 5 acciones por respuesta: se prueba en dos)
        PantallaProtocolo.Respuesta r = sesionCon("[{\"id\":1,\"a\":\"texto\",\"t\":\"hola\"},{\"id\":2,\"a\":\"texto\",\"t\":\"" + doscientos + "\"},"
                + "{\"id\":3,\"a\":\"texto\",\"t\":\"" + doscientosUno + "\"},{\"id\":4,\"a\":\"texto\",\"t\":\"\"}]");
        PantallaProtocolo.Respuesta r2 = sesionCon("[{\"id\":5,\"a\":\"texto\"},{\"id\":6,\"a\":\"texto\",\"t\":5},{\"id\":7,\"a\":\"texto\",\"t\":\"a\\u0007b\"}]");
        // 2.11.0: ya no se descartan en silencio: llegan marcadas para confirmarse como «texto_invalido»
        assertEquals(4, r.acciones.size());
        assertEquals(3, r2.acciones.size());
        assertEquals("hola", r.acciones.get(0).t);
        assertNull(r.acciones.get(0).rechazo);
        assertEquals(200, r.acciones.get(1).t.length());
        assertNull(r.acciones.get(1).rechazo);
        for (PantallaProtocolo.Accion a : new PantallaProtocolo.Accion[]{r.acciones.get(2), r.acciones.get(3),
                r2.acciones.get(0), r2.acciones.get(1), r2.acciones.get(2)}) {
            assertEquals("texto_invalido", a.rechazo);
            assertNull(a.t);
        }
        assertEquals(3, r.acciones.get(2).id);
        assertEquals(7, r2.acciones.get(2).id);
    }

    @Test
    public void textoSeMideEnUnidadesUtf16() {
        String cien = "\uD83D\uDE00".repeat(100);   // 100 emojis = 200 unidades UTF-16
        assertEquals(200, cien.length());
        assertTrue(PantallaProtocolo.textoValido(cien));
        assertFalse("101 emojis = 202 unidades", PantallaProtocolo.textoValido("\uD83D\uDE00".repeat(101)));
        assertTrue(PantallaProtocolo.textoValido("a".repeat(200)));
        assertFalse(PantallaProtocolo.textoValido("a".repeat(201)));
        assertTrue(PantallaProtocolo.textoValido("uno\ndos"));
        assertFalse(PantallaProtocolo.textoValido("uno\rdos"));
        assertFalse(PantallaProtocolo.textoValido("a\u007fb"));
        assertFalse("sustituto suelto", PantallaProtocolo.textoValido("a\uD83Db"));
        assertFalse("sustituto bajo suelto", PantallaProtocolo.textoValido("\uDE00"));
        assertFalse(PantallaProtocolo.textoValido(""));
        assertFalse(PantallaProtocolo.textoValido(null));
    }

    @Test
    public void textoAceptaTildesYSaltoDeLinea() {
        PantallaProtocolo.Respuesta r = sesionCon("[{\"id\":1,\"a\":\"texto\",\"t\":\"canci\\u00f3n\\nuno\"}]");
        assertEquals(1, r.acciones.size());
        assertEquals("canción\nuno", r.acciones.get(0).t);
    }

    @Test
    public void borrarValidaElNumero() {
        PantallaProtocolo.Respuesta r = sesionCon("[{\"id\":1,\"a\":\"borrar\"},{\"id\":2,\"a\":\"borrar\",\"n\":3},{\"id\":3,\"a\":\"borrar\",\"n\":0},"
                + "{\"id\":4,\"a\":\"borrar\",\"n\":201},{\"id\":5,\"a\":\"borrar\",\"n\":2.5},{\"id\":6,\"a\":\"borrar\",\"n\":\"2\"},{\"id\":7,\"a\":\"borrar\",\"n\":200}]");
        assertEquals(3, r.acciones.size());
        assertEquals(1, r.acciones.get(0).n);
        assertEquals(3, r.acciones.get(1).n);
        assertEquals(200, r.acciones.get(2).n);
    }

    @Test
    public void accionQueNoEsObjetoSeSalta() {
        PantallaProtocolo.Respuesta r = sesionCon("[5,\"x\",null,[1],{\"id\":1,\"a\":\"atras\"}]");
        assertEquals(1, r.acciones.size());
    }

    // ------------------------------------------------------------------ ids ejecutados una sola vez

    @Test
    public void unIdSoloSeEjecutaUnaVez() {
        PantallaProtocolo.IdsHechos h = new PantallaProtocolo.IdsHechos();
        assertTrue(h.registrar(5));
        assertFalse(h.registrar(5));
        assertTrue(h.registrar(6));
        assertTrue(h.contiene(5));
        assertFalse(h.contiene(99));
    }

    @Test
    public void elRegistroDeIdsEstaAcotadoYOlvidaLosMasViejos() {
        PantallaProtocolo.IdsHechos h = new PantallaProtocolo.IdsHechos();
        for (long i = 1; i <= PantallaProtocolo.MAX_RECORDADOS + 50; i++) h.registrar(i);
        assertEquals(PantallaProtocolo.MAX_RECORDADOS, h.size());
        assertFalse(h.contiene(1));
        assertTrue(h.contiene(PantallaProtocolo.MAX_RECORDADOS + 50));
    }

    // ------------------------------------------------------------------ eco y ts del servidor

    @Test
    public void ecoCoincideSoloConElTsEnviado() {
        PantallaProtocolo.Respuesta r = PantallaProtocolo.parsear("{\"ok\":true,\"sesion\":false,\"eco\":1764000000123,\"ts\":1764000000500}");
        assertTrue(r.ok);
        assertEquals(1764000000123L, r.eco);
        assertEquals(1764000000500L, r.tsServidor);
        assertTrue(r.ecoCoincide(1764000000123L));
        assertFalse(r.ecoCoincide(1764000000124L));
    }

    @Test
    public void sinEcoOEcoMalformadoNuncaCoincide() {
        assertFalse(PantallaProtocolo.parsear("{\"ok\":true,\"sesion\":false}").ecoCoincide(0));
        assertFalse(PantallaProtocolo.parsear("{\"ok\":true,\"sesion\":false}").ecoCoincide(-1));
        assertFalse(PantallaProtocolo.parsear("{\"ok\":true,\"eco\":\"123\"}").ecoCoincide(123));
        assertFalse(PantallaProtocolo.parsear("{\"ok\":true,\"eco\":12.5}").ecoCoincide(12));
        assertFalse(PantallaProtocolo.parsear("{\"ok\":true,\"eco\":-5}").ecoCoincide(-5));
        assertFalse(PantallaProtocolo.parsear("no es json").ecoCoincide(1));
    }

    @Test
    public void ecoSeLeeAunqueLaSesionEsteCerradaOHayaAcciones() {
        PantallaProtocolo.Respuesta r = PantallaProtocolo.parsear(
                "{\"ok\":true,\"sesion\":true,\"sid\":\"s1\",\"resta_s\":60,\"eco\":42,\"ts\":43,\"acciones\":[{\"id\":9,\"a\":\"atras\"}]}");
        assertTrue(r.sesion);
        assertEquals(1, r.acciones.size());
        assertTrue(r.ecoCoincide(42));
    }

    // ------------------------------------------------------------------ 2.11.0: https obligatorio en /pantalla

    @Test
    public void pantallaExigeHttpsYSoloAceptaHttpEnElBucleLocal() {
        assertNull(PantallaProtocolo.urlPantalla("http://pagos.dmalabomba.com/sms"));
        assertNull(PantallaProtocolo.urlPantalla("http://10.0.2.2:8099/sms"));
        assertNull(PantallaProtocolo.urlPantalla("http://192.168.1.50/sms"));
        assertNull(PantallaProtocolo.urlPantalla("http://localhost.evil.com/sms"));
        assertNull(PantallaProtocolo.urlPantalla("http://127.0.0.1.evil.com/sms"));
        assertEquals("https://pagos.dmalabomba.com/pantalla", PantallaProtocolo.urlPantalla("https://pagos.dmalabomba.com/sms"));
        assertEquals("https://10.0.2.2:8443/pantalla", PantallaProtocolo.urlPantalla("https://10.0.2.2:8443/sms"));
        // bucle local: el trafico no sale del telefono (pruebas con servidor falso en el propio aparato)
        assertEquals("http://127.0.0.1:8080/pantalla", PantallaProtocolo.urlPantalla("http://127.0.0.1:8080/latido"));
        assertEquals("http://localhost:8080/pantalla", PantallaProtocolo.urlPantalla("http://localhost:8080/latido"));
    }

    // ------------------------------------------------------------------ 2.11.0: acciones atadas al cuadro

    @Test
    public void cuadroSeqSeLeeYSinElSeEjecutaComoAntes() {
        PantallaProtocolo.Respuesta r = sesionCon("[{\"id\":1,\"a\":\"atras\",\"cuadro_seq\":7},{\"id\":2,\"a\":\"inicio\"},"
                + "{\"id\":3,\"a\":\"atras\",\"cuadro_seq\":\"7\"},{\"id\":4,\"a\":\"atras\",\"cuadro_seq\":-1},"
                + "{\"id\":5,\"a\":\"atras\",\"cuadro_seq\":7.5},{\"id\":6,\"a\":\"atras\",\"cuadro_seq\":0}]");
        assertEquals("tope de 5 por respuesta", 5, r.acciones.size());
        assertEquals(7, r.acciones.get(0).cuadroSeq);
        assertEquals(PantallaProtocolo.SIN_CUADRO_SEQ, r.acciones.get(1).cuadroSeq);
        assertEquals(PantallaProtocolo.CUADRO_SEQ_INVALIDO, r.acciones.get(2).cuadroSeq);
        assertEquals(PantallaProtocolo.CUADRO_SEQ_INVALIDO, r.acciones.get(3).cuadroSeq);
        assertEquals(PantallaProtocolo.CUADRO_SEQ_INVALIDO, r.acciones.get(4).cuadroSeq);
    }

    private static PantallaProtocolo.Accion accion(String json) {
        return sesionCon("[" + json + "]").acciones.get(0);
    }

    @Test
    public void pantallaEstaticaConVariosSinCambioEntreMediasLasAccionesSiSeEjecutan() {
        // cuadro 1 con imagen; 2, 3, 4 y 5 son «sin_cambio» (no cambian la imagen): el visor sigue mostrando la del 1
        PantallaProtocolo.SeqImagen img = new PantallaProtocolo.SeqImagen();
        img.registrarImagen(1, 1000);
        PantallaProtocolo.Accion a = accion("{\"id\":1,\"a\":\"toque\",\"x\":0.5,\"y\":0.5,\"cuadro_seq\":1}");
        assertNull("mucho despues y con la misma imagen: se ejecuta", PantallaProtocolo.resultadoPrevio(a, true, img, 1000 + 600_000));
    }

    @Test
    public void pantallaAnimadaAceptaLaImagenAnteriorSoloDosSegundos() {
        PantallaProtocolo.SeqImagen img = new PantallaProtocolo.SeqImagen();
        img.registrarImagen(1, 1000);
        img.registrarImagen(2, 5000);   // la imagen 2 reemplazo a la 1 en t=5000
        PantallaProtocolo.Accion sobre1 = accion("{\"id\":1,\"a\":\"toque\",\"x\":0.1,\"y\":0.1,\"cuadro_seq\":1}");
        PantallaProtocolo.Accion sobre2 = accion("{\"id\":2,\"a\":\"toque\",\"x\":0.1,\"y\":0.1,\"cuadro_seq\":2}");
        assertNull(PantallaProtocolo.resultadoPrevio(sobre2, true, img, 5000));
        assertNull("una imagen de diferencia, recien cambiada", PantallaProtocolo.resultadoPrevio(sobre1, true, img, 5000));
        assertNull(PantallaProtocolo.resultadoPrevio(sobre1, true, img, 6999));
        assertEquals("a los 2000 ms ya no", "obsoleta", PantallaProtocolo.resultadoPrevio(sobre1, true, img, 7000));
        assertEquals("obsoleta", PantallaProtocolo.resultadoPrevio(sobre1, true, img, 60_000));
        assertNull("la ultima imagen siempre vale", PantallaProtocolo.resultadoPrevio(sobre2, true, img, 60_000));
        // dos imagenes de diferencia: no
        img.registrarImagen(3, 8000);
        assertEquals("obsoleta", PantallaProtocolo.resultadoPrevio(sobre1, true, img, 8001));
        assertNull("la 2 era la previa, dentro del margen", PantallaProtocolo.resultadoPrevio(sobre2, true, img, 8001));
    }

    @Test
    public void cuadroSeqDeOtraImagenFuturaOMalFormadoEsObsoleta() {
        PantallaProtocolo.SeqImagen img = new PantallaProtocolo.SeqImagen();
        img.registrarImagen(4, 1000);
        assertEquals("obsoleta", PantallaProtocolo.resultadoPrevio(accion("{\"id\":1,\"a\":\"atras\",\"cuadro_seq\":9}"), true, img, 1000));
        assertEquals("obsoleta", PantallaProtocolo.resultadoPrevio(accion("{\"id\":1,\"a\":\"atras\",\"cuadro_seq\":3}"), true, img, 1000));
        assertEquals("obsoleta", PantallaProtocolo.resultadoPrevio(accion("{\"id\":1,\"a\":\"atras\",\"cuadro_seq\":\"4\"}"), true, img, 1000));
        assertEquals("obsoleta", PantallaProtocolo.resultadoPrevio(accion("{\"id\":1,\"a\":\"atras\",\"cuadro_seq\":-1}"), true, img, 1000));
    }

    @Test
    public void sinImagenTodaviaUnCuadroSeqNoPuedeCoincidir() {
        PantallaProtocolo.SeqImagen img = new PantallaProtocolo.SeqImagen();   // solo hubo cuadros sin imagen
        assertEquals("obsoleta", PantallaProtocolo.resultadoPrevio(accion("{\"id\":1,\"a\":\"atras\",\"cuadro_seq\":0}"), true, img, 1000));
        assertEquals("obsoleta", PantallaProtocolo.resultadoPrevio(accion("{\"id\":1,\"a\":\"atras\",\"cuadro_seq\":2}"), true, img, 1000));
        assertNull("sin cuadro_seq (servidor viejo) se ejecuta", PantallaProtocolo.resultadoPrevio(accion("{\"id\":1,\"a\":\"atras\"}"), true, img, 1000));
    }

    @Test
    public void encenderEstaExentaDeLaReglaDeLaImagenPeroNoDeLaDelPrimerCuadro() {
        PantallaProtocolo.SeqImagen img = new PantallaProtocolo.SeqImagen();   // pantalla apagada: nunca hubo imagen
        PantallaProtocolo.Accion enc = accion("{\"id\":1,\"a\":\"encender\",\"cuadro_seq\":99}");
        assertNull(PantallaProtocolo.resultadoPrevio(enc, true, img, 1000));
        assertEquals("antes del primer cuadro todo es obsoleto", "obsoleta", PantallaProtocolo.resultadoPrevio(enc, false, img, 1000));
    }

    @Test
    public void antesDelPrimerCuadroTodaAccionEsObsoleta() {
        PantallaProtocolo.SeqImagen img = new PantallaProtocolo.SeqImagen();
        PantallaProtocolo.Respuesta r = sesionCon("[{\"id\":1,\"a\":\"atras\"},{\"id\":2,\"a\":\"atras\",\"cuadro_seq\":0}]");
        for (PantallaProtocolo.Accion a : r.acciones) {
            assertEquals("obsoleta", PantallaProtocolo.resultadoPrevio(a, false, img, 0));
        }
    }

    @Test
    public void elResultadoObsoletaCabeEnElCuerpoDelCuadro() throws Exception {
        Map<Long, String> res = new LinkedHashMap<>();
        res.put(1L, "obsoleta");
        res.put(2L, "texto_invalido");
        String b = PantallaProtocolo.cuadro(5L, "soda", "s1", 2, 10, 10, null, true, true, false, null, new long[]{1, 2}, res);
        JSONObject o = new JSONObject(b);
        assertEquals("obsoleta", o.getJSONObject("resultados").getString("1"));
        assertEquals("texto_invalido", o.getJSONObject("resultados").getString("2"));
    }
}
