package tech.bogomolov.incomingsmsgateway;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import tech.bogomolov.incomingsmsgateway.SmsDespertar.Resultado;

/** La Bomba 2.11.0: SMS de despertar «LB1 orden contador firma» (JVM pura). */
public class SmsDespertarTest {

    private static final String K = "claveprueba";

    private static String firmado(String cmd, long n, int largoFirma) throws Exception {
        return "LB1 " + cmd + " " + n + " " + SmsDespertar.firmaCompleta(K, cmd, n).substring(0, largoFirma);
    }

    // ------------------------------------------------------------------ formato

    @Test
    public void esLB1SoloSiEmpiezaConElPrefijoSeguidoDeEspacioOFin() {
        assertTrue(SmsDespertar.esLB1("LB1 latido_ya 1 abcdef0123"));
        assertTrue(SmsDespertar.esLB1("lb1 latido_ya 1 abcdef0123"));
        assertTrue(SmsDespertar.esLB1("  Lb1\tlatido_ya"));
        assertTrue(SmsDespertar.esLB1("LB1"));
        assertTrue(SmsDespertar.esLB1("LB1\nxx"));
        assertFalse("pegado a otra cosa no es el prefijo", SmsDespertar.esLB1("LB1x latido_ya 1 abcdef0123"));
        assertFalse(SmsDespertar.esLB1("LB10 latido_ya"));
        assertFalse(SmsDespertar.esLB1("Recibiste un SINPE Movil por 5000. LB1 latido"));
        assertFalse(SmsDespertar.esLB1("LB"));
        assertFalse(SmsDespertar.esLB1(""));
        assertFalse(SmsDespertar.esLB1(null));
    }

    @Test
    public void analizaCuatroCamposYNormalizaMayusculasYEspacios() throws Exception {
        SmsDespertar.Orden o = SmsDespertar.analizar("  LB1   LATIDO_YA \t 0007  ABCDEF0123 \n");
        assertNotNull(o);
        assertEquals("latido_ya", o.cmd);
        assertEquals(7, o.contador);
        assertEquals("abcdef0123", o.firma);
    }

    @Test
    public void rechazaLoQueNoTieneLaForma() {
        String[] malos = {
                "LB1", "LB1 latido_ya", "LB1 latido_ya 5", "LB1 latido_ya 5 abcdef0123 extra",
                "LB1 latido_ya cinco abcdef0123", "LB1 latido_ya -5 abcdef0123", "LB1 latido_ya 0 abcdef0123",
                "LB1 latido_ya 5 abcdef012",                       // firma de 9 (menos de 10)
                "LB1 latido_ya 5 " + "a".repeat(65),               // firma de 65
                "LB1 latido_ya 5 abcdef01zz",                      // no hex
                "LB1 latido-ya 5 abcdef0123", "LB1 latido1 5 abcdef0123",
                "LB1 " + "a".repeat(25) + " 5 abcdef0123",
                "LB1 latido_ya 1234567890123456 abcdef0123",       // contador de 16 digitos
                "LB1 latido_ya ٥ abcdef0123",                 // digito arabe-indico: no es ASCII
                "LB1 latido_ya 5 abcdef0123 " + "x".repeat(130)    // demasiado largo
        };
        for (String m : malos) assertNull("deberia rechazar: " + m, SmsDespertar.analizar(m));
    }

    @Test
    public void largoMaximoDelCuerpo() throws Exception {
        String ok = "LB1 reiniciar_servicio 123456 " + "a".repeat(SmsDespertar.FIRMA_MAX);   // la orden mas larga con firma completa
        assertTrue(ok.length() <= SmsDespertar.LARGO_MAX);
        assertNotNull(SmsDespertar.analizar(ok));
        assertNull("firma de 65", SmsDespertar.analizar("LB1 latido_ya 5 " + "a".repeat(65)));
        assertNull(SmsDespertar.analizar("LB1 latido_ya 5 abcdef0123 " + "x".repeat(SmsDespertar.LARGO_MAX)));
        assertNull(SmsDespertar.analizar("x".repeat(500)));
    }

    // ------------------------------------------------------------------ firma

    @Test
    public void laFirmaEsHmacSha256DeLB1CmdContadorYAceptaPrefijosDeDiezOMas() throws Exception {
        String completa = SmsDespertar.firmaCompleta(K, "reiniciar_servicio", 42);
        assertEquals(64, completa.length());
        // calculo independiente
        javax.crypto.Mac mac = javax.crypto.Mac.getInstance("HmacSHA256");
        mac.init(new javax.crypto.spec.SecretKeySpec(K.getBytes("UTF-8"), "HmacSHA256"));
        StringBuilder esperado = new StringBuilder();
        for (byte b : mac.doFinal("LB1 reiniciar_servicio 42".getBytes("UTF-8"))) esperado.append(String.format("%02x", b));
        assertEquals(esperado.toString(), completa);
        for (int largo : new int[]{10, 12, 20, 32, 64}) {
            assertEquals("largo " + largo, Resultado.OK, SmsDespertar.validar(firmado("reiniciar_servicio", 42, largo), K, 0));
        }
    }

    @Test
    public void unaFirmaDeNueveCaracteresOMalaOConOtraClaveNoSirve() throws Exception {
        assertEquals(Resultado.FORMATO, SmsDespertar.validar("LB1 latido_ya 5 " + SmsDespertar.firmaCompleta(K, "latido_ya", 5).substring(0, 9), K, 0));
        String mala = "LB1 latido_ya 5 " + "0".repeat(12);
        assertEquals(Resultado.FIRMA_MALA, SmsDespertar.validar(mala, K, 0));
        assertEquals(Resultado.FIRMA_MALA, SmsDespertar.validar(firmado("latido_ya", 5, 20), "otraclave", 0));
        // cambiar un solo caracter de la firma la invalida
        String f = SmsDespertar.firmaCompleta(K, "latido_ya", 5).substring(0, 12);
        char c = f.charAt(11) == 'a' ? 'b' : 'a';
        assertEquals(Resultado.FIRMA_MALA, SmsDespertar.validar("LB1 latido_ya 5 " + f.substring(0, 11) + c, K, 0));
    }

    @Test
    public void laFirmaNoSirveParaOtraOrdenNiOtroContador() throws Exception {
        String f = SmsDespertar.firmaCompleta(K, "latido_ya", 5).substring(0, 16);
        assertEquals(Resultado.OK, SmsDespertar.validar("LB1 latido_ya 5 " + f, K, 0));
        assertEquals("otra orden", Resultado.FIRMA_MALA, SmsDespertar.validar("LB1 reiniciar_servicio 5 " + f, K, 0));
        assertEquals("otro contador", Resultado.FIRMA_MALA, SmsDespertar.validar("LB1 latido_ya 6 " + f, K, 0));
    }

    @Test
    public void mayusculasEspaciosYCerosNoCambianLaValidez() throws Exception {
        String f = SmsDespertar.firmaCompleta(K, "latido_ya", 9).substring(0, 14);
        assertEquals(Resultado.OK, SmsDespertar.validar("lb1   LATIDO_YA  009\t" + f.toUpperCase() + "  ", K, 0));
        assertEquals(Resultado.OK, SmsDespertar.validar("LB1 latido_ya 9 " + f.toUpperCase(), K, 0));
    }

    @Test
    public void sinClaveNoSeAceptaNada() throws Exception {
        assertEquals(Resultado.SIN_CLAVE, SmsDespertar.validar(firmado("latido_ya", 5, 12), null, 0));
        assertEquals(Resultado.SIN_CLAVE, SmsDespertar.validar(firmado("latido_ya", 5, 12), "", 0));
    }

    // ------------------------------------------------------------------ órdenes cerradas

    @Test
    public void soloLasTresOrdenesDeLaListaCerrada() throws Exception {
        for (String c : new String[]{"latido_ya", "reiniciar_servicio", "reenviar_historial"}) {
            assertEquals(c, Resultado.OK, SmsDespertar.validar(firmado(c, 3, 12), K, 0));
        }
        // firmadas CORRECTAMENTE pero fuera de la lista: nunca
        for (String c : new String[]{"reiniciar_telefono", "borrar_todo", "pantalla", "despertar", "latido", "encender", "formatear"}) {
            assertEquals(c, Resultado.ORDEN_DESCONOCIDA, SmsDespertar.validar(firmado(c, 3, 12), K, 0));
        }
    }

    @Test
    public void unaOrdenFueraDeListaConFirmaMalaSoloDiceFirmaMala() throws Exception {
        assertEquals(Resultado.FIRMA_MALA, SmsDespertar.validar("LB1 borrar_todo 3 " + "0".repeat(12), K, 0));
    }

    // ------------------------------------------------------------------ contador

    @Test
    public void elContadorDebeSerEstrictamenteCreciente() throws Exception {
        assertEquals(Resultado.OK, SmsDespertar.validar(firmado("latido_ya", 11, 12), K, 10));
        assertEquals("igual al ultimo", Resultado.CONTADOR_REPETIDO, SmsDespertar.validar(firmado("latido_ya", 10, 12), K, 10));
        assertEquals("menor", Resultado.CONTADOR_REPETIDO, SmsDespertar.validar(firmado("latido_ya", 9, 12), K, 10));
        assertEquals(Resultado.OK, SmsDespertar.validar(firmado("latido_ya", 1, 12), K, 0));
    }

    @Test
    public void repeticionDelMismoSmsEsRechazadaDespuesDeAceptarlo() throws Exception {
        String sms = firmado("reenviar_historial", 100, 12);
        SmsDespertar.Orden[] sal = new SmsDespertar.Orden[1];
        assertEquals(Resultado.OK, SmsDespertar.validarOrden(sms, K, 99, sal));
        long ultimo = sal[0].contador;   // lo que guardaria GuardianState
        assertEquals(100, ultimo);
        assertEquals(Resultado.CONTADOR_REPETIDO, SmsDespertar.validar(sms, K, ultimo));
        assertEquals(Resultado.CONTADOR_REPETIDO, SmsDespertar.validar(sms.toLowerCase(), K, ultimo));
    }

    @Test
    public void unSaltoMayorDeMilNoDejaSordaALaApp() throws Exception {
        assertEquals(Resultado.OK, SmsDespertar.validar(firmado("latido_ya", 1010, 12), K, 10));
        assertEquals(Resultado.CONTADOR_SALTO, SmsDespertar.validar(firmado("latido_ya", 1011, 12), K, 10));
        assertEquals(Resultado.CONTADOR_SALTO, SmsDespertar.validar(firmado("latido_ya", 999_999_999L, 12), K, 10));
        assertEquals("instalacion nueva (contador guardado 0): vale cualquiera",
                Resultado.OK, SmsDespertar.validar(firmado("latido_ya", 5000, 12), K, 0));
    }

    @Test
    public void unSmsNormalNoEsLB1() {
        assertEquals(Resultado.NO_ES_LB1, SmsDespertar.validar("Recibiste un SINPE Movil por 5000 colones", K, 0));
        assertEquals(Resultado.NO_ES_LB1, SmsDespertar.validar(null, K, 0));
    }

    @Test
    public void validarOrdenDejaLaOrdenSoloSiEsValida() throws Exception {
        SmsDespertar.Orden[] sal = new SmsDespertar.Orden[1];
        assertEquals(Resultado.FIRMA_MALA, SmsDespertar.validarOrden("LB1 latido_ya 5 " + "0".repeat(12), K, 0, sal));
        assertNull(sal[0]);
        assertEquals(Resultado.OK, SmsDespertar.validarOrden(firmado("latido_ya", 5, 12), K, 0, sal));
        assertEquals("latido_ya", sal[0].cmd);
    }
}
