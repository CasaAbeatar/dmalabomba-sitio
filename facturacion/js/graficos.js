// Gráficos SVG propios (sin librerías). Ejes con título en palabras, orden cronológico, valores al tocar.
// Los estilos están en css/listados.css (clases .gr ...).
import { atributoSeguro } from './util.js';
const NS = 'http://www.w3.org/2000/svg';
export function s(tag, attrs = {}, ...kids) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false && atributoSeguro(k, v === true ? '' : v, tag)) e.setAttribute(k, v === true ? '' : v);
  kids.flat().forEach((k) => { if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k))); });
  return e;
}

const nf1 = new Intl.NumberFormat('es-CR', { maximumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat('es-CR', { maximumFractionDigits: 0 });
// ₡12 mil, ₡1,2 M (solo para ejes y etiquetas pequeñas; las lecturas usan el monto exacto)
export function corto(n) {
  const a = Math.abs(n), sg = n < 0 ? '−' : '';
  if (a >= 1e6) return sg + '₡' + nf1.format(a / 1e6) + ' M';
  if (a >= 1e3) return sg + '₡' + nf1.format(a / 1e3) + ' mil';
  return sg + '₡' + nf0.format(a);
}

function escala(vmin, vmax, n = 4) {
  vmin = Math.min(0, vmin); vmax = Math.max(0, vmax);
  if (vmax === vmin) vmax = vmin + 1;
  const raw = (vmax - vmin) / n, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  const lo = Math.floor(vmin / step + 1e-9) * step, hi = Math.ceil(vmax / step - 1e-9) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { lo, hi, ticks };
}

function ajustar(texto, max) { // recorta con puntos suspensivos según un ancho aproximado (6,2 px por letra a 11 px)
  const maxChars = Math.max(4, Math.floor(max / 6.2));
  return texto.length > maxChars ? texto.slice(0, maxChars - 1) + '…' : texto;
}

// Parte un título de eje en hasta 2 renglones para que nunca se salga del gráfico (6,3 px por letra a 11,5 px)
function partir(texto, maxPx) {
  const t = String(texto || '').trim();
  const maxChars = Math.max(10, Math.floor(maxPx / 6.3));
  if (t.length <= maxChars) return t ? [t] : [];
  const lineas = [''];
  for (const p of t.split(' ')) {
    const l = lineas[lineas.length - 1], prueba = (l + ' ' + p).trim();
    if (prueba.length <= maxChars) lineas[lineas.length - 1] = prueba; else lineas.push(p);
  }
  if (lineas.length > 2) { const resto = lineas.slice(1).join(' '); lineas.length = 2; lineas[1] = resto.length > maxChars ? resto.slice(0, maxChars - 1) + '…' : resto; }
  return lineas;
}
// Título del eje horizontal (abajo, centrado). El último renglón queda pegado al borde de abajo.
function tituloEjeX(svg, texto, cx, H, ancho) {
  const ls = partir(texto, ancho);
  ls.forEach((t, i) => svg.append(s('text', { class: 'eje-tit', x: cx, y: H - 6 - (ls.length - 1 - i) * 13, 'text-anchor': 'middle' }, t)));
}
// Título del eje vertical (a la izquierda, girado)
function tituloEjeY(svg, texto, cy, alto) {
  const ls = partir(texto, alto);
  ls.forEach((t, i) => svg.append(s('text', { class: 'eje-tit', transform: `translate(${ls.length > 1 ? 11 + i * 13 : 14} ${cy}) rotate(-90)`, 'text-anchor': 'middle' }, t)));
}

// Columnas verticales. datos: [{id, etiqueta, valor, texto}]  (texto = lectura completa al tocar)
// opciones: {ancho, alto, tituloX, tituloY, color: 'rojo'|'ambar', seleccionado (índice), alSeleccionar(d, i), descripcion}
export function graficoColumnas(datos, o = {}) {
  const W = Math.max(300, Math.round(o.ancho || 640)), H = o.alto || 270;
  const M = { l: 84, r: 12, t: 16, b: 58 }; // 84 px a la izquierda: el título del eje (hasta 2 renglones) no pisa los valores en colones
  const pw = W - M.l - M.r, ph = H - M.t - M.b;
  const vals = datos.map((d) => d.valor);
  const sc = escala(Math.min(0, ...vals), Math.max(0, ...vals));
  const y = (v) => M.t + ph - ((v - sc.lo) / (sc.hi - sc.lo)) * ph;
  const slot = pw / Math.max(1, datos.length), bw = Math.max(3, Math.min(56, slot * 0.68));
  const x = (i) => M.l + slot * i + slot / 2;
  const svg = s('svg', { class: 'gr cols', viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': o.descripcion || '' });
  // cuadrícula y eje vertical con valores en colones
  sc.ticks.forEach((t) => {
    svg.append(s('line', { class: t === 0 ? 'base' : 'rej', x1: M.l, x2: W - M.r, y1: y(t), y2: y(t) }));
    svg.append(s('text', { class: 'tick', x: M.l - 6, y: y(t) + 4, 'text-anchor': 'end' }, corto(t)));
  });
  // etiquetas del eje horizontal, salteando las que no caben
  const cada = Math.max(1, Math.ceil(datos.length / Math.max(1, Math.floor(pw / (o.anchoEtiqueta || 40)))));
  datos.forEach((d, i) => { if (i % cada === 0) svg.append(s('text', { class: 'tick', x: x(i), y: M.t + ph + 16, 'text-anchor': 'middle' }, d.etiqueta)); });
  const conValor = slot >= 58;
  const barras = datos.map((d, i) => {
    const y0 = y(0), y1 = y(d.valor), top = Math.min(y0, y1), alto = Math.max(1.5, Math.abs(y0 - y1));
    const r = s('rect', { class: 'barra ' + (o.color || 'rojo') + (d.valor < 0 ? ' neg' : ''), x: x(i) - bw / 2, y: top, width: bw, height: alto, rx: 3 });
    if (d.valor !== 0) svg.append(r);
    if (conValor && d.valor !== 0) svg.append(s('text', { class: 'val', x: x(i), y: (d.valor >= 0 ? top - 4 : top + alto + 12), 'text-anchor': 'middle' }, corto(d.valor)));
    return r;
  });
  // títulos de ejes en palabras
  tituloEjeX(svg, o.tituloX, M.l + pw / 2, H, W - 16);
  tituloEjeY(svg, o.tituloY, M.t + ph / 2, ph);
  // zonas para tocar (una por columna, de arriba abajo)
  let sel = o.seleccionado ?? -1;
  const marcar = (i) => { sel = i; barras.forEach((b, k) => b.classList.toggle('sel', k === i)); };
  datos.forEach((d, i) => {
    const z = s('rect', { class: 'zona', x: M.l + slot * i, y: M.t, width: slot, height: ph + 22, tabindex: 0, role: 'button', 'aria-label': d.texto || d.etiqueta });
    const elegir = () => { marcar(i); o.alSeleccionar?.(d, i); };
    z.addEventListener('click', elegir);
    z.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') elegir(); });
    z.addEventListener('focus', elegir);
    z.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); elegir(); } });
    svg.append(z);
  });
  // Con el dedo, toda el área del gráfico es el botón: se elige la columna más cercana al toque (las columnas angostas no se podrían tocar una por una).
  // Las zonas de cada columna quedan solo para el teclado y los lectores de pantalla.
  if (datos.length) {
    const toque = s('rect', { class: 'zona-toque', x: M.l, y: M.t, width: pw, height: ph + 22 });
    const indice = (e) => { const r = svg.getBoundingClientRect(); const x = (e.clientX - r.left) * (W / (r.width || W)); return Math.max(0, Math.min(datos.length - 1, Math.floor((x - M.l) / slot))); };
    const elegirToque = (e) => { const i = indice(e); marcar(i); o.alSeleccionar?.(datos[i], i); };
    toque.addEventListener('click', elegirToque);
    toque.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') elegirToque(e); });
    svg.append(toque);
  }
  if (sel >= 0 && sel < datos.length) marcar(sel);
  return svg;
}

// Barras horizontales. datos: [{etiqueta, valor, texto, extra}]  extra = texto corto a la derecha de la barra (porcentaje)
export function graficoBarras(datos, o = {}) {
  const W = Math.max(300, Math.round(o.ancho || 640)), fila = 48; // 48 px: la zona de cada barra se toca con el dedo
  const lw = Math.min(150, Math.max(84, W * 0.28));
  const M = { l: 18 + lw, r: 12, t: 10, b: 54 };
  const H = M.t + M.b + datos.length * fila;
  const pw = W - M.l - M.r - 92; // reserva a la derecha para el valor
  const sc = escala(0, Math.max(0, ...datos.map((d) => d.valor)), pw < 220 ? 2 : 3); // en pantallas angostas, menos marcas para que los valores no se peguen
  const xx = (v) => M.l + (v / sc.hi) * pw;
  const svg = s('svg', { class: 'gr', viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': o.descripcion || '' });
  sc.ticks.forEach((t) => {
    svg.append(s('line', { class: t === 0 ? 'base' : 'rej', x1: xx(t), x2: xx(t), y1: M.t, y2: H - M.b }));
    svg.append(s('text', { class: 'tick', x: xx(t), y: H - M.b + 15, 'text-anchor': 'middle' }, corto(t)));
  });
  const barras = [];
  datos.forEach((d, i) => {
    const cy = M.t + i * fila + fila / 2, bw = Math.max(2, xx(Math.max(0, d.valor)) - xx(0));
    svg.append(s('text', { class: 'cat', x: M.l - 8, y: cy + 4, 'text-anchor': 'end' }, s('title', {}, d.etiqueta), ajustar(d.etiqueta, lw)));
    const r = s('rect', { class: 'barra ' + (o.color || 'rojo'), x: xx(0), y: cy - 12, width: bw, height: 24, rx: 3 });
    barras.push(r); svg.append(r);
    svg.append(s('text', { class: 'val', x: xx(0) + bw + 6, y: cy + 4 }, corto(d.valor) + (d.extra ? ' · ' + d.extra : '')));
  });
  tituloEjeX(svg, o.tituloX, M.l + pw / 2, H, W - 16);
  tituloEjeY(svg, o.tituloY, M.t + (datos.length * fila) / 2, datos.length * fila);
  const marcar = (i) => barras.forEach((b, k) => b.classList.toggle('sel', k === i));
  datos.forEach((d, i) => {
    const z = s('rect', { class: 'zona', x: 0, y: M.t + i * fila, width: W, height: fila, tabindex: 0, role: 'button', 'aria-label': d.texto || d.etiqueta });
    const elegir = () => { marcar(i); o.alSeleccionar?.(d, i); };
    z.addEventListener('click', elegir);
    z.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') elegir(); });
    z.addEventListener('focus', elegir);
    z.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); elegir(); } });
    svg.append(z);
  });
  return svg;
}

// Vuelve a dibujar cuando cambia el ancho del contenedor (girar el celular, cambiar el tamaño de la ventana)
export function autoAjustar(cont, dibujar) {
  let ultimo = 0, t;
  const pintar = () => { const w = Math.round(cont.clientWidth); if (w && w !== ultimo) { ultimo = w; dibujar(w); } };
  pintar();
  if (typeof ResizeObserver === 'undefined') return () => {};
  const ro = new ResizeObserver(() => { clearTimeout(t); t = setTimeout(pintar, 120); });
  ro.observe(cont);
  return () => { clearTimeout(t); ro.disconnect(); };
}
