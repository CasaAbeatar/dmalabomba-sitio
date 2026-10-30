// Anular con nota de crédito: la ventana de motivos, la confirmación y el resultado. La usa la ventana «Anular y reimprimir» (m_documentos.js),
// tanto desde el botón «Anular» de cada fila como desde el detalle de un documento. Ya no es un módulo con lista propia.
// Anular = nota de crédito por el total que referencia el documento original (código 01 «Anula documento de referencia», que en pantalla se llama
// «Anulación total») y la razón escrita, como exige Hacienda. El documento original no se borra.
// Además: el camino guiado «el cliente pide factura» / «corregir el cliente» (cambiarCliente), que anula y arma la venta de nuevo con el cliente elegido.
import { h, money, modal, toast, nombrePropio, horaCorta, MEDIOS } from './util.js';
import { copiarVentaParaRehacer, abrirCuentaNueva, ventaClonarConCliente, mensajeAmable, anulacionDe, saldosDe, permiteAnular, anulacionDeSaldos, sinEfectoDeSaldos, otrasNotas } from './api_documentos.js';
import { reimprimirComprobante, numeroCorto } from './imprimir.js';
import { selectorCliente } from './ui_cliente.js';

if (!document.querySelector('link[data-fx-anular]')) document.head.append(h('link', { rel: 'stylesheet', href: new URL('../css/anular.css', import.meta.url).href, 'data-fx-anular': '1' }));

const NOMBRE_TIPO = { '01': 'Factura', '04': 'Tiquete' };
const conArticulo = (tipo) => (tipo === '01' ? 'la factura electrónica' : 'el tiquete electrónico');

/* ---------- Códigos de la nota, con su nombre en palabras simples (Nota 9 del anexo de Hacienda) ---------- */
// Solo los que la cajera aprende (ver manual/PUNTOS_MANUAL_ANULACIONES.md). Los demás códigos no se nombran en pantalla.
const NOMBRE_CODIGO = { '01': 'Anulación total', '02': 'Corrección de monto', '06': 'Devolución' };
export const textoCodigoNota = (codigo) => (NOMBRE_CODIGO[codigo] ? `código ${codigo} «${NOMBRE_CODIGO[codigo]}»` : null);
// Una nota de crédito sin código guardado se envía a Hacienda con el 01 (CONTRATO_NC.md, sección 1)
export const codigoDeNota = (nc) => String(nc?.codigo_referencia || '01');
// La venta nueva lleva el 07 «Sustituye el comprobante anulado» solo cuando la base sabe guardarlo (columnas codigo_referencia y reemplaza_a, CONTRATO_NC.md sección 2).
// Mientras esas columnas no existan, la pantalla no lo menciona para no prometer algo que el sistema todavía no envía.
// MOSTRAR_07 es el interruptor de esa frase: ponerlo en false la quita de todas las pantallas. Debe seguir en true solo mientras Facturación cobre la venta nueva con
// fx_cobrar_reemplazo (sql/21n4), que es la que guarda reemplaza_a y el código 07; si Facturación cobra con fx_cobrar a secas, la venta nueva sale sin referencia.
export const MOSTRAR_07 = true;
export const sustituyeSoportado = (c) => MOSTRAR_07 && !!c && typeof c === 'object' && 'codigo_referencia' in c && 'reemplaza_a' in c;
export const TEXTO_07 = 'código 07 «Sustituye el comprobante anulado»';

/* ---------- Las notas que ya tiene un documento (fx_comprobante_saldos.notas) ---------- */
// Nombres de estado de las notas: los mismos de toda la aplicación
const ESTADO_NOTA = { pendiente: 'Por enviar a Hacienda', enviado: 'Enviada a Hacienda', aceptado: 'Aceptada por Hacienda', rechazado: 'Rechazada por Hacienda', error: 'No se pudo enviar a Hacienda' };
// «Nota de crédito: Devolución N.° 0003 · −₡3 000,00 · Aceptada por Hacienda». Una nota de débito suma (+); una de crédito resta (−). El rótulo (nombre_simple) lo da la base.
export function textoNota(n) {
  const debito = n.tipo_doc === '02';
  const rotulo = n.nombre_simple || n.codigo_nombre || '';
  return `${debito ? 'Nota de débito' : 'Nota de crédito'}${rotulo ? ': ' + rotulo : ''} N.° ${numeroCorto(n.consecutivo)} · ${debito ? '+' : '−'}⁠${money(n.total)} · ${ESTADO_NOTA[n.estado] || n.estado}`;
}
// Lista de las demás notas vivas del documento (devoluciones, correcciones y notas de débito) o null si no tiene ninguna. La anulación total no va aquí: se dice aparte.
export function listaNotas(saldos) {
  const notas = otrasNotas(saldos);
  return notas.length ? h('ul.an-notas', notas.map((n) => h('li', textoNota(n)))) : null;
}

// Motivos frecuentes. Hacienda pide que la nota de crédito diga por qué se anula (la razón puede tener hasta 180 letras; la base exige entre 3 y 180).
// Esta nota anula TODO el documento: por eso se dice «toda la compra». Si el cliente devuelve solo una parte, se anula y se hace la venta de nuevo con lo que se queda.
const M_CLIENTE = 'Error en el cliente (cédula o nombre)';
const M_PRECIO = 'Error en el precio';
const M_PRODUCTOS = 'Error en los productos o en las cantidades';
const M_DEVOLVIO = 'El cliente devolvió toda la compra';
const M_DOBLE = 'Se cobró dos veces';
const M_OTRO = 'Otro motivo';
const MOTIVOS = [M_CLIENTE, M_PRECIO, M_PRODUCTOS, M_DEVOLVIO, M_DOBLE, M_OTRO];
const RAZON_FACTURA = M_CLIENTE + ': el cliente pidió factura a su nombre';
const RAZON_CORREGIR = M_CLIENTE + ': se corrige el cliente de la factura';

/* ---------- Qué hacer con el dinero ---------- */
// El cierre de caja ya descuenta el efectivo de la venta anulada (sale del turno en que se emite la nota). Por eso la cajera NO anota además una salida de efectivo.
function pagosDe(c) {
  const por = new Map();
  for (const p of c?.pagos_snapshot || []) por.set(p.medio, Math.round(((por.get(p.medio) || 0) + (Number(p.monto) || 0)) * 100) / 100);
  return [...por].filter(([, m]) => m > 0).map(([medio, monto]) => ({ medio, monto }));
}
const COMO_DEVOLVER = {
  efectivo: (m, cierre) => `Efectivo ${money(m)}: entréguelo de la caja.${cierre ? ' El cierre de caja ya lo descuenta, así que no lo anote además como salida de efectivo.' : ''}`,
  tarjeta: (m) => `Tarjeta ${money(m)}: la devolución se hace a la misma tarjeta, por el datáfono.`,
  sinpe: (m) => `SINPE Móvil ${money(m)}: devuélvalo por SINPE al mismo número.`,
  transferencia: (m) => `Transferencia ${money(m)}: devuélvala por transferencia a la misma cuenta.`,
};
// cierre = false cuando la nota no entra en ningún cierre de caja (no hay turno abierto) o no se sabe: entonces no se habla del cierre
export const lineasDevolver = (pagos, { cierre = true } = {}) => pagos.map((p) => h('li', (COMO_DEVOLVER[p.medio] || ((m) => `${MEDIOS[p.medio] || p.medio} ${money(m)}: devuélvalo por el mismo medio.`))(p.monto, cierre)));
const pagoTxt = (pagos) => pagos.map((p) => `${MEDIOS[p.medio] || p.medio} ${money(p.monto)}`).join(', ');

function bloqueDinero(motivo, pagos) {
  const caja = h('div.an-dinero');
  const tit = h('div.an-etq', 'Qué hacer con el dinero');
  if (!motivo) { caja.append(tit, h('p', 'Escoja el motivo y aquí verá qué hacer con el dinero.')); return caja; }
  const dev = (intro) => [h('p', intro), pagos.length ? h('ul', lineasDevolver(pagos)) : h('p', 'Devuélvalo por el mismo medio con que pagó.')];
  let cuerpo;
  if (motivo === M_CLIENTE) cuerpo = [h('p', 'No hay dinero que devolver: el cliente ya pagó.'), h('p', `Después de anular, haga la venta de nuevo con el cliente correcto y registre el mismo pago${pagos.length ? ' (' + pagoTxt(pagos) + ')' : ''}. El cierre de caja descuenta el efectivo del documento anulado y suma el de la venta nueva, así que queda igual.`)];
  else if (motivo === M_PRECIO || motivo === M_PRODUCTOS) cuerpo = [h('p', 'Después de anular, haga la venta de nuevo con ' + (motivo === M_PRECIO ? 'el precio correcto' : 'los productos y las cantidades correctos') + '.'), h('p', `Al cobrar la venta nueva, ponga el mismo pago que el cliente ya hizo${pagos.length ? ' (' + pagoTxt(pagos) + ')' : ''}: el vuelto que muestre el cobro es la diferencia que se le devuelve. Si la venta nueva sale más cara, cobre esa diferencia.`), h('p', 'El cierre de caja ya descuenta el efectivo del documento anulado, así que no anote nada como salida de efectivo.')];
  else if (motivo === M_DEVOLVIO) cuerpo = dev('Devuélvale al cliente todo lo que pagó por este documento:');
  else if (motivo === M_DOBLE) cuerpo = [...dev('Si el cliente pagó de más de verdad, devuélvale lo que pagó por este documento:'), h('p', 'Si solo se registró dos veces en el sistema y el cliente pagó una vez, no hay dinero que devolver.')];
  else cuerpo = dev('Si hay que devolver dinero, devuélvalo por el mismo medio con que pagó:');
  caja.append(tit, ...cuerpo);
  return caja;
}

// Un doble toque en «Anular» no debe cerrar la ventana recién abierta: el segundo toque cae sobre el fondo y el sistema lo toma por «tocar fuera». Se ignora en el primer instante.
export function ignorarToqueDeFondo(m) {
  const fondo = m.el.parentElement, t0 = Date.now();
  fondo?.addEventListener('mousedown', (e) => { if (Date.now() - t0 < 700) e.stopImmediatePropagation(); }, true);
}

/* ---------- Un documento a la vez ---------- */
// Evita abrir dos ventanas de anulación del mismo documento (por ejemplo desde la fila y desde el detalle) y anular dos veces.
const enCurso = new Set();

class FalloNota extends Error {
  constructor(mensaje, { dudoso = false } = {}) { super(mensaje); this.dudoso = dudoso; }
}
const esDeRed = (e) => e?.transitorio === true || ['red', 'tiempo', 'ocupado'].includes(e?.tipo);
// Tras una respuesta perdida la base puede seguir guardando un buen rato (hasta ~18 s: espera de conexión, bloqueo y la propia consulta). Una lectura sin la nota solo vale como «no se anuló nada» pasados 35 s desde la falla.
const MS_RELEER = 4500, MS_SEGURO = 35000;
const ahoraMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const textoTodavia = (falloMs) => `Todavía no se puede asegurar. Espere unos ${Math.max(5, Math.ceil(Math.max(MS_SEGURO - (ahoraMs() - falloMs), 0) / 5000) * 5)} segundos y toque «Revisar si quedó anulado». No toque «Anular» otra vez todavía.`;

// Crea la nota de crédito. Si la respuesta no llega (se cayó el internet o tardó), averigua si la nota quedó creada antes de decir que falló.
// Devuelve { nc, yaExistia }. Lanza FalloNota con un texto listo para mostrar.
// marca.falloMs queda con el momento de la falla de la escritura, para que la ventana cuente desde ahí.
async function emitirNota(app, d, razon, marca = {}) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new FalloNota('No hay conexión con internet, así que no se anuló nada. Cuando vuelva la conexión, intente de nuevo.');
  try {
    return { nc: await app.api.notaCredito(d.id, razon, app.terminal), yaExistia: false };
  } catch (e) {
    const msg = mensajeAmable(e);
    if (/ya tiene una nota de cr[eé]dito/i.test(msg)) {
      // Puede ser una anulación hecha desde otro aparato (se muestra como «ya estaba anulado») o una devolución o corrección parcial, que NO es una anulación:
      // en ese caso se dice lo que dice la base y no se finge que quedó anulado.
      let r;
      try { r = await anulacionDe(d.id); }
      catch { throw new FalloNota('El sistema dice que este documento ya tiene una nota de crédito, pero no se pudo comprobar si es una anulación o una devolución. Revise la conexión y mire la lista de documentos.'); }
      if (r.sinEfecto) throw new FalloNota('La anulación de este documento ya se dejó sin efecto con una nota de débito, así que ya no se puede anular otra vez.');
      if (!r.nc) throw new FalloNota(permiteAnular(r.saldos).motivo || 'Este documento ya tiene una devolución o una corrección, así que no se puede anular completo. Si falta devolver algo, use «Devolver parte».');
      return { nc: r.nc, yaExistia: true };
    }
    if (esDeRed(e)) {
      marca.falloMs = ahoraMs();
      const noSeSupo = () => new FalloNota('No se pudo confirmar si el documento quedó anulado. No toque «Anular» otra vez todavía: cuando vuelva la conexión, revise la lista. Si dice «Anulado», ya está listo.', { dudoso: true });
      let nc;
      try { nc = (await anulacionDe(d.id)).nc; } catch { throw noSeSupo(); }
      if (nc) return { nc, yaExistia: false };
      // Una lectura sin la nota no prueba que no se hizo: la base puede estar terminando de guardar. Se mira otra vez a los pocos segundos y, si sigue sin aparecer, se dice que no se pudo confirmar.
      await esperar(MS_RELEER);
      try { nc = (await anulacionDe(d.id)).nc; } catch { throw noSeSupo(); }
      if (nc) return { nc, yaExistia: false };
      throw new FalloNota('No se pudo confirmar si la anulación quedó hecha. Espere unos segundos y toque «Revisar si quedó anulado». No toque «Anular» otra vez todavía.', { dudoso: true });
    }
    if (/debe estar aceptado|no est[aá] aceptado/i.test(msg)) throw new FalloNota('Hacienda todavía no acepta este documento, así que no se puede anular. Espere a que aparezca como «Aceptado por Hacienda».');
    throw new FalloNota(msg);
  }
}

/* ---------- Piezas de pantalla ---------- */
const resumenDoc = (d) => h('div.an-resumen',
  h('div', h('b', `${NOMBRE_TIPO[d.tipo_doc] || 'Documento'} N.° ${numeroCorto(d.consecutivo)}`), h('span.tenue', ' · ' + horaCorta(d.fecha_emision))),
  h('div', d.cliente ? nombrePropio(d.cliente) : 'Consumidor final'),
  h('div.an-resumen-total', money(d.total)));

function listaProductos(c) {
  const ls = c?.lineas_snapshot || [];
  if (!ls.length) return [];
  return [h('div.an-lineas-tit', 'Lo que se va a dejar sin efecto'),
    ...ls.slice(0, 5).map((l) => h('div.an-linea', h('span', `${Number(l.cantidad) || 1} × ${l.descripcion || l.nombre || 'Producto'}`), h('span.der', money(l.total ?? l.total_linea ?? 0)))),
    ls.length > 5 ? h('small.tenue', `y ${ls.length - 5} productos más`) : null].filter(Boolean);
}

// Confirmación: lo que se va a anular (número, hora, cliente, total), el tipo de nota con su código y el motivo. Un solo toque cuenta: el botón se apaga al primer toque.
function confirmarAnulacion(d, razon, soporta07) {
  return new Promise((ok) => {
    let hecho = false;
    const fin = (v, cerrar) => { if (hecho) return; hecho = true; cerrar?.(); ok(v); };
    const mc = modal({ titulo: 'Confirme la anulación', ancho: 560, alCerrar: () => { if (!hecho) { hecho = true; ok(false); } },
      contenido: h('div.an-dlg',
        h('p.an-pregunta', `¿Anular ${conArticulo(d.tipo_doc)} N.° ${numeroCorto(d.consecutivo)}?`),
        resumenDoc(d),
        h('div.an-ficha',
          h('div.an-ficha-fila', h('span.an-etq', 'Nota que se creará'), h('div', h('b', `Nota de crédito por ${money(d.total)}`), h('div', 'Tipo de nota: ' + textoCodigoNota('01') + '. Deja sin efecto todo el documento, no una parte.'))),
          soporta07 ? h('div.an-ficha-fila', h('span.an-etq', 'Si después hace la venta de nuevo'), h('div', 'La venta nueva llevará el ' + TEXTO_07 + '.')) : null,
          h('div.an-ficha-fila', h('span.an-etq', 'Motivo'), h('div', razon))),
        h('p.an-sin-deshacer', 'La nota de crédito no se puede borrar.')),
      botones: [{ texto: 'No, volver', clase: 'grande', onclick: (c) => fin(false, c) }, { texto: 'Sí, anular', clase: 'peligro.grande', onclick: (c) => fin(true, c) }] });
    ignorarToqueDeFondo(mc);
  });
}

/* =====================================================================================================================
   Anular con nota de crédito
   d: { id, tipo_doc ('01' | '04'), consecutivo, total, fecha_emision, cliente?, venta_id?, estado? }
   opciones.alTerminar(nc): se llama cuando la nota de crédito ya quedó creada (la lista vuelve a cargarse).
   opciones.alVerNC(nc): si viene, el resultado ofrece «Ver la nota de crédito».
   opciones.alCambiarCliente(): si viene, el motivo «Error en el cliente» ofrece el camino guiado.
   opciones.alDevolverParte() y opciones.alCorregirMonto(): si vienen y la base admite notas parciales (admite_notas), la ventana ofrece «Devolver parte» y «Corregir un monto»
   para cuando solo hay que devolver o corregir una parte y no hace falta anular todo (m_nota_parcial.js).
   ===================================================================================================================== */
export function anularDocumento(app, d, { alTerminar, alVerNC, alCambiarCliente, alDevolverParte, alCorregirMonto } = {}) {
  if (d.estado && d.estado !== 'aceptado') { toast('Todavía no se puede anular: Hacienda debe aceptar este documento primero.', 'error', 6000); return null; }
  if (enCurso.has(d.id)) { toast('Ya hay una ventana de anulación abierta para este documento.', 'error'); return null; }
  enCurso.add(d.id);
  const nombre = conArticulo(d.tipo_doc);
  let original = null; // el comprobante completo (productos y pagos)
  let soporta07 = false;
  let enVuelo = false;
  let saldosListos = false; // ya se supo (o no se pudo saber) si la base permite anular completo
  let bloqueado = false; // la base dice que este documento no se puede anular completo (fx_comprobante_saldos.admite_anulacion = false)
  const zonaBloqueo = h('div');
  const detalleLineas = h('div.an-lineas', h('small.tenue', 'Cargando el detalle…'));
  const zonaDinero = h('div');
  const zonaExplica = h('div');
  const explica = () => zonaExplica.replaceChildren(h('div.an-explica',
    h('p', h('b', 'Qué pasa si sigue:')),
    h('ul',
      h('li', `Se emite una nota de crédito por ${money(d.total)} que anula ${nombre}. Tipo de nota: ${textoCodigoNota('01')}. Deja sin efecto todo el documento, no una parte.`),
      h('li', 'La nota de crédito se enviará sola a Hacienda y su estado cambiará solo en la lista. El documento original no se borra: queda enlazado a la nota.'),
      h('li', 'Si hay que cobrar de nuevo, después toque «Hacer la venta de nuevo en Facturación».' + (soporta07 ? ` La venta nueva llevará el ${TEXTO_07}.` : '')),
      h('li', 'La nota de crédito no se puede borrar.'))));
  explica();
  app.api.comprobante(d.id).then((c) => {
    if (!m.el.isConnected) return;
    original = c; soporta07 = sustituyeSoportado(c);
    detalleLineas.replaceChildren(...listaProductos(c));
    explica(); pintarDinero();
  }).catch(() => {
    if (!m.el.isConnected) return;
    // Sin el documento no se pueden mostrar los productos ni los montos por medio de pago: se dice, para que nadie crea que no hay nada que devolver
    detalleLineas.replaceChildren(h('div.an-aviso', h('p', h('b', 'No se pudo leer lo que se vendió ni cómo se pagó. '), 'Puede seguir, pero antes de devolver dinero revise el documento: aquí no se ven los montos por medio de pago.')));
  });

  let elegido = null;
  const detalle = h('input.campo', { type: 'text', maxlength: 150, placeholder: 'Escriba aquí qué pasó', 'aria-label': 'Detalle del motivo' });
  const etqDetalle = h('label.etq', h('span.an-etq-det', 'Cuente brevemente qué pasó'), detalle);
  const error = h('div.error-caja', { hidden: true, role: 'alert' });
  const zonaCliente = h('div');
  const zonaParcial = h('div'); // «¿Solo hay que devolver o corregir una parte?», cuando la base admite notas parciales
  const pintarDinero = () => zonaDinero.replaceChildren(bloqueDinero(elegido, pagosDe(original)));
  const botonesMotivo = MOTIVOS.map((t) => h('button.btn.atajo', { type: 'button', 'aria-pressed': 'false', onclick: () => {
    if (enVuelo) return;
    elegido = t;
    botonesMotivo.forEach((b) => b.setAttribute('aria-pressed', String(b.textContent === t)));
    error.hidden = true;
    etqDetalle.querySelector('.an-etq-det').textContent = t === M_OTRO ? 'Escriba cuál fue el motivo (obligatorio)' : 'Detalle (opcional)';
    pintarDinero();
    zonaCliente.replaceChildren(...(t === M_CLIENTE && alCambiarCliente ? [h('div.an-aviso',
      h('p', h('b', '¿El cliente pidió factura, o hay que cambiar sus datos?'), ' Hay un camino más corto: elija al cliente, anule y deje la venta lista para cobrar con ese cliente.'),
      h('button.btn.primario', { type: 'button', onclick: () => { if (enVuelo) return; m.cerrar(); alCambiarCliente(); } }, 'Cambiar el cliente y hacer la venta de nuevo'))] : []));
    detalle.focus();
  } }, t));

  // Todo lo que se escoge para anular; se esconde si la base dice que este documento no se puede anular completo
  const cuerpoMotivos = h('div.an-dlg',
    zonaParcial,
    h('div.an-etq', '¿Por qué se anula? (Hacienda lo pide)'),
    h('div.an-motivos', botonesMotivo),
    zonaCliente,
    etqDetalle,
    zonaDinero,
    zonaExplica);
  const volver = h('button.btn', { type: 'button', onclick: () => { if (enVuelo) return; m.cerrar(); } }, 'No anular, volver');
  // Mientras la anulación va en camino (o se está revisando si se puede), «No anular, volver» queda apagado: no puede cancelar algo que ya salió
  const vuelo = (v) => { enVuelo = v; volver.disabled = v; };
  const rotuloSeguir = () => (bloqueado ? 'No se puede anular' : dudoso ? 'Revisar si quedó anulado' : 'Anular');
  let dudoso = false; // se perdió la respuesta y no se pudo comprobar si la nota quedó creada: el botón pasa a «Revisar si quedó anulado»
  let falloMs = null; // cuándo falló la escritura que dejó la duda (para no decir «no se anuló nada» antes de tiempo)
  const revisar = async () => {
    vuelo(true); seguir.disabled = true; error.hidden = true;
    try {
      const nc = (await anulacionDe(d.id)).nc;
      if (nc) { dudoso = false; vuelo(false); m.cerrar(); resultado(nc, { motivo: elegido, yaExistia: false }); try { await alTerminar?.(nc); } catch { /* nada */ } return; }
      if (falloMs != null && ahoraMs() - falloMs < MS_SEGURO) { error.textContent = textoTodavia(falloMs); error.hidden = false; return; } // sigue la duda: no se afirma nada
      dudoso = false; error.textContent = 'No se anuló nada. Puede intentarlo de nuevo.'; error.hidden = false; seguir.textContent = 'Anular';
    } catch { error.textContent = 'Todavía no hay conexión para comprobarlo. Espere unos segundos y toque «Revisar si quedó anulado».'; error.hidden = false; }
    finally { vuelo(false); seguir.disabled = bloqueado; seguir.textContent = rotuloSeguir(); }
  };
  const seguir = h('button.btn.peligro.grande', { type: 'button', onclick: async () => {
    if (enVuelo || bloqueado) return;
    if (dudoso) return revisar();
    let volverAlBoton = false;
    const det = detalle.value.trim();
    if (!elegido) { error.textContent = 'Escoja uno de los motivos de arriba.'; error.hidden = false; return; }
    if (elegido === M_OTRO && det.length < 5) { error.textContent = 'Escriba cuál fue el motivo (mínimo 5 letras).'; error.hidden = false; detalle.focus(); return; }
    // Hacienda guarda esta razón en la nota de crédito: motivo, y el detalle si lo hay (máximo 180 letras)
    const razon = (elegido === M_OTRO ? det : elegido + (det ? ': ' + det : '')).slice(0, 180);
    error.hidden = true;
    vuelo(true); seguir.disabled = true;
    if (!saldosListos) seguir.textContent = 'Revisando si se puede anular…'; // la base puede tardar unos segundos en contestar: el botón dice qué está pasando
    try {
      await cargaSaldos; // si la base ya dijo que no se puede anular completo, se avisa aquí y no se llega a la confirmación
      if (!m.el.isConnected) return; // la ventana se cerró mientras se revisaba: no se abre una confirmación sobre una pantalla que la persona ya dejó
      if (bloqueado) return;
      seguir.textContent = rotuloSeguir();
      const ok = await confirmarAnulacion(d, razon, soporta07);
      if (!ok) { volverAlBoton = true; return; } // «No, volver»: el teclado queda otra vez en «Anular», donde estaba
      seguir.textContent = 'Anulando, espere…';
      const marca = { falloMs: null };
      let nota;
      try { nota = await emitirNota(app, d, razon, marca); } finally { if (marca.falloMs != null) falloMs = marca.falloMs; }
      const { nc, yaExistia } = nota;
      vuelo(false); m.cerrar();
      resultado(nc, { motivo: elegido, yaExistia });
      try { await alTerminar?.(nc); } catch { /* la lista se actualiza sola en unos segundos */ }
    } catch (e) {
      error.textContent = e instanceof FalloNota ? e.message : mensajeAmable(e); error.hidden = false; volverAlBoton = true; // el error se lee y el teclado queda en el botón
      if (e instanceof FalloNota && e.dudoso) { dudoso = true; Promise.resolve(alTerminar?.(null)).catch(() => {}); }
    } finally {
      vuelo(false); seguir.disabled = bloqueado; seguir.textContent = rotuloSeguir();
      if (volverAlBoton && m.el.isConnected && !seguir.disabled) { try { seguir.focus({ preventScroll: true }); } catch { /* nada */ } }
    }
  } }, 'Anular');

  const m = modal({ titulo: 'Anular ' + (d.tipo_doc === '01' ? 'factura' : 'tiquete'), ancho: 640,
    alCerrar: () => { enCurso.delete(d.id); },
    bloqueo: () => (enVuelo ? 'Espere un momento: se está anulando el documento.' : ''),
    contenido: h('div.an-dlg',
      h('div.an-compruebe', 'Compruebe que es el documento correcto antes de seguir:'),
      resumenDoc(d),
      detalleLineas,
      zonaBloqueo,
      cuerpoMotivos) });
  pintarDinero();
  ignorarToqueDeFondo(m);
  // Los dos botones quedan fuera de la parte que se desplaza: se ven siempre, aunque la ventana sea más alta que la pantalla
  m.el.append(h('div.modal-pie.an-pie', error, volver, seguir));
  // ¿La base permite anular completo? Si dice que no (por ejemplo, el documento tiene una devolución o una nota de débito, o ya se anuló), se muestra su frase tal cual, se esconden los motivos y el botón queda apagado.
  // Si no se puede preguntar, todo sigue como antes.
  // Un botón que cierra esta ventana y abre la de la nota parcial (el mismo documento no puede tener las dos abiertas)
  const botonParcial = (texto, abrirla) => h('button.btn', { type: 'button', onclick: () => { if (enVuelo) return; m.cerrar(); abrirla(); } }, texto);
  const avisoParcial = (s, enBloqueo) => {
    if (s?.admite_notas !== true || !(alDevolverParte || alCorregirMonto)) return null;
    return h('div.an-aviso', h('p', h('b', enBloqueo ? 'Lo que sí se puede hacer: ' : '¿Solo hay que devolver o corregir una parte? '), enBloqueo ? 'devolver una parte del documento o corregir un monto.' : 'No hace falta anular todo: puede devolver una parte o corregir un monto.'),
      h('div.an-aviso-botones', alDevolverParte ? botonParcial('Devolver parte', alDevolverParte) : null, alCorregirMonto ? botonParcial('Corregir un monto', alCorregirMonto) : null));
  };
  const cargaSaldos = saldosDe(d.id).then(async (s) => {
    if (!m.el.isConnected) return;
    // No se pudo leer (saldosDe devuelve null): se puede seguir (la base rechaza lo que no corresponda), pero se dice con las mismas palabras que el detalle del documento, no en silencio
    if (!s) {
      zonaBloqueo.replaceChildren(h('div.an-aviso.an-sin-saldos', { role: 'note' }, h('p', h('b', 'No se pudo comprobar si tiene devoluciones.')),
        h('p', 'Revise la conexión. Mientras tanto no dé por hecho que no tiene devoluciones ni correcciones; si no corresponde, el sistema no deja anular.')));
      return;
    }
    const permiso = permiteAnular(s);
    if (!permiso.sabe || permiso.permite) { const a = avisoParcial(s, false); if (a) zonaParcial.replaceChildren(a); return; }
    bloqueado = true;
    cuerpoMotivos.hidden = true;
    detalleLineas.style.display = 'none'; // «Lo que se va a dejar sin efecto» ya no aplica: no se va a dejar nada sin efecto
    const notas = listaNotas(s);
    const yaAnulada = anulacionDeSaldos(s); // otra persona (u otro aparato) ya lo anuló
    // La anulación puede haberse dejado sin efecto con una nota de débito (cuelga de la nota de crédito): entonces el documento vuelve a valer y «ya está anulado» no sería cierto
    // (Desde fx_23i los saldos del documento ya traen esa nota de débito 01; si no, se mira en los saldos de la nota de crédito.)
    const sinEfecto = sinEfectoDeSaldos(s) || (yaAnulada ? sinEfectoDeSaldos(await saldosDe(yaAnulada.id)) : null);
    if (!m.el.isConnected) return;
    // Con la anulación sin efecto, lo que se puede hacer lo dice la base (no se inventa aquí): su frase de por qué no se anula completo (motivo_no_anulacion) y, si admite_notas,
    // la opción de devolver una parte o corregir un monto. Con la nota de débito 01 aceptada la base sí admite devoluciones y correcciones; mientras Hacienda no la acepta, no.
    zonaBloqueo.replaceChildren(h('div.an-bloqueo', { role: 'alert' },
      h('p.an-bloqueo-tit', sinEfecto ? 'La anulación de este documento se dejó sin efecto' : yaAnulada ? 'Este documento ya está anulado' : 'Este documento no se puede anular completo'),
      sinEfecto ? h('p', `Con la nota de débito N.° ${numeroCorto(sinEfecto.consecutivo)}, el documento vuelve a valer.`)
        : yaAnulada ? h('p', textoNota(yaAnulada)) : null,
      h('p', permiso.motivo),
      notas ? h('div.an-notas-caja', h('div.an-etq', 'Notas que ya tiene este documento'), notas) : null,
      avisoParcial(s, true)));
    seguir.disabled = true; seguir.textContent = rotuloSeguir();
    error.hidden = true;
    if (yaAnulada && !sinEfecto) Promise.resolve(alTerminar?.(null)).catch(() => { /* la lista se actualiza sola en unos segundos */ }); // ya estaba anulado: la lista debe ponerse al día
  }).catch(() => {}).finally(() => { saldosListos = true; });
  return m;

  function resultado(nc, { motivo, yaExistia }) {
    const codigo = codigoDeNota(nc);
    const clienteMal = !yaExistia && motivo === M_CLIENTE;
    // reimprimirComprobante pregunta Tiquete o Factura carta e imprime con el formato de la nota de crédito
    const imp = nc?.id ? h('button.btn', { type: 'button', onclick: () => { reimprimirComprobante(nc.id); } }, 'Imprimir la nota de crédito') : null;
    // Copia los productos de la venta anulada a una cuenta nueva y recién entonces abre Facturación (fx_venta_clonar_con_cliente). Si la copia falla NO se abre Facturación ni se manda a armar la venta a mano:
    // se muestra lo que dijo la base y un botón «Intentar de nuevo» (la base no duplica: si la copia ya se había creado, devuelve esa misma).
    const fallo = h('div.an-clon-fallo', { hidden: true, role: 'alert' });
    let enCopia = false, yaCorregida = false;
    const copiar = async (ventaId, clienteId) => {
      if (enCopia) return;
      enCopia = true; fallo.hidden = true;
      let rr;
      try { rr = await copiarVentaParaRehacer(ventaId, clienteId); } finally { enCopia = false; }
      if (rr.ok) { r.cerrar(); abrirCuentaNueva(app, rr.id, toast, rr.sinCliente); return; }
      fallo.replaceChildren(...[h('p', rr.motivo === 'ya_corregida' ? (/no hace falta/i.test(rr.mensaje) ? null : h('b', 'No hace falta hacer la venta de nuevo. ')) : h('b', 'No se pudo copiar la venta. '), rr.mensaje),
        rr.motivo === 'ya_corregida' || rr.sinReintento ? null : rr.motivo === 'sin_funcion' ? h('button.btn', { type: 'button', onclick: () => { r.cerrar(); app.ir('caja'); } }, 'Ir a Facturación')
          : h('button.btn.primario', { type: 'button', 'data-reintentar-copia': '1', onclick: () => copiar(ventaId, clienteId) }, 'Intentar de nuevo')].filter(Boolean)); // replaceChildren escribiría «null» como texto
      fallo.hidden = false;
      if (rr.motivo === 'ya_corregida') { yaCorregida = true; r.el.querySelectorAll('[data-hacer-de-nuevo]').forEach((x) => { x.disabled = true; }); }
      try { fallo.scrollIntoView({ block: 'nearest' }); } catch { /* nada */ }
    };
    const hacer = (texto, clase, conCliente) => {
      const b = h('button.btn' + (clase ? '.' + clase : ''), { type: 'button', 'data-hacer-de-nuevo': '1', onclick: async () => {
        b.disabled = true;
        try {
          const ventaId = d.venta_id || original?.venta_id || (await app.api.comprobante(d.id))?.venta_id;
          if (conCliente) { selectorCliente(app, { titulo: 'Elegir el cliente de la venta nueva', alElegir: (cl) => { copiar(ventaId, cl?.id); } }); b.disabled = false; return; }
          await copiar(ventaId, null);
          if (!yaCorregida) b.disabled = false; // si la base dice que la venta ya se corrigió, el botón queda apagado
        } catch (e) { toast(mensajeAmable(e), 'error', 7000); b.disabled = false; }
      } }, texto);
      return b;
    };
    const ver = alVerNC && nc ? h('button.btn', { type: 'button', onclick: () => { r.cerrar(); alVerNC(nc); } }, 'Ver la nota de crédito') : null;
    const estadoTxt = !nc ? 'No se pudo leer la nota. Revísela en la lista.'
      : nc.estado === 'aceptado' ? 'Hacienda ya la aceptó.' : 'Se enviará a Hacienda y su estado cambiará solo en la lista. No tiene que hacer nada más.';
    const botones = clienteMal
      ? [hacer('Elegir el cliente correcto y hacer la venta de nuevo', 'primario', true), hacer('Hacer la venta de nuevo sin cambiar el cliente', '', false)]
      : [hacer('Hacer la venta de nuevo en Facturación', '', false)];
    const r = modal({ titulo: yaExistia ? 'Este documento ya estaba anulado' : 'Anulación registrada', ancho: 600, contenido: h('div.an-dlg',
      h('div.an-ok',
        h('b', nc ? `Nota de crédito N.° ${numeroCorto(nc.consecutivo)}` : 'Nota de crédito'),
        h('div', `Anula ${nombre} N.° ${numeroCorto(d.consecutivo)} por ${money(d.total)}.`),
        textoCodigoNota(codigo) ? h('div.an-codigo', 'Tipo de nota: ' + textoCodigoNota(codigo)) : null,
        yaExistia ? h('div', 'Ya estaba anulado (quizás desde otro aparato). No se creó otra nota.') : null),
      h('p', estadoTxt),
      yaExistia ? null : bloqueDinero(motivo, pagosDe(original)),
      fallo,
      soporta07 ? h('p.tenue', `Si hace la venta de nuevo, la venta nueva llevará el ${TEXTO_07}.`) : null,
      h('div.an-botones', imp, ...botones, ver, h('button.btn', { type: 'button', onclick: () => r.cerrar() }, 'Cerrar'))) });
  }
}

/* =====================================================================================================================
   Camino guiado: «el cliente pide factura» (de un tiquete) o «corregir el cliente» (de una factura)
   Anula el documento con el motivo «Error en el cliente (cédula o nombre)» y deja en Facturación la venta nueva con los mismos productos y el cliente elegido.
   Usa fx_venta_clonar_con_cliente (sql/21h). El dinero no se mueve: el cliente ya pagó y en la venta nueva se registra el mismo pago.
   ===================================================================================================================== */
export function cambiarCliente(app, d, { alTerminar } = {}) {
  if (enCurso.has(d.id)) { toast('Ya hay una ventana abierta para este documento.', 'error'); return null; }
  enCurso.add(d.id);
  const esTiquete = d.tipo_doc === '04';
  const nombre = conArticulo(d.tipo_doc);
  const razon = esTiquete ? RAZON_FACTURA : RAZON_CORREGIR;
  let estado = d.estado || 'aceptado', cliente = null, nc = null, original = null, enVuelo = false, vivo = true, soporta07 = false, yaCorregida = false;
  let saldos = null; // fx_comprobante_saldos: si dice que no se puede anular completo, este camino tampoco sirve (también anula)
  let notaSinEfecto = null; // la nota de débito que dejó sin efecto la anulación de este documento, si la hay
  const pagos = () => pagosDe(original);
  const sinPermiso = () => { const p = permiteAnular(saldos); return estado === 'aceptado' && !nc && p.sabe && !p.permite ? p : null; };

  const clienteBox = h('div.an-cliente');
  const pasos = h('ol.an-pasos');
  const aviso = h('div.an-aviso', { hidden: true });
  const error = h('div.error-caja', { hidden: true, role: 'alert' });
  const porque = h('p.an-porque');
  const principal = h('button.btn.primario.grande', { type: 'button', onclick: () => seguir() }, '');
  const volver = h('button.btn', { type: 'button', onclick: () => m.cerrar() }, 'Volver sin cambiar nada');

  const elegirCliente = () => selectorCliente(app, { titulo: 'Elegir el cliente de la factura', alElegir: (cl) => { cliente = cl; error.hidden = true; pintar(); } });

  function pintar() {
    const rechazado = estado === 'rechazado';
    clienteBox.replaceChildren(cliente
      ? h('div.an-cliente-ok', h('div', h('b', nombrePropio(cliente.nombre)), h('div.tenue', [cliente.identificacion, cliente.correo].filter(Boolean).join(' · '))), h('button.btn', { type: 'button', disabled: enVuelo, onclick: elegirCliente }, 'Cambiar de cliente'))
      : h('button.btn.primario', { type: 'button', disabled: enVuelo, onclick: elegirCliente }, 'Elegir al cliente'));
    pasos.replaceChildren(...[
      h('li', h('b', 'Elija al cliente. '), 'Es el que saldrá en la factura.', clienteBox),
      rechazado ? null : h('li', h('b', `Se anula ${nombre} N.° ${numeroCorto(d.consecutivo)} `), `con una nota de crédito por ${money(d.total)}. Tipo de nota: ${textoCodigoNota('01')}. Motivo: ${M_CLIENTE}.`),
      h('li', h('b', 'Se deja lista la venta de nuevo '), 'en Facturación, con los mismos productos y ese cliente. Usted solo cobra: ponga el mismo pago que el cliente ya hizo' + (pagos().length ? ` (${pagoTxt(pagos())})` : '') + '.'
        + (soporta07 ? ` La venta nueva llevará el ${TEXTO_07}.` : ''))].filter(Boolean));
    aviso.hidden = true;
    if (estado === 'pendiente' || estado === 'enviado') {
      aviso.hidden = false; aviso.className = 'an-aviso espera';
      aviso.replaceChildren(h('p', h('b', 'Hacienda todavía no acepta este documento. '), 'Una nota de crédito solo se puede hacer sobre un documento que Hacienda ya aceptó. Mientras tanto puede elegir al cliente y dejar esta ventana abierta: se actualiza sola y el botón se habilitará cuando Hacienda lo acepte. También puede atender a otros clientes y volver aquí.'));
    } else if (estado === 'error') {
      aviso.hidden = false; aviso.className = 'an-aviso espera';
      aviso.replaceChildren(h('p', h('b', 'Este documento todavía no llegó a Hacienda. '), 'Cierre esta ventana, abra el documento y toque «Reenviar a Hacienda». Cuando Hacienda lo acepte podrá seguir.'));
    } else if (rechazado) {
      aviso.hidden = false; aviso.className = 'an-aviso';
      aviso.replaceChildren(h('p', h('b', 'Hacienda no aceptó este documento. '), 'No necesita nota de crédito: solo hay que hacer la venta de nuevo con el cliente correcto.'));
    } else if (nc) {
      aviso.hidden = false; aviso.className = 'an-aviso ok';
      aviso.replaceChildren(h('p', h('b', `El documento ya quedó anulado con la nota de crédito N.° ${numeroCorto(nc.consecutivo)}. `), 'Falta dejar lista la venta nueva con el cliente elegido.'));
    } else if (sinPermiso()) {
      aviso.hidden = false; aviso.className = 'an-aviso';
      const notas = listaNotas(saldos);
      aviso.replaceChildren(...[h('p', h('b', 'Este documento no se puede anular completo. ')),
        // Con la anulación sin efecto el documento vuelve a valer; por qué no se anula completo otra vez lo dice la base (motivo_no_anulacion), tal cual
        notaSinEfecto ? h('p', `La anulación se dejó sin efecto con la nota de débito N.° ${numeroCorto(notaSinEfecto.consecutivo)}, así que el documento vuelve a valer.`) : null,
        h('p', sinPermiso().motivo),
        ...(notas ? [h('div.an-etq', 'Notas que ya tiene este documento'), notas] : [])].filter(Boolean)); // replaceChildren escribiría «null» como texto
    }
    const puede = !!cliente && (estado === 'aceptado' || rechazado || !!nc) && !enVuelo && !sinPermiso() && !yaCorregida;
    principal.disabled = !puede;
    principal.textContent = enVuelo ? 'Trabajando, espere…' : nc ? 'Dejar lista la venta nueva con este cliente' : rechazado ? 'Hacer la venta de nuevo con este cliente'
      : esTiquete ? 'Anular el tiquete y armar la factura' : 'Anular la factura y armarla con el cliente correcto';
    porque.textContent = puede || enVuelo ? '' : yaCorregida ? 'La venta nueva ya existe. Cierre esta ventana.' : sinPermiso() ? 'No se puede seguir con este documento. Lea el aviso de arriba.' : !cliente ? 'Primero elija al cliente.' : 'Todavía no se puede seguir: espere a que Hacienda acepte el documento.';
    volver.disabled = enVuelo;
  }

  async function seguir() {
    if (enVuelo || !cliente) return;
    enVuelo = true; error.hidden = true; pintar();
    try {
      if (!nc && estado === 'aceptado') {
        const ok = await confirmarAnulacion(d, razon, soporta07);
        if (!ok) return;
        const r = await emitirNota(app, d, razon);
        nc = r.nc;
        if (!nc) throw new FalloNota('La nota quedó creada pero no se pudo leer. Revise la lista y toque «Hacer la venta de nuevo» desde el documento anulado.');
        try { await alTerminar?.(nc); } catch { /* la lista se actualiza sola */ }
      }
      const ventaId = d.venta_id || original?.venta_id || (await app.api.comprobante(d.id))?.venta_id;
      const nueva = ventaId ? await ventaClonarConCliente(ventaId, cliente.id) : null;
      const id = nueva?.venta?.id || nueva?.id || null;
      if (!id) throw new FalloNota('La copia automática de la venta todavía no está activada. En Facturación tendrá que armarla otra vez.');
      if (nueva.sinCliente) throw new FalloNota('La venta se copió, pero esta versión no puede ponerle el cliente. Elíjalo en Facturación.');
      try { sessionStorage.setItem('fx.caja.abrir', String(id)); } catch { /* sin almacenamiento: Facturación abre la cuenta sola si puede */ }
      vivo = false; enCurso.delete(d.id);
      m.cerrar();
      app.ir('caja');
    } catch (e) {
      error.hidden = false;
      const msg = e instanceof FalloNota ? e.message : mensajeAmable(e);
      // Si la base dice que la venta ya se corrigió con otra venta cobrada, repetir no sirve: se dice con palabras y el botón se apaga
      if (nc && !(e instanceof FalloNota) && /ya se corrigi[oó] con/i.test(msg)) { yaCorregida = true; error.textContent = 'El documento ya quedó anulado. ' + msg + ' No hace falta hacer la venta de nuevo.'; }
      else error.textContent = !nc ? msg : 'El documento ya quedó anulado. ' + (e instanceof FalloNota ? msg : 'No se pudo dejar lista la venta nueva. ' + msg + ' Toque el botón de abajo para intentarlo de nuevo.');
    } finally { enVuelo = false; if (vivo) pintar(); }
  }

  const m = modal({ titulo: esTiquete ? 'El cliente pide factura' : 'Corregir el cliente de la factura', ancho: 640,
    alCerrar: () => { vivo = false; enCurso.delete(d.id); clearInterval(reloj); },
    bloqueo: () => (enVuelo ? 'Espere un momento: se está trabajando en el documento.' : ''),
    contenido: h('div.an-dlg',
      h('div.an-compruebe', 'Documento que se va a cambiar:'),
      resumenDoc(d),
      pasos,
      h('div.an-dinero', h('div.an-etq', 'Qué hacer con el dinero'), h('p', 'No hay que devolver dinero ni cobrar otra vez al cliente: ya pagó. El cierre de caja descuenta el efectivo del documento anulado y suma el de la venta nueva, así que queda igual. No anote nada como salida de efectivo.')),
      aviso) });
  const reloj = setInterval(async () => {
    if (!vivo || enVuelo || document.hidden || estado === 'aceptado' || estado === 'rechazado' || nc) return;
    try { const c = await app.api.comprobante(d.id); if (vivo && c?.estado && c.estado !== estado) { estado = c.estado; pintar(); } } catch { /* se vuelve a intentar */ }
  }, 5000);
  app.api.comprobante(d.id).then((c) => { if (!vivo) return; original = c; soporta07 = sustituyeSoportado(c); if (c?.estado) estado = c.estado; pintar(); }).catch(() => {});
  // Si el documento ya estaba anulado (desde otro aparato), se sigue desde ahí: solo falta dejar lista la venta nueva
  // La anulación puede haberse dejado sin efecto con una nota de débito (cuelga de la nota de crédito): entonces el documento vuelve a valer, NO está anulado, y no se debe dejar lista una venta nueva
  saldosDe(d.id).then(async (s) => {
    if (!vivo || !s) return;
    saldos = s;
    const ya = anulacionDeSaldos(s);
    const sinEfecto = !nc ? (sinEfectoDeSaldos(s) || (ya ? sinEfectoDeSaldos(await saldosDe(ya.id)) : null)) : null; // desde fx_23i los saldos del documento ya traen la nota de débito 01
    if (!vivo) return;
    if (ya && !nc && !sinEfecto) nc = ya;
    notaSinEfecto = sinEfecto;
    pintar();
  }).catch(() => {});
  m.el.append(h('div.modal-pie.an-pie', error, porque, volver, principal));
  ignorarToqueDeFondo(m);
  pintar();
  return m;
}
