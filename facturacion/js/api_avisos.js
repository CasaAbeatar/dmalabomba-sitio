// Acceso a datos de Avisos por WhatsApp y de las entradas de efectivo. Todo pasa por funciones fx_* de Supabase (api.js no se toca).
// Las consultas las repite UNA vez sola api.js si falla la red; las escrituras nunca se repiten solas.
import { rpc } from './api.js';

// api.js ya repite una vez las lecturas que fallan por la red; aquí no se repite de nuevo.
const leer = (nombre, args) => rpc(nombre, args);

// Entradas y salidas de efectivo de la caja
export const efectivo = {
  salidaRegistrar: (turno, monto, motivo) => rpc('fx_salida_registrar', { p_turno: turno, p_monto: monto, p_motivo: motivo }),
  entradaRegistrar: (turno, monto, motivo) => rpc('fx_entrada_registrar', { p_turno: turno, p_monto: monto, p_motivo: motivo }),
  // Anular siempre lleva el motivo de la anulación
  salidaAnular: (id, motivo) => rpc('fx_salida_anular_motivo', { p_id: id, p_motivo: motivo }),
  entradaAnular: (id, motivo) => rpc('fx_entrada_anular', { p_id: id, p_motivo: motivo }),
  // Entradas y salidas del turno mezcladas, en orden de hora: [{ tipo:'entrada'|'salida', id, monto, motivo, creado_por, creado_por_nombre, creado_en, anulada, anulada_por, anulada_en, anulada_motivo }]
  movimientos: (turno, incluirAnuladas = true) => leer('fx_movimientos_efectivo', { p_turno: turno, p_incluir_anuladas: incluirAnuladas }),
};

// Avisos por WhatsApp (pantalla Avisos)
export const avisos = {
  // { negocio, modo:'simulado'|'real', numero_emisor, emisor_configurado, texto_plantilla, destinatarios_activos, pendientes, con_error, hoy, puede_administrar }
  resumen: (soc) => leer('fx_avisos_resumen', { p_soc: soc }),
  // [{ id, nombre, telefono (completo solo para administradores), eventos[], monto_minimo, activo, consentimiento_en, consentimiento_por }]
  destinatarios: (soc) => leer('fx_avisos_destinatarios', { p_soc: soc }),
  // p: { id?, nombre, telefono, eventos[], monto_minimo, activo, consentimiento } (solo cambia las llaves que se manden)
  guardar: (soc, p) => rpc('fx_avisos_destinatario_guardar', { p_soc: soc, p }),
  // [{ id, tipo, parametros[7], estado, estado_entrega, error, es_prueba, creado_en, enviado_en, destinatario, telefono }] del más viejo al más nuevo
  lista: (soc, desde, hasta) => leer('fx_avisos_lista', { p_soc: soc, p_desde: desde, p_hasta: hasta }),
  probar: (soc, destinatario) => rpc('fx_avisos_probar', { p_soc: soc, p_destinatario: destinatario }),
  reintentar: (soc) => rpc('fx_avisos_reintentar', { p_soc: soc }),
};
