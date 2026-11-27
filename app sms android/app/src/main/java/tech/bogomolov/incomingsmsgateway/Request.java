package tech.bogomolov.incomingsmsgateway;

import android.annotation.SuppressLint;
import android.util.Log;

import androidx.annotation.NonNull;

import org.apache.http.conn.ssl.AllowAllHostnameVerifier;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.BufferedWriter;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.net.HttpURLConnection;
import java.net.MalformedURLException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.InvalidKeyException;
import java.security.KeyManagementException;
import java.security.NoSuchAlgorithmException;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import javax.net.ssl.HttpsURLConnection;

import tech.bogomolov.incomingsmsgateway.SSLSocketFactory.TLSSocketFactory;

public class Request {

    private final String payload;
    private boolean ignoreSsl = false;
    private boolean useChunkedMode = true;
    private String error = null;
    private int responseCode = -1;
    private String responseBody = "";
    private String responseSignature = null;

    private HttpURLConnection connection;
    // 2.12.0 (caida de dominios): lo necesario para repetir la misma peticion por otro camino (ver RutasAlternas).
    private final String urlOriginal;
    private String urlUsada;
    private final Map<String, String> cabeceras = new LinkedHashMap<>();
    private boolean falloDeRed = false;
    private boolean alternasPermitidas = true;

    public static final String RESULT_SUCCESS = "success";
    public static final String RESULT_ERROR = "error";
    public static final String RESULT_RETRY = "error_retry";

    public Request(String urlString, String payload) {
        this.payload = payload;
        this.urlOriginal = urlString;
        this.urlUsada = urlString;
        abrir(urlString);
    }

    /** Abre (o reabre) la conexion hacia {@code urlString} con las cabeceras ya puestas. @return false si no se pudo (queda this.error). */
    private boolean abrir(String urlString) {
        this.error = null;
        this.connection = null;
        URL url;
        try {
            url = new URL(urlString);
        } catch (MalformedURLException e) {
            Log.e("SmsGateway", "malformed url error: " + urlString);
            this.error = RESULT_ERROR;
            return false;
        }

        try {
            this.connection = (HttpURLConnection) url.openConnection();
        } catch (IOException e) {
            Log.e("SmsGateway", "open connection error: " + e);
            this.error = RESULT_ERROR;
            return false;
        }

        this.connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        // La Bomba 2.7.0: sin tiempos limite un servidor o una red colgados dejaban el hilo esperando para
        // siempre (el latido y el reenvio se quedaban mudos sin avisar). Ahora se corta y se reintenta.
        this.connection.setConnectTimeout(20_000);
        this.connection.setReadTimeout(45_000);
        for (Map.Entry<String, String> e : cabeceras.entrySet()) {
            this.connection.setRequestProperty(e.getKey(), e.getValue());
        }
        return true;
    }

    private void cabecera(String clave, String valor) {
        cabeceras.put(clave, valor);
        if (this.connection != null) this.connection.setRequestProperty(clave, valor);
    }

    public void setJsonHeaders(String headers) {
        JSONObject headersObj;
        try {
            headersObj = new JSONObject(headers);
            Iterator<String> keys = headersObj.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                if (headersObj.get(key) instanceof JSONObject) {
                    Log.e("SmsGateway", "only string supported in json");
                    continue;
                }

                cabecera(key, (String) headersObj.get(key));
            }
        } catch (JSONException e) {
            Log.e("SmsGateway", "headers error: " + e);
            this.error = RESULT_ERROR;
        }
    }

    public static String convertByteToHexadecimal(@NonNull byte[] byteArray) {
        StringBuilder hex = new StringBuilder();
        for (byte i : byteArray) {
            hex.append(String.format("%02x", i));
        }
        return hex.toString();
    }

    public static String computeHmacSha256Hex(@NonNull String secret, @NonNull String body)
            throws NoSuchAlgorithmException, InvalidKeyException {
        String algorithm = "HmacSHA256";
        SecretKeySpec secretKeySpec =
                new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), algorithm);
        Mac mac = Mac.getInstance(algorithm);
        mac.init(secretKeySpec);
        return convertByteToHexadecimal(mac.doFinal(body.getBytes(StandardCharsets.UTF_8)));
    }

    public void setSignatureHeader(@NonNull String secret, @NonNull String body) {
        try {
            cabecera("X-Signature", computeHmacSha256Hex(secret, body));
        } catch (NoSuchAlgorithmException | InvalidKeyException | IllegalArgumentException e) {
            // IllegalArgumentException covers an empty secret, which SecretKeySpec
            // rejects — never let a bad signing config crash the delivery path.
            Log.e("SmsGateway", "hmac signature error: " + e);
        }
    }


    public void setIgnoreSsl(boolean ignoreSsl) {
        this.ignoreSsl = ignoreSsl;
    }

    public void setUseChunkedMode(boolean useChunkedMode) {
        this.useChunkedMode = useChunkedMode;
    }

    // HTTP status of the last execute(), or -1 if the request never got a response
    // (malformed URL, connection failure, or not yet executed).
    public int getResponseCode() {
        return this.responseCode;
    }

    // La Bomba 2.6.0: cuerpo (corto) de la respuesta del ultimo execute(); la carga de mensajes anteriores lo usa para leer los conteos.
    public String getResponseBody() {
        return this.responseBody;
    }

    // La Bomba 2.7.0: cabecera X-Signature de la respuesta (null si no vino). Sirve para verificar las ordenes remotas.
    public String getResponseSignature() {
        return this.responseSignature;
    }

    /** La URL con la que se obtuvo el ultimo resultado (la original, o la de un camino alterno). */
    public String getUrlUsada() {
        return this.urlUsada;
    }

    /** Pruebas y casos especiales: no probar caminos alternos aunque el principal falle. */
    public void setAlternasPermitidas(boolean permitidas) {
        this.alternasPermitidas = permitidas;
    }

    /**
     * 2.12.0: manda la peticion y, SOLO si fallo a nivel de red (el nombre no resuelve, no conecta, el certificado no
     * corresponde, o contesto una pagina HTML que no es nuestra), la repite por los caminos equivalentes de
     * {@link RutasAlternas} (mismas firmas; los alternos nunca ignoran errores de certificado). Un mensaje nunca se manda dos
     * veces por una respuesta perdida, y una respuesta legitima del servidor (aunque sea un error) pone fin a la busqueda.
     */
    public String execute() {
        String r = ejecutarUna();
        if (RESULT_SUCCESS.equals(r) || !falloDeRed || !alternasPermitidas) return r;
        List<String> caminos = RutasAlternas.candidatasMensaje(urlOriginal);
        boolean ignoraOriginal = this.ignoreSsl;
        for (int i = 1; i < caminos.size(); i++) {
            String alt = caminos.get(i);
            Log.w("SmsGateway", "sin respuesta por " + urlUsada + ": se prueba " + alt);
            this.responseCode = -1;
            this.responseBody = "";
            this.responseSignature = null;
            this.ignoreSsl = false;
            this.urlUsada = alt;
            if (!abrir(alt)) continue;
            r = ejecutarUna();
            if (RESULT_SUCCESS.equals(r) || !falloDeRed) break;
        }
        this.ignoreSsl = ignoraOriginal;
        return r;
    }

    @SuppressLint({"AllowAllHostnameVerifier"})
    private String ejecutarUna() {
        this.falloDeRed = false;
        if (this.error != null) {
            return this.error;
        }

        String result = RESULT_SUCCESS;

        try {
            if (this.connection instanceof HttpsURLConnection) {
                ((HttpsURLConnection) this.connection).setSSLSocketFactory(
                        new TLSSocketFactory(this.ignoreSsl)
                );

                if (this.ignoreSsl) {
                    ((HttpsURLConnection) this.connection).setHostnameVerifier(new AllowAllHostnameVerifier());
                }
            }

            this.connection.setDoOutput(true);
            if (this.useChunkedMode) {
                this.connection.setChunkedStreamingMode(0);
            } else {
                // Content-Length must be the UTF-8 byte count, not the char count, or a
                // payload with multi-byte characters gets truncated server-side.
                this.connection.setFixedLengthStreamingMode(
                        this.payload.getBytes(StandardCharsets.UTF_8).length);
            }

            OutputStream out = new BufferedOutputStream(this.connection.getOutputStream());

            BufferedWriter writer;
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.KITKAT) {
                writer = new BufferedWriter(new OutputStreamWriter(out, StandardCharsets.UTF_8));
            } else {
                writer = new BufferedWriter(new OutputStreamWriter(out));
            }

            writer.write(this.payload);
            writer.flush();
            writer.close();
            out.close();

            // getResponseCode() does not throw on 4xx/5xx, so read it first.
            // The actual error body (if any) is exposed via getErrorStream(), not
            // getInputStream() — reading getInputStream() on a non-2xx response throws.
            this.responseCode = this.connection.getResponseCode();

            this.responseSignature = this.connection.getHeaderField("X-Signature");

            boolean isSuccess = this.responseCode >= 200 && this.responseCode < 300;
            InputStream responseStream =
                    isSuccess ? this.connection.getInputStream() : this.connection.getErrorStream();
            if (responseStream != null) {
                BufferedInputStream in = new BufferedInputStream(responseStream);
                try {
                    java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
                    byte[] buf = new byte[1024];
                    int n;
                    while ((n = in.read(buf)) > 0 && bos.size() < 8192) {
                        bos.write(buf, 0, n);
                    }
                    this.responseBody = bos.toString("UTF-8");
                } finally {
                    in.close();
                }
            }

            if (!isSuccess) {
                Log.e("SmsGateway", "response code: " + this.responseCode + " for " + this.connection.getURL());
                result = RESULT_RETRY;
            } else if (RutasAlternas.esAnfitrionPropio(this.urlUsada) && RutasAlternas.pareceHtml(this.responseBody)) {
                // 2.12.0: un 2xx con una pagina HTML no es nuestro servidor (p. ej. la pagina «parked» de un registrador
                // cuando el dominio se cae): no cuenta como entregado y se prueba otro camino.
                Log.e("SmsGateway", "respuesta HTML ajena de " + this.urlUsada + ": no se da por entregado");
                result = RESULT_RETRY;
                this.falloDeRed = true;
            }
        } catch (NoSuchAlgorithmException e) {
            Log.e("SmsGateway", "ssl algorithm error: " + e);
            result = RESULT_ERROR;
        } catch (KeyManagementException e) {
            Log.e("SmsGateway", "ssl factory error: " + e);
            result = RESULT_ERROR;
        } catch (IOException e) {
            Log.e("SmsGateway", "io error " + e);
            result = RESULT_RETRY;
            this.falloDeRed = RutasAlternas.esFalloDeRed(e);
        } finally {
            if (this.connection != null) {
                this.connection.disconnect();
            }
        }

        return result;
    }
}
