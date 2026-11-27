package tech.bogomolov.incomingsmsgateway;

import android.Manifest;
import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;

import java.lang.reflect.Method;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * La Bomba 2.12.0: depuración inalámbrica a pedido (órdenes abrir_adb / cerrar_adb). Con WRITE_SECURE_SETTINGS (que se
 * concede UNA vez por adb) la app enciende o apaga Settings.Global.adb_wifi_enabled; lo que ELLA enciende se apaga solo a
 * los 30 min. Lo que la persona encendió a mano no se toca (no hay hora de cierre anotada).
 *
 * Auditoría 2.12.0 (reglas en AdbPolitica, con pruebas): otro abrir_adb mientras está abierta NO extiende el plazo; si la
 * app tuvo que encender «opciones de desarrollador» para abrirla, al cerrar (orden o autocierre) también las apaga (anota
 * esa bandera en GuardianState); y el puerto solo se reporta mientras está abierta. abrir_adb exige además la respuesta
 * firmada (ver RemoteCommands.SENSIBLES).
 *
 * Límite honesto de Android: encender la depuración inalámbrica NO empareja ningún computador. La primera vez hay que
 * emparejar (adb pair) con el código de la pantalla de «Depuración inalámbrica»; con la pantalla remota se puede abrir
 * ese menú y leer el código. Desde Android 11; en versiones anteriores la orden se confirma como «comando_no_soportado».
 */
public final class AdbInalambrico {

    static final String TAG = "AdbInalambrico";
    /** La depuración que enciende la app se apaga sola a los 30 min. */
    public static final long AUTOCIERRE_MS = 30L * 60_000L;
    static final String AJUSTE_ADB_WIFI = "adb_wifi_enabled";

    private AdbInalambrico() {
    }

    public static boolean soportado() {
        return Build.VERSION.SDK_INT >= 30;
    }

    public static boolean tienePermiso(Context ctx) {
        return Guardian.tienePermiso(ctx, Manifest.permission.WRITE_SECURE_SETTINGS);
    }

    /** true si la depuración inalámbrica está encendida ahora (se puede leer sin permiso especial). */
    public static boolean activo(Context ctx) {
        try {
            return Settings.Global.getInt(ctx.getContentResolver(), AJUSTE_ADB_WIFI, 0) == 1;
        } catch (Throwable e) {
            return false;
        }
    }

    /** Resultado que tendrá la orden, decidido antes de ejecutarla. */
    public static String resultadoPrevisto(Context ctx, boolean abrir) {
        if (abrir && !soportado()) return "comando_no_soportado";
        if (!tienePermiso(ctx)) return "falta_permiso_ajustes";
        return "ok";
    }

    /** true si «opciones de desarrollador» están encendidas ahora. */
    static boolean desarrolloEncendido(Context ctx) {
        try {
            return Settings.Global.getInt(ctx.getContentResolver(), Settings.Global.DEVELOPMENT_SETTINGS_ENABLED, 0) == 1;
        } catch (Throwable e) {
            return false;
        }
    }

    /**
     * Enciende la depuración inalámbrica y anota la hora de cierre automático. Si ya estaba abierta por la app y no venció,
     * NO se extiende el plazo; si estaba abierta a mano, no se toca. @return true si queda encendida.
     */
    public static boolean abrir(Context ctx, GuardianState st, long ahora) {
        try {
            if (!soportado() || !tienePermiso(ctx)) return false;
            AdbPolitica.Apertura a = AdbPolitica.decidirApertura(activo(ctx), st.getAdbCierraTs(), ahora);
            if (a == AdbPolitica.Apertura.YA_ABIERTA_POR_APP || a == AdbPolitica.Apertura.YA_ABIERTA_A_MANO) {
                Log.i(TAG, "abrir: ya estaba abierta (" + a + "); no se cambia el plazo");
                return true;
            }
            if (a == AdbPolitica.Apertura.CERRAR_VENCIDA_Y_ABRIR) cerrar(ctx, st);   // vencida: plazo nuevo y limpio
            // Desde Android 11 la depuración inalámbrica solo funciona con las opciones de desarrollador encendidas.
            // Si estaban apagadas las enciende la app y lo anota, para apagarlas al cerrar.
            if (AdbPolitica.encenderDesarrollo(desarrolloEncendido(ctx))) {
                st.setAdbDesarrolloPorApp(true);
                Settings.Global.putInt(ctx.getContentResolver(), Settings.Global.DEVELOPMENT_SETTINGS_ENABLED, 1);
            }
            Settings.Global.putInt(ctx.getContentResolver(), AJUSTE_ADB_WIFI, 1);
            st.setAdbCierraTs(ahora + AUTOCIERRE_MS);
            Guardian.scheduleAlarm(ctx, AUTOCIERRE_MS);
            boolean queda = activo(ctx);
            Log.i(TAG, "abrir: depuracion inalambrica activa=" + queda);
            return queda;
        } catch (Throwable e) {
            Log.e(TAG, "abrir: " + e);
            return false;
        }
    }

    /**
     * Apaga la depuración inalámbrica y, si las opciones de desarrollador las encendió la app, también ellas.
     * @return true si la depuración inalámbrica queda apagada.
     */
    public static boolean cerrar(Context ctx, GuardianState st) {
        try {
            if (!soportado() || !tienePermiso(ctx)) return false;
            Settings.Global.putInt(ctx.getContentResolver(), AJUSTE_ADB_WIFI, 0);
            st.setAdbCierraTs(0);
            if (AdbPolitica.apagarDesarrolloAlCerrar(st.getAdbDesarrolloPorApp())) {
                Settings.Global.putInt(ctx.getContentResolver(), Settings.Global.DEVELOPMENT_SETTINGS_ENABLED, 0);
                st.setAdbDesarrolloPorApp(false);
                Log.i(TAG, "cerrar: se apagaron tambien las opciones de desarrollador que habia encendido la app");
            }
            return !activo(ctx);
        } catch (Throwable e) {
            Log.e(TAG, "cerrar: " + e);
            return false;
        }
    }

    /** Si la app la encendió y ya pasaron los 30 min, la apaga. Lo llaman el vigilante y cada latido. */
    public static void revisarVencimiento(Context ctx, GuardianState st, long ahora) {
        try {
            long cierra = st.getAdbCierraTs();
            if (cierra <= 0 || ahora < cierra) return;
            Log.i(TAG, "autocierre de la depuracion inalambrica");
            cerrar(ctx, st);
            st.setAdbCierraTs(0);   // aunque no hubiera permiso: no reintentar eternamente
        } catch (Throwable ignored) {
        }
    }

    /**
     * Puerto de la depuración inalámbrica (el de «conectar»); 0 si no se pudo leer. Primero la propiedad del sistema;
     * si Android no la deja leer, se pregunta por mDNS (_adb-tls-connect._tcp), que es como lo hace el propio adb. Se
     * llama desde un hilo de fondo; espera como mucho ~4 s. Solo mientras está abierta (y, si la abrió la app, dentro de su plazo).
     */
    public static int puerto(Context ctx, GuardianState st, long ahora) {
        if (!AdbPolitica.puertoReportable(activo(ctx), st.getAdbCierraTs(), ahora)) return 0;
        int p = puertoPropiedad();
        if (p > 0) return p;
        return puertoMdns(ctx);
    }

    static int puertoPropiedad() {
        try {
            Class<?> c = Class.forName("android.os.SystemProperties");
            Method m = c.getMethod("get", String.class, String.class);
            String v = (String) m.invoke(null, "service.adb.tls.port", "");
            if (v != null && v.matches("^\\d{1,5}$")) {
                int n = Integer.parseInt(v);
                return n > 0 && n <= 65535 ? n : 0;
            }
        } catch (Throwable ignored) {
            // Android no deja leerla: se usa mDNS
        }
        return 0;
    }

    static int puertoMdns(Context ctx) {
        if (Build.VERSION.SDK_INT < 21) return 0;
        final AtomicInteger puerto = new AtomicInteger(0);
        final CountDownLatch listo = new CountDownLatch(1);
        final NsdManager nsd = (NsdManager) ctx.getApplicationContext().getSystemService(Context.NSD_SERVICE);
        if (nsd == null) return 0;
        final NsdManager.DiscoveryListener[] dl = new NsdManager.DiscoveryListener[1];
        dl[0] = new NsdManager.DiscoveryListener() {
            @Override public void onStartDiscoveryFailed(String t, int e) { listo.countDown(); }
            @Override public void onStopDiscoveryFailed(String t, int e) { }
            @Override public void onDiscoveryStarted(String t) { }
            @Override public void onDiscoveryStopped(String t) { }
            @Override public void onServiceLost(NsdServiceInfo s) { }

            @Override
            public void onServiceFound(NsdServiceInfo s) {
                try {
                    nsd.resolveService(s, new NsdManager.ResolveListener() {
                        @Override public void onResolveFailed(NsdServiceInfo i, int e) { }

                        @Override
                        public void onServiceResolved(NsdServiceInfo i) {
                            int pt = i.getPort();
                            if (pt > 0 && pt <= 65535) {
                                puerto.set(pt);
                                listo.countDown();
                            }
                        }
                    });
                } catch (Throwable ignored) {
                }
            }
        };
        try {
            nsd.discoverServices("_adb-tls-connect._tcp", NsdManager.PROTOCOL_DNS_SD, dl[0]);
            listo.await(4, TimeUnit.SECONDS);
        } catch (Throwable e) {
            Log.w(TAG, "mdns: " + e);
        } finally {
            try {
                nsd.stopServiceDiscovery(dl[0]);
            } catch (Throwable ignored) {
            }
        }
        return puerto.get();
    }
}
