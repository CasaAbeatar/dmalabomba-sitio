// Acceso a datos de las alertas de Hacienda (solo administradores). Todo pasa por funciones fx_* con el rpc() de api.js, que no se toca.
// La base devuelve null (resumen) o un error (lista y atención) a quien no es administrador: una cajera no ve ni recibe nada.
import { rpc } from './api.js';

export const alertasHacienda = {
  // { abiertas, urgentes, mensaje } o null si no es administrador
  resumen: () => rpc('fx_alertas_hacienda_resumen'),
  // estado: 'abiertas' | 'atendidas' (últimos 30 días). { abiertas, items[] }
  lista: (estado = 'abiertas') => rpc('fx_alertas_hacienda', { p_estado: estado, p_limite: 100 }),
  // La nota es obligatoria; queda en la auditoría con quién y cuándo
  atender: (id, nota) => rpc('fx_alerta_hacienda_atender', { p_id: id, p_nota: nota }),
};

const aNum = (x) => { const n = Math.floor(Number(x)); return Number.isFinite(n) && n > 0 ? n : 0; };

// Deja el resumen en una forma segura para pintar
export function normalizarAlertasHacienda(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  return { abiertas: aNum(r.abiertas), urgentes: aNum(r.urgentes), mensaje: String(r.mensaje ?? '') };
}
