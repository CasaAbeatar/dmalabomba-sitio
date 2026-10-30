// Dirección de un cliente, en palabras. La usan la pantalla de Clientes, la Caja, los documentos que se imprimen y el detalle de un documento.
//
// Regla del dueño: la dirección de un cliente puede estar incompleta; un solo dato (provincia, cantón, distrito, barrio u otras señas) ya vale.
//  * En PANTALLA lo que falta se muestra como «Sin dato», con su rótulo («Cantón: Sin dato»). Un código guardado que no está en el catálogo oficial
//    se muestra igual que en la lista desplegable del formulario: «Código 99 (no está en la lista)».
//  * En la BASE nunca se guarda «Sin dato»: lo que falta queda vacío (NULL).
//  * En un DOCUMENTO (tiquete, factura, PDF) solo salen las partes que existen, separadas por comas y de la más específica a la más general,
//    como se escribe una dirección en Costa Rica y como sale la dirección de la empresa: otras señas, barrio, distrito, cantón y provincia
//    («Frente al parque, Pital, San Carlos, Alajuela»). Si no hay ninguna, no sale ni la línea. Nunca sale «Sin dato».
//    Un lugar que las señas ya dicen como palabra completa (sin mirar tildes ni mayúsculas), o que ya salió antes, no se repite
//    («Pital centro, frente al parque, San Carlos, Alajuela»; pero «Frente al Hospital, Pital, …»): es el MISMO criterio de la dirección de la empresa
//    (unirDireccion, que también usa js/imprimir.js).
//    Un código que no está en el catálogo no se imprime.
//    (La pantalla del formulario y del resumen NO cambia: sigue el orden de las listas, provincia, cantón, distrito, barrio y señas.)
//  * Cada parte se limpia igual en pantalla y en los documentos (limpiarParte): sin comas ni espacios sobrantes en los bordes.
// Los códigos de provincia, cantón y distrito se convierten en nombres SOLO con el catálogo oficial (js/data_ubicaciones.js). El mismo cálculo está
// en fn/pdf.ts (con fn/ubicaciones.ts, copia del catálogo) para que el PDF y el tiquete digan lo mismo; los casos de referencia de los dos están en
// fn/tests/direccion_vectores.json.
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
const BORDES = /^[\s,;.:-]+|[\s,;.:-]+$/g;
// Una parte de la dirección, limpia: en forma compuesta (NFC: una «í» guardada como «i» más la tilde suelta queda como una sola letra), los saltos de línea
// y los espacios repetidos como un solo espacio, y sin espacios ni signos «, ; . : -» al principio ni al final («Frente al parque,» -> «Frente al parque»).
// '' si no queda nada (o si decía «Sin dato»).
export function limpiarParte(v) {
  const t = String(v ?? '').normalize('NFC').replace(/\s+/g, ' ').replace(BORDES, '');
  return SIN.test(t) ? '' : t;
}

const MINUS = new Set(['a', 'al', 'de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'en', 'con', 'por', 'para']);
const sinTildes = (s) => s.normalize('NFD').replace(/\p{M}/gu, '');
// Sigla: de 2 a 4 letras mayúsculas sin vocales (JYJ, BCR, CCSS), sin contar los signos pegados («BCR)», «JYJ,»)
const esSigla = (w) => { const n = w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''); return /^\p{Lu}{2,4}$/u.test(n) && !/[AEIOU]/.test(sinTildes(n)); };
// Mayúsculas sostenidas se escriben normal: «CONTIGUO A SERVICENTRO JYJ (FRENTE AL BCR)» -> «Contiguo a Servicentro JYJ (Frente al BCR)».
// Mayúscula inicial por palabra (las cortas como «a», «de», «los» van en minúscula), las siglas sin vocales se quedan en mayúsculas y después de «(» va mayúscula.
// Si el texto ya trae minúsculas se respeta tal cual.
export function titulo(s) {
  if (!s || s !== s.toUpperCase()) return s;
  return s.split(' ').map((w, i) => {
    if (esSigla(w)) return w;
    const m = w.toLowerCase();
    return (i > 0 && MINUS.has(m)) ? m : m.charAt(0).toUpperCase() + m.slice(1);
  }).join(' ').replace(/\((\p{Ll})/gu, (_, l) => '(' + l.toUpperCase());
}

// Código de provincia (largo 1), cantón o distrito (largo 2): solo números, con su relleno de ceros; '' si falta o si son solo ceros.
export const codigoUbicacion = (v, largo) => { const d = String(v ?? '').replace(/\D/g, ''); return d && !/^0+$/.test(d) ? d.padStart(largo, '0').slice(-largo) : ''; };
// Cómo se ve en pantalla un código guardado que no está en el catálogo (lista desplegable y resumen dicen lo mismo)
export const fueraDeLista = (cod) => 'Código ' + cod + ' (no está en la lista)';
function catalogo(c) {
  const p = codigoUbicacion(c?.provincia, 1), k = codigoUbicacion(c?.canton, 2), d = codigoUbicacion(c?.distrito, 2);
  const P = UBICACIONES[p] || null;
  const K = P ? P[1][k] || null : null;
  const D = K ? K[1][d] || '' : '';
  return { p, k, d, provincia: P ? P[0] : '', canton: K ? K[0] : '', distrito: D };
}

// Los nombres de provincia, cantón y distrito según el catálogo; '' donde el código falta o no existe. El barrio y las señas salen limpios y con mayúsculas bien puestas.
export function nombresDireccion(c) {
  const n = catalogo(c);
  return { provincia: n.provincia, canton: n.canton, distrito: n.distrito, barrio: titulo(limpiarParte(c?.barrio)), otras_senas: titulo(limpiarParte(c?.otras_senas)) };
}

// Une una dirección para imprimir: primero las señas y después los lugares (de lo más específico a lo más general) que todavía no se hayan dicho.
// Un lugar se omite:
//  * si las señas ya lo dicen como palabra completa o secuencia de palabras completas (con algo que no sea letra ni número a cada lado), comparando sin tildes
//    ni mayúsculas: «Frente a Gasolinera JyJ Horquetas» y «Horquetas centro» ya dicen «Horquetas»; «Escuela de Sarapiqui» ya dice «Sarapiquí»;
//    «Frente al Hospital» NO dice «Pital» (es parte de otra palabra);
//  * o si ya salió antes en la misma dirección, comparado igual (barrio igual al distrito, distrito igual a la provincia: 2/01/01 sale «Alajuela, Central»).
// Lo usan la dirección de la EMPRESA (js/imprimir.js) y la del cliente (textoDireccion): si se cambia aquí, cambia en las dos. fn/pdf.ts hace lo mismo.
const plano = (s) => sinTildes(String(s ?? '')).toLowerCase().replace(/\s+/g, ' ').trim();
const comoPalabras = (k) => new RegExp('(^|[^\\p{L}\\p{N}])' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=$|[^\\p{L}\\p{N}])', 'u');
export function unirDireccion(senas, lugares) {
  const s = String(senas ?? '');
  const dicho = plano(s);
  const vistos = new Set();
  const resto = lugares.filter((l) => {
    const k = plano(l);
    if (!k || vistos.has(k) || comoPalabras(k).test(dicho)) return false;
    vistos.add(k); return true;
  });
  return [s, ...resto].filter(Boolean).join(', ');
}

// Para los DOCUMENTOS: solo lo que existe, de lo más específico a lo más general (señas, barrio, distrito, cantón, provincia), separado por comas, sin repetir lugares. '' si no hay nada.
export function textoDireccion(c) {
  const n = nombresDireccion(c);
  return unirDireccion(n.otras_senas, [n.barrio, n.distrito, n.canton, n.provincia]);
}

// Para la PANTALLA: las cinco partes con su rótulo; las que faltan llevan falta = true y valor «Sin dato»;
// un código que no está en el catálogo lleva fuera = true y valor «Código 99 (no está en la lista)», como en la lista desplegable.
export function partesParaPantalla(c) {
  const n = nombresDireccion(c), k = catalogo(c);
  const fuera = { provincia: !n.provincia && !!k.p, canton: !n.canton && !!k.k, distrito: !n.distrito && !!k.d };
  const valor = { ...n, provincia: n.provincia || (k.p ? fueraDeLista(k.p) : ''), canton: n.canton || (k.k ? fueraDeLista(k.k) : ''), distrito: n.distrito || (k.d ? fueraDeLista(k.d) : '') };
  return PARTES_DIRECCION.map(({ clave, etiqueta }) => ({ clave, etiqueta, valor: valor[clave] || SIN_DATO, falta: !valor[clave], fuera: !!fuera[clave] }));
}

// Hay dirección = algún código (aunque no esté en el catálogo) o algún texto que no quede vacío al limpiarlo
export const hayDireccion = (c) => { const k = catalogo(c); return !!(k.p || k.k || k.d || limpiarParte(c?.barrio) || limpiarParte(c?.otras_senas)); };
// Completa = lo que Hacienda necesita para ponerla en el XML del cliente: provincia, cantón y distrito que existan JUNTOS en el catálogo oficial
// y otras señas de 5 caracteres o más (contados como caracteres: un emoji o una «á» cuentan 1).
export const direccionCompleta = (c) => { const k = catalogo(c); return !!(k.provincia && k.canton && k.distrito) && [...limpiarParte(c?.otras_senas)].length >= 5; };
// 'sin' = no hay ningún dato; 'parcial' = hay algo pero no está completa; 'completa'
export const estadoDireccion = (c) => (!hayDireccion(c) ? 'sin' : direccionCompleta(c) ? 'completa' : 'parcial');
