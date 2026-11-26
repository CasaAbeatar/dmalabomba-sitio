package tech.bogomolov.incomingsmsgateway;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assume.assumeTrue;

import android.Manifest;
import android.app.Instrumentation;
import android.app.UiAutomation;
import android.content.Context;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.os.ParcelFileDescriptor;
import android.provider.Settings;
import android.util.Base64;
import android.util.DisplayMetrics;
import android.view.WindowManager;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.AfterClass;
import org.junit.Before;
import org.junit.BeforeClass;
import org.junit.FixMethodOrder;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.junit.runners.MethodSorters;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * La Bomba 2.10.0: pruebas de la pantalla remota en un Android REAL (emulador de CI, API 33 y 35), sin simular
 * nada del sistema: se activa el servicio de accesibilidad de verdad (por shell, como lo haría el permiso
 * WRITE_SECURE_SETTINGS), se captura la pantalla con takeScreenshot, se toca con dispatchGesture un botón de una
 * Activity de prueba y se recorre el protocolo completo contra un servidor falso 127.0.0.1 que firma (o no) sus
 * respuestas.
 *
 * El orden es por nombre: la prueba de auto-activación (que concede un permiso con adb) va la última.
 */
@RunWith(AndroidJUnit4.class)
@FixMethodOrder(MethodSorters.NAME_ASCENDING)
public class PantallaRemotaInstrumentedTest {

    private static final String SECRETO = "claveprueba";
    private static final String PAQUETE = "tech.bogomolov.incomingsmsgateway";
    private static final String SERVICIO = PAQUETE + "/" + PAQUETE + ".PantallaRemotaService";

    private static final Instrumentation inst = InstrumentationRegistry.getInstrumentation();
    private static final Context ctx = inst.getTargetContext();

    private static boolean permisoConcedidoPorLaPrueba = false;
    private static String serviciosAntes;
    private static String habilitadoAntes;

    private PantallaServidor server;
    private ActivityScenario<PantallaPruebaActivity> escena;

    // ------------------------------------------------------------------ preparación

    @BeforeClass
    public static void prepararSistema() throws Exception {
        assumeTrue("la pantalla remota necesita Android 7 o mayor", Build.VERSION.SDK_INT >= 24);
        serviciosAntes = Settings.Secure.getString(ctx.getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        habilitadoAntes = Settings.Secure.getString(ctx.getContentResolver(), Settings.Secure.ACCESSIBILITY_ENABLED);
        // pantalla encendida y sin bloqueo, para que la captura y los toques lleguen a la Activity de prueba
        shell("svc power stayon true");
        shell("input keyevent KEYCODE_WAKEUP");
        shell("wm dismiss-keyguard");
        activarServicio();
    }

    @AfterClass
    public static void restaurarSistema() throws Exception {
        PantallaRemotaService.escuchaMs = 60_000L;
        PantallaRemotaService.cuadroMs = 800L;
        if (Build.VERSION.SDK_INT < 24) return;
        if (serviciosAntes == null || serviciosAntes.isEmpty()) {
            shell("settings delete secure enabled_accessibility_services");
        } else {
            shell("settings put secure enabled_accessibility_services " + serviciosAntes);
        }
        shell("settings put secure accessibility_enabled " + (habilitadoAntes == null ? "0" : habilitadoAntes));
        shell("svc power stayon false");
        if (permisoConcedidoPorLaPrueba) {
            // que el vigilante del Guardian no vuelva a encender el servicio durante las demás pruebas
            shell("pm revoke " + PAQUETE + " android.permission.WRITE_SECURE_SETTINGS");
        }
    }

    @Before
    public void preparar() throws Exception {
        activarServicio();   // si otra prueba lo suprimió, se vuelve a conectar
        limpiar();
        PantallaPruebaActivity.toques = 0;
        PantallaRemotaService.escuchaMs = 60_000L;
        PantallaRemotaService.cuadroMs = 400L;
        server = new PantallaServidor();
        server.start();
        ForwardingConfig c = new ForwardingConfig(ctx);
        c.setKey("pantalla-test");
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
    }

    @After
    public void terminar() {
        PantallaRemotaService.escuchaMs = 60_000L;
        PantallaRemotaService.cuadroMs = 800L;
        if (escena != null) {
            try {
                escena.close();
            } catch (Throwable ignored) {
            }
            escena = null;
        }
        server.stop();
        limpiar();
        PantallaRemotaService.despertarYa();
    }

    private static void limpiar() {
        for (String f : new String[]{ctx.getString(R.string.key_phones_preference), "heartbeat", "guardian", "failed_messages"}) {
            ctx.getSharedPreferences(f, Context.MODE_PRIVATE).edit().clear().commit();
        }
    }

    // ------------------------------------------------------------------ pruebas

    /** La captura real del sistema devuelve la pantalla de prueba (fondo rojo), no una imagen vacía. */
    @Test
    public void t1_capturaDevuelveLaPantallaReal() throws Exception {
        assumeTrue("takeScreenshot es de Android 11 o mayor", Build.VERSION.SDK_INT >= 30);
        abrirPantallaDePrueba();
        PantallaRemotaService s = servicio();

        Bitmap b = null;
        boolean hayRojo = false;
        for (int intento = 0; intento < 10 && !hayRojo; intento++) {
            if (b != null) b.recycle();
            b = s.capturar(8000);
            if (b != null) hayRojo = hayColor(b, 184, 22, 34, 40);
            if (!hayRojo) Thread.sleep(700);
        }
        assertNotNull("takeScreenshot no devolvió imagen (error " + PantallaCaptura.ultimoError.get() + ")", b);
        assertTrue("la imagen no muestra la pantalla de prueba (fondo rojo)", hayRojo);
        assertTrue(b.getWidth() > 0 && b.getHeight() > 0);

        // reducida y en JPEG, como sale al servidor
        Bitmap chica = PantallaRemotaService.escalar(b);
        assertTrue("más ancha de 540", chica.getWidth() <= PantallaRemotaService.ANCHO_MAX);
        byte[] jpg = PantallaRemotaService.jpeg(chica);
        assertTrue(jpg.length > 1000);
        assertTrue("debe ser un JPEG", (jpg[0] & 0xFF) == 0xFF && (jpg[1] & 0xFF) == 0xD8);
        Bitmap vuelta = BitmapFactory.decodeByteArray(jpg, 0, jpg.length);
        assertNotNull(vuelta);
        assertEquals(chica.getWidth(), vuelta.getWidth());
    }

    /** Un toque real (dispatchGesture) pulsa el botón de la Activity de prueba. */
    @Test
    public void t2_toqueRealPulsaElBoton() throws Exception {
        abrirPantallaDePrueba();
        double[] p = centroDelBoton();
        String r = servicio().ejecutar(accion("{\"id\":1,\"a\":\"toque\",\"x\":" + p[0] + ",\"y\":" + p[1] + "}"));
        assertEquals("ok", r);
        assertTrue("el botón no recibió el toque", esperar(() -> PantallaPruebaActivity.toques == 1, 8000));
    }

    /** «Largo» y «deslizar» también se despachan y terminan bien. */
    @Test
    public void t3_largoYDeslizarSeCompletan() throws Exception {
        abrirPantallaDePrueba();
        double[] p = centroDelBoton();
        assertEquals("ok", servicio().ejecutar(accion("{\"id\":2,\"a\":\"largo\",\"x\":" + p[0] + ",\"y\":" + p[1] + ",\"ms\":600}")));
        assertEquals("ok", servicio().ejecutar(accion("{\"id\":3,\"a\":\"deslizar\",\"x1\":0.5,\"y1\":0.8,\"x2\":0.5,\"y2\":0.3,\"ms\":300}")));
    }

    /** «texto» agrega al campo con foco y «borrar» quita del final. */
    @Test
    public void t4_textoYBorrarEnElCampoConFoco() throws Exception {
        abrirPantallaDePrueba();
        escena.onActivity(a -> a.campo.requestFocus());
        assertTrue(esperar(() -> campoFocoTexto() != null, 5000));
        assertEquals("ok", servicio().ejecutar(accion("{\"id\":4,\"a\":\"texto\",\"t\":\"hola\"}")));
        assertTrue("texto no es hola: " + textoDelCampo(), esperar(() -> "hola".equals(textoDelCampo()), 5000));
        assertEquals("ok", servicio().ejecutar(accion("{\"id\":5,\"a\":\"texto\",\"t\":\" mundo\"}")));
        assertTrue("texto: " + textoDelCampo(), esperar(() -> "hola mundo".equals(textoDelCampo()), 5000));
        assertEquals("ok", servicio().ejecutar(accion("{\"id\":6,\"a\":\"borrar\",\"n\":6}")));
        assertTrue("texto no es hola: " + textoDelCampo(), esperar(() -> "hola".equals(textoDelCampo()), 5000));
    }

    /** «inicio» saca la app del frente y «atrás» cierra la pantalla de prueba. */
    @Test
    public void t5_inicioYAtrasSonAccionesGlobalesReales() throws Exception {
        abrirPantallaDePrueba();
        assertEquals("ok", servicio().ejecutar(accion("{\"id\":7,\"a\":\"inicio\"}")));
        assertTrue("la pantalla de prueba sigue al frente tras «inicio»", esperar(() -> !PantallaPruebaActivity.alFrente, 8000));

        abrirPantallaDePrueba();
        assertEquals("ok", servicio().ejecutar(accion("{\"id\":8,\"a\":\"atras\"}")));
        assertTrue("la pantalla de prueba sigue al frente tras «atrás»", esperar(() -> !PantallaPruebaActivity.alFrente, 8000));
    }

    /**
     * Recorrido completo: escucha firmada → sesión → cuadros con imagen real → acción firmada (que se repite en
     * varias respuestas) → se ejecuta UNA sola vez y se confirma → el servidor cierra la sesión y se detienen los cuadros.
     */
    @Test
    public void t6_recorridoCompletoConServidorFalso() throws Exception {
        abrirPantallaDePrueba();
        double[] p = centroDelBoton();
        PantallaRemotaService.escuchaMs = 500;
        PantallaRemotaService.cuadroMs = 400;

        // 1) mientras nadie pide pantalla, solo escucha (firmada) y no hay cuadros
        PantallaRemotaService.despertarYa();
        assertTrue("el teléfono no escuchó", esperar(() -> server.cuerpos("escucha").size() >= 2, 15000));
        Peticion esc = server.cuerpos("escucha").get(0);
        assertEquals(Request.computeHmacSha256Hex(SECRETO, esc.cuerpo), esc.cabecera("x-signature"));
        JSONObject e = new JSONObject(esc.cuerpo);
        assertEquals("pantalla", e.getString("tipo"));
        assertEquals("soda", e.getString("empresa"));
        assertEquals(BuildConfig.VERSION_NAME, e.getString("app"));
        assertTrue(e.has("pantalla_encendida") && e.has("bloqueada"));
        assertEquals(0, server.cuerpos("cuadro").size());

        // 2) se abre una sesión: llegan cuadros, el primero con imagen
        server.abrirSesion = true;
        assertTrue("no llegaron cuadros", esperar(() -> server.cuerpos("cuadro").size() >= 2, 20000));
        Peticion primero = server.cuerpos("cuadro").get(0);
        assertEquals(Request.computeHmacSha256Hex(SECRETO, primero.cuerpo), primero.cabecera("x-signature"));
        JSONObject c1 = new JSONObject(primero.cuerpo);
        assertEquals("s1", c1.getString("sid"));
        assertEquals(1, c1.getInt("seq"));
        if (Build.VERSION.SDK_INT >= 30) {
            assertFalse("el primer cuadro debe traer imagen: " + c1.optString("error"), c1.getBoolean("sin_cambio"));
            byte[] bytes = Base64.decode(c1.getString("jpg"), Base64.DEFAULT);
            Bitmap bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
            assertNotNull("el jpg del cuadro no se puede abrir", bmp);
            assertTrue(bmp.getWidth() <= PantallaRemotaService.ANCHO_MAX);
            assertEquals(bmp.getWidth(), c1.getInt("w"));
        }
        // la imagen va al final del cuerpo (jpg último), como pide el protocolo
        assertTrue(primero.cuerpo.indexOf("\"jpg\"") < 0 || primero.cuerpo.indexOf("\"jpg\"") > primero.cuerpo.indexOf("\"resultados\""));

        // 3) una acción de toque firmada, repetida en cada respuesta: se ejecuta una sola vez
        server.accionesFijas.add("{\"id\":77,\"a\":\"toque\",\"x\":" + p[0] + ",\"y\":" + p[1] + "}");
        assertTrue("el botón no recibió el toque", esperar(() -> PantallaPruebaActivity.toques >= 1, 15000));
        assertTrue("el teléfono no confirmó la acción", esperar(() -> hayConfirmada(77, "ok"), 15000));
        int cuadrosAntes = server.cuerpos("cuadro").size();
        assertTrue(esperar(() -> server.cuerpos("cuadro").size() >= cuadrosAntes + 3, 20000));
        assertEquals("la misma acción se ejecutó más de una vez", 1, PantallaPruebaActivity.toques);

        // 4) el servidor cierra la sesión: los cuadros se detienen y vuelve a escuchar
        server.abrirSesion = false;
        Thread.sleep(1500);   // lo que ya iba en camino
        int cuadrosFinal = server.cuerpos("cuadro").size();
        int escuchasAntes = server.cuerpos("escucha").size();
        assertTrue("no volvió a escuchar", esperar(() -> server.cuerpos("escucha").size() > escuchasAntes, 15000));
        Thread.sleep(2000);
        assertEquals("siguió mandando cuadros con la sesión cerrada", cuadrosFinal, server.cuerpos("cuadro").size());
    }

    /** Una respuesta sin firma NO ejecuta nada ni abre sesión, aunque traiga acciones y sea bien formada. */
    @Test
    public void t7_respuestaSinFirmaNoEjecutaNada() throws Exception {
        abrirPantallaDePrueba();
        double[] p = centroDelBoton();
        server.firma = PantallaServidor.SIN_FIRMA;
        server.abrirSesion = true;
        server.accionesFijas.add("{\"id\":90,\"a\":\"toque\",\"x\":" + p[0] + ",\"y\":" + p[1] + "}");
        PantallaRemotaService.escuchaMs = 400;
        PantallaRemotaService.despertarYa();
        assertTrue(esperar(() -> server.cuerpos("escucha").size() >= 3, 15000));
        Thread.sleep(1500);
        assertEquals("se ejecutó una acción de una respuesta sin firma", 0, PantallaPruebaActivity.toques);
        assertEquals("abrió sesión con una respuesta sin firma", 0, server.cuerpos("cuadro").size());
    }

    /** Una firma que no corresponde (clave equivocada) tampoco ejecuta nada. */
    @Test
    public void t8_respuestaConFirmaFalsaNoEjecutaNada() throws Exception {
        abrirPantallaDePrueba();
        double[] p = centroDelBoton();
        server.firma = PantallaServidor.FIRMA_FALSA;
        server.abrirSesion = true;
        server.accionesFijas.add("{\"id\":91,\"a\":\"toque\",\"x\":" + p[0] + ",\"y\":" + p[1] + "}");
        PantallaRemotaService.escuchaMs = 400;
        PantallaRemotaService.despertarYa();
        assertTrue(esperar(() -> server.cuerpos("escucha").size() >= 3, 15000));
        Thread.sleep(1500);
        assertEquals("se ejecutó una acción con firma falsa", 0, PantallaPruebaActivity.toques);
        assertEquals("abrió sesión con firma falsa", 0, server.cuerpos("cuadro").size());
    }

    /** Firma válida pero «eco» distinto del ts enviado (respuesta repetida/vieja): tampoco ejecuta nada. */
    @Test
    public void t8b_respuestaConEcoDistintoNoEjecutaNada() throws Exception {
        abrirPantallaDePrueba();
        double[] p = centroDelBoton();
        server.ecoDistinto = true;
        server.abrirSesion = true;
        server.accionesFijas.add("{\"id\":92,\"a\":\"toque\",\"x\":" + p[0] + ",\"y\":" + p[1] + "}");
        PantallaRemotaService.escuchaMs = 400;
        PantallaRemotaService.despertarYa();
        assertTrue(esperar(() -> server.cuerpos("escucha").size() >= 3, 15000));
        Thread.sleep(1500);
        assertEquals("se ejecutó una acción con eco distinto", 0, PantallaPruebaActivity.toques);
        assertEquals("abrió sesión con eco distinto", 0, server.cuerpos("cuadro").size());
    }

    /**
     * Con el permiso WRITE_SECURE_SETTINGS (concedido una vez por adb) la app se activa sola, sin que nadie
     * toque Ajustes. Va la última (nombre t9) porque concede un permiso en pleno proceso.
     */
    @Test
    public void t9_autoActivacionConPermisoDeAjustesSeguros() throws Exception {
        // se desactiva el servicio y se comprueba que la app lo vuelve a activar sola
        shell("settings delete secure enabled_accessibility_services");
        shell("settings put secure accessibility_enabled 0");
        assertTrue("el servicio no se desconectó", esperar(() -> !PantallaRemotaService.conectado(), 20000));
        assertFalse(Guardian.pantallaActiva(ctx));

        // sin el permiso, no puede
        if (ctx.checkSelfPermission(Manifest.permission.WRITE_SECURE_SETTINGS) != PackageManager.PERMISSION_GRANTED) {
            assertFalse(Guardian.autoActivarPantalla(ctx));
            shell("pm grant " + PAQUETE + " android.permission.WRITE_SECURE_SETTINGS");
            permisoConcedidoPorLaPrueba = true;
        }
        assertEquals(PackageManager.PERMISSION_GRANTED, ctx.checkSelfPermission(Manifest.permission.WRITE_SECURE_SETTINGS));

        assertTrue("autoActivarPantalla devolvió false", Guardian.autoActivarPantalla(ctx));
        assertTrue("Android no conectó el servicio", esperar(PantallaRemotaService::conectado, 30000));
        assertTrue(Guardian.pantallaActiva(ctx));
        assertTrue("el latido debe declarar «pantalla»", Guardian.permisosExtraDados(ctx).contains("pantalla"));
    }

    // ------------------------------------------------------------------ ayudas de las pruebas

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

    private static UiAutomation automatizacion() {
        // sin esta bandera Android apaga los servicios de accesibilidad mientras corre una prueba instrumentada
        return inst.getUiAutomation(UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES);
    }

    private static String shell(String comando) throws Exception {
        ParcelFileDescriptor fd = automatizacion().executeShellCommand(comando);
        ByteArrayOutputStream sal = new ByteArrayOutputStream();
        try (InputStream in = new ParcelFileDescriptor.AutoCloseInputStream(fd)) {
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) > 0) sal.write(buf, 0, n);
        }
        return sal.toString("UTF-8");
    }

    /** Activa el servicio como lo hace Ajustes y espera a que Android lo conecte. */
    private static void activarServicio() throws Exception {
        automatizacion();
        if (!PantallaRemotaService.conectado()) {
            String lista = Settings.Secure.getString(ctx.getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
            if (lista == null || !lista.contains(SERVICIO)) {
                String nueva = (lista == null || lista.isEmpty() || "null".equals(lista)) ? SERVICIO : lista + ":" + SERVICIO;
                shell("settings put secure enabled_accessibility_services " + nueva);
            }
            shell("settings put secure accessibility_enabled 1");
        }
        assertTrue("Android no conectó el servicio de pantalla remota", esperar(PantallaRemotaService::conectado, 60000));
    }

    private static PantallaRemotaService servicio() {
        PantallaRemotaService s = PantallaRemotaService.instancia();
        assertNotNull("el servicio no está conectado", s);
        return s;
    }

    private void abrirPantallaDePrueba() throws Exception {
        shell("input keyevent KEYCODE_WAKEUP");
        shell("wm dismiss-keyguard");
        if (escena != null) escena.close();
        PantallaPruebaActivity.alFrente = false;
        escena = ActivityScenario.launch(PantallaPruebaActivity.class);
        assertTrue("la pantalla de prueba no llegó al frente", esperar(() -> PantallaPruebaActivity.alFrente, 15000));
        final boolean[] foco = {false};
        assertTrue("la pantalla de prueba no tiene el foco", esperar(() -> {
            escena.onActivity(a -> foco[0] = a.hasWindowFocus());
            return foco[0];
        }, 15000));
        Thread.sleep(800);   // que termine de dibujar
    }

    private double[] centroDelBoton() {
        final int[] c = new int[2];
        escena.onActivity(a -> {
            int[] loc = new int[2];
            a.boton.getLocationOnScreen(loc);
            c[0] = loc[0] + a.boton.getWidth() / 2;
            c[1] = loc[1] + a.boton.getHeight() / 2;
        });
        DisplayMetrics dm = new DisplayMetrics();
        ((WindowManager) ctx.getSystemService(Context.WINDOW_SERVICE)).getDefaultDisplay().getRealMetrics(dm);
        return new double[]{c[0] / (double) (dm.widthPixels - 1), c[1] / (double) (dm.heightPixels - 1)};
    }

    /** Una acción ya validada por el mismo analizador que usa el teléfono con las respuestas del servidor. */
    private static PantallaProtocolo.Accion accion(String json) {
        PantallaProtocolo.Respuesta r = PantallaProtocolo.parsear(
                "{\"ok\":true,\"sesion\":true,\"sid\":\"t\",\"resta_s\":30,\"acciones\":[" + json + "]}");
        assertEquals("la acción de la prueba no pasó el analizador: " + json, 1, r.acciones.size());
        return r.acciones.get(0);
    }

    private String textoDelCampo() {
        final String[] t = {null};
        escena.onActivity(a -> t[0] = a.campo.getText().toString());
        return t[0];
    }

    private String campoFocoTexto() {
        final boolean[] foco = {false};
        escena.onActivity(a -> foco[0] = a.campo.hasFocus() && a.hasWindowFocus());
        return foco[0] ? "ok" : null;
    }

    /** ¿Hay algún píxel cerca del color dado (muestreo en rejilla)? */
    private static boolean hayColor(Bitmap b, int r, int g, int bl, int tolerancia) {
        int pasoX = Math.max(1, b.getWidth() / 24), pasoY = Math.max(1, b.getHeight() / 40);
        for (int y = 0; y < b.getHeight(); y += pasoY) {
            for (int x = 0; x < b.getWidth(); x += pasoX) {
                int px = b.getPixel(x, y);
                if (Math.abs(((px >> 16) & 0xFF) - r) <= tolerancia && Math.abs(((px >> 8) & 0xFF) - g) <= tolerancia
                        && Math.abs((px & 0xFF) - bl) <= tolerancia) return true;
            }
        }
        return false;
    }

    private boolean hayConfirmada(long id, String resultado) {
        for (Peticion p : server.cuerpos("cuadro")) {
            try {
                JSONObject o = new JSONObject(p.cuerpo);
                JSONArray conf = o.getJSONArray("confirmadas");
                for (int i = 0; i < conf.length(); i++) {
                    if (conf.getLong(i) == id && resultado.equals(o.getJSONObject("resultados").optString(String.valueOf(id)))) return true;
                }
            } catch (Exception ignored) {
            }
        }
        return false;
    }

    // ------------------------------------------------------------------ servidor falso de /pantalla

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

    /** Servidor HTTP mínimo en el propio proceso que habla el protocolo de pantalla (puerto libre en 127.0.0.1). */
    static final class PantallaServidor {
        static final int FIRMA_BUENA = 0, SIN_FIRMA = 1, FIRMA_FALSA = 2;

        int port;
        volatile boolean abrirSesion = false;
        volatile int firma = FIRMA_BUENA;
        /** true: el «eco» de la respuesta no es el ts de la petición (respuesta repetida o vieja). */
        volatile boolean ecoDistinto = false;
        /** Acciones (JSON) que se mandan en CADA respuesta de sesión, para probar que no se repiten al ejecutar. */
        final List<String> accionesFijas = new CopyOnWriteArrayList<>();
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
            }, "PantallaServidor");
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

        /** Peticiones a /pantalla de una fase («escucha», «cuadro», «fin»). */
        List<Peticion> cuerpos(String fase) {
            List<Peticion> l = new ArrayList<>();
            for (Peticion p : recibidas) {
                if (!p.ruta.equals("/pantalla")) continue;
                if (p.cuerpo.contains("\"fase\":\"" + fase + "\"")) l.add(p);
            }
            return l;
        }

        private String respuesta(String cuerpo) {
            long tsPeticion = 0;
            try {
                tsPeticion = new JSONObject(cuerpo).getLong("ts");
            } catch (Exception ignored) {
            }
            // como el servidor real: «eco» = ts de la petición y «ts» = hora del servidor
            String cola = ",\"eco\":" + (ecoDistinto ? tsPeticion + 1 : tsPeticion) + ",\"ts\":" + System.currentTimeMillis();
            boolean fin = cuerpo.contains("\"fase\":\"fin\"");
            if (fin) return "{\"ok\":true" + cola + "}";
            if (!abrirSesion) return "{\"ok\":true,\"sesion\":false" + cola + "}";
            StringBuilder b = new StringBuilder("{\"ok\":true,\"sesion\":true,\"sid\":\"s1\",\"resta_s\":120" + cola + ",\"acciones\":[");
            boolean primero = true;
            for (String a : accionesFijas) {
                if (!primero) b.append(',');
                primero = false;
                b.append(a);
            }
            return b.append("]}").toString();
        }

        private void atender(Socket s) {
            try (Socket sock = s) {
                sock.setSoTimeout(15_000);
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

                String resp = ruta.equals("/pantalla") ? respuesta(texto) : "{\"nuevos\":0}";
                StringBuilder h = new StringBuilder("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n");
                if (ruta.equals("/pantalla") && firma == FIRMA_BUENA) {
                    h.append("X-Signature: ").append(Request.computeHmacSha256Hex(SECRETO, resp)).append("\r\n");
                } else if (ruta.equals("/pantalla") && firma == FIRMA_FALSA) {
                    h.append("X-Signature: ").append(Request.computeHmacSha256Hex("otra-clave", resp)).append("\r\n");
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
