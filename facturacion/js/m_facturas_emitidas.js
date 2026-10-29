// Facturas emitidas (dentro de Administración): la misma lista de Documentos, para buscar facturas y tiquetes de cualquier fecha y ver en qué estado quedaron con Hacienda.
// Reutiliza toda la pantalla de «Anular y reimprimir» (fechas, buscador, estados, filtros, paginación y, más adelante, descargas), con una frase de introducción propia.
import { h } from './util.js';
import documentos from './m_documentos.js';

export default {
  ...documentos,
  id: 'emitidas',
  titulo: 'Facturas emitidas',
  async mount(root, app) {
    const promesa = documentos.mount(root, app);
    // La frase va arriba desde el primer momento: no espera a que lleguen los documentos (si la base tarda, la pantalla no queda sin su introducción)
    const intro = h('p.doc-ayuda',
      'Facturas y tiquetes emitidos. Busque por número, cliente, cédula, estado o monto, y vea si Hacienda lo aceptó o lo rechazó. Los que tienen una devolución o una nota de débito salen marcados. Para anular o volver a imprimir, toque el documento.');
    const poner = () => { const mod = root.querySelector('.doc-mod'); if (!mod) return false; if (!intro.isConnected) mod.prepend(intro); return true; };
    if (!poner()) {
      const obs = new MutationObserver(() => { if (poner()) obs.disconnect(); });
      obs.observe(root, { childList: true, subtree: true });
      promesa.then(() => obs.disconnect(), () => obs.disconnect());
    }
    const fin = await promesa;
    poner();
    return fin;
  },
};
