// Acceso a datos de «Numeración y paso a facturas reales» (solo administradores). Pasa por el rpc() de api.js, que no se toca.
// Nada de aquí cambia el ambiente de la empresa (sociedades.ambiente): la base no ofrece una función para eso y esta pantalla tampoco la busca.
// Lo único que escribe es el número de partida de cada tipo de documento (fx_consecutivo_fijar) y la confirmación de que la numeración real empieza en 1 (las dos fx_consecutivo_confirmar_inicio*).
import { rpc } from './api.js';

export const numeracion = {
  // { empresa, nombre, ambiente_actual:'sandbox'|'produccion', ambiente_actual_texto, destino, destino_texto, paso_permitido, motivos:[{causa, cuantos, mensaje, detalle?}],
  //   consecutivos:[{sucursal, terminal, tipo_doc, nombre, fijado, ultimo, siguiente}], consecutivos_fijados, consecutivos_pendientes, indice_viejo_pendiente, comprobantes_pruebas, comprobantes_reales }
  estado: (soc) => rpc('fx_ambiente_estado', { p_soc: soc }),
  // { ambiente, filas:[{ambiente, terminal, tipo_doc, ultimo, siguiente, fijado_manual}], faltan_para_produccion:[{terminal, tipo_doc}], requeridos:[igual que consecutivos de arriba] }
  consecutivos: (soc) => rpc('fx_consecutivos', { p_soc: soc }),
  // Escribe el ÚLTIMO número emitido (nunca baja: la base lo rechaza). ambiente: 'sandbox' | 'produccion' (la fila que se toca).
  fijar: (soc, terminal, tipo, ultimo, ambiente) => rpc('fx_consecutivo_fijar', { p_soc: soc, p_terminal: terminal, p_tipo: tipo, p_ultimo: ultimo, p_ambiente: ambiente }),
  // Facturas, tiquetes y notas (01 a 04) de una caja: la empresa nunca ha emitido en producción. confirmacion = exactamente «sin comprobantes previos».
  confirmarInicio: (soc, terminal, confirmacion) => rpc('fx_consecutivo_confirmar_inicio', { p_soc: soc, p_terminal: terminal, p_confirmacion: confirmacion }),
  // Respuestas a facturas de proveedores (05, 06 y 07; siempre caja 1). confirmacion = exactamente «sin respuestas previas».
  confirmarInicioMensajes: (soc, confirmacion) => rpc('fx_consecutivo_confirmar_inicio_mensajes', { p_soc: soc, p_confirmacion: confirmacion }),
};

// Las frases que la base exige escribir tal cual (comparan sin mayúsculas ni espacios de más)
export const FRASE_COMPROBANTES = 'sin comprobantes previos';
export const FRASE_RESPUESTAS = 'sin respuestas previas';

export const NOMBRE_TIPO = {
  '01': 'Factura electrónica', '02': 'Nota de débito', '03': 'Nota de crédito', '04': 'Tiquete electrónico',
  '05': 'Aceptación de una factura de proveedor', '06': 'Aceptación parcial de una factura de proveedor', '07': 'Rechazo de una factura de proveedor',
};
export const nombreTipo = (t, dado) => (typeof dado === 'string' && dado.trim() ? dado.trim() : NOMBRE_TIPO[t] || 'Documento ' + t);
export const esRespuesta = (t) => t === '05' || t === '06' || t === '07';

const entero = (x, def = null) => { const n = Number(x); return Number.isFinite(n) ? Math.floor(n) : def; };
const fila = (c) => (c && typeof c === 'object' ? {
  terminal: entero(c.terminal, 1), tipo: String(c.tipo_doc ?? ''), nombre: nombreTipo(String(c.tipo_doc ?? ''), c.nombre),
  fijado: c.fijado === true || c.fijado_manual === true, ultimo: c.ultimo == null ? null : entero(c.ultimo), siguiente: c.siguiente == null ? null : entero(c.siguiente),
  ambiente: c.ambiente == null ? null : String(c.ambiente),
} : null);

// Deja las dos respuestas en una forma segura para pintar. Un dato raro se ignora en vez de romper la pantalla.
export function normalizarNumeracion(e, c) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return null;
  const actual = e.ambiente_actual === 'produccion' ? 'produccion' : 'sandbox';
  const destino = actual === 'produccion' ? 'sandbox' : 'produccion';
  const motivos = (Array.isArray(e.motivos) ? e.motivos : []).filter((m) => m && typeof m === 'object').map((m) => ({ causa: String(m.causa ?? ''), cuantos: Math.max(0, entero(m.cuantos, 0)), mensaje: String(m.mensaje ?? '') }));
  const requeridos = (Array.isArray(e.consecutivos) ? e.consecutivos : Array.isArray(c?.requeridos) ? c.requeridos : []).map(fila).filter(Boolean);
  const filas = (Array.isArray(c?.filas) ? c.filas : []).map(fila).filter((f) => f && (f.ambiente === 'sandbox' || f.ambiente === 'produccion'));
  return {
    empresa: String(e.nombre ?? e.empresa ?? ''),
    actual, actualTexto: String(e.ambiente_actual_texto || (actual === 'produccion' ? 'Facturas reales' : 'Modo de pruebas')),
    destino, destinoTexto: String(e.destino_texto || (destino === 'produccion' ? 'Facturas reales' : 'Modo de pruebas')),
    pasoPermitido: e.paso_permitido === true && motivos.length === 0,
    motivos, requeridos, filas,
    fijados: entero(e.consecutivos_fijados, requeridos.filter((r) => r.fijado).length), pendientes: entero(e.consecutivos_pendientes, requeridos.filter((r) => !r.fijado).length),
    pruebas: Math.max(0, entero(e.comprobantes_pruebas, 0)), reales: Math.max(0, entero(e.comprobantes_reales, 0)),
  };
}
