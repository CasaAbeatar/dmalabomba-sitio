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

// Motivos de un toque. Son los mismos para Facturación y para Apertura y cierre de caja. Si el servidor manda su propia lista (fx_contexto:
// motivos_entrada_efectivo y motivos_salida_efectivo) se usa esa; si no, estas. «Otro» siempre queda al final.
export const MOTIVOS_ENTRADA = ['Sencillo / cambio', 'Aporte del dueño', 'Otro'];
export const MOTIVOS_SALIDA = ['Pago a proveedor', 'Compra de hielo', 'Compra de insumos', 'Sencillo / cambio', 'Retiro del dueño', 'Otro'];
export function motivosValidos(lista, porDefecto) {
  if (!Array.isArray(lista)) return porDefecto;
  const limpia = [...new Set(lista.map((x) => (typeof x === 'string' ? x.trim() : '')).filter((x) => x && x.length <= 40))].slice(0, 12);
  if (!limpia.length) return porDefecto;
  return [...limpia.filter((x) => x !== 'Otro'), 'Otro'];
}

// Texto de error para mostrar en pantalla: el mensaje solo se deja pasar si lo escribió el sistema en español. Un mensaje técnico
// (permission denied, invalid input, Failed to fetch...) se cambia por una frase que dice qué hacer.
export const MENSAJE_GENERAL = 'Algo no salió bien. Intente de nuevo; si sigue igual, avise a la persona encargada.';
const TECNICO = /permission denied|invalid input|duplicate key|could not|violates|syntax error|does not exist|undefined|null value|TypeError|Failed to fetch|NetworkError|Load failed|JWT|PGRST|schema cache|overflow|unexpected|\bHTTP\b|\berror\b:/i;
export function textoError(e, general = MENSAJE_GENERAL) {
  const m = String((e && e.message) || (typeof e === 'string' ? e : '') || '').trim();
  if (!m || m.length > 300 || TECNICO.test(m)) return general;
  return m;
}

export const apiEfectivo = {
  // Todo lo que hace falta para el resumen del turno: esperado_efectivo, total_entradas, total_salidas, entradas[] y salidas[] vigentes, turno.abierto_en
  estado: (turno) => leer('fx_turno_estado', { p_turno: turno }),
  // Entradas y salidas mezcladas en orden de hora: [{ tipo:'entrada'|'salida', id, monto, motivo, creado_por, creado_por_nombre, creado_en, anulada, anulada_por, anulada_en, anulada_motivo }]
  movimientos: (turno, incluirAnuladas = true) => leer('fx_movimientos_efectivo', { p_turno: turno, p_incluir_anuladas: incluirAnuladas }),
  registrar: (tipo, turno, monto, motivo) => rpc(tipo === 'entrada' ? 'fx_entrada_registrar' : 'fx_salida_registrar', { p_turno: turno, p_monto: monto, p_motivo: motivo }),
  anular: (tipo, id, motivo) => rpc(tipo === 'entrada' ? 'fx_entrada_anular' : 'fx_salida_anular_motivo', { p_id: id, p_motivo: motivo }),
};
