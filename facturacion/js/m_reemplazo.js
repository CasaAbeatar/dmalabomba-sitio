// «Reemplazar Factura Electrónica #N»: de un documento rechazado por Hacienda (o que no llegó a Hacienda, o que se anuló con nota de crédito) a un documento nuevo corregido, en un solo paso.
// Una sola ventana: el aviso de que reemplaza un documento, el motivo del rechazo en palabras simples y qué conviene hacer, el cliente (se puede cambiar o corregir allí mismo),
// el pago y los productos ya cargados, y un solo botón «Generar». No se rehace la venta: se copia sola y el pago se repite igual.
// La base (fx_reemplazar_documento, o en su defecto fx_venta_clonar + fx_cobrar_reemplazo) deja el documento nuevo con consecutivo nuevo y la referencia al anterior.
import { h, money, modal, toast, nombrePropio, traducirHacienda, describirEstado, TIPOS_ID, MEDIOS } from './util.js';
import { abrirFormCliente, selectorCliente } from './ui_cliente.js';
import { numeroCorto, NOMBRES_DOCUMENTO, imprimirComprobante } from './imprimir.js';
import { leerTurno, abrirCajaAhora } from './caja_nota.js';
import { mensajeAmable } from './api_documentos.js';
import { explicarRechazoConClaude } from './claude_ayuda.js';
import { reemplazarDocumento, tipoDeReemplazo } from './api_reemplazo.js';

if (!document.querySelector('link[data-fx-reemplazo]')) document.head.append(h('link', { rel: 'stylesheet', href: new URL('../css/reemplazo.css', import.meta.url).href, 'data-fx-reemplazo': '1' }));

// El aviso rojo, con asteriscos, como lo pide la operación. Según el motivo del reemplazo.
const AVISO = {
  rechazado: '***Este proceso reemplaza un documento rechazado***',
  error: '***Este proceso reemplaza un documento que no llegó a Hacienda***',
  anulado: '***Este proceso reemplaza un documento anulado***',
  aceptado: '***Este proceso anula el documento con una nota de crédito y emite uno nuevo***',
};
// Motivos de la nota de crédito cuando el documento está aceptado (los mismos de «Anular»). «Se cobró dos veces» no genera documento nuevo: va solo a la nota de crédito.
const MOTIVOS_NC = ['Error en el cliente (cédula o nombre)', 'Error en el detalle de los productos', 'Error en el precio o el monto', 'Otro motivo'];
const M_DOBLE = 'Se cobró dos veces';
const redondea = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const enCurso = new Set();
const pagoTxt = (p) => (MEDIOS[p.medio] || p.medio) + (p.referencia ? ' (ref. ' + p.referencia + ')' : '');

// Qué conviene hacer según lo que dijo Hacienda. Es una guía fija y sin costo: reconoce el texto de Hacienda y da el siguiente paso en palabras simples.
// Lo que no reconoce no inventa nada: se queda con el texto de Hacienda y el botón «Explicar con IA» (solo administración).
const QUE_HACER = [
  [/identificaci[oó]n del receptor|c[eé]dula/i, 'La cédula o el nombre del cliente no coinciden con lo que Hacienda tiene. Toque «Corregir los datos del cliente»: allí puede consultar la cédula en Hacienda y traer el nombre y la actividad correctos.'],
  [/actividad econ[oó]mica/i, 'La actividad económica del cliente no está registrada en Hacienda. Toque «Corregir los datos del cliente» y elija la actividad que Hacienda tiene para él.'],
  [/ya existe.*consecutiv|consecutiv.*ya existe|^-99$/i, 'Con el número no hay que hacer nada: el documento nuevo sale con un número nuevo, que el sistema pone solo.'],
  [/provincia, cant[oó]n y distrito|^-37$/i, 'Este aviso es del domicilio de la empresa en Hacienda, no de este documento; lo corrige la persona encargada en el RUT.'],
  [/firma|llave/i, 'La firma del documento no es de la empresa. Hay que avisar a la persona encargada: con este documento nuevo se repetiría lo mismo.'],
  [/CAByS|cabys/i, 'Un producto tiene un código CABYS que Hacienda no reconoce. Hay que corregirlo en el catálogo de productos y luego hacer la venta de nuevo en Facturación.'],
  [/total|suma|no coincide con/i, 'Los montos del documento no cuadran entre sí. Hay que avisar a la persona encargada antes de generarlo otra vez.'],
];
export function queHacer(items) {
  const vistos = new Set(), r = [];
  for (const it of items) {
    const clave = (it.codigo || '') + ' ' + (it.original || '');
    const hit = QUE_HACER.find(([re]) => re.test(clave));
    if (hit && !vistos.has(hit[1])) { vistos.add(hit[1]); r.push(hit[1]); }
  }
  return r;
}

const datosCliente = (cl) => cl ? [TIPOS_ID[cl.tipo_id] ? TIPOS_ID[cl.tipo_id] + ' ' + (cl.identificacion || '') : cl.identificacion, cl.correo ? 'Correo: ' + cl.correo : null].filter(Boolean) : [];
// Lo que le falta al cliente para poder facturarle (la base lo exige al cobrar). Se dice antes, con palabras, y se apaga «Generar».
function faltasDelCliente(cl) {
  if (!cl) return [];
  const f = [];
  if (/^0+$/.test(String(cl.identificacion || ''))) f.push('la cédula está pendiente (en ceros)');
  if (['01', '02', '03', '04'].includes(cl.tipo_id) && !String(cl.correo || '').trim()) f.push('falta el correo, que es adonde se envía la factura');
  if (cl.activo === false) f.push('el cliente está desactivado');
  return f;
}

export function abrirReemplazo(app, comprobante, { nc = null, alTerminar, alVerNuevo, alSoloAnular } = {}) {
  const c = comprobante;
  const motivoTipo = tipoDeReemplazo(c, nc);
  if (!motivoTipo) { toast('Este documento no se puede reemplazar desde aquí.', 'error'); return null; }
  if (enCurso.has(c.id)) { toast('Ya hay una ventana abierta para este documento.', 'error'); return null; }
  enCurso.add(c.id);

  const nombreDoc = NOMBRES_DOCUMENTO[c.tipo_doc] || 'Documento';
  const tituloDoc = nombreDoc.replace(/(^|\s)(\p{L})/gu, (_, a, b) => a + b.toUpperCase()); // «Factura Electrónica», como en la pantalla que se usa hoy
  const num = numeroCorto(c.consecutivo);
  const snapshot = c.cliente_snapshot && c.cliente_snapshot.id ? c.cliente_snapshot : null;
  let cliente = snapshot;                 // el cliente que llevará el documento nuevo
  let turno = 'desconocido', enVuelo = false, vivo = true, hecho = null;
  const actividadFactura = snapshot && snapshot.actividad_por_factura ? snapshot.actividad_codigo : null;

  /* ---------- piezas de la pantalla ---------- */
  const th = traducirHacienda(c.mensaje);
  // La causa primero; el aviso -37 (domicilio de la empresa) al final, como en el detalle
  const items = [...th.items.filter((i) => i.codigo !== '-37'), ...th.items.filter((i) => i.codigo === '-37')];
  const aviso = h('div.rp-aviso', { role: 'note' }, AVISO[motivoTipo]);

  // Motivo de la nota de crédito (solo documento aceptado): obligatorio, de 3 a 180 letras. «Se cobró dos veces» no emite documento nuevo.
  let motivoNC = '', otroNC = '';
  const textoMotivoNC = () => (motivoNC === 'Otro motivo' ? otroNC.trim() : motivoNC);
  const zonaMotivoNC = h('div.rp-motivo-nc');
  function pintarMotivoNC() {
    const sel = h('select.campo', { 'aria-label': 'Motivo de la nota de crédito', onchange: (e) => { motivoNC = e.target.value; pintarMotivoNC(); pintarPie(); } },
      h('option', { value: '' }, 'Elija por qué se corrige…'), MOTIVOS_NC.map((m) => h('option', { value: m }, m)));
    sel.value = motivoNC;
    zonaMotivoNC.replaceChildren(...[h('label.rp-etq', h('span', 'Por qué se corrige (Hacienda lo pide en la nota de crédito)'), sel),
      motivoNC === 'Otro motivo' ? h('input.campo', { type: 'text', maxlength: 160, placeholder: 'Escriba el motivo (3 a 160 letras)', 'aria-label': 'Otro motivo', value: otroNC, oninput: (e) => { otroNC = e.target.value; pintarPie(); } }) : null,
      alSoloAnular ? h('p.tenue.rp-doble', `Si el problema fue que se cobró dos veces, no hace falta documento nuevo: `, h('button.btn.enlace', { type: 'button', onclick: () => { m.cerrar(); alSoloAnular(M_DOBLE); } }, 'solo anular con nota de crédito')) : null].filter(Boolean)); // replaceChildren escribiría «null» como texto
  }

  const motivoCaja = (() => {
    if (motivoTipo === 'aceptado') {
      return h('section.rp-bloque', h('h3', 'Qué va a pasar'),
        h('p', `Hacienda ya aceptó este documento, así que no se puede cambiar: se anula con una nota de crédito por ${money(c.total)} y se emite uno nuevo con lo que corrija abajo. Todo en un solo paso: si algo falla, no queda nada a medias.`),
        zonaMotivoNC);
    }
    if (motivoTipo === 'anulado') {
      return h('section.rp-bloque', h('h3', 'Por qué se reemplaza'),
        h('p', `Este documento se anuló con la nota de crédito N.° ${numeroCorto(nc?.consecutivo)}. El documento nuevo lo reemplaza y llevará la referencia a él.`));
    }
    const sec = h('section.rp-bloque.rp-motivo', h('h3', motivoTipo === 'error' ? 'Por qué no llegó a Hacienda' : 'Motivo del rechazo'));
    if (items.length) sec.append(h('ul.rp-lista', items.map((i) => h('li', (i.codigo ? h('b.rp-cod', i.codigo + ' ') : null), i.texto))));
    else sec.append(h('p', c.mensaje ? String(c.mensaje).slice(0, 400) : 'Hacienda no dio un motivo.'));
    const hacer = queHacer(items);
    if (motivoTipo === 'error') hacer.unshift('Este documento nunca llegó a Hacienda, así que no tiene validez. El documento nuevo lleva otro número y reemplaza a este.');
    if (hacer.length) sec.append(h('div.rp-hacer', h('b', 'Qué conviene hacer'), h('ul', hacer.map((x) => h('li', x)))));
    if (c.mensaje) sec.append(h('details.rp-crudo', h('summary', 'Ver el texto original de Hacienda'), h('pre', String(c.mensaje))));
    if (app.admin && c.id && c.estado === 'rechazado') sec.append(explicarRechazoConClaude({ comprobanteId: c.id, rotulo: 'Explicar con IA' }));
    return sec;
  })();

  const zonaCliente = h('section.rp-bloque');
  const faltas = () => faltasDelCliente(cliente);
  function pintarCliente() {
    const f = faltas();
    const esTiquete = c.tipo_doc === '04';
    zonaCliente.replaceChildren(...[
      h('h3', 'Cliente'),
      cliente
        ? h('div.rp-cliente', h('div.rp-cli-datos', h('b', nombrePropio(cliente.nombre)), ...datosCliente(cliente).map((x) => h('span.tenue', x)),
          cliente.verificado === false ? h('span.tenue', 'Sin verificar en Hacienda') : null))
        : h('p.tenue', esTiquete ? 'Sin cliente: sale otro tiquete. Si el cliente pide factura, elíjalo.' : 'Falta elegir al cliente.'),
      f.length ? h('p.rp-falta', { role: 'alert' }, 'Antes de generar: ' + f.join('; ') + '. Toque «Corregir los datos del cliente».') : null,
      h('div.rp-fila-btn',
        cliente ? h('button.btn', { type: 'button', disabled: enVuelo, onclick: corregirCliente }, 'Corregir los datos del cliente') : null,
        h('button.btn', { type: 'button', disabled: enVuelo, onclick: elegirOtro }, cliente ? 'Cambiar de cliente' : (esTiquete ? 'El cliente pide factura: elegirlo' : 'Elegir al cliente')))].filter(Boolean)); // replaceChildren escribiría «null» como texto
    pintarPie();
  }
  // Corregir al mismo cliente: el formulario completo (cédula con consulta a Hacienda, nombre, correo, actividad económica). Lo que se guarda queda también en la ficha del cliente.
  function corregirCliente() {
    abrirFormCliente(app, cliente, { completo: true, titulo: 'Corregir los datos del cliente', alGuardar: (cl) => { cliente = cl; pintarCliente(); toast('Datos del cliente guardados.'); } });
  }
  function elegirOtro() { selectorCliente(app, { titulo: 'Elegir el cliente del documento nuevo', alElegir: (cl) => { if (cl) { cliente = cl; pintarCliente(); } } }); }

  const lineas = (Array.isArray(c.lineas_snapshot) ? c.lineas_snapshot : []).filter((l) => !l.quitada).slice().sort((a, b) => (a.orden || 0) - (b.orden || 0));
  const pagos = (Array.isArray(c.pagos_snapshot) ? c.pagos_snapshot : []).filter((p) => Number(p.monto) > 0);
  // Lo que se puede cambiar en cada línea: el detalle (3 a 200 letras), la cantidad y el precio unitario con IVA. Lo demás (producto, código CABYS, IVA, descuento) se copia igual.
  const edit = new Map(lineas.map((l) => [l.id, { det: l.descripcion || '', cant: String(Number(l.cantidad)), precio: String(Number(l.precio_final)) }]));
  const pctDesc = (l) => (l.descuento && Number(l.descuento.porcentaje) > 0 ? Math.min(100, Number(l.descuento.porcentaje)) : 0);
  const totalLinea = (l) => { const e = edit.get(l.id); const t = redondea(Number(e.cant) * Number(e.precio)); return redondea(t - redondea(t * pctDesc(l) / 100)); };
  const totalNuevo = () => redondea(lineas.reduce((a, l) => a + (Number.isFinite(totalLinea(l)) ? totalLinea(l) : 0), 0));
  const cambioLinea = (l) => { const e = edit.get(l.id); return { det: e.det.trim() !== String(l.descripcion || '').trim(), cant: Number(e.cant) !== Number(l.cantidad), precio: Number(e.precio) !== Number(l.precio_final) }; };
  const hayCambios = () => lineas.some((l) => { const k = cambioLinea(l); return k.det || k.cant || k.precio; });
  const errorLinea = (l) => {
    const e = edit.get(l.id), d = e.det.trim();
    if (d.length < 3) return 'El detalle debe tener al menos 3 letras.';
    if (d.length > 200) return 'El detalle puede tener hasta 200 letras.';
    if (!(Number(e.cant) > 0) || Number(e.cant) > 99999) return 'La cantidad no es válida.';
    if (!(Number(e.precio) > 0) || Number(e.precio) > 99999999.99) return 'El precio no es válido.';
    return '';
  };
  const filasLineas = h('div.rp-tabla', { role: 'table', 'aria-label': 'Productos del documento' });
  const celdaTotal = new Map(), celdaErr = new Map();
  const totalesTxt = h('div.rp-totales');
  const avisoMonto = h('p.rp-monto', { role: 'status', hidden: true });
  function pintarTotales() {
    for (const l of lineas) {
      const k = cambioLinea(l), ce = celdaTotal.get(l.id);
      ce.textContent = money(totalLinea(l)); ce.classList.toggle('cambiado', k.cant || k.precio);
      sincAtajos.get(l.id)?.();
      const er = errorLinea(l), ee = celdaErr.get(l.id); ee.textContent = er; ee.hidden = !er;
    }
    const tn = totalNuevo(), cambia = tn !== redondea(c.total);
    totalesTxt.replaceChildren(h('span', 'Total'), cambia ? h('span.rp-total-cambio', h('s', money(c.total)), ' ', h('b', money(tn))) : h('b', money(c.total)));
    avisoMonto.hidden = !cambia;
    avisoMonto.textContent = !cambia ? '' : pagos.length === 1
      ? `El monto cambia de ${money(c.total)} a ${money(tn)}. El pago (${MEDIOS[pagos[0].medio] || pagos[0].medio}) se ajusta al monto nuevo.`
      : `El monto cambia de ${money(c.total)} a ${money(tn)}, pero el documento se pagó con ${pagos.length} medios y el sistema no adivina cómo repartir la diferencia. Deje el monto igual, o anule con la nota de crédito y haga la venta de nuevo en Facturación.`;
    avisoMonto.classList.toggle('rp-falta', cambia && pagos.length !== 1);
    pintarPie();
  }
  const SUGERENCIAS = ['Servicio de alimentación', 'Desayunos', 'Almuerzos', 'Cenas'];
  const sincAtajos = new Map();
  let filaActiva = null;
  function activar(fila) { if (filaActiva) filaActiva.classList.remove('activa'); filaActiva = fila; fila.classList.add('activa'); }
  filasLineas.append(h('div.rp-th', { role: 'row' }, h('span', 'Cant.'), h('span', 'Descripción y precio'), h('span.der', 'Total')));
  for (const l of lineas) {
    const e = edit.get(l.id);
    const desc = pctDesc(l);
    const iDet = h('input.campo', { type: 'text', maxlength: 200, value: e.det, 'aria-label': 'Descripción de la línea', oninput: (ev) => { e.det = ev.target.value; pintarTotales(); } });
    const iCant = h('input.campo.rp-num', { type: 'number', inputmode: 'decimal', step: '0.001', min: '0', value: e.cant, 'aria-label': 'Cantidad', oninput: (ev) => { e.cant = ev.target.value; pintarTotales(); } });
    const iPre = h('input.campo.rp-num', { type: 'number', inputmode: 'decimal', step: '0.01', min: '0', value: e.precio, 'aria-label': 'Precio unitario con IVA', oninput: (ev) => { e.precio = ev.target.value; pintarTotales(); } });
    const tot = h('span.der.rp-tot'), er = h('small.rp-err', { role: 'alert', hidden: true });
    celdaTotal.set(l.id, tot); celdaErr.set(l.id, er);
    const botonesA = SUGERENCIAS.map((t) => h('button.rp-atajo', { type: 'button', 'aria-pressed': 'false', onclick: () => { e.det = t; iDet.value = t; pintarTotales(); } }, t));
    sincAtajos.set(l.id, () => botonesA.forEach((b, i) => { const on = e.det.trim() === SUGERENCIAS[i]; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }));
    const atajos = h('div.rp-atajos', { role: 'group', 'aria-label': 'Detalle general para esta línea' }, h('span.rp-atajos-t', 'Detalle general'), botonesA);
    const fila = h('div.rp-tr.rp-edit', { role: 'row', onfocusin: () => activar(fila) }, iCant,
      h('span.rp-col', iDet, atajos, h('label.rp-precio', h('small.tenue', 'Precio con IVA'), iPre), desc ? h('small.tenue', desc >= 100 ? 'Cortesía' : 'Descuento ' + String(desc).replace('.', ',') + ' %') : null, er), tot);
    filasLineas.append(fila);
    if (!filaActiva) activar(fila);
  }
  const notaPago = h('p.tenue.rp-nota');
  const zonaDatos = h('section.rp-bloque',
    h('h3', 'Lo que se factura'),
    h('p.tenue.rp-nota', 'Puede corregir el detalle y el monto de cada línea. Lo que no toque sale igual.'),
    filasLineas, totalesTxt, avisoMonto,
    h('dl.rp-datos',
      h('div', h('dt', 'Condición de venta'), h('dd', 'Contado')),
      h('div', h('dt', 'Forma de pago'), h('dd', pagos.length ? pagos.map((p) => h('div', pagoTxt(p) + ': ' + money(p.monto))) : 'Sin pagos registrados'))),
    h('p.tenue.rp-nota', 'El pago se repite igual que en el documento original: el cliente ya pagó, no hay que cobrarle otra vez.'));

  const zonaCaja = h('div.rp-caja', { role: 'status', hidden: true });
  function pintarCaja() {
    zonaCaja.replaceChildren(); zonaCaja.hidden = true;
    if (turno === 'cerrado') {
      zonaCaja.hidden = false;
      zonaCaja.append(h('p', h('b', 'Primero hay que abrir la caja. '), 'El sistema registra el pago del documento nuevo en el turno abierto.'),
        h('button.btn.primario', { type: 'button', onclick: () => abrirCajaAhora(app, { sigue: () => vivo, textoOk: 'Caja abierta. Ya puede generar el documento.', alAbrir: (t) => { turno = t; pintarCaja(); pintarPie(); } }) }, 'Abrir la caja ahora'));
    }
  }

  const error = h('div.error-caja', { hidden: true, role: 'alert' });
  const porque = h('small.rp-porque');
  const volver = h('button.btn', { type: 'button', onclick: () => m.cerrar() }, 'Volver sin cambiar nada');
  const generar = h('button.btn.primario.grande', { type: 'button', onclick: () => ejecutar() }, 'Generar');
  const queHace = h('small.rp-quehace', motivoTipo === 'aceptado' ? 'Se anula este documento con una nota de crédito por el total y se emite uno nuevo con número nuevo y la referencia a este.' : 'Se emite un documento nuevo con número nuevo, con la referencia a este, y este queda reemplazado.');
  function pintarPie() {
    const f = faltas();
    let motivo = '';
    if (!lineas.length || !pagos.length && Number(c.total) > 0) motivo = 'Este documento no trae los productos o el pago guardados; hay que hacer la venta de nuevo en Facturación.';
    else if (motivoTipo !== 'anulado' && !cliente && c.tipo_doc === '01') motivo = 'Primero elija al cliente.';
    else if (f.length) motivo = 'Primero corrija los datos del cliente.';
    else if (lineas.some((l) => errorLinea(l))) motivo = 'Revise las líneas marcadas en rojo.';
    else if (motivoTipo === 'aceptado' && (textoMotivoNC().length < 3 || textoMotivoNC().length > 160)) motivo = 'Elija por qué se corrige el documento: Hacienda lo pide en la nota de crédito.';
    else if (totalNuevo() !== redondea(c.total) && pagos.length !== 1) motivo = 'El monto cambió y el documento se pagó con varios medios: deje el monto igual.';
    else if (turno === 'cerrado') motivo = 'Primero hay que abrir la caja.';
    generar.disabled = enVuelo || !!motivo;
    generar.textContent = enVuelo ? 'Generando, espere…' : 'Generar';
    porque.textContent = motivo;
    volver.disabled = enVuelo;
  }

  async function ejecutar() {
    if (enVuelo) return;
    enVuelo = true; error.hidden = true; pintarPie(); pintarCliente();
    try {
      turno = await leerTurno(app); pintarCaja();
      if (turno === 'cerrado') return;
      const cambios = lineas.flatMap((l) => { const k = cambioLinea(l), e = edit.get(l.id); if (!(k.det || k.cant || k.precio)) return []; return [{ linea: l.id, ...(k.det ? { descripcion: e.det.trim() } : {}), ...(k.cant ? { cantidad: Number(e.cant) } : {}), ...(k.precio ? { precio: Number(e.precio) } : {}) }]; });
      const r = await reemplazarDocumento({ original: c, clienteId: cliente?.id || null, actividad: actividadFactura, esAdmin: !!app.admin, cambios, motivo: motivoTipo === 'aceptado' ? textoMotivoNC() : null });
      hecho = r;
      try { await alTerminar?.(r.comprobante); } catch { /* la lista se actualiza sola */ }
      mostrarResultado(r);
    } catch (e) {
      error.textContent = mensajeAmable(e, 'No se pudo generar el documento nuevo. Revise los datos e intente de nuevo; el documento original no se tocó.');
      error.hidden = false;
      try { error.scrollIntoView({ block: 'nearest' }); } catch { /* nada */ }
    } finally { enVuelo = false; if (vivo && !hecho) { pintarPie(); pintarCliente(); } }
  }

  /* ---------- resultado ---------- */
  function mostrarResultado(r) {
    const n = r.comprobante || {};
    const nuevoNum = numeroCorto(n.consecutivo);
    const estado = h('div.rp-estado'); // se actualiza sola mientras Hacienda responde
    const pintaEstado = (comp) => { const d = describirEstado(comp?.estado, comp?.mensaje); estado.className = 'rp-estado ' + (d.clase || ''); estado.replaceChildren(h('b', d.chip), h('span', comp?.estado === 'rechazado' ? ' ' + (th2(comp) || '') : '')); };
    const th2 = (comp) => traducirHacienda(comp?.mensaje).items.filter((i) => i.codigo !== '-37').map((i) => i.texto).join(' ');
    pintaEstado(n);
    let intentos = 0;
    const reloj = setInterval(async () => {
      if (!vivo || ++intentos > 24 || ['aceptado', 'rechazado'].includes(estado.dataset.fin)) { clearInterval(reloj); return; }
      try { const nuevo = await app.api.comprobante(n.id); pintaEstado(nuevo); if (['aceptado', 'rechazado'].includes(nuevo.estado)) { estado.dataset.fin = nuevo.estado; clearInterval(reloj); } } catch { /* se reintenta */ }
    }, 5000);
    m.el.querySelector('.modal-pie')?.remove();
    const cuerpo = m.el.querySelector('.rp-dlg');
    cuerpo.replaceChildren(
      h('div.rp-ok', h('b', `Listo: ${NOMBRES_DOCUMENTO[n.tipo_doc] || 'documento'} N.° ${nuevoNum}`),
        h('div', `Reemplaza a ${nombreDoc.toLowerCase()} N.° ${num}. Total ${money(n.total ?? c.total)}.`),
        motivoTipo === 'aceptado' ? h('div', `El documento anterior se anuló con una nota de crédito por ${money(c.total)}.`) : null),
      estado,
      h('p.tenue', 'El estado se actualiza solo mientras Hacienda responde. No tiene que hacer nada más.'),
      r.alertaCerrada ? h('p.tenue', 'El aviso rojo de Hacienda del documento anterior quedó cerrado.')
        : (motivoTipo !== 'anulado' ? h('p.tenue', 'El aviso rojo del documento anterior se quita cuando el documento nuevo quede aceptado' + (app.admin ? ', o con «Ya lo atendí».' : '.')) : null),
      h('div.rp-pie', h('button.btn', { type: 'button', onclick: () => imprimirComprobante(n.id, { formato: 'tiquete', copias: 1 }).catch((e) => toast(mensajeAmable(e), 'error', 6000)) }, 'Imprimir'),
        h('button.btn', { type: 'button', onclick: () => { m.cerrar(); alVerNuevo?.(n); } }, 'Ver el documento nuevo'),
        h('button.btn.primario', { type: 'button', onclick: () => m.cerrar() }, 'Cerrar')));
  }

  const m = modal({ titulo: `Reemplazar ${tituloDoc} #${num}`, ancho: 760,
    alCerrar: () => { vivo = false; enCurso.delete(c.id); },
    bloqueo: () => (enVuelo ? 'Espere un momento: se está generando el documento.' : ''),
    contenido: h('div.rp-dlg', aviso, motivoCaja, zonaCliente, zonaDatos, zonaCaja) });
  m.el.append(h('div.modal-pie.rp-pie', error, porque, queHace, volver, generar));
  if (motivoTipo === 'aceptado') pintarMotivoNC();
  pintarCliente(); pintarCaja(); pintarTotales();
  leerTurno(app).then((t) => { if (vivo) { turno = t; pintarCaja(); pintarPie(); } });
  return m;
}
