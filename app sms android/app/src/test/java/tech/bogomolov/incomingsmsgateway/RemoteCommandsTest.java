package tech.bogomolov.incomingsmsgateway;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.List;

/** La Bomba 2.7.0: filtrado de órdenes remotas, registro de ids y confianza en la respuesta. */
public class RemoteCommandsTest {

    @Test
    public void aceptaLasCuatroOrdenesDeLaListaCerrada() {
        List<RemoteCommands.Command> l = RemoteCommands.parse(
                "{\"comandos\":[{\"id\":1,\"cmd\":\"reiniciar_servicio\"},{\"id\":2,\"cmd\":\"latido_ya\"},"
                        + "{\"id\":3,\"cmd\":\"reenviar_historial\"},{\"id\":4,\"cmd\":\"reiniciar_telefono\"}]}");
        assertEquals(4, l.size());
        assertEquals("reiniciar_servicio", l.get(0).cmd);
        assertEquals(4L, l.get(3).id);
    }

    @Test
    public void ignoraCualquierOtraOrden() {
        List<RemoteCommands.Command> l = RemoteCommands.parse(
                "{\"comandos\":[{\"id\":1,\"cmd\":\"borrar_todo\"},{\"id\":2,\"cmd\":\"LATIDO_YA\"},"
                        + "{\"id\":3,\"cmd\":\"latido_ya \"},{\"id\":4,\"cmd\":\"rm -rf /\"},{\"id\":5,\"cmd\":\"latido_ya\"}]}");
        assertEquals(1, l.size());
        assertEquals(5L, l.get(0).id);
    }

    @Test
    public void descartaEntradasMalformadas() {
        List<RemoteCommands.Command> l = RemoteCommands.parse(
                "{\"comandos\":[{\"cmd\":\"latido_ya\"},{\"id\":\"7\",\"cmd\":\"latido_ya\"},{\"id\":-1,\"cmd\":\"latido_ya\"},"
                        + "{\"id\":1.5,\"cmd\":\"latido_ya\"},{\"id\":8},{\"id\":9,\"cmd\":5},\"texto\",null,{\"id\":10,\"cmd\":\"latido_ya\"}]}");
        assertEquals(1, l.size());
        assertEquals(10L, l.get(0).id);
    }

    @Test
    public void cuerpoQueNoEsJsonOSinComandosDaListaVacia() {
        assertTrue(RemoteCommands.parse(null).isEmpty());
        assertTrue(RemoteCommands.parse("").isEmpty());
        assertTrue(RemoteCommands.parse("<html>502</html>").isEmpty());
        assertTrue(RemoteCommands.parse("{\"ok\":true}").isEmpty());
        assertTrue(RemoteCommands.parse("{\"comandos\":\"latido_ya\"}").isEmpty());
        assertTrue(RemoteCommands.parse("{\"comandos\":[]}").isEmpty());
    }

    @Test
    public void unIdRepetidoEnLaMismaRespuestaSoloCuentaUnaVez() {
        List<RemoteCommands.Command> l = RemoteCommands.parse(
                "{\"comandos\":[{\"id\":1,\"cmd\":\"latido_ya\"},{\"id\":1,\"cmd\":\"reiniciar_servicio\"}]}");
        assertEquals(1, l.size());
        assertEquals("latido_ya", l.get(0).cmd);
    }

    @Test
    public void tope5OrdenesPorRespuesta() {
        StringBuilder b = new StringBuilder("{\"comandos\":[");
        for (int i = 1; i <= 9; i++) b.append(i > 1 ? "," : "").append("{\"id\":").append(i).append(",\"cmd\":\"latido_ya\"}");
        b.append("]}");
        assertEquals(RemoteCommands.MAX_POR_RESPUESTA, RemoteCommands.parse(b.toString()).size());
    }

    @Test
    public void unaOrdenYaEjecutadaNoSeRepite() {
        RemoteCommands.CommandLog log = new RemoteCommands.CommandLog();
        List<RemoteCommands.Command> todas = RemoteCommands.parse(
                "{\"comandos\":[{\"id\":1,\"cmd\":\"latido_ya\"},{\"id\":2,\"cmd\":\"reiniciar_servicio\"}]}");
        assertEquals(2, RemoteCommands.nuevas(todas, log).size());
        log.add(1);
        List<RemoteCommands.Command> n = RemoteCommands.nuevas(todas, log);
        assertEquals(1, n.size());
        assertEquals(2L, n.get(0).id);
        log.add(2);
        assertTrue(RemoteCommands.nuevas(todas, log).isEmpty());
    }

    @Test
    public void registroSeGuardaYSeLeeComoTexto() {
        RemoteCommands.CommandLog log = new RemoteCommands.CommandLog();
        log.add(5);
        log.add(3);
        assertEquals("5,3", log.toString());
        RemoteCommands.CommandLog otra = RemoteCommands.CommandLog.fromString("5,3,x,, 8 ");
        assertTrue(otra.contains(5));
        assertTrue(otra.contains(8));
        assertEquals(3, otra.size());
        assertFalse(otra.add(5));
    }

    @Test
    public void registroOlvidaLosMasViejosPasadoElTope() {
        RemoteCommands.CommandLog log = new RemoteCommands.CommandLog();
        for (long i = 1; i <= RemoteCommands.MAX_RECORDADOS + 10; i++) log.add(i);
        assertEquals(RemoteCommands.MAX_RECORDADOS, log.size());
        assertFalse(log.contains(1));
        assertTrue(log.contains(RemoteCommands.MAX_RECORDADOS + 10));
    }

    @Test
    public void respuestaConfiableSegunFirmaYHttps() throws Exception {
        String secret = "clave";
        String body = "{\"comandos\":[{\"id\":1,\"cmd\":\"latido_ya\"}]}";
        String firma = Request.computeHmacSha256Hex(secret, body);
        // firmada y correcta: vale aun por http
        assertTrue(RemoteCommands.respuestaConfiable("http://10.0.2.2/latido", 200, body, firma, secret));
        assertTrue(RemoteCommands.respuestaConfiable("https://x/latido", 200, body, firma.toUpperCase(), secret));
        // firma presente pero mala: se descarta aunque sea https
        assertFalse(RemoteCommands.respuestaConfiable("https://x/latido", 200, body, "00" + firma.substring(2), secret));
        assertFalse(RemoteCommands.respuestaConfiable("https://x/latido", 200, body + " ", firma, secret));
        assertFalse(RemoteCommands.respuestaConfiable("https://x/latido", 200, body, firma, "otra"));
        // sin firma: solo https
        assertTrue(RemoteCommands.respuestaConfiable("https://x/latido", 200, body, null, secret));
        assertTrue(RemoteCommands.respuestaConfiable("HTTPS://x/latido", 204, body, "", secret));
        assertFalse(RemoteCommands.respuestaConfiable("http://x/latido", 200, body, null, secret));
        // código no 2xx
        assertFalse(RemoteCommands.respuestaConfiable("https://x/latido", 500, body, firma, secret));
        assertFalse(RemoteCommands.respuestaConfiable("https://x/latido", 401, body, null, secret));
        assertFalse(RemoteCommands.respuestaConfiable("https://x/latido", 200, null, null, secret));
    }
}
