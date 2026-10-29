// Formulario para abrir la caja: el efectivo con que empieza el turno se escribe siempre; no hay montos predeterminados ni botones de un toque.
// Lo usa «Apertura y cierre de caja». Facturación puede usar el mismo (crearFormularioApertura) para que las dos pantallas sean idénticas.
// El servidor (fx_turno_abrir) no abre dos veces: si otra persona ya abrió la caja devuelve esa y marca ya_abierto, y aquí se le dice a la cajera.
import { h, money, money0, leerNumero, fechaCorta, horaCorta, conPunto, confirmar } from './util.js';
import { esTransitorio } from './api.js';
import { textoError } from './api_efectivo.js';

const TOPE = 99999999.99;
const cents = (n) => Math.round((Number(n) || 0) * 100);
const colones = (n) => (cents(n) % 100 === 0 ? money0(n) : money(n));
let contador = 0;

// api: app.api. socId y terminal: el local y la caja. sugerido: { monto, cuando } con lo que se contó al cerrar el último turno (opcional; no se escribe solo).
// alAbrir(respuesta, monto): se llama cuando el servidor confirmó; allí se actualiza la pantalla. Devuelve { el, enfocar }.
export function crearFormularioApertura({ api, socId, terminal = 1, local = '', sugerido = null, alAbrir } = {}) {
  const n = ++contador;
  const idLectura = 'apertura-lectura-' + n;
  let enviando = false;

  const fondo = h('input.campo.monto-grande', { type: 'text', inputmode: 'decimal', placeholder: '0', autocomplete: 'off', enterkeyhint: 'done',
    'aria-label': 'Efectivo con que abre la caja', 'aria-describedby': idLectura });
  const lectura = h('p.apertura-lectura', { id: idLectura, 'aria-live': 'polite' });
  const err = h('div.error-caja', { hidden: true, role: 'alert' });
  const abrir = h('button.btn.primario.grande.apertura-abrir', { type: 'button' }, 'Abrir caja');

  // Solo informa lo que se contó al cerrar el último turno; no se escribe solo ni es un botón: el monto siempre lo escribe la persona.
  const ultimo = sugerido && Number.isFinite(Number(sugerido.monto)) && Number(sugerido.monto) >= 0 && Number(sugerido.monto) <= TOPE
    ? h('p.apertura-ultimo', 'Al cerrar la caja el ' + fechaCorta(sugerido.cuando) + ' a las ' + horaCorta(sugerido.cuando) + ' se contaron ' + colones(sugerido.monto) + '.')
    : null;

  // Dice con palabras y en grande con cuánto se va a abrir, para que un cero de más o de menos se vea antes de tocar «Abrir caja»
  function mostrarLectura() {
    err.hidden = true;
    const txt = fondo.value.trim();
    if (!txt) { lectura.textContent = 'Escriba cuánto efectivo hay en la caja al empezar. Si no hay efectivo, escriba 0.'; lectura.className = 'apertura-lectura'; return; }
    const v = leerNumero(txt);
    if (!Number.isFinite(v) || v < 0 || v > TOPE) { lectura.textContent = 'Ese monto no es válido. Escriba solo números, por ejemplo 20000.'; lectura.className = 'apertura-lectura mal'; return; }
    lectura.textContent = 'Abrirá la caja con ' + colones(v) + '.';
    lectura.className = 'apertura-lectura ok';
  }
  function fallo(texto) { err.textContent = texto; err.hidden = false; fondo.focus(); }

  async function hacer() {
    if (enviando) return;
    err.hidden = true;
    const txt = fondo.value.trim();
    if (!txt) { fallo('Escriba cuánto efectivo hay en la caja al empezar. Si no hay efectivo, escriba 0.'); return; }
    const v = leerNumero(txt);
    if (!Number.isFinite(v) || v < 0) { fallo('Ese monto no es válido. Escriba solo números, por ejemplo 20000. Si no hay efectivo, escriba 0.'); return; }
    if (v > TOPE) { fallo('El monto es demasiado grande. El máximo es ' + money(TOPE) + '.'); return; }
    enviando = true; // también mientras se espera la respuesta de la ventana de abajo: un segundo toque no abre otra
    // Abrir en ₡0 cuando el último cierre contó dinero suele ser un descuido: ese efectivo sigue en el cajón y al cerrar saldría como sobrante. Se pregunta una vez, con una ventana de dos botones.
    if (cents(v) === 0 && ultimo && cents(sugerido.monto) > 0) {
      const sigue = await confirmar('El último cierre contó ' + colones(sugerido.monto) + ' y se va a abrir la caja con ₡0. Si ese efectivo sigue en la caja, al cerrar aparecerá como sobrante. ¿La caja empieza sin efectivo?',
        { si: 'Sí, abrir con ₡0', no: 'No, revisar el monto' });
      if (!sigue) { enviando = false; try { fondo.focus(); } catch { /* nada */ } return; }
    }
    abrir.disabled = true; abrir.setAttribute('aria-busy', 'true'); abrir.textContent = 'Abriendo la caja…';
    try {
      const res = await api.turnoAbrir(socId, terminal, Math.round(v * 100) / 100);
      await alAbrir?.(res, v);
    } catch (e) {
      // Abrir dos veces no duplica nada: si la caja alcanzó a abrirse, al tocar «Abrir caja» otra vez el sistema devuelve la que ya está abierta
      fallo(esTransitorio(e)
        ? 'No se pudo abrir la caja por la conexión. Revise internet y toque «Abrir caja» otra vez. Si la caja ya se había abierto, el sistema no abre otra.'
        : conPunto(textoError(e, 'No se pudo abrir la caja. Intente de nuevo; si sigue igual, avise a la persona encargada.')));
    } finally {
      enviando = false; abrir.disabled = false; abrir.removeAttribute('aria-busy'); abrir.textContent = 'Abrir caja';
    }
  }
  abrir.addEventListener('click', hacer);
  fondo.addEventListener('input', mostrarLectura);
  fondo.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (!e.repeat) hacer(); } });

  const el = h('div.apertura', { role: 'group', 'aria-label': 'Abrir la caja' },
    h('label.etq', 'Efectivo con que abre la caja (₡)', h('small', 'Cuente los billetes y monedas que hay en la caja y escriba el total.'), fondo),
    lectura,
    ultimo,
    err, abrir);
  mostrarLectura();
  return { el, enfocar: () => { try { fondo.focus(); } catch { /* nada */ } } };
}
