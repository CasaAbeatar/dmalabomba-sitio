package tech.bogomolov.incomingsmsgateway;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assume.assumeTrue;

import android.app.Instrumentation;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.ParcelFileDescriptor;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.net.Socket;
import java.util.Arrays;
import java.util.List;

import javax.net.ssl.SSLSocket;

import tech.bogomolov.incomingsmsgateway.SSLSocketFactory.TLSSocketFactory;
import tech.bogomolov.incomingsmsgateway.SSLSocketFactory.TlsPolitica;

/**
 * La Bomba 2.12.0 (auditoría), en Android de verdad: lista cerrada de instaladores, nombre de la app, tope global de
 * descargas por día, TLS 1.2/1.3 y receptor de SMS no exportado.
 */
@RunWith(AndroidJUnit4.class)
public class AuditoriaInstrumentedTest {

    private static final String PAQUETE = "tech.bogomolov.incomingsmsgateway";
    private static final String SECRETO = "claveprueba";
    private static final Instrumentation inst = InstrumentationRegistry.getInstrumentation();
    private static final Context ctx = inst.getTargetContext();

    @Before
    public void preparar() {
        ctx.getSharedPreferences("guardian", Context.MODE_PRIVATE).edit().clear().commit();
        new File(ctx.getFilesDir(), "prueba_tope_global").delete();
        new File(ctx.getFilesDir(), "prueba_nombre_otro").delete();
    }

    @After
    public void terminar() {
        ctx.getSharedPreferences("guardian", Context.MODE_PRIVATE).edit().clear().commit();
    }

    // ------------------------------------------------------------------ pulsador: instaladores y nombre

    private static Intent haciaPaquete(String pkg) {
        return new Intent().setComponent(new ComponentName(pkg, pkg + ".InstallInstalling"));
    }

    @Test
    public void soloSeAceptanLosInstaladoresDeLaListaCerrada() {
        for (String ok : new String[]{"com.google.android.packageinstaller", "com.android.packageinstaller",
                "com.samsung.android.packageinstaller", "com.huawei.android.packageinstaller", "com.hihonor.android.packageinstaller"}) {
            assertEquals(ok, Actualizador.paqueteInstalador(ctx, haciaPaquete(ok)));
        }
        // apps del sistema que NO son instaladores, la propia app y una app cualquiera: no
        assertNull("una app de sistema cualquiera no vale", Actualizador.paqueteInstalador(ctx, haciaPaquete("com.android.settings")));
        assertNull(Actualizador.paqueteInstalador(ctx, haciaPaquete("com.android.systemui")));
        assertNull("la propia app no", Actualizador.paqueteInstalador(ctx, haciaPaquete(PAQUETE)));
        assertNull(Actualizador.paqueteInstalador(ctx, haciaPaquete("com.example.instalador.falso")));
        assertNull(Actualizador.paqueteInstalador(ctx, null));
        assertNull(Actualizador.paqueteInstalador(ctx, new Intent()));
    }

    @Test
    public void elNombreDeLaAppEsElLabelRealYElDialogoDelInstaladorLoContiene() throws Exception {
        String nombre = Actualizador.nombreApp(ctx);
        assertFalse(nombre.isEmpty());
        assertEquals(ctx.getApplicationInfo().loadLabel(ctx.getPackageManager()).toString(), nombre);
        // lo que muestra el instalador de Google en la actualización
        List<String> dialogo = Arrays.asList(nombre, "Do you want to update this app?", "Cancel", "Update");
        assertTrue(InstaladorPolitica.contieneNombreDeApp(dialogo, nombre));
        assertFalse(InstaladorPolitica.contieneNombreDeApp(Arrays.asList("Otra App", "Do you want to update this app?", "Update"), nombre));
    }

    @Test
    public void sinSesionDeInstalacionAbiertaPorLaAppNoHayVentanaDePulsado() {
        assertFalse(Actualizador.ventanaDePulsadoAbierta());
        // y el servicio de accesibilidad, aunque se le pida, no pulsa fuera de la lista cerrada de paquetes
        PantallaRemotaService s = PantallaRemotaService.instancia();
        if (s != null) {
            assertFalse(s.pulsarBotonInstalador("com.android.settings", Actualizador.nombreApp(ctx)));
            assertFalse(s.pulsarBotonInstalador(PAQUETE, Actualizador.nombreApp(ctx)));
        }
    }

    // ------------------------------------------------------------------ tope global de descargas por día

    @Test
    public void lasDescargasSeRecuerdanYSePodanPasadas24h() {
        GuardianState st = new GuardianState(ctx);
        long h = 3_600_000L;
        long ahora = System.currentTimeMillis();
        st.registrarDescargaUpd(ahora - 30 * h);
        st.registrarDescargaUpd(ahora - 2 * h);
        st.registrarDescargaUpd(ahora - h);
        assertEquals("la de hace 30 h se olvidó al anotar las siguientes", 2, st.getUpdDescargas().length);
        st.registrarDescargaUpd(ahora);
        assertEquals(3, st.getUpdDescargas().length);
        assertFalse("tres en 24 h: tope alcanzado",
                ActualizacionPolitica.dentroDelTopeDiario(st.getUpdDescargas(), ahora, Actualizador.topeDescargasDia(ctx)));
        // sobrevive a limpiarIntentosUpd (el tope es global, no por versión)
        st.limpiarIntentosUpd();
        assertEquals(3, st.getUpdDescargas().length);
    }

    @Test
    public void conElTopeDiarioAlcanzadoUnaOfertaDeOtraVersionNoDescargaNada() throws Exception {
        assertEquals("en producción y sin marcador el tope es 3", 3, Actualizador.topeDescargasDia(ctx));
        GuardianState st = new GuardianState(ctx);
        long ahora = System.currentTimeMillis();
        // tres descargas de versiones cualesquiera en las últimas horas
        st.registrarDescargaUpd(ahora - 3_000_000L);
        st.registrarDescargaUpd(ahora - 2_000_000L);
        st.registrarDescargaUpd(ahora - 1_000_000L);

        int vc = BuildConfig.VERSION_CODE + 1;   // una versión que NUNCA se intentó: el límite por versión no la frena
        assertEquals(0, st.intentosUpd(vc));
        long tsEnviado = ahora - 2_000L;
        long tsOferta = ahora - 60_000L;
        String v = "2.99.0";
        String url = "https://pagos.dmalabomba.com/instalar/tope-diario-prueba.apk";
        String sha = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        String firma = Request.computeHmacSha256Hex(SECRETO, "ACT1|" + v + "|" + vc + "|" + url + "|" + sha + "|" + tsOferta + "|" + tsEnviado);
        JSONObject a = new JSONObject().put("v", v).put("vc", vc).put("url", url).put("sha256", sha).put("ts", tsOferta).put("firma", firma);
        String cuerpo = new JSONObject().put("ok", true).put("eco", tsEnviado).put("actualizacion", a).toString();
        // la oferta es válida de verdad (así se prueba el tope y no un rechazo anterior)
        assertNotNull(ActualizacionPolitica.leer(cuerpo, SECRETO, tsEnviado, ahora, true).oferta);

        Actualizador.alResponderLatido(ctx, st, SECRETO, cuerpo, tsEnviado);
        Thread.sleep(1500);   // si hubiera arrancado el hilo de descarga, ya habría anotado el intento
        assertEquals("no se anotó ninguna descarga nueva", 3, st.getUpdDescargas().length);
        assertEquals("ni intento de la versión", 0, st.intentosUpd(vc));
        assertEquals("fallo", st.getUpdEstado());
        assertEquals("tope_diario", st.getUpdDetalle());
        assertTrue(HeartbeatBody.codigoCorto(st.getUpdDetalle()));
    }

    // ------------------------------------------------------------------ TLS

    private static void verificarProtocolos(Socket s) {
        assertTrue(s instanceof SSLSocket);
        String[] en = ((SSLSocket) s).getEnabledProtocols();
        assertTrue("sin protocolos habilitados", en.length >= 1);
        for (String p : en) {
            assertTrue("protocolo habilitado no permitido: " + p, TlsPolitica.PERMITIDOS.contains(p));
        }
        List<String> l = Arrays.asList(en);
        assertFalse(l.contains("TLSv1"));
        assertFalse(l.contains("TLSv1.1"));
        assertFalse(l.contains("SSLv3"));
    }

    @Test
    public void laFabricaDeSocketsDeLaAppSoloHabilitaTls12y13() throws Exception {
        try (Socket s = new TLSSocketFactory(false).createSocket()) {
            verificarProtocolos(s);
        }
        try (Socket s = new TLSSocketFactory(true).createSocket()) {   // «ignorar SSL» tampoco baja de TLS 1.2
            verificarProtocolos(s);
        }
    }

    // ------------------------------------------------------------------ SmsReceiverService no exportado

    @Test
    public void elServicioDeReenvioNoEstaExportadoYNadieDeFueraLoPuedeArrancar() throws Exception {
        ServiceInfo si = ctx.getPackageManager().getServiceInfo(new ComponentName(ctx, SmsReceiverService.class), 0);
        assertFalse("SmsReceiverService no debe estar exportado", si.exported);
        assertTrue("sigue habilitado", si.enabled);

        ctx.stopService(new Intent(ctx, SmsReceiverService.class));
        long limite = System.currentTimeMillis() + 10_000;
        while (SmsReceiverService.isRunning() && System.currentTimeMillis() < limite) Thread.sleep(200);
        assumeTrue("el servicio no se detuvo; no se puede comprobar el arranque externo", !SmsReceiverService.isRunning());

        // El shell de adb (otro uid) intenta arrancarlo: Android debe negarlo
        String salida = shell("am startservice -n " + PAQUETE + "/" + PAQUETE + ".SmsReceiverService");
        Thread.sleep(2500);
        assertFalse("un arranque desde fuera no debe levantar el servicio (salida: " + salida + ")", SmsReceiverService.isRunning());
    }

    private static String shell(String comando) throws Exception {
        ParcelFileDescriptor fd = inst.getUiAutomation().executeShellCommand(comando);
        ByteArrayOutputStream sal = new ByteArrayOutputStream();
        try (InputStream in = new ParcelFileDescriptor.AutoCloseInputStream(fd)) {
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) > 0) sal.write(buf, 0, n);
        }
        return sal.toString("UTF-8");
    }
}
