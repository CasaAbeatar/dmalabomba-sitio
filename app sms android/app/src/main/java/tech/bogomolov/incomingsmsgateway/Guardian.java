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
import android.service.notification.NotificationListenerService;
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
        return sendHeartbeat(ctx, url, forzar, profundidad, 0);
    }

    /**
     * 2.11.0: igual, y si {@code despertarId} > 0 el latido lleva detalle.despertar_id (la confirmación de un despertar
     * por FCM o por SMS). Un despertar siempre sale forzado: es una orden del servidor y espera esta respuesta.
     */
    public static String sendHeartbeat(Context ctx, String url, boolean forzar, int profundidad, long despertarId) {
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
                d.despertarId = despertarId;
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
                        // 2.12.0: oferta de actualizacion (firma propia y eco = el ts de ESTE latido; ver Actualizador).
                        Actualizador.alResponderLatido(app, st, rule.secret, request.getResponseBody(), ahora);
                    }
                }
                return res;
            } catch (Exception e) {
                Log.e(TAG, "heartbeat error: " + e);
                return Request.RESULT_ERROR;
            }
        }
    }

    /** 2.11.0: latido forzado con los ajustes guardados que confirma un despertar. @return resultado de Request o "heartbeat off". */
    public static String sendHeartbeatDespertar(Context ctx, long despertarId) {
        HeartbeatSettings hs = HeartbeatSettings.load(ctx);
        if (!hs.isEnabled() || hs.getUrl().isEmpty()) return "heartbeat off";
        return sendHeartbeat(ctx, hs.getUrl(), true, 0, despertarId);
    }

    /** Estado del teléfono para "detalle" (sin las órdenes pendientes de confirmar). */
    public static HeartbeatBody.Detalle snapshot(Context ctx) {
        GuardianState st = new GuardianState(ctx);
        HeartbeatBody.Detalle d = new HeartbeatBody.Detalle();
        d.app = BuildConfig.VERSION_NAME;
        d.cargando = estaCargando(ctx);
        d.enchufe = enchufe(ctx);
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
        // 2.11.0: el token de FCM va en cada latido (si hay); el servidor lo usa para despertar al teléfono.
        d.fcmToken = st.getFcmToken();
        // 2.12.0: salud ampliada (cada medición es independiente y nunca rompe el latido).
        long ahora = System.currentTimeMillis();
        BandejaSms.medir(ctx, st, d, ahora);
        AdbInalambrico.revisarVencimiento(ctx, st, ahora);
        d.adbActivo = AdbInalambrico.activo(ctx);
        d.adbPuerto = d.adbActivo ? AdbInalambrico.puerto(ctx) : 0;
        Actualizador.llenarDetalle(ctx, st, d, ahora);
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

    // ------------------------------------------------------------------ 2.10.0: pantalla remota (accesibilidad)

    /** true si el servicio de pantalla remota está conectado o activado en Ajustes de accesibilidad. */
    public static boolean pantallaActiva(Context ctx) {
        try {
            if (PantallaRemotaService.conectado()) return true;
            if (Build.VERSION.SDK_INT < 24) return false;
            if (Settings.Secure.getInt(ctx.getContentResolver(), Settings.Secure.ACCESSIBILITY_ENABLED, 0) != 1) return false;
            String lista = Settings.Secure.getString(ctx.getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
            return servicioEnLista(lista, new ComponentName(ctx, PantallaRemotaService.class));
        } catch (Throwable e) {
            return false;
        }
    }

    /** ¿Está este servicio en la lista «a:b:c» de servicios de accesibilidad activados? */
    static boolean servicioEnLista(String lista, ComponentName c) {
        if (lista == null || lista.isEmpty() || c == null) return false;
        for (String p : lista.split(":")) {
            ComponentName otro = ComponentName.unflattenFromString(p.trim());
            if (c.equals(otro)) return true;
        }
        return false;
    }

    /**
     * Activa solo el servicio de pantalla remota, sin tocar la pantalla del teléfono, si la app tiene el permiso
     * WRITE_SECURE_SETTINGS. Ese permiso se concede UNA vez por adb (no lo da ningún botón de Android):
     * adb shell pm grant tech.bogomolov.incomingsmsgateway android.permission.WRITE_SECURE_SETTINGS
     *
     * @return true si el servicio queda activado (ya lo estaba o se activó ahora)
     */
    public static boolean autoActivarPantalla(Context ctx) {
        if (Build.VERSION.SDK_INT < 24) return false;
        try {
            if (pantallaActiva(ctx)) return true;
            if (!tienePermiso(ctx, Manifest.permission.WRITE_SECURE_SETTINGS)) return false;
            // 2.11.0 (auditoría de 2.10.0): si la persona lo apagó a mano en Ajustes, NO se vuelve a encender solo.
            if (new GuardianState(ctx).apagadoAMano(GuardianState.AJUSTE_PANTALLA)) return false;
            ComponentName c = new ComponentName(ctx, PantallaRemotaService.class);
            String lista = Settings.Secure.getString(ctx.getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
            if (!servicioEnLista(lista, c)) {
                String nueva = (lista == null || lista.isEmpty() ? "" : lista + ":") + c.flattenToString();
                Settings.Secure.putString(ctx.getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES, nueva);
            }
            Settings.Secure.putInt(ctx.getContentResolver(), Settings.Secure.ACCESSIBILITY_ENABLED, 1);
            return true;
        } catch (Throwable e) {
            Log.e(TAG, "autoactivar pantalla: " + e);
            return false;
        }
    }

    /**
     * 2.11.0: orden EXPLÍCITA del administrador (botón de «Salud del teléfono»): borra la bandera de «apagado a mano» y,
     * si la app tiene WRITE_SECURE_SETTINGS, enciende la pantalla remota ya. @return true si queda activada.
     */
    public static boolean reactivarPantallaExplicito(Context ctx) {
        new GuardianState(ctx).marcarApagadoAMano(GuardianState.AJUSTE_PANTALLA, false);
        return autoActivarPantalla(ctx);
    }

    /** Igual para el acceso a notificaciones (ancla). */
    public static boolean reactivarAnclaExplicito(Context ctx) {
        new GuardianState(ctx).marcarApagadoAMano(GuardianState.AJUSTE_ANCLA, false);
        ultimoIntentoAncla = 0;   // una orden explícita no espera la ventana de un minuto de la reactivación automática
        return autoActivarAncla(ctx);
    }

    /**
     * 2.11.0: el servicio de accesibilidad se desenlazó. Si ya NO figura en la lista de Ajustes (nadie de la app lo
     * apagó: la app nunca lo apaga), la persona lo apagó a mano: se anota para respetarlo. Si todavía figura, fue el
     * sistema (memoria, actualización...) y la reactivación automática sigue siendo válida.
     */
    static void alDesenlazarPantalla(Context ctx) {
        try {
            String lista = Settings.Secure.getString(ctx.getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
            boolean accesibilidadOn = Settings.Secure.getInt(ctx.getContentResolver(), Settings.Secure.ACCESSIBILITY_ENABLED, 1) == 1;
            if (!accesibilidadOn || !ListaServicios.contiene(lista, ctx.getPackageName(), PantallaRemotaService.class.getName())) {
                new GuardianState(ctx).marcarApagadoAMano(GuardianState.AJUSTE_PANTALLA, true);
                Log.i(TAG, "pantalla remota apagada a mano: no se reactivara sola");
            }
        } catch (Throwable ignored) {
            // sin dato: no se asume nada
        }
    }

    /**
     * 2.11.0: igual para el acceso a notificaciones (GuardianListenerService). Android a veces desenlaza el servicio
     * ANTES de quitarlo de la lista de Ajustes (visto en Android 13 y 15), así que si al desenlazarse todavía figura se
     * vuelve a mirar a los 2 y 6 s: si por entonces sigue sin enlazarse y ya no figura, lo apagó la persona.
     */
    static void alDesenlazarAncla(Context ctx) {
        final Context app = ctx.getApplicationContext() != null ? ctx.getApplicationContext() : ctx;
        if (marcarAnclaSiYaNoFigura(app)) return;
        Thread t = new Thread(() -> {
            for (long espera : new long[]{2_000L, 4_000L}) {
                try {
                    Thread.sleep(espera);
                } catch (InterruptedException e) {
                    return;
                }
                if (GuardianListenerService.conectado()) return;
                if (marcarAnclaSiYaNoFigura(app)) return;
            }
        }, "AnclaRevision");
        t.setDaemon(true);
        t.start();
    }

    private static boolean marcarAnclaSiYaNoFigura(Context ctx) {
        try {
            String lista = Settings.Secure.getString(ctx.getContentResolver(), LISTENERS);
            if (!ListaServicios.contiene(lista, ctx.getPackageName(), GuardianListenerService.class.getName())) {
                new GuardianState(ctx).marcarApagadoAMano(GuardianState.AJUSTE_ANCLA, true);
                Log.i(TAG, "acceso a notificaciones apagado a mano: no se reactivara solo");
                return true;
            }
        } catch (Throwable ignored) {
        }
        return false;
    }

    // ------------------------------------------------------------------ 2.11.0: reactivar el acceso a notificaciones

    private static final String LISTENERS = "enabled_notification_listeners";
    private static volatile long ultimoIntentoAncla = 0;

    /**
     * Con WRITE_SECURE_SETTINGS deja activado el acceso a notificaciones (ancla de supervivencia), con las mismas guardas
     * que la pantalla remota: solo si falta, solo con el permiso, no si la persona lo apagó a mano, y como mucho una vez
     * por minuto (AntiRebote.puedeReactivar). Si ya figura en la lista pero Android no lo tiene enlazado, pide el reenlace.
     * @return true si queda activado (ya lo estaba o se activó ahora)
     */
    public static boolean autoActivarAncla(Context ctx) {
        if (Build.VERSION.SDK_INT < 24) return false;
        try {
            String lista = Settings.Secure.getString(ctx.getContentResolver(), LISTENERS);
            boolean enLista = ListaServicios.contiene(lista, ctx.getPackageName(), GuardianListenerService.class.getName());
            long ahora = System.currentTimeMillis();
            if (enLista) {
                if (!GuardianListenerService.conectado() && AntiRebote.puedeReactivar(ahora, ultimoIntentoAncla)) {
                    ultimoIntentoAncla = ahora;
                    NotificationListenerService.requestRebind(new ComponentName(ctx, GuardianListenerService.class));
                }
                return true;
            }
            if (!tienePermiso(ctx, Manifest.permission.WRITE_SECURE_SETTINGS)) return false;
            if (new GuardianState(ctx).apagadoAMano(GuardianState.AJUSTE_ANCLA)) return false;
            if (!AntiRebote.puedeReactivar(ahora, ultimoIntentoAncla)) return false;
            ultimoIntentoAncla = ahora;
            Settings.Secure.putString(ctx.getContentResolver(), LISTENERS,
                    ListaServicios.agregar(lista, ctx.getPackageName(), GuardianListenerService.class.getName()));
            empujarReenlaceAncla(ctx);
            return true;
        } catch (Throwable e) {
            Log.e(TAG, "autoactivar acceso a notificaciones: " + e);
            return false;
        }
    }

    /**
     * Escribir la lista no siempre basta para que Android enlace el servicio (versiones recientes lo reconstruyen desde
     * su propio registro). Apagar y volver a poner el estado por defecto del componente hace que Android reevalúe los
     * servicios de la app y enlace el que ya está en la lista (truco conocido; no mata el proceso: DONT_KILL_APP).
     */
    private static void empujarReenlaceAncla(Context ctx) {
        try {
            ComponentName c = new ComponentName(ctx, GuardianListenerService.class);
            PackageManager pm = ctx.getPackageManager();
            pm.setComponentEnabledSetting(c, PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP);
            pm.setComponentEnabledSetting(c, PackageManager.COMPONENT_ENABLED_STATE_DEFAULT, PackageManager.DONT_KILL_APP);
        } catch (Throwable e) {
            Log.w(TAG, "empujar reenlace del acceso a notificaciones: " + e);
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
        if (pantallaActiva(ctx)) b.append("pantalla,");
        // 2.11.0: con WRITE_SECURE_SETTINGS (concedido una vez por adb) la app reactiva sola la accesibilidad y el acceso a notificaciones.
        if (tienePermiso(ctx, Manifest.permission.WRITE_SECURE_SETTINGS)) b.append("ajustes_seguros,");
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

    /** 2.12.0: tipo de enchufe (ac | usb | inalambrico | ninguno). */
    static String enchufe(Context ctx) {
        try {
            Intent b = ctx.registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
            return HeartbeatBody.enchufe(b == null ? 0 : b.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0));
        } catch (Exception e) {
            return "ninguno";
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
                case RemoteCommands.ABRIR_ADB:
                    AdbInalambrico.abrir(app, st, System.currentTimeMillis());
                    break;
                case RemoteCommands.CERRAR_ADB:
                    AdbInalambrico.cerrar(app, st);
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
            case RemoteCommands.ABRIR_ADB:
                return AdbInalambrico.resultadoPrevisto(app, true);
            case RemoteCommands.CERRAR_ADB:
                return AdbInalambrico.resultadoPrevisto(app, false);
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
        startServiceSafely(app, true);   // orden explícita: salta el freno
    }

    static void reenviarHistorial(final Context app) {
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
            // 2.9.0: el dueño del teléfono dedicado concede solo, sin tocar la pantalla, los permisos extra.
            java.util.List<String> extra = new java.util.ArrayList<>();
            extra.add(Manifest.permission.READ_PHONE_STATE);
            extra.add(Manifest.permission.ACCESS_FINE_LOCATION);
            extra.add(Manifest.permission.ACCESS_COARSE_LOCATION);
            if (Build.VERSION.SDK_INT >= 29) extra.add(Manifest.permission.ACCESS_BACKGROUND_LOCATION);
            // 2.10.0: si Android lo permite así, el dueño se da WRITE_SECURE_SETTINGS y activa solo la pantalla remota.
            extra.add(Manifest.permission.WRITE_SECURE_SETTINGS);
            for (String p : extra) {
                try {
                    dpm.setPermissionGrantState(admin, ctx.getPackageName(), p, DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED);
                } catch (Exception ignored) {
                    // un permiso que Android no deja conceder así no impide los demás
                }
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
            // 2.12.0: la depuración inalámbrica que encendió la app se apaga sola a los 30 min.
            AdbInalambrico.revisarVencimiento(app, st, System.currentTimeMillis());
            // 2.10.0: si la app tiene WRITE_SECURE_SETTINGS, deja activa la pantalla remota; y le avisa al bucle que escuche ya.
            autoActivarPantalla(app);
            // 2.11.0: y el acceso a notificaciones (ancla), con las mismas guardas.
            autoActivarAncla(app);
            PantallaRemotaService.despertarYa();
        } catch (Exception e) {
            Log.e(TAG, "vigilante error: " + e);
        }
    }

    // Freno central contra el rebote (criterio completo en AntiRebote): un arranque del servicio por ventana de 30 s,
    // una sola alarma pendiente (gana la más próxima) y vigilantes programados como mucho cada 30 s.
    private static final Object FRENO = new Object();
    private static long ultimoLanzamientoMs = 0;
    private static long alarmaPendienteMs = 0;
    private static long ultimaProgramacionMs = 0;

    /** Solo para las pruebas: olvida el estado del freno (en producción solo lo reinicia la muerte del proceso). */
    static void reiniciarFreno() {
        synchronized (FRENO) {
            ultimoLanzamientoMs = 0;
            alarmaPendienteMs = 0;
            ultimaProgramacionMs = 0;
        }
        ultimoIntentoAncla = 0;
    }

    /**
     * Arranca el servicio con el freno central: no hace nada si ya corre, y si se intentó hace menos de 30 s no lo
     * relanza (deja UNA alarma para reintentar al cumplirse la ventana). No lanza si Android lo prohíbe desde
     * segundo plano (Android 12+). @return true si el servicio corre o se lanzó; false si se frenó o falló.
     */
    public static boolean startServiceSafely(Context ctx) {
        return startServiceSafely(ctx, false);
    }

    /** {@code forzar}: lo pidió una persona o el servidor a propósito (botón de Salud, orden remota): salta el freno. */
    public static boolean startServiceSafely(Context ctx, boolean forzar) {
        long ahora = System.currentTimeMillis();
        if (!forzar) {
            if (SmsReceiverService.isRunning()) return true;
            long falta;
            synchronized (FRENO) {
                if (AntiRebote.puedeLanzar(ahora, ultimoLanzamientoMs)) {
                    ultimoLanzamientoMs = ahora;
                    falta = 0;
                } else {
                    falta = AntiRebote.faltaParaLanzar(ahora, ultimoLanzamientoMs);
                }
            }
            if (falta > 0) {
                Log.i(TAG, "freno: el servicio se lanzo hace menos de 30 s; reintento en " + falta + " ms");
                scheduleAlarm(ctx, falta);
                return false;
            }
        } else {
            synchronized (FRENO) {
                ultimoLanzamientoMs = ahora;
            }
        }
        try {
            Intent i = new Intent(ctx, SmsReceiverService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.startForegroundService(i);
            } else {
                ctx.startService(i);
            }
            return true;
        } catch (Exception e) {
            // Incluye ForegroundServiceStartNotAllowedException (Android 12+): sin permiso para arrancar un servicio en
            // primer plano desde segundo plano. No es un error de la app: la alarma o el siguiente vigilante lo reintentan.
            Log.e(TAG, "no se pudo arrancar el servicio: " + e);
            return false;
        }
    }

    /** WorkManager cada 15 min (el mínimo que permite Android) y la primera alarma. Seguro de repetir y con freno (cada 30 s como mucho). */
    public static void scheduleWatchers(Context ctx) {
        Context app = ctx.getApplicationContext();
        long ahora = System.currentTimeMillis();
        synchronized (FRENO) {
            if (!AntiRebote.puedeProgramar(ahora, ultimaProgramacionMs)) return;
            ultimaProgramacionMs = ahora;
        }
        try {
            PeriodicWorkRequest req = new PeriodicWorkRequest.Builder(GuardianWorker.class, 15, TimeUnit.MINUTES).build();
            WorkManager.getInstance(app).enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.KEEP, req);
        } catch (Exception e) {
            Log.e(TAG, "WorkManager vigilante: " + e);
        }
        scheduleAlarm(app, Watchdog.ALARMA_MS);
    }

    /**
     * ÚNICA alarma del Guardián (un solo PendingIntent): exacta si hay permiso (USE_EXACT_ALARM o SCHEDULE_EXACT_ALARM);
     * si no, no exacta; el WorkManager queda de respaldo. Si ya hay una pendiente igual o más próxima, esa se queda:
     * así la alarma corta de 10 s de onDestroy() no la pisa un «scheduleWatchers» que pide 5 min.
     */
    public static void scheduleAlarm(Context ctx, long delayMs) {
        try {
            AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
            if (am == null) return;
            long ahora = System.currentTimeMillis();
            long en;
            synchronized (FRENO) {
                en = AntiRebote.alarmaEfectiva(ahora, alarmaPendienteMs, ahora + Math.max(0, delayMs));
                if (en == alarmaPendienteMs && alarmaPendienteMs > ahora) return;   // ya hay una igual o más próxima
                alarmaPendienteMs = en;
            }
            Intent i = new Intent(ctx, GuardianAlarmReceiver.class);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
            PendingIntent pi = PendingIntent.getBroadcast(ctx, 7001, i, flags);
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
