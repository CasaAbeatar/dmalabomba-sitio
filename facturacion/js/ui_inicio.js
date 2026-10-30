// Pantalla de inicio y pantalla de Administración: tarjetas grandes armadas a partir del registro de módulos (modulos.js).
import { h, horaCorta, fechaCorta, hoyCR } from './util.js';
import { s } from './graficos.js';
import { modulosDe, insigniaDe, descripcionDe } from './modulos.js';

/* ---------- Dibujos de línea fina (decorativos; la palabra siempre va escrita al lado) ---------- */
const P = (d) => ['path', { d }];
const ICONOS = {
  facturar: [P('M14 8H50V56L44 51L38 56L32 51L26 56L20 51L14 56Z'), P('M22 20H42M22 29H42M22 38H33')],
  impresora: [P('M18 24V9H46V24'), ['rect', { x: 8, y: 24, width: 48, height: 22, rx: 4 }], ['rect', { x: 18, y: 37, width: 28, height: 18, rx: 1.5, class: 'rel' }], P('M24 44H40M24 49.5H35'), ['circle', { cx: 49, cy: 31, r: 1.7 }]],
  personas: [['circle', { cx: 24, cy: 21, r: 8 }], P('M7 54C7 43 14 35 24 35S41 43 41 54'), ['circle', { cx: 46, cy: 25, r: 6 }], P('M44 36C52 36 57 42 57 51')],
  ajustes: [P('M9 18H55M9 32H55M9 46H55'), ['circle', { cx: 22, cy: 18, r: 5.5, class: 'rel' }], ['circle', { cx: 42, cy: 32, r: 5.5, class: 'rel' }], ['circle', { cx: 28, cy: 46, r: 5.5, class: 'rel' }]],
  caja: [P('M12 30L17 14H47L52 30'), ['rect', { x: 8, y: 30, width: 48, height: 24, rx: 4 }], ['circle', { cx: 32, cy: 42, r: 6.5 }], P('M29.5 42H34.5')],
  producto: [P('M32 7L55 19V44L32 57L9 44V19Z'), P('M9 19L32 32L55 19M32 32V57')],
  bodega: [P('M6 26L32 9L58 26'), P('M10 23V56H54V23'), P('M20 56V34H44V56'), P('M20 41H44M20 48H44')],
  barras: [P('M9 9V55H56'), ['rect', { x: 17, y: 34, width: 8, height: 21, rx: 1.5 }], ['rect', { x: 30, y: 23, width: 8, height: 32, rx: 1.5 }], ['rect', { x: 43, y: 13, width: 8, height: 42, rx: 1.5 }]],
  emitidas: [P('M10 8H38V56H10Z'), P('M17 19H31M17 27H31M17 35H25'), P('M43 32H57M51 25L58 32L51 39')],
  libro: [P('M15 6H40L50 16V58H15Z'), P('M40 6V16H50M22 28H43M22 36H43'), P('M23 48L29 54L41 42')],
  usuario: [['circle', { cx: 32, cy: 21, r: 10 }], P('M11 57C11 44 20 36 32 36S53 44 53 57')],
  numeracion: [P('M24 8L19 56M44 8L39 56'), P('M10 23H56M8 41H54')],
  aviso: [P('M10 14H54V42H30L18 54V42H10Z'), P('M20 24H44M20 32H36')],
  respaldo: [P('M12 14C12 8 52 8 52 14V50C52 56 12 56 12 50Z'), P('M12 14C12 20 52 20 52 14'), P('M12 27C12 33 52 33 52 27'), P('M12 39C12 45 52 45 52 39')],
};
export function icono(nombre) {
  const partes = ICONOS[nombre] || ICONOS.producto;
  return s('svg', { class: 'mod-ico', viewBox: '0 0 64 64', 'aria-hidden': 'true', focusable: 'false' }, partes.map(([tag, attrs]) => s(tag, attrs)));
}

/* ---------- Tarjeta de un módulo ---------- */
function textoInsignia(i) { return i ? h('span.mod-insignia' + (i.urgente ? '.urgente' : ''), i.texto) : null; }
export function tarjetaModulo(m, app, alAbrir) {
  const bloq = !!m.emite && app?.soc?.puede_emitir === false;
  return h('button.mod-tarjeta' + (m.destacado && !bloq ? '.destacada' : '') + (bloq ? '.bloqueada' : ''), { type: 'button', 'data-mod': m.id, onclick: () => alAbrir(m) },
    icono(m.icono),
    h('span.mod-titulo', m.titulo),
    h('span.mod-desc', descripcionDe(m, app)),
    textoInsignia(insigniaDe(m, app)));
}
// Vuelve a escribir las insignias de las tarjetas que se ven (cuando cambian las cifras sin cambiar de pantalla)
export function pintarInsignias(raiz, app) {
  if (!raiz) return;
  raiz.querySelectorAll('.mod-tarjeta[data-mod]').forEach((b) => {
    const m = [...modulosDe('principal', app), ...modulosDe('admin', app)].find((x) => x.id === b.dataset.mod);
    if (!m) return;
    b.querySelector('.mod-insignia')?.remove();
    const n = textoInsignia(insigniaDe(m, app));
    if (n) b.append(n);
  });
}

/* ---------- Inicio: lo de HOY y los módulos principales ---------- */
export function pantallaInicio(app, { alAbrir, alCerrarCaja, alAbrirCaja }) {
  const t = app.turno;
  const desde = t ? (new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Costa_Rica' }).format(new Date(t.abierto_en)) < hoyCR() ? ' del ' + fechaCorta(t.abierto_en) : '') : '';
  // Una caja que lleva más de 18 horas abierta casi siempre se olvidó de cerrar: el recuadro se pone ámbar y lo dice
  const horasAbierta = t ? Math.floor((Date.now() - new Date(t.abierto_en).getTime()) / 3600000) : 0;
  const larga = !!t && horasAbierta >= 18;
  const franja = h('div.hoy-franja' + (larga ? '.larga' : ''), { role: 'status' },
    h('div.hoy-texto', h('span.hoy-et', 'Hoy'), h('strong', t ? 'Caja abierta desde las ' + horaCorta(t.abierto_en) + desde : 'Caja cerrada'),
      larga ? h('span.hoy-larga', 'Lleva ' + horasAbierta + ' horas abierta. ¿Hay que cerrarla?') : null),
    t ? h('button.btn', { type: 'button', onclick: alCerrarCaja }, 'Cerrar caja')
      : h('button.btn.primario', { type: 'button', onclick: alAbrirCaja }, 'Abrir caja'));
  const mods = modulosDe('principal', app);
  const rejilla = h('div.mod-rejilla.principal' + (mods.length === 4 ? '.cuatro' : ''), mods.map((m) => tarjetaModulo(m, app, alAbrir)));
  return h('div.inicio', h('h1.solo-lectores', 'Inicio'), franja, rejilla);
}

/* ---------- Administración: los módulos del grupo «admin» ---------- */
export function pantallaAdmin(app, { alAbrir }) {
  return h('div.inicio.admin', h('h1.solo-lectores', 'Administración'),
    h('div.mod-rejilla.admin', modulosDe('admin', app).map((m) => tarjetaModulo(m, app, alAbrir))));
}
