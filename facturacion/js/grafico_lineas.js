// Gráfico de líneas SVG propio (sin librerías) para la conciliación y la posición de caja. Ejes con título en palabras, orden cronológico de izquierda a derecha,
// línea del cero marcada y lectura al tocar. Los estilos de texto y rejilla vienen de listados.css (.gr); los de las líneas, de banco_caja.css.
import { s, corto } from './graficos.js';

function escala(vmin, vmax, n = 4) {
  vmin = Math.min(0, vmin); vmax = Math.max(0, vmax);
  if (vmax === vmin) vmax = vmin + 1;
  const raw = (vmax - vmin) / n, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  const lo = Math.floor(vmin / step + 1e-9) * step, hi = Math.ceil(vmax / step - 1e-9) * step, ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { lo, hi, ticks };
}

// series: [{nombre, clase ('rojo'|'ambar'|'verde'|'tinta'), valores:[n]}]; etiquetas: texto del eje X (una por punto)
export function graficoLineas(series, etiquetas, o = {}) {
  const W = Math.max(300, Math.round(o.ancho || 640)), H = o.alto || 280, M = { l: 84, r: 14, t: 16, b: 58 };
  const pw = W - M.l - M.r, ph = H - M.t - M.b, n = etiquetas.length;
  const todos = series.flatMap((x) => x.valores.filter((v) => v != null));
  const sc = escala(Math.min(0, ...todos), Math.max(0, ...todos));
  const y = (v) => M.t + ph - ((v - sc.lo) / (sc.hi - sc.lo)) * ph;
  const x = (i) => M.l + (n <= 1 ? pw / 2 : (pw * i) / (n - 1));
  const svg = s('svg', { class: 'gr lineas', viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': o.descripcion || '' });
  sc.ticks.forEach((t) => {
    svg.append(s('line', { class: t === 0 ? 'base' : 'rej', x1: M.l, x2: W - M.r, y1: y(t), y2: y(t) }));
    svg.append(s('text', { class: 'tick', x: M.l - 6, y: y(t) + 4, 'text-anchor': 'end' }, corto(t)));
  });
  const cada = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(pw / (o.anchoEtiqueta || 44)))));
  etiquetas.forEach((e, i) => { if (i % cada === 0) svg.append(s('text', { class: 'tick', x: x(i), y: M.t + ph + 16, 'text-anchor': 'middle' }, e)); });
  series.forEach((sr) => {
    const pts = sr.valores.map((v, i) => (v == null ? null : [x(i), y(v)])).filter(Boolean);
    if (pts.length) svg.append(s('path', { class: 'linea ' + (sr.clase || 'rojo') + (sr.punteada ? ' punteada' : ''), d: pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ') }));
  });
  if (o.tituloX) svg.append(s('text', { class: 'eje-tit', x: M.l + pw / 2, y: H - 8, 'text-anchor': 'middle' }, o.tituloX));
  if (o.tituloY) {
    const cx = 14, cy = M.t + ph / 2;
    svg.append(s('text', { class: 'eje-tit', transform: `rotate(-90 ${cx} ${cy})`, x: cx, y: cy, 'text-anchor': 'middle' }, o.tituloY));
  }
  const marca = s('line', { class: 'cursor', x1: 0, x2: 0, y1: M.t, y2: M.t + ph, visibility: 'hidden' });
  svg.append(marca);
  if (n) {
    const toque = s('rect', { class: 'zona-toque', x: M.l, y: M.t, width: pw, height: ph + 22 });
    const elegir = (e) => {
      const r = svg.getBoundingClientRect(), px = (e.clientX - r.left) * (W / (r.width || W));
      const i = Math.max(0, Math.min(n - 1, Math.round(((px - M.l) / (pw || 1)) * (n - 1))));
      marca.setAttribute('x1', x(i)); marca.setAttribute('x2', x(i)); marca.setAttribute('visibility', 'visible');
      o.alSeleccionar?.(i);
    };
    toque.addEventListener('click', elegir);
    toque.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') elegir(e); });
    svg.append(toque);
  }
  return svg;
}
