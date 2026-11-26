package tech.bogomolov.incomingsmsgateway;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

import java.util.ArrayList;
import java.util.List;

/** La Bomba 2.12.0: autochequeo «recibe pero no reenvía» (JVM pura). */
public class AutoChequeoSmsTest {

    private static final long AHORA = 1_790_000_000_000L;
    private static final long MIN = 60_000L;
    private static final long H = 3600_000L;

    /** Cubre SMS de «4066» que contengan «SINPE», como la regla real. */
    private static final AutoChequeoSms.Cubre REGLA = (de, texto) -> de.equals("4066") && texto.contains("SINPE");

    private static AutoChequeoSms.Sms sms(String de, String texto, long fecha) {
        return new AutoChequeoSms.Sms(de, texto, fecha);
    }

    @Test
    public void cuentaLosCubiertosPosterioresAlUltimoReenvio() {
        List<AutoChequeoSms.Sms> b = new ArrayList<>();
        b.add(sms("4066", "SINPE 1", AHORA - 30 * MIN));   // antes del último reenvío: ya estaba
        b.add(sms("4066", "SINPE 2", AHORA - 10 * MIN));   // después: sin reenviar
        b.add(sms("4066", "SINPE 3", AHORA - 5 * MIN));    // después: sin reenviar
        assertEquals(2, AutoChequeoSms.contar(b, AHORA - 20 * MIN, AHORA, REGLA));
    }

    @Test
    public void unSmsMuyRecienteTodaviaPuedeIrEnCamino() {
        List<AutoChequeoSms.Sms> b = new ArrayList<>();
        b.add(sms("4066", "SINPE", AHORA - 20_000));        // hace 20 s: no cuenta
        b.add(sms("4066", "SINPE", AHORA - 61_000));        // hace 61 s: cuenta
        assertEquals(1, AutoChequeoSms.contar(b, 0, AHORA, REGLA));
    }

    @Test
    public void soloLasUltimas48Horas() {
        List<AutoChequeoSms.Sms> b = new ArrayList<>();
        b.add(sms("4066", "SINPE viejo", AHORA - 49 * H));
        b.add(sms("4066", "SINPE", AHORA - 47 * H));
        assertEquals(1, AutoChequeoSms.contar(b, 0, AHORA, REGLA));
    }

    @Test
    public void losQueNoCubreLaReglaNoCuentan() {
        List<AutoChequeoSms.Sms> b = new ArrayList<>();
        b.add(sms("5555", "SINPE de otro remitente", AHORA - 10 * MIN));
        b.add(sms("4066", "promocion sin la palabra", AHORA - 10 * MIN));
        assertEquals(0, AutoChequeoSms.contar(b, 0, AHORA, REGLA));
    }

    @Test
    public void bandejaVaciaONula() {
        assertEquals(0, AutoChequeoSms.contar(new ArrayList<>(), 0, AHORA, REGLA));
        assertEquals(0, AutoChequeoSms.contar(null, 0, AHORA, REGLA));
        assertEquals(0, AutoChequeoSms.contar(new ArrayList<>(), 0, AHORA, null));
        assertEquals(0, AutoChequeoSms.masNuevo(null));
    }

    @Test
    public void topeDe999() {
        List<AutoChequeoSms.Sms> b = new ArrayList<>();
        for (int i = 0; i < 1500; i++) b.add(sms("4066", "SINPE " + i, AHORA - 10 * MIN - i));
        assertEquals(999, AutoChequeoSms.contar(b, 0, AHORA, REGLA));
    }

    @Test
    public void masNuevoDevuelveLaFechaMayor() {
        List<AutoChequeoSms.Sms> b = new ArrayList<>();
        b.add(sms("a", "x", 100));
        b.add(sms("b", "y", 900));
        b.add(sms("c", "z", 500));
        assertEquals(900, AutoChequeoSms.masNuevo(b));
    }

    @Test
    public void elReenvioPosteriorBorraLaAlarma() {
        List<AutoChequeoSms.Sms> b = new ArrayList<>();
        b.add(sms("4066", "SINPE", AHORA - 10 * MIN));
        assertEquals(1, AutoChequeoSms.contar(b, AHORA - 20 * MIN, AHORA, REGLA));
        // se reenvía el historial (o llega y se reenvía otro SMS): el último reenvío ya es posterior
        assertEquals(0, AutoChequeoSms.contar(b, AHORA - MIN, AHORA, REGLA));
    }
}
