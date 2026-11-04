// Contabilidad, Formularios, bloque D-270 (fase 5): pagos sin comprobante electrónico (intereses, comisiones, entes públicos). Las comisiones e intereses ya contabilizados
// se proponen solos; se incluyen con un toque, en la misma fila. No se presenta en cero. Plazos: 2025 anual (25 jun 2026), 2026 mensual con régimen transitorio (25 ene 2027), desde 2027 dentro de 25 días.
import { h, money, hoyCR, esqueleto, bloqueError, textoDeError, toast, conBoton, confirmar } from './util.js';
import { fechaDMA } from './periodo.js';
import { llenar } from './c_comun.js';
import { d270, d270Guardar, d270Quitar, d270Presentar, d270Rectificar, d270Calendario } from './api_contable.js';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const nombrePeriodo = (p) => (/^\d{4}$/.test(p) ? 'Año ' + p + ' (declaración anual)' : MESES[Number(p.slice(5)) - 1] + ' de ' + p.slice(0, 4));
const TIPOS = { intereses: 'Intereses', comisiones: 'Comisiones', pago_ente_publico: 'Pago a ente público (exento)', otro_sin_comprobante: 'Otro pago sin comprobante electrónico' };
const REGIMEN = { anual_2025: 'Declaración anual de 2025', transitorio_2026: 'Régimen transitorio de 2026: se puede presentar mes a mes o todos los meses hasta el 25 de enero de 2027', mensual: 'Declaración mensual, dentro de 25 días naturales', cubierto_por_anual_2025: 'Cubierto por la declaración anual de 2025' };

export async function montarD270(bloque, ctx) {
  const { soc, memoria } = ctx;
  const hoy = hoyCR();
  let per = memoria.d270Periodo || hoy.slice(0, 7);
  let ficha = 0, cal = [];

  async function cargar() {
    const mi = ++ficha;
    llenar(bloque, h('h2', 'D-270, pagos sin comprobante electrónico'), esqueleto(2, 'Revisando los pagos…'));
    let d; try { [cal, d] = await Promise.all([d270Calendario(soc.id), d270(soc.id, per)]); } catch (e) { if (mi === ficha) llenar(bloque, h('h2', 'D-270, pagos sin comprobante electrónico'), bloqueError({ titulo: 'No se pudo cargar el D-270', mensaje: textoDeError(e), alReintentar: cargar })); return; }
    if (mi !== ficha) return;
    pintar(d);
  }

  function pintar(d) {
    const dec = d.declaracion, presentada = dec?.estado === 'presentada', ops = d.operaciones || [], cands = d.candidatas || [];
    const vencido = d.vence && d.vence < hoy && !presentada;
    const selector = h('select.campo', { 'aria-label': 'Período del D-270', onchange: (e) => { per = e.target.value; memoria.d270Periodo = per; cargar(); } },
      cal.map((c) => h('option', { value: c.periodo, selected: c.periodo === per }, nombrePeriodo(c.periodo) + (c.operaciones > 0 ? ' · ' + c.operaciones + ' pago(s)' : '') + (c.estado === 'presentada' ? ' · presentado' : ''))));
    // Formulario para agregar un pago a mano (queda dentro del período escogido)
    const f = {
      tipo: h('select.campo', { 'aria-label': 'Clase de pago' }, Object.entries(TIPOS).map(([k, t]) => h('option', { value: k }, t))),
      fecha: h('input.campo', { type: 'date', value: d.hasta < hoy ? d.hasta : hoy, min: d.desde, max: d.hasta, 'aria-label': 'Fecha del pago' }),
      nombre: h('input.campo', { type: 'text', placeholder: 'Entidad o institución', 'aria-label': 'A quién se pagó' }),
      cedula: h('input.campo', { type: 'text', placeholder: 'Cédula (si la tiene)', inputmode: 'numeric', 'aria-label': 'Cédula' }),
      monto: h('input.campo', { type: 'text', inputmode: 'decimal', placeholder: '0,00', 'aria-label': 'Monto' }),
      codigo: h('input.campo', { type: 'text', placeholder: 'Lo define la contadora', 'aria-label': 'Código de operación' }),
      detalle: h('input.campo', { type: 'text', placeholder: 'Detalle opcional', 'aria-label': 'Detalle' }),
    };
    const num2 = h('input.campo', { type: 'text', placeholder: 'Número de comprobante de TRIBU-CR', 'aria-label': 'Número de comprobante de TRIBU-CR' });
    const filaCand = (c) => {
      const nom = h('input.campo', { type: 'text', placeholder: 'Entidad financiera', 'aria-label': 'Entidad financiera de ' + c.concepto }), ced = h('input.campo', { type: 'text', placeholder: 'Cédula', inputmode: 'numeric', 'aria-label': 'Cédula de la entidad' });
      return h('div.con-bloque', { style: 'margin:.5rem 0;padding:.7rem .8rem' }, h('div.con-fila', h('div', { style: 'flex:1;min-width:220px' }, h('strong', c.concepto), h('div.con-nota', fechaDMA(c.fecha) + ' · asiento ' + c.asiento + ' · ' + (c.rol === 'intereses_bancarios' ? 'intereses' : 'comisión') + ' · ' + money(c.monto))),
        nom, ced, h('button.btn.primario', { type: 'button', disabled: presentada, onclick: (e) => conBoton(e.currentTarget, async () => {
          try { await d270Guardar(soc.id, { periodo: per, fecha: c.fecha, tipo: c.rol === 'intereses_bancarios' ? 'intereses' : 'comisiones', tercero_nombre: nom.value, tercero_cedula: ced.value, monto: String(c.monto), detalle: c.concepto, asiento_linea_id: c.linea_id }); toast('Incluido en el D-270'); await cargar(); } catch (er) { toast(textoDeError(er), 'error'); }
        }) }, 'Incluir en el D-270')));
    };
    llenar(bloque,
      h('div.con-fila', h('h2', { style: 'flex:1' }, 'D-270, pagos sin comprobante electrónico'), presentada ? h('span.chip.ok', 'Presentado' + (dec.version > 1 ? ' (versión ' + dec.version + ')' : '')) : vencido ? h('span.chip.mal', 'Vencido') : h('span.chip', 'Pendiente')),
      h('p.con-ayuda', 'Solo lleva pagos que NO tienen factura ni tiquete electrónico: intereses y comisiones que no pagan IVA, y pagos a instituciones públicas exentas por ley. Lo que ya tiene comprobante electrónico no va aquí, y no se presenta en cero.'),
      h('label.etq', 'Período', selector),
      h('p.con-nota', (REGIMEN[d.regimen] || '') + (d.vence ? '. Vence el ' + fechaDMA(d.vence) + (d.ordinaria && d.ordinaria !== d.vence ? ' (el plazo mensual ordinario sería el ' + fechaDMA(d.ordinaria) + ')' : '') + ', o el siguiente día hábil.' : '.')),
      h('h3', { style: 'margin-top:1rem' }, 'Pagos que se reportan'),
      ops.length ? h('div.tabla-caja', h('table.con-tabla', h('thead', h('tr', h('th', 'Fecha'), h('th', 'Clase'), h('th', 'A quién'), h('th', 'Código'), h('th.der', 'Monto'), h('th', ''))),
        h('tbody', ops.map((o) => h('tr', h('td', fechaDMA(o.fecha)), h('td', TIPOS[o.tipo]), h('td', o.tercero_nombre, o.tercero_cedula ? h('div.con-nota', o.tercero_cedula) : null), h('td.con-codigo', o.codigo || 'Falta'), h('td.der', money(o.monto)),
          h('td', presentada ? null : h('button.btn.chico', { type: 'button', onclick: (e) => conBoton(e.currentTarget, async () => { try { await d270Quitar(soc.id, o.id); toast('Quitado'); await cargar(); } catch (er) { toast(textoDeError(er), 'error'); } }) }, 'Quitar'))))),
        h('tfoot', h('tr.con-grupo', h('td', { colspan: 4 }, 'Total del período'), h('td.der', money(d.total)), h('td'))))) : h('div.con-vacio', 'No hay pagos reportados en este período: si no hay nada que reportar, no se presenta el D-270.'),
      cands.length ? h('div', h('h3', { style: 'margin-top:1rem' }, 'Comisiones e intereses contabilizados que podrían ir'), h('p.con-ayuda', 'Aparecen porque se registraron en las cuentas de comisiones o intereses. Si el banco o la entidad sí dio factura electrónica, no se incluyen.'), cands.map(filaCand)) : null,
      presentada ? null : h('details', { style: 'margin-top:.8rem' }, h('summary', 'Agregar otro pago sin comprobante'),
        h('div.con-form', h('label.etq', 'Clase de pago', f.tipo), h('label.etq', 'Fecha', f.fecha), h('label.etq', 'A quién se pagó', f.nombre), h('label.etq', 'Cédula', f.cedula), h('label.etq', 'Monto', f.monto), h('label.etq', 'Código', f.codigo), h('label.etq.ancho', 'Detalle', f.detalle)),
        h('div.con-acciones', h('button.btn.primario', { type: 'button', onclick: (e) => conBoton(e.currentTarget, async () => {
          try { await d270Guardar(soc.id, { periodo: per, fecha: f.fecha.value, tipo: f.tipo.value, tercero_nombre: f.nombre.value, tercero_cedula: f.cedula.value, monto: f.monto.value, codigo: f.codigo.value, detalle: f.detalle.value }); toast('Pago agregado'); await cargar(); } catch (er) { toast(textoDeError(er), 'error'); }
        }) }, 'Agregar este pago al D-270'))),
      presentada ? h('div', h('p.con-ayuda', 'Presentado el ' + fechaDMA(String(dec.presentado_en).slice(0, 10)) + ' por ' + dec.presentado_por + ' con el comprobante ' + dec.numero_presentacion + '.'),
        h('button.btn', { type: 'button', onclick: (e) => conBoton(e.currentTarget, async () => { if (!(await confirmar('Se abre una versión rectificativa para corregir los pagos de este período. ¿Seguir?', { si: 'Sí, abrirla' }))) return; try { await d270Rectificar(soc.id, per); await cargar(); } catch (er) { toast(textoDeError(er), 'error'); } }) }, 'Corregir con una versión rectificativa'))
        : ops.length ? h('div.con-fila', { style: 'margin-top:.8rem' }, num2, h('button.btn', { type: 'button', onclick: (e) => conBoton(e.currentTarget, async () => { try { await d270Presentar(soc.id, per, num2.value.trim()); toast('Marcado como presentado'); await cargar(); } catch (er) { toast(textoDeError(er), 'error'); } }) }, 'Ya lo presenté en TRIBU-CR')) : null,
      h('p.con-nota', 'Base: resolución MH-DGT-RES-0010-2026 y comunicados CP-14-2026 y CP-09-2026. Los códigos de operación y el plazo los confirma la contadora (ver «Decisiones de la contadora» en Catálogo).'));
  }
  await cargar();
}
