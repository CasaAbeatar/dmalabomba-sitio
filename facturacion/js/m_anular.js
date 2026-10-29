// Anular con nota de crédito: la ventana de motivos, la confirmación y el resultado. La usa la ventana «Anular y reimprimir» (m_documentos.js),
// tanto desde el botón «Anular» de cada fila como desde el detalle de un documento. Ya no es un módulo con lista propia.
// Anular = nota de crédito por el total que referencia el documento original (código 01 "Anula documento de referencia"
// y la razón escrita, como exige Hacienda). El documento original no se borra.
import { h, money, modal, toast, confirmar, nombrePropio, horaCorta } from './util.js';
import { hacerVentaDeNuevo } from './api_documentos.js';
import { reimprimirComprobante, numeroCorto } from './imprimir.js';

if (!document.querySelector('link[data-fx-anular]')) document.head.append(h('link', { rel: 'stylesheet', href: new URL('../css/anular.css', import.meta.url).href, 'data-fx-anular': '1' }));

const NOMBRE_TIPO = { '01': 'Factura', '04': 'Tiquete' };
const conArticulo = (tipo) => (tipo === '01' ? 'la factura electrónica' : 'el tiquete electrónico');

// Motivos frecuentes. Hacienda pide que la nota de crédito diga por qué se anula (la razón puede tener hasta 180 letras).
const MOTIVOS = [
  'Error en el cliente (cédula o nombre)',
  'Error en el precio',
  'Error en los productos o en las cantidades',
  'El cliente devolvió la compra',
  'Se cobró dos veces',
  'Otro motivo',
];

// d: { id, tipo_doc ('01' | '04'), consecutivo, total, fecha_emision, cliente?, venta_id? }
// opciones.alTerminar(nc): se llama cuando la nota de crédito ya quedó creada (la lista vuelve a cargarse).
// opciones.alVerNC(nc): si viene, el resultado ofrece «Ver la nota de crédito».
export function anularDocumento(app, d, { alTerminar, alVerNC } = {}) {
  const nombre = conArticulo(d.tipo_doc);
  const detalleLineas = h('div.an-lineas', h('small.tenue', 'Cargando el detalle…'));
  app.api.comprobante(d.id).then((c) => {
    const ls = c?.lineas_snapshot || [];
    if (!ls.length || !m.el.isConnected) { detalleLineas.replaceChildren(); return; }
    detalleLineas.replaceChildren(...[h('div.an-lineas-tit', 'Lo que se va a dejar sin efecto'),
      ...ls.slice(0, 10).map((l) => h('div.an-linea', h('span', `${Number(l.cantidad) || 1} × ${l.descripcion || l.nombre || 'Producto'}`), h('span.der', money(l.total ?? l.total_linea ?? 0)))),
      ls.length > 10 ? h('small.tenue', `y ${ls.length - 10} líneas más`) : null].filter(Boolean));
  }).catch(() => detalleLineas.replaceChildren());

  let elegido = null;
  const detalle = h('input.campo', { type: 'text', maxlength: 150, placeholder: 'Escriba aquí qué pasó', 'aria-label': 'Detalle del motivo' });
  const etqDetalle = h('label.etq', h('span.an-etq-det', 'Cuente brevemente qué pasó'), detalle);
  const error = h('div.error-caja', { hidden: true, role: 'alert' });
  const botonesMotivo = MOTIVOS.map((t) => h('button.btn.atajo', { type: 'button', 'aria-pressed': 'false', onclick: () => {
    elegido = t;
    botonesMotivo.forEach((b) => b.setAttribute('aria-pressed', String(b.textContent === t)));
    error.hidden = true;
    etqDetalle.querySelector('.an-etq-det').textContent = t === 'Otro motivo' ? 'Escriba cuál fue el motivo (obligatorio)' : 'Detalle (opcional)';
    detalle.focus();
  } }, t));

  const volver = h('button.btn', { type: 'button', onclick: () => m.cerrar() }, 'No anular, volver');
  const seguir = h('button.btn.peligro.grande', { type: 'button', onclick: async () => {
    const det = detalle.value.trim();
    if (!elegido) { error.textContent = 'Escoja uno de los motivos de arriba.'; error.hidden = false; return; }
    if (elegido === 'Otro motivo' && det.length < 5) { error.textContent = 'Escriba cuál fue el motivo (mínimo 5 letras).'; error.hidden = false; detalle.focus(); return; }
    // Hacienda guarda esta razón en la nota de crédito: motivo, y el detalle si lo hay (máximo 180 letras)
    const razon = (elegido === 'Otro motivo' ? det : elegido + (det ? ': ' + det : '')).slice(0, 180);
    error.hidden = true;
    seguir.disabled = true;
    try {
      const ok = await confirmar(`Se va a crear la nota de crédito por ${money(d.total)} que anula ${nombre} N.° ${numeroCorto(d.consecutivo)}. Motivo: ${razon}. Esto no se puede deshacer. ¿Anular de verdad?`, { si: 'Sí, anular', no: 'No, volver', peligro: true });
      if (!ok) return;
      const nc = await app.api.notaCredito(d.id, razon, app.terminal);
      m.cerrar();
      resultado(nc);
      try { await alTerminar?.(nc); } catch { /* la lista se actualiza sola en unos segundos */ }
    } catch (e) { toast(e.message || String(e), 'error', 7000); } finally { seguir.disabled = false; }
  } }, 'Anular');

  const m = modal({ titulo: 'Anular ' + (d.tipo_doc === '01' ? 'factura' : 'tiquete'), ancho: 620,
    contenido: h('div.an-dlg',
      h('div.an-resumen',
        h('div', h('b', `${NOMBRE_TIPO[d.tipo_doc]} N.° ${numeroCorto(d.consecutivo)}`), h('span.tenue', ' · ' + horaCorta(d.fecha_emision))),
        h('div', d.cliente ? nombrePropio(d.cliente) : 'Consumidor final'),
        h('div.an-resumen-total', money(d.total))),
      detalleLineas,
      h('div.an-explica',
        h('p', h('b', 'Qué pasa si sigue:')),
        h('ul',
          h('li', `Se emite una nota de crédito por ${money(d.total)} que referencia ${nombre} y la deja sin efecto ante Hacienda.`),
          h('li', 'Se anula toda la venta, no una parte. Si hay que cobrar de nuevo, haga la venta nueva en Facturación.'),
          h('li', 'La nota de crédito se envía sola a Hacienda en el próximo minuto.'),
          h('li', 'El cierre de caja descuenta de la caja el efectivo de esta venta. Si hay que devolver dinero al cliente, sáquelo de la caja.'))),
      h('div.an-etq', '¿Por qué se anula? (Hacienda lo pide)'),
      h('div.an-motivos', botonesMotivo),
      etqDetalle) });
  // Los dos botones quedan fuera de la parte que se desplaza: se ven siempre, aunque la ventana sea más alta que la pantalla
  m.el.append(h('div.modal-pie.an-pie', error, volver, seguir));
  return m;

  function resultado(nc) {
    // reimprimirComprobante pregunta Tiquete o Factura carta y imprime con el formato de la nota de crédito
    const imp = h('button.btn.primario', { type: 'button', onclick: () => { reimprimirComprobante(nc.id); } }, 'Imprimir la nota de crédito');
    // Copia las líneas de la venta anulada a una cuenta nueva y abre Facturación (fx_venta_clonar). Si la copia no se puede, igual abre Facturación y avisa.
    const nueva = h('button.btn', { type: 'button', onclick: async () => {
      nueva.disabled = true;
      try { const ventaId = d.venta_id || (await app.api.comprobante(d.id))?.venta_id; r.cerrar(); await hacerVentaDeNuevo(app, ventaId, toast); }
      catch (e) { toast(e.message || String(e), 'error', 7000); nueva.disabled = false; }
    } }, 'Hacer la venta de nuevo en Facturación');
    const ver = alVerNC ? h('button.btn', { type: 'button', onclick: () => { r.cerrar(); alVerNC(nc); } }, 'Ver la nota de crédito') : null;
    const r = modal({ titulo: 'Listo, quedó anulada', ancho: 560, contenido: h('div.an-dlg',
      h('div.an-ok', h('b', `Se creó la nota de crédito N.° ${numeroCorto(nc.consecutivo)}.`), h('div', `Anula ${nombre} N.° ${numeroCorto(d.consecutivo)} por ${money(d.total)}.`)),
      h('p', nc.estado === 'aceptado' ? 'Hacienda ya la aceptó.' : 'Se enviará a Hacienda en el próximo minuto y su estado cambia solo.'),
      h('div.an-botones', imp, nueva, ver, h('button.btn', { type: 'button', onclick: () => r.cerrar() }, 'Cerrar'))) });
  }
}
