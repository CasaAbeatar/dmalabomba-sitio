// Descargas de informes: UN solo componente para bajar lo que hay en pantalla como Excel (.xlsx), CSV, PDF y, si la pantalla lo ofrece, XML firmados (.zip).
//
// USO
//   import { crearDescarga, nombrePeriodo } from './descargas.js';
//   zona.append(crearDescarga(() => ({                      // un objeto, o una función (puede ser async) que lo arma justo al bajar
//     nombre: 'Ventas por día ' + nombrePeriodo(desde, hasta), // nombre del archivo sin extensión (sin guiones bajos)
//     empresa: 'Pollos La Bomba', cedula: '3102111943',        // encabezado
//     titulo: 'Ventas por día',
//     subtitulo: 'del lunes 1 de octubre al sábado 31 de octubre de 2026 · todos los turnos', // rango en palabras y filtros activos
//     cifras: 'netas',                                         // 'brutas' | 'netas' | 'mixtas': sale como «Cifras netas» en el encabezado
//     cifrasNota: 'Con IVA incluido; notas de crédito ya restadas', // opcional, va junto a «Cifras netas»
//     columnas: [{ clave: 'dia', titulo: 'Fecha', tipo: 'fecha' }, { clave: 'netas', titulo: 'Ventas netas (₡, con IVA)', tipo: 'moneda' }],
//     filas: [{ dia: '2026-10-01', netas: 12345.5 }],          // objetos por clave, o arreglos en el orden de las columnas
//     totales: { netas: 'suma' },                              // opcional: clave -> número (el que se ve en pantalla) o 'suma'
//     notas: ['Los días sin ventas aparecen en cero.'],        // opcional
//     xml: async ({ alAvanzar }) => [{ nombre: 'clave.xml', contenido: '<xml…/>' }],  // opcional: SOLO si se pasa, sale «XML firmados (.zip)»
//   }), { texto: 'Descargar', etiqueta: 'Descargar ventas por día' }));   // segundo argumento opcional
//
//   Varias tablas en un informe: en lugar de columnas/filas se pasa hojas:[{nombre, titulo, subtitulo, cifras, columnas, filas, totales, notas}, …].
//   Excel trae una hoja por tabla, el PDF todas las tablas una tras otra y el CSV un .zip con un archivo por tabla.
//
// XML: la función xml recibe { alAvanzar(0..1) } y devuelve [{ nombre, contenido }] (contenido: texto o Uint8Array). Si falla, el componente avisa con palabras y ofrece «Intentar de nuevo».
// PDF: hasta MAX_FILAS_PDF filas (5 000, medido). Con más, el menú solo ofrece Excel y CSV y lo explica en una línea. Excel y CSV aguantan 100 000 filas.
//
// TIPOS DE COLUMNA: texto | numero | moneda | fecha | fechahora | porcentaje (ver descargas_comun.js).
// El Excel real (números como números, fechas como fechas, ₡#,##0.00, encabezado fijo) lo arma descargas_xlsx.js; el CSV (UTF-8 con BOM, comas,
// punto decimal, fechas AAAA-MM-DD, una sola fila de encabezado) y el PDF (impresión del navegador en un iframe oculto) se arman aquí.
import { h, num } from './util.js';
import { resolverOpciones, ahoraCR, nombreArchivo, nombrePeriodo, reloj, crearCsv, valorXlsx, valorFila, calcularTotales, textoCifras, decimalesDe, dmaDeSerie, mesDeSerie, nombreHoja } from './descargas_comun.js';

export { nombrePeriodo, nombreArchivo, ahoraCR };

const cssUrl = new URL('../css/descargas.css', import.meta.url).href;
const FUENTES_URL = 'https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&display=swap';
// El PDF sale de la impresión del navegador. Medido en Chromium: 5 000 filas son 152 páginas y se imprimen en 8 s; con 20 000 filas la impresión falla. Más de esto solo se ofrece Excel y CSV.
export const MAX_FILAS_PDF = 5000;
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
let contador = 0;

/* ---------- guardar el archivo ---------- */
export function bajarBlob(blob, nombre) {
  const a = h('a', { href: URL.createObjectURL(blob), download: nombre });
  document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 60000);
}

/* ---------- PDF: impresión del navegador ---------- */
const esIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const modoImpresion = () => { let m = 'auto'; try { m = (JSON.parse(localStorage.getItem('fx_impresion') || '{}') || {}).modo || 'auto'; } catch { /* sin ajustes: automático */ } return m === 'iframe' ? 'iframe' : (m === 'pagina' || esIOS()) ? 'pagina' : 'iframe'; };
// Texto seguro para un «content» de CSS (solo letras, números y signos sencillos)
const cssTexto = (t) => String(t ?? '').replace(/[^\p{L}\p{N} .,;:()%/·-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 90);

// Todas las reglas empiezan con .fxp para poder usarlas dentro del iframe o, en iPhone y iPad, en la página misma
const CSS_PDF = `
.fxp{font-family:Figtree,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1d1a17;font-size:10px;line-height:1.35;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.fxp *{box-sizing:border-box}
.fxp .cab{padding-bottom:6px;margin-bottom:8px;border-bottom:2px solid #b81622}
.fxp .emp{font-size:11px;font-weight:700;color:#b81622;letter-spacing:.02em}
.fxp h1{margin:2px 0 1px;font-size:19px;font-weight:700;letter-spacing:-.01em}
.fxp h2{margin:14px 0 2px;font-size:13px;font-weight:700;break-after:avoid;page-break-after:avoid}
.fxp p{margin:1px 0}
.fxp .sub{font-size:11px}
.fxp .cif{font-size:10.5px;font-weight:700;color:#0f6f6a}
.fxp .gen{font-size:9px;color:#6b645b}
.fxp table{width:100%;border-collapse:collapse;margin-top:6px}
.fxp thead{display:table-header-group}
.fxp tfoot{display:table-row-group}
.fxp tr{break-inside:avoid;page-break-inside:avoid}
.fxp th{padding:4px 5px;text-align:left;font-size:8.5px;font-weight:700;background:#fdf2dc;border-top:1px solid #1d1a17;border-bottom:1px solid #1d1a17;vertical-align:bottom}
.fxp td{padding:3px 5px;border-bottom:.5px solid #cfc5b2;vertical-align:top;overflow-wrap:anywhere}
.fxp th.d,.fxp td.d{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.fxp th.d{white-space:normal}
.fxp td.cod{white-space:nowrap;font-variant-numeric:tabular-nums}
.fxp tr.tot td{font-weight:700;background:#fbf8f2;border-top:1px solid #1d1a17;border-bottom:2px double #1d1a17}
.fxp ul{margin:8px 0 0;padding-left:14px;font-size:9px;color:#6b645b}
.fxp .vacia{margin-top:8px;font-style:italic;color:#6b645b}
`;

const formatos = new Map();
const nf = (min, max) => { const k = min + '/' + max; if (!formatos.has(k)) formatos.set(k, new Intl.NumberFormat('es-CR', { minimumFractionDigits: min, maximumFractionDigits: max })); return formatos.get(k); };
// Cómo se ve un dato en el PDF: igual que en pantalla (₡12 345,50, 29/10/2026)
function textoPdf(col, v) {
  const x = valorXlsx(col, v);
  if (x == null) return '';
  if (typeof x === 'string') return x;
  switch (col.tipo) {
    case 'fecha': return col.formato === 'mes' ? mesDeSerie(x) : dmaDeSerie(x, false);
    case 'fechahora': return dmaDeSerie(x, true);
    case 'moneda': { const d = decimalesDe(col); const s = nf(d, Math.max(d, col.decMax || 0)).format(Math.abs(x)); return (x < 0 && /[1-9]/.test(s) ? '-' : '') + '₡' + s; }
    case 'porcentaje': { const d = decimalesDe(col); return nf(d, Math.max(d, 3)).format(x) + ' %'; }
    default: return nf(col.dec ?? 0, col.dec ?? 3).format(x);
  }
}

// Arma el informe dentro de raiz (un elemento del documento D). No usa innerHTML: todo entra con textContent.
async function construirPdf(D, raiz, res, doc, pausar) {
  const el = (tag, cls, txt) => { const e = D.createElement(tag); if (cls) e.className = cls; if (txt != null && txt !== '') e.textContent = txt; return e; };
  const { base, tablas, varias } = res;
  const cab = el('div', 'cab');
  cab.append(el('div', 'emp', [base.empresa, base.cedula ? 'Cédula ' + base.cedula : ''].filter(Boolean).join(' · ')));
  cab.append(el('h1', '', varias ? base.titulo : tablas[0].titulo));
  const sub = varias ? base.subtitulo : tablas[0].subtitulo;
  if (sub) cab.append(el('p', 'sub', sub));
  const cif = varias ? [textoCifras(base.cifras), base.cifrasNota].filter(Boolean).join('. ') : [textoCifras(tablas[0].cifras), tablas[0].cifrasNota].filter(Boolean).join('. ');
  if (cif) cab.append(el('p', 'cif', cif));
  cab.append(el('p', 'gen', 'Generado el ' + doc.generado.texto));
  raiz.append(cab);
  if (varias && base.notas?.length) { const ul = el('ul'); base.notas.forEach((n) => ul.append(el('li', '', n))); raiz.append(ul); }

  for (const t of tablas) {
    const visibles = t.columnas.map((c, i) => ({ c, i })).filter((x) => x.c.enPdf);
    if (varias) {
      raiz.append(el('h2', '', t.titulo));
      if (t.subtitulo && t.subtitulo !== base.subtitulo) raiz.append(el('p', 'sub', t.subtitulo));
      const ci = [textoCifras(t.cifras), t.cifrasNota].filter(Boolean).join('. ');
      if (ci) raiz.append(el('p', 'cif', ci));
    }
    const tabla = el('table'); const thead = el('thead'), trh = el('tr');
    visibles.forEach(({ c }) => trh.append(el('th', c.tipo === 'texto' ? '' : 'd', c.titulo)));
    thead.append(trh); tabla.append(thead);
    const tb = el('tbody'); tabla.append(tb);
    raiz.append(tabla);
    const n = t.filas.length, lote = 400;
    // Los códigos largos (consecutivo, cédula, clave) no se parten en dos renglones: se ven en una línea y se pueden copiar
    const codigo = new Set(visibles.filter(({ c, i }) => c.tipo === 'texto' && t.filas.slice(0, 300).some((f) => /^\d{10,}$/.test(String(valorFila(f, c, i) ?? ''))) && t.filas.slice(0, 300).every((f) => /^(\d{10,})?$/.test(String(valorFila(f, c, i) ?? '')))).map(({ i }) => i));
    for (let i = 0; i < n; i += lote) {
      const frag = D.createDocumentFragment();
      for (let k = i; k < Math.min(n, i + lote); k++) {
        const tr = D.createElement('tr'); const f = t.filas[k];
        for (const { c, i: j } of visibles) { const td = D.createElement('td'); if (c.tipo !== 'texto') td.className = 'd'; else if (codigo.has(j)) td.className = 'cod'; td.textContent = textoPdf(c, valorFila(f, c, j)); tr.append(td); }
        frag.append(tr);
      }
      tb.append(frag);
      await pausar();
    }
    if (!n) raiz.append(el('p', 'vacia', 'No hay filas con lo que se ve en pantalla.'));
    const tot = calcularTotales(t);
    if (tot) {
      const tr = el('tr', 'tot');
      const primero = visibles.findIndex(({ c, i }) => !tot.has(i) && c.tipo === 'texto');
      visibles.forEach(({ c, i }, pos) => {
        const td = el('td', c.tipo === 'texto' ? '' : 'd');
        if (tot.has(i)) { const v = tot.get(i); td.textContent = typeof v === 'number' ? textoPdf(c, v) : String(v); } else if (pos === (primero >= 0 ? primero : 0)) td.textContent = t.etiquetaTotal;
        tr.append(td);
      });
      tb.append(tr);
    }
    const notas = [...(t.notas || [])];
    if (notas.length) { const ul = el('ul'); notas.forEach((x) => ul.append(el('li', '', x))); raiz.append(ul); }
  }
}

/**
 * Deja el PDF listo en un iframe oculto (o en la página, en iPhone y iPad). Devuelve { imprimir(), cerrar(), marco, doc } para quien quiera mirarlo antes.
 * imprimir() abre la ventana de impresión del navegador: ahí se elige «Guardar como PDF».
 */
export async function prepararPdf(res, { nombre = '', alAvanzar } = {}) {
  const modo = modoImpresion();
  const pausar = reloj(12);
  const doc = { generado: ahoraCR() };
  const orient = (res.tablas[0]?.columnas.filter((c) => c.enPdf).length || 0) >= 7 ? 'landscape' : 'portrait';
  const pie = cssTexto([res.base.titulo || res.tablas[0]?.titulo, res.base.empresa].filter(Boolean).join(' · '));
  const cssPagina = `@page{size:letter ${orient};margin:12mm 11mm 15mm;`
    + `@bottom-left{content:"${pie}";font:8px Figtree,system-ui,sans-serif;color:#6b645b}`
    + '@bottom-right{content:"Página " counter(page) " de " counter(pages);font:8px Figtree,system-ui,sans-serif;color:#6b645b}}';
  let D, ventana, raiz, limpiar, marco = null, tituloPrevio = null;
  if (modo === 'iframe') {
    marco = h('iframe', { title: 'Informe para imprimir', 'aria-hidden': 'true', tabindex: '-1', style: 'position:fixed;left:-10000px;top:0;width:1100px;height:800px;border:0;opacity:0;pointer-events:none' });
    marco.srcdoc = '<!doctype html><html lang="es"><head><meta charset="utf-8"><title></title></head><body></body></html>';
    const cargado = new Promise((ok) => marco.addEventListener('load', ok, { once: true }));
    document.body.append(marco);
    await Promise.race([cargado, esperar(8000)]);
    D = marco.contentDocument; ventana = marco.contentWindow;
    if (!D || !D.body) { marco.remove(); throw new Error('No se pudo preparar el documento para imprimir.'); }
    D.title = nombre || res.nombre;
    const estilo = D.createElement('style'); estilo.textContent = 'html,body{margin:0;padding:0;background:#fff}' + CSS_PDF + cssPagina; D.head.append(estilo);
    const fuente = D.createElement('link'); fuente.rel = 'stylesheet'; fuente.href = FUENTES_URL; D.head.append(fuente);
    raiz = D.createElement('div'); raiz.className = 'fxp'; D.body.append(raiz);
    limpiar = () => marco.remove();
  } else {
    // iPhone y iPad imprimen la página completa y no el iframe: el informe se pone en la página y una regla de impresión oculta todo lo demás
    document.getElementById('fx-descarga-pdf')?.remove(); document.getElementById('fx-descarga-pdf-estilo')?.remove();
    D = document; ventana = window;
    const estilo = h('style#fx-descarga-pdf-estilo'); estilo.textContent = CSS_PDF + cssPagina + '@media screen{#fx-descarga-pdf{display:none}}@media print{body>*:not(#fx-descarga-pdf){display:none!important}#fx-descarga-pdf{display:block}}';
    document.head.append(estilo);
    raiz = h('div#fx-descarga-pdf.fxp'); document.body.append(raiz);
    tituloPrevio = document.title; document.title = nombre || res.nombre;
    limpiar = () => { raiz.remove(); estilo.remove(); document.title = tituloPrevio; };
  }
  try {
    await construirPdf(D, raiz, res, doc, async () => { await pausar(); });
    if (alAvanzar) alAvanzar(1);
    if (D.fonts?.ready) await Promise.race([D.fonts.ready, esperar(1500)]);
  } catch (e) { try { limpiar(); } catch { /* ya no está */ } throw e; }
  let impreso = false;
  const imprimir = () => new Promise((fin, mal) => {
    if (impreso) { fin(); return; }
    impreso = true;
    let hecho = false;
    const cierre = () => { if (hecho) return; hecho = true; setTimeout(() => { try { limpiar(); } catch { /* ya no está */ } fin(); }, 300); };
    ventana.addEventListener('afterprint', cierre, { once: true });
    setTimeout(cierre, 120000); // por si el navegador nunca avisa
    try { ventana.focus(); ventana.print(); } catch (e) { hecho = true; try { limpiar(); } catch { /* nada */ } mal(e); return; }
    if (modo === 'iframe' && !('onafterprint' in ventana)) cierre();
  });
  return { imprimir, cerrar: limpiar, marco, doc: D, modo };
}

/* ---------- el componente ---------- */
const FORMATOS = {
  xlsx: { sello: 'XLSX', titulo: 'Excel (.xlsx)', ext: 'xlsx', info: (r) => (r.varias ? 'Un solo libro con una hoja por tabla, para revisar o sumar en Excel.' : 'Para revisar, ordenar o sumar en Excel.') },
  csv: { sello: 'CSV', titulo: 'CSV (para programas contables)', ext: 'csv', info: (r) => (r.varias ? 'Un archivo CSV por tabla, juntos en un .zip, para cargar en otros programas.' : 'Texto simple, sin formato, para cargar en otros programas.') },
  pdf: { sello: 'PDF', titulo: 'PDF (para imprimir o guardar)', ext: 'pdf', info: () => 'Para imprimir o enviar. Al abrirse la impresión, elija «Guardar como PDF».' },
  xml: { sello: 'ZIP', titulo: 'XML firmados (.zip)', ext: 'zip', info: () => 'Los comprobantes originales firmados, para contabilidad o respaldo.' },
};

export function crearDescarga(opciones, { texto = 'Descargar', etiqueta = '', clase = '' } = {}) {
  if (!document.getElementById('css-descargas')) document.head.append(h('link', { id: 'css-descargas', rel: 'stylesheet', href: cssUrl }));
  const id = ++contador;
  let abierto = false, ocupado = false, res = null, ultimo = null, tAviso = 0;
  const estado = h('p.desc-estado', { id: 'desc-estado-' + id, role: 'status', 'aria-live': 'polite', hidden: true });
  const boton = h('button.btn.desc-boton' + (clase ? '.' + clase : ''), { type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false', 'aria-controls': 'desc-menu-' + id, 'aria-label': etiqueta || null, 'aria-describedby': 'desc-estado-' + id, onclick: () => (abierto ? cerrar(true) : abrir()) },
    h('span.desc-txt', texto), h('span.desc-flecha', { 'aria-hidden': 'true' }, '▾'));
  const velo = h('div.desc-velo', { hidden: true, onclick: () => cerrar(true) });
  const menu = h('div.desc-menu', { id: 'desc-menu-' + id, role: 'menu', 'aria-label': 'Formatos de descarga', hidden: true });
  const ancla = h('div.desc-ancla', boton, velo, menu);
  const raiz = h('div.desc', ancla, estado);

  const decir = (txt, tipo = '', ...extra) => {
    clearTimeout(tAviso);
    estado.className = 'desc-estado' + (tipo ? ' ' + tipo : ''); estado.replaceChildren(txt, ...extra); estado.hidden = !txt;
    if (tipo === 'ok') tAviso = setTimeout(() => { estado.hidden = true; }, 9000);
  };
  const ocupar = (si, pct) => {
    ocupado = si; boton.disabled = si;
    boton.querySelector('.desc-txt').textContent = si ? 'Preparando…' + (pct != null && pct > 0 && pct < 1 ? ' ' + Math.round(pct * 100) + ' %' : '') : texto;
    boton.setAttribute('aria-busy', String(si));
  };

  const fuera = (e) => { if (!ancla.contains(e.target)) cerrar(false); };
  const teclas = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); cerrar(true); return; }
    const items = [...menu.querySelectorAll('button')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); } else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); } else if (e.key === 'Home') { e.preventDefault(); items[0]?.focus(); } else if (e.key === 'End') { e.preventDefault(); items[items.length - 1]?.focus(); }
  };
  function cerrar(devolverFoco) {
    if (!abierto) return;
    abierto = false; menu.hidden = true; velo.hidden = true; boton.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', fuera, true); menu.removeEventListener('keydown', teclas);
    if (devolverFoco && !ocupado) boton.focus({ preventScroll: true });
  }
  async function abrir() {
    if (ocupado) return;
    decir('');
    try { res = await resolverOpciones(opciones); } catch (e) { res = null; decir('No se pudo preparar la lista para descargar. Intente de nuevo.', 'mal', reintentar(abrir)); return; }
    if (!res.tablas.length || !res.filas) { decir('No hay nada para descargar con lo que se ve ahora. Cambie el periodo o el filtro e intente de nuevo.', ''); return; }
    const pdfSi = res.filas <= MAX_FILAS_PDF;
    const fs = ['xlsx', 'csv', ...(pdfSi ? ['pdf'] : []), ...(res.xml ? ['xml'] : [])];
    menu.replaceChildren(
      h('p.desc-tit', '¿En qué formato lo quiere?'),
      ...fs.map((f) => h('button.desc-opc', { type: 'button', role: 'menuitem', 'data-formato': f, onclick: () => ejecutar(f) },
        h('span.desc-sello', { 'aria-hidden': 'true' }, FORMATOS[f].sello),
        h('span.desc-opc-txt', h('strong', FORMATOS[f].titulo), h('small', FORMATOS[f].info(res))))),
      ...(pdfSi ? [] : [h('p.desc-nota', `El PDF no se ofrece con tantas filas (son ${num(res.filas, 0)} y el máximo es ${num(MAX_FILAS_PDF, 0)}). Para una lista así use Excel o CSV.`)]),
      h('button.btn.desc-cerrar', { type: 'button', onclick: () => cerrar(true) }, 'Cerrar sin descargar'));
    abierto = true; menu.hidden = false; velo.hidden = false; boton.setAttribute('aria-expanded', 'true');
    // en pantallas anchas el menú se abre hacia el lado donde cabe
    const r = boton.getBoundingClientRect(), ancho = Math.min(380, innerWidth - 32);
    menu.classList.toggle('der', r.right - ancho >= 8); menu.classList.toggle('izq', !(r.right - ancho >= 8));
    // si abajo no cabe, se abre hacia arriba; si tampoco cabe arriba, se baja la pantalla lo justo para verlo completo
    menu.classList.remove('arriba');
    if (innerWidth > 640) {
      const alto = menu.getBoundingClientRect().height;
      if (r.bottom + 6 + alto > innerHeight - 8) { if (r.top - 6 - alto >= 8) menu.classList.add('arriba'); else menu.scrollIntoView({ block: 'nearest' }); }
    }
    document.addEventListener('pointerdown', fuera, true); menu.addEventListener('keydown', teclas);
    menu.querySelector('button')?.focus({ preventScroll: true });
  }
  const reintentar = (fn) => h('button.btn.chico.desc-reintentar', { type: 'button', onclick: () => fn() }, 'Intentar de nuevo');

  async function ejecutar(formato) {
    const r = res; cerrar(false);
    if (!r || ocupado) return;
    ultimo = formato;
    ocupar(true); decir('Preparando el archivo, un momento…');
    const alAvanzar = (p) => { if (r.filas > 4000) ocupar(true, p); };
    try {
      const f = FORMATOS[formato];
      const doc = { empresa: r.base.empresa, cedula: r.base.cedula, generado: ahoraCR(), tablas: r.tablas, titulo: r.base.titulo || r.tablas[0].titulo };
      const archivo = nombreArchivo(r.nombre, f.ext);
      if (formato === 'xlsx') {
        const { crearXlsx } = await import('./descargas_xlsx.js');
        bajarBlob(await crearXlsx(doc, { alAvanzar }), archivo);
        decir(`Listo: se descargó «${archivo}». Búsquelo en la carpeta de descargas.`, 'ok');
      } else if (formato === 'csv') {
        if (r.varias) {
          const { crearZip } = await import('./descargas_xlsx.js');
          const usados = new Set(); const archivos = [];
          for (const t of r.tablas) archivos.push({ nombre: nombreArchivo(nombreHoja(t.nombre, usados), 'csv'), contenido: await (await crearCsv(t)).arrayBuffer() });
          bajarBlob(await crearZip(archivos, { alAvanzar }), nombreArchivo(r.nombre, 'zip'));
          decir(`Listo: se descargó «${nombreArchivo(r.nombre, 'zip')}», con un archivo CSV por tabla.`, 'ok');
        } else {
          bajarBlob(await crearCsv(r.tablas[0], { alAvanzar }), archivo);
          decir(`Listo: se descargó «${archivo}». Búsquelo en la carpeta de descargas.`, 'ok');
        }
      } else if (formato === 'pdf') {
        const p = await prepararPdf(r, { nombre: nombreArchivo(r.nombre), alAvanzar });
        decir('Se abrió la impresión. Para guardar el PDF, elija «Guardar como PDF» como destino.', 'ok');
        await p.imprimir();
      } else if (formato === 'xml') {
        const salida = await r.xml({ alAvanzar });
        const archivos = Array.isArray(salida) ? salida : (salida?.archivos || []);
        if (!archivos.length) { decir('No hay XML firmados para descargar con lo que se ve ahora.', ''); return; }
        const { crearZip } = await import('./descargas_xlsx.js');
        bajarBlob(await crearZip(archivos, { alAvanzar }), archivo);
        decir(`Listo: se descargó «${archivo}» con ${archivos.length} ${archivos.length === 1 ? 'archivo' : 'archivos'}.`, 'ok');
      }
    } catch (e) {
      decir('No se pudo preparar el archivo. Puede intentarlo de nuevo; si sigue igual, pruebe con otro formato.', 'mal', reintentar(() => ejecutarDeNuevo()));
      try { console.error('descarga', e); } catch { /* sin consola */ }
    } finally { ocupar(false); }
  }
  async function ejecutarDeNuevo() {
    if (ocupado || !ultimo) return;
    try { res = await resolverOpciones(opciones); } catch { decir('No se pudo preparar la lista para descargar. Intente de nuevo.', 'mal', reintentar(ejecutarDeNuevo)); return; }
    await ejecutar(ultimo);
  }

  // Para quien necesite bajar sin abrir el menú (pruebas u otras pantallas): crearDescarga(...).descargar('xlsx')
  raiz.descargar = async (formato) => { res = await resolverOpciones(opciones); await ejecutar(formato); };
  raiz.abrirMenu = abrir; raiz.cerrarMenu = () => cerrar(true);
  return raiz;
}

/** Baja de una vez, sin menú, lo que describe «opciones» (misma forma que crearDescarga). formato: 'xlsx' | 'csv'. Devuelve el Blob y el nombre. */
export async function generarArchivo(opciones, formato) {
  const r = await resolverOpciones(opciones);
  const doc = { empresa: r.base.empresa, cedula: r.base.cedula, generado: ahoraCR(), tablas: r.tablas, titulo: r.base.titulo || r.tablas[0]?.titulo };
  if (formato === 'xlsx') { const { crearXlsx } = await import('./descargas_xlsx.js'); return { blob: await crearXlsx(doc), nombre: nombreArchivo(r.nombre, 'xlsx') }; }
  if (formato === 'csv') return { blob: await crearCsv(r.tablas[0]), nombre: nombreArchivo(r.nombre, 'csv') };
  throw new Error('Formato no disponible: ' + formato);
}
