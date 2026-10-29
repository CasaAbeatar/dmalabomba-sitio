// Clientes activos y desactivados. La búsqueda al facturar (api.clientes) solo trae los activos;
// la pantalla Clientes y la revisión de duplicados usan clientesTodos, que incluye los desactivados.
import { sb, ErrorApi } from './api.js';

async function rpc(nombre, args) {
  const { data, error } = await sb.rpc(nombre, args);
  if (error) {
    let m = error.message || 'Error desconocido';
    if (/JWT|expired|not authenticated/i.test(m)) m = 'Su sesión venció. Recargue la página e ingrese de nuevo.';
    throw new ErrorApi(m);
  }
  return data;
}

// Todos los clientes del local (activos y desactivados). Cada fila trae "activo" (true o false).
export const clientesTodos = (soc, q = '') => rpc('fx_clientes_todos', { p_soc: soc, p_q: q }).then((r) => r || []);
// Activa o desactiva un cliente. Un cliente desactivado no aparece al buscar cliente para facturar.
export const clienteActivar = (id, activo) => rpc('fx_cliente_activar', { p_id: id, p_activo: !!activo });
