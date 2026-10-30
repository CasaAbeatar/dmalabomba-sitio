// Utilidades compartidas: formato, DOM, avisos y ventanas.
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// Textos de error que comparten util.js y api.js. Los dos fallan con palabras que dicen qué hacer; ninguno muestra textos técnicos de la base.
export const MSG_SIN_INTERNET = 'No hay conexión con internet. Revise la conexión e intente de nuevo.';
export const MSG_GENERICO = 'Algo no salió bien. Intente de nuevo; si sigue igual, avise a la persona encargada.';
// El texto que se le muestra a una persona por cualquier error. Un error del sistema (ErrorApi, que trae .tipo) ya viene con palabras claras; una falla del navegador
// sin conexión («Failed to fetch») se explica como falta de internet; cualquier otro error de programa («TypeError: x is undefined») no se enseña: sale la frase general.
export function textoDeError(e) {
  if (!e) return MSG_GENERICO;
  const m = typeof e === 'string' ? e : String(e.message || '');
  if (e && typeof e === 'object' && typeof e.tipo === 'string' && m) return m;
  if (e instanceof TypeError && /failed to fetch|networkerror|load failed|network request failed/i.test(m)) return MSG_SIN_INTERNET;
  if (typeof e === 'string') return m || MSG_GENERICO;
  if (/^(TypeError|ReferenceError|SyntaxError|RangeError|EvalError|URIError)$/.test(e.name || '') || e instanceof DOMException || !m) return MSG_GENERICO;
  return m;
}

// Atributos seguros para h() y para los gráficos SVG. Nunca se crea un atributo on* con texto (solo funciones con addEventListener),
// ni srcdoc, ni una dirección que ejecute código (javascript:, vbscript:). Un src de imagen puede ser data:image/(png, jpeg, gif, webp o svg);
// un href o src de otro elemento solo puede ser data:image/(png, jpeg, gif, webp) o una dirección normal (https:, blob:, relativa).
const NOMBRE_ATRIBUTO = /^[a-zA-Z_:][-a-zA-Z0-9_:.]*$/;
const ATRIBUTOS_URL = /^(href|src|action|formaction|xlink:href|poster|background|ping)$/i;
export function atributoSeguro(nombre, valor, etiqueta = '') {
  const k = String(nombre);
  if (!NOMBRE_ATRIBUTO.test(k) || /^on/i.test(k) || /^srcdoc$/i.test(k)) return false;
  if (!ATRIBUTOS_URL.test(k)) return true;
  const t = String(valor).replace(/[\u0000- \u007f-\u009f]/g, ''); // el navegador ignora espacios y saltos dentro del esquema
  if (/^(javascript|vbscript):/i.test(t)) return false;
  if (/^data:/i.test(t)) {
    if (/^data:image\/(png|jpe?g|gif|webp)[;,]/i.test(t)) return true;
    return /^src$/i.test(k) && String(etiqueta).toUpperCase() === 'IMG' && /^data:image\/svg\+xml[;,]/i.test(t);
  }
  return true;
}

// h('div.clase#id', {atributos, onclick}, ...hijos)  -> elemento
export function h(sel, attrs, ...hijos) {
  const m = sel.match(/^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i) || [];
  const el = document.createElement(m[1] || 'div');
  (m[2] || '').replace(/([.#])([\w-]+)/g, (_, t, n) => { if (t === '.') el.classList.add(n); else el.id = n; });
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { hijos.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) { if (typeof v === 'function') el.addEventListener(k.slice(2), v); continue; } // on* solo con funciones
    if (k === 'class') el.className += ' ' + v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden') el[k] = !!v;
    else if (atributoSeguro(k, v === true ? '' : v, el.tagName)) el.setAttribute(k, v === true ? '' : v);
  }
  const add = (x) => { if (x == null || x === false) return; if (Array.isArray(x)) x.forEach(add); else el.append(x.nodeType ? x : document.createTextNode(String(x))); };
  hijos.forEach(add);
  return el;
}

// Dinero en colones: ₡12 345,50
const nf = new Intl.NumberFormat('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('es-CR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
// Un monto negativo lleva el signo antes del símbolo: -₡22 350,00 (no ₡-22 350,00). Si al redondear queda en cero no lleva signo.
const enColones = (f, n) => { const v = Number(n) || 0, t = f.format(Math.abs(v)); return (v < 0 && /[1-9]/.test(t) ? '-' : '') + '₡' + t; };
export const money = (n) => enColones(nf, n);
export const money0 = (n) => enColones(nf0, n);
export const num = (n, dec = 3) => new Intl.NumberFormat('es-CR', { maximumFractionDigits: dec }).format(Number(n) || 0);
export const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
// Interpreta lo que escribe una persona: "1 500,50", "1.500", "1.500,25", "1500.5" -> número.
// Solo acepta dígitos, espacios, punto, coma y ₡. Si el texto es ambiguo o no es un monto (letras, exponentes como 1e3, signos, más de
// dos decimales, o una coma con tres dígitos como "12,345", que no se sabe si son miles o decimales) devuelve NaN y quien llama pide corregirlo.
const MILES = (sep) => new RegExp('^\\d{1,3}(?:\\' + sep + '\\d{3})+$');
export function leerNumero(s) {
  s = String(s ?? '').trim();
  if (!s || !/^[\d\s .,₡]+$/.test(s)) return NaN;
  s = s.replace(/[₡\s ]/g, '');
  if (!/\d/.test(s)) return NaN;
  const puntos = (s.match(/\./g) || []).length, comas = (s.match(/,/g) || []).length;
  let ent = s, dec = '';
  if (puntos && comas) {
    // El último separador es el decimal; el otro solo puede separar miles de tres en tres
    const dec_ = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',', otro = dec_ === '.' ? ',' : '.';
    const partes = s.split(dec_);
    if (partes.length !== 2) return NaN;
    [ent, dec] = partes;
    if (ent.includes(otro) ? !MILES(otro).test(ent) : !/^\d+$/.test(ent)) return NaN;
    ent = ent.split(otro).join('');
  } else if (comas || puntos) {
    const sep = comas ? ',' : '.', n = comas || puntos;
    if (n > 1) { // 1.234.567 o 1,234,567: solo valen como miles
      if (!MILES(sep).test(s)) return NaN;
      ent = s.split(sep).join('');
    } else {
      [ent, dec] = s.split(sep);
      if (dec.length === 3 && sep === '.' && /^[1-9]\d{0,2}$/.test(ent)) { ent += dec; dec = ''; } // 1.500 = mil quinientos
      else if (dec.length === 3) return NaN; // 12,345 o 0.005: no se sabe si son miles o decimales
      else if (dec.length > 3) return NaN;
      if (!/^\d*$/.test(ent)) return NaN;
    }
  }
  if (!/^\d*$/.test(dec) || dec.length > 2) return NaN;
  if (!ent && !dec) return NaN;
  return Number((ent || '0') + (dec ? '.' + dec : ''));
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
    alReintentar ? h('button.btn.primario', { type: 'button', 'data-reintentar': '1', onclick: (e) => alReintentar(e.currentTarget) }, texto) : null);
}

// Avisos breves
export function toast(msg, tipo = 'ok', ms = 3500) {
  let c = $('#toasts'); if (!c) { c = h('div#toasts', { 'aria-live': 'polite' }); document.body.append(c); }
  const t = h('div.toast.' + tipo, msg); c.append(t);
  setTimeout(() => { t.classList.add('fuera'); setTimeout(() => t.remove(), 300); }, ms);
}

/* ---------- Ventanas y botón Atrás ---------- */
// Todas las ventanas abiertas comparten UNA entrada del historial del navegador: así el botón Atrás (o el gesto Atrás del celular) cierra primero la
// ventana de arriba y no saca a la persona de la pantalla. Si quedan más ventanas abiertas, la entrada se vuelve a poner, así nunca se apilan entradas repetidas.
// Al cerrar la última ventana con un botón, la entrada se quita con history.back(); hay que esperar a que el navegador avise (esperarHistorial)
// antes de empujar otra entrada, para que las dos operaciones no se pisen.
let entradaVentana = false; // hay una entrada del historial puesta por las ventanas
let hrefVentana = '';
let atrasPendiente = 0; // history.back() pedidos por nosotros que el navegador todavía no avisó
let esperando = [];
let popDeVentana = false;
const despertar = () => { const r = esperando; esperando = []; r.forEach((f) => f()); };
// Se resuelve cuando ya no hay un history.back() de ventana pendiente
export const esperarHistorial = () => (atrasPendiente > 0 ? new Promise((ok) => { esperando.push(ok); }) : Promise.resolve());
// true mientras se atiende un popstate que solo cerró una ventana: el enrutador (main.js) no debe cambiar de pantalla por eso
export const popEsDeVentana = () => popDeVentana;
function empujarEntrada() {
  if (entradaVentana) return;
  try { history.pushState({ ...(history.state || {}), fxVentana: 1 }, '', location.href); entradaVentana = true; hrefVentana = location.href; } catch { /* sin historial */ }
}
function soltarEntrada() {
  if (!entradaVentana) return;
  entradaVentana = false;
  if (!(history.state && history.state.fxVentana)) return; // ya se salió de esa entrada: no hay nada que quitar
  atrasPendiente++;
  try { history.back(); } catch { atrasPendiente--; return; }
  setTimeout(() => { if (atrasPendiente > 0) { atrasPendiente = 0; despertar(); } }, 700); // por si el navegador no avisa
}
try { if (history.state && history.state.fxVentana) { const limpio = { ...history.state }; delete limpio.fxVentana; history.replaceState(limpio, ''); } } catch { /* sin historial */ } // recarga con una ventana abierta
window.addEventListener('popstate', () => {
  popDeVentana = false;
  if (atrasPendiente > 0) { atrasPendiente--; popDeVentana = true; setTimeout(() => { popDeVentana = false; }, 0); if (!atrasPendiente) despertar(); return; }
  const estado = history.state;
  if (estado && estado.fxVentana && !entradaVentana) { // Adelante hacia una entrada de ventana que ya no existe: se regresa sin que se note
    popDeVentana = true; setTimeout(() => { popDeVentana = false; }, 0);
    atrasPendiente++; try { history.back(); } catch { atrasPendiente--; }
    return;
  }
  if (!entradaVentana || (estado && estado.fxVentana)) return;
  entradaVentana = false; // el navegador ya quitó la entrada
  if (location.href !== hrefVentana) { [...pilaModales].forEach((f) => { try { f._cerrar?.(false); } catch { /* nada */ } }); return; } // se fue a otra dirección: se cierran todas
  popDeVentana = true; setTimeout(() => { popDeVentana = false; }, 0);
  const arriba = pilaModales[pilaModales.length - 1];
  if (!arriba) return;
  const bloqueo = arriba._bloqueo?.();
  if (bloqueo) { empujarEntrada(); toast(bloqueo, 'error', 5000); return; } // no se puede cerrar ahora: la entrada vuelve a quedar puesta
  arriba._cerrar(false);
  if (pilaModales.length) empujarEntrada();
});

// Ventana modal. Devuelve {cerrar, el}. contenido: nodo; botones: [{texto, clase, onclick(cerrar)}]
// Con varias ventanas abiertas, Escape y Tab solo actúan en la de arriba; al cerrar, el foco vuelve a donde estaba.
// bloqueo (opcional): función que devuelve un texto mientras la ventana NO se puede cerrar (por ejemplo, con un cobro en camino) o algo vacío si sí.
// Escape, tocar fuera, «Cerrar ✕» y el botón Atrás respetan el bloqueo y muestran ese texto; cerrar() desde el código siempre cierra.
const pilaModales = [];
let contadorModal = 0;
const FOCOS = 'button:not([disabled]),[href],input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])';
export function modal({ titulo, contenido, botones = [], ancho = 520, alCerrar, bloqueo }) {
  const fondo = h('div.modal-fondo');
  const previo = document.activeElement;
  const idTitulo = titulo ? 'modal-tit-' + (++contadorModal) : null;
  let cerrado = false;
  const intentar = () => { const b = bloqueo ? bloqueo() : ''; if (b) { toast(b, 'error', 5000); return; } cerrar(); };
  const teclas = (e) => {
    if (pilaModales[pilaModales.length - 1] !== fondo) return;
    if (e.key === 'Escape') { e.preventDefault(); intentar(); return; }
    if (e.key !== 'Tab') return;
    const lista = [...caja.querySelectorAll(FOCOS)].filter((x) => x.offsetParent !== null);
    if (!lista.length) return;
    const primero = lista[0], ultimo = lista[lista.length - 1];
    if (!caja.contains(document.activeElement) || document.activeElement === caja) { e.preventDefault(); (e.shiftKey ? ultimo : primero).focus(); } // el foco inicial puede estar en la propia ventana: de ahí, Tab va al primer control y Mayús+Tab al último
    else if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
    else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
  };
  // conHistorial = false cuando el cierre viene del propio botón Atrás (el navegador ya quitó la entrada)
  const cerrar = (conHistorial = true) => {
    if (cerrado) return;
    cerrado = true;
    fondo.remove();
    document.removeEventListener('keydown', teclas);
    const i = pilaModales.indexOf(fondo); if (i >= 0) pilaModales.splice(i, 1);
    if (!pilaModales.length && conHistorial !== false) soltarEntrada();
    // El foco vuelve al botón que abrió la ventana: si ya no queda ninguna ventana, o si ese botón está dentro de la ventana que queda abajo (por ejemplo, «Devolver parte» dentro del detalle de un documento)
    const debajo = pilaModales[pilaModales.length - 1];
    if (previo && previo.isConnected && typeof previo.focus === 'function' && (!pilaModales.length || debajo.contains(previo))) { try { previo.focus({ preventScroll: true }); } catch { /* nada */ } }
    alCerrar?.();
  };
  const caja = h('div.modal', { style: `max-width:${ancho}px`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': idTitulo },
    titulo ? h('div.modal-tit', h('h2', { id: idTitulo }, titulo), h('button.cerrar', { type: 'button', onclick: intentar }, 'Cerrar ✕')) : null,
    h('div.modal-cuerpo', contenido),
    botones.length ? h('div.modal-pie', botones.map((b) => h('button.btn' + (b.clase ? '.' + b.clase : ''), { type: 'button', onclick: () => b.onclick?.(cerrar) }, b.texto))) : null);
  fondo.append(caja);
  fondo._cerrar = cerrar; // para cerrarVentanas() y para el botón Atrás
  fondo._bloqueo = bloqueo;
  fondo.addEventListener('mousedown', (e) => { if (e.target === fondo) intentar(); });
  document.addEventListener('keydown', teclas);
  pilaModales.push(fondo);
  document.body.append(fondo);
  // La entrada del historial se pone al abrir (si un history.back() anterior sigue pendiente, se espera a que termine)
  if (!entradaVentana) {
    if (atrasPendiente > 0) esperarHistorial().then(() => { if (!cerrado && pilaModales.length) empujarEntrada(); });
    else empujarEntrada();
  }
  // Foco inicial: un campo solo si ya se ve completo al abrir (si está más abajo, enfocarlo corre la ventana
  // y en el celular abre el teclado encima del contenido); si no, el primer botón del pie (suele ser el seguro: «No», «Volver»); y si no hay pie, la propia ventana
  // (la lectura de pantalla anuncia su título y el primer Tab llega a su primer control). Nunca «Cerrar ✕»: un Enter de más no debe cerrar lo que se acaba de abrir.
  // Quien arma la ventana suele poner el pie justo después de crearla: por eso se vuelve a mirar un instante después, solo si el foco sigue en la ventana misma
  // (si quien la armó ya movió el foco a otro lado, se respeta).
  caja.tabIndex = -1;
  const cuerpo = caja.querySelector('.modal-cuerpo') || caja;
  const vis = (el) => { const r = el.getBoundingClientRect(), c = cuerpo.getBoundingClientRect(); return r.height > 0 && r.top >= c.top - 1 && r.bottom <= c.bottom + 1; };
  const enfocarInicial = () => {
    const f = caja.querySelector('input:not([type=hidden]),select,textarea');
    if (f && vis(f)) f.focus({ preventScroll: true });
    else (caja.querySelector('.modal-pie .primario:not([disabled]), .modal-pie button:not([disabled])') || caja).focus({ preventScroll: true });
  };
  enfocarInicial();
  queueMicrotask(() => { if (!cerrado && pilaModales[pilaModales.length - 1] === fondo && document.activeElement === caja) enfocarInicial(); });
  return { cerrar, el: caja };
}

// Cierra todas las ventanas abiertas (por ejemplo al cerrar la sesión o al cambiar de pantalla), de la última a la primera.
// Devuelve una promesa que se cumple cuando el historial del navegador ya quedó en orden.
export function cerrarVentanas() {
  [...pilaModales].reverse().forEach((f) => { try { f._cerrar?.(); } catch { /* nada */ } });
  return esperarHistorial();
}
// Antes de empujar o recorrer el historial desde una pantalla: cierra las ventanas que haya y espera a que el historial se acomode
export const asentarVentanas = () => (pilaModales.length ? cerrarVentanas() : esperarHistorial());

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
  catch (e) { toast(textoDeError(e), 'error', 7000); }
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

/* ---------- Respuesta de Hacienda en palabras simples ---------- */
const CODIGOS_HACIENDA = {
  '-37': 'La provincia, el cantón o el distrito de la empresa no coinciden con lo que Hacienda tiene registrado. La persona encargada debe actualizar esos datos en Hacienda.',
  '-60': 'La firma digital del documento no es de esta empresa. Avise a la persona encargada.',
  '-99': 'Hacienda ya tiene un documento con ese mismo número. Avise a la persona encargada.',
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
  // El aviso -37 («la ubicación del emisor no coincide con Hacienda») es solo un aviso y no es el motivo de un rechazo: si viene junto con la causa real, no se mezcla; el texto completo queda en el detalle técnico
  const items = mensaje ? traducirHacienda(mensaje).items : [];
  const causas = items.filter((i) => i.codigo !== '-37');
  const motivo = (causas.length ? causas : items).map((i) => i.texto).join(' ');
  const ESTADOS_TXT = {
    pendiente: { final: false, clase: 'espera', chip: 'Por enviar a Hacienda', texto: 'Cobro registrado. Se enviará a Hacienda en un momento. Este aviso cambia solo cuando Hacienda responda.' },
    enviado: { final: false, clase: 'espera', chip: 'Enviado a Hacienda', texto: 'Cobro registrado. Se envió a Hacienda y se espera su respuesta. Este aviso cambia solo cuando Hacienda responda.' },
    aceptado: { final: true, clase: 'ok', chip: 'Aceptado por Hacienda', texto: 'Cobro registrado. Hacienda aceptó el comprobante.' },
    rechazado: { final: true, clase: 'mal', chip: 'Rechazado por Hacienda', texto: 'Cobro registrado, pero Hacienda no aceptó el comprobante.' + (motivo ? ' Motivo: ' + motivo : '') + ' Avise a la persona encargada; el documento queda en «Anular y reimprimir».' },
    error: { final: false, clase: 'mal', chip: 'No se pudo enviar', texto: 'Cobro registrado, pero todavía no se pudo enviar a Hacienda.' + (motivo ? ' Motivo: ' + motivo : '') + ' No repita el cobro. Para mandarlo otra vez a Hacienda abra «Anular y reimprimir» y toque «Reenviar a Hacienda», o avise a la persona encargada.' },
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

// Tabla (o cualquier bloque) que se desliza hacia los lados: pone un degradado en el borde y dice con palabras que hay más columnas.
// Devuelve el envoltorio; el aviso solo se ve cuando de verdad hay algo oculto.
export function conPistaDesliz(cont, texto = 'Deslice hacia los lados para ver más columnas.') {
  const pista = h('p.desliza-pista', { hidden: true, 'aria-hidden': 'true' }, texto);
  const env = h('div.desliza', cont, pista);
  const revisar = () => {
    const resto = cont.scrollWidth - cont.clientWidth - cont.scrollLeft;
    env.classList.toggle('hay-mas', resto > 4);
    env.classList.toggle('hay-antes', cont.scrollLeft > 4);
    pista.hidden = !(cont.scrollWidth - cont.clientWidth > 4);
  };
  cont.addEventListener('scroll', revisar, { passive: true });
  if (window.ResizeObserver) { const ro = new ResizeObserver(revisar); ro.observe(cont); const t = cont.querySelector('table'); if (t) ro.observe(t); }
  setTimeout(revisar, 0);
  return env;
}
