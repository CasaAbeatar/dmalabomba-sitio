// SINPE en la caja (27 nov 2026): lógica pura, sin pantalla ni red, para poder probarla con node.
// Todo lo de aquí solo INFORMA a la cajera. Decisión 18 nov: cobrar y cerrar nunca dependen de SINPE.
// Sin devoluciones, sobrantes ni propinas (Emil, 27 nov): no hay nada de eso aquí.
const TZ = 'America/Costa_Rica';
const diaCR = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(d));
const horaCR = (d) => new Intl.DateTimeFormat('es-CR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(d));
const nf0 = new Intl.NumberFormat('es-CR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const colones = (n) => { const v = Math.round((Number(n) || 0) * 100) / 100; return '₡' + (Number.isInteger(v) ? nf0 : nf2).format(v); };

/* ---------- 1. Indicador «el teléfono de SINPE está conectado» ---------- */
export const ALERTA_LATIDO_MIN = 30; // igual que fact.sinpe_vigilancia_config.latido_alerta_min
export function textoDuracion(min) {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return m + (m === 1 ? ' minuto' : ' minutos');
  const h = Math.floor(m / 60);
  if (h < 48) return h + (h === 1 ? ' hora' : ' horas');
  const d = Math.floor(h / 24);
  return d + ' días';
}
// r = respuesta de fx_sinpe_lista (ahora, ultimo_latido). La edad se mide contra el reloj del servidor (no el de la computadora).
// nivel: 'ok' (el teléfono dio señal hace poco) | 'atraso' (más de 30 min sin señal) | 'sin' (el sistema nunca ha sabido de un teléfono)
export function indicadorTelefono(r, limiteMin = ALERTA_LATIDO_MIN) {
  if (!r || typeof r !== 'object') return null;
  const lat = r.ultimo_latido ? new Date(r.ultimo_latido).getTime() : NaN;
  if (!Number.isFinite(lat)) return { nivel: 'sin', minutos: null, texto: 'No hay señal del teléfono de SINPE. Los SINPE podrían no aparecer aquí; el cobro sigue igual.' };
  const ahora = r.ahora ? new Date(r.ahora).getTime() : Date.now();
  const min = Math.max(0, (ahora - lat) / 60000);
  if (min <= limiteMin) return { nivel: 'ok', minutos: Math.floor(min), texto: 'Teléfono de SINPE conectado' };
  return { nivel: 'atraso', minutos: Math.floor(min), texto: 'El teléfono de SINPE no da señal desde hace ' + textoDuracion(min) + '. Los SINPE podrían no aparecer aquí; el cobro sigue igual.' };
}

/* ---------- 2. Monto exacto ---------- */
// Un SINPE de hoy, todavía sin usar, cuyo monto es igual al total del cobro: se resalta para que la cajera lo encuentre sin buscar.
export function esExacto(p, total, usado = false, ahora = Date.now()) {
  const t = Math.round((Number(total) || 0) * 100), m = Math.round((Number(p?.monto) || 0) * 100);
  if (!(t > 0) || t !== m || usado) return false;
  try { return diaCR(p.hora) === diaCR(ahora); } catch { return false; }
}

/* ---------- 3 y 4. Revisión del comprobante (respuesta de fx_sinpe_ref_revisar) ---------- */
// Devuelve una lista de { tono: 'aviso' | 'info' | 'ok', texto }. Nunca bloquea: solo informa.
export function revisarComprobante(res, { total = 0, ahora = Date.now() } = {}) {
  if (!res || typeof res !== 'object' || res.activa === false || res.vacio) return [];
  const out = [];
  if (res.repetido) out.push({ tono: 'aviso', texto: 'Este comprobante ya se usó en la venta ' + (res.repetido_venta || 'anterior') + '. Revise que no sea el mismo SINPE cobrado dos veces.' });
  if (res.encontrado) {
    if (res.otra_empresa) {
      out.push({ tono: 'aviso', texto: 'Este comprobante es de un SINPE recibido en la otra empresa, no en esta. Revise que sea el de esta venta.' });
    } else if (res.pago) {
      const dias = Number(res.dias_antes) || 0;
      const monto = Number(res.pago.monto) || 0;
      if (dias >= 1) out.push({ tono: 'aviso', texto: 'Ese SINPE se recibió ' + (dias === 1 ? 'ayer' : 'hace ' + dias + ' días') + ', no hoy. Revise que sea el de este cliente.' });
      else out.push({ tono: 'ok', texto: 'Es un SINPE recibido hoy a las ' + horaCR(res.pago.hora) + ' por ' + colones(monto) + '.' });
      if (Number(total) > 0 && Math.round(monto * 100) !== Math.round(Number(total) * 100)) out.push({ tono: 'info', texto: 'El SINPE es de ' + colones(monto) + ' y el cobro es de ' + colones(total) + '. Es solo informativo: el cobro no se detiene.' });
    }
  } else {
    out.push({ tono: 'info', texto: 'Ese comprobante no aparece entre los SINPE recibidos. Puede que el aviso del banco todavía no haya llegado. El cobro sigue igual.' });
  }
  return out;
}
// ¿Vale la pena preguntarle a la base? (comprobantes del BCR: 8 o más caracteres; se acepta desde 4 para no perder formatos cortos)
export const refConsultable = (t) => String(t ?? '').replace(/[^A-Za-z0-9]/g, '').length >= 4;

/* ---------- 5. Pantalla del cliente: «Pago recibido ₡X» con el nombre del pagador ---------- */
// Emil (27 nov 2026): con nombre. Solo después de que el SINPE esté ligado a ESA venta (la cajera lo escogió en el cobro).
export function nombreParaCliente(t) {
  const s = String(t ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  const bonito = s.toLocaleLowerCase('es').replace(/(^|[\s'’-])(\p{L})/gu, (_, a, b) => a + b.toLocaleUpperCase('es'));
  return bonito.slice(0, 60);
}
// p = SINPE escogido (fila de fx_sinpe_lista). Devuelve { nombre, monto } o null si no hay un SINPE de monto válido.
export function datosParaPantalla(p) {
  if (!p || typeof p !== 'object') return null;
  const monto = Math.round((Number(p.monto) || 0) * 100) / 100;
  if (!(monto > 0) || !Number.isFinite(monto)) return null;
  return { nombre: nombreParaCliente(p.pagador), monto };
}
// Lo que la pantalla del cliente acepta (la ventana del cliente vuelve a limpiarlo por su lado)
export function sinpeSeguro(s) {
  if (!s || typeof s !== 'object') return null;
  const monto = Math.round((Number(s.monto) || 0) * 100) / 100;
  if (!(monto > 0) || !Number.isFinite(monto) || monto > 100000000) return null;
  return { nombre: nombreParaCliente(s.nombre), monto };
}
