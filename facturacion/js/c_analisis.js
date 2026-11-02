// Contabilidad, pestaña «Análisis» (fase 6): analítica de ventas, compras y margen. Primero el día de hoy frente a los mismos días de la semana, después la serie diaria
// (cronológica, de izquierda a derecha, con ejes rotulados) y por último los agregados por día de la semana, semana y mes. Cifras con media, desviación estándar muestral y coeficiente de variación.
import { h, money, hoyCR, esqueleto, bloqueError, textoDeError } from './util.js';
import { selectorPeriodo, textoRango, fechaDMA } from './periodo.js';
import { cargarHoja } from './ui_hojas.js';
import { graficoColumnas, autoAjustar } from './graficos.js';
import { llenar } from './c_comun.js';
import { analitica } from './api_contable.js';

export const DIAS = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const pct = (x) => (x == null ? 'sin dato' : new Intl.NumberFormat('es-CR', { maximumFractionDigits: 1 }).format(x * 100) + ' %');
const ddmm = (ymd) => ymd.slice(8, 10) + '/' + ymd.slice(5, 7);
const mesLargo = (ymd) => new Intl.DateTimeFormat('es-CR', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(ymd + 'T12:00:00Z'));
// Lectura en palabras de a cuántas desviaciones estándar está un valor del promedio
export function lecturaDesviaciones(z) {
  if (z == null) return 'Todavía no hay suficientes días comparables para medir si es normal.';
  const a = Math.abs(z);
  if (a < 1) return 'Dentro de lo normal para este día de la semana (a menos de una desviación estándar del promedio).';
  const d = new Intl.NumberFormat('es-CR', { maximumFractionDigits: 1 }).format(a);
  return (z > 0 ? 'Por encima' : 'Por debajo') + ' de lo habitual: a ' + d + ' desviaciones estándar del promedio de este día de la semana' + (a >= 2 ? ' (poco frecuente).' : '.');
}

export default {
  id: 'analisis', texto: 'Análisis',
  async montar(cont, ctx) {
    const { soc, memoria } = ctx;
    await cargarHoja('listados.css');
    const bHoy = h('div.con-bloque'), bCuerpo = h('div.con-raiz');
    let rango, ficha = 0; const limpiezas = [];
    const periodo = selectorPeriodo({ inicial: memoria.analisisPeriodo || 'mes', alCambiar: ([d, a], id) => { memoria.analisisPeriodo = id; rango = [d, a]; cargar(); } });
    rango = periodo.rango();
    cont.append(h('div.con-raiz', bHoy, h('div.con-bloque', h('h2', 'Período del análisis'), periodo.el), bCuerpo));

    async function cargar() {
      const mi = ++ficha; limpiezas.splice(0).forEach((f) => f());
      llenar(bHoy, h('h2', 'Hoy, ' + fechaDMA(hoyCR())), esqueleto(1, 'Calculando…')); llenar(bCuerpo, esqueleto(3, 'Calculando el análisis…'));
      let a; try { a = await analitica(soc.id, rango[0], rango[1]); } catch (er) { if (mi === ficha) { llenar(bHoy, h('h2', 'Hoy'), bloqueError({ titulo: 'No se pudo calcular el análisis', mensaje: textoDeError(er), alReintentar: cargar })); llenar(bCuerpo); } return; }
      if (mi !== ficha) return;
      const hv = a.hoy_vs_semanas, g = a.global, dias = a.dias;
      llenar(bHoy, h('h2', 'Hoy, ' + DIAS[hv.dow] + ' ' + fechaDMA(hv.dia)),
        a.ambiente !== 'produccion' ? h('p.con-nota', 'Datos de PRUEBAS (' + a.ambiente + '): no son ventas reales.') : null,
        h('div.con-cifras',
          h('div.con-cifra', h('div.t', 'Ventas netas de hoy'), h('div.v', money(hv.neto)), h('div.n', hv.docs + ' documentos · sin IVA, netas de notas de crédito')),
          h('div.con-cifra', h('div.t', 'Promedio de los ' + DIAS[hv.dow] + ' anteriores'), h('div.v', hv.media_mismo_dia == null ? 'sin dato' : money(hv.media_mismo_dia)), h('div.n', hv.n + ' días comparados (8 semanas)')),
          h('div.con-cifra', h('div.t', 'Desviación estándar'), h('div.v', hv.sd_mismo_dia == null ? 'sin dato' : money(hv.sd_mismo_dia)), h('div.n', 'coeficiente de variación ' + pct(hv.cv_mismo_dia))),
          h('div.con-cifra', h('div.t', 'Hoy frente al promedio'), h('div.v', hv.desviaciones == null ? 'sin dato' : (hv.desviaciones > 0 ? '+' : '') + new Intl.NumberFormat('es-CR', { maximumFractionDigits: 2 }).format(hv.desviaciones) + ' DE'))),
        h('p.con-ayuda', { style: 'margin-top:.6rem' }, lecturaDesviaciones(hv.desviaciones)));

      // Serie diaria
      const lect = h('p.lectura', { 'aria-live': 'polite' }, 'Toque una barra para ver el detalle del día.');
      const gr = h('div.gr-caja'); let sel = -1;
      const datos = dias.map((d) => ({ id: d.dia, etiqueta: ddmm(d.dia), valor: d.neto, texto: DIAS[d.dow] + ' ' + fechaDMA(d.dia) + ': ventas netas ' + money(d.neto) + ' (' + d.docs + ' documentos), brutas ' + money(d.bruto) + ', compras ' + money(d.compras) + ', gasto y costo ' + money(d.gasto_costo) }));
      if (datos.length) limpiezas.push(autoAjustar(gr, (w) => llenar(gr, graficoColumnas(datos, { ancho: w, alto: 280, tituloX: 'Día (de izquierda a derecha, del más antiguo al más reciente)', tituloY: 'Ventas netas del día (₡, sin IVA)', seleccionado: sel, alSeleccionar: (d, i) => { sel = i; lect.textContent = d.texto; }, descripcion: 'Ventas netas por día' }))));
      const tbDias = h('tbody', dias.map((d) => h('tr', h('td', DIAS[d.dow].slice(0, 3) + ' ' + ddmm(d.dia)), h('td.der', String(d.docs)), h('td.der', money(d.neto)), h('td.der', money(d.bruto)), h('td.der', d.ticket == null ? '' : money(d.ticket)),
        h('td.der', money(d.efectivo)), h('td.der', money(d.tarjeta)), h('td.der', money(d.sinpe + d.transferencia)), h('td.der', money(d.compras)), h('td.der', money(d.gasto_costo)), h('td.der', money(d.margen)))));
      const cvTxt = g.cv == null ? 'sin dato' : pct(g.cv);
      llenar(bCuerpo,
        h('div.con-bloque', h('h2', 'Día por día'), h('p.con-ayuda', textoRango(rango[0], rango[1]) + '. ' + a.rotulos.neto + '.'),
          h('div.con-cifras', { style: 'margin-bottom:.8rem' },
            h('div.con-cifra', h('div.t', 'Ventas netas del período'), h('div.v', money(g.total)), h('div.n', g.n + ' días' + (a.dias_cero_cuentan ? ' (los días sin ventas cuentan)' : ''))),
            h('div.con-cifra', h('div.t', 'Promedio por día'), h('div.v', money(g.media)), h('div.n', 'mediana ' + money(g.mediana))),
            h('div.con-cifra', h('div.t', 'Desviación estándar'), h('div.v', g.sd == null ? 'sin dato' : money(g.sd)), h('div.n', 'muestral, de las ventas netas diarias')),
            h('div.con-cifra', h('div.t', 'Coeficiente de variación'), h('div.v', cvTxt), h('div.n', 'desviación estándar entre promedio'))),
          datos.length ? h('div', gr, lect) : h('div.con-vacio', 'No hay días en este período.'),
          dias.length ? h('div.tabla-caja', { style: 'margin-top:.8rem' }, h('table.con-tabla', h('thead', h('tr', h('th', 'Día'), h('th.der', 'Docs'), h('th.der', 'Ventas netas'), h('th.der', 'Ventas brutas'), h('th.der', 'Ticket promedio (bruto)'), h('th.der', 'Efectivo'), h('th.der', 'Tarjeta'), h('th.der', 'SINPE y transf.'), h('th.der', 'Compras (neto)'), h('th.der', 'Gasto y costo'), h('th.der', 'Margen'))), tbDias)) : null,
          h('p.con-nota', 'Brutas = con IVA. Netas = sin IVA. Los cobros por medio de pago son brutos. ' + a.rotulos.compras + '. ' + a.rotulos.gasto_costo + '. Margen = ventas netas menos gasto y costo contabilizados ese día (si falta contabilizar, el margen se ve más alto de lo real).')),
        h('div.con-bloque', h('h2', 'Por día de la semana'), h('p.con-ayuda', 'Cuánto varía cada día de la semana en el período. Un coeficiente de variación alto quiere decir que ese día es poco predecible.'),
          h('div.tabla-caja', h('table.con-tabla', h('thead', h('tr', h('th', 'Día'), h('th.der', 'Días'), h('th.der', 'Promedio'), h('th.der', 'Desv. estándar'), h('th.der', 'Coef. de variación'), h('th.der', 'Mínimo'), h('th.der', 'Máximo'))),
            h('tbody', a.por_dia_semana.map((x) => h('tr', h('td', DIAS[x.dow]), h('td.der', String(x.n)), h('td.der', money(x.media)), h('td.der', x.sd == null ? 'sin dato' : money(x.sd)), h('td.der', pct(x.cv)), h('td.der', money(x.min)), h('td.der', money(x.max)))))))),
        h('div.con-bloque', h('h2', 'Semana por semana'), h('p.con-ayuda', 'Semanas de lunes a domingo, de la más antigua a la más reciente. La primera y la última pueden estar incompletas.'),
          h('div.tabla-caja', h('table.con-tabla', h('thead', h('tr', h('th', 'Semana desde el lunes'), h('th.der', 'Días'), h('th.der', 'Docs'), h('th.der', 'Ventas netas'), h('th.der', 'Ventas brutas'), h('th.der', 'Compras (neto)'), h('th.der', 'Gasto y costo'))),
            h('tbody', a.semanas.map((x) => h('tr', h('td', fechaDMA(x.inicio)), h('td.der', String(x.dias)), h('td.der', String(x.docs)), h('td.der', money(x.neto)), h('td.der', money(x.bruto)), h('td.der', money(x.compras)), h('td.der', money(x.gasto_costo)))))))),
        h('div.con-bloque', h('h2', 'Mes por mes'), h('p.con-ayuda', 'De enero hacia adelante: el mes más reciente queda de último.'),
          h('div.tabla-caja', h('table.con-tabla', h('thead', h('tr', h('th', 'Mes'), h('th.der', 'Días'), h('th.der', 'Docs'), h('th.der', 'Ventas netas'), h('th.der', 'Ventas brutas'), h('th.der', 'Compras (neto)'), h('th.der', 'Gasto y costo'))),
            h('tbody', a.meses.map((x) => h('tr', h('td', mesLargo(x.inicio)), h('td.der', String(x.dias)), h('td.der', String(x.docs)), h('td.der', money(x.neto)), h('td.der', money(x.bruto)), h('td.der', money(x.compras)), h('td.der', money(x.gasto_costo)))))))));
    }
    await cargar();
    return () => limpiezas.splice(0).forEach((f) => f());
  },
};
