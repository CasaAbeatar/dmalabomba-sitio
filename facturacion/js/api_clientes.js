// Clientes activos y desactivados. La búsqueda al facturar (api.clientes) solo trae los activos;
// la pantalla Clientes y la revisión de duplicados usan clientesTodos, que incluye los desactivados.
// El acceso a la base y los textos de error (sesión vencida, sin conexión) son los de api.js, para que se lean igual en toda la pantalla.
import { rpc } from './api.js';

// Todos los clientes del local (activos y desactivados). Cada fila trae "activo" (true o false).
export const clientesTodos = (soc, q = '') => rpc('fx_clientes_todos', { p_soc: soc, p_q: q }).then((r) => r || []);
// Activa o desactiva un cliente. Un cliente desactivado no aparece al buscar cliente para facturar.
export const clienteActivar = (id, activo) => rpc('fx_cliente_activar', { p_id: id, p_activo: !!activo });
