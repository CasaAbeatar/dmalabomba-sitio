package tech.bogomolov.incomingsmsgateway;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assume.assumeTrue;

import android.Manifest;
import android.app.Instrumentation;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.ParcelFileDescriptor;
import android.provider.Settings;

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
 * La Bomba 2.12.0 (auditoría): la depuración inalámbrica a pedido con el sistema de verdad (Settings.Global).
 *  - al cerrar (orden o autocierre) se apagan también las «opciones de desarrollador» SI las encendió la app;
 *  - si ya estaban encendidas, quedan como estaban;
 *  - otro abrir mientras está abierta no extiende el plazo.
 * El permiso WRITE_SECURE_SETTINGS se concede por adb (como en un teléfono real) y se retira al final.
 */
@RunWith(AndroidJUnit4.class)
public class AdbInalambricoInstrumentedTest {

    private static final String PAQUETE = "tech.bogomolov.incomingsmsgateway";
    private static final Instrumentation inst = InstrumentationRegistry.getInstrumentation();
    private static final Context ctx = inst.getTargetContext();

    private static boolean permisoConcedidoPorLaPrueba = false;
    private static int desarrolloAntes;
    private static int adbWifiAntes;

    @BeforeClass
    public static void prepararSistema() throws Exception {
        assumeTrue("la depuración inalámbrica es de Android 11 o mayor", Build.VERSION.SDK_INT >= 30);
        desarrolloAntes = Settings.Global.getInt(ctx.getContentResolver(), Settings.Global.DEVELOPMENT_SETTINGS_ENABLED, 0);
        adbWifiAntes = Settings.Global.getInt(ctx.getContentResolver(), "adb_wifi_enabled", 0);
        if (ctx.checkSelfPermission(Manifest.permission.WRITE_SECURE_SETTINGS) != PackageManager.PERMISSION_GRANTED) {
            shell("pm grant " + PAQUETE + " android.permission.WRITE_SECURE_SETTINGS");
            permisoConcedidoPorLaPrueba = true;
        }
        assertEquals(PackageManager.PERMISSION_GRANTED, ctx.checkSelfPermission(Manifest.permission.WRITE_SECURE_SETTINGS));
    }

    @AfterClass
    public static void restaurarSistema() throws Exception {
        if (Build.VERSION.SDK_INT < 30) return;
        try {
            Settings.Global.putInt(ctx.getContentResolver(), "adb_wifi_enabled", adbWifiAntes);
            Settings.Global.putInt(ctx.getContentResolver(), Settings.Global.DEVELOPMENT_SETTINGS_ENABLED, desarrolloAntes);
        } catch (Throwable ignored) {
        }
        if (permisoConcedidoPorLaPrueba) shell("pm revoke " + PAQUETE + " android.permission.WRITE_SECURE_SETTINGS");
    }

    @Before
    public void preparar() {
        ctx.getSharedPreferences("guardian", Context.MODE_PRIVATE).edit().clear().commit();
        poner("adb_wifi_enabled", 0);
    }

    @After
    public void terminar() {
        ctx.getSharedPreferences("guardian", Context.MODE_PRIVATE).edit().clear().commit();
    }

    private static void poner(String ajuste, int v) {
        Settings.Global.putInt(ctx.getContentResolver(), ajuste, v);
    }

    private static int leer(String ajuste) {
        return Settings.Global.getInt(ctx.getContentResolver(), ajuste, 0);
    }

    @Test
    public void siLaAppEncendioLasOpcionesDeDesarrolloAlCerrarLasApagaTambien() {
        GuardianState st = new GuardianState(ctx);
        poner(Settings.Global.DEVELOPMENT_SETTINGS_ENABLED, 0);
        long ahora = System.currentTimeMillis();
        AdbInalambrico.abrir(ctx, st, ahora);
        assertEquals("la app enciende las opciones de desarrollador", 1, leer(Settings.Global.DEVELOPMENT_SETTINGS_ENABLED));
        assertTrue("y lo anota", st.getAdbDesarrolloPorApp());
        assertEquals("anota la hora de cierre automático", ahora + AdbInalambrico.AUTOCIERRE_MS, st.getAdbCierraTs());

        assertTrue("cerrar (orden) deja la depuración inalámbrica apagada", AdbInalambrico.cerrar(ctx, st));
        assertEquals(0, leer("adb_wifi_enabled"));
        assertEquals("y apaga también las opciones de desarrollador", 0, leer(Settings.Global.DEVELOPMENT_SETTINGS_ENABLED));
        assertFalse(st.getAdbDesarrolloPorApp());
        assertEquals(0, st.getAdbCierraTs());
    }

    @Test
    public void elAutocierreTambienApagaLasOpcionesDeDesarrollo() {
        GuardianState st = new GuardianState(ctx);
        poner(Settings.Global.DEVELOPMENT_SETTINGS_ENABLED, 0);
        long ahora = System.currentTimeMillis();
        AdbInalambrico.abrir(ctx, st, ahora);
        assertEquals(1, leer(Settings.Global.DEVELOPMENT_SETTINGS_ENABLED));
        // antes del plazo no pasa nada
        AdbInalambrico.revisarVencimiento(ctx, st, ahora + AdbInalambrico.AUTOCIERRE_MS - 1);
        assertEquals(1, leer(Settings.Global.DEVELOPMENT_SETTINGS_ENABLED));
        // pasado el plazo se cierra todo
        AdbInalambrico.revisarVencimiento(ctx, st, ahora + AdbInalambrico.AUTOCIERRE_MS);
        assertEquals(0, leer("adb_wifi_enabled"));
        assertEquals(0, leer(Settings.Global.DEVELOPMENT_SETTINGS_ENABLED));
        assertFalse(st.getAdbDesarrolloPorApp());
        assertEquals(0, st.getAdbCierraTs());
    }

    @Test
    public void siLasOpcionesDeDesarrolloYaEstabanEncendidasQuedanEncendidas() {
        GuardianState st = new GuardianState(ctx);
        poner(Settings.Global.DEVELOPMENT_SETTINGS_ENABLED, 1);
        AdbInalambrico.abrir(ctx, st, System.currentTimeMillis());
        assertFalse("no las encendió la app: no lo anota", st.getAdbDesarrolloPorApp());
        AdbInalambrico.cerrar(ctx, st);
        assertEquals(0, leer("adb_wifi_enabled"));
        assertEquals("quedan como estaban", 1, leer(Settings.Global.DEVELOPMENT_SETTINGS_ENABLED));
    }

    @Test
    public void otroAbrirMientrasEstaAbiertaNoExtiendeElPlazo() {
        GuardianState st = new GuardianState(ctx);
        poner(Settings.Global.DEVELOPMENT_SETTINGS_ENABLED, 1);
        long t0 = System.currentTimeMillis();
        AdbInalambrico.abrir(ctx, st, t0);
        long cierre = st.getAdbCierraTs();
        assertEquals(t0 + AdbInalambrico.AUTOCIERRE_MS, cierre);
        // Android 14+ puede apagarla sola al instante si no hay una red conocida: sin ella no hay nada que comprobar aquí
        // (la decisión está probada a fondo en AdbPoliticaTest).
        assumeTrue(AdbInalambrico.activo(ctx));
        AdbInalambrico.abrir(ctx, st, t0 + 20 * 60_000L);   // «20 minutos después» llega otro abrir_adb
        assertEquals("el plazo sigue siendo el de la primera apertura", cierre, st.getAdbCierraTs());
    }

    @Test
    public void abiertaAManoNoSeLePoneCierreAutomatico() {
        GuardianState st = new GuardianState(ctx);
        poner(Settings.Global.DEVELOPMENT_SETTINGS_ENABLED, 1);
        poner("adb_wifi_enabled", 1);
        assumeTrue(AdbInalambrico.activo(ctx));
        assertTrue(AdbInalambrico.abrir(ctx, st, System.currentTimeMillis()));
        assertEquals("lo abierto a mano no se toca: sin hora de cierre", 0, st.getAdbCierraTs());
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
