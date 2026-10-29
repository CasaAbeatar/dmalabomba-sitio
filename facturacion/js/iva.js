// Tarifas de IVA que se ofrecen al editar una línea de la cuenta (códigos de la nota 8.1 del anexo v4.4 de Hacienda).
// La lista oficial vive en la base (fact.tarifas_iva) y el servidor fija el porcentaje según el código; esta copia solo sirve
// para mostrar las opciones y calcular, solo para mostrar, el desglose de una línea.
// Los transitorios 05, 06 y 07 son únicamente para notas de crédito y débito: no se ofrecen en ventas.
export const TARIFAS_IVA = [
  { codigo: '08', pct: 13, nombre: 'General 13 %', frecuente: true },
  { codigo: '03', pct: 2, nombre: 'Reducida 2 %', frecuente: true },
  { codigo: '02', pct: 1, nombre: 'Reducida 1 %', frecuente: true },
  { codigo: '04', pct: 4, nombre: 'Reducida 4 %', frecuente: true },
  { codigo: '10', pct: 0, nombre: 'Exenta', frecuente: true },
  { codigo: '09', pct: 0.5, nombre: 'Reducida 0,5 %' },
  { codigo: '01', pct: 0, nombre: '0 % (Art. 32, num. 1, RLIVA)' },
  { codigo: '11', pct: 0, nombre: '0 % sin derecho a crédito' },
];
const POR_PCT = { 13: '08', 4: '04', 2: '03', 1: '02', 0.5: '09' };

// Tarifa de una línea: usa el código si lo trae; si no, lo deduce del porcentaje (como hace el XML). Con 0 % sin código no se sabe cuál es.
export function tarifaDeLinea(l) {
  const pct = Number(l?.tarifa_iva);
  const cod = l?.codigo_tarifa_iva || (Number.isFinite(pct) ? POR_PCT[pct] : null) || null;
  const t = TARIFAS_IVA.find((x) => x.codigo === cod);
  if (t) return t;
  return { codigo: '', pct: Number.isFinite(pct) ? pct : 13, nombre: (Number.isFinite(pct) ? String(pct).replace('.', ',') : '13') + ' %' };
}

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
// Precio final con IVA conservado; la base se calcula hacia atrás. Solo para mostrar (el servidor y el XML hacen su propio cálculo exacto).
export function desgloseIva(totalConIva, pct) {
  const total = r2(totalConIva);
  const base = r2(total / (1 + (Number(pct) || 0) / 100));
  return { base, iva: r2(total - base), total };
}
