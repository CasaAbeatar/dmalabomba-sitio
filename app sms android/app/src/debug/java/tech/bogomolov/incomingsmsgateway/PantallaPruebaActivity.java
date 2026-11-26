package tech.bogomolov.incomingsmsgateway;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;

/**
 * La Bomba 2.10.0: pantalla de prueba para la pantalla remota. Fondo rojo liso (para reconocerla en la captura),
 * un botón grande que cuenta los toques y un campo de texto. El botón va primero para que sea él (y no el campo,
 * cuyo cursor parpadea) quien tenga el foco: así la pantalla queda quieta y los cuadros iguales se detectan.
 */
public class PantallaPruebaActivity extends Activity {

    public static volatile int toques = 0;
    /** true mientras la pantalla está al frente (la prueba la usa para ver que «inicio» y «atrás» funcionan). */
    public static volatile boolean alFrente = false;

    public Button boton;
    public EditText campo;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        LinearLayout raiz = new LinearLayout(this);
        raiz.setOrientation(LinearLayout.VERTICAL);
        raiz.setGravity(Gravity.CENTER);
        raiz.setBackgroundColor(Color.rgb(184, 22, 34));

        boton = new Button(this);
        boton.setText("TOCAR");
        boton.setTextSize(28);
        boton.setOnClickListener(v -> toques++);
        raiz.addView(boton, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 400));

        campo = new EditText(this);
        campo.setHint("escribir");
        campo.setBackgroundColor(Color.WHITE);
        campo.setFocusable(true);
        campo.setFocusableInTouchMode(true);
        raiz.addView(campo, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 160));

        setContentView(raiz);
        boton.requestFocus();
    }

    @Override
    protected void onResume() {
        super.onResume();
        alFrente = true;
    }

    @Override
    protected void onPause() {
        alFrente = false;
        super.onPause();
    }
}
