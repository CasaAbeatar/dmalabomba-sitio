package tech.bogomolov.incomingsmsgateway;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * La Bomba 2.7.0: segundo vigilante, por alarma cada ~5 min. Solo lo dispara la alarma que la propia app
 * programa (PendingIntent explícito e inmutable). No acepta nada del exterior: ignora cualquier dato del intent.
 */
public class GuardianAlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(final Context context, Intent intent) {
        final Context app = context.getApplicationContext();
        Guardian.scheduleAlarm(app, Watchdog.ALARMA_MS);   // primero la siguiente, por si lo demás falla
        final PendingResult pr = goAsync();
        new Thread(() -> {
            try {
                Guardian.tick(app, "alarma");
            } finally {
                pr.finish();
            }
        }, "GuardianAlarma").start();
    }
}
