// SINPE · administración («Caja para mí», solo administrador). Cada función llama a public.fx_sinpe_adm_*, que en la base exige el rol de administrador
// (una cajera recibe «Solo un administrador puede usar esta función»). Todo es consulta salvo `orden` (pide latido o reenvío de historial al teléfono) y `bancoCargar`.
import { rpc } from './api.js';

export const sinpeAdmin = {
  caja: (soc) => rpc('fx_sinpe_adm_caja', { p_soc: soc }),
  orden: (soc, cmd, telefono = null, nota = null) => rpc('fx_sinpe_adm_orden', { p_soc: soc, p_cmd: cmd, p_telefono: telefono, p_nota: nota }),
  sinFactura: (soc, desde, hasta) => rpc('fx_sinpe_adm_sin_factura', { p_soc: soc, p_desde: desde, p_hasta: hasta }),
  conciliacion: (soc, desde, hasta) => rpc('fx_sinpe_adm_conciliacion', { p_soc: soc, p_desde: desde, p_hasta: hasta }),
  informeMes: (soc, mes) => rpc('fx_sinpe_adm_informe_mes', { p_soc: soc, p_mes: mes }),
  estadistica: (soc, desde, hasta) => rpc('fx_sinpe_adm_estadistica', { p_soc: soc, p_desde: desde, p_hasta: hasta }),
  serieHoras: (soc, desde, hasta) => rpc('fx_sinpe_adm_serie_horas', { p_soc: soc, p_desde: desde, p_hasta: hasta }),
  versiones: (soc) => rpc('fx_sinpe_adm_versiones', { p_soc: soc }),
  // Entrada lista para el archivo de movimientos del BCR (formato por definir; hoy ninguna pantalla la usa). filas: [{fecha, monto, referencia, descripcion}]
  bancoCargar: (soc, archivo, filas) => rpc('fx_sinpe_adm_banco_cargar', { p_soc: soc, p_archivo: archivo, p_filas: filas }),
};

// Manifiesto del kit (OTA), solo para mostrar qué versión está publicada para cada caja. Se lee del mismo sitio; si no está o no se puede leer, devuelve null (nunca falla).
export async function leerManifiestoKit(url = new URL('../../kit-caja/ota/manifiesto.json', import.meta.url).href) {
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch(url, { cache: 'no-store', signal: ctrl.signal }); clearTimeout(t);
    if (!r.ok) return null;
    const j = await r.json();
    return j && Array.isArray(j.lanzamientos) ? j : null;
  } catch { return null; }
}
