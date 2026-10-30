// Acceso a datos de los respaldos (solo administradores). Todo pasa por funciones fx_* con el rpc() de api.js, que no se toca.
// Las mismas cifras salen en fx_alertas (llave `respaldo`) y en fx_respaldo_alertas_resumen(): las dos devuelven fact.respaldo_resumen().
// El encabezado usa fx_respaldo_alertas_resumen porque api_documentos.js (alertas()) arma un objeto nuevo con las llaves que conoce y deja afuera `respaldo`.
import { rpc } from './api.js';

export const respaldos = {
  // { problemas, urgente, mensaje, ultimo_respaldo, ultimo_respaldo_xml, ultima_prueba:{fecha, ok}|null, alertas:[{id|null, motivo, mensaje, desde, ultima_vez, veces, urgente}] }
  // Para un usuario que no es administrador contesta null.
  resumen: () => rpc('fx_respaldo_alertas_resumen'),
  // { resumen, tareas[], corridas[], pruebas:[{id, fecha, tipo, ok, archivo}], xml:{archivos, bytes, partes_onedrive_pendientes} } (solo administradores)
  estado: () => rpc('fx_respaldo_estado'),
  // Marca un aviso como atendido (queda en la auditoría). Los avisos «virtuales» (id null: atrasos) no se marcan: se quitan solos cuando la copia sale bien.
  atender: (id, nota = null) => rpc('fx_respaldo_alerta_atender', { p_id: id, p_nota: nota }),
};

const aFecha = (x) => { if (!x) return null; const t = new Date(x); return Number.isNaN(t.getTime()) ? null : x; };

// Deja el resumen en una forma segura para pintar: números enteros, textos como texto, listas como listas. Un dato raro se ignora en vez de romper la pantalla.
export function normalizarRespaldo(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  const alertas = (Array.isArray(r.alertas) ? r.alertas : []).filter((a) => a && typeof a === 'object').map((a) => ({
    id: a.id != null && Number.isFinite(Number(a.id)) ? Number(a.id) : null,
    motivo: String(a.motivo ?? ''), mensaje: String(a.mensaje ?? ''),
    desde: aFecha(a.desde), ultima_vez: aFecha(a.ultima_vez),
    veces: Math.max(1, Math.floor(Number(a.veces)) || 1), urgente: a.urgente === true,
  }));
  const n = Number(r.problemas);
  const problemas = Number.isFinite(n) && n >= 0 ? Math.floor(n) : alertas.length;
  const p = r.ultima_prueba && typeof r.ultima_prueba === 'object' ? r.ultima_prueba : null;
  return {
    problemas: Math.max(problemas, alertas.length),
    urgente: r.urgente === true || alertas.some((a) => a.urgente),
    mensaje: String(r.mensaje ?? alertas[0]?.mensaje ?? ''),
    ultimo_respaldo: aFecha(r.ultimo_respaldo), ultimo_respaldo_xml: aFecha(r.ultimo_respaldo_xml),
    ultima_prueba: p && aFecha(p.fecha) ? { fecha: p.fecha, ok: p.ok === true } : null,
    alertas,
  };
}

// «hace 5 minutos», «hace 3 horas», «hace 2 días» (para que se entienda de un vistazo cuánto lleva sin hacerse)
export function haceCuanto(fecha, ahora = Date.now()) {
  const t = new Date(fecha).getTime();
  if (!Number.isFinite(t)) return '';
  const min = Math.max(0, Math.round((ahora - t) / 60000));
  if (min < 2) return 'hace un momento';
  if (min < 60) return 'hace ' + min + ' minutos';
  const hh = Math.round(min / 60);
  if (hh < 48) return 'hace ' + hh + (hh === 1 ? ' hora' : ' horas');
  const d = Math.round(hh / 24);
  return 'hace ' + d + ' días';
}
