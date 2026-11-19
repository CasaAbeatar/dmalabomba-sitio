// Existencias: qué hay en cada bodega y local (fx_inv_existencias), con lo de HOY arriba (lo que vence pronto, lo vencido, lo que está bajo el mínimo)
// y el valor al final. Tocar un artículo abre sus lotes (fx_inv_lotes) en el orden en que van saliendo, con su empresa de origen y su factura.
import { h, money, num, fechaHora, debounce, campoBusqueda } from './util.js';
import { inv } from './api_inventarios.js';
import { ventana, cargando, falla, vacio, aviso, cantTxt, costoTxt, venceTxt, claseVence, dma, plural, empresaChip, chipEmpresaId, selectUbicacion, enfocar, poner, proveedorPartes } from './m_inv_comun.js';

// Los lotes traen la cédula tal como vino en la factura; la base la compara solo con dígitos
const soloDigitos = (x) => String(x == null ? '' : x).replace(/\D/g, '');

const ORIGEN = { factura: 'Entró por factura', manual: 'Entrada manual', traslado: 'Llegó por traslado', porcionado: 'Salió de un porcionado', conteo: 'Sobrante de un conteo', ajuste: 'Ajuste directo' };
const ESTADO_LOTE = { activo: '', agotado: 'Agotado', vencido: 'Vencido', anulado: 'Anulado' };

export async function abrir(ctx, _id, pedido = {}) {
  const cat = ctx.cat;
  const dias = Number(cat.config?.dias_aviso ?? 2);
  const est = { ubicacion: pedido.ubicacion || '', categoria: '', q: '', ceros: false, solo: '', datos: null, sociedad: pedido.sociedad || '', vista: pedido.vista === 'proveedor' ? 'proveedor' : 'bodega' };
  let vivo = true, seq = 0;
  const empresas = (cat.empresas || []).filter((e) => e.activo !== false);
  const empresa = h('select.campo', { 'aria-label': 'Empresa de origen', onchange: () => { est.sociedad = empresa.value; est.datos = null; cargar(); } },
    h('option', { value: '' }, 'Las dos empresas'), empresas.map((e) => h('option', { value: e.id }, e.nombre)));
  empresa.value = est.sociedad;
  const vistaBtns = h('div.inv-hoy-filtros', { role: 'group', 'aria-label': 'Cómo ver las existencias' });
  const pintarVista = () => poner(vistaBtns, h('span.hoy-et', 'Ver'),
    ...[['bodega', 'Por bodega o local'], ['proveedor', 'Por proveedor']].map(([id, t]) => h('button.btn.inv-seg', { type: 'button', 'aria-pressed': String(est.vista === id), onclick: () => { if (est.vista === id) return; est.vista = id; est.datos = null; est.solo = ''; pintarVista(); cargar(); } }, t)));
  pintarVista();
  const ubic = selectUbicacion(cat, { todas: true, valor: est.ubicacion, etiqueta: 'Bodega o local', alCambiar: (v) => { est.ubicacion = v; cargar(); } });
  const categ = h('select.campo', { 'aria-label': 'Categoría', onchange: () => { est.categoria = categ.value; cargar(); } },
    h('option', { value: '' }, 'Todas las categorías'), (cat.categorias || []).filter((c) => c.activo !== false).map((c) => h('option', { value: c.id }, c.nombre)));
  const buscar = h('input.campo', { type: 'search', placeholder: 'Nombre del artículo o CABYS', 'aria-label': 'Buscar artículo', autocomplete: 'off' });
  buscar.addEventListener('input', debounce(() => { est.q = buscar.value.trim(); cargar(); }, 300));
  const ceros = h('input', { type: 'checkbox', onchange: () => { est.ceros = ceros.checked; cargar(); } });
  const hoyCaja = h('div.inv-hoy-filtros', { role: 'group', 'aria-label': 'Ver solo', hidden: true });
  const lista = h('div.inv-exis', cargando('Cargando existencias…'));
  const totales = h('div.inv-resumen');
  const porCategoria = h('button.btn.primario', { type: 'button', onclick: async () => (await import('./m_inv_mover_cat.js')).formTrasladoCategoria(ctx, { origen: est.ubicacion || '', categoriaId: est.categoria || '' }) }, 'Mover productos a otra bodega');
  const admin = ctx.esAdmin ? h('div.inv-admin-btns',
    h('button.btn', { type: 'button', onclick: async () => (await import('./m_inv_mover.js')).formEntradaManual(ctx, { ubicacion: est.ubicacion }) }, 'Entrada manual (administrador)'),
    h('button.btn', { type: 'button', onclick: async () => (await import('./m_inv_mover.js')).formAjuste(ctx, { ubicacion: est.ubicacion }) }, 'Corregir existencias (administrador)')) : null;
  const alCambio = () => { if (vivo) cargar(); };
  document.addEventListener('inv:cambio', alCambio);
  ventana({ titulo: 'Existencias', contenido: [
    h('div.inv-ventana-cab', h('p', 'Lo que hay hoy en cada bodega y local, de las dos empresas. Toque un artículo para ver sus lotes y vencimientos. Valores al costo, sin IVA.'), h('div.inv-admin-btns', porCategoria), admin),
    vistaBtns,
    hoyCaja,
    h('div.inv-filtros.cuatro.exis', h('label.etq', 'Bodega o local', ubic), h('label.etq', 'Empresa de origen', empresa), h('label.etq', 'Categoría', categ), h('label.etq.inv-buscar', 'Buscar', campoBusqueda(buscar, () => { est.q = ''; cargar(); }))),
    h('label.inv-casilla', ceros, h('span', 'Mostrar también los artículos en cero que tienen un mínimo')),
    lista, totales], alCerrar: () => { vivo = false; document.removeEventListener('inv:cambio', alCambio); } });

  async function cargar() {
    const mia = ++seq;
    if (!est.datos) poner(lista, cargando('Cargando existencias…'));
    try {
      const d = est.vista === 'proveedor'
        ? await inv.existenciasPorProveedor(est.ubicacion || null, est.categoria || null, est.q, est.sociedad || null)
        : await inv.existencias(est.ubicacion || null, est.categoria || null, est.q, est.ceros, est.sociedad || null);
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
    const porProv = est.vista === 'proveedor';
    const provs = porProv ? (est.datos.proveedores || []) : [];
    const filas = porProv ? provs.flatMap((p) => p.filas || []) : (est.datos.filas || []);
    hoyCaja.hidden = false;
    if (ceros.parentElement) ceros.parentElement.hidden = porProv;
    const nP = filas.filter(vencePronto).length, nV = filas.filter(conVencido).length, nB = filas.filter((f) => f.bajo_minimo).length;
    const b = (id, t, n, clase) => h('button.btn.inv-seg' + (n && clase ? '.' + clase : ''), { type: 'button', 'aria-pressed': String(est.solo === id), onclick: () => { est.solo = est.solo === id ? '' : id; pintar(); } }, t, h('span.inv-cuenta', String(n)));
    poner(hoyCaja, h('span.hoy-et', 'Hoy'),
      b('pronto', dias === 0 ? 'Vencen hoy' : 'Vencen en ' + (dias === 1 ? '1 día' : dias + ' días') + ' o menos', nP, 'pronto'),
      b('vencido', 'Tienen algo vencido', nV, 'urgente'), porProv ? null : b('minimo', 'Bajo el mínimo', nB, 'pronto'),
      est.solo ? h('button.btn.suave', { type: 'button', onclick: () => { est.solo = ''; pintar(); } }, 'Ver todo') : null);
    const pasa = (f) => !est.solo || (est.solo === 'pronto' ? vencePronto(f) : est.solo === 'vencido' ? conVencido(f) : f.bajo_minimo);
    const ver = filas.filter(pasa);
    const filtroTxt = est.sociedad ? ' de ' + (empresas.find((e) => e.id === est.sociedad)?.nombre || 'esa empresa') : '';
    if (!ver.length) {
      poner(lista, vacio(est.solo ? 'Nada cumple ese filtro.' : est.q ? 'Ningún artículo coincide con «' + est.q + '».' : 'No hay existencias' + filtroTxt + (est.ubicacion ? ' en esta ubicación.' : ' todavía. Lo que se reciba en «Por recibir» aparece aquí.')));
    } else if (porProv) {
      poner(lista, ...provs.map((p) => ({ p, fs: (p.filas || []).filter(pasa) })).filter((x) => x.fs.length).map(({ p, fs }) => {
        const sub = fs.reduce((s, f) => s + Number(f.valor || 0), 0);
        const pt = p.cedula ? proveedorPartes(p.nombre) : { nombre: 'Sin proveedor', razon: 'Entradas manuales, ajustes o conteos que no vienen de una factura' };
        return h('section.inv-exis-grupo',
          h('h3.inv-grupo-tit', pt.nombre, h('small.tenue', [pt.razon, p.cedula ? 'Cédula ' + p.cedula : '', plural(fs.length, 'renglón', 'renglones'), money(sub) + ' sin IVA'].filter(Boolean).join(' · '))),
          h('div.inv-exis-lista', fs.map((f) => fila(f, true))));
      }));
    } else {
      const grupos = new Map();
      ver.forEach((f) => { if (!grupos.has(f.ubicacion_id)) grupos.set(f.ubicacion_id, []); grupos.get(f.ubicacion_id).push(f); });
      poner(lista, ...[...grupos.values()].map((fs) => {
        const sub = fs.reduce((s, f) => s + Number(f.valor || 0), 0);
        return h('section.inv-exis-grupo',
          h('h3.inv-grupo-tit', fs[0].ubicacion, h('small.tenue', (fs[0].ubicacion_tipo === 'local' ? 'Local' : 'Bodega') + ' · ' + plural(fs.length, 'artículo', 'artículos') + ' · ' + money(sub) + ' sin IVA')),
          h('div.inv-exis-lista', fs.map((f) => fila(f, false))));
      }));
    }
    const t = est.datos.totales || {};
    const hayFiltro = est.ubicacion || est.categoria || est.q || est.sociedad;
    poner(totales, h('h3', 'Valor de lo que se ve'),
      h('ul.inv-datos-lista', h('li', h('span', 'Total al costo, sin IVA'), h('strong.cifra', money(t.valor || 0))),
        ...(t.por_empresa || []).map((e) => h('li', chipEmpresaId(cat, e.sociedad_id, e.sociedad_nombre),
          e.sociedad_id && est.sociedad !== e.sociedad_id
            ? h('button.btn.chico', { type: 'button', 'aria-label': 'Ver solo lo de ' + (e.sociedad_nombre || 'esta empresa'), onclick: () => { est.sociedad = e.sociedad_id; empresa.value = est.sociedad; est.datos = null; cargar(); } }, 'Ver solo esta')
            : null,
          h('strong.cifra', money(e.valor))))),
      est.sociedad ? h('button.btn.suave', { type: 'button', onclick: () => { est.sociedad = ''; empresa.value = ''; est.datos = null; cargar(); } }, 'Ver las dos empresas') : null,
      h('p.tenue.inv-chico', hayFiltro ? 'Solo de lo que coincide con los filtros de arriba.' : 'De todas las bodegas y locales.'));
  }
  function fila(f, mostrarUbicacion) {
    const chips = [];
    if (conVencido(f)) chips.push(h('span.chip.mal', 'Vencido: ' + cantTxt(f.cantidad_vencida, f.unidad)));
    if (f.proximo_vencimiento) chips.push(h('span.chip' + (claseVence(f.dias_para_vencer, dias) ? '.' + claseVence(f.dias_para_vencer, dias) : ''), venceTxt(f.dias_para_vencer, f.proximo_vencimiento)));
    else if (Number(f.cantidad) - Number(f.cantidad_vencida || 0) > 0) chips.push(h('span.chip', 'No vence'));
    if (f.bajo_minimo) chips.push(h('span.chip.espera', 'Bajo el mínimo (' + cantTxt(f.minimo, f.unidad) + ')'));
    // Con un filtro de empresa o de proveedor, los lotes que se abren son solo los de ese filtro (la cantidad de arriba ya lo es)
    const ver = est.vista === 'proveedor' ? { ...f, filtrar_proveedor: true, sociedad_filtro: est.sociedad || null } : (est.sociedad ? { ...f, sociedad_filtro: est.sociedad } : f);
    return h('button.inv-exis-fila', { type: 'button', onclick: () => abrirLotes(ctx, ver), 'aria-label': `Ver los lotes de ${f.articulo} en ${f.ubicacion}` },
      h('span.inv-exis-art', h('strong', f.articulo), h('small', [mostrarUbicacion ? f.ubicacion : '', f.categoria, plural(f.lotes || 0, 'lote', 'lotes'), f.costo_promedio != null ? costoTxt(f.costo_promedio) + ' promedio por ' + (f.unidad || 'unidad') : ''].filter(Boolean).join(' · '))),
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
    h('div.inv-ventana-cab', h('p', h('strong', f.ubicacion), ' · ', cantTxt(f.cantidad, f.unidad), ' · ', money(f.valor), ' sin IVA'), h('p.tenue', 'Los lotes van en el orden en que salen: primero el que vence primero. Lo que no vence sale al final.'),
      f.filtrar_proveedor || f.sociedad_filtro ? h('p.tenue.inv-chico', 'Se muestran solo los lotes ' + [f.filtrar_proveedor ? 'de ese proveedor' : '', f.sociedad_filtro ? 'de la empresa de origen escogida' : ''].filter(Boolean).join(' y ') + '.') : null),
    acciones, h('label.inv-casilla', chk, h('span', 'Mostrar también los lotes agotados, vencidos o anulados')), lista],
  alCerrar: () => { vivo = false; document.removeEventListener('inv:cambio', alCambio); } });

  async function cargar() {
    let d;
    try { d = await inv.lotes(f.articulo_id, f.ubicacion_id, agotados, 200); } catch (e) { if (vivo) poner(lista, falla(e, () => cargar(), 'No se pudieron cargar los lotes')); return; }
    if (!vivo) return;
    const todos = d.lotes || [];
    // El orden de salida ("sale primero") se cuenta con todos los lotes; el filtro solo decide cuáles se muestran
    const pasa = (l) => (!f.sociedad_filtro || l.sociedad_origen_id === f.sociedad_filtro) && (!f.filtrar_proveedor || soloDigitos(l.proveedor_cedula) === soloDigitos(f.proveedor_cedula));
    const lotes = todos.map((l, i) => ({ l, i })).filter((x) => pasa(x.l));
    if (!lotes.length) { poner(lista, vacio('No hay lotes con existencia de este artículo aquí.')); return; }
    poner(lista, ...lotes.map(({ l, i }) => h('article.inv-lote' + (l.vencido ? '.vencido' : ''),
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
