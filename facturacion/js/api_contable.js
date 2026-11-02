// Datos del módulo Contabilidad (solo administradores). Todo pasa por funciones public.fx_contable_* (ver sql/contable/). Archivo nuevo: no se edita api.js.
import { rpc } from './api.js';

// Fase 1: catálogo y parámetros
export const catalogo = (soc) => rpc('fx_contable_catalogo', { p_soc: soc });
export const catalogoIniciar = (soc) => rpc('fx_contable_catalogo_iniciar', { p_soc: soc });
export const cuentaGuardar = (soc, datos) => rpc('fx_contable_cuenta_guardar', { p_soc: soc, p: datos });
export const parametros = (soc) => rpc('fx_contable_parametros', { p_soc: soc });
export const parametroGuardar = (soc, clave, valor, resuelto = true) => rpc('fx_contable_parametro_guardar', { p_soc: soc, p_clave: clave, p_valor: valor, p_resuelto: resuelto });
