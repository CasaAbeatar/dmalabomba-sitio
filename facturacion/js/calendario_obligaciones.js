// Contabilidad, pestaña «Calendario»: lo que vence (IVA D-150, retenciones D-103, planilla CCSS, D-270, renta D-101 y pagos parciales, y el plazo de 8 días hábiles para responder facturas recibidas)
// con una casilla «Hecho» por obligación. Abre con lo que toca hoy: arriba el IVA del período en vivo, luego lo vencido y lo próximo, y al final el mes en calendario.
// Las fechas salen de fx_contable_calendario (la base calcula el siguiente día hábil con el calendario de Costa Rica). Las que la contadora aún no confirmó llevan la marca «por confirmar».
import { h, hoyCR, esqueleto, bloqueError, textoDeError, toast, conBoton } from './util.js';
import { fechaDMA } from './periodo.js';
import { llenar } from './c_comun.js';
import { cargarHoja } from './ui_hojas.js';
import { calendario, calendarioMarcar } from './api_contable.js';
import { montarIva } from './iva_periodo.js';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const CORTO = { d150: 'IVA', d103: 'Retenciones', ccss_planilla: 'CCSS', d270: 'D-270', d101: 'Renta', renta_parcial: 'Renta parcial', receptor_8dias: 'Responder' };
const nombreMes = (per) => { const [a, m] = per.split('-').map(Number); return MESES[m - 1] + ' de ' + a; };
const sumaMes = (per, n) => { const [a, m] = per.split('-').map(Number); const t = a * 12 + (m - 1) + n; return Math.floor(t / 12) + '-' + String((t % 12) + 1).padStart(2, '0'); };
const AUTOMATICAS = new Set(['receptor_8dias']); // se dan por hechas solas cuando no queda ninguna factura sin responder
const MARCAS = new Set(['d150', 'd103', 'ccss_planilla', 'd270', 'd101', 'renta_parcial']);

export default {
  id: 'calendario', texto: 'Calendario',
  async montar(cont, ctx) {
    await cargarHoja('calendario_obligaciones.css');
    const { soc, memoria, app } = ctx;
    const hoy = hoyCR();
    let mes = memoria.calMes || hoy.slice(0, 7), verHechas = !!memoria.calHechas, ficha = 0, vivo = true, datos = null, apagarIva = null;

    const bIva = h('div.con-bloque');
    const bLista = h('div.con-bloque');
    const bMes = h('div.con-bloque');
    cont.append(h('div.con-raiz', bIva, bLista, bMes));

    // El IVA tiene su propia carga y su propio reloj; si se cambia de pestaña, se apaga
    montarIva(bIva, ctx, { alIrAFormularios: (per) => { memoria.d150Mes = per; ctx.ir?.('formularios'); } }).then((f) => { if (vivo) apagarIva = f; else if (typeof f === 'function') f(); });

    async function cargar() {
      const mi = ++ficha;
      llenar(bLista, h('h2', 'Lo que vence'), esqueleto(3, 'Revisando las obligaciones…'));
      llenar(bMes, h('h2', nombreMes(mes)), esqueleto(2, 'Armando el calendario…'));
      const [a, m] = mes.split('-').map(Number);
      const ini = new Date(Date.UTC(a, m - 1, 1)).toISOString().slice(0, 10), fin = new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
      const d0 = new Date(Date.now() - 45 * 864e5).toISOString().slice(0, 10), d1 = new Date(Date.now() + 150 * 864e5).toISOString().slice(0, 10);
      let d; try { d = await calendario(soc.id, ini < d0 ? ini : d0, fin > d1 ? fin : d1); }
      catch (e) { if (vivo && mi === ficha) { const err = bloqueError({ titulo: 'No se pudo cargar el calendario', mensaje: textoDeError(e), alReintentar: cargar }); llenar(bLista, h('h2', 'Lo que vence'), err); llenar(bMes, h('h2', nombreMes(mes))); } return; }
      if (!vivo || mi !== ficha) return;
      datos = d; pintar();
    }

    const dif = (n) => n < 0 ? 'venció hace ' + Math.abs(n) + ' día(s) hábil(es)' : n === 0 ? 'vence hoy' : 'faltan ' + n + ' día(s) hábil(es)';

    async function marcar(it, estado, btn) {
      try { await calendarioMarcar(soc.id, it.clave, it.periodo, estado); toast(estado === 'hecho' ? 'Marcada como hecha' : estado === 'no_aplica' ? 'Marcada como «No aplica»' : 'Vuelve a pendiente'); await cargar(); }
      catch (e) { toast(textoDeError(e), 'error'); }
    }

    function fila(it) {
      const auto = AUTOMATICAS.has(it.clave) || it.origen === 'automatico';
      const editable = MARCAS.has(it.clave) && !auto;
      const chk = h('input', { type: 'checkbox', 'aria-label': 'Marcar como hecha: ' + it.titulo, disabled: !editable });
      chk.checked = it.estado === 'hecho';
      chk.addEventListener('change', () => { chk.disabled = true; marcar(it, chk.checked ? 'hecho' : 'pendiente'); });
      const estado = it.estado === 'hecho' ? h('span.chip.ok', 'Hecha') : it.estado === 'no_aplica' ? h('span.chip', 'No aplica') : it.vencido ? h('span.chip.mal', 'Vencida') : h('span.chip', 'Pendiente');
      return h('div.cal-fila' + (it.estado === 'hecho' || it.estado === 'no_aplica' ? '.cal-cerrada' : '') + (it.vencido ? '.cal-vencida' : ''),
        h('label.cal-chk', chk, h('span.cal-quien', h('strong', it.titulo), ' ', h('span.con-nota', it.formulario)),),
        h('div.cal-cuando', h('div', 'Vence el ' + fechaDMA(it.vence)), h('div.con-nota', it.estado === 'pendiente' ? dif(it.dias_habiles) : (it.marcado_por ? 'Marcada por ' + it.marcado_por : it.detalle || ''))),
        h('div.cal-estado', estado, !it.confirmada ? h('span.cal-confirmar', { title: 'La contadora todavía no confirma esta fecha' }, 'por confirmar') : null),
        it.detalle && it.estado === 'pendiente' ? h('div.cal-detalle.con-nota', it.detalle) : null,
        h('details.cal-fuente', h('summary', 'Más sobre esta fecha'), h('p.con-nota', it.fuente),
          editable && it.estado === 'pendiente' ? h('button.btn.chico', { type: 'button', onclick: (e) => conBoton(e.currentTarget, () => marcar(it, 'no_aplica')) }, 'Marcar «No aplica» (no corresponde este período)') : null,
          editable && it.estado === 'no_aplica' ? h('button.btn.chico', { type: 'button', onclick: (e) => conBoton(e.currentTarget, () => marcar(it, 'pendiente')) }, 'Volver a pendiente') : null));
    }

    function pintar() {
      const items = datos.items || [];
      const abiertas = items.filter((i) => i.estado === 'pendiente');
      const vencidas = abiertas.filter((i) => i.vencido);
      ctx.avisar?.('calendario', vencidas.length);
      const proximas = abiertas.filter((i) => !i.vencido && i.dias_habiles <= 45);
      const cerradas = items.filter((i) => i.estado !== 'pendiente').sort((x, y) => y.vence.localeCompare(x.vence)).slice(0, 12);
      llenar(bLista,
        h('div.con-fila', h('h2', { style: 'flex:1' }, 'Lo que vence'), vencidas.length ? h('span.chip.mal', vencidas.length + ' vencida(s)') : h('span.chip.ok', 'Nada vencido')),
        h('p.con-ayuda', 'Hoy es ' + fechaDMA(hoy) + '. Primero lo vencido, luego lo que viene. Marque «Hecha» cuando la contadora o usted presenten la declaración; los plazos automáticos se cierran solos.'),
        vencidas.length ? h('div', h('h3', 'Vencidas'), vencidas.map(fila)) : null,
        proximas.length ? h('div', h('h3', { style: 'margin-top:.8rem' }, 'Próximas (45 días hábiles)'), proximas.map(fila)) : h('div.con-vacio', 'No hay obligaciones próximas sin hacer.'),
        h('details', { style: 'margin-top:.8rem', open: verHechas, ontoggle: (e) => { memoria.calHechas = e.currentTarget.open; } },
          h('summary', 'Hechas y «No aplica» (' + cerradas.length + ')'), cerradas.length ? cerradas.map(fila) : h('p.con-nota', 'Todavía no hay nada marcado.')),
        h('p.con-nota', 'Las fechas marcadas «por confirmar» siguen la ley o la práctica general; la contadora las confirma en «Decisiones de la contadora». No es un calendario oficial de Hacienda.'));
      pintarMes();
    }

    function pintarMes() {
      const [a, m] = mes.split('-').map(Number);
      const primero = new Date(Date.UTC(a, m - 1, 1)), nDias = new Date(Date.UTC(a, m, 0)).getUTCDate();
      const lead = (primero.getUTCDay() + 6) % 7; // lunes = 0
      const porDia = new Map();
      for (const it of datos.items || []) { if (it.vence.slice(0, 7) === mes) { const k = Number(it.vence.slice(8)); if (!porDia.has(k)) porDia.set(k, []); porDia.get(k).push(it); } }
      const celdas = [];
      for (let i = 0; i < lead; i++) celdas.push(h('div.cal-dia.cal-vacia'));
      for (let dia = 1; dia <= nDias; dia++) {
        const ymd = mes + '-' + String(dia).padStart(2, '0'), lista = porDia.get(dia) || [];
        celdas.push(h('div.cal-dia' + (ymd === hoy ? '.cal-hoy' : ''), { 'aria-label': dia + ' de ' + nombreMes(mes) + (lista.length ? ': ' + lista.map((i) => i.titulo).join(', ') : '') },
          h('span.cal-num', String(dia)),
          lista.map((i) => h('span.cal-marca.' + (i.estado === 'hecho' ? 'hecha' : i.estado === 'no_aplica' ? 'noaplica' : i.vencido ? 'vencida' : 'pend'), { title: i.titulo }, (i.estado === 'hecho' ? '✓ ' : '') + (CORTO[i.clave] || i.formulario)))));
      }
      llenar(bMes,
        h('div.con-fila', h('h2', { style: 'flex:1' }, nombreMes(mes)),
          h('button.btn.chico', { type: 'button', 'aria-label': 'Mes anterior', onclick: () => { mes = sumaMes(mes, -1); memoria.calMes = mes; cargar(); } }, '‹ Mes anterior'),
          h('button.btn.chico', { type: 'button', disabled: mes === hoy.slice(0, 7), onclick: () => { mes = hoy.slice(0, 7); memoria.calMes = mes; cargar(); } }, 'Este mes'),
          h('button.btn.chico', { type: 'button', 'aria-label': 'Mes siguiente', onclick: () => { mes = sumaMes(mes, 1); memoria.calMes = mes; cargar(); } }, 'Mes siguiente ›')),
        h('div.cal-rejilla', { role: 'grid', 'aria-label': 'Calendario de obligaciones de ' + nombreMes(mes) }, DIAS.map((x) => h('div.cal-cab', x)), celdas),
        h('p.con-nota.cal-leyenda', h('span.cal-marca.hecha', '✓ Hecha'), ' ', h('span.cal-marca.pend', 'Pendiente'), ' ', h('span.cal-marca.vencida', 'Vencida'), ' ', h('span.cal-marca.noaplica', 'No aplica')));
    }

    await cargar();
    return () => { vivo = false; if (typeof apagarIva === 'function') apagarIva(); };
  },
};
