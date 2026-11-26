package tech.bogomolov.incomingsmsgateway;

import android.accessibilityservice.AccessibilityService;
import android.graphics.Bitmap;
import android.hardware.HardwareBuffer;
import android.util.Log;
import android.view.Display;

import androidx.annotation.RequiresApi;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

/**
 * La Bomba 2.10.0: captura de la pantalla con AccessibilityService.takeScreenshot (Android 11+). Va en una clase
 * aparte para que Android viejo (minSdk 14) nunca cargue estas referencias. Con la pantalla apagada o con una
 * ventana protegida (FLAG_SECURE) Android devuelve error o una imagen negra: el llamador lo informa, no lo oculta.
 */
@RequiresApi(30)
final class PantallaCaptura {

    private static final String TAG = "PantallaRemota";

    /** Último código de error de takeScreenshot (0 si la última captura salió bien). */
    static final AtomicInteger ultimoError = new AtomicInteger(0);

    private PantallaCaptura() {
    }

    /** @return la imagen en software (ARGB_8888) o null si no se pudo en el tiempo dado. */
    static Bitmap capturar(AccessibilityService servicio, Executor ejecutor, long timeoutMs) {
        final CountDownLatch espera = new CountDownLatch(1);
        final AtomicReference<Bitmap> ref = new AtomicReference<>();
        ultimoError.set(0);
        try {
            servicio.takeScreenshot(Display.DEFAULT_DISPLAY, ejecutor, new AccessibilityService.TakeScreenshotCallback() {
                @Override
                public void onSuccess(AccessibilityService.ScreenshotResult r) {
                    HardwareBuffer hb = null;
                    try {
                        hb = r.getHardwareBuffer();
                        Bitmap hw = Bitmap.wrapHardwareBuffer(hb, r.getColorSpace());
                        if (hw != null) {
                            ref.set(hw.copy(Bitmap.Config.ARGB_8888, false));
                            hw.recycle();
                        }
                    } catch (Throwable e) {
                        Log.e(TAG, "captura: " + e);
                    } finally {
                        try {
                            if (hb != null) hb.close();
                        } catch (Throwable ignored) {
                        }
                        espera.countDown();
                    }
                }

                @Override
                public void onFailure(int errorCode) {
                    ultimoError.set(errorCode);
                    espera.countDown();
                }
            });
            espera.await(timeoutMs, TimeUnit.MILLISECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } catch (Throwable e) {
            Log.e(TAG, "takeScreenshot: " + e);
        }
        return ref.get();
    }
}
