package tech.bogomolov.incomingsmsgateway;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.nio.charset.StandardCharsets;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/** La Bomba 2.7.0: el cuerpo del latido enriquecido y su firma (JVM pura, org.json real). */
public class HeartbeatBodyTest {

    private static HeartbeatBody.Detalle detalle() {
        HeartbeatBody.Detalle d = new HeartbeatBody.Detalle();
        d.app = "2.7.0";
        d.cargando = true;
        d.ahorroBateria = false;
        d.sinRestriccionBateria = true;
        d.redValidada = true;
        d.tipoRed = HeartbeatBody.tipoRed(true, false);
        d.ultimoSmsTs = 1763520000000L;
        d.ultimoReenvioOkTs = 1763520001000L;
        d.fallidosPendientes = 3;
        d.permisoSms = true;
        d.notificaciones = false;
        d.android = 35;
        d.marcaModelo = "HONOR HONOR X6c";
        d.senalNivel = -87;
        d.operador = "Kolbi \"ICE\"";
        d.simEstado = "listo";
        d.modoAvion = false;
        d.memoriaLibreMb = 1234;
        d.arranqueTs = 1763400000000L;
        d.bucketStandby = 20;
        d.doze = true;
        d.latidoRetrasoMs = 2700000L;
        d.reiniciosServicio = 4;
        return d;
    }

    @Test
    public void conservaLosCamposDe25YAgregaDetalle() throws Exception {
        String body = HeartbeatBody.build(1763520100000L, "soda", "HONOR X6c", 87, detalle());
        JSONObject o = new JSONObject(body);
        assertEquals("latido", o.getString("tipo"));
        assertEquals(1763520100000L, o.getLong("ts"));
        assertEquals("soda", o.getString("empresa"));
        assertEquals("HONOR X6c", o.getString("telefono"));
        assertEquals(87, o.getInt("bateria"));
        assertTrue(o.has("detalle"));
    }

    @Test
    public void detalleTraeTodosLosCamposConSuTipo() throws Exception {
        JSONObject d = new JSONObject(HeartbeatBody.build(1L, "pollos", "X", 5, detalle())).getJSONObject("detalle");
        assertEquals("2.7.0", d.getString("app"));
        assertTrue(d.getBoolean("cargando"));
        assertFalse(d.getBoolean("ahorro_bateria"));
        assertTrue(d.getBoolean("sin_restriccion_bateria"));
        assertTrue(d.getBoolean("red_validada"));
        assertEquals("wifi", d.getString("tipo_red"));
        assertEquals(1763520000000L, d.getLong("ultimo_sms_ts"));
        assertEquals(1763520001000L, d.getLong("ultimo_reenvio_ok_ts"));
        assertEquals(3, d.getInt("fallidos_pendientes"));
        assertTrue(d.getBoolean("permiso_sms"));
        assertFalse(d.getBoolean("notificaciones"));
        assertEquals(35, d.getInt("android"));
        assertEquals("HONOR HONOR X6c", d.getString("marca_modelo"));
        assertFalse("sin ordenes pendientes no debe haber comandos_hechos", d.has("comandos_hechos"));
    }

    @Test
    public void detalleTraeLasMedicionesDe28ConSuTipo() throws Exception {
        JSONObject d = new JSONObject(HeartbeatBody.build(1L, "soda", "X", 5, detalle())).getJSONObject("detalle");
        assertEquals(-87, d.getInt("senal_nivel"));
        assertEquals("Kolbi \"ICE\"", d.getString("operador"));   // las comillas se escapan y el JSON sigue valido
        assertEquals("listo", d.getString("sim_estado"));
        assertFalse(d.getBoolean("modo_avion"));
        assertEquals(1234, d.getInt("memoria_libre_mb"));
        assertEquals(1763400000000L, d.getLong("arranque_ts"));
        assertEquals(20, d.getInt("bucket_standby"));
        assertTrue(d.getBoolean("doze"));
        assertEquals(2700000L, d.getLong("latido_retraso_ms"));
        assertEquals(4, d.getInt("reinicios_servicio"));
    }

    @Test
    public void sinMedicionesLosValoresPorDefectoSonDeDesconocido() throws Exception {
        JSONObject d = new JSONObject(HeartbeatBody.build(1L, "soda", "X", 5, new HeartbeatBody.Detalle())).getJSONObject("detalle");
        assertEquals(0, d.getInt("senal_nivel"));
        assertEquals("desconocido", d.getString("sim_estado"));
        assertEquals(-1, d.getInt("memoria_libre_mb"));
        assertEquals(-1, d.getInt("bucket_standby"));
        assertEquals(-1L, d.getLong("latido_retraso_ms"));
        assertEquals(0, d.getInt("reinicios_servicio"));
    }

    @Test
    public void tipoRedSoloTresValores() {
        assertEquals("wifi", HeartbeatBody.tipoRed(true, true));
        assertEquals("datos", HeartbeatBody.tipoRed(false, true));
        assertEquals("ninguna", HeartbeatBody.tipoRed(false, false));
    }

    @Test
    public void comandosHechosYResultadoViajanCuandoHayOrdenesPorConfirmar() throws Exception {
        HeartbeatBody.Detalle d = detalle();
        d.comandosHechos = new long[]{4, 9};
        d.comandosResultado.put(4L, "ok");
        d.comandosResultado.put(9L, "comando_no_soportado");
        JSONObject det = new JSONObject(HeartbeatBody.build(1L, "soda", "X", 1, d)).getJSONObject("detalle");
        JSONArray hechos = det.getJSONArray("comandos_hechos");
        assertEquals(2, hechos.length());
        assertEquals(4, hechos.getLong(0));
        assertEquals(9, hechos.getLong(1));
        assertEquals("comando_no_soportado", det.getJSONObject("comandos_resultado").getString("9"));
    }

    @Test
    public void sinDetalleQuedaIgualAlLatido25() throws Exception {
        String body = HeartbeatBody.build(10L, "soda", "HONOR X6c", 50, null);
        assertEquals("{\"tipo\":\"latido\",\"ts\":10,\"empresa\":\"soda\",\"telefono\":\"HONOR X6c\",\"bateria\":50}", body);
    }

    @Test
    public void textoConComillasYSaltosSigueSiendoJsonValido() throws Exception {
        HeartbeatBody.Detalle d = detalle();
        d.marcaModelo = "Raro \"modelo\" \\ con\nsalto\tytab";
        JSONObject o = new JSONObject(HeartbeatBody.build(1L, "so\"da", "tel\\x", 1, d));
        assertEquals("so\"da", o.getString("empresa"));
        assertEquals("Raro \"modelo\" \\ con\nsalto\tytab", o.getJSONObject("detalle").getString("marca_modelo"));
    }

    @Test
    public void firmaSeCalculaSobreElCuerpoExactoEnviado() throws Exception {
        String secret = "clave-de-prueba";
        String body = HeartbeatBody.build(1763520100000L, "soda", "HONOR X6c", 87, detalle());
        String firma = Request.computeHmacSha256Hex(secret, body);

        // Cálculo independiente con javax.crypto
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        StringBuilder esperado = new StringBuilder();
        for (byte b : mac.doFinal(body.getBytes(StandardCharsets.UTF_8))) esperado.append(String.format("%02x", b));
        assertEquals(esperado.toString(), firma);
        assertEquals(64, firma.length());

        // Cualquier cambio al cuerpo (un byte) cambia la firma, y otra clave también.
        assertNotEquals(firma, Request.computeHmacSha256Hex(secret, body.replace("87", "88")));
        assertNotEquals(firma, Request.computeHmacSha256Hex("otra-clave", body));
    }

    @Test
    public void mismoCuerpoMismaFirmaDeterminista() throws Exception {
        String a = HeartbeatBody.build(5L, "soda", "X", 1, detalle());
        String b = HeartbeatBody.build(5L, "soda", "X", 1, detalle());
        assertEquals(a, b);
    }
}
