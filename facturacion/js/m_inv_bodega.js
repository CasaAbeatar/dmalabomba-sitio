// Bodega dentro de Inventarios (7 nov 2026): el módulo Bodega (m_bodega.js) ya no es un ícono aparte; se abre desde Inventarios, como las demás secciones.
// Solo envuelve a m_bodega.js en una ventana de Inventarios (con «‹ Inventarios» para volver); no cambia nada de lo que hace.
import { h } from './util.js';
import { ventana } from './m_inv_comun.js';
import modulo from './m_bodega.js';

export async function abrir(ctx) {
  const caja = h('div');
  let cerrar = null, cerrada = false;
  ventana({ titulo: 'Bodega', contenido: [caja], alCerrar: () => { cerrada = true; try { cerrar?.(); } catch { /* nada */ } } });
  const r = await modulo.mount(caja, ctx.app);
  if (typeof r === 'function') { cerrar = r; if (cerrada) r(); }
}
