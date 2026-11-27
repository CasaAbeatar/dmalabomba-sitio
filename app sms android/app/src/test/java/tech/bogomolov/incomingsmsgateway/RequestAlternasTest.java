package tech.bogomolov.incomingsmsgateway;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;

/**
 * 27 nov 2026: Request y el actualizador prueban otro camino SOLO si el principal falla a nivel de red, con servidores
 * de verdad en 127.0.0.1 (JVM). El principal es un puerto cerrado (conexión rechazada, como un nombre que no resuelve).
 */
public class RequestAlternasTest {

    private MiniServidor vivo;

    @Before
    public void arrancar() throws Exception {
        vivo = new MiniServidor();
    }

    @After
    public void parar() {
        vivo.close();
        RutasAlternas.paraPrueba = null;
    }

    private static void caminos(final String... urls) {
        RutasAlternas.paraPrueba = url -> new ArrayList<>(Arrays.asList(urls));
    }

    private static String sha(byte[] b) throws Exception {
        return ActualizacionPolitica.hex(java.security.MessageDigest.getInstance("SHA-256").digest(b));
    }

    @Test
    public void siElPrincipalNoConectaSeUsaElAlternoConLaMismaFirmaYCuerpo() throws Exception {
        String muerto = MiniServidor.urlMuerta("/sms");
        caminos(muerto, vivo.url("/sms"));
        Request r = new Request(muerto, "{\"text\":\"hola\"}");
        r.setUseChunkedMode(false);   // el servidor de prueba lee Content-Length (el latido tambien va asi)
        r.setSignatureHeader("clave", "{\"text\":\"hola\"}");
        assertEquals(Request.RESULT_SUCCESS, r.execute());
        assertEquals(vivo.url("/sms"), r.getUrlUsada());
        assertEquals(200, r.getResponseCode());
        assertEquals(1, vivo.peticiones.size());
        String firma = Request.computeHmacSha256Hex("clave", "{\"text\":\"hola\"}");
        assertTrue(vivo.peticiones.get(0), vivo.peticiones.get(0).startsWith("POST /sms HTTP/1.1 | firma=" + firma + " | "));
        assertTrue(vivo.peticiones.get(0), vivo.peticiones.get(0).endsWith("| {\"text\":\"hola\"}"));
    }

    @Test
    public void unaRespuestaLegitimaDelServidorNoPruebaOtroCamino() throws Exception {
        vivo.codigo = 500;
        caminos(vivo.url("/sms"), MiniServidor.urlMuerta("/sms"));
        Request r = new Request(vivo.url("/sms"), "{}");
        assertEquals(Request.RESULT_RETRY, r.execute());
        assertEquals(500, r.getResponseCode());
        assertEquals(1, vivo.peticiones.size());
        assertEquals(vivo.url("/sms"), r.getUrlUsada());
    }

    @Test
    public void siElPrincipalYaRespondeBienNoSeTocanLosAlternos() throws Exception {
        caminos(vivo.url("/latido"), MiniServidor.urlMuerta("/latido"));
        Request r = new Request(vivo.url("/latido"), "{}");
        assertEquals(Request.RESULT_SUCCESS, r.execute());
        assertEquals(1, vivo.peticiones.size());
        assertEquals(vivo.url("/latido"), r.getUrlUsada());
    }

    @Test
    public void siTodosFallanElResultadoEsReintentar() throws Exception {
        caminos(MiniServidor.urlMuerta("/sms"), MiniServidor.urlMuerta("/otra"));
        Request r = new Request(MiniServidor.urlMuerta("/sms"), "{}");
        assertEquals(Request.RESULT_RETRY, r.execute());
        assertEquals(-1, r.getResponseCode());
        assertEquals(0, vivo.peticiones.size());
    }

    @Test
    public void sePuedeDesactivarLaBusqueda() throws Exception {
        String muerto = MiniServidor.urlMuerta("/sms");
        caminos(muerto, vivo.url("/sms"));
        Request r = new Request(muerto, "{}");
        r.setAlternasPermitidas(false);
        assertEquals(Request.RESULT_RETRY, r.execute());
        assertEquals(0, vivo.peticiones.size());
    }

    // ------------------------------------------------------------------ descarga de la actualización

    @Test
    public void laDescargaPasaAlOtroAnfitrionSiElPrimeroNoConecta() throws Exception {
        byte[] apk = "contenido de un apk de prueba".getBytes(StandardCharsets.UTF_8);
        vivo.cuerpo = apk;
        String muerto = MiniServidor.urlMuerta("/instalar/a.apk");
        caminos(muerto, vivo.url("/instalar/a.apk"));
        File f = File.createTempFile("act", ".apk");
        try {
            assertNull(Actualizador.descargar(muerto, f, sha(apk)));
            assertEquals(apk.length, f.length());
        } finally {
            f.delete();
        }
    }

    @Test
    public void laHuellaSigueSiendoObligatoriaEnElAlterno() throws Exception {
        vivo.cuerpo = "contenido ajeno".getBytes(StandardCharsets.UTF_8);
        String muerto = MiniServidor.urlMuerta("/instalar/a.apk");
        caminos(muerto, vivo.url("/instalar/a.apk"));
        File f = File.createTempFile("act", ".apk");
        try {
            assertEquals("sha256_distinto", Actualizador.descargar(muerto, f, sha("otro contenido".getBytes(StandardCharsets.UTF_8))));
        } finally {
            f.delete();
        }
    }

    @Test
    public void sinRedEnNingunCaminoSeInformaSinRed() throws Exception {
        String a = MiniServidor.urlMuerta("/instalar/a.apk");
        caminos(a, MiniServidor.urlMuerta("/instalar/b.apk"));
        File f = File.createTempFile("act", ".apk");
        try {
            assertEquals("sin_red", Actualizador.descargar(a, f, sha(new byte[]{1})));
        } finally {
            f.delete();
        }
    }

    @Test
    public void unaUrlNoPermitidaNoSeReintentaPorOtroCamino() throws Exception {
        caminos("http://example.com/instalar/a.apk", vivo.url("/instalar/a.apk"));
        File f = File.createTempFile("act", ".apk");
        try {
            assertEquals("url_no_permitida", Actualizador.descargar("http://example.com/instalar/a.apk", f, sha(new byte[]{1})));
            assertEquals(0, vivo.peticiones.size());
        } finally {
            f.delete();
        }
    }

    @Test
    public void unHttp404DelPrimeroPasaAlAlterno() throws Exception {
        byte[] apk = "apk".getBytes(StandardCharsets.UTF_8);
        vivo.cuerpo = apk;
        try (MiniServidor cuatrocientos = new MiniServidor()) {
            cuatrocientos.codigo = 404;
            cuatrocientos.cuerpo = new byte[0];
            String a404 = cuatrocientos.url("/instalar/a.apk");
            caminos(a404, vivo.url("/instalar/a.apk"));
            File f = File.createTempFile("act", ".apk");
            try {
                assertNull(Actualizador.descargar(a404, f, sha(apk)));
            } finally {
                f.delete();
            }
        }
    }
}
