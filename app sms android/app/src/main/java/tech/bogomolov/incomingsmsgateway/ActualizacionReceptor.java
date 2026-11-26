package tech.bogomolov.incomingsmsgateway;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * La Bomba 2.12.0: recibe el resultado de la sesión de PackageInstaller de la actualización automática. No está exportado:
 * solo lo dispara el PendingIntent explícito que la propia app entrega al instalador del sistema.
 */
public class ActualizacionReceptor extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !Actualizador.ACCION_ESTADO.equals(intent.getAction())) return;
        Actualizador.alEstadoInstalador(context, intent);
    }
}
