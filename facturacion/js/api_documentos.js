// Datos propios de la ventana «Anular y reimprimir» y del aviso del encabezado (no se edita api.js).
// Funciones SQL usadas (ver /home/claude/facturador/sql/05_documentos.sql):
//   fx_documentos(p_soc, p_desde, p_hasta)  -> comprobantes del rango en orden cronológico, con el vínculo factura <-> nota de crédito
//   fx_documentos_pagina(p_soc, p_desde, p_hasta, p_limite, p_desplazamiento) -> { documentos, total, hay_mas, siguiente_desplazamiento }: lo mismo por tandas de hasta 1 000, el más nuevo primero (fx_23b)
//   fx_comprobante_nc(p_id)                 -> nota de crédito vigente (no rechazada) de un comprobante, o null
//   fx_alertas(p_soc)                       -> { rechazados, pendientes, pendientes_demorados, recepcion_por_responder, recepcion_vencen_pronto, ultimos[] } (contrato 3 y 2B)
//   fx_alerta_atender(p_comprobante, p_nota) -> marca un documento rechazado como atendido: sale del aviso rojo, NO de Anular y reimprimir ni de Informes (contrato 2B)
//   fx_venta_clonar(p_venta)                -> cuenta nueva abierta con las líneas de una venta anulada o rechazada; misma forma que fx_venta (contrato 2B)
//   fx_venta_clonar_con_cliente(p_venta, p_cliente) -> lo mismo, pero la cuenta nueva queda con el cliente elegido (un tiquete no guarda cliente); sql/21h
//   fx_comprobante_saldos(p_id)             -> qué se le puede hacer a una factura o tiquete (admite_anulacion, motivo_no_anulacion), sus notas (notas[], con viva) y sus saldos (CONTRATO_NC_SQL.md, sección 2.1)
//   fx_nota_calcular, fx_nota_credito_devolucion, fx_nota_credito_monto, fx_nota_debito_monto, fx_nota_debito_sin_efecto -> notas parciales (CONTRATO_NC_SQL.md 2.2 a 2.6; las usa m_nota_parcial.js)
//   fx_venta_reemplazo_info(p_venta)        -> si una cuenta abierta es la copia de un comprobante anulado ({reemplaza, original_id, consecutivo, estado_nota_credito})
//   fx_cobrar_reemplazo(p_venta, p_original, p_pagos, ...) -> cobra esa copia y deja guardada la referencia 07 «Sustituye al comprobante»
import { api, rpc, ErrorApi } from './api.js';
import { hoyCR, sumaDias, numeroDoc, traducirHacienda } from './util.js';

// ¿La función de la base no existe todavía? api.js cambia el texto de todo error técnico por una frase general, así que el texto ya no sirve para saberlo:
// se mira el código y el estado que conserva ErrorApi (PostgREST contesta 404 con PGRST202 cuando no encuentra la función; 42883 es «undefined_function» de Postgres).
export const faltaFuncion = (e) => !!e && (e.codigo === 'PGRST202' || e.codigo === '42883' || e.estado === 404);
// ¿Es una respuesta de negocio escrita por una función nuestra (código P0001 o PT4xx), con un texto ya en español pensado para mostrarse tal cual?
// (No es la esErrorDeNegocio de api.js: aquella mira la clase de la falla y también cuenta como «negocio» una función que no existe; esta solo deja pasar lo que escribió una función nuestra.)
export const esRespuestaDeNegocio = (e) => !!e && /^(P0001|PT[1-4]\d\d)$/.test(String(e.codigo || ''));

// Lista del rango. Cada fila trae además nc_id, nc_consecutivo, nc_estado (solo si fue anulada por completo: una devolución parcial deja nc_id en null) y ref_consecutivo, ref_tipo (si es una nota).
// Llaves nuevas por fila (CONTRATO_NC_SQL.md, 8.2), que valen null o 0 en un documento normal: codigo_referencia, codigo_nombre, nombre_simple (el rótulo en palabras simples), reemplaza_a,
// reemplaza_consecutivo, tarifas (texto como «IVA 13%, IVA 2%» o «Exento»), parciales_n y parciales_total (devoluciones y correcciones), debitos_n y debitos_total (notas de débito por monto).
export async function documentos(soc, desde, hasta) {
  try {
    return (await rpc('fx_documentos', { p_soc: soc, p_desde: desde, p_hasta: hasta })) || [];
  } catch (e) {
    // Si la función nueva no existiera todavía, se usa la lista básica y se calcula el vínculo con lo que haya en el rango.
    if (!faltaFuncion(e)) throw e;
    const filas =((await api.comprobantes(soc, desde, hasta, '')) || []).slice().reverse();
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

// Lista del rango por páginas, la más nueva primero (fx_documentos_pagina, migración fx_23b). Devuelve { documentos, total, hay_mas, siguiente }:
//   total = cuántos documentos tiene el rango, hay_mas = si faltan más antiguos que los entregados, siguiente = desplazamiento de la página siguiente (o null).
// Cada fila trae las mismas llaves que documentos(). Si la base todavía no tiene la función (404 / PGRST202 / 42883), se usa documentos(), que entrega a lo sumo 1 000 y son los MÁS ANTIGUOS:
// entonces el resultado trae respaldo: true, orden: 'antiguos' y sinPaginas: true (no se pueden pedir más), y la pantalla lo dice con palabras.
export const DOCUMENTOS_POR_PAGINA = 1000; // el máximo que entrega la base por llamada
export async function documentosPagina(soc, desde, hasta, desplazamiento = 0, limite = DOCUMENTOS_POR_PAGINA) {
  try {
    const r = await rpc('fx_documentos_pagina', { p_soc: soc, p_desde: desde, p_hasta: hasta, p_limite: limite, p_desplazamiento: desplazamiento });
    if (Array.isArray(r)) return { documentos: r, total: r.length, hay_mas: r.length >= limite, siguiente: null, sinPaginas: true, orden: 'recientes' }; // una versión sin paginar entregó el arreglo de siempre
    const docs = Array.isArray(r?.documentos) ? r.documentos : [];
    return { documentos: docs, total: Number(r?.total) || docs.length, hay_mas: !!r?.hay_mas, siguiente: r?.siguiente_desplazamiento ?? null, sinPaginas: false, orden: 'recientes' };
  } catch (e) {
    if (!faltaFuncion(e)) throw e;
    if (desplazamiento > 0) return { documentos: [], total: 0, hay_mas: false, siguiente: null, sinPaginas: true, respaldo: true, orden: 'antiguos' }; // el respaldo no sabe entregar más
    const docs = await documentos(soc, desde, hasta);
    return { documentos: docs, total: docs.length, hay_mas: docs.length >= limite, siguiente: null, sinPaginas: true, respaldo: true, orden: 'antiguos' };
  }
}

// Nota de crédito vigente de un comprobante (la más reciente que no fue rechazada, sea del código que sea), o null
export const ncDe =(id) => rpc('fx_comprobante_nc', { p_id: id });

/* ---------- Saldos y notas de una factura o un tiquete (fx_comprobante_saldos) ---------- */
// Responde, con el texto ya en español, si se puede anular completo (admite_anulacion, motivo_no_anulacion), y trae las notas que ya tiene (notas[], con viva = true
// también para una nota que quedó en error) y cuánto lleva devuelto o cobrado de más. Si la función no existe todavía, tarda o falla, saldosDe devuelve null y cada pantalla
// se comporta como antes: no poder preguntar nunca bloquea una anulación; la base igual la rechaza con su propio mensaje si no corresponde.
const ESPERA_SALDOS_MS = 8000;
export async function saldosDe(id) {
  if (!id) return null;
  let reloj;
  try {
    const s = await Promise.race([rpc('fx_comprobante_saldos', { p_id: id }), new Promise((_, no) => { reloj = setTimeout(() => no(new Error('tardó')), ESPERA_SALDOS_MS); })]);
    return s && typeof s === 'object' && !Array.isArray(s) ? s : null;
  } catch { return null; } finally { clearTimeout(reloj); }
}
// ¿Se puede anular completo? { sabe, permite, motivo }. Sin la llave admite_anulacion (la base todavía no la manda) no se sabe: la pantalla deja intentar, como antes.
export function permiteAnular(s) {
  if (!s || typeof s.admite_anulacion !== 'boolean') return { sabe: false, permite: true, motivo: '' };
  return { sabe: true, permite: s.admite_anulacion, motivo: s.admite_anulacion ? '' : String(s.motivo_no_anulacion || '').trim() || 'Este documento no se puede anular completo.' };
}
// Una anulación total es una nota de crédito viva con código 01 (o 13); una nota de crédito sin código guardado se lee como 01 (CONTRATO_NC_SQL.md, sección 1)
export const esAnulacionTotal = (n) => !!n && n.tipo_doc === '03' && n.viva !== false && n.estado !== 'rechazado' && ['01', '13'].includes(String(n.codigo_referencia || '01'));
// La nota de anulación total vigente que traen los saldos, o null
export function anulacionDeSaldos(s) {
  if (!s || !Array.isArray(s.notas)) return null;
  return s.notas.filter(esAnulacionTotal).sort((a, b) => new Date(b.fecha_emision) - new Date(a.fecha_emision))[0] || null;
}
// Las demás notas vivas del documento: devoluciones y correcciones de crédito (03) y notas de débito (02)
export const otrasNotas = (s) => (s && Array.isArray(s.notas) ? s.notas.filter((n) => n.viva !== false && n.estado !== 'rechazado' && !esAnulacionTotal(n)) : []);
// La anulación total de un comprobante: { saldos, nc, ncAnulacion, saldosNC, sinEfecto }.
//   nc: la anulación que sigue VIGENTE (solo código 01 o 13; una devolución parcial NO es una anulación). Es null si no hay anulación o si se dejó sin efecto.
//   ncAnulacion: la nota de crédito de anulación total aunque ya se haya dejado sin efecto; saldosNC: los saldos de esa nota; sinEfecto: la nota de débito 01 viva que la dejó sin efecto.
//   La nota de débito 01 cuelga de la nota de crédito (no de la factura), por eso se leen los saldos de la nota de crédito: con la anulación sin efecto, el documento vuelve a valer.
// Sin los saldos se usa fx_comprobante_nc, que devuelve la última nota de crédito de CUALQUIER código y sin su código: entonces se lee la nota para saber de qué clase es.
// Si no se puede saber (falla la lectura), lanza un error con una frase lista para mostrar: nunca se da por anulado un documento que solo tiene una devolución, ni al revés.
export async function anulacionDe(id) {
  const saldos = await saldosDe(id);
  let vigente;
  if (saldos && Array.isArray(saldos.notas)) vigente = anulacionDeSaldos(saldos);
  else {
    const nota = await ncDe(id);
    vigente = null;
    if (nota) {
      let codigo = 'codigo_referencia' in nota ? nota.codigo_referencia : undefined;
      if (codigo === undefined) {
        try { const c = await rpc('fx_comprobante', { p_id: nota.id }); codigo = c && typeof c === 'object' ? (c.codigo_referencia ?? null) : undefined; } catch { codigo = undefined; }
      }
      if (codigo === undefined) throw new ErrorApi('No se pudo comprobar si este documento está anulado. Revise la conexión e intente de nuevo.');
      if (['01', '13'].includes(String(codigo || '01'))) vigente = nota; // una nota sin código guardado se lee como 01
    }
  }
  if (!vigente) return { saldos: saldos && Array.isArray(saldos.notas) ? saldos : null, nc: null, ncAnulacion: null, saldosNC: null, sinEfecto: null };
  const saldosNC = await saldosDe(vigente.id);
  // Sin esta segunda lectura no se sabe si la anulación se dejó sin efecto con una nota de débito: darla por vigente mostraría «Anulado» un documento que vuelve a valer
  if (!saldosNC || !Array.isArray(saldosNC.notas)) throw new ErrorApi('No se pudo comprobar si la anulación se dejó sin efecto. Intente de nuevo.');
  const sinEfecto = sinEfectoDeSaldos(saldosNC);
  return { saldos: saldos && Array.isArray(saldos.notas) ? saldos : null, nc: sinEfecto ? null : vigente, ncAnulacion: vigente, saldosNC, sinEfecto };
}

/* ---------- Notas parciales: devolver parte, corregir un monto y dejar sin efecto una anulación (CONTRATO_NC_SQL.md, secciones 2.2 a 2.6) ---------- */
// Lectura estricta de los saldos: a diferencia de saldosDe, si falla lanza el error para que la pantalla ofrezca «Intentar de nuevo» (api.js ya repite una vez la consulta si falló la red).
export async function saldosEstricto(id) {
  const s = await rpc('fx_comprobante_saldos', { p_id: id });
  if (!s || typeof s !== 'object' || Array.isArray(s)) throw new ErrorApi('No se pudo leer el documento. Intente de nuevo.');
  return s;
}
// Calcula la nota sin guardar nada: { tipo_doc, codigo_referencia, total, total_iva, lineas[], pagos_sugeridos[] }. tipo '03' crédito o '02' débito; codigo '06', '02' o '01'.
export const notaCalcular = (id, tipo, codigo, lineas = null) => rpc('fx_nota_calcular', { p_id: id, p_tipo: tipo, p_codigo: codigo, p_lineas: lineas });
// Las cuatro funciones que SÍ guardan (crean la nota y la mandan a la cola de Hacienda). Nunca se repiten solas: api.js solo repite consultas.
// lineas: devolución [{ linea, cantidad: '1.500' }]; corrección [{ linea, monto: '500.00' }]. pagos: [{ medio, monto: '1000.00' }] y debe sumar el total de la nota.
export const notaDevolucion = (id, lineas, motivo, terminal = 1, pagos = null) => rpc('fx_nota_credito_devolucion', { p_id: id, p_lineas: lineas, p_motivo: motivo, p_terminal: terminal, p_pagos: pagos });
export const notaCreditoMonto = (id, lineas, motivo, terminal = 1, pagos = null) => rpc('fx_nota_credito_monto', { p_id: id, p_lineas: lineas, p_motivo: motivo, p_terminal: terminal, p_pagos: pagos });
export const notaDebitoMonto = (id, lineas, motivo, terminal = 1, pagos = null) => rpc('fx_nota_debito_monto', { p_id: id, p_lineas: lineas, p_motivo: motivo, p_terminal: terminal, p_pagos: pagos });
// id = la NOTA DE CRÉDITO de anulación total (no la factura)
export const notaDebitoSinEfecto = (id, motivo, terminal = 1, pagos = null) => rpc('fx_nota_debito_sin_efecto', { p_id: id, p_motivo: motivo, p_terminal: terminal, p_pagos: pagos });
// La nota de débito viva que dejó sin efecto una anulación, si la hay. Se lee en los saldos de la NOTA DE CRÉDITO (la nota de débito cuelga de ella, no de la factura).
export const sinEfectoDeSaldos = (s) => (s && Array.isArray(s.notas) ? s.notas.find((n) => n.tipo_doc === '02' && String(n.codigo_referencia) === '01' && n.viva !== false && n.estado !== 'rechazado') || null : null);

/* ---------- Reemplazo: «Anular y hacer de nuevo» ---------- */
// Pregunta si la cuenta abierta es la copia de un comprobante anulado. { ok: true, reemplaza: false } o
// { ok: true, reemplaza: true, original_id, consecutivo, estado_nota_credito } (pendiente, enviado, aceptado o error). { ok: false } si no se pudo saber (la función no existe o no hubo conexión).
// Un error de negocio de la base (P0001 / PT4xx) NO se traga: se lanza tal cual con su texto en español. Es el caso de fx_23e: la anulación del original se dejó sin efecto con una nota de débito,
// así que ese comprobante vuelve a valer y la cuenta no puede cobrarse como su reemplazo. Caja muestra ese texto y ofrece «Anular esta cuenta».
export async function reemplazoInfo(ventaId) {
  try {
    const r = await rpc('fx_venta_reemplazo_info', { p_venta: ventaId });
    if (!r || typeof r !== 'object') return { ok: false };
    return r.reemplaza === true && r.original_id ? { ok: true, reemplaza: true, original_id: r.original_id, consecutivo: r.consecutivo || '', estado_nota_credito: r.estado_nota_credito || '' } : { ok: true, reemplaza: false };
  } catch (e) {
    if (esRespuestaDeNegocio(e)) throw e; // la base dijo que no, con palabras: se muestra
    return { ok: false }; // sin red, sin tiempo o sin la función: «no se sabe», y el cobro normal sigue (la base lo vuelve a revisar al cobrar)
  }
}
// Cobra la copia como reemplazo del original: igual que fx_cobrar, y guarda en la misma operación la referencia 07 y el motivo «Reemplaza el comprobante N». Devuelve el comprobante nuevo.
export const cobrarReemplazo = (ventaId, originalId, pagos, clienteId = null, terminal = 1, actividad = null) =>
  rpc('fx_cobrar_reemplazo', { p_venta: ventaId, p_original: originalId, p_pagos: pagos, p_cliente: clienteId, p_terminal: terminal, p_actividad_receptor: actividad || null });

// Correo al cliente: el interruptor ya no es una constante fija. Lo trae fx_contexto (llave correo_activo, que lee fact.config) y m_documentos.js lo mira con correoActivo(app).
// Mientras la base diga que no, el botón «Reenviar al cliente por correo» queda apagado y lo explica.
export const correoActivo = (app) => app?.ctx?.correo_activo === true;
// El reenvío vive en la base: fx_reenviar_correo(p_id) deja la orden y la base llama a facturador-envio con accion 'correo'. No existe una función «facturador-correo».
export const reenviarCorreo = (id) => rpc('fx_reenviar_correo', { p_id: id });

// Frase para mostrar cuando algo falla. Los errores que vienen de la base ya llegan en español y con qué hacer (api.js los filtra); solo un error del propio navegador
// o de este código (TypeError, undefined...) no debe verse tal cual.
export const FRASE_GENERAL = 'Algo no salió bien. Intente de nuevo; si sigue igual, avise a la persona encargada.';
const TECNICO = /\b(typeerror|referenceerror|syntaxerror|undefined|null|failed to fetch|networkerror|load failed|permission denied|invalid input|duplicate key|could not find|schema cache|violates|jwt|pgrst)\b|\[object|is not a function|cannot read/i;
export function mensajeAmable(e, defecto = FRASE_GENERAL) {
  const m = String((e && e.message) ?? e ?? '').trim();
  return !m || TECNICO.test(m) ? defecto : m;
}

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
      if (!faltaFuncion(e) && !SIN_FUNCION.test(e.message || '')) throw e;
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
    mensaje: d.estado === 'rechazado' ? (traducirHacienda(d.mensaje).resumen || 'Hacienda no lo aceptó.') : (d.estado === 'error' ? 'No se pudo enviar a Hacienda. No se reenvía solo: abra «Anular y reimprimir» y toque «Reenviar a Hacienda».' : 'Todavía no llegó a Hacienda. El sistema lo intentará de nuevo solo.'),
  }));
  return { rechazados: rechazados.length, pendientes: pendientes.length, recepcion_por_responder: null, recepcion_vencen_pronto: null, ultimos, desde, fuente: 'reserva' };
}

/* ---------- Funciones nuevas de la ronda 2B (si la base todavía no las tiene, se avisa con palabras claras) ---------- */
// Marca un documento rechazado como atendido. La nota es opcional. Devuelve lo que responda la base ({ok, ...}).
export async function alertaAtender(comprobanteId, nota = '') {
  try {
    return await rpc('fx_alerta_atender', { p_comprobante: comprobanteId, p_nota: String(nota || '').trim().slice(0, 300) || null });
  } catch (e) {
    if (faltaFuncion(e)) throw new ErrorApi('Esta opción todavía no está activada. El aviso rojo seguirá hasta que se active.');
    throw e;
  }
}

// Crea una cuenta nueva con las mismas líneas de una venta anulada o rechazada. Devuelve { venta, lineas, ... } como fx_venta, o null si la función no existe todavía.
export async function ventaClonar(ventaId) {
  try {
    return await rpc('fx_venta_clonar', { p_venta: ventaId });
  } catch (e) {
    if (faltaFuncion(e)) return null;
    throw e;
  }
}

// Igual, pero la cuenta nueva queda con el cliente elegido (clienteId) o, si no se manda, con el cliente que tenía la venta original.
// Es lo que permite pasar de un tiquete a una factura a nombre del cliente. Si la función nueva no está, copia sin cliente y lo avisa con { sinCliente: true }.
export async function ventaClonarConCliente(ventaId, clienteId = null) {
  try {
    return await rpc('fx_venta_clonar_con_cliente', { p_venta: ventaId, p_cliente: clienteId || null });
  } catch (e) {
    if (!faltaFuncion(e)) throw e;
    const r = await ventaClonar(ventaId);
    return r && clienteId ? { ...r, sinCliente: true } : r;
  }
}

// Copia las líneas de una venta anulada o rechazada a una cuenta nueva (lo que hace «Hacer la venta de nuevo»). NUNCA navega: devuelve el resultado y la pantalla decide.
//   { ok: true, id, sinCliente }                        la cuenta nueva ya existe (id). sinCliente = se copió sin el cliente elegido, hay que elegirlo en Facturación.
//   { ok: false, motivo: 'ya_corregida', mensaje }      la base dice que esa venta ya se corrigió con otra venta: no hay nada que rehacer (el texto es el de la base, tal cual).
//   { ok: false, motivo: 'sin_funcion', mensaje }       la base todavía no tiene la copia automática: solo en ese caso hay que armar la venta a mano en Facturación.
//   { ok: false, motivo: 'red' | 'tiempo' | 'error', mensaje }  la copia falló: se dice lo que pasó y se puede intentar de nuevo (la base no duplica: si la cuenta ya se había creado, devuelve esa misma).
const YA_CORREGIDA = /ya se corrigi[oó] con/i;
export async function copiarVentaParaRehacer(ventaId, clienteId = null) {
  if (!ventaId) return { ok: false, motivo: 'error', mensaje: 'No se encontró la venta de este documento, así que no se pudo copiar. Ábrala desde Facturación.' };
  let nueva;
  try { nueva = await ventaClonarConCliente(ventaId, clienteId); }
  catch (e) {
    const m = String(e?.message || '');
    if (esRespuestaDeNegocio(e) && YA_CORREGIDA.test(m)) return { ok: false, motivo: 'ya_corregida', mensaje: m };
    if (e?.tipo === 'red') return { ok: false, motivo: 'red', mensaje: 'No hay conexión con internet. Revise la conexión e intente de nuevo; si la copia ya se había hecho, no se duplica.' };
    if (e?.tipo === 'tiempo' || e?.tipo === 'ocupado') return { ok: false, motivo: 'tiempo', mensaje: 'La respuesta tardó demasiado. Intente de nuevo; si la copia ya se había hecho, no se duplica.' };
    return { ok: false, motivo: 'error', mensaje: mensajeAmable(e) };
  }
  if (!nueva) return { ok: false, motivo: 'sin_funcion', mensaje: 'La copia automática de la venta todavía no está activada. En Facturación tendrá que armar la venta otra vez.' };
  const id = nueva?.venta?.id || nueva?.id || null;
  if (!id) return { ok: false, motivo: 'error', mensaje: 'La copia no devolvió la cuenta nueva. Intente de nuevo; si la copia ya se había hecho, no se duplica.' };
  return { ok: true, id, sinCliente: nueva.sinCliente === true };
}

// Deja anotada la cuenta nueva para que Facturación la abra (sessionStorage 'fx.caja.abrir' = id) y va a Facturación (app.ir('caja')).
export function abrirCuentaNueva(app, id, toast, sinCliente = false) {
  if (id) { try { sessionStorage.setItem('fx.caja.abrir', String(id)); } catch { /* sin almacenamiento: Facturación abre la cuenta sola si puede */ } }
  if (sinCliente) toast?.('La venta se copió, pero el cliente hay que elegirlo en Facturación.', 'error', 8000);
  app.ir('caja');
  return id || null;
}

// Versión de una sola llamada, para quien no necesita mostrar un reintento: copia y, solo si la copia salió bien, va a Facturación. Si falló NO navega: avisa con lo que dijo la base y devuelve null.
export async function hacerVentaDeNuevo(app, ventaId, toast, clienteId = null) {
  const r = await copiarVentaParaRehacer(ventaId, clienteId);
  if (!r.ok) { toast?.((r.motivo === 'ya_corregida' ? '' : 'No se pudo copiar la venta. ') + r.mensaje, 'error', 8000); return null; }
  return abrirCuentaNueva(app, r.id, toast, r.sinCliente);
}
