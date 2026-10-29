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

// Nombre del local para mostrar: usa el nombre comercial (o la razón social si falta) y, si viene todo en mayúsculas, lo pasa a "Pollos La Bomba".
const MENORES = new Set(['a', 'al', 'de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'en', 'con', 'por', 'para']);
export function nombreLocal(s) {
  const comercial = String((s && s.nombre_comercial) ?? '').trim();
  const t = comercial || String((s && s.nombre) ?? '').trim();
  if (!t || t !== t.toUpperCase()) return t;
  // Nombre comercial (marca): todas las palabras con mayúscula inicial. Razón social: las palabras de enlace quedan en minúscula.
  return t.toLowerCase().split(/\s+/).map((w, i) => (i > 0 && !comercial && MENORES.has(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// Esqueleto de carga: rectángulos grises con brillo suave y la palabra "Cargando…" (la hoja de estilos está en app.css)
export function esqueleto(filas = 4, texto = 'Cargando…') {
  return h('div.esqueleto', { role: 'status', 'aria-live': 'polite' },
    h('p.esq-texto', texto),
    Array.from({ length: filas }, (_, i) => h('div.esq-fila', h('i', { style: `width:${[62, 88, 74, 54, 80][i % 5]}%` }), h('i.corto'))));
}

// Pantalla de error con botón "Intentar de nuevo". Sirve para cualquier sección que no pudo cargar.
export function bloqueError({ titulo = 'No se pudo cargar', mensaje = '', alReintentar, texto = 'Intentar de nuevo' } = {}) {
  return h('div.vacio.bloque-error', { role: 'alert' },
    h('p.bloque-error-tit', titulo),
    mensaje ? h('p.tenue', mensaje) : null,
    alReintentar ? h('button.btn.primario', { type: 'button', onclick: (e) => alReintentar(e.currentTarget) }, texto) : null);
}

// Avisos breves
export function toast(msg, tipo = 'ok', ms = 3500) {
  let c = $('#toasts'); if (!c) { c = h('div#toasts', { 'aria-live': 'polite' }); document.body.append(c); }
  const t = h('div.toast.' + tipo, msg); c.append(t);
  setTimeout(() => { t.classList.add('fuera'); setTimeout(() => t.remove(), 300); }, ms);
}

// Ventana modal. Devuelve {cerrar, el}. contenido: nodo; botones: [{texto, clase, onclick(cerrar)}]
// Con varias ventanas abiertas, Escape y Tab solo actúan en la de arriba; al cerrar, el foco vuelve a donde estaba.
const pilaModales = [];
let contadorModal = 0;
const FOCOS = 'button:not([disabled]),[href],input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])';
export function modal({ titulo, contenido, botones = [], ancho = 520, alCerrar }) {
  const fondo = h('div.modal-fondo');
  const previo = document.activeElement;
  const idTitulo = titulo ? 'modal-tit-' + (++contadorModal) : null;
  let cerrado = false;
  const teclas = (e) => {
    if (pilaModales[pilaModales.length - 1] !== fondo) return;
    if (e.key === 'Escape') { e.preventDefault(); cerrar(); return; }
    if (e.key !== 'Tab') return;
    const lista = [...caja.querySelectorAll(FOCOS)].filter((x) => x.offsetParent !== null);
    if (!lista.length) return;
    const primero = lista[0], ultimo = lista[lista.length - 1];
    if (!caja.contains(document.activeElement)) { e.preventDefault(); primero.focus(); }
    else if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
    else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
  };
  const cerrar = () => {
    if (cerrado) return;
    cerrado = true;
    fondo.remove();
    document.removeEventListener('keydown', teclas);
    const i = pilaModales.indexOf(fondo); if (i >= 0) pilaModales.splice(i, 1);
    if (previo && previo.isConnected && typeof previo.focus === 'function' && !pilaModales.length) { try { previo.focus({ preventScroll: true }); } catch { /* nada */ } }
    alCerrar?.();
  };
  const caja = h('div.modal', { style: `max-width:${ancho}px`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': idTitulo },
    titulo ? h('div.modal-tit', h('h2', { id: idTitulo }, titulo), h('button.cerrar', { type: 'button', onclick: cerrar }, 'Cerrar ✕')) : null,
    h('div.modal-cuerpo', contenido),
    botones.length ? h('div.modal-pie', botones.map((b) => h('button.btn' + (b.clase ? '.' + b.clase : ''), { type: 'button', onclick: () => b.onclick?.(cerrar) }, b.texto))) : null);
  fondo.append(caja);
  fondo._cerrar = cerrar; // para cerrarVentanas()
  fondo.addEventListener('mousedown', (e) => { if (e.target === fondo) cerrar(); });
  document.addEventListener('keydown', teclas);
  pilaModales.push(fondo);
  document.body.append(fondo);
  // Foco inicial: un campo solo si ya se ve completo al abrir (si está más abajo, enfocarlo corre la ventana
  // y en el celular abre el teclado encima del contenido); si no, el botón principal o «Cerrar».
  const f = caja.querySelector('input:not([type=hidden]),select,textarea');
  const cuerpo = caja.querySelector('.modal-cuerpo') || caja;
  const vis = (el) => { const r = el.getBoundingClientRect(), c = cuerpo.getBoundingClientRect(); return r.height > 0 && r.top >= c.top - 1 && r.bottom <= c.bottom + 1; };
  if (f && vis(f)) f.focus({ preventScroll: true });
  else caja.querySelector('.modal-pie .primario, .modal-pie button, .cerrar')?.focus({ preventScroll: true });
  return { cerrar, el: caja };
}

// Cierra todas las ventanas abiertas (por ejemplo al cerrar la sesión), de la última a la primera
export function cerrarVentanas() {
  [...pilaModales].reverse().forEach((f) => { try { f._cerrar?.(); } catch { /* nada */ } });
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

/* ---------- Texto para mostrar ---------- */

// Pone punto final si el mensaje no termina en un signo (los mensajes de pantalla siempre cierran la frase)
export const conPunto = (m) => { const t = String(m ?? '').trim(); return t && !/[.!?:…]$/.test(t) ? t + '.' : t; };

// Nombres propios en mayúsculas sostenidas ("CORPORACION DMA COSTA RICA SOCIEDAD DE RESPONSABILIDAD LIMITADA") se muestran como
// "Corporación DMA Costa Rica Sociedad de Responsabilidad Limitada". SOLO es para mostrar: lo que va en el XML no se toca.
// Un nombre que ya trae mayúsculas y minúsculas se deja igual.
const SIGLAS = new Set(['SA', 'SRL', 'SAS', 'SL', 'DMA', 'CR', 'ICE', 'CCSS', 'INS', 'UNA', 'UCR', 'UTN', 'TEC', 'BCR', 'BAC', 'BN', 'CNFL', 'ICT', 'IMAS', 'MEP', 'MAG', 'AYA', 'CGR', 'TSE', 'JPS', 'ICAFE', 'CONAVI', 'COSEVI', 'MOPT', 'RECOPE', 'JASEC', 'ESPH', 'INA', 'INVU', 'CNP', 'ICODER', 'DIMEX', 'NITE', 'KFC', 'BBQ', 'TV', 'PC', 'USA', 'EEUU', 'II', 'III', 'IV', 'VI', 'VII', 'VIII', 'IX', 'XI', 'XII']);
const ENLACES = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'o', 'u', 'en', 'con', 'por', 'para', 'al', 'sin']);
const sinTilde = (x) => x.replace(/[áÁ]/g, 'A').replace(/[éÉ]/g, 'E').replace(/[íÍ]/g, 'I').replace(/[óÓ]/g, 'O').replace(/[úÚüÜ]/g, 'U').replace(/[ñÑ]/g, 'N').toUpperCase();
const ACENTOS = Object.fromEntries(('Corporación Administración Distribución Comercialización Construcción Inversión Tecnología Tecnologías Panadería Carnicería Ferretería Librería Pulpería Pizzería Zapatería Repostería Cafetería Marisquería Lavandería Peluquería Papelería Joyería Consultoría Asesoría Compañía Compañías Mecánica Eléctrica Electrónica Electrónicos Telefonía Agrícola Económica Anónima Pública Público Médica Médico Clínica Química Químicos Logística Vehículos Turística Alimentación Marítima Centroamérica América Niño Niños Año Muñoz Núñez Zúñiga Acuña Peña Ibáñez Castañeda Señor Señora Diseño Café Plásticos Electrodomésticos Máquinas Artículos Escazú Limón Tibás José María Jesús Andrés Adrián Sebastián Julián Ángel Óscar Raúl Saúl Rubén Héctor Víctor Néstor Mónica Verónica Rocío Lucía Sofía Álvaro Elías Tomás Matías Joaquín Fabián César Martínez Rodríguez González Fernández Hernández Pérez López Ramírez Sánchez Gómez Jiménez Álvarez Domínguez Vásquez Vázquez Díaz García Méndez Chávez Gutiérrez Guzmán Solís Céspedes Bermúdez Márquez Velásquez Velázquez Benítez Juárez Suárez Ordóñez Córdoba León Morán Román Briceño Agüero Alpízar Chacón Umaña Zeledón Jarquín Baltodano Calderón Marín Quirós Camacho Sandoval Peralta Saborío Araúz Lizano Monge Brenes Ugalde Cubero Vílchez Aguilar Montoya Mejía Carvajal Cascante Cerdas').split(' ')
  .map((p) => [sinTilde(p), p]));
const LETRAS = 'A-Za-zÁÉÍÓÚÜÑáéíóúüñ';
function pieza(core, primera) {
  if (!core || /^\d/.test(core)) return core;
  const up = core.toUpperCase(), low = core.toLowerCase();
  if (SIGLAS.has(up)) return up;
  if (ACENTOS[sinTilde(up)]) return ACENTOS[sinTilde(up)];
  if (/[ÁÉÍÓÚÜÑ]/.test(up)) return low.charAt(0).toUpperCase() + low.slice(1); // ya trae su tilde
  if (!primera && ENLACES.has(low)) return low;
  const base = /(c|s)ion$/.test(low) && low.length > 5 ? low.replace(/(c|s)ion$/, '$1ión') : low;
  return base.charAt(0).toUpperCase() + base.slice(1);
}
export function nombrePropio(s) {
  const t = String(s ?? '').trim().replace(/\s+/g, ' ');
  if (!t) return '';
  const letras = t.replace(new RegExp('[^' + LETRAS + ']', 'g'), '');
  if (letras.length < 3) return t;
  if (letras.replace(/[^A-ZÁÉÍÓÚÜÑ]/g, '').length / letras.length < 0.8) return t; // ya viene con mayúsculas y minúsculas
  return t.split(' ').map((p, i) => {
    if (/^([A-ZÑ]\.)+[A-ZÑ]?\.?$/.test(p)) return p; // S.A., S.R.L.
    const m = p.match(new RegExp('^([^' + LETRAS + '0-9]*)(.*?)([^' + LETRAS + '0-9]*)$'));
    const partes = m[2].split(/([-/])/).map((x, k) => (k % 2 ? x : pieza(x, i === 0 && k === 0)));
    return m[1] + partes.join('') + m[3];
  }).join(' ');
}

// PIN demasiado fácil de adivinar: devuelve el motivo en palabras, o '' si sirve. La misma regla debe vivir en el servidor (fx_pin_cambiar).
export function pinDebil(p) {
  if (!/^\d{4}$/.test(String(p))) return '';
  const d = [...String(p)].map(Number);
  if (d.every((x) => x === d[0])) return 'No use el mismo número cuatro veces, como 1111.';
  const paso = (i) => (d[i + 1] - d[i] + 10) % 10;
  if ([0, 1, 2].every((i) => paso(i) === 1)) return 'No use números seguidos hacia arriba, como 1234.';
  if ([0, 1, 2].every((i) => paso(i) === 9)) return 'No use números seguidos hacia abajo, como 4321.';
  if (d[0] === d[2] && d[1] === d[3]) return 'No repita una pareja de números, como 1212.';
  if (d[0] === d[1] && d[2] === d[3]) return 'No use dos parejas seguidas, como 1122.';
  if (['2580', '0852'].includes(String(p))) return 'No use una línea recta del teclado, como 2580.';
  if (['1357', '2468', '1379', '1004'].includes(String(p))) return 'Ese PIN es de los primeros que se adivinan, como 2468 o 1357.';
  if (/^(19\d\d|20[0-3]\d)$/.test(String(p))) return 'No use un año, como 1990.';
  return '';
}

// "unos 12 minutos" / "menos de un minuto" hasta una hora futura
export function tiempoFalta(hasta) {
  const ms = new Date(hasta).getTime() - Date.now();
  if (!Number.isFinite(ms)) return '';
  if (ms <= 0) return '';
  const min = Math.ceil(ms / 60000);
  return min <= 1 ? 'menos de un minuto' : 'unos ' + min + ' minutos';
}

/* ---------- Respuesta de Hacienda en palabras simples ---------- */
const CODIGOS_HACIENDA = {
  '-37': 'La provincia, el cantón o el distrito del emisor no coinciden con lo que Hacienda tiene registrado. Es solo un aviso y no impide que el documento valga, pero hay que actualizar esos datos en Hacienda.',
  '-60': 'La firma del documento no corresponde a quien lo emite: el certificado de firma es de otro contribuyente.',
  '-99': 'Ese número de comprobante ya existe en Hacienda.',
  '-410': 'El código de actividad económica del cliente no está registrado en Hacienda. Revise la actividad del cliente.',
};
const limpiarHacienda = (x) => String(x ?? '').replace(/"{2,}/g, '"').replace(/[\[\]]/g, ' ').replace(/^[\s"']+|[\s"']+$/g, '').replace(/\s+/g, ' ').trim();
// Devuelve { items:[{codigo, texto, original}], pruebas, resumen, crudo }. El texto crudo se conserva para mostrarlo plegado.
export function traducirHacienda(crudo) {
  const t = String(crudo ?? '');
  const items = [];
  const re = /(-?\d{1,4})\s*,\s*"{1,3}([\s\S]*?)"{1,3}\s*,\s*\d+\s*,\s*\d+/g;
  let m;
  while ((m = re.exec(t))) {
    const original = limpiarHacienda(m[2]);
    items.push({ codigo: m[1], original, texto: CODIGOS_HACIENDA[m[1]] || conPunto(original) });
  }
  const pruebas = /ambiente de pruebas/i.test(t);
  if (!items.length) {
    const sinNota = limpiarHacienda(t.replace(/Este comprobante fue recibido en el ambiente de pruebas, por lo cual no tiene validez para fines tributarios\.?/i, '').replace(/El comprobante electr[oó]nico tiene los siguientes errores:?/i, ''));
    if (sinNota) items.push({ codigo: '', original: sinNota, texto: conPunto(sinNota) });
  }
  return { items, pruebas, resumen: items.map((i) => i.texto).join(' '), crudo: t };
}

// Estado de un comprobante para mostrar a la cajera. Nunca dice que algo "ya está" si la base no lo sabe.
// Devuelve { estado, final, clase:'ok'|'espera'|'mal', chip, texto, motivo }
export function describirEstado(estado, mensaje) {
  const e = estado || 'pendiente';
  const motivo = mensaje ? traducirHacienda(mensaje).resumen : '';
  const ESTADOS_TXT = {
    pendiente: { final: false, clase: 'espera', chip: 'En cola', texto: 'Cobro registrado. Se está enviando a Hacienda. Este aviso cambia solo cuando Hacienda responda.' },
    enviado: { final: false, clase: 'espera', chip: 'Enviado a Hacienda', texto: 'Cobro registrado. Ya se envió a Hacienda y se espera su respuesta. Este aviso cambia solo.' },
    aceptado: { final: true, clase: 'ok', chip: 'Aceptado', texto: 'Cobro registrado. Hacienda aceptó el comprobante.' },
    rechazado: { final: true, clase: 'mal', chip: 'Rechazado', texto: 'Cobro registrado, pero Hacienda no aceptó el comprobante.' + (motivo ? ' Motivo: ' + motivo : '') + ' Avise a la persona encargada; el documento queda en «Documentos del día».' },
    error: { final: false, clase: 'mal', chip: 'Con error', texto: 'Cobro registrado, pero todavía no se pudo enviar a Hacienda.' + (motivo ? ' Motivo: ' + motivo : '') + ' El sistema vuelve a intentarlo solo.' },
  };
  return { estado: e, motivo, ...(ESTADOS_TXT[e] || ESTADOS_TXT.pendiente) };
}

// Número corto de un comprobante: 00100001040000008000 -> 8000 (los últimos 10 dígitos sin ceros a la izquierda). Es el mismo que usa la impresión.
export const numeroDoc = (cons) => { const n = parseInt(String(cons || '').slice(-10), 10); return Number.isFinite(n) ? String(n) : ''; };

// Campo de búsqueda con un botón escrito «Borrar búsqueda» (reemplaza la «x» pequeña que pone el navegador). alBorrar() vuelve a pintar la lista.
export function campoBusqueda(input, alBorrar) {
  const borrar = h('button.btn', { type: 'button', hidden: true, onclick: () => { input.value = ''; borrar.hidden = true; alBorrar?.(); input.focus(); } }, 'Borrar búsqueda');
  input.addEventListener('input', () => { borrar.hidden = !input.value; });
  return h('div.buscar-fila', input, borrar);
}
