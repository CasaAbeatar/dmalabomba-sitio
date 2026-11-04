// Contabilidad, pestaña «Estados» (fase 6): estados financieros con la estructura de la NIIF para las PYMES, armados del libro: situación financiera, resultados,
// cambios en el patrimonio, flujo de efectivo (método directo) y notas. Abre con la posición de hoy y sigue con el período escogido. La contadora fija el marco y las políticas.
import { h, money, hoyCR, esqueleto, bloqueError, textoDeError } from './util.js';
import { selectorPeriodo, textoRango, fechaDMA } from './periodo.js';
import { llenar } from './c_comun.js';
import { estados } from './api_contable.js';

const fila = (t, a, b, o = {}) => h('tr' + (o.fuerte ? '.con-grupo' : ''), h('td', o.sangria ? h('span', { style: 'padding-left:' + o.sangria + 'px' }, t) : t), h('td.der', a == null ? '' : money(a)), b === undefined ? null : h('td.der', b == null ? '' : money(b)));
const tabla = (cabs, filas) => h('div.tabla-caja', h('table.con-tabla', h('thead', h('tr', cabs.map((c, i) => h('th' + (i ? '.der' : ''), c)))), h('tbody', filas)));

export default {
  id: 'estados', texto: 'Estados',
  async montar(cont, ctx) {
    const { soc, memoria } = ctx;
    const bHoy = h('div.con-bloque'), bCuerpo = h('div.con-raiz');
    const periodo = selectorPeriodo({ inicial: memoria.estadosPeriodo || 'mes', alCambiar: ([d, a], id) => { memoria.estadosPeriodo = id; rango = [d, a]; cargar(); } });
    let rango = periodo.rango(), ficha = 0;
    cont.append(h('div.con-raiz', bHoy, h('div.con-bloque', h('h2', 'Período de los estados'), h('p.con-ayuda', 'Escoja el período. La situación financiera se muestra a su último día y se compara con el día anterior a su inicio.'), periodo.el), bCuerpo));

    async function cargarHoy() {
      const hoy = hoyCR(); let e;
      llenar(bHoy, h('h2', 'Hoy, ' + fechaDMA(hoy)), esqueleto(1, 'Calculando la posición de hoy…'));
      try { e = await estados(soc.id, hoy, hoy); } catch (er) { llenar(bHoy, h('h2', 'Hoy'), bloqueError({ titulo: 'No se pudo calcular', mensaje: textoDeError(er), alReintentar: cargarHoy })); return; }
      const efe = (e.situacion.al_final.activos.find((x) => x.rubro === 'efectivo') || {}).monto || 0;
      llenar(bHoy, h('h2', 'Hoy, ' + fechaDMA(hoy)), e.ambiente !== 'produccion' ? h('p.con-nota', 'Libros de PRUEBAS (' + e.ambiente + '): no son cifras reales.') : null,
        h('div.con-cifras',
          h('div.con-cifra', h('div.t', 'Efectivo y bancos al cierre de hoy'), h('div.v', money(efe)), h('div.n', 'saldo del libro')),
          h('div.con-cifra', h('div.t', 'Ingresos netos de hoy'), h('div.v', money(e.resultados.periodo.ingresos_netos)), h('div.n', 'sin IVA, netos de notas de crédito')),
          h('div.con-cifra', h('div.t', 'Activos totales'), h('div.v', money(e.situacion.al_final.total_activos))),
          h('div.con-cifra', h('div.t', 'Resultado de hoy'), h('div.v', money(e.resultados.periodo.utilidad_neta)), h('div.n', 'ingresos menos costos y gastos contabilizados'))));
    }

    async function cargar() {
      const mi = ++ficha; llenar(bCuerpo, esqueleto(3, 'Armando los estados financieros…'));
      let e; try { e = await estados(soc.id, rango[0], rango[1]); } catch (er) { if (mi === ficha) llenar(bCuerpo, bloqueError({ titulo: 'No se pudieron armar los estados', mensaje: textoDeError(er), alReintentar: cargar })); return; }
      if (mi !== ficha) return;
      const sf = e.situacion, fin = sf.al_final, ini = sf.al_inicio, er = e.resultados.periodo, ant = e.resultados.anterior, pt = e.patrimonio, fl = e.flujo;
      const grupo = (lista, listaIni) => lista.map((x) => fila(x.nombre, x.monto, (listaIni.find((y) => y.rubro === x.rubro) || {}).monto ?? 0, { sangria: 12 }));
      // rubros que tenían saldo al inicio y ya no al final
      const soloIni = (listaIni, listaFin) => listaIni.filter((y) => !listaFin.some((x) => x.rubro === y.rubro)).map((y) => fila(y.nombre, 0, y.monto, { sangria: 12 }));
      const cab = ['Concepto', 'Al ' + fechaDMA(fin.fecha), 'Al ' + fechaDMA(ini.fecha)];
      llenar(bCuerpo,
        e.ambiente !== 'produccion' ? h('p.con-nota', 'Libros de PRUEBAS (' + e.ambiente + '): no son cifras reales.') : null,
        h('div.con-bloque', h('h2', 'Estado de situación financiera'), h('p.con-ayuda', 'Al ' + fechaDMA(fin.fecha) + ' frente al ' + fechaDMA(ini.fecha) + '. Cifras en colones.'),
          tabla(cab, [
            fila('Activos', fin.total_activos, ini.total_activos, { fuerte: true }), grupo(fin.activos, ini.activos), soloIni(ini.activos, fin.activos),
            fila('Pasivos', fin.total_pasivos, ini.total_pasivos, { fuerte: true }), grupo(fin.pasivos, ini.pasivos), soloIni(ini.pasivos, fin.pasivos),
            fila('Patrimonio', fin.total_patrimonio, ini.total_patrimonio, { fuerte: true }), grupo(fin.patrimonio, ini.patrimonio), soloIni(ini.patrimonio, fin.patrimonio),
            fila('Pasivos más patrimonio', fin.total_pasivos + fin.total_patrimonio, ini.total_pasivos + ini.total_patrimonio, { fuerte: true })]),
          h('p.con-nota', sf.cuadra ? 'El balance cuadra: activos igual a pasivos más patrimonio.' : 'El balance NO cuadra (diferencia ' + money(sf.diferencia) + '). Hay que revisar los asientos.')),
        h('div.con-bloque', h('h2', 'Estado de resultados'), h('p.con-ayuda', textoRango(rango[0], rango[1]) + ', comparado con el período anterior de igual duración. Ingresos sin IVA y netos de notas de crédito; todo en colones.'),
          tabla(['Concepto', 'Este período', 'Período anterior'], [
            fila('Ventas', er.ventas, ant.ventas), fila('(−) Notas de crédito y devoluciones', -er.devoluciones, -ant.devoluciones), fila('Ingresos netos', er.ingresos_netos, ant.ingresos_netos, { fuerte: true }),
            fila('(−) Costo de ventas', -er.costo_ventas, -ant.costo_ventas), fila('Utilidad bruta', er.utilidad_bruta, ant.utilidad_bruta, { fuerte: true }),
            fila('(−) Gastos de personal', -er.gastos_personal, -ant.gastos_personal), fila('(−) Gastos de operación', -er.gastos_operacion, -ant.gastos_operacion), fila('Utilidad de operación', er.utilidad_operacion, ant.utilidad_operacion, { fuerte: true }),
            fila('(+) Otros ingresos', er.otros_ingresos, ant.otros_ingresos), fila('(−) Gastos financieros', -er.gastos_financieros, -ant.gastos_financieros), fila('Utilidad antes de impuesto', er.utilidad_antes_impuesto, ant.utilidad_antes_impuesto, { fuerte: true }),
            fila('(−) Impuesto sobre la renta', -er.impuesto_renta, -ant.impuesto_renta), fila('Utilidad (pérdida) neta', er.utilidad_neta, ant.utilidad_neta, { fuerte: true })]),
          er.sin_rubro ? h('p.con-nota.con-mas', 'Hay ' + money(er.sin_rubro) + ' en cuentas de resultados sin rubro asignado; se incluyeron en la utilidad antes de impuesto.') : null),
        h('div.con-bloque', h('h2', 'Estado de cambios en el patrimonio'), h('p.con-ayuda', 'Cómo pasó el patrimonio del saldo inicial al final.'),
          tabla(['Concepto', 'Capital', 'Reservas', 'Resultados'], [
            h('tr', h('td', 'Saldo al ' + fechaDMA(ini.fecha)), h('td.der', money(pt.capital.inicial)), h('td.der', money(pt.reservas.inicial)), h('td.der', money(pt.resultados.inicial))),
            h('tr', h('td', 'Utilidad (pérdida) del período'), h('td.der', ''), h('td.der', ''), h('td.der', money(pt.utilidad_periodo))),
            h('tr', h('td', 'Aportes, retiros y otros movimientos'), h('td.der', money(pt.capital.final - pt.capital.inicial)), h('td.der', money(pt.reservas.final - pt.reservas.inicial)), h('td.der', money(pt.resultados.final - pt.resultados.inicial - pt.utilidad_periodo))),
            h('tr.con-grupo', h('td', 'Saldo al ' + fechaDMA(fin.fecha)), h('td.der', money(pt.capital.final)), h('td.der', money(pt.reservas.final)), h('td.der', money(pt.resultados.final)))])),
        h('div.con-bloque', h('h2', 'Estado de flujos de efectivo (método directo)'), h('p.con-ayuda', 'Efectivo y bancos según el libro. Cada movimiento se clasifica por la cuenta contraria.'),
          tabla(['Concepto', 'Monto'], [
            fila('Actividades de operación', fl.operacion.total, undefined, { fuerte: true }), fila('Cobros por ventas y otros ingresos', fl.operacion.cobros, undefined, { sangria: 12 }), fila('Pagos a proveedores e inventarios', fl.operacion.proveedores, undefined, { sangria: 12 }),
            fila('Pagos de personal', fl.operacion.personal, undefined, { sangria: 12 }), fila('Pagos de gastos de operación', fl.operacion.gastos, undefined, { sangria: 12 }), fila('IVA e impuestos (neto)', fl.operacion.impuestos, undefined, { sangria: 12 }),
            fila('Intereses y comisiones', fl.operacion.financieros, undefined, { sangria: 12 }), fila('Otros', fl.operacion.otros, undefined, { sangria: 12 }),
            fila('Actividades de inversión', fl.inversion, undefined, { fuerte: true }), fila('Actividades de financiación', fl.financiacion, undefined, { fuerte: true }),
            fila('Aumento (disminución) neto del efectivo', fl.variacion, undefined, { fuerte: true }), fila('Efectivo al inicio', fl.efectivo_inicial, undefined), fila('Efectivo al final', fl.efectivo_final, undefined, { fuerte: true })]),
          h('p.con-nota', fl.cuadra ? 'El flujo cuadra con el saldo de efectivo del balance.' : 'El flujo NO cuadra con el balance (diferencia ' + money(fl.diferencia) + ').')),
        h('div.con-bloque', h('h2', 'Notas'), h('ol', { style: 'padding-left:1.2rem;margin:0' },
          h('li', 'Base de preparación: ' + (e.marco ? String(e.marco) : 'pendiente: la contadora debe decidir si se usa la NIIF para las PYMES o las NIIF plenas (la resolución MH-DGT-RES-0015-2026 rige desde el 1 de enero de 2027).')),
          h('li', 'Moneda funcional y de presentación: colón costarricense.'),
          h('li', 'Ingresos: se reconocen con las facturas y tiquetes electrónicos aceptados por Hacienda, netos de notas de crédito y sin IVA.'),
          h('li', 'Políticas contables (inventarios, depreciación, provisiones): ' + (e.politicas ? String(e.politicas) : 'pendiente de la contadora.')),
          h('li', 'Impuesto sobre la renta: ' + (er.impuesto_renta ? 'registrado en el libro.' : 'todavía no hay gasto de renta registrado; los límites los fija la contadora.')),
          h('li', 'Información auxiliar: estos estados no son oficiales ni definitivos; los oficiales son los que presenta la contadora a Hacienda.'),
          h('li', 'Estos estados salen solo de lo contabilizado: los días y las facturas de proveedores sin contabilizar no aparecen.'))));
    }
    await Promise.all([cargarHoy(), cargar()]);
  },
};
