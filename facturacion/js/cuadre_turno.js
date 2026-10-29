// Cifras para que la cajera pueda cuadrar «Anular y reimprimir» con «Apertura y cierre de caja».
//
// Las dos pantallas cuentan cosas parecidas, pero no iguales, y las dos tienen razón en lo suyo:
//   - «Apertura y cierre de caja» cuenta VENTAS COBRADAS en la caja (de ahí sale el efectivo que debe haber). Una venta cuyo documento Hacienda
//     no aceptó sí cuenta, porque la plata se cobró. Un documento que no salió de una cuenta cobrada en la caja no cuenta, porque no entró plata por la caja.
//   - «Anular y reimprimir» cuenta DOCUMENTOS que sirven ante Hacienda: no suma los que Hacienda no aceptó y sí suma los que no tienen cuenta de caja.
// Por eso las dos pantallas dicen en palabras simples qué hay de diferencia, con los mismos montos y las mismas frases.
import { money } from './util.js';

const centimos = (n) => Math.round((Number(n) || 0) * 100);
const esVenta = (d) => d.tipo_doc === '01' || d.tipo_doc === '04';
const plural = (n, uno, varios) => n + ' ' + (n === 1 ? uno : varios);

// Documentos de un turno: los emitidos desde que se abrió la caja, lo más reciente primero
export function docsDelTurno(lista, abiertoEn) {
  const desde = new Date(abiertoEn).getTime();
  return (lista || []).filter((d) => new Date(d.fecha_emision).getTime() >= desde).sort((a, b) => new Date(b.fecha_emision) - new Date(a.fecha_emision));
}

// Lo que suma una lista de documentos (montos en céntimos para que no haya errores de redondeo). Un documento rechazado no existe para Hacienda: no suma.
// Las notas de crédito restan (anulaciones, devoluciones y correcciones de monto) y las notas de débito suman: así el total coincide con total_ventas_netas de «Apertura y cierre de caja».
// nAnul y nDev separan las anulaciones totales (código 01, o sin código) de las devoluciones y correcciones; si la lista no trae el código, todas cuentan como anulaciones, como antes.
const esAnulacion = (d) => ['01', '13'].includes(String(d.codigo_referencia || '01'));
export function sumarDocumentos(lista) {
  const s = { ventas: 0, anul: 0, deb: 0, iva: 0, nVentas: 0, nNC: 0, nAnul: 0, nDev: 0, nND: 0, rechN: 0, rech: 0, ncRechN: 0, ncRech: 0, ndRechN: 0, ndRech: 0, sinN: 0, sin: 0 };
  for (const d of lista || []) {
    if (d.estado === 'rechazado') {
      if (d.tipo_doc === '03') { s.ncRechN++; s.ncRech += centimos(d.total); } else if (d.tipo_doc === '02') { s.ndRechN++; s.ndRech += centimos(d.total); } else if (esVenta(d)) { s.rechN++; s.rech += centimos(d.total); }
      continue;
    }
    if (d.tipo_doc === '03') { s.anul += centimos(d.total); s.iva -= centimos(d.total_iva); s.nNC++; if (esAnulacion(d)) s.nAnul++; else s.nDev++; }
    else if (d.tipo_doc === '02') { s.deb += centimos(d.total); s.iva += centimos(d.total_iva); s.nND++; }
    else if (esVenta(d)) {
      s.ventas += centimos(d.total); s.iva += centimos(d.total_iva); s.nVentas++;
      if (!d.venta_id) { s.sinN++; s.sin += centimos(d.total); } // no salió de una cuenta cobrada en la caja
    }
  }
  s.neto = (s.ventas - s.anul + s.deb) / 100;
  return s;
}

/* ---------- Frases de «Anular y reimprimir» (lo que no suma y lo que sí suma) ---------- */
export function frasesDeLista(s) {
  const f = [];
  if (s.rechN) f.push(`No suma ${plural(s.rechN, 'documento que Hacienda no aceptó', 'documentos que Hacienda no aceptó')} (${money(s.rech / 100)}).`);
  if (s.ncRechN) f.push(`No resta ${plural(s.ncRechN, 'nota de crédito que Hacienda no aceptó', 'notas de crédito que Hacienda no aceptó')} (${money(s.ncRech / 100)}): esa venta sigue valiendo.`);
  if (s.ndRechN) f.push(`No suma ${plural(s.ndRechN, 'nota de débito que Hacienda no aceptó', 'notas de débito que Hacienda no aceptó')} (${money(s.ndRech / 100)}).`);
  if (s.sinN) f.push(`Sí suma ${s.sinN === 1 ? '1 documento que no salió' : s.sinN + ' documentos que no salieron'} de una cuenta cobrada en Facturación (${money(s.sin / 100)}).`);
  return f;
}

/* ---------- El puente con «Apertura y cierre de caja» ---------- */
// turnoNeto = total_ventas_netas de fx_turno_estado; turnoRech = rechazadas_total (ventas con documento rechazado que el turno sí cuenta).
// Devuelve las filas del cuadre y lo que queda sin explicar (`otras`, normalmente 0: por ejemplo notas de crédito de ventas de otro turno).
export function puenteConTurno(s, est) {
  if (!est || est.total_ventas_netas == null) return null;
  const turnoNeto = centimos(est.total_ventas_netas), turnoRech = centimos(est.rechazadas_total);
  const lista = centimos(s.neto);
  const otras = lista - (turnoNeto - turnoRech + s.sin);
  return { turnoNeto, turnoRech, sin: s.sin, sinN: s.sinN, otras, lista, coincide: lista === turnoNeto };
}

/* ---------- Frase de «Apertura y cierre de caja» (la misma cuenta, vista desde el otro lado) ---------- */
// docs = documentos del turno; est = fx_turno_estado. Devuelve el texto o null si no hace falta decir nada.
export function fraseParaTurno(docs, est) {
  const s = sumarDocumentos(docs);
  const p = puenteConTurno(s, est);
  if (!p) return null;
  if (p.coincide && !p.turnoRech && !p.sin) return `«Anular y reimprimir» muestra la misma cifra para este turno: ${money(s.neto)}.`;
  const partes = [];
  if (p.turnoRech) partes.push(`no suma ${plural(Number(est.rechazadas_n) || 1, 'venta cuyo documento Hacienda no aceptó', 'ventas cuyos documentos Hacienda no aceptó')} (${money(p.turnoRech / 100)})`);
  if (p.sinN) partes.push(`sí suma ${plural(p.sinN, 'documento sin cuenta de caja', 'documentos sin cuenta de caja')} (${money(p.sin / 100)})`);
  let t = `«Anular y reimprimir» muestra ${money(s.neto)} para este turno`;
  t += partes.length ? ', porque ' + partes.join(' y ') + '.' : '.';
  if (p.otras) t += ` Otras diferencias: ${money(p.otras / 100)}, por ejemplo notas de crédito de ventas de otro turno.`;
  return t;
}
