// Datos propios del módulo "Documentos del día" (no se edita api.js).
// Funciones SQL usadas (ver /home/claude/facturador/sql/05_documentos.sql):
//   fx_documentos(p_soc, p_desde, p_hasta)  -> comprobantes del rango en orden cronológico, con el vínculo factura <-> nota de crédito
//   fx_comprobante_nc(p_id)                 -> nota de crédito vigente (no rechazada) de un comprobante, o null
import { sb, api, ErrorApi, funcion } from './api.js';

async function rpc(nombre, args) {
  const { data, error } = await sb.rpc(nombre, args);
  if (error) {
    let m = error.message || 'Error desconocido';
    if (/JWT|expired|not authenticated/i.test(m)) m = 'Su sesión venció. Recargue la página e ingrese de nuevo.';
    throw new ErrorApi(m);
  }
  return data;
}

// Lista del rango. Cada fila trae además nc_id, nc_consecutivo, nc_estado (si fue anulada) y ref_consecutivo, ref_tipo (si es una nota de crédito).
export async function documentos(soc, desde, hasta) {
  try {
    return (await rpc('fx_documentos', { p_soc: soc, p_desde: desde, p_hasta: hasta })) || [];
  } catch (e) {
    // Si la función nueva no existiera todavía, se usa la lista básica y se calcula el vínculo con lo que haya en el rango.
    if (!/fx_documentos|does not exist|schema cache/i.test(e.message)) throw e;
    const filas = ((await api.comprobantes(soc, desde, hasta, '')) || []).slice().reverse();
    const porId = new Map(filas.map((f) => [f.id, f]));
    for (const f of filas) {
      if (f.tipo_doc === '03' && f.estado !== 'rechazado' && f.comprobante_ref && porId.has(f.comprobante_ref)) {
        const o = porId.get(f.comprobante_ref);
        o.nc_id = f.id; o.nc_consecutivo = f.consecutivo; o.nc_estado = f.estado;
      }
      if (f.comprobante_ref && porId.has(f.comprobante_ref)) { f.ref_consecutivo = porId.get(f.comprobante_ref).consecutivo; f.ref_tipo = porId.get(f.comprobante_ref).tipo_doc; }
    }
    return filas;
  }
}

// Nota de crédito vigente de un comprobante, o null
export const ncDe = (id) => rpc('fx_comprobante_nc', { p_id: id });

// Correo al cliente: todavía no existe la función en el servidor. Cuando se active el envío de correos,
// poner CORREO_ACTIVO en true y ajustar el nombre de la función de borde si hace falta.
export const CORREO_ACTIVO = false;
export const reenviarCorreo = (id) => funcion('facturador-correo', { id });
