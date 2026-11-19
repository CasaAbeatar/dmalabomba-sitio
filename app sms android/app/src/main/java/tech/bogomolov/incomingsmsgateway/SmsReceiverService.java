package tech.bogomolov.incomingsmsgateway;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;

import androidx.annotation.Nullable;

import java.util.HashSet;
import java.util.Set;

// Keeps the foreground "F" indicator alive and hosts the heartbeat ping. SMS
// delivery itself is handled by the manifest-declared SmsBroadcastReceiver (see
// AndroidManifest.xml / issue #78), so this service no longer registers an SMS
// receiver at runtime — doing so would double-deliver every message.
//
// La Bomba 2.7.0 («Guardián»): ademas
//  - mantiene un WakeLock parcial (renovado cada ~5 min, expira solo si el servicio muere) y un WifiLock;
//  - manda latido apenas vuelve la red y cuando cambia la carga o el ahorro de bateria;
//  - re-arma sus vigilantes (WorkManager y alarma) y, si lo matan, deja una alarma corta para revivir.
public class SmsReceiverService extends Service {

    private static final String CHANNEL_ID = "SmsDefault";
    private static final String TAG = "SmsGateway";
    private static final long WAKELOCK_MS = 15 * 60_000L;

    // Sent by SettingsActivity after the user edits the heartbeat settings, so a
    // running service re-reads them without a full restart (see onStartCommand).
    public static final String ACTION_RESCHEDULE_HEARTBEAT =
            "tech.bogomolov.incomingsmsgateway.RESCHEDULE_HEARTBEAT";

    private static volatile boolean running = false;
    // Cuantas veces se creo el servicio en este proceso (diagnostico y pruebas: un reinicio sube el contador).
    private static final java.util.concurrent.atomic.AtomicInteger creaciones = new java.util.concurrent.atomic.AtomicInteger();

    public static int getCreaciones() {
        return creaciones.get();
    }
    private static volatile boolean wifiLockHeld = false;

    /** true mientras el servicio esta vivo en este proceso (lo usa el vigilante y la pantalla Salud). */
    public static boolean isRunning() {
        return running;
    }

    public static boolean isWifiLockHeld() {
        return wifiLockHeld;
    }

    // Todo el trabajo de red va en este hilo (nunca en el principal): latido periodico,
    // latidos por eventos y el mantenimiento del Guardian.
    private HandlerThread thread;
    private Handler handler;
    private Runnable heartbeatRunnable;
    private Runnable keeperRunnable;

    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;
    private ConnectivityManager.NetworkCallback networkCallback;
    private BroadcastReceiver stateReceiver;
    private final Set<Network> redesValidadas = new HashSet<>();

    @Override
    public void onCreate() {
        super.onCreate();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager notificationManager = getSystemService(NotificationManager.class);

            // IMPORTANCE_LOW keeps the "F" indicator silent (no sound, collapsed in
            // the shade) like the original IMPORTANCE_NONE, but is not created in a
            // blocked state — IMPORTANCE_NONE leaves the channel off on Android 13+,
            // which greys out the user's "Allow notifications" toggle (issue #77).
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    getText(R.string.notification_channel),
                    NotificationManager.IMPORTANCE_LOW);

            notificationManager.createNotificationChannel(channel);

            Notification notification =
                    new Notification.Builder(this, CHANNEL_ID)
                            .setSmallIcon(R.drawable.ic_f)
                            .setColor(getColor(R.color.colorPrimary))
                            .setContentTitle(getText(R.string.guardian_notification))
                            .setOngoing(true)
                            .build();

            startForeground(1, notification);
        }

        running = true;
        creaciones.incrementAndGet();
        adquirirCandados();
        iniciarVigilancia();
        registrarEventos();
        Guardian.scheduleWatchers(this);
        Guardian.aplicarPoliticasDedicado(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_RESCHEDULE_HEARTBEAT.equals(intent.getAction())) {
            iniciarVigilancia();
        }
        return START_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // Quitar la app de recientes: algunos fabricantes matan el servicio. Se deja una alarma corta para revivirlo.
        Guardian.scheduleAlarm(this, 10_000L);
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        super.onDestroy();

        running = false;
        // Si no fue a proposito (el sistema o el fabricante lo mataron), la alarma lo revive en segundos.
        Guardian.scheduleAlarm(this, 10_000L);
        desregistrarEventos();
        detenerVigilancia();
        liberarCandados();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            stopForeground(true);
        }
    }

    // ------------------------------------------------------------------ hilo, latido periodico y mantenimiento

    // Re-reads the heartbeat settings and (re)schedules the periodic ping. Safe to
    // call repeatedly: it first tears down any existing schedule.
    private void iniciarVigilancia() {
        detenerVigilancia();

        thread = new HandlerThread("GuardianThread");
        thread.start();
        handler = new Handler(thread.getLooper());

        // Mantenimiento cada ~5 min: renueva el WakeLock, el WifiLock y re-arma la alarma.
        keeperRunnable = new Runnable() {
            @Override
            public void run() {
                try {
                    adquirirCandados();
                    Guardian.scheduleAlarm(SmsReceiverService.this, Watchdog.ALARMA_MS);
                } catch (Exception e) {
                    Log.e(TAG, "mantenimiento: " + e);
                }
                if (handler != null) handler.postDelayed(this, Watchdog.ALARMA_MS);
            }
        };
        handler.postDelayed(keeperRunnable, Watchdog.ALARMA_MS);

        HeartbeatSettings settings = HeartbeatSettings.load(this);
        if (!settings.isEnabled() || settings.getUrl().isEmpty()) {
            return;
        }

        heartbeatRunnable = new Runnable() {
            @Override
            public void run() {
                // Se relee cada vez: si cambian los ajustes el ritmo cambia sin reiniciar nada.
                HeartbeatSettings s = HeartbeatSettings.load(SmsReceiverService.this);
                if (!s.isEnabled() || s.getUrl().isEmpty()) {
                    return;
                }
                Log.i(TAG, "heartbeat: " + Guardian.sendHeartbeat(SmsReceiverService.this, s.getUrl(), false, 0));
                if (handler != null) {
                    long espera = Watchdog.siguienteLatidoEn(System.currentTimeMillis(),
                            new GuardianState(SmsReceiverService.this).getUltimoLatidoIntento(), s.getIntervalMillis());
                    handler.postDelayed(this, espera);
                }
            }
        };

        // Primer latido: pronto si el ultimo es viejo (arranque, reinicio), o lo que falte del intervalo.
        // Si quedaron ordenes remotas por confirmar (p. ej. tras "reiniciar_servicio"), el primer latido sale ya.
        GuardianState st = new GuardianState(this);
        long primero = st.getAcksPendientes().isEmpty()
                ? Watchdog.siguienteLatidoEn(System.currentTimeMillis(), st.getUltimoLatidoIntento(), settings.getIntervalMillis())
                : Watchdog.PRIMER_LATIDO_MIN_MS;
        handler.postDelayed(heartbeatRunnable, primero);
    }

    private void detenerVigilancia() {
        if (handler != null) {
            if (heartbeatRunnable != null) handler.removeCallbacks(heartbeatRunnable);
            if (keeperRunnable != null) handler.removeCallbacks(keeperRunnable);
        }
        if (thread != null) {
            thread.quit();
            thread = null;
        }
        handler = null;
        heartbeatRunnable = null;
        keeperRunnable = null;
    }

    // Latido disparado por un evento (vuelve la red, cambia carga o ahorro). Fuera del hilo principal.
    private void latidoPorEvento(final String motivo) {
        final Handler h = handler;
        if (h == null) return;
        h.post(() -> {
            HeartbeatSettings s = HeartbeatSettings.load(SmsReceiverService.this);
            if (!s.isEnabled() || s.getUrl().isEmpty()) return;
            Log.i(TAG, "heartbeat por " + motivo + ": " + Guardian.sendHeartbeat(SmsReceiverService.this, s.getUrl(), false, 0));
        });
    }

    // ------------------------------------------------------------------ WakeLock y WifiLock

    private void adquirirCandados() {
        try {
            if (wakeLock == null) {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "smsgateway:guardian");
                wakeLock.setReferenceCounted(false);
            }
            // Con tiempo limite: si el servicio muere sin liberar, Android lo suelta solo.
            wakeLock.acquire(WAKELOCK_MS);
        } catch (Exception e) {
            Log.e(TAG, "wakelock: " + e);
        }
        try {
            boolean[] red = Guardian.red(this);
            boolean hayWifi = red[1];
            if (hayWifi) {
                if (wifiLock == null) {
                    WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                    wifiLock = wm.createWifiLock(wifiModo(), "smsgateway:wifi");
                    wifiLock.setReferenceCounted(false);
                }
                if (!wifiLock.isHeld()) wifiLock.acquire();
                wifiLockHeld = wifiLock.isHeld();
            } else if (wifiLock != null && wifiLock.isHeld()) {
                wifiLock.release();
                wifiLockHeld = false;
            }
        } catch (Exception e) {
            Log.e(TAG, "wifilock: " + e);
        }
    }

    @SuppressWarnings("deprecation")
    private static int wifiModo() {
        // FULL_HIGH_PERF esta en desuso desde Android 10 y alli solo rinde con la pantalla encendida;
        // es lo que hay: por eso la pantalla Salud tambien pide mantener el Wi-Fi activo en suspension.
        return WifiManager.WIFI_MODE_FULL_HIGH_PERF;
    }

    private void liberarCandados() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        } catch (Exception ignored) {
        }
        try {
            if (wifiLock != null && wifiLock.isHeld()) wifiLock.release();
        } catch (Exception ignored) {
        }
        wifiLockHeld = false;
        wakeLock = null;
        wifiLock = null;
    }

    // ------------------------------------------------------------------ eventos: red, carga, ahorro de bateria

    private void registrarEventos() {
        try {
            stateReceiver = new BroadcastReceiver() {
                @Override
                public void onReceive(Context context, Intent intent) {
                    String a = intent == null ? null : intent.getAction();
                    if (a != null) latidoPorEvento(a);
                }
            };
            IntentFilter f = new IntentFilter();
            f.addAction(Intent.ACTION_POWER_CONNECTED);
            f.addAction(Intent.ACTION_POWER_DISCONNECTED);
            if (Build.VERSION.SDK_INT >= 21) f.addAction(PowerManager.ACTION_POWER_SAVE_MODE_CHANGED);
            registerReceiver(stateReceiver, f);
        } catch (Exception e) {
            Log.e(TAG, "receptor de estado: " + e);
            stateReceiver = null;
        }
        if (Build.VERSION.SDK_INT >= 21) {
            try {
                ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
                networkCallback = new ConnectivityManager.NetworkCallback() {
                    @Override
                    public void onCapabilitiesChanged(Network network, NetworkCapabilities caps) {
                        boolean validada = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
                        boolean eraValidada;
                        synchronized (redesValidadas) {
                            eraValidada = redesValidadas.contains(network);
                            if (validada) redesValidadas.add(network); else redesValidadas.remove(network);
                        }
                        // Solo cuando una red pasa a tener internet de verdad (no en cada cambio menor).
                        if (validada && !eraValidada) latidoPorEvento("red");
                    }

                    @Override
                    public void onLost(Network network) {
                        synchronized (redesValidadas) {
                            redesValidadas.remove(network);
                        }
                    }
                };
                cm.registerNetworkCallback(
                        new NetworkRequest.Builder().addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET).build(),
                        networkCallback);
            } catch (Exception e) {
                Log.e(TAG, "callback de red: " + e);
                networkCallback = null;
            }
        }
    }

    private void desregistrarEventos() {
        try {
            if (stateReceiver != null) unregisterReceiver(stateReceiver);
        } catch (Exception ignored) {
        }
        stateReceiver = null;
        if (Build.VERSION.SDK_INT >= 21 && networkCallback != null) {
            try {
                ((ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE)).unregisterNetworkCallback(networkCallback);
            } catch (Exception ignored) {
            }
        }
        networkCallback = null;
    }

    // ------------------------------------------------------------------ latido firmado (API conservada: la usa el boton Test de Ajustes)

    // La Bomba: el latido va firmado. Toma la primera regla con firma HMAC encendida y
    // clave, arma un cuerpo JSON con ts (ms), empresa (la de la plantilla de esa regla),
    // telefono, bateria y, desde 2.7.0, "detalle"; lo firma con la MISMA clave de la regla
    // y lo manda en X-Signature. Sin regla con firma no manda nada.
    // Devuelve el resultado de Request (success, error, error_retry) o "no signing rule".
    public static String sendSignedHeartbeat(Context ctx, String url) {
        return Guardian.sendHeartbeat(ctx, url, true, 0);
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
