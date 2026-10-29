// Orden del menú en la Caja: de la A a la Z (sin fijarse en tildes ni mayúsculas) y, al final, los adicionales.
// Rango 0: productos normales. Rango 1: los adicionales. Rango 2: lo último de todo (adicional extra, porciones extra y cualquier «extra»).
// Dentro de cada rango el orden es alfabético, así «Adicional extra» queda antes que «Porciones extra».
const sinTildes = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const alfabeto = new Intl.Collator('es', { sensitivity: 'base', numeric: true });

export function rangoMenu(nombre) {
  const n = sinTildes(nombre);
  if (/(^|[^a-z])extras?([^a-z]|$)/.test(n) || /^porcion(es)?([^a-z]|$)/.test(n)) return 2;
  if (/^adicional(es)?([^a-z]|$)/.test(n)) return 1;
  return 0;
}

// Devuelve una copia ordenada. nombreDe dice de dónde sale el nombre de cada elemento.
export function ordenarMenu(lista, nombreDe = (x) => x.nombre) {
  return lista
    .map((x) => { const nombre = String(nombreDe(x) ?? ''); return { x, nombre, rango: rangoMenu(nombre) }; })
    .sort((a, b) => (a.rango - b.rango) || alfabeto.compare(a.nombre, b.nombre))
    .map((e) => e.x);
}
