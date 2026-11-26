package tech.bogomolov.incomingsmsgateway;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assume.assumeTrue;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.service.notification.StatusBarNotification;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.rule.GrantPermissionRule;

import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.util.HashMap;
import java.util.Map;

/**
 * La Bomba 2.11.0: el despertar por FCM. No se puede mandar un FCM real desde una prueba, así que se ejercita todo lo
 * que hace la app al RECIBIR uno (DespertarFcmService.atender, el mismo código que onMessageReceived) contra el
 * servidor falso del latido: valida el mensaje, muestra y quita la notificación «Reconectando...», manda un latido
 * forzado con despertar_id y respeta la prioridad (en Android 12+ un mensaje degradado no arranca el servicio).
 * También: el token nuevo se guarda y viaja en el latido, y FcmInicio nunca lanza aunque no haya Play Services.
 */
@RunWith(AndroidJUnit4.class)
public class FcmDespertarInstrumentedTest {

    private static final String SECRETO = "claveprueba";
    private static final String TOKEN = "fXJ0b2tlbjpBUEE5MWJF-_abc123:XYZ0987654321qwertyuiop";
    private final Context ctx = InstrumentationRegistry.getInstrumentation().getTargetContext();

    @Rule
    public GrantPermissionRule permisos = GrantPermissionRule.grant(permisosAConceder());

    private static String[] permisosAConceder() {
        if (Build.VERSION.SDK_INT >= 33) {
            return new String[]{Manifest.permission.RECEIVE_SMS, Manifest.permission.READ_SMS, Manifest.permission.POST_NOTIFICATIONS};
        }
        return new String[]{Manifest.permission.RECEIVE_SMS, Manifest.permission.READ_SMS};
    }

    private GuardianInstrumentedTest.MiniServer server;

    @Before
    public void preparar() throws Exception {
        limpiar();
        Guardian.reiniciarFreno();
        ctx.stopService(new Intent(ctx, SmsReceiverService.class));
        server = new GuardianInstrumentedTest.MiniServer();
        server.start();
        ForwardingConfig c = new ForwardingConfig(ctx);
        c.setKey("fcm-test");
        c.setSender("4066");
        c.setSmsFilter("");
        c.setUrl("http://127.0.0.1:" + server.port + "/sms");
        c.setTemplate("{\"from\":\"%from%\",\"text\":\"%text%\",\"sentStamp\":\"%sentStamp%\",\"empresa\":\"soda\"}");
        c.setHeaders("{}");
        c.setRetriesNumber(1);
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
        Notificaciones.ocultarReconectando(ctx);
        Notificaciones.ocultarControlRemoto(ctx);
        limpiar();
    }

    private void limpiar() {
        for (String f : new String[]{ctx.getString(R.string.key_phones_preference), "heartbeat", "guardian", "failed_messages"}) {
            ctx.getSharedPreferences(f, Context.MODE_PRIVATE).edit().clear().commit();
        }
    }

    // ------------------------------------------------------------------ el despertar

    @Test
    public void unDespertarValidoLevantaElServicioYConfirmaConElMismoId() throws Exception {
        long ahora = System.currentTimeMillis();
        assertEquals(DespertarFcmService.Resultado.ATENDIDO, DespertarFcmService.atender(ctx, datos("despertar", "41", ahora), true, ahora));

        assertTrue("el latido del despertar no llegó", esperar(() -> server.latidos().size() >= 1, 20_000));
        JSONObject o = new JSONObject(server.latidos().get(0).cuerpo);
        JSONObject d = o.getJSONObject("detalle");
        assertTrue("despertar_id debe ser un número", d.get("despertar_id") instanceof Number);
        assertEquals(41, d.getLong("despertar_id"));
        assertEquals(Request.computeHmacSha256Hex(SECRETO, server.latidos().get(0).cuerpo), server.latidos().get(0).cabecera("x-signature"));
        assertTrue("el servicio debe quedar corriendo", esperar(SmsReceiverService::isRunning, 15_000));
        assertEquals("«Reconectando...» debe retirarse al terminar", 0, notificacionesPropias(Notificaciones.ID_DESPERTAR));
        assertEquals(41, new GuardianState(ctx).getDespertarIdUltimo());
    }

    @Test
    public void lasNotificacionesDelDespertarYDelControlRemotoSeVenYSeQuitan() throws Exception {
        assumeTrue("las notificaciones propias se listan desde Android 6", Build.VERSION.SDK_INT >= 23);
        Notificaciones.mostrarReconectando(ctx);
        assertTrue("no apareció «Reconectando...»", esperar(() -> notificacionesPropias(Notificaciones.ID_DESPERTAR) == 1, 10_000));
        StatusBarNotification sbn = propia(Notificaciones.ID_DESPERTAR);
        assertNotNull(sbn);
        assertEquals("Reconectando...", String.valueOf(sbn.getNotification().extras.getCharSequence(Notification.EXTRA_TITLE)));
        Notificaciones.ocultarReconectando(ctx);
        assertTrue(esperar(() -> notificacionesPropias(Notificaciones.ID_DESPERTAR) == 0, 10_000));

        Notificaciones.mostrarControlRemoto(ctx);
        assertTrue("no apareció la notificación del control remoto", esperar(() -> notificacionesPropias(Notificaciones.ID_CONTROL) == 1, 10_000));
        StatusBarNotification fija = propia(Notificaciones.ID_CONTROL);
        assertNotNull(fija);
        assertTrue("la del control remoto debe ser fija (no se descarta)", (fija.getNotification().flags & Notification.FLAG_ONGOING_EVENT) != 0);
        Notificaciones.ocultarControlRemoto(ctx);
        assertTrue(esperar(() -> notificacionesPropias(Notificaciones.ID_CONTROL) == 0, 10_000));
    }

    @Test
    public void lasNotificacionesSonDeBajaImportanciaYTienenCanalPropio() throws Exception {
        assumeTrue("los canales existen desde Android 8", Build.VERSION.SDK_INT >= 26);
        Notificaciones.mostrarReconectando(ctx);
        Notificaciones.mostrarControlRemoto(ctx);
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        assertTrue(esperar(() -> nm.getNotificationChannel(Notificaciones.CANAL_DESPERTAR) != null
                && nm.getNotificationChannel(Notificaciones.CANAL_CONTROL) != null, 10_000));
        assertEquals(NotificationManager.IMPORTANCE_LOW, nm.getNotificationChannel(Notificaciones.CANAL_DESPERTAR).getImportance());
        assertEquals(NotificationManager.IMPORTANCE_LOW, nm.getNotificationChannel(Notificaciones.CANAL_CONTROL).getImportance());
    }

    @Test
    public void unMensajeQueNoEsDespertarONoEsRecienteSeIgnoraSinLatido() throws Exception {
        long ahora = System.currentTimeMillis();
        assertEquals(DespertarFcmService.Resultado.IGNORADO, DespertarFcmService.atender(ctx, datos("otra_cosa", "50", ahora), true, ahora));
        assertEquals(DespertarFcmService.Resultado.IGNORADO, DespertarFcmService.atender(ctx, datos("Despertar", "51", ahora), true, ahora));
        assertEquals(DespertarFcmService.Resultado.IGNORADO, DespertarFcmService.atender(ctx, datos("despertar", "52", ahora - 10 * 60_000L), true, ahora));
        assertEquals(DespertarFcmService.Resultado.IGNORADO, DespertarFcmService.atender(ctx, datos("despertar", "53", ahora + 10 * 60_000L), true, ahora));
        Map<String, String> sinId = datos("despertar", "54", ahora);
        sinId.remove("despertar_id");
        assertEquals(DespertarFcmService.Resultado.IGNORADO, DespertarFcmService.atender(ctx, sinId, true, ahora));
        Map<String, String> idRaro = datos("despertar", "no-numero", ahora);
        assertEquals(DespertarFcmService.Resultado.IGNORADO, DespertarFcmService.atender(ctx, idRaro, true, ahora));
        assertEquals(DespertarFcmService.Resultado.IGNORADO, DespertarFcmService.atender(ctx, new HashMap<String, String>(), true, ahora));
        Thread.sleep(1500);
        assertEquals("nada de lo ignorado debe mandar latido", 0, server.latidos().size());
        assertFalse(SmsReceiverService.isRunning());
        assertEquals(0, new GuardianState(ctx).getDespertarIdUltimo());
    }

    @Test
    public void elMismoDespertarDosVecesSeAtiendeUnaSolaVez() throws Exception {
        long ahora = System.currentTimeMillis();
        assertEquals(DespertarFcmService.Resultado.ATENDIDO, DespertarFcmService.atender(ctx, datos("despertar", "60", ahora), true, ahora));
        assertEquals(DespertarFcmService.Resultado.REPETIDO, DespertarFcmService.atender(ctx, datos("despertar", "60", ahora), true, ahora + 2_000));
        assertTrue(esperar(() -> server.latidos().size() >= 1, 20_000));
        Thread.sleep(1500);
        int con60 = 0;
        for (GuardianInstrumentedTest.Peticion p : server.latidos()) {
            JSONObject d = new JSONObject(p.cuerpo).getJSONObject("detalle");
            if (d.has("despertar_id") && d.getLong("despertar_id") == 60) con60++;
        }
        assertEquals("el despertar repetido no debe confirmarse dos veces", 1, con60);
    }

    @Test
    public void conPrioridadDegradadaEnAndroid12SoloHayLatidoYNoSeArrancaElServicio() throws Exception {
        assumeTrue("la degradación de prioridad impide arrancar servicios desde Android 12", Build.VERSION.SDK_INT >= 31);
        assertFalse(SmsReceiverService.isRunning());
        long ahora = System.currentTimeMillis();
        assertEquals(DespertarFcmService.Resultado.ATENDIDO_SIN_SERVICIO,
                DespertarFcmService.atender(ctx, datos("despertar", "70", ahora), false, ahora));
        assertTrue("el latido igual debe salir", esperar(() -> server.latidos().size() >= 1, 20_000));
        assertEquals(70, new JSONObject(server.latidos().get(0).cuerpo).getJSONObject("detalle").getLong("despertar_id"));
        Thread.sleep(1500);
        assertFalse("con prioridad degradada no se debe arrancar el servicio", SmsReceiverService.isRunning());
        assertEquals(0, notificacionesPropias(Notificaciones.ID_DESPERTAR));
    }

    @Test
    public void unDespertarNoRebotaElServicioSiYaSeLanzoHaceUnMomento() throws Exception {
        long ahora = System.currentTimeMillis();
        assertTrue(Guardian.startServiceSafely(ctx, true));
        assertTrue(esperar(SmsReceiverService::isRunning, 15_000));
        int creaciones = SmsReceiverService.getCreaciones();
        assertEquals(DespertarFcmService.Resultado.ATENDIDO, DespertarFcmService.atender(ctx, datos("despertar", "80", ahora), true, ahora));
        assertEquals("el servicio ya corría: no se recrea", creaciones, SmsReceiverService.getCreaciones());
        assertTrue(esperar(() -> server.latidos().size() >= 1, 20_000));
    }

    // ------------------------------------------------------------------ el token

    @Test
    public void unTokenNuevoSeGuardaYSeMandaEnUnLatidoForzado() throws Exception {
        FcmInicio.alNuevoToken(ctx, TOKEN);
        assertTrue("no salió el latido del token nuevo", esperar(() -> server.latidos().size() >= 1, 20_000));
        assertEquals(TOKEN, new GuardianState(ctx).getFcmToken());
        JSONObject d = new JSONObject(server.latidos().get(0).cuerpo).getJSONObject("detalle");
        assertEquals(TOKEN, d.getString("fcm_token"));
        assertFalse("un token nuevo no es un despertar", d.has("despertar_id"));
    }

    @Test
    public void unTokenInvalidoNoSeGuardaNiSeManda() throws Exception {
        FcmInicio.alNuevoToken(ctx, "corto");
        FcmInicio.alNuevoToken(ctx, "tiene espacios y signos raros !!!!!!!!!!!!!!!!");
        FcmInicio.alNuevoToken(ctx, null);
        Thread.sleep(1500);
        // (si el emulador tiene Google Play Services puede llegar un token REAL por su cuenta: solo importa que no sea ninguno de estos)
        String guardado = new GuardianState(ctx).getFcmToken();
        assertFalse("corto".equals(guardado) || guardado.contains(" "));
        for (GuardianInstrumentedTest.Peticion p : server.latidos()) {
            String t = new JSONObject(p.cuerpo).getJSONObject("detalle").optString("fcm_token", "");
            assertFalse("corto".equals(t) || t.contains(" "));
        }
    }

    @Test
    public void iniciarFcmNuncaLanzaAunqueNoHayaPlayServices() {
        FcmInicio.iniciar(ctx);
        FcmInicio.iniciar(ctx);   // idempotente
    }

    // ------------------------------------------------------------------ ayudas

    private static Map<String, String> datos(String tipo, String id, long ts) {
        Map<String, String> m = new HashMap<>();
        m.put("tipo", tipo);
        m.put("despertar_id", id);
        m.put("titulo", "Reconectando...");
        m.put("ts", String.valueOf(ts));
        return m;
    }

    private int notificacionesPropias(int id) {
        return propia(id) == null ? 0 : 1;
    }

    private StatusBarNotification propia(int id) {
        if (Build.VERSION.SDK_INT < 23) return null;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        for (StatusBarNotification s : nm.getActiveNotifications()) {
            if (s.getId() == id && ctx.getPackageName().equals(s.getPackageName())) return s;
        }
        return null;
    }

    private interface Condicion {
        boolean ok() throws Exception;
    }

    private static boolean esperar(Condicion c, long ms) throws Exception {
        long fin = System.currentTimeMillis() + ms;
        while (System.currentTimeMillis() < fin) {
            try {
                if (c.ok()) return true;
            } catch (Exception ignored) {
            }
            Thread.sleep(200);
        }
        try {
            return c.ok();
        } catch (Exception e) {
            return false;
        }
    }
}
