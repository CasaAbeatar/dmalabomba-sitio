package tech.bogomolov.incomingsmsgateway;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assume.assumeTrue;

import android.Manifest;
import android.app.Instrumentation;
import android.app.UiAutomation;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.ParcelFileDescriptor;
import android.provider.Settings;
import android.util.Log;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.After;
import org.junit.AfterClass;
import org.junit.Before;
import org.junit.BeforeClass;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;

/**
 * La Bomba 2.11.0: reactivación automática del ACCESO A NOTIFICACIONES (el ancla de supervivencia) con
 * WRITE_SECURE_SETTINGS, con las mismas guardas que la accesibilidad: solo con el permiso, solo si falta, nunca si la
 * persona lo apagó a mano, y una orden explícita del administrador sí lo vuelve a encender. Se declara en
 * permisos_extra («ancla», «ajustes_seguros») y por tanto en «Salud del teléfono».
 *
 * El permiso se concede por adb a mitad de la prueba (como se hace en un teléfono real) y se retira al final.
 */
@RunWith(AndroidJUnit4.class)
public class AnclaInstrumentedTest {

    private static final String PAQUETE = "tech.bogomolov.incomingsmsgateway";
    private static final String LISTENER = PAQUETE + "/" + PAQUETE + ".GuardianListenerService";
    private static final String AJUSTE = "enabled_notification_listeners";

    private static final Instrumentation inst = InstrumentationRegistry.getInstrumentation();
    private static final Context ctx = inst.getTargetContext();

    private static String listenersAntes;
    private static boolean permisoConcedidoPorLaPrueba = false;

    @BeforeClass
    public static void prepararSistema() throws Exception {
        assumeTrue("cmd notification allow_listener / disallow_listener es de Android 10 o mayor", Build.VERSION.SDK_INT >= 29);
        listenersAntes = Settings.Secure.getString(ctx.getContentResolver(), AJUSTE);
    }

    @AfterClass
    public static void restaurarSistema() throws Exception {
        if (Build.VERSION.SDK_INT < 29) return;
        shell("cmd notification disallow_listener " + LISTENER);   // que el ancla de la prueba no quede enlazado en las demás clases
        if (listenersAntes == null || listenersAntes.isEmpty()) {
            shell("settings delete secure " + AJUSTE);
        } else {
            shell("settings put secure " + AJUSTE + " " + listenersAntes);
        }
        if (permisoConcedidoPorLaPrueba) {
            shell("pm revoke " + PAQUETE + " android.permission.WRITE_SECURE_SETTINGS");
        }
    }

    @Before
    public void preparar() {
        for (String f : new String[]{"guardian"}) {
            ctx.getSharedPreferences(f, Context.MODE_PRIVATE).edit().clear().commit();
        }
        Guardian.reiniciarFreno();
    }

    @After
    public void terminar() {
        ctx.getSharedPreferences("guardian", Context.MODE_PRIVATE).edit().clear().commit();
    }

    @Test
    public void sinPermisoNoSePuedeActivarYConPermisoSeActivaSoloRespetandoElApagadoAMano() throws Exception {
        // 1) arranque limpio: sin el servicio en la lista (como lo dejaría quien nunca lo activó)
        shell("cmd notification disallow_listener " + LISTENER);
        assertTrue(esperar(() -> !GuardianListenerService.conectado(), 20_000));
        assertTrue(esperar(() -> !enLista(), 10_000));
        new GuardianState(ctx).marcarApagadoAMano(GuardianState.AJUSTE_ANCLA, false);
        Guardian.reiniciarFreno();

        // sin el permiso no puede, y el latido no dice «ajustes_seguros»
        if (ctx.checkSelfPermission(Manifest.permission.WRITE_SECURE_SETTINGS) != PackageManager.PERMISSION_GRANTED) {
            assertFalse("sin WRITE_SECURE_SETTINGS no puede reactivarlo", Guardian.autoActivarAncla(ctx));
            assertFalse(Guardian.permisosExtraDados(ctx).contains("ajustes_seguros"));
            shell("pm grant " + PAQUETE + " android.permission.WRITE_SECURE_SETTINGS");
            permisoConcedidoPorLaPrueba = true;
        }
        assertEquals(PackageManager.PERMISSION_GRANTED, ctx.checkSelfPermission(Manifest.permission.WRITE_SECURE_SETTINGS));
        assertTrue("con el permiso el latido lo declara", Guardian.permisosExtraDados(ctx).contains("ajustes_seguros"));

        // 2) con el permiso y sin apagado a mano: la app lo escribe en Ajustes sola
        assertTrue("autoActivarAncla devolvió false", Guardian.autoActivarAncla(ctx));
        assertTrue("el servicio no quedó en la lista de Ajustes", enLista());
        conectarOAvisar();
        assertTrue("el latido debe declarar «ancla»", esperar(() -> Guardian.permisosExtraDados(ctx).contains("ancla"), 10_000));
        assertFalse("conectarse borra la bandera de apagado a mano", new GuardianState(ctx).apagadoAMano(GuardianState.AJUSTE_ANCLA));

        // 3) la persona lo apaga a mano en Ajustes (lo mismo que hace el interruptor): la app lo anota y NO lo vuelve a encender
        shell("cmd notification disallow_listener " + LISTENER);
        assertTrue("el acceso no se desconectó", esperar(() -> !GuardianListenerService.conectado(), 30_000));
        assertTrue("debía anotarse el apagado a mano", esperar(() -> new GuardianState(ctx).apagadoAMano(GuardianState.AJUSTE_ANCLA), 10_000));
        Guardian.reiniciarFreno();
        assertFalse("no debe reactivarlo solo tras apagarlo a mano", Guardian.autoActivarAncla(ctx));
        Guardian.tick(ctx, "prueba-ancla");
        Thread.sleep(1500);
        assertFalse("el vigilante lo reactivó pese al apagado a mano", enLista());

        // 4) el administrador lo pide a propósito (botón de «Salud del teléfono»): sí
        assertTrue("la orden explícita no lo activó", Guardian.reactivarAnclaExplicito(ctx));
        assertTrue(enLista());
        assertFalse(new GuardianState(ctx).apagadoAMano(GuardianState.AJUSTE_ANCLA));
        conectarOAvisar();
    }

    @Test
    public void laListaDeAjustesConservaLosOtrosServiciosAlAgregarElNuestro() throws Exception {
        String otro = otroServicioDeAntes();
        assumeTrue("el emulador no tenía otro servicio de acceso a notificaciones", otro != null);
        if (ctx.checkSelfPermission(Manifest.permission.WRITE_SECURE_SETTINGS) != PackageManager.PERMISSION_GRANTED) {
            shell("pm grant " + PAQUETE + " android.permission.WRITE_SECURE_SETTINGS");
            permisoConcedidoPorLaPrueba = true;
        }
        shell("cmd notification disallow_listener " + LISTENER);
        assertTrue(esperar(() -> !enLista(), 10_000));
        Thread.sleep(500);
        new GuardianState(ctx).marcarApagadoAMano(GuardianState.AJUSTE_ANCLA, false);
        Guardian.reiniciarFreno();
        assertTrue(Guardian.autoActivarAncla(ctx));
        String lista = Settings.Secure.getString(ctx.getContentResolver(), AJUSTE);
        assertTrue(lista, lista.contains(otro));
        assertTrue(lista, lista.contains(LISTENER));
    }

    // ------------------------------------------------------------------ ayudas

    private static boolean enLista() {
        String l = Settings.Secure.getString(ctx.getContentResolver(), AJUSTE);
        return l != null && l.contains(LISTENER);
    }

    /** Otro servicio de acceso a notificaciones (real: Android descarta los que no existen) de la lista de antes de las pruebas. */
    private static String otroServicioDeAntes() {
        if (listenersAntes == null) return null;
        for (String e : listenersAntes.split(":")) {
            if (!e.isEmpty() && !e.contains(PAQUETE)) return e;
        }
        return null;
    }

    /**
     * Espera a que Android enlace el servicio después de que la app escribió la lista. Si Android no lo enlaza solo
     * con la escritura (depende de la versión), se anota en el log y se le da el permiso por el mismo camino que usa
     * Ajustes (cmd notification allow_listener) para poder seguir probando el resto de la lógica.
     */
    private static void conectarOAvisar() throws Exception {
        if (esperar(GuardianListenerService::conectado, 25_000)) {
            Log.w("AnclaTest", "Android enlazo el acceso a notificaciones solo con la escritura de Settings.Secure");
            return;
        }
        Log.w("AnclaTest", "LIMITE: Android NO enlazo el acceso a notificaciones solo con escribir Settings.Secure; se usa allow_listener");
        shell("cmd notification allow_listener " + LISTENER);
        assertTrue("Android no conectó el acceso a notificaciones", esperar(GuardianListenerService::conectado, 40_000));
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

    private static String shell(String comando) throws Exception {
        UiAutomation ua = inst.getUiAutomation();
        ParcelFileDescriptor fd = ua.executeShellCommand(comando);
        ByteArrayOutputStream sal = new ByteArrayOutputStream();
        try (InputStream in = new ParcelFileDescriptor.AutoCloseInputStream(fd)) {
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) > 0) sal.write(buf, 0, n);
        }
        return sal.toString("UTF-8");
    }
}
