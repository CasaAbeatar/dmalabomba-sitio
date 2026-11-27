package tech.bogomolov.incomingsmsgateway;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CopyOnWriteArrayList;

/** Servidor HTTP mínimo en 127.0.0.1 para pruebas JVM (sin com.sun, que Android no ve). Una respuesta fija por servidor. */
final class MiniServidor implements AutoCloseable {
    final ServerSocket socket;
    final CopyOnWriteArrayList<String> peticiones = new CopyOnWriteArrayList<>();
    volatile int codigo = 200;
    volatile byte[] cuerpo = "{\"ok\":true}".getBytes(StandardCharsets.UTF_8);
    volatile String tipo = "application/json";
    private volatile boolean corriendo = true;

    MiniServidor() throws Exception {
        socket = new ServerSocket(0, 10, InetAddress.getByName("127.0.0.1"));
        Thread t = new Thread(() -> {
            while (corriendo) {
                try (Socket s = socket.accept()) {
                    s.setSoTimeout(3000);
                    InputStream in = s.getInputStream();
                    StringBuilder cab = new StringBuilder();
                    int c;
                    while ((c = in.read()) >= 0) {
                        cab.append((char) c);
                        if (cab.length() >= 4 && cab.substring(cab.length() - 4).equals("\r\n\r\n")) break;
                    }
                    String texto = cab.toString();
                    int len = 0;
                    for (String l : texto.split("\r\n")) {
                        if (l.toLowerCase().startsWith("content-length:")) len = Integer.parseInt(l.substring(15).trim());
                    }
                    byte[] cu = new byte[len];
                    int leido = 0;
                    while (leido < len) {
                        int n = in.read(cu, leido, len - leido);
                        if (n < 0) break;
                        leido += n;
                    }
                    String firma = "";
                    for (String l : texto.split("\r\n")) {
                        if (l.toLowerCase().startsWith("x-signature:")) firma = l.substring(12).trim();
                    }
                    peticiones.add(texto.split("\r\n")[0] + " | firma=" + firma + " | " + new String(cu, 0, leido, StandardCharsets.UTF_8));
                    OutputStream out = s.getOutputStream();
                    out.write(("HTTP/1.1 " + codigo + " X\r\nContent-Type: " + tipo + "\r\nContent-Length: " + cuerpo.length
                            + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.UTF_8));
                    out.write(cuerpo);
                    out.flush();
                } catch (Exception ignored) {
                    // cerrado al terminar
                }
            }
        }, "mini-servidor");
        t.setDaemon(true);
        t.start();
    }

    int puerto() {
        return socket.getLocalPort();
    }

    String url(String ruta) {
        return "http://127.0.0.1:" + puerto() + ruta;
    }

    /** Un puerto en el que nadie escucha (conexión rechazada). */
    static String urlMuerta(String ruta) throws Exception {
        try (ServerSocket s = new ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))) {
            return "http://127.0.0.1:" + s.getLocalPort() + ruta;
        }
    }

    @Override
    public void close() {
        corriendo = false;
        try {
            socket.close();
        } catch (Exception ignored) {
        }
    }
}
