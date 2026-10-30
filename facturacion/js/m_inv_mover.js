// Mover entre bodegas (fx_inv_trasladar), Salidas y mermas (fx_inv_salida: consumo, merma, devolución; fx_inv_porcionar) y, para administradores,
// Corregir existencias (fx_inv_ajustar) y Entrada manual (fx_inv_entrada_manual). Toda salida consume por FEFO: primero lo que vence primero.
// Cada formulario es UNA intención: su clave de repetición se crea al primer toque y se reutiliza en «Reintentar» (m_inv_comun.js, accionSegura).
import { h, money, num, horaCorta, sumaDias } from './util.js';
import { graficoColumnas, autoAjustar } from './graficos.js';
import { inv, cant, dinero } from './api_inventarios.js';
import {
  ventana, dialogo, cargando, falla, vacio, aviso, cantTxt, costoTxt, unidadTxt, dma, plural, empresaChip, chipEmpresaId, selectUbicacion, nombreUbicacion,
  elegirArticulo, opcionDeArticulo, campoCantidad, leerMonto, accionSegura, rotular, repetidaTxt, enfocar, poner } from './m_inv_comun.js';

/* =====================================================================================================================
   Las dos secciones
   ===================================================================================================================== */
export async function abrir(ctx, id, pedido = {}) {
  return id === 'salidas' ? seccionSalidas(ctx, pedido) : seccionMover(ctx, pedido);
}
// Quién hizo un movimiento: el nombre de la persona, o «el sistema» para el vencimiento automático de las 5:30
export const quienTxt = (m) => (m.usuario === 'sistema' ? 'el sistema, solo' : m.usuario_nombre || m.usuario || 'sin dato');
const TIPOS_SALIDA = ['consumo', 'merma', 'devolucion', 'porcion_salida', 'salida_vencimiento', 'ajuste_conteo', 'ajuste_manual', 'anulacion_entrada'];

// Lista de movimientos de HOY (quién, qué, cuánto, por qué)
function listaHoy(ctx, filas, vacioTxt) {
  if (!filas.length) return vacio(vacioTxt);
  return h('ul.inv-movs', filas.map((m) => h('li.inv-mov',
    h('span.inv-mov-hora.cifra', horaCorta(m.creado_en)),
    h('span.inv-mov-dato', h('strong', m.articulo), h('small', [m.tipo_nombre, m.ubicacion + (m.contraparte_ubicacion ? (Number(m.cantidad) < 0 ? ' → ' : ' ← ') + m.contraparte_ubicacion : ''), m.motivo && m.motivo !== m.tipo_nombre ? '«' + m.motivo + '»' : '', quienTxt(m)].filter(Boolean).join(' · '))),
    h('span.inv-mov-cant.cifra' + (Number(m.cantidad) < 0 ? '.sale' : '.entra'), (Number(m.cantidad) > 0 ? '+' : '') + cantTxt(m.cantidad, m.unidad)),
    h('span.inv-mov-val.cifra', money(Math.abs(Number(m.valor) || 0))))));
}

async function seccionMover(ctx, pedido) {
  const hoyLista = h('div', cargando('Cargando los traslados de hoy…'));
  let vivo = true;
  const cargar = async () => {
    try {
      const d = await inv.movimientos(ctx.hoy, ctx.hoy, { tipo: 'traslado_salida', limite: 500 });
      if (vivo) poner(hoyLista, listaHoy(ctx, d.filas || [], 'Hoy no se ha trasladado nada.'));
    } catch (e) { if (vivo) poner(hoyLista, falla(e, cargar, 'No se pudieron cargar los traslados de hoy')); }
  };
  const alCambio = () => { if (vivo) cargar(); };
  document.addEventListener('inv:cambio', alCambio);
  const v = ventana({ titulo: 'Mover entre bodegas', contenido: [
    h('div.inv-ventana-cab', h('p', 'Pasar mercadería de la bodega central a un local, o de un lugar a otro. Lo que se mueve conserva su vencimiento, su costo y su empresa de origen.')),
    h('div.inv-acciones-grandes', h('button.btn.primario.grande', { type: 'button', onclick: () => formTraslado(ctx, {}) }, 'Hacer un traslado')),
    h('section.inv-grupo', h('h3', 'Traslados de hoy'), hoyLista)],
  alCerrar: () => { vivo = false; document.removeEventListener('inv:cambio', alCambio); } });
  await cargar();
  enfocar(v.cuerpo);
  if (pedido.origen || pedido.articulo) formTraslado(ctx, pedido);
}

async function seccionSalidas(ctx, pedido) {
  const hoyLista = h('div', cargando('Cargando las salidas de hoy…'));
  const mes = h('div', cargando('Cargando las mermas del mes…'));
  let vivo = true, quitarGrafico = null;
  const desde = ctx.hoy.slice(0, 8) + '01';
  const cargar = async () => {
    try {
      const d = await inv.movimientos(ctx.hoy, ctx.hoy, { limite: 500 });
      const filas = (d.filas || []).filter((m) => Number(m.cantidad) < 0 && TIPOS_SALIDA.includes(m.tipo));
      if (vivo) poner(hoyLista, listaHoy(ctx, filas, 'Hoy no ha salido nada.'));
    } catch (e) { if (vivo) poner(hoyLista, falla(e, cargar, 'No se pudieron cargar las salidas de hoy')); }
    try { const m = await inv.mermas(desde, ctx.hoy); if (vivo) pintarMes(m); } catch (e) { if (vivo) poner(mes, falla(e, cargar, 'No se pudieron cargar las mermas del mes')); }
  };
  function pintarMes(m) {
    quitarGrafico?.(); quitarGrafico = null;
    const porDia = new Map((m.por_dia || []).map((x) => [x.fecha, x]));
    const dias = [];
    for (let d = desde; d <= ctx.hoy; d = sumaDias(d, 1)) { const x = porDia.get(d) || { merma: 0, vencimiento: 0 }; dias.push({ fecha: d, merma: Number(x.merma) || 0, vencimiento: Number(x.vencimiento) || 0 }); }
    const lectura = h('p.lectura.inv-lectura', { 'aria-live': 'polite' }, 'Toque una columna para ver el detalle de ese día.');
    const caja = h('div.gr-caja');
    const datos = dias.map((x) => ({ etiqueta: x.fecha.slice(8, 10), valor: Math.round((x.merma + x.vencimiento) * 100) / 100,
      texto: dma(x.fecha) + ': merma ' + money(x.merma) + ' y vencimiento ' + money(x.vencimiento) + ', en total ' + money(x.merma + x.vencimiento) + ' al costo sin IVA.' }));
    const porTipo = m.por_tipo || [];
    const porArt = (m.por_articulo || []).slice().sort((a, b) => Number(b.valor) - Number(a.valor)).slice(0, 10);
    poner(mes, 
      h('ul.inv-datos-lista',
        h('li', h('span', 'Total del mes (merma y vencimiento)'), h('strong.cifra', money(m.total?.valor || 0) + ' · ' + plural(m.total?.movimientos || 0, 'salida', 'salidas'))),
        ...porTipo.map((t) => h('li', h('span', t.nombre || (t.tipo === 'merma' ? 'Merma' : 'Vencimiento automático')), h('strong.cifra', money(t.valor) + ' · ' + plural(t.movimientos, 'salida', 'salidas')))),
        ...(m.por_empresa || []).map((e) => h('li', chipEmpresaId(ctx.cat, e.sociedad_id, e.sociedad_nombre), h('strong.cifra', money(e.valor))))),
      h('h4', 'Pérdida por día del mes, al costo sin IVA (cifras netas de IVA)'), caja, lectura,
      porArt.length ? h('div', h('h4', 'Lo que más se perdió este mes'), h('ul.inv-datos-lista', porArt.map((a) => h('li', h('span', a.articulo + ' (' + (a.tipo === 'merma' ? 'merma' : 'vencimiento') + ')'), h('strong.cifra', cantTxt(a.cantidad, a.unidad) + ' · ' + money(a.valor)))))) : null);
    quitarGrafico = autoAjustar(caja, (w) => poner(caja, graficoColumnas(datos, {
      ancho: w, alto: 240, tituloX: 'Día de ' + mesNombre(ctx.hoy) + ' (del 1 a hoy)', tituloY: 'Pérdida en colones', color: 'ambar', anchoEtiqueta: 26,
      descripcion: 'Pérdida por merma y vencimiento de cada día del mes, en colones al costo sin IVA', alSeleccionar: (d) => { lectura.textContent = d.texto; } })));
  }
  const alCambio = () => { if (vivo) cargar(); };
  document.addEventListener('inv:cambio', alCambio);
  const v = ventana({ titulo: 'Salidas y mermas', contenido: [
    h('div.inv-ventana-cab', h('p', 'Registre lo que se usó (consumo), lo que se dañó o se botó (merma) y el porcionado. Siempre sale primero lo que vence primero.')),
    h('div.inv-acciones-grandes',
      h('button.btn.primario.grande', { type: 'button', onclick: () => formSalida(ctx, { tipo: 'merma' }) }, 'Registrar una merma'),
      h('button.btn.grande', { type: 'button', onclick: () => formSalida(ctx, { tipo: 'consumo' }) }, 'Registrar un consumo'),
      h('button.btn.grande', { type: 'button', onclick: () => formPorcionar(ctx, {}) }, 'Porcionar')),
    h('section.inv-grupo', h('h3', 'Salidas de hoy'), hoyLista),
    h('section.inv-grupo', h('h3', 'Mermas y vencimientos de este mes'), mes)],
  alCerrar: () => { vivo = false; quitarGrafico?.(); document.removeEventListener('inv:cambio', alCambio); } });
  await cargar();
  enfocar(v.cuerpo);
  if (pedido.tipo) formSalida(ctx, pedido);
}
const mesNombre = (ymd) => new Intl.DateTimeFormat('es-CR', { timeZone: 'UTC', month: 'long' }).format(new Date(ymd + 'T12:00:00Z'));

/* =====================================================================================================================
   Lista de artículos con cantidades (sirve para trasladar, sacar, corregir y entrar a mano)
   ===================================================================================================================== */
// fuente(): promesa con las opciones [{ id, nombre, unidad, disponible?, extra }]. modo: 'salida' (con disponible), 'real' (cantidad real, 0 vale), 'entrada' (con costo y vencimiento)
export function editorItems(ctx, { fuente, modo = 'salida', inicial = [], etiquetaCant = 'Cantidad', vacioTxt = 'No hay artículos con existencia aquí.', unico = false }) {
  let opciones = [];
  const filas = [];
  const cont = h('div.inv-items');
  const agregar = unico ? null : h('button.btn', { type: 'button', onclick: () => nuevaFila() }, 'Agregar otro artículo');
  const estado = h('div');
  const el = h('div.inv-items-caja', estado, cont, agregar);
  function nuevaFila(pre = {}) {
    const f = { art: null, lote: pre.lote || null };
    const btn = h('button.btn.inv-item-art', { type: 'button', onclick: () => escoger() }, 'Escoger artículo');
    const disp = h('small.inv-item-disp');
    const c = campoCantidad({ etiqueta: modo === 'real' ? 'Cantidad que hay de verdad' : etiquetaCant, min0: modo === 'real' });
    const costo = modo === 'entrada' ? h('input.campo.inv-num', { type: 'text', inputmode: 'decimal', autocomplete: 'off', 'aria-label': 'Costo sin IVA por unidad (₡)' }) : null;
    const vence = modo === 'entrada' ? h('input.campo', { type: 'date', min: ctx.hoy, 'aria-label': 'Fecha de vencimiento' }) : null;
    const noVence = modo === 'entrada' ? h('input', { type: 'checkbox', onchange: () => { vence.disabled = noVence.checked; } }) : null;
    const quitar = unico ? null : h('button.btn.suave.inv-item-quitar', { type: 'button', onclick: () => { f.el.remove(); filas.splice(filas.indexOf(f), 1); if (!filas.length) nuevaFila(); } }, 'Quitar');
    f.el = h('div.inv-item',
      h('div.etq', h('span', 'Artículo'), btn, disp),
      c.el,
      modo === 'entrada' ? h('label.etq', 'Costo sin IVA por unidad (₡)', costo) : null,
      modo === 'entrada' ? h('div.etq', h('span', 'Vence'), vence, h('label.inv-casilla.chica', noVence, h('span', 'No vence'))) : null,
      quitar);
    f.c = c; f.costo = costo; f.vence = vence; f.noVence = noVence; f.btn = btn; f.disp = disp;
    f.poner = (o) => {
      f.art = o;
      btn.textContent = o ? o.nombre : 'Escoger artículo';
      btn.classList.toggle('falta', !o);
      c.unidad(o?.unidad || '');
      disp.textContent = o ? (f.lote ? 'Solo del lote escogido · ' : '') + (o.extra || '') : '';
      if (modo === 'entrada' && o?.a) { const vig = o.a.no_vence ? null : o.a.vigencia_efectiva; noVence.checked = vig == null; vence.disabled = vig == null; vence.value = vig == null ? '' : sumaDias(ctx.hoy, Math.max(Number(vig) - 1, 0)); }
    };
    async function escoger() {
      const o = await elegirArticulo({ titulo: 'Escoja el artículo', opciones, vacioTxt });
      if (o) { f.lote = null; f.poner(o); c.input.focus(); }
    }
    filas.push(f); cont.append(f.el);
    if (pre.articulo) { const o = opciones.find((x) => x.id === pre.articulo); if (o) f.poner(o); }
    if (pre.cantidad != null) c.poner(pre.cantidad);
    return f;
  }
  return {
    el,
    // Trae las opciones (lo que hay en la ubicación escogida). Si falla, lo dice aquí mismo con «Intentar de nuevo».
    async cargar(primera = false) {
      estado.hidden = false; poner(estado, cargando('Buscando lo que hay…'));
      try { opciones = await fuente(); }
      catch (e) { poner(estado, falla(e, () => this.cargar(primera), 'No se pudo saber qué hay aquí')); if (primera && !filas.length) nuevaFila(); return; }
      poner(estado, opciones.length ? '' : aviso('espera', h('p', vacioTxt)));
      estado.hidden = !!opciones.length;
      filas.forEach((f) => { if (f.art) { const o = opciones.find((x) => x.id === f.art.id); f.poner(o || null); } });
      if (primera) { if (inicial.length) inicial.forEach((p) => nuevaFila(p)); else nuevaFila(); }
    },
    problema() {
      const usadas = filas.filter((f) => f.art || f.c.input.value.trim());
      if (!usadas.length) return 'Escoja al menos un artículo.';
      for (const f of usadas) {
        if (!f.art) return 'Escoja el artículo de cada fila (o quite la fila vacía).';
        if (!f.c.valido()) return 'Revise la cantidad de «' + f.art.nombre + '».';
        if (modo === 'salida' && f.art.disponible != null && f.c.leer() > Number(f.art.disponible) + 1e-9) return 'De «' + f.art.nombre + '» solo hay ' + cantTxt(f.art.disponible, f.art.unidad) + ' disponibles aquí.';
        if (modo === 'entrada') {
          const v = leerMonto(f.costo.value);
          if (!Number.isFinite(v) || v < 0) return 'Escriba el costo sin IVA de «' + f.art.nombre + '» (un monto, puede ser 0).';
          if (!f.noVence.checked && !f.vence.value) return 'Escriba cuándo vence «' + f.art.nombre + '» o marque «No vence».';
        }
      }
      const ids = usadas.map((f) => f.art.id + ':' + (f.lote || ''));
      if (new Set(ids).size !== ids.length) return 'Hay un artículo repetido: júntelo en una sola fila.';
      return '';
    },
    items() {
      return filas.filter((f) => f.art).map((f) => {
        if (modo === 'real') return { articulo_id: f.art.id, cantidad_real: cant(f.c.leer()) };
        const x = { articulo_id: f.art.id, cantidad: cant(f.c.leer()) };
        if (f.lote) x.lote_id = f.lote;
        if (modo === 'entrada') { x.costo_unitario = dinero(leerMonto(f.costo.value)); if (f.noVence.checked) x.sin_vencimiento = true; else x.vence_en = f.vence.value; }
        return x;
      });
    },
    unidadDe: (id) => opciones.find((o) => o.id === id)?.unidad,
    hay: () => opciones.length > 0,
  };
}
// Opciones: lo que hay en una ubicación (para sacar o trasladar). conVencidos: la merma y la devolución pueden usar lotes ya vencidos; el consumo y el traslado no.
export async function opcionesDe(ubicacion, conVencidos) {
  if (!ubicacion) return [];
  const d = await inv.existencias(ubicacion, null, '', false);
  return (d.filas || []).filter((f) => Number(f.cantidad) > 0).map((f) => {
    const disponible = conVencidos ? Number(f.cantidad) : Math.max(0, Number(f.cantidad) - Number(f.cantidad_vencida || 0));
    return { id: f.articulo_id, nombre: f.articulo, unidad: f.unidad, disponible, detalle: f.categoria || '',
      extra: 'Hay ' + cantTxt(disponible, f.unidad) + (conVencidos ? '' : ' que se pueden usar') + (Number(f.cantidad_vencida) > 0 && !conVencidos ? ' (además ' + cantTxt(f.cantidad_vencida, f.unidad) + ' vencido, que sale como merma)' : '') };
  }).filter((o) => o.disponible > 0);
}
const motivoCampo = (placeholder, obligatorio) => h('input.campo', { type: 'text', maxlength: 200, 'aria-label': obligatorio ? 'Motivo' : 'Motivo (opcional)', placeholder });
const rapidos = (campo, lista) => h('div.inv-rapidos', lista.map((t) => h('button.btn.chico.inv-rapido', { type: 'button', onclick: () => { campo.value = t; campo.focus(); } }, t)));
function leerMotivo(campo, obligatorio) {
  const m = campo.value.trim().replace(/\s+/g, ' ');
  if (obligatorio && m.length < 3) { campo.focus(); throw new Error('Escriba el motivo (al menos 3 letras).'); }
  if (!obligatorio && m && m.length < 3) { campo.focus(); throw new Error('El motivo tiene que tener al menos 3 letras, o déjelo vacío.'); }
  return m || null;
}
// Formulario de una sola intención: el botón principal hace la llamada; al terminar se muestra el resultado y se ofrece «Hacer otro»
function formulario({ titulo, ancho = 760, partes, boton, ocupado, hacer, resultado, otro, alFallar }) {
  const zona = h('div');
  const caja = h('div.inv-form', partes, zona);
  const fin = h('div.inv-form-fin', { hidden: true });
  const ok = h('button.btn.primario.grande', { type: 'button' }, boton);
  const d = dialogo({ titulo, ancho, contenido: [caja, fin], botones: [{ texto: 'Cerrar', onclick: (c) => c() }] });
  d.el.querySelector('.modal-pie').append(ok);
  const acc = accionSegura({ boton: ok, zona, ocupado, hacer, alFallar,
    alTerminar: (r, info) => {
      caja.hidden = true; ok.hidden = true; fin.hidden = false;
      poner(fin, resultado(r, info), h('div.inv-form-otra', h('button.btn', { type: 'button', onclick: () => { d.cerrar(); otro?.(); } }, 'Hacer otro'), h('button.btn.primario', { type: 'button', onclick: () => d.cerrar() }, 'Listo, cerrar')));
      fin.querySelector('.inv-form-otra .primario')?.focus();
    } });
  ok.addEventListener('click', () => acc.ejecutar());
  return { d, ok };
}

/* ---------- Traslado ---------- */
export async function formTraslado(ctx, pre = {}) {
  const cat = ctx.cat;
  const bodega = (cat.ubicaciones || []).find((u) => u.tipo === 'bodega' && u.predeterminada && u.activo !== false);
  let origen = pre.origen || bodega?.id || '';
  const selO = selectUbicacion(cat, { valor: origen, etiqueta: 'Desde dónde', alCambiar: async (v) => { origen = v; pintarDestino(); await items.cargar(); } });
  const destCaja = h('div');
  let selD = null;
  const pintarDestino = () => { const prev = selD?.value; selD = selectUbicacion(cat, { valor: prev && prev !== origen ? prev : '', etiqueta: 'Hacia dónde', excluir: origen }); poner(destCaja, h('label.etq', 'Hacia dónde', selD)); };
  pintarDestino();
  const motivo = motivoCampo('Por ejemplo: para el turno de la noche', false);
  const items = editorItems(ctx, { fuente: () => opcionesDe(origen, false), inicial: pre.articulo ? [{ articulo: pre.articulo, cantidad: pre.cantidad, lote: pre.lote }] : [] });
  formulario({ titulo: 'Hacer un traslado', boton: 'Trasladar', ocupado: 'Trasladando…',
    partes: [h('div.inv-form-fila', h('label.etq', 'Desde dónde', selO), destCaja), h('h3', 'Qué se mueve'), items.el, h('label.etq', 'Motivo (opcional)', motivo)],
    hacer: (idem) => {
      if (!origen) throw new Error('Escoja desde dónde sale.');
      if (!selD.value) throw new Error('Escoja hacia dónde va.');
      const p = items.problema(); if (p) throw new Error(p);
      return inv.trasladar(origen, selD.value, items.items(), leerMotivo(motivo, false), idem);
    },
    resultado: (r, { repetida }) => aviso('ok', h('p', h('strong', 'Listo: se trasladó de ' + nombreUbicacion(cat, r.origen_id) + ' a ' + nombreUbicacion(cat, r.destino_id) + '.'), ' Valor al costo, sin IVA: ' + money(r.valor_total) + '.' + repetidaTxt(repetida)),
      h('ul.inv-res-lista', (r.items || []).map((it) => h('li', it.articulo + ': ' + cantTxt(it.cantidad, items.unidadDe(it.articulo_id)) + ' (' + money(it.valor) + ')' +
        ((it.piezas || []).some((p) => p.vence_en) ? ' · vence ' + [...new Set(it.piezas.map((p) => p.vence_en ? dma(p.vence_en) : 'no vence'))].join(', ') : ''))))),
    otro: () => formTraslado(ctx, { origen }), alFallar: (e) => { if (e?.codigo === 'P0001') items.cargar(); } });
  await items.cargar(true);
}

/* ---------- Consumo, merma o devolución ---------- */
const MOTIVOS = {
  consumo: ['Uso en cocina', 'Preparación del día', 'Comida del personal', 'Muestra o degustación'],
  merma: ['Se venció', 'Se dañó o se echó a perder', 'Se cayó o se quemó', 'Mal estado al abrirlo', 'Se lo comieron plagas'],
  devolucion: ['Llegó en mal estado', 'No era lo que se pidió', 'Llegó de más'],
};
const NOMBRE_SALIDA = { consumo: 'consumo', merma: 'merma', devolucion: 'devolución a proveedor' };
export async function formSalida(ctx, pre = {}) {
  const cat = ctx.cat;
  let tipo = MOTIVOS[pre.tipo] ? pre.tipo : 'merma';
  const bodega = (cat.ubicaciones || []).find((u) => u.tipo === 'bodega' && u.predeterminada && u.activo !== false);
  let ubic = pre.ubicacion || bodega?.id || '';
  const sel = selectUbicacion(cat, { valor: ubic, etiqueta: 'De dónde sale', alCambiar: async (v) => { ubic = v; await items.cargar(); } });
  const motivo = motivoCampo('Escriba o toque una de las opciones', true);
  if (pre.motivo) motivo.value = pre.motivo;
  const rapCaja = h('div');
  const tipos = h('div.inv-segmento', { role: 'group', 'aria-label': 'Qué tipo de salida' });
  const ayuda = h('p.tenue.inv-chico');
  let ok = null;
  const pintarTipo = () => {
    poner(tipos, ...['merma', 'consumo', 'devolucion'].map((t) => h('button.btn.inv-seg', { type: 'button', 'aria-pressed': String(tipo === t), onclick: async () => { if (tipo === t) return; tipo = t; pintarTipo(); await items.cargar(); } }, t === 'merma' ? 'Merma' : t === 'consumo' ? 'Consumo' : 'Devolución a proveedor')));
    poner(rapCaja, rapidos(motivo, MOTIVOS[tipo]));
    ayuda.textContent = tipo === 'merma' ? 'Lo que se dañó, se venció o se botó. Puede sacar también lo que ya está vencido.' : tipo === 'consumo' ? 'Lo que se usó. No saca lotes vencidos: esos se sacan como merma.' : 'Mercadería que se le devuelve al proveedor sin nota de crédito. Si el proveedor mandó una nota de crédito, use «Notas de proveedor».';
    if (ok) rotular(ok, 'Registrar ' + NOMBRE_SALIDA[tipo]);
  };
  const items = editorItems(ctx, { fuente: () => opcionesDe(ubic, tipo !== 'consumo'), inicial: pre.articulo ? [{ articulo: pre.articulo, cantidad: pre.cantidad, lote: pre.lote }] : [] });
  const f = formulario({ titulo: 'Registrar una salida', boton: 'Registrar ' + NOMBRE_SALIDA[tipo], ocupado: 'Registrando…',
    partes: [h('div.etq', h('span', 'Qué es'), tipos), ayuda, h('label.etq', 'De dónde sale', sel), h('h3', 'Qué sale'), items.el, h('label.etq', 'Motivo (obligatorio)', motivo), rapCaja],
    hacer: (idem) => {
      if (!ubic) throw new Error('Escoja de dónde sale.');
      const p = items.problema(); if (p) throw new Error(p);
      return inv.salida(tipo, ubic, items.items(), leerMotivo(motivo, true), idem);
    },
    resultado: (r, { repetida }) => aviso('ok', h('p', h('strong', 'Listo: se registró la ' + NOMBRE_SALIDA[r.tipo || tipo] + ' en ' + nombreUbicacion(cat, r.ubicacion_id) + '.'), ' Valor al costo, sin IVA: ' + money(r.valor_total) + '.' + repetidaTxt(repetida)),
      h('ul.inv-res-lista', (r.items || []).map((it) => h('li', it.articulo + ': ' + cantTxt(it.cantidad, items.unidadDe(it.articulo_id)) + ' (' + money(it.valor) + ')' + ((it.piezas || []).length > 1 ? ', de ' + plural(it.piezas.length, 'lote', 'lotes') : ''))))),
    otro: () => formSalida(ctx, { tipo, ubicacion: ubic }), alFallar: (e) => { if (e?.codigo === 'P0001') items.cargar(); } });
  ok = f.ok;
  pintarTipo();
  await items.cargar(true);
}

/* ---------- Porcionado ---------- */
export async function formPorcionar(ctx, pre = {}) {
  const cat = ctx.cat;
  const bodega = (cat.ubicaciones || []).find((u) => u.tipo === 'bodega' && u.predeterminada && u.activo !== false);
  let ubic = pre.ubicacion || bodega?.id || '';
  let todos = [];
  const sel = selectUbicacion(cat, { valor: ubic, etiqueta: 'Dónde se porciona', alCambiar: async (v) => { ubic = v; await origen.cargar(); } });
  const origen = editorItems(ctx, { fuente: () => opcionesDe(ubic, false), etiquetaCant: 'Cuánto se usa', unico: true });
  const resultados = h('div.inv-items');
  const filasR = [];
  const agregarR = h('button.btn', { type: 'button', onclick: () => nuevaR() }, 'Agregar otro resultado');
  function nuevaR() {
    const r = { art: null };
    const btn = h('button.btn.inv-item-art', { type: 'button', onclick: async () => { const o = await elegirArticulo({ titulo: 'Qué resulta', opciones: todos }); if (o) { r.art = o; btn.textContent = o.nombre; btn.classList.remove('falta'); c.unidad(o.unidad); } } }, 'Escoger artículo');
    const c = campoCantidad({ etiqueta: 'Cuánto resulta' });
    const prop = h('input.campo.inv-num', { type: 'text', inputmode: 'decimal', autocomplete: 'off', 'aria-label': 'Parte del costo' });
    const vence = h('input.campo', { type: 'date', min: ctx.hoy, 'aria-label': 'Vence (opcional)' });
    const quitar = h('button.btn.suave.inv-item-quitar', { type: 'button', onclick: () => { r.el.remove(); filasR.splice(filasR.indexOf(r), 1); if (!filasR.length) nuevaR(); } }, 'Quitar');
    r.el = h('div.inv-item', h('div.etq', h('span', 'Artículo que resulta'), btn), c.el,
      h('details.inv-corregir', h('summary', 'Más opciones'), h('label.etq', 'Parte del costo (opcional)', prop, h('small', 'Sin escribir nada, el costo se reparte según la cantidad.')), h('label.etq', 'Vence (opcional)', vence, h('small', 'Si lo deja vacío: el vencimiento más cercano de lo que se usó.'))),
      quitar);
    Object.assign(r, { c, prop, vence, btn });
    filasR.push(r); resultados.append(r.el);
  }
  formulario({ titulo: 'Porcionar', boton: 'Porcionar', ocupado: 'Porcionando…',
    partes: [h('p.tenue', 'Por ejemplo: de un pollo entero salen piezas, o de un saco salen bolsas. El costo de lo que se usa se reparte entre lo que resulta.'),
      h('label.etq', 'Dónde se porciona', sel), h('h3', 'Lo que se usa'), origen.el, h('h3', 'Lo que resulta'), resultados, agregarR],
    hacer: (idem) => {
      if (!ubic) throw new Error('Escoja dónde se porciona.');
      const p = origen.problema(); if (p) throw new Error(p);
      const usados = filasR.filter((r) => r.art || r.c.input.value.trim());
      if (!usados.length) throw new Error('Escoja al menos un artículo que resulta.');
      const res = usados.map((r) => {
        if (!r.art) throw new Error('Escoja el artículo de cada resultado (o quite la fila vacía).');
        if (!r.c.valido()) throw new Error('Revise la cantidad de «' + r.art.nombre + '».');
        const x = { articulo_id: r.art.id, cantidad: cant(r.c.leer()) };
        if (r.prop.value.trim()) { const v = leerMonto(r.prop.value); if (!Number.isFinite(v) || v <= 0) throw new Error('La parte del costo de «' + r.art.nombre + '» tiene que ser un número mayor que cero.'); x.proporcion = String(v); }
        if (r.vence.value) { if (r.vence.value < ctx.hoy) throw new Error('El vencimiento de «' + r.art.nombre + '» no puede ser anterior a hoy.'); x.vence_en = r.vence.value; }
        return x;
      });
      const [o] = origen.items();
      return inv.porcionar(ubic, { articulo_id: o.articulo_id, cantidad: o.cantidad, ...(o.lote_id ? { lote_id: o.lote_id } : {}) }, res, null, idem);
    },
    resultado: (r, { repetida }) => aviso('ok', h('p', h('strong', 'Listo: se porcionó.'), ' Se usó mercadería por ' + money(r.valor_consumido) + ' (al costo, sin IVA).' + repetidaTxt(repetida)),
      h('ul.inv-res-lista', (r.resultados || []).map((x) => h('li', x.articulo + ': ' + num(x.cantidad, 3) + ' a ' + costoTxt(x.costo_unitario) + ' cada una (' + money(x.valor) + ')' + (x.vence_en ? ', vence el ' + dma(x.vence_en) : ', no vence')))),
      Number(r.diferencia_redondeo) ? h('p.tenue.inv-chico', 'Diferencia por redondeo: ' + costoTxt(r.diferencia_redondeo) + '.') : null),
    otro: () => formPorcionar(ctx, { ubicacion: ubic }) });
  nuevaR();
  const [listaTodos] = await Promise.all([ctx.articulos.lista(), origen.cargar(true)]);
  todos = listaTodos.filter((a) => a.activo !== false).map(opcionDeArticulo);
}

/* ---------- Administrador: corregir existencias (ajuste directo) ---------- */
export async function formAjuste(ctx, pre = {}) {
  if (!ctx.esAdmin) return;
  const cat = ctx.cat;
  let ubic = pre.ubicacion || (cat.ubicaciones || []).find((u) => u.tipo === 'bodega' && u.predeterminada)?.id || '';
  const sel = selectUbicacion(cat, { valor: ubic, etiqueta: 'Dónde', alCambiar: async (v) => { ubic = v; await items.cargar(); } });
  const motivo = motivoCampo('Por ejemplo: se encontró una caja que no estaba anotada', true);
  const fuente = async () => {
    const [arts, ex] = await Promise.all([ctx.articulos.lista(), ubic ? inv.existencias(ubic, null, '', true) : Promise.resolve({ filas: [] })]);
    const hay = new Map((ex.filas || []).map((f) => [f.articulo_id, f]));
    return arts.filter((a) => a.activo !== false).map((a) => ({ ...opcionDeArticulo(a), extra: hay.get(a.id) ? 'El sistema dice que hay ' + cantTxt(hay.get(a.id).cantidad, a.unidad) : 'El sistema dice que no hay' }));
  };
  const items = editorItems(ctx, { fuente, modo: 'real', inicial: pre.articulo ? [{ articulo: pre.articulo }] : [], vacioTxt: 'No hay artículos activos.' });
  formulario({ titulo: 'Corregir existencias', boton: 'Corregir existencias', ocupado: 'Corrigiendo…',
    partes: [aviso('espera', h('p', 'Escriba cuánto hay DE VERDAD de cada artículo. El sistema saca o agrega la diferencia. Para revisar muchos artículos es mejor un «Conteo físico».')),
      h('label.etq', 'Dónde', sel), h('h3', 'Lo que hay de verdad'), items.el, h('label.etq', 'Motivo (obligatorio)', motivo)],
    hacer: (idem) => {
      if (!ubic) throw new Error('Escoja dónde.');
      const p = items.problema(); if (p) throw new Error(p);
      return inv.ajustar(ubic, items.items(), leerMotivo(motivo, true), idem);
    },
    resultado: (r, { repetida }) => aviso('ok', h('p', h('strong', 'Listo: se corrigió.'), repetidaTxt(repetida)),
      h('ul.inv-res-lista', (r.ajustes || []).map((a) => { const u = items.unidadDe(a.articulo_id); return h('li', a.articulo + ': antes ' + cantTxt(a.antes, u) + ', ahora ' + cantTxt(a.despues, u) + (Number(a.diferencia) ? ' (' + (Number(a.diferencia) > 0 ? '+' : '') + num(a.diferencia, 3) + ', ' + money(a.valor) + ' sin IVA)' : ' (sin cambio)')); }))),
    otro: () => formAjuste(ctx, { ubicacion: ubic }) });
  await items.cargar(true);
}

/* ---------- Administrador: entrada manual ---------- */
export async function formEntradaManual(ctx, pre = {}) {
  if (!ctx.esAdmin) return;
  const cat = ctx.cat;
  let ubic = pre.ubicacion || (cat.ubicaciones || []).find((u) => u.tipo === 'bodega' && u.predeterminada)?.id || '';
  const sel = selectUbicacion(cat, { valor: ubic, etiqueta: 'Adónde entra', alCambiar: (v) => { ubic = v; } });
  const emp = h('select.campo', { 'aria-label': 'Empresa de origen' }, h('option', { value: '' }, 'Escoja la empresa'), (cat.empresas || []).map((e) => h('option', { value: e.id }, e.nombre)));
  if (ctx.app.socId && (cat.empresas || []).some((e) => e.id === ctx.app.socId)) emp.value = ctx.app.socId;
  const motivo = motivoCampo('Por ejemplo: compra en efectivo en el supermercado, sin factura electrónica', true);
  const fuente = async () => (await ctx.articulos.lista()).filter((a) => a.activo !== false).map(opcionDeArticulo);
  const items = editorItems(ctx, { fuente, modo: 'entrada', vacioTxt: 'No hay artículos activos.' });
  formulario({ titulo: 'Entrada manual', boton: 'Registrar la entrada', ocupado: 'Registrando…',
    partes: [aviso('espera', h('p', h('strong', 'Cuidado con contar dos veces. '), 'Si después llega la factura electrónica de esta mercadería, márquela «No es de inventario» con el motivo «Ya entró a mano».')),
      h('div.inv-form-fila', h('label.etq', 'Adónde entra', sel), h('label.etq', 'Empresa de origen (a nombre de quién se compró)', emp)),
      h('h3', 'Lo que entra'), items.el, h('label.etq', 'Motivo (obligatorio)', motivo)],
    hacer: (idem) => {
      if (!ubic) throw new Error('Escoja adónde entra.');
      if (!emp.value) throw new Error('Escoja la empresa de origen.');
      const p = items.problema(); if (p) throw new Error(p);
      return inv.entradaManual(ubic, emp.value, items.items(), leerMotivo(motivo, true), idem);
    },
    resultado: (r, { repetida }) => aviso('ok', h('p', h('strong', 'Listo: entró al inventario.'), repetidaTxt(repetida)),
      h('p', empresaChip((cat.empresas || []).find((e) => e.id === emp.value)?.nombre, (cat.empresas || []).find((e) => e.id === emp.value)?.codigo)),
      h('ul.inv-res-lista', (r.lotes || []).map((l) => h('li', l.articulo + ': ' + cantTxt(l.cantidad, items.unidadDe(l.articulo_id)) + ' a ' + costoTxt(l.costo_unitario) + ' (' + money(l.valor) + ' sin IVA)' + (l.vence_en ? ', vence el ' + dma(l.vence_en) : ', no vence'))))),
    otro: () => formEntradaManual(ctx, { ubicacion: ubic }) });
  await items.cargar(true);
}
