// Contabilidad, pestaña «Compras» (fase 3): las facturas de proveedores y a qué cuenta va cada línea. Abre con las que llegaron hoy y sigue con el período.
// La propuesta viene armada (por lo aprendido de ese proveedor, por el CABYS o por lo que ya entró a Inventarios): se confirma en la misma fila, sin otra ventana.
import { h, money, hoyCR, esqueleto, bloqueError, textoDeError, toast, conBoton } from './util.js';
import { selectorPeriodo, fechaDMA, textoRango } from './periodo.js';
import { compras, compra, compraConfirmar, comprasAceptarSugerencias, reglas, reglaQuitar, catalogo } from './api_contable.js';
import { llenar } from './c_comun.js';

const FILTROS = [['por_clasificar', 'Por clasificar'], ['listas', 'Listas para contabilizar'], ['contabilizadas', 'Contabilizadas'], ['todas', 'Todas']];
const FUENTE = { regla: 'Aprendido de este proveedor', inventario: 'Entró a Inventarios', categoria: 'Por el tipo de producto (CABYS)' };
const TIPO = { FacturaElectronica: 'Factura', TiqueteElectronico: 'Tiquete', NotaCreditoElectronica: 'Nota de crédito', NotaDebitoElectronica: 'Nota de débito' };
const ESTADO = { por_clasificar: ['mal', 'Por clasificar'], lista: ['', 'Lista: falta confirmar'], contabilizada: ['ok', 'Contabilizada'] };

export default {
  id: 'compras', texto: 'Compras',
  async montar(cont, ctx) {
    const { soc, memoria } = ctx;
    let cuentas = [];
    try { cuentas = (await catalogo(soc.id)).cuentas.filter((c) => c.imputable && c.activa); } catch (e) { cont.append(bloqueError({ titulo: 'No se pudo cargar el catálogo de cuentas', mensaje: textoDeError(e), alReintentar: () => { cont.replaceChildren(); this.montar(cont, ctx); } })); return; }
    if (!cuentas.length) { cont.append(h('div.con-bloque', h('h2', 'Primero el catálogo'), h('p.con-ayuda', 'Para clasificar compras hace falta el catálogo de cuentas. Créelo en la pestaña «Catálogo».'))); return; }

    const bHoy = h('div.con-bloque'), bPeriodo = h('div.con-bloque'), bReglas = h('details.con-bloque');
    cont.append(h('div.con-raiz', bHoy, bPeriodo, bReglas));
    let filtro = memoria.comprasFiltro || 'por_clasificar', q = memoria.comprasQ || '', rango;
    const fichas = { hoy: 0, per: 0 };

    const opciones = (elegida) => {
      const grupos = [['Gastos y costos', cuentas.filter((c) => c.tipo === 'gasto' || c.tipo === 'costo')], ['Inventario y activos', cuentas.filter((c) => c.tipo === 'activo')], ['Pasivo, patrimonio e ingresos', cuentas.filter((c) => !['gasto', 'costo', 'activo'].includes(c.tipo))]];
      return grupos.map(([t, l]) => h('optgroup', { label: t }, l.map((c) => h('option', { value: c.id, selected: c.id === elegida }, c.codigo + ' ' + c.nombre))));
    };

    function filaFactura(f, alCambiar) {
      const [cls, txt] = ESTADO[f.estado] || ['', f.estado];
      const cuerpo = h('div'); let cargada = false;
      const det = h('details.con-asiento', { style: 'border-bottom:1px solid var(--linea)' },
        h('summary', h('span.con-codigo', fechaDMA(String(f.fecha).slice(0, 10))), ' ', h('strong', f.proveedor), ' ', h('span.con-nota', (TIPO[f.tipo] || f.tipo) + ' ' + (f.consecutivo ? '· ' + String(f.consecutivo).slice(-10) : '')), ' ',
          h('strong', money(f.total)), ' ', h('span.chip' + (cls ? '.' + cls : ''), txt), f.provisional ? h('span.chip.espera', { title: 'Contabilizada con cuentas sin confirmar' }, 'Provisional') : null, f.asiento ? h('span.con-nota', ' asiento ' + f.asiento) : null), cuerpo);
      det.addEventListener('toggle', async () => {
        if (!det.open || cargada) return; cargada = true; llenar(cuerpo, esqueleto(1, 'Cargando las líneas…'));
        try { pintarDetalle(cuerpo, await compra(soc.id, f.clave), f, alCambiar); } catch (e) { cargada = false; llenar(cuerpo, bloqueError({ titulo: 'No se pudo cargar la factura', mensaje: textoDeError(e), alReintentar: () => { cargada = false; det.open = false; det.open = true; } })); }
      });
      return det;
    }

    function pintarDetalle(cuerpo, d, f, alCambiar) {
      const sel = new Map(), apr = new Map();
      const filas = d.lineas.map((l) => {
        const s = h('select.campo', { 'aria-label': 'Cuenta para ' + l.detalle }, h('option', { value: '' }, 'Escoja la cuenta'), opciones(l.efectiva));
        sel.set(l.linea, s);
        const cb = h('input', { type: 'checkbox', checked: !l.confirmada || l.fuente !== 'regla', 'aria-label': 'Recordar esta cuenta para este proveedor' }); apr.set(l.linea, cb);
        return h('div.con-bloque', { style: 'margin:.5rem 0;padding:.7rem .8rem' },
          h('div.con-fila', h('div', { style: 'flex:1;min-width:220px' }, h('strong', l.detalle), h('div.con-nota', 'Línea ' + l.linea + (l.cabys ? ' · CABYS ' + l.cabys : '') + ' · ' + l.cantidad + ' × · Sin IVA ' + money(l.subtotal) + ' · IVA ' + money(l.impuesto))),
            h('div', { style: 'flex:1;min-width:220px' }, s)),
          h('div.con-fila', l.confirmada ? h('span.chip.ok', 'Confirmada') : l.sugerida ? h('span.chip', 'Propuesta: ' + (FUENTE[l.fuente] || '')) : h('span.chip.mal', 'Sin propuesta: escoja la cuenta'),
            h('label.etq', { style: 'flex-direction:row;align-items:center;gap:.4rem' }, cb, 'Recordar para próximas facturas de este proveedor')));
      });
      const previa = d.previa, lineasP = (previa?.lineas || []);
      const nombre = (id) => { const c = cuentas.find((x) => x.id === id); return c ? c.codigo + ' ' + c.nombre : id; };
      const resumen = h('details', h('summary', 'Ver cómo quedaría el asiento'), h('div.tabla-caja', h('table.con-tabla', h('thead', h('tr', h('th', 'Cuenta'), h('th.der', 'Debe'), h('th.der', 'Haber'))),
        h('tbody', lineasP.map((l) => h('tr', h('td', nombre(l.cuenta_id)), h('td.der', l.debe ? money(l.debe) : ''), h('td.der', l.haber ? money(l.haber) : ''))))),
        h('p.con-nota', 'Es la propuesta con las cuentas de arriba tal como están guardadas; al confirmar se recalcula con lo que usted escoja.')));
      llenar(cuerpo, 
        d.asiento ? h('p.con-nota', 'Contabilizada en el asiento ' + d.asiento + (d.provisional ? ' (provisional: ' + (d.provisional_motivo || 'cuentas sin confirmar') + ')' : '') + '. Si cambia una cuenta y confirma, el asiento se reversa y se hace uno nuevo.') : null,
        filas, lineasP.length ? resumen : null,
        h('div.con-acciones', h('button.btn.primario', { type: 'button', onclick: (e) => conBoton(e.currentTarget, async () => {
          const falta = [...sel.entries()].filter(([, s]) => !s.value);
          if (falta.length) { toast('Falta escoger la cuenta de ' + falta.length + (falta.length === 1 ? ' línea' : ' líneas'), 'error'); falta[0][1].focus(); return; }
          const items = d.lineas.map((l) => ({ linea: l.linea, cuenta_id: sel.get(l.linea).value, aprender: apr.get(l.linea).checked, origen: l.efectiva && l.efectiva === sel.get(l.linea).value && !l.confirmada ? 'sugerida' : 'manual' }));
          try { const r = await compraConfirmar(soc.id, f.clave, items, true); toast(r.estado === 'igual' ? 'Ya estaba contabilizada igual' : 'Factura contabilizada'); alCambiar(); } catch (er) { toast(textoDeError(er), 'error'); }
        }) }, d.asiento ? 'Confirmar el cambio' : 'Confirmar y contabilizar')));
    }

    /* ---------- Hoy ---------- */
    async function cargarHoy() {
      const mi = ++fichas.hoy; const hoy = hoyCR();
      llenar(bHoy, h('h2', 'Llegaron hoy'), esqueleto(1, 'Revisando las facturas de hoy…'));
      let r; try { r = await compras(soc.id, hoy, hoy, 'todas'); } catch (e) { if (mi === fichas.hoy) llenar(bHoy, h('h2', 'Llegaron hoy'), bloqueError({ titulo: 'No se pudieron cargar', mensaje: textoDeError(e), alReintentar: cargarHoy })); return; }
      if (mi !== fichas.hoy) return;
      const fs = r.facturas || [];
      llenar(bHoy, h('h2', 'Facturas de proveedores de hoy'), fs.length ? h('div', fs.map((f) => filaFactura(f, refrescar))) : h('p.con-ayuda', 'Hoy no han llegado facturas de proveedores.'));
    }

    /* ---------- Período ---------- */
    const periodo = selectorPeriodo({ inicial: memoria.comprasPeriodo || 'mes', alCambiar: ([d, a], id) => { memoria.comprasPeriodo = id; rango = [d, a]; cargarPeriodo(); } });
    rango = periodo.rango();
    async function cargarPeriodo() {
      const mi = ++fichas.per;
      const lista = h('div', esqueleto(2, 'Cargando las facturas…'));
      const chips = h('div.con-fila', { role: 'group', 'aria-label': 'Qué facturas ver' });
      llenar(bPeriodo, h('h2', 'Facturas del período'), h('p.con-ayuda', 'Toque una factura para ver sus líneas y confirmar a qué cuenta va cada una. Del más antiguo al más reciente.'), periodo.el,
        h('div', { style: 'margin:.6rem 0' }, h('input.campo', { type: 'search', placeholder: 'Buscar proveedor o número', value: q, 'aria-label': 'Buscar una factura', onchange: (e) => { q = e.target.value.trim(); memoria.comprasQ = q; cargarPeriodo(); } })), chips, lista);
      let r; try { r = await compras(soc.id, rango[0], rango[1], 'todas', q || null); } catch (e) { if (mi === fichas.per) llenar(lista, bloqueError({ titulo: 'No se pudieron cargar las facturas', mensaje: textoDeError(e), alReintentar: cargarPeriodo })); return; }
      if (mi !== fichas.per) return;
      const c = r.conteo || {}; ctx.avisar?.('compras', c.por_clasificar || 0);
      llenar(chips, ...FILTROS.map(([id, t]) => h('button.btn.chico', { type: 'button', 'aria-pressed': String(filtro === id), onclick: () => { filtro = id; memoria.comprasFiltro = id; pintarLista(); chips.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-pressed', String(FILTROS[i][0] === filtro))); } }, t + ' (' + (c[id] ?? 0) + ')')));
      function pintarLista() {
        const fs = (r.facturas || []).filter((f) => filtro === 'todas' || f.estado === (filtro === 'listas' ? 'lista' : filtro === 'contabilizadas' ? 'contabilizada' : 'por_clasificar'));
        const listas = (r.facturas || []).filter((f) => f.estado === 'lista');
        llenar(lista, 
          filtro === 'listas' && listas.length ? h('div.con-acciones', { style: 'margin:0 0 .6rem' }, h('button.btn.primario', { type: 'button', onclick: (e) => conBoton(e.currentTarget, async () => {
            try { const x = await comprasAceptarSugerencias(soc.id, listas.slice(0, 300).map((f) => f.clave)); toast(x.contabilizadas + ' facturas contabilizadas' + (x.errores?.length ? ' · ' + x.errores.length + ' con error' : '')); await refrescar(); } catch (er) { toast(textoDeError(er), 'error'); }
          }) }, 'Aceptar las propuestas de estas ' + Math.min(300, listas.length) + ' facturas')) : null,
          fs.length ? h('div', fs.slice(0, 200).map((f) => filaFactura(f, refrescar))) : h('div.con-vacio', 'No hay facturas en esta lista para ' + textoRango(rango[0], rango[1]) + '.'),
          fs.length > 200 ? h('p.con-nota', 'Se muestran las primeras 200; use la búsqueda o un período más corto.') : null);
      }
      pintarLista();
    }
    async function refrescar() { await Promise.all([cargarHoy(), cargarPeriodo()]); }

    /* ---------- Lo aprendido ---------- */
    async function cargarReglas() {
      llenar(bReglas, h('summary', 'Lo que el sistema aprendió de sus proveedores'), esqueleto(1, 'Cargando…'));
      let r; try { r = await reglas(soc.id); } catch (e) { llenar(bReglas, h('summary', 'Lo que el sistema aprendió de sus proveedores'), bloqueError({ titulo: 'No se pudo cargar', mensaje: textoDeError(e), alReintentar: cargarReglas })); return; }
      llenar(bReglas, h('summary', 'Lo que el sistema aprendió de sus proveedores (' + r.length + ')'),
        h('p.con-ayuda', 'Cada vez que usted confirma una línea y deja marcada la casilla «Recordar», la próxima factura del mismo proveedor y tipo de producto llega con esa cuenta propuesta. Si una regla ya no sirve, quítela.'),
        r.length ? h('div.tabla-caja', h('table.con-tabla', h('thead', h('tr', h('th', 'Proveedor'), h('th', 'Tipo de producto (CABYS)'), h('th', 'Cuenta'), h('th.der', 'Veces'), h('th', ''))),
          h('tbody', r.map((x) => h('tr', h('td', x.proveedor || x.proveedor_cedula || 'Cualquiera'), h('td.con-codigo', x.cabys_prefijo ? x.cabys_prefijo + '…' : x.palabra || ''), h('td', x.cuenta), h('td.der', String(x.usos)),
            h('td', h('button.btn.chico', { type: 'button', onclick: (e) => conBoton(e.currentTarget, async () => { try { await reglaQuitar(soc.id, x.id); toast('Regla quitada'); await cargarReglas(); } catch (er) { toast(textoDeError(er), 'error'); } }) }, 'Quitar'))))))) : h('div.con-vacio', 'Todavía no hay reglas aprendidas.'));
    }
    bReglas.addEventListener('toggle', () => { if (bReglas.open) cargarReglas(); });
    bReglas.append(h('summary', 'Lo que el sistema aprendió de sus proveedores'));

    await Promise.all([cargarHoy(), cargarPeriodo()]);
  },
};
