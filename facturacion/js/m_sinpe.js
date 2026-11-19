// Pagos SINPE (Administración): la misma lista de consulta que ve la caja, a pantalla completa. Solo se mira; nada se ata al cobro ni al cierre.
// Decisión de Emil (17 nov 2026, Libro: pagos.sinpe_movil.alcance_simple). Cifras brutas, en colones.
import { h } from './util.js';
import { cargarCssSinpe, listaSinpe } from './ui_sinpe.js';

export default {
  id: 'sinpe',
  titulo: 'Pagos SINPE',
  async mount(root, app) {
    await cargarCssSinpe();
    if (!app.admin) {
      root.append(h('div.vacio', h('p', 'Esta pantalla es solo para administradores.'), h('button.btn', { type: 'button', onclick: () => app.ir('inicio') }, 'Volver al inicio')));
      return;
    }
    const lista = listaSinpe({ soc: app.soc.id, empresa: app.empresa?.codigo || 'soda', titulo: 'SINPE Móvil recibidos' });
    root.append(h('div.sinpe-admin',
      h('div.sinpe-admin-cab', h('h2', 'Pagos SINPE Móvil'), h('p', 'Los avisos del banco tal como llegan, del más reciente al más antiguo y con hoy primero. Es solo para consultar: el cobro no depende de esta lista.')),
      lista.el));
    return () => lista.destruir();
  },
};
