// Selector de periodo con botones grandes (Hoy, Ayer, Esta semana, Este mes, Mes pasado, Otro periodo). Lo usan Listados y Recepción.
import { h, hoyCR, sumaDias } from './util.js';

const cssUrl = new URL('../css/periodo.css', import.meta.url).href;
const pad = (n) => String(n).padStart(2, '0');
export function rangoPeriodo(id, hoy = hoyCR()) {
  const [y, m] = hoy.split('-').map(Number);
  const dow = new Date(hoy + 'T12:00:00Z').getUTCDay(); // 0 = domingo
  switch (id) {
    case 'ayer': { const a = sumaDias(hoy, -1); return [a, a]; }
    case 'semana': return [sumaDias(hoy, -((dow + 6) % 7)), hoy]; // semana desde el lunes
    case 'mes': return [`${y}-${pad(m)}-01`, hoy];
    case 'mes_pasado': { const ult = sumaDias(`${y}-${pad(m)}-01`, -1); return [ult.slice(0, 8) + '01', ult]; }
    default: return [hoy, hoy];
  }
}

const fmt = (ymd, o) => new Intl.DateTimeFormat('es-CR', { timeZone: 'UTC', ...o }).format(new Date(ymd + 'T12:00:00Z'));
export const fechaLarga = (ymd) => fmt(ymd, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
export const fechaDMA = (ymd) => ymd ? ymd.split('-').reverse().join('/') : '';
export function textoRango(desde, hasta) {
  if (desde === hasta) return fechaLarga(desde);
  return 'del ' + fmt(desde, { weekday: 'long', day: 'numeric', month: 'long' }) + ' al ' + fechaLarga(hasta);
}

export const OPCIONES = [
  { id: 'hoy', texto: 'Hoy' }, { id: 'ayer', texto: 'Ayer' }, { id: 'semana', texto: 'Esta semana' },
  { id: 'mes', texto: 'Este mes' }, { id: 'mes_pasado', texto: 'Mes pasado' }, { id: 'otro', texto: 'Otro periodo' },
];

// alCambiar([desde, hasta], id) se llama al elegir. Devuelve {el, rango(), id(), elegir(id)}
export function selectorPeriodo({ inicial = 'hoy', alCambiar }) {
  if (!document.getElementById('css-periodo')) document.head.append(h('link', { id: 'css-periodo', rel: 'stylesheet', href: cssUrl }));
  let actual = inicial, rango = rangoPeriodo(inicial === 'otro' ? 'hoy' : inicial);
  const desde = h('input.campo', { type: 'date', 'aria-label': 'Desde', value: rango[0], max: hoyCR() });
  const hasta = h('input.campo', { type: 'date', 'aria-label': 'Hasta', value: rango[1], max: hoyCR() });
  const aviso = h('small.per-aviso', { hidden: true });
  const verBtn = h('button.btn.primario', { type: 'button', onclick: () => {
    if (!desde.value || !hasta.value) { aviso.textContent = 'Escoja las dos fechas.'; aviso.hidden = false; return; }
    if (hasta.value < desde.value) { aviso.textContent = 'La fecha final no puede ser anterior a la inicial.'; aviso.hidden = false; return; }
    aviso.hidden = true; rango = [desde.value, hasta.value]; alCambiar(rango, 'otro');
  } }, 'Ver este periodo');
  const otro = h('div.per-otro', { hidden: inicial !== 'otro' }, h('label.etq', 'Desde', desde), h('label.etq', 'Hasta', hasta), verBtn, aviso);
  const botones = OPCIONES.map((o) => h('button.btn.per-btn', { type: 'button', 'data-id': o.id, 'aria-pressed': String(o.id === actual), onclick: () => elegir(o.id, true) }, o.texto));
  function elegir(id, avisar) {
    actual = id;
    botones.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.id === id)));
    otro.hidden = id !== 'otro';
    if (id === 'otro') { desde.focus(); return; }
    rango = rangoPeriodo(id);
    desde.value = rango[0]; hasta.value = rango[1];
    if (avisar) alCambiar(rango, id);
  }
  const el = h('div.periodo', h('div.per-botones', { role: 'group', 'aria-label': 'Periodo' }, botones), otro);
  return { el, rango: () => rango, id: () => actual, elegir: (id) => elegir(id, true) };
}
