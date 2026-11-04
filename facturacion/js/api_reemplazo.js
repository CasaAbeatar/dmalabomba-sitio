// «Corregir y generar de nuevo»: reemplaza un documento rechazado por Hacienda (o que no llegó a Hacienda, o que se anuló con nota de crédito) con uno nuevo, en un solo paso.
// Función de la base: fx_reemplazar_documento(p_original, p_cliente, p_terminal, p_actividad_receptor). Hace TODO en una sola transacción: copia la venta, repite el pago,
// cobra como reemplazo (consecutivo nuevo, referencia al anterior) y cierra la alerta de Hacienda del documento viejo. Propuesta en sql/REEMPLAZO 01 propuesta.sql.
// Mientras esa función no exista en la base se usa el camino de siempre en tres llamadas (fx_venta_clonar, fx_cobrar_reemplazo y, si es administración, fx_alerta_atender):
// el resultado es el mismo documento nuevo, solo que la alerta de Hacienda no se cierra sola para quien no es administrador y no es una sola transacción.
import { rpc } from './api.js';
import { faltaFuncion, ventaClonar, alertaAtender } from './api_documentos.js';

// Se enciende cuando la base y la función de borde sepan reemplazar un documento en estado «error» (sin referencia, porque Hacienda nunca lo vio).
const SOPORTA_ERROR = false;
const MEDIOS_VALIDOS = ['efectivo', 'tarjeta', 'sinpe', 'transferencia'];

// El mismo pago del documento original, tal como lo espera fx_cobrar (en efectivo el recibido es el monto: no hay vuelto nuevo que dar)
export function pagosParaReemplazo(original) {
  const lista = Array.isArray(original?.pagos_snapshot) ? original.pagos_snapshot : [];
  return lista.filter((p) => MEDIOS_VALIDOS.includes(p?.medio) && Number(p.monto) > 0).map((p) => {
    const base = { medio: p.medio, monto: Number(p.monto), referencia: p.referencia || undefined };
    return p.medio === 'efectivo' ? { ...base, recibido: Number(p.monto) } : base;
  });
}

// Lo que se puede reemplazar: rechazados, con error (no llegaron a Hacienda) y aceptados que ya tienen una nota de crédito viva.
// Devuelve 'rechazado' | 'error' | 'anulado' | null.
export function tipoDeReemplazo(c, nc) {
  if (!c || !['01', '04'].includes(c.tipo_doc) || !c.venta_id) return null;
  if (c.estado === 'rechazado') return 'rechazado';
  if (c.estado === 'error') return SOPORTA_ERROR ? 'error' : null; // un documento que no llegó a Hacienda: ver el informe (hace falta cambiar la función de borde)
  if (c.estado === 'aceptado' && nc && nc.estado !== 'rechazado') return 'anulado';
  return null;
}

export async function reemplazarDocumento({ original, clienteId = null, actividad = null, esAdmin = false }) {
  try {
    const r = await rpc('fx_reemplazar_documento', { p_original: original.id, p_cliente: clienteId || null, p_terminal: original.terminal || null, p_actividad_receptor: actividad || null });
    return { comprobante: r, alertaCerrada: Number(r?.alertas_cerradas || 0) > 0, unaSolaTransaccion: true };
  } catch (e) {
    if (!faltaFuncion(e)) throw e;
  }
  // Camino de respaldo con las funciones que ya existen. fx_venta_clonar copia también los descuentos; el cliente elegido viaja en el cobro.
  const copia = await ventaClonar(original.venta_id);
  const ventaId = copia?.venta?.id || copia?.id || null;
  if (!ventaId) throw new Error('La copia de la venta todavía no está activada.');
  const pagos = pagosParaReemplazo(original);
  const comp = await rpc('fx_cobrar_reemplazo', { p_venta: ventaId, p_original: original.id, p_pagos: pagos, p_cliente: clienteId || null, p_terminal: original.terminal || 1, p_actividad_receptor: actividad || null });
  let alertaCerrada = false;
  if (esAdmin && original.estado !== 'aceptado') {
    try { await alertaAtender(original.id, 'Reemplazado por el documento ' + String(comp?.consecutivo || '').slice(-10).replace(/^0+(?=\d)/, '')); alertaCerrada = true; } catch { /* queda para «Ya lo atendí» */ }
  }
  return { comprobante: comp, alertaCerrada, unaSolaTransaccion: false };
}
