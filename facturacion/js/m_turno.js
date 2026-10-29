// Cierre de caja: solo se cuenta el EFECTIVO. Debe haber en caja = fondo + ventas en efectivo + cobros en efectivo de notas de débito + entradas de efectivo - salidas - devoluciones en efectivo por notas de crédito.
import { h, money, leerNumero, r2, toast, modal, fechaHora, fechaCorta, horaCorta, esqueleto, bloqueError, nombreLocal, conPistaDesliz, hoyCR, conPunto, TIPOS_SERVICIO, MEDIOS } from './util.js';
import { esTransitorio } from './api.js';
import { textoError } from './api_efectivo.js';
import { anularSalida, anularEntrada, listaSalidas } from './ui_salidas.js';
import { crearZonaEfectivo } from './ui_efectivo_rapido.js';
import { crearFormularioApertura } from './ui_apertura.js';
import { documentos } from './api_documentos.js';
import { fraseParaTurno, docsDelTurno } from './cuadre_turno.js';
import { crearDescarga, nombrePeriodo } from './descargas.js';

const CSS_URL = new URL('../css/caja.css', import.meta.url).href;
function cargarCss() {
  return new Promise((ok) => {
    if (document.getElementById('css-caja')) return ok();
    const l = h('link', { id: 'css-caja', rel: 'stylesheet', href: CSS_URL });
    l.onload = l.onerror = () => ok();
    document.head.append(l);
    setTimeout(ok, 1500);
  });
}

const MAX_NOTAS = 200; // largo máximo de la nota del cierre que acepta el servidor
const TOPE = 99999999.99; // el servidor no acepta un efectivo contado mayor
const OTROS = ['tarjeta', 'sinpe', 'transferencia'];
const TODOS = ['efectivo', 'tarjeta', 'sinpe', 'transferencia'];
const cents = (n) => Math.round((Number(n) || 0) * 100);
const numCuenta = (n) => '#' + String(n || '').split('-').pop();
// fx_turno_cerrar rechaza el cierre con cuentas abiertas (error P0001, hint «cuentas_abiertas»). api.js guarda el hint en el error; el texto queda solo de respaldo por si el servidor no lo manda.
const rechazoPorCuentas = (e) => !!e && !esTransitorio(e) && (e.hint === 'cuentas_abiertas' || /cuentas? abiertas?/i.test(e.message || ''));

// Fecha y hora que se pueden partir en dos renglones sin cortar los números (celular)
const fechaPartida = (d) => (d ? [h('span.nw', fechaCorta(d) + ','), ' ', h('span.nw', horaCorta(d))] : '');
const ymdDe = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Costa_Rica' }).format(new Date(iso));

function duracion(desde, hasta) {
  const min = Math.max(0, Math.round((new Date(hasta) - new Date(desde)) / 60000));
  const hh = Math.floor(min / 60), mm = min % 60;
  return (hh ? hh + ' h ' : '') + mm + ' min';
}

// Cifras de un turno a partir de fx_turno_estado
function datosResumen(est) {
  const t = est.turno, pm = est.por_medio || {};
  const cerrado = !!t.cerrado_en;
  const fondo = Number(est.fondo ?? t.fondo_inicial ?? 0);
  const efVentas = Number(est.efectivo_ventas ?? pm.efectivo ?? 0);
  const salidas = est.salidas || [];
  const totSal = Number(est.total_salidas ?? 0);
  // Dinero que entró a la caja sin ser una venta (fx_turno_estado.entradas y total_entradas). El servidor ya lo suma en «debe haber»; sin entradas la fila no se muestra.
  const entradas = est.entradas || [];
  const totEnt = Number(est.total_entradas ?? 0);
  // Efectivo devuelto por notas de crédito durante el turno (fx_turno_estado.devoluciones_efectivo). Si el servidor todavía no lo manda, la fila no se muestra.
  const devoluciones = est.devoluciones_efectivo != null ? Number(est.devoluciones_efectivo) : null;
  // Efectivo que el cliente pagó en notas de débito del turno (cobros_nota_debito_efectivo; notas_debito_efectivo es el mismo número con otro nombre). El servidor ya lo suma en «debe haber»:
  // aquí solo se muestra como una fila más para que la cuenta se pueda seguir, y nunca se suma otra vez.
  const ndEfectivo = Math.max(0, Number(est.cobros_nota_debito_efectivo ?? est.notas_debito_efectivo ?? 0) || 0);
  const esperado = r2(Number(est.esperado_efectivo ?? (fondo + efVentas + ndEfectivo + totEnt - totSal - (devoluciones || 0))));
  const contado = cerrado ? Number(est.contado_efectivo ?? t.contado_efectivo ?? 0) : null;
  const dif = cerrado ? r2(est.diferencia_efectivo != null ? Number(est.diferencia_efectivo) : contado - esperado) : null;
  return {
    t, cerrado, fondo, efVentas, salidas, totSal, entradas, totEnt, devoluciones, esperado, contado, dif,
    discrepancia: cerrado ? cents(dif) !== 0 : null,
    otros: OTROS.map((m) => ({ medio: m, monto: Number(pm[m] || 0) })),
    porMedio: TODOS.map((m) => ({ medio: m, monto: Number(pm[m] || 0) })),
    ventas: Number(est.ventas || 0), totalVentas: Number(est.total_ventas || 0),
    notasCredito: Number(est.notas_credito || 0), sinAceptar: Number(est.sin_aceptar || 0),
    anuladasN: Number(est.ventas_anuladas_n || 0), anuladasTotal: Number(est.ventas_anuladas_total || 0),
    // Notas de débito y devoluciones parciales del turno (las anuladas de arriba cuentan solo anulaciones totales). total_ventas_netas ya las incluye.
    ndEfectivo, ndN: Math.max(0, Math.floor(Number(est.notas_debito_n || 0))), ndTotal: Number(est.notas_debito_total || 0),
    parcN: Math.max(0, Math.floor(Number(est.devoluciones_parciales_n || 0))), parcTotal: Number(est.devoluciones_parciales_total || 0),
    totalNetas: est.total_ventas_netas != null && Number.isFinite(Number(est.total_ventas_netas)) ? Number(est.total_ventas_netas) : null,
    // Líneas cobradas con un precio distinto al del catálogo (fx_turno_estado.precios_cambiados). Solo es rastro: la cajera puede cambiar todo y nada se bloquea.
    preciosCambiados: Math.max(0, Math.floor(Number(est.precios_cambiados || 0))),
    // Ventas cobradas cuyo documento Hacienda no aceptó (fx_turno_estado.rechazadas_n y rechazadas_total). Siguen contadas en el total: la plata sí se cobró.
    rechazadasN: Number(est.rechazadas_n || 0), rechazadasTotal: Number(est.rechazadas_total || 0),
  };
}

function textoDif(dif) {
  const c = cents(dif);
  return c === 0 ? 'Cuadra' : (c > 0 ? 'Sobran ' : 'Faltan ') + money(Math.abs(c) / 100);
}
function chipDif(dif) {
  if (dif == null) return h('span.dif', 'Sin dato');
  const c = cents(dif);
  return h('span.dif.' + (c === 0 ? 'cuadra' : c > 0 ? 'sobra' : 'falta'), textoDif(dif));
}

// «Incluye 1 venta (₡5 000,00) cuyo documento Hacienda no aceptó. Informes no la cuenta.»
function textoRechazadas(d) {
  const uno = d.rechazadasN === 1;
  return `Incluye ${d.rechazadasN} ${uno ? 'venta' : 'ventas'} (${money(d.rechazadasTotal)}) cuyo${uno ? '' : 's'} documento${uno ? '' : 's'} Hacienda no aceptó. Informes no ${uno ? 'la cuenta' : 'las cuenta'}.`;
}

// «Productos cobrados con precio distinto del catálogo: 3» (discreto: es un dato para saber, no una alarma)
const textoPreciosCambiados = (d) => 'Productos cobrados con precio distinto del catálogo: ' + d.preciosCambiados;

// Qué se le resta o se le suma al total vendido: ventas anuladas, devoluciones o correcciones parciales (notas de crédito) y notas de débito.
// Con solo ventas anuladas el texto es el de siempre; si hay otros ajustes, los nombra y dice cuánto es lo vendido con todos ellos (total_ventas_netas, que calcula la base).
function textoAjustes(d) {
  if (d.anuladasN <= 0 && d.parcN <= 0 && d.ndN <= 0) return null;
  if (d.parcN <= 0 && d.ndN <= 0) return h('p.tenue-linea', `De ese total, ${d.anuladasN} ${d.anuladasN === 1 ? 'venta se anuló' : 'ventas se anularon'} con nota de crédito (${money(d.anuladasTotal)}). Sin esas ventas anuladas, lo vendido es ${money(d.totalNetas ?? r2(d.totalVentas - d.anuladasTotal))}.`);
  const partes = [];
  if (d.anuladasN > 0) partes.push(`${d.anuladasN} ${d.anuladasN === 1 ? 'venta se anuló' : 'ventas se anularon'} con nota de crédito (resta ${money(d.anuladasTotal)})`);
  if (d.parcN > 0) partes.push(`${d.parcN} ${d.parcN === 1 ? 'devolución o corrección' : 'devoluciones o correcciones'} con nota de crédito (resta ${money(d.parcTotal)})`);
  if (d.ndN > 0) partes.push(`${d.ndN} ${d.ndN === 1 ? 'nota de débito' : 'notas de débito'} (suma ${money(d.ndTotal)})`);
  const neto = d.totalNetas ?? r2(d.totalVentas - d.anuladasTotal - d.parcTotal + d.ndTotal);
  return h('p.tenue-linea.ajustes-turno', `De ese total: ${partes.join('; ')}. Con esos ajustes, lo vendido es ${money(neto)}.`);
}

// Filas de la cuenta: abrió + ventas + cobros de notas de débito + entradas - salidas - devoluciones = debe haber
function bloqueCalculo(d, { alAnularSalida, alAnularEntrada, extra } = {}) {
  return h('div.calc',
    h('div.calc-fila', h('span', h('span.op', ''), 'Efectivo con que abrió la caja'), h('span.v', money(d.fondo))),
    h('div.calc-fila', h('span', h('span.op', '+'), 'Ventas en efectivo'), h('span.v', money(d.efVentas))),
    d.ndEfectivo > 0 ? h('div.calc-fila.cobros-nd', h('span', h('span.op', '+'), 'Cobros en efectivo de notas de débito', h('small.calc-nota', 'Dinero que los clientes pagaron en efectivo por notas de débito en este turno.')), h('span.v', money(d.ndEfectivo))) : null,
    d.totEnt > 0 || d.entradas.length ? h('div.calc-fila.entradas', h('span', h('span.op', '+'), 'Entradas de efectivo', h('small.calc-nota', 'Dinero que entró a la caja y no es una venta.')), h('span.v', money(d.totEnt))) : null,
    d.entradas.length ? h('div.calc-sub', listaSalidas(d.entradas, alAnularEntrada, 'entrada')) : null,
    h('div.calc-fila', h('span', h('span.op', '−'), 'Salidas de efectivo'), h('span.v', money(d.totSal))),
    d.salidas.length || alAnularSalida ? h('div.calc-sub', listaSalidas(d.salidas, alAnularSalida, 'salida')) : null,
    d.devoluciones != null ? h('div.calc-fila', h('span', h('span.op', '−'), 'Efectivo devuelto con notas de crédito',
      d.devoluciones > 0 ? h('small.calc-nota', 'Efectivo de ventas anuladas y de devoluciones o correcciones con nota de crédito hechas en este turno. Se resta porque ese dinero debe haber salido de la caja.') : null), h('span.v', money(d.devoluciones))) : null,
    h('div.calc-fila.total', h('span', h('span.op', '='), 'Debe haber en caja'), h('span.v', money(d.esperado))),
    // Si lo que salió es más que lo que entró, la cifra sale negativa: se explica con palabras (y solo se ofrece anular donde se puede)
    cents(d.esperado) < 0 ? h('p.tenue-linea.calc-negativo', { role: 'note' }, alAnularSalida
      ? 'Las salidas anotadas suman más que el efectivo que entró a la caja, por eso la cifra sale negativa. Si alguna salida quedó anotada de más, se puede anular en la lista de salidas.'
      : 'En este turno las salidas anotadas sumaron más que el efectivo que entró a la caja, por eso la cifra es negativa.') : null,
    extra);
}

// Lo vendido en el turno por cada medio de pago, calculado por el sistema
function bloqueVentas(d, { alVer, nota } = {}) {
  return h('div.tarjeta.col',
    h('div.fila.sep', h('h3', 'Vendido en el turno'), h('span.chip.ok', 'Registrado automáticamente por el sistema')),
    h('div.ventas-medios',
      d.porMedio.map((o) => h('div.dato', h('div.et', MEDIOS[o.medio]), h('div.val', money(o.monto)))),
      h('div.dato.total', h('div.et', 'Total vendido'), h('div.val', money(d.totalVentas)), h('div.det', d.ventas + (d.ventas === 1 ? ' venta' : ' ventas') + ', IVA incluido'))),
    d.rechazadasN > 0 ? h('div.aviso-rechazadas', { role: 'note' }, h('span', textoRechazadas(d)), alVer ? h('button.btn.chico', { type: 'button', onclick: alVer }, 'Ver esos documentos') : null) : null,
    textoAjustes(d),
    nota || null,
    d.preciosCambiados > 0 ? h('p.precios-cambiados', textoPreciosCambiados(d)) : null,
    h('p.tenue-linea', 'Solo el efectivo se cuenta a mano. Tarjeta, SINPE Móvil y transferencia los suma el sistema con cada cobro.'));
}

// Resumen para la pantalla
function nodoPantalla(d) {
  const t = d.t;
  return h('div.col',
    h('div.turno-datos',
      h('div.dato', h('div.et', 'Abrió'), h('div.val', fechaPartida(t.abierto_en)), h('div.det', t.abierto_por || '')),
      h('div.dato', h('div.et', 'Cerró'), h('div.val', t.cerrado_en ? fechaPartida(t.cerrado_en) : 'Sigue abierta'), h('div.det', t.cerrado_en ? (t.cerrado_por || '') + ' · duró ' + duracion(t.abierto_en, t.cerrado_en) : 'Lleva ' + duracion(t.abierto_en, new Date()))),
      h('div.dato', h('div.et', 'Notas de crédito'), h('div.val', money(d.notasCredito)), h('div.det', 'Durante el turno')),
      d.ndN > 0 ? h('div.dato', h('div.et', 'Notas de débito'), h('div.val', money(d.ndTotal)), h('div.det', `${d.ndN} ${d.ndN === 1 ? 'nota' : 'notas'} en el turno`)) : null),
    bloqueVentas(d),
    h('div.tarjeta',
      h('h3', 'Efectivo en la caja'),
      bloqueCalculo(d),
      d.cerrado ? h('div.calc',
        h('div.calc-fila', h('span', 'Efectivo contado al cerrar'), h('span.v', money(d.contado))),
        h('div.calc-fila', h('span', 'Diferencia'), h('span.v', chipDif(d.dif)))) : null),
    d.cerrado && d.discrepancia ? h('div.alerta-dif.' + (cents(d.dif) < 0 ? 'falta' : 'sobra'), 'Este cierre quedó con una diferencia: ' + textoDif(d.dif).toLowerCase() + '.') : null,
    t.notas ? h('div.dato', h('div.et', 'Notas del cierre'), h('div', t.notas)) : null);
}

// Resumen para papel de 80 mm (se arma con nodos, nunca con texto HTML)
function nodoImpresion(d, soc) {
  const t = d.t;
  const fila = (a, b) => h('div.f', h('span', a), h('b', b));
  return h('div.tk',
    h('div.c', h('b', nombreLocal(soc))),
    h('div.c', soc.nombre + ' · Céd. ' + (soc.cedula || '')),
    h('div.c.g', 'CIERRE DE CAJA'),
    h('div.c', 'Caja ' + (t.terminal || 1) + (t.cerrado_en ? '' : ' (todavía abierta)')),
    h('hr'),
    fila('Abierta', fechaHora(t.abierto_en)),
    fila('Cerrada', t.cerrado_en ? fechaHora(t.cerrado_en) : 'Sigue abierta'),
    fila('Abrió', t.abierto_por || ''),
    t.cerrado_en ? fila('Cerró', t.cerrado_por || '') : null,
    h('hr'),
    h('div.c', h('b', 'VENDIDO EN EL TURNO')),
    h('div.c.p', 'Registrado automáticamente por el sistema'),
    d.porMedio.map((o) => fila(MEDIOS[o.medio], money(o.monto))),
    fila('TOTAL VENDIDO', money(d.totalVentas)),
    fila('Ventas', String(d.ventas)),
    d.rechazadasN > 0 ? h('div.c.p', textoRechazadas(d)) : null,
    fila('Notas de crédito', money(d.notasCredito)),
    d.ndN > 0 ? fila('Notas de débito', money(d.ndTotal)) : null,
    d.parcN > 0 ? fila('Devoluciones y correcciones', money(d.parcTotal)) : null,
    d.preciosCambiados > 0 ? h('div.c.p', textoPreciosCambiados(d)) : null,
    h('hr'),
    h('div.c', h('b', 'EFECTIVO EN LA CAJA')),
    fila('Efectivo con que abrió', money(d.fondo)),
    fila('+ Ventas en efectivo', money(d.efVentas)),
    d.ndEfectivo > 0 ? fila('+ Cobros de notas de débito en efectivo', money(d.ndEfectivo)) : null,
    d.totEnt > 0 ? fila('+ Entradas de efectivo', money(d.totEnt)) : null,
    d.entradas.map((e) => h('div.f.sal', h('span', '  ' + e.motivo), h('span', money(e.monto)))),
    fila('- Salidas de efectivo', money(d.totSal)),
    d.salidas.map((s) => h('div.f.sal', h('span', '  ' + s.motivo), h('span', money(s.monto)))),
    d.devoluciones != null ? fila('- Efectivo devuelto con notas de crédito', money(d.devoluciones)) : null,
    fila('= Debe haber en caja', money(d.esperado)),
    d.cerrado ? fila('Efectivo contado', money(d.contado)) : null,
    d.cerrado ? fila('Diferencia', textoDif(d.dif)) : null,
    d.cerrado && d.discrepancia ? h('div.c.g', 'CON DIFERENCIA') : null,
    t.notas ? h('div', h('hr'), h('div', 'Notas: ' + t.notas)) : null,
    h('div.firma', 'Firma de quien contó:'),
    h('div.c.p', 'Impreso ' + fechaHora(new Date())));
}

// Imprime un nodo en papel de 80 mm con un marco oculto (sin abrir pestañas)
function imprimirNodo(nodo, titulo) {
  const f = document.createElement('iframe');
  f.setAttribute('aria-hidden', 'true');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:80mm;height:10px;border:0;opacity:0;pointer-events:none';
  document.body.append(f);
  const d = f.contentDocument;
  d.open(); d.write('<!doctype html><html lang="es"><head><meta charset="utf-8"><title></title></head><body></body></html>'); d.close();
  d.title = titulo || 'Cierre de caja';
  const css = d.createElement('style');
  css.textContent = `
    *{box-sizing:border-box}
    html,body{margin:0;padding:0;background:#fff}
    body{width:72mm;margin:0 auto;padding:3mm 0 5mm;font:12px/1.35 "Courier New",ui-monospace,monospace;color:#000}
    .c{text-align:center}.g{font-size:15px;font-weight:700;margin:2mm 0}.p{font-size:10px;margin-top:3mm}
    .f{display:flex;justify-content:space-between;gap:4mm}
    .f b{text-align:right}.sal{font-size:11px}
    hr{border:0;border-top:1px dashed #000;margin:2mm 0}
    .firma{margin-top:9mm;border-top:1px solid #000;padding-top:1mm}`;
  d.head.append(css);
  d.body.append(d.importNode(nodo, true));
  setTimeout(() => {
    const mm = Math.ceil(d.body.scrollHeight * 25.4 / 96) + 6;
    const pg = d.createElement('style');
    pg.textContent = `@page{size:80mm ${mm}mm;margin:0}`;
    d.head.append(pg);
    f.contentWindow.addEventListener('afterprint', () => f.remove());
    try { f.contentWindow.focus(); f.contentWindow.print(); } catch { toast('No se pudo abrir la impresión. Revise la impresora e intente de nuevo.', 'error'); f.remove(); }
    setTimeout(() => f.remove(), 120000);
  }, 300);
}

export default {
  id: 'turno',
  titulo: 'Apertura y cierre de caja',
  async mount(root, app) {
    await cargarCss();
    const api = app.api;
    const socId = app.soc.id;
    const soc = app.soc;
    let vivo = true;
    let final = null; // resumen del cierre que se acaba de hacer
    let finalAviso = null; // frase que acompaña al resumen cuando la caja ya estaba cerrada
    let turnoVisto = null;
    let est = null, abiertas = [], historial = [];
    let sugerencia = null; // fx_turno_sugerencia_apertura: lo contado al cerrar el último turno de ESTA terminal (null si no se pudo leer)
    let contadoTxt = '';
    let notas = '';
    let zona = null; // zona de efectivo (entradas y salidas), la misma que usa Facturación
    let refrescoActual = null; // pone al día solo las cifras del turno abierto, sin rehacer la pantalla
    let errBox = null, botonCerrar = null;
    let mensajeCierre = ''; // el último problema del cierre se queda a la vista hasta el siguiente intento
    const contenedor = h('div.turno');
    root.append(contenedor);

    const soltarZona = () => { zona?.destruir(); zona = null; refrescoActual = null; errBox = null; botonCerrar = null; };

    let nCarga = 0; // cada lectura lleva su número: si llega tarde la respuesta de una anterior (dos toques seguidos en «Actualizar cifras»), se descarta
    async function cargar() {
      const mi = ++nCarga;
      turnoVisto = app.turno?.id || null;
      soltarZona();
      contenedor.replaceChildren(esqueleto(4, 'Cargando el cierre de caja…'));
      let e, ab, hist, sug;
      try {
        [e, ab, hist, sug] = await Promise.all([
          turnoVisto ? api.turnoEstado(turnoVisto) : null,
          turnoVisto ? api.ventasAbiertas(socId) : [],
          api.turnos(socId, 30),
          turnoVisto ? null : api.turnoSugerencia(socId, app.terminal).catch(() => null), // solo informa: si falla no se detiene la pantalla
        ]);
        if (mi !== nCarga) return;
      } catch (er) {
        if (!vivo || mi !== nCarga) return;
        contenedor.replaceChildren(bloqueError({ titulo: 'No se pudo cargar el cierre de caja', mensaje: conPunto(textoError(er, 'Revise la conexión e intente de nuevo.')), alReintentar: () => sincronizar() }));
        return;
      }
      // Este aparato todavía creía abierta una caja que otro aparato ya cerró: se pone al día lo que sabe la sesión. 'app:cambio' vuelve a cargar con el turno nuevo
      // (por eso se compara con el número de esta carga y no con turnoVisto). Si no cambió nada, se dibuja como lo que el servidor dice: caja cerrada.
      if (turnoVisto && e?.turno?.cerrado_en) {
        try { await app.refrescar(); } catch { /* sin conexión: se dibuja con lo que se leyó */ }
        if (!vivo || mi !== nCarga) return;
        turnoVisto = null; e = null; ab = [];
      }
      est = e; abiertas = ab || []; historial = hist || []; sugerencia = sug || null;
      pintar();
    }

    // Vuelve a preguntar si hay un turno abierto (otra persona pudo abrirlo o cerrarlo desde otro aparato) y lee todo de nuevo
    async function sincronizar() {
      const antes = turnoVisto;
      try { await app.refrescar(); } catch { /* sin conexión: abajo se avisa si no se puede leer */ }
      if (turnoVisto === antes) await cargar(); // si el turno cambió, 'app:cambio' ya volvió a cargar
    }

    // Vuelve a leer solo el turno actual (después de anotar o anular dinero) y cambia solo las cifras
    async function recargarTurno() {
      if (!turnoVisto) return;
      const mi = ++nCarga, id = turnoVisto;
      let e;
      try { e = await api.turnoEstado(id); } catch (er) { if (mi === nCarga) toast(conPunto(textoError(er, 'No se pudieron actualizar las cifras. Toque «Actualizar cifras».')), 'error'); return; }
      if (mi !== nCarga || id !== turnoVisto || final) return;
      if (e?.turno?.cerrado_en) { await sincronizar(); return; } // otra persona cerró la caja mientras tanto
      est = e;
      if (refrescoActual) refrescoActual(e); else pintar();
    }

    function pintar() {
      if (!vivo) return;
      soltarZona();
      contenedor.replaceChildren(
        h('p.tenue.mt-intro', nombreLocal(soc) + '. Un turno no es el día: empieza cuando se abre la caja y termina cuando se cierra, aunque cruce la medianoche.'),
        final ? seccionFinal() : (turnoVisto && est ? seccionActual() : seccionSinTurno()),
        seccionHistorial());
    }

    /* ---------- Resumen del cierre recién hecho ---------- */
    function seccionFinal() {
      const d = datosResumen(final);
      return h('section.resumen-final',
        h('h2', '✓ Caja cerrada'),
        finalAviso ? h('div.aviso-abiertas', { role: 'note' }, h('span', finalAviso)) : null,
        nodoPantalla(d),
        h('div.fila',
          h('button.btn.primario.grande', { type: 'button', onclick: () => imprimirNodo(nodoImpresion(d, soc)) }, 'Imprimir resumen del cierre'),
          h('button.btn.grande', { type: 'button', onclick: () => app.ir('caja') }, 'Abrir una caja nueva')));
    }

    /* ---------- Sin turno: abrir la caja aquí mismo ---------- */
    function seccionSinTurno() {
      // Lo que se contó al cerrar el último turno de esta terminal solo se muestra como dato; nunca se escribe solo.
      // Viene del servidor (fx_turno_sugerencia_apertura); si no se pudo leer, se usa el historial ya cargado.
      const uc = sugerencia?.ultimo_cierre;
      const delServidor = sugerencia && sugerencia.origen === 'contado' && uc?.cerrado_en && sugerencia.sugerido != null
        ? { monto: Number(sugerencia.sugerido), cuando: uc.cerrado_en } : null;
      const ultimo = historial.find((x) => x.cerrado_en && x.contado_efectivo != null);
      const form = crearFormularioApertura({
        api, socId, terminal: app.terminal, local: nombreLocal(soc),
        sugerido: sugerencia ? delServidor : (ultimo ? { monto: Number(ultimo.contado_efectivo), cuando: ultimo.cerrado_en } : null),
        alAbrir: async (res, monto) => {
          try { await app.refrescar(); } catch { toast('La caja se abrió, pero no se pudo actualizar la pantalla. Revise la conexión y toque «Abrir caja» otra vez: el sistema no abre otra.', 'error', 9000); return; }
          if (res && res.ya_abierto) toast('La caja ya estaba abierta (la abrió ' + (res.abierto_por || 'otra persona') + ') con ' + money(res.fondo_inicial ?? 0) + '. No se cambió el efectivo con que abrió.', 'ok', 9000);
          else toast('Caja abierta con ' + money(monto) + '.');
        },
      });
      return h('section.col',
        h('h2', 'La caja está cerrada'),
        h('p.tenue', 'No hay un turno abierto en ' + nombreLocal(soc) + '. Para vender hay que abrir la caja: escriba el efectivo con que empieza.'),
        form.el);
    }

    /* ---------- Turno abierto: conteo del efectivo ---------- */
    function seccionActual() {
      let d = datosResumen(est);
      const t = d.t;
      const inp = h('input.campo.monto-grande', { type: 'text', inputmode: 'decimal', placeholder: '0', value: contadoTxt, autocomplete: 'off', 'aria-label': 'Efectivo que hay en la caja ahora' });
      const difBox = h('div');
      const leer = () => {
        const txt = contadoTxt.trim();
        if (txt === '') return null;
        const v = leerNumero(txt);
        return Number.isFinite(v) && v >= 0 && v <= TOPE ? v : NaN;
      };
      function recalcular() {
        const v = leer();
        if (v == null) difBox.replaceChildren(h('span.dif', 'Escriba lo que contó para ver si cuadra'));
        else if (Number.isNaN(v)) difBox.replaceChildren(h('span.dif.falta', 'Ese monto no es válido'));
        else difBox.replaceChildren(chipDif(r2(v - d.esperado)));
      }
      inp.addEventListener('input', () => { contadoTxt = inp.value; recalcular(); });
      // El servidor guarda hasta 200 caracteres en la nota del cierre: el campo no deja escribir más y un contador discreto dice cuánto lleva
      const txtNotas = h('textarea.campo', { rows: 3, maxlength: MAX_NOTAS, placeholder: 'Ej. se pagó al proveedor de hielo', value: notas.slice(0, MAX_NOTAS), 'aria-label': 'Notas del cierre' });
      const contador = h('small.contador-notas', { 'aria-live': 'off' });
      const contar = () => { contador.textContent = txtNotas.value.length + ' de ' + MAX_NOTAS; };
      txtNotas.addEventListener('input', () => { notas = txtNotas.value.slice(0, MAX_NOTAS); contar(); });
      contar();
      const err = h('div.error-caja', { hidden: !mensajeCierre, role: 'alert' }, mensajeCierre);
      errBox = err;
      const btn = h('button.btn.primario.grande', { type: 'button' }, 'Cerrar caja');
      botonCerrar = btn;
      btn.addEventListener('click', async () => {
        if (btn.disabled || cerrando) return;
        err.hidden = true; mensajeCierre = '';
        const v = leer();
        if (v == null) { err.textContent = 'Escriba cuánto efectivo hay en la caja ahora. Si no hay nada, escriba 0.'; err.hidden = false; inp.focus(); return; }
        if (Number.isNaN(v)) { err.textContent = 'Ese monto no es válido. Escriba solo números, por ejemplo 15000.'; err.hidden = false; inp.focus(); return; }
        ocupadoCierre(true, 'Revisando la caja…');
        try { await prepararCierre(d, v, notas.trim().slice(0, MAX_NOTAS)); }
        catch (e) {
          errorCierre(esTransitorio(e)
            ? 'No hay conexión para revisar la caja. No se cerró nada. Revise internet y toque «Cerrar caja» otra vez.'
            : conPunto(textoError(e, 'No se pudo revisar la caja. No se cerró nada. Intente de nuevo; si sigue igual, avise a la persona encargada.')));
        } finally { ocupadoCierre(false); }
      });
      const avisoAbiertas = abiertas.length ? h('div.aviso-abiertas',
        h('strong', 'Hay ' + abiertas.length + (abiertas.length === 1 ? ' cuenta abierta sin cobrar' : ' cuentas abiertas sin cobrar')),
        h('span', 'Antes de cerrar hay que cobrarlas o anularlas.'),
        h('div.fila', h('button.btn', { type: 'button', onclick: () => app.ir('caja') }, 'Volver a Facturación a cobrarlas'))) : null;
      // Un turno que viene de otro día suele ser una caja que se olvidó cerrar
      const deOtroDia = ymdDe(t.abierto_en) < hoyCR();
      const avisoOtroDia = deOtroDia ? h('div.aviso-abiertas', { role: 'note' },
        h('strong', 'Esta caja se abrió el ' + fechaCorta(t.abierto_en) + ' y sigue abierta'),
        h('span', 'Si ya terminó el trabajo de ese día, cuente el efectivo y ciérrela. Si todavía sigue vendiendo en el mismo turno, no hace falta cerrarla.')) : null;
      // Anular dinero anotado: la misma ventana con motivo que usa Facturación
      const alAnular = (anular) => async (m) => { if (await anular(m)) { await recargarTurno(); zona?.refrescar(); } };
      const calcSlot = h('div');
      const pintarCalculo = () => calcSlot.replaceChildren(bloqueCalculo(d, { alAnularSalida: alAnular(anularSalida), alAnularEntrada: alAnular(anularEntrada) }));
      pintarCalculo();
      refrescoActual = (nuevo) => { d = datosResumen(nuevo); pintarCalculo(); recalcular(); };
      // La zona de efectivo es la misma de Facturación: entradas y salidas se anotan igual en las dos pantallas
      zona = crearZonaEfectivo({ turnoId: turnoVisto, conPie: false, enFlujo: true,
        motivos: { entrada: app.ctx?.motivos_entrada_efectivo, salida: app.ctx?.motivos_salida_efectivo },
        alCambiar: () => recargarTurno() });
      // La misma cuenta que se ve en «Anular y reimprimir», dicha desde aquí: qué documentos suma y cuáles no. Si no se puede leer, esta línea simplemente no sale.
      const notaDocs = h('p.tenue-linea.nota-docs', { hidden: true });
      const idTurno = turnoVisto;
      documentos(socId, ymdDe(t.abierto_en), hoyCR()).then((lista) => {
        if (!vivo || final || idTurno !== turnoVisto) return;
        const frase = fraseParaTurno(docsDelTurno(lista, t.abierto_en), est);
        if (frase) { notaDocs.textContent = frase; notaDocs.hidden = false; }
      }).catch(() => { /* sin esta explicación el resto sigue igual */ });

      const sec = h('section.col',
        h('div.fila.sep', h('h2', 'Turno abierto'), h('button.btn', { type: 'button', onclick: () => app.ir('caja') }, 'Ir a Facturación a vender')),
        avisoOtroDia,
        h('div.turno-datos',
          h('div.dato', h('div.et', 'Abrió'), h('div.val', fechaPartida(t.abierto_en)), h('div.det', (t.abierto_por || '') + ' · lleva ' + duracion(t.abierto_en, new Date()))),
          h('div.dato', h('div.et', 'Notas de crédito'), h('div.val', money(d.notasCredito)), h('div.det', 'Durante el turno')),
          d.ndN > 0 ? h('div.dato', h('div.et', 'Notas de débito'), h('div.val', money(d.ndTotal)), h('div.det', `${d.ndN} ${d.ndN === 1 ? 'nota' : 'notas'} en el turno`)) : null,
          h('div.dato', h('div.et', 'Cuentas abiertas'), h('div.val', String(abiertas.length)), h('div.det', abiertas.length ? 'Sin cobrar' : 'Todo cobrado'))),
        d.sinAceptar ? h('div.aviso-abiertas', h('strong', d.sinAceptar + (d.sinAceptar === 1 ? ' comprobante todavía no aceptado por Hacienda' : ' comprobantes todavía no aceptados por Hacienda')), h('span', 'Esto no impide cerrar la caja. Quedan en «Anular y reimprimir».')) : null,
        avisoAbiertas,
        bloqueVentas(d, { nota: notaDocs, alVer: () => app.ir('anular', { filtro: 'problemas', desde: ymdDe(t.abierto_en) < hoyCR() ? ymdDe(t.abierto_en) : null }) }),
        h('div.tarjeta',
          h('h3', 'Cuánto efectivo debe haber'),
          calcSlot,
          h('div.mt-efectivo',
            h('h4', 'Dinero que entra o sale de la caja'),
            h('p.tenue-linea', 'Anote aquí el dinero que entra o sale y no es una venta ni un vuelto: sencillo, pago a un proveedor, compra de hielo. Si se devuelve dinero por una nota de crédito, no lo anote aquí: el sistema ya lo descuenta.'),
            zona.el),
          h('div.contado-caja',
            h('label.etq', 'Efectivo que hay en la caja ahora (₡)', h('small', 'Cuente los billetes y monedas y escriba el total.'), inp),
            difBox)),
        h('label.etq', 'Notas del cierre (opcional)', txtNotas, contador),
        err,
        h('div.fila', btn, h('button.btn', { type: 'button', onclick: () => sincronizar() }, 'Actualizar cifras')));
      recalcular();
      return sec;
    }

    /* ---------- Cerrar: revisar cuentas abiertas, diferencia y cerrar ---------- */
    let cerrando = false;
    function ocupadoCierre(si, texto) {
      if (!botonCerrar || !botonCerrar.isConnected) return;
      botonCerrar.disabled = si;
      if (si) { botonCerrar.setAttribute('aria-busy', 'true'); botonCerrar.textContent = texto || 'Cerrando la caja…'; }
      else { botonCerrar.removeAttribute('aria-busy'); botonCerrar.textContent = 'Cerrar caja'; }
    }
    // El problema se queda escrito en la pantalla (un aviso que desaparece se puede perder justo cuando importa)
    function errorCierre(texto) {
      mensajeCierre = texto;
      if (errBox && errBox.isConnected) { errBox.textContent = texto; errBox.hidden = false; try { errBox.scrollIntoView({ block: 'center' }); } catch { /* nada */ } }
      toast(texto, 'error', 9000);
    }
    // Otra persona (u otro aparato) ya cerró la caja: se muestra el cierre que quedó guardado, no el conteo que se acaba de escribir
    function avisoYaCerrada(res, contado, { propio = false } = {}) {
      const t = res.turno || {};
      const guardado = Number(res.contado_efectivo ?? t.contado_efectivo ?? 0);
      const mismo = cents(guardado) === cents(contado);
      if (propio && mismo && t.cerrado_por && t.cerrado_por === app.usuario) return null; // su cierre sí salió; solo no llegó la respuesta
      return 'Esta caja ya estaba cerrada' + (t.cerrado_por ? ': la cerró ' + t.cerrado_por : '') + ' el ' + fechaHora(t.cerrado_en) + ' con ' + money(guardado) + ' contados.'
        + (mismo ? '' : ' Usted había escrito ' + money(contado) + ' y eso no cambió el cierre guardado. Si el conteo guardado no es el correcto, avise a la persona encargada.');
    }
    async function terminarCierre(res, aviso) {
      final = res; finalAviso = aviso || null; mensajeCierre = '';
      contadoTxt = ''; notas = '';
      try { await app.refrescar(); } catch { /* la cabecera se actualiza sola luego */ }
      turnoVisto = null; est = null; abiertas = [];
      try { historial = (await api.turnos(socId, 30)) || []; } catch { /* queda el anterior */ }
      try { sugerencia = await api.turnoSugerencia(socId, app.terminal); } catch { sugerencia = null; }
      pintar();
      window.scrollTo({ top: 0 });
      toast(aviso ? 'Esta caja ya estaba cerrada.' : 'Caja cerrada.');
    }

    async function prepararCierre(dMostrado, contado, notasTxt) {
      // Se leen las cifras otra vez por si hubo ventas, salidas o un cierre desde otro aparato mientras se contaba
      const [fresco, lista] = await Promise.all([api.turnoEstado(turnoVisto), api.ventasAbiertas(socId)]);
      if (fresco?.turno?.cerrado_en) { await terminarCierre(fresco, avisoYaCerrada(fresco, contado)); return; }
      const d2 = datosResumen(fresco);
      d2.leidoEn = Date.now();
      if (cents(d2.esperado) !== cents(dMostrado.esperado)) {
        est = fresco; abiertas = lista || [];
        mensajeCierre = 'Lo que debe haber en caja cambió (hubo ventas o dinero anotado mientras contaba). Revise la cifra y vuelva a tocar «Cerrar caja».';
        pintar(); toast(mensajeCierre, 'error', 9000);
        return;
      }
      if ((lista || []).length) { avisarAbiertas(lista, d2, contado, notasTxt); return; }
      await revisarDiferencia(d2, contado, notasTxt);
    }

    function avisarAbiertas(lista, d, contado, notasTxt) {
      modal({ titulo: 'Hay cuentas sin cobrar', ancho: 520,
        contenido: h('div.col',
          h('p.conf', 'No se puede cerrar la caja con cuentas abiertas. Cóbrelas en Facturación o anúlelas aquí.'),
          h('ul', { style: 'margin:0;padding-left:1.2rem' }, lista.map((c) => h('li', (TIPOS_SERVICIO[c.tipo_servicio] || c.tipo_servicio) + ' ' + (c.referencia || numCuenta(c.numero)) + ' · ' + money(c.total) + (c.estado === 'prefacturada' ? ' · con prefactura' : ''))))),
        botones: [
          { texto: 'Volver a Facturación', clase: 'primario', onclick: (c) => { c(); app.ir('caja'); } },
          { texto: 'Anular estas ' + lista.length + (lista.length === 1 ? ' cuenta' : ' cuentas'), clase: 'peligro', onclick: (c) => { c(); anularTodas(lista, d, contado, notasTxt); } },
          { texto: 'Cancelar', onclick: (c) => c() }] });
    }

    function anularTodas(lista, d, contado, notasTxt) {
      let corriendo = false;
      const esperan = lista.filter((c) => c.estado === 'prefacturada' || c.tipo_servicio === 'espera').length;
      modal({ titulo: 'Confirme', ancho: 460,
        contenido: h('div.col',
          h('p.conf', 'Se anularán ' + lista.length + (lista.length === 1 ? ' cuenta' : ' cuentas') + ' por un total de ' + money(lista.reduce((s, c) => s + Number(c.total), 0)) + '. No se puede deshacer.'),
          esperan ? h('p.conf', esperan === 1 ? 'Una de ellas es de un cliente en espera o con prefactura que todavía no ha pagado.' : esperan + ' de ellas son de clientes en espera o con prefactura que todavía no han pagado.') : null,
          h('p.conf', '¿Anular y seguir con el cierre?')),
        botones: [{ texto: 'No, volver', onclick: (c) => c() }, { texto: 'Sí, anular', clase: 'peligro', onclick: async (c) => {
          if (corriendo) return; corriendo = true; c();
          toast('Anulando las cuentas…', 'ok', 2500);
          let cortado = false;
          // Cada cuenta se anula aparte: si una ya se cobró desde otro aparato, las demás se siguen anulando
          for (const v of lista) {
            try { await api.ventaAnular(v.id, 'Cierre de caja: cuenta sin cobrar'); }
            catch (e) { if (esTransitorio(e)) { cortado = true; break; } }
          }
          try { abiertas = (await api.ventasAbiertas(socId)) || []; }
          catch { errorCierre('No hay conexión para comprobar las cuentas. No se cerró la caja. Revise internet y vuelva a tocar «Cerrar caja».'); return; }
          if (abiertas.length) {
            toast(cortado ? 'Se cortó la conexión. Quedan ' + abiertas.length + (abiertas.length === 1 ? ' cuenta abierta.' : ' cuentas abiertas.') : 'No se pudieron anular todas. Quedan ' + abiertas.length + (abiertas.length === 1 ? ' cuenta abierta.' : ' cuentas abiertas.'), 'error', 7000);
            avisarAbiertas(abiertas, d, contado, notasTxt); return;
          }
          toast('Cuentas anuladas.');
          await revisarDiferencia(d, contado, notasTxt);
        } }] });
    }

    // Si no cuadra, avisa ANTES de cerrar; siempre se permite cerrar
    async function revisarDiferencia(d, contado, notasTxt) {
      const dif = r2(contado - d.esperado);
      if (cents(dif) === 0) { await cerrarYa(d, contado, notasTxt); return; }
      const falta = cents(dif) < 0;
      const enorme = Math.abs(cents(dif)) >= 100000 && Math.abs(cents(dif)) * 2 >= Math.max(cents(d.esperado), cents(contado));
      let decidido = false;
      modal({ titulo: 'Revise el conteo', ancho: 540, alCerrar: () => {},
        contenido: h('div.col',
          h('div.alerta-dif.' + (falta ? 'falta' : 'sobra'),
            'Hay una diferencia: ' + (falta ? 'faltan ' : 'sobran ') + money(Math.abs(cents(dif)) / 100) + '.',
            h('small', 'Debe haber ' + money(d.esperado) + ' en la caja y usted contó ' + money(contado) + '.')),
          enorme ? h('p.conf', 'La diferencia es muy grande. Revise que escribió bien el total: puede faltar un cero o sobrar uno.') : null,
          h('p.tenue-linea', 'Puede contar otra vez o cerrar así. Si cierra, la diferencia queda registrada en el cierre.')),
        botones: [
          { texto: 'Cerrar de todos modos', clase: 'peligro', onclick: async (c) => { if (decidido) return; decidido = true; c(); await cerrarYa(d, contado, notasTxt); } },
          { texto: 'Volver a contar', clase: 'primario', onclick: (c) => c() }] });
    }

    async function cerrarYa(d, contado, notasTxt) {
      if (cerrando) return;
      cerrando = true;
      ocupadoCierre(true, 'Cerrando la caja…');
      try {
        // Última revisión: entre el conteo y el toque final pudo entrar una cuenta, una venta o un cierre desde otro aparato.
        // Lo que la persona aprobó en pantalla tiene que ser lo que se guarda.
        if (Date.now() - (d.leidoEn || 0) > 4000) {
          let fresco, lista;
          try { [fresco, lista] = await Promise.all([api.turnoEstado(turnoVisto), api.ventasAbiertas(socId)]); }
          catch (e) { errorCierre(esTransitorio(e) ? 'No hay conexión para revisar la caja antes de cerrar. No se cerró nada. Revise internet y toque «Cerrar caja» otra vez.' : conPunto(textoError(e, 'No se pudo revisar la caja antes de cerrar. No se cerró nada. Intente de nuevo.'))); return; }
          if (fresco?.turno?.cerrado_en) { await terminarCierre(fresco, avisoYaCerrada(fresco, contado)); return; }
          const d2 = datosResumen(fresco);
          if ((lista || []).length) { abiertas = lista; cerrando = false; avisarAbiertas(lista, d2, contado, notasTxt); return; }
          if (cents(d2.esperado) !== cents(d.esperado)) {
            est = fresco; abiertas = lista || [];
            mensajeCierre = 'Lo que debe haber en caja cambió mientras se revisaba el conteo. No se cerró nada. Revise la cifra y vuelva a tocar «Cerrar caja».';
            pintar(); toast(mensajeCierre, 'error', 9000);
            return;
          }
        }
        let res;
        try { res = await api.turnoCerrar(turnoVisto, { efectivo: contado, notas: notasTxt || null }); }
        catch (e) {
          // El servidor no deja cerrar con cuentas abiertas (otro aparato dejó una después de la revisión): se leen de nuevo y se ofrece cobrarlas o anularlas, como en la revisión de antes
          if (rechazoPorCuentas(e)) {
            let fresco = null, lista = null;
            try { [fresco, lista] = await Promise.all([api.turnoEstado(turnoVisto), api.ventasAbiertas(socId)]); } catch { /* sin poder leerlas queda el texto del servidor, más abajo */ }
            if (fresco?.turno?.cerrado_en) { await terminarCierre(fresco, avisoYaCerrada(fresco, contado)); return; }
            if ((lista || []).length) { est = fresco; abiertas = lista; pintar(); avisarAbiertas(lista, datosResumen(fresco), contado, notasTxt); return; }
          }
          // Cerrar no se repite solo. Si falló, se mira cómo quedó la caja antes de decir nada, para no cerrar dos veces ni perder el resumen.
          const yaCerrada = /ya est[aá] cerrado/i.test(e.message || ''); // otra pantalla ya la cerró
          let cerrada = null, sabe = !esTransitorio(e);
          if (yaCerrada || esTransitorio(e)) {
            try { const t = await api.turnoEstado(turnoVisto); sabe = true; if (t?.turno?.cerrado_en) cerrada = t; } catch { /* sin conexión: se avisa abajo */ }
          }
          if (cerrada) { await terminarCierre(cerrada, avisoYaCerrada(cerrada, contado, { propio: !yaCerrada })); return; }
          errorCierre(!sabe
            ? 'No hay conexión y no se pudo comprobar si la caja quedó cerrada. No se pierde nada. Cuando vuelva internet toque «Cerrar caja» otra vez: si ya estaba cerrada, el sistema se lo dirá.'
            : esTransitorio(e)
              ? 'No se pudo cerrar la caja por la conexión. La caja sigue abierta. Revise internet y toque «Cerrar caja» otra vez.'
              : conPunto('No se pudo cerrar la caja. ' + textoError(e, 'Intente de nuevo; si sigue igual, avise a la persona encargada.')) + ' La caja sigue abierta.');
          return;
        }
        await terminarCierre(res, null);
      } finally { cerrando = false; ocupadoCierre(false); }
    }

    /* ---------- Historial ---------- */
    // Vendido por medio de un turno cerrado: tarjeta, SINPE y transferencia quedan guardadas al cerrar; el efectivo se deduce de esperado - fondo - entradas + salidas + devoluciones
    // (el «esperado» ya suma las entradas de efectivo, que no son ventas; los turnos de antes no traen entradas_total y cuentan como 0)
    const efectivoVendido = (t, sinDato) => (sinDato ? null : r2(Number(t.esperado_efectivo) - Number(t.fondo_inicial) - Number(t.entradas_total || 0) + Number(t.salidas_total || 0) + Number(t.devoluciones_efectivo || 0)));
    function ventasFila(t, abierto, sinDato) {
      if (abierto) return [h('td.der', h('span.tenue', 'Al cerrar')), h('td.der', ''), h('td.der', ''), h('td.der', ''), h('td.der', '')];
      const ef = efectivoVendido(t, sinDato);
      const tj = Number(t.contado_tarjeta || 0), sp = Number(t.contado_sinpe || 0), tr = Number(t.contado_transferencia || 0);
      const sin = () => h('span.tenue', 'Sin dato');
      return [h('td.der', ef == null ? sin() : money(ef)), h('td.der', money(tj)), h('td.der', money(sp)), h('td.der', money(tr)), h('td.der', ef == null ? sin() : h('b', money(r2(ef + tj + sp + tr))))];
    }

    function seccionHistorial() {
      if (!historial.length) return h('section.col', h('h2', 'Turnos anteriores'), h('div.vacio', 'Todavía no hay turnos.'));
      const filas = historial.map((t) => {
        const abierto = !t.cerrado_en;
        const cruza = t.cerrado_en && fechaCorta(t.abierto_en) !== fechaCorta(t.cerrado_en);
        const sinDato = !abierto && t.esperado_efectivo == null;
        const dif = !abierto && !sinDato ? (t.diferencia_efectivo != null ? Number(t.diferencia_efectivo) : r2(Number(t.contado_efectivo) - Number(t.esperado_efectivo))) : null;
        return h('tr',
          h('td', fechaHora(t.abierto_en)),
          h('td', abierto ? h('span.chip.ok', 'Abierta') : [fechaHora(t.cerrado_en), h('div.tenue.noche', 'Duró ' + duracion(t.abierto_en, t.cerrado_en) + (cruza ? ' · cruzó la medianoche' : ''))]),
          h('td', t.abierto_por || ''),
          h('td.der', money(t.fondo_inicial)),
          h('td.der', abierto ? h('span.tenue', 'Al cerrar') : sinDato ? h('span.tenue', 'Sin dato') : money(t.esperado_efectivo)),
          h('td.der', abierto ? h('span.tenue', 'Al cerrar') : money(t.contado_efectivo)),
          h('td', abierto ? h('span.tenue', 'En curso') : sinDato ? h('span.tenue', 'Sin dato') : [chipDif(dif), (t.discrepancia || (dif != null && cents(dif) !== 0)) ? h('div', h('span.chip.espera', 'Con diferencia')) : null]),
          ...ventasFila(t, abierto, sinDato),
          h('td', h('button.btn.chico', { type: 'button', 'aria-label': 'Ver resumen del turno del ' + fechaHora(t.abierto_en), onclick: () => verDetalle(t) }, 'Ver resumen')));
      });
      return h('section.col',
        h('div.hist-cab', h('h2', 'Turnos anteriores'), crearDescarga(() => opcionesHistorial(), { texto: 'Descargar', etiqueta: 'Descargar la lista de turnos anteriores' })),
        h('p.tenue', 'Del más reciente al más antiguo. Las horas son de Costa Rica. Lo vendido por cada medio lo registra el sistema; solo el efectivo se cuenta a mano.'),
        conPistaDesliz(h('div.tabla-caja', h('table.tabla.hist',
          h('thead', h('tr', ['Abrió', 'Cerró', 'Abierta por', 'Fondo', 'Debe haber en caja', 'Contado', 'Diferencia', 'Vendido en efectivo', 'Vendido con tarjeta', 'Vendido por SINPE', 'Vendido por transferencia', 'Total vendido', ''].map((x, i) => h('th' + (i === 3 || i === 4 || i === 5 || i >= 7 && i <= 11 ? '.der' : ''), x)))),
          h('tbody', filas))), 'Deslice la tabla hacia los lados para ver más columnas: lo vendido por cada medio, el total y el botón «Ver resumen».'));
    }

    // Lo que se descarga: los mismos turnos de la tabla (los últimos 30), del más antiguo al más reciente, con las mismas cifras que se ven.
    function opcionesHistorial() {
      const lista = historial.slice().sort((a, b) => new Date(a.abierto_en) - new Date(b.abierto_en));
      if (!lista.length) return { filas: [] };
      const primero = lista[0], ultimo = lista[lista.length - 1];
      const ymd = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Costa_Rica' }).format(new Date(iso));
      const desde = ymd(primero.abierto_en), hasta = ymd(ultimo.cerrado_en || ultimo.abierto_en);
      return {
        nombre: 'Turnos de caja ' + nombrePeriodo(desde, hasta),
        empresa: nombreLocal(soc), cedula: soc?.cedula || '',
        titulo: 'Turnos de caja',
        subtitulo: `Los últimos ${lista.length} ${lista.length === 1 ? 'turno' : 'turnos'}, del ${fechaHora(primero.abierto_en)} al ${fechaHora(ultimo.cerrado_en || ultimo.abierto_en)}`,
        cifras: 'brutas', cifrasNota: 'Montos en colones. Es lo cobrado en la caja, sin descontar lo que Hacienda no aceptó; solo el efectivo se cuenta a mano',
        columnas: [
          { clave: 'abrio', titulo: 'Abrió (fecha y hora)', tipo: 'fechahora' },
          { clave: 'cerro', titulo: 'Cerró (fecha y hora)', tipo: 'fechahora' },
          { clave: 'dura', titulo: 'Duración', tipo: 'texto', enPdf: false },
          { clave: 'por', titulo: 'Abierta por', tipo: 'texto' },
          { clave: 'cerroPor', titulo: 'Cerrada por', tipo: 'texto', enPdf: false },
          { clave: 'fondo', titulo: 'Fondo (₡)', tipo: 'moneda', enPdf: false },
          { clave: 'entradas', titulo: 'Entradas de efectivo (₡)', tipo: 'moneda', enPdf: false },
          { clave: 'salidas', titulo: 'Salidas de efectivo (₡)', tipo: 'moneda', enPdf: false },
          { clave: 'devol', titulo: 'Devoluciones en efectivo (₡)', tipo: 'moneda', enPdf: false },
          { clave: 'esperado', titulo: 'Debe haber en caja (₡)', tipo: 'moneda' },
          { clave: 'contado', titulo: 'Contado (₡)', tipo: 'moneda' },
          { clave: 'dif', titulo: 'Diferencia (₡)', tipo: 'moneda' },
          { clave: 'ef', titulo: 'Vendido en efectivo (₡)', tipo: 'moneda' },
          { clave: 'tj', titulo: 'Vendido con tarjeta (₡)', tipo: 'moneda' },
          { clave: 'sp', titulo: 'Vendido por SINPE (₡)', tipo: 'moneda' },
          { clave: 'tr', titulo: 'Vendido por transferencia (₡)', tipo: 'moneda' },
          { clave: 'total', titulo: 'Total vendido (₡)', tipo: 'moneda' },
          { clave: 'estado', titulo: 'Estado', tipo: 'texto' },
          { clave: 'notas', titulo: 'Notas del cierre', tipo: 'texto', enPdf: false }],
        filas: lista.map((t) => {
          const abierto = !t.cerrado_en, sinDato = !abierto && t.esperado_efectivo == null;
          const dif = !abierto && !sinDato ? (t.diferencia_efectivo != null ? Number(t.diferencia_efectivo) : r2(Number(t.contado_efectivo) - Number(t.esperado_efectivo))) : null;
          const ef = abierto ? null : efectivoVendido(t, sinDato);
          const sinMedios = abierto || sinDato; // un turno viejo sin datos del cierre deja vacíos los medios, no en cero
          const tj = sinMedios ? null : Number(t.contado_tarjeta || 0), sp = sinMedios ? null : Number(t.contado_sinpe || 0), tr = sinMedios ? null : Number(t.contado_transferencia || 0);
          return {
            abrio: t.abierto_en, cerro: t.cerrado_en || '', dura: abierto ? '' : duracion(t.abierto_en, t.cerrado_en), por: t.abierto_por || '', cerroPor: t.cerrado_por || '',
            fondo: Number(t.fondo_inicial || 0), entradas: abierto ? '' : Number(t.entradas_total || 0), salidas: abierto ? '' : Number(t.salidas_total || 0), devol: abierto ? '' : Number(t.devoluciones_efectivo || 0),
            esperado: abierto || sinDato ? '' : Number(t.esperado_efectivo), contado: abierto ? '' : (t.contado_efectivo == null ? '' : Number(t.contado_efectivo)), dif: dif == null ? '' : dif,
            ef: ef == null ? '' : ef, tj: tj ?? '', sp: sp ?? '', tr: tr ?? '', total: ef == null ? '' : r2(ef + tj + sp + tr),
            estado: abierto ? 'Abierta' : (t.discrepancia || (dif != null && cents(dif) !== 0) ? 'Cerrada con diferencia' : sinDato ? 'Cerrada, sin dato del efectivo' : 'Cerrada'), notas: t.notas || '',
          };
        }),
        totales: { ef: 'suma', tj: 'suma', sp: 'suma', tr: 'suma', total: 'suma', dif: 'suma' },
        notas: ['Ordenado del turno más antiguo al más reciente. Un turno abierto todavía no tiene cifras de cierre.', 'Una diferencia negativa es efectivo que faltó; positiva, que sobró.'],
      };
    }

    async function verDetalle(t) {
      let e;
      try { e = await api.turnoEstado(t.id); } catch (er) { toast(conPunto(textoError(er, 'No se pudo abrir el resumen de ese turno. Revise la conexión e intente de nuevo.')), 'error'); return; }
      const d = datosResumen(e);
      modal({ titulo: 'Resumen del turno', ancho: 760, contenido: nodoPantalla(d),
        botones: [{ texto: 'Cerrar', onclick: (c) => c() }, { texto: 'Imprimir resumen', clase: 'primario', onclick: () => imprimirNodo(nodoImpresion(d, soc)) }] });
    }

    const alCambio = () => { if (vivo && !final && (app.turno?.id || null) !== turnoVisto) cargar(); };
    document.addEventListener('app:cambio', alCambio);

    await cargar();
    return () => { vivo = false; soltarZona(); document.removeEventListener('app:cambio', alCambio); };
  },
};
