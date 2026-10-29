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
import { h, esc, money, num, r2, modal, toast, conBoton, fechaCorta, horaCorta, nombrePropio, TIPOS_ID, TIPOS_SERVICIO, MEDIOS } from './util.js';

/* ------------------------------------------------------------------ constantes */

// Leyenda del pie. En la versión 4.4 la norma vigente es la resolución MH-DGT-RES-0027-2024 (publicada el 19-nov-2024,
// obligatoria desde el 1-sep-2025), que reemplaza a la DGT-R-48-2016 de las versiones 4.2/4.3. Esa resolución no obliga a
// imprimir una leyenda fija y dejó suspendido el código QR en la representación gráfica hasta que la DGT lo informe, así que
// el QR no se imprime. Se deja la leyenda con la resolución vigente; si Hacienda pidiera otro texto, se cambia solo aquí.
export const RESOLUCION_VIGENTE = 'MH-DGT-RES-0027-2024';
const LEYENDA_RESOLUCION = 'Autorizada mediante resolución ' + RESOLUCION_VIGENTE;

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
  const a = { ...DEFECTO, ...g };
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
  const nuevo = { ...leerAjustes(), ...parcial };
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
  if (prov === 4 && cant === 10) lugar.push(DISTRITOS_SARAPIQUI[dist] || titulo(x.barrio), 'Sarapiquí', 'Heredia');
  else { if (x.barrio) lugar.push(titulo(x.barrio)); if (PROVINCIAS[prov]) lugar.push(PROVINCIAS[prov]); }
  const senas = titulo(x.otras_senas);
  // si las señas ya mencionan el distrito (p. ej. "Frente a Gasolinera JyJ Horquetas") no se repite
  const resto = lugar.filter((l) => l && !senas.toLowerCase().includes(String(l).toLowerCase()));
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
  const filas = [...g.values()].map((x) => { const base = r2(x.bruto / (1 + x.t / 100)); return { t: x.t, codigo: x.codigo, etq: etiquetaIva(x.t, x.codigo), bruto: x.bruto, base, iva: r2(x.bruto - base) }; })
    .sort((a, b) => a.t - b.t || String(a.codigo).localeCompare(String(b.codigo)));
  if (ivaOficial != null && filas.length) {
    const dif = r2(ivaOficial - filas.reduce((a, f) => a + f.iva, 0));
    if (dif) { const f = filas.reduce((m, x) => (x.bruto > m.bruto ? x : m), filas[0]); f.iva = r2(f.iva + dif); f.base = r2(f.bruto - f.iva); }
  }
  return filas;
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
    estado: null, sandbox: false, motivo: '', original: null, venta: { numero: v.numero, tipo_servicio: v.tipo_servicio, referencia: v.referencia, prefactura_numero: v.prefactura_numero },
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

function nodoTiquete(m, { papel, logo, copia }) {
  const pre = m.clase === 'prefactura';
  const nc = m.tipo === '03';
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
    raiz.append(h('div.etq-chica', 'Consecutivo'), h('div.mono', m.consecutivo));
  }
  raiz.append(fila('Fecha', fechaLinea(m.fecha)));
  if (m.venta?.numero) raiz.append(fila(pre ? 'Cuenta' : 'Venta', m.venta.numero));
  if (m.venta?.prefactura_numero && pre) raiz.append(fila('Prefactura N.°', m.venta.prefactura_numero));
  if (m.venta?.tipo_servicio) raiz.append(fila('Servicio', TIPOS_SERVICIO[m.venta.tipo_servicio] || m.venta.tipo_servicio));
  if (m.venta?.referencia) raiz.append(fila('Referencia', m.venta.referencia));
  if (!pre) raiz.append(fila('Condición de venta', 'Contado'));
  if (nc && m.original) {
    raiz.append(linea());
    raiz.append(h('div.etq-chica', 'Anula el documento'), h('div.dato', (NOMBRE_DOC[m.original.tipo_doc] || 'Comprobante') + ' N.° ' + numCorto(m.original.consecutivo)), h('div.mono', m.original.consecutivo));
    if (m.motivo) raiz.append(h('div.dato', 'Motivo: ' + m.motivo));
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
      h('div.q', h('span', `${num(l.cantidad)} x ${money(l.precio_final)}`), h('b', money(l.total_linea))),
      tarifaDeLinea(l).pct !== 13 ? h('div.iva-lin', etiquetaIva(tarifaDeLinea(l).pct, tarifaDeLinea(l).codigo)) : null,
      l.nota ? h('div.nota', l.nota) : null));
  }
  raiz.append(linea('doble'));
  raiz.append(fila('Subtotal sin IVA', money(m.subtotal)));
  for (const f of m.desglose) raiz.append(fila(f.etq, money(f.iva)));
  raiz.append(h('div.fila-tq.total', h('span', nc ? 'TOTAL ACREDITADO' : 'TOTAL'), h('span.v', money(m.total))));
  if (m.pagos.length) {
    raiz.append(linea());
    raiz.append(h('div.etq-chica', nc ? 'Pagos del documento original' : 'Pagos'));
    for (const p of m.pagos) {
      raiz.append(fila(MEDIOS[p.medio] || p.medio, money(p.monto)));
      if (p.referencia) raiz.append(h('div.dato.izq', 'Ref. ' + p.referencia));
      const ef = nc ? null : pagoEfectivo(p);
      if (ef) { raiz.append(fila('Recibido', money(ef.recibido))); raiz.append(fila('Vuelto', money(ef.vuelto), 'negrita')); }
    }
  }
  if (!pre) {
    raiz.append(linea());
    raiz.append(h('div.etq-chica', 'Clave numérica'), ...partir(m.clave, 25).map((p) => h('div.mono', p)));
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
  const marca = MARCA[m.soc.codigo] || MARCA.soda;
  const raiz = h('div.fxd.ct');
  if (m.sandbox) raiz.append(h('div.marca-agua', 'PRUEBA'));

  // Encabezado
  raiz.append(h('div.ct-cab',
    h('div.ct-marca', logo ? h('img.ct-logo', { src: logo, alt: m.soc.comercial }) : h('div.ct-nombre-grande', m.soc.comercial)),
    h('div.ct-titulo',
      h('div.ct-tit', m.titulo),
      h('div.ct-num', 'N.° ' + numCorto(m.consecutivo)),
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

  if (nc && m.original) {
    raiz.append(h('div.ct-ref',
      h('div', h('b', 'Esta nota de crédito anula: '), (NOMBRE_DOC[m.original.tipo_doc] || 'Comprobante') + ' N.° ' + numCorto(m.original.consecutivo)),
      h('div.mono', m.original.consecutivo),
      m.motivo ? h('div', h('b', 'Motivo: '), m.motivo) : null));
  }

  // Líneas
  raiz.append(h('table.ct-tabla',
    h('thead', h('tr', h('th', 'Código'), h('th', 'Descripción'), h('th.der', 'Cant.'), h('th.der', 'Precio unit.'), h('th.der', 'IVA'), h('th.der', 'Total'))),
    h('tbody', m.lineas.map((l) => h('tr',
      h('td.cod', l.cabys || ''),
      h('td', h('div', l.descripcion || ''), l.nota ? h('div.ct-tenue', l.nota) : null),
      h('td.der', num(l.cantidad)),
      h('td.der', money(l.precio_final)),
      h('td.der', (tarifaDeLinea(l).pct ? num(tarifaDeLinea(l).pct, 2) + '%' : tarifaDeLinea(l).codigo === '10' || !tarifaDeLinea(l).codigo ? 'Exento' : '0%')),
      h('td.der', money(l.total_linea)))))));
  raiz.append(h('div.ct-nota-precio', 'Los precios unitarios y los totales de cada línea incluyen el IVA.'));

  // Pagos y totales
  const pagos = h('div.ct-pagos', h('div.ct-etq', nc ? 'Pagos del documento original' : 'Pagos'));
  if (m.pagos.length) {
    for (const p of m.pagos) {
      pagos.append(h('div.ct-fila', h('span', (MEDIOS[p.medio] || p.medio) + (p.referencia ? ' (ref. ' + p.referencia + ')' : '')), h('span.v', money(p.monto))));
      const ef = nc ? null : pagoEfectivo(p);
      if (ef) { pagos.append(h('div.ct-fila', h('span', 'Recibido'), h('span.v', money(ef.recibido))), h('div.ct-fila', h('span', 'Vuelto'), h('span.v', money(ef.vuelto)))); }
    }
  } else pagos.append(h('div.ct-tenue', 'Sin pagos registrados'));
  const tot = h('div.ct-totales',
    h('div.ct-fila', h('span', 'Subtotal sin IVA'), h('span.v', money(m.subtotal))),
    m.desglose.map((f) => h('div.ct-fila', h('span', f.etq), h('span.v', money(f.iva)))),
    h('div.ct-fila.gran', h('span', nc ? 'Total acreditado' : 'Total'), h('span.v', money(m.total))));
  raiz.append(h('div.ct-cierre', pagos, tot));

  // Clave, consecutivo y estado
  const st = m.estado;
  const txtSt = st === 'aceptado' ? 'Aceptado por Hacienda' : st === 'rechazado' ? 'RECHAZADO POR HACIENDA. Este documento no es válido.' : 'Pendiente de validación: Hacienda aún no confirma este comprobante.';
  raiz.append(h('div.ct-clave',
    h('div', h('span.ct-etq', 'Consecutivo'), h('span.mono', m.consecutivo)),
    h('div', h('span.ct-etq', 'Clave numérica'), h('span.mono', m.clave)),
    h('div.ct-estado.' + (st === 'aceptado' ? 'ok' : st === 'rechazado' ? 'mal' : 'pend'), txtSt)));

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
  raiz.append(...partir('50628102600310211194300100001040000000011847027391', 25).map((p) => h('div.mono', p)));
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
  const c = await api.comprobante(comprobanteId);
  if (!c) throw new Error('No se encontró el comprobante.');
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
    catch (e) { estado.textContent = 'No se pudo imprimir: ' + (e.message || e) + ' Revise el botón «Impresora» e intente de nuevo.'; }
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
      : 'En este aparato: APAGADA. Al terminar el cobro no sale nada solo; aparece el botón «Imprimir tiquete» para tocarlo si el cliente lo quiere.';
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
    grupo('Imprimir automáticamente al cobrar', 'Encienda esto en cada aparato que tenga impresora (la computadora o la tableta de la caja). En los demás aparatos, como los celulares, déjelo apagado y el tiquete se imprime tocando el botón. Cada aparato guarda su propia opción.',
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
        h('li', h('b', 'Deje la impresora de tiquetes como predeterminada. '), 'En Windows: Inicio, Configuración, Bluetooth y dispositivos, Impresoras y escáneres. Toque la impresora de tiquetes y luego "Establecer como predeterminada". Si arriba de la lista dice "Permitir que Windows administre mi impresora predeterminada", apáguelo.'),
        h('li', h('b', 'Revise el papel de esa impresora. '), 'En "Preferencias de impresión" escoja papel de rollo de 80 mm y márgenes en cero. Si el tiquete sale muy pequeño, ponga la escala en 100%.'),
        h('li', h('b', 'Cree un acceso directo especial. '), 'Clic derecho en el Escritorio, Nuevo, Acceso directo. En "Ubicación" pegue el texto de abajo (toque "Copiar texto"), toque Siguiente, escriba el nombre "Facturación La Bomba" y toque Finalizar.'),
        h('li', h('b', 'Abra el sistema siempre con ese acceso directo. '), 'Se abre en su propia ventana, sin pestañas, y al imprimir el tiquete sale solo, sin preguntar.')),
      h('div.fx-cmd', { tabindex: 0 }, cmd),
      h('button.btn', { type: 'button', onclick: (e) => copiar(e.currentTarget) }, 'Copiar texto'),
      h('p.fx-nota', 'Si Chrome está instalado en otra carpeta (por ejemplo Program Files (x86)), cambie esa parte del texto. También sirve con Microsoft Edge: cambie la ruta por la de msedge.exe. En Mac, abra la Terminal y escriba: open -na "Google Chrome" --args --kiosk-printing --app=' + new URL('../', import.meta.url).href),
      h('p.fx-nota', 'Importante: con este acceso directo todo se imprime en la impresora predeterminada. Para una factura carta en hoja normal, abra el sistema con el Chrome de siempre (el que muestra la ventanita) y escoja la impresora de hojas ahí.'),
      h('p.fx-nota', 'En celular o tableta no hay forma de saltarse la ventanita: aparece la ventana de impresión del aparato y ahí se escoge la impresora.')));

  pintarEstadoAuto();
  modal({ titulo: 'Ajustes de impresión', contenido, ancho: 680, botones: [{ texto: 'Listo', clase: 'primario', onclick: (c) => c() }] });
}
