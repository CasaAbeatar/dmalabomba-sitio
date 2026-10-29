// Utilidades compartidas: formato, DOM, avisos y ventanas.
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// h('div.clase#id', {atributos, onclick}, ...hijos)  -> elemento
export function h(sel, attrs, ...hijos) {
  const m = sel.match(/^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i) || [];
  const el = document.createElement(m[1] || 'div');
  (m[2] || '').replace(/([.#])([\w-]+)/g, (_, t, n) => { if (t === '.') el.classList.add(n); else el.id = n; });
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { hijos.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className += ' ' + v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = (x) => { if (x == null || x === false) return; if (Array.isArray(x)) x.forEach(add); else el.append(x.nodeType ? x : document.createTextNode(String(x))); };
  hijos.forEach(add);
  return el;
}

// Dinero en colones: ₡12 345,50
const nf = new Intl.NumberFormat('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('es-CR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
export const money = (n) => '₡' + nf.format(Number(n) || 0);
export const money0 = (n) => '₡' + nf0.format(Number(n) || 0);
export const num = (n, dec = 3) => new Intl.NumberFormat('es-CR', { maximumFractionDigits: dec }).format(Number(n) || 0);
export const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
// Interpreta lo que escribe una persona: "1 500,50", "1.500", "1500.5" -> número
export function leerNumero(s) {
  s = String(s ?? '').trim().replace(/[₡\s]/g, '');
  if (!s) return NaN;
  if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (s.includes(',')) s = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
  else if ((s.match(/\./g) || []).length > 1 || /\.\d{3}$/.test(s)) s = s.replace(/\./g, '');
  return Number(s);
}

// Fechas siempre en hora de Costa Rica
const TZ = 'America/Costa_Rica';
export const hoyCR = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date()); // YYYY-MM-DD
export const fechaHora = (d) => d ? new Intl.DateTimeFormat('es-CR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(d)) : '';
export const fechaCorta = (d) => d ? new Intl.DateTimeFormat('es-CR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(d)) : '';
export const horaCorta = (d) => d ? new Intl.DateTimeFormat('es-CR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(d)) : '';
export const sumaDias = (ymd, n) => { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

// Nombres para mostrar
export const TIPOS_DOC = { '01': 'Factura electrónica', '02': 'Nota de débito', '03': 'Nota de crédito', '04': 'Tiquete electrónico' };
export const TIPOS_SERVICIO = { buffet: 'Buffet', espera: 'En espera', llevar: 'Para llevar', express: 'Express' };
export const MEDIOS = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', sinpe: 'SINPE Móvil', transferencia: 'Transferencia' };
export const TIPOS_ID = { '01': 'Cédula física', '02': 'Cédula jurídica', '03': 'DIMEX', '04': 'NITE', '05': 'Extranjero no domiciliado', '06': 'No contribuyente' };
export const ESTADOS = { pendiente: 'En cola', enviado: 'Enviado a Hacienda', aceptado: 'Aceptado', rechazado: 'Rechazado', error: 'Con error' };

// Avisos breves
export function toast(msg, tipo = 'ok', ms = 3500) {
  let c = $('#toasts'); if (!c) { c = h('div#toasts', { 'aria-live': 'polite' }); document.body.append(c); }
  const t = h('div.toast.' + tipo, msg); c.append(t);
  setTimeout(() => { t.classList.add('fuera'); setTimeout(() => t.remove(), 300); }, ms);
}

// Ventana modal. Devuelve {cerrar, el}. contenido: nodo; botones: [{texto, clase, onclick(cerrar)}]
export function modal({ titulo, contenido, botones = [], ancho = 520, alCerrar }) {
  const fondo = h('div.modal-fondo');
  const cerrar = () => { fondo.remove(); document.removeEventListener('keydown', esc_); alCerrar?.(); };
  const esc_ = (e) => { if (e.key === 'Escape') cerrar(); };
  const caja = h('div.modal', { style: `max-width:${ancho}px`, role: 'dialog', 'aria-modal': 'true' },
    titulo ? h('div.modal-tit', h('h2', titulo), h('button.cerrar', { 'aria-label': 'Cerrar', onclick: cerrar }, 'Cerrar ✕')) : null,
    h('div.modal-cuerpo', contenido),
    botones.length ? h('div.modal-pie', botones.map((b) => h('button.btn' + (b.clase ? '.' + b.clase : ''), { onclick: () => b.onclick?.(cerrar) }, b.texto))) : null);
  fondo.append(caja);
  fondo.addEventListener('mousedown', (e) => { if (e.target === fondo) cerrar(); });
  document.addEventListener('keydown', esc_);
  document.body.append(fondo);
  const f = caja.querySelector('input,select,textarea'); f?.focus();
  return { cerrar, el: caja };
}

export function confirmar(texto, { si = 'Sí, continuar', no = 'No, volver', peligro = false } = {}) {
  return new Promise((ok) => {
    let hecho = false;
    modal({ titulo: 'Confirme', contenido: h('p.conf', texto), ancho: 440, alCerrar: () => { if (!hecho) ok(false); },
      botones: [{ texto: no, onclick: (c) => { hecho = true; c(); ok(false); } }, { texto: si, clase: peligro ? 'peligro' : 'primario', onclick: (c) => { hecho = true; c(); ok(true); } }] });
  });
}

// Pide un texto/número en una ventana. Devuelve string o null
export function pedir({ titulo, etiqueta, valor = '', tipo = 'text', nota = '', boton = 'Aceptar', multilinea = false }) {
  return new Promise((ok) => {
    let hecho = false;
    const inp = multilinea ? h('textarea.campo', { rows: 3 }, valor) : h('input.campo', { type: tipo, value: valor, inputmode: tipo === 'number' ? 'decimal' : null });
    const fin = (v, c) => { hecho = true; c?.(); ok(v); };
    const m = modal({ titulo, ancho: 440, alCerrar: () => { if (!hecho) ok(null); },
      contenido: h('label.etq', etiqueta, inp, nota ? h('small', nota) : null),
      botones: [{ texto: 'Cancelar', onclick: (c) => fin(null, c) }, { texto: boton, clase: 'primario', onclick: (c) => fin(inp.value, c) }] });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !multilinea) fin(inp.value, m.cerrar); });
    inp.select?.();
  });
}

// Ejecuta una acción mostrando el botón ocupado y avisando los errores
export async function conBoton(btn, fn) {
  const t = btn?.textContent; if (btn) { btn.disabled = true; btn.dataset.ocupado = '1'; }
  try { return await fn(); }
  catch (e) { toast(e.message || String(e), 'error', 7000); }
  finally { if (btn) { btn.disabled = false; delete btn.dataset.ocupado; if (t != null) btn.textContent = t; } }
}

// Descarga un texto como archivo
export function descargar(nombre, texto, tipo = 'application/xml') {
  const a = h('a', { href: URL.createObjectURL(new Blob([texto], { type: tipo })), download: nombre });
  document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
