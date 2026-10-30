// Acceso a datos de la seguridad del ingreso (solo administradores): avisos por muchos intentos fallidos de PIN y aparatos de confianza. Pasa por el rpc() de api.js, que no se toca.
// Aparatos de confianza: fx_login_aparatos (lista, de la empresa de la sesión) y fx_login_aparato_revocar (quitar la confianza a uno). Quitar la confianza NO cierra la sesión que ese aparato
// tenga abierta: para cortar el acceso a una persona hay que reiniciar su PIN o desactivarla (Usuarios).
import { rpc } from './api.js';

export const seguridad = {
  // { pendientes (número de avisos sin atender), ultimas:[{ id, tipo:'usuario_fallos'|'total_fallos'|'acierto_tras_fallos', usuario, creada_en, detalle, atendida, mensaje,
  //   ip (red resumida), ips ([{ ip, fallos }]), ip_conocida (true | false | null), aparato ({ estado: 'nuevo' | 'conocido', etiqueta } | null) }] } (hasta 20, el más nuevo primero)
  alertas: () => rpc('fx_login_alertas'),
  // Marca un aviso como atendido. nota: hasta 300 letras (opcional). Idempotente.
  atender: (id, nota = null) => rpc('fx_login_alerta_atender', { p_id: id, p_nota: nota }),
  // { aparatos:[{ id, usuario_id, usuario, nombre, etiqueta, desde, ultimo_uso, vence_en, activo, revocado_en, ip_resumen }], activos, mostrados }.
  // usuario (id) deja solo los de una persona; todos = true suma los que ya no valen (quitados o vencidos). Hasta 300.
  aparatos: (usuario = null, todos = false) => rpc('fx_login_aparatos', { p_usuario: usuario || null, p_todos: !!todos }),
  // Quita la confianza a un aparato. motivo: de 3 a 200 letras (obligatorio; queda en la bitácora). Devuelve { ok, id, usuario, etiqueta, ya_estaba_revocado, revocado_en }. Idempotente.
  quitarAparato: (id, motivo) => rpc('fx_login_aparato_revocar', { p_id: id, p_motivo: motivo }),
};

const texto = (x) => (x == null ? '' : String(x));
// Redes de un aviso: [{ ip: '190.12.x.x', fallos: 6 }]. Acepta también un texto suelto por red. «sin dato» se deja como viene (la pantalla lo dice en palabras).
const redesDe = (r) => (Array.isArray(r) ? r : []).map((x) => (x && typeof x === 'object'
  ? { ip: texto(x.ip).trim(), fallos: Number.isFinite(Number(x.fallos ?? x.n)) && Number(x.fallos ?? x.n) > 0 ? Math.floor(Number(x.fallos ?? x.n)) : 0 }
  : { ip: texto(x).trim(), fallos: 0 })).filter((x) => x.ip).slice(0, 3);
const aparatoDe = (a) => (a && typeof a === 'object' && /^(nuevo|conocido)$/.test(texto(a.estado)) ? { estado: texto(a.estado), etiqueta: texto(a.etiqueta).trim().slice(0, 60) } : null);

// Deja la respuesta en una forma segura para pintar
export function normalizarSeguridad(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  const ultimas = (Array.isArray(r.ultimas) ? r.ultimas : []).filter((a) => a && typeof a === 'object' && a.id != null).map((a) => ({
    id: Number(a.id), tipo: String(a.tipo ?? ''), usuario: a.usuario == null ? '' : String(a.usuario),
    creada_en: a.creada_en || null, detalle: a.detalle && typeof a.detalle === 'object' ? a.detalle : {}, atendida: a.atendida === true, mensaje: String(a.mensaje ?? ''),
    ip: texto(a.ip).trim(), ips: redesDe(a.ips), ip_conocida: typeof a.ip_conocida === 'boolean' ? a.ip_conocida : null, aparato: aparatoDe(a.aparato),
  }));
  const n = Number(r.pendientes);
  return { pendientes: Number.isFinite(n) && n >= 0 ? Math.floor(n) : ultimas.filter((a) => !a.atendida).length, ultimas };
}

// Deja la lista de aparatos en una forma segura para pintar. null si no es un objeto.
export function normalizarAparatos(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  const aparatos = (Array.isArray(r.aparatos) ? r.aparatos : []).filter((a) => a && typeof a === 'object' && a.id != null).map((a) => ({
    id: Number(a.id), usuario_id: texto(a.usuario_id), usuario: texto(a.usuario), nombre: texto(a.nombre).trim(), etiqueta: texto(a.etiqueta).trim().slice(0, 60),
    desde: a.desde || null, ultimo_uso: a.ultimo_uso || null, vence_en: a.vence_en || null, activo: a.activo === true, revocado_en: a.revocado_en || null, ip_resumen: texto(a.ip_resumen).trim(),
  })).filter((a) => Number.isFinite(a.id));
  const n = Number(r.activos);
  return { aparatos, activos: Number.isFinite(n) && n >= 0 ? Math.floor(n) : aparatos.filter((a) => a.activo).length };
}
