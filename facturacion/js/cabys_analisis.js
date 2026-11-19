// Análisis de un CABYS distinto al habitual, en palabras simples y listo para decidir en el mismo lugar (solo administradores).
// Lo usan la bandeja «Alertas de Hacienda» y la pantalla de la factura (Contabilidad > Recibidas). Los datos los arma la base de datos
// (fact.ah_cabys_analisis, migración 210), así el correo, el aviso del teléfono y las pantallas dicen lo mismo.
// Trae también la ventana para anotar «Ya lo atendí» (la nota es obligatoria) y el botón que copia el mensaje para el proveedor.
import { h, money, num, modal, toast } from './util.js';
import { cargarHoja } from './ui_hojas.js';

cargarHoja('cabys_analisis.css');

const pct = (t) => (t == null ? 'sin dato' : num(+t * 100, 0) + ' %');
const VEREDICTOS = {
  probable_error: { clase: 'mal', icono: 'Probable error del proveedor' },
  revisar: { clase: 'espera', icono: 'Hay que revisarlo con el proveedor' },
  cambio_legitimo_probable: { clase: 'espera', icono: 'Cambio legítimo probable' },
  poco_relevante: { clase: '', icono: 'Poco relevante: la tarifa del IVA es la misma' },
};

/** Copia un texto al portapapeles; si el navegador no deja, lo deja seleccionado para que la persona lo copie. */
export async function copiarTexto(texto, areaRespaldo) {
  try { await navigator.clipboard.writeText(texto); toast('Mensaje copiado. Ya puede pegarlo en el correo o en WhatsApp.'); return true; } catch { /* sigue abajo */ }
  try { if (areaRespaldo) { areaRespaldo.focus(); areaRespaldo.select(); if (document.execCommand('copy')) { toast('Mensaje copiado.'); return true; } } } catch { /* nada */ }
  toast('No se pudo copiar solo. El mensaje quedó seleccionado: mantenga el dedo sobre él y toque Copiar.');
  return false;
}

/** «Ya lo atendí» se guarda con un solo toque (decisión de Emil, 16 nov 2026): ya no se pide una nota. Se conserva quién y cuándo; el servidor recibe un texto fijo. Devuelve siempre el texto. */
export function pedirNotaAtencion() {
  return Promise.resolve('Atendida desde el facturador');
}

function dato(t, ...v) { return h('div.cb-dato', h('span.cb-et', t), h('div', ...v)); }

function lineaTarjeta(l) {
  const ver = VEREDICTOS[l.veredicto] || VEREDICTOS.revisar;
  const cambia = !!l.cambia_tarifa;
  const dif = +l.diferencia_iva || 0;
  const veces = `${num(l.veces, 0)} de ${num(l.total, 0)} veces`;
  const ult = Array.isArray(l.habitual_ultimas) ? l.habitual_ultimas : [];
  const vendeA = Array.isArray(l.vende_actual) ? l.vende_actual : [], vendeH = Array.isArray(l.vende_habitual) ? l.vende_habitual : [];
  return h('div.cb-linea' + (cambia ? '.cambia' : ''),
    h('p.cb-lt', h('strong', `Línea ${l.linea}`), l.descripcion ? ' · ' + l.descripcion : ''),
    h('p.cb-ver.' + (ver.clase || 'neutro'), h('strong', l.veredicto_titulo || ver.icono)),
    l.veredicto_porque ? h('p.cb-por', l.veredicto_porque) : null,
    l.veredicto_nota ? h('p.cb-por', l.veredicto_nota) : null,
    h('div.cb-compara',
      h('div.cb-lado.ahora',
        h('p.cb-lado-t', 'Lo que trae esta factura'),
        h('p.cb-cabys', h('code', l.cabys), ' · ', h('strong' + (cambia ? '.cb-tar' : ''), 'IVA ' + pct(l.tarifa || l.actual_tarifa))),
        h('p.cb-desc', l.cabys_descripcion || l.actual_descripcion || 'Sin descripción en el catálogo'),
        h('p.cb-peq', +l.nuevo_veces_antes > 0
          ? `Este proveedor ya lo había usado ${num(l.nuevo_veces_antes, 0)} ${+l.nuevo_veces_antes === 1 ? 'vez' : 'veces'} con este producto (la primera, el ${l.nuevo_primera_vez}).`
          : 'Es la primera vez que este proveedor usa este código con este producto.'),
        h('p.cb-peq', vendeA.length ? 'Usted vende con este mismo CABYS: ' + vendeA.join(', ') + '.' : 'Ningún artículo suyo usa este CABYS.')),
      h('div.cb-lado.antes',
        h('p.cb-lado-t', 'Lo que traía antes (lo habitual)'),
        h('p.cb-cabys', h('code', l.habitual), ' · ', h('strong', 'IVA ' + pct(l.habitual_tarifa))),
        h('p.cb-desc', l.habitual_descripcion || 'Sin descripción en el catálogo'),
        h('p.cb-peq', `Lo usó ${veces}${l.habitual_fecha_primera ? `, entre el ${l.habitual_fecha_primera} y el ${l.habitual_fecha_ultima}` : ''}.`),
        ult.length ? h('p.cb-peq', 'Últimas facturas con ese código: ' + ult.map((u) => `n.º ${u.numero} (${u.fecha})`).join(', ') + '.') : null,
        h('p.cb-peq', vendeH.length ? 'Usted vende con ese CABYS: ' + vendeH.join(', ') + '.' : 'Ningún artículo suyo usa ese CABYS.'))),
    h('div.cb-dinero',
      h('p', h('strong', 'En colones: '), `la línea es de ${money(l.subtotal)} sin IVA. Con el CABYS que trae, el IVA es ${money(l.iva_con_actual)}; con el habitual sería ${money(l.iva_con_habitual)}.`,
        cambia ? h('strong', ' ' + (dif < 0 ? `Se acredita ${money(-dif)} menos.` : dif > 0 ? `Se acredita ${money(dif)} más.` : 'No cambia el monto.')) : ' El monto no cambia.'),
      l.tarifa_de_acuerdo === true ? h('p.cb-peq', `La factura sí cobró la tarifa que corresponde al CABYS que trae (${pct(l.tarifa || l.actual_tarifa)}).`)
        : l.tarifa_de_acuerdo === false ? h('p.cb-peq.cb-ojo', `Ojo: la factura cobró ${pct(l.tarifa_aplicada)} y el CABYS que trae corresponde a ${pct(l.tarifa || l.actual_tarifa)}. Puede haber un descuento o una exoneración; revise la línea.`) : null));
}

const pc = (t) => (t == null ? 'sin dato' : num(+t * 100, 1) + ' %');
const signoMoney = (v) => (v < 0 ? '−' : v > 0 ? '+' : '') + money(Math.abs(v));

// Tarifa del IVA realmente cobrada contra el catálogo del CABYS que trae, el del CABYS habitual y lo que ese proveedor cobraba antes
function tarifaTarjeta(t) {
  const ver = VEREDICTOS[t.veredicto] || VEREDICTOS.revisar, dif = +t.diferencia_iva || 0;
  const co = t.coincide_con;
  const fila = (et, valor, marca) => h('div.cb-fila' + (marca ? '.marca' : ''), h('span', et), h('strong', valor), marca ? h('small', marca) : null);
  return h('div.cb-linea.cambia',
    h('p.cb-lt', h('strong', `Línea ${t.linea}`), t.descripcion ? ' · ' + t.descripcion : ''),
    h('p.cb-ver.' + (ver.clase || 'neutro'), h('strong', t.veredicto_titulo || ver.icono)),
    t.veredicto_porque ? h('p.cb-por', t.veredicto_porque) : null,
    h('div.cb-tres',
      fila('Tarifa que realmente cobró la factura', pc(t.tarifa_cobrada)),
      fila(`Tarifa del catálogo para el CABYS que trae (${t.cabys || 'sin CABYS'})`, pc(t.tarifa_catalogo_actual), co === 'actual' ? 'Coincide con lo cobrado' : null),
      t.habitual ? fila(`Tarifa del catálogo para el CABYS habitual (${t.habitual})`, pc(t.tarifa_catalogo_habitual), co === 'habitual' ? 'Coincide con lo cobrado' : null) : null,
      fila('Lo que este proveedor cobraba antes por este producto', pc(t.tarifa_cobrada_habitual), t.total ? `${num(t.veces, 0)} de ${num(t.total, 0)} compras anteriores` : null)),
    co === 'ninguno' ? h('p.cb-peq.cb-ojo', 'Lo cobrado no coincide con ninguno de los dos códigos.') : null,
    (t.ultimas || []).length ? h('p.cb-peq', 'Últimas compras: ' + t.ultimas.map((u) => `n.º ${u.numero} (${u.fecha}) con ${pc(u.tarifa)}`).join(', ') + '.') : null,
    h('div.cb-dinero', h('p', h('strong', 'En colones: '), `la línea es de ${money(t.subtotal)} sin IVA. La factura cobró ${money(t.iva_cobrado)} de IVA; con la tarifa habitual serían ${money(t.iva_con_habitual)}. `,
      h('strong', dif > 0 ? `Se cobró ${money(dif)} más de IVA.` : dif < 0 ? `Se cobró ${money(-dif)} menos de IVA.` : 'No cambia el monto.'))));
}

// Precio por unidad contra el promedio de las últimas compras. Para este negocio pagar menos es lo favorable (verde) y pagar más es lo malo (rojo).
function precioTarjeta(p) {
  const sube = p.direccion === 'sube', imp = +p.impacto_linea || 0, v = +p.variacion || 0;
  const fila = (et, valor) => h('div.cb-fila', h('span', et), h('strong', valor));
  return h('div.cb-linea.' + (sube ? 'sube' : 'baja'),
    h('p.cb-lt', h('strong', `Línea ${p.linea}`), p.descripcion ? ' · ' + p.descripcion : ''),
    h('p.cb-ver.' + (sube ? 'mal' : 'bien'), h('strong', p.veredicto)),
    h('div.cb-tres',
      fila('Precio por unidad en esta factura (sin IVA)', money(p.precio_actual)),
      fila(`Promedio de las últimas ${num(p.compras, 0)} compras`, money(p.promedio)),
      fila('Más barato / más caro que ha pagado', `${money(p.minimo)} / ${money(p.maximo)}`),
      fila('Variación', `${v > 0 ? '+' : ''}${num(v * 100, 1)} % (${signoMoney(+p.diferencia_unidad || 0)} por unidad)`),
      fila(`Impacto en esta línea (${num(p.cantidad, 2)} unidades)`, signoMoney(imp))),
    h('p.cb-peq', `Tendencia: ${p.tendencia === 'sostenida' ? 'sostenida, las dos compras anteriores ya iban en esa dirección' : 'puntual, es un salto de esta compra'}. Últimos precios: ${(p.ultimas || []).map((x) => money(x)).join(', ')}.`),
    p.costo_inventario != null ? h('p.cb-peq', `Costo por unidad de inventario ya registrado: ${money(p.costo_inventario)}.`) : null,
    p.posible_presentacion ? h('p.cb-peq.cb-ojo', 'Una variación tan grande suele ser otra presentación o unidad (por ejemplo caja en vez de unidad), no un cambio de precio. Compare con la factura en papel.') : null);
}

/**
 * Panel completo de una factura: CABYS distinto (alertas viejas), tarifa del IVA, precio y notas.
 * det = detalle de la alerta o respuesta de fx_cabys_revision_factura.
 * opciones: { alAtender?: función (si se pasa, muestra «Ya lo atendí» dentro del panel), sinEncabezado?: boolean, solo?: 'tarifa'|'precio'|'cabys' }
 */
export function panelCabys(det, opciones = {}) {
  const solo = opciones.solo;
  const lineas = !solo || solo === 'cabys' ? (Array.isArray(det?.lineas) ? det.lineas : []) : [];
  const tarifa = !solo || solo === 'tarifa' ? (Array.isArray(det?.tarifa) ? det.tarifa : []) : [];
  const precio = !solo || solo === 'precio' ? (Array.isArray(det?.precio) ? det.precio : []) : [];
  const notas = Array.isArray(det?.notas) ? det.notas : [];
  if (!lineas.length && !tarifa.length && !precio.length && !(notas.length && !solo)) return null;
  const r = det.resumen || {};
  const dif = +r.diferencia_iva || 0, nT = +r.n_cambia_tarifa || 0;
  const msg = tarifa.length || lineas.length ? (det.mensaje_proveedor || '') : '';
  const area = h('textarea.cb-mensaje', { readonly: true, rows: 7, 'aria-label': 'Mensaje para el proveedor' }, msg);
  const impP = precio.reduce((a, x) => a + (+x.impacto_linea || 0), 0);
  const pasos = [];
  if (tarifa.length || lineas.length) {
    pasos.push(h('li', h('strong', 'Si la tarifa del IVA es la correcta: '), 'no hay que pedirle nada al proveedor. Toque «Ya lo atendí» y anote, por ejemplo, «tarifa correcta».'));
    pasos.push(h('li', h('strong', 'Si parece un error: '), msg ? 'copie el mensaje de abajo y envíeselo al proveedor para que corrija la factura. Cuando responda, toque «Ya lo atendí» y anote qué le dijo.' : 'pídale al proveedor que corrija la factura y anote qué le dijo al tocar «Ya lo atendí».'));
  }
  if (precio.length) {
    pasos.push(h('li', h('strong', 'Si el precio es correcto: '), 'anótelo con «Ya lo atendí» (por ejemplo, «el proveedor subió el precio»). Si baja, es una buena noticia.'));
    pasos.push(h('li', h('strong', 'Si parece un error: '), 'pregúntele al proveedor antes de pagar y pida la nota de crédito si cobró de más.'));
  }
  return h('div.cb',
    opciones.sinEncabezado ? null : h('div.cb-cab', h('p', h('strong', det.proveedor || 'Proveedor'), ` · factura n.º ${det.numero || 'sin dato'} · ${det.fecha_texto || ''}`, det.total != null ? ` · total ${money(det.total)}` : '')),
    lineas.length ? h('p.cb-resumen', `${lineas.length === 1 ? 'Una línea trae' : lineas.length + ' líneas traen'} un CABYS distinto al habitual. `,
      nT ? h('strong', `En ${nT === 1 ? 'una' : nT} cambia la tarifa del IVA. `) : 'La tarifa del IVA es la misma. ',
      nT ? `Con los CABYS de la factura se acredita ${money(r.iva_con_actual)} de IVA en estas líneas; con los habituales serían ${money(r.iva_con_habitual)} (${dif < 0 ? money(-dif) + ' menos' : dif > 0 ? money(dif) + ' más' : 'igual'}).` : '') : null,
    tarifa.length ? h('p.cb-resumen', h('strong', `${tarifa.length === 1 ? 'Una línea trae' : tarifa.length + ' líneas traen'} una tarifa de IVA distinta a la habitual o que no corresponde a su CABYS. `), `Diferencia total de IVA contra lo habitual: ${signoMoney(+det.resumen_tarifa?.diferencia_iva || 0)}.`) : null,
    precio.length ? h('p.cb-resumen', h('strong', `${precio.length === 1 ? 'Una línea tiene' : precio.length + ' líneas tienen'} un precio distinto al habitual. `), `Impacto total en esta factura: ${signoMoney(impP)} (negativo = pagó menos).`) : null,
    h('div.cb-lineas', lineas.map(lineaTarjeta), tarifa.map(tarifaTarjeta), precio.map(precioTarjeta)),
    notas.length && !solo ? h('div.cb-notas', h('p.cb-lado-t', 'Notas (solo informativas, no piden hacer nada)'), h('ul', notas.map((n) => h('li', n.texto)))) : null,
    pasos.length ? h('div.cb-acciones',
      h('p.cb-lado-t', 'Cómo atenderla'),
      h('ol.cb-pasos', pasos),
      msg ? h('div.cb-copiar', area, h('button.btn', { type: 'button', onclick: () => copiarTexto(msg, area) }, 'Copiar mensaje para el proveedor')) : null,
      opciones.alAtender ? h('div.cb-botones', h('button.btn.primario', { type: 'button', onclick: (e) => opciones.alAtender(e.currentTarget) }, 'Ya lo atendí')) : null) : null);
}
