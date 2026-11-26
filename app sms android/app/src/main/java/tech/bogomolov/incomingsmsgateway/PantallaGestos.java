package tech.bogomolov.incomingsmsgateway;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.graphics.Path;
import android.util.Log;

import androidx.annotation.RequiresApi;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * La Bomba 2.10.0: toques y deslizamientos con AccessibilityService.dispatchGesture (Android 7+). Clase aparte
 * para que Android viejo (minSdk 14) nunca cargue estas referencias.
 */
@RequiresApi(24)
final class PantallaGestos {

    private static final String TAG = "PantallaRemota";

    private PantallaGestos() {
    }

    /**
     * Un trazo de (x1,y1) a (x2,y2) en píxeles de pantalla durante ms milisegundos. Un toque es un trazo de un
     * solo punto. Espera a que Android termine el gesto (máximo ms + 3 s).
     *
     * @return true si Android lo completó; false si lo canceló o no pudo despacharlo
     */
    static boolean trazo(AccessibilityService servicio, float x1, float y1, float x2, float y2, int ms) {
        try {
            Path p = new Path();
            p.moveTo(x1, y1);
            if (x1 != x2 || y1 != y2) p.lineTo(x2, y2);
            GestureDescription g = new GestureDescription.Builder()
                    .addStroke(new GestureDescription.StrokeDescription(p, 0, Math.max(1, ms)))
                    .build();
            final CountDownLatch espera = new CountDownLatch(1);
            final AtomicBoolean completo = new AtomicBoolean(false);
            boolean despachado = servicio.dispatchGesture(g, new AccessibilityService.GestureResultCallback() {
                @Override
                public void onCompleted(GestureDescription gestureDescription) {
                    completo.set(true);
                    espera.countDown();
                }

                @Override
                public void onCancelled(GestureDescription gestureDescription) {
                    espera.countDown();
                }
            }, null);
            if (!despachado) return false;
            espera.await(ms + 3000L, TimeUnit.MILLISECONDS);
            return completo.get();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return false;
        } catch (Throwable e) {
            Log.e(TAG, "gesto: " + e);
            return false;
        }
    }
}
