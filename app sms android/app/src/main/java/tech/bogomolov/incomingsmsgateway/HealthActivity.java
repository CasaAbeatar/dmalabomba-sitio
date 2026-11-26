package tech.bogomolov.incomingsmsgateway;

import android.Manifest;
import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Intent;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.LayoutInflater;
import android.view.MenuItem;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import java.util.ArrayList;
import java.util.List;

/**
 * La Bomba 2.7.0: pantalla «Salud del teléfono». Semáforo verde/rojo de todo lo que puede dormir o matar la app,
 * un botón por cada cosa que diga con palabras qué hace, y «Arreglar todo», que recorre los pendientes uno a uno.
 * Se vuelve a calcular cada vez que se regresa a la pantalla.
 */
public class HealthActivity extends AppCompatActivity {

    private static final int REQ_PERMISO = 41;

    private LinearLayout lista;
    private TextView resumen;

    // «Arreglar todo»: cola de ids por atender en este recorrido. null = no hay recorrido.
    private List<String> cola = null;
    private String esperando = null;        // id cuyo ajuste se abrió y se espera el regreso
    private String permisoPendiente = null; // id cuyo permiso se pidió (el resultado llega por onRequestPermissionsResult)
    private AlertDialog dialogo = null;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_health);
        setTitle(R.string.health_title);
        if (getSupportActionBar() != null) getSupportActionBar().setDisplayHomeAsUpEnabled(true);
        lista = findViewById(R.id.health_list);
        resumen = findViewById(R.id.health_summary);
        findViewById(R.id.health_fix_all).setOnClickListener(v -> arreglarTodo());
        findViewById(R.id.health_dedicated_off).setOnClickListener(v -> confirmarDejarDedicado());
    }

    @Override
    protected void onResume() {
        super.onResume();
        refrescar();
        if (cola != null && esperando != null) {
            String id = esperando;
            esperando = null;
            HealthCheck.Item it = buscar(id);
            if (it != null && it.pendiente() && it.manual) {
                preguntarSiYaLoHizo(it);
            } else {
                siguiente();
            }
        }
    }

    @Override
    protected void onDestroy() {
        if (dialogo != null && dialogo.isShowing()) dialogo.dismiss();
        super.onDestroy();
    }

    @Override
    public boolean onOptionsItemSelected(MenuItem item) {
        if (item.getItemId() == android.R.id.home) {
            finish();
            return true;
        }
        return super.onOptionsItemSelected(item);
    }

    // ------------------------------------------------------------------ pantalla

    private List<HealthCheck.Item> actuales = new ArrayList<>();

    private HealthCheck.Item buscar(String id) {
        for (HealthCheck.Item i : actuales) if (i.id.equals(id)) return i;
        return null;
    }

    private void refrescar() {
        actuales = HealthCheck.evaluar(this);
        int pend = 0;
        for (HealthCheck.Item i : actuales) if (i.pendiente()) pend++;
        resumen.setText(pend == 0 ? getString(R.string.health_summary_ok) : getString(R.string.health_summary_bad, pend));
        findViewById(R.id.health_fix_all).setVisibility(pend == 0 ? View.GONE : View.VISIBLE);
        findViewById(R.id.health_fix_all_hint).setVisibility(pend == 0 ? View.GONE : View.VISIBLE);

        lista.removeAllViews();
        LayoutInflater inf = LayoutInflater.from(this);
        // Lo que falta (rojo) va arriba; luego lo que está bien; al final lo que solo informa.
        List<HealthCheck.Item> ordenados = new ArrayList<>();
        for (HealthCheck.Item i : actuales) if (i.pendiente()) ordenados.add(i);
        for (HealthCheck.Item i : actuales) if (!i.pendiente() && !i.informativo) ordenados.add(i);
        for (HealthCheck.Item i : actuales) if (i.informativo) ordenados.add(i);
        for (final HealthCheck.Item it : ordenados) {
            View v = inf.inflate(R.layout.item_health, lista, false);
            v.setTag(it.id);
            int color = it.informativo ? ContextCompat.getColor(this, R.color.colorNeutral)
                    : ContextCompat.getColor(this, it.ok ? R.color.colorOk : R.color.colorDanger);
            View dot = v.findViewById(R.id.h_dot);
            dot.setBackgroundResource(R.drawable.bg_dot);
            ((GradientDrawable) dot.getBackground().mutate()).setColor(color);
            ((TextView) v.findViewById(R.id.h_title)).setText(it.titulo);
            TextView estado = v.findViewById(R.id.h_state);
            estado.setText(it.informativo ? R.string.health_state_info : (it.ok ? R.string.health_state_ok : R.string.health_state_bad));
            estado.setTextColor(color);
            ((TextView) v.findViewById(R.id.h_help)).setText(it.ayuda);

            Button fix = v.findViewById(R.id.h_fix);
            Button done = v.findViewById(R.id.h_done);
            boolean mostrarFix = it.boton != 0 && (!it.ok || it.id.equals(HealthCheck.LATIDO)) && !it.informativo;
            // Lo que ya está bien no necesita botón, salvo el latido (enviar uno ahora siempre sirve).
            if (mostrarFix) {
                fix.setVisibility(View.VISIBLE);
                fix.setText(it.boton);
                fix.setOnClickListener(x -> arreglar(it, false));
            }
            if (it.manual) {
                done.setVisibility(View.VISIBLE);
                done.setText(it.ok ? R.string.health_btn_undo : R.string.health_btn_done);
                done.setOnClickListener(x -> {
                    new GuardianState(this).confirmar(it.id, !it.ok);
                    refrescar();
                });
            }
            lista.addView(v);
        }
        findViewById(R.id.health_dedicated).setVisibility(Guardian.esDispositivoDedicado(this) ? View.VISIBLE : View.GONE);
    }

    // ------------------------------------------------------------------ arreglar todo

    private void arreglarTodo() {
        cola = new ArrayList<>();
        for (HealthCheck.Item i : actuales) if (i.pendiente() && i.boton != 0) cola.add(i.id);
        esperando = null;
        permisoPendiente = null;
        siguiente();
    }

    private void siguiente() {
        while (cola != null && !cola.isEmpty()) {
            String id = cola.remove(0);
            HealthCheck.Item it = buscar(id);
            if (it == null || !it.pendiente()) continue;
            arreglar(it, true);
            return;
        }
        if (cola != null) {
            cola = null;
            refrescar();
            int pend = HealthCheck.contarPendientes(this);
            Toast.makeText(this, pend == 0 ? getString(R.string.health_fix_all_done)
                    : getString(R.string.health_fix_all_left, pend), Toast.LENGTH_LONG).show();
        }
    }

    private void preguntarSiYaLoHizo(final HealthCheck.Item it) {
        dialogo = new AlertDialog.Builder(this)
                .setTitle(R.string.health_ask_done_title)
                .setMessage(getString(R.string.health_ask_done_message) + "\n\n" + getString(it.titulo))
                .setCancelable(false)
                .setPositiveButton(R.string.health_ask_yes, (d, w) -> {
                    new GuardianState(this).confirmar(it.id, true);
                    refrescar();
                    siguiente();
                })
                .setNegativeButton(R.string.health_ask_no, (d, w) -> siguiente())
                .show();
    }

    // ------------------------------------------------------------------ acciones por cada comprobación

    private void arreglar(HealthCheck.Item it, boolean enRecorrido) {
        switch (it.id) {
            case HealthCheck.SMS:
                pedirPermiso(it.id, Manifest.permission.RECEIVE_SMS, enRecorrido);
                break;
            case HealthCheck.LEER_SMS:
                pedirPermiso(it.id, Manifest.permission.READ_SMS, enRecorrido);
                break;
            case HealthCheck.UBICACION:
                pedirPermiso(it.id, Manifest.permission.ACCESS_FINE_LOCATION, enRecorrido);
                break;
            case HealthCheck.UBICACION_SIEMPRE:
                // Android 11+ no muestra diálogo: manda a la pantalla de permisos de la app, donde se elige «Permitir siempre».
                if (Build.VERSION.SDK_INT >= 30) {
                    abrirAjuste(it.id, enRecorrido, new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName())));
                } else {
                    pedirPermiso(it.id, Manifest.permission.ACCESS_BACKGROUND_LOCATION, enRecorrido);
                }
                break;
            case HealthCheck.TELEFONO:
                pedirPermiso(it.id, Manifest.permission.READ_PHONE_STATE, enRecorrido);
                break;
            case HealthCheck.USO:
                abrirAjuste(it.id, enRecorrido, new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS, Uri.parse("package:" + getPackageName())),
                        new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS));
                break;
            case HealthCheck.SUPERPOSICION:
                abrirAjuste(it.id, enRecorrido, new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getPackageName())));
                break;
            case HealthCheck.AJUSTES:
                abrirAjuste(it.id, enRecorrido, new Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS, Uri.parse("package:" + getPackageName())));
                break;
            case HealthCheck.NO_MOLESTAR:
                abrirAjuste(it.id, enRecorrido, new Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS));
                break;
            case HealthCheck.NOTIF:
                if (Build.VERSION.SDK_INT >= 33) {
                    pedirPermiso(it.id, Manifest.permission.POST_NOTIFICATIONS, enRecorrido);
                } else {
                    abrirAjuste(it.id, enRecorrido, ajusteNotificaciones());
                }
                break;
            case HealthCheck.BATERIA:
                abrirAjuste(it.id, enRecorrido, concat(intentBateriaLibre(), new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)));
                break;
            case HealthCheck.AHORRO:
                abrirAjuste(it.id, enRecorrido,
                        new Intent(Build.VERSION.SDK_INT >= 22 ? Settings.ACTION_BATTERY_SAVER_SETTINGS : Settings.ACTION_SETTINGS));
                break;
            case HealthCheck.SERVICIO:
                Guardian.startServiceSafely(this);
                lista.postDelayed(() -> {
                    refrescar();
                    if (enRecorrido) siguiente();
                }, 1200);
                break;
            case HealthCheck.AUTOINICIO:
                abrirAjuste(it.id, enRecorrido, intentsAutoinicio());
                break;
            case HealthCheck.RESTRINGIDOS:
                abrirAjuste(it.id, enRecorrido, new Intent[0]);   // cae a la información de la app
                break;
            case HealthCheck.WIFI:
                abrirAjuste(it.id, enRecorrido, new Intent(Settings.ACTION_WIFI_SETTINGS));
                break;
            case HealthCheck.LATIDO:
                latido(it, enRecorrido);
                break;
            default:
                if (enRecorrido) siguiente();
        }
    }

    private void pedirPermiso(String id, String permiso, boolean enRecorrido) {
        if (Guardian.tienePermiso(this, permiso)) {
            refrescar();
            if (enRecorrido) siguiente();
            return;
        }
        permisoPendiente = enRecorrido ? id : null;
        ActivityCompat.requestPermissions(this, new String[]{permiso}, REQ_PERMISO);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != REQ_PERMISO) return;
        boolean dado = grantResults.length > 0 && grantResults[0] == android.content.pm.PackageManager.PERMISSION_GRANTED;
        if (!dado) Toast.makeText(this, R.string.health_perm_denied, Toast.LENGTH_LONG).show();
        boolean enRecorrido = permisoPendiente != null;
        permisoPendiente = null;
        refrescar();
        if (enRecorrido) siguiente();
    }

    private static Intent[] concat(Intent[] a, Intent b) {
        Intent[] r = new Intent[a.length + 1];
        System.arraycopy(a, 0, r, 0, a.length);
        r[a.length] = b;
        return r;
    }

    private Intent[] intentBateriaLibre() {
        if (Build.VERSION.SDK_INT >= 23) {
            // Pide a Android sacar a esta app de la restricción de batería (necesita REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).
            return new Intent[]{new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                    Uri.parse("package:" + getPackageName()))};
        }
        return new Intent[0];
    }

    private void abrirAjuste(String id, boolean enRecorrido, Intent... intents) {
        abrirAjusteLista(id, enRecorrido, intents);
    }

    private Intent ajusteNotificaciones() {
        if (Build.VERSION.SDK_INT >= 26) {
            return new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName());
        }
        return new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()));
    }

    /** HONOR/Huawei: administrador de inicio de apps. Nombres de actividad conocidos; si ninguno abre, cae a la info de la app. */
    private Intent[] intentsAutoinicio() {
        String[][] c = {
                {"com.hihonor.systemmanager", "com.hihonor.systemmanager.appcontrol.activity.StartupAppControlActivity"},
                {"com.huawei.systemmanager", "com.huawei.systemmanager.appcontrol.activity.StartupAppControlActivity"},
                {"com.hihonor.systemmanager", "com.hihonor.systemmanager.startupmgr.ui.StartupNormalAppListActivity"},
                {"com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"},
                {"com.huawei.systemmanager", "com.huawei.systemmanager.optimize.process.ProtectActivity"},
        };
        Intent[] out = new Intent[c.length];
        for (int i = 0; i < c.length; i++) {
            out[i] = new Intent().setComponent(new ComponentName(c[i][0], c[i][1]));
        }
        return out;
    }

    // Prueba cada intent en orden; si ninguno abre, deja la información de la app (siempre existe).
    private void abrirAjusteLista(String id, boolean enRecorrido, Intent[] intents) {
        boolean abrio = false;
        for (Intent i : intents) {
            try {
                startActivity(i);
                abrio = true;
                break;
            } catch (ActivityNotFoundException | SecurityException e) {
                // siguiente
            }
        }
        if (!abrio) {
            try {
                startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName())));
                if (intents.length > 0) Toast.makeText(this, R.string.health_not_opened, Toast.LENGTH_LONG).show();
                abrio = true;
            } catch (Exception e) {
                // sin pantalla de ajustes: se sigue
            }
        }
        if (enRecorrido) {
            if (abrio) esperando = id; else siguiente();
        }
    }

    private void latido(final HealthCheck.Item it, final boolean enRecorrido) {
        HeartbeatSettings hs = HeartbeatSettings.load(this);
        if (!hs.isEnabled() || hs.getUrl().isEmpty()) {
            startActivity(new Intent(this, SettingsActivity.class));
            if (enRecorrido) esperando = it.id;
            return;
        }
        new Thread(() -> {
            final String r = Guardian.sendHeartbeat(getApplicationContext(), true);
            runOnUiThread(() -> {
                Toast.makeText(this, getString(R.string.h_hb_sent_toast, r), Toast.LENGTH_LONG).show();
                refrescar();
                if (enRecorrido) siguiente();
            });
        }).start();
    }

    // ------------------------------------------------------------------ modo teléfono dedicado

    private void confirmarDejarDedicado() {
        dialogo = new AlertDialog.Builder(this)
                .setTitle(R.string.h_dedicated_btn)
                .setMessage(R.string.h_dedicated_confirm)
                .setPositiveButton(R.string.h_dedicated_btn, (d, w) -> {
                    boolean ok = Guardian.dejarDeSerDedicado(this);
                    Toast.makeText(this, ok ? R.string.h_dedicated_done : R.string.h_dedicated_fail, Toast.LENGTH_LONG).show();
                    refrescar();
                })
                .setNegativeButton(R.string.btn_cancel, null)
                .show();
    }
}
