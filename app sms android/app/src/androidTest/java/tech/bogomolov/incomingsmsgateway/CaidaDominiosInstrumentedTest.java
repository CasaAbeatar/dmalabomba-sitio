package tech.bogomolov.incomingsmsgateway;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.app.Instrumentation;
import android.content.Context;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * 27 nov 2026 (caída de los dominios), en Android de verdad: la oferta guardada sobrevive en la memoria privada de la app,
 * un intento sin red no gasta el tope diario, y Request prueba el camino alterno solo cuando el principal no conecta.
 */
@RunWith(AndroidJUnit4.class)
public class CaidaDominiosInstrumentedTest {

    private static final Instrumentation inst = InstrumentationRegistry.getInstrumentation();
    private static final Context ctx = inst.getTargetContext();
    private static final String SHA = "2163fad5b0c1f2d9a1b0c9d8e7f60514233445566778899aabbccddeeff0f8e1";

    private ServerSocket servidor;
    private volatile boolean corriendo;
    private final CopyOnWriteArrayList<String> peticiones = new CopyOnWriteArrayList<>();

    @Before
    public void preparar() throws Exception {
        ctx.getSharedPreferences("guardian", Context.MODE_PRIVATE).edit().clear().commit();
        servidor = new ServerSocket(0, 5, InetAddress.getByName("127.0.0.1"));
        corriendo = true;
        Thread t = new Thread(() -> {
            while (corriendo) {
                try (Socket s = servidor.accept()) {
                    s.setSoTimeout(3000);
                    InputStream in = s.getInputStream();
                    StringBuilder cab = new StringBuilder();
                    int c;
                    while ((c = in.read()) >= 0) {
                        cab.append((char) c);
                        if (cab.length() >= 4 && cab.substring(cab.length() - 4).equals("\r\n\r\n")) break;
                    }
                    String texto = cab.toString();
                    int len = 0;
                    for (String l : texto.split("\r\n")) if (l.toLowerCase().startsWith("content-length:")) len = Integer.parseInt(l.substring(15).trim());
                    byte[] cuerpo = new byte[len];
                    int leido = 0;
                    while (leido < len) {
                        int n = in.read(cuerpo, leido, len - leido);
                        if (n < 0) break;
                        leido += n;
                    }
                    peticiones.add(texto.split("\r\n")[0] + " | " + new String(cuerpo, 0, leido, StandardCharsets.UTF_8));
                    byte[] r = "{\"ok\":true}".getBytes(StandardCharsets.UTF_8);
                    OutputStream out = s.getOutputStream();
                    out.write(("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: " + r.length + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.UTF_8));
                    out.write(r);
                    out.flush();
                } catch (Exception ignored) {
                    // cerrado al terminar
                }
            }
        }, "servidor-prueba");
        t.setDaemon(true);
        t.start();
    }

    @After
    public void terminar() throws Exception {
        corriendo = false;
        servidor.close();
        RutasAlternas.paraPrueba = null;
        ctx.getSharedPreferences("guardian", Context.MODE_PRIVATE).edit().clear().commit();
    }

    private static int puertoCerrado() throws Exception {
        try (ServerSocket s = new ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))) {
            return s.getLocalPort();
        }
    }

    @Test
    public void laOfertaGuardadaSobreviveYSeLimpia() {
        GuardianState st = new GuardianState(ctx);
        assertNull(st.getOfertaUpd(false));
        String url = "https://sinpe-pagos.pages.dev/instalar/reenviador-sms-la-bomba-2.12.0.apk";
        long ts = System.currentTimeMillis();
        ActualizacionPolitica.Oferta o = ActualizacionPolitica.ofertaDeJson(
                "{\"v\":\"2.12.0\",\"vc\":22,\"url\":\"" + url + "\",\"sha256\":\"" + SHA + "\",\"ts\":" + ts + "}", false);
        assertNotNull(o);
        st.guardarOfertaUpd(o);
        ActualizacionPolitica.Oferta leida = new GuardianState(ctx).getOfertaUpd(false);   // otra instancia: viene del disco
        assertNotNull(leida);
        assertEquals(22, leida.vc);
        assertEquals(url, leida.url);
        assertEquals(SHA, leida.sha256);
        st.limpiarOfertaUpd();
        assertNull(new GuardianState(ctx).getOfertaUpd(false));
    }

    @Test
    public void unaOfertaGuardadaAlteradaEnLaMemoriaNoSeUsa() {
        ctx.getSharedPreferences("guardian", Context.MODE_PRIVATE).edit()
                .putString("upd_oferta_cache", "{\"v\":\"2.12.0\",\"vc\":22,\"url\":\"https://evil.example.com/instalar/a.apk\",\"sha256\":\"" + SHA + "\",\"ts\":1}")
                .commit();
        assertNull(new GuardianState(ctx).getOfertaUpd(false));
    }

    @Test
    public void unIntentoSinRedNoGastaElTopeDiarioNiLosIntentos() {
        GuardianState st = new GuardianState(ctx);
        long ahora = System.currentTimeMillis();
        st.contarIntentoUpd(22, ahora);
        st.registrarDescargaUpd(ahora);
        assertEquals(1, st.getUpdDescargas().length);
        assertEquals(1, st.intentosUpd(22));
        // lo que hace Actualizador.ejecutar cuando ningun camino conecta
        st.devolverIntentoUpd(22);
        st.quitarUltimaDescargaUpd();
        assertEquals(0, st.getUpdDescargas().length);
        assertEquals(0, st.intentosUpd(22));
        // con varias, solo se quita la ultima
        st.registrarDescargaUpd(ahora - 2000);
        st.registrarDescargaUpd(ahora - 1000);
        st.quitarUltimaDescargaUpd();
        assertEquals(1, st.getUpdDescargas().length);
        assertEquals(ahora - 2000, st.getUpdDescargas()[0]);
        // y ahora se espera 15 min antes de otro intento
        st.setUpdEstado("fallo", "sin_red", "2.12.0", ahora);
        assertTrue(ActualizacionPolitica.esperandoPorSinRed(st.getUpdEstado(), st.getUpdDetalle(), st.getUpdEstadoTs(), ahora + 60_000L));
        assertFalse(ActualizacionPolitica.esperandoPorSinRed(st.getUpdEstado(), st.getUpdDetalle(), st.getUpdEstadoTs(), ahora + 16 * 60_000L));
    }

    @Test
    public void elPrincipalCaidoPasaAlAlternoEnAndroidDeVerdad() throws Exception {
        final String muerto = "http://127.0.0.1:" + puertoCerrado() + "/latido";
        final String vivo = "http://127.0.0.1:" + servidor.getLocalPort() + "/latido";
        RutasAlternas.paraPrueba = url -> new ArrayList<>(Arrays.asList(muerto, vivo));
        Request r = new Request(muerto, "{\"tipo\":\"latido\"}");
        r.setUseChunkedMode(false);   // el servidor de prueba lee Content-Length (el latido real tambien va asi)
        r.setSignatureHeader("clave", "{\"tipo\":\"latido\"}");
        assertEquals(Request.RESULT_SUCCESS, r.execute());
        assertEquals(vivo, r.getUrlUsada());
        assertEquals("{\"ok\":true}", r.getResponseBody());
        assertEquals(1, peticiones.size());
        assertTrue(peticiones.get(0), peticiones.get(0).startsWith("POST /latido"));
        assertTrue(peticiones.get(0), peticiones.get(0).endsWith("{\"tipo\":\"latido\"}"));
    }
}
