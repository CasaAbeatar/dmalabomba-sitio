package tech.bogomolov.incomingsmsgateway;

import android.app.PendingIntent;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.os.Build;
import android.os.SystemClock;
import android.util.Log;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

import javax.net.ssl.HttpsURLConnection;

import tech.bogomolov.incomingsmsgateway.SSLSocketFactory.TLSSocketFactory;

/**
 * La Bomba 2.12.0: actualización automática de la app. Pegamento con Android; las REGLAS están en ActualizacionPolitica
 * (JVM, con pruebas): oferta firmada y vigente, host exacto, versión mayor, sha256, mismo certificado, intentos acotados y
 * solo en momento seguro. Si algo falla no se instala nada y se reporta «actualizacion_estado = fallo» con un código corto.
 *
 * Flujo: latido con respuesta confiable → oferta válida → hilo de fondo: descarga (https, sin redirecciones, con tope de
 * tamaño) → comprueba sha256 → comprueba paquete, versión y certificado del archivo → PackageInstaller (sesión; sin
 * confirmación en Android 12+ si se puede: USER_ACTION_NOT_REQUIRED) → si Android pide confirmar, abre el diálogo del
 * instalador del sistema y el servicio de accesibilidad pulsa «Instalar/Actualizar» (solo en ESE paquete y con esos
 * textos exactos) → Android reemplaza la app y el receptor de MY_PACKAGE_REPLACED la levanta sola.
 */
final class Actualizador {

    /** Un fallido guardado hace más de esto ya no frena la actualización (queda guardado y sobrevive a ella). */
    static final long FALLIDOS_RECIENTES_MS = BuildConfig.DEBUG ? 60 * 1000L : 10 * 60 * 1000L;
    static final String TAG = "Actualizador";
    static final String ACCION_ESTADO = "tech.bogomolov.incomingsmsgateway.ACTUALIZACION_ESTADO";

    /** Textos EXACTOS (sin distinguir mayúsculas) de los botones que el servicio de accesibilidad puede pulsar. */
    static final String[] TEXTOS_BOTON = {"Instalar", "Actualizar", "Update", "Install"};
    /** Instaladores del sistema conocidos; cualquier otro paquete de sistema que dé Android también vale (ver paqueteInstalador). */
    private static final List<String> INSTALADORES = Arrays.asList(
            "com.google.android.packageinstaller", "com.android.packageinstaller", "com.samsung.android.packageinstaller",
            "com.hihonor.packageinstaller", "com.huawei.packageinstaller");

    /** Un estado «descargando» o «instalando» más viejo que esto se da por fallido. */
    static final long ESTADO_MAX_MS = 15L * 60_000L;
    /** Cuánto se espera un momento seguro (sin cola ni SMS recientes) después de descargar, antes de abandonar el intento. */
    static final long ESPERA_SEGURA_MS = 5L * 60_000L;
    /** Tiempo durante el cual se pulsa el botón del instalador tras abrirlo. */
    static final long VENTANA_PULSAR_MS = 3L * 60_000L;

    private static final AtomicBoolean EN_CURSO = new AtomicBoolean(false);

    /** Paquete del instalador cuyo diálogo se espera y hasta cuándo (reloj monótono); null = nada que pulsar. */
    private static volatile String instaladorEsperado = null;
    private static volatile long pulsarHastaMs = 0;

    private Actualizador() {
    }

    // ------------------------------------------------------------------ entrada: respuesta al latido

    /** Llamado por Guardian tras un latido con respuesta confiable. Nunca lanza; la descarga corre en un hilo aparte. */
    static void alResponderLatido(final Context ctx, final GuardianState st, String secreto, String cuerpo, long tsEnviado) {
        try {
            final Context app = ctx.getApplicationContext();
            long ahora = System.currentTimeMillis();
            ActualizacionPolitica.Lectura l = ActualizacionPolitica.leer(cuerpo, secreto, tsEnviado, ahora, BuildConfig.DEBUG);
            if (l.oferta == null) {
                if (l.rechazo != null) Log.w(TAG, "oferta de actualizacion rechazada: " + l.rechazo);
                return;
            }
            final ActualizacionPolitica.Oferta o = l.oferta;
            if (!ActualizacionPolitica.esMasNueva(o.vc, BuildConfig.VERSION_CODE)) return;
            revisarPendiente(app, st, ahora);
            String estado = st.getUpdEstado();
            if (("descargando".equals(estado) || "instalando".equals(estado)) && st.getUpdVc() == o.vc) return;   // ya en curso
            int cuenta = st.intentosUpd(o.vc);
            if (!ActualizacionPolitica.puedeIntentar(cuenta, st.getUpdUltimoIntento(), ahora)) {
                Log.i(TAG, "actualizacion " + o.v + ": intentos=" + cuenta + ", espera "
                        + ActualizacionPolitica.faltaParaIntentar(cuenta, st.getUpdUltimoIntento(), ahora) + " ms");
                return;
            }
            if (!ActualizacionPolitica.momentoSeguro(FailedMessage.recientes(app, FALLIDOS_RECIENTES_MS), st.getUltimoSms(), ahora)) {
                Log.i(TAG, "actualizacion " + o.v + ": esperando un momento seguro (cola de reenvio o SMS reciente)");
                return;
            }
            if (!EN_CURSO.compareAndSet(false, true)) return;
            Thread t = new Thread(() -> {
                try {
                    ejecutar(app, st, o);
                } catch (Throwable e) {
                    Log.e(TAG, "ejecutar: " + e);
                    fallo(st, o.vc, o.v, "error_inesperado");
                } finally {
                    EN_CURSO.set(false);
                }
            }, "ActualizacionAuto");
            t.setDaemon(true);
            t.start();
        } catch (Throwable e) {
            Log.e(TAG, "alResponderLatido: " + e);
        }
    }

    private static void ejecutar(Context app, GuardianState st, ActualizacionPolitica.Oferta o) {
        long ahora = System.currentTimeMillis();
        int intento = st.contarIntentoUpd(o.vc, ahora);
        Log.i(TAG, "actualizando a " + o.v + " (vc " + o.vc + "), intento " + intento);
        st.setUpdEstado("descargando", "descarga", o.v, ahora);
        File dir = new File(app.getCacheDir(), "actualizacion");
        limpiarCarpeta(dir);
        if (!dir.isDirectory() && !dir.mkdirs()) {
            fallo(st, o.vc, o.v, "sin_carpeta");
            return;
        }
        File apk = new File(dir, "app-" + o.vc + ".apk");
        String error = descargar(o.url, apk, o.sha256);
        if (error != null) {
            apk.delete();
            fallo(st, o.vc, o.v, error);
            return;
        }
        error = verificarArchivo(app, apk, o);
        if (error != null) {
            apk.delete();
            fallo(st, o.vc, o.v, error);
            return;
        }
        // La descarga pudo tardar: antes de instalar se vuelve a pedir un momento seguro (esperando un rato si hace falta).
        long limite = SystemClock.elapsedRealtime() + ESPERA_SEGURA_MS;
        while (!ActualizacionPolitica.momentoSeguro(FailedMessage.recientes(app, FALLIDOS_RECIENTES_MS), st.getUltimoSms(), System.currentTimeMillis())) {
            if (SystemClock.elapsedRealtime() > limite) {
                Log.i(TAG, "no hubo momento seguro: se abandona este intento (no cuenta)");
                apk.delete();
                st.devolverIntentoUpd(o.vc);
                st.setUpdEstado("ninguna", "", "", System.currentTimeMillis());
                return;
            }
            try {
                Thread.sleep(5_000L);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            }
        }
        st.setUpdEstado("instalando", "sesion", o.v, System.currentTimeMillis());
        error = instalar(app, apk);
        if (error != null) {
            apk.delete();
            fallo(st, o.vc, o.v, error);
        }
        // Si no hubo error, el resultado llega al receptor (alEstadoInstalador) o la app es reemplazada.
    }

    private static void fallo(GuardianState st, int vc, String version, String detalle) {
        Log.w(TAG, "actualizacion fallida (" + version + "): " + detalle);
        st.setUpdEstado("fallo", HeartbeatBody.codigoCorto(detalle) ? detalle : "fallo", version, System.currentTimeMillis());
    }

    // ------------------------------------------------------------------ descarga

    /** @return null si quedó bien; si no, un código corto [a-z0-9_]{1,30}. */
    static String descargar(String url, File destino, String sha256Esperado) {
        HttpURLConnection c = null;
        try {
            if (!ActualizacionPolitica.urlPermitida(url, BuildConfig.DEBUG)) return "url_no_permitida";
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setInstanceFollowRedirects(false);   // jamás se sigue una redirección a otro sitio
            c.setConnectTimeout(20_000);
            c.setReadTimeout(60_000);
            if (c instanceof HttpsURLConnection) {
                ((HttpsURLConnection) c).setSSLSocketFactory(new TLSSocketFactory(false));
            }
            int code = c.getResponseCode();
            if (code >= 300 && code < 400) return "redirige";
            if (code != 200) return "http_" + code;
            long len = c.getContentLength();
            if (len > ActualizacionPolitica.BYTES_MAX) return "demasiado_grande";
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            long total = 0;
            try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(destino)) {
                byte[] buf = new byte[16 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) {
                    total += n;
                    if (total > ActualizacionPolitica.BYTES_MAX) return "demasiado_grande";
                    md.update(buf, 0, n);
                    out.write(buf, 0, n);
                }
                out.flush();
            }
            if (total == 0) return "archivo_vacio";
            if (!ActualizacionPolitica.sha256Coincide(sha256Esperado, ActualizacionPolitica.hex(md.digest()))) return "sha256_distinto";
            return null;
        } catch (java.net.UnknownHostException | java.net.ConnectException | java.net.SocketTimeoutException e) {
            return "sin_red";
        } catch (Throwable e) {
            Log.w(TAG, "descarga: " + e);
            return "descarga_error";
        } finally {
            if (c != null) c.disconnect();
        }
    }

    // ------------------------------------------------------------------ comprobar el archivo

    /** Paquete, versión y certificado del archivo descargado. @return null si todo coincide; si no, un código corto. */
    @SuppressWarnings("deprecation")
    static String verificarArchivo(Context ctx, File apk, ActualizacionPolitica.Oferta o) {
        try {
            PackageManager pm = ctx.getPackageManager();
            int flags = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
            PackageInfo arch = pm.getPackageArchiveInfo(apk.getAbsolutePath(), flags);
            if (arch == null) return "apk_ilegible";
            if (!ctx.getPackageName().equals(arch.packageName)) return "paquete_distinto";
            long vcArch = Build.VERSION.SDK_INT >= 28 ? arch.getLongVersionCode() : arch.versionCode;
            if (vcArch != o.vc) return "version_distinta";
            if (!o.v.equals(arch.versionName)) return "nombre_version_distinto";
            PackageInfo propia = pm.getPackageInfo(ctx.getPackageName(), flags);
            if (!ActualizacionPolitica.mismosFirmantes(firmas(propia), firmas(arch))) return "firma_distinta";
            return null;
        } catch (Throwable e) {
            Log.w(TAG, "verificar archivo: " + e);
            return "verificacion_error";
        }
    }

    @SuppressWarnings("deprecation")
    private static byte[][] firmas(PackageInfo pi) {
        Signature[] s = null;
        if (Build.VERSION.SDK_INT >= 28) {
            if (pi.signingInfo != null) s = pi.signingInfo.getApkContentsSigners();
        } else {
            s = pi.signatures;
        }
        if (s == null) return new byte[0][];
        byte[][] out = new byte[s.length][];
        for (int i = 0; i < s.length; i++) out[i] = s[i].toByteArray();
        return out;
    }

    // ------------------------------------------------------------------ instalar

    /** Abre la sesión de PackageInstaller y la confirma. @return null si se confirmó (el resultado llega al receptor). */
    static String instalar(Context ctx, File apk) {
        PackageInstaller.Session sesion = null;
        PackageInstaller pi = null;
        int id = -1;
        try {
            pi = ctx.getPackageManager().getPackageInstaller();
            for (PackageInstaller.SessionInfo si : pi.getMySessions()) {
                try {
                    pi.abandonSession(si.getSessionId());   // sesiones viejas que quedaron colgadas
                } catch (Throwable ignored) {
                }
            }
            PackageInstaller.SessionParams p = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
            p.setAppPackageName(ctx.getPackageName());
            p.setSize(apk.length());
            // Solo en compilaciones de depuración (pruebas): un archivo marcador obliga a pasar por la confirmación del instalador,
            // para probar el pulsador de accesibilidad. En produccion BuildConfig.DEBUG es false y esto no existe.
            boolean forzarConfirmacion = BuildConfig.DEBUG && new File(ctx.getFilesDir(), "prueba_confirmacion").exists();
            if (Build.VERSION.SDK_INT >= 31 && !forzarConfirmacion) {
                // Sin pantalla de confirmación cuando Android lo permite (la app se actualiza a sí misma y tiene REQUEST_INSTALL_PACKAGES).
                p.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
            }
            id = pi.createSession(p);
            sesion = pi.openSession(id);
            try (InputStream in = new FileInputStream(apk); OutputStream out = sesion.openWrite("base.apk", 0, apk.length())) {
                byte[] buf = new byte[64 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                sesion.fsync(out);
            }
            Intent i = new Intent(ctx, ActualizacionReceptor.class).setAction(ACCION_ESTADO);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= 31) flags |= PendingIntent.FLAG_MUTABLE;   // Android rellena el resultado en el intent
            PendingIntent pend = PendingIntent.getBroadcast(ctx, id, i, flags);
            sesion.commit(pend.getIntentSender());
            return null;
        } catch (Throwable e) {
            Log.e(TAG, "instalar: " + e);
            try {
                if (sesion != null) sesion.abandon();
            } catch (Throwable ignored) {
            }
            return "sesion_error";
        } finally {
            if (sesion != null) sesion.close();
        }
    }

    // ------------------------------------------------------------------ resultado del instalador

    /** Lo llama ActualizacionReceptor con el resultado de la sesión de instalación. */
    @SuppressWarnings("deprecation")
    static void alEstadoInstalador(Context ctx, Intent intent) {
        try {
            Context app = ctx.getApplicationContext();
            GuardianState st = new GuardianState(app);
            int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, -1);
            String version = st.getUpdVersion();
            int vc = st.getUpdVc();
            Log.i(TAG, "resultado del instalador: status=" + status + " msg=" + intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE));
            switch (status) {
                case PackageInstaller.STATUS_PENDING_USER_ACTION: {
                    Intent confirmar = intent.getParcelableExtra(Intent.EXTRA_INTENT);
                    String paquete = paqueteInstalador(app, confirmar);
                    if (paquete == null) {
                        abandonarSesiones(app);
                        fallo(st, vc, version, "confirmacion_no_valida");
                        return;
                    }
                    // Android pide confirmar y no hay quien pulse: no se abre un dialogo que nadie atendera; se reporta y
                    // se espera al siguiente intento (1 h, 6 h, 24 h; maximo 3 por version), sin bucle.
                    if (PantallaRemotaService.instancia() == null) {
                        abandonarSesiones(app);
                        fallo(st, vc, version, "requiere_confirmacion");
                        return;
                    }
                    st.setUpdEstado("instalando", "esperando_confirmar", version, System.currentTimeMillis());
                    instaladorEsperado = paquete;
                    pulsarHastaMs = SystemClock.elapsedRealtime() + VENTANA_PULSAR_MS;
                    confirmar.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    try {
                        app.startActivity(confirmar);
                    } catch (Throwable e) {
                        Log.w(TAG, "no se pudo abrir el instalador: " + e);
                        instaladorEsperado = null;
                        fallo(st, vc, version, "no_abre_instalador");
                        return;
                    }
                    iniciarPulsador(app, st, vc, version);
                    break;
                }
                case PackageInstaller.STATUS_SUCCESS:
                    // Android reemplaza la app y el proceso termina; el nuevo proceso lo anota en alIniciar().
                    break;
                default:
                    fallo(st, vc, version, "instalador_" + status);
                    break;
            }
        } catch (Throwable e) {
            Log.e(TAG, "alEstadoInstalador: " + e);
        }
    }

    /**
     * El paquete del instalador al que apunta el intent de confirmación, SOLO si es un instalador conocido o una app del sistema
     * (nunca la propia app ni una app instalada por el usuario). null si no es válido.
     */
    static String paqueteInstalador(Context ctx, Intent confirmar) {
        if (confirmar == null) return null;
        try {
            PackageManager pm = ctx.getPackageManager();
            ComponentName c = confirmar.getComponent();
            if (c == null) {
                android.content.pm.ResolveInfo ri = pm.resolveActivity(confirmar, 0);
                if (ri != null && ri.activityInfo != null) c = new ComponentName(ri.activityInfo.packageName, ri.activityInfo.name);
            }
            if (c == null) return null;
            String pkg = c.getPackageName();
            if (pkg == null || pkg.equals(ctx.getPackageName())) return null;
            if (INSTALADORES.contains(pkg)) return pkg;
            try {
                ApplicationInfo ai = pm.getApplicationInfo(pkg, 0);
                if ((ai.flags & ApplicationInfo.FLAG_SYSTEM) != 0) return pkg;
            } catch (PackageManager.NameNotFoundException ignored) {
            }
        } catch (Throwable ignored) {
        }
        return null;
    }

    /** Mientras el diálogo del instalador esté en pantalla, pide al servicio de accesibilidad que pulse el botón (una sola vez). */
    private static void iniciarPulsador(final Context app, final GuardianState st, final int vc, final String version) {
        Thread t = new Thread(() -> {
            while (SystemClock.elapsedRealtime() < pulsarHastaMs && instaladorEsperado != null) {
                try {
                    Thread.sleep(1_000L);
                } catch (InterruptedException e) {
                    return;
                }
                PantallaRemotaService s = PantallaRemotaService.instancia();
                String paquete = instaladorEsperado;
                if (s != null && paquete != null && s.pulsarBotonInstalador(paquete)) {
                    Log.i(TAG, "boton del instalador pulsado");
                    instaladorEsperado = null;
                    return;
                }
            }
            if (instaladorEsperado != null) {
                // Nadie pulso en la ventana (el servicio no ve o no alcanza el boton): fallo claro, sin esperar los 15 min.
                instaladorEsperado = null;
                abandonarSesiones(app);
                fallo(st, vc, version, "boton_no_pulsado");
            }
        }, "ActualizacionBoton");
        t.setDaemon(true);
        t.start();
    }

    // ------------------------------------------------------------------ estado

    /**
     * Pone al día el estado: si la versión instalada ya alcanzó la que se perseguía, quedó bien («ninguna», intentos en cero);
     * si un «descargando»/«instalando» lleva demasiado, fue un fallo. Lo llaman el arranque, cada latido y la oferta.
     */
    static void revisarPendiente(Context ctx, GuardianState st, long ahora) {
        try {
            String estado = st.getUpdEstado();
            if ("ninguna".equals(estado)) return;
            int vc = st.getUpdVc();
            if (vc > 0 && BuildConfig.VERSION_CODE >= vc) {
                Log.i(TAG, "actualizacion completada: ahora " + BuildConfig.VERSION_NAME);
                st.setUpdEstado("ninguna", "", "", ahora);
                st.limpiarIntentosUpd();
                limpiarCarpeta(new File(ctx.getCacheDir(), "actualizacion"));
                return;
            }
            if (("descargando".equals(estado) || "instalando".equals(estado))
                    && ahora - st.getUpdEstadoTs() > ESTADO_MAX_MS && !EN_CURSO.get()) {
                fallo(st, vc, st.getUpdVersion(), "sin_resultado");
                abandonarSesiones(ctx);
            }
        } catch (Throwable e) {
            Log.w(TAG, "revisarPendiente: " + e);
        }
    }

    /** Llena en el latido el estado de la actualización. */
    static void llenarDetalle(Context ctx, GuardianState st, HeartbeatBody.Detalle d, long ahora) {
        revisarPendiente(ctx, st, ahora);
        d.actualizacionEstado = st.getUpdEstado();
        d.actualizacionDetalle = st.getUpdDetalle();
        d.actualizacionObjetivo = st.getUpdVersion();
    }

    /** Abandona las sesiones de instalacion de esta app que hayan quedado abiertas o esperando confirmacion. */
    static void abandonarSesiones(Context ctx) {
        try {
            PackageInstaller pi = ctx.getPackageManager().getPackageInstaller();
            for (PackageInstaller.SessionInfo si : pi.getMySessions()) {
                try {
                    pi.abandonSession(si.getSessionId());
                } catch (Throwable ignored) {
                }
            }
        } catch (Throwable ignored) {
        }
    }

    private static void limpiarCarpeta(File dir) {
        try {
            File[] fs = dir.listFiles();
            if (fs != null) {
                for (File f : fs) f.delete();
            }
        } catch (Throwable ignored) {
        }
    }
}
