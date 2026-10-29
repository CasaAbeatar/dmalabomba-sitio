// Acceso a datos de la caja de efectivo dentro de Facturación (entradas y salidas de dinero que no son ventas).
// Todo pasa por funciones fx_* de Supabase con el mismo rpc() de api.js, que no se toca.
// Las consultas se repiten UNA vez sola si falla la red. Las escrituras nunca se repiten solas: quien las llama comprueba antes de repetir.
import { rpc, esTransitorio } from './api.js';

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
async function leer(nombre, args) {
  try { return await rpc(nombre, args); }
  catch (e) {
    if (!esTransitorio(e)) throw e;
    await pausa(700);
    return rpc(nombre, args);
  }
}

export const apiEfectivo = {
  // Todo lo que hace falta para el resumen del turno: esperado_efectivo, total_entradas, total_salidas, entradas[] y salidas[] vigentes, turno.abierto_en
  estado: (turno) => leer('fx_turno_estado', { p_turno: turno }),
  // Entradas y salidas mezcladas en orden de hora: [{ tipo:'entrada'|'salida', id, monto, motivo, creado_por, creado_por_nombre, creado_en, anulada, anulada_por, anulada_en, anulada_motivo }]
  movimientos: (turno, incluirAnuladas = true) => leer('fx_movimientos_efectivo', { p_turno: turno, p_incluir_anuladas: incluirAnuladas }),
  registrar: (tipo, turno, monto, motivo) => rpc(tipo === 'entrada' ? 'fx_entrada_registrar' : 'fx_salida_registrar', { p_turno: turno, p_monto: monto, p_motivo: motivo }),
  anular: (tipo, id, motivo) => rpc(tipo === 'entrada' ? 'fx_entrada_anular' : 'fx_salida_anular_motivo', { p_id: id, p_motivo: motivo }),
};
