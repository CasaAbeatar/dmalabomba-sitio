// Clave de comparación de nombres de producto: la MISMA regla que fact.inv_clave en la base (sql/inventarios/normalizacion_fusion.sql).
// Minúsculas, sin tildes, sin puntuación, espacios simples, «355ML» = «355 mL», «1,5 L» = «1.5L». Dos nombres con la misma clave son el MISMO producto:
// nunca se crea un alias entre ellos y nunca hay dos artículos activos así.
export const claveNombre = (p) => String(p ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()      // sin tildes (ñ, ü y las demás quedan como n, u)
  .replace(/([0-9])[.,]([0-9])/g, '$1d$2')                      // 1,5 y 1.5 -> 1d5 (no se confunde con 15)
  .replace(/([0-9])\s*(ml|lt|lts|l|gr|grs|g|kg|oz)\b/g, '$1 $2') // 355ml -> 355 ml
  .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

export const mismoProducto = (a, b) => { const x = claveNombre(a); return x !== '' && x === claveNombre(b); };

// ¿Decidir esta línea merece guardar un alias? Sí cuando el texto del proveedor es OTRA forma de nombrar el artículo y el sistema todavía no lo sabía.
// No cuando: no se pidió recordar, el artículo se lleva en colones, el texto solo difiere en mayúsculas/tildes/puntuación/espacios (es el mismo nombre),
// el texto es demasiado corto, o el sistema ya lo conocía por la memoria exacta, por un alias o por el nombre del artículo.
export function debeGuardarAlias({ detalle, articuloNombre, articuloId, unidad, recordar, sugerencia }) {
  if (!recordar || !articuloId || unidad === 'colon') return false;
  const c = claveNombre(detalle);
  if (c.length < 3 || c === claveNombre(articuloNombre)) return false;
  const s = sugerencia || {};
  if (['memoria', 'alias', 'nombre'].includes(s.fuente) && s.articulo_id === articuloId) return false;
  return true;
}
