package tech.bogomolov.incomingsmsgateway;

import android.accessibilityservice.AccessibilityService;
import android.app.KeyguardManager;
import android.content.Context;
import android.graphics.Bitmap;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.os.SystemClock;
import android.util.DisplayMetrics;
import android.util.Base64;
import android.util.Log;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;

import java.io.ByteArrayOutputStream;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * La Bomba 2.10.0: pantalla remota propia (sin software de terceros). Es un servicio de accesibilidad que,
 * mientras Emil tiene una sesión abierta en el visor web, manda una captura del teléfono cada ~1 s y ejecuta
 * los toques, deslizamientos y teclas que llegan en la respuesta del servidor (ver PROTOCOLO.md).
 *
 * Seguridad:
 *  - Sin sesión solo "escucha": cada 60 s manda una petición firmada mínima y pregunta si hay sesión.
 *  - Toda petición va firmada con la clave de la regla; la respuesta TAMBIÉN debe venir firmada, o no se
 *    ejecuta nada (PantallaProtocolo.respuestaFirmada).
 *  - Lista cerrada de acciones, tope por respuesta, un id se ejecuta una sola vez y la sesión vence sola
 *    (el servidor dice cuánto resta; el teléfono además corta a los 15 min pase lo que pase).
 *  - No lee ni guarda el contenido de las ventanas. Solo busca el campo con foco para escribir texto.
 *
 * También es ancla: Android lo enlaza y lo vuelve a levantar solo, y al conectarse o caerse revive el
 * servicio que reenvía los SMS.
 */
public class PantallaRemotaService extends AccessibilityService {

    private static final String TAG = "PantallaRemota";

    private static volatile PantallaRemotaService instancia;

    /** Cada cuánto escucha sin sesión (ms). Las pruebas lo acortan. */
    static volatile long escuchaMs = 60_000L;
    /** Pausa objetivo entre cuadros en sesión (ms). takeScreenshot no admite menos de ~333 ms. */
    static volatile long cuadroMs = 800L;
    static final int ANCHO_MAX = 540;
    static final int CALIDAD_JPEG = 55;
    /**
     * Una sesión dura como máximo 15 min en el teléfono, diga lo que diga el servidor. Es el MISMO tope que
     * PantallaProtocolo.MAX_RESTA_S (900 s) que limita lo que «resta_s» puede prometer: si uno cambia, cambia el otro.
     */
    static final long TOPE_SESION_MS = 15 * 60_000L;
    private static final int MAX_JPEG_BYTES = 150 * 1024;

    private final Object dormir = new Object();
    private volatile boolean parar = false;
    private Thread hilo;
    private final ExecutorService ejecutorCaptura = Executors.newSingleThreadExecutor();
    private PowerManager.WakeLock cpu;

    /** Estado de la sesión en curso (solo lo toca el hilo del bucle). */
    private static final class Sesion {
        String sid;
        long inicioMs;
        long finMs;
        int seq;
        int w, h;
        String hashUltimo = "";
        /** 2.11.0: ¿ya se mandó el primer cuadro? Antes de eso toda acción es «obsoleta» (no se apoya en nada que se haya visto). */
        boolean cuadroEnviado = false;
        /** 2.11.0: seq de las últimas imágenes enviadas (los cuadros sin_cambio no cuentan): contra ellas se comparan las acciones. */
        final PantallaProtocolo.SeqImagen imagen = new PantallaProtocolo.SeqImagen();
        int errores;
        final List<Long> confirmadas = new ArrayList<>();
        final Map<Long, String> resultados = new LinkedHashMap<>();
        final PantallaProtocolo.IdsHechos hechas = new PantallaProtocolo.IdsHechos();
        /** Resultado de las acciones ya ejecutadas (acotado), para volver a confirmarlas si el servidor las reentrega. */
        final Map<Long, String> resultadoHechas = new LinkedHashMap<Long, String>() {
            @Override
            protected boolean removeEldestEntry(Map.Entry<Long, String> eldest) {
                return size() > PantallaProtocolo.MAX_RECORDADOS;
            }
        };
    }

    private Sesion sesion;

    // ------------------------------------------------------------------ estado visible desde fuera

    /** true si Android tiene el servicio conectado ahora mismo. */
    public static boolean conectado() {
        return instancia != null;
    }

    static PantallaRemotaService instancia() {
        return instancia;
    }

    /** Despierta el bucle para que escuche ya (lo usa el vigilante y las pruebas). */
    public static void despertarYa() {
        PantallaRemotaService s = instancia;
        if (s == null) return;
        synchronized (s.dormir) {
            s.dormir.notifyAll();
        }
    }

    // ------------------------------------------------------------------ ciclo de vida

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        instancia = this;
        parar = false;
        // 2.11.0: si está conectado es que alguien lo encendió (la persona, o el administrador desde Salud): se borra
        // la anotación de «apagado a mano».
        try {
            new GuardianState(getApplicationContext()).marcarApagadoAMano(GuardianState.AJUSTE_PANTALLA, false);
        } catch (Throwable ignored) {
        }
        anclar();
        if (hilo == null || !hilo.isAlive()) {
            hilo = new Thread(this::bucle, "PantallaRemota");
            hilo.setDaemon(true);
            hilo.start();
        }
        Log.i(TAG, "servicio conectado");
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        // No se lee nada de las ventanas: el servicio solo existe para capturar y tocar.
    }

    @Override
    public void onInterrupt() {
    }

    @Override
    public boolean onUnbind(android.content.Intent intent) {
        // 2.11.0: ¿lo apagó la persona a mano? (si ya no figura en Ajustes). Se anota ANTES de cerrar para respetarlo.
        Guardian.alDesenlazarPantalla(getApplicationContext());
        cerrar();
        return super.onUnbind(intent);
    }

    @Override
    public void onDestroy() {
        cerrar();
        ejecutorCaptura.shutdown();
        super.onDestroy();
    }

    private void cerrar() {
        if (instancia == this) instancia = null;
        parar = true;
        liberarCpu();
        Notificaciones.ocultarControlRemoto(getApplicationContext());
        synchronized (dormir) {
            dormir.notifyAll();
        }
        if (hilo != null) hilo.interrupt();
        hilo = null;
        anclar();   // si el servicio de SMS cayó, se levanta
    }

    private void anclar() {
        try {
            if (!SmsReceiverService.isRunning()) Guardian.startServiceSafely(getApplicationContext());
            Guardian.scheduleWatchers(getApplicationContext());
        } catch (Throwable ignored) {
            // nunca debe tumbar el enlace
        }
    }

    // ------------------------------------------------------------------ bucle

    private void bucle() {
        while (!parar) {
            long espera;
            try {
                if (sesion == null) {
                    escuchar();
                    // si la escucha abrió una sesión, el primer cuadro sale enseguida (no a los 60 s)
                    espera = sesion != null ? 300 : escuchaMs;
                } else {
                    espera = cuadro();
                }
            } catch (Throwable e) {
                Log.e(TAG, "bucle: " + e);
                if (sesion != null) cerrarSesion();
                espera = escuchaMs;
            }
            dormirMs(espera);
        }
    }

    private void dormirMs(long ms) {
        synchronized (dormir) {
            if (parar) return;
            try {
                dormir.wait(Math.max(50, ms));
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
    }

    private void escuchar() {
        SigningRule regla = SigningRule.find(getApplicationContext());
        if (regla == null) return;
        String url = PantallaProtocolo.urlPantalla(regla.url);
        if (url == null) return;
        long ts = System.currentTimeMillis();
        String cuerpo = PantallaProtocolo.escucha(ts, regla.empresa,
                BuildConfig.VERSION_NAME, pantallaEncendida(), pantallaBloqueada());
        PantallaProtocolo.Respuesta r = enviar(regla, url, cuerpo, ts);
        if (r == null || !r.sesion || r.restaS <= 0) return;
        iniciarSesion(r);
        procesarAcciones(r);
    }

    private void iniciarSesion(PantallaProtocolo.Respuesta r) {
        Sesion s = new Sesion();
        s.sid = r.sid;
        s.inicioMs = SystemClock.elapsedRealtime();
        s.finMs = s.inicioMs + r.restaS * 1000L;
        sesion = s;
        tomarCpu(r.restaS * 1000L + 30_000L);
        // 2.11.0: notificación fija mientras haya una sesión de control remoto (que se vea que alguien puede ver y tocar el teléfono).
        Notificaciones.mostrarControlRemoto(getApplicationContext());
        Log.i(TAG, "sesion abierta " + s.sid + " resta " + r.restaS + " s");
    }

    private void cerrarSesion() {
        Sesion s = sesion;
        sesion = null;
        liberarCpu();
        Notificaciones.ocultarControlRemoto(getApplicationContext());
        if (s != null) Log.i(TAG, "sesion cerrada " + s.sid);
    }

    /** Avisa al servidor que el teléfono cierra la sesión (fase «fin», opcional); si falla no pasa nada. */
    private void avisarFin(Sesion s) {
        try {
            SigningRule regla = SigningRule.find(getApplicationContext());
            String url = regla == null ? null : PantallaProtocolo.urlPantalla(regla.url);
            if (regla == null || url == null) return;
            long ts = System.currentTimeMillis();
            enviar(regla, url, PantallaProtocolo.fin(ts, regla.empresa, s.sid), ts);
        } catch (Throwable ignored) {
        }
    }

    /** Un cuadro de la sesión. @return cuánto esperar antes del siguiente (ms). */
    private long cuadro() {
        Sesion s = sesion;
        long t0 = SystemClock.elapsedRealtime();
        if (t0 >= s.finMs || t0 - s.inicioMs > TOPE_SESION_MS) {
            avisarFin(s);
            cerrarSesion();
            return escuchaMs;
        }
        SigningRule regla = SigningRule.find(getApplicationContext());
        String url = regla == null ? null : PantallaProtocolo.urlPantalla(regla.url);
        if (regla == null || url == null) {
            cerrarSesion();
            return escuchaMs;
        }

        boolean encendida = pantallaEncendida();
        boolean bloqueada = pantallaBloqueada();
        String jpg = null;
        String error = null;
        boolean sinCambio = true;
        if (encendida) {
            Bitmap bmp = capturar(5000);
            if (bmp == null) {
                error = "captura_fallo";
            } else {
                try {
                    Bitmap esc = escalar(bmp);
                    s.w = esc.getWidth();
                    s.h = esc.getHeight();
                    byte[] bytes = jpeg(esc);
                    if (esc != bmp) esc.recycle();
                    String hash = sha1(bytes);
                    if (!hash.equals(s.hashUltimo)) {
                        s.hashUltimo = hash;
                        jpg = Base64.encodeToString(bytes, Base64.NO_WRAP);
                        sinCambio = false;
                    }
                } finally {
                    bmp.recycle();
                }
            }
        }
        long[] conf = new long[s.confirmadas.size()];
        for (int i = 0; i < conf.length; i++) conf[i] = s.confirmadas.get(i);
        Map<Long, String> res = new LinkedHashMap<>(s.resultados);
        long ts = System.currentTimeMillis();
        String cuerpo = PantallaProtocolo.cuadro(ts, regla.empresa, s.sid, ++s.seq,
                s.w, s.h, jpg, sinCambio, encendida, bloqueada, error, conf, res);
        s.cuadroEnviado = true;   // desde aquí las acciones se comparan con lo enviado (ver procesarAcciones)
        PantallaProtocolo.Respuesta r = enviar(regla, url, cuerpo, ts);
        if (r == null) {
            if (++s.errores >= 5) {
                cerrarSesion();
                return escuchaMs;
            }
            return 3000;
        }
        s.errores = 0;
        // Una imagen solo cuenta como «enviada» si el servidor la recibió (respuesta válida): el visor mostrará esa seq.
        if (jpg != null && !sinCambio) s.imagen.registrarImagen(s.seq, SystemClock.elapsedRealtime());
        s.confirmadas.removeAll(toList(conf));
        for (long id : conf) s.resultados.remove(id);
        if (!r.sesion) {
            cerrarSesion();
            return escuchaMs;
        }
        s.finMs = SystemClock.elapsedRealtime() + r.restaS * 1000L;
        boolean hizoAlgo = procesarAcciones(r);
        long gastado = SystemClock.elapsedRealtime() - t0;
        long espera = hizoAlgo ? 500 : cuadroMs - gastado;
        return Math.max(350, espera);
    }

    private static List<Long> toList(long[] a) {
        List<Long> l = new ArrayList<>();
        for (long v : a) l.add(v);
        return l;
    }

    /** Ejecuta las acciones nuevas de la respuesta. @return true si ejecutó alguna. */
    private boolean procesarAcciones(PantallaProtocolo.Respuesta r) {
        Sesion s = sesion;
        if (s == null) return false;
        boolean alguna = false;
        for (PantallaProtocolo.Accion a : r.acciones) {
            if (!s.hechas.registrar(a.id)) {
                // ya ejecutada: NO se repite. Si el servidor la reentrega es que no recibió la confirmación: se reenvía.
                String antes = s.resultadoHechas.get(a.id);
                if (antes != null && !s.confirmadas.contains(a.id)) {
                    s.confirmadas.add(a.id);
                    s.resultados.put(a.id, antes);
                }
                continue;
            }
            // 2.11.0: acciones atadas al cuadro. Una acción obsoleta (llegó antes del primer cuadro, o el administrador
            // miró otra imagen) se CONFIRMA como «obsoleta» sin ejecutarla; un texto inválido, como «texto_invalido».
            String resultado = PantallaProtocolo.resultadoPrevio(a, s.cuadroEnviado, s.imagen, SystemClock.elapsedRealtime());
            if (resultado == null) resultado = a.rechazo != null ? a.rechazo : ejecutar(a);
            s.resultadoHechas.put(a.id, resultado);
            s.confirmadas.add(a.id);
            s.resultados.put(a.id, resultado);
            Log.i(TAG, "accion " + a.id + " " + a.a + " -> " + resultado);
            alguna = true;
        }
        return alguna;
    }

    /**
     * Manda un cuerpo firmado y devuelve la respuesta ya leída, o null si no hubo respuesta, no fue 2xx o la
     * firma de la respuesta no es válida o su «eco» no es el ts enviado (en ese caso NUNCA se ejecuta nada).
     */
    private PantallaProtocolo.Respuesta enviar(SigningRule regla, String url, String cuerpo, long ts) {
        try {
            Request req = new Request(url, cuerpo);
            req.setUseChunkedMode(false);
            // 2.11.0: /pantalla NO hereda el «ignorar errores de certificado» de la regla (ni va por http: ver urlPantalla).
            req.setIgnoreSsl(false);
            req.setSignatureHeader(regla.secret, cuerpo);
            String res = req.execute();
            if (!Request.RESULT_SUCCESS.equals(res)) return null;
            if (!PantallaProtocolo.respuestaFirmada(req.getResponseCode(), req.getResponseBody(),
                    req.getResponseSignature(), regla.secret)) {
                Log.e(TAG, "respuesta sin firma valida: se ignora");
                return null;
            }
            PantallaProtocolo.Respuesta r = PantallaProtocolo.parsear(req.getResponseBody());
            if (!r.ecoCoincide(ts)) {
                Log.e(TAG, "respuesta con eco distinto al ts enviado: se ignora");
                return null;
            }
            return r.ok ? r : null;
        } catch (Throwable e) {
            Log.e(TAG, "enviar: " + e);
            return null;
        }
    }

    // ------------------------------------------------------------------ captura

    /** Captura la pantalla (Android 11+). null si no se pudo (pantalla apagada, ventana protegida, Android viejo). */
    Bitmap capturar(long timeoutMs) {
        if (Build.VERSION.SDK_INT < 30) return null;
        return PantallaCaptura.capturar(this, ejecutorCaptura, timeoutMs);
    }

    /** Reduce a ANCHO_MAX de ancho (mantiene la proporción). Devuelve el mismo bitmap si ya es más angosto. */
    static Bitmap escalar(Bitmap b) {
        if (b.getWidth() <= ANCHO_MAX) return b;
        int h = Math.max(1, Math.round(b.getHeight() * (ANCHO_MAX / (float) b.getWidth())));
        return Bitmap.createScaledBitmap(b, ANCHO_MAX, h, true);
    }

    /** JPEG con la calidad base; si pasa del tope baja la calidad hasta que quepa. */
    static byte[] jpeg(Bitmap b) {
        int calidad = CALIDAD_JPEG;
        byte[] out;
        do {
            ByteArrayOutputStream bos = new ByteArrayOutputStream(64 * 1024);
            b.compress(Bitmap.CompressFormat.JPEG, calidad, bos);
            out = bos.toByteArray();
            calidad -= 10;
        } while (out.length > MAX_JPEG_BYTES && calidad >= 15);
        return out;
    }

    private static String sha1(byte[] b) {
        try {
            return Request.convertByteToHexadecimal(MessageDigest.getInstance("SHA-1").digest(b));
        } catch (Exception e) {
            return String.valueOf(b.length);
        }
    }

    // ------------------------------------------------------------------ acciones

    /** Ejecuta una acción ya validada. @return "ok", "fallo" o "no_soportado". */
    String ejecutar(PantallaProtocolo.Accion a) {
        try {
            switch (a.a) {
                case PantallaProtocolo.TOQUE:
                    return gesto(a.x, a.y, a.x, a.y, 60);
                case PantallaProtocolo.LARGO:
                    return gesto(a.x, a.y, a.x, a.y, a.ms);
                case PantallaProtocolo.DESLIZAR:
                    return gesto(a.x1, a.y1, a.x2, a.y2, a.ms);
                case PantallaProtocolo.ATRAS:
                    return global(GLOBAL_ACTION_BACK);
                case PantallaProtocolo.INICIO:
                    return global(GLOBAL_ACTION_HOME);
                case PantallaProtocolo.RECIENTES:
                    return global(GLOBAL_ACTION_RECENTS);
                case PantallaProtocolo.NOTIFICACIONES:
                    return global(GLOBAL_ACTION_NOTIFICATIONS);
                case PantallaProtocolo.TEXTO:
                    return escribir(a.t, 0);
                case PantallaProtocolo.BORRAR:
                    return escribir(null, a.n);
                case PantallaProtocolo.ENCENDER:
                    return encender();
                case PantallaProtocolo.ABRIR_AJUSTE:
                    return abrirAjuste(a.que);
                default:
                    return "no_soportado";
            }
        } catch (Throwable e) {
            Log.e(TAG, "ejecutar " + a.a + ": " + e);
            return "fallo";
        }
    }

    /**
     * 2.12.0: abre una pantalla de Ajustes de la lista cerrada (AjustesRemotos) por intent; solo la ABRE (no cambia nada).
     * Prueba los candidatos en orden y confirma «ok:<código del que abrió>», o «no_disponible» si ninguno abrió.
     */
    private String abrirAjuste(String que) {
        for (AjustesRemotos.Candidato c : AjustesRemotos.candidatos(que)) {
            try {
                android.content.Intent i;
                if (c.accion != null) {
                    i = new android.content.Intent(c.accion);
                    if (c.conPaqueteDeLaApp) i.setData(android.net.Uri.fromParts("package", getPackageName(), null));
                } else {
                    i = new android.content.Intent();
                    i.setComponent(new android.content.ComponentName(c.paquete, c.clase));
                }
                i.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(i);
                return AjustesRemotos.resultadoOk(c.codigo);
            } catch (Throwable e) {
                Log.i(TAG, "abrir_ajuste " + que + ": " + c.codigo + " no abrio (" + e.getClass().getSimpleName() + ")");
            }
        }
        return AjustesRemotos.NO_DISPONIBLE;
    }

    /**
     * 2.12.0 (actualización automática): si Android pidió confirmar la instalación, pulsa «Instalar»/«Actualizar» del diálogo del
     * instalador del sistema. Solo actúa si la ventana activa es del paquete del instalador que Android dio para NUESTRA sesión, y
     * solo pulsa un botón cuyo texto sea exactamente uno de Actualizador.TEXTOS_BOTON. No lee ni guarda nada más.
     * @return true si pulsó
     */
    boolean pulsarBotonInstalador(String paqueteInstalador) {
        try {
            // La ventana activa puede ser otra (p. ej. un aviso del sistema encima): se buscan todas las ventanas
            // interactivas y se actua solo sobre la que es del instalador del sistema.
            AccessibilityNodeInfo activa = getRootInActiveWindow();
            if (activa != null && activa.getPackageName() != null && paqueteInstalador.contentEquals(activa.getPackageName())) {
                if (pulsarEn(activa, paqueteInstalador)) return true;
            }
            List<AccessibilityWindowInfo> ventanas = getWindows();
            if (ventanas != null) {
                for (AccessibilityWindowInfo w : ventanas) {
                    AccessibilityNodeInfo r = w.getRoot();
                    if (r == null || r.getPackageName() == null || !paqueteInstalador.contentEquals(r.getPackageName())) continue;
                    if (pulsarEn(r, paqueteInstalador)) return true;
                }
            }
        } catch (Throwable e) {
            Log.w(TAG, "pulsar boton del instalador: " + e);
        }
        return false;
    }

    private boolean pulsarEn(AccessibilityNodeInfo raiz, String paqueteInstalador) {
        for (String texto : Actualizador.TEXTOS_BOTON) {
            List<AccessibilityNodeInfo> nodos = raiz.findAccessibilityNodeInfosByText(texto);
            if (nodos == null) continue;
            for (AccessibilityNodeInfo n : nodos) {
                CharSequence t = n.getText();
                if (t == null || !t.toString().trim().equalsIgnoreCase(texto) || !n.isEnabled()) continue;
                if (n.getPackageName() == null || !paqueteInstalador.contentEquals(n.getPackageName())) continue;
                AccessibilityNodeInfo clic = n;
                for (int i = 0; i < 3 && clic != null && !clic.isClickable(); i++) clic = clic.getParent();
                if (clic != null && clic.isClickable() && clic.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return true;
            }
        }
        return false;
    }

    private String gesto(double x1, double y1, double x2, double y2, int ms) {
        if (Build.VERSION.SDK_INT < 24) return "no_soportado";
        DisplayMetrics dm = new DisplayMetrics();
        WindowManager wm = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
        if (wm == null) return "fallo";
        wm.getDefaultDisplay().getRealMetrics(dm);
        float px1 = (float) (x1 * (dm.widthPixels - 1)), py1 = (float) (y1 * (dm.heightPixels - 1));
        float px2 = (float) (x2 * (dm.widthPixels - 1)), py2 = (float) (y2 * (dm.heightPixels - 1));
        return PantallaGestos.trazo(this, px1, py1, px2, py2, ms) ? "ok" : "fallo";
    }

    private String global(int accion) {
        return performGlobalAction(accion) ? "ok" : "fallo";
    }

    /**
     * Teclea en el campo con foco: agrega {@code agregar} al final, o quita {@code quitar} caracteres del final
     * (como el teclado). Solo busca el campo con foco; no lee ni guarda lo que hay en pantalla.
     */
    private String escribir(String agregar, int quitar) {
        if (Build.VERSION.SDK_INT < 21) return "no_soportado";
        AccessibilityNodeInfo raiz = getRootInActiveWindow();
        if (raiz == null) return "fallo";
        AccessibilityNodeInfo campo = null;
        try {
            campo = raiz.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
            if (campo == null || !campo.isEditable()) return "fallo";
            // Android guarda en caché lo que ya vio del campo y este servicio no pide eventos de texto:
            // se refresca para leer lo que hay AHORA (si no, «agregar» pisaría lo escrito antes).
            campo.refresh();
            CharSequence actual = campo.getText();
            String base = (actual == null || (Build.VERSION.SDK_INT >= 26 && campo.isShowingHintText())) ? "" : actual.toString();
            String nuevo;
            if (agregar != null) {
                nuevo = base + agregar;
            } else {
                nuevo = base.substring(0, Math.max(0, base.length() - quitar));
            }
            Bundle args = new Bundle();
            args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, nuevo);
            return campo.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args) ? "ok" : "fallo";
        } finally {
            try {
                if (campo != null) campo.recycle();
                raiz.recycle();
            } catch (Throwable ignored) {
            }
        }
    }

    /** Enciende la pantalla un momento (el bloqueo con clave o patrón no se puede saltar desde aquí). */
    @SuppressWarnings("deprecation")
    private String encender() {
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm == null) return "fallo";
        PowerManager.WakeLock wl = pm.newWakeLock(PowerManager.FULL_WAKE_LOCK
                | PowerManager.ACQUIRE_CAUSES_WAKEUP | PowerManager.ON_AFTER_RELEASE, "labomba:pantalla");
        wl.acquire(5000);
        return "ok";
    }

    // ------------------------------------------------------------------ estado de la pantalla

    @SuppressWarnings("deprecation")
    private boolean pantallaEncendida() {
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm == null) return true;
            return Build.VERSION.SDK_INT >= 20 ? pm.isInteractive() : pm.isScreenOn();
        } catch (Throwable e) {
            return true;
        }
    }

    private boolean pantallaBloqueada() {
        try {
            if (Build.VERSION.SDK_INT < 22) return false;
            KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
            return km != null && km.isKeyguardLocked();
        } catch (Throwable e) {
            return false;
        }
    }

    /** Mantiene la CPU despierta mientras dura la sesión (con tope, nunca queda pegado). */
    private void tomarCpu(long ms) {
        try {
            liberarCpu();
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm == null) return;
            cpu = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "labomba:pantalla-sesion");
            cpu.setReferenceCounted(false);
            cpu.acquire(ms);
        } catch (Throwable ignored) {
        }
    }

    private void liberarCpu() {
        try {
            if (cpu != null && cpu.isHeld()) cpu.release();
        } catch (Throwable ignored) {
        }
        cpu = null;
    }
}
