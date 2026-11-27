// Piezas comunes de «Caja para mí»: estilos, tarjetas, tablas que se apilan en el celular, carga con reintento, selector de periodo con memoria y gráficos con lectura.
import { h, esqueleto, bloqueError, textoDeError, hoyCR } from './util.js';
import { selectorPeriodo } from './periodo.js';
import { graficoColumnas, columnasAngostas, autoAjustar } from './graficos.js';

const HOJAS = [['css-listados', '../css/listados.css'], ['css-sinpe-caja', '../css/sinpe_caja.css']];
// listados.css trae los estilos de los gráficos de columnas (.gr); sinpe_caja.css, los de esta pantalla.
export function cargarCssCaja() {
  return Promise.all(HOJAS.map(([id, ruta]) => new Promise((ok) => {
    if (document.getElementById(id) || document.querySelector('link[href$="' + ruta.split('/').pop() + '"]')) return ok();
    const l = h('link', { id, rel: 'stylesheet', href: new URL(ruta, import.meta.url).href });
    l.onload = l.onerror = () => ok();
    document.head.append(l);
    setTimeout(ok, 1500);
  }))).then(() => {});
}

export const chip = (txt, clase = '') => h('span.chip' + (clase ? '.' + clase : ''), txt);
export const kpi = (titulo, valor, nota, clase = '') => h('div.sc-kpi' + (clase ? '.' + clase : ''), h('div.sc-kpi-t', titulo), h('div.sc-kpi-v', valor), nota ? h('div.sc-kpi-n', nota) : null);

// cols: [{ t: 'Título', der?: true, cab?: true (primera celda grande en celular), ancha?: true (ocupa todo el renglón en celular) }]
// filas: lista de listas de contenido (una por columna). pie: lista de contenido para la fila de totales.
export function tablaApilable(cols, filas, pie = null) {
  const clase = (c) => [c.der ? 'der' : '', c.cab ? 'cab' : '', c.ancha ? 'ancha' : '', c.nw ? 'nw' : ''].filter(Boolean).join(' ');
  const celda = (c, v, tag = 'td') => h(tag, { class: clase(c), 'data-t': c.t }, v);
  return h('div.sc-tabla-caja', h('table.sc-tabla',
    h('thead', h('tr', cols.map((c) => h('th', { class: c.der ? 'der' : '' }, c.t)))),
    h('tbody', filas.map((f) => h('tr', f.map((v, i) => celda(cols[i], v))))),
    pie ? h('tfoot', h('tr', pie.map((v, i) => celda(cols[i], v)))) : null));
}

// Zona que se llena sola: muestra «Cargando…», pinta lo que devuelve cargar() y, si falla, dice por qué y ofrece «Intentar de nuevo».
// recargar(true) refresca sin vaciar la pantalla (si falla, deja lo que ya había).
export function zonaCarga({ cargar, pintar, filas = 3 }) {
  const el = h('div.sc-zona');
  let ficha = 0;
  async function recargar(silencioso = false) {
    const mi = ++ficha;
    if (!silencioso || !el.firstChild) el.replaceChildren(esqueleto(filas));
    try {
      const datos = await cargar();
      if (mi !== ficha) return;
      el.replaceChildren(pintar(datos));
    } catch (e) {
      if (mi !== ficha) return;
      if (silencioso && el.firstChild && !el.querySelector('.esqueleto')) return;
      el.replaceChildren(bloqueError({ titulo: 'No se pudo cargar', mensaje: textoDeError(e), alReintentar: () => recargar() }));
    }
  }
  return { el, recargar, destruir: () => { ficha++; } };
}

// Selector de periodo que recuerda lo escogido (mem = { id, rango }) aunque se salga de la pantalla y se vuelva.
export function periodoConMemoria(mem, alCambiar, idInicial = 'mes') {
  if (!mem.id) mem.id = idInicial;
  const sel = selectorPeriodo({ inicial: mem.id, alCambiar: (rango, id) => { mem.id = id; mem.rango = rango; alCambiar(rango, id); } });
  if (mem.id === 'otro' && mem.rango) {
    const [d, a] = sel.el.querySelectorAll('.per-otro input[type=date]');
    if (d) d.value = mem.rango[0];
    if (a) a.value = mem.rango[1];
  } else mem.rango = sel.rango();
  return { el: sel.el, rango: () => (mem.id === 'otro' && mem.rango ? mem.rango : sel.rango()) };
}

// Meses para escoger (el más reciente primero): [{ valor: 'AAAA-MM-01', texto: 'noviembre 2026' }]
export function mesesParaEscoger(cuantos = 14, hoy = hoyCR()) {
  const MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  let y = +hoy.slice(0, 4), m = +hoy.slice(5, 7);
  const out = [];
  for (let i = 0; i < cuantos; i++) { out.push({ valor: `${y}-${String(m).padStart(2, '0')}-01`, texto: MES[m - 1] + ' ' + y }); m--; if (m === 0) { m = 12; y--; } }
  return out;
}

// Gráfico de columnas con su lectura al tocar. En pantallas angostas se avanza con botones grandes. limpiezas: lista donde se guarda lo que hay que soltar al salir.
export function columnasConLectura(datos, opc, limpiezas, vacioTxt = 'No hay datos en este período.') {
  if (!datos.length) return h('p.sc-vacio', vacioTxt);
  const lect = h('p.sc-lectura', { 'aria-live': 'polite' }, 'Toque o pase el cursor sobre una columna para ver el detalle.');
  const cont = h('div.sc-graf');
  let sel = -1, ancho = 0;
  const paso = h('div.sc-paso', { hidden: true });
  const dibujar = () => {
    const angosta = columnasAngostas(datos.length, ancho);
    cont.replaceChildren(graficoColumnas(datos, { ...opc, ancho, seleccionado: sel, zonasPorColumna: !angosta, alSeleccionar: (d, i) => { sel = i; lect.textContent = d.texto; } }));
    paso.hidden = !angosta;
  };
  const ir = (n) => { sel = Math.max(0, Math.min(datos.length - 1, (sel < 0 ? (n > 0 ? -1 : datos.length) : sel) + n)); lect.textContent = datos[sel].texto; dibujar(); };
  paso.append(h('button.btn', { type: 'button', onclick: () => ir(-1) }, '‹ Anterior'), h('button.btn', { type: 'button', onclick: () => ir(1) }, 'Siguiente ›'));
  limpiezas.push(autoAjustar(cont, (w) => { ancho = w; dibujar(); }));
  return h('div', cont, paso, lect);
}
