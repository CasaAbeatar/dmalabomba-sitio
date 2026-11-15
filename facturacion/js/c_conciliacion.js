// Contabilidad, pestaña «Conciliación»: lo que el BCR depositó por tarjeta frente a lo que el facturador registró como cobrado con tarjeta. Muestra la comisión del datáfono y las retenciones.
import { h, money, esqueleto, bloqueError, textoDeError } from './util.js';
import { selectorPeriodo, textoRango, fechaDMA } from './periodo.js';
import { cargarHoja } from './ui_hojas.js';
import { autoAjustar } from './graficos.js';
import { graficoLineas } from './grafico_lineas.js';
import { llenar } from './c_comun.js';
import { conciliacion } from './api_contable.js';

const pct2 = (x) => (x == null ? 'sin dato' : new Intl.NumberFormat('es-CR', { maximumFractionDigits: 2 }).format(x * 100) + ' %');
const ddmm = (ymd) => ymd.slice(8, 10) + '/' + ymd.slice(5, 7);

export default {
  id: 'conc-bcr', texto: 'Conciliación BCR',
  async montar(cont, ctx) {
    const { soc, memoria } = ctx;
    await cargarHoja('listados.css'); await cargarHoja('banco_caja.css');
    const cuerpo = h('div.con-raiz'); let rango, ficha = 0; const limpiezas = [];
    const periodo = selectorPeriodo({ inicial: memoria.concPeriodo || 'mes', alCambiar: ([d, a], id) => { memoria.concPeriodo = id; rango = [d, a]; cargar(); } });
    rango = periodo.rango();
    cont.append(h('div.con-raiz', h('div.con-bloque', h('h2', 'Período a conciliar'), periodo.el), cuerpo));

    async function cargar() {
      const mi = ++ficha; limpiezas.splice(0).forEach((f) => f());
      llenar(cuerpo, esqueleto(3, 'Conciliando con el BCR…'));
      let r; try { r = await conciliacion(soc.id, rango[0], rango[1]); } catch (er) { if (mi === ficha) llenar(cuerpo, bloqueError({ titulo: 'No se pudo conciliar', mensaje: textoDeError(er), alReintentar: cargar })); return; }
      if (mi !== ficha) return;
      const t = r.totales, dias = r.dias || [];
      const lect = h('p.lectura', { 'aria-live': 'polite' }, 'Toque o pase el cursor sobre el gráfico para ver el día.');
      const gr = h('div.gr-caja');
      if (dias.length) limpiezas.push(autoAjustar(gr, (w) => llenar(gr, graficoLineas([
        { nombre: 'BCR depositó (neto)', clase: 'verde', valores: dias.map((d) => (d.hay_banco ? d.banco_neto : null)) },
        { nombre: 'Facturador cobró con tarjeta (bruto)', clase: 'tinta', valores: dias.map((d) => d.fact_tarjeta) },
      ], dias.map((d) => ddmm(d.fecha)), { ancho: w, alto: 280, tituloX: 'Día (de izquierda a derecha, del más antiguo al más reciente)', tituloY: 'Colones por día (₡)', descripcion: 'Depósitos del BCR frente a cobros con tarjeta del facturador',
        alSeleccionar: (i) => { const d = dias[i]; lect.textContent = fechaDMA(d.fecha) + ': BCR ' + (d.hay_banco ? 'depositó ' + money(d.banco_neto) + ' (bruto ' + money(d.banco_bruto) + ', comisión ' + money(d.banco_comision) + ')' : 'sin dato') + '; facturador ' + money(d.fact_tarjeta) + ' con tarjeta (' + d.fact_n_tarjeta + ' cobros).'; } }))));
      const filas = dias.map((d) => h('tr', h('td', ddmm(d.fecha)), h('td.der', d.hay_banco ? money(d.banco_bruto) : 'sin dato'), h('td.der', d.hay_banco ? money(d.banco_comision) : ''), h('td.der', d.hay_banco ? money(d.banco_ret_iva + d.banco_ret_renta) : ''),
        h('td.der', d.hay_banco ? money(d.banco_neto) : ''), h('td.der', money(d.fact_tarjeta)), h('td.der', money(d.fact_sinpe + d.fact_transferencia)), h('td.der', d.hay_banco ? h('span.bc-dif' + (Math.abs(d.diferencia) < 1 ? '.cero' : '.pos'), money(d.diferencia)) : ''), h('td', d.nota || '')));
      llenar(cuerpo,
        r.ventas_de_prueba ? h('div.bc-aviso', h('strong', 'Ventas de prueba. '), 'El facturador todavía está en ambiente ' + r.ambiente + ': las diferencias son grandes porque las ventas reales de la Soda aún pasan por Prisma. Cuando se facture en producción la conciliación se vuelve útil.') : null,
        !r.tiene_banco ? h('div.bc-aviso', 'No hay depósitos del BCR cargados en este período.') : null,
        h('div.con-bloque', h('h2', 'Resumen, ' + textoRango(rango[0], rango[1])),
          h('div.con-cifras',
            h('div.con-cifra', h('div.t', 'Ventas con tarjeta según el BCR (bruto)'), h('div.v', money(t.banco_bruto)), h('div.n', t.vouchers + ' vouchers · ' + t.dias_con_banco + ' días con dato')),
            h('div.con-cifra', h('div.t', 'Comisión del datáfono'), h('div.v', money(t.banco_comision)), h('div.n', 'efectiva ' + pct2(t.tasa_comision) + ' · acordada ' + pct2(r.tasa_comision_acordada))),
            h('div.con-cifra', h('div.t', 'Retenciones de IVA y renta'), h('div.v', money(t.banco_ret_iva + t.banco_ret_renta)), h('div.n', 'IVA ' + money(t.banco_ret_iva) + ' · renta ' + money(t.banco_ret_renta))),
            h('div.con-cifra', h('div.t', 'Depositado neto por el BCR'), h('div.v', money(t.banco_neto))),
            h('div.con-cifra', h('div.t', 'Tarjeta según el facturador (bruto)'), h('div.v', money(t.fact_tarjeta_mismos_dias)), h('div.n', 'mismos días que tienen dato del banco')),
            h('div.con-cifra', h('div.t', 'Diferencia (banco menos facturador)'), h('div.v' + (Math.abs(t.diferencia) < 1 ? '' : '.bc-neg'), money(t.diferencia)), h('div.n', 'ambos en bruto'))),
          h('ul.bc-sup', h('li', 'La comparación es en bruto: lo que el cliente pagó con tarjeta según cada fuente, antes de comisión y retenciones.'), h('li', 'Los días sin dato del banco (' + t.dias_sin_banco + ') no entran en la diferencia.'), h('li', 'Efectivo ' + money(t.fact_efectivo) + ', SINPE ' + money(t.fact_sinpe) + ' y transferencia ' + money(t.fact_transferencia) + ' no pasan por el datáfono.'))),
        h('div.con-bloque', h('h2', 'Día por día'), dias.length ? h('div', gr, h('div.bc-leyenda', h('span', h('i.verde'), 'BCR depositó (neto)'), h('span', h('i.tinta'), 'Facturador cobró con tarjeta (bruto)')), lect) : h('div.con-vacio', 'No hay días en este período.'),
          dias.length ? h('div.tabla-caja', { style: 'margin-top:.8rem' }, h('table.con-tabla', h('thead', h('tr', h('th', 'Día'), h('th.der', 'BCR bruto'), h('th.der', 'Comisión'), h('th.der', 'Retenciones'), h('th.der', 'BCR neto'), h('th.der', 'Facturador tarjeta'), h('th.der', 'SINPE y transf.'), h('th.der', 'Diferencia'), h('th', 'Nota'))), h('tbody', filas))) : null));
    }
    await cargar();
    return () => limpiezas.splice(0).forEach((f) => f());
  },
};
