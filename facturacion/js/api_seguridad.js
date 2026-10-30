// Acceso a datos de la seguridad del ingreso (solo administradores): avisos por muchos intentos fallidos de PIN. Pasa por el rpc() de api.js, que no se toca.
// Aparatos de confianza: hoy la base NO tiene una función que un administrador pueda llamar para ver o revocar aparatos (fxs_aparato_* son solo del servicio de acceso),
// y el aviso no trae el aparato ni la dirección de red. Por eso esta pantalla no los muestra: ver el informe.
import { rpc } from './api.js';

export const seguridad = {
  // { pendientes (número de avisos sin atender), ultimas:[{ id, tipo:'usuario_fallos'|'total_fallos'|'acierto_tras_fallos', usuario, creada_en, detalle, atendida, mensaje }] } (hasta 20, el más nuevo primero)
  alertas: () => rpc('fx_login_alertas'),
  // Marca un aviso como atendido. nota: hasta 300 letras (opcional). Idempotente.
  atender: (id, nota = null) => rpc('fx_login_alerta_atender', { p_id: id, p_nota: nota }),
};

// Deja la respuesta en una forma segura para pintar
export function normalizarSeguridad(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  const ultimas = (Array.isArray(r.ultimas) ? r.ultimas : []).filter((a) => a && typeof a === 'object' && a.id != null).map((a) => ({
    id: Number(a.id), tipo: String(a.tipo ?? ''), usuario: a.usuario == null ? '' : String(a.usuario),
    creada_en: a.creada_en || null, detalle: a.detalle && typeof a.detalle === 'object' ? a.detalle : {}, atendida: a.atendida === true, mensaje: String(a.mensaje ?? ''),
  }));
  const n = Number(r.pendientes);
  return { pendientes: Number.isFinite(n) && n >= 0 ? Math.floor(n) : ultimas.filter((a) => !a.atendida).length, ultimas };
}
