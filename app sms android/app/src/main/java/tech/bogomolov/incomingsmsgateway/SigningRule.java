package tech.bogomolov.incomingsmsgateway;

import android.content.Context;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * La Bomba: la primera regla de reenvío con firma HMAC encendida y clave. De ella salen la clave del
 * latido y la empresa (soda o pollos) que viene en la plantilla. Misma lógica que usa HistoryForwarder.
 */
public final class SigningRule {
    public final String secret;
    public final String empresa;
    public final String url;
    public final boolean ignoreSsl;

    private SigningRule(String secret, String empresa, String url, boolean ignoreSsl) {
        this.secret = secret;
        this.empresa = empresa;
        this.url = url;
        this.ignoreSsl = ignoreSsl;
    }

    private static final Pattern EMPRESA = Pattern.compile("\"empresa\"\\s*:\\s*\"([A-Za-z]{0,10})\"");

    /** Empresa en minúsculas tomada de la plantilla, o "" si no la trae. */
    public static String empresaDePlantilla(String plantilla) {
        if (plantilla == null) return "";
        Matcher m = EMPRESA.matcher(plantilla);
        return m.find() ? m.group(1).toLowerCase() : "";
    }

    /** @return la regla con firma, o null si no hay ninguna. */
    public static SigningRule find(Context ctx) {
        for (ForwardingConfig c : ForwardingConfig.getAll(ctx)) {
            String k = c.getSignHmacSha256Secret();
            if (c.getSignHmacSha256() && k != null && !k.isEmpty()) {
                return new SigningRule(k, empresaDePlantilla(c.getTemplate()), c.getUrl(), c.getIgnoreSsl());
            }
        }
        return null;
    }
}
