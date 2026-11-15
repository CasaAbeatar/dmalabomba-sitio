// Contabilidad, Compras: el asiento de una factura de proveedor explicado línea por línea, con los totales y la marca «Cuadra» (debe = haber).
// Las cifras vienen de fx_contable_compra_asiento (el asiento ya contabilizado, o la propuesta si todavía no se confirma); aquí no se calcula contabilidad.
import { h, money } from './util.js';
import { cargarHoja } from './ui_hojas.js';

const PENDIENTES = { inventario_metodo: 'el método de costeo del inventario', activos_fijos_politica: 'la política de activos fijos', niif_politicas: 'las políticas de la NIIF para las PYMES' };

export async function pintarAsiento(a) {
  await cargarHoja('contable_asiento.css');
  if (!a || !(a.lineas || []).length) return h('p.con-nota', 'Todavía no hay líneas para armar el asiento.');
  const hecho = a.fuente === 'contabilizado';
  const pend = (a.pendientes_contadora || []).map((k) => PENDIENTES[k]).filter(Boolean);
  return h('div.asx',
    h('div.asx-cab', h('h3', hecho ? 'Asiento ' + a.numero + ' de esta factura' : 'Así quedaría el asiento de esta factura'),
      a.provisional ? h('span.chip.prov', { title: 'Queda sujeto a lo que decida la contadora' }, 'Provisional') : null),
    h('table.asx-tabla', h('thead', h('tr', h('th', 'Cuenta y por qué'), h('th.der', 'Debe'), h('th.der', 'Haber'))),
      h('tbody', a.lineas.map((l) => h('tr',
        h('td', h('span.asx-cod', l.codigo + ' '), h('strong', l.nombre), h('span.asx-exp', l.explicacion), l.detalle ? h('span.asx-det', l.detalle) : null),
        h('td.der', Number(l.debe) ? money(l.debe) : ''), h('td.der', Number(l.haber) ? money(l.haber) : '')))),
      h('tfoot', h('tr', h('td', 'Totales'), h('td.der', money(a.total_debe)), h('td.der', money(a.total_haber))))),
    h('p.asx-cuadra.' + (a.cuadra ? 'ok' : 'mal'), a.cuadra ? 'Cuadra: lo que se debita es igual a lo que se acredita.' : 'No cuadra: diferencia de ' + money(a.diferencia) + '.'),
    pend.length ? h('p.asx-nota', 'Provisional porque la contadora todavía no decidió ' + pend.join(', ') + '.') : null,
    !hecho && a.provisional && !pend.length ? h('p.asx-nota', 'Provisional mientras alguna línea siga sin cuenta definitiva.') : null,
    a.provisional_motivo ? h('p.asx-nota', 'Motivo: ' + a.provisional_motivo + '.') : null);
}
