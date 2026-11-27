package tech.bogomolov.incomingsmsgateway;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.json.JSONObject;
import org.junit.Test;

import java.nio.charset.StandardCharsets;

/** La Bomba 2.12.0: reglas de la actualización automática (JVM pura, org.json real). */
public class ActualizacionPoliticaTest {

    private static final String CLAVE = "claveprueba";
    private static final String URL_BUENA = "https://pagos.dmalabomba.com/instalar/reenviador-sms-la-bomba-2.12.0.apk";
    private static final String SHA = "2163fad5b0c1f2d9a1b0c9d8e7f60514233445566778899aabbccddeeff0f8e1";
    private static final long AHORA = 1_790_000_000_000L;
    private static final long ECO = AHORA - 5_000L;

    private static String firmar(String v, long vc, String url, String sha, long ts, long eco) throws Exception {
        return Request.computeHmacSha256Hex(CLAVE, "ACT1|" + v + "|" + vc + "|" + url + "|" + sha + "|" + ts + "|" + eco);
    }

    private static String respuesta(String v, long vc, String url, String sha, long ts, long eco, String firma) throws Exception {
        JSONObject a = new JSONObject();
        a.put("v", v);
        a.put("vc", vc);
        a.put("url", url);
        a.put("sha256", sha);
        a.put("ts", ts);
        if (firma != null) a.put("firma", firma);
        JSONObject r = new JSONObject();
        r.put("ok", true);
        r.put("eco", eco);
        r.put("actualizacion", a);
        return r.toString();
    }

    private static String buena() throws Exception {
        long ts = AHORA - 3_600_000L;
        return respuesta("2.12.0", 22, URL_BUENA, SHA, ts, ECO, firmar("2.12.0", 22, URL_BUENA, SHA, ts, ECO));
    }

    private static ActualizacionPolitica.Lectura leer(String cuerpo) {
        return ActualizacionPolitica.leer(cuerpo, CLAVE, ECO, AHORA, false);
    }

    @Test
    public void ofertaValidaSeAcepta() throws Exception {
        ActualizacionPolitica.Lectura l = leer(buena());
        assertNotNull(l.rechazo, l.oferta);
        assertEquals("2.12.0", l.oferta.v);
        assertEquals(22, l.oferta.vc);
        assertEquals(URL_BUENA, l.oferta.url);
        assertEquals(SHA, l.oferta.sha256);
    }

    @Test
    public void sinOfertaNoEsError() {
        ActualizacionPolitica.Lectura l = leer("{\"comandos\":[]}");
        assertNull(l.oferta);
        assertNull(l.rechazo);
        assertNull(leer(null).oferta);
        assertNull(leer("no es json").oferta);
    }

    @Test
    public void sinFirmaOFirmaMalaNoInstala() throws Exception {
        long ts = AHORA - 1000;
        assertEquals("firma_invalida", leer(respuesta("2.12.0", 22, URL_BUENA, SHA, ts, ECO, null)).rechazo);
        String mala = firmar("2.12.0", 22, URL_BUENA, SHA, ts, ECO).replace('a', 'b').replace('0', '1');
        assertNull(leer(respuesta("2.12.0", 22, URL_BUENA, SHA, ts, ECO, mala)).oferta);
        // firmada con otra clave
        String otra = Request.computeHmacSha256Hex("otraclave", "ACT1|2.12.0|22|" + URL_BUENA + "|" + SHA + "|" + ts + "|" + ECO);
        assertEquals("firma_invalida", leer(respuesta("2.12.0", 22, URL_BUENA, SHA, ts, ECO, otra)).rechazo);
    }

    @Test
    public void cualquierCampoCambiadoRompeLaFirma() throws Exception {
        long ts = AHORA - 1000;
        String f = firmar("2.12.0", 22, URL_BUENA, SHA, ts, ECO);
        // el atacante cambia la URL, el sha, la versión o el vc conservando la firma
        String otraUrl = "https://pagos.dmalabomba.com/instalar/otro.apk";
        assertNull(leer(respuesta("2.12.0", 22, otraUrl, SHA, ts, ECO, f)).oferta);
        assertNull(leer(respuesta("2.12.0", 22, URL_BUENA, SHA.replace('2', '3'), ts, ECO, f)).oferta);
        assertNull(leer(respuesta("2.12.1", 22, URL_BUENA, SHA, ts, ECO, f)).oferta);
        assertNull(leer(respuesta("2.12.0", 23, URL_BUENA, SHA, ts, ECO, f)).oferta);
        assertNull(leer(respuesta("2.12.0", 22, URL_BUENA, SHA, ts + 1, ECO, f)).oferta);
    }

    @Test
    public void elEcoDebeSerElTsEnviado() throws Exception {
        // respuesta repetida de otro latido: firmada bien pero con otro eco
        long ts = AHORA - 1000;
        long ecoViejo = ECO - 600_000;
        assertEquals("eco_distinto", leer(respuesta("2.12.0", 22, URL_BUENA, SHA, ts, ecoViejo, firmar("2.12.0", 22, URL_BUENA, SHA, ts, ecoViejo))).rechazo);
        // sin eco
        JSONObject o = new JSONObject(buena());
        o.remove("eco");
        assertEquals("eco_distinto", leer(o.toString()).rechazo);
    }

    @Test
    public void tsDeLaOfertaDebeSerReciente() throws Exception {
        long vieja = AHORA - 24L * 3600_000L - 1000;
        assertEquals("ts_fuera_de_vigencia", leer(respuesta("2.12.0", 22, URL_BUENA, SHA, vieja, ECO, firmar("2.12.0", 22, URL_BUENA, SHA, vieja, ECO))).rechazo);
        long futura = AHORA + 10 * 60_000L;
        assertEquals("ts_fuera_de_vigencia", leer(respuesta("2.12.0", 22, URL_BUENA, SHA, futura, ECO, firmar("2.12.0", 22, URL_BUENA, SHA, futura, ECO))).rechazo);
        long justa = AHORA - 24L * 3600_000L + 1000;
        assertNotNull(leer(respuesta("2.12.0", 22, URL_BUENA, SHA, justa, ECO, firmar("2.12.0", 22, URL_BUENA, SHA, justa, ECO))).oferta);
        assertTrue(ActualizacionPolitica.vigente(AHORA, AHORA));
        assertFalse(ActualizacionPolitica.vigente(AHORA - 25L * 3600_000L, AHORA));
    }

    @Test
    public void soloElHostExactoPorHttps() {
        assertTrue(ActualizacionPolitica.urlPermitida(URL_BUENA, false));
        assertTrue(ActualizacionPolitica.urlPermitida("https://PAGOS.dmalabomba.com/instalar/a.apk", false));
        assertTrue(ActualizacionPolitica.urlPermitida("https://pagos.dmalabomba.com:443/instalar/a.apk", false));
        String[] malas = {
                "http://pagos.dmalabomba.com/instalar/a.apk",                 // sin https
                "https://pagos.dmalabomba.com.evil.com/instalar/a.apk",       // sufijo
                "https://evilpagos.dmalabomba.com/instalar/a.apk",            // prefijo
                "https://dmalabomba.com/instalar/a.apk",                      // otro host
                "https://pagos.dmalabomba.com@evil.com/instalar/a.apk",       // usuario
                "https://evil.com@pagos.dmalabomba.com/instalar/a.apk",       // usuario aunque el host coincida
                "https://pagos.dmalabomba.com:8443/instalar/a.apk",           // puerto
                "https://pagos.dmalabomba.com/instalar/a.apk?x=1",            // consulta
                "https://pagos.dmalabomba.com/instalar/a.apk#x",              // fragmento
                "https://pagos.dmalabomba.com/otra/a.apk",                    // otra ruta
                "https://pagos.dmalabomba.com/instalar/../a.apk",             // subida de carpeta
                "https://pagos.dmalabomba.com/instalar/a.zip",                // no es apk
                "https://pagos.dmalabomba.com/instalar/",                     // sin archivo
                "https://pagos.dmalabomba.com\\@evil.com/instalar/a.apk",     // barra invertida
                "https://pagos.dmalabomba.com/instalar/a b.apk",              // espacio
                "ftp://pagos.dmalabomba.com/instalar/a.apk",
                "file:///instalar/a.apk",
                "", null,
        };
        for (String u : malas) assertFalse(String.valueOf(u), ActualizacionPolitica.urlPermitida(u, false));
    }

    @Test
    public void elServidorDePruebasSoloExisteEnDepuracion() {
        String prueba = "http://10.0.2.2:8099/instalar/app.apk";
        assertFalse("en produccion no debe existir", ActualizacionPolitica.urlPermitida(prueba, false));
        assertTrue(ActualizacionPolitica.urlPermitida(prueba, true));
        assertTrue(ActualizacionPolitica.urlPermitida("http://127.0.0.1:8099/instalar/app.apk", true));
        assertFalse(ActualizacionPolitica.urlPermitida("http://evil.com/instalar/app.apk", true));
        assertFalse(ActualizacionPolitica.urlPermitida("http://pagos.dmalabomba.com/instalar/app.apk", true));
    }

    @Test
    public void unaUrlMalaNoPasaAunqueVayaBienFirmada() throws Exception {
        long ts = AHORA - 1000;
        String mala = "https://evil.com/instalar/a.apk";
        assertEquals("url_no_permitida", leer(respuesta("2.12.0", 22, mala, SHA, ts, ECO, firmar("2.12.0", 22, mala, SHA, ts, ECO))).rechazo);
    }

    @Test
    public void formatosInvalidosSeRechazan() throws Exception {
        long ts = AHORA - 1000;
        assertEquals("version_invalida", leer(respuesta("2.12", 22, URL_BUENA, SHA, ts, ECO, firmar("2.12", 22, URL_BUENA, SHA, ts, ECO))).rechazo);
        assertEquals("sha256_invalido", leer(respuesta("2.12.0", 22, URL_BUENA, "ABC", ts, ECO, firmar("2.12.0", 22, URL_BUENA, "ABC", ts, ECO))).rechazo);
        assertEquals("vc_invalido", leer(respuesta("2.12.0", 0, URL_BUENA, SHA, ts, ECO, firmar("2.12.0", 0, URL_BUENA, SHA, ts, ECO))).rechazo);
        // sin clave configurada no se acepta nada
        assertEquals("sin_clave", ActualizacionPolitica.leer(buena(), "", ECO, AHORA, false).rechazo);
    }

    @Test
    public void soloVersionesMasNuevas() {
        assertTrue(ActualizacionPolitica.esMasNueva(22, 21));
        assertFalse(ActualizacionPolitica.esMasNueva(21, 21));
        assertFalse(ActualizacionPolitica.esMasNueva(20, 21));
    }

    @Test
    public void tresIntentosConEsperaCreciente() {
        long h = 3600_000L;
        long t0 = AHORA;
        assertTrue(ActualizacionPolitica.puedeIntentar(0, 0, AHORA));
        // tras el 1.º fallo espera 1 h
        assertFalse(ActualizacionPolitica.puedeIntentar(1, t0, t0 + h - 1));
        assertTrue(ActualizacionPolitica.puedeIntentar(1, t0, t0 + h));
        // tras el 2.º, 6 h
        assertFalse(ActualizacionPolitica.puedeIntentar(2, t0, t0 + 6 * h - 1));
        assertTrue(ActualizacionPolitica.puedeIntentar(2, t0, t0 + 6 * h));
        // tras el 3.º ya no se reintenta esa versión
        assertFalse(ActualizacionPolitica.puedeIntentar(3, t0, t0 + 48 * h));
        assertFalse(ActualizacionPolitica.puedeIntentar(4, t0, t0 + 480 * h));
        assertEquals(-1, ActualizacionPolitica.faltaParaIntentar(3, t0, t0 + h));
        assertEquals(h, ActualizacionPolitica.faltaParaIntentar(1, t0, t0));
        assertEquals(0, ActualizacionPolitica.faltaParaIntentar(0, 0, t0));
        // el reloj retrocedió: no se bloquea para siempre
        assertTrue(ActualizacionPolitica.puedeIntentar(1, t0 + 10 * h, t0));
    }

    @Test
    public void soloEnMomentoSeguro() {
        assertTrue(ActualizacionPolitica.momentoSeguro(0, 0, AHORA));
        assertFalse("con cola de reenvio pendiente", ActualizacionPolitica.momentoSeguro(1, 0, AHORA));
        assertFalse("SMS hace 10 s", ActualizacionPolitica.momentoSeguro(0, AHORA - 10_000, AHORA));
        assertFalse("SMS hace 59 s", ActualizacionPolitica.momentoSeguro(0, AHORA - 59_999, AHORA));
        assertTrue("SMS hace 60 s", ActualizacionPolitica.momentoSeguro(0, AHORA - 60_000, AHORA));
        assertTrue(ActualizacionPolitica.momentoSeguro(0, AHORA - 3600_000, AHORA));
        assertFalse("hora del SMS en el futuro (reloj movido): se espera", ActualizacionPolitica.momentoSeguro(0, AHORA + 5_000, AHORA));
    }

    @Test
    public void sha256YCertificado() {
        assertTrue(ActualizacionPolitica.sha256Coincide(SHA, SHA.toUpperCase()));
        assertFalse(ActualizacionPolitica.sha256Coincide(SHA, SHA.replace('2', '3')));
        assertFalse(ActualizacionPolitica.sha256Coincide(SHA, null));

        byte[] a = "certificado-A".getBytes(StandardCharsets.UTF_8);
        byte[] b = "certificado-B".getBytes(StandardCharsets.UTF_8);
        assertTrue(ActualizacionPolitica.mismosFirmantes(new byte[][]{a}, new byte[][]{a.clone()}));
        assertFalse("otro certificado", ActualizacionPolitica.mismosFirmantes(new byte[][]{a}, new byte[][]{b}));
        assertFalse("uno de mas", ActualizacionPolitica.mismosFirmantes(new byte[][]{a}, new byte[][]{a, b}));
        assertTrue("mismo conjunto en otro orden", ActualizacionPolitica.mismosFirmantes(new byte[][]{a, b}, new byte[][]{b, a}));
        assertFalse("sin firmas", ActualizacionPolitica.mismosFirmantes(new byte[0][], new byte[][]{a}));
        assertFalse("nulo", ActualizacionPolitica.mismosFirmantes(null, new byte[][]{a}));
        assertFalse("certificado vacio", ActualizacionPolitica.mismosFirmantes(new byte[][]{new byte[0]}, new byte[][]{new byte[0]}));
    }

    // ------------------------------------------------------------------ 2.12.0 (auditoría): tope global y límite de vc

    @Test
    public void topeGlobalDeDescargasPorDiaSinImportarLaVersion() {
        long h = 3_600_000L;
        assertEquals(3, ActualizacionPolitica.TOPE_DESCARGAS_DIA);
        assertTrue(ActualizacionPolitica.dentroDelTopeDiario(new long[0], AHORA, 3));
        assertTrue(ActualizacionPolitica.dentroDelTopeDiario(null, AHORA, 3));
        assertTrue("2 descargas: todavía se puede una", ActualizacionPolitica.dentroDelTopeDiario(new long[]{AHORA - h, AHORA - 2 * h}, AHORA, 3));
        assertFalse("3 en 24 h: tope alcanzado", ActualizacionPolitica.dentroDelTopeDiario(new long[]{AHORA - h, AHORA - 2 * h, AHORA - 3 * h}, AHORA, 3));
        assertFalse(ActualizacionPolitica.dentroDelTopeDiario(new long[]{AHORA, AHORA, AHORA, AHORA}, AHORA, 3));
        // las de hace 24 h o más ya no cuentan
        assertTrue(ActualizacionPolitica.dentroDelTopeDiario(
                new long[]{AHORA - 25 * h, AHORA - 24 * h, AHORA - 23 * h}, AHORA, 3));
        assertEquals(1, ActualizacionPolitica.descargasEnLaVentana(new long[]{AHORA - 25 * h, AHORA - 24 * h, AHORA - 23 * h}, AHORA));
        // un reloj retrocedido (marcas en el futuro lejano) no bloquea para siempre
        assertTrue(ActualizacionPolitica.dentroDelTopeDiario(new long[]{AHORA + 10 * h, AHORA + 11 * h, AHORA + 12 * h}, AHORA, 3));
    }

    @Test
    public void podarDescargasDejaSoloLasDeLasUltimas24hYAcota() {
        long h = 3_600_000L;
        long[] p = ActualizacionPolitica.podarDescargas(new long[]{AHORA - 30 * h, AHORA - 2 * h, AHORA - h}, AHORA);
        assertEquals(2, p.length);
        assertEquals(AHORA - 2 * h, p[0]);
        assertEquals(AHORA - h, p[1]);
        long[] muchas = new long[50];
        for (int i = 0; i < muchas.length; i++) muchas[i] = AHORA - (50 - i) * 1000L;
        assertEquals(ActualizacionPolitica.MAX_DESCARGAS_RECORDADAS, ActualizacionPolitica.podarDescargas(muchas, AHORA).length);
        assertEquals(0, ActualizacionPolitica.podarDescargas(null, AHORA).length);
    }

    @Test
    public void elLimiteDeVcCoincideConElDelServidor() throws Exception {
        long ts = AHORA - 3_600_000L;
        // 1 a 10.000.000 vale (el servidor rechaza vc > 1e7: ver CONTRATO-2.12.md); 0, negativo y 10.000.001 no
        for (long vc : new long[]{1, 22, 10_000_000L}) {
            ActualizacionPolitica.Lectura l = leer(respuesta("2.12.0", vc, URL_BUENA, SHA, ts, ECO, firmar("2.12.0", vc, URL_BUENA, SHA, ts, ECO)));
            assertNotNull("vc " + vc, l.oferta);
            assertEquals((int) vc, l.oferta.vc);
        }
        for (long vc : new long[]{0, -1, 10_000_001L, 2_147_483_648L}) {
            assertEquals("vc " + vc, "vc_invalido",
                    leer(respuesta("2.12.0", vc, URL_BUENA, SHA, ts, ECO, firmar("2.12.0", vc, URL_BUENA, SHA, ts, ECO))).rechazo);
        }
    }

    // ------------------------------------------------------------------ 27 nov 2026: anfitrión alterno, espera sin red, oferta guardada

    @Test
    public void elAnfitrionAlternoDePagesSeAcepta() {
        assertTrue(ActualizacionPolitica.urlPermitida("https://sinpe-pagos.pages.dev/instalar/reenviador-sms-la-bomba-2.12.0.apk", false));
        assertTrue(ActualizacionPolitica.urlPermitida("https://SINPE-PAGOS.pages.dev:443/instalar/a.apk", false));
    }

    @Test
    public void otrosAnfitrionesParecidosSiguenRechazados() {
        String[] malas = {
                "https://otro.pages.dev/instalar/a.apk",
                "https://sinpe-pagos.pages.dev.evil.com/instalar/a.apk",
                "https://evil.sinpe-pagos.pages.dev/instalar/a.apk",
                "https://sinpe-pagos.pages.dev:8443/instalar/a.apk",
                "http://sinpe-pagos.pages.dev/instalar/a.apk",
                "https://sinpe-pagos.pages.dev/otra/a.apk",
                "https://dwlbcbtwdungyrykgahm.supabase.co/instalar/a.apk",
        };
        for (String u : malas) assertFalse(u, ActualizacionPolitica.urlPermitida(u, false));
    }

    @Test
    public void unaOfertaFirmadaConElAnfitrionAlternoSeAcepta() throws Exception {
        String url = "https://sinpe-pagos.pages.dev/instalar/reenviador-sms-la-bomba-2.12.0.apk";
        long ts = AHORA - 3_600_000L;
        ActualizacionPolitica.Lectura l = leer(respuesta("2.12.0", 22, url, SHA, ts, ECO, firmar("2.12.0", 22, url, SHA, ts, ECO)));
        assertNotNull(l.rechazo, l.oferta);
        assertEquals(url, l.oferta.url);
    }

    @Test
    public void tras_unFalloSinRedSeEsperaQuinceMinutosYNada_mas() {
        long t = AHORA;
        assertTrue(ActualizacionPolitica.esperandoPorSinRed("fallo", "sin_red", t - 60_000L, t));
        assertTrue(ActualizacionPolitica.esperandoPorSinRed("fallo", "sin_red", t - 14 * 60_000L, t));
        assertFalse(ActualizacionPolitica.esperandoPorSinRed("fallo", "sin_red", t - 15 * 60_000L, t));
        assertFalse("otro fallo: lo gobiernan los intentos", ActualizacionPolitica.esperandoPorSinRed("fallo", "sha256_distinto", t - 60_000L, t));
        assertFalse(ActualizacionPolitica.esperandoPorSinRed("ninguna", "sin_red", t - 60_000L, t));
        assertFalse("reloj retrocedido: no se bloquea", ActualizacionPolitica.esperandoPorSinRed("fallo", "sin_red", t + 3_600_000L, t));
    }

    @Test
    public void laOfertaGuardadaSeLeeIgualYSoloSiSigueSiendoValida() throws Exception {
        ActualizacionPolitica.Lectura l = leer(buena());
        String json = ActualizacionPolitica.ofertaAJson(l.oferta);
        ActualizacionPolitica.Oferta o = ActualizacionPolitica.ofertaDeJson(json, false);
        assertNotNull(o);
        assertEquals(l.oferta.v, o.v);
        assertEquals(l.oferta.vc, o.vc);
        assertEquals(l.oferta.url, o.url);
        assertEquals(l.oferta.sha256, o.sha256);
        assertEquals(l.oferta.ts, o.ts);
        // alterada: URL ajena, huella corta, versión rara, vacía o basura
        assertNull(ActualizacionPolitica.ofertaDeJson(json.replace("pagos.dmalabomba.com", "evil.example.com"), false));
        assertNull(ActualizacionPolitica.ofertaDeJson(json.replace(SHA, "abc"), false));
        assertNull(ActualizacionPolitica.ofertaDeJson(json.replace("2.12.0", "x.y"), false));
        assertNull(ActualizacionPolitica.ofertaDeJson("", false));
        assertNull(ActualizacionPolitica.ofertaDeJson(null, false));
        assertNull(ActualizacionPolitica.ofertaDeJson("{no es json", false));
        assertNull(ActualizacionPolitica.ofertaDeJson("{}", false));
    }

    @Test
    public void laOfertaGuardadaVenceA_las24h() throws Exception {
        ActualizacionPolitica.Oferta o = leer(buena()).oferta;
        assertTrue(ActualizacionPolitica.vigente(o.ts, AHORA));
        assertFalse(ActualizacionPolitica.vigente(o.ts, o.ts + 24L * 3600_000L + 1));
    }
}
