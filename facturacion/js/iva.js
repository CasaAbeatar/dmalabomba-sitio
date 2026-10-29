// Tarifas de IVA que se ofrecen al editar un producto de la cuenta (códigos de la nota 8.1 del anexo v4.4 de Hacienda).
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

/* ---------- Tarifa de IVA habitual de un cliente (contrato 1: llave tarifa_habitual_codigo) ----------
   Códigos de Hacienda v4.4 que se pueden usar en una venta. Los códigos 05, 06 y 07 son solo para notas de crédito y débito: no se ofrecen.
   "texto" es lo que se lee en la ficha del cliente; "frase" completa la oración "Este cliente normalmente ..." en la caja;
   "boton" es lo que dice el botón grande de la caja. El 08 (13 %) equivale a "Ninguna": no se ofrece como opción aparte. */
export const TARIFAS_CLIENTE = [
  { codigo: '', pct: 13, texto: 'Ninguna', ayuda: 'Paga el IVA normal de 13 % (o el que tenga cada producto).' },
  { codigo: '03', pct: 2, texto: 'IVA reducido 2 % (universidades)', ayuda: 'Universidades públicas y entidades que la ley cubre con la tarifa de 2 %. No es una exoneración.', frase: 'paga IVA reducido del 2 %', boton: 'Aplicar 2 % a todos los productos' },
  { codigo: '04', pct: 4, texto: 'IVA reducido 4 %', ayuda: 'Por ejemplo boletos aéreos y salud privada.', frase: 'paga IVA reducido del 4 %', boton: 'Aplicar 4 % a todos los productos' },
  { codigo: '02', pct: 1, texto: 'IVA reducido 1 %', ayuda: 'Canasta básica.', frase: 'paga IVA reducido del 1 %', boton: 'Aplicar 1 % a todos los productos' },
  { codigo: '09', pct: 0.5, texto: 'IVA reducido 0,5 %', ayuda: 'Productos agropecuarios orgánicos.', frase: 'paga IVA reducido del 0,5 %', boton: 'Aplicar 0,5 % a todos los productos' },
  { codigo: '10', pct: 0, texto: 'Exento de IVA', ayuda: 'La ley lo exime del impuesto (Ley 9635, artículo 8).', frase: 'está exento de IVA', boton: 'Aplicar «exento» a todos los productos' },
  { codigo: '01', pct: 0, texto: '0 % (CCSS y municipalidades)', ayuda: 'Tarifa 0 % con derecho a crédito: ventas a la CCSS o a una municipalidad, entre otras operaciones del artículo 32, numeral 1, del reglamento.', frase: 'paga 0 % de IVA con derecho a crédito (por ejemplo la CCSS o una municipalidad)', boton: 'Aplicar 0 % a todos los productos' },
  { codigo: '11', pct: 0, texto: '0 % sin derecho a crédito', ayuda: 'Bien o servicio no sujeto que no da derecho a crédito fiscal.', frase: 'paga 0 % de IVA sin derecho a crédito', boton: 'Aplicar 0 % sin derecho a crédito a todos los productos' },
];
// Códigos que sí significan "una tarifa distinta de la normal" (el 08 y vacío no avisan nada)
export function tarifaHabitual(cliente) {
  const cod = String(cliente?.tarifa_habitual_codigo ?? '').trim();
  if (!cod || cod === '08') return null;
  return TARIFAS_CLIENTE.find((t) => t.codigo === cod) || null;
}
// ¿La base ya devuelve la llave? (null = no se sabe todavía; true/false = se sabe por esta fila de cliente)
export const clienteTraeTarifa = (c) => (c && typeof c === 'object' ? 'tarifa_habitual_codigo' in c : null);
