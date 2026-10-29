// Datos del módulo Listados (no se edita api.js). Función SQL: public.fx_listados2 (ver /home/claude/facturador/sql/05_listados2.sql).
import { sb, ErrorApi } from './api.js';

async function rpc(nombre, args) {
  const { data, error } = await sb.rpc(nombre, args);
  if (error) {
    let m = error.message || 'Error desconocido';
    if (/JWT|expired|not authenticated/i.test(m)) m = 'Su sesión venció. Recargue la página e ingrese de nuevo.';
    else if (/failed to fetch|networkerror|load failed|timeout|canceling statement/i.test(m)) m = 'El servidor tardó demasiado o no hay conexión. Espere un momento e intente de nuevo.';
    throw new ErrorApi(m);
  }
  return data;
}

// Devuelve {resumen, por_dia, por_hora, por_medio, por_servicio, por_cajero, por_turno, productos, por_tarifa}.
// turno (opcional): id de un turno para ver solo sus ventas.
export const listados2 = (soc, desde, hasta, turno = null) => rpc('fx_listados2', { p_soc: soc, p_desde: desde, p_hasta: hasta, p_turno: turno });
