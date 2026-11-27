package tech.bogomolov.incomingsmsgateway;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.net.Socket;

import javax.net.ssl.SSLSocket;

import tech.bogomolov.incomingsmsgateway.SSLSocketFactory.TLSSocketFactory;
import tech.bogomolov.incomingsmsgateway.SSLSocketFactory.TlsPolitica;

/** La Bomba 2.12.0 (auditoría): solo TLS 1.2 y 1.3 (JVM pura). */
public class TlsPoliticaTest {

    @Test
    public void filtraTodoLoQueNoSeaTls12OTls13() {
        assertArrayEquals(new String[]{"TLSv1.3", "TLSv1.2"},
                TlsPolitica.filtrar(new String[]{"SSLv3", "TLSv1", "TLSv1.1", "TLSv1.2", "TLSv1.3"}));
        assertArrayEquals(new String[]{"TLSv1.2"}, TlsPolitica.filtrar(new String[]{"TLSv1", "TLSv1.1", "TLSv1.2"}));
        assertArrayEquals(new String[]{"TLSv1.3"}, TlsPolitica.filtrar(new String[]{"TLSv1.3"}));
        // si solo hay protocolos viejos, queda vacío: no se conecta
        assertEquals(0, TlsPolitica.filtrar(new String[]{"SSLv3", "TLSv1", "TLSv1.1"}).length);
        assertEquals(0, TlsPolitica.filtrar(new String[0]).length);
        assertEquals(0, TlsPolitica.filtrar(null).length);
        assertEquals(2, TlsPolitica.PERMITIDOS.size());
    }

    @Test
    public void laFabricaDeSocketsSoloHabilitaTls12y13() throws Exception {
        try (Socket s = new TLSSocketFactory(false).createSocket()) {
            assertTrue(s instanceof SSLSocket);
            for (String p : ((SSLSocket) s).getEnabledProtocols()) {
                assertTrue("protocolo habilitado no permitido: " + p, TlsPolitica.PERMITIDOS.contains(p));
            }
            assertTrue(((SSLSocket) s).getEnabledProtocols().length >= 1);
        }
    }
}
