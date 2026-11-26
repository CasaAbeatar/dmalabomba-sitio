package tech.bogomolov.incomingsmsgateway;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.provider.Telephony;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.rule.GrantPermissionRule;

import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.mockito.Mockito;

import java.io.ByteArrayOutputStream;

/**
 * La Bomba 2.11.0: el SMS de despertar «LB1 &lt;orden&gt; &lt;contador&gt; &lt;firma&gt;» pasa por el receptor REAL de SMS
 * (SmsBroadcastReceiver.onReceive, con el mismo mecanismo de SmsReceiverTest: receptor simulado con el onReceive
 * verdadero y callWebHook interceptado) y por el servidor falso del latido. Comprueba que el SMS de despertar
 * se descarta SIEMPRE antes de las reglas de reenvío (callWebHook nunca se llama), que solo la firma buena y el
 * contador creciente lo ejecutan, y que un SMS normal sigue reenviándose igual que antes.
 */
@RunWith(AndroidJUnit4.class)
public class SmsDespertarInstrumentedTest {

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

    private GuardianInstrumentedTest.MiniServer server;

    @Before
    public void preparar() throws Exception {
        limpiar();
        Guardian.reiniciarFreno();
        FcmInicio.ignorarTokenDeFirebase = true;   // el token real de Firebase mandaría latidos que ensucian el conteo
        server = new GuardianInstrumentedTest.MiniServer();
        server.start();
        // regla con comodín: un SMS normal SÍ se reenviaría; así se prueba que el de despertar no.
        ForwardingConfig c = new ForwardingConfig(ctx);
        c.setKey("despertar-test");
        c.setSender(ctx.getString(R.string.asterisk));
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
        limpiar();
    }

    private void limpiar() {
        for (String f : new String[]{ctx.getString(R.string.key_phones_preference), "heartbeat", "guardian", "failed_messages"}) {
            ctx.getSharedPreferences(f, Context.MODE_PRIVATE).edit().clear().commit();
        }
    }

    // ------------------------------------------------------------------ pruebas

    @Test
    public void unDespertarValidoNoSeReenvia_SeAnotaYElServidorRecibeUnLatido() throws Exception {
        SmsBroadcastReceiver receiver = receptor();
        receiver.onReceive(ctx, intent(sms(SmsDespertar.CMD_LATIDO_YA, 1)));

        assertTrue("el latido del despertar no llegó", esperar(() -> server.latidos().size() >= 1, 20_000));
        assertTrue(esperar(() -> ultimoResultado().equals("OK"), 5_000));
        assertEquals(1, new GuardianState(ctx).getSmsContador());
        JSONObject o = new JSONObject(server.latidos().get(0).cuerpo);
        assertEquals("latido", o.getString("tipo"));
        assertEquals(Request.computeHmacSha256Hex(SECRETO, server.latidos().get(0).cuerpo), server.latidos().get(0).cabecera("x-signature"));
        noSeReenvio(receiver);
    }

    @Test
    public void unSmsRepetidoSeRechazaYNoVuelveAEjecutar() throws Exception {
        SmsBroadcastReceiver receiver = receptor();
        String texto = sms(SmsDespertar.CMD_LATIDO_YA, 5);
        receiver.onReceive(ctx, intent(texto));
        assertTrue(esperar(() -> server.latidos().size() >= 1, 20_000));
        assertTrue(esperar(() -> lineasLog() >= 1 && ultimoResultado().equals("OK"), 5_000));

        receiver.onReceive(ctx, intent(texto));   // el mismo SMS otra vez (replay)
        assertTrue(esperar(() -> lineasLog() >= 2, 10_000));
        assertEquals("CONTADOR_REPETIDO", ultimoResultado());
        Thread.sleep(1500);
        assertEquals("el replay no debe ejecutarse otra vez: solo una orden OK en la bitácora", 1, contarResultado("OK"));
        assertEquals(5, new GuardianState(ctx).getSmsContador());

        receiver.onReceive(ctx, intent(sms(SmsDespertar.CMD_LATIDO_YA, 4)));   // contador menor: tampoco
        assertTrue(esperar(() -> lineasLog() >= 3, 10_000));
        assertEquals("CONTADOR_REPETIDO", ultimoResultado());
        noSeReenvio(receiver);
    }

    @Test
    public void unaFirmaMalaSeDescartaSinEjecutarNiReenviar() throws Exception {
        SmsBroadcastReceiver receiver = receptor();
        String buena = SmsDespertar.firmaCompleta(SECRETO, SmsDespertar.CMD_LATIDO_YA, 9).substring(0, 16);
        String mala = (buena.charAt(0) == '0' ? "1" : "0") + buena.substring(1);
        receiver.onReceive(ctx, intent("LB1 latido_ya 9 " + mala));
        assertTrue(esperar(() -> lineasLog() >= 1, 10_000));
        assertEquals("FIRMA_MALA", ultimoResultado());
        Thread.sleep(1500);
        assertEquals(0, contarResultado("OK"));
        assertEquals("el contador no avanza con una firma mala", 0, new GuardianState(ctx).getSmsContador());
        noSeReenvio(receiver);

        // con la clave equivocada tampoco
        String ajena = SmsDespertar.firmaCompleta("otra-clave", SmsDespertar.CMD_LATIDO_YA, 9).substring(0, 16);
        receiver.onReceive(ctx, intent("LB1 latido_ya 9 " + ajena));
        assertTrue(esperar(() -> lineasLog() >= 2, 10_000));
        assertEquals("FIRMA_MALA", ultimoResultado());
        assertEquals(0, contarResultado("OK"));
        noSeReenvio(receiver);
    }

    @Test
    public void mayusculasYEspaciosSeToleranPeroLaFirmaSigueSiendoLaDelTextoCanonico() throws Exception {
        SmsBroadcastReceiver receiver = receptor();
        String firma = SmsDespertar.firmaCompleta(SECRETO, SmsDespertar.CMD_LATIDO_YA, 12).substring(0, 20).toUpperCase();
        receiver.onReceive(ctx, intent("  lb1   LATIDO_YA  12   " + firma + " "));
        assertTrue("no llegó el latido", esperar(() -> server.latidos().size() >= 1, 20_000));
        assertTrue(esperar(() -> ultimoResultado().equals("OK"), 5_000));
        assertEquals(12, new GuardianState(ctx).getSmsContador());
        noSeReenvio(receiver);
    }

    @Test
    public void unaOrdenFueraDeLaListaCerradaSeRechazaAunqueEsteBienFirmada() throws Exception {
        SmsBroadcastReceiver receiver = receptor();
        String firma = SmsDespertar.firmaCompleta(SECRETO, "borrar_todo", 3).substring(0, 16);
        receiver.onReceive(ctx, intent("LB1 borrar_todo 3 " + firma));
        assertTrue(esperar(() -> lineasLog() >= 1, 10_000));
        assertEquals("ORDEN_DESCONOCIDA", ultimoResultado());
        assertEquals(0, contarResultado("OK"));
        assertEquals(0, new GuardianState(ctx).getSmsContador());
        noSeReenvio(receiver);
    }

    @Test
    public void unSaltoEnormeDeContadorSeRechazaPeroDespuesDeUnoValidoEsperado() throws Exception {
        SmsBroadcastReceiver receiver = receptor();
        receiver.onReceive(ctx, intent(sms(SmsDespertar.CMD_LATIDO_YA, 10)));
        assertTrue(esperar(() -> server.latidos().size() >= 1, 20_000));
        receiver.onReceive(ctx, intent(sms(SmsDespertar.CMD_LATIDO_YA, 10 + SmsDespertar.SALTO_MAX + 5)));
        assertTrue(esperar(() -> lineasLog() >= 2, 10_000));
        assertEquals("CONTADOR_SALTO", ultimoResultado());
        assertEquals(10, new GuardianState(ctx).getSmsContador());
        noSeReenvio(receiver);
    }

    @Test
    public void reiniciarServicioRelanzaDeVerdadElServicioYMandaLatido() throws Exception {
        assertTrue(Guardian.startServiceSafely(ctx, true));
        assertTrue(esperar(SmsReceiverService::isRunning, 15_000));
        int creaciones = SmsReceiverService.getCreaciones();
        SmsBroadcastReceiver receiver = receptor();
        receiver.onReceive(ctx, intent(sms(SmsDespertar.CMD_REINICIAR_SERVICIO, 1)));
        assertTrue("no llegó el latido", esperar(() -> server.latidos().size() >= 1, 30_000));
        assertTrue("el servicio no se recreó", esperar(() -> SmsReceiverService.getCreaciones() > creaciones, 20_000));
        assertTrue(esperar(SmsReceiverService::isRunning, 20_000));
        assertTrue(esperar(() -> ultimoResultado().equals("OK"), 5_000));
        noSeReenvio(receiver);
    }

    @Test
    public void reenviarHistorialSeAceptaConElPermisoDeLeerSms() throws Exception {
        SmsBroadcastReceiver receiver = receptor();
        receiver.onReceive(ctx, intent(sms(SmsDespertar.CMD_REENVIAR_HISTORIAL, 1)));
        assertTrue("no llegó el latido", esperar(() -> server.latidos().size() >= 1, 30_000));
        assertTrue(esperar(() -> ultimoResultado().equals("OK"), 5_000));
        noSeReenvio(receiver);
    }

    @Test
    public void unSmsNormalSigueReenviandoseComoAntes() throws Exception {
        SmsBroadcastReceiver receiver = receptor();
        receiver.onReceive(ctx, intent("Test"));
        Mockito.verify(receiver, Mockito.times(1)).callWebHook(
                Mockito.any(ForwardingConfig.class), Mockito.anyString(), Mockito.anyString(), Mockito.anyString(), Mockito.anyLong());
        // y uno que solo CONTIENE LB1 en medio no es de despertar: también se reenvía
        SmsBroadcastReceiver otro = receptor();
        otro.onReceive(ctx, intent("Hola LB1 latido_ya 1 abcdef0123"));
        Mockito.verify(otro, Mockito.times(1)).callWebHook(
                Mockito.any(ForwardingConfig.class), Mockito.anyString(), Mockito.anyString(), Mockito.anyString(), Mockito.anyLong());
        assertEquals(0, lineasLog());
    }

    @Test
    public void unSmsLb1MalFormadoTambienSeDescartaYNoSeReenvia() throws Exception {
        SmsBroadcastReceiver receiver = receptor();
        receiver.onReceive(ctx, intent("LB1 latido_ya"));                       // faltan campos
        receiver.onReceive(ctx, intent("LB1 latido_ya cero abcdef0123"));       // contador no numérico
        receiver.onReceive(ctx, intent("LB1 latido_ya 1 xyz"));                 // firma corta y no hex
        assertTrue(esperar(() -> lineasLog() >= 3, 10_000));
        noSeReenvio(receiver);
        assertEquals(0, contarResultado("OK"));
        assertEquals("FORMATO", ultimoResultado());
    }

    // ------------------------------------------------------------------ ayudas

    private void noSeReenvio(SmsBroadcastReceiver receiver) {
        Mockito.verify(receiver, Mockito.times(0)).callWebHook(
                Mockito.any(ForwardingConfig.class), Mockito.anyString(), Mockito.anyString(), Mockito.anyString(), Mockito.anyLong());
    }

    private int lineasLog() {
        String l = new GuardianState(ctx).getSmsLog();
        return l.isEmpty() ? 0 : l.split("\n").length;
    }

    private int contarResultado(String resultado) {
        String l = new GuardianState(ctx).getSmsLog();
        int n = 0;
        if (l.isEmpty()) return 0;
        for (String linea : l.split("\n")) {
            String[] c = linea.split("\\|");
            if (c.length >= 4 && c[3].equals(resultado)) n++;
        }
        return n;
    }

    private String ultimoResultado() {
        String l = new GuardianState(ctx).getSmsLog();
        if (l.isEmpty()) return "";
        String[] lineas = l.split("\n");
        String[] c = lineas[lineas.length - 1].split("\\|");
        return c.length >= 4 ? c[3] : "";
    }

    /** SMS firmado como lo haría el servidor: HMAC-SHA256 de «LB1 cmd contador» con la clave de la regla, 16 hex. */
    private static String sms(String cmd, long contador) throws Exception {
        return "LB1 " + cmd + " " + contador + " " + SmsDespertar.firmaCompleta(SECRETO, cmd, contador).substring(0, 16);
    }

    private SmsBroadcastReceiver receptor() {
        SmsBroadcastReceiver receiver = Mockito.mock(SmsBroadcastReceiver.class);
        Mockito.doCallRealMethod().when(receiver).onReceive(Mockito.any(Context.class), Mockito.any(Intent.class));
        Mockito.doNothing().when(receiver).callWebHook(
                Mockito.any(ForwardingConfig.class), Mockito.anyString(), Mockito.anyString(), Mockito.anyString(), Mockito.anyLong());
        return receiver;
    }

    private Intent intent(String texto) {
        Intent intent = new Intent(Telephony.Sms.Intents.SMS_RECEIVED_ACTION);
        intent.putExtra("pdus", new byte[][]{pdu(texto)});
        return intent;
    }

    /** PDU SMS-DELIVER de +16505551111 con el texto en GSM de 7 bits (solo letras, dígitos, espacio, «_» y «-»). */
    private static byte[] pdu(String texto) {
        String cabecera = "07914151551512f2040B916105551511f100006060605130308A";
        ByteArrayOutputStream datos = new ByteArrayOutputStream();
        int acc = 0, bits = 0;
        for (int i = 0; i < texto.length(); i++) {
            char ch = texto.charAt(i);
            int sept = ch == '_' ? 0x11 : ch;
            acc |= sept << bits;
            bits += 7;
            while (bits >= 8) {
                datos.write(acc & 0xFF);
                acc >>>= 8;
                bits -= 8;
            }
        }
        if (bits > 0) datos.write(acc & 0xFF);
        StringBuilder hex = new StringBuilder(cabecera);
        hex.append(String.format("%02X", texto.length()));
        for (byte b : datos.toByteArray()) hex.append(String.format("%02X", b & 0xFF));
        String h = hex.toString();
        byte[] r = new byte[h.length() / 2];
        for (int i = 0; i < r.length; i++) r[i] = (byte) Integer.parseInt(h.substring(i * 2, i * 2 + 2), 16);
        return r;
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
