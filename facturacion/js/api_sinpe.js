// SINPE Móvil: lista de consulta para la cajera (decisión de Emil, 17 nov 2026: solo consulta, nada se ata al cobro).
// Lecturas por funciones public.fx_sinpe_* (revisan la sesión del facturador). Nada se ve mientras la bandera fact.config «sinpe_tarjeta» (activa) esté apagada:
// la bandera se pregunta cada 5 minutos y, si la función no existe o no responde, queda apagada.
import { rpc } from './api.js';
import { sinpeActivo, fijarSinpe } from './bandera_sinpe.js';

export { sinpeActivo };
let banderaPromesa = null, banderaEn = 0;
const VIDA_BANDERA = 5 * 60 * 1000;
export function cargarBanderaSinpe(forzar = false) {
  if (!banderaPromesa || forzar || Date.now() - banderaEn > VIDA_BANDERA) {
    banderaEn = Date.now();
    banderaPromesa = rpc('fx_sinpe_flags', {})
      .then((r) => { fijarSinpe(!!r && r.activa === true); return sinpeActivo(); })
      .catch(() => { fijarSinpe(false); return false; });
  }
  return banderaPromesa;
}
export const olvidarBanderaSinpe = () => { banderaPromesa = null; banderaEn = 0; fijarSinpe(false); };

export const sinpe = {
  lista: (soc, dias = 3) => rpc('fx_sinpe_lista', { p_soc: soc, p_dias: dias }),
  // Revisa el comprobante escrito o escogido (solo informa: repetido, fecha, empresa). Nunca detiene el cobro.
  revisar: (soc, ref, venta = null) => rpc('fx_sinpe_ref_revisar', { p_soc: soc, p_ref: ref, p_venta: venta }),
  usar: (pago, usado = true, venta = null) => rpc('fx_sinpe_usar', { p_pago: pago, p_usado: usado, p_venta: venta }),
};
