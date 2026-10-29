// Datos propios de la ventana «Anular y reimprimir» y del aviso del encabezado (no se edita api.js).
// Funciones SQL usadas (ver /home/claude/facturador/sql/05_documentos.sql):
//   fx_documentos(p_soc, p_desde, p_hasta)  -> comprobantes del rango en orden cronológico, con el vínculo factura <-> nota de crédito
//   fx_comprobante_nc(p_id)                 -> nota de crédito vigente (no rechazada) de un comprobante, o null
//   fx_alertas(p_soc)                       -> { rechazados, pendientes, pendientes_demorados, recepcion_por_responder, recepcion_vencen_pronto, ultimos[] } (contrato 3 y 2B)
//   fx_alerta_atender(p_comprobante, p_nota) -> marca un documento rechazado como atendido: sale del aviso rojo, NO de Anular y reimprimir ni de Informes (contrato 2B)
//   fx_venta_clonar(p_venta)                -> cuenta nueva abierta con las líneas de una venta anulada o rechazada; misma forma que fx_venta (contrato 2B)
import { api, rpc, funcion, ErrorApi } from './api.js';
import { hoyCR, sumaDias, numeroDoc, traducirHacienda } from './util.js';

// Lista del rango. Cada fila trae además nc_id, nc_consecutivo, nc_estado (si fue anulada) y ref_consecutivo, ref_tipo (si es una nota de crédito).
export async function documentos(soc, desde, hasta) {
  try {
    return (await rpc('fx_documentos', { p_soc: soc, p_desde: desde, p_hasta: hasta })) || [];
  } catch (e) {
    // Si la función nueva no existiera todavía, se usa la lista básica y se calcula el vínculo con lo que haya en el rango.
    if (!/fx_documentos|does not exist|schema cache/i.test(e.message)) throw e;
    const filas = ((await api.comprobantes(soc, desde, hasta, '')) || []).slice().reverse();
    const porId = new Map(filas.map((f) => [f.id, f]));
    for (const f of filas) {
      if (f.tipo_doc === '03' && f.estado !== 'rechazado' && f.comprobante_ref && porId.has(f.comprobante_ref)) {
        const o = porId.get(f.comprobante_ref);
        o.nc_id = f.id; o.nc_consecutivo = f.consecutivo; o.nc_estado = f.estado;
      }
      if (f.comprobante_ref && porId.has(f.comprobante_ref)) { f.ref_consecutivo = porId.get(f.comprobante_ref).consecutivo; f.ref_tipo = porId.get(f.comprobante_ref).tipo_doc; }
    }
    return filas;
  }
}

// Nota de crédito vigente de un comprobante, o null
export const ncDe = (id) => rpc('fx_comprobante_nc', { p_id: id });

// Correo al cliente: todavía no existe la función en el servidor. Cuando se active el envío de correos,
// poner CORREO_ACTIVO en true y ajustar el nombre de la función de borde si hace falta.
export const CORREO_ACTIVO = false;
export const reenviarCorreo = (id) => funcion('facturador-correo', { id });

/* ---------- Alertas del encabezado ---------- */
// Devuelve { rechazados, pendientes, recepcion_por_responder (número o null si no se sabe), recepcion_vencen_pronto, ultimos:[{id, numero, estado, mensaje}], desde (YYYY-MM-DD), fuente }.
// «pendientes» son los que llevan demasiado esperando a Hacienda (fx_alertas los trae como pendientes_demorados, más de 15 minutos); un cobro recién hecho siempre está en cola un momento y no debe dar aviso.
// La ventana de fx_alertas son los últimos 3 días (hoy y los 3 anteriores): «desde» es el primer día, para que «Ver» abra la lista con las mismas fechas.
// Usa fx_alertas cuando la base ya la tiene. Mientras no exista usa un valor de reserva sacado de fx_documentos (los últimos 3 días) y vuelve a probar fx_alertas cada 5 minutos,
// así que cambia sola a la función nueva cuando se cree.
let noHayAlertasHasta = 0;
const SIN_FUNCION = /fx_alertas|does not exist|schema cache|could not find the function/i;
const entero = (x) => { const n = Number(x); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; };

export async function alertas(soc) {
  if (Date.now() >= noHayAlertasHasta) {
    try {
      const a = (await rpc('fx_alertas', { p_soc: soc })) || {};
      return {
        rechazados: entero(a.rechazados), pendientes: entero(a.pendientes_demorados ?? a.pendientes),
        recepcion_por_responder: a.recepcion_por_responder == null ? null : entero(a.recepcion_por_responder),
        recepcion_vencen_pronto: a.recepcion_vencen_pronto == null ? null : entero(a.recepcion_vencen_pronto),
        ultimos: (Array.isArray(a.ultimos) ? a.ultimos : []).slice(0, 5).map((u) => ({ id: u.id, numero: String(u.numero ?? ''), estado: u.estado || '', mensaje: String(u.mensaje ?? '') })),
        desde: typeof a.desde === 'string' ? a.desde.slice(0, 10) : sumaDias(hoyCR(), -DIAS_VENTANA), fuente: 'fx_alertas',
      };
    } catch (e) {
      if (!SIN_FUNCION.test(e.message || '')) throw e;
      noHayAlertasHasta = Date.now() + 5 * 60 * 1000;
    }
  }
  return alertasDeReserva(soc);
}

const MIN_PENDIENTE = 15; // igual que fx_alertas: un cobro recién hecho siempre está en cola un momento; avisa solo si pasan más de 15 minutos
const DIAS_VENTANA = 3;
async function alertasDeReserva(soc) {
  const hoy = hoyCR(), desde = sumaDias(hoy, -DIAS_VENTANA);
  const docs = await documentos(soc, desde, hoy);
  const ahora = Date.now();
  const rechazados = docs.filter((d) => d.estado === 'rechazado');
  const pendientes = docs.filter((d) => ['pendiente', 'enviado', 'error'].includes(d.estado) && ahora - new Date(d.fecha_emision).getTime() > MIN_PENDIENTE * 60000);
  const ultimos = [...rechazados, ...pendientes].sort((a, b) => new Date(b.fecha_emision) - new Date(a.fecha_emision)).slice(0, 5).map((d) => ({
    id: d.id, numero: numeroDoc(d.consecutivo), estado: d.estado,
    mensaje: d.estado === 'rechazado' ? (traducirHacienda(d.mensaje).resumen || 'Hacienda no lo aceptó.') : 'Todavía no llegó a Hacienda. El sistema vuelve a intentarlo solo.',
  }));
  return { rechazados: rechazados.length, pendientes: pendientes.length, recepcion_por_responder: null, recepcion_vencen_pronto: null, ultimos, desde, fuente: 'reserva' };
}

/* ---------- Funciones nuevas de la ronda 2B (si la base todavía no las tiene, se avisa con palabras claras) ---------- */
const NO_EXISTE = /fx_alerta_atender|fx_venta_clonar|does not exist|schema cache|could not find the function/i;

// Marca un documento rechazado como atendido. La nota es opcional. Devuelve lo que responda la base ({ok, ...}).
export async function alertaAtender(comprobanteId, nota = '') {
  try {
    return await rpc('fx_alerta_atender', { p_comprobante: comprobanteId, p_nota: String(nota || '').trim().slice(0, 300) || null });
  } catch (e) {
    if (NO_EXISTE.test(e.message || '')) throw new ErrorApi('Esta opción todavía no está activada en el servidor. El aviso rojo seguirá hasta que se active.');
    throw e;
  }
}

// Crea una cuenta nueva con las mismas líneas de una venta anulada o rechazada. Devuelve { venta, lineas, ... } como fx_venta, o null si la función no existe todavía.
export async function ventaClonar(ventaId) {
  try {
    return await rpc('fx_venta_clonar', { p_venta: ventaId });
  } catch (e) {
    if (NO_EXISTE.test(e.message || '')) return null;
    throw e;
  }
}

// Lo que hace el botón «Hacer la venta de nuevo en Facturación»: copia las líneas a una cuenta nueva, la deja anotada para que Facturación la abra
// (sessionStorage 'fx.caja.abrir' = id de la cuenta nueva) y va a Facturación (app.ir('caja')). Si no se pudo copiar, igual va y avisa con palabras claras.
export async function hacerVentaDeNuevo(app, ventaId, toast) {
  let nueva = null;
  try { nueva = ventaId ? await ventaClonar(ventaId) : null; }
  catch (e) { toast?.('No se pudo copiar la venta: ' + (e.message || e) + ' En Facturación tendrá que armarla otra vez.', 'error', 8000); }
  const id = nueva?.venta?.id || nueva?.id || null;
  if (id) { try { sessionStorage.setItem('fx.caja.abrir', String(id)); } catch { /* sin almacenamiento: Caja abre la cuenta sola si puede */ } }
  else if (!nueva) toast?.('La copia automática de la venta todavía no está activada. En Facturación tendrá que armarla otra vez.', 'error', 8000);
  app.ir('caja');
  return id;
}
