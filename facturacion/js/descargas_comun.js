// Piezas comunes de las descargas (Excel, CSV y PDF). NO usa el DOM: se puede probar sola y la usan descargas.js y descargas_xlsx.js.
//
// MODELO DE UNA TABLA (lo que recibe crearDescarga en tablas / hojas, ya normalizado por normalizarTabla):
//   { nombre, titulo, subtitulo, cifras:'brutas'|'netas'|'mixtas'|'', cifrasNota, columnas:[{clave,titulo,tipo,dec,decMax,formato,ancho,enPdf}], filas, totales, etiquetaTotal, notas }
// TIPOS DE COLUMNA: texto | numero | moneda | fecha | fechahora | porcentaje
//   numero y porcentaje: dec = decimales fijos (por omisión 0 en numero y 1 en porcentaje); moneda: dec fijo 2, decMax para mostrar hasta más decimales si el dato los trae.
//   fecha con formato:'mes' se muestra como «octubre 2026» (y en CSV como AAAA-MM).
//
// SEGURIDAD CONTRA FÓRMULAS: todo texto que empiece con = + - @ tabulador o retorno de carro se trata como texto literal
//   (en xlsx se guarda como cadena y con quotePrefix; en CSV se le antepone un apóstrofo, solo si empieza así).

const MS_DIA = 86400000;
const DESFASE_CR = -6 * 3600000; // Costa Rica es UTC-6 todo el año (no tiene horario de verano)
export const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const TIPOS_COLUMNA = ['texto', 'numero', 'moneda', 'fecha', 'fechahora', 'porcentaje'];
export const MAX_CELDA = 32767; // límite de caracteres de una celda de Excel

const pad = (n) => String(n).padStart(2, '0');
export const peligrosa = (t) => /^[=+\-@\t\r]/.test(t);

/* ---------- ceder el turno al navegador para no congelar la pantalla ---------- */
export const cede = () => (globalThis.scheduler && typeof globalThis.scheduler.yield === 'function' ? globalThis.scheduler.yield() : new Promise((r) => setTimeout(r, 0)));
// reloj(12)() devuelve una función que, al llamarla con await, solo cede si ya pasaron 12 ms de trabajo seguido
export function reloj(ms = 12) {
  let t = performance.now();
  return async () => { if (performance.now() - t > ms) { await cede(); t = performance.now(); } };
}

/* ---------- fechas (todas en hora de Costa Rica) ---------- */
// Número de serie de Excel (días desde 1899-12-30) de una fecha o fecha y hora. Devuelve NaN si no se puede leer.
// Un texto AAAA-MM-DD es solo fecha. Una marca de tiempo sin zona se toma como hora de Costa Rica; con zona se pasa a Costa Rica.
export function serialFecha(v, conHora) {
  if (v == null || v === '') return NaN;
  let ms;
  if (typeof v === 'string') {
    const t = v.trim();
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
    if (m) { const y = +m[1], mo = +m[2], d = +m[3]; if (mo < 1 || mo > 12 || d < 1 || d > 31) return NaN; return Date.UTC(y, mo - 1, d) / MS_DIA + 25569; }
    if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(t)) return NaN;
    const iso = t.replace(' ', 'T');
    ms = Date.parse(/(Z|[+-]\d{2}(:?\d{2})?)$/i.test(iso) ? iso : iso + '-06:00');
  } else if (v instanceof Date) ms = v.getTime();
  else if (typeof v === 'number') ms = v;
  else return NaN;
  if (!Number.isFinite(ms)) return NaN;
  const cr = Math.round((ms + DESFASE_CR) / 1000) * 1000; // hora de pared de Costa Rica, al segundo
  const dia = Math.floor(cr / MS_DIA);
  if (!conHora) return dia + 25569;
  return dia + 25569 + (cr - dia * MS_DIA) / MS_DIA;
}
// Del número de serie a texto: 'AAAA-MM-DD' o 'AAAA-MM-DD HH:MM' (sin zona: es la hora de Costa Rica)
export function isoDeSerie(s, conHora) {
  const ms = Math.round((s - 25569) * MS_DIA / 1000) * 1000;
  const f = new Date(ms).toISOString();
  return conHora ? f.slice(0, 10) + ' ' + f.slice(11, 16) : f.slice(0, 10);
}
export const dmaDeSerie = (s, conHora) => { const i = isoDeSerie(s, conHora); return i.slice(8, 10) + '/' + i.slice(5, 7) + '/' + i.slice(0, 4) + (conHora ? ' ' + i.slice(11) : ''); };
export const mesDeSerie = (s) => { const i = isoDeSerie(s, false); return MESES[+i.slice(5, 7) - 1] + ' ' + i.slice(0, 4); };

// Ahora, en hora de Costa Rica
export function ahoraCR(ms = Date.now()) {
  const i = new Date(ms + DESFASE_CR).toISOString();
  return { dma: i.slice(8, 10) + '/' + i.slice(5, 7) + '/' + i.slice(0, 4), hora: i.slice(11, 16), iso: i.slice(0, 10), texto: `${i.slice(8, 10)}/${i.slice(5, 7)}/${i.slice(0, 4)} a las ${i.slice(11, 16)} (hora de Costa Rica)` };
}

/* ---------- nombres de archivo ---------- */
// Sin guiones bajos, con espacios, sin caracteres que los sistemas no permiten
export function nombreArchivo(base, ext = '') {
  let t = String(base ?? '').replace(/_/g, ' ').replace(/[\\/:*?"<>|\u0000-\u001f\u007f-\u009f‎‏‪-‮]/g, ' ').replace(/\s+/g, ' ').trim();
  t = t.replace(/^\.+/, '').replace(/[. ]+$/, '');
  if (t.length > 150) t = t.slice(0, 150).trim();
  if (!t || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(t)) t = 'Informe';
  return t + (ext ? '.' + ext.replace(/^\./, '') : '');
}
// «octubre 2026», «29 octubre 2026», «5 al 12 octubre 2026», «5 septiembre al 12 octubre 2026»
export function nombrePeriodo(desde, hasta) {
  const ok = (x) => /^\d{4}-\d{2}-\d{2}$/.test(String(x));
  if (!ok(desde) || !ok(hasta)) return '';
  const [y1, m1, d1] = desde.split('-').map(Number), [y2, m2, d2] = hasta.split('-').map(Number);
  const ultimo = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (desde === hasta) return `${d1} ${MESES[m1 - 1]} ${y1}`;
  if (y1 === y2 && m1 === m2) return d1 === 1 && d2 === ultimo(y2, m2) ? `${MESES[m1 - 1]} ${y1}` : `${d1} al ${d2} ${MESES[m1 - 1]} ${y1}`;
  if (y1 === y2) return d1 === 1 && d2 === ultimo(y2, m2) ? `${MESES[m1 - 1]} a ${MESES[m2 - 1]} ${y1}` : `${d1} ${MESES[m1 - 1]} al ${d2} ${MESES[m2 - 1]} ${y1}`;
  return `${d1} ${MESES[m1 - 1]} ${y1} al ${d2} ${MESES[m2 - 1]} ${y2}`;
}
// Nombre de hoja de Excel: máximo 31 letras, sin [ ] : * ? / \ y único
export function nombreHoja(n, usados) {
  let t = String(n ?? '').replace(/[\[\]:*?\/\\]/g, ' ').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^'+|'+$/g, '').trim().slice(0, 31).trim() || 'Hoja';
  let k = 2, c = t;
  while (usados.has(c.toLowerCase())) { const suf = ' ' + k++; c = t.slice(0, 31 - suf.length).trim() + suf; }
  usados.add(c.toLowerCase());
  return c;
}

/* ---------- valores de celda ---------- */
const limpiaFlotante = (n) => { if (!Number.isFinite(n)) return NaN; const s = String(n); return s.length > 15 ? Number(n.toPrecision(15)) : n; };
// Número de un dato (número, o texto numérico como los que devuelve la base). NaN si no es un número.
export function leerNumero(v) {
  if (typeof v === 'number') return limpiaFlotante(v);
  if (typeof v === 'string') { const t = v.trim(); if (/^-?\d+(\.\d+)?$/.test(t)) return limpiaFlotante(Number(t)); }
  if (typeof v === 'bigint') return Number(v);
  return NaN;
}
// Lo que se guarda en una celda de Excel: null (vacía), un número (número, moneda, porcentaje o serie de fecha) o un texto.
// Si el dato no cabe en el tipo de la columna (por ejemplo «Sigue abierto» en una columna de fechas) se guarda como texto.
export function valorXlsx(col, v) {
  if (v == null || v === '') return null;
  switch (col.tipo) {
    case 'numero': case 'moneda': case 'porcentaje': { const n = leerNumero(v); return Number.isNaN(n) ? textoDe(v) : n; }
    case 'fecha': case 'fechahora': { const s = serialFecha(v, col.tipo === 'fechahora'); if (Number.isNaN(s)) return textoDe(v); return col.tipo === 'fecha' ? Math.floor(s) : s; }
    default: return textoDe(v);
  }
}
function textoDe(v) { const t = typeof v === 'string' ? v : (v instanceof Date ? v.toISOString() : String(v)); return t.length > MAX_CELDA ? t.slice(0, MAX_CELDA - 1) + '…' : t; }

// Cuántos decimales se muestran en un número: fijos (dec) o hasta decMax
export const decimalesDe = (col) => (col.tipo === 'moneda' ? (col.dec ?? 2) : col.tipo === 'porcentaje' ? (col.dec ?? 1) : (col.dec ?? 0));

// Texto de un número para CSV: punto decimal, sin separador de miles, con los decimales fijos de la columna si el dato los cabe
function numeroCsv(col, n) {
  if (n === 0) n = 0; // quita el -0
  const dec = decimalesDe(col);
  if (col.tipo === 'numero' && col.dec == null) return exp(String(n));
  const f = n.toFixed(dec);
  const r = Number(f) === n ? f : exp(String(n));
  return /^-0(\.0+)?$/.test(r) ? r.slice(1) : r;
}
const exp = (s) => (/e/i.test(s) ? Number(s).toFixed(12).replace(/\.?0+$/, '') : s);
// Texto de una celda para CSV (sin comillas todavía)
export function textoCsv(col, v) {
  const x = valorXlsx(col, v);
  if (x == null) return '';
  if (typeof x === 'string') return x;
  if (col.tipo === 'fecha') return col.formato === 'mes' ? isoDeSerie(x, false).slice(0, 7) : isoDeSerie(x, false);
  if (col.tipo === 'fechahora') return isoDeSerie(x, true);
  return numeroCsv(col, x);
}
// Celda CSV completa de un dato: los números y las fechas van tal cual (un -5 es un número, no una fórmula); un texto que empiece con = + - @ tab o retorno recibe el apóstrofo
export function cadenaCsv(col, v) {
  const x = valorXlsx(col, v);
  if (x == null) return '';
  if (typeof x === 'number') return textoCsv(col, v);
  return celdaCsv(x);
}
// Celda CSV según RFC 4180, con el apóstrofo delante de lo que parezca una fórmula
export function celdaCsv(t) {
  if (t === '') return '';
  if (peligrosa(t)) t = "'" + t;
  return /[",\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
}

/* ---------- normalizar lo que manda la pantalla ---------- */
const CIFRAS = { brutas: 'Cifras brutas', netas: 'Cifras netas', mixtas: 'Cifras brutas y netas (cada columna dice cuál es)' };
export const textoCifras = (c) => CIFRAS[c] || '';

export function normalizarTabla(o, base = {}) {
  const cols = (o.columnas || []).map((c, i) => ({ clave: c.clave ?? 'c' + i, titulo: String(c.titulo ?? c.clave ?? ''), tipo: TIPOS_COLUMNA.includes(c.tipo) ? c.tipo : 'texto', dec: c.dec, decMax: c.decMax, formato: c.formato, ancho: c.ancho, enPdf: c.enPdf !== false }));
  const vistas = new Set(); cols.forEach((c, i) => { if (vistas.has(c.clave)) c.clave = c.clave + '#' + i; vistas.add(c.clave); });
  const filas = Array.isArray(o.filas) ? o.filas : [];
  return {
    nombre: o.hoja ?? o.titulo ?? base.titulo ?? 'Informe', // nombre de la hoja de Excel (no confundir con el nombre del archivo)
    titulo: o.titulo ?? base.titulo ?? 'Informe',
    subtitulo: o.subtitulo ?? base.subtitulo ?? '',
    cifras: o.cifras ?? base.cifras ?? '',
    cifrasNota: o.cifrasNota ?? base.cifrasNota ?? '',
    columnas: cols, filas,
    totales: o.totales || null,
    etiquetaTotal: o.etiquetaTotal || 'Total',
    notas: [...(base.notas || []), ...(o.notas || [])].filter(Boolean).map(String),
  };
}
export const valorFila = (fila, col, i) => (Array.isArray(fila) ? fila[i] : (fila == null ? undefined : fila[col.clave]));

// Valores de la fila de totales: {clave: número}. 'suma' se calcula con las filas (sumas con 6 decimales de tolerancia).
export function calcularTotales(t) {
  if (!t.totales) return null;
  const out = new Map();
  t.columnas.forEach((c, i) => {
    const d = t.totales[c.clave];
    if (d == null) return;
    if (d === 'suma') {
      let s = 0, hay = false;
      for (let k = 0; k < t.filas.length; k++) { const n = valorXlsx(c, valorFila(t.filas[k], c, i)); if (typeof n === 'number') { s += n; hay = true; } }
      if (hay) out.set(i, Math.round(s * 1e6) / 1e6);
    } else { const n = c.tipo === 'texto' ? d : valorXlsx(c, d); out.set(i, n); }
  });
  return out.size ? out : null;
}

// Antes de bajar, la pantalla puede mandar su ficha de dos maneras: un objeto, o una función (que puede ser async) que lo arma en el momento de bajar.
export async function resolverOpciones(opc) {
  const o = typeof opc === 'function' ? await opc() : opc;
  if (!o || typeof o !== 'object') return { tablas: [], base: {} };
  const base = { empresa: o.empresa || '', cedula: o.cedula || '', titulo: o.titulo || '', subtitulo: o.subtitulo || '', cifras: o.cifras || '', cifrasNota: o.cifrasNota || '', notas: o.notas || [] };
  const origen = Array.isArray(o.hojas) && o.hojas.length ? o.hojas : [o];
  const tablas = [];
  for (const h of origen) {
    const x = typeof h === 'function' ? await h() : h;
    if (!x) continue;
    const filas = typeof x.filas === 'function' ? await x.filas() : x.filas;
    // en un informe de varias tablas, las notas y la cifra de arriba valen para todas; en una sola tabla no se repiten
    tablas.push(normalizarTabla({ ...x, filas }, origen.length > 1 ? { ...base, notas: [] } : base));
  }
  return { base, tablas, xml: typeof o.xml === 'function' ? o.xml : null, nombre: o.nombre || base.titulo || 'Informe', varias: tablas.length > 1, filas: tablas.reduce((a, t) => a + t.filas.length, 0) };
}

/* ---------- CSV (una tabla) ---------- */
// Devuelve un Blob UTF-8 con BOM, comas, punto decimal, CRLF y UNA sola fila de encabezado. Sin totales ni encabezado del informe.
export async function crearCsv(t, { alAvanzar } = {}) {
  const partes = ['﻿'];
  const cols = t.columnas;
  partes.push(cols.map((c) => celdaCsv(c.titulo)).join(',') + '\r\n');
  const pausar = reloj(12);
  const n = t.filas.length, lote = 500;
  for (let i = 0; i < n; i += lote) {
    const fin = Math.min(n, i + lote);
    let trozo = '';
    for (let k = i; k < fin; k++) {
      const f = t.filas[k];
      let linea = '';
      for (let j = 0; j < cols.length; j++) { if (j) linea += ','; linea += cadenaCsv(cols[j], valorFila(f, cols[j], j)); }
      trozo += linea + '\r\n';
    }
    partes.push(trozo);
    if (alAvanzar) alAvanzar(fin / n);
    await pausar();
  }
  return new Blob(partes, { type: 'text/csv;charset=utf-8' });
}
