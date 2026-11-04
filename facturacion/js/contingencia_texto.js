// Ayudas puras de la pantalla de contingencia (sin red), para poder probarlas con node.
// «2026-10-29T12:25» escrito en hora de Costa Rica (UTC-6, sin horario de verano) -> instante ISO
export function fechaProvisionalISO(local) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(local || ''));
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00-06:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
export const numeroProvisionalValido = (n) => /^[A-Za-z0-9-]{1,20}$/.test(String(n || '').trim());
