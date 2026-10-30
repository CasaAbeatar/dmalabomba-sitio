// Existencias: qué hay en cada bodega y local (fx_inv_existencias), con lo de HOY arriba (lo que vence pronto, lo vencido, lo que está bajo el mínimo)
// y el valor al final. Tocar un artículo abre sus lotes (fx_inv_lotes) en el orden en que van saliendo, con su empresa de origen y su factura.
import { h, money, num, fechaHora, debounce, campoBusqueda } from './util.js';
import { inv } from './api_inventarios.js';
import { ventana, cargando, falla, vacio, aviso, cantTxt, costoTxt, venceTxt, claseVence, dma, plural, empresaChip, chipEmpresaId, selectUbicacion, enfocar, poner } from './m_inv_comun.js';

const ORIGEN = { factura: 'Entró por factura', manual: 'Entrada manual', traslado: 'Llegó por traslado', porcionado: 'Salió de un porcionado', conteo: 'Sobrante de un conteo', ajuste: 'Ajuste directo' };
const ESTADO_LOTE = { activo: '', agotado: 'Agotado', vencido: 'Vencido', anulado: 'Anulado' };

export async function abrir(ctx, _id, pedido = {}) {
  const cat = ctx.cat;
  const dias = Number(cat.config?.dias_aviso ?? 2);
  const est = { ubicacion: pedido.ubicacion || '', categoria: '', q: '', ceros: false, solo: '', datos: null };
  let vivo = true, seq = 0;
  const ubic = selectUbicacion(cat, { todas: true, valor: est.ubicacion, etiqueta: 'Bodega o local', alCambiar: (v) => { est.ubicacion = v; cargar(); } });
  const categ = h('select.campo', { 'aria-label': 'Categoría', onchange: () => { est.categoria = categ.value; cargar(); } },
    h('option', { value: '' }, 'Todas las categorías'), (cat.categorias || []).filter((c) => c.activo !== false).map((c) => h('option', { value: c.id }, c.nombre)));
  const buscar = h('input.campo', { type: 'search', placeholder: 'Nombre del artículo o CABYS', 'aria-label': 'Buscar artículo', autocomplete: 'off' });
  buscar.addEventListener('input', debounce(() => { est.q = buscar.value.trim(); cargar(); }, 300));
  const ceros = h('input', { type: 'checkbox', onchange: () => { est.ceros = ceros.checked; cargar(); } });
  const hoyCaja = h('div.inv-hoy-filtros', { role: 'group', 'aria-label': 'Ver solo' });
  const lista = h('div.inv-exis', cargando('Cargando existencias…'));
  const totales = h('div.inv-resumen');
  const admin = ctx.esAdmin ? h('div.inv-admin-btns',
    h('button.btn', { type: 'button', onclick: async () => (await import('./m_inv_mover.js')).formEntradaManual(ctx, { ubicacion: est.ubicacion }) }, 'Entrada manual (administrador)'),
    h('button.btn', { type: 'button', onclick: async () => (await import('./m_inv_mover.js')).formAjuste(ctx, { ubicacion: est.ubicacion }) }, 'Corregir existencias (administrador)')) : null;
  const alCambio = () => { if (vivo) cargar(); };
  document.addEventListener('inv:cambio', alCambio);
  ventana({ titulo: 'Existencias', contenido: [
    h('div.inv-ventana-cab', h('p', 'Lo que hay hoy en cada bodega y local, de las dos empresas. Toque un artículo para ver sus lotes y vencimientos. Valores al costo, sin IVA.'), admin),
    h('div.inv-filtros.cuatro', h('label.etq', 'Bodega o local', ubic), h('label.etq', 'Categoría', categ), h('label.etq.inv-buscar', 'Buscar', campoBusqueda(buscar, () => { est.q = ''; cargar(); }))),
    h('label.inv-casilla', ceros, h('span', 'Mostrar también los artículos en cero que tienen un mínimo')),
    hoyCaja, lista, totales], alCerrar: () => { vivo = false; document.removeEventListener('inv:cambio', alCambio); } });

  async function cargar() {
    const mia = ++seq;
    if (!est.datos) poner(lista, cargando('Cargando existencias…'));
    try {
      const d = await inv.existencias(est.ubicacion || null, est.categoria || null, est.q, est.ceros);
      if (!vivo || mia !== seq) return;
      est.datos = d; pintar();
    } catch (e) {
      if (!vivo || mia !== seq) return;
      poner(lista, falla(e, () => { est.datos = null; cargar(); }, 'No se pudieron cargar las existencias'));
    }
  }
  const vencePronto = (f) => f.dias_para_vencer != null && f.dias_para_vencer >= 0 && f.dias_para_vencer <= dias && Number(f.cantidad) > 0;
  const conVencido = (f) => Number(f.cantidad_vencida) > 0;
  function pintar() {
    const filas = est.datos.filas || [];
    const nP = filas.filter(vencePronto).length, nV = filas.filter(conVencido).length, nB = filas.filter((f) => f.bajo_minimo).length;
    const b = (id, t, n, clase) => h('button.btn.inv-seg' + (n && clase ? '.' + clase : ''), { type: 'button', 'aria-pressed': String(est.solo === id), onclick: () => { est.solo = est.solo === id ? '' : id; pintar(); } }, t, h('span.inv-cuenta', String(n)));
    poner(hoyCaja, h('span.hoy-et', 'Hoy'),
      b('pronto', dias === 0 ? 'Vencen hoy' : 'Vencen en ' + (dias === 1 ? '1 día' : dias + ' días') + ' o menos', nP, 'pronto'),
      b('vencido', 'Tienen algo vencido', nV, 'urgente'), b('minimo', 'Bajo el mínimo', nB, 'pronto'),
      est.solo ? h('button.btn.suave', { type: 'button', onclick: () => { est.solo = ''; pintar(); } }, 'Ver todo') : null);
    const ver = filas.filter((f) => !est.solo || (est.solo === 'pronto' ? vencePronto(f) : est.solo === 'vencido' ? conVencido(f) : f.bajo_minimo));
    if (!ver.length) {
      poner(lista, vacio(est.solo ? 'Nada cumple ese filtro.' : est.q ? 'Ningún artículo coincide con «' + est.q + '».' : 'No hay existencias' + (est.ubicacion ? ' en esta ubicación.' : ' todavía. Lo que se reciba en «Por recibir» aparece aquí.')));
    } else {
      const grupos = new Map();
      ver.forEach((f) => { if (!grupos.has(f.ubicacion_id)) grupos.set(f.ubicacion_id, []); grupos.get(f.ubicacion_id).push(f); });
      poner(lista, ...[...grupos.values()].map((fs) => {
        const sub = fs.reduce((s, f) => s + Number(f.valor || 0), 0);
        return h('section.inv-exis-grupo',
          h('h3.inv-grupo-tit', fs[0].ubicacion, h('small.tenue', (fs[0].ubicacion_tipo === 'local' ? 'Local' : 'Bodega') + ' · ' + plural(fs.length, 'artículo', 'artículos') + ' · ' + money(sub) + ' sin IVA')),
          h('div.inv-exis-lista', fs.map(fila)));
      }));
    }
    const t = est.datos.totales || {};
    poner(totales, h('h3', 'Valor de lo que se ve'),
      h('ul.inv-datos-lista', h('li', h('span', 'Total al costo, sin IVA'), h('strong.cifra', money(t.valor || 0))),
        ...(t.por_empresa || []).map((e) => h('li', chipEmpresaId(cat, e.sociedad_id, e.sociedad_nombre), h('strong.cifra', money(e.valor))))),
      h('p.tenue.inv-chico', est.ubicacion || est.categoria || est.q ? 'Solo de lo que coincide con los filtros de arriba.' : 'De todas las bodegas y locales.'));
  }
  function fila(f) {
    const chips = [];
    if (conVencido(f)) chips.push(h('span.chip.mal', 'Vencido: ' + cantTxt(f.cantidad_vencida, f.unidad)));
    if (f.proximo_vencimiento) chips.push(h('span.chip' + (claseVence(f.dias_para_vencer, dias) ? '.' + claseVence(f.dias_para_vencer, dias) : ''), venceTxt(f.dias_para_vencer, f.proximo_vencimiento)));
    else if (Number(f.cantidad) - Number(f.cantidad_vencida || 0) > 0) chips.push(h('span.chip', 'No vence'));
    if (f.bajo_minimo) chips.push(h('span.chip.espera', 'Bajo el mínimo (' + cantTxt(f.minimo, f.unidad) + ')'));
    return h('button.inv-exis-fila', { type: 'button', onclick: () => abrirLotes(ctx, f), 'aria-label': `Ver los lotes de ${f.articulo} en ${f.ubicacion}` },
      h('span.inv-exis-art', h('strong', f.articulo), h('small', [f.categoria, plural(f.lotes || 0, 'lote', 'lotes'), f.costo_promedio != null ? costoTxt(f.costo_promedio) + ' promedio por ' + (f.unidad || 'unidad') : ''].filter(Boolean).join(' · '))),
      h('span.inv-exis-cant.cifra', cantTxt(f.cantidad, f.unidad)),
      h('span.inv-exis-chips', chips),
      h('span.inv-exis-val.cifra', money(f.valor)),
      h('span.inv-exis-ver', 'Ver lotes'));
  }
  await cargar();
  enfocar(lista.closest('.modal-cuerpo'));
}

/* ---------- Lotes de un artículo en una ubicación ---------- */
export async function abrirLotes(ctx, f) {
  const cat = ctx.cat;
  const dias = Number(cat.config?.dias_aviso ?? 2);
  let vivo = true, agotados = false;
  const lista = h('div.inv-lotes', cargando('Cargando lotes…'));
  const chk = h('input', { type: 'checkbox', onchange: () => { agotados = chk.checked; cargar(); } });
  const mover = () => import('./m_inv_mover.js');
  const acciones = h('div.inv-admin-btns',
    h('button.btn', { type: 'button', onclick: async () => (await mover()).formSalida(ctx, { tipo: 'consumo', ubicacion: f.ubicacion_id, articulo: f.articulo_id }) }, 'Registrar consumo'),
    h('button.btn', { type: 'button', onclick: async () => (await mover()).formSalida(ctx, { tipo: 'merma', ubicacion: f.ubicacion_id, articulo: f.articulo_id }) }, 'Registrar merma'),
    h('button.btn', { type: 'button', onclick: async () => (await mover()).formTraslado(ctx, { origen: f.ubicacion_id, articulo: f.articulo_id }) }, 'Mover a otro lugar'),
    ctx.esAdmin ? h('button.btn', { type: 'button', onclick: async () => (await mover()).formAjuste(ctx, { ubicacion: f.ubicacion_id, articulo: f.articulo_id }) }, 'Corregir la existencia (administrador)') : null);
  const alCambio = () => { if (vivo) cargar(); };
  document.addEventListener('inv:cambio', alCambio);
  ventana({ titulo: f.articulo, volver: 'Existencias', contenido: [
    h('div.inv-ventana-cab', h('p', h('strong', f.ubicacion), ' · ', cantTxt(f.cantidad, f.unidad), ' · ', money(f.valor), ' sin IVA'), h('p.tenue', 'Los lotes van en el orden en que salen: primero el que vence primero. Lo que no vence sale al final.')),
    acciones, h('label.inv-casilla', chk, h('span', 'Mostrar también los lotes agotados, vencidos o anulados')), lista],
  alCerrar: () => { vivo = false; document.removeEventListener('inv:cambio', alCambio); } });

  async function cargar() {
    let d;
    try { d = await inv.lotes(f.articulo_id, f.ubicacion_id, agotados, 200); } catch (e) { if (vivo) poner(lista, falla(e, () => cargar(), 'No se pudieron cargar los lotes')); return; }
    if (!vivo) return;
    const lotes = d.lotes || [];
    if (!lotes.length) { poner(lista, vacio('No hay lotes con existencia de este artículo aquí.')); return; }
    poner(lista, ...lotes.map((l, i) => h('article.inv-lote' + (l.vencido ? '.vencido' : ''),
      h('div.inv-lote-cab',
        h('div', h('span.inv-lote-orden', l.estado === 'activo' && Number(l.cantidad_actual) > 0 ? 'Sale ' + (i === 0 ? 'primero' : 'en el lugar ' + (i + 1)) : ESTADO_LOTE[l.estado] || l.estado),
          h('strong.cifra', cantTxt(l.cantidad_actual, l.unidad)), h('small.tenue', ' de ' + cantTxt(l.cantidad_inicial, l.unidad) + ' que entraron')),
        h('span.chip' + (l.vencido ? '.mal' : claseVence(l.dias_para_vencer, dias) ? '.' + claseVence(l.dias_para_vencer, dias) : ''), l.vence_en ? venceTxt(l.dias_para_vencer, l.vence_en) + ' (' + dma(l.vence_en) + ')' : 'No vence')),
      h('ul.inv-datos-lista.compacta',
        h('li', h('span', 'Entró'), h('strong', dma(l.fecha_entrada) + ' · ' + (ORIGEN[l.origen] || l.origen))),
        h('li', h('span', 'Empresa de origen'), empresaChip(l.sociedad_origen_nombre, (cat.empresas || []).find((e) => e.id === l.sociedad_origen_id)?.codigo)),
        h('li', h('span', 'Costo sin IVA'), h('strong.cifra', costoTxt(l.costo_unitario) + ' por ' + (l.unidad || 'unidad') + ' · ' + money(l.valor) + ' en total')),
        l.factura_clave ? h('li', h('span', 'Factura'), h('button.btn.chico', { type: 'button', onclick: async () => (await import('./m_inv_recibir.js')).abrirFactura(ctx, l.factura_clave) }, 'Ver la factura (línea ' + l.factura_linea + ')' + (l.proveedor_cedula ? ' · proveedor ' + l.proveedor_cedula : ''))) : null,
        l.cabys ? h('li', h('span', 'CABYS'), h('strong', l.cabys + (l.tarifa_iva != null ? ' · IVA ' + num(l.tarifa_iva, 2) + '%' : ''))) : null,
        l.nota ? h('li', h('span', 'Nota'), h('strong', l.nota)) : null,
        h('li', h('span', 'Lo registró'), h('strong', (l.usuario_nombre || l.usuario || 'sin dato') + (l.creado_en ? ', ' + fechaHora(l.creado_en) : '')))),
      l.estado === 'activo' && Number(l.cantidad_actual) > 0 ? h('div.inv-lote-btns',
        h('button.btn', { type: 'button', onclick: async () => (await import('./m_inv_mover.js')).formSalida(ctx, { tipo: l.vencido ? 'merma' : 'consumo', ubicacion: f.ubicacion_id, articulo: f.articulo_id, lote: l.id, cantidad: l.cantidad_actual, motivo: l.vencido ? 'Se venció' : '' }) }, l.vencido ? 'Sacar este lote como merma' : 'Sacar de este lote')) : null)),
      d.truncado ? aviso('espera', h('p', 'Se muestran los 200 primeros lotes.')) : null);
  }
  await cargar();
  enfocar(lista.closest('.modal-cuerpo'));
}
