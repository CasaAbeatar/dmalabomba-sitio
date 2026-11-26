package tech.bogomolov.incomingsmsgateway;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONObject;
import org.junit.Test;

import java.nio.charset.StandardCharsets;

/** La Bomba 2.12.0: llaves planas nuevas del latido (JVM pura, org.json real). */
public class HeartbeatBody212Test {

    private static HeartbeatBody.Detalle base() {
        HeartbeatBody.Detalle d = new HeartbeatBody.Detalle();
        d.app = "2.12.0";
        return d;
    }

    private static JSONObject detalle(HeartbeatBody.Detalle d) throws Exception {
        return new JSONObject(HeartbeatBody.build(1790000000000L, "soda", "HONOR X6c", 80, d)).getJSONObject("detalle");
    }

    @Test
    public void valoresPorDefectoSonSeguros() throws Exception {
        JSONObject o = detalle(base());
        assertEquals(0, o.getLong("sms_inbox_ultimo_ms"));
        assertEquals(-1, o.getInt("sms_sin_reenviar"));
        assertFalse(o.getBoolean("adb_activo"));
        assertEquals(0, o.getInt("adb_puerto"));
        assertEquals("ninguna", o.getString("actualizacion_estado"));
        assertFalse(o.has("actualizacion_detalle"));
        assertFalse(o.has("actualizacion_objetivo"));
    }

    @Test
    public void conservaLasLlavesPlanasDeAntes() throws Exception {
        HeartbeatBody.Detalle d = base();
        d.cargando = true;
        d.tipoRed = "wifi";
        d.permisosExtra = "ubicacion,ancla";
        JSONObject o = detalle(d);
        assertTrue(o.getBoolean("cargando"));
        assertEquals("wifi", o.getString("tipo_red"));
        assertEquals("ubicacion,ancla", o.getString("permisos_extra"));
        assertEquals("2.12.0", o.getString("app"));
    }

    @Test
    public void llevaLoNuevo() throws Exception {
        HeartbeatBody.Detalle d = base();
        d.smsInboxUltimoMs = 1789999000000L;
        d.smsSinReenviar = 3;
        d.adbActivo = true;
        d.adbPuerto = 37123;
        d.actualizacionEstado = "fallo";
        d.actualizacionDetalle = "sha256_distinto";
        d.actualizacionObjetivo = "2.12.1";
        JSONObject o = detalle(d);
        assertEquals(1789999000000L, o.getLong("sms_inbox_ultimo_ms"));
        assertEquals(3, o.getInt("sms_sin_reenviar"));
        assertTrue(o.getBoolean("adb_activo"));
        assertEquals(37123, o.getInt("adb_puerto"));
        assertEquals("fallo", o.getString("actualizacion_estado"));
        assertEquals("sha256_distinto", o.getString("actualizacion_detalle"));
        assertEquals("2.12.1", o.getString("actualizacion_objetivo"));
    }

    @Test
    public void losValoresSeAcotanParaQueElServidorNoRechaceTodoElLatido() throws Exception {
        HeartbeatBody.Detalle d = base();
        d.smsInboxUltimoMs = -5;
        d.smsSinReenviar = 5000;
        d.adbPuerto = 99999;
        d.actualizacionEstado = "cualquier cosa";
        d.actualizacionDetalle = "Tiene Mayusculas y espacios";
        d.actualizacionObjetivo = "2.12";
        JSONObject o = detalle(d);
        assertEquals(0, o.getLong("sms_inbox_ultimo_ms"));
        assertEquals(999, o.getInt("sms_sin_reenviar"));
        assertEquals(0, o.getInt("adb_puerto"));
        assertEquals("ninguna", o.getString("actualizacion_estado"));
        assertFalse(o.has("actualizacion_detalle"));
        assertFalse(o.has("actualizacion_objetivo"));
        d.smsSinReenviar = -7;
        assertEquals(-1, detalle(d).getInt("sms_sin_reenviar"));
        d.actualizacionDetalle = "x".repeat(31);
        assertFalse(detalle(d).has("actualizacion_detalle"));
    }

    @Test
    public void todosLosEstadosValidos() throws Exception {
        for (String e : new String[]{"ninguna", "descargando", "instalando", "fallo"}) {
            HeartbeatBody.Detalle d = base();
            d.actualizacionEstado = e;
            assertEquals(e, detalle(d).getString("actualizacion_estado"));
        }
    }

    @Test
    public void laFirmaCubreElTextoExactoConLoNuevo() throws Exception {
        HeartbeatBody.Detalle d = base();
        d.smsSinReenviar = 2;
        d.adbActivo = true;
        String body = HeartbeatBody.build(1790000000000L, "soda", "HONOR", 80, d);
        String firma = Request.computeHmacSha256Hex("clave", body);
        javax.crypto.Mac mac = javax.crypto.Mac.getInstance("HmacSHA256");
        mac.init(new javax.crypto.spec.SecretKeySpec("clave".getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        StringBuilder hex = new StringBuilder();
        for (byte b : mac.doFinal(body.getBytes(StandardCharsets.UTF_8))) hex.append(String.format("%02x", b));
        assertEquals(hex.toString(), firma);
        // el orden es fijo: dos armados iguales dan el mismo texto
        assertEquals(body, HeartbeatBody.build(1790000000000L, "soda", "HONOR", 80, d));
    }
}
