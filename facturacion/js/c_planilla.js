// Contabilidad, pestaña «Conciliación» (fase 7). Arriba, la caja de hoy: lo que dice el sistema frente a lo que se contó, y las salidas y entradas de efectivo para
// asignarles cuenta. Abajo, la planilla: la fuente es el comprobante mensual de la CCSS (SICERE). El sistema no calcula cargas sociales: carga lo que dice el
// comprobante, lo contabiliza y lo compara con el libro y con el mes anterior (verde si se paga menos, rojo si se paga más).
import { h, money, hoyCR, esqueleto, bloqueError, textoDeError, toast, conBoton, leerNumero, fechaHora, horaCorta } from './util.js';
import { fechaDMA } from './periodo.js';
import { llenar } from './c_comun.js';
import { catalogo, cajaDia, cajaRegistrar, planilla, planillaCargar, planillaContabilizar, planillaHistoria } from './api_contable.js';

const pct = (x) => x == null ? '—' : new Intl.NumberFormat('es-CR', { style: 'percent', maximumFractionDigits: 1 }).format(x);
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const nombreMes = (p) => { const [a, m] = p.split('-').map(Number); return MESES[m - 1] + ' ' + a; };

// Lee texto separado por tabulaciones, punto y coma o comas (con comillas). Devuelve filas de celdas. No supone ningún formato del comprobante.
export function leerTabla(texto) {
  const t = String(texto || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim();
  if (!t) return [];
  const primera = t.split('\n')[0];
  const cuenta = (c) => primera.split(c).length - 1;
  const sep = ['\t', ';', ','].map((c) => [c, cuenta(c)]).sort((a, b) => b[1] - a[1])[0];
  const d = sep[1] ? sep[0] : ',';
  const filas = []; let fila = [], cel = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cel += '"'; i++; } else q = false; } else cel += c; }
    else if (c === '"') q = true;
    else if (c === d) { fila.push(cel.trim()); cel = ''; }
    else if (c === '\n') { fila.push(cel.trim()); filas.push(fila); fila = []; cel = ''; }
    else cel += c;
  }
  fila.push(cel.trim()); filas.push(fila);
  return filas.filter((f) => f.some((x) => x !== ''));
}
const adivinar = (nombre, pistas) => { const n = nombre.toLowerCase(); return pistas.some((p) => n.includes(p)); };
const CAMPOS = [
  { id: 'cedula', texto: 'Cédula', pistas: ['cédula', 'cedula', 'identific'] },
  { id: 'nombre', texto: 'Nombre', pistas: ['nombre', 'asegurado', 'trabajador'] },
  { id: 'dias', texto: 'Días', pistas: ['días', 'dias'] },
  { id: 'salario', texto: 'Salario', pistas: ['salario', 'sueldo', 'remuner'] },
  { id: 'cuota_obrera', texto: 'Cuota obrera', pistas: ['obrer', 'trabajador (', 'cuota del trab'] },
  { id: 'cuota_patronal', texto: 'Cuota patronal', pistas: ['patron'] },
];
// Convierte lo escrito a número con el mismo lector del resto del sistema; null si está vacío, y NaN se avisa.
const aNumero = (s) => { const t = String(s ?? '').trim(); if (t === '') return null; const n = leerNumero(t); return n; };

export default {
  id: 'conciliacion', texto: 'Conciliación',
  async montar(cont, ctx) {
    const { soc, memoria } = ctx;
    const bCaja = h('div.con-bloque'), bPlan = h('div.con-bloque'), bHist = h('div.con-bloque');
    cont.append(h('div.con-raiz', bCaja, bPlan, bHist));
    let dia = memoria.cajaDia || hoyCR(), cuentas = null, fichaCaja = 0, fichaPlan = 0;
    let mes = memoria.planillaMes || hoyCR().slice(0, 7);

    async function traerCuentas() { if (!cuentas) { const r = await catalogo(soc.id); cuentas = (r.cuentas || []).filter((c) => c.imputable && c.activa); } return cuentas; }

    /* ---------- Caja del día ---------- */
    async function cargarCaja() {
      const mi = ++fichaCaja;
      const encab = () => h('div', h('h2', 'Caja del día'), h('p.con-ayuda', 'Lo que dice el sistema frente a lo que se contó al cerrar cada turno. Las diferencias de efectivo se pueden contabilizar y a cada salida o entrada de efectivo se le asigna su cuenta.'),
        h('input.campo', { type: 'date', value: dia, max: hoyCR(), 'aria-label': 'Día de la caja', onchange: (e) => { if (e.target.value) { dia = e.target.value; memoria.cajaDia = dia; cargarCaja(); } } }));
      llenar(bCaja, encab(), esqueleto(2, 'Cargando la caja…'));
      let r, cs; try { [r, cs] = await Promise.all([cajaDia(soc.id, dia), traerCuentas()]); } catch (e) { if (mi === fichaCaja) llenar(bCaja, encab(), bloqueError({ titulo: 'No se pudo cargar la caja', mensaje: textoDeError(e), alReintentar: cargarCaja })); return; }
      if (mi !== fichaCaja) return;
      const sel = (valor, tipo) => {
        const s = h('select.campo', { 'aria-label': 'Cuenta de ' + tipo }, h('option', { value: '' }, 'Escoja la cuenta'), cs.map((c) => h('option', { value: c.id, selected: c.id === valor }, c.codigo + ' ' + c.nombre)));
        return s;
      };
      const turnos = r.turnos || [];
      const colorDif = (d) => d < 0 ? 'con-mas' : d > 0 ? 'con-menos' : 'con-neutro'; // faltante en rojo, sobrante en verde
      const tTurnos = turnos.length ? h('div.tabla-caja', h('table.con-tabla',
        h('thead', h('tr', h('th', 'Turno'), h('th.der', 'Esperado'), h('th.der', 'Contado'), h('th.der', 'Diferencia'), h('th.der', 'Tarjeta (sist. / contado)'), h('th.der', 'SINPE (sist. / contado)'), h('th.der', 'Transf. (sist. / contado)'), h('th', 'Asiento'))),
        h('tbody', turnos.map((t) => h('tr', h('td', '#' + (t.numero ?? '') + ' ' + (t.cerrado_por || ''), h('div.con-nota', horaCorta(t.cerrado_en))), h('td.der', money(t.esperado_efectivo)), h('td.der', money(t.contado_efectivo)),
          h('td.der', h('span.' + colorDif(Number(t.diferencia || 0)), money(t.diferencia || 0))),
          ...['tarjeta', 'sinpe', 'transferencia'].map((k) => { const x = t[k] || {}; const d = Number(x.contado ?? 0) - Number(x.sistema ?? 0); return h('td.der', money(x.sistema) + ' / ' + (x.contado == null ? '—' : money(x.contado)), d !== 0 && x.contado != null ? h('div.con-nota.' + (d < 0 ? 'con-mas' : 'con-menos'), (d > 0 ? '+' : '') + money(d)) : null); }),
          h('td', t.asiento ? '#' + t.asiento : (Number(t.diferencia || 0) ? 'Sin contabilizar' : '—'))))))) : h('div.con-vacio', 'No hay turnos cerrados el ' + fechaDMA(dia) + '.');
      const fil = (lista, tipo) => lista.map((m) => {
        const s = sel(m.cuenta_id, tipo === 'salida' ? 'la salida' : 'la entrada');
        if (m.asiento || m.anulada) s.disabled = true;
        return { m, s, fila: h('tr', h('td', horaCorta(m.hora) + ' · ' + (m.por || '')), h('td', m.motivo || 'Sin motivo', m.anulada ? h('span.chip.mal', 'Anulada') : null), h('td.der', money(m.monto)), h('td', m.anulada ? '—' : s), h('td', m.asiento ? '#' + m.asiento : '—')) };
      });
      const sal = fil(r.salidas || [], 'salida'), ent = fil(r.entradas || [], 'entrada');
      const tabla = (titulo, lst, vacio) => lst.length ? h('div', h('h3', titulo), h('div.tabla-caja', h('table.con-tabla', h('thead', h('tr', h('th', 'Hora y persona'), h('th', 'Motivo'), h('th.der', 'Monto'), h('th', 'Cuenta'), h('th', 'Asiento'))), h('tbody', lst.map((x) => x.fila))))) : h('p.con-nota', vacio);
      const pendientes = sal.filter((x) => !x.m.asiento && !x.m.anulada).length + ent.filter((x) => !x.m.asiento && !x.m.anulada).length + turnos.filter((t) => Number(t.diferencia || 0) && !t.asiento).length;
      const btn = h('button.btn.primario', { type: 'button', disabled: !pendientes, onclick: (e) => conBoton(e.currentTarget, async () => {
        const dec = { cierres: true,
          salidas: sal.filter((x) => !x.m.asiento && !x.m.anulada && x.s.value).map((x) => ({ id: x.m.id, cuenta_id: x.s.value })),
          entradas: ent.filter((x) => !x.m.asiento && !x.m.anulada && x.s.value).map((x) => ({ id: x.m.id, cuenta_id: x.s.value })) };
        const sinCuenta = [...sal, ...ent].filter((x) => !x.m.asiento && !x.m.anulada && !x.s.value).length;
        try { const rr = await cajaRegistrar(soc.id, dia, dec); toast(rr.asientos_nuevos ? rr.asientos_nuevos + (rr.asientos_nuevos === 1 ? ' asiento registrado' : ' asientos registrados') : 'No había nada nuevo que registrar'); if (sinCuenta) toast(sinCuenta + ' movimiento(s) quedaron sin cuenta: escójala para registrarlos.', 'error', 6000); await cargarCaja(); }
        catch (er) { toast(textoDeError(er), 'error'); }
      }) }, 'Contabilizar lo escogido');
      llenar(bCaja, encab(), h('p.con-nota', 'Faltante en rojo, sobrante en verde. Un faltante se registra contra «faltante de caja»; la contadora decide cómo se trata.'), tTurnos,
        tabla('Salidas de efectivo', sal, 'No hubo salidas de efectivo.'), tabla('Entradas de efectivo', ent, 'No hubo entradas de efectivo.'),
        h('div.con-acciones', btn, pendientes ? h('span.con-nota', pendientes + ' por registrar') : h('span.con-nota', 'Todo lo del día está registrado.')));
    }

    /* ---------- Planilla ---------- */
    async function cargarPlanilla() {
      const mi = ++fichaPlan;
      const encab = () => h('div', h('h2', 'Planilla de la CCSS'), h('p.con-ayuda', 'La fuente es el comprobante mensual de la CCSS (SICERE). El sistema no calcula cargas sociales: usted carga lo que dice el comprobante y aquí se contabiliza y se compara.'),
        h('input.campo', { type: 'month', value: mes, 'aria-label': 'Mes de la planilla', onchange: (e) => { if (e.target.value) { mes = e.target.value; memoria.planillaMes = mes; cargarPlanilla(); } } }));
      llenar(bPlan, encab(), esqueleto(2, 'Cargando la planilla…'));
      let r; try { r = await planilla(soc.id, mes); } catch (e) { if (mi === fichaPlan) llenar(bPlan, encab(), bloqueError({ titulo: 'No se pudo cargar la planilla', mensaje: textoDeError(e), alReintentar: cargarPlanilla })); return; }
      if (mi !== fichaPlan) return;
      if (!r.comprobante) { llenar(bPlan, encab(), h('p.con-nota', 'Todavía no hay comprobante cargado para ' + nombreMes(mes) + '.'), formularioCarga(null)); return; }
      const c = r.comprobante, k = r.comprobaciones, a = r.anterior;
      const dif = (act, ant) => { if (ant == null || act == null) return h('td.der', '—'); const d = Number(act) - Number(ant); return h('td.der', h('span.' + (d > 0 ? 'con-mas' : d < 0 ? 'con-menos' : 'con-neutro'), (d > 0 ? '+' : '') + money(d)), ant ? h('div.con-nota', pct(d / ant)) : null); };
      const comp = h('div.tabla-caja', h('table.con-tabla', h('thead', h('tr', h('th', 'Concepto'), h('th.der', nombreMes(mes)), h('th.der', a ? nombreMes(a.periodo) : 'Mes anterior'), h('th.der', 'Cambio'), h('th.der', 'En el libro'), h('th.der', 'Libro menos comprobante'))),
        h('tbody',
          h('tr', h('td', 'Salarios'), h('td.der', money(c.total_salarios)), h('td.der', a ? money(a.total_salarios) : '—'), dif(c.total_salarios, a?.total_salarios), h('td.der', money(k.libro_salarios)), h('td.der', h('span.' + (Number(k.libro_vs_comprobante_salarios) === 0 ? 'con-neutro' : 'con-mas'), money(k.libro_vs_comprobante_salarios)))),
          h('tr', h('td', 'Cuotas obreras'), h('td.der', c.total_cuotas_obreras == null ? '—' : money(c.total_cuotas_obreras)), h('td.der', a?.total_cuotas_obreras == null ? '—' : money(a.total_cuotas_obreras)), dif(c.total_cuotas_obreras, a?.total_cuotas_obreras), h('td.der', '—'), h('td.der', '—')),
          h('tr', h('td', 'Cargas patronales'), h('td.der', c.total_cargas_patronales == null ? '—' : money(c.total_cargas_patronales)), h('td.der', a?.total_cargas_patronales == null ? '—' : money(a.total_cargas_patronales)), dif(c.total_cargas_patronales, a?.total_cargas_patronales), h('td.der', money(k.libro_cargas_patronales)), h('td.der', k.libro_vs_comprobante_cargas == null ? '—' : h('span.' + (Number(k.libro_vs_comprobante_cargas) === 0 ? 'con-neutro' : 'con-mas'), money(k.libro_vs_comprobante_cargas)))),
          h('tr.con-grupo', h('td', 'Total a pagar a la CCSS'), h('td.der', c.total_a_pagar == null ? '—' : money(c.total_a_pagar)), h('td.der', '—'), h('td.der', '—'), h('td.der', '—'), h('td.der', '—')))));
      const avisos = [];
      if (Number(k.detalle_vs_total_salarios)) avisos.push('El detalle de personas suma ' + money(k.detalle_vs_total_salarios) + ' de diferencia con el total de salarios del comprobante.');
      if (Number(k.detalle_vs_total_obreras)) avisos.push('El detalle suma ' + money(k.detalle_vs_total_obreras) + ' de diferencia con el total de cuotas obreras.');
      if (Number(k.detalle_vs_total_patronales)) avisos.push('El detalle suma ' + money(k.detalle_vs_total_patronales) + ' de diferencia con el total de cargas patronales.');
      if (Number(k.pagado_de_caja_a_personal)) avisos.push('De la caja salieron ' + money(k.pagado_de_caja_a_personal) + ' con motivo de personal o planilla en este mes; revise que no se cuenten dos veces.');
      const lineas = r.lineas || [];
      const tLin = lineas.length ? h('details', h('summary', 'Detalle por persona (' + lineas.length + ')'), h('div.tabla-caja', h('table.con-tabla', h('thead', h('tr', h('th', 'Persona'), h('th.der', 'Días'), h('th.der', 'Salario'), h('th.der', 'Cuota obrera'), h('th.der', 'Cuota patronal'), h('th.der', 'Salario del mes anterior'))),
        h('tbody', lineas.map((l) => h('tr', h('td', (l.nombre || '') + (l.cedula ? ' · ' + l.cedula : '')), h('td.der', l.dias ?? ''), h('td.der', l.salario == null ? '' : money(l.salario)), h('td.der', l.cuota_obrera == null ? '' : money(l.cuota_obrera)), h('td.der', l.cuota_patronal == null ? '' : money(l.cuota_patronal)),
          dif(l.salario, l.salario_anterior)))))))  : null;
      const btn = h('button.btn.primario', { type: 'button', onclick: (e) => conBoton(e.currentTarget, async () => {
        try { const rr = await planillaContabilizar(soc.id, mes); toast(rr.estado === 'igual' ? 'El asiento ya estaba al día' : rr.estado === 'nuevo' ? 'Planilla contabilizada' : 'Asiento rehecho con el comprobante nuevo'); await Promise.all([cargarPlanilla(), cargarHistoria()]); }
        catch (er) { toast(textoDeError(er), 'error', 7000); }
      }) }, r.asiento ? 'Rehacer el asiento si cambió' : 'Contabilizar la planilla');
      llenar(bPlan, encab(),
        h('p.con-nota', 'Comprobante ' + (c.numero ? c.numero + ' · ' : '') + c.fuente + ' · versión ' + c.version + ' · cargado por ' + (c.cargado_por || '') + ' el ' + fechaHora(c.cargado_en) + (c.archivo ? ' · ' + c.archivo : '')),
        comp, avisos.map((t) => h('p.con-nota.con-mas', t)), tLin,
        h('div.con-acciones', btn, r.asiento ? h('span.con-nota', 'Asiento #' + r.asiento.numero + ' por ' + money(r.asiento.total)) : h('span.con-nota', 'Aún sin asiento.')),
        h('details', h('summary', 'Cargar otra versión del comprobante'), formularioCarga(r)));
    }

    function formularioCarga() {
      const tx = h('textarea.campo', { rows: 6, placeholder: 'Pegue aquí la tabla del comprobante (con la fila de títulos), o escoja el archivo CSV', 'aria-label': 'Detalle del comprobante' });
      const arch = h('input', { type: 'file', accept: '.csv,.txt,.tsv', 'aria-label': 'Archivo del comprobante', onchange: async (e) => { const f = e.target.files?.[0]; if (!f) return; tx.value = await f.text(); nombreArch = f.name; mapear(); } });
      let nombreArch = '', tabla = [];
      const mapa = h('div'), tot = {};
      const entrada = (id, etq, ph) => { const i = h('input.campo', { type: 'text', inputmode: 'decimal', placeholder: ph || '', 'aria-label': etq }); tot[id] = i; return h('label.etq', etq, i); };
      const numero = h('input.campo', { type: 'text', placeholder: 'Opcional', 'aria-label': 'Número del comprobante' });
      const selects = {};
      function mapear() {
        tabla = leerTabla(tx.value);
        if (tabla.length < 2) { llenar(mapa); return; }
        const cab = tabla[0];
        llenar(mapa, h('p.con-ayuda', 'Diga qué columna es cada dato. Las demás columnas se guardan tal como vienen. ' + (tabla.length - 1) + ' filas.'),
          h('div.con-form', CAMPOS.map((cp) => {
            const s = h('select.campo', { 'aria-label': 'Columna de ' + cp.texto }, h('option', { value: '' }, 'No viene'), cab.map((n, i) => h('option', { value: String(i), selected: adivinar(n, cp.pistas) }, n || 'Columna ' + (i + 1))));
            selects[cp.id] = s; return h('label.etq', cp.texto, s);
          })));
      }
      tx.addEventListener('change', mapear);
      const guardar = h('button.btn.primario', { type: 'button', onclick: (e) => conBoton(e.currentTarget, async () => {
        const p = { periodo: mes, numero_comprobante: numero.value.trim(), archivo_nombre: nombreArch || null, lineas: [] };
        const mapaTot = { total_salarios: 'total_salarios', total_cuotas_obreras: 'total_cuotas_obreras', total_cargas_patronales: 'total_cargas_patronales', total_a_pagar: 'total_a_pagar' };
        for (const [k, id] of Object.entries(mapaTot)) { const n = aNumero(tot[id].value); if (Number.isNaN(n)) { toast('El valor de «' + tot[id].getAttribute('aria-label') + '» no es un monto válido', 'error'); tot[id].focus(); return; } if (n != null) p[k] = n; }
        if (tabla.length > 1) {
          const col = (id) => selects[id]?.value === '' || selects[id] == null ? -1 : Number(selects[id].value);
          const idx = Object.fromEntries(CAMPOS.map((cp) => [cp.id, col(cp.id)])), usados = new Set(Object.values(idx).filter((i) => i >= 0));
          for (let f = 1; f < tabla.length; f++) {
            const fila = tabla[f], l = { otros: {} };
            for (const cp of CAMPOS) {
              const v = idx[cp.id] >= 0 ? fila[idx[cp.id]] : '';
              if (['cedula', 'nombre'].includes(cp.id)) l[cp.id] = v || null;
              else { const n = aNumero(v); if (Number.isNaN(n)) { toast('Fila ' + (f + 1) + ': «' + v + '» no es un monto válido en ' + cp.texto, 'error', 7000); return; } l[cp.id] = n; }
            }
            tabla[0].forEach((nom, i) => { if (!usados.has(i) && fila[i] !== undefined && fila[i] !== '') l.otros[nom || 'Columna ' + (i + 1)] = fila[i]; });
            p.lineas.push(l);
          }
        }
        try { await planillaCargar(soc.id, p); toast('Comprobante cargado'); await Promise.all([cargarPlanilla(), cargarHistoria()]); }
        catch (er) { toast(textoDeError(er), 'error', 7000); }
      }) }, 'Guardar el comprobante');
      return h('div', h('div.con-form', h('label.etq', 'Número del comprobante', numero),
        entrada('total_salarios', 'Total de salarios', 'Del comprobante'), entrada('total_cuotas_obreras', 'Total de cuotas obreras'), entrada('total_cargas_patronales', 'Total de cargas patronales'), entrada('total_a_pagar', 'Total a pagar a la CCSS')),
        h('p.con-nota', 'Si deja un total vacío y carga el detalle, se usa la suma del detalle. Escriba los totales tal como aparecen en el comprobante.'),
        h('div.con-form', h('label.etq.ancho', 'Detalle por persona (opcional)', tx), h('label.etq', 'O escoja el archivo', arch)), mapa, h('div.con-acciones', guardar));
    }

    /* ---------- Historia y variabilidad ---------- */
    async function cargarHistoria() {
      llenar(bHist, h('h2', 'Planilla en los últimos meses'), esqueleto(1, 'Calculando…'));
      let r; try { r = await planillaHistoria(soc.id); } catch (e) { llenar(bHist, h('h2', 'Planilla en los últimos meses'), bloqueError({ titulo: 'No se pudo cargar', mensaje: textoDeError(e), alReintentar: cargarHistoria })); return; }
      const ms = (r.meses || []).filter((m) => m.cargado);
      if (!ms.length) { llenar(bHist, h('h2', 'Planilla en los últimos meses'), h('div.con-vacio', 'Cuando cargue comprobantes aparecerán aquí los meses, la carga patronal sobre salarios y su variabilidad.')); return; }
      const rt = r.ratio || {}, sl = r.salarios || {};
      llenar(bHist, h('h2', 'Planilla en los últimos meses'), h('p.con-ayuda', 'Cada mes con su comprobante. La carga patronal sobre salarios debería moverse poco; si un mes se aleja, revise el comprobante.'),
        h('div.tabla-caja', h('table.con-tabla', h('thead', h('tr', h('th', 'Mes'), h('th.der', 'Personas'), h('th.der', 'Salarios'), h('th.der', 'Cuotas obreras'), h('th.der', 'Cargas patronales'), h('th.der', 'Carga sobre salarios'), h('th', 'Asiento'))),
          h('tbody', ms.map((m) => h('tr', h('td', nombreMes(m.periodo)), h('td.der', m.empleados || '—'), h('td.der', money(m.salarios)), h('td.der', m.cuotas_obreras == null ? '—' : money(m.cuotas_obreras)), h('td.der', m.cargas_patronales == null ? '—' : money(m.cargas_patronales)), h('td.der', pct(m.carga_sobre_salarios)), h('td', m.contabilizado ? 'Contabilizada' : h('span.con-mas', 'Sin contabilizar'))))))),
        h('div.con-cifras', { style: 'margin-top:.8rem' },
          h('div.con-cifra', h('div.t', 'Salarios, promedio'), h('div.v', money(sl.media)), h('div.n', sl.n + ' meses')),
          h('div.con-cifra', h('div.t', 'Salarios, desviación estándar'), h('div.v', sl.sd == null ? '—' : money(sl.sd)), h('div.n', 'muestral')),
          h('div.con-cifra', h('div.t', 'Salarios, coeficiente de variación'), h('div.v', pct(sl.cv)), h('div.n', 'desviación entre promedio')),
          h('div.con-cifra', h('div.t', 'Carga patronal sobre salarios'), h('div.v', pct(rt.media)), h('div.n', 'promedio · variación ' + pct(rt.cv)))));
    }

    await Promise.all([cargarCaja(), cargarPlanilla(), cargarHistoria()]);
  },
};
