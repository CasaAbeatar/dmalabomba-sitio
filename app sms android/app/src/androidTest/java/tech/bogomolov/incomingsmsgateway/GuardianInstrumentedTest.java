package tech.bogomolov.incomingsmsgateway;

import static androidx.test.espresso.Espresso.onView;
import static androidx.test.espresso.action.ViewActions.click;
import static androidx.test.espresso.action.ViewActions.scrollTo;
import static androidx.test.espresso.assertion.ViewAssertions.matches;
import static androidx.test.espresso.matcher.ViewMatchers.isDescendantOfA;
import static androidx.test.espresso.matcher.ViewMatchers.isDisplayed;
import static androidx.test.espresso.matcher.ViewMatchers.withId;
import static androidx.test.espresso.matcher.ViewMatchers.withTagValue;
import static androidx.test.espresso.matcher.ViewMatchers.withText;
import static org.hamcrest.Matchers.allOf;
import static org.hamcrest.Matchers.equalTo;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.rule.GrantPermissionRule;
import androidx.work.ListenableWorker;
import androidx.work.WorkInfo;
import androidx.work.WorkManager;
import androidx.work.testing.TestListenableWorkerBuilder;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * La Bomba 2.7.0: pruebas instrumentadas del Guardián en un emulador/dispositivo real de Android, contra un
 * servidor falso dentro del propio proceso (127.0.0.1). Verifican el latido enriquecido y su firma, que las
 * órdenes remotas se ejecuten una sola vez y solo si la respuesta es de confianza, los vigilantes
 * (WorkManager, alarma, arranque) y la pantalla «Salud del teléfono».
 */
@RunWith(AndroidJUnit4.class)
public class GuardianInstrumentedTest {

    private static final String SECRETO = "claveprueba";
    private final Context ctx = InstrumentationRegistry.getInstrumentation().getTargetContext();

    @Rule
    public GrantPermissionRule permisos = GrantPermissionRule.grant(permisosAConceder());

    private static String[] permisosAConceder() {
        if (Build.VERSION.SDK_INT >= 33) {
            return new String[]{Manifest.permission.RECEIVE_SMS, Manifest.permission.READ_SMS, Manifest.permission.POST_NOTIFICATIONS};
        }
        return new String[]{Manifest.permission.RECEIVE_SMS, Manifest.permission.READ_SMS};
    }

    private MiniServer server;

    @Before
    public void preparar() throws Exception {
        limpiar();
        Guardian.reiniciarFreno();   // 2.11.0: el freno central es estado del proceso; cada prueba empieza sin historial
        FcmInicio.ignorarTokenDeFirebase = true;   // 2.11.0: el token real de Firebase mandaría latidos que ensucian el conteo
        server = new MiniServer();
        server.start();
        ForwardingConfig c = new ForwardingConfig(ctx);
        c.setKey("guardian-test");
        c.setSender("4066");
        c.setSmsFilter("");
        c.setUrl("http://127.0.0.1:" + server.port + "/sms");
        c.setTemplate("{\"from\":\"%from%\",\"text\":\"%text%\",\"sentStamp\":\"%sentStamp%\",\"empresa\":\"soda\"}");
        c.setHeaders("{}");
        c.setRetriesNumber(3);
        c.setSignHmacSha256(true);
        c.setSignHmacSha256Secret(SECRETO);
        c.setLocalMode(true);
        c.save();
        new HeartbeatSettings(true, "http://127.0.0.1:" + server.port + "/latido", 5).save(ctx);
    }

    @After
    public void terminar() {
        ctx.stopService(new Intent(ctx, SmsReceiverService.class));
        server.stop();
        limpiar();
    }

    private void limpiar() {
        for (String f : new String[]{ctx.getString(R.string.key_phones_preference), "heartbeat", "guardian", "failed_messages"}) {
            ctx.getSharedPreferences(f, Context.MODE_PRIVATE).edit().clear().commit();
        }
    }

    private String urlLatido() {
        return "http://127.0.0.1:" + server.port + "/latido";
    }

    // ------------------------------------------------------------------ latido

    @Test
    public void latidoLlevaDetalleCompletoYFirmaValida() throws Exception {
        assertEquals(Request.RESULT_SUCCESS, Guardian.sendHeartbeat(ctx, urlLatido(), true, 0));
        assertEquals(1, server.latidos().size());
        Peticion p = server.latidos().get(0);
        assertEquals(Request.computeHmacSha256Hex(SECRETO, p.cuerpo), p.cabecera("x-signature"));

        JSONObject o = new JSONObject(p.cuerpo);
        assertEquals("latido", o.getString("tipo"));
        assertEquals("soda", o.getString("empresa"));
        assertTrue(Math.abs(o.getLong("ts") - System.currentTimeMillis()) < 60_000);
        assertTrue(o.has("telefono"));
        assertTrue(o.has("bateria"));
        JSONObject d = o.getJSONObject("detalle");
        for (String k : new String[]{"app", "cargando", "ahorro_bateria", "sin_restriccion_bateria", "red_validada",
                "tipo_red", "ultimo_sms_ts", "ultimo_reenvio_ok_ts", "fallidos_pendientes", "permiso_sms",
                "notificaciones", "android", "marca_modelo"}) {
            assertTrue("falta detalle." + k, d.has(k));
        }
        assertEquals(BuildConfig.VERSION_NAME, d.getString("app"));
        assertEquals("2.12.1", d.getString("app"));
        // 2.12.0: salud ampliada (llaves planas)
        for (String k : new String[]{"sms_inbox_ultimo_ms", "sms_sin_reenviar", "adb_activo", "adb_puerto", "actualizacion_estado"}) {
            assertTrue("falta detalle." + k, d.has(k));
        }
        assertEquals("ninguna", d.getString("actualizacion_estado"));
        // con READ_SMS el autochequeo da un conteo 0..999 (el emulador puede traer SMS de otros pasos de la prueba)
        assertTrue(d.getInt("sms_sin_reenviar") >= 0 && d.getInt("sms_sin_reenviar") <= 999);
        assertTrue(d.getLong("sms_inbox_ultimo_ms") >= 0);
        assertEquals(AdbInalambrico.activo(ctx), d.getBoolean("adb_activo"));
        for (String k : new String[]{"senal_nivel", "operador", "sim_estado", "modo_avion", "memoria_libre_mb", "arranque_ts",
                "bucket_standby", "doze", "latido_retraso_ms", "reinicios_servicio"}) {
            assertTrue("falta detalle." + k, d.has(k));
        }
        for (String k : new String[]{"wifi_encendido", "wifi_rssi", "wifi_mbps", "wifi_mhz", "wifi_nombre", "permisos_extra"}) {
            assertTrue("falta detalle." + k, d.has(k));
        }
        assertTrue("la memoria libre se midio", d.getInt("memoria_libre_mb") > 0);
        assertTrue("el arranque es anterior a ahora", d.getLong("arranque_ts") > 0 && d.getLong("arranque_ts") < System.currentTimeMillis());
        assertTrue(Arrays.asList("listo", "ausente", "bloqueado", "desconocido").contains(d.getString("sim_estado")));
        assertFalse("el emulador no esta en modo avion", d.getBoolean("modo_avion"));
        assertEquals(Build.VERSION.SDK_INT, d.getInt("android"));
        assertTrue(d.getBoolean("permiso_sms"));
        assertTrue(Arrays.asList("wifi", "datos", "ninguna").contains(d.getString("tipo_red")));
        assertFalse(d.has("comandos_hechos"));
    }

    @Test
    public void latidoConFirmaMalaEsRechazadoPorElServidorFalso() throws Exception {
        // Control negativo: si la clave de la regla fuera otra, la firma no coincidiría con la esperada.
        Guardian.sendHeartbeat(ctx, urlLatido(), true, 0);
        Peticion p = server.latidos().get(0);
        assertFalse(Request.computeHmacSha256Hex("otraclave", p.cuerpo).equals(p.cabecera("x-signature")));
    }

    @Test
    public void unLatidoReciente_seOmiteSalvoForzado() {
        assertEquals(Request.RESULT_SUCCESS, Guardian.sendHeartbeat(ctx, urlLatido(), false, 0));
        assertEquals("omitido", Guardian.sendHeartbeat(ctx, urlLatido(), false, 0));
        assertEquals(Request.RESULT_SUCCESS, Guardian.sendHeartbeat(ctx, urlLatido(), true, 0));
        assertEquals(2, server.latidos().size());
    }

    // ------------------------------------------------------------------ 2.7.1: un SMS reenviado deja un latido

    private ListenableWorker reenvio(String url) {
        androidx.work.Data datos = new androidx.work.Data.Builder()
                .putString(RequestWorker.DATA_URL, url)
                .putString(RequestWorker.DATA_TEXT, "{\"from\":\"4066\",\"text\":\"Ha recibido 100.00 Colones\"}")
                .putString(RequestWorker.DATA_HEADERS, "{}")
                .putBoolean(RequestWorker.DATA_CHUNKED_MODE, false)
                .putInt(RequestWorker.DATA_MAX_RETRIES, 3)
                .build();
        return TestListenableWorkerBuilder.from(ctx, RequestWorker.class).setInputData(datos).build();
    }

    @Test
    public void unSmsReenviadoDejaUnLatidoFirmadoYLosRepetidosSeFiltran() throws Exception {
        String urlSms = "http://127.0.0.1:" + server.port + "/sms";
        assertEquals(ListenableWorker.Result.success(), reenvio(urlSms).startWork().get());
        assertEquals("el reenvio reactiva el latido", 1, server.latidos().size());
        Peticion p = server.latidos().get(0);
        assertEquals(Request.computeHmacSha256Hex(SECRETO, p.cuerpo), p.cabecera("x-signature"));
        assertTrue(new JSONObject(p.cuerpo).getJSONObject("detalle").getLong("ultimo_reenvio_ok_ts") > 0);

        // una rafaga de SMS no debe generar una rafaga de latidos (filtro de 30 s)
        assertEquals(ListenableWorker.Result.success(), reenvio(urlSms).startWork().get());
        assertEquals(1, server.latidos().size());
    }

    @Test
    public void siElReenvioFallaNoHayLatidoNiCambiaElResultado() throws Exception {
        ListenableWorker.Result r = reenvio("http://127.0.0.1:1/sms").startWork().get();
        assertFalse("el reenvio fallido no es exito", ListenableWorker.Result.success().equals(r));
        assertEquals(0, server.latidos().size());
    }

    @Test
    public void siElLatidoFallaElReenvioSigueSiendoExitoso() throws Exception {
        new HeartbeatSettings(true, "http://127.0.0.1:1/latido", 5).save(ctx);
        assertEquals(ListenableWorker.Result.success(),
                reenvio("http://127.0.0.1:" + server.port + "/sms").startWork().get());
    }

    @Test
    public void elServicioContaSusArranquesYElLatidoMideSuAtraso() throws Exception {
        int antes = new GuardianState(ctx).getReiniciosServicio();
        Guardian.startServiceSafely(ctx);
        assertTrue(esperar(() -> SmsReceiverService.isRunning(), 15_000));
        assertTrue("cuenta el arranque", new GuardianState(ctx).getReiniciosServicio() > antes);
        // el primer latido periodico sale a los ~15 s y deja anotado su atraso (>= 0)
        assertTrue(esperar(() -> new GuardianState(ctx).getLatidoRetrasoMs() >= 0, 40_000));
        // un latido por evento (red) puede haber salido antes y el periodico omitirse por repetido: el
        // siguiente latido ya lleva el atraso medido
        assertEquals(Request.RESULT_SUCCESS, Guardian.sendHeartbeat(ctx, urlLatido(), true, 0));
        JSONObject d = new JSONObject(server.latidos().get(server.latidos().size() - 1).cuerpo).getJSONObject("detalle");
        assertTrue(d.getLong("latido_retraso_ms") >= 0);
        assertTrue(d.getInt("reinicios_servicio") >= 1);
    }

    // ------------------------------------------------------------------ 2.11.0: FCM en el latido y freno central

    private static final String TOKEN = "dXJ0b2tlbjpBUEE5MWJF-_abc123:XYZ0987654321qwertyuiop";

    @Test
    public void elTokenDeFcmViajaEnCadaLatidoYElDespertarIdSoloEnElQueLoConfirma() throws Exception {
        new GuardianState(ctx).guardarFcmToken(TOKEN);
        assertEquals(Request.RESULT_SUCCESS, Guardian.sendHeartbeat(ctx, urlLatido(), true, 0, 731));
        assertEquals(Request.RESULT_SUCCESS, Guardian.sendHeartbeat(ctx, urlLatido(), true, 0));
        List<Peticion> l = server.latidos();
        assertEquals(2, l.size());
        JSONObject d0 = new JSONObject(l.get(0).cuerpo).getJSONObject("detalle");
        JSONObject d1 = new JSONObject(l.get(1).cuerpo).getJSONObject("detalle");
        assertEquals(TOKEN, d0.getString("fcm_token"));
        assertEquals(TOKEN, d1.getString("fcm_token"));
        assertTrue("despertar_id es un numero", d0.get("despertar_id") instanceof Number);
        assertEquals(731, d0.getLong("despertar_id"));
        assertFalse(d1.has("despertar_id"));
        for (Peticion p : l) assertEquals(Request.computeHmacSha256Hex(SECRETO, p.cuerpo), p.cabecera("x-signature"));
    }

    @Test
    public void sinTokenElLatidoNoLlevaElCampo() throws Exception {
        Guardian.sendHeartbeat(ctx, urlLatido(), true, 0);
        assertFalse(new JSONObject(server.latidos().get(0).cuerpo).getJSONObject("detalle").has("fcm_token"));
    }

    @Test
    public void elFrenoCentralNoRelanzaElServicioDosVecesEnTreintaSegundosPeroLoPedidoAManoSiPasa() throws Exception {
        ctx.stopService(new Intent(ctx, SmsReceiverService.class));
        assertTrue(esperar(() -> !SmsReceiverService.isRunning(), 10_000));
        Guardian.reiniciarFreno();
        assertTrue("el primer arranque pasa", Guardian.startServiceSafely(ctx));
        assertTrue(esperar(() -> SmsReceiverService.isRunning(), 15_000));
        int creaciones = SmsReceiverService.getCreaciones();
        assertTrue("con el servicio corriendo no hace nada y dice que corre", Guardian.startServiceSafely(ctx));

        ctx.stopService(new Intent(ctx, SmsReceiverService.class));
        assertTrue(esperar(() -> !SmsReceiverService.isRunning(), 10_000));
        assertFalse("segundo arranque automatico dentro de 30 s: frenado", Guardian.startServiceSafely(ctx));
        Thread.sleep(1500);
        assertFalse("el servicio no se relanzo", SmsReceiverService.isRunning());
        assertEquals(creaciones, SmsReceiverService.getCreaciones());

        assertTrue("lo pedido a mano salta el freno", Guardian.startServiceSafely(ctx, true));
        assertTrue(esperar(() -> SmsReceiverService.isRunning(), 15_000));
        assertTrue(SmsReceiverService.getCreaciones() > creaciones);
    }

    @Test
    public void elVigilantePorAlarmaNoRebotaElServicioSiAcabaDeLanzarse() throws Exception {
        ctx.stopService(new Intent(ctx, SmsReceiverService.class));
        assertTrue(esperar(() -> !SmsReceiverService.isRunning(), 10_000));
        Guardian.reiniciarFreno();
        Guardian.startServiceSafely(ctx);
        assertTrue(esperar(() -> SmsReceiverService.isRunning(), 15_000));
        int creaciones = SmsReceiverService.getCreaciones();
        // diez vigilantes seguidos con el servicio vivo: ninguno lo relanza
        for (int i = 0; i < 10; i++) Guardian.tick(ctx, "rafaga");
        assertEquals(creaciones, SmsReceiverService.getCreaciones());
        assertTrue(SmsReceiverService.isRunning());
    }

    // ------------------------------------------------------------------ órdenes remotas

    @Test
    public void ordenesSeEjecutanUnaSolaVezSeConfirmanYLasDesconocidasSeIgnoran() throws Exception {
        server.respuestaLatido = "{\"comandos\":[{\"id\":11,\"cmd\":\"latido_ya\"},{\"id\":12,\"cmd\":\"reiniciar_telefono\"},"
                + "{\"id\":13,\"cmd\":\"borrar_todo\"}]}";
        server.firmarRespuesta = true;

        Guardian.sendHeartbeat(ctx, urlLatido(), true, 0);   // A: trae las órdenes; deja un latido de seguimiento B
        Guardian.sendHeartbeat(ctx, urlLatido(), true, 0);   // C: el servidor repite las mismas órdenes
        Guardian.sendHeartbeat(ctx, urlLatido(), true, 0);   // D

        GuardianState st = new GuardianState(ctx);
        assertEquals("latido_ya, una sola vez", 1, st.vecesEjecutada(11));
        assertEquals("reiniciar_telefono (no soportado), una sola vez", 1, st.vecesEjecutada(12));
        assertEquals("cmd fuera de la lista: nunca", 0, st.vecesEjecutada(13));
        assertFalse(st.getCommandLog().contains(13));

        List<Peticion> l = server.latidos();
        assertTrue("A, B, C y D", l.size() >= 4);
        JSONObject b = new JSONObject(l.get(1).cuerpo).getJSONObject("detalle");   // el seguimiento confirma
        JSONArray hechos = b.getJSONArray("comandos_hechos");
        assertEquals(2, hechos.length());
        assertEquals(11, hechos.getLong(0));
        assertEquals(12, hechos.getLong(1));
        assertEquals("ok", b.getJSONObject("comandos_resultado").getString("11"));
        assertEquals("comando_no_soportado", b.getJSONObject("comandos_resultado").getString("12"));
        // ya confirmadas: los latidos siguientes no las repiten
        assertFalse(new JSONObject(l.get(2).cuerpo).getJSONObject("detalle").has("comandos_hechos"));
        assertFalse(new JSONObject(l.get(3).cuerpo).getJSONObject("detalle").has("comandos_hechos"));
        // todas las firmas salientes son válidas
        for (Peticion p : l) assertEquals(Request.computeHmacSha256Hex(SECRETO, p.cuerpo), p.cabecera("x-signature"));
    }

    /** 2.12.0: abrir_adb / cerrar_adb se confirman aunque no haya WRITE_SECURE_SETTINGS (resultado claro) y se ejecutan una sola vez. */
    @Test
    public void ordenesDeDepuracionInalambricaSeConfirmanConResultadoClaro() throws Exception {
        server.respuestaLatido = "{\"comandos\":[{\"id\":51,\"cmd\":\"abrir_adb\"},{\"id\":52,\"cmd\":\"cerrar_adb\"}]}";
        server.firmarRespuesta = true;
        Guardian.sendHeartbeat(ctx, urlLatido(), true, 0);   // A: trae las órdenes y deja el seguimiento B con las confirmaciones
        GuardianState st = new GuardianState(ctx);
        assertEquals(1, st.vecesEjecutada(51));
        assertEquals(1, st.vecesEjecutada(52));
        String esperadoAbrir = !AdbInalambrico.soportado() ? "comando_no_soportado"
                : (AdbInalambrico.tienePermiso(ctx) ? "ok" : "falta_permiso_ajustes");
        String esperadoCerrar = AdbInalambrico.tienePermiso(ctx) ? "ok" : "falta_permiso_ajustes";
        JSONObject b = new JSONObject(server.latidos().get(1).cuerpo).getJSONObject("detalle");
        assertEquals(esperadoAbrir, b.getJSONObject("comandos_resultado").getString("51"));
        assertEquals(esperadoCerrar, b.getJSONObject("comandos_resultado").getString("52"));
        // sin permiso nada se enciende: el latido reporta adb_activo=false
        if (!AdbInalambrico.tienePermiso(ctx)) assertFalse(b.getBoolean("adb_activo"));
        Guardian.sendHeartbeat(ctx, urlLatido(), true, 0);   // el servidor repite las mismas órdenes: no se vuelven a ejecutar
        assertEquals(1, st.vecesEjecutada(51));
        assertEquals(1, st.vecesEjecutada(52));
        // sin permiso la app no anota ninguna hora de cierre (no encendió nada)
        if (!AdbInalambrico.tienePermiso(ctx)) assertEquals(0, st.getAdbCierraTs());
    }

    /**
     * 2.12.0 (auditoría): reiniciar_telefono y abrir_adb solo se ejecutan si la respuesta del latido trae X-Signature válida.
     * Sin ella (p. ej. la respuesta llegó por https pero sin firma) se ignoran y se confirman como «orden_sensible_sin_firma»;
     * las no sensibles siguen pasando. Con firma válida, las dos se ejecutan como siempre.
     */
    @Test
    public void ordenesSensiblesSinFirmaSeIgnoranYConFirmaSeEjecutan() {
        GuardianState st = new GuardianState(ctx);
        String sinFirma = "{\"comandos\":[{\"id\":61,\"cmd\":\"abrir_adb\"},{\"id\":62,\"cmd\":\"reiniciar_telefono\"},"
                + "{\"id\":63,\"cmd\":\"latido_ya\"}]}";
        // profundidad 1: sin latido de seguimiento (las confirmaciones quedan pendientes y se leen aquí)
        Guardian.procesarOrdenes(ctx, st, urlLatido(), sinFirma, 1, false);
        Map<Long, String> acks = st.getAcksPendientes();
        assertEquals(RemoteCommands.SIN_FIRMA, acks.get(61L));
        assertEquals(RemoteCommands.SIN_FIRMA, acks.get(62L));
        assertEquals("la no sensible sigue pasando", "ok", acks.get(63L));
        assertEquals("abrir_adb sin firma no enciende nada ni anota hora de cierre", 0, st.getAdbCierraTs());
        assertEquals(1, st.vecesEjecutada(61));   // queda registrada: no se reevalúa en cada latido
        assertEquals(1, st.vecesEjecutada(62));

        String conFirma = "{\"comandos\":[{\"id\":71,\"cmd\":\"abrir_adb\"},{\"id\":72,\"cmd\":\"reiniciar_telefono\"}]}";
        Guardian.procesarOrdenes(ctx, st, urlLatido(), conFirma, 1, true);
        acks = st.getAcksPendientes();
        String esperadoAbrir = !AdbInalambrico.soportado() ? "comando_no_soportado"
                : (AdbInalambrico.tienePermiso(ctx) ? "ok" : "falta_permiso_ajustes");
        assertEquals("con firma, abrir_adb se evalúa y ejecuta como siempre", esperadoAbrir, acks.get(71L));
        assertEquals("con firma, reiniciar_telefono se evalúa (no es dispositivo dedicado)", "comando_no_soportado", acks.get(72L));
        if (AdbInalambrico.tienePermiso(ctx) && AdbInalambrico.soportado()) AdbInalambrico.cerrar(ctx, st);
    }

    @Test
    public void respuestaSinFirmaPorHttpOConFirmaMalaNoEjecutaNada() {
        String cmds = "{\"comandos\":[{\"id\":21,\"cmd\":\"reiniciar_servicio\"},{\"id\":22,\"cmd\":\"latido_ya\"}]}";
        server.respuestaLatido = cmds;
        server.firmarRespuesta = false;
        Guardian.sendHeartbeat(ctx, urlLatido(), true, 0);
        server.firmaFija = "00" + "ab".repeat(31);
        server.firmarRespuesta = true;
        Guardian.sendHeartbeat(ctx, urlLatido(), true, 0);

        GuardianState st = new GuardianState(ctx);
        assertEquals(0, st.vecesEjecutada(21));
        assertEquals(0, st.vecesEjecutada(22));
        assertEquals("ni siquiera hubo latido de seguimiento", 2, server.latidos().size());
    }

    @Test
    public void reiniciarServicioReiniciaElServicioDeVerdad() throws Exception {
        Guardian.startServiceSafely(ctx);
        esperar(() -> SmsReceiverService.isRunning(), 10_000);
        int antes = SmsReceiverService.getCreaciones();

        server.respuestaLatido = "{\"comandos\":[{\"id\":31,\"cmd\":\"reiniciar_servicio\"}]}";
        server.firmarRespuesta = true;
        Guardian.sendHeartbeat(ctx, urlLatido(), true, 0);

        assertTrue("el servicio se volvió a crear", esperar(() -> SmsReceiverService.getCreaciones() > antes, 15_000));
        assertTrue("y está corriendo", esperar(() -> SmsReceiverService.isRunning(), 15_000));
        assertEquals(1, new GuardianState(ctx).vecesEjecutada(31));
        // la confirmación sale en el primer latido del servicio nuevo (a los ~15 s)
        server.respuestaLatido = "{\"ok\":true}";
        assertTrue("llega un latido que confirma 31",
                esperar(() -> server.latidos().stream().anyMatch(p -> p.cuerpo.contains("\"comandos_hechos\":[31]")), 40_000));
    }

    @Test
    public void reenviarHistorialSeRegistraYNoFallaSinMensajes() throws Exception {
        server.respuestaLatido = "{\"comandos\":[{\"id\":41,\"cmd\":\"reenviar_historial\"}]}";
        server.firmarRespuesta = true;
        Guardian.sendHeartbeat(ctx, urlLatido(), true, 0);
        GuardianState st = new GuardianState(ctx);
        assertEquals(1, st.vecesEjecutada(41));
        assertTrue(st.getEjecuciones().contains("41|reenviar_historial|ok|"));
    }

    @Test
    public void esDispositivoDedicadoEsFalsoYElRebootNoEstaSoportado() {
        assertFalse(Guardian.esDispositivoDedicado(ctx));
        assertEquals("comando_no_soportado", Guardian.resultadoPrevisto(ctx, RemoteCommands.REINICIAR_TELEFONO));
        assertFalse(Guardian.dejarDeSerDedicado(ctx));
    }

    // ------------------------------------------------------------------ vigilantes

    @Test
    public void vigilanteWorkManagerLevantaElServicioYMandaLatido() throws Exception {
        ctx.stopService(new Intent(ctx, SmsReceiverService.class));
        assertTrue(esperar(() -> !SmsReceiverService.isRunning(), 10_000));
        ListenableWorker w = TestListenableWorkerBuilder.from(ctx, GuardianWorker.class).build();
        assertEquals(ListenableWorker.Result.success(), w.startWork().get());
        assertTrue("el servicio volvió", esperar(() -> SmsReceiverService.isRunning(), 15_000));
        assertTrue("el vigilante mandó latido por su cuenta", server.latidos().size() >= 1);
    }

    @Test
    public void vigilantePorAlarmaLevantaElServicioYMandaLatido() throws Exception {
        ctx.stopService(new Intent(ctx, SmsReceiverService.class));
        assertTrue(esperar(() -> !SmsReceiverService.isRunning(), 10_000));
        new GuardianAlarmReceiver().onReceive(ctx, new Intent("x"));
        assertTrue(esperar(() -> SmsReceiverService.isRunning(), 15_000));
        assertTrue(esperar(() -> server.latidos().size() >= 1, 15_000));
    }

    @Test
    public void arranqueDelTelefonoYActualizacionRevivenAlServicioYArmanElVigilante() throws Exception {
        for (String accion : new String[]{Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED,
                "android.intent.action.QUICKBOOT_POWERON", Intent.ACTION_LOCKED_BOOT_COMPLETED}) {
            ctx.stopService(new Intent(ctx, SmsReceiverService.class));
            assertTrue(esperar(() -> !SmsReceiverService.isRunning(), 10_000));
            Guardian.reiniciarFreno();   // 2.11.0: cuatro arranques seguidos serian frenados a proposito; cada uno cuenta como uno nuevo
            new BootCompletedReceiver().onReceive(ctx, new Intent(accion));
            assertTrue("tras " + accion, esperar(() -> SmsReceiverService.isRunning(), 15_000));
        }
        List<WorkInfo> trabajos = WorkManager.getInstance(ctx).getWorkInfosForUniqueWork(Guardian.WORK_NAME).get();
        assertEquals(1, trabajos.size());
        assertFalse(trabajos.get(0).getState().isFinished());
    }

    @Test
    public void elServicioManda_latidoSoloAlArrancarSiElUltimoEsViejo() throws Exception {
        Guardian.startServiceSafely(ctx);
        // primer latido a los ~15 s de arrancar
        assertTrue(esperar(() -> server.latidos().size() >= 1, 40_000));
        assertTrue(SmsReceiverService.isRunning());
    }

    // ------------------------------------------------------------------ pantalla Salud

    @Test
    public void pantallaSaludSeAbreDesdeElBotonYMuestraLosSemaforos() {
        try (ActivityScenario<MainActivity> sc = ActivityScenario.launch(MainActivity.class)) {
            onView(withId(R.id.btn_health)).check(matches(isDisplayed()));
            onView(withId(R.id.btn_health)).perform(click());
            onView(withId(R.id.health_summary)).check(matches(isDisplayed()));
            for (int t : new int[]{R.string.h_sms_title, R.string.h_read_title, R.string.h_notif_title, R.string.h_bat_title,
                    R.string.h_saver_title, R.string.h_service_title, R.string.h_autostart_title, R.string.h_wifi_title,
                    R.string.h_hb_title, R.string.h_lastsms_title}) {
                onView(withText(t)).perform(scrollTo()).check(matches(isDisplayed()));
            }
        }
    }

    @Test
    public void yaLoHiceMarcaYDesmarcaLoQueAndroidNoDejaLeer() {
        try (ActivityScenario<MainActivity> sc = ActivityScenario.launch(MainActivity.class)) {
            onView(withId(R.id.btn_health)).perform(click());
            onView(allOf(withId(R.id.h_done), isDescendantOfA(withTagValue(equalTo((Object) "wifi")))))
                    .perform(scrollTo(), click());
            assertTrue(new GuardianState(ctx).confirmado("wifi"));
            onView(allOf(withId(R.id.h_done), isDescendantOfA(withTagValue(equalTo((Object) "wifi")))))
                    .perform(scrollTo()).check(matches(withText(R.string.health_btn_undo)));
        }
    }

    /** 2.12.1: desde Android 10 la fila de Wi-Fi en suspensión explica el ajuste por app y abre la información de la app. */
    @Test
    public void filaWifiSuspensionUsaElTextoYElBotonSegunLaVersionDeAndroid() {
        HealthCheck.Item w = null;
        for (HealthCheck.Item i : HealthCheck.evaluar(ctx)) if (i.id.equals(HealthCheck.WIFI)) w = i;
        assertTrue(w != null);
        if (android.os.Build.VERSION.SDK_INT >= 29) {
            assertEquals(R.string.h_wifi_btn_29, w.boton);
        } else {
            assertEquals(R.string.h_wifi_btn, w.boton);
        }
    }

    @Test
    public void evaluacionDeSaludReflejaPermisosYServicio() {
        List<HealthCheck.Item> l = HealthCheck.evaluar(ctx);
        Map<String, HealthCheck.Item> m = new HashMap<>();
        for (HealthCheck.Item i : l) m.put(i.id, i);
        assertTrue(m.get(HealthCheck.SMS).ok);
        assertTrue(m.get(HealthCheck.LEER_SMS).ok);
        assertFalse("autoinicio no se puede leer: pendiente hasta confirmar", m.get(HealthCheck.AUTOINICIO).ok);
        assertTrue(m.get(HealthCheck.AUTOINICIO).manual);
        assertTrue(m.get(HealthCheck.ULTIMO_SMS).informativo);
        assertNotNull(m.get(HealthCheck.LATIDO));
        if (Build.VERSION.SDK_INT >= 33) assertTrue("con permiso de SMS dado no hay ajuste restringido", m.get(HealthCheck.RESTRINGIDOS).ok);
    }

    // ------------------------------------------------------------------ utilidades

    interface Condicion {
        boolean ok();
    }

    private static boolean esperar(Condicion c, long ms) throws InterruptedException {
        long fin = System.currentTimeMillis() + ms;
        while (System.currentTimeMillis() < fin) {
            if (c.ok()) return true;
            Thread.sleep(250);
        }
        return c.ok();
    }

    static final class Peticion {
        final String ruta, cuerpo;
        final Map<String, String> cab;

        Peticion(String ruta, String cuerpo, Map<String, String> cab) {
            this.ruta = ruta;
            this.cuerpo = cuerpo;
            this.cab = cab;
        }

        String cabecera(String k) {
            return cab.get(k.toLowerCase());
        }
    }

    /** Servidor HTTP mínimo en el propio proceso (127.0.0.1, puerto libre). */
    static final class MiniServer {
        int port;
        volatile String respuestaLatido = "{\"ok\":true}";
        volatile boolean firmarRespuesta = false;
        volatile String firmaFija = null;
        private ServerSocket ss;
        private volatile boolean activo = true;
        private final List<Peticion> recibidas = new CopyOnWriteArrayList<>();

        void start() throws Exception {
            ss = new ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"));
            port = ss.getLocalPort();
            Thread t = new Thread(() -> {
                while (activo) {
                    try {
                        final Socket s = ss.accept();
                        new Thread(() -> atender(s)).start();
                    } catch (Exception e) {
                        return;
                    }
                }
            }, "MiniServer");
            t.setDaemon(true);
            t.start();
        }

        void stop() {
            activo = false;
            try {
                ss.close();
            } catch (Exception ignored) {
            }
        }

        List<Peticion> latidos() {
            List<Peticion> l = new ArrayList<>();
            for (Peticion p : recibidas) if (p.ruta.equals("/latido")) l.add(p);
            return l;
        }

        private void atender(Socket s) {
            try (Socket sock = s) {
                sock.setSoTimeout(10_000);
                InputStream in = sock.getInputStream();
                ByteArrayOutputStream head = new ByteArrayOutputStream();
                int b, estado = 0;
                while ((b = in.read()) >= 0) {
                    head.write(b);
                    estado = (b == '\r' && (estado == 0 || estado == 2)) ? estado + 1 : (b == '\n' && (estado == 1 || estado == 3)) ? estado + 1 : 0;
                    if (estado == 4) break;
                }
                String[] lineas = head.toString("UTF-8").split("\r\n");
                String ruta = lineas[0].split(" ")[1];
                Map<String, String> cab = new HashMap<>();
                for (int i = 1; i < lineas.length; i++) {
                    int c = lineas[i].indexOf(':');
                    if (c > 0) cab.put(lineas[i].substring(0, c).trim().toLowerCase(), lineas[i].substring(c + 1).trim());
                }
                int largo = cab.containsKey("content-length") ? Integer.parseInt(cab.get("content-length")) : 0;
                byte[] cuerpo = new byte[largo];
                int leido = 0;
                while (leido < largo) {
                    int n = in.read(cuerpo, leido, largo - leido);
                    if (n < 0) break;
                    leido += n;
                }
                String texto = new String(cuerpo, StandardCharsets.UTF_8);
                recibidas.add(new Peticion(ruta, texto, cab));

                String resp = ruta.equals("/latido") ? respuestaLatido : "{\"nuevos\":0}";
                StringBuilder h = new StringBuilder("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n");
                if (ruta.equals("/latido") && firmarRespuesta) {
                    h.append("X-Signature: ").append(firmaFija != null ? firmaFija : Request.computeHmacSha256Hex(SECRETO, resp)).append("\r\n");
                }
                byte[] rb = resp.getBytes(StandardCharsets.UTF_8);
                h.append("Content-Length: ").append(rb.length).append("\r\nConnection: close\r\n\r\n");
                OutputStream out = sock.getOutputStream();
                out.write(h.toString().getBytes(StandardCharsets.UTF_8));
                out.write(rb);
                out.flush();
            } catch (Exception ignored) {
            }
        }
    }
}
