package tech.bogomolov.incomingsmsgateway;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

/** La Bomba 2.7.0: la empresa del latido sale de la plantilla de la regla. */
public class SigningRuleTest {
    @Test
    public void empresaDePlantilla() {
        assertEquals("soda", SigningRule.empresaDePlantilla("{\"from\":\"%from%\",\"empresa\":\"soda\",\"text\":\"%text%\"}"));
        assertEquals("pollos", SigningRule.empresaDePlantilla("{\"empresa\" : \"Pollos\"}"));
        assertEquals("", SigningRule.empresaDePlantilla("{\"from\":\"%from%\"}"));
        assertEquals("", SigningRule.empresaDePlantilla(null));
    }
}
