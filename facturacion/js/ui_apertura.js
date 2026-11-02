// Formulario para abrir la caja: el efectivo con que empieza el turno se escribe siempre; no hay montos predeterminados ni botones de un toque.
// Lo usa «Apertura y cierre de caja». Facturación puede usar el mismo (crearFormularioApertura) para que las dos pantallas sean idénticas.
// No se sugiere ningún monto: la caja puede abrir cada día con un efectivo distinto.
// El servidor (fx_turno_abrir) no abre dos veces: si otra persona ya abrió la caja devuelve esa y marca ya_abierto, y aquí se le dice a la cajera.
import { h, money, money0, leerNumero, conPunto } from './util.js';
import { imprimirAperturaAuto } from './imprimir_caja.js';
import { esTransitorio } from './api.js';
import { textoError } from './api_efectivo.js';

const TOPE = 99999999.99;
const cents = (n) => Math.round((Number(n) || 0) * 100);
const colones = (n) => (cents(n) % 100 === 0 ? money0(n) : money(n));
let contador = 0;

// api: app.api. socId y terminal: el local y la caja.
// alAbrir(respuesta, monto): se llama cuando el servidor confirmó; allí se actualiza la pantalla. Devuelve { el, enfocar }.
export function crearFormularioApertura({ api, socId, terminal = 1, local = '', soc = null, alAbrir } = {}) {
  const n = ++contador;
  const idLectura = 'apertura-lectura-' + n;
  let enviando = false;
  let ceroConfirmado = false; // abrir con ₡0 pide un segundo toque; no dice nada del cierre anterior (el cierre es ciego)

  const fondo = h('input.campo.monto-grande', { type: 'text', inputmode: 'decimal', placeholder: '0', autocomplete: 'off', enterkeyhint: 'done',
    'aria-label': 'Efectivo con que abre la caja', 'aria-describedby': idLectura });
  const lectura = h('p.apertura-lectura', { id: idLectura, 'aria-live': 'polite' });
  const err = h('div.error-caja', { hidden: true, role: 'alert' });
  const abrir = h('button.btn.primario.grande.apertura-abrir', { type: 'button' }, 'Abrir caja');

  // Dice con palabras y en grande con cuánto se va a abrir, para que un cero de más o de menos se vea antes de tocar «Abrir caja»
  function mostrarLectura() {
    err.hidden = true;
    ceroConfirmado = false; abrir.textContent = 'Abrir caja';
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
    if (v === 0 && !ceroConfirmado) {
      ceroConfirmado = true; abrir.textContent = 'Sí, abrir con ₡0';
      lectura.textContent = 'Va a abrir la caja con ₡0. Si hay billetes o monedas en la caja, cuéntelos y escriba el total. Si de verdad no hay efectivo, toque «Sí, abrir con ₡0».'; lectura.className = 'apertura-lectura mal';
      return;
    }
    enviando = true; // también mientras se espera la respuesta de la ventana de abajo: un segundo toque no abre otra
    abrir.disabled = true; abrir.setAttribute('aria-busy', 'true'); abrir.textContent = 'Abriendo la caja…';
    try {
      const res = await api.turnoAbrir(socId, terminal, Math.round(v * 100) / 100);
      await alAbrir?.(res, v);
      // Tiquete de apertura en la impresora POS (solo si la caja se abrió ahora). No se espera: el cuadro de impresión no debe dejar a la cajera esperando.
      if (soc && res && !res.ya_abierto) imprimirAperturaAuto(soc, res).catch((e) => console.warn('No se pudo imprimir el tiquete de apertura:', e));
    } catch (e) {
      // Abrir dos veces no duplica nada: si la caja alcanzó a abrirse, al tocar «Abrir caja» otra vez el sistema devuelve la que ya está abierta
      fallo(esTransitorio(e)
        ? 'No se pudo abrir la caja por la conexión. Revise internet y toque «Abrir caja» otra vez. Si la caja ya se había abierto, el sistema no abre otra.'
        : conPunto(textoError(e, 'No se pudo abrir la caja. Intente de nuevo; si sigue igual, avise a la persona encargada.')));
    } finally {
      enviando = false; abrir.disabled = false; abrir.removeAttribute('aria-busy'); abrir.textContent = ceroConfirmado ? 'Sí, abrir con ₡0' : 'Abrir caja';
    }
  }
  abrir.addEventListener('click', hacer);
  fondo.addEventListener('input', mostrarLectura);
  fondo.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (!e.repeat) hacer(); } });

  const el = h('div.apertura', { role: 'group', 'aria-label': 'Abrir la caja' },
    h('label.etq', 'Efectivo con que abre la caja (₡)', h('small', 'Cuente los billetes y monedas que hay en la caja y escriba el total.'), fondo),
    lectura,
    err, abrir);
  mostrarLectura();
  return { el, enfocar: () => { try { fondo.focus(); } catch { /* nada */ } } };
}
