// Facturas emitidas (dentro de Administración): la misma lista de Documentos, para buscar facturas y tiquetes de cualquier fecha y ver en qué estado quedaron con Hacienda.
// Reutiliza toda la pantalla de «Anular y reimprimir» (fechas, buscador, estados, filtros, paginación y, más adelante, descargas), con una frase de introducción propia.
import { h } from './util.js';
import documentos from './m_documentos.js';

export default {
  ...documentos,
  id: 'emitidas',
  titulo: 'Facturas emitidas',
  async mount(root, app) {
    const fin = await documentos.mount(root, app);
    root.querySelector('.doc-mod')?.prepend(h('p.doc-ayuda',
      'Facturas y tiquetes emitidos. Busque por número, cliente, cédula, estado o monto, y vea si Hacienda lo aceptó o lo rechazó. Para anular o volver a imprimir, toque el documento.'));
    return fin;
  },
};
