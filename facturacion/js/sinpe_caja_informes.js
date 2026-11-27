// «Caja para mí» · INFORMES: (1) informe mensual de SINPE para la contadora, (2) estadística por hora, día y cajera (media, desviación estándar y coeficiente de variación),
// (3) serie por hora de los pagos SINPE como insumo del modelo de salida de inventario. Cifras brutas (lo que el banco avisó), en colones; las series van en orden cronológico.
import { h, money } from './util.js';
import { sinpeAdmin } from './api_sinpe_admin.js';
import { zonaCarga, kpi, tablaApilable, periodoConMemoria, mesesParaEscoger, columnasConLectura } from './sinpe_caja_ui.js';
import { crearDescarga, nombrePeriodo } from './descargas.js';
import { textoRango } from './periodo.js';
import { diaLargo, dmaDeYmd, fechaHoraCR, numTxt, pctTxt, nombreMes, nombreEstadoPago, recorteHoras, etiquetaHora, etiquetaCajera, lecturaHora,
  NOMBRE_ISODOW, tablaInformeMes, tablaResumenMes, tablaHoras, tablaSerieHoras } from './sinpe_admin_calc.js';

const SUBS = [['mes', 'Informe del mes (contadora)'], ['estadistica', 'Estadística'], ['serie', 'Serie por hora (inventario)']];

export function seccionInformes(ctx) {
  const { mem } = ctx;
  const cuerpo = h('div.sc-panel');
  const limpiezas = [];
  let actual = null;
  const botones = SUBS.map(([id, txt]) => h('button.btn', { type: 'button', 'data-id': id, 'aria-pressed': String(mem.informes.vista === id), onclick: () => ir(id) }, txt));
  function ir(id) {
    mem.informes.vista = id;
    botones.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.id === id)));
    actual?.destruir?.(); limpiezas.splice(0).forEach((f) => f());
    actual = id === 'mes' ? informeMes(ctx) : id === 'estadistica' ? estadistica(ctx, limpiezas) : serie(ctx);
    cuerpo.replaceChildren(actual.el);
  }
  ir(mem.informes.vista);
  return { el: h('div.sc-panel', h('div.sc-sub', { role: 'group', 'aria-label': 'Informe' }, botones), cuerpo), destruir: () => { actual?.destruir?.(); limpiezas.splice(0).forEach((f) => f()); } };
}

/* ---------------------------------------------------------------- Informe del mes */
function informeMes(ctx) {
  const { soc, mem, nombreEmpresa, app } = ctx;
  const mi = mem.informes;
  const meses = mesesParaEscoger(14);
  if (!meses.some((m) => m.valor === mi.mes)) mi.mes = meses[0].valor;
  let datos = null;
  const sel = h('select.campo', { 'aria-label': 'Mes del informe', onchange: () => { mi.mes = sel.value; zona.recargar(); } }, meses.map((m) => h('option', { value: m.valor, selected: m.valor === mi.mes }, m.texto)));

  function pintar(d) {
    datos = d;
    const r = d.resumen || {}, f = d.medio06_facturas || { n: 0, total: 0 }, nc = d.notas_credito_mes || { n: 0, total: 0 };
    const dif = (+r.total || 0) - (+f.total || 0);
    const filas = [...(d.filas || [])].reverse(); // en pantalla, el día más reciente primero; el archivo va del 1 al último día
    const cols = [{ t: 'Fecha y hora', cab: true }, { t: 'Monto', der: true }, { t: 'Referencia del banco', ancha: true }, { t: 'Estado' }, { t: 'Venta', nw: true }, { t: 'Clave de la factura', ancha: true }];
    return h('div.sc-panel',
      h('div.sc-kpis',
        kpi('SINPE que avisó el banco', money(r.total || 0), `${numTxt(r.n || 0)} pagos en ${nombreMes(d.mes)}`),
        kpi('Medio de pago 06 en facturas', money(f.total || 0), `${numTxt(f.n)} facturas y tiquetes aceptados del mes`),
        kpi('Diferencia', money(dif), 'Lo que avisó el banco menos el medio 06 facturado', Math.abs(dif) > 0.005 ? 'rojo' : '')),
      tablaApilable([{ t: 'Concepto', cab: true }, { t: 'Pagos', der: true }, { t: 'Monto', der: true }], [
        ['SINPE avisado por el banco', numTxt(r.n || 0), money(r.total || 0)],
        ['… atado a una venta del facturador', numTxt(r.con_venta_n || 0), money(r.con_venta_total || 0)],
        ['… con clave de factura', numTxt(r.con_clave_n || 0), money(r.con_clave_total || 0)],
        ['… sin venta en el facturador', numTxt(r.sin_venta_n || 0), money(r.sin_venta_total || 0)],
        ['Medio 06 en facturas y tiquetes aceptados', numTxt(f.n), money(f.total || 0)],
        ['Notas de crédito aceptadas del mes (informativo)', numTxt(nc.n), money(nc.total || 0)],
      ]),
      h('p.sc-nota', 'Cifras brutas: no se descuentan notas de crédito. La diferencia no tiene por qué ser cero: mientras la empresa facture con otro sistema, el banco avisa pagos que las facturas de este facturador no ven.' + (r.historial_n ? ` ${numTxt(r.historial_n)} de los pagos vienen del historial que el teléfono reenvió.` : '')),
      avisoSilencio(d),
      filas.length ? listaPorTandas(cols, filas, r) : h('p.sc-vacio', 'En este mes el banco no avisó ningún SINPE.'));
  }
  // En pantalla se muestran de 25 en 25 (un mes puede tener cientos de pagos); el archivo para la contadora lleva todos.
  function listaPorTandas(cols, filas, r) {
    const caja = h('div.sc-panel');
    let ver = 25;
    const pintarTanda = () => {
      const filasVistas = filas.slice(0, ver);
      const resto = filas.length - filasVistas.length;
      caja.replaceChildren(
        resto > 0 ? h('p.sc-nota', `Se muestran los ${numTxt(filasVistas.length)} pagos más recientes de ${numTxt(filas.length)}. El total de abajo es el de todo el mes y el archivo para la contadora lleva todos.`) : null,
        tablaApilable(cols, filasVistas.map((p) => [fechaHoraCR(p.hora), money(p.monto), h('span', p.referencia || '—'), nombreEstadoPago(p.estado) + (p.origen === 'historial' ? ' · historial' : ''), p.venta_numero || '—', h('span.sc-clave', p.clave || (p.venta_numero ? 'La venta no tiene factura' : '—'))]),
          ['Total del mes', money(r.total || 0), '', '', '', '']),
        resto > 0 ? h('button.btn', { type: 'button', onclick: () => { ver += 25; pintarTanda(); } }, `Mostrar ${numTxt(Math.min(25, resto))} más`) : null);
    };
    pintarTanda();
    return caja;
  }
  function avisoSilencio(d) {
    if (!d.ultimo_aviso) return h('p.sc-aviso', 'Todavía no se ha recibido ningún aviso del banco para esta empresa.');
    const fin = new Date(d.hasta + 'T23:59:59-06:00');
    const ult = new Date(d.ultimo_aviso);
    if (fin > new Date()) return null; // mes en curso
    if ((fin - ult) / 86400000 > 1) return h('p.sc-aviso', `El último aviso del banco recibido es del ${fechaHoraCR(d.ultimo_aviso)}: si el mes termina después, faltan los avisos de esos días (por ejemplo, un teléfono sin señal).`);
    return null;
  }
  const zona = zonaCarga({ cargar: () => sinpeAdmin.informeMes(soc, mi.mes), pintar, filas: 4 });
  const descarga = crearDescarga(() => {
    if (!datos || !(datos.filas || []).length) return { hojas: [] };
    return { nombre: 'SINPE ' + nombreMes(datos.mes), empresa: nombreEmpresa, cedula: app.soc?.cedula || '', titulo: 'SINPE Móvil del mes', subtitulo: nombreMes(datos.mes) + ' · ordenado del día 1 al último día', hojas: [tablaResumenMes(datos), tablaInformeMes(datos)] };
  }, { texto: 'Descargar para la contadora', etiqueta: 'Descargar el informe mensual de SINPE' });
  const el = h('div.sc-panel',
    h('section.sc-tarjeta',
      h('div.sc-cab-tarjeta', h('div', h('h2', 'Informe mensual de SINPE'), h('p.sc-ayuda', `Para la contadora: cada SINPE del mes de ${nombreEmpresa} con su fecha, monto, referencia, estado y la clave de la factura, y el total del medio de pago 06 contra las facturas.`)), descarga),
      h('label.etq', 'Mes', sel)),
    zona.el);
  zona.recargar();
  return { el, destruir: () => zona.destruir() };
}

/* ---------------------------------------------------------------- Estadística */
function estadistica(ctx, limpiezas) {
  const { soc, mem, nombreEmpresa, app } = ctx;
  const me = mem.informes.est;
  let datos = null;
  const per = periodoConMemoria(me, () => zona.recargar(), 'mes');

  function pintar(d) {
    datos = d;
    if (d.vacio) return h('p.sc-vacio', 'En este período el banco no avisó ningún SINPE, así que no hay nada que calcular.');
    const r = d.resumen, rd = d.resumen_dia;
    const horas = recorteHoras(d.por_hora);
    const dias = d.por_dia.slice(-62);
    const sinPagos = d.dias - rd.dias_con_pagos;
    return h('div.sc-panel',
      d.dias_sin_avisos_al_final > 1 ? h('p.sc-aviso.alto', { role: 'alert' }, `Los últimos avisos del banco son del ${fechaHoraCR(d.ultimo_aviso)}: hace ${numTxt(d.dias_sin_avisos_al_final)} días no llega ninguno. Puede ser falta de señal del teléfono y no falta de ventas con SINPE; esos días no se cuentan.`) : null,
      sinPagos > 0 && sinPagos / d.dias > 0.2 ? h('p.sc-aviso', `De los ${numTxt(d.dias)} días entre el ${dmaDeYmd(d.dato_desde)} y el ${dmaDeYmd(d.dato_hasta)}, ${numTxt(sinPagos)} no tienen ningún aviso del banco. Las medias «por día» los cuentan como cero; si fueron días sin servicio o sin señal del teléfono, las medias salen más bajas que lo real.`) : null,
      h('div.sc-kpis',
        kpi('Pagos SINPE', numTxt(r.n), `${numTxt(d.dias)} días, del ${dmaDeYmd(d.dato_desde)} al ${dmaDeYmd(d.dato_hasta)}`),
        kpi('Total (bruto)', money(r.total), 'Lo que el banco avisó, en colones'),
        kpi('Pago promedio', money(r.media), `Mediana ${money(r.mediana)} · 9 de cada 10 pagos son de ${money(r.p90)} o menos · el mayor, ${money(r.maximo)}`),
        kpi('Desviación estándar del pago', money(r.sd), 'Qué tanto se alejan los pagos del promedio'),
        kpi('Coeficiente de variación del pago', pctTxt(r.cv), 'Desviación estándar entre el promedio'),
        kpi('Pagos por día', numTxt(rd.n_media, 1), `Desviación estándar ${numTxt(rd.n_sd, 1)} · variación ${pctTxt(rd.n_cv)}`),
        kpi('Monto por día', money(rd.total_media), `Desviación estándar ${money(rd.total_sd)} · variación ${pctTxt(rd.total_cv)}`)),
      h('section.sc-tarjeta', h('h2', 'Pagos SINPE por hora del día'), h('p.sc-ayuda', 'Promedio de pagos por cada día del período, hora por hora (de 00:00 a 23:59, hora de Costa Rica). Es solo la parte pagada con SINPE.'),
        columnasConLectura(horas.map((x) => ({ id: x.hora, etiqueta: etiquetaHora(x.hora).slice(0, 2), valor: +x.dia_media || 0, texto: lecturaHora(x) })),
          { tituloX: 'Hora del día (24 horas)', tituloY: 'Pagos SINPE por día (promedio)', color: 'ambar', alto: 260, anchoEtiqueta: 30, formato: (v) => numTxt(v, 1) }, limpiezas, 'No hay pagos en este período.')),
      h('section.sc-tarjeta', h('h2', 'Monto SINPE por día'), h('p.sc-ayuda', `Del día más antiguo (izquierda) al más reciente (derecha). Cifras brutas, en colones.${d.por_dia.length > 62 ? ' Se grafican los últimos 62 días del período.' : ''}`),
        columnasConLectura(dias.map((x) => ({ id: x.dia, etiqueta: x.dia.slice(8, 10) + '/' + x.dia.slice(5, 7), valor: +x.total, texto: `${diaLargo(x.dia)}: ${numTxt(x.n)} ${x.n === 1 ? 'pago' : 'pagos'}, ${money(x.total)}` })),
          { tituloX: 'Día (más antiguo a la izquierda)', tituloY: 'Monto SINPE del día (₡, bruto)', color: 'rojo', alto: 260, anchoEtiqueta: 44 }, limpiezas)),
      h('section.sc-tarjeta', h('div.sc-cab-tarjeta', h('div', h('h2', 'Por hora'), h('p.sc-ayuda', '«Pago» es lo que paga cada cliente; «por día» es cuántos pagos hay en esa hora cada día, contando los días sin pagos como cero. Variación = desviación estándar entre el promedio.')), descargaHoras()),
        tablaApilable([{ t: 'Hora', cab: true, nw: true }, { t: 'Pagos', der: true }, { t: 'Total', der: true }, { t: 'Pago promedio', der: true }, { t: 'Desv. del pago', der: true }, { t: 'Variación del pago', der: true }, { t: 'Pagos por día', der: true }, { t: 'Desv. por día', der: true }, { t: 'Variación por día', der: true }],
          horas.map((x) => [etiquetaHora(x.hora), numTxt(x.n), money(x.total), x.n ? money(x.ticket_media) : '—', x.ticket_sd != null ? money(x.ticket_sd) : '—', pctTxt(x.ticket_cv), numTxt(x.dia_media, 2), numTxt(x.dia_sd, 2), pctTxt(x.dia_cv)]))),
      h('section.sc-tarjeta', h('h2', 'Por día de la semana'), h('p.sc-ayuda', 'Cada día de la semana cuenta cuántos días hubo en el período (con o sin pagos).'),
        tablaApilable([{ t: 'Día', cab: true, nw: true }, { t: 'Días', der: true }, { t: 'Pagos', der: true }, { t: 'Total', der: true }, { t: 'Pagos por día', der: true }, { t: 'Desv.', der: true }, { t: 'Variación', der: true }, { t: 'Monto por día', der: true }, { t: 'Desv.', der: true }, { t: 'Variación', der: true }],
          d.por_dow.map((x) => [NOMBRE_ISODOW[x.dow], numTxt(x.dias), numTxt(x.n), money(x.total), numTxt(x.dia_n_media, 1), numTxt(x.dia_n_sd, 1), pctTxt(x.dia_n_cv), money(x.dia_total_media), x.dia_total_sd != null ? money(x.dia_total_sd) : '—', pctTxt(x.dia_total_cv)]))),
      h('section.sc-tarjeta', h('h2', 'Por cajera'), h('p.sc-ayuda', 'La cajera solo se conoce cuando el SINPE está atado a una venta del facturador; el resto va en «Sin cajera conocida».'),
        tablaApilable([{ t: 'Cajera', cab: true }, { t: 'Pagos', der: true }, { t: 'Total', der: true }, { t: 'Pago promedio', der: true }, { t: 'Desv. del pago', der: true }, { t: 'Variación', der: true }],
          d.por_cajera.map((x) => [etiquetaCajera(x.cajera), numTxt(x.n), money(x.total), money(x.media), x.sd != null ? money(x.sd) : '—', pctTxt(x.cv)]))));
  }
  const descargaHoras = () => crearDescarga(() => {
    if (!datos || datos.vacio) return { hojas: [] };
    const [a, z] = per.rango();
    return { nombre: 'SINPE por hora ' + nombrePeriodo(a, z), empresa: nombreEmpresa, cedula: app.soc?.cedula || '', titulo: 'SINPE por hora', subtitulo: textoRango(a, z), hojas: [tablaHoras({ por_hora: recorteHoras(datos.por_hora) })] };
  }, { texto: 'Descargar', etiqueta: 'Descargar la estadística por hora' });
  const zona = zonaCarga({ cargar: () => { const [a, z] = per.rango(); return sinpeAdmin.estadistica(soc, a, z); }, pintar, filas: 5 });
  const el = h('div.sc-panel',
    h('section.sc-tarjeta',
      h('div.sc-cab-tarjeta', h('div', h('h2', 'Estadística de los SINPE'), h('p.sc-ayuda', `${nombreEmpresa}: por hora, por día de la semana y por cajera, con promedio, desviación estándar y coeficiente de variación. Cifras brutas, en colones.`))),
      per.el),
    zona.el);
  zona.recargar();
  return { el, destruir: () => zona.destruir() };
}

/* ---------------------------------------------------------------- Serie por hora */
function serie(ctx) {
  const { soc, mem, nombreEmpresa, app } = ctx;
  const ms = mem.informes.serie;
  let datos = null;
  const per = periodoConMemoria(ms, () => zona.recargar(), 'mes');
  function pintar(d) {
    datos = d;
    const filas = d.filas || [];
    const dias = new Set(filas.map((x) => String(x.dia).slice(0, 10))).size;
    const tot = filas.reduce((a, x) => a + +x.total, 0), n = filas.reduce((a, x) => a + +x.n, 0);
    const recientes = filas.slice(-48).reverse();
    return h('div.sc-panel',
      h('p.sc-aviso', { role: 'note' }, d.nota),
      h('div.sc-kpis', kpi('Pagos', numTxt(n), `${numTxt(filas.length)} combinaciones de día y hora, en ${numTxt(dias)} días`), kpi('Total (bruto)', money(tot), 'Solo SINPE Móvil'), kpi('Último aviso del banco', d.ultimo_aviso ? fechaHoraCR(d.ultimo_aviso) : '—', 'Después de esta hora el período puede estar incompleto')),
      filas.length ? h('section.sc-tarjeta', h('h2', 'Vista previa'), h('p.sc-ayuda', 'Las últimas 48 combinaciones de día y hora, la más reciente primero. El archivo completo baja en orden cronológico: enero primero, día por día y hora por hora.'),
        tablaApilable([{ t: 'Fecha', cab: true, nw: true }, { t: 'Hora', der: true }, { t: 'Pagos', der: true }, { t: 'Total', der: true }], recientes.map((x) => [dmaDeYmd(x.dia), etiquetaHora(x.hora), numTxt(x.n), money(x.total)])))
        : h('p.sc-vacio', 'En este período el banco no avisó ningún SINPE.'));
  }
  const zona = zonaCarga({ cargar: () => { const [a, z] = per.rango(); return sinpeAdmin.serieHoras(soc, a, z); }, pintar });
  const descarga = crearDescarga(() => {
    if (!datos || !(datos.filas || []).length) return { hojas: [] };
    const [a, z] = per.rango();
    return { nombre: 'Serie SINPE por hora ' + nombrePeriodo(a, z), empresa: nombreEmpresa, cedula: app.soc?.cedula || '', titulo: 'Pagos SINPE por hora', subtitulo: textoRango(a, z) + ' · solo la parte pagada con SINPE', hojas: [tablaSerieHoras(datos)] };
  }, { texto: 'Descargar la serie', etiqueta: 'Descargar la serie de pagos SINPE por hora' });
  const el = h('div.sc-panel',
    h('section.sc-tarjeta',
      h('div.sc-cab-tarjeta', h('div', h('h2', 'Serie por hora de los SINPE'), h('p.sc-ayuda', `Pagos y monto de ${nombreEmpresa} por día y por hora, para alimentar el modelo de salida de inventario. Ojo: es solo la parte pagada con SINPE, no toda la venta.`)), descarga),
      per.el),
    zona.el);
  zona.recargar();
  return { el, destruir: () => zona.destruir() };
}
