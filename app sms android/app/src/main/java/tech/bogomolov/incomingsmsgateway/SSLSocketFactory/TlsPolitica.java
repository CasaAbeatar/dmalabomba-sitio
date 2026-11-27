package tech.bogomolov.incomingsmsgateway.SSLSocketFactory;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * La Bomba 2.12.0 (auditoría): solo TLS 1.2 y TLS 1.3. Antes se habilitaba todo lo que el teléfono soportara (en
 * Android viejo, hasta TLS 1.0/1.1). Lógica pura (se prueba en la JVM).
 */
public final class TlsPolitica {

    /** Los únicos protocolos permitidos, del más nuevo al más viejo. */
    public static final List<String> PERMITIDOS = Arrays.asList("TLSv1.3", "TLSv1.2");

    private TlsPolitica() {
    }

    /** Los protocolos soportados por el socket que además están permitidos (puede quedar vacío: entonces no se conecta). */
    public static String[] filtrar(String[] soportados) {
        List<String> out = new ArrayList<>();
        if (soportados != null) {
            for (String p : PERMITIDOS) {
                for (String s : soportados) {
                    if (p.equals(s)) {
                        out.add(p);
                        break;
                    }
                }
            }
        }
        return out.toArray(new String[0]);
    }
}
