// Datos del módulo Contabilidad (solo administradores). Todo pasa por funciones public.fx_contable_* (ver sql/contable/). Archivo nuevo: no se edita api.js.
import { rpc } from './api.js';

// Fase 1: catálogo y parámetros
export const catalogo = (soc) => rpc('fx_contable_catalogo', { p_soc: soc });
export const catalogoIniciar = (soc) => rpc('fx_contable_catalogo_iniciar', { p_soc: soc });
export const cuentaGuardar = (soc, datos) => rpc('fx_contable_cuenta_guardar', { p_soc: soc, p: datos });
export const parametros = (soc) => rpc('fx_contable_parametros', { p_soc: soc });
export const parametroGuardar = (soc, clave, valor, resuelto = true) => rpc('fx_contable_parametro_guardar', { p_soc: soc, p_clave: clave, p_valor: valor, p_resuelto: resuelto });

// Fase 2: asientos, libro diario, balanza, mayor y períodos
export const hoy = (soc, dia = null) => rpc('fx_contable_hoy', { p_soc: soc, p_dia: dia });
export const ventasDiaRegistrar = (soc, desde, hasta = null) => rpc('fx_contable_ventas_dia_registrar', { p_soc: soc, p_desde: desde, p_hasta: hasta });
export const asientoManual = (soc, fecha, concepto, lineas) => rpc('fx_contable_asiento_manual', { p_soc: soc, p_fecha: fecha, p_concepto: concepto, p_lineas: lineas });
export const asientoReversar = (soc, id, motivo) => rpc('fx_contable_asiento_reversar', { p_soc: soc, p_asiento: id, p_motivo: motivo });
export const diario = (soc, desde, hasta, q = null, origen = null) => rpc('fx_contable_diario', { p_soc: soc, p_desde: desde, p_hasta: hasta, p_q: q, p_origen: origen });
export const balanza = (soc, desde, hasta) => rpc('fx_contable_balanza', { p_soc: soc, p_desde: desde, p_hasta: hasta });
export const mayor = (soc, cuenta, desde, hasta) => rpc('fx_contable_mayor', { p_soc: soc, p_cuenta: cuenta, p_desde: desde, p_hasta: hasta });
export const periodos = (soc) => rpc('fx_contable_periodos', { p_soc: soc });
export const periodoEstado = (soc, anio, mes, cerrar, nota = null) => rpc('fx_contable_periodo_estado', { p_soc: soc, p_anio: anio, p_mes: mes, p_cerrar: cerrar, p_nota: nota });
