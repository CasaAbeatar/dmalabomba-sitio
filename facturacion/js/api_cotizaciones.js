// Acceso a datos de Cotizaciones y Pedidos fijos (solo administradores). Todo pasa por funciones fx_* de Supabase.
// Una cotización NO es un comprobante electrónico y nunca se envía a Hacienda. Un pedido fijo solo genera BORRADORES: nada se emite solo.
import { rpc } from './api.js';

export const cotizaciones = {
  // [{ id, numero, estado, estado_efectivo ('vencida' si ya pasó la vigencia), cliente_nombre, total, vigencia_hasta, creado_en, n_lineas, venta_numero }]
  lista: (soc, estado = null, q = null) => rpc('fx_cotizaciones', { p_soc: soc, p_estado: estado || null, p_q: q || null }),
  // { cotizacion, lineas[], cliente, emisor }
  ver: (id) => rpc('fx_cotizacion', { p_id: id }),
  // p: { id?, sociedad_id, cliente_id? | cliente_texto, correo, telefono, vigencia_hasta, notas, lineas:[{ producto_id, cantidad, precio, nota }] }
  guardar: (p) => rpc('fx_cotizacion_guardar', { p }),
  // estado: 'enviada' (con via: 'correo' | 'impresa' | 'whatsapp'), 'aceptada', 'rechazada' o 'borrador'
  estado: (id, estado, via = null) => rpc('fx_cotizacion_estado', { p_id: id, p_estado: estado, p_via: via }),
  // Pasa la cotización a una cuenta abierta de Caja (necesita turno abierto). Devuelve la cuenta (como api.venta).
  convertir: (id, terminal = 1) => rpc('fx_cotizacion_convertir', { p_id: id, p_terminal: terminal }),
};

export const recurrentes = {
  // { plantillas:[{ id, nombre, cliente_id, cliente_nombre, tipo_servicio, frecuencia, dia_semana, dia_mes, proxima_fecha, activa, notas, ultima_generada, total, lineas[] }], borradores:[...], pendientes }
  estado: (soc) => rpc('fx_recurrentes', { p_soc: soc }),
  // p: { id?, sociedad_id, nombre, cliente_id, tipo_servicio, frecuencia ('semanal'|'quincenal'|'mensual'), dia_semana (0 domingo a 6), dia_mes (1 a 28), notas, lineas[] }
  guardar: (p) => rpc('fx_recurrente_guardar', { p }),
  activar: (id, activa) => rpc('fx_recurrente_activar', { p_id: id, p_activa: !!activa }),
  // Genera ahora los borradores que ya tocaban. Devuelve { nuevos, estado }.
  generar: (soc) => rpc('fx_recurrente_generar', { p_soc: soc }),
  // Confirmar abre la cuenta en Caja (turno abierto); NO cobra ni emite. Devuelve la cuenta.
  confirmar: (borrador, terminal = 1) => rpc('fx_recurrente_confirmar', { p_borrador: borrador, p_terminal: terminal }),
  descartar: (borrador, motivo = null) => rpc('fx_recurrente_descartar', { p_borrador: borrador, p_motivo: motivo }),
};
