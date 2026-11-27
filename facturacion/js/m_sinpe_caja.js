// «Caja para mí» (SINPE, administración): una pestaña solo para el administrador, nunca visible para las cajeras.
// Abre con lo de HOY (el teléfono, las órdenes y los SINPE de hoy) y luego vienen los totales: SINPE sin factura, conciliación, informes y kit ↔ app.
// Decisión de Emil (27 nov 2026): ningún botón de esto va en el facturador de las cajeras; nada de aquí frena el cobro ni el cierre (Libro: pagos.sinpe_movil.alcance_simple).
// Lo que se escogió (pestaña, períodos, filtros) se recuerda mientras la página siga abierta, para volver al mismo lugar.
import { h, nombreLocal } from './util.js';
import { cargarCssCaja } from './sinpe_caja_ui.js';
import { seccionHoy } from './sinpe_caja_hoy.js';
import { seccionSinFactura, seccionConciliacion } from './sinpe_caja_listas.js';
import { seccionInformes } from './sinpe_caja_informes.js';
import { seccionKit } from './sinpe_caja_kit.js';

const PESTANAS = [
  ['hoy', 'Hoy', seccionHoy],
  ['sin_factura', 'SINPE sin factura', seccionSinFactura],
  ['conciliacion', 'Conciliación', seccionConciliacion],
  ['informes', 'Informes', seccionInformes],
  ['kit', 'Kit y app', seccionKit],
];

// Memoria de la pantalla (vive mientras la página esté abierta). Si cambia la empresa, se empieza de cero.
let memoria = null;
const nuevaMemoria = (soc) => ({ soc, pestana: 'hoy', sinFactura: { q: '' }, conciliacion: {}, informes: { vista: 'mes', est: {}, serie: {} } });

export default {
  id: 'sinpe_caja',
  titulo: 'Caja para mí',
  async mount(root, app) {
    await cargarCssCaja();
    if (!app.admin) {
      root.append(h('div.vacio', h('p', 'Esta pantalla es solo para administradores.'), h('button.btn', { type: 'button', onclick: () => app.ir('inicio') }, 'Volver al inicio')));
      return;
    }
    if (!memoria || memoria.soc !== app.soc.id) memoria = nuevaMemoria(app.soc.id);
    const ctx = { app, soc: app.soc.id, mem: memoria, nombreEmpresa: nombreLocal(app.soc) || 'la empresa', empresaCodigo: String(app.empresa?.codigo || app.soc?.codigo || '').toLowerCase() };
    const panel = h('div.sc-panel', { role: 'tabpanel' });
    let actual = null;
    const botones = PESTANAS.map(([id, texto]) => h('button.sc-tab', { type: 'button', role: 'tab', id: 'sc-tab-' + id, 'aria-selected': String(memoria.pestana === id), onclick: () => ir(id) }, texto));
    function ir(id) {
      memoria.pestana = id;
      botones.forEach((b, i) => b.setAttribute('aria-selected', String(PESTANAS[i][0] === id)));
      actual?.destruir?.();
      const [, , fabrica] = PESTANAS.find((p) => p[0] === id) || PESTANAS[0];
      panel.setAttribute('aria-labelledby', 'sc-tab-' + id);
      actual = fabrica(ctx);
      panel.replaceChildren(actual.el);
    }
    root.append(h('div.sc',
      h('div.sc-cab', h('h2', 'Caja para mí'), h('p', `Solo para el administrador. Aquí se ve el teléfono que recibe los SINPE, lo que el banco avisó y no tiene factura, y los informes. Nada de esto frena el cobro ni el cierre de las cajas. ${ctx.nombreEmpresa}.`)),
      h('div.sc-tabs', { role: 'tablist', 'aria-label': 'Secciones' }, botones),
      panel));
    ir(memoria.pestana);
    return () => { actual?.destruir?.(); };
  },
};
