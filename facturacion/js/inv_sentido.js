// Sentido comercial de una línea de factura de proveedor: ¿el costo por unidad que sale de la conversión tiene sentido para ese producto?
// El nombre puede decir «8U» y aun así la factura cobrar cada unidad suelta (o cobrar el paquete). Lo que lo decide es el precio por litro.
// Solo ayuda a revisar: nunca cambia nada sin que se vea, y la persona siempre puede escribir la conversión que sabe que es.

// Litros que trae UNA unidad según el nombre: «1.5L» -> 1.5, «600 ML» -> 0.6, «3L» -> 3. null si no dice.
export function litrosDe(desc) {
  const m = /(?:^|[^\d.,])(\d{1,4}(?:[.,]\d{1,3})?)\s*(ml|cc|lts?|litros?|l)\b/i.exec(String(desc || ''));
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  if (!(n > 0)) return null;
  const litros = /^(ml|cc)$/i.test(m[2]) ? n / 1000 : n;
  return litros >= 0.05 && litros <= 30 ? litros : null;
}

// Lo que se paga por litro de bebida sin IVA en Costa Rica al por mayor: muy por debajo de ₡150 o muy por encima de ₡6 000 no es creíble
export const BANDA_POR_LITRO = { min: 150, max: 6000 };

// subtotal: lo que cuesta la línea sin IVA; cantidad: lo que dice la factura; factor: unidades que trae cada una según la conversión
export function porLitro({ descripcion, subtotal, cantidad, factor }) {
  const l = litrosDe(descripcion);
  const unidades = Number(cantidad) * Number(factor);
  if (!l || !(unidades > 0) || !(Number(subtotal) > 0)) return null;
  const porUnidad = Number(subtotal) / unidades;
  return { litros: l, porUnidad, porLitro: porUnidad / l };
}
const creible = (x) => !!x && x.porLitro >= BANDA_POR_LITRO.min && x.porLitro <= BANDA_POR_LITRO.max;

// Devuelve { factor, aviso }: el factor con el que conviene empezar (el que dice el nombre si tiene sentido; si no, 1) y un texto si hay algo que revisar.
// fmt(n) formatea colones.
export function revisarConversion({ descripcion, subtotal, cantidad, factorNombre, factorActual }, fmt = (n) => '₡' + n.toFixed(2)) {
  const actual = Number(factorActual ?? factorNombre ?? 1);
  const a = porLitro({ descripcion, subtotal, cantidad, factor: actual });
  if (!a || creible(a)) return { factor: actual, aviso: '' };
  const uno = actual !== 1 ? porLitro({ descripcion, subtotal, cantidad, factor: 1 }) : null;
  const dicho = (x) => fmt(x.porUnidad) + ' por unidad (' + fmt(x.porLitro) + ' por litro)';
  const razon = a.porLitro < BANDA_POR_LITRO.min ? 'muy por debajo' : 'muy por encima';
  if (uno && creible(uno)) {
    return { factor: 1, cambiado: true, aviso: 'El nombre dice ' + actual + ' unidades por paquete, pero con ' + actual + ' cada unidad saldría a ' + dicho(a) + ', ' + razon + ' de lo normal en bebidas. '
      + 'Con 1 queda en ' + dicho(uno) + ', que sí tiene sentido: la factura parece cobrar cada unidad suelta. Se dejó 1; si llegaron paquetes completos y se cobraron por paquete, escriba ' + actual + '.' };
  }
  return { factor: actual, aviso: 'Con esta conversión cada unidad sale a ' + dicho(a) + ', ' + razon + ' de lo normal en bebidas (entre ' + fmt(BANDA_POR_LITRO.min) + ' y ' + fmt(BANDA_POR_LITRO.max) + ' por litro). Revise cuántas unidades trae cada una de la factura.' };
}

// Algunos proveedores (por ejemplo de carnes) escriben «Unid» aunque venden por peso: si la cantidad trae decimales y la unidad es de conteo, es peso (kg).
// Devuelve la unidad que se debe mostrar y usar: { unidad, corregida }.
export function unidadReal(cantidad, unidad) {
  const u = String(unidad || '').trim().toLowerCase().replace(/\./g, '');
  const conteo = ['', 'unid', 'und', 'un', 'unidad', 'unidades', '1', 'sp'].includes(u);
  const n = Number(cantidad);
  const fraccion = Number.isFinite(n) && Math.abs(n - Math.round(n)) > 0.0005;
  return conteo && fraccion ? { unidad: 'kg', corregida: true, original: String(unidad || 'Unid') } : { unidad: unidad || '', corregida: false, original: String(unidad || '') };
}
