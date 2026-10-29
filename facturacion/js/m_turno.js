// Cierre de caja: solo se cuenta el EFECTIVO. Debe haber en caja = fondo + ventas en efectivo - salidas - devoluciones en efectivo por notas de crédito.
import { h, money, leerNumero, r2, toast, modal, conBoton, fechaHora, fechaCorta, horaCorta, esqueleto, bloqueError, nombreLocal, conPistaDesliz, hoyCR, TIPOS_SERVICIO, MEDIOS } from './util.js';
import { esTransitorio } from './api.js';
import { abrirSalidas, anularSalida, listaSalidas } from './ui_salidas.js';

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

const OTROS = ['tarjeta', 'sinpe', 'transferencia'];
const TODOS = ['efectivo', 'tarjeta', 'sinpe', 'transferencia'];
const cents = (n) => Math.round((Number(n) || 0) * 100);
const numCuenta = (n) => '#' + String(n || '').split('-').pop();

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
  // Efectivo devuelto por notas de crédito durante el turno (fx_turno_estado.devoluciones_efectivo). Si el servidor todavía no lo manda, la fila no se muestra.
  const devoluciones = est.devoluciones_efectivo != null ? Number(est.devoluciones_efectivo) : null;
  const esperado = r2(Number(est.esperado_efectivo ?? (fondo + efVentas - totSal - (devoluciones || 0))));
  const contado = cerrado ? Number(est.contado_efectivo ?? t.contado_efectivo ?? 0) : null;
  const dif = cerrado ? r2(est.diferencia_efectivo != null ? Number(est.diferencia_efectivo) : contado - esperado) : null;
  return {
    t, cerrado, fondo, efVentas, salidas, totSal, devoluciones, esperado, contado, dif,
    discrepancia: cerrado ? cents(dif) !== 0 : null,
    otros: OTROS.map((m) => ({ medio: m, monto: Number(pm[m] || 0) })),
    porMedio: TODOS.map((m) => ({ medio: m, monto: Number(pm[m] || 0) })),
    ventas: Number(est.ventas || 0), totalVentas: Number(est.total_ventas || 0),
    notasCredito: Number(est.notas_credito || 0), sinAceptar: Number(est.sin_aceptar || 0),
    anuladasN: Number(est.ventas_anuladas_n || 0), anuladasTotal: Number(est.ventas_anuladas_total || 0),
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

// Filas de la cuenta: abrió + ventas - salidas = debe haber
function bloqueCalculo(d, { alAnularSalida, extra } = {}) {
  return h('div.calc',
    h('div.calc-fila', h('span', h('span.op', ''), 'Efectivo con que abrió la caja'), h('span.v', money(d.fondo))),
    h('div.calc-fila', h('span', h('span.op', '+'), 'Ventas en efectivo'), h('span.v', money(d.efVentas))),
    h('div.calc-fila', h('span', h('span.op', '−'), 'Salidas de efectivo'), h('span.v', money(d.totSal))),
    d.salidas.length || alAnularSalida ? h('div.calc-sub', listaSalidas(d.salidas, alAnularSalida)) : null,
    d.devoluciones != null ? h('div.calc-fila', h('span', h('span.op', '−'), 'Efectivo de ventas anuladas con nota de crédito', d.devoluciones > 0 ? h('small.calc-nota', 'Efectivo de ventas anuladas con nota de crédito en este turno. Se resta porque ese dinero debe haber salido de la caja.') : null), h('span.v', money(d.devoluciones))) : null,
    h('div.calc-fila.total', h('span', h('span.op', '='), 'Debe haber en caja'), h('span.v', money(d.esperado))),
    extra);
}

// Lo vendido en el turno por cada medio de pago, calculado por el sistema
function bloqueVentas(d, { alVer } = {}) {
  return h('div.tarjeta.col',
    h('div.fila.sep', h('h3', 'Vendido en el turno'), h('span.chip.ok', 'Registrado automáticamente por el sistema')),
    h('div.ventas-medios',
      d.porMedio.map((o) => h('div.dato', h('div.et', MEDIOS[o.medio]), h('div.val', money(o.monto)))),
      h('div.dato.total', h('div.et', 'Total vendido'), h('div.val', money(d.totalVentas)), h('div.det', d.ventas + (d.ventas === 1 ? ' venta' : ' ventas') + ', IVA incluido'))),
    d.rechazadasN > 0 ? h('div.aviso-rechazadas', { role: 'note' }, h('span', textoRechazadas(d)), alVer ? h('button.btn.chico', { type: 'button', onclick: alVer }, 'Ver esos documentos') : null) : null,
    d.anuladasN > 0 ? h('p.tenue-linea', `De ese total, ${d.anuladasN} ${d.anuladasN === 1 ? 'venta se anuló' : 'ventas se anularon'} con nota de crédito (${money(d.anuladasTotal)}). Sin esas ventas anuladas, lo vendido es ${money(r2(d.totalVentas - d.anuladasTotal))}.`) : null,
    h('p.tenue-linea', 'Solo el efectivo se cuenta a mano. Tarjeta, SINPE Móvil y transferencia los suma el sistema con cada cobro.'));
}

// Resumen para la pantalla
function nodoPantalla(d) {
  const t = d.t;
  return h('div.col',
    h('div.turno-datos',
      h('div.dato', h('div.et', 'Abrió'), h('div.val', fechaPartida(t.abierto_en)), h('div.det', t.abierto_por || '')),
      h('div.dato', h('div.et', 'Cerró'), h('div.val', t.cerrado_en ? fechaPartida(t.cerrado_en) : 'Sigue abierta'), h('div.det', t.cerrado_en ? (t.cerrado_por || '') + ' · duró ' + duracion(t.abierto_en, t.cerrado_en) : 'Lleva ' + duracion(t.abierto_en, new Date()))),
      h('div.dato', h('div.et', 'Notas de crédito'), h('div.val', money(d.notasCredito)), h('div.det', 'Durante el turno'))),
    bloqueVentas(d),
    h('div.tarjeta',
      h('h3', 'Efectivo en la caja'),
      bloqueCalculo(d),
      d.cerrado ? h('div.calc',
        h('div.calc-fila', h('span', 'Efectivo contado al cerrar'), h('span.v', money(d.contado))),
        h('div.calc-fila', h('span', 'Diferencia'), h('span.v', chipDif(d.dif)))) : null),
    d.cerrado && d.discrepancia ? h('div.alerta-dif.' + (cents(d.dif) < 0 ? 'falta' : 'sobra'), 'Este cierre quedó con discrepancia: ' + textoDif(d.dif).toLowerCase() + '.') : null,
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
    h('hr'),
    h('div.c', h('b', 'EFECTIVO EN LA CAJA')),
    fila('Efectivo con que abrió', money(d.fondo)),
    fila('+ Ventas en efectivo', money(d.efVentas)),
    fila('- Salidas de efectivo', money(d.totSal)),
    d.salidas.map((s) => h('div.f.sal', h('span', '  ' + s.motivo), h('span', money(s.monto)))),
    d.devoluciones != null ? fila('- Ventas anuladas en efectivo', money(d.devoluciones)) : null,
    fila('= Debe haber en caja', money(d.esperado)),
    d.cerrado ? fila('Efectivo contado', money(d.contado)) : null,
    d.cerrado ? fila('Diferencia', textoDif(d.dif)) : null,
    d.cerrado && d.discrepancia ? h('div.c.g', 'CON DISCREPANCIA') : null,
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
    try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { toast('No se pudo abrir la impresión: ' + e.message, 'error'); f.remove(); }
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
    let turnoVisto = null;
    let est = null, abiertas = [], historial = [];
    let contadoTxt = '';
    let notas = '';
    const contenedor = h('div.turno');
    root.append(contenedor);

    async function cargar() {
      turnoVisto = app.turno?.id || null;
      contenedor.replaceChildren(esqueleto(4, 'Cargando el cierre de caja…'));
      try {
        const [e, ab, hist] = await Promise.all([
          turnoVisto ? api.turnoEstado(turnoVisto) : null,
          turnoVisto ? api.ventasAbiertas(socId) : [],
          api.turnos(socId, 30),
        ]);
        est = e; abiertas = ab || []; historial = hist || [];
      } catch (e) {
        if (!vivo) return;
        contenedor.replaceChildren(bloqueError({ titulo: 'No se pudo cargar el cierre de caja', mensaje: e.message || String(e), alReintentar: () => cargar() }));
        return;
      }
      pintar();
    }

    // Vuelve a leer solo el turno actual (después de registrar o anular una salida)
    async function recargarTurno() {
      if (!turnoVisto) return;
      try { est = await api.turnoEstado(turnoVisto); } catch (e) { toast(e.message || String(e), 'error'); return; }
      pintar();
    }

    function pintar() {
      if (!vivo) return;
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
        nodoPantalla(d),
        h('div.fila',
          h('button.btn.primario.grande', { type: 'button', onclick: () => imprimirNodo(nodoImpresion(d, soc)) }, 'Imprimir resumen del cierre'),
          h('button.btn.grande', { type: 'button', onclick: () => app.ir('caja') }, 'Abrir una caja nueva')));
    }

    function seccionSinTurno() {
      return h('section.tarjeta', h('h2', 'La caja está cerrada'), h('p', 'No hay un turno abierto en este local. Para vender hay que abrir la caja.'),
        h('button.btn.primario.grande', { type: 'button', onclick: () => app.ir('caja') }, 'Abrir la caja'));
    }

    /* ---------- Turno abierto: conteo del efectivo ---------- */
    function seccionActual() {
      const d = datosResumen(est);
      const t = d.t;
      const inp = h('input.campo.monto-grande', { type: 'text', inputmode: 'decimal', placeholder: '0', value: contadoTxt, autocomplete: 'off', 'aria-label': 'Efectivo que hay en la caja ahora' });
      const difBox = h('div');
      const leer = () => {
        const txt = contadoTxt.trim();
        if (txt === '') return null;
        const v = leerNumero(txt);
        return Number.isFinite(v) && v >= 0 ? v : NaN;
      };
      function recalcular() {
        const v = leer();
        if (v == null) difBox.replaceChildren(h('span.dif', 'Escriba lo que contó para ver si cuadra'));
        else if (Number.isNaN(v)) difBox.replaceChildren(h('span.dif.falta', 'Ese monto no es válido'));
        else difBox.replaceChildren(chipDif(r2(v - d.esperado)));
      }
      inp.addEventListener('input', () => { contadoTxt = inp.value; recalcular(); });
      const txtNotas = h('textarea.campo', { rows: 3, placeholder: 'Ej. se pagó al proveedor de hielo', value: notas, 'aria-label': 'Notas del cierre' });
      txtNotas.addEventListener('input', () => { notas = txtNotas.value; });
      const err = h('div.error-caja', { hidden: true });
      const btn = h('button.btn.primario.grande', { type: 'button' }, 'Cerrar caja');
      btn.addEventListener('click', () => conBoton(btn, async () => {
        err.hidden = true;
        const v = leer();
        if (v == null) { err.textContent = 'Escriba cuánto efectivo hay en la caja ahora. Si no hay nada, escriba 0.'; err.hidden = false; inp.focus(); return; }
        if (Number.isNaN(v)) { err.textContent = 'Ese monto no es válido. Escriba solo números, por ejemplo 15000.'; err.hidden = false; inp.focus(); return; }
        await prepararCierre(d, v, notas.trim());
      }));
      const avisoAbiertas = abiertas.length ? h('div.aviso-abiertas',
        h('strong', 'Hay ' + abiertas.length + (abiertas.length === 1 ? ' cuenta abierta sin cobrar' : ' cuentas abiertas sin cobrar')),
        h('span', 'Antes de cerrar hay que cobrarlas o anularlas.'),
        h('div.fila', h('button.btn', { type: 'button', onclick: () => app.ir('caja') }, 'Volver a Facturación a cobrarlas'))) : null;
      const alAnular = async (s) => { if (await anularSalida(api, s)) await recargarTurno(); };

      const sec = h('section.col',
        h('h2', 'Turno abierto'),
        h('div.turno-datos',
          h('div.dato', h('div.et', 'Abrió'), h('div.val', fechaPartida(t.abierto_en)), h('div.det', (t.abierto_por || '') + ' · lleva ' + duracion(t.abierto_en, new Date()))),
          h('div.dato', h('div.et', 'Notas de crédito'), h('div.val', money(d.notasCredito)), h('div.det', 'Durante el turno')),
          h('div.dato', h('div.et', 'Cuentas abiertas'), h('div.val', String(abiertas.length)), h('div.det', abiertas.length ? 'Sin cobrar' : 'Todo cobrado'))),
        d.sinAceptar ? h('div.aviso-abiertas', h('strong', d.sinAceptar + (d.sinAceptar === 1 ? ' comprobante todavía no aceptado por Hacienda' : ' comprobantes todavía no aceptados por Hacienda')), h('span', 'Esto no impide cerrar la caja. Quedan en «Anular y reimprimir».')) : null,
        avisoAbiertas,
        bloqueVentas(d, { alVer: () => app.ir('anular', { filtro: 'problemas', desde: ymdDe(t.abierto_en) < hoyCR() ? ymdDe(t.abierto_en) : null }) }),
        h('div.tarjeta',
          h('h3', 'Cuánto efectivo debe haber'),
          bloqueCalculo(d, { alAnularSalida: alAnular }),
          h('div.fila', { style: 'margin-top:.8rem' },
            h('button.btn.grande', { type: 'button', onclick: () => abrirSalidas({ api, turnoId: turnoVisto, alCambiar: recargarTurno }) }, 'Registrar salida de efectivo')),
          h('div.contado-caja',
            h('label.etq', 'Efectivo que hay en la caja ahora (₡)', h('small', 'Cuente los billetes y monedas y escriba el total.'), inp),
            difBox)),
        h('label.etq', 'Notas del cierre (opcional)', txtNotas),
        err,
        h('div.fila', btn, h('button.btn', { type: 'button', onclick: cargar }, 'Actualizar cifras')));
      recalcular();
      return sec;
    }

    /* ---------- Cerrar: revisar cuentas abiertas, discrepancia y cerrar ---------- */
    async function prepararCierre(dMostrado, contado, notasTxt) {
      // Se leen las cifras otra vez por si hubo ventas o salidas mientras se contaba
      const [fresco, lista] = await Promise.all([api.turnoEstado(turnoVisto), api.ventasAbiertas(socId)]);
      const d2 = datosResumen(fresco);
      if (cents(d2.esperado) !== cents(dMostrado.esperado)) {
        est = fresco; abiertas = lista || []; pintar();
        toast('El efectivo esperado cambió (hubo ventas o salidas mientras contaba). Revise la cifra y vuelva a tocar «Cerrar caja».', 'error', 9000);
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
      modal({ titulo: 'Confirme', ancho: 460,
        contenido: h('p.conf', 'Se anularán ' + lista.length + (lista.length === 1 ? ' cuenta' : ' cuentas') + ' por un total de ' + money(lista.reduce((s, c) => s + Number(c.total), 0)) + '. No se puede deshacer. ¿Anular y seguir con el cierre?'),
        botones: [{ texto: 'No, volver', onclick: (c) => c() }, { texto: 'Sí, anular', clase: 'peligro', onclick: async (c) => {
          if (corriendo) return; corriendo = true; c();
          try {
            for (const v of lista) await api.ventaAnular(v.id, 'Cierre de caja: cuenta sin cobrar');
            abiertas = (await api.ventasAbiertas(socId)) || [];
            toast('Cuentas anuladas.');
            if (abiertas.length) { avisarAbiertas(abiertas, d, contado, notasTxt); return; }
            await revisarDiferencia(d, contado, notasTxt);
          } catch (e) { toast(e.message || String(e), 'error', 7000); cargar(); }
        } }] });
    }

    // Si no cuadra, avisa ANTES de cerrar; siempre se permite cerrar
    async function revisarDiferencia(d, contado, notasTxt) {
      const dif = r2(contado - d.esperado);
      if (cents(dif) === 0) { await cerrarYa(contado, notasTxt); return; }
      const falta = cents(dif) < 0;
      let decidido = false;
      modal({ titulo: 'Revise el conteo', ancho: 540, alCerrar: () => {},
        contenido: h('div.col',
          h('div.alerta-dif.' + (falta ? 'falta' : 'sobra'),
            'Hay una discrepancia: ' + (falta ? 'faltan ' : 'sobran ') + money(Math.abs(cents(dif)) / 100) + '.',
            h('small', 'Debe haber ' + money(d.esperado) + ' en la caja y usted contó ' + money(contado) + '.')),
          h('p.tenue-linea', 'Puede contar otra vez o cerrar así. Si cierra, la diferencia queda registrada en el cierre.')),
        botones: [
          { texto: 'Cerrar de todos modos', clase: 'peligro', onclick: async (c) => { if (decidido) return; decidido = true; c(); await cerrarYa(contado, notasTxt); } },
          { texto: 'Volver a contar', clase: 'primario', onclick: (c) => c() }] });
    }

    let cerrando = false;
    async function cerrarYa(contado, notasTxt) {
      if (cerrando) return;
      cerrando = true;
      try {
        let res;
        try { res = await api.turnoCerrar(turnoVisto, { efectivo: contado, notas: notasTxt || null }); }
        catch (e) {
          // Si falló la red, se revisa si la caja igual quedó cerrada (así no se cierra dos veces ni se pierde el resumen)
          res = null;
          let sabe = !esTransitorio(e); // un rechazo del servidor (regla de negocio) significa que no se cerró
          if (esTransitorio(e)) { try { const t = await api.turnoEstado(turnoVisto); sabe = true; if (t?.turno?.cerrado_en) res = t; } catch { /* sin conexión: se avisa abajo */ } }
          if (!res) throw new Error((e.message || String(e)) + (sabe ? ' La caja sigue abierta; toque «Cerrar caja» para intentarlo de nuevo.' : ' No se pudo confirmar si la caja se cerró. Cuando vuelva la conexión toque «Actualizar cifras» para revisar.'));
        }
        final = res;
        contadoTxt = ''; notas = '';
        try { await app.refrescar(); } catch { /* la cabecera se actualiza sola luego */ }
        turnoVisto = null; est = null; abiertas = [];
        try { historial = (await api.turnos(socId, 30)) || []; } catch { /* queda el anterior */ }
        pintar();
        window.scrollTo({ top: 0 });
        toast('Caja cerrada.');
      } catch (e) { toast('No se pudo cerrar la caja: ' + (e.message || e), 'error', 8000); }
      finally { cerrando = false; }
    }

    /* ---------- Historial ---------- */
    // Vendido por medio de un turno cerrado: tarjeta, SINPE y transferencia quedan guardadas al cerrar; el efectivo se deduce de esperado - fondo + salidas
    function ventasFila(t, abierto, sinDato) {
      if (abierto) return [h('td.der', h('span.tenue', 'Al cerrar')), h('td.der', ''), h('td.der', ''), h('td.der', ''), h('td.der', '')];
      const ef = sinDato ? null : r2(Number(t.esperado_efectivo) - Number(t.fondo_inicial) + Number(t.salidas_total || 0) + Number(t.devoluciones_efectivo || 0));
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
          h('td', abierto ? h('span.tenue', 'En curso') : sinDato ? h('span.tenue', 'Sin dato') : [chipDif(dif), (t.discrepancia || (dif != null && cents(dif) !== 0)) ? h('div', h('span.chip.espera', 'Con discrepancia')) : null]),
          ...ventasFila(t, abierto, sinDato),
          h('td', h('button.btn.chico', { type: 'button', 'aria-label': 'Ver resumen del turno del ' + fechaHora(t.abierto_en), onclick: () => verDetalle(t) }, 'Ver resumen')));
      });
      return h('section.col',
        h('h2', 'Turnos anteriores'),
        h('p.tenue', 'Del más reciente al más antiguo. Las horas son de Costa Rica. Lo vendido por cada medio lo registra el sistema; solo el efectivo se cuenta a mano.'),
        conPistaDesliz(h('div.tabla-caja', h('table.tabla.hist',
          h('thead', h('tr', ['Abrió', 'Cerró', 'Abierta por', 'Fondo', 'Debía haber en caja', 'Contado', 'Diferencia', 'Vendido en efectivo', 'Vendido con tarjeta', 'Vendido por SINPE', 'Vendido por transferencia', 'Total vendido', ''].map((x, i) => h('th' + (i === 3 || i === 4 || i === 5 || i >= 7 && i <= 11 ? '.der' : ''), x)))),
          h('tbody', filas))), 'Deslice la tabla hacia los lados para ver más columnas: lo vendido por cada medio, el total y el botón «Ver resumen».'));
    }

    async function verDetalle(t) {
      let e;
      try { e = await api.turnoEstado(t.id); } catch (er) { toast(er.message || String(er), 'error'); return; }
      const d = datosResumen(e);
      modal({ titulo: 'Resumen del turno', ancho: 760, contenido: nodoPantalla(d),
        botones: [{ texto: 'Cerrar', onclick: (c) => c() }, { texto: 'Imprimir resumen', clase: 'primario', onclick: () => imprimirNodo(nodoImpresion(d, soc)) }] });
    }

    const alCambio = () => { if (vivo && !final && (app.turno?.id || null) !== turnoVisto) cargar(); };
    document.addEventListener('app:cambio', alCambio);

    await cargar();
    return () => { vivo = false; document.removeEventListener('app:cambio', alCambio); };
  },
};
