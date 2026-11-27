package tech.bogomolov.incomingsmsgateway;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.Arrays;
import java.util.Collections;

/** La Bomba 2.12.0 (auditoría): cuándo puede pulsar el servicio de accesibilidad el botón del instalador (JVM pura). */
public class InstaladorPoliticaTest {

    @Test
    public void soloLosInstaladoresDeLaListaCerrada() {
        for (String ok : new String[]{"com.google.android.packageinstaller", "com.android.packageinstaller",
                "com.samsung.android.packageinstaller", "com.huawei.android.packageinstaller", "com.hihonor.android.packageinstaller"}) {
            assertTrue(ok, InstaladorPolitica.paqueteValido(ok));
        }
        assertEquals(5, InstaladorPolitica.PAQUETES.size());
        // nada que no esté en la lista, aunque sea del sistema o se parezca
        for (String no : new String[]{null, "", "com.android.settings", "com.google.android.gms", "com.android.systemui",
                "tech.bogomolov.incomingsmsgateway", "com.android.packageinstaller.evil", "COM.ANDROID.PACKAGEINSTALLER",
                " com.android.packageinstaller", "com.hihonor.packageinstaller", "com.huawei.packageinstaller",
                "com.android.vending", "com.example.packageinstaller"}) {
            assertFalse(String.valueOf(no), InstaladorPolitica.paqueteValido(no));
        }
    }

    @Test
    public void laVentanaDePulsadoEsDe90SegundosDesdeLaSesion() {
        long t0 = 5_000_000L;
        assertEquals(90_000L, InstaladorPolitica.VENTANA_MS);
        assertTrue(InstaladorPolitica.dentroDeVentana(t0, t0));
        assertTrue(InstaladorPolitica.dentroDeVentana(t0, t0 + 89_999));
        assertFalse(InstaladorPolitica.dentroDeVentana(t0, t0 + 90_000));
        assertFalse(InstaladorPolitica.dentroDeVentana(t0, t0 + 180_000));
        assertFalse("reloj anterior a la sesión", InstaladorPolitica.dentroDeVentana(t0, t0 - 1));
        assertFalse("sin sesión abierta por la app no se pulsa", InstaladorPolitica.dentroDeVentana(0, 10_000));
        assertFalse(InstaladorPolitica.dentroDeVentana(-5, 10_000));
    }

    @Test
    public void exigeElNombreDeLaAppEnElTextoDeLaVentana() {
        Iterable<String> dialogo = Arrays.asList("Sms Forwarder", "Do you want to update this app?", "Cancel", "Update");
        assertTrue(InstaladorPolitica.contieneNombreDeApp(dialogo, "Sms Forwarder"));
        assertTrue("sin distinguir mayúsculas", InstaladorPolitica.contieneNombreDeApp(dialogo, "sms forwarder"));
        assertTrue("el nombre dentro de una frase", InstaladorPolitica.contieneNombreDeApp(
                Arrays.asList("¿Quieres actualizar Sms Forwarder?", "Cancelar", "Actualizar"), "Sms Forwarder"));
        // diálogo de OTRA app: no se pulsa
        assertFalse(InstaladorPolitica.contieneNombreDeApp(
                Arrays.asList("Otra App", "Do you want to update this app?", "Cancel", "Update"), "Sms Forwarder"));
        assertFalse(InstaladorPolitica.contieneNombreDeApp(Collections.<String>emptyList(), "Sms Forwarder"));
        assertFalse(InstaladorPolitica.contieneNombreDeApp(null, "Sms Forwarder"));
        assertFalse(InstaladorPolitica.contieneNombreDeApp(dialogo, null));
        assertFalse("un nombre vacío no vale para todo", InstaladorPolitica.contieneNombreDeApp(dialogo, ""));
        assertFalse(InstaladorPolitica.contieneNombreDeApp(dialogo, "   "));
        assertFalse(InstaladorPolitica.contieneNombreDeApp(Arrays.asList((String) null), "Sms Forwarder"));
    }

    @Test
    public void soloBotonesConElTextoExacto() {
        for (String ok : new String[]{"Instalar", "Actualizar", "Update", "Install", "  install ", "ACTUALIZAR"}) {
            assertTrue(ok, InstaladorPolitica.textoDeBotonValido(ok));
        }
        for (String no : new String[]{null, "", "Cancel", "Cancelar", "Install anyway", "Instalar de todos modos", "Update all", "Open"}) {
            assertFalse(String.valueOf(no), InstaladorPolitica.textoDeBotonValido(no));
        }
    }
}
