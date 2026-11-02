// Contabilidad, pestaña «Libro» (fase 2): primero el día de hoy (qué se vendió y cómo quedaría el asiento), después el libro diario del período,
// el asiento manual, la balanza de comprobación y los períodos. Las cifras vienen de las funciones fx_contable_*; aquí no se calcula contabilidad.
import { h, money, fechaCorta, hoyCR, sumaDias, esqueleto, bloqueError, textoDeError, toast, conBoton, confirmar, pedir } from './util.js';
import { selectorPeriodo, fechaLarga, fechaDMA, textoRango } from './periodo.js';
import { hoy, ventasDiaRegistrar, asientoManual, asientoReversar, diario, balanza, mayor, periodos, periodoEstado, catalogo } from './api_contable.js';
import { ROLES } from './c_catalogo.js';

const ORIGEN = { manual: 'Manual', ventas_dia: 'Ventas del día', compra: 'Compra', planilla: 'Planilla', caja: 'Caja', reversa: 'Reversa', ajuste: 'Ajuste' };
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const cifra = (t, v, n) => h('div.con-cifra', h('div.t', t), h('div.v', v), n ? h('div.n', n) : null);
const dm = (n) => (Number(n) ? money(n) : '');

export default {
  id: 'libro', texto: 'Libro',
  async montar(cont, ctx) {
    const { soc, memoria } = ctx;
    const bHoy = h('div.con-bloque'), bDiario = h('div.con-bloque'), bManual = h('details.con-bloque'), bBalanza = h('details.con-bloque'), bPeriodos = h('details.con-bloque');
    cont.append(h('div.con-raiz', bHoy, bDiario, bManual, bBalanza, bPeriodos));
    let dia = memoria.libroDia || hoyCR();
    let fichaHoy = 0, fichaDiario = 0; // cada carga lleva su número: la respuesta de una anterior se descarta

    /* ---------- Hoy ---------- */
    async function cargarHoy() {
      const mi = ++fichaHoy;
      bHoy.replaceChildren(h('h2', 'El día'), esqueleto(2, 'Revisando las ventas del día…'));
      let d;
      try { d = await hoy(soc.id, dia); } catch (e) { if (mi === fichaHoy) bHoy.replaceChildren(h('h2', 'El día'), bloqueError({ titulo: 'No se pudo revisar el día', mensaje: textoDeError(e), alReintentar: cargarHoy })); return; }
      if (mi !== fichaHoy) return;
      const c = d.calculo, lineas = c.lineas || [];
      const sel = h('input.campo', { type: 'date', value: dia, max: hoyCR(), 'aria-label': 'Día que se revisa', onchange: (e) => { if (e.target.value) { dia = e.target.value; memoria.libroDia = dia; cargarHoy(); } } });
      const mover = (n) => h('button.btn.chico', { type: 'button', 'aria-label': n < 0 ? 'Día anterior' : 'Día siguiente', disabled: n > 0 && dia >= hoyCR(), onclick: () => { dia = sumaDias(dia, n); memoria.libroDia = dia; cargarHoy(); } }, n < 0 ? '‹ Día anterior' : 'Día siguiente ›');
      const estado = d.asiento_id ? h('span.chip.ok', 'Contabilizado en el asiento ' + d.asiento_numero) : lineas.length ? h('span.chip.mal', 'Sin contabilizar') : h('span.chip', 'Sin ventas aceptadas');
      const tabla = lineas.length ? h('div.tabla-caja', h('table.con-tabla', h('thead', h('tr', h('th', 'Cuenta'), h('th.der', 'Debe'), h('th.der', 'Haber'))),
        h('tbody', lineas.map((l) => h('tr', h('td', ROLES[l.rol] || l.rol), h('td.der', l.monto > 0 ? money(l.monto) : ''), h('td.der', l.monto < 0 ? money(-l.monto) : '')))),
        h('tfoot', h('tr.con-grupo', h('td', 'Totales'), h('td.der', money(lineas.filter((l) => l.monto > 0).reduce((s, l) => s + l.monto, 0))), h('td.der', money(-lineas.filter((l) => l.monto < 0).reduce((s, l) => s + l.monto, 0))))))) : null;
      const avisos = [];
      if (c.pendientes_hacienda > 0) avisos.push(h('p.con-nota', c.pendientes_hacienda + ' documento(s) siguen pendientes de respuesta de Hacienda y no entran todavía: se suman cuando queden aceptados.'));
      if (c.rechazados > 0) avisos.push(h('p.con-nota', c.rechazados + ' documento(s) fueron rechazados por Hacienda y no se contabilizan.'));
      if (!d.periodo_abierto) avisos.push(h('p.con-nota.con-mas', 'El período de este día está cerrado: no recibe asientos.'));
      const puede = lineas.length && d.periodo_abierto && !d.asiento_id;
      bHoy.replaceChildren(
        h('div.con-fila', h('h2', { style: 'flex:1' }, fechaLarga(dia)), estado),
        h('div.con-fila', mover(-1), sel, mover(1)),
        h('div.con-cifras', { style: 'margin:.8rem 0' },
          cifra('Documentos aceptados', String(c.n_documentos)), cifra('Ventas sin IVA', money(c.ventas_sin_iva), 'netas, antes de notas de crédito'),
          cifra('Notas de crédito sin IVA', money(c.devoluciones_sin_iva)), cifra('IVA de ventas del día', money(c.iva_debito_neto), 'neto de notas de crédito')),
        lineas.length ? h('p.con-ayuda', d.asiento_id ? 'Así quedó el asiento de este día:' : 'Así quedaría el asiento de este día:') : h('p.con-ayuda', 'No hay ventas aceptadas por Hacienda este día, así que no hay nada que contabilizar.'),
        tabla, avisos,
        h('div.con-acciones',
          puede ? h('button.btn.primario.grande', { type: 'button', onclick: (e) => conBoton(e.currentTarget, () => registrar(dia, dia)) }, 'Contabilizar este día') : null,
          d.asiento_id && lineas.length ? h('button.btn', { type: 'button', onclick: (e) => conBoton(e.currentTarget, () => registrar(dia, dia)) }, 'Revisar si cambió la facturación') : null,
          d.sin_contabilizar > 0 ? h('button.btn', { type: 'button', onclick: (e) => conBoton(e.currentTarget, () => registrar(sumaDias(hoyCR(), -30), sumaDias(hoyCR(), -1))) },
            'Contabilizar los ' + d.sin_contabilizar + ' días anteriores que faltan') : null));
    }
    async function registrar(desde, hasta) {
      try {
        const r = await ventasDiaRegistrar(soc.id, desde, hasta);
        const n = r.filter((x) => x.estado === 'nuevo' || x.estado === 'actualizado').length, err = r.filter((x) => x.estado === 'error');
        toast(n ? n + (n === 1 ? ' día contabilizado' : ' días contabilizados') : 'Todo estaba al día', err.length ? 'error' : 'ok');
        if (err.length) toast(err[0].mensaje, 'error', 6000);
      } catch (e) { toast(textoDeError(e), 'error'); }
      await Promise.all([cargarHoy(), cargarDiario()]);
    }

    /* ---------- Libro diario ---------- */
    const periodo = selectorPeriodo({ inicial: memoria.libroPeriodo || 'mes', alCambiar: ([d, a], id) => { memoria.libroPeriodo = id; rango = [d, a]; cargarDiario(); cargarBalanza(); } });
    let rango = periodo.rango();
    let filtroQ = memoria.libroQ || '';
    async function cargarDiario() {
      const mi = ++fichaDiario;
      const lista = h('div'); bDiario.replaceChildren(encabezadoDiario(), lista); lista.append(esqueleto(2, 'Cargando el libro diario…'));
      let r;
      try { r = await diario(soc.id, rango[0], rango[1], filtroQ || null); } catch (e) { if (mi === fichaDiario) lista.replaceChildren(bloqueError({ titulo: 'No se pudo cargar el libro diario', mensaje: textoDeError(e), alReintentar: cargarDiario })); return; }
      if (mi !== fichaDiario) return;
      const as = r.asientos || [];
      lista.replaceChildren(
        r.ambiente !== 'produccion' ? h('p.con-nota', 'Asientos de PRUEBAS (' + r.ambiente + '): no son cifras reales.') : null,
        as.length ? h('div', as.map(filaAsiento)) : h('div.con-vacio', 'No hay asientos en ' + textoRango(rango[0], rango[1]) + '.'));
    }
    function encabezadoDiario() {
      const q = h('input.campo', { type: 'search', placeholder: 'Buscar por concepto o número', value: filtroQ, 'aria-label': 'Buscar en el libro diario',
        onchange: (e) => { filtroQ = e.target.value.trim(); memoria.libroQ = filtroQ; cargarDiario(); } });
      return h('div', h('h2', 'Libro diario'), h('p.con-ayuda', 'Los asientos del período, del más antiguo al más reciente. Toque uno para ver sus líneas o reversarlo.'), periodo.el, h('div', { style: 'margin-top:.6rem' }, q));
    }
    function filaAsiento(a) {
      const reversado = a.estado === 'reversado';
      const motivo = h('input.campo', { type: 'text', placeholder: 'Motivo de la reversa', 'aria-label': 'Motivo de la reversa' });
      const puedeRev = !reversado && a.origen !== 'reversa';
      return h('details.con-asiento', { style: 'border-bottom:1px solid var(--linea)' },
        h('summary', h('span.con-codigo', '#' + a.numero + ' · ' + fechaDMA(a.fecha)), ' ', a.concepto, ' ', h('span.chip' + (reversado ? '.mal' : ''), reversado ? 'Reversado' : ORIGEN[a.origen] || a.origen), ' ', h('strong', money(a.total))),
        h('div.tabla-caja', h('table.con-tabla', h('thead', h('tr', h('th', 'Cuenta'), h('th.der', 'Debe'), h('th.der', 'Haber'))),
          h('tbody', (a.lineas || []).map((l) => h('tr', h('td', h('span.con-codigo', l.codigo), ' ', l.cuenta, l.detalle ? h('div.con-nota', l.detalle) : null), h('td.der', dm(l.debe)), h('td.der', dm(l.haber))))))),
        puedeRev ? h('div.con-fila', { style: 'margin:.5rem 0 .8rem' }, motivo, h('button.btn.peligro', { type: 'button', onclick: (e) => conBoton(e.currentTarget, async () => {
          if (motivo.value.trim().length < 3) { toast('Escriba el motivo de la reversa', 'error'); motivo.focus(); return; }
          try { await asientoReversar(soc.id, a.id, motivo.value.trim()); toast('Asiento reversado'); await Promise.all([cargarHoy(), cargarDiario(), cargarBalanza()]); } catch (er) { toast(textoDeError(er), 'error'); }
        }) }, 'Reversar este asiento')) : null,
        a.creado_por ? h('p.con-nota', 'Registrado por ' + a.creado_por) : null);
    }

    /* ---------- Asiento manual ---------- */
    let cuentas = null;
    async function montarManual() {
      bManual.replaceChildren(h('summary', 'Asiento manual'), h('p.con-ayuda', 'Para lo que no viene de una factura: aportes de capital, ajustes, pagos del banco. Debe y haber tienen que sumar igual.'));
      const f = { fecha: h('input.campo', { type: 'date', value: hoyCR(), 'aria-label': 'Fecha del asiento' }), concepto: h('input.campo', { type: 'text', placeholder: 'Qué se registra', maxlength: 300, 'aria-label': 'Concepto' }) };
      const filas = h('div'); const resumen = h('p.con-nota'); let guardar;
      const nuevaFila = () => {
        const sel = h('select.campo', { 'aria-label': 'Cuenta' }, h('option', { value: '' }, 'Escoja la cuenta'), (cuentas || []).filter((c) => c.imputable && c.activa).map((c) => h('option', { value: c.id }, c.codigo + ' ' + c.nombre)));
        const d = h('input.campo', { type: 'text', inputmode: 'decimal', placeholder: 'Debe', 'aria-label': 'Debe', oninput: calc }), hh = h('input.campo', { type: 'text', inputmode: 'decimal', placeholder: 'Haber', 'aria-label': 'Haber', oninput: calc });
        const fila = h('div.con-fila', { style: 'margin-bottom:.4rem' }, h('div', { style: 'flex:2;min-width:200px' }, sel), h('div', { style: 'flex:1;min-width:100px' }, d), h('div', { style: 'flex:1;min-width:100px' }, hh));
        fila._v = () => ({ cuenta_id: sel.value, debe: num(d.value), haber: num(hh.value) });
        return fila;
      };
      const num = (t) => { const n = Number(String(t || '').replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
      function calc() {
        const v = [...filas.children].map((x) => x._v()); const D = v.reduce((s, x) => s + x.debe, 0), H = v.reduce((s, x) => s + x.haber, 0), dif = Math.round((D - H) * 100) / 100;
        resumen.textContent = 'Debe ' + money(D) + ' · Haber ' + money(H) + (dif === 0 && D > 0 ? ' · Cuadra' : ' · Diferencia ' + money(dif));
        resumen.className = 'con-nota ' + (dif === 0 && D > 0 ? 'con-menos' : 'con-mas');
        guardar.disabled = !(dif === 0 && D > 0);
      }
      guardar = h('button.btn.primario', { type: 'button', disabled: true, onclick: (e) => conBoton(e.currentTarget, async () => {
        const v = [...filas.children].map((x) => x._v()).filter((x) => x.cuenta_id && (x.debe || x.haber));
        try { const r = await asientoManual(soc.id, f.fecha.value, f.concepto.value.trim(), v); toast('Asiento ' + r.numero + ' registrado'); montarManual(); await Promise.all([cargarHoy(), cargarDiario(), cargarBalanza()]); }
        catch (er) { toast(textoDeError(er), 'error'); }
      }) }, 'Registrar el asiento');
      filas.append(nuevaFila(), nuevaFila());
      bManual.append(h('div.con-form', h('label.etq', 'Fecha', f.fecha), h('label.etq', 'Concepto', f.concepto)), h('div', { style: 'margin-top:.7rem' }, filas),
        h('div.con-acciones', h('button.btn', { type: 'button', onclick: () => { filas.append(nuevaFila()); } }, 'Agregar una línea'), guardar), resumen);
      calc();
    }
    bManual.addEventListener('toggle', async () => { if (bManual.open && !cuentas) { try { cuentas = (await catalogo(soc.id)).cuentas; } catch (e) { toast(textoDeError(e), 'error'); return; } montarManual(); } });
    bManual.append(h('summary', 'Asiento manual'));

    /* ---------- Balanza ---------- */
    async function cargarBalanza() {
      if (!bBalanza.open) return;
      bBalanza.replaceChildren(h('summary', 'Balanza de comprobación'), esqueleto(2, 'Calculando la balanza…'));
      let r;
      try { r = await balanza(soc.id, rango[0], rango[1]); } catch (e) { bBalanza.replaceChildren(h('summary', 'Balanza de comprobación'), bloqueError({ titulo: 'No se pudo calcular la balanza', mensaje: textoDeError(e), alReintentar: cargarBalanza })); return; }
      const cu = r.cuentas || [];
      const cuerpoTabla = h('tbody');
      for (const c of cu) {
        const det = h('tr', { hidden: true }, h('td', { colspan: 5 }));
        cuerpoTabla.append(h('tr.con-toque', { tabindex: 0, role: 'button', 'aria-label': 'Ver el movimiento de ' + c.nombre, onclick: () => verMayor(c, det), onkeydown: (e) => { if (e.key === 'Enter') verMayor(c, det); } },
          h('td', h('span.con-codigo', c.codigo), ' ', c.nombre), h('td.der', dm(c.saldo_inicial)), h('td.der', dm(c.debe)), h('td.der', dm(c.haber)), h('td.der', money(c.saldo_final))), det);
      }
      bBalanza.replaceChildren(h('summary', 'Balanza de comprobación'),
        h('p.con-ayuda', 'Saldos de cada cuenta en ' + textoRango(rango[0], rango[1]) + ' (positivo = saldo deudor; negativo = acreedor). Toque una cuenta para ver su movimiento.'),
        cu.length ? h('div.tabla-caja', h('table.con-tabla', h('thead', h('tr', h('th', 'Cuenta'), h('th.der', 'Saldo inicial'), h('th.der', 'Debe'), h('th.der', 'Haber'), h('th.der', 'Saldo final'))), cuerpoTabla,
          h('tfoot', h('tr.con-grupo', h('td', 'Totales del período'), h('td'), h('td.der', money(r.total_debe)), h('td.der', money(r.total_haber)), h('td.der', r.total_debe === r.total_haber ? 'Cuadra' : 'No cuadra'))))) : h('div.con-vacio', 'No hay movimientos en el período.'));
    }
    async function verMayor(c, fila) {
      if (!fila.hidden) { fila.hidden = true; return; }
      fila.hidden = false; const td = fila.firstChild; td.replaceChildren(esqueleto(1, 'Cargando el movimiento…'));
      try {
        const r = await mayor(soc.id, c.cuenta_id, rango[0], rango[1]);
        td.replaceChildren(h('table.con-tabla', h('thead', h('tr', h('th', 'Fecha'), h('th', 'Asiento'), h('th.der', 'Debe'), h('th.der', 'Haber'), h('th.der', 'Saldo'))),
          h('tbody', r.movimientos.map((m) => h('tr', h('td', fechaDMA(m.fecha)), h('td', '#' + m.numero + ' ' + m.concepto), h('td.der', dm(m.debe)), h('td.der', dm(m.haber)), h('td.der', money(m.saldo)))))));
      } catch (e) { td.replaceChildren(h('p.con-mas', textoDeError(e))); }
    }
    bBalanza.addEventListener('toggle', () => { if (bBalanza.open) cargarBalanza(); });
    bBalanza.append(h('summary', 'Balanza de comprobación'));

    /* ---------- Períodos ---------- */
    async function cargarPeriodos() {
      bPeriodos.replaceChildren(h('summary', 'Cierre de períodos'), esqueleto(1, 'Cargando…'));
      let r;
      try { r = await periodos(soc.id); } catch (e) { bPeriodos.replaceChildren(h('summary', 'Cierre de períodos'), bloqueError({ titulo: 'No se pudieron cargar los períodos', mensaje: textoDeError(e), alReintentar: cargarPeriodos })); return; }
      bPeriodos.replaceChildren(h('summary', 'Cierre de períodos'),
        h('p.con-ayuda', 'Un mes cerrado ya no recibe asientos nuevos. Si hay que corregirlo, se reabre dejando escrito el motivo. Del más antiguo al más reciente.'),
        h('div.tabla-caja', h('table.con-tabla', h('thead', h('tr', h('th', 'Mes'), h('th.der', 'Asientos'), h('th', 'Estado'), h('th', ''))),
          h('tbody', r.map((p) => h('tr', h('td', MESES[p.mes - 1] + ' ' + p.anio), h('td.der', String(p.asientos)), h('td', h('span.chip' + (p.estado === 'cerrado' ? '.ok' : ''), p.estado === 'cerrado' ? 'Cerrado' : 'Abierto'), p.cerrado_por ? h('span.con-nota', ' por ' + p.cerrado_por) : null),
            h('td', p.estado === 'cerrado' ? h('button.btn.chico', { type: 'button', onclick: (e) => conBoton(e.currentTarget, () => cambiar(p, false)) }, 'Reabrir') : h('button.btn.chico', { type: 'button', onclick: (e) => conBoton(e.currentTarget, () => cambiar(p, true)) }, 'Cerrar el mes'))))))));
    }
    async function cambiar(p, cerrar) {
      let nota = null;
      if (cerrar) { if (!(await confirmar('Al cerrar ' + MESES[p.mes - 1] + ' ' + p.anio + ' no se podrán registrar más asientos en ese mes. ¿Cerrarlo?', { si: 'Sí, cerrar el mes' }))) return; }
      else { nota = await pedir({ titulo: 'Reabrir ' + MESES[p.mes - 1] + ' ' + p.anio, etiqueta: 'Motivo para reabrir el período', boton: 'Reabrir el mes' }); if (!nota) return; }
      try { await periodoEstado(soc.id, p.anio, p.mes, cerrar, nota); toast(cerrar ? 'Mes cerrado' : 'Mes reabierto'); await cargarPeriodos(); await cargarHoy(); }
      catch (e) { toast(textoDeError(e), 'error'); }
    }
    bPeriodos.addEventListener('toggle', () => { if (bPeriodos.open) cargarPeriodos(); });
    bPeriodos.append(h('summary', 'Cierre de períodos'));

    await Promise.all([cargarHoy(), cargarDiario()]);
  },
};
