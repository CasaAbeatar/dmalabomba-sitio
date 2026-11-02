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

// Fase 3: facturas de proveedores a cuentas
export const compras = (soc, desde, hasta, filtro = 'por_clasificar', q = null) => rpc('fx_contable_compras', { p_soc: soc, p_desde: desde, p_hasta: hasta, p_filtro: filtro, p_q: q });
export const compra = (soc, clave) => rpc('fx_contable_compra', { p_soc: soc, p_clave: clave });
export const compraConfirmar = (soc, clave, items, contabilizar = true) => rpc('fx_contable_compra_confirmar', { p_soc: soc, p_clave: clave, p_items: items, p_contabilizar: contabilizar });
export const comprasAceptarSugerencias = (soc, claves) => rpc('fx_contable_compras_aceptar_sugerencias', { p_soc: soc, p_claves: claves });
export const reglas = (soc) => rpc('fx_contable_reglas', { p_soc: soc });
export const reglaQuitar = (soc, id) => rpc('fx_contable_regla_quitar', { p_soc: soc, p_regla: id });

// Fase 4: D-150 (IVA) y declaraciones guardadas
export const d150 = (soc, mes) => rpc('fx_contable_d150', { p_soc: soc, p_mes: mes });
export const declaracionGuardar = (soc, tipo, periodo, entradas) => rpc('fx_contable_declaracion_guardar', { p_soc: soc, p_tipo: tipo, p_periodo: periodo, p_entradas: entradas });
export const d150Presentar = (soc, mes, numero) => rpc('fx_contable_d150_presentar', { p_soc: soc, p_mes: mes, p_numero: numero });
export const declaraciones = (soc, tipo = 'D150') => rpc('fx_contable_declaraciones', { p_soc: soc, p_tipo: tipo });

// Fase 5: D-270
export const d270 = (soc, periodo) => rpc('fx_contable_d270', { p_soc: soc, p_periodo: periodo });
export const d270Guardar = (soc, datos) => rpc('fx_contable_d270_operacion_guardar', { p_soc: soc, p: datos });
export const d270Quitar = (soc, id) => rpc('fx_contable_d270_operacion_quitar', { p_soc: soc, p_id: id });
export const d270Presentar = (soc, periodo, numero) => rpc('fx_contable_d270_presentar', { p_soc: soc, p_periodo: periodo, p_numero: numero });
export const d270Rectificar = (soc, periodo) => rpc('fx_contable_d270_rectificar', { p_soc: soc, p_periodo: periodo });
export const d270Calendario = (soc) => rpc('fx_contable_d270_calendario', { p_soc: soc });

// Fase 6: estados financieros (NIIF para las PYMES) y analítica
export const estados = (soc, desde, hasta) => rpc('fx_contable_estados', { p_soc: soc, p_desde: desde, p_hasta: hasta });
export const analitica = (soc, desde, hasta) => rpc('fx_contable_analitica', { p_soc: soc, p_desde: desde, p_hasta: hasta });
