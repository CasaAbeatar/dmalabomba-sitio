// «Caja para mí» · SINPE sin factura y conciliación de tres puntos (aviso del banco ↔ venta ↔ movimiento del BCR).
import { h, money, campoBusqueda } from './util.js';
import { sinpeAdmin } from './api_sinpe_admin.js';
import { zonaCarga, chip, kpi, tablaApilable, periodoConMemoria } from './sinpe_caja_ui.js';
import { crearDescarga, nombrePeriodo } from './descargas.js';
import { diaLargo, horaCR, fechaHoraCR, numTxt, coincidePago, tablaSinFactura } from './sinpe_admin_calc.js';
import { textoRango } from './periodo.js';

/* ---------------------------------------------------------------- SINPE sin factura */
export function seccionSinFactura(ctx) {
  const { soc, mem, nombreEmpresa, empresaCodigo, app } = ctx;
  const ms = mem.sinFactura;
  let datos = null;
  const per = periodoConMemoria(ms, () => zona.recargar(), 'mes');
  const busca = h('input.campo.sc-buscar', { type: 'search', placeholder: 'Buscar por nombre, comprobante o monto', 'aria-label': 'Buscar en la lista', value: ms.q || '', autocomplete: 'off' });
  const cuerpo = h('div.sc-panel');

  const filtrados = () => (datos?.por_dia || []).map((d) => {
    const pagos = d.pagos.filter((p) => coincidePago(p, ms.q || ''));
    return { dia: d.dia, pagos, n: pagos.length, total: pagos.reduce((a, p) => a + +p.monto, 0) };
  }).filter((d) => d.n > 0);

  function pintarLista() {
    if (!datos) return;
    const dias = filtrados(), n = dias.reduce((a, d) => a + d.n, 0), total = dias.reduce((a, d) => a + d.total, 0);
    cuerpo.replaceChildren(
      h('div.sc-kpis', kpi(ms.q ? 'Pagos que coinciden' : 'SINPE sin factura', money(total), `${numTxt(n)} ${n === 1 ? 'pago' : 'pagos'} en ${numTxt(dias.length)} ${dias.length === 1 ? 'día' : 'días'}`, n ? 'rojo' : '')),
      empresaCodigo === 'soda' ? h('p.sc-nota', 'La Soda todavía factura con Prisma, por eso casi todos sus SINPE aparecen aquí: el banco los avisó pero ninguna venta de este facturador los tiene. Cuando la Soda facture aquí, esta lista se irá vaciando sola.') : null,
      datos.truncado ? h('p.sc-aviso', `Son muchos pagos: se muestran los ${numTxt(datos.tope)} más recientes de ${numTxt(datos.total_n)}. Escoja un período más corto para verlos todos.`) : null,
      dias.length ? h('div.sc-lista', dias.map((d) => [
        h('p.sc-dia', h('span', diaLargo(d.dia)), h('span', `${numTxt(d.n)} ${d.n === 1 ? 'pago' : 'pagos'} · ${money(d.total)}`)),
        ...d.pagos.map((p) => h('div.sc-fila',
          h('div.sc-fila-i', h('span.sc-nombre', p.pagador || 'Sin nombre'), h('small', `${horaCR(p.hora)}${p.referencia ? ' · comprobante ' + p.referencia : ''}${p.detalle ? ' · ' + p.detalle : ''}`)),
          h('div.sc-fila-d', h('span.sc-monto', money(p.monto)), p.origen === 'historial' ? chip('Historial', 'neutro') : null, p.estado === 'revision' ? chip('En revisión', 'espera') : null))),
      ])) : h('p.sc-vacio', ms.q ? 'Ningún pago coincide con lo escrito.' : 'En este período no hay SINPE sin factura. Todo lo que el banco avisó tiene su venta.'));
  }

  const zona = zonaCarga({
    cargar: async () => { const [d, a] = per.rango(); datos = await sinpeAdmin.sinFactura(soc, d, a); return datos; },
    pintar: () => { pintarLista(); return cuerpo; },
  });
  busca.addEventListener('input', () => { ms.q = busca.value; pintarLista(); });
  const buscaConBorrar = campoBusqueda(busca, () => { ms.q = ''; pintarLista(); }); // el botón «Borrar búsqueda» envuelve al campo; hay que poner el envoltorio, no el campo suelto
  if (ms.q) buscaConBorrar.querySelector('button')?.removeAttribute('hidden');

  const descarga = crearDescarga(() => {
    if (!datos || !datos.por_dia?.length) return { hojas: [] };
    const [d, a] = per.rango();
    return { nombre: 'SINPE sin factura ' + nombrePeriodo(d, a), empresa: nombreEmpresa, cedula: app.soc?.cedula || '', titulo: 'SINPE sin factura', subtitulo: textoRango(d, a), hojas: [tablaSinFactura(datos)] };
  }, { texto: 'Descargar', etiqueta: 'Descargar la lista de SINPE sin factura' });

  const el = h('div.sc-panel',
    h('section.sc-tarjeta',
      h('div.sc-cab-tarjeta', h('div', h('h2', 'SINPE sin factura'), h('p.sc-ayuda', `Pagos reales de ${nombreEmpresa} que el banco avisó y que no están atados a ninguna venta. Los días más recientes van primero. Cifras brutas, en colones.`)), descarga),
      per.el, h('label.etq', { style: 'margin-top:.7rem' }, 'Buscar', buscaConBorrar)),
    zona.el);
  zona.recargar();
  return { el, destruir: () => zona.destruir() };
}

/* ---------------------------------------------------------------- Conciliación */
export function seccionConciliacion(ctx) {
  const { soc, mem, nombreEmpresa } = ctx;
  const mc = mem.conciliacion;
  const per = periodoConMemoria(mc, () => zona.recargar(), 'mes');

  const celda = (titulo, valor, nota, clase = '') => h('div.sc-punto-caja' + (clase ? '.' + clase : ''), h('h3', titulo), h('div.sc-kpi-v', valor), h('div.sc-kpi-n', nota));
  const detalle = (titulo, n, contenido, abierto = false) => h('details.sc-detalle', { open: abierto && n > 0 },
    h('summary', h('span', titulo), chip(numTxt(n), n ? 'espera' : 'ok')), n ? contenido : h('p.sc-vacio', 'Nada por revisar.'));

  function pintar(d) {
    const av = d.avisos, ve = d.ventas, b = d.banco;
    const filasAv = (d.lista_avisos_sin_venta || []).map((p) => [h('span', diaLargoCorto(p.hora)), p.pagador || 'Sin nombre', h('span', p.referencia || '—'), money(p.monto)]);
    const filasVe = (d.lista_ventas_sin_aviso || []).map((p) => [h('span', diaLargoCorto(p.hora)), p.venta_numero || '—', p.cobrado_por || '—', p.referencia ? h('span', p.referencia) : 'Sin comprobante escrito', money(p.monto)]);
    const filasDi = (d.lista_monto_distinto || []).map((p) => [h('span', diaLargoCorto(p.fecha_pago)), p.venta_numero || '—', money(p.aviso_monto), money(p.venta_monto), money(p.venta_monto - p.aviso_monto)]);
    const filasPo = (d.lista_posibles || []).map((p) => [h('span', diaLargoCorto(p.creado_en)), p.venta_numero || '—', money(p.monto), `${numTxt(p.minutos)} min de diferencia`]);
    return h('div.sc-panel',
      h('div.sc-tres',
        celda('1 · Aviso del banco (SMS)', money(av.total), `${numTxt(av.n)} avisos. ${numTxt(d.avisos_con_venta.n)} con venta y ${numTxt(d.avisos_sin_venta.n)} sin venta (${money(d.avisos_sin_venta.total)}).`),
        celda('2 · Venta del facturador', money(ve.total), `${numTxt(ve.n)} cobros con SINPE. ${numTxt(d.ventas_con_aviso.n)} con su aviso y ${numTxt(d.ventas_sin_aviso.n)} sin aviso (${money(d.ventas_sin_aviso.total)}).${ve.sin_referencia ? ` ${numTxt(ve.sin_referencia)} sin comprobante escrito.` : ''}`),
        b.cargado ? celda('3 · Movimiento del banco', money(b.total), `${numTxt(b.n)} movimientos. ${numTxt(b.avisos_sin_banco_n)} avisos sin movimiento y ${numTxt(b.banco_sin_aviso_n)} movimientos sin aviso.`)
          : celda('3 · Movimiento del banco', 'Pendiente', 'Todavía no entra el archivo de movimientos del BCR. No se inventa ningún dato del banco: cuando se defina el formato del archivo se carga y esta columna se cuadra por comprobante.', 'pendiente')),
      h('p.sc-nota', 'Se cuadra por el comprobante del banco: el que viene en el SMS contra el que la cajera escribió al cobrar. «Posibles» son sugerencias por monto y hora cuando falta el comprobante; no son seguras.'),
      detalle('Avisos del banco sin venta', d.avisos_sin_venta.n, tablaApilable([{ t: 'Cuándo', cab: true }, { t: 'Quién pagó', ancha: true }, { t: 'Comprobante', ancha: true }, { t: 'Monto', der: true }], filasAv), true),
      detalle('Cobros con SINPE sin aviso del banco', d.ventas_sin_aviso.n, tablaApilable([{ t: 'Cuándo', cab: true }, { t: 'Venta' }, { t: 'Cajera' }, { t: 'Comprobante', ancha: true }, { t: 'Monto', der: true }], filasVe), true),
      detalle('Montos distintos entre aviso y venta', d.monto_distinto_n, tablaApilable([{ t: 'Cuándo', cab: true }, { t: 'Venta' }, { t: 'Aviso', der: true }, { t: 'Venta', der: true }, { t: 'Diferencia', der: true }], filasDi), true),
      detalle('Posibles parejas (por monto y hora)', d.posibles_n, tablaApilable([{ t: 'Cuándo', cab: true }, { t: 'Venta' }, { t: 'Monto', der: true }, { t: 'Aviso cercano' }], filasPo)),
      (d.lista_avisos_sin_venta || []).length >= 200 || (d.lista_ventas_sin_aviso || []).length >= 200 ? h('p.sc-aviso', 'Cada lista muestra hasta 200 renglones, los más recientes primero. Escoja un período más corto para ver el resto.') : null,
      h('section.sc-tarjeta',
        h('h2', 'Archivo del BCR'),
        h('p.sc-ayuda', b.movimientos_en_total ? `Ya hay ${numTxt(b.movimientos_en_total)} movimientos del banco guardados.` : 'Todavía no hay movimientos del banco guardados.'),
        h('button.btn', { type: 'button', disabled: true }, 'Cargar archivo del BCR (todavía no disponible)'),
        h('p.sc-ayuda', 'La entrada ya existe en el sistema; falta definir el formato del archivo que baja el banco. Cuando se defina, aquí se sube y se cuadra solo.')));
  }
  const diaLargoCorto = (iso) => fechaHoraCR(iso);

  const zona = zonaCarga({ cargar: () => { const [d, a] = per.rango(); return sinpeAdmin.conciliacion(soc, d, a); }, pintar, filas: 4 });
  const el = h('div.sc-panel',
    h('section.sc-tarjeta',
      h('div.sc-cab-tarjeta', h('div', h('h2', 'Conciliación de tres puntos'), h('p.sc-ayuda', `Compara lo que avisó el banco, lo que el facturador cobró con SINPE y, cuando exista el archivo, lo que el banco movió. ${nombreEmpresa}. Cifras brutas, en colones.`))),
      per.el),
    zona.el);
  zona.recargar();
  return { el, destruir: () => zona.destruir() };
}
