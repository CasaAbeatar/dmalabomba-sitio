// Generador mínimo de libros de Excel (.xlsx, Office Open XML). Escribe las hojas poco a poco y las comprime al vuelo,
// así que un informe de 100 000 filas no congela la pantalla ni llena la memoria.
//
// BIBLIOTECA DE COMPRESIÓN (solo se usa para armar el .zip del xlsx; no se carga nada desde internet en ningún momento):
//   fflate 0.8.2, licencia MIT (101arrowz, https://github.com/101arrowz/fflate).
//   Procedencia: paquete npm «fflate@0.8.2» (https://registry.npmjs.org/fflate/-/fflate-0.8.2.tgz,
//   integridad sha512-cPJU47OaAoCbg0pBvzsgpTPhmhqI5eJjh/JIu8tPj5q+T7iLvW/JAYUqmE7KOB4R1ZyEhzBaIQpQpardBF5z8A==).
//   Archivo copiado tal cual del paquete: esm/browser.js -> facturacion/vendor/fflate-0.8.2.js (SHA-256 8cc1f687e0159e977addb6b85e274dbd11e622cf151f4fcb7b85d49622ea43e7).
//   Su licencia está en facturacion/vendor/fflate-0.8.2-LICENSE.txt. Solo se usan las clases Zip y ZipDeflate (síncronas, sin Worker),
//   porque la política de seguridad de la página (CSP) no permite crear Workers desde blob:. Para actualizar: instalar la versión nueva con npm
//   en un directorio temporal, copiar esm/browser.js con la versión en el nombre, cambiar este comentario y el import de abajo.
import { Zip, ZipDeflate } from '../vendor/fflate-0.8.2.js';
import { valorXlsx, valorFila, calcularTotales, textoCifras, reloj, decimalesDe, nombreHoja, MAX_CELDA } from './descargas_comun.js';

const enc = new TextEncoder();
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CAB = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/* ---------- XML seguro ---------- */
// Caracteres que un XML no admite (Excel diría que el archivo está dañado) y los que hay que escapar
const NECESITA = /[&<>"\r\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF￾￿]/;
const MAPA = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
export function escXml(s) {
  s = String(s);
  if (!NECESITA.test(s)) return s;
  return s.replace(/\r\n?/g, '\n').replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[&<>"\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF￾￿]/g, (c) => (c.length === 2 ? c : (MAPA[c] || '')));
}
const letra = (i) => { let s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };

/* ---------- estilos ---------- */
function crearEstilos() {
  const fuentes = [], rellenos = [], bordes = [], fmts = new Map(), xfs = [], cache = new Map();
  const reg = (arr, xml) => { let i = arr.indexOf(xml); if (i < 0) { i = arr.length; arr.push(xml); } return i; };
  const fuente = ({ b, i, sz = 11, color = '1D1A17' } = {}) => reg(fuentes, `<font>${b ? '<b/>' : ''}${i ? '<i/>' : ''}<sz val="${sz}"/><color rgb="FF${color}"/><name val="Calibri"/><family val="2"/></font>`);
  const relleno = (rgb) => (rgb ? reg(rellenos, `<fill><patternFill patternType="solid"><fgColor rgb="FF${rgb}"/><bgColor indexed="64"/></patternFill></fill>`) : 0);
  const lado = (n, s) => (s ? `<${n} style="${s[0]}"><color rgb="FF${s[1]}"/></${n}>` : `<${n}/>`);
  const borde = ({ arriba, abajo } = {}) => (arriba || abajo ? reg(bordes, `<border><left/><right/>${lado('top', arriba)}${lado('bottom', abajo)}<diagonal/></border>`) : 0);
  const fmt = (code) => { if (!code) return 0; if (!fmts.has(code)) fmts.set(code, 164 + fmts.size); return fmts.get(code); };
  // lo que Excel espera al principio: fuente 0 normal, rellenos 0 y 1 reservados, borde 0 vacío, estilo 0 General
  fuente(); rellenos.push('<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'); bordes.push('<border><left/><right/><top/><bottom/><diagonal/></border>');
  const xf = (o = {}) => {
    const k = JSON.stringify(o);
    if (cache.has(k)) return cache.get(k);
    const al = o.h || o.wrap || o.v ? `<alignment${o.h ? ` horizontal="${o.h}"` : ''} vertical="${o.v || 'center'}"${o.wrap ? ' wrapText="1"' : ''}/>` : '';
    const x = `<xf numFmtId="${fmt(o.fmt)}" fontId="${o.fuente ?? 0}" fillId="${o.relleno ?? 0}" borderId="${o.borde ?? 0}" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"${al ? ' applyAlignment="1"' : ''}${o.q ? ' quotePrefix="1"' : ''}>${al}</xf>`;
    const i = xfs.push(x) - 1; cache.set(k, i); return i;
  };
  xf({}); // estilo 0
  const xml = () => CAB + `<styleSheet xmlns="${NS}">`
    + (fmts.size ? `<numFmts count="${fmts.size}">${[...fmts].map(([c, id]) => `<numFmt numFmtId="${id}" formatCode="${escXml(c)}"/>`).join('')}</numFmts>` : '')
    + `<fonts count="${fuentes.length}">${fuentes.join('')}</fonts><fills count="${rellenos.length}">${rellenos.join('')}</fills><borders count="${bordes.length}">${bordes.join('')}</borders>`
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + `<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  return { fuente, relleno, borde, xf, xml };
}

// Formato numérico de Excel de una columna (null = General)
function codigoFormato(c) {
  const ceros = (n) => (n > 0 ? '.' + '0'.repeat(n) : '');
  switch (c.tipo) {
    case 'moneda': { const d = decimalesDe(c), m = Math.max(d, c.decMax || 0); return '"₡"#,##0' + ceros(d) + '#'.repeat(m - d); }
    case 'numero': return c.dec == null ? null : '#,##0' + ceros(c.dec);
    case 'porcentaje': return '0' + ceros(decimalesDe(c)) + '" %"';
    case 'fecha': return c.formato === 'mes' ? 'mmmm yyyy' : 'dd/mm/yyyy';
    case 'fechahora': return 'dd/mm/yyyy hh:mm';
    default: return null;
  }
}
const alinear = (c) => (c.tipo === 'texto' ? 'left' : 'right');

// Ancho de columna en caracteres, según el título y una muestra de los datos
function anchoColumna(c, i, t) {
  if (c.ancho) return Math.min(80, Math.max(6, c.ancho));
  if (c.tipo === 'fecha') return c.formato === 'mes' ? 16 : 12;
  if (c.tipo === 'fechahora') return 17;
  let w = 0;
  const n = t.filas.length, paso = Math.max(1, Math.floor(n / 4000));
  for (let k = 0; k < n; k += paso) {
    const x = valorXlsx(c, valorFila(t.filas[k], c, i));
    if (x == null) continue;
    const l = typeof x === 'string' ? Math.min(x.length, 60) : (c.tipo === 'moneda' ? Math.abs(x).toFixed(Math.max(2, c.decMax || 0)).length + Math.floor(Math.abs(x) / 1000).toString().length / 3 + 3 : String(x).length + 2);
    if (l > w) w = l;
  }
  const palabra = Math.max(...c.titulo.split(/\s+/).map((p) => p.length), 4);
  const titulo = Math.min(Math.ceil(c.titulo.length * 0.6), 20);
  return Math.min(c.tipo === 'texto' ? 60 : 26, Math.max(10, w + 2, palabra + 2, titulo + 2));
}

/* ---------- salida comprimida al vuelo ---------- */
class Salida {
  constructor(zf) { this.zf = zf; this.buf = []; this.n = 0; }
  add(s) { this.buf.push(s); this.n += s.length; if (this.n > 200000) this.vaciar(false); }
  vaciar(final) { const bytes = enc.encode(this.buf.join('')); this.buf = []; this.n = 0; this.zf.push(bytes, final); }
}

const quotaNombre = (n) => "'" + n.replace(/'/g, "''") + "'";

/**
 * Crea el libro. doc = { empresa, cedula, generado:{texto}, tablas:[tabla normalizada], titulo }.
 * Devuelve un Blob .xlsx. alAvanzar(0..1) es opcional.
 */
export async function crearXlsx(doc, { alAvanzar } = {}) {
  const tablas = doc.tablas.filter((t) => t.columnas.length);
  if (!tablas.length) throw new Error('No hay nada que guardar.');
  const E = crearEstilos();
  const cadenas = []; const indice = new Map(); let referencias = 0;
  const cadena = (s) => { referencias++; let i = indice.get(s); if (i === undefined) { i = cadenas.length; cadenas.push(s); indice.set(s, i); } return i; };
  const pausar = reloj(12);

  // estilos del encabezado del informe
  const fE = E.fuente({ b: 1, sz: 14, color: 'B81622' }), fT = E.fuente({ b: 1, sz: 12 }), fS = E.fuente({ sz: 11 }), fC = E.fuente({ b: 1, sz: 11, color: '0F6F6A' }), fN = E.fuente({ i: 1, sz: 10, color: '6B645B' }), fB = E.fuente({ b: 1 });
  const oEmpresa = { fuente: fE }, oTitulo = { fuente: fT }, oSub = { fuente: fS }, oCifras = { fuente: fC }, oNota = { fuente: fN };
  const sNota = E.xf(oNota);
  const totalFilas = Math.max(1, tablas.reduce((a, b) => a + b.filas.length, 0));
  const rEnc = E.relleno('FDF2DC'), rTot = E.relleno('FBF8F2');
  const bFila = E.borde({ abajo: ['hair', 'CFC5B2'] }), bEnc = E.borde({ abajo: ['thin', '1D1A17'] }), bTot = E.borde({ arriba: ['thin', '1D1A17'], abajo: ['double', '1D1A17'] });

  const partes = []; let terminado;
  const fin = new Promise((ok, mal) => { terminado = { ok, mal }; });
  const zip = new Zip((err, chunk, final) => { if (err) { terminado.mal(err); return; } partes.push(chunk); if (final) terminado.ok(); });
  const archivo = (nombre) => { const zf = new ZipDeflate(nombre, { level: 6 }); zip.add(zf); return zf; };
  const chico = (nombre, texto) => { const zf = archivo(nombre); zf.push(enc.encode(texto), true); };

  const usados = new Set();
  const hojas = tablas.map((t) => ({ t, nombre: nombreHoja(t.nombre, usados) }));
  const n = hojas.length;
  chico('[Content_Types].xml', CAB + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + hojas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
    + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
    + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>');
  chico('_rels/.rels', CAB + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
    + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>');
  chico('docProps/app.xml', CAB + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Facturador La Bomba</Application></Properties>');
  chico('docProps/core.xml', CAB + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
    + `<dc:title>${escXml(doc.titulo || tablas[0].titulo)}</dc:title><dc:creator>Facturador La Bomba</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().slice(0, 19)}Z</dcterms:created></cp:coreProperties>`);

  // nombres definidos: filas que se repiten al imprimir y el filtro de cada hoja (se llenan al armar cada hoja)
  const nombresDef = [];
  let hechas = 0;

  for (let h = 0; h < n; h++) {
    const { t, nombre } = hojas[h];
    const cols = t.columnas, nc = cols.length;
    const FILA_ENC = 6, PRIMERA = 7; // 5 filas de encabezado del informe + la fila de títulos de columna
    const filas = t.filas, nf = filas.length;
    const totales = calcularTotales(t);
    const ultimaDatos = FILA_ENC + nf;
    const filaTot = totales ? ultimaDatos + 1 : 0;
    const notas = t.notas || [];
    const ultima = (filaTot || ultimaDatos) + (notas.length ? 1 + notas.length : 0);
    // estilos por columna
    const est = cols.map((c) => {
      const code = codigoFormato(c), al = alinear(c);
      return {
        enc: E.xf({ fuente: fB, relleno: rEnc, borde: bEnc, h: al, wrap: 1 }),
        dato: E.xf({ borde: bFila, fmt: code, h: al }),
        datoQ: E.xf({ borde: bFila, fmt: code, h: al, q: 1 }),
        tot: E.xf({ fuente: fB, relleno: rTot, borde: bTot, fmt: code, h: al }),
        totTxt: E.xf({ fuente: fB, relleno: rTot, borde: bTot, h: 'left' }),
      };
    });
    const anchos = cols.map((c, i) => anchoColumna(c, i, t));
    const lineasEnc = Math.min(3, Math.max(1, ...cols.map((c, i) => Math.ceil((c.titulo.length * 1.1) / anchos[i]))));

    const zf = archivo(`xl/worksheets/sheet${h + 1}.xml`);
    const S = new Salida(zf);
    const apaisada = nc >= 7 || anchos.reduce((a, b) => a + b, 0) > 95;
    S.add(CAB + `<worksheet xmlns="${NS}" xmlns:r="${NS_R}"><sheetPr><tabColor rgb="FFB81622"/><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${letra(nc - 1)}${ultima}"/>`
      + `<sheetViews><sheetView${h === 0 ? ' tabSelected="1"' : ''} workbookViewId="0"><pane ySplit="${FILA_ENC}" topLeftCell="A${PRIMERA}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${PRIMERA}" sqref="A${PRIMERA}"/></sheetView></sheetViews>`
      + '<sheetFormatPr defaultRowHeight="15"/>'
      + `<cols>${anchos.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${(Math.round(w * 100) / 100).toString()}" customWidth="1"/>`).join('')}</cols><sheetData>`);

    // filas 1 a 5: encabezado del informe
    const lineaCifras = [textoCifras(t.cifras), t.cifrasNota].filter(Boolean).join('. ');
    const info = [
      [[doc.empresa, doc.cedula ? `Cédula ${doc.cedula}` : ''].filter(Boolean).join(' · '), oEmpresa, 20],
      [t.titulo, oTitulo, 18],
      [t.subtitulo, oSub, 16],
      [lineaCifras, oCifras, 16],
      ['Generado el ' + doc.generado.texto, oNota, 16],
    ];
    info.forEach(([txt, o, alto], k) => {
      const r = k + 1;
      const s = E.xf({ ...o, q: /^[=+\-@\t\r]/.test(String(txt)) ? 1 : 0 });
      S.add(`<row r="${r}" ht="${alto}" customHeight="1">${txt ? `<c r="A${r}" s="${s}" t="s"><v>${cadena(String(txt).slice(0, MAX_CELDA))}</v></c>` : ''}</row>`);
    });
    // fila 6: títulos de columna
    S.add(`<row r="${FILA_ENC}" ht="${lineasEnc * 16 + 6}" customHeight="1">${cols.map((c, i) => `<c r="${letra(i)}${FILA_ENC}" s="${est[i].enc}" t="s"><v>${cadena(c.titulo)}</v></c>`).join('')}</row>`);

    // datos, por tandas
    const refs = cols.map((_, i) => letra(i));
    const lote = 300;
    for (let i = 0; i < nf; i += lote) {
      const hasta = Math.min(nf, i + lote);
      for (let k = i; k < hasta; k++) {
        const r = PRIMERA + k, f = filas[k];
        let x = `<row r="${r}">`;
        for (let j = 0; j < nc; j++) {
          const v = valorXlsx(cols[j], valorFila(f, cols[j], j));
          if (v == null) x += `<c r="${refs[j]}${r}" s="${est[j].dato}"/>`;
          else if (typeof v === 'number') x += `<c r="${refs[j]}${r}" s="${est[j].dato}"><v>${v}</v></c>`;
          else x += `<c r="${refs[j]}${r}" s="${/^[=+\-@\t\r]/.test(v) ? est[j].datoQ : est[j].dato}" t="s"><v>${cadena(v)}</v></c>`;
        }
        S.add(x + '</row>');
      }
      await pausar();
      if (alAvanzar) alAvanzar(((hechas + hasta) / totalFilas) * 0.95);
    }
    hechas += nf;

    // totales (los mismos números que se ven en pantalla) y notas
    if (totales) {
      const rot = Array.from({ length: nc }, (_, i) => totales.has(i));
      const primerTexto = cols.findIndex((c, i) => !rot[i] && c.tipo === 'texto');
      let x = `<row r="${filaTot}">`;
      for (let j = 0; j < nc; j++) {
        const ref = `${refs[j]}${filaTot}`;
        if (rot[j]) {
          const v = totales.get(j);
          x += typeof v === 'number' ? `<c r="${ref}" s="${est[j].tot}"><v>${v}</v></c>` : `<c r="${ref}" s="${est[j].totTxt}" t="s"><v>${cadena(String(v))}</v></c>`;
        } else if (j === (primerTexto >= 0 ? primerTexto : 0)) x += `<c r="${ref}" s="${est[j].totTxt}" t="s"><v>${cadena(t.etiquetaTotal)}</v></c>`;
        else x += `<c r="${ref}" s="${est[j].totTxt}"/>`;
      }
      S.add(x + '</row>');
    }
    if (notas.length) {
      const r0 = (filaTot || ultimaDatos) + 2;
      notas.forEach((txt, k) => { S.add(`<row r="${r0 + k}"><c r="A${r0 + k}" s="${sNota}" t="s"><v>${cadena(String(txt).slice(0, MAX_CELDA))}</v></c></row>`); });
    }
    const rango = `$A$${FILA_ENC}:$${letra(nc - 1)}$${ultimaDatos}`;
    S.add('</sheetData>'
      + (nf ? `<autoFilter ref="A${FILA_ENC}:${letra(nc - 1)}${ultimaDatos}"/>` : '')
      + '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.7" header="0.3" footer="0.3"/>'
      + `<pageSetup paperSize="1" orientation="${apaisada ? 'landscape' : 'portrait'}" fitToWidth="1" fitToHeight="0"/>`
      + `<headerFooter><oddFooter>${escXml('&L&8' + String(t.titulo).replace(/&/g, '&&').slice(0, 80) + '&R&8Página &P de &N')}</oddFooter></headerFooter></worksheet>`);
    S.vaciar(true);
    nombresDef.push(`<definedName name="_xlnm.Print_Titles" localSheetId="${h}">${escXml(quotaNombre(nombre))}!$${FILA_ENC}:$${FILA_ENC}</definedName>`);
    if (nf) nombresDef.push(`<definedName name="_xlnm._FilterDatabase" localSheetId="${h}" hidden="1">${escXml(quotaNombre(nombre))}!${rango}</definedName>`);
    await pausar();
  }

  chico('xl/workbook.xml', CAB + `<workbook xmlns="${NS}" xmlns:r="${NS_R}"><workbookPr/><bookViews><workbookView activeTab="0"/></bookViews><sheets>`
    + hojas.map((x, i) => `<sheet name="${escXml(x.nombre)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + `</sheets><definedNames>${nombresDef.join('')}</definedNames></workbook>`);
  chico('xl/_rels/workbook.xml.rels', CAB + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + hojas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
    + `<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId${n + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`);
  chico('xl/styles.xml', E.xml());
  // cadenas compartidas: se escriben al final porque se van juntando mientras se arman las hojas
  {
    const zf = archivo('xl/sharedStrings.xml'); const S = new Salida(zf);
    S.add(CAB + `<sst xmlns="${NS}" count="${referencias}" uniqueCount="${cadenas.length}">`);
    for (let i = 0; i < cadenas.length; i++) {
      S.add(`<si><t xml:space="preserve">${escXml(cadenas[i])}</t></si>`);
      if (i % 2000 === 1999) await pausar();
    }
    S.add('</sst>'); S.vaciar(true);
  }
  zip.end();
  await fin;
  if (alAvanzar) alAvanzar(1);
  return new Blob(partes, { type: TIPO_XLSX });
}

// Zip de varios archivos de texto o bytes: [{nombre, contenido}] -> Blob. Los nombres se limpian (sin carpetas ni caracteres raros) y no se repiten.
export async function crearZip(archivos, { alAvanzar, tipo = 'application/zip' } = {}) {
  const partes = []; let terminado;
  const fin = new Promise((ok, mal) => { terminado = { ok, mal }; });
  const zip = new Zip((err, chunk, final) => { if (err) { terminado.mal(err); return; } partes.push(chunk); if (final) terminado.ok(); });
  const usados = new Set(); const pausar = reloj(12);
  let k = 0;
  for (const a of archivos) {
    let nom = String(a.nombre ?? 'archivo').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '') || 'archivo';
    const punto = nom.lastIndexOf('.'); const base = punto > 0 ? nom.slice(0, punto) : nom, ext = punto > 0 ? nom.slice(punto) : '';
    let c = nom, j = 2; while (usados.has(c.toLowerCase())) c = `${base} ${j++}${ext}`;
    usados.add(c.toLowerCase());
    const zf = new ZipDeflate(c, { level: 6 }); zip.add(zf);
    const bytes = typeof a.contenido === 'string' ? enc.encode(a.contenido) : (a.contenido instanceof Uint8Array ? a.contenido : new Uint8Array(a.contenido));
    zf.push(bytes, true);
    if (alAvanzar) alAvanzar(++k / archivos.length);
    await pausar();
  }
  zip.end(); await fin;
  return new Blob(partes, { type: tipo });
}
