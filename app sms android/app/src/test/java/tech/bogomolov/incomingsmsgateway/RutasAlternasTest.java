package tech.bogomolov.incomingsmsgateway;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.After;
import org.junit.Test;

import java.net.ConnectException;
import java.net.NoRouteToHostException;
import java.net.SocketException;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.util.Arrays;
import java.util.List;

import javax.net.ssl.SSLHandshakeException;
import javax.net.ssl.SSLPeerUnverifiedException;

/** 27 nov 2026 (caída de los dominios): caminos equivalentes, lista cerrada (JVM pura). */
public class RutasAlternasTest {

    private static final String SB = "https://dwlbcbtwdungyrykgahm.supabase.co/functions/v1";

    @After
    public void limpiar() {
        RutasAlternas.paraPrueba = null;
    }

    @Test
    public void elSmsDePagosTieneComoAlternosPagesYSupabase() {
        List<String> c = RutasAlternas.candidatasMensaje("https://pagos.dmalabomba.com/sms");
        assertEquals(Arrays.asList(
                "https://pagos.dmalabomba.com/sms",
                "https://sinpe-pagos.pages.dev/sms",
                SB + "/sinpe-recibir"), c);
    }

    @Test
    public void elLatidoYLaPantallaTambienTienenTresCaminos() {
        assertEquals(Arrays.asList(
                "https://pagos.dmalabomba.com/latido",
                "https://sinpe-pagos.pages.dev/latido",
                SB + "/sinpe-recibir/latido"), RutasAlternas.candidatasMensaje("https://pagos.dmalabomba.com/latido"));
        assertEquals(Arrays.asList(
                "https://pagos.dmalabomba.com/pantalla",
                "https://sinpe-pagos.pages.dev/pantalla",
                SB + "/sinpe-pantalla"), RutasAlternas.candidatasMensaje("https://pagos.dmalabomba.com/pantalla"));
    }

    @Test
    public void esSimetrico_desdePagesYDesdeSupabase() {
        assertEquals(Arrays.asList(
                "https://sinpe-pagos.pages.dev/latido",
                "https://pagos.dmalabomba.com/latido",
                SB + "/sinpe-recibir/latido"), RutasAlternas.candidatasMensaje("https://sinpe-pagos.pages.dev/latido"));
        assertEquals(Arrays.asList(
                SB + "/sinpe-recibir",
                "https://pagos.dmalabomba.com/sms",
                "https://sinpe-pagos.pages.dev/sms"), RutasAlternas.candidatasMensaje(SB + "/sinpe-recibir"));
    }

    @Test
    public void laBarraFinalNoImpide_peroSeConservaLaUrlPedida() {
        List<String> c = RutasAlternas.candidatasMensaje("https://pagos.dmalabomba.com/sms/");
        assertEquals("https://pagos.dmalabomba.com/sms/", c.get(0));
        assertEquals(3, c.size());
    }

    @Test
    public void loQueNoEsNuestroNoTieneAlternos() {
        String[] ajenas = {
                "https://otro.example.com/sms",                         // otro servidor del usuario
                "https://pagos.dmalabomba.com/otra-ruta",                // ruta que no está en la tabla
                "http://pagos.dmalabomba.com/sms",                       // sin https
                "https://pagos.dmalabomba.com:8443/sms",                 // otro puerto
                "https://pagos.dmalabomba.com/sms?x=1",                  // con consulta
                "https://user@pagos.dmalabomba.com/sms",                 // con usuario
                "https://evil-pagos.dmalabomba.com/sms",                 // parecido
                "https://pagos.dmalabomba.com.evil.com/sms",             // parecido
                "https://sinpe-pagos.pages.dev.evil.com/sms",            // parecido
                "https://otro.pages.dev/sms",                            // otro proyecto de Pages
                "https://otroproyecto.supabase.co/functions/v1/sinpe-recibir",
                "",
                "no es una url",
        };
        for (String u : ajenas) {
            assertEquals(u, Arrays.asList(u), RutasAlternas.candidatasMensaje(u));
            assertFalse(u, RutasAlternas.esAnfitrionPropio(u));
        }
    }

    @Test
    public void nuloNoRompe() {
        assertEquals(1, RutasAlternas.candidatasMensaje(null).size());
        assertFalse(RutasAlternas.esAnfitrionPropio(null));
    }

    @Test
    public void elInstaladorSoloAlternaEntreLosDosAnfitrionesDePages() {
        String a = "https://pagos.dmalabomba.com/instalar/reenviador-sms-la-bomba-2.12.0.apk";
        assertEquals(Arrays.asList(a, "https://sinpe-pagos.pages.dev/instalar/reenviador-sms-la-bomba-2.12.0.apk"),
                RutasAlternas.candidatasInstalador(a));
        String b = "https://sinpe-pagos.pages.dev/instalar/x.apk";
        assertEquals(Arrays.asList(b, "https://pagos.dmalabomba.com/instalar/x.apk"), RutasAlternas.candidatasInstalador(b));
        // Supabase NO aloja el APK; rutas fuera de /instalar, http, consulta, otro puerto o anfitrión: sin alterno
        String[] sin = {
                SB + "/instalar/x.apk",
                "https://pagos.dmalabomba.com/sms",
                "https://pagos.dmalabomba.com/instalar/x.zip",
                "https://pagos.dmalabomba.com/instalar/../x.apk",
                "http://pagos.dmalabomba.com/instalar/x.apk",
                "https://pagos.dmalabomba.com/instalar/x.apk?a=1",
                "https://pagos.dmalabomba.com:444/instalar/x.apk",
                "https://otro.example.com/instalar/x.apk",
        };
        for (String u : sin) assertEquals(u, Arrays.asList(u), RutasAlternas.candidatasInstalador(u));
    }

    @Test
    public void lasUrlsAlternasDelInstaladorPasanLaPoliticaDeActualizacion() {
        for (String u : RutasAlternas.candidatasInstalador("https://pagos.dmalabomba.com/instalar/reenviador-sms-la-bomba-2.12.0.apk")) {
            assertTrue(u, ActualizacionPolitica.urlPermitida(u, false));
        }
    }

    @Test
    public void unaPaginaHtmlNoEsNuestraRespuesta() {
        assertTrue(RutasAlternas.pareceHtml("<!DOCTYPE html><html><head><script>window.onload=function(){window.location.href=\"/lander\"}</script></head></html>"));
        assertTrue(RutasAlternas.pareceHtml("  \n<html>"));
        assertFalse(RutasAlternas.pareceHtml("{\"ok\":true}"));
        assertFalse(RutasAlternas.pareceHtml(""));
        assertFalse(RutasAlternas.pareceHtml(null));
    }

    @Test
    public void soloLosFallosAnterioresAlEnvioPidenOtroCamino() {
        assertTrue(RutasAlternas.esFalloDeRed(new UnknownHostException("pagos.dmalabomba.com")));
        assertTrue(RutasAlternas.esFalloDeRed(new ConnectException("Connection refused")));
        assertTrue(RutasAlternas.esFalloDeRed(new NoRouteToHostException()));
        assertTrue(RutasAlternas.esFalloDeRed(new SSLHandshakeException("no coincide")));
        assertTrue(RutasAlternas.esFalloDeRed(new SSLPeerUnverifiedException("cert")));
        assertTrue(RutasAlternas.esFalloDeRed(new SocketTimeoutException("failed to connect to /1.2.3.4 (port 443) after 20000ms")));
        // una respuesta perdida o cortada NO: el servidor pudo haber recibido el mensaje
        assertFalse(RutasAlternas.esFalloDeRed(new SocketTimeoutException("Read timed out")));
        assertFalse(RutasAlternas.esFalloDeRed(new SocketException("Connection reset")));
        assertFalse(RutasAlternas.esFalloDeRed(new java.io.IOException("unexpected end of stream")));
    }
}
