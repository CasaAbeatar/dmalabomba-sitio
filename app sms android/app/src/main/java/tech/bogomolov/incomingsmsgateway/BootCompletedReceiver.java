package tech.bogomolov.incomingsmsgateway;

import android.annotation.SuppressLint;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.UserManager;

// La Bomba 2.7.0: ademas de BOOT_COMPLETED reacciona a LOCKED_BOOT_COMPLETED, MY_PACKAGE_REPLACED (tras
// actualizar la app) y QUICKBOOT_POWERON (arranque rapido de algunos fabricantes). Con el telefono bloqueado
// y sin desbloquear por primera vez, el almacenamiento de la app no esta disponible: no se hace nada y se
// espera a BOOT_COMPLETED (limite de Android: un telefono con PIN no arranca la app hasta el primer desbloqueo).
public class BootCompletedReceiver extends BroadcastReceiver {
    @SuppressLint("UnsafeProtectedBroadcastReceiver")
    @Override
    public void onReceive(Context context, Intent argIntent) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            UserManager um = (UserManager) context.getSystemService(Context.USER_SERVICE);
            if (um != null && !um.isUserUnlocked()) {
                return;
            }
        }
        Guardian.startServiceSafely(context);
        Guardian.scheduleWatchers(context);
    }
}
