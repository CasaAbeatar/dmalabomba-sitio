// Tiquetes de la caja para la impresora POS: apertura, cierre (copia de la cajera) y vales de entrada y salida de efectivo.
// Regla del cierre ciego: nada de lo que sale aquí dice cuánto debía haber en la caja ni si sobró dinero. Solo lo que la persona escribió y, si faltó, el faltante que ya se le avisó.
// El informe completo (esperado, diferencia, sobrante) es solo para administración y no sale por esta vía.
// Todos son comprobantes internos: no son facturas electrónicas.
import { h, money, fechaHora, nombreLocal, toast } from './util.js';


const fila = (a, b) => h('div.f', h('span', a), h('b', b));
const numeroCierre = (n) => String(n || 0).padStart(6, '0');

async function ajustes() {
  try { return (await import('./imprimir.js')).leerAjustes(); } catch { return { papel: 80, copias: 1, auto: true }; }
}

// Imprime un nodo en papel POS con un marco oculto (sin abrir pestañas). Devuelve una promesa que termina cuando se mandó a imprimir.
export async function imprimirNodo(nodo, titulo) {
  const aj = await ajustes();
  const ancho = aj.papel === 58 ? 58 : 80;
  const cuerpo = ancho === 58 ? 48 : 72;
  const f = document.createElement('iframe');
  f.setAttribute('aria-hidden', 'true');
  f.style.cssText = `position:fixed;right:0;bottom:0;width:${ancho}mm;height:10px;border:0;opacity:0;pointer-events:none`;
  document.body.append(f);
  const d = f.contentDocument;
  d.open(); d.write('<!doctype html><html lang="es"><head><meta charset="utf-8"><title></title></head><body></body></html>'); d.close();
  d.title = titulo || 'Caja';
  const css = d.createElement('style');
  css.textContent = `
    *{box-sizing:border-box}
    html,body{margin:0;padding:0;background:#fff}
    body{width:${cuerpo}mm;margin:0 auto;padding:3mm 0 5mm;font:12px/1.35 "Courier New",ui-monospace,monospace;color:#000}
    .c{text-align:center}.g{font-size:15px;font-weight:700;margin:2mm 0}.p{font-size:10px;margin-top:3mm}
    .f{display:flex;justify-content:space-between;gap:4mm}
    .f b{text-align:right}.sal{font-size:11px}
    hr{border:0;border-top:1px dashed #000;margin:2mm 0}
    .firma{margin-top:9mm;border-top:1px solid #000;padding-top:1mm}`;
  d.head.append(css);
  d.body.append(d.importNode(nodo, true));
  await new Promise((ok) => setTimeout(ok, 300));
  const mm = Math.ceil(d.body.scrollHeight * 25.4 / 96) + 6;
  const pg = d.createElement('style');
  pg.textContent = `@page{size:${ancho}mm ${mm}mm;margin:0}`;
  d.head.append(pg);
  f.contentWindow.addEventListener('afterprint', () => f.remove());
  try { f.contentWindow.focus(); f.contentWindow.print(); } catch { toast('No se pudo abrir la impresión. Revise la impresora e intente de nuevo.', 'error'); f.remove(); }
  setTimeout(() => f.remove(), 120000);
}

const pie = (copia) => [
  h('div.firma', 'Firma:'),
  h('div.c.p', 'Comprobante interno, no es factura electrónica'),
  h('div.c.p', (copia ? 'COPIA (reimpresión) · ' : '') + 'Impreso ' + fechaHora(new Date()))];

const cabecera = (soc, titulo, t) => [
  h('div.c', h('b', nombreLocal(soc))),
  h('div.c', (soc.nombre || '') + (soc.cedula ? ' · Céd. ' + soc.cedula : '')),
  h('div.c.g', titulo),
  h('div.c', 'Caja ' + (t.terminal || 1)),
  h('hr')];

// Quién lo hizo: si el servidor guarda el correo, se muestra lo que va antes de la @
const persona = (x) => String(x || '').split('@')[0];

export function nodoApertura(soc, t, copia = false) {
  return h('div.tk',
    cabecera(soc, 'APERTURA DE CAJA', t),
    fila('Fecha', fechaHora(t.abierto_en)),
    fila('Abre', persona(t.abierto_por)),
    h('hr'),
    fila('Dinero al abrir', money(t.fondo_inicial ?? t.fondo ?? 0)),
    pie(copia));
}

export function nodoVale(soc, t, { tipo, monto, motivo, quien, cuando, id }, copia = false) {
  const entrada = tipo === 'entrada';
  return h('div.tk',
    cabecera(soc, entrada ? 'VALE DE ENTRADA DE EFECTIVO' : 'VALE DE SALIDA DE EFECTIVO', t),
    fila('Fecha', fechaHora(cuando || new Date())),
    id ? fila('Vale', '#' + String(id).slice(0, 8).toUpperCase()) : null,
    fila('Registró', persona(quien)),
    h('hr'),
    fila(entrada ? 'Entra a la caja' : 'Sale de la caja', money(monto)),
    h('div', 'Motivo: ' + (motivo || 'sin motivo')),
    pie(copia));
}

// Copia de la cajera al cerrar. conteos: [{ n, monto, faltante }] (el faltante viene vacío cuando no se le avisó).
export function nodoCierreCajera(soc, est, copia = false) {
  const t = est.turno || {};
  const conteos = est.conteos || [];
  const conAviso = conteos.some((c) => Number(c.faltante) > 0);
  const falto = Number(t.faltante_reconocido) > 0 ? Number(t.faltante_reconocido) : 0;
  const ORD = ['Primer', 'Segundo', 'Tercer', 'Cuarto', 'Quinto'];
  return h('div.tk',
    cabecera(soc, 'CIERRE DE CAJA', t),
    t.numero_cierre ? h('div.c', 'Cierre No. ' + numeroCierre(t.numero_cierre)) : null,
    fila('Abierta', fechaHora(t.abierto_en)),
    fila('Cerrada', t.cerrado_en ? fechaHora(t.cerrado_en) : ''),
    fila('Cajera', persona(t.cerrado_por || t.abierto_por)),
    h('hr'),
    fila('Apertura', money(est.fondo ?? t.fondo_inicial ?? 0)),
    Number(est.total_entradas) > 0 ? fila('Entradas de efectivo', money(est.total_entradas)) : null,
    (est.entradas || []).map((e) => h('div.f.sal', h('span', '  ' + (e.motivo || '')), h('span', money(e.monto)))),
    Number(est.total_salidas) > 0 ? fila('Salidas de efectivo', money(est.total_salidas)) : null,
    (est.salidas || []).map((s) => h('div.f.sal', h('span', '  ' + (s.motivo || '')), h('span', money(s.monto)))),
    h('hr'),
    conAviso
      ? conteos.map((c, i) => [fila((ORD[i] || (i + 1) + '.º') + ' conteo', money(c.monto)), Number(c.faltante) > 0 ? fila('Faltaban', money(c.faltante)) : null])
      : fila('Dinero contado', money(t.contado_efectivo ?? est.contado_efectivo ?? 0)),
    falto > 0 ? h('div.c.g', 'Faltante reconocido ' + money(falto)) : h('div.c.g', 'Sin faltante'),
    t.notas ? h('div', 'Notas: ' + t.notas) : null,
    pie(copia));
}

// Informe completo para administración (esperado, diferencia, conteos): se imprime desde la pantalla de administración, nunca desde la caja.
export function nodoInforme(texto, soc, copia = true) {
  return h('div.tk',
    h('div.c', h('b', nombreLocal(soc))),
    h('div.c.g', 'SOLO ADMINISTRACIÓN'),
    h('hr'),
    String(texto || '').split('\n').map((l) => h('div', { style: 'white-space:pre-wrap' }, l || ' ')),
    h('hr'),
    h('div.c.p', (copia ? 'COPIA · ' : '') + 'Impreso ' + fechaHora(new Date())));
}

// Apertura, cierre y vales SIEMPRE se mandan solos a la impresora POS, sin importar el ajuste de impresión automática de las ventas:
// el comprobante físico se adjunta al cierre y no puede depender de que alguien se acuerde de tocar un botón. «Volver a imprimir» queda aparte.
async function sola(nodo, titulo) {
  const aj = await ajustes();
  for (let i = 0; i < aj.copias; i++) await imprimirNodo(nodo, titulo);
  return true;
}

export const imprimirAperturaAuto = (soc, t) => sola(nodoApertura(soc, t), 'Apertura de caja');
export const imprimirValeAuto = (soc, t, v) => sola(nodoVale(soc, t, v), v.tipo === 'entrada' ? 'Vale de entrada' : 'Vale de salida');
export const imprimirCierreAuto = (soc, est) => sola(nodoCierreCajera(soc, est), 'Cierre de caja');

