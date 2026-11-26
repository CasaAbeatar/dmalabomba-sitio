package tech.bogomolov.incomingsmsgateway;

import android.app.Application;

/**
 * La Bomba 2.11.0: el proceso del app. Aquí se inicia Firebase (a mano, sin google-services) para que FCM funcione
 * también cuando Android crea el proceso solo para entregar un mensaje de despertar con el app cerrada.
 */
public class LaBombaApp extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        FcmInicio.iniciar(this);   // nunca lanza
    }
}
