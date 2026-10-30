// Dirección de un cliente, en palabras. La usan la pantalla de Clientes, la Caja, los documentos que se imprimen y el detalle de un documento.
//
// Regla del dueño: la dirección de un cliente puede estar incompleta; un solo dato (provincia, cantón, distrito, barrio u otras señas) ya vale.
//  * En PANTALLA lo que falta se muestra como «Sin dato», con su rótulo («Cantón: Sin dato»).
//  * En la BASE nunca se guarda «Sin dato»: lo que falta queda vacío (NULL).
//  * En un DOCUMENTO (tiquete, factura, PDF) solo salen las partes que existen, separadas por comas y de la más específica a la más general,
//    como se escribe una dirección en Costa Rica y como sale la dirección de la empresa: otras señas, barrio, distrito, cantón y provincia
//    («Frente al parque, Pital, San Carlos, Alajuela»). Si no hay ninguna, no sale ni la línea. Nunca sale «Sin dato».
//    (La pantalla del formulario y del resumen NO cambia: sigue el orden de las listas, provincia, cantón, distrito, barrio y señas.)
// Los códigos de provincia, cantón y distrito se convierten en nombres SOLO con el catálogo oficial (js/data_ubicaciones.js). El mismo cálculo está
// en fn/pdf.ts (con fn/ubicaciones.ts, copia del catálogo) para que el PDF y el tiquete digan lo mismo.
import { UBICACIONES } from './data_ubicaciones.js';

export const SIN_DATO = 'Sin dato';
export const PARTES_DIRECCION = [
  { clave: 'provincia', etiqueta: 'Provincia' },
  { clave: 'canton', etiqueta: 'Cantón' },
  { clave: 'distrito', etiqueta: 'Distrito' },
  { clave: 'barrio', etiqueta: 'Barrio' },
  { clave: 'otras_senas', etiqueta: 'Otras señas' },
];

const SIN = /^\s*sin\s+datos?\s*\.?\s*$/i; // por si algún dato viejo trae el texto «Sin dato»: se trata como vacío
const limpiar = (v) => { const t = String(v ?? '').replace(/\s+/g, ' ').trim(); return SIN.test(t) ? '' : t; };
const MINUS = new Set(['a', 'al', 'de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'en', 'con', 'por', 'para']);
const titulo = (s) => { // "CONTIGUO A SERVICENTRO" -> "Contiguo a Servicentro"; si ya trae minúsculas se respeta
  if (!s || s !== s.toUpperCase()) return s;
  return s.toLowerCase().split(/\s+/).map((w, i) => (i > 0 && MINUS.has(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
};
const codigo = (v, largo) => { const d = String(v ?? '').replace(/\D/g, ''); return d && !/^0+$/.test(d) ? d.padStart(largo, '0').slice(-largo) : ''; };

// Los nombres de provincia, cantón y distrito según el catálogo; '' donde el código falta o no existe. El barrio y las señas salen tal cual (con mayúsculas bien puestas).
export function nombresDireccion(c) {
  const p = UBICACIONES[codigo(c?.provincia, 1)] || null;
  const k = p ? p[1][codigo(c?.canton, 2)] || null : null;
  const d = k ? k[1][codigo(c?.distrito, 2)] || '' : '';
  return { provincia: p ? p[0] : '', canton: k ? k[0] : '', distrito: d, barrio: titulo(limpiar(c?.barrio)), otras_senas: titulo(limpiar(c?.otras_senas)) };
}

// Para los DOCUMENTOS: solo lo que existe, de lo más específico a lo más general (señas, barrio, distrito, cantón, provincia), separado por comas. '' si no hay nada. Si el barrio se llama igual que el distrito sale una sola vez.
export function textoDireccion(c) {
  const n = nombresDireccion(c);
  return [...PARTES_DIRECCION].reverse() // el orden de las listas (provincia primero) se invierte: las señas van primero
    .filter(({ clave }) => n[clave] && !(clave === 'barrio' && n.barrio.toLowerCase() === n.distrito.toLowerCase()))
    .map(({ clave }) => n[clave]).join(', ');
}

// Para la PANTALLA: las cinco partes con su rótulo; las que faltan llevan falta = true y valor «Sin dato».
export function partesParaPantalla(c) {
  const n = nombresDireccion(c);
  return PARTES_DIRECCION.map(({ clave, etiqueta }) => ({ clave, etiqueta, valor: n[clave] || SIN_DATO, falta: !n[clave] }));
}

export const hayDireccion = (c) => PARTES_DIRECCION.some(({ clave }) => limpiar(c?.[clave]) !== '');
// Completa = lo que Hacienda necesita para ponerla en el XML del cliente: provincia, cantón y distrito en código y otras señas de 5 letras o más
export const direccionCompleta = (c) => !!(codigo(c?.provincia, 1) && codigo(c?.canton, 2) && codigo(c?.distrito, 2) && limpiar(c?.otras_senas).length >= 5);
// 'sin' = no hay ningún dato; 'parcial' = hay algo pero no está completa; 'completa'
export const estadoDireccion = (c) => (!hayDireccion(c) ? 'sin' : direccionCompleta(c) ? 'completa' : 'parcial');
