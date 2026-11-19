package tech.bogomolov.incomingsmsgateway;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

/** La Bomba 2.7.0: vigilante por WorkManager (cada 15 min). Si el servicio no corre, lo levanta y manda latido. */
public class GuardianWorker extends Worker {

    public GuardianWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        Guardian.tick(getApplicationContext(), "workmanager");
        // Si la cadena de alarmas se rompió (reinicio, fuerza bruta del fabricante), aquí se vuelve a armar.
        Guardian.scheduleAlarm(getApplicationContext(), Watchdog.ALARMA_MS);
        return Result.success();
    }
}
