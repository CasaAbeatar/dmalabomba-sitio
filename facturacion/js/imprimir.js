// Impresión de comprobantes, prefacturas y tiquete de prueba.
//
// CONTRATO (BRIEF):
//   imprimirComprobante(comprobanteId, { formato: 'tiquete'|'carta', copias: 1 })
//   imprimirPrefactura(ventaId)
//   abrirAjustesImpresion()
//   reimprimirComprobante(comprobanteId) : pregunta Tiquete o Factura carta y lo imprime
//   imprimirPrueba()
//   + leerAjustes() / guardarAjustes(parcial) para quien necesite saber la configuración de ESTE aparato.
//
// CÓMO IMPRIME (sin dejar pestañas abiertas):
//   1. Arma el documento con h() (nunca innerHTML con datos) dentro de un iframe oculto.
//   2. Espera a que carguen hoja de estilos, logo (SVG en data URI) y fuentes.
//   3. Mide el alto real del tiquete y escribe @page{size:<ancho>mm <alto>mm;margin:0}. Chrome NO acepta
//      "size:80mm auto" (lo ignora y usa carta), por eso el alto se calcula; así cada tiquete es una página
//      del largo exacto y la impresora térmica corta donde termina.
//   4. Llama a print() del iframe y lo borra al terminar (evento afterprint, o a los 2 minutos).
//   En iPhone/iPad (que imprimen el documento completo y no el iframe) se usa el modo "pagina": el mismo contenido
//   se pone en el documento principal y una regla @media print oculta todo lo demás.
//
// IMPRIMIR SIN VENTANITA (computadora de la caja): abrir Chrome/Edge con --kiosk-printing e imprimir a la impresora
// predeterminada. Las instrucciones paso a paso, en lenguaje simple, están en abrirAjustesImpresion().
//
// FUTURO, IMPRESIÓN DIRECTA ESC/POS (NO IMPLEMENTADO): el sistema es independiente de la marca de la impresora porque usa la
// impresión del navegador. Si algún día se quiere imprimir directo a una térmica por WebUSB o Bluetooth, el punto de
// entrada sería una función como la de abajo, que recibiría el MISMO modelo de documento (ver modeloComprobante) y
// generaría bytes ESC/POS (init 0x1B 0x40, texto en CP858/CP437 para tildes y ñ, 0x1B 0x61 n alineación, 0x1D 0x56 corte),
// enviándolos con navigator.usb.requestDevice() + transferOut() o con la API Web Bluetooth (GATT, servicio de la impresora).
// Para activarlo, imprimirNodos() intentaría primero esa vía si leerAjustes().directo === true y, si falla, caería a la del navegador.
//   async function imprimirEscPos(modelo, ajustes) { throw new Error('Impresión directa ESC/POS no disponible todavía'); }

import { api } from './api.js';
import { tarifaDeLinea } from './iva.js';
import { h, esc, money, num, r2, modal, toast, conBoton, textoDeError, fechaCorta, horaCorta, nombrePropio, TIPOS_ID, TIPOS_SERVICIO, MEDIOS } from './util.js';

/* ------------------------------------------------------------------ constantes */

// Leyenda del pie. En la versión 4.4 la norma vigente es la resolución MH-DGT-RES-0027-2024 (publicada el 19-nov-2024,
// obligatoria desde el 1-sep-2025), que reemplaza a la DGT-R-48-2016 de las versiones 4.2/4.3. Esa resolución no obliga a
// imprimir una leyenda fija y dejó suspendido el código QR en la representación gráfica hasta que la DGT lo informe, así que
// el QR no se imprime. La leyenda solo cita la resolución (no afirma una autorización que la resolución no da); si Hacienda pidiera
// otro texto, se cambia solo aquí.
export const RESOLUCION_VIGENTE = 'MH-DGT-RES-0027-2024';
const LEYENDA_RESOLUCION = 'Comprobante electrónico según la resolución ' + RESOLUCION_VIGENTE;

const TITULOS = { '01': 'FACTURA ELECTRÓNICA', '02': 'NOTA DE DÉBITO ELECTRÓNICA', '03': 'NOTA DE CRÉDITO ELECTRÓNICA', '04': 'TIQUETE ELECTRÓNICO' };
const NOMBRE_DOC = { '01': 'Factura electrónica', '02': 'Nota de débito electrónica', '03': 'Nota de crédito electrónica', '04': 'Tiquete electrónico' };

// Textos publicados en el sitio de Grupo DMA La Bomba (dmalabomba-sitio/index.html), reutilizados tal cual.
const CONTACTO = { correo: 'contacto@dmalabomba.com', instagram: '@sodaypolloslabomba' };
const MARCA = {
  soda: {
    web: 'www.sodalabomba.com', facebook: 'Soda La Bomba',
    historia: 'Soda La Bomba abrió el 30 de septiembre de 2012 con un solo local pequeño. A fuerza de trabajo y visión de familia fue creciendo, y hoy atiende las 24 horas con un equipo de más de 30 personas. Seguimos creciendo.',
    lema: 'Comida de soda, abierta las 24 horas.',
  },
  pollos: {
    web: 'www.polloslabomba.com', facebook: 'Pollos La Bomba y Papea',
    historia: null, // el sitio no tiene una historia propia de Pollos La Bomba: se usa solo su descripción
    lema: 'El mejor pollo al mejor precio, de la familia de Soda La Bomba.',
  },
};

const PROVINCIAS = { 1: 'San José', 2: 'Alajuela', 3: 'Cartago', 4: 'Heredia', 5: 'Guanacaste', 6: 'Puntarenas', 7: 'Limón' };
const DISTRITOS_SARAPIQUI = { 1: 'Puerto Viejo', 2: 'La Virgen', 3: 'Horquetas', 4: 'Llanuras del Gaspar', 5: 'Cureña' };

const AJUSTES_CLAVE = 'fx_impresion';
const DEFECTO = { papel: 80, copias: 1, auto: false, formato: 'tiquete', hoja: 'carta', modo: 'auto' };
// El tiquete se entrega en el mismo acto de la venta (Res. MH-DGT-RES-0027-2024, art. 5). Por eso, mientras el aparato no haya guardado
// su propia opción, la impresión automática viene encendida en computadora y tableta (pantalla de más de 700 px) y apagada en celular.
const esCelular = () => { try { return window.matchMedia('(max-width:700px)').matches; } catch { return false; } };
const CSS_URL = new URL('../css/imprimir.css', import.meta.url).href;
const FUENTES_URL = 'https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&display=swap';

// Cargar la hoja de estilos también en la página principal (ventana de ajustes y modo "pagina")
if (!document.querySelector('link[data-fx-imprimir]')) document.head.append(h('link', { rel: 'stylesheet', href: CSS_URL, 'data-fx-imprimir': '1' }));

/* ------------------------------------------------------------------ ajustes (por aparato, en localStorage) */

// Devuelve {papel: 58|80, copias, auto (imprimir al cobrar), formato ('tiquete'|'carta'), hoja ('carta'|'a4'), modo}
// Con alias autoImprimir = auto y formatoAuto = formato por comodidad de quien lo use.
export function leerAjustes() {
  let g = {};
  try { g = JSON.parse(localStorage.getItem(AJUSTES_CLAVE) || '{}') || {}; } catch { g = {}; }
  const a = { ...DEFECTO, auto: !esCelular(), ...g };
  a.papel = Number(a.papel) === 58 ? 58 : 80;
  a.copias = Math.min(5, Math.max(1, parseInt(a.copias, 10) || 1));
  a.auto = !!a.auto;
  a.formato = a.formato === 'carta' ? 'carta' : 'tiquete';
  a.hoja = a.hoja === 'a4' ? 'a4' : 'carta';
  a.modo = ['auto', 'iframe', 'pagina'].includes(a.modo) ? a.modo : 'auto';
  a.autoImprimir = a.auto;
  a.formatoAuto = a.formato;
  return a;
}
export function guardarAjustes(parcial) {
  // Se guarda solo lo que la persona escogió (no los valores por defecto), así la opción de impresión automática por tipo de pantalla sigue valiendo hasta que alguien la cambie.
  let g = {};
  try { g = JSON.parse(localStorage.getItem(AJUSTES_CLAVE) || '{}') || {}; } catch { g = {}; }
  const nuevo = { ...g, ...parcial };
  delete nuevo.autoImprimir; delete nuevo.formatoAuto;
  try { localStorage.setItem(AJUSTES_CLAVE, JSON.stringify(nuevo)); } catch { /* sin almacenamiento: se usan los valores por defecto */ }
  return leerAjustes();
}

/* ------------------------------------------------------------------ formato de datos */

const pad = (n) => String(n).padStart(2, '0');
const partir = (s, n) => String(s || '').match(new RegExp('.{1,' + n + '}', 'g')) || [];
const soloDig = (s) => String(s ?? '').replace(/\D/g, '');
const MINUS = new Set(['a', 'al', 'de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'en', 'con', 'por', 'para']);
const titulo = (s) => { // "CONTIGUO A SERVICENTRO GUTI" -> "Contiguo a Servicentro Guti"; si ya trae minúsculas se respeta
  s = String(s ?? '').trim();
  if (!s || s !== s.toUpperCase()) return s;
  return s.toLowerCase().split(/\s+/).map((w, i) => (i > 0 && MINUS.has(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
};
// Nombre comercial sin gritar: "POLLOS LA BOMBA" -> "Pollos La Bomba". Solo para mostrar; si ya trae minúsculas se respeta.
const SIN_MAYUS = new Set(['a', 'al', 'de', 'del', 'y', 'e', 'en', 'con', 'por', 'para']);
const nombreComercial = (s) => {
  s = String(s ?? '').trim();
  if (!s || s !== s.toUpperCase()) return s;
  return s.toLowerCase().split(/\s+/).map((w, i) => (i > 0 && SIN_MAYUS.has(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
};
function fmtCedula(ced, tipo) {
  const d = soloDig(ced);
  if (tipo === '02' && d.length === 10) return `${d[0]}-${d.slice(1, 4)}-${d.slice(4)}`;
  if ((tipo === '01' || !tipo) && d.length === 9) return `${d[0]}-${d.slice(1, 5)}-${d.slice(5)}`;
  return d || String(ced ?? '');
}
const fmtTel = (t) => { const d = soloDig(t); return d.length === 8 ? d.slice(0, 4) + '-' + d.slice(4) : String(t ?? ''); };
function direccion(x) {
  const prov = parseInt(x.provincia, 10), cant = parseInt(x.canton, 10), dist = parseInt(x.distrito, 10);
  const lugar = [];
  // Barrio, distrito, cantón y provincia: la norma pide la dirección completa con barrio (Reg. 13 inc. 2). Si el barrio y el distrito se llaman igual, sale una sola vez.
  if (x.barrio) lugar.push(titulo(x.barrio));
  if (prov === 4 && cant === 10) lugar.push(DISTRITOS_SARAPIQUI[dist] || '', 'Sarapiquí', 'Heredia');
  else if (PROVINCIAS[prov]) lugar.push(PROVINCIAS[prov]);
  const senas = titulo(x.otras_senas);
  // si las señas ya mencionan el lugar (p. ej. "Frente a Gasolinera JyJ Horquetas") no se repite, ni tampoco un nombre repetido
  const vistos = new Set();
  const resto = lugar.filter((l) => {
    const k = String(l || '').trim().toLowerCase();
    if (!k || vistos.has(k) || senas.toLowerCase().includes(k)) return false;
    vistos.add(k); return true;
  });
  return [senas, ...resto].filter(Boolean).join(', ');
}
const fechaLinea = (d) => d ? fechaCorta(d) + ' ' + horaCorta(d) : '';
const numCorto = (cons) => { const n = parseInt(String(cons || '').slice(-10), 10); return Number.isFinite(n) ? String(n) : ''; };

// Etiqueta impresa de una tarifa. Con 0 % hay varias cosas distintas, y por eso se separan por código.
function etiquetaIva(t, codigo) {
  if (t > 0) return 'IVA ' + num(t, 2) + '%';
  if (codigo === '01') return 'IVA 0% (no sujeto)';
  if (codigo === '11') return 'IVA 0% (sin derecho a crédito)';
  return 'Exento (IVA 0%)';
}
// Título que pide la norma para el monto de cada tarifa (Reg. 13 inc. 15): «Impuesto sobre el Valor Agregado» y la tarifa.
const etiquetaTarifa = (t, codigo) => (t > 0 ? 'Tarifa ' + num(t, 2) + '%' : codigo === '01' ? 'Tarifa 0% (no sujeto)' : codigo === '11' ? 'Tarifa 0% (sin derecho a crédito)' : 'Tarifa exenta (0%)');
const etiquetaLarga = (t, codigo) => 'Impuesto sobre el Valor Agregado ' + (t > 0 ? num(t, 2) + '%' : codigo === '01' ? '0% (no sujeto)' : codigo === '11' ? '0% (sin derecho a crédito)' : 'exento (0%)');
// IVA por tarifa. Los importes salen del precio final con IVA; si el comprobante trae el IVA oficial (total_iva),
// la diferencia de redondeo se absorbe en la tarifa mayor para que la suma cuadre al céntimo con el comprobante.
// Se agrupa por código de tarifa de Hacienda (no solo por porcentaje): "Exento" y "0 % no sujeto" salen en renglones separados.
function desgloseIva(lineas, ivaOficial) {
  const g = new Map();
  for (const l of lineas) {
    const tf = tarifaDeLinea(l);
    const clave = tf.codigo || String(tf.pct);
    const x = g.get(clave) || { t: tf.pct, codigo: tf.codigo, bruto: 0 };
    x.bruto = r2(x.bruto + (Number(l.total_linea) || 0));
    g.set(clave, x);
  }
  const filas = [...g.values()].map((x) => { const base = r2(x.bruto / (1 + x.t / 100)); return { t: x.t, codigo: x.codigo, etq: etiquetaIva(x.t, x.codigo), etqTarifa: etiquetaTarifa(x.t, x.codigo), etqLarga: etiquetaLarga(x.t, x.codigo), bruto: x.bruto, base, iva: r2(x.bruto - base) }; })
    .sort((a, b) => a.t - b.t || String(a.codigo).localeCompare(String(b.codigo)));
  if (ivaOficial != null && filas.length) {
    const dif = r2(ivaOficial - filas.reduce((a, f) => a + f.iva, 0));
    if (dif) { const f = filas.reduce((m, x) => (x.bruto > m.bruto ? x : m), filas[0]); f.iva = r2(f.iva + dif); f.base = r2(f.bruto - f.iva); }
  }
  return filas;
}
// Mercancías y servicios, gravados y exentos (Reg. 13 incs. 12 y 13), con la misma clasificación del XML: la base de cada línea es su total sin IVA.
// Solo salen los renglones con monto. Si alguna línea no dice si es servicio o mercancía (datos viejos), no se inventa: se devuelve null y solo se imprime el precio neto.
function desgloseTipo(lineas) {
  if (!lineas.length || lineas.some((l) => typeof l.es_servicio !== 'boolean')) return null;
  const t = { mg: 0, me: 0, mn: 0, sg: 0, se: 0, sn: 0 };
  for (const l of lineas) {
    const tf = tarifaDeLinea(l), bruto = Number(l.total_linea) || 0;
    const base = r2(bruto / (1 + (tf.pct || 0) / 100));
    const clase = tf.pct > 0 ? 'g' : (tf.codigo === '01' || tf.codigo === '11') ? 'n' : 'e';
    t[(l.es_servicio ? 's' : 'm') + clase] = r2(t[(l.es_servicio ? 's' : 'm') + clase] + base);
  }
  const nombres = [['mg', 'Mercancías gravadas'], ['me', 'Mercancías exentas'], ['mn', 'Mercancías no sujetas'], ['sg', 'Servicios gravados'], ['se', 'Servicios exentos'], ['sn', 'Servicios no sujetos']];
  return nombres.filter(([k]) => t[k] > 0).map(([k, etq]) => ({ etq, monto: t[k] }));
}
// Unidad de medida (Reg. 13 inc. 10). El XML usa la unidad de la línea y, si no trae, «Sp» para servicios y «Unid» para mercancías.
// En la impresión va en lenguaje llano: «Unidad» o «Servicio» (la comida preparada es servicio según el CABYS 6332; solo las bebidas embotelladas son mercancía),
// «Kg» tal cual y cualquier otro símbolo como viene. La descripción oficial de la unidad no se imprime (Anexos v4.4, nota 15 no la exige).
const UNIDAD_LLANA = { Unid: 'Unidad', Sp: 'Servicio', Spe: 'Servicio', Os: 'Servicio' };
const unidadDeLinea = (l) => { const u = String(l?.unidad ?? '').trim() || (l?.es_servicio ? 'Sp' : 'Unid'); return UNIDAD_LLANA[u] || u; };
// Código de referencia de una nota o de un reemplazo, con la descripción oficial (Anexos v4.4, nota 9)
const DESC_REF = { '01': 'Anula documento de referencia', '02': 'Corrige monto', '04': 'Referencia a otro documento', '06': 'Devolución de mercancía', '07': 'Sustituye comprobante electrónico' };
// Qué dice el bloque de referencia de una nota de crédito o de débito. Lo que sale de la base manda: codigo_nombre (descripción oficial) y nombre_simple («Devolución», «Corrección de monto», «Anulación total»...).
// Sin esas llaves queda como antes: una nota de crédito sin código se lee como anulación (código 01).
function referenciaNota(m) {
  const cod = m.codigoRef || '';
  const anula = m.tipo === '03' && (!cod || cod === '01' || cod === '13');
  const tipoNota = m.tipo === '02' ? 'Nota de débito' : 'Nota de crédito';
  return {
    anula, cod,
    // Frase corta para el tiquete y frase de carta
    tiquete: anula ? 'Anula el documento' : tipoNota + ' sobre el documento',
    carta: anula ? 'Esta nota de crédito anula: ' : tipoNota + ' sobre el documento: ',
    oficial: m.codigoNombre || DESC_REF[cod] || '',
    simple: anula ? '' : (m.nombreSimple || ''), // en una anulación total el encabezado ya lo dice
    sustituido: m.original?.codigo_referencia === '07' ? 'Ese documento había sustituido a otro que se anuló antes.' : '',
  };
}
// Lo que se entregó y el vuelto de un pago en efectivo. Una nota de crédito nunca muestra Recibido ni Vuelto (no se recibe dinero).
function pagoEfectivo(p) {
  const monto = Number(p.monto) || 0, rec = Number(p.recibido) || 0, vue = Number(p.vuelto) || 0;
  const vuelto = vue > 0 ? r2(vue) : rec > monto ? r2(rec - monto) : 0;
  return vuelto > 0 ? { recibido: rec >= monto + vuelto - 0.005 ? rec : r2(monto + vuelto), vuelto } : null;
}

// Utilidades de formato que también usa la pantalla de documentos
export { direccion as formatoDireccion, fmtCedula as formatoCedula, fmtTel as formatoTelefono, numCorto as numeroCorto, NOMBRE_DOC as NOMBRES_DOCUMENTO };

/* ------------------------------------------------------------------ modelo del documento (lo que se dibuja) */

function datosSoc(s = {}) {
  const codigo = s.codigo === 'pollos' ? 'pollos' : 'soda';
  return {
    codigo, comercial: nombreComercial(s.nombre_comercial || s.nombre || ''), razon: nombrePropio(s.nombre), cedula: fmtCedula(s.cedula, s.cedula_tipo || '02'),
    tel: fmtTel(s.telefono), dir: direccion(s), correo: s.correo || '', ambiente: s.ambiente,
  };
}
function datosCliente(c) {
  if (!c || !(c.nombre || c.identificacion)) return null;
  // Solo para mostrar: "CORPORACION DMA..." se imprime como nombre propio. El XML que va a Hacienda conserva el original.
  return { nombre: nombrePropio(c.nombre), comercial: nombrePropio(c.nombre_comercial), tipoId: TIPOS_ID[c.tipo_id] || '', ident: fmtCedula(c.identificacion, c.tipo_id), correo: c.correo || '', tel: fmtTel(c.telefono), dir: direccion(c) };
}

export function modeloComprobante(c) {
  const lineas = (c.lineas_snapshot || []).slice().sort((a, b) => (a.orden || 0) - (b.orden || 0));
  const total = Number(c.total) || 0, iva = Number(c.total_iva) || 0;
  return {
    clase: 'comprobante', tipo: c.tipo_doc, titulo: TITULOS[c.tipo_doc] || 'COMPROBANTE ELECTRÓNICO',
    soc: datosSoc({ ...(c.sociedad || {}), ambiente: c.ambiente || c.sociedad?.ambiente }), cliente: datosCliente(c.cliente_snapshot),
    lineas, total, iva, subtotal: r2(total - iva), desglose: desgloseIva(lineas, iva),
    pagos: c.pagos_snapshot || [], consecutivo: c.consecutivo || '', clave: c.clave || '', fecha: c.fecha_emision, estado: c.estado,
    sandbox: (c.ambiente || c.sociedad?.ambiente) !== 'produccion', motivo: c.motivo || '',
    original: c.original || null, venta: c.venta || null,
    tipos: desgloseTipo(lineas),
    // Código de referencia (solo si la base ya lo devuelve; si no, la impresión queda como estaba). En una nota sin código guardado el único que se emite hoy es el 01.
    codigoRef: 'codigo_referencia' in c ? (c.codigo_referencia || (c.tipo_doc === '03' ? '01' : '')) : null,
    codigoNombre: c.codigo_nombre || '', nombreSimple: c.nombre_simple || '',
    // Documento al que sustituye (código 07): la base ya trae el objeto `reemplaza` {id, tipo_doc, consecutivo, clave, fecha_emision}; si solo viene reemplaza_a, se usa el número buscado aparte (reemplazado)
    reemplaza: c.reemplaza && typeof c.reemplaza === 'object' ? { ...c.reemplaza } : c.reemplaza_a ? { id: c.reemplaza_a, ...(c.reemplazado || {}) } : null,
  };
}
export function modeloPrefactura(r, soc) {
  const lineas = (r.lineas || []).slice().sort((a, b) => (a.orden || 0) - (b.orden || 0));
  const v = r.venta || {};
  const total = Number(v.total) || lineas.reduce((a, l) => a + (Number(l.total_linea) || 0), 0);
  const desglose = desgloseIva(lineas, null);
  const iva = r2(desglose.reduce((a, f) => a + f.iva, 0));
  return {
    clase: 'prefactura', tipo: 'PRE', titulo: 'PREFACTURA', soc: datosSoc(soc), cliente: datosCliente(r.cliente),
    lineas, total, iva, subtotal: r2(total - iva), desglose, pagos: [], consecutivo: '', clave: '', fecha: v.prefacturada_en || new Date().toISOString(),
    estado: null, sandbox: false, motivo: '', original: null, venta: { numero: v.numero, tipo_servicio: v.tipo_servicio, referencia: v.referencia, prefactura_numero: v.prefactura_numero, prefactura_revision: v.prefactura_revision },
  };
}

/* ------------------------------------------------------------------ logos */

const logos = new Map();
function logoDataUri(codigo) {
  const k = codigo === 'pollos' ? 'pollos' : 'soda';
  if (!logos.has(k)) {
    logos.set(k, (async () => {
      try {
        const r = await fetch(new URL(`../img/logo-${k}.svg`, import.meta.url));
        if (!r.ok) throw new Error('sin logo');
        return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(await r.text());
      } catch { return null; }
    })());
  }
  return logos.get(k);
}

/* ------------------------------------------------------------------ dibujo: tiquete térmico */

const linea = (clase = '') => h('div.hr' + (clase ? '.' + clase : ''));
const fila = (a, b, clase = '') => h('div.fila-tq' + (clase ? '.' + clase : ''), h('span', a), h('span.v', b));

function marcaPrueba() {
  return h('div.prueba', h('b', 'COMPROBANTE DE PRUEBA'), h('b', 'SIN VALIDEZ'));
}

function estadoImpreso(m) {
  if (m.clase === 'prefactura' || !m.estado) return null;
  if (m.estado === 'aceptado') return h('div.estado', 'Estado: aceptado por Hacienda');
  if (m.estado === 'rechazado') return h('div.estado.mal', h('b', 'RECHAZADO POR HACIENDA'), h('span', 'Este documento no es válido'));
  return h('div.estado.pend', h('b', 'Pendiente de validación'), h('span', 'Hacienda aún no confirma este comprobante'));
}

// Rótulo de los pagos: en la anulación total (código 01) son los del documento original; en una devolución o corrección de monto son
// el dinero de ESA nota, y en una nota de débito es lo que se paga de diferencia.
const etiquetaPagos = (m) => (m.tipo === '03' ? ((m.codigoRef || '01') === '01' ? 'Pagos del documento original' : 'Cómo se devuelve el dinero') : m.tipo === '02' ? 'Cómo se paga la diferencia' : 'Pagos');

function nodoTiquete(m, { papel, logo, copia }) {
  const pre = m.clase === 'prefactura';
  const nc = m.tipo === '03';
  const nota = nc || m.tipo === '02'; // las notas (de crédito y de débito) llevan la referencia al documento original
  const raiz = h('div.fxd.tq' + (papel === 58 ? '.p58' : ''));
  if (m.sandbox && !pre) raiz.append(marcaPrueba());
  if (logo) raiz.append(h('img.logo', { src: logo, alt: m.soc.comercial }));
  raiz.append(h('div.nombre', m.soc.comercial));
  if (m.soc.razon && m.soc.razon.toUpperCase() !== m.soc.comercial.toUpperCase()) raiz.append(h('div.razon', m.soc.razon));
  raiz.append(h('div.dato', 'Cédula jurídica ' + m.soc.cedula));
  if (m.soc.tel) raiz.append(h('div.dato', 'Tel. ' + m.soc.tel));
  if (m.soc.dir) raiz.append(h('div.dato', m.soc.dir));
  if (m.soc.correo) raiz.append(h('div.dato', m.soc.correo));
  raiz.append(linea());
  raiz.append(h('div.titulo', m.titulo));
  if (pre) {
    raiz.append(h('div.aviso-pre', 'NO ES UN COMPROBANTE ELECTRÓNICO.', h('br'), 'NO VÁLIDA COMO FACTURA'));
    raiz.append(h('div.dato', 'Cuenta para revisar con el cliente'));
  } else {
    // Tipo de documento (el título), consecutivo y clave juntos (Anexos v4.4, nota 1)
    raiz.append(h('div.etq-chica', 'Consecutivo'), h('div.mono', m.consecutivo));
    raiz.append(h('div.etq-chica', 'Clave numérica'), ...partir(m.clave, 25).map((p) => h('div.mono', p)));
  }
  raiz.append(fila('Fecha', fechaLinea(m.fecha)));
  if (m.venta?.numero) raiz.append(fila(pre ? 'Cuenta' : 'Venta', m.venta.numero));
  if (m.venta?.prefactura_numero && pre) raiz.append(fila('Prefactura N.°', m.venta.prefactura_numero));
  if (pre && Number(m.venta?.prefactura_revision) > 1) raiz.append(fila('Revisión', String(Number(m.venta.prefactura_revision))));
  if (m.venta?.tipo_servicio) raiz.append(fila('Servicio', TIPOS_SERVICIO[m.venta.tipo_servicio] || m.venta.tipo_servicio));
  if (m.venta?.referencia) raiz.append(fila('Referencia', m.venta.referencia));
  if (!pre) raiz.append(fila('Condición de venta', 'Contado'), fila('Moneda', 'Colón (CRC)'));
  if (nota && m.original) {
    const rf = referenciaNota(m);
    raiz.append(linea());
    raiz.append(h('div.etq-chica', rf.tiquete), h('div.dato', (NOMBRE_DOC[m.original.tipo_doc] || 'Comprobante') + ' N.° ' + numCorto(m.original.consecutivo)), h('div.mono', m.original.consecutivo));
    if (rf.simple) raiz.append(h('div.dato', 'Tipo: ' + rf.simple));
    if (m.codigoRef && rf.oficial) raiz.append(h('div.dato', 'Código de referencia ' + m.codigoRef + ': ' + rf.oficial));
    if (rf.sustituido) raiz.append(h('div.dato', rf.sustituido));
    if (m.motivo) raiz.append(h('div.dato', 'Motivo: ' + m.motivo));
  } else if (!pre && !nota && (m.reemplaza || m.codigoRef === '07')) {
    // Venta hecha de nuevo después de una anulación: dice cuál documento sustituye (código 07)
    raiz.append(linea());
    raiz.append(h('div.etq-chica', 'Sustituye al documento'));
    if (m.reemplaza?.consecutivo) raiz.append(h('div.dato', (NOMBRE_DOC[m.reemplaza.tipo_doc] || 'Comprobante') + ' N.° ' + numCorto(m.reemplaza.consecutivo)), h('div.mono', m.reemplaza.consecutivo));
    raiz.append(h('div.dato', 'Código de referencia 07: ' + DESC_REF['07']));
  }
  if (m.cliente) {
    raiz.append(linea());
    raiz.append(h('div.etq-chica', 'Cliente'), h('div.cli', m.cliente.nombre));
    if (m.cliente.ident) raiz.append(h('div.dato.izq', (m.cliente.tipoId ? m.cliente.tipoId + ' ' : 'Identificación ') + m.cliente.ident));
    if (m.cliente.correo) raiz.append(h('div.dato.izq', m.cliente.correo));
  }
  raiz.append(linea('doble'));
  raiz.append(h('div.fila-tq.enc', h('span', 'Cant. x Precio con IVA'), h('span.v', 'Total')));
  for (const l of m.lineas) {
    raiz.append(h('div.lin',
      h('div.d', l.descripcion || ''),
      h('div.q', h('span', pre ? `${num(l.cantidad)} x ${money(l.precio_final)}` : `${num(l.cantidad)} ${unidadDeLinea(l)} x ${money(l.precio_final)}`), h('b', money(l.total_linea))),
      tarifaDeLinea(l).pct !== 13 ? h('div.iva-lin', etiquetaIva(tarifaDeLinea(l).pct, tarifaDeLinea(l).codigo)) : null,
      l.nota ? h('div.nota', l.nota) : null));
  }
  raiz.append(linea('doble'));
  if (pre) raiz.append(fila('Subtotal sin IVA', money(m.subtotal)));
  else {
    // Mercancías y servicios, gravados y exentos; después el precio neto de venta (no hay descuentos, así que es la suma de lo anterior)
    for (const t of m.tipos || []) raiz.append(fila(t.etq, money(t.monto)));
    raiz.append(fila('Precio neto de venta (sin IVA)', money(m.subtotal)));
  }
  // Monto del impuesto de cada tarifa, con la indicación que pide la norma
  if (m.desglose.length) raiz.append(h('div.etq-chica', 'Impuesto sobre el Valor Agregado'));
  for (const f of m.desglose) raiz.append(fila(pre ? f.etq : f.etqTarifa, money(f.iva)));
  raiz.append(h('div.fila-tq.total', h('span', nc ? 'TOTAL ACREDITADO' : 'TOTAL'), h('span.v', money(m.total))));
  if (m.pagos.length) {
    raiz.append(linea());
    raiz.append(h('div.etq-chica', etiquetaPagos(m)));
    for (const p of m.pagos) {
      raiz.append(fila(MEDIOS[p.medio] || p.medio, money(p.monto)));
      if (p.referencia) raiz.append(h('div.dato.izq', 'Ref. ' + p.referencia));
      const ef = nc ? null : pagoEfectivo(p);
      if (ef) { raiz.append(fila('Recibido', money(ef.recibido))); raiz.append(fila('Vuelto', money(ef.vuelto), 'negrita')); }
    }
  }
  if (!pre) {
    raiz.append(linea());
    const st = estadoImpreso(m); if (st) raiz.append(st);
    raiz.append(h('div.pie', LEYENDA_RESOLUCION));
  } else {
    raiz.append(linea());
    raiz.append(h('div.aviso-pre.chico', 'NO ES UN COMPROBANTE ELECTRÓNICO.', h('br'), 'NO VÁLIDA COMO FACTURA'));
    raiz.append(h('div.pie', 'Pida su factura o tiquete electrónico al pagar'));
  }
  if (m.sandbox && !pre) raiz.append(marcaPrueba());
  if (copia) raiz.append(h('div.pie.copia', copia));
  raiz.append(h('div.avance'));
  return raiz;
}

/* ------------------------------------------------------------------ dibujo: factura carta */

function nodoCarta(m, { logo, copia }) {
  const nc = m.tipo === '03';
  const nota = nc || m.tipo === '02'; // las notas (de crédito y de débito) llevan la referencia al documento original
  const marca = MARCA[m.soc.codigo] || MARCA.soda;
  const raiz = h('div.fxd.ct');
  if (m.sandbox) raiz.append(h('div.marca-agua', 'PRUEBA'));

  // Encabezado
  raiz.append(h('div.ct-cab',
    h('div.ct-marca', logo ? h('img.ct-logo', { src: logo, alt: m.soc.comercial }) : h('div.ct-nombre-grande', m.soc.comercial)),
    h('div.ct-titulo',
      h('div.ct-tit', m.titulo),
      h('div.ct-num', 'N.° ' + numCorto(m.consecutivo)),
      // Tipo de documento (arriba), consecutivo y clave juntos (Anexos v4.4, nota 1)
      h('div.ct-clave-enc', h('div', h('span.ct-etq', 'Consecutivo'), ' ', h('span.mono', m.consecutivo)), h('div', h('span.ct-etq', 'Clave numérica'), ' ', h('span.mono', m.clave))),
      h('div.ct-fecha', fechaLinea(m.fecha)),
      m.sandbox ? h('div.ct-prueba', 'COMPROBANTE DE PRUEBA SIN VALIDEZ') : null)));
  raiz.append(h('div.ct-regla', h('i')));

  // Emisor y cliente
  const emisor = h('div.ct-caja',
    h('div.ct-etq', 'Emisor'),
    h('div.ct-fuerte', m.soc.comercial),
    m.soc.razon && m.soc.razon.toUpperCase() !== m.soc.comercial.toUpperCase() ? h('div', m.soc.razon) : null,
    h('div', 'Cédula jurídica ' + m.soc.cedula),
    m.soc.tel ? h('div', 'Teléfono ' + m.soc.tel) : null,
    m.soc.correo ? h('div', m.soc.correo) : null,
    m.soc.dir ? h('div', m.soc.dir) : null);
  const c = m.cliente;
  const cliente = h('div.ct-caja',
    h('div.ct-etq', 'Cliente'),
    c ? h('div.ct-fuerte', c.nombre) : h('div.ct-fuerte', 'Consumidor final'),
    c?.comercial ? h('div', c.comercial) : null,
    c?.ident ? h('div', (c.tipoId || 'Identificación') + ' ' + c.ident) : null,
    c?.correo ? h('div', c.correo) : null,
    c?.tel ? h('div', 'Teléfono ' + c.tel) : null,
    c?.dir ? h('div', c.dir) : null,
    !c ? h('div.ct-tenue', 'Sin datos del cliente') : null);
  raiz.append(h('div.ct-dos', emisor, cliente));

  // Datos de la venta
  const meta = [['Condición de venta', 'Contado'], ['Moneda', 'Colón costarricense (CRC)']];
  if (m.venta?.numero) meta.unshift(['Venta', m.venta.numero]);
  if (m.venta?.tipo_servicio) meta.push(['Servicio', TIPOS_SERVICIO[m.venta.tipo_servicio] || m.venta.tipo_servicio]);
  if (m.venta?.referencia) meta.push(['Referencia', m.venta.referencia]);
  raiz.append(h('div.ct-meta', meta.map(([a, b]) => h('div', h('span.ct-etq', a), h('b', b)))));

  if (nota && m.original) {
    const rf = referenciaNota(m);
    raiz.append(h('div.ct-ref',
      h('div', h('b', rf.carta), (NOMBRE_DOC[m.original.tipo_doc] || 'Comprobante') + ' N.° ' + numCorto(m.original.consecutivo)),
      h('div.mono', m.original.consecutivo),
      rf.simple ? h('div', h('b', 'Tipo: '), rf.simple) : null,
      m.codigoRef && rf.oficial ? h('div', h('b', 'Código de referencia: '), m.codigoRef + ', ' + rf.oficial) : null,
      rf.sustituido ? h('div', rf.sustituido) : null,
      m.motivo ? h('div', h('b', 'Motivo: '), m.motivo) : null));
  } else if (!nota && (m.reemplaza || m.codigoRef === '07')) {
    raiz.append(h('div.ct-ref',
      h('div', h('b', 'Este documento sustituye a: '), m.reemplaza?.consecutivo ? (NOMBRE_DOC[m.reemplaza.tipo_doc] || 'Comprobante') + ' N.° ' + numCorto(m.reemplaza.consecutivo) : 'un documento anulado'),
      m.reemplaza?.consecutivo ? h('div.mono', m.reemplaza.consecutivo) : null,
      h('div', h('b', 'Código de referencia: '), '07, ' + (m.codigoNombre || DESC_REF['07']))));
  }

  // Líneas
  raiz.append(h('table.ct-tabla',
    h('thead', h('tr', h('th', 'CABYS'), h('th', 'Descripción'), h('th', 'Unidad'), h('th.der', 'Cant.'), h('th.der', 'Precio unit.'), h('th.der', 'IVA'), h('th.der', 'Total'))),
    h('tbody', m.lineas.map((l) => h('tr',
      h('td.cod', l.cabys || ''),
      h('td', h('div', l.descripcion || ''), l.nota ? h('div.ct-tenue', l.nota) : null),
      h('td.uni', unidadDeLinea(l)),
      h('td.der', num(l.cantidad)),
      h('td.der', money(l.precio_final)),
      h('td.der', (tarifaDeLinea(l).pct ? num(tarifaDeLinea(l).pct, 2) + '%' : tarifaDeLinea(l).codigo === '10' || !tarifaDeLinea(l).codigo ? 'Exento' : '0%')),
      h('td.der', money(l.total_linea)))))));
  raiz.append(h('div.ct-nota-precio', 'Los precios unitarios y los totales de cada línea incluyen el IVA.'));

  // Pagos y totales
  const pagos = h('div.ct-pagos', h('div.ct-etq', etiquetaPagos(m)));
  if (m.pagos.length) {
    for (const p of m.pagos) {
      pagos.append(h('div.ct-fila', h('span', (MEDIOS[p.medio] || p.medio) + (p.referencia ? ' (ref. ' + p.referencia + ')' : '')), h('span.v', money(p.monto))));
      const ef = nc ? null : pagoEfectivo(p);
      if (ef) { pagos.append(h('div.ct-fila', h('span', 'Recibido'), h('span.v', money(ef.recibido))), h('div.ct-fila', h('span', 'Vuelto'), h('span.v', money(ef.vuelto)))); }
    }
  } else pagos.append(h('div.ct-tenue', 'Sin pagos registrados'));
  const tot = h('div.ct-totales',
    (m.tipos || []).map((t) => h('div.ct-fila', h('span', t.etq), h('span.v', money(t.monto)))),
    h('div.ct-fila.neto', h('span', 'Precio neto de venta (sin IVA)'), h('span.v', money(m.subtotal))),
    m.desglose.map((f) => h('div.ct-fila', h('span', f.etqLarga), h('span.v', money(f.iva)))),
    h('div.ct-fila.gran', h('span', nc ? 'Total acreditado' : 'Total'), h('span.v', money(m.total))));
  raiz.append(h('div.ct-cierre', pagos, tot));

  // Estado de validación (el consecutivo y la clave van arriba, junto al tipo de documento)
  const st = m.estado;
  const txtSt = st === 'aceptado' ? 'Aceptado por Hacienda' : st === 'rechazado' ? 'RECHAZADO POR HACIENDA. Este documento no es válido.' : 'Pendiente de validación: Hacienda aún no confirma este comprobante.';
  raiz.append(h('div.ct-clave', h('div.ct-estado.' + (st === 'aceptado' ? 'ok' : st === 'rechazado' ? 'mal' : 'pend'), txtSt)));

  // Pie con quiénes somos
  const pieIzq = h('div.ct-quienes',
    h('div.ct-etq', marca.historia ? 'Quiénes somos' : m.soc.comercial),
    h('p', marca.historia || marca.lema),
    marca.historia ? null : h('p.ct-tenue', 'Grupo DMA La Bomba, empresa familiar de la Ruta 4, Horquetas de Sarapiquí.'));
  const pieDer = h('div.ct-contacto',
    h('div.ct-etq', 'Contáctenos'),
    h('div', CONTACTO.correo),
    h('div', marca.web),
    h('div', 'Instagram ' + CONTACTO.instagram),
    h('div', 'Facebook ' + marca.facebook));
  raiz.append(h('div.ct-pie', pieIzq, pieDer));
  raiz.append(h('div.ct-ley', LEYENDA_RESOLUCION + '. Gracias por preferirnos.', copia ? h('span', ' ' + copia) : null));
  return raiz;
}

/* ------------------------------------------------------------------ dibujo: tiquete de prueba */

function nodoPrueba(papel, logo) {
  const util = papel === 58 ? 48 : 72;
  const raiz = h('div.fxd.tq' + (papel === 58 ? '.p58' : ''));
  if (logo) raiz.append(h('img.logo', { src: logo, alt: '' }));
  raiz.append(h('div.titulo', 'TIQUETE DE PRUEBA'), h('div.dato', 'Calibración de la impresora'));
  raiz.append(h('div.dato', `Papel de ${papel} mm, área útil ${util} mm`), h('div.dato', fechaLinea(new Date().toISOString())));
  raiz.append(linea('doble'));

  raiz.append(h('div.etq-chica', `Regla de ${util} mm (cada marca grande es 1 cm)`));
  const nums = h('div.regla-nums');
  for (let i = 0; i < Math.ceil(util / 10); i++) nums.append(h('span', String(i)));
  raiz.append(h('div.regla', h('i')), nums);
  raiz.append(h('div.dato.izq', 'Mida con una regla: la distancia entre la marca 0 y el borde derecho debe ser de ' + util + ' mm. Si sale más corta o más larga, ponga la escala en 100% en las preferencias de la impresora.'));

  raiz.append(h('div.etq-chica', 'Caja de ' + util + ' mm de ancho'));
  raiz.append(h('div.caja-prueba', 'Si ve las 4 esquinas completas, no se está cortando nada'));
  raiz.append(h('div.etq-chica', 'Línea de borde a borde'));
  raiz.append(h('div.borde-borde', h('i'), h('i')));
  raiz.append(linea());

  raiz.append(h('div.etq-chica', 'Tamaños de letra'));
  for (const px of [9, 10, 11, 12, 14, 16, 20]) raiz.append(h('div', { style: `font-size:${px}px;line-height:1.25` }, `${px} px: La Bomba 0123456789`));
  raiz.append(h('div', { style: 'font-weight:700;font-size:13px' }, 'Negrita: TOTAL ₡12 345,00'));
  raiz.append(h('div.mono', '00100001040000000001'));
  raiz.append(...partir('0'.repeat(50), 25).map((p) => h('div.mono', p))); // ceros: un papel de prueba no debe parecer un comprobante real
  raiz.append(linea());
  raiz.append(h('div.etq-chica', 'Tildes y eñes'));
  raiz.append(h('div', 'áéíóúü ÁÉÍÓÚÜ ñ Ñ ¡Hola! ¿Qué tal?'));
  raiz.append(h('div', 'Piña, café, jalapeño, ración, ₡ colones'));
  raiz.append(h('div', 'Pollo frito: 2 x ₡2 250,00 = ₡4 500,00'));
  raiz.append(linea('doble'));
  raiz.append(h('div.pie', 'Si todo se lee bien y nada se corta, la impresora quedó lista.'));
  raiz.append(h('div.avance'));
  return raiz;
}

/* ------------------------------------------------------------------ motor de impresión */

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const esIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const mmAPx = (mm) => Math.round(mm * 96 / 25.4);

async function esperarRecursos(doc, raiz) {
  const imgs = [...raiz.querySelectorAll('img')];
  await Promise.race([
    Promise.all(imgs.map((i) => (i.complete && i.naturalWidth) ? null : (i.decode ? i.decode().catch(() => {}) : new Promise((r) => { i.onload = i.onerror = r; })))),
    esperar(4000)]);
  void raiz.offsetHeight; // fuerza el cálculo de estilos para que se pidan las fuentes
  if (doc.fonts?.ready) await Promise.race([doc.fonts.ready, esperar(2500)]);
}

// Tamaño de página: tiquete = ancho del rollo x alto exacto del contenido; carta = hoja completa con márgenes
function cssPagina({ tipo, papel, hoja, altoMm }) {
  if (tipo === 'tiquete') return `@page{size:${papel}mm ${altoMm}mm;margin:0}`;
  return `@page{size:${hoja === 'a4' ? 'A4' : 'letter'};margin:10mm 14mm 11mm}`;
}

/**
 * Imprime los nodos (una copia por nodo). tipo: 'tiquete' | 'carta'.
 * Devuelve cuando el navegador terminó de mostrar la ventana de impresión (o cuando la envió a la impresora).
 */
async function imprimirNodos(nodos, { tipo, papel, hoja, titulo: tit, fuentes = false }) {
  const aj = leerAjustes();
  const modo = aj.modo === 'iframe' ? 'iframe' : (aj.modo === 'pagina' || esIOS()) ? 'pagina' : 'iframe';
  const ancho = tipo === 'tiquete' ? papel : 216;
  let doc, raiz, ventana, limpiar, estiloPagina = null;

  if (modo === 'iframe') {
    const f = h('iframe', { title: 'Documento para imprimir', 'aria-hidden': 'true', tabindex: '-1',
      style: `position:fixed;left:-10000px;top:0;width:${mmAPx(ancho)}px;height:800px;border:0;opacity:0;pointer-events:none` });
    f.srcdoc = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(tit)}</title>`
      + `<style>html,body{margin:0;padding:0;background:#fff;color:#000;-webkit-print-color-adjust:exact;print-color-adjust:exact}</style>`
      + `<link rel="stylesheet" href="${esc(CSS_URL)}">${fuentes ? `<link rel="stylesheet" href="${esc(FUENTES_URL)}">` : ''}</head><body></body></html>`;
    const cargado = new Promise((ok) => f.addEventListener('load', ok, { once: true }));
    document.body.append(f);
    await Promise.race([cargado, esperar(8000)]);
    doc = f.contentDocument; ventana = f.contentWindow;
    if (!doc || !doc.body) { f.remove(); throw new Error('No se pudo preparar el documento para imprimir.'); }
    raiz = doc.body;
    limpiar = () => f.remove();
  } else {
    // Modo "pagina": el mismo contenido en el documento principal; una regla @media print oculta lo demás.
    document.getElementById('fx-impresion')?.remove();
    document.getElementById('fx-impresion-estilo')?.remove();
    const caja = h('div#fx-impresion');
    caja.style.width = ancho + 'mm';
    document.body.append(caja);
    doc = document; ventana = window; raiz = caja;
    // Cada impresión limpia solo lo suyo: si se pide otra enseguida, el aviso tardío de la primera no le quita el estilo a la segunda
    limpiar = () => { caja.remove(); estiloPagina?.remove(); if (!document.getElementById('fx-impresion')) document.body.classList.remove('fx-imprimiendo'); };
  }

  try {
    for (const n of nodos) raiz.append(n);
    await esperarRecursos(doc, raiz);

    let altoMm = 0;
    if (tipo === 'tiquete') {
      const alto = Math.max(...[...raiz.querySelectorAll('.fxd')].map((e) => e.getBoundingClientRect().height));
      altoMm = Math.ceil(alto * 25.4 / 96) + 2; // 2 mm de holgura para que nunca se parta en dos páginas
    }
    const estilo = (modo === 'iframe' ? doc.createElement('style') : h('style#fx-impresion-estilo'));
    estilo.textContent = cssPagina({ tipo, papel, hoja, altoMm });
    (modo === 'iframe' ? doc.head : document.head).append(estilo);
    if (modo === 'pagina') estiloPagina = estilo;
    if (modo === 'pagina') document.body.classList.add('fx-imprimiendo');

    await new Promise((fin) => {
      let hecho = false;
      const cierre = () => { if (hecho) return; hecho = true; setTimeout(() => { try { limpiar(); } catch { /* ya no está */ } fin(); }, 300); };
      ventana.addEventListener('afterprint', cierre, { once: true });
      setTimeout(cierre, 120000); // por si el navegador nunca avisa
      try { ventana.focus(); ventana.print(); }
      catch (e) { hecho = true; try { limpiar(); } catch { /* nada */ } throw e; }
      // Chrome de escritorio bloquea en print() hasta cerrar la ventana; los demás vuelven enseguida y esperan afterprint.
      if (modo === 'iframe' && !('onafterprint' in ventana)) cierre();
    });
  } catch (e) {
    try { limpiar(); } catch { /* nada */ }
    throw e;
  }
}

function copiaTxt(i, n) { return n > 1 ? `Copia ${i} de ${n}` : null; }

/* ------------------------------------------------------------------ funciones públicas */

export async function imprimirComprobante(comprobanteId, { formato, copias } = {}) {
  const aj = leerAjustes();
  formato = formato === 'carta' ? 'carta' : formato === 'tiquete' ? 'tiquete' : aj.formato;
  copias = Math.min(5, Math.max(1, parseInt(copias, 10) || aj.copias));
  let c = await api.comprobante(comprobanteId);
  if (!c) throw new Error('No se encontró el comprobante.');
  // Una venta hecha de nuevo después de anular dice cuál documento sustituye: se busca su número (si no se puede leer, se imprime sin él)
  if (c.reemplaza_a && !c.reemplaza?.consecutivo) { try { const o = await api.comprobante(c.reemplaza_a); if (o) c = { ...c, reemplazado: { tipo_doc: o.tipo_doc, consecutivo: o.consecutivo } }; } catch { /* se imprime sin el número */ } }
  const m = modeloComprobante(c);
  const logo = await logoDataUri(m.soc.codigo);
  const nodos = [];
  for (let i = 1; i <= copias; i++) nodos.push(formato === 'carta' ? nodoCarta(m, { logo, copia: copiaTxt(i, copias) }) : nodoTiquete(m, { papel: aj.papel, logo, copia: copiaTxt(i, copias) }));
  const nombre = `${NOMBRE_DOC[m.tipo] || 'Comprobante'} ${m.consecutivo}`;
  await imprimirNodos(nodos, { tipo: formato, papel: aj.papel, hoja: aj.hoja, titulo: nombre, fuentes: formato === 'carta' });
}

// Para reimprimir un comprobante ya emitido: pregunta si se quiere el tiquete de rollo o la factura carta y lo imprime.
// Lo pueden usar otras pantallas (Documentos del día, Anular factura) en lugar de tener botones sueltos.
export function reimprimirComprobante(comprobanteId, { copias } = {}) {
  const aj = leerAjustes();
  const estado = h('p.tenue-linea', { role: 'status' });
  let m = null;
  const lanzar = (formato, btn) => conBoton(btn, async () => {
    estado.textContent = '';
    try { await imprimirComprobante(comprobanteId, { formato, copias }); m?.cerrar(); }
    catch (e) { estado.textContent = 'No se pudo imprimir: ' + textoDeError(e) + ' Revise el botón «Impresora» e intente de nuevo.'; }
  });
  const b1 = h('button.btn.primario.grande', { type: 'button', onclick: () => lanzar('tiquete', b1) }, 'Tiquete (rollo de ' + aj.papel + ' mm)');
  const b2 = h('button.btn.grande', { type: 'button', onclick: () => lanzar('carta', b2) }, 'Factura carta (' + (aj.hoja === 'a4' ? 'hoja grande A4' : 'hoja carta') + ')');
  m = modal({ titulo: 'Imprimir otra vez', ancho: 460, contenido: h('div.col', h('p', '¿Cómo quiere imprimirlo?'), b1, b2, estado) });
  return m;
}

async function sociedadDeVenta(venta) {
  const w = window.fx?.soc;
  if (w && w.id === venta.sociedad_id) return w;
  const ctx = window.fx?.ctx || await api.contexto();
  return (ctx.sociedades || []).find((s) => s.id === venta.sociedad_id) || w || {};
}

export async function imprimirPrefactura(ventaId) {
  const aj = leerAjustes();
  const r = await api.venta(ventaId);
  if (!r?.venta) throw new Error('No se encontró la cuenta.');
  const m = modeloPrefactura(r, await sociedadDeVenta(r.venta));
  const logo = await logoDataUri(m.soc.codigo);
  const nodos = [nodoTiquete(m, { papel: aj.papel, logo })];
  await imprimirNodos(nodos, { tipo: 'tiquete', papel: aj.papel, hoja: aj.hoja, titulo: 'Prefactura ' + (r.venta.numero || '') });
}

export async function imprimirPrueba() {
  const aj = leerAjustes();
  const soc = window.fx?.soc;
  const logo = await logoDataUri(soc?.codigo);
  await imprimirNodos([nodoPrueba(aj.papel, logo)], { tipo: 'tiquete', papel: aj.papel, hoja: aj.hoja, titulo: 'Tiquete de prueba' });
}

/* ------------------------------------------------------------------ ventana de ajustes */

function seg(opciones, valor, alCambiar, etiqueta) {
  const caja = h('div.fx-seg', { role: 'group', 'aria-label': etiqueta });
  const pintar = (v) => caja.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === String(v))));
  for (const [v, txt] of opciones) caja.append(h('button', { type: 'button', 'data-v': String(v), onclick: () => { pintar(v); alCambiar(v); } }, txt));
  pintar(valor);
  return caja;
}

function comandoChrome() {
  const url = new URL('../', import.meta.url).href;
  return `"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --kiosk-printing --user-data-dir="C:\\FacturadorLaBomba" --app=${url}`;
}

export function abrirAjustesImpresion() {
  let aj = leerAjustes();
  const guardado = h('small.fx-guardado', 'Los cambios se guardan solos en este aparato.');
  // Frase que dice, en palabras, qué pasa en ESTE aparato al terminar un cobro (se actualiza al cambiar la opción)
  const estadoAuto = h('div.fx-estado', { role: 'status' });
  const pintarEstadoAuto = () => {
    estadoAuto.className = 'fx-estado ' + (aj.auto ? 'si' : 'no');
    estadoAuto.textContent = aj.auto
      ? 'En este aparato: ENCENDIDA. Al terminar cada cobro sale ' + (aj.formato === 'carta' ? 'la factura carta' : 'el tiquete') + ' solo.'
      : 'En este aparato: APAGADA. Al terminar el cobro no sale nada solo; aparece el botón «Imprimir tiquete» para tocarlo y entregarle el tiquete al cliente.';
  };
  const cambiar = (k, v) => { aj = guardarAjustes({ [k]: v }); guardado.textContent = 'Guardado.'; pintarEstadoAuto(); };
  const grupo = (tit, ayuda, ...ctl) => h('div.fx-grupo', h('div.fx-tit', tit), ayuda ? h('div.fx-ayuda', ayuda) : null, ...ctl);

  const cmd = comandoChrome();
  const copiar = (btn) => conBoton(btn, async () => {
    try { await navigator.clipboard.writeText(cmd); toast('Texto copiado. Ya lo puede pegar.'); }
    catch { toast('No se pudo copiar solo. Selecciónelo con el dedo o el mouse y cópielo.', 'error'); }
  });
  const probar = h('button.btn.primario', { type: 'button', onclick: () => conBoton(probar, () => imprimirPrueba()) }, 'Imprimir tiquete de prueba');

  const contenido = h('div.fx-aj',
    grupo('Ancho del papel', 'Mire el rollo de la impresora de tiquetes: casi siempre es de 80 mm.',
      seg([[80, 'Papel de 80 mm'], [58, 'Papel de 58 mm']], aj.papel, (v) => cambiar('papel', Number(v)), 'Ancho del papel')),
    grupo('Copias de cada tiquete', 'Cuántas copias salen cada vez que se imprime.',
      seg([[1, '1 copia'], [2, '2 copias'], [3, '3 copias']], aj.copias, (v) => cambiar('copias', Number(v)), 'Copias')),
    grupo('Imprimir automáticamente al cobrar', 'En computadora y tableta viene encendido: el tiquete sale solo al terminar el cobro y se entrega al cliente. En celular viene apagado: el tiquete se imprime tocando el botón y se entrega igual. Cada aparato guarda su propia opción.',
      seg([['si', 'Sí, imprimir solo'], ['no', 'No, yo lo pido']], aj.auto ? 'si' : 'no', (v) => cambiar('auto', v === 'si'), 'Imprimir automáticamente'), estadoAuto),
    grupo('Qué se imprime automáticamente', 'Solo aplica si arriba escogió que se imprima solo.',
      seg([['tiquete', 'Tiquete (rollo)'], ['carta', 'Factura carta (hoja)']], aj.formato, (v) => cambiar('formato', v), 'Formato automático')),
    grupo('Tamaño de la hoja para la factura carta', null,
      seg([['carta', 'Hoja carta (Letter)'], ['a4', 'Hoja grande (A4)']], aj.hoja, (v) => cambiar('hoja', v), 'Tamaño de la hoja')),
    h('div.fx-grupo', h('div.fx-tit', 'Probar la impresora'),
      h('div.fx-ayuda', 'Saca un tiquete con una regla, letras de varios tamaños y tildes, para ver que nada se corta.'), probar, guardado),

    h('div.fx-instr',
      h('h3', 'Para que imprima sin ventanitas (recomendado en la computadora de la caja)'),
      h('p', 'Normalmente el navegador abre una ventana para escoger la impresora cada vez. En la computadora de la caja se puede evitar: el tiquete sale directo a la impresora de tiquetes. Se hace una sola vez, en esa computadora.'),
      h('ol',
        h('li', h('b', 'Deje la impresora de tiquetes como predeterminada. '), 'En Windows: Inicio, Configuración, Bluetooth y dispositivos, Impresoras y escáneres. Toque la impresora de tiquetes y luego «Establecer como predeterminada». Si arriba de la lista dice «Permitir que Windows administre mi impresora predeterminada», apáguelo.'),
        h('li', h('b', 'Revise el papel de esa impresora. '), 'En «Preferencias de impresión» escoja papel de rollo de 80 mm y márgenes en cero. Si el tiquete sale muy pequeño, ponga la escala en 100%.'),
        h('li', h('b', 'Cree un acceso directo especial. '), 'Clic derecho en el Escritorio, Nuevo, Acceso directo. En «Ubicación» pegue el texto de abajo (toque «Copiar texto»), toque Siguiente, escriba el nombre «Facturación La Bomba» y toque Finalizar.'),
        h('li', h('b', 'Abra el sistema siempre con ese acceso directo. '), 'Se abre en su propia ventana, sin pestañas, y al imprimir el tiquete sale solo, sin preguntar.')),
      h('div.fx-cmd', { tabindex: 0 }, cmd),
      h('button.btn', { type: 'button', onclick: (e) => copiar(e.currentTarget) }, 'Copiar texto'),
      h('p.fx-nota', 'Si Chrome está instalado en otra carpeta (por ejemplo Program Files (x86)), cambie esa parte del texto. También sirve con Microsoft Edge: cambie la ruta por la de msedge.exe. En Mac, abra la Terminal y escriba: open -na "Google Chrome" --args --kiosk-printing --app=' + new URL('../', import.meta.url).href),
      h('p.fx-nota', 'Importante: con este acceso directo todo se imprime en la impresora predeterminada. Para una factura carta en hoja normal, abra el sistema con el Chrome de siempre (el que muestra la ventanita) y escoja la impresora de hojas ahí.'),
      h('p.fx-nota', 'En celular o tableta no hay forma de saltarse la ventanita: aparece la ventana de impresión del aparato y ahí se escoge la impresora.')));

  pintarEstadoAuto();
  modal({ titulo: 'Ajustes de impresión', contenido, ancho: 680, botones: [{ texto: 'Listo', clase: 'primario', onclick: (c) => c() }] });
}
