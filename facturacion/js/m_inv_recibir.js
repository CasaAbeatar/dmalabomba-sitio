// Por recibir: facturas de proveedores de las DOS empresas con líneas que todavía no entran al inventario (fx_inv_pendientes), y la ventana de cada factura
// (fx_inv_factura) donde se reciben una o varias líneas a la vez (fx_inv_recibir) o se marcan «No es de inventario» (fx_inv_ignorar) con su «Deshacer».
// La sugerencia (memoria del proveedor, CABYS) NUNCA recibe sola: la persona marca cada línea «Recibir esta línea» y confirma con el botón de abajo.
// Una factura que Contable o Hacienda rechazaron no se puede recibir (puede_recibir = false): solo se puede marcar «No es de inventario».
import { h, money, num, fechaHora, horaCorta, debounce, campoBusqueda, sumaDias } from './util.js';
import { inv, cant, dinero } from './api_inventarios.js';
import {
  ventana, dialogo, cargando, falla, vacio, aviso, cantTxt, costoTxt, unidadTxt, dma, diaTxt, plural, empresaChip, numFactura, proveedorTxt, tipoDocTxt,
  accionSegura, botonSeguro, rotular, repetidaTxt, campoCantidad, leerCantidad, leerMonto, selectUbicacion, nombreUbicacion, elegirArticulo, opcionDeArticulo,
  enfocar, toastOk, norm, poner, ymdCR, proveedorPartes, GRUPOS, grupoDe, esSimple } from './m_inv_comun.js';

// Estado contable (contrato 3.2) a color: verde aceptada, ámbar con aviso, rojo no entra
const CLASE_ESTADO = { aceptada: 'ok', parcial: 'espera', plazo_vencido: 'espera', rechazada: 'mal', rechazo_en_tramite: 'mal', rechazada_por_hacienda: 'mal' };
export const chipContable = (ec) => (ec ? h('span.chip.inv-contable' + (CLASE_ESTADO[ec.estado] ? '.' + CLASE_ESTADO[ec.estado] : ''), 'Contable: ' + (ec.texto || 'Sin dato')) : null);
const FUENTES = {
  memoria: 'Lo mismo que se usó la vez pasada con este proveedor',
  memoria_cabys: 'Con este proveedor y este CABYS se usó este artículo (revise la conversión)',
  articulo_cabys: 'Es el único artículo con este mismo CABYS',
  cabys: 'Por su CABYS',
  servicio: 'La factura lo cobra como un servicio',
};
// Unidad de la factura (Hacienda) a la del inventario, para proponerla al crear un artículo nuevo
const UNIDAD_DE_FACTURA = { kg: 'kg', g: 'g', l: 'litro', lt: 'litro', ml: 'ml', unid: 'unidad', und: 'unidad', un: 'unidad', caja: 'caja', paq: 'paquete', bolsa: 'bolsa', lata: 'lata', botella: 'botella' };
const unidadSugerida = (u) => UNIDAD_DE_FACTURA[norm(u).replace(/\./g, '')] || 'unidad';

export async function abrir(ctx, id, pedido = {}) {
  if (id === 'factura' && pedido.clave) return abrirFactura(ctx, pedido.clave);
  return abrirLista(ctx, pedido);
}

/* =====================================================================================================================
   Lista de facturas por recibir
   ===================================================================================================================== */
// Al entrar a una empresa, «Por recibir» abre con las facturas de ESA empresa; «Las dos empresas» queda a un toque. La última elección se recuerda por empresa mientras la página siga abierta.
const FILTRO_RECUERDO = new Map();
async function abrirLista(ctx) {
  const cat = ctx.cat;
  const propia = (cat.empresas || []).some((e) => e.id === ctx.app.socId) ? ctx.app.socId : null;
  const est = { sociedad: FILTRO_RECUERDO.has(propia) ? FILTRO_RECUERDO.get(propia) : propia, q: '', datos: null, otra: null, otraVieja: true };
  let vivo = true, seq = 0;
  const buscar = h('input.campo', { type: 'search', placeholder: 'Proveedor, cédula, número o artículo', 'aria-label': 'Buscar factura por recibir', autocomplete: 'off' });
  const filtroEmp = h('div.inv-segmento', { role: 'group', 'aria-label': 'De qué empresa' });
  const deshechos = h('div.inv-deshechos', { 'aria-live': 'polite' });
  const lista = h('div.inv-fac-lista', cargando('Buscando facturas por recibir…'));
  const resumen = h('div.inv-resumen');
  const cab = h('div.inv-ventana-cab');
  const otraNota = h('div.inv-otra-nota');
  const contenido = [
    cab,
    h('div.inv-filtros', filtroEmp, h('label.etq.inv-buscar', 'Buscar', campoBusqueda(buscar, () => { est.q = ''; cargar(); }))),
    otraNota, deshechos, lista, resumen];
  const alCambio = () => { if (vivo) { est.otraVieja = true; cargar(); } };
  ventana({ titulo: 'Por recibir', contenido, alCerrar: () => { vivo = false; document.removeEventListener('inv:cambio', alCambio); } });
  document.addEventListener('inv:cambio', alCambio);
  buscar.addEventListener('input', debounce(() => { est.q = buscar.value.trim(); cargar(); }, 350));

  function elegir(id) {
    if (est.sociedad === id) return;
    est.sociedad = id; FILTRO_RECUERDO.set(propia, id);
    est.datos = null; pintarFiltro(); cargar();
  }
  function pintarFiltro() {
    const b = (id, t) => h('button.btn.inv-seg', { type: 'button', 'aria-pressed': String(est.sociedad === id), onclick: () => elegir(id) }, t);
    const empresas = cat.empresas || [];
    const mi = empresas.find((e) => e.id === propia);
    // La empresa de la sesión va primero; «Las dos empresas» después
    const otras = empresas.filter((e) => e.id !== propia);
    poner(filtroEmp, ...(mi ? [b(mi.id, mi.nombre), b(null, 'Las dos empresas'), ...otras.map((e) => b(e.id, e.nombre))] : [b(null, 'Las dos empresas'), ...empresas.map((e) => b(e.id, e.nombre))]));
    const e = empresas.find((x) => x.id === est.sociedad);
    poner(cab, h('p', 'Facturas de proveedores a nombre de ',
      ...(e ? [h('strong', e.nombre)] : empresas.flatMap((x, i) => [i ? ' y de ' : '', h('strong', x.nombre)])),
      ' que traen líneas por entrar a la bodega. Lo que llegó hoy va primero.'));
  }
  // Con una sola empresa a la vista, avisa cuántas hay de la otra para que el número del inicio de Inventarios (las dos) cuadre
  function pintarOtra() {
    const falta = est.sociedad ? ((est.otra && est.otra.resumen && est.otra.resumen.por_empresa) || []).filter((e) => e.sociedad_id !== est.sociedad && Number(e.facturas) > 0) : [];
    poner(otraNota, falta.length ? h('p.tenue.inv-chico', falta.map((e) => 'Hay ' + plural(e.facturas, 'factura por recibir', 'facturas por recibir') + ' a nombre de ' + e.sociedad_nombre + '. Para verlas toque «Las dos empresas».').join(' ')) : null);
  }
  async function cargar() {
    const mia = ++seq;
    if (!est.datos) poner(lista, cargando('Buscando facturas por recibir…'));
    try {
      const pedirOtra = est.sociedad && est.otraVieja;
      const [d, otra] = await Promise.all([inv.pendientes(est.sociedad, est.q, 100), pedirOtra ? inv.pendientes(null, '', 1).catch(() => null) : Promise.resolve(undefined)]);
      if (!vivo || mia !== seq) return;
      if (pedirOtra) { est.otra = otra; est.otraVieja = !otra; }
      est.datos = d; pintar(); pintarOtra();
    } catch (e) {
      if (!vivo || mia !== seq) return;
      poner(lista, falla(e, () => { est.datos = null; cargar(); }, 'No se pudieron traer las facturas por recibir'));
      poner(resumen, );
    }
  }
  function pintar() {
    const d = est.datos, facs = d.facturas || [], hoy = d.hoy || ctx.hoy;
    const deHoy = facs.filter((f) => ymdCR(f.llego || f.fecha) === hoy);
    const antes = facs.filter((f) => !deHoy.includes(f));
    if (!facs.length) {
      poner(lista, vacio(est.q ? 'Ninguna factura por recibir coincide con «' + est.q + '».' : 'No hay facturas por recibir. Todo lo que llegó ya se recibió o se marcó «No es de inventario».'));
    } else {
      // Si hay más de las que se muestran, el aviso va ARRIBA y el contador dice «100 de 119» (antes quedaba al final de la lista, tras 100 tarjetas)
      const totalFacs = Number((d.resumen || {}).facturas) || 0;
      const cuenta = (n) => String(n) + (d.truncado && totalFacs > facs.length ? ' de ' + totalFacs : '');
      poner(lista,
        d.truncado ? aviso('espera', h('p', 'Se muestran las ' + facs.length + ' más recientes' + (totalFacs > facs.length ? ' de ' + totalFacs : '') + (est.sociedad ? '. Use el buscador para ver las demás.' : '. Use el buscador o escoja una empresa para ver las demás.'))) : null,
        deHoy.length ? h('h3.inv-grupo-tit', 'Llegaron hoy', h('span.inv-cuenta', String(deHoy.length))) : null, ...deHoy.map(tarjeta),
        antes.length ? h('h3.inv-grupo-tit', deHoy.length ? 'De días anteriores' : 'Facturas por recibir', h('span.inv-cuenta', deHoy.length ? String(antes.length) : cuenta(antes.length))) : null, ...antes.map(tarjeta));
    }
    const r = d.resumen || {};
    poner(resumen, h('h3', 'Resumen de lo pendiente'),
      h('ul.inv-datos-lista',
        h('li', h('span', 'Facturas con líneas por recibir'), h('strong.cifra', num(r.facturas || 0, 0))),
        h('li', h('span', 'Líneas que se pueden recibir'), h('strong.cifra', num(r.lineas_por_recibir || 0, 0))),
        r.facturas_rechazadas ? h('li', h('span', 'Facturas rechazadas (no entran)'), h('strong.cifra', num(r.facturas_rechazadas, 0))) : null,
        ...(r.por_empresa || []).map((e) => h('li', empresaChip(e.sociedad_nombre, codigoEmp(cat, e.sociedad_id)), h('strong.cifra', plural(e.facturas, 'factura', 'facturas') + ' · ' + plural(e.lineas, 'línea', 'líneas'))))),
      h('p.tenue.inv-chico', 'Se toman en cuenta las facturas emitidas desde el ' + dma(d.desde) + '.'));
  }
  function tarjeta(f) {
    const ec = f.estado_contable || {};
    const puede = f.puede_recibir !== false;
    const ignorarToda = h('button.btn', { type: 'button', onclick: () => pedirIgnorar(ctx, f, null, (r) => { quitarDeLista(f, r); }) }, 'Toda la factura no es de inventario');
    const decididas = (f.lineas_recibidas || 0) + (f.lineas_ignoradas || 0);
    return h('article.inv-fac' + (puede ? '' : '.rechazada'), { 'data-clave': f.clave },
      h('div.inv-fac-cab',
        h('div.inv-fac-prov', h('strong', proveedorTxt(f.proveedor_nombre)), razonTxt(f.proveedor_nombre),
          h('small', tipoDocTxt(f.tipo) + ' N.° ' + numFactura(f.consecutivo) + ' · emitida ' + diaTxt(f.fecha) + (f.llego ? ' · llegó ' + (ymdCR(f.llego) === ctx.hoy ? 'hoy a las ' + horaCorta(f.llego) : fechaHora(f.llego)) : ''))),
        h('div.inv-fac-emp', h('small', 'A nombre de'), empresaChip(f.sociedad_nombre, f.sociedad_codigo))),
      h('div.inv-fac-estado', chipContable(ec), h('span.inv-fac-total.cifra', 'Total con IVA ' + money(f.total) + (f.moneda && f.moneda !== 'CRC' ? ' (en ' + f.moneda + ' convertido)' : ''))),
      !puede ? aviso('mal', h('p', h('strong', (ec.texto || 'Rechazada, no entra') + '. '), 'Esta factura no se puede recibir al inventario. Si la mercadería no se quedó, márquela «No es de inventario» para que salga de esta lista.'))
        : (f.aviso || ec.aviso) ? aviso('espera', h('p', f.aviso || ec.aviso)) : null,
      h('p.inv-fac-cuenta', h('strong', plural(f.lineas_pendientes, 'línea por recibir', 'líneas por recibir')), ' de ' + num(f.lineas_total, 0) + (decididas ? ' (' + [f.lineas_recibidas ? plural(f.lineas_recibidas, 'recibida', 'recibidas') : '', f.lineas_ignoradas ? plural(f.lineas_ignoradas, 'no es de inventario', 'no son de inventario') : ''].filter(Boolean).join(', ') + ')' : '')),
      h('ul.inv-fac-lineas', (f.lineas || []).slice(0, 4).map((l) => h('li', h('span', l.descripcion), h('span.tenue.cifra', num(l.cantidad, 3) + ' ' + (l.unidad || ''))))),
      (f.lineas || []).length > 4 ? h('p.tenue.inv-chico', 'y ' + plural(f.lineas.length - 4, 'línea más', 'líneas más')) : null,
      h('div.inv-fac-btns',
        h('button.btn' + (puede ? '.primario' : ''), { type: 'button', onclick: () => abrirFactura(ctx, f.clave, { previa: f }) }, puede ? 'Recibir líneas' : 'Ver la factura'),
        ignorarToda));
  }
  // La factura entera quedó «No es de inventario»: sale de la lista y deja un aviso con «Deshacer»
  function quitarDeLista(f, r) {
    const banda = h('div.inv-deshecho', h('p', h('strong', proveedorTxt(f.proveedor_nombre) + ', factura N.° ' + numFactura(f.consecutivo) + ': '), plural((r.ignoradas || []).length, 'línea quedó', 'líneas quedaron') + ' como «No es de inventario».'));
    const zona = h('div');
    const { boton } = botonSeguro('Deshacer', '', { zona, ocupado: 'Deshaciendo…',
      hacer: (idem) => inv.deshacerIgnorar(f.clave, null, idem),
      alTerminar: (x) => { poner(banda, h('p', 'Listo: ' + plural((x.reabiertas || []).length, 'línea volvió', 'líneas volvieron') + ' a «Por recibir».')); setTimeout(() => banda.remove(), 6000); } });
    banda.append(boton, zona);
    deshechos.prepend(banda);
    boton.focus({ preventScroll: true });
  }
  pintarFiltro();
  await cargar();
  enfocar(lista.closest('.modal-cuerpo') || lista);
}
// La razón social, en pequeño, cuando el proveedor trae nombre comercial
const razonTxt = (n) => { const r = proveedorPartes(n).razon; return r ? h('small.inv-razon', r) : null; };
const codigoEmp = (cat, id) => (cat.empresas || []).find((e) => e.id === id)?.codigo || null;

/* ---------- «No es de inventario» (una línea, varias o toda la factura) ---------- */
// lineas = null: todas las pendientes de la factura. alTerminar(r) recibe la respuesta de fx_inv_ignorar.
export function pedirIgnorar(ctx, f, lineas, alTerminar) {
  const motivo = h('input.campo', { type: 'text', maxlength: 200, 'aria-label': 'Motivo (opcional)', placeholder: 'Por ejemplo: es un repuesto de ferretería' });
  const rapidos = ['Ferretería o mantenimiento', 'Seguro o servicio', 'Alquiler o renting', 'Ya entró a mano'].map((t) => h('button.btn.chico.inv-rapido', { type: 'button', onclick: () => { motivo.value = t; motivo.focus(); } }, t));
  const recordar = h('input', { type: 'checkbox', checked: true });
  const zona = h('div');
  const ok = h('button.btn.primario', { type: 'button' }, lineas ? 'Sí, no es de inventario' : 'Sí, toda la factura');
  const acc = accionSegura({ boton: ok, zona, ocupado: 'Guardando…',
    hacer: (idem) => {
      const m = motivo.value.trim().replace(/\s+/g, ' ');
      if (m && m.length < 3) throw new Error('El motivo tiene que tener al menos 3 letras, o déjelo vacío.');
      return inv.ignorar(f.clave, lineas, m || null, recordar.checked, idem);
    },
    alTerminar: (r, { repetida }) => {
      d.cerrar();
      const n = (r.ignoradas || []).length, om = r.omitidas || [];
      toastOk((n ? plural(n, 'línea quedó', 'líneas quedaron') + ' como «No es de inventario».' : 'No había líneas pendientes que marcar.') + (om.length ? ' ' + plural(om.length, 'línea no se tocó', 'líneas no se tocaron') + ' (' + [...new Set(om.map((o) => o.razon))].join(', ') + ').' : '') + repetidaTxt(repetida));
      alTerminar?.(r);
    } });
  ok.addEventListener('click', () => acc.ejecutar());
  const que = lineas ? (lineas.length === 1 ? 'la línea ' + lineas[0] : plural(lineas.length, 'línea', 'líneas')) : 'todas las líneas pendientes';
  const d = dialogo({ titulo: 'No es de inventario', ancho: 560, contenido: [
    h('p', `¿Marcar ${que} de la factura N.° ${numFactura(f.consecutivo)} de ${proveedorTxt(f.proveedor_nombre)} como «No es de inventario»? No entra a la bodega. Se puede deshacer después.`),
    h('label.etq', 'Motivo (opcional)', motivo), h('div.inv-rapidos', rapidos),
    h('label.inv-casilla', recordar, h('span', 'Recordarlo: la próxima factura de este proveedor con lo mismo saldrá sugerida como «No es de inventario»')),
    lineas ? null : h('p.tenue.inv-chico', 'Las líneas que ya se recibieron no cambian.'),
    zona], botones: [{ texto: 'No, volver', onclick: (c) => c() }] });
  d.el.querySelector('.modal-pie').append(ok);
}

/* =====================================================================================================================
   Ventana de una factura: recibir sus líneas
   ===================================================================================================================== */
export async function abrirFactura(ctx, clave, { previa = null } = {}) {
  const cat = ctx.cat;
  let vivo = true;
  const cuerpo = h('div.inv-factura', cargando('Cargando la factura…'));
  const resultado = h('div.inv-resultado', { 'aria-live': 'polite' });
  ventana({ titulo: 'Factura de proveedor', volver: 'Por recibir', contenido: [resultado, cuerpo], alCerrar: () => { vivo = false; } });
  const recordados = new Map(); // línea -> sugerencia que trajo la lista (por si la consulta de la factura no la repite)
  (previa?.lineas || []).forEach((l) => recordados.set(l.linea, l.sugerencia));
  let articulos = [];
  const recordar = h('input', { type: 'checkbox', checked: true });
  // Lo que la persona ya llenó en cada línea pendiente: se conserva cuando la ventana se vuelve a pintar (después de marcar otra línea «No es de inventario», por ejemplo)
  const memoria = new Map();

  async function cargar(primera = false) {
    let d;
    try { [d, articulos] = await Promise.all([inv.factura(clave), ctx.articulos.lista()]); }
    catch (e) { if (vivo) poner(cuerpo, falla(e, () => { poner(cuerpo, cargando()); cargar(primera); }, 'No se pudo abrir la factura')); return; }
    if (!vivo) return;
    pintar(d);
    if (primera) enfocar(cuerpo);
  }

  function pintar(d) {
    const f = d.factura || {}, ec = f.estado_contable || {};
    const puede = f.puede_recibir !== false;
    const lineas = d.lineas || [];
    const pend = lineas.filter((l) => l.estado === 'pendiente');
    const otras = lineas.filter((l) => l.estado !== 'pendiente');
    const formas = pend.map((l) => formaLinea(f, l, puede));
    const marcadas = () => formas.filter((x) => x.marcada());
    const zonaRecibir = h('div');
    const btnRecibir = h('button.btn.primario.grande', { type: 'button' }, 'Recibir las líneas marcadas');
    const contar = () => { const n = marcadas().length; rotular(btnRecibir, n ? 'Recibir ' + plural(n, 'línea marcada', 'líneas marcadas') : 'Marque las líneas que va a recibir'); btnRecibir.disabled = !n && !btnRecibir.dataset.ocupado; };
    formas.forEach((x) => x.alCambiar(contar));
    const accRecibir = accionSegura({ boton: btnRecibir, zona: zonaRecibir, ocupado: 'Recibiendo…',
      hacer: (idem) => {
        const sel = marcadas();
        if (!sel.length) throw new Error('Marque al menos una línea con «Recibir esta línea».');
        const problemas = sel.map((x) => x.problema()).filter(Boolean);
        if (problemas.length) { sel.find((x) => x.problema())?.enfocarProblema(); throw new Error(problemas[0]); }
        return inv.recibir(sel.map((x) => ({ ...x.datos(), recordar: recordar.checked })), idem);
      },
      alTerminar: async (r, { repetida }) => {
        const rec = r.recibidas || [];
        poner(resultado, aviso('ok',
          h('p', h('strong', rec.length === 1 ? 'Se recibió 1 línea.' : 'Se recibieron ' + rec.length + ' líneas.'), repetidaTxt(repetida)),
          h('ul.inv-res-lista', rec.map((x) => h('li', `Línea ${x.linea}: ${x.articulo}, ${cantTxt(x.cantidad, x.unidad)} a ${x.ubicacion}` + (x.vence_en ? ', vence el ' + dma(x.vence_en) : ', no vence') + `, ${costoTxt(x.costo_unitario)} por ${unidadTxt(x.unidad, 1)} (${money(x.valor)} sin IVA). Empresa de origen: ${x.sociedad_origen_nombre || 'sin dato'}.`))),
          ...(r.avisos || []).map((t) => h('p.inv-res-aviso', t))));
        resultado.scrollIntoView({ block: 'nearest' });
        ctx.articulos.olvidar();
        await cargar();
      } });
    btnRecibir.addEventListener('click', () => accRecibir.ejecutar());
    const marcarTodas = h('button.btn', { type: 'button', onclick: () => { formas.forEach((x) => x.marcarSiTiene()); contar(); } }, 'Marcar todas las que ya tienen artículo');
    const ignorarToda = h('button.btn', { type: 'button', onclick: () => pedirIgnorar(ctx, f, null, () => cargar()) }, 'Toda la factura no es de inventario');
    const contableAqui = f.sociedad_id && f.sociedad_id === ctx.app.socId;

    poner(cuerpo, 
      h('div.inv-fac-detalle-cab',
        h('div', h('h2', proveedorTxt(f.proveedor_nombre)), razonTxt(f.proveedor_nombre),
          h('p.tenue', tipoDocTxt(f.tipo) + ' N.° ' + numFactura(f.consecutivo) + ' · emitida ' + diaTxt(f.fecha) + ' · cédula del proveedor ' + (f.proveedor_cedula || 'sin dato'))),
        h('div.inv-fac-emp', h('small', 'A nombre de'), empresaChip(f.sociedad_nombre, f.sociedad_codigo))),
      h('div.inv-fac-estado', chipContable(ec), h('span.inv-fac-total.cifra', 'Total con IVA ' + money(f.total)), f.moneda && f.moneda !== 'CRC' ? h('span.tenue', 'Factura en ' + f.moneda + ', tipo de cambio ' + num(f.tipo_cambio, 2)) : null),
      !puede ? aviso('mal', h('p', h('strong', (ec.texto || 'Rechazada, no entra') + '. '), 'No se puede recibir al inventario. ' + (ec.estado === 'rechazada_por_hacienda' ? 'Espere la factura que la reemplace.' : 'Si la mercadería no se quedó, márquela «No es de inventario».')),
          // Lo mismo que le dice Contable antes de rechazar (m_recepcion.js): rechazar no mueve la bodega
          lineas.some((l) => l.estado === 'recibida') ? h('p', 'Lo que ya se recibió sigue en la bodega: rechazar la factura en Contable no lo saca. Para corregirlo, use «Deshacer la recepción» en cada línea (solo una persona administradora, y solo si ese lote todavía no se ha tocado) o registre una salida como «Devolución a proveedor», en «Salidas y mermas».') : null)
        : (f.aviso || ec.aviso) ? aviso('espera', h('p', f.aviso || ec.aviso)) : null,
      h('div.inv-enlaces', contableAqui
        ? h('button.btn', { type: 'button', onclick: () => ctx.app.ir('recepcion', { clave: f.clave, buscar: numFactura(f.consecutivo) }) }, 'Ir a Contable (factura N.° ' + numFactura(f.consecutivo) + ')')
        : h('p.tenue.inv-chico', 'Esta factura es de ' + (f.sociedad_nombre || 'la otra empresa') + ': en Contable se responde desde una sesión de esa empresa.')),
      pend.length ? h('section.inv-grupo', h('h3', 'Líneas por recibir', h('span.inv-cuenta', String(pend.length))),
        puede ? h('p.tenue.inv-chico', 'Revise cada línea, escoja el artículo y marque «Recibir esta línea». La sugerencia no se guarda sola. Los costos son sin IVA.') : null,
        h('div.inv-lineas-acciones', puede ? marcarTodas : null, ignorarToda),
        h('div.inv-lineas', formas.map((x) => x.el)),
        puede ? h('div.inv-barra-recibir',
          h('label.inv-casilla', recordar, h('span', 'Recordar estas decisiones para las próximas facturas de este proveedor')),
          btnRecibir, zonaRecibir) : null)
        : aviso('ok', h('p', 'Esta factura ya no tiene líneas por recibir.')),
      otras.length ? h('section.inv-grupo', h('h3', 'Líneas ya decididas', h('span.inv-cuenta', String(otras.length))), h('div.inv-lineas', otras.map((l) => lineaDecidida(f, l)))) : null,
      (d.notas_proveedor || []).length ? h('section.inv-grupo', h('h3', 'Notas del proveedor sobre esta factura'),
        h('ul.inv-datos-lista', d.notas_proveedor.map((n) => h('li', h('span', tipoDocTxt(n.tipo) + ' N.° ' + numFactura(n.consecutivo) + ' del ' + dma(n.fecha)), h('strong', ({ por_revisar: 'Por revisar', devuelta: 'Mercadería devuelta', ignorada: 'No afecta el inventario' })[n.estado] || n.estado || '')))),
        h('button.btn', { type: 'button', onclick: () => ctx.abrir('notas') }, 'Abrir Notas de proveedor')) : null);
    contar();
  }

  /* ---------- Una línea pendiente: lo que se va a recibir ---------- */
  // Descripción de la línea tal como viene en la factura
  const descLinea = (l) => h('div.inv-linea-desc', h('strong', 'Línea ' + l.linea + ': ' + l.descripcion),
    h('small', 'En la factura: ' + num(l.cantidad, 3) + ' ' + (l.unidad || '') + ' a ' + costoTxt(l.costo_unitario_factura) + ' cada una, sin IVA · subtotal ' + money(l.subtotal_crc) + ' sin IVA' + (l.tarifa_iva != null ? ' · IVA ' + num(l.tarifa_iva, 2) + '%' : '')),
    l.cabys ? h('small', 'CABYS ' + l.cabys + (l.cabys_descripcion ? ': ' + l.cabys_descripcion : '')) : null,
    l.reabierta ? h('small.inv-marca', 'Volvió a pendiente después de una corrección') : null);
  function formaLinea(f, l, puede) {
    // Factura rechazada: la línea solo se lee; lo único que se puede hacer es marcarla «No es de inventario»
    if (!puede) {
      const el = h('article.inv-linea.bloqueada', { 'data-linea': l.linea }, h('div.inv-linea-cab', descLinea(l)),
        h('div.inv-linea-pie', h('button.btn', { type: 'button', onclick: () => pedirIgnorar(ctx, f, [l.linea], () => cargar()) }, 'No es de inventario')));
      return { el, marcada: () => false, marcarSiTiene() {}, alCambiar() {}, problema: () => '', enfocarProblema() {}, datos: () => null };
    }
    const sug = l.sugerencia || recordados.get(l.linea) || {};
    const avisarCambio = [];
    const cambio = () => avisarCambio.forEach((fn) => fn());
    let art = sug.articulo_id ? articulos.find((a) => a.id === sug.articulo_id) || (sug.articulo ? { id: sug.articulo_id, nombre: sug.articulo, unidad: sug.unidad, categoria_id: sug.categoria_id } : null) : null;
    let cantidadTocada = false;
    const chk = h('input', { type: 'checkbox', 'aria-label': 'Recibir la línea ' + l.linea });
    const nombreArt = h('strong.inv-art-nombre');
    const btnArt = h('button.btn', { type: 'button', onclick: () => escogerArticulo() }, 'Escoger artículo');
    const factor = h('input.campo.inv-num', { type: 'text', inputmode: 'decimal', autocomplete: 'off', 'aria-label': 'Cuántas unidades del artículo trae cada unidad de la factura' });
    const factorEco = h('small.inv-eco');
    const cantidad = campoCantidad({ etiqueta: 'Cantidad que entra', unidad: art?.unidad || '', alCambiar: () => { cantidadTocada = true; pintarCosto(); cambio(); } });
    const ubic = selectUbicacion(cat, { etiqueta: 'Dónde se guarda', alCambiar: cambio });
    let venceEditada = false; // solo si una persona escribe la fecha se manda; si no, la base aplica la misma regla desde la fecha de la factura
    const vence = h('input.campo', { type: 'date', 'aria-label': 'Fecha de vencimiento', oninput: () => { venceEditada = true; pintarVence(); } });
    const venceEco = h('small.inv-eco');
    const noVence = h('input', { type: 'checkbox', onchange: () => { vence.disabled = noVence.checked; pintarVence(); } });
    const pintarVence = () => { venceEco.className = 'inv-eco'; if (noVence.checked) venceEco.textContent = 'No vence.'; else if (!vence.value) { venceEco.textContent = 'Escriba la fecha o marque «No vence».'; venceEco.className = 'inv-eco mal'; } else if (vence.value < ctx.hoy && venceEditada) { venceEco.textContent = 'La fecha no puede ser anterior a hoy.'; venceEco.className = 'inv-eco mal'; } else if (vence.value < ctx.hoy) { const cc = art && (cat.categorias || []).find((x) => x.id === art.categoria_id); venceEco.textContent = (!cc || cc.salida_automatica !== false) ? 'Por la fecha de la factura ya cumplió sus días: al recibirla entra y sale como consumo automático.' : 'Por la fecha de la factura ya venció.'; } else venceEco.textContent = 'Vence el ' + diaTxt(vence.value) + '.'; };
    const costoTxtEl = h('span.inv-costo');
    const costoInput = h('input.campo.inv-num', { type: 'text', inputmode: 'decimal', autocomplete: 'off', 'aria-label': 'Costo sin IVA por unidad del artículo' });
    const costoDet = h('details.inv-corregir', h('summary', 'Corregir el costo'), h('label.etq', 'Costo sin IVA por unidad del artículo (₡)', costoInput, h('small', 'Solo si el costo de la factura no es el correcto. Déjelo vacío para usar el de la factura.')));
    const zona = h('div');
    const ignorarBtn = h('button.btn' + (sug.no_inventario ? '.ambar' : ''), { type: 'button', onclick: () => pedirIgnorar(ctx, f, [l.linea], () => cargar()) }, 'No es de inventario');
    const campos = h('div.inv-linea-campos',
      h('div.inv-campo-art', h('span.etq', 'Artículo del inventario'), h('div.inv-art-fila', nombreArt, btnArt)),
      h('label.etq.inv-c-conv', h('span', 'Conversión'), h('span.inv-con-unidad', h('span.inv-pre', 'Cada «' + (l.unidad || 'unidad') + '» de la factura trae'), factor, h('span.inv-unidad.inv-u-art')), factorEco),
      cantidad.el,
      h('label.etq.inv-c-ubic', 'Dónde se guarda', ubic),
      h('div.etq.inv-c-vence', h('span', 'Vence'), vence, venceEco, h('label.inv-casilla.chica', noVence, h('span', 'No vence'))),
      h('div.inv-costo-fila', h('span.inv-costo-et', 'Costo sin IVA:'), costoTxtEl, costoDet));
    const sugTxt = sugerenciaTxt(sug);
    const simple = esSimple(cat);
    const resumen = h('p.tenue.inv-chico.inv-resumen-simple');
    const el = h('article.inv-linea' + (simple ? '.inv-simple' : ''), { 'data-linea': l.linea },
      h('div.inv-linea-cab',
        h('label.inv-recibir-chk', chk, h('span', 'Recibir esta línea')),
        descLinea(l)),
      sugTxt ? h('p.inv-sug' + (sug.no_inventario ? '.no-inv' : ''), h('span.inv-sug-et', 'Sugerencia: '), sugTxt) : null,
      simple ? resumen : null,
      campos,
      h('div.inv-linea-pie', ignorarBtn, zona));

    function pintarArticulo(cambiar) {
      nombreArt.textContent = art ? art.nombre + ' (se cuenta en ' + unidadTxt(art.unidad, 2) + ')' : 'Sin escoger';
      nombreArt.classList.toggle('falta', !art);
      btnArt.textContent = art ? 'Cambiar artículo' : 'Escoger artículo';
      el.querySelector('.inv-u-art').textContent = art ? unidadTxt(art.unidad, 2) + ' del artículo' : 'del artículo';
      cantidad.unidad(art?.unidad || '');
      el.dataset.grupo = grupoDe(cat, art) || '';
      if (!cambiar) { pintarResumen(); return; }
      // Valores por omisión de ese artículo: los de la sugerencia si es el mismo; si no, la regla del contrato (3.3)
      const mismo = art && sug.articulo_id === art.id;
      const fac = mismo && sug.factor != null ? Number(sug.factor) : sug.factor_sugerido != null ? Number(sug.factor_sugerido) : 1;
      factor.value = String(fac).replace('.', ',');
      if (!cantidadTocada) cantidad.poner(Math.round(Number(l.cantidad) * fac * 1000) / 1000);
      ubic.value = (mismo && sug.ubicacion_id) || ubicacionPorOmision(art) || '';
      const ven = mismo ? sug.vence_en : venceDe(art);
      venceEditada = false; noVence.checked = !ven; vence.disabled = !ven; vence.value = ven || '';
      pintarFactor(); pintarCosto(); pintarVence(); pintarResumen();
    }
    // Modo simple: lo que no se pide se dice en una línea, para que se vea a dónde va la mercadería
    function pintarResumen() {
      if (!simple) return;
      const g = grupoDe(cat, art);
      el.classList.toggle('inv-ver-ubic', !ubic.value);
      const donde = ubic.value ? (ubic.selectedOptions[0]?.textContent || '') : '';
      resumen.textContent = !art ? '' : 'Bolsa: ' + (GRUPOS[g] || 'sin bolsa') + (donde ? ' · se guarda en ' + donde : '') + (noVence.checked ? ' · no vence' : vence.value ? ' · vence el ' + dma(vence.value) : '');
    }
    function ubicacionPorOmision(a) {
      if (!a) return '';
      const c = (cat.categorias || []).find((x) => x.id === a.categoria_id);
      const activas = (cat.ubicaciones || []).filter((u) => u.activo !== false);
      if (c?.entrada_ubicacion_id && activas.some((u) => u.id === c.entrada_ubicacion_id)) return c.entrada_ubicacion_id;
      if (c?.entrada === 'local') return activas.find((u) => u.tipo === 'local' && u.sociedad_id === f.sociedad_id && u.predeterminada)?.id || '';
      return activas.find((u) => u.tipo === 'bodega' && u.predeterminada)?.id || '';
    }
    function venceDe(a) {
      if (!a || a.no_vence) return null;
      const c = (cat.categorias || []).find((x) => x.id === a.categoria_id);
      // vigencia_efectiva (de fx_inv_articulos) ya resolvió la de la categoría: null = no vence
      const vig = 'vigencia_efectiva' in a ? a.vigencia_efectiva : (a.vigencia_dias ?? c?.vigencia_dias);
      if (vig == null) return null;
      // La entrada cuenta desde la fecha de la factura y la vigencia son días completos contando ese día (7 = hasta el séptimo día; sale el octavo)
      const desde = f.fecha && ymdCR(f.fecha) < ctx.hoy ? ymdCR(f.fecha) : ctx.hoy;
      return sumaDias(desde, Math.max(Number(vig) - 1, 0));
    }
    const leerFactor = () => { const t = String(factor.value).trim().replace(',', '.'); return /^\d*(\.\d{0,6})?$/.test(t) && /\d/.test(t) ? Number(t) : NaN; };
    function pintarFactor() {
      const fv = leerFactor();
      if (!Number.isFinite(fv) || fv <= 0) { factorEco.textContent = 'Escriba cuántas trae cada una (mayor que cero, hasta 6 decimales). Si es lo mismo, escriba 1.'; factorEco.className = 'inv-eco mal'; return; }
      factorEco.className = 'inv-eco';
      factorEco.textContent = 'La factura dice ' + num(l.cantidad, 3) + ' × ' + num(fv, 6) + ' = ' + (art ? cantTxt(Math.round(Number(l.cantidad) * fv * 1000) / 1000, art.unidad) : num(Number(l.cantidad) * fv, 3)) + '. Si llegó menos, corrija la cantidad.';
    }
    function costoCalculado() {
      const fv = leerFactor();
      if (!Number.isFinite(fv) || fv <= 0) return null;
      const mismo = art && sug.articulo_id === art.id && sug.factor != null && Number(sug.factor) === fv && sug.costo_unitario != null;
      return mismo ? Number(sug.costo_unitario) : Math.round(Number(l.subtotal_crc) / (Number(l.cantidad) * fv) * 1e5) / 1e5;
    }
    function pintarCosto() {
      const c = costoCalculado();
      costoTxtEl.textContent = c == null ? 'Se calcula al escribir la conversión.' : costoTxt(c) + ' por ' + unidadTxt(art?.unidad || 'unidad', 1) + ' (sale de la factura)';
    }
    factor.addEventListener('input', () => { cantidadTocada = false; const fv = leerFactor(); if (Number.isFinite(fv) && fv > 0) cantidad.poner(Math.round(Number(l.cantidad) * fv * 1000) / 1000); pintarFactor(); pintarCosto(); cambio(); });
    chk.addEventListener('change', async () => {
      if (chk.checked && !art) { chk.checked = false; await escogerArticulo(); if (art) chk.checked = true; }
      el.classList.toggle('marcada', chk.checked); cambio();
    });
    async function escogerArticulo() {
      const opciones = articulos.filter((a) => a.activo !== false).map(opcionDeArticulo);
      const elegido = await elegirArticulo({
        titulo: 'Artículo para la línea ' + l.linea, opciones, sugerido: sug.articulo_id || null,
        ayuda: '«' + l.descripcion + '»' + (l.cabys ? ' · CABYS ' + l.cabys : '') + '. ' + (ctx.esAdmin ? '' : 'Si no está en la lista, pídale a un administrador que lo cree en «Catálogo».'),
        crear: ctx.esAdmin ? async (texto) => {
          const { formArticulo } = await import('./m_inv_catalogo.js');
          const nuevo = await formArticulo(ctx, null, { nombre: texto || l.descripcion.slice(0, 120), cabys: l.cabys || '', categoria_id: sug.categoria_id || '', unidad: unidadSugerida(l.unidad) });
          if (!nuevo) return null;
          articulos = await ctx.articulos.lista(true);
          return opcionDeArticulo(articulos.find((a) => a.id === nuevo.id) || nuevo);
        } : null,
      });
      if (!elegido) return;
      art = elegido.a || articulos.find((a) => a.id === elegido.id) || null;
      pintarArticulo(true);
      chk.checked = true; el.classList.add('marcada'); cambio(); guardarEstado();
    }
    function guardarEstado() {
      memoria.set(l.linea, { art, factor: factor.value, cantidad: cantidad.leer(), tocada: cantidadTocada, ubic: ubic.value, vence: vence.value, editada: venceEditada, noVence: noVence.checked, costoAbierto: costoDet.open, costo: costoInput.value, marcada: chk.checked });
    }
    pintarArticulo(true);
    const previo = memoria.get(l.linea);
    if (previo) {
      if (previo.art) { art = articulos.find((a) => a.id === previo.art.id) || previo.art; pintarArticulo(false); }
      factor.value = previo.factor; cantidadTocada = previo.tocada;
      if (Number.isFinite(previo.cantidad)) cantidad.poner(previo.cantidad);
      ubic.value = previo.ubic; vence.value = previo.vence; venceEditada = !!previo.editada; noVence.checked = previo.noVence; vence.disabled = previo.noVence;
      costoDet.open = previo.costoAbierto; costoInput.value = previo.costo;
      chk.checked = previo.marcada && !!art; el.classList.toggle('marcada', chk.checked);
      pintarFactor(); pintarCosto(); pintarVence();
    }
    el.addEventListener('input', guardarEstado); el.addEventListener('change', guardarEstado); costoDet.addEventListener('toggle', guardarEstado);
    return {
      el,
      marcada: () => chk.checked,
      marcarSiTiene: () => { if (art) { chk.checked = true; el.classList.add('marcada'); } },
      alCambiar: (fn) => avisarCambio.push(fn),
      problema() {
        if (!art) return 'Línea ' + l.linea + ': escoja el artículo.';
        const fv = leerFactor();
        if (!Number.isFinite(fv) || fv <= 0 || fv > 100000) return 'Línea ' + l.linea + ': revise la conversión (mayor que cero y hasta 100 000).';
        if (!cantidad.valido()) return 'Línea ' + l.linea + ': revise la cantidad que entra.';
        if (!ubic.value) return 'Línea ' + l.linea + ': escoja dónde se guarda.';
        if (!noVence.checked) { if (!vence.value) return 'Línea ' + l.linea + ': escriba la fecha de vencimiento o marque «No vence».'; if (vence.value < ctx.hoy && venceEditada) return 'Línea ' + l.linea + ': la fecha de vencimiento no puede ser anterior a hoy.'; }
        if (costoDet.open && costoInput.value.trim()) { const c = leerMonto(costoInput.value); if (!Number.isFinite(c) || c < 0) return 'Línea ' + l.linea + ': el costo corregido no es un monto válido.'; }
        return '';
      },
      enfocarProblema() { el.scrollIntoView({ block: 'center' }); (art ? cantidad.input : btnArt).focus({ preventScroll: true }); },
      datos() {
        const x = { clave: f.clave, linea: l.linea, articulo_id: art.id, factor: String(leerFactor()), cantidad: cant(cantidad.leer()), ubicacion_id: ubic.value };
        if (noVence.checked) x.sin_vencimiento = true; else if (venceEditada) x.vence_en = vence.value;
        if (costoDet.open && costoInput.value.trim()) x.costo_unitario = dinero(leerMonto(costoInput.value));
        return x;
      },
    };
  }
  function sugerenciaTxt(s) {
    if (!s || !s.fuente) return null;
    if (s.no_inventario) return (s.fuente === 'memoria' ? 'la vez pasada esto se marcó «No es de inventario»' : s.fuente === 'servicio' ? 'parece un servicio: normalmente no es de inventario' : 'por su CABYS normalmente no es de inventario') + (s.motivo ? ' (' + s.motivo + ')' : '') + '. Si es así, toque «No es de inventario».';
    if (s.articulo) return s.articulo + ' (' + FUENTES[s.fuente] + (s.factor != null && s.fuente === 'memoria' ? ', cada una trae ' + num(s.factor, 6) + ' ' + unidadTxt(s.unidad, s.factor) : s.factor_sugerido != null ? ', por el nombre parece que cada una trae ' + num(s.factor_sugerido, 6) + ' ' + unidadTxt(s.unidad, s.factor_sugerido) : '') + '). Revíselo antes de marcar la línea.';
    if (s.categoria) return 'por su CABYS parece de la categoría «' + s.categoria + '». ' + (ctx.esAdmin ? 'Toque «Escoger artículo» para escogerlo o crearlo.' : 'Escoja el artículo; si no existe, un administrador lo puede crear en «Catálogo».');
    return null;
  }

  /* ---------- Una línea ya decidida: recibida, «No es de inventario» o que no aplica ---------- */
  function lineaDecidida(f, l) {
    const quien = (l.decidido_por_nombre || l.decidido_por) ? ' · ' + (l.decidido_por_nombre || l.decidido_por) + (l.decidido_en ? ', ' + fechaHora(l.decidido_en) : '') : '';
    const zona = h('div');
    if (l.estado === 'recibida') {
      const r = l.recepcion || {};
      const deshacer = ctx.esAdmin ? h('button.btn.peligro', { type: 'button', onclick: () => pedirDeshacerRecepcion(f, l, () => cargar()) }, 'Deshacer la recepción') : null;
      return h('article.inv-linea.decidida.recibida', { 'data-linea': l.linea },
        h('div.inv-linea-desc', h('strong', 'Línea ' + l.linea + ': ' + l.descripcion), h('span.chip.ok', 'Recibida')),
        h('p.inv-linea-res', `${r.articulo || 'Artículo'}: ${cantTxt(r.cantidad, r.unidad)} a ${r.ubicacion || 'sin dato'}` + (r.vence_en ? ', vence el ' + dma(r.vence_en) : ', no vence') + (r.costo_unitario != null ? ', ' + costoTxt(r.costo_unitario) + ' por ' + unidadTxt(r.unidad, 1) + ' sin IVA' : '') + quien),
        r.lote_estado && r.lote_estado !== 'activo' ? h('p.tenue.inv-chico', 'El lote está ' + ({ agotado: 'agotado (ya se usó todo)', vencido: 'vencido', anulado: 'anulado' })[r.lote_estado] + (r.lote_cantidad_actual != null ? ' · quedan ' + cantTxt(r.lote_cantidad_actual, r.unidad) : '') + '.') : null,
        deshacer ? h('div.inv-linea-pie', deshacer, zona) : null);
    }
    if (l.estado === 'ignorada') {
      const { boton } = botonSeguro('Deshacer: volver a «Por recibir»', '', { zona, ocupado: 'Deshaciendo…', hacer: (idem) => inv.deshacerIgnorar(f.clave, [l.linea], idem), alTerminar: (r, { repetida }) => { toastOk('La línea ' + l.linea + ' volvió a «Por recibir».' + repetidaTxt(repetida)); return cargar(); } });
      return h('article.inv-linea.decidida.ignorada', { 'data-linea': l.linea },
        h('div.inv-linea-desc', h('strong', 'Línea ' + l.linea + ': ' + l.descripcion), h('span.chip', 'No es de inventario')),
        h('p.inv-linea-res', (l.motivo ? 'Motivo: ' + l.motivo : 'Sin motivo') + quien),
        h('div.inv-linea-pie', boton, zona));
    }
    return h('article.inv-linea.decidida.no-aplica', { 'data-linea': l.linea },
      h('div.inv-linea-desc', h('strong', 'Línea ' + l.linea + ': ' + l.descripcion), h('span.chip', 'No aplica')),
      h('p.tenue.inv-chico', Number(l.cantidad) > 0 ? 'Este tipo de documento no entra al inventario.' : 'La línea trae cantidad cero: no hay nada que recibir.'));
  }
  // Administrador: deshacer una recepción (solo si el lote está intacto). Motivo obligatorio.
  function pedirDeshacerRecepcion(f, l, alTerminar) {
    const motivo = h('input.campo', { type: 'text', maxlength: 200, 'aria-label': 'Motivo', placeholder: 'Por ejemplo: se escogió el artículo equivocado' });
    const zona = h('div');
    const ok = h('button.btn.peligro', { type: 'button' }, 'Sí, deshacer la recepción');
    const acc = accionSegura({ boton: ok, zona, ocupado: 'Deshaciendo…',
      hacer: (idem) => { const m = motivo.value.trim(); if (m.length < 3) { motivo.focus(); throw new Error('Escriba el motivo (al menos 3 letras).'); } return inv.recepcionDeshacer(f.clave, l.linea, m, idem); },
      alTerminar: (r, { repetida }) => { d.cerrar(); toastOk('Se deshizo la recepción de la línea ' + l.linea + ': volvió a «Por recibir».' + repetidaTxt(repetida)); alTerminar?.(); } });
    ok.addEventListener('click', () => acc.ejecutar());
    const d = dialogo({ titulo: 'Deshacer la recepción', ancho: 540, contenido: [
      h('p', `La línea ${l.linea} («${l.descripcion}») sale del inventario y vuelve a «Por recibir». Solo se puede si nadie ha usado ni trasladado ese lote.`),
      h('label.etq', 'Motivo (obligatorio)', motivo), zona], botones: [{ texto: 'No, volver', onclick: (c) => c() }] });
    d.el.querySelector('.modal-pie').append(ok);
  }

  await cargar(true);
}
