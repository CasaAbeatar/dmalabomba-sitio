package tech.bogomolov.incomingsmsgateway;

import android.Manifest;
import android.app.ActivityManager;
import android.app.AlarmManager;
import android.app.PendingIntent;
import android.app.admin.DevicePolicyManager;
import android.app.usage.UsageStatsManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkInfo;
import android.os.BatteryManager;
import android.os.Build;
import android.os.PowerManager;
import android.os.SystemClock;
import android.provider.Settings;
import android.telephony.TelephonyManager;
import android.util.Log;

import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/**
 * La Bomba 2.7.0 («Guardián»): punto central. Arma y manda el latido enriquecido (firmado), ejecuta las
 * órdenes remotas de la lista cerrada y mantiene vivos al servicio y a sus vigilantes (WorkManager y alarma).
 * La lógica de decisión está en clases puras (Watchdog, RemoteCommands, HeartbeatBody) con pruebas JVM; esta
 * clase es el pegamento con Android.
 */
public final class Guardian {

    static final String TAG = "SmsGateway";
    static final String WORK_NAME = "guardian-vigilante";

    private static final Object LOCK = new Object();

    private Guardian() {
    }

    // ------------------------------------------------------------------ latido

    /** Latido con los ajustes guardados. @return resultado de Request, "omitido", "heartbeat off" o "no signing rule". */
    public static String sendHeartbeat(Context ctx, boolean forzar) {
        HeartbeatSettings hs = HeartbeatSettings.load(ctx);
        if (!hs.isEnabled() || hs.getUrl().isEmpty()) return "heartbeat off";
        return sendHeartbeat(ctx, hs.getUrl(), forzar, 0);
    }

    /**
     * Arma el cuerpo, lo firma con la clave de la regla (X-Signature sobre el texto exacto enviado), lo manda,
     * y si la respuesta es de confianza ejecuta las órdenes nuevas. Se puede llamar desde cualquier hilo de fondo.
     */
    public static String sendHeartbeat(Context ctx, String url, boolean forzar, int profundidad) {
        final Context app = ctx.getApplicationContext();
        synchronized (LOCK) {
            try {
                GuardianState st = new GuardianState(app);
                long ahora = System.currentTimeMillis();
                Map<Long, String> acks = st.getAcksPendientes();
                // Con ordenes por confirmar el latido sale aunque sea reciente (se confirma una sola vez y se limpia).
                if (!Watchdog.pasaDedupe(ahora, st.getUltimoLatidoIntento(), forzar || !acks.isEmpty())) {
                    return "omitido";
                }
                SigningRule rule = SigningRule.find(app);
                if (rule == null) {
                    Log.e(TAG, "heartbeat: no signing rule, not sent");
                    return "no signing rule";
                }
                HeartbeatBody.Detalle d = snapshot(app);
                d.comandosHechos = new long[acks.size()];
                int i = 0;
                for (Long id : acks.keySet()) d.comandosHechos[i++] = id;
                d.comandosResultado = new LinkedHashMap<>(acks);

                String tel = (Build.MANUFACTURER + " " + Build.MODEL).replace("\\", "").replace("\"", "");
                String body = HeartbeatBody.build(ahora, rule.empresa, tel, DeviceInfo.getBatteryPercentage(app), d);

                Request request = new Request(url, body);
                request.setUseChunkedMode(false);
                request.setSignatureHeader(rule.secret, body);
                st.marcarLatidoIntento(ahora);
                String res = request.execute();
                Log.i(TAG, "heartbeat(" + (forzar ? "forzado" : "normal") + "): " + res);

                if (Request.RESULT_SUCCESS.equals(res)) {
                    st.marcarLatidoOk(System.currentTimeMillis());
                    if (!acks.isEmpty()) st.quitarAcks(new ArrayList<>(acks.keySet()));
                    if (RemoteCommands.respuestaConfiable(url, request.getResponseCode(),
                            request.getResponseBody(), request.getResponseSignature(), rule.secret)) {
                        procesarOrdenes(app, st, url, request.getResponseBody(), profundidad);
                    }
                }
                return res;
            } catch (Exception e) {
                Log.e(TAG, "heartbeat error: " + e);
                return Request.RESULT_ERROR;
            }
        }
    }

    /** Estado del teléfono para "detalle" (sin las órdenes pendientes de confirmar). */
    public static HeartbeatBody.Detalle snapshot(Context ctx) {
        GuardianState st = new GuardianState(ctx);
        HeartbeatBody.Detalle d = new HeartbeatBody.Detalle();
        d.app = BuildConfig.VERSION_NAME;
        d.cargando = estaCargando(ctx);
        d.ahorroBateria = ahorroBateriaActivo(ctx);
        d.sinRestriccionBateria = sinRestriccionBateria(ctx);
        boolean[] red = red(ctx);   // {validada, wifi, datos}
        d.redValidada = red[0];
        d.tipoRed = HeartbeatBody.tipoRed(red[1], red[2]);
        d.ultimoSmsTs = st.getUltimoSms();
        d.ultimoReenvioOkTs = st.getUltimoReenvioOk();
        d.fallidosPendientes = FailedMessage.getCount(ctx);
        d.permisoSms = tienePermiso(ctx, Manifest.permission.RECEIVE_SMS);
        d.notificaciones = notificacionesPermitidas(ctx);
        d.android = Build.VERSION.SDK_INT;
        d.marcaModelo = (Build.MANUFACTURER + " " + Build.MODEL).replace("\\", "").replace("\"", "");
        // 2.8.0: mediciones del teléfono. Cada una es independiente y nunca rompe el latido.
        d.senalNivel = senalDbm(ctx);
        d.operador = operador(ctx);
        d.simEstado = simEstado(ctx);
        d.modoAvion = modoAvion(ctx);
        d.memoriaLibreMb = memoriaLibreMb(ctx);
        d.arranqueTs = System.currentTimeMillis() - SystemClock.elapsedRealtime();
        d.bucketStandby = bucketStandby(ctx);
        d.doze = enDoze(ctx);
        d.latidoRetrasoMs = st.getLatidoRetrasoMs();
        d.reiniciosServicio = st.getReiniciosServicio();
        // 2.9.0: Wi-Fi y permisos extra. Cada medición es independiente y nunca rompe el latido.
        medirWifi(ctx, d);
        d.permisosExtra = permisosExtraDados(ctx);
        return d;
    }

    // ------------------------------------------------------------------ 2.9.0: Wi-Fi y permisos extra

    @SuppressWarnings("deprecation")
    public static void medirWifi(Context ctx, HeartbeatBody.Detalle d) {
        try {
            android.net.wifi.WifiManager wm = (android.net.wifi.WifiManager)
                    ctx.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wm == null) return;
            d.wifiEncendido = wm.isWifiEnabled();
            android.net.wifi.WifiInfo wi = wm.getConnectionInfo();
            if (wi == null || wi.getNetworkId() == -1 && wi.getRssi() <= -127) return;
            int rssi = wi.getRssi();
            d.wifiRssi = rssi > -127 && rssi < 0 ? rssi : 0;
            d.wifiMbps = wi.getLinkSpeed();
            if (Build.VERSION.SDK_INT >= 21) d.wifiMhz = wi.getFrequency();
            String ssid = wi.getSSID();
            if (ssid != null && !ssid.contains("unknown ssid")) {
                d.wifiNombre = ssid.replace("\"", "").replaceAll("[^\\p{L}\\p{N} ._-]", "");
            }
        } catch (Throwable e) {
            // sin dato
        }
    }

    /** true si Android dejó dar el permiso especial de «uso de aplicaciones» a esta app. */
    public static boolean usoDeAppsDado(Context ctx) {
        try {
            android.app.AppOpsManager ops = (android.app.AppOpsManager) ctx.getSystemService(Context.APP_OPS_SERVICE);
            if (ops == null) return false;
            int modo = ops.checkOpNoThrow(android.app.AppOpsManager.OPSTR_GET_USAGE_STATS,
                    android.os.Process.myUid(), ctx.getPackageName());
            return modo == android.app.AppOpsManager.MODE_ALLOWED;
        } catch (Throwable e) {
            return false;
        }
    }

    public static boolean superposicionDada(Context ctx) {
        try {
            return Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(ctx);
        } catch (Throwable e) {
            return false;
        }
    }

    public static boolean ajustesSistemaDados(Context ctx) {
        try {
            return Build.VERSION.SDK_INT < 23 || Settings.System.canWrite(ctx);
        } catch (Throwable e) {
            return false;
        }
    }

    /** true si el acceso a notificaciones (ancla de supervivencia) está dado a esta app. */
    public static boolean anclaActiva(Context ctx) {
        try {
            return NotificationManagerCompat.getEnabledListenerPackages(ctx).contains(ctx.getPackageName());
        } catch (Throwable e) {
            return false;
        }
    }

    public static boolean noMolestarDado(Context ctx) {
        try {
            if (Build.VERSION.SDK_INT < 23) return true;
            android.app.NotificationManager nm = (android.app.NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            return nm != null && nm.isNotificationPolicyAccessGranted();
        } catch (Throwable e) {
            return false;
        }
    }

    /** Lista corta (para el latido) de cuáles permisos extra están dados. */
    public static String permisosExtraDados(Context ctx) {
        StringBuilder b = new StringBuilder();
        if (tienePermiso(ctx, Manifest.permission.ACCESS_FINE_LOCATION)) b.append("ubicacion,");
        if (Build.VERSION.SDK_INT >= 29 && tienePermiso(ctx, Manifest.permission.ACCESS_BACKGROUND_LOCATION)) b.append("ubicacion_siempre,");
        if (tienePermiso(ctx, Manifest.permission.READ_PHONE_STATE)) b.append("telefono,");
        if (usoDeAppsDado(ctx)) b.append("uso,");
        if (superposicionDada(ctx)) b.append("superposicion,");
        if (ajustesSistemaDados(ctx)) b.append("ajustes,");
        if (noMolestarDado(ctx)) b.append("no_molestar,");
        if (anclaActiva(ctx)) b.append("ancla,");
        if (b.length() > 0) b.setLength(b.length() - 1);
        return b.toString();
    }

    // ------------------------------------------------------------------ 2.8.0: mediciones (sin permisos nuevos)

    /** dBm de la red activa si Android lo entrega sin permisos especiales (API 29+); 0 si no. */
    public static int senalDbm(Context ctx) {
        try {
            if (Build.VERSION.SDK_INT < 29) return 0;
            ConnectivityManager cm = (ConnectivityManager) ctx.getSystemService(Context.CONNECTIVITY_SERVICE);
            Network n = cm == null ? null : cm.getActiveNetwork();
            NetworkCapabilities caps = n == null ? null : cm.getNetworkCapabilities(n);
            if (caps == null) return 0;
            int v = caps.getSignalStrength();
            return v == NetworkCapabilities.SIGNAL_STRENGTH_UNSPECIFIED ? 0 : v;
        } catch (Throwable e) {
            return 0;
        }
    }

    public static String operador(Context ctx) {
        try {
            TelephonyManager tm = (TelephonyManager) ctx.getSystemService(Context.TELEPHONY_SERVICE);
            String o = tm == null ? "" : tm.getNetworkOperatorName();
            return o == null ? "" : o.replaceAll("[^\\p{L}\\p{N} .-]", "");
        } catch (Throwable e) {
            return "";
        }
    }

    public static String simEstado(Context ctx) {
        try {
            TelephonyManager tm = (TelephonyManager) ctx.getSystemService(Context.TELEPHONY_SERVICE);
            if (tm == null) return "desconocido";
            switch (tm.getSimState()) {
                case TelephonyManager.SIM_STATE_READY: return "listo";
                case TelephonyManager.SIM_STATE_ABSENT: return "ausente";
                case TelephonyManager.SIM_STATE_PIN_REQUIRED:
                case TelephonyManager.SIM_STATE_PUK_REQUIRED:
                case TelephonyManager.SIM_STATE_NETWORK_LOCKED: return "bloqueado";
                default: return "desconocido";
            }
        } catch (Throwable e) {
            return "desconocido";
        }
    }

    public static boolean modoAvion(Context ctx) {
        try {
            return Settings.Global.getInt(ctx.getContentResolver(), Settings.Global.AIRPLANE_MODE_ON, 0) != 0;
        } catch (Throwable e) {
            return false;
        }
    }

    public static int memoriaLibreMb(Context ctx) {
        try {
            ActivityManager am = (ActivityManager) ctx.getSystemService(Context.ACTIVITY_SERVICE);
            if (am == null) return -1;
            ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
            am.getMemoryInfo(mi);
            return (int) (mi.availMem / (1024 * 1024));
        } catch (Throwable e) {
            return -1;
        }
    }

    /** Cubeta de espera de Android para esta app (API 28+): 10 activa, 20 en uso, 30 frecuente, 40 rara, 45 restringida. */
    public static int bucketStandby(Context ctx) {
        try {
            if (Build.VERSION.SDK_INT < 28) return -1;
            UsageStatsManager u = (UsageStatsManager) ctx.getSystemService(Context.USAGE_STATS_SERVICE);
            return u == null ? -1 : u.getAppStandbyBucket();
        } catch (Throwable e) {
            return -1;
        }
    }

    public static boolean enDoze(Context ctx) {
        try {
            if (Build.VERSION.SDK_INT < 23) return false;
            PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
            return pm != null && pm.isDeviceIdleMode();
        } catch (Throwable e) {
            return false;
        }
    }

    // ------------------------------------------------------------------ lecturas de estado (también las usa la pantalla Salud)

    public static boolean tienePermiso(Context ctx, String permiso) {
        return ContextCompat.checkSelfPermission(ctx, permiso) == PackageManager.PERMISSION_GRANTED;
    }

    public static boolean notificacionesPermitidas(Context ctx) {
        if (Build.VERSION.SDK_INT >= 33) {
            return tienePermiso(ctx, Manifest.permission.POST_NOTIFICATIONS);
        }
        try {
            return NotificationManagerCompat.from(ctx).areNotificationsEnabled();
        } catch (Exception e) {
            return true;
        }
    }

    public static boolean estaCargando(Context ctx) {
        try {
            Intent b = ctx.registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
            if (b == null) return false;
            int plugged = b.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0);
            int status = b.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
            return plugged != 0 || status == BatteryManager.BATTERY_STATUS_CHARGING
                    || status == BatteryManager.BATTERY_STATUS_FULL;
        } catch (Exception e) {
            return false;
        }
    }

    public static boolean ahorroBateriaActivo(Context ctx) {
        if (Build.VERSION.SDK_INT < 21) return false;
        try {
            PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
            return pm != null && pm.isPowerSaveMode();
        } catch (Exception e) {
            return false;
        }
    }

    /** true si Android NO restringe la batería de esta app (está en la lista de excepciones). */
    public static boolean sinRestriccionBateria(Context ctx) {
        if (Build.VERSION.SDK_INT < 23) return true;
        try {
            PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
            return pm != null && pm.isIgnoringBatteryOptimizations(ctx.getPackageName());
        } catch (Exception e) {
            return false;
        }
    }

    /** @return {validada, wifi, datos}. */
    public static boolean[] red(Context ctx) {
        boolean validada = false, wifi = false, datos = false;
        try {
            ConnectivityManager cm = (ConnectivityManager) ctx.getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm != null) {
                if (Build.VERSION.SDK_INT >= 23) {
                    Network n = cm.getActiveNetwork();
                    NetworkCapabilities caps = n == null ? null : cm.getNetworkCapabilities(n);
                    if (caps != null) {
                        validada = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
                        wifi = caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI);
                        datos = caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR);
                    }
                } else {
                    NetworkInfo info = cm.getActiveNetworkInfo();
                    if (info != null && info.isConnected()) {
                        validada = true;
                        wifi = info.getType() == ConnectivityManager.TYPE_WIFI;
                        datos = info.getType() == ConnectivityManager.TYPE_MOBILE;
                    }
                }
            }
        } catch (Exception ignored) {
        }
        return new boolean[]{validada, wifi, datos};
    }

    // ------------------------------------------------------------------ órdenes remotas

    private static void procesarOrdenes(Context app, GuardianState st, String url, String cuerpo, int profundidad) {
        List<RemoteCommands.Command> nuevas = RemoteCommands.nuevas(RemoteCommands.parse(cuerpo), st.getCommandLog());
        if (nuevas.isEmpty()) return;
        boolean hayReinicio = false;
        for (RemoteCommands.Command c : nuevas) {
            String resultado = resultadoPrevisto(app, c.cmd);
            // Primero queda registrada (con commit): si la orden reinicia el teléfono, el registro ya existe.
            st.registrarOrden(c.id, c.cmd, resultado, System.currentTimeMillis());
            Log.i(TAG, "orden remota " + c.id + " " + c.cmd + " -> " + resultado);
            if (!"ok".equals(resultado)) continue;
            switch (c.cmd) {
                case RemoteCommands.LATIDO_YA:
                    break;   // la confirmación sale en el latido de seguimiento de abajo
                case RemoteCommands.REINICIAR_SERVICIO:
                    hayReinicio = true;
                    reiniciarServicio(app);
                    break;
                case RemoteCommands.REENVIAR_HISTORIAL:
                    reenviarHistorial(app);
                    break;
                case RemoteCommands.REINICIAR_TELEFONO:
                    hayReinicio = true;
                    reiniciarTelefono(app);
                    break;
                default:
                    break;
            }
        }
        // Confirma de una vez en un latido de seguimiento (solo uno: no encadena más).
        if (!hayReinicio && profundidad < 1) {
            sendHeartbeat(app, url, true, profundidad + 1);
        }
    }

    /** Resultado que tendrá la orden, decidido ANTES de ejecutarla. */
    static String resultadoPrevisto(Context app, String cmd) {
        switch (cmd) {
            case RemoteCommands.REENVIAR_HISTORIAL:
                return tienePermiso(app, Manifest.permission.READ_SMS) ? "ok" : "falta_permiso_sms";
            case RemoteCommands.REINICIAR_TELEFONO:
                return esDispositivoDedicado(app) ? "ok" : "comando_no_soportado";
            default:
                return "ok";
        }
    }

    public static void reiniciarServicio(Context app) {
        try {
            app.stopService(new Intent(app, SmsReceiverService.class));
        } catch (Exception e) {
            Log.e(TAG, "stopService: " + e);
        }
        startServiceSafely(app);
    }

    private static void reenviarHistorial(final Context app) {
        new Thread(() -> new HistoryForwarder().run(app, new HistoryForwarder.Listener() {
            @Override
            public void onProgress(String texto) {
            }

            @Override
            public void onDone(HistoryForwarder.Result r) {
                Log.i(TAG, "historial remoto: leidos=" + r.leidos + " aEnviar=" + r.aEnviar + " nuevos=" + r.nuevos
                        + " repetidos=" + r.repetidos + " fallidos=" + r.fallidos
                        + (r.error != null ? " error=" + r.error : ""));
            }
        }), "GuardianHistorial").start();
    }

    private static void reiniciarTelefono(Context app) {
        if (Build.VERSION.SDK_INT < 24) return;
        try {
            DevicePolicyManager dpm = (DevicePolicyManager) app.getSystemService(Context.DEVICE_POLICY_SERVICE);
            dpm.reboot(new ComponentName(app, GuardianAdminReceiver.class));
        } catch (Exception e) {
            Log.e(TAG, "reboot: " + e);
        }
    }

    // ------------------------------------------------------------------ modo teléfono dedicado (Device Owner)

    public static boolean esDispositivoDedicado(Context ctx) {
        if (Build.VERSION.SDK_INT < 24) return false;
        try {
            DevicePolicyManager dpm = (DevicePolicyManager) ctx.getSystemService(Context.DEVICE_POLICY_SERVICE);
            return dpm != null && dpm.isDeviceOwnerApp(ctx.getPackageName());
        } catch (Exception e) {
            return false;
        }
    }

    /** Solo si la app ya es Device Owner (el dueño lo activa a mano con adb): pantalla encendida cargando y permisos concedidos. */
    public static void aplicarPoliticasDedicado(Context ctx) {
        if (!esDispositivoDedicado(ctx)) return;
        try {
            DevicePolicyManager dpm = (DevicePolicyManager) ctx.getSystemService(Context.DEVICE_POLICY_SERVICE);
            ComponentName admin = new ComponentName(ctx, GuardianAdminReceiver.class);
            // 1 (AC) + 2 (USB) + 4 (inalámbrico) = 7: la pantalla no se apaga mientras carga.
            dpm.setGlobalSetting(admin, Settings.Global.STAY_ON_WHILE_PLUGGED_IN, "7");
            String[] permisos = Build.VERSION.SDK_INT >= 33
                    ? new String[]{Manifest.permission.RECEIVE_SMS, Manifest.permission.READ_SMS, Manifest.permission.POST_NOTIFICATIONS}
                    : new String[]{Manifest.permission.RECEIVE_SMS, Manifest.permission.READ_SMS};
            for (String p : permisos) {
                dpm.setPermissionGrantState(admin, ctx.getPackageName(), p, DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED);
            }
        } catch (Exception e) {
            Log.e(TAG, "politicas dedicado: " + e);
        }
    }

    /** Deja de ser teléfono dedicado (sin necesidad de restablecer de fábrica). */
    public static boolean dejarDeSerDedicado(Context ctx) {
        if (Build.VERSION.SDK_INT < 24 || !esDispositivoDedicado(ctx)) return false;
        try {
            DevicePolicyManager dpm = (DevicePolicyManager) ctx.getSystemService(Context.DEVICE_POLICY_SERVICE);
            dpm.clearDeviceOwnerApp(ctx.getPackageName());
            return true;
        } catch (Exception e) {
            Log.e(TAG, "clearDeviceOwner: " + e);
            return false;
        }
    }

    // ------------------------------------------------------------------ vigilantes

    /** Un paso del vigilante (lo llaman WorkManager y la alarma): levanta el servicio y manda latido si hace falta. */
    public static void tick(Context ctx, String origen) {
        Context app = ctx.getApplicationContext();
        try {
            HeartbeatSettings hs = HeartbeatSettings.load(app);
            boolean activo = hs.isEnabled() && !hs.getUrl().isEmpty();
            GuardianState st = new GuardianState(app);
            Watchdog.Decision d = Watchdog.decidir(SmsReceiverService.isRunning(), activo,
                    System.currentTimeMillis(), st.getUltimoLatidoIntento(), hs.getIntervalMillis());
            Log.i(TAG, "vigilante(" + origen + "): servicio=" + SmsReceiverService.isRunning()
                    + " levantar=" + d.levantarServicio + " latido=" + d.mandarLatido);
            if (d.levantarServicio) startServiceSafely(app);
            if (d.mandarLatido) sendHeartbeat(app, hs.getUrl(), false, 0);
        } catch (Exception e) {
            Log.e(TAG, "vigilante error: " + e);
        }
    }

    /** Arranca el servicio sin lanzar si Android lo prohíbe desde segundo plano (Android 12+). */
    public static boolean startServiceSafely(Context ctx) {
        try {
            Intent i = new Intent(ctx, SmsReceiverService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.startForegroundService(i);
            } else {
                ctx.startService(i);
            }
            return true;
        } catch (Exception e) {
            Log.e(TAG, "no se pudo arrancar el servicio: " + e);
            return false;
        }
    }

    /** WorkManager cada 15 min (el mínimo que permite Android) y la primera alarma. Seguro de repetir. */
    public static void scheduleWatchers(Context ctx) {
        Context app = ctx.getApplicationContext();
        try {
            PeriodicWorkRequest req = new PeriodicWorkRequest.Builder(GuardianWorker.class, 15, TimeUnit.MINUTES).build();
            WorkManager.getInstance(app).enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.KEEP, req);
        } catch (Exception e) {
            Log.e(TAG, "WorkManager vigilante: " + e);
        }
        scheduleAlarm(app, Watchdog.ALARMA_MS);
    }

    /** Alarma exacta (si hay permiso) que vuelve a despertar al vigilante; si no, alarma no exacta; el WorkManager queda de respaldo. */
    public static void scheduleAlarm(Context ctx, long delayMs) {
        try {
            AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
            if (am == null) return;
            Intent i = new Intent(ctx, GuardianAlarmReceiver.class);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
            PendingIntent pi = PendingIntent.getBroadcast(ctx, 7001, i, flags);
            long en = System.currentTimeMillis() + delayMs;
            if (Build.VERSION.SDK_INT >= 31 && !am.canScheduleExactAlarms()) {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, en, pi);
            } else if (Build.VERSION.SDK_INT >= 23) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, en, pi);
            } else {
                am.set(AlarmManager.RTC_WAKEUP, en, pi);
            }
        } catch (Exception e) {
            Log.e(TAG, "alarma: " + e);
        }
    }
}
