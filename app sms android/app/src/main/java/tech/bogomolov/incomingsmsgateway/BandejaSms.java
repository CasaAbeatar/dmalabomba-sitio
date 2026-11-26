package tech.bogomolov.incomingsmsgateway;

import android.Manifest;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.util.Log;

import java.util.ArrayList;
import java.util.List;

/**
 * La Bomba 2.12.0: lee la bandeja de SMS del teléfono (SOLO lectura, con READ_SMS) para el autochequeo gratuito
 * «recibe pero no reenvía» (ver AutoChequeoSms). Nunca manda ni borra nada.
 */
final class BandejaSms {

    private static final int FILAS_MAX = 2000;

    private BandejaSms() {
    }

    /**
     * Rellena sms_inbox_ultimo_ms y sms_sin_reenviar del latido. Sin permiso READ_SMS o ante cualquier error:
     * sms_inbox_ultimo_ms = 0 y sms_sin_reenviar = -1 (el latido nunca se rompe por esto).
     */
    static void medir(final Context ctx, GuardianState st, HeartbeatBody.Detalle d, long ahora) {
        d.smsInboxUltimoMs = 0;
        d.smsSinReenviar = -1;
        if (!Guardian.tienePermiso(ctx, Manifest.permission.READ_SMS)) return;
        try {
            final String asterisk = ctx.getString(R.string.asterisk);
            final List<ForwardingConfig> reglas = new ArrayList<>();
            for (ForwardingConfig c : ForwardingConfig.getAll(ctx)) {
                if (c.getIsSmsEnabled()) reglas.add(c);
            }
            AutoChequeoSms.Cubre cubre = (remitente, texto) -> {
                for (ForwardingConfig c : reglas) {
                    if (SmsBroadcastReceiver.matchesSender(c, remitente, asterisk)
                            && SmsBroadcastReceiver.matchesFilter(c.getSmsFilter(), texto)) {
                        return true;
                    }
                }
                return false;
            };
            List<AutoChequeoSms.Sms> bandeja = new ArrayList<>();
            Uri inbox = Uri.parse("content://sms/inbox");
            Cursor cur = ctx.getContentResolver().query(inbox, new String[]{"address", "body", "date"},
                    "date >= ?", new String[]{String.valueOf(ahora - AutoChequeoSms.VENTANA_MS)}, "date DESC");
            if (cur != null) {
                try {
                    int n = 0;
                    while (cur.moveToNext() && n++ < FILAS_MAX) {
                        String from = cur.getString(0);
                        String body = cur.getString(1);
                        if (from == null || body == null) continue;
                        bandeja.add(new AutoChequeoSms.Sms(from, body, cur.getLong(2)));
                    }
                } finally {
                    cur.close();
                }
            }
            long masNuevo = AutoChequeoSms.masNuevo(bandeja);
            if (masNuevo == 0) {
                // nada en las últimas 48 h: el más nuevo de toda la bandeja (para saber desde cuándo no entra nada)
                Cursor c2 = ctx.getContentResolver().query(inbox, new String[]{"date"}, null, null, "date DESC");
                if (c2 != null) {
                    try {
                        if (c2.moveToFirst()) masNuevo = c2.getLong(0);
                    } finally {
                        c2.close();
                    }
                }
            }
            d.smsInboxUltimoMs = Math.max(0, masNuevo);
            d.smsSinReenviar = AutoChequeoSms.contar(bandeja, Math.max(st.getUltimoReenvioOk(), st.getHistorialOkTs()), ahora, cubre);
        } catch (Throwable e) {
            Log.w(Guardian.TAG, "autochequeo de la bandeja: " + e);
            d.smsInboxUltimoMs = 0;
            d.smsSinReenviar = -1;
        }
    }
}
