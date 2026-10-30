// Datos del módulo Contable (no se edita api.js). Funciones SQL de solo lectura: public.fx_recibidas y public.fx_recibida (ver sql/06_recepcion.sql y CONTRATO_CONTABLE.md).
// Responder (aceptar, parcial, rechazar), revisar lo que se enviaría (calcular) y revisar el correo usan funciones de borde con la sesión del usuario.
import { rpc, ErrorApi, funcion } from './api.js';

// modo: 'todas' (por periodo) | 'pendientes' (sin respuesta y dentro del plazo de 8 días hábiles; ignora el periodo) | 'vencidas' (sin respuesta y plazo vencido, dentro del periodo)
// Devuelve {hoy, conteo:{llegaron_hoy,pendientes_en_plazo,vencen_pronto,vencen_hoy,iva_en_riesgo,vencidas_recientes,vencidas_antiguas}, resumen:{n,total,iva,neto,sin_responder,redondeo?}, otras_cedulas, sin_receptor?, truncado, filas[]}
// Por fila, además (contrato C1): del_grupo, buzon_otra_empresa, aviso_buzon, receptor_reportado, hacienda_cuadra, lineas_cuadran, lineas_aviso, verificacion_nota.
export const recibidas = (soc, desde, hasta, q = '', modo = 'todas') => rpc('fx_recibidas', { p_soc: soc, p_desde: desde, p_hasta: hasta, p_q: q, p_modo: modo });
// Detalle por clave de 50 dígitos: {factura, local, lineas[], mensajes[], requiere, propia, receptor_estado, receptor_en, hacienda_estado, vence, dias_restantes, pendiente, ...llaves del contrato C1 (desglose, credito, inventario, aviso_buzon, lineas_aviso, receptor_reportado...)}
export const recibida = (clave) => rpc('fx_recibida', { p_id: clave });
// La respuesta propia guardada (acción, condición del IVA, IVA acreditado, gasto, detalle, consecutivo, estado ante Hacienda), sin el XML. null si no hay.
export const respuestaGuardada = (clave) => rpc('fx_respuesta_recibida', { p_clave: clave });
// Solo el contador de pendientes (para un aviso en otra pantalla)
export const contarPendientes = async (soc) => (await recibidas(soc, null, null, '', 'pendientes')).conteo;
// Avisos del encabezado (fx_alertas): además trae recepcion_sin_xml, correos_sin_xml y recepcion_sin_xml_ultimos (contrato C1, 3.3)
export const alertasRecepcion = (soc) => rpc('fx_alertas', { p_soc: soc });
// «Ya lo revisé» de un aviso de recepción (tipo 'sin_xml_mensaje' | 'correo_sin_xml')
export const atenderAviso = (soc, tipo, ref, nota = null) => rpc('fx_alerta_recepcion_atender', { p_soc: soc, p_tipo: tipo, p_ref: ref, p_nota: nota });
// Comprobantes que llegaron a los buzones de esta empresa a nombre de otra cédula: {n, filas:[...]}
export const otraCedula = (soc, desde, hasta) => rpc('fx_recibidas_otra_cedula', { p_soc: soc, p_desde: desde, p_hasta: hasta });
// IVA del mes (débito de ventas y crédito de compras) y su detalle por comprobante (contrato C1, sección 4)
export const ivaMes = (soc, mes) => rpc('fx_iva_mes', { p_sociedad: soc, p_mes: mes });
export const ivaMesDetalle = (soc, mes, lado = 'todo', grupo = null) => rpc('fx_iva_mes_detalle', { p_sociedad: soc, p_mes: mes, p_lado: lado, p_grupo: grupo });

// Respuesta al proveedor. Función de borde "facturador-receptor" (v8): POST {factura_id (clave de 50 dígitos), accion:'aceptar'|'parcial'|'rechazar'|'consultar', motivo, condicion_impuesto?, proporcion?, monto_aceptado?, esperado?}
// -> {ok, estado:'aceptado'|'enviado'|'rechazado'|'pendiente', consecutivo, detalle, reenvio, enviado:{accion, mensaje, condicion, acreditar, gasto, detalle, descripcion}}. Los errores llegan como {ok:false, error} y funcion() los convierte en ErrorApi con ese texto.
// condicion_impuesto: '01' todo el IVA es crédito, '02' solo una parte (proporcion mayor que 0 y menor que 100), '03' bien de capital, '04' gasto sin crédito.
export async function responder(clave, accion, motivo = '', extra = {}) {
  try {
    return await funcion('facturador-receptor', { factura_id: clave, accion, motivo, ...extra });
  } catch (e) {
    if (/^Error 404|Requested function was not found|NOT_FOUND/i.test(e.message)) throw new ErrorApi('La respuesta automática a Hacienda todavía no está activada en el sistema. La factura sigue sin responder.');
    throw e;
  }
}
// Lo que se enviaría, SIN enviar nada ni gastar consecutivo: {calculo:{mensaje, condicion, condicion_texto, acreditar, gasto, detalle, monto_aceptado, nota_credito, total, impuesto, iva, otros_impuestos, iva_devuelto, fuente, con_xml, moneda, tipo_cambio, descripcion}, se_puede_enviar, bloqueo, previa}
export const calcularRespuesta = (clave, respuesta, motivo = '', extra = {}) => responder(clave, 'calcular', motivo, { respuesta, ...extra });
// Pregunta a Hacienda si ya procesó una respuesta enviada (o si llegó una que quedó sin confirmar) y actualiza el estado.
export const consultarRespuesta = (clave) => funcion('facturador-receptor', { factura_id: clave, accion: 'consultar' });

// Revisa los buzones de contabilidad (Microsoft Graph) y guarda las facturas nuevas. La función de borde "facturas-recibidas" exige sesión válida (verify_jwt) y por omisión lee los últimos 3 días.
// Por buzón: {buzon, correos, comprobantes, mensajes_hacienda, n_sin_xml, sin_xml[], avisos[], errores[]}
export const revisarCorreo = () => funcion('facturas-recibidas', {});
