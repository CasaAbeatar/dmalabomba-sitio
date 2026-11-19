package tech.bogomolov.incomingsmsgateway;

import android.Manifest;
import android.content.Context;
import android.os.Build;

import java.util.ArrayList;
import java.util.List;

/**
 * La Bomba 2.7.0: la lista de comprobaciones de la pantalla «Salud del teléfono». La usan la pantalla y el
 * botón de la pantalla principal (para mostrar cuántas faltan). Lo que Android no deja leer (inicio automático,
 * Wi-Fi en suspensión, ajustes restringidos) se resuelve con una confirmación manual de la persona.
 */
public final class HealthCheck {

    public static final String SMS = "sms";
    public static final String LEER_SMS = "leer_sms";
    public static final String NOTIF = "notif";
    public static final String BATERIA = "bateria";
    public static final String AHORRO = "ahorro";
    public static final String SERVICIO = "servicio";
    public static final String AUTOINICIO = "autoinicio";
    public static final String RESTRINGIDOS = "restringidos";
    public static final String WIFI = "wifi";
    public static final String LATIDO = "latido";
    public static final String ULTIMO_SMS = "ultimo_sms";

    private HealthCheck() {
    }

    public static final class Item {
        public final String id;
        public final int titulo;
        public boolean ok;
        /** Solo informa (sin semáforo rojo/verde y sin contar como pendiente). */
        public boolean informativo;
        /** Android no deja comprobarlo: se confirma a mano con «Ya lo hice». */
        public boolean manual;
        public String ayuda = "";
        public int boton;   // 0 = sin botón

        Item(String id, int titulo) {
            this.id = id;
            this.titulo = titulo;
        }

        public boolean pendiente() {
            return !ok && !informativo;
        }
    }

    public static List<Item> evaluar(Context ctx) {
        GuardianState st = new GuardianState(ctx);
        long ahora = System.currentTimeMillis();
        List<Item> l = new ArrayList<>();

        Item i = new Item(SMS, R.string.h_sms_title);
        i.ok = Guardian.tienePermiso(ctx, Manifest.permission.RECEIVE_SMS);
        i.ayuda = ctx.getString(i.ok ? R.string.h_sms_ok : R.string.h_sms_bad);
        i.boton = R.string.h_sms_btn;
        l.add(i);

        Item leer = new Item(LEER_SMS, R.string.h_read_title);
        leer.ok = Guardian.tienePermiso(ctx, Manifest.permission.READ_SMS);
        leer.ayuda = ctx.getString(leer.ok ? R.string.h_read_ok : R.string.h_read_bad);
        leer.boton = R.string.h_read_btn;
        l.add(leer);

        Item n = new Item(NOTIF, R.string.h_notif_title);
        n.ok = Guardian.notificacionesPermitidas(ctx);
        n.ayuda = ctx.getString(n.ok ? R.string.h_notif_ok : R.string.h_notif_bad);
        n.boton = R.string.h_notif_btn;
        l.add(n);

        Item b = new Item(BATERIA, R.string.h_bat_title);
        b.ok = Guardian.sinRestriccionBateria(ctx);
        b.ayuda = ctx.getString(b.ok ? R.string.h_bat_ok : R.string.h_bat_bad);
        b.boton = R.string.h_bat_btn;
        l.add(b);

        Item a = new Item(AHORRO, R.string.h_saver_title);
        a.ok = !Guardian.ahorroBateriaActivo(ctx);
        a.ayuda = ctx.getString(a.ok ? R.string.h_saver_ok : R.string.h_saver_bad);
        a.boton = R.string.h_saver_btn;
        l.add(a);

        Item s = new Item(SERVICIO, R.string.h_service_title);
        s.ok = SmsReceiverService.isRunning();
        s.ayuda = ctx.getString(s.ok ? R.string.h_service_ok : R.string.h_service_bad);
        s.boton = R.string.h_service_btn;
        l.add(s);

        Item au = new Item(AUTOINICIO, R.string.h_autostart_title);
        au.manual = true;
        au.ok = st.confirmado(AUTOINICIO);
        au.ayuda = ctx.getString(au.ok ? R.string.health_marked_by_you : R.string.h_autostart_bad);
        au.boton = R.string.h_autostart_btn;
        l.add(au);

        if (Build.VERSION.SDK_INT >= 33) {
            Item r = new Item(RESTRINGIDOS, R.string.h_restricted_title);
            r.manual = true;
            // Si el permiso de SMS ya está dado, Android no lo está bloqueando: se da por resuelto solo.
            boolean smsDado = Guardian.tienePermiso(ctx, Manifest.permission.RECEIVE_SMS);
            r.ok = smsDado || st.confirmado(RESTRINGIDOS);
            r.ayuda = ctx.getString(smsDado ? R.string.h_restricted_ok
                    : (r.ok ? R.string.health_marked_by_you : R.string.h_restricted_bad));
            r.boton = R.string.h_restricted_btn;
            r.manual = !smsDado;
            l.add(r);
        }

        Item w = new Item(WIFI, R.string.h_wifi_title);
        w.manual = true;
        w.ok = st.confirmado(WIFI);
        w.ayuda = ctx.getString(w.ok ? R.string.health_marked_by_you : R.string.h_wifi_bad);
        w.boton = R.string.h_wifi_btn;
        l.add(w);

        HeartbeatSettings hs = HeartbeatSettings.load(ctx);
        Item h = new Item(LATIDO, R.string.h_hb_title);
        long ok = st.getUltimoLatidoOk();
        if (!hs.isEnabled() || hs.getUrl().isEmpty()) {
            h.ok = false;
            h.ayuda = ctx.getString(R.string.h_hb_off);
            h.boton = R.string.h_hb_btn_settings;
        } else if (ok <= 0) {
            h.ok = false;
            h.ayuda = ctx.getString(R.string.h_hb_never);
            h.boton = R.string.h_hb_btn;
        } else if (Watchdog.latidoReciente(ahora, ok, hs.getIntervalMillis())) {
            h.ok = true;
            h.ayuda = ctx.getString(R.string.h_hb_ok, hace(ctx, ahora, ok));
            h.boton = R.string.h_hb_btn;
        } else {
            h.ok = false;
            h.ayuda = ctx.getString(R.string.h_hb_old, hace(ctx, ahora, ok));
            h.boton = R.string.h_hb_btn;
        }
        l.add(h);

        Item u = new Item(ULTIMO_SMS, R.string.h_lastsms_title);
        u.informativo = true;
        long sms = st.getUltimoSms();
        u.ayuda = sms <= 0 ? ctx.getString(R.string.h_lastsms_never)
                : ctx.getString(R.string.h_lastsms_info, hace(ctx, ahora, sms), hace(ctx, ahora, st.getUltimoReenvioOk()));
        l.add(u);
        return l;
    }

    public static int contarPendientes(Context ctx) {
        int n = 0;
        for (Item i : evaluar(ctx)) if (i.pendiente()) n++;
        return n;
    }

    /** «hace 5 min», «hace 2 h 10 min»... */
    public static String hace(Context ctx, long ahora, long ts) {
        if (ts <= 0) return ctx.getString(R.string.h_when_never);
        long seg = (ahora - ts) / 1000;
        if (seg < 60) return ctx.getString(R.string.h_when_now);
        long min = seg / 60;
        if (min < 60) return ctx.getString(R.string.h_when_min, (int) min);
        long h = min / 60;
        if (h < 48) return ctx.getString(R.string.h_when_hours, (int) h, (int) (min % 60));
        return ctx.getString(R.string.h_when_days, (int) (h / 24));
    }
}
