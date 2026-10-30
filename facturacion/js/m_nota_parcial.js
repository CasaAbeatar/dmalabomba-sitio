// Notas parciales: las tres pantallas que faltaban además de «Anular» (m_anular.js).
//   «Devolver parte»                  -> nota de crédito código 06 (fx_nota_credito_devolucion)
//   «Corregir un monto»               -> código 02: nota de crédito si se cobró de más (fx_nota_credito_monto), nota de débito si se cobró de menos (fx_nota_debito_monto)
//   «Dejar sin efecto la anulación»   -> nota de débito código 01 sobre la nota de crédito de anulación total (fx_nota_debito_sin_efecto)
// Los códigos 13 a 17 no se usan (están apagados). Todos los montos los calcula el servidor: la pantalla manda cantidades o montos por línea y el reparto del dinero,
// y antes de confirmar pide el total con fx_nota_calcular. Los errores de las funciones vienen en español y se muestran con sus mismas palabras (mensajeAmable); solo los números se escriben como en el resto de la pantalla (amigableDelServidor).
// Una nota no se puede deshacer: la pantalla lo dice con calma, avisa del correo y de que Hacienda puede tardar unos minutos.
import { h, money, modal, toast, nombrePropio, fechaCorta, num, leerNumero, MEDIOS, bloqueError, esqueleto, conBoton } from './util.js';
import { saldosEstricto, notaCalcular, notaDevolucion, notaCreditoMonto, notaDebitoMonto, notaDebitoSinEfecto, mensajeAmable } from './api_documentos.js';
import { numeroCorto, reimprimirComprobante } from './imprimir.js';
import { ignorarToqueDeFondo, textoCodigoNota, listaNotas, lineasDevolver } from './m_anular.js';

if (!document.querySelector('link[data-fx-nota-parcial]')) document.head.append(h('link', { rel: 'stylesheet', href: new URL('../css/nota_parcial.css', import.meta.url).href, 'data-fx-nota-parcial': '1' }));

const NOMBRE_TIPO = { '01': 'Factura', '02': 'Nota de débito', '03': 'Nota de crédito', '04': 'Tiquete' };
const OTRO = 'Otro motivo';
const MEDIOS_ORDEN = ['efectivo', 'tarjeta', 'sinpe', 'transferencia'];

/* ---------- Números: todo se calcula en enteros (centavos y milésimas) para no arrastrar decimales ---------- */
export const aCent = (n) => Math.round((Number(n) + Number.EPSILON) * 100) || 0;
export const aMil = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) || 0;
const txtCent = (c) => (c / 100).toFixed(2);                    // lo que viaja al servidor: «1234.50»
const txtMil = (m) => (m / 1000).toFixed(3);                    // «1.500»
const montoPantalla = (c) => (c % 100 === 0 ? String(c / 100) : (c / 100).toFixed(2).replace('.', ',')); // lo que se ve en un campo: «1500» o «1500,50»
const moneyC = (c) => money(c / 100);
const MAX_ENTRADA = 9999999999; // el servidor no acepta más de esto en un número

// Cantidad que escribe una persona: «2», «1,5», «0.250». Hasta 3 decimales, coma o punto como separador decimal, sin separador de miles.
// Devuelve { vacio } | { error } | { mil } (la cantidad en milésimas).
export function leerCantidad(s) {
  const t = String(s ?? '').trim().replace(',', '.');
  if (t === '') return { vacio: true };
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(t)) return { error: 'Escriba solo números, por ejemplo 2 o 1,5.' };
  const [e, d = ''] = t.split('.');
  if (d.length > 3) return { error: 'La cantidad puede tener hasta 3 decimales, por ejemplo 1,250.' };
  if (e.length > 7) return { error: 'Esa cantidad es demasiado grande.' };
  return { mil: Number(e || '0') * 1000 + Number((d + '000').slice(0, 3)) };
}
// Un monto en colones que escribe una persona: «1500», «1 500,50». Devuelve { vacio } | { error } | { cent }
export function leerMonto(s) {
  const t = String(s ?? '').trim();
  if (t === '') return { vacio: true };
  const v = leerNumero(t);
  if (!Number.isFinite(v)) return { error: 'Escriba solo números, por ejemplo 1500 o 1500,50 (hasta 2 decimales).' };
  if (v > MAX_ENTRADA) return { error: 'Ese monto es demasiado grande.' };
  return { cent: Math.round(v * 100) };
}

// Los avisos de la base traen los montos como «₡1000.00» y las cantidades como «1.000» (punto decimal y tres decimales: en Costa Rica «1.000» se lee como mil).
// Aquí se dicen como en el resto de la pantalla, «₡1 000,00» y «1»; las palabras del aviso no se tocan.
export function amigableDelServidor(msg) {
  return String(msg ?? '')
    .replace(/₡\s?(\d+)\.(\d{2})(?!\d)/g, (_, e, d) => money(Number(e + '.' + d)))
    .replace(/(solo tiene |se pidió )(\d+)\.(\d{3})(?!\d)/g, (_, pre, e, d) => pre + num(Number(e + '.' + d)))
    .replace(/(Los pagos \()(\d+)\.(\d{2})(\) no suman el total de la nota \()(\d+)\.(\d{2})(\))/g, (_, a, e1, d1, b, e2, d2, c) => a + money(Number(e1 + '.' + d1)) + b + money(Number(e2 + '.' + d2)) + c)
    // Los productos no están numerados en la pantalla: «La línea 1 (Gallo pinto) solo tiene 0 por devolver y se pidió 1.» se dice con el nombre del producto
    .replace(/\bLa línea \d+ \((.+?)\) solo tiene (.+?) por devolver y se pidió (.+?)\./g, (_, nombre, queda, pidio) => (queda === '0' ? `De «${nombre}» ya no queda nada por devolver y se pidió ${pidio}.` : `De «${nombre}» solo quedan ${queda} por devolver y se pidió ${pidio}.`))
    .replace(/\b[Ll]a línea \d+ \(([^)]+)\)/g, (_, nombre) => `«${nombre}»`);
}
const mensajeDe = (e, defecto) => amigableDelServidor(mensajeAmable(e, defecto));
// En la lista de notas el signo («+» o «−») tiene que quedar pegado a su importe: sin esto, en el celular la línea puede cortarse entre «+» y «₡7 000,00» (se une con U+2060, que no se ve ni ocupa lugar)
const pegarSigno = (lista) => { lista?.querySelectorAll('li').forEach((li) => li.childNodes.forEach((t) => { if (t.nodeType === 3) t.nodeValue = t.nodeValue.replace(/([+\u2212])(\u20a1)/g, '$1\u2060$2'); })); return lista; };

/* ---------- Validaciones (puras, sin pantalla). Las mismas reglas del servidor; el servidor sigue siendo quien manda ---------- */
// lineas: [{ linea, nombre, saldoMil, saldoCent, pfCent }]; texto: Map(linea -> lo escrito).
// Devuelve { items: [{ linea, mil, cent }], errores: Map(linea -> frase), total (centavos) }.
export function validarDevolucion(lineas, texto) {
  const items = [], errores = new Map(); let total = 0;
  for (const l of lineas) {
    if (l.saldoMil <= 0 || l.saldoCent <= 0) continue; // sin cantidad o sin dinero por devolver (una corrección de monto pudo agotar el dinero de la línea) la línea está agotada
    const r = leerCantidad(texto.get(l.linea));
    if (r.vacio) continue;
    if (r.error) { errores.set(l.linea, r.error); continue; }
    if (r.mil <= 0) { errores.set(l.linea, 'Escriba una cantidad mayor que cero, o deje la casilla vacía si no devuelve este producto.'); continue; }
    if (r.mil > l.saldoMil) { errores.set(l.linea, `De este producto solo se pueden devolver ${num(l.saldoMil / 1000)}.`); continue; }
    // Si se devuelve todo lo que queda, se acredita el saldo exacto; si no, cantidad por precio, redondeado hacia arriba desde la mitad (igual que el servidor)
    const cent = r.mil === l.saldoMil ? l.saldoCent : Math.floor((r.mil * l.pfCent + 500) / 1000);
    if (cent <= 0) { errores.set(l.linea, 'Esa cantidad es tan pequeña que no llega a un colón. Escriba una cantidad mayor.'); continue; }
    items.push({ linea: l.linea, mil: r.mil, cent }); total += cent;
  }
  return { items, errores, total };
}
// dir: 'mas' (se cobró de más: nota de crédito) o 'menos' (se cobró de menos: nota de débito).
// lineas: [{ linea, nombre, saldoCent, totCent }]; tope de la nota de débito: lo cobrado en la línea y lo que le queda al documento (totalCent - debitadoCent).
export function validarMontos(lineas, texto, dir, { totalCent = 0, debitadoCent = 0 } = {}) {
  const items = [], errores = new Map(); let total = 0, general = '';
  for (const l of lineas) {
    if (dir === 'mas' && l.saldoCent <= 0) continue;
    const r = leerMonto(texto.get(l.linea));
    if (r.vacio) continue;
    if (r.error) { errores.set(l.linea, r.error); continue; }
    if (r.cent <= 0) { errores.set(l.linea, 'El monto tiene que ser mayor que cero. Si no corrige este producto, deje la casilla vacía.'); continue; }
    if (dir === 'mas' && r.cent > l.saldoCent) { errores.set(l.linea, `De este producto solo se pueden devolver ${moneyC(l.saldoCent)}.`); continue; }
    if (dir === 'menos' && r.cent > l.totCent) { errores.set(l.linea, `No puede pasar de lo que se cobró en este producto (${moneyC(l.totCent)}). Si el cliente debe más que eso, haga una venta nueva por la diferencia.`); continue; }
    if (dir === 'menos' && r.cent > Math.max(totalCent - debitadoCent, 0)) { errores.set(l.linea, `Con las notas de débito que ya tiene, a este documento solo se le pueden cobrar ${moneyC(Math.max(totalCent - debitadoCent, 0))} más en total.`); continue; }
    items.push({ linea: l.linea, cent: r.cent }); total += r.cent;
  }
  if (dir === 'menos' && !errores.size && debitadoCent + total > totalCent) {
    general = `Las notas de débito de este documento sumarían ${moneyC(debitadoCent + total)} y pasarían del monto del documento, ${moneyC(totalCent)}. Si el cliente debe más que eso, haga una venta nueva por la diferencia.`;
  }
  return { items, errores, total, general };
}

/* ---------- Cuánto le queda a cada medio de pago por devolver ---------- */
// El dinero se devuelve por el mismo medio con que se pagó: a cada medio le queda lo que el cliente pagó menos lo que ya se le devolvió en notas de crédito vivas.
// fx_comprobante_saldos trae lo pagado (pagos_originales) pero no lo ya devuelto por medio; se saca de los pagos de esas notas. Solo se consulta cuando el documento ya tiene notas de crédito vivas.
// Si alguna no se puede leer, se usa lo pagado como tope y el servidor lo revisa al guardar (aproximado = true).
export async function capacidadPagos(app, saldos) {
  const mapa = new Map(); let aproximado = false;
  const sumar = (m, medio, c) => m.set(medio, (m.get(medio) || 0) + c);
  for (const p of saldos.pagos_originales || []) sumar(mapa, String(p.medio || '').toLowerCase().trim(), aCent(p.monto));
  const notas = (saldos.notas || []).filter((n) => n.tipo_doc === '03' && n.viva !== false && n.estado !== 'rechazado');
  const leidas = await Promise.all(notas.map((n) => app.api.comprobante(n.id).then((c) => c, () => null)));
  for (const c of leidas) {
    if (!c || !Array.isArray(c.pagos_snapshot)) { aproximado = true; continue; }
    for (const p of c.pagos_snapshot) sumar(mapa, String(p.medio || '').toLowerCase().trim(), -aCent(p.monto));
  }
  for (const [k, v] of [...mapa]) if (v <= 0) mapa.delete(k);
  return { mapa, aproximado };
}

/* ---------- Reparto del dinero entre medios de pago ---------- */
// filas: [{ medio, topeCent (null = sin tope), inicialCent }]. El reparto tiene que sumar exactamente el total de la nota y ningún medio puede pasar de su tope.
// leer() -> { ok, pagos: [{ medio, monto: '1234.50' }], mensaje }
function editorPagos({ totalCent, filas, alCambiar, restablecible = true }) {
  const el = h('div.np-pagos');
  const unico = filas.length === 1;
  const filasUI = filas.map((f) => {
    const input = h('input.campo', { type: 'text', inputmode: 'decimal', autocomplete: 'off', 'data-medio': f.medio, 'aria-label': `Monto por ${MEDIOS[f.medio] || f.medio}`, value: f.inicialCent > 0 ? montoPantalla(f.inicialCent) : '', disabled: unico });
    const error = h('p.np-pago-error', { role: 'alert', hidden: true });
    const tope = f.topeCent != null ? h('small', `Se puede devolver hasta ${moneyC(f.topeCent)} con este medio`) : null;
    const fila = h('div.np-pago', h('div.np-pago-medio', h('b', MEDIOS[f.medio] || f.medio), tope),
      h('div.np-pago-monto', h('span.np-moneda', '₡'), input), error);
    return { f, input, error, fila };
  });
  const suma = h('span.np-pagos-suma');
  const estado = h('b.np-pagos-estado', { 'aria-live': 'polite' });
  const volver = restablecible && !unico ? h('button.btn.chico', { type: 'button', onclick: () => { filasUI.forEach((x) => { x.input.value = x.f.inicialCent > 0 ? montoPantalla(x.f.inicialCent) : ''; }); revisar(); } }, 'Volver al reparto sugerido') : null;
  el.append(...filasUI.map((x) => x.fila), h('div.np-pagos-pie', suma, estado), ...(volver ? [volver] : []));
  function leer() {
    let total = 0, mensaje = '';
    const pagos = [];
    for (const x of filasUI) {
      const r = leerMonto(x.input.value);
      let msg = '';
      if (r.error) msg = r.error;
      else if (!r.vacio && r.cent > 0 && x.f.topeCent != null && r.cent > x.f.topeCent) msg = `No puede pasar de ${moneyC(x.f.topeCent)}: es lo que le queda a este medio.`;
      x.error.textContent = msg; x.error.hidden = !msg;
      x.input.setAttribute('aria-invalid', msg ? 'true' : 'false');
      if (msg) { mensaje = mensaje || msg; continue; }
      if (!r.vacio && r.cent > 0) { total += r.cent; pagos.push({ medio: x.f.medio, monto: txtCent(r.cent) }); }
    }
    if (!mensaje && total !== totalCent) mensaje = total < totalCent ? `Falta repartir ${moneyC(totalCent - total)} para llegar a ${moneyC(totalCent)}.` : `El reparto se pasa por ${moneyC(total - totalCent)}. Tiene que sumar ${moneyC(totalCent)}.`;
    return { ok: !mensaje, pagos, mensaje, total };
  }
  function revisar() {
    const r = leer();
    suma.textContent = `Suma: ${moneyC(r.total)} de ${moneyC(totalCent)}`;
    estado.textContent = r.ok ? 'Cuadra con el total' : r.mensaje;
    estado.className = 'np-pagos-estado ' + (r.ok ? 'ok' : 'mal');
    alCambiar?.(r);
  }
  filasUI.forEach((x) => x.input.addEventListener('input', revisar));
  revisar();
  return { el, leer };
}

/* ---------- Un documento a la vez ---------- */
const enCurso = new Set();
class Fallo extends Error { constructor(m, { dudoso = false } = {}) { super(m); this.dudoso = dudoso; } }
const esDeRed = (e) => e?.transitorio === true || ['red', 'tiempo', 'ocupado'].includes(e?.tipo);

/* ---------- Lo propio de cada pantalla ---------- */
const MOTIVOS = {
  devolucion: ['El cliente devolvió producto', 'El producto llegó en mal estado', 'No era lo que el cliente pidió', OTRO],
  mas: ['Se cobró un precio equivocado', 'No se aplicó un descuento o una promoción', OTRO],
  menos: ['Se cobró menos que el precio correcto', 'Faltó cobrar una parte de la compra', OTRO],
  sinefecto: ['La anulación se hizo por error', 'El cliente no devolvió la compra', OTRO],
};
const EXPLICA_NC = 'Una nota de crédito es un documento que le resta a la factura lo que se devuelve. La factura original no se borra: queda guardada y enlazada a la nota.';
const EXPLICA_NC_MONTO = 'Una nota de crédito es un documento que le resta a la factura lo que se cobró de más. La factura original no se borra: queda guardada y enlazada a la nota.';
const EXPLICA_ND = 'Una nota de débito es un documento que le suma a la factura lo que faltó cobrar. La factura original no se borra: queda guardada y enlazada a la nota.';
const EXPLICA_ND_SIN_EFECTO = 'Una nota de débito es un documento que vuelve a sumar lo que la anulación había restado. La nota de crédito de la anulación no se borra: queda guardada y enlazada a la nota de débito.';

const CON_ARTICULO = { '01': 'la factura', '02': 'la nota de débito', '03': 'la nota de crédito', '04': 'el tiquete' };
const DE_DOC = { '01': 'de la factura', '02': 'de la nota de débito', '03': 'de la nota de crédito', '04': 'del tiquete' };
const EN_DOC = { '01': 'en la factura', '02': 'en la nota de débito', '03': 'en la nota de crédito', '04': 'en el tiquete' };
const MS_RELEER = 4500;  // tras una respuesta perdida: cuánto se espera para volver a mirar si la nota quedó hecha (la base puede estar terminando de guardar)
const MS_SEGURO = 15000; // desde que se envió la nota: pasado este tiempo la base ya terminó de guardar o de descartar, y una lectura sin la nota vale como «no se hizo»
const MAX_RAZON = 180;   // el motivo que se manda a Hacienda: de 3 a 180 letras
const AVISO_SIN_TURNO = 'No hay un turno abierto, así que el cierre de caja de hoy no incluirá esta nota.';
const lineasSaldo = (s) => (Array.isArray(s?.lineas) ? s.lineas : []).map((l) => ({
  linea: Number(l.linea), nombre: String(l.descripcion || 'Producto'), cantMil: aMil(l.cantidad), pfCent: aCent(l.precio_final), totCent: aCent(l.total_linea),
  devMil: aMil(l.devuelto_cantidad), acredCent: aCent(l.acreditado_monto), saldoMil: aMil(l.saldo_cantidad), saldoCent: aCent(l.saldo_monto) }));

const resumenDoc = (d) => h('div.an-resumen',
  h('div', h('b', `${NOMBRE_TIPO[d.tipo_doc] || 'Documento'} N.° ${numeroCorto(d.consecutivo)}`), d.fecha_emision ? h('span.tenue', ' · ' + fechaCorta(d.fecha_emision)) : null),
  h('div', d.cliente ? nombrePropio(d.cliente) : 'Consumidor final'),
  h('div.an-resumen-total', money(d.total)));

/* =====================================================================================================================
   El motor de las tres pantallas. clase: 'devolucion' | 'monto' | 'sinefecto'
   d: { id, tipo_doc, consecutivo, total, fecha_emision, cliente? } (el resto se lee del servidor al abrir)
   opciones.alTerminar(nota): cuando la nota ya quedó creada (la lista y el documento se vuelven a leer).
   opciones.alVerNota(nota): si viene, el resultado ofrece «Ver la nota».
   ===================================================================================================================== */
function abrir(app, d, clase, { alTerminar, alVerNota } = {}) {
  if (!d || !d.id) return null;
  if (enCurso.has(d.id)) { toast('Ya hay una ventana abierta para este documento.', 'error'); return null; }
  enCurso.add(d.id);
  const TITULOS = { devolucion: 'Devolver parte', monto: 'Corregir un monto', sinefecto: 'Dejar sin efecto la anulación' };
  const S = { paso: 'cargando', saldos: null, orig: null, dir: null, texto: new Map(), motivo: null, detalle: '', calc: null, queda: null, editor: null, razon: '', payload: null,
    error: '', errorLectura: '', dudoso: false, enVuelo: false, vivo: true, ultimoReparto: null, pasoPintado: null, refresco: null, errorEsReparto: false, aviso: '', revalidar: null };
  const cuerpo = h('div.an-dlg.np-cuerpo');
  const pie = h('div.modal-pie.an-pie.np-pie');
  // Con la nota en camino (paso 2 y trabajando) cerrar o recargar la pestaña haría perder el aviso de lo que pasó con ella: el navegador pregunta antes de salir
  const alSalir = (e) => { if (!(S.enVuelo && S.paso === 'revisar')) return undefined; e.preventDefault(); e.returnValue = ''; return ''; };
  window.addEventListener('beforeunload', alSalir);
  const m = modal({ titulo: TITULOS[clase], ancho: 720, contenido: cuerpo,
    alCerrar: () => { S.vivo = false; enCurso.delete(d.id); window.removeEventListener('beforeunload', alSalir); },
    bloqueo: () => (S.enVuelo ? 'Espere un momento: se está trabajando en la nota.' : '') });
  m.el.append(pie);
  ignorarToqueDeFondo(m);

  const terminal = () => (Number.isInteger(app?.terminal) ? app.terminal : 1);
  const esCredito = () => clase === 'devolucion' || (clase === 'monto' && S.dir === 'mas'); // el dinero se devuelve al cliente (si no, el cliente paga)
  const tipoNota = () => (esCredito() ? '03' : '02');
  const codigoNota = () => (clase === 'devolucion' ? '06' : clase === 'monto' ? '02' : '01');
  const clave = () => (clase === 'monto' ? S.dir : clase);
  // «Tipo de nota»: la nota de débito código 01 no es una «anulación total» (eso es la nota de crédito 01): es la que deja sin efecto esa anulación
  const tipoNotaTxt = (cod) => (clase === 'sinefecto' ? 'código 01 «Deja sin efecto la anulación»' : textoCodigoNota(cod));

  /* --- piezas comunes --- */
  const botonVolver = (texto = 'Volver sin hacer nada') => h('button.btn', { type: 'button', onclick: () => m.cerrar() }, texto);
  const cajaError = h('div.error-caja', { hidden: true, role: 'alert' });
  const mostrarError = (t) => { S.error = t || ''; cajaError.textContent = S.error; cajaError.hidden = !S.error; };
  // Una línea tranquila (gris) sobre los botones: lo que se está comprobando o por qué no se puede cambiar nada
  const estadoPie = h('p.np-estado', { role: 'status', hidden: true });
  const ponerEstado = (t) => { estadoPie.textContent = t || ''; estadoPie.hidden = !t; };
  const TEXTO_DUDOSO = 'Mientras no se sepa, no se puede cambiar nada.';
  const pasoTxt = (n, t) => h('div.np-paso', { tabindex: '-1' }, h('b', `Paso ${n} de 2`), ' · ' + t);
  const motivoNoAdmite = () => {
    if (clase === 'sinefecto') return motivoSinEfecto();
    return String(S.saldos?.motivo_no_admite || '').trim() || 'Este documento no admite devoluciones ni correcciones.';
  };
  function motivoSinEfecto() {
    const s = S.saldos, o = S.orig;
    const nd = (s?.notas || []).find((n) => n.tipo_doc === '02' && String(n.codigo_referencia) === '01' && n.viva !== false && n.estado !== 'rechazado');
    if (nd) return `Esta anulación ya se dejó sin efecto con la nota de débito N.° ${numeroCorto(nd.consecutivo)}.`;
    if (o && o.tipo_doc !== '03') return 'Solo se deja sin efecto una nota de crédito de anulación.';
    if (o && o.estado !== 'aceptado') return 'Hacienda todavía no acepta la nota de crédito de la anulación. Cuando la acepte se podrá dejar sin efecto.';
    if (o && !['01', '13'].includes(String(o.codigo_referencia || '01'))) return 'Solo se deja sin efecto una anulación total. Para una devolución o una corrección, haga una nota nueva.';
    return 'Esta anulación no se puede dejar sin efecto en este momento.';
  }
  const permite = () => (clase === 'sinefecto' ? S.saldos.admite_sin_efecto === true : S.saldos.admite_notas !== false);

  /* --- pintar según el paso --- */
  function pintar() {
    pie.replaceChildren();
    if (S.paso === 'cargando') {
      cuerpo.replaceChildren(resumenDoc(d), esqueleto(3, 'Leyendo el documento…'));
      pie.append(botonVolver('Cancelar'));
    } else if (S.paso === 'error') {
      cuerpo.replaceChildren(resumenDoc(d), bloqueError({ titulo: 'No se pudo abrir esta pantalla', mensaje: S.errorLectura, alReintentar: (b) => conBoton(b, cargar) }));
      pie.append(botonVolver('Volver'));
    } else if (S.paso === 'bloqueado') {
      const notas = pegarSigno(listaNotas(S.saldos));
      cuerpo.replaceChildren(resumenDoc(d), h('div.an-bloqueo', { role: 'alert' },
        h('p.an-bloqueo-tit', clase === 'sinefecto' ? 'Esta anulación no se puede dejar sin efecto' : 'Este documento no admite devoluciones ni correcciones'),
        S.aviso ? h('p', S.aviso) : null,
        h('p', motivoNoAdmite()),
        notas ? h('div.an-notas-caja', h('div.an-etq', 'Notas que ya tiene este documento'), notas) : null));
      pie.append(botonVolver('Volver'));
    } else if (S.paso === 'editar') {
      pintarEditar();
    } else if (S.paso === 'revisar') {
      pintarRevisar();
    }
    // Al cambiar de paso se lee desde el principio y el foco pasa al contenido nuevo (si no, con teclado o lector de pantalla se queda en «Cerrar» o se pierde)
    if (S.paso !== S.pasoPintado) { S.pasoPintado = S.paso; if (S.paso !== 'cargando') alInicio(); }
  }
  function alInicio() {
    const c = m.el.querySelector('.modal-cuerpo'); if (c) c.scrollTop = 0;
    const objetivo = cuerpo.querySelector('.np-paso, .an-bloqueo-tit, .bloque-error-tit');
    if (!objetivo) return;
    objetivo.setAttribute('tabindex', '-1');
    try { objetivo.focus({ preventScroll: true }); } catch { /* nada */ }
  }

  async function cargar() {
    S.paso = 'cargando'; pintar();
    try {
      const [saldos, orig] = await Promise.all([saldosEstricto(d.id), app.api.comprobante(d.id)]);
      if (!S.vivo) return;
      if (!orig || typeof orig !== 'object') throw new Fallo('No se pudo leer el documento. Intente de nuevo.');
      S.saldos = saldos; S.orig = orig;
      S.paso = permite() ? 'editar' : 'bloqueado';
      if (S.paso === 'editar' && clase !== 'sinefecto' && !lineasSaldo(saldos).length) throw new Fallo('No se pudo leer el detalle de los productos de este documento. Intente de nuevo.');
    } catch (e) {
      if (!S.vivo) return;
      S.paso = 'error'; S.errorLectura = mensajeDe(e, 'No se pudo leer el documento. Revise la conexión e intente de nuevo.');
    }
    pintar();
  }

  /* ---------------------------------------------------------------- paso 1: qué se hace ---------------------------------------------------------------- */
  // El motivo que se manda a Hacienda es «motivo: detalle» y no puede pasar de 180 letras: el detalle tiene el espacio que le queda al motivo escogido, así nada se recorta sin avisar
  const limiteDetalle = () => (S.motivo && S.motivo !== OTRO ? MAX_RAZON - S.motivo.length - 2 : MAX_RAZON);
  const botonesMotivo = () => {
    const lista = MOTIVOS[clave()] || [];
    const etq = h('label.etq', h('span.an-etq-det', S.motivo === OTRO ? 'Escriba cuál fue el motivo (obligatorio)' : 'Detalle (opcional)'),
      h('input.campo', { type: 'text', maxlength: limiteDetalle(), placeholder: 'Escriba aquí qué pasó', 'aria-label': 'Detalle del motivo', value: S.detalle, autocomplete: 'off',
        oninput: (e) => { S.detalle = e.target.value; } }));
    const botones = lista.map((t) => h('button.btn.atajo', { type: 'button', 'aria-pressed': String(S.motivo === t), onclick: () => {
      S.motivo = t; mostrarError('');
      botones.forEach((b) => b.setAttribute('aria-pressed', String(b.textContent === t)));
      etq.querySelector('input').maxLength = limiteDetalle();
      etq.querySelector('.an-etq-det').textContent = t === OTRO ? 'Escriba cuál fue el motivo (obligatorio)' : 'Detalle (opcional)';
      if (t === OTRO) etq.querySelector('input').focus({ preventScroll: true }); // solo cuando hay que escribir algo: si no, en el celular el teclado taparía los botones
    } }, t));
    return h('div.np-motivo', h('div.an-etq', clase === 'sinefecto' ? '¿Por qué se deja sin efecto? (Hacienda lo pide)' : clase === 'devolucion' ? '¿Por qué se devuelve? (Hacienda lo pide)' : '¿Por qué se corrige? (Hacienda lo pide)'),
      h('div.an-motivos.np-motivos', botones), etq);
  };

  function pintarEditar() {
    pie.replaceChildren();
    const partes = [resumenDoc(d)];
    let vivo = null, validar = null;
    if (clase === 'devolucion') ({ nodos: partes[1], vivo, validar } = vistaDevolucion());
    else if (clase === 'monto') ({ nodos: partes[1], vivo, validar } = vistaMonto());
    else ({ nodos: partes[1], vivo, validar } = vistaSinEfecto());
    S.revalidar = validar;
    cuerpo.replaceChildren(...partes.flat().filter(Boolean), ...(clase !== 'monto' || S.dir ? [botonesMotivo()] : []));
    const siguiente = h('button.btn.primario.grande', { type: 'button', onclick: (e) => conBoton(e.currentTarget, irARevisar) }, clase === 'devolucion' ? 'Revisar la devolución' : clase === 'monto' ? 'Revisar la corrección' : 'Revisar antes de confirmar');
    pie.append(...[vivo, cajaError, botonVolver(), siguiente].filter(Boolean));
    mostrarError('');
    validar?.();
  }

  // ----- Devolver parte
  function vistaDevolucion() {
    const lineas = lineasSaldo(S.saldos);
    const vivo = h('div.np-vivo', { 'aria-live': 'polite' });
    const refs = new Map();
    const tarjetas = lineas.map((l) => {
      const agotada = l.saldoMil <= 0 || l.saldoCent <= 0; // sin dinero por devolver también está agotada, aunque quede cantidad (una corrección de monto pudo gastar el dinero de la línea)
      const input = h('input.campo', { type: 'text', inputmode: 'decimal', autocomplete: 'off', 'data-linea': String(l.linea), 'aria-label': `Cantidad a devolver de ${l.nombre}`, value: S.texto.get(l.linea) || '', disabled: agotada,
        oninput: (e) => { S.texto.set(l.linea, e.target.value); validar(); } });
      const todo = h('button.btn.chico', { type: 'button', 'data-todo': String(l.linea), disabled: agotada, onclick: () => {
        const lleno = leerCantidad(S.texto.get(l.linea)).mil === l.saldoMil;
        const v = lleno ? '' : String(l.saldoMil / 1000).replace('.', ',');
        S.texto.set(l.linea, v); input.value = v; validar();
      } });
      const error = h('p.np-l-error', { role: 'alert', hidden: true });
      const sub = h('p.np-l-sub', { hidden: true });
      refs.set(l.linea, { l, input, todo, error, sub });
      return h('div.np-linea' + (agotada ? '.agotada' : ''),
        h('div.np-l-nombre', l.nombre),
        h('div.np-l-datos', h('span', 'Compró ', h('b', num(l.cantMil / 1000))), l.devMil > 0 ? h('span', 'Ya devuelto ', h('b', num(l.devMil / 1000))) : null,
          h('span', agotada ? h('b', l.saldoMil <= 0 ? 'Ya se devolvió todo' : 'Ya se devolvió todo el dinero de este producto') : ['Se puede devolver ', h('b', num(l.saldoMil / 1000))]), h('span', h('b', money(l.pfCent / 100)), ' cada uno')),
        agotada ? null : h('div.np-l-entrada', h('label', h('span', 'Cantidad a devolver'), input), todo),
        error, sub);
    });
    function validar() {
      const v = validarDevolucion(lineas, S.texto);
      for (const [, r] of refs) {
        const e = v.errores.get(r.l.linea), it = v.items.find((x) => x.linea === r.l.linea);
        r.error.textContent = e || ''; r.error.hidden = !e;
        r.input.setAttribute('aria-invalid', e ? 'true' : 'false');
        r.sub.textContent = it ? `Se devolverían ${moneyC(it.cent)}` : ''; r.sub.hidden = !it;
        const lleno = !!it && it.mil === r.l.saldoMil;
        r.todo.textContent = lleno ? 'Quitar la cantidad' : `Devolver todo (${num(r.l.saldoMil / 1000)})`;
        r.todo.closest('.np-linea')?.classList.toggle('activa', !!it);
      }
      vivo.replaceChildren(v.items.length ? h('span', 'Se devolvería: ', h('b.np-vivo-total', moneyC(v.total)), `  ·  ${v.items.length} ${v.items.length === 1 ? 'producto' : 'productos'}`, v.errores.size ? ' (sin contar los productos con error)' : '') : h('span.tenue', 'Todavía no escribió ninguna cantidad.'));
      return v;
    }
    const nodos = [pasoTxt(1, 'Qué se devuelve'),
      h('p.np-intro', 'El cliente devuelve una parte de lo que compró. Escriba cuánto devuelve de cada producto y se le devolverá el dinero de esa parte. La factura original no se borra.'),
      h('div.np-lineas', tarjetas)];
    return { nodos, vivo, validar };
  }

  // ----- Corregir un monto
  function vistaMonto() {
    const lineas = lineasSaldo(S.saldos);
    const totalCent = aCent(S.saldos.total), debitadoCent = aCent(S.saldos.total_debitado);
    const vivo = h('div.np-vivo', { 'aria-live': 'polite' });
    const zona = h('div.np-lineas');
    const opcion = (dir, titulo, texto) => h('button.np-opcion', { type: 'button', 'data-dir': dir, 'aria-pressed': String(S.dir === dir), onclick: () => {
      if (S.dir === dir) return;
      S.dir = dir; S.texto = new Map(); S.motivo = null; S.detalle = ''; S.error = ''; pintarEditar();
      cuerpo.querySelector(`.np-opcion[data-dir="${dir}"]`)?.focus({ preventScroll: true });
    } }, h('b', titulo), h('span', texto));
    const opciones = h('div.np-opciones', { role: 'group', 'aria-label': '¿Se cobró de más o de menos?' },
      opcion('mas', 'Se cobró de más', 'El cliente pagó más de lo correcto. Se le devuelve la diferencia.'),
      opcion('menos', 'Se cobró de menos', 'El cliente pagó menos de lo correcto. Se le cobra la diferencia.'));
    const refs = new Map();
    // Un solo mensaje: gris mientras no se haya intentado seguir; rojo si se toca el botón sin haber escogido
    function validar(insistir = false) {
      if (!S.dir) { vivo.replaceChildren(h(insistir ? 'span.np-vivo-mal' : 'span.tenue', 'Primero escoja si se cobró de más o de menos.')); return null; }
      const v = validarMontos(lineas, S.texto, S.dir, { totalCent, debitadoCent });
      for (const [, r] of refs) {
        const e = v.errores.get(r.l.linea), it = v.items.find((x) => x.linea === r.l.linea);
        r.error.textContent = e || ''; r.error.hidden = !e;
        r.input.setAttribute('aria-invalid', e ? 'true' : 'false');
        r.input.closest('.np-linea')?.classList.toggle('activa', !!it);
      }
      const verbo = S.dir === 'mas' ? 'devolvería' : 'cobraría';
      vivo.replaceChildren(v.general ? h('span.np-vivo-mal', `Se cobraría ${moneyC(v.total)}, pero a este documento solo se le pueden cobrar ${moneyC(Math.max(totalCent - debitadoCent, 0))} más en total.`)
        : v.items.length ? h('span', `Se ${verbo}: `, h('b.np-vivo-total', moneyC(v.total)), `  ·  ${v.items.length} ${v.items.length === 1 ? 'producto' : 'productos'}`, v.errores.size ? ' (sin contar los productos con error)' : '') : h('span.tenue', 'Todavía no escribió ningún monto.'));
      return v;
    }
    if (S.dir) {
      const resto = Math.max(totalCent - debitadoCent, 0); // lo que todavía se le puede cobrar al documento entre todos los productos
      for (const l of lineas) {
        const agotada = S.dir === 'mas' && l.saldoCent <= 0;
        const tope = S.dir === 'mas' ? l.saldoCent : Math.min(l.totCent, resto);
        const topeDelDocumento = S.dir === 'menos' && resto < l.totCent; // el tope no es el de este producto: es lo que le queda al documento en total
        const input = h('input.campo', { type: 'text', inputmode: 'decimal', autocomplete: 'off', 'data-linea': String(l.linea), 'aria-label': `${S.dir === 'mas' ? 'Monto que se devuelve' : 'Monto que se cobra'} de ${l.nombre}`, value: S.texto.get(l.linea) || '', disabled: agotada,
          oninput: (e) => { S.texto.set(l.linea, e.target.value); validar(); } });
        const error = h('p.np-l-error', { role: 'alert', hidden: true });
        refs.set(l.linea, { l, input, error });
        zona.append(h('div.np-linea' + (agotada ? '.agotada' : ''),
          h('div.np-l-nombre', l.nombre),
          h('div.np-l-datos', h('span', 'Se cobró ', h('b', moneyC(l.totCent)), ' (con IVA)'), S.dir === 'mas' && l.acredCent > 0 ? h('span', 'Ya acreditado ', h('b', moneyC(l.acredCent))) : null,
            h('span', agotada ? h('b', 'Ya no admite más correcciones de crédito') : [S.dir === 'mas' ? 'Se puede devolver hasta ' : (topeDelDocumento ? 'Entre todos los productos se puede cobrar hasta ' : 'Se puede cobrar hasta '), h('b', moneyC(tope))])),
          agotada ? null : h('div.np-l-entrada', h('label', h('span', S.dir === 'mas' ? 'Monto que se devuelve (₡)' : 'Monto que se cobra (₡)'), input)),
          error));
      }
    }
    const nodos = [pasoTxt(1, 'Qué se corrige'),
      h('p.np-intro', 'Úselo cuando se cobró un monto equivocado en un producto y solo hay que ajustar la diferencia, sin rehacer la venta.'),
      opciones,
      S.dir ? h('p.np-ayuda', h('b', 'Escriba solo la diferencia, no el precio correcto. '),
        S.dir === 'mas' ? `Por ejemplo, si se cobró ${money(5000)} y debía ser ${money(4000)}, escriba 1000. Los montos incluyen el IVA.`
          : `Por ejemplo, si se cobró ${money(4000)} y debía ser ${money(5000)}, escriba 1000. Los montos incluyen el IVA.`) : null,
      zona];
    return { nodos, vivo, validar };
  }

  // ----- Dejar sin efecto la anulación
  function vistaSinEfecto() {
    const o = S.orig, orig = o.original;
    const lineas = Array.isArray(o.lineas_snapshot) ? o.lineas_snapshot : [];
    const total = money(o.total);
    const nodos = [pasoTxt(1, 'Qué se hace'),
      h('p.np-intro', `Esta nota de crédito N.° ${numeroCorto(o.consecutivo)} anuló ${orig ? `${CON_ARTICULO[orig.tipo_doc] || 'el documento'} N.° ${numeroCorto(orig.consecutivo)}` : 'un documento'} por ${total}.`),
      h('div.an-explica', h('p', h('b', 'Qué pasa si sigue:')), h('ul',
        h('li', `Se crea una nota de débito por ${total}.`),
        h('li', 'La venta vuelve a valer como estaba antes de anularla.'),
        h('li', 'Después de esto, el documento original ya no admite más devoluciones ni correcciones.'))),
      lineas.length ? h('div.an-lineas', h('div.an-lineas-tit', 'Lo que volvería a valer'),
        lineas.slice(0, 8).map((l) => h('div.an-linea', h('span', `${num(l.cantidad)} × ${l.descripcion || 'Producto'}`), h('span.der', money(l.total_linea)))),
        lineas.length > 8 ? h('small.tenue', `y ${lineas.length - 8} productos más`) : null) : null];
    const vivo = h('div.np-vivo', h('span', 'La nota de débito sería por ', h('b.np-vivo-total', total)));
    return { nodos, vivo, validar: null };
  }

  /* ---------------------------------------------------------------- de paso 1 a paso 2: pedir el cálculo al servidor ---------------------------------------------------------------- */
  async function irARevisar() {
    if (S.enVuelo) return;
    mostrarError('');
    let v = null, payload = null;
    if (clase === 'devolucion') {
      v = validarDevolucion(lineasSaldo(S.saldos), S.texto);
      if (v.errores.size) return mostrarError('Revise las cantidades marcadas en rojo.');
      if (!v.items.length) return mostrarError('Escriba cuánto se devuelve de al menos un producto.');
      payload = v.items.map((x) => ({ linea: x.linea, cantidad: txtMil(x.mil) }));
    } else if (clase === 'monto') {
      if (!S.dir) { S.revalidar?.(true); cuerpo.querySelector('.np-opcion')?.focus(); return; } // el mensaje ya está abajo: se pone en rojo y el cursor va a las dos opciones
      v = validarMontos(lineasSaldo(S.saldos), S.texto, S.dir, { totalCent: aCent(S.saldos.total), debitadoCent: aCent(S.saldos.total_debitado) });
      if (v.errores.size) return mostrarError('Revise los montos marcados en rojo.');
      if (v.general) return mostrarError('No se puede seguir con ese monto. Si el cliente debe más, haga una venta nueva por la diferencia.'); // la cifra del tope ya está en rojo arriba de los botones
      if (!v.items.length) return mostrarError('Escriba el monto de al menos un producto.');
      payload = v.items.map((x) => ({ linea: x.linea, monto: txtCent(x.cent) }));
    }
    if (!S.motivo) return mostrarError('Escoja uno de los motivos de arriba.');
    if (S.motivo === OTRO && S.detalle.trim().length < 5) return mostrarError('Escriba cuál fue el motivo (mínimo 5 letras).');
    const det = S.detalle.trim();
    const razon = S.motivo === OTRO ? det : S.motivo + (det ? ': ' + det : '');
    if (razon.length > MAX_RAZON) return mostrarError(`El motivo y el detalle juntos pasan de ${MAX_RAZON} letras (tienen ${razon.length}). Acorte el detalle en ${razon.length - MAX_RAZON} letras.`);
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return mostrarError('No hay conexión con internet. Cuando vuelva, toque el botón otra vez.');
    S.enVuelo = true;
    try {
      // Los saldos se leen otra vez junto con el cálculo: si otra persona (u otro aparato) hizo una nota mientras esta ventana estaba abierta, se avisa y se vuelve al paso 1
      const [calc, queda, fresca] = await Promise.all([notaCalcular(d.id, tipoNota(), codigoNota(), payload), esCredito() ? capacidadPagos(app, S.saldos) : null, saldosEstricto(d.id)]);
      if (!S.vivo) return;
      const nuevas = notasNuevas(S.saldos, fresca);
      if (nuevas.length) return hayNotasNuevas(fresca, nuevas);
      if (!calc || typeof calc !== 'object' || !Number.isFinite(Number(calc.total)) || !(Number(calc.total) > 0)) throw new Fallo('No se pudo calcular la nota. Intente de nuevo.');
      S.saldos = fresca; S.calc = calc; S.queda = queda; S.razon = razon; S.payload = payload;
      S.paso = 'revisar'; pintar();
    } catch (e) {
      const msg = e instanceof Fallo ? e.message : mensajeDe(e);
      mostrarError(msg);
      // El servidor dijo que no por los datos (lo más común: otra persona hizo una nota mientras tanto): se leen los saldos de nuevo para que los topes que se ven sean los de ahora
      if (!(e instanceof Fallo) && esRechazo(e)) {
        const previos = S.saldos;
        await refrescar();
        if (S.vivo && S.paso === 'editar') {
          const nuevas = notasNuevas(previos, S.saldos);
          const texto = (nuevas.length ? avisoMientrasTanto(nuevas) + ' ' : '') + msg;
          if (permite()) { pintarEditar(); mostrarError(texto); } else { S.aviso = nuevas.length ? avisoMientrasTanto(nuevas) : ''; S.paso = 'bloqueado'; pintar(); }
        }
      }
    }
    finally { S.enVuelo = false; }
  }
  // Una falla de datos (el sistema entendió y dijo que no), no de conexión ni de sesión
  const esRechazo = (e) => !esDeRed(e) && !e?.sesion && e?.tipo !== 'sesion';
  // Las notas vivas que hay ahora en el documento y que esta ventana no conocía (de otra persona o de otro aparato)
  function notasNuevas(antesS, ahoraS) {
    const conocidas = new Set(((antesS && antesS.notas) || []).map((n) => n.id));
    return ((ahoraS && ahoraS.notas) || []).filter((n) => !conocidas.has(n.id) && n.viva !== false && n.estado !== 'rechazado');
  }
  function avisoMientrasTanto(nuevas) {
    const nums = nuevas.map((n) => `N.° ${numeroCorto(n.consecutivo)}`);
    const lista = nums.length === 1 ? nums[0] : nums.slice(0, -1).join(', ') + ' y ' + nums.at(-1);
    return `Mientras tanto se ${nuevas.length === 1 ? 'hizo la nota' : 'hicieron las notas'} ${lista} en este documento. Ya se actualizaron los datos: revise de nuevo antes de seguir.`;
  }
  // Se detectó una nota que la pantalla no conocía: se vuelve al paso 1 con los datos de ahora y se avisa (lo escrito se conserva y se revisa contra lo que queda)
  function hayNotasNuevas(fresca, nuevas) {
    S.saldos = fresca; S.calc = null; S.queda = null; S.dudoso = false;
    S.aviso = avisoMientrasTanto(nuevas);
    S.paso = permite() ? 'editar' : 'bloqueado';
    pintar();
    if (S.paso === 'editar') mostrarError(S.aviso);
  }
  function refrescar() {
    S.refresco = (async () => { try { const s = await saldosEstricto(d.id); if (S.vivo) S.saldos = s; } catch { /* se queda lo que ya se ve */ } })();
    return S.refresco;
  }
  /* ---------------------------------------------------------------- paso 2: revisar y confirmar ---------------------------------------------------------------- */
  const correoTxt = () => {
    const o = S.orig;
    if ((clase === 'sinefecto' ? o.original?.tipo_doc : o.tipo_doc) === '04') return 'Como es un tiquete, no se envía copia por correo.'; // «sin efecto» se hace sobre la nota de crédito: lo que cuenta es el documento que anuló
    const c = o.cliente_snapshot?.correo;
    return c ? `Es posible que el cliente reciba una copia de la nota por correo (${c}).` : 'Este cliente no tiene correo registrado, así que no recibirá copia por correo.';
  };
  function pintarRevisar() {
    pie.replaceChildren();
    const calc = S.calc, o = S.orig;
    const totalCent = aCent(calc.total);
    const credito = esCredito();
    const titulos = { devolucion: ['¿Hacer esta devolución?', 'Total que se devuelve', 'Sí, hacer la devolución'], monto: [credito ? '¿Hacer esta corrección y devolver la diferencia?' : '¿Hacer esta corrección y cobrar la diferencia?', credito ? 'Total que se devuelve' : 'Total que se cobra', 'Sí, hacer la corrección'], sinefecto: ['¿Dejar sin efecto esta anulación?', 'Total que vuelve a valer', 'Sí, dejar sin efecto la anulación'] }[clase];
    // El reparto del dinero: lo sugiere el servidor y se puede cambiar. En un crédito ningún medio puede llevar más de lo que le queda; en un débito se puede cobrar por cualquier medio.
    const sug = new Map((Array.isArray(calc.pagos_sugeridos) ? calc.pagos_sugeridos : []).map((p) => [String(p.medio || '').toLowerCase().trim(), aCent(p.monto)]));
    let filas;
    if (credito) {
      const mapa = S.queda?.mapa || new Map();
      const medios = [...mapa.keys()];
      for (const k of sug.keys()) if (!medios.includes(k)) medios.push(k);
      filas = medios.map((medio) => ({ medio, topeCent: Math.max(mapa.get(medio) || 0, sug.get(medio) || 0), inicialCent: sug.get(medio) || 0 }));
    } else {
      const medios = [...MEDIOS_ORDEN];
      for (const k of sug.keys()) if (!medios.includes(k)) medios.push(k);
      filas = medios.map((medio) => ({ medio, topeCent: null, inicialCent: sug.get(medio) || 0 }));
    }
    if (!filas.length) filas = [{ medio: 'efectivo', topeCent: null, inicialCent: totalCent }];
    if (filas.length === 1) filas[0].inicialCent = totalCent; // un solo medio lleva todo
    // El aviso del pie sobre el reparto se quita apenas se toca un campo: de ahí en adelante habla solo la línea «Suma: … de …» de la caja del reparto (dos mensajes sobre lo mismo se contradecirían)
    S.editor = editorPagos({ totalCent, filas, alCambiar: () => { if (S.errorEsReparto) { S.errorEsReparto = false; mostrarError(''); } } });
    const tipo = tipoNota();
    const explica = clase === 'sinefecto' ? EXPLICA_ND_SIN_EFECTO : clase === 'devolucion' ? EXPLICA_NC : credito ? EXPLICA_NC_MONTO : EXPLICA_ND;
    const lineas = Array.isArray(calc.lineas) ? calc.lineas : [];
    const dineroTit = credito ? '¿Cómo se le devuelve el dinero al cliente?' : clase === 'sinefecto' ? '¿Cómo se había pagado la venta?' : '¿Cómo paga el cliente la diferencia?';
    const dineroAyuda = credito ? 'El dinero se devuelve por el mismo medio con que el cliente pagó. Ya se propuso un reparto; puede cambiarlo si hace falta.'
      : clase === 'sinefecto' ? 'La anulación restó este dinero del cierre de caja. Esta nota lo vuelve a sumar. Anote aquí cómo se había pagado la venta.'
        : 'Ya se propuso un reparto según como pagó la compra. Puede cambiarlo si el cliente paga de otra forma. El cierre de caja sumará el efectivo que ponga aquí.';
    const orig2 = o.original;
    cuerpo.replaceChildren(
      pasoTxt(2, 'Revise y confirme'),
      h('p.an-pregunta', titulos[0]),
      h('div.np-total', h('span.an-etq', titulos[1]), h('b', moneyC(totalCent))),
      h('div.an-ficha',
        h('div.an-ficha-fila', h('span.an-etq', 'Nota que se creará'), h('div', h('b', `${tipo === '03' ? 'Nota de crédito' : 'Nota de débito'} por ${moneyC(totalCent)}`),
          h('div', `Tipo de nota: ${tipoNotaTxt(codigoNota()) || 'código ' + codigoNota()}. ${explica}`))),
        h('div.an-ficha-fila', h('span.an-etq', clase === 'sinefecto' ? 'Anulación' : 'Documento'), h('div',
          clase === 'sinefecto' ? `Nota de crédito N.° ${numeroCorto(o.consecutivo)}${orig2 ? `, que anuló ${(NOMBRE_TIPO[orig2.tipo_doc] || 'el documento').toLowerCase()} N.° ${numeroCorto(orig2.consecutivo)}` : ''}`
            : `${NOMBRE_TIPO[o.tipo_doc] || 'Documento'} N.° ${numeroCorto(o.consecutivo)} · ${fechaCorta(o.fecha_emision)} · ${money(o.total)}`)),
        h('div.an-ficha-fila', h('span.an-etq', clase === 'devolucion' ? 'Productos que se devuelven' : clase === 'sinefecto' ? 'Productos' : 'Lo que se corrige'),
          h('div.np-ficha-lineas', lineas.map((l) => h('div.an-linea', h('span', l.ajuste ? String(l.descripcion || '') : `${num(l.cantidad)} × ${l.descripcion || 'Producto'}`), h('span.der', money(l.total_linea)))))),
        h('div.an-ficha-fila', h('span.an-etq', 'Motivo'), h('div', S.razon))),
      h('div.an-dinero.np-dinero', h('div.an-etq', dineroTit), h('p', dineroAyuda), S.editor.el,
        S.queda?.aproximado ? h('small.tenue', 'No se pudo comprobar cuánto queda por devolver en cada medio. El sistema lo revisará al guardar.') : null),
      h('div.np-avisos', { role: 'note' },
        h('p.np-calma', h('b', 'Una vez creada, esta nota no se puede borrar ni deshacer. '), 'Revise que todo esté bien antes de confirmar.'),
        h('p', 'Después se enviará a Hacienda. Hacienda puede tardar unos minutos en aceptarla, y su estado cambiará solo en la lista.'),
        h('p', correoTxt()),
        app?.turno ? null : h('p.np-sin-turno', AVISO_SIN_TURNO)));
    volverAEditar = h('button.btn', { type: 'button', disabled: S.dudoso, onclick: async () => {
      if (S.enVuelo) return;
      if (S.refresco) { await S.refresco; S.refresco = null; } // si el servidor había dicho que no, los saldos ya se leyeron de nuevo
      if (!S.vivo) return;
      S.paso = permite() ? 'editar' : 'bloqueado'; S.dudoso = false; mostrarError(''); pintar();
    } }, 'Volver y cambiar');
    // Doble toque: el botón se apaga en el primer toque y mientras la nota está en camino nada más lo atiende (S.enVuelo)
    principal = h('button.btn.primario.grande', { type: 'button', 'data-confirmar': '1', onclick: async (e) => {
      const b = e.currentTarget;
      if (S.enVuelo || b.disabled) return;
      b.disabled = true; b.dataset.ocupado = '1';
      try { await (S.dudoso ? revisarSiQuedo() : confirmar()); } finally { b.disabled = false; delete b.dataset.ocupado; }
    } }, S.dudoso ? 'Revisar si quedó hecha' : titulos[2]);
    etiquetaConfirmar = titulos[2];
    ponerEstado(S.dudoso ? TEXTO_DUDOSO : '');
    // En el estado «no se sabe si quedó hecha» la persona ya no está por confirmar nada: la frase sobraría y ocuparía lugar en el pie
    lineaSinDeshacer = h('p.an-sin-deshacer.np-sin-deshacer', { hidden: S.dudoso }, 'Esto no se puede deshacer.');
    pie.append(lineaSinDeshacer, cajaError, estadoPie, volverAEditar, principal);
    mostrarError(S.error);
  }
  let principal = null, volverAEditar = null, lineaSinDeshacer = null, etiquetaConfirmar = '';
  // Se perdió la respuesta y no se pudo comprobar si la nota quedó creada: el botón pasa a «Revisar si quedó hecha» y no se puede cambiar nada
  function marcarDudoso() {
    S.dudoso = true;
    if (principal) principal.textContent = 'Revisar si quedó hecha';
    if (volverAEditar) volverAEditar.disabled = true;
    if (lineaSinDeshacer) lineaSinDeshacer.hidden = true;
    ponerEstado(TEXTO_DUDOSO);
  }
  function quitarDudoso() {
    S.dudoso = false;
    if (principal) principal.textContent = etiquetaConfirmar;
    if (volverAEditar) volverAEditar.disabled = false;
    if (lineaSinDeshacer) lineaSinDeshacer.hidden = false;
    ponerEstado('');
  }

  /* ---------------------------------------------------------------- guardar ---------------------------------------------------------------- */
  const escribir = (pagos) => {
    if (clase === 'devolucion') return notaDevolucion(d.id, S.payload, S.razon, terminal(), pagos);
    if (clase === 'monto') return (S.dir === 'mas' ? notaCreditoMonto : notaDebitoMonto)(d.id, S.payload, S.razon, terminal(), pagos);
    return notaDebitoSinEfecto(d.id, S.razon, terminal(), pagos);
  };
  // Si la respuesta se perdió, se averigua si la nota quedó creada antes de decir que falló: una nota nueva (que no estaba) del mismo tipo, código y total.
  // «Que no estaba» se decide con una lectura hecha justo antes de enviar (antes), no con la hora del aparato: un reloj adelantado o atrasado no puede esconder la nota.
  let antes = new Set(), totalEnviado = 0, t0 = 0, tipoFalla = '';
  const ahoraMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
  const notaNueva = (s) => (s.notas || []).find((n) => !antes.has(n.id) && n.tipo_doc === tipoNota() && String(n.codigo_referencia) === codigoNota() && n.viva !== false && aCent(n.total) === totalEnviado) || null;
  const noRepetir = () => ({ devolucion: 'No haga la devolución otra vez hasta saberlo.', monto: 'No haga la corrección otra vez hasta saberlo.', sinefecto: 'No deje sin efecto la anulación otra vez hasta saberlo.' })[clase];
  // porque: el tipo de falla de la escritura ('tiempo', 'ocupado', 'red') o '' si lo que falló fue la lectura
  const textoNoSeSupo = (porque) => (porque === 'tiempo' ? 'La respuesta tardó demasiado y no se pudo saber si la nota quedó hecha.' : porque === 'ocupado' ? 'El sistema estaba ocupado y no se pudo saber si la nota quedó hecha.'
    : porque === 'red' ? 'Se perdió la conexión y no se pudo saber si la nota quedó hecha.' : 'No se pudo saber si la nota quedó hecha.')
    + ` Toque «Revisar si quedó hecha» para comprobarlo. ${noRepetir()}`;
  async function leerNueva() {
    let s;
    try { s = await saldosEstricto(d.id); } catch { throw new Fallo(textoNoSeSupo(''), { dudoso: true }); }
    return notaNueva(s);
  }
  // Tras la respuesta perdida: una lectura enseguida y otra a los pocos segundos (la base puede estar terminando de guardar). Si en ninguna aparece, NO se afirma que no se hizo: queda «no se pudo saber».
  async function buscarCreada() {
    let nota = await leerNueva();
    if (nota) return nota;
    await esperar(MS_RELEER);
    if (!S.vivo) throw new Fallo(textoNoSeSupo(tipoFalla), { dudoso: true });
    nota = await leerNueva();
    if (nota) return nota;
    throw new Fallo(textoNoSeSupo(tipoFalla), { dudoso: true });
  }
  // La persona toca «Revisar si quedó hecha»: una lectura. Si aún no aparece y todavía es pronto, se sigue sin saber; pasado el tiempo seguro, sin nota significa que no se hizo.
  async function buscarCreadaUnaVez() {
    const nota = await leerNueva();
    if (nota) return nota;
    if (ahoraMs() - t0 < MS_SEGURO) throw new Fallo(`Todavía no aparece ninguna nota nueva en este documento. Espere unos segundos y toque «Revisar si quedó hecha» otra vez. ${noRepetir()}`, { dudoso: true });
    throw new Fallo('Se revisó y no hay ninguna nota nueva en este documento, así que no se hizo. Puede intentarlo de nuevo.');
  }
  async function confirmar() {
    if (S.enVuelo) return;
    const lec = S.editor.leer();
    if (!lec.ok) { S.errorEsReparto = true; return mostrarError(lec.mensaje); }
    S.errorEsReparto = false;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return mostrarError('No hay conexión con internet, así que no se hizo nada. Cuando vuelva la conexión, intente de nuevo.');
    mostrarError('');
    S.enVuelo = true;
    S.ultimoReparto = lec.pagos;
    try {
      // Lectura fresca justo antes de escribir: si otra persona hizo una nota después de revisar, no se escribe nada y se avisa; y de esta lectura sale «lo que ya había» para reconocer la nota propia
      ponerEstado('Revisando el documento antes de guardar…');
      let fresca;
      try { fresca = await saldosEstricto(d.id); }
      catch { ponerEstado(''); return mostrarError('No se pudo revisar el documento antes de guardar, así que no se hizo nada. Intente de nuevo.'); }
      if (!S.vivo) return;
      const nuevas = notasNuevas(S.saldos, fresca);
      if (nuevas.length) { ponerEstado(''); return hayNotasNuevas(fresca, nuevas); }
      antes = new Set((fresca.notas || []).map((n) => n.id)); totalEnviado = aCent(S.calc.total); tipoFalla = ''; t0 = ahoraMs();
      ponerEstado('Guardando la nota…');
      let nota;
      try { nota = await escribir(lec.pagos); }
      catch (e) {
        if (!esDeRed(e)) throw e;
        tipoFalla = e?.tipo === 'tiempo' ? 'tiempo' : e?.tipo === 'ocupado' ? 'ocupado' : 'red';
        ponerEstado('Comprobando si la nota quedó hecha…');
        nota = await buscarCreada();
      }
      ponerEstado('');
      S.enVuelo = false; m.cerrar();
      resultado(nota, lec.pagos);
      try { await alTerminar?.(nota); } catch { /* la lista se actualiza sola en unos segundos */ }
    } catch (e) {
      ponerEstado('');
      if (e instanceof Fallo) {
        mostrarError(e.message);
        if (e.dudoso) { marcarDudoso(); try { Promise.resolve(alTerminar?.(null)).catch(() => {}); } catch { /* nada */ } }
      } else if (esRechazo(e)) {
        const msg = mensajeDe(e), accion = accionTrasRechazo(msg);
        mostrarError(accion ? msg + ' ' + accion : msg);
        alPonerseAlDia(msg); // si la persona vuelve al paso 1, ahí ya están los saldos de ahora
      } else mostrarError(mensajeDe(e));
    } finally { S.enVuelo = false; }
  }
  // Qué hacer después de que el sistema dijo que no por los datos (no por la conexión): la frase dice qué toca
  function accionTrasRechazo(msg) {
    if (clase === 'sinefecto') return /ya se dej[oó] sin efecto/i.test(msg) ? 'No hace falta hacer nada más. Cierre esta ventana.' : 'Toque «Volver y cambiar» para ver cómo quedó este documento.';
    return clase === 'devolucion' ? 'Toque «Volver y cambiar» para ver lo que queda por devolver.' : 'Toque «Volver y cambiar» para ver lo que se puede corregir.';
  }
  // Tras un rechazo: se leen los saldos de nuevo y, si el sistema dice que los pagos ya no suman el total, es que el total de la nota cambió (otra persona hizo una nota): se pide el cálculo otra vez y se pone al día lo que se ve
  async function alPonerseAlDia(msg) {
    await refrescar();
    if (clase === 'sinefecto' || !/no suman el total de la nota/.test(msg)) return;
    try {
      const [calc, queda] = await Promise.all([notaCalcular(d.id, tipoNota(), codigoNota(), S.payload), esCredito() ? capacidadPagos(app, S.saldos) : null]);
      if (!S.vivo || S.paso !== 'revisar' || S.enVuelo || !calc || !(Number(calc.total) > 0) || aCent(calc.total) === aCent(S.calc.total)) return;
      S.calc = calc; S.queda = queda;
      S.error = `El total de la nota cambió a ${money(calc.total)} porque se hizo otra nota mientras tanto. Revise el reparto del dinero y confirme de nuevo.`;
      pintar();
    } catch { /* se queda el aviso del sistema */ }
  }
  async function revisarSiQuedo() {
    if (S.enVuelo) return;
    S.enVuelo = true; mostrarError(''); ponerEstado('Comprobando si la nota quedó hecha…');
    try {
      const nota = await buscarCreadaUnaVez();
      ponerEstado('');
      S.enVuelo = false; m.cerrar();
      resultado(nota, S.ultimoReparto || []);
      try { await alTerminar?.(nota); } catch { /* nada */ }
    } catch (e) {
      mostrarError(e instanceof Fallo ? e.message : mensajeDe(e));
      if (e instanceof Fallo && !e.dudoso) quitarDudoso(); else ponerEstado(TEXTO_DUDOSO);
    } finally { S.enVuelo = false; }
  }

  /* ---------------------------------------------------------------- resultado ---------------------------------------------------------------- */
  // Qué hace la persona con cada medio. cierre = false cuando el efectivo ya se explicó aparte (en «Dejar sin efecto» la caja se dice en su propio bloque)
  function cobrarTxt(pagos, { cierre = true } = {}) {
    const por = { efectivo: (x) => `Efectivo ${money(x)}: recíbalo del cliente y póngalo en la caja.${cierre ? ' El cierre de caja lo sumará, así que no lo anote además como entrada de efectivo.' : ''}`,
      tarjeta: (x) => `Tarjeta ${money(x)}: cóbrelo por el datáfono.`, sinpe: (x) => `SINPE Móvil ${money(x)}: pídale al cliente que lo pague por SINPE Móvil.`, transferencia: (x) => `Transferencia ${money(x)}: pídale al cliente que la haga a la cuenta del local.` };
    return pagos.map((p) => h('li', (por[p.medio] || ((x) => `${MEDIOS[p.medio] || p.medio} ${money(x)}: cóbrelo por ese medio.`))(Number(p.monto))));
  }
  function resultado(nota, pagos) {
    const credito = esCredito();
    const pagosNum = pagos.map((p) => ({ medio: p.medio, monto: Number(p.monto) }));
    const titulo = { devolucion: 'Devolución registrada', monto: 'Corrección registrada', sinefecto: 'La anulación quedó sin efecto' }[clase];
    const cod = String(nota?.codigo_referencia || codigoNota());
    const o = S.orig;
    const estadoTxt = !nota ? 'No se pudo leer la nota. Revísela en la lista.'
      : nota.estado === 'aceptado' ? 'Hacienda ya la aceptó.' : 'Se enviará a Hacienda y su estado cambiará solo en la lista. Hacienda puede tardar unos minutos. Con Hacienda no tiene que hacer nada más.';
    const total = money(nota?.total ?? S.calc.total), docN = `N.° ${numeroCorto(o.consecutivo)}`;
    const queHace = clase === 'devolucion' ? `Devuelve ${total} ${DE_DOC[o.tipo_doc] || 'del documento'} ${docN}.`
      : clase === 'monto' ? (credito ? `Devuelve ${total} que se habían cobrado de más ${EN_DOC[o.tipo_doc] || 'en el documento'} ${docN}.` : `Cobra ${total} que faltaban ${EN_DOC[o.tipo_doc] || 'en el documento'} ${docN}.`)
        : `Deja sin efecto la anulación hecha con la nota de crédito ${docN} por ${total}.`;
    // «Dejar sin efecto»: lo de la caja pasa siempre (la anulación restó el dinero del cierre y esta nota lo vuelve a sumar); cobrarle al cliente solo si cuando se anuló se le había devuelto dinero
    const efectivo = pagosNum.filter((p) => p.medio === 'efectivo').reduce((a, p) => a + p.monto, 0);
    const bloquesDinero = clase === 'sinefecto'
      ? [h('div.an-dinero', h('div.an-etq', 'En el cierre de caja'),
        h('p', efectivo > 0 ? `El cierre de caja volverá a sumar ${money(efectivo)} en efectivo por esta nota. No lo anote además como entrada de efectivo.` : 'Esta nota no lleva efectivo, así que no cambia el efectivo del cierre de caja.')),
      h('div.an-dinero', h('div.an-etq', 'Con el cliente'), h('p', 'Solo si cuando se anuló se le había devuelto dinero al cliente: cóbreselo otra vez:'), h('ul', cobrarTxt(pagosNum, { cierre: false })))]
      : [credito ? h('div.an-dinero', h('div.an-etq', 'Qué hacer con el dinero'), h('p', 'Devuélvale al cliente lo que corresponde:'), h('ul', lineasDevolver(pagosNum)))
        : h('div.an-dinero', h('div.an-etq', 'Qué hacer con el dinero'), h('p', 'Cóbrele al cliente la diferencia:'), h('ul', cobrarTxt(pagosNum)))];
    const imp = nota?.id ? h('button.btn', { type: 'button', onclick: () => { reimprimirComprobante(nota.id); } }, 'Imprimir la nota') : null;
    const ver = alVerNota && nota?.id ? h('button.btn', { type: 'button', onclick: () => { r.cerrar(); alVerNota(nota); } }, 'Ver la nota') : null;
    const r = modal({ titulo, ancho: 600, contenido: h('div.an-dlg',
      h('div.an-ok', h('b', nota ? `${credito ? 'Nota de crédito' : 'Nota de débito'} N.° ${numeroCorto(nota.consecutivo)}` : (credito ? 'Nota de crédito' : 'Nota de débito')), h('div', queHace),
        tipoNotaTxt(cod) ? h('div.an-codigo', 'Tipo de nota: ' + tipoNotaTxt(cod)) : null),
      ...bloquesDinero,
      app?.turno ? null : h('div.an-aviso.np-sin-turno', h('p', AVISO_SIN_TURNO)),
      h('p', estadoTxt),
      h('p.tenue', correoTxt()),
      h('div.an-botones', imp, ver, h('button.btn.primario', { type: 'button', onclick: () => r.cerrar() }, 'Cerrar'))) });
    ignorarToqueDeFondo(r);
  }

  cargar();
  return m;
}

export const devolverParte = (app, d, opciones) => abrir(app, d, 'devolucion', opciones);
export const corregirMonto = (app, d, opciones) => abrir(app, d, 'monto', opciones);
export const dejarSinEfecto = (app, d, opciones) => abrir(app, d, 'sinefecto', opciones);
