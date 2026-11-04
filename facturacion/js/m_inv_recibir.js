// Por recibir: facturas de proveedores de las DOS empresas con líneas que todavía no entran al inventario (fx_inv_pendientes), y la ventana de cada factura
// (fx_inv_factura) donde se reciben las líneas (fx_inv_recibir) o se marcan «No es de inventario» (fx_inv_ignorar).
// Pantalla rediseñada (3 nov 2026): una fila compacta por factura en la lista y UNA FILA por línea dentro de la factura.
//  - Lista: facturas agrupadas por proveedor, con filtros y orden que se conservan al entrar y volver. «Recibir las N líneas seguras» recibe sin abrir la factura.
//  - Factura: las verdes (seguras) se aceptan juntas con un solo botón; las ámbar y rojas se abren en su misma fila para corregir y recibirse una por una.
// Lo que se escribe en el inventario NO cambió: sigue siendo fx_inv_recibir / fx_inv_ignorar con la misma clave de repetición por intención.
// Rótulos: «Categoría» = comida preparada, unitarios o suministros (el tratamiento en inventario); «Rubro» = Lácteos y quesos, Abarrotes secos, etc.
// Una factura que Contable o Hacienda rechazaron no se puede recibir (puede_recibir = false): solo se puede marcar «No es de inventario».
import { h, money, money0, num, fechaHora, horaCorta, debounce, campoBusqueda, sumaDias } from './util.js';
import { inv, cant, dinero } from './api_inventarios.js';
import { debeGuardarAlias } from './invclave.js';
import { revisarConversion, unidadReal } from './inv_sentido.js';
const uFac = (l) => unidadReal(l.cantidad, l.unidad).unidad; // «Unid» con decimales es peso: se muestra y se usa como kg
import {
  ventana, dialogo, cargando, falla, vacio, aviso, cantTxt, costoTxt, unidadTxt, dma, diaTxt, plural, empresaChip, numFactura, proveedorTxt, tipoDocTxt,
  accionSegura, botonSeguro, rotular, repetidaTxt, campoCantidad, leerCantidad, leerMonto, selectUbicacion, elegirArticulo, opcionDeArticulo,
  enfocar, toastOk, toastMal, norm, poner, ymdCR, proveedorPartes, GRUPOS, grupoDe } from './m_inv_comun.js';

/* =====================================================================================================================
   Ajustes y ganchos (lo que el agente de datos entrega después)
   ===================================================================================================================== */
// Banda costo/precio ÚNICA: la fija la base (fact.inv_config: costo_precio_min y costo_precio_max) y llega en fx_inv_catalogos().config. No hay valor de respaldo en la pantalla:
// si la base no la trae, la pantalla no juzga el costo contra el precio (se muestra la relación sin decir «normal» o «fuera de lo normal»).
const bandaCostoPrecio = (cat) => {
  const c = (cat && cat.config) || {}, mn = Number(c.costo_precio_min), mx = Number(c.costo_precio_max);
  return Number.isFinite(mn) && Number.isFinite(mx) && mn > 0 && mx > mn ? { min: mn, max: mx } : null;
};

// Diccionario de siglas de la IA (fact.ia_diccionario). La propuesta de la IA trae ia.siglas = [{ id, sigla, significado, confirmado }] (fx_ia_propuestas, solo las del proveedor que aparecen en la línea).
// «Confirmar» marca la sigla como confirmada por Emil, «Corregir» guarda el significado correcto (y la confirma) y «No es correcta» la rechaza: la IA deja de usarla.
const DICCIONARIO = {
  confirmar: (s) => inv.diccionarioConfirmar(s.id),
  corregir: (s, significado) => inv.diccionarioCorregir(s.id, significado),
  rechazar: (s) => inv.diccionarioRechazar(s.id),
  deshacer: (s) => inv.diccionarioDeshacer(s.id),
};
const siglasDe = (ia) => {
  if (!ia) return [];
  const bruto = Array.isArray(ia.siglas) ? ia.siglas : [];
  return bruto.filter((s) => s && s.id && s.sigla && s.significado && !s.confirmado && !s.rechazada);
};

// Estado contable (contrato 3.2) a color: verde aceptada, ámbar con aviso, rojo no entra
const CLASE_ESTADO = { aceptada: 'ok', parcial: 'espera', plazo_vencido: 'espera', rechazada: 'mal', rechazo_en_tramite: 'mal', rechazada_por_hacienda: 'mal' };
export const chipContable = (ec) => (ec ? h('span.chip.inv-contable' + (CLASE_ESTADO[ec.estado] ? '.' + CLASE_ESTADO[ec.estado] : ''), 'Contable: ' + (ec.texto || 'Sin dato')) : null);
const FUENTES = {
  memoria: 'Lo mismo que se usó la vez pasada con este proveedor',
  alias: 'Otro nombre que ya se le conoce a este artículo (alias guardado)',
  nombre: 'Es el mismo nombre de un artículo del inventario (sin contar mayúsculas, tildes ni puntuación)',
  memoria_cabys: 'Con este proveedor y este CABYS se usó este artículo (revise la conversión)',
  articulo_cabys: 'Es el único artículo con este mismo CABYS',
  cabys: 'Por su CABYS',
  servicio: 'La factura lo cobra como un servicio',
};
// Unidad de la factura (Hacienda) a la del inventario, para proponerla al crear un artículo nuevo
const UNIDAD_DE_FACTURA = { kg: 'kg', g: 'g', l: 'litro', lt: 'litro', ml: 'ml', unid: 'unidad', und: 'unidad', un: 'unidad', caja: 'caja', paq: 'paquete', bolsa: 'bolsa', lata: 'lata', botella: 'botella' };
const unidadSugerida = (u) => UNIDAD_DE_FACTURA[norm(u).replace(/\./g, '')] || 'unidad';
// El artículo general de comida preparada y suministros se llama «Rubro (en colones)»: en pantalla el dinero va con ₡, nunca con la palabra colones al lado
const limpiaNombre = (n) => String(n || '').replace(/\s*\(en colones\)\s*/i, '').trim();
// Cantidad con su unidad; si la unidad es el colón es dinero y se escribe con ₡
const cantR = (n, unidad) => (unidad === 'colon' ? money(n) : cantTxt(n, unidad));

// Decidir un enlace de verdad guarda su alias (solo administración): el texto del proveedor queda como otra forma de nombrar ese artículo, para ese proveedor.
// No se guarda alias si el texto solo difiere del nombre del artículo en mayúsculas, tildes, puntuación o espacios (eso es el mismo nombre, la base lo compara normalizado),
// ni si el sistema ya lo conocía. Es un efecto secundario: si falla, la recepción ya quedó hecha y no se avisa como error.
async function guardarAliases(ctx, f, infos) {
  if (!ctx.esAdmin) return 0;
  let n = 0;
  for (const a of infos.filter((x) => x && debeGuardarAlias(x))) {
    try { await inv.aliasGuardar({ descripcion: a.detalle, proveedor_cedula: f.proveedor_cedula || null, articulo_id: a.articuloId, factor: a.factor > 0 && a.factor !== 1 ? String(a.factor) : null, origen: 'decision', confirmado: true }); n++; }
    catch { /* el alias es una ayuda para la próxima vez; nada que reintentar ahora */ }
  }
  return n;
}

/* ---------- Lector de presentación (empaque, peso, volumen) a partir del texto de la factura ---------- */
// Esta lectura es solo para MOSTRAR y no decide nada: la conversión y los factores los lee la base con fact.inv_leer_presentacion (la misma regla que usa la IA).
// «GASEOSA LATA 355ML CAJA X24» -> { nombre: 'Gaseosa lata', texto: '355 mL · caja de 24' }
const PEQUENAS = new Set(['de', 'la', 'el', 'en', 'con', 'sin', 'por', 'los', 'las', 'una', 'uno', 'al', 'del', 'para', 'y']);
export function leerPresentacion(desc, unidadFactura = '') {
  let t = ' ' + String(desc || '').replace(/\s+/g, ' ').trim() + ' ';
  const partes = [];
  const quita = (re, formato) => { const m = t.match(re); if (!m) return null; t = t.replace(re, ' '); const p = formato(m); if (p) partes.push(p); return m; };
  const decimal = (s) => String(s).replace(',', '.');
  quita(/(?<![\w.])(\d+(?:[.,]\d+)?)\s?(ml|cc|lts?|litros?|l)\b\.?/i, (m) => { const u = /^(ml|cc)$/i.test(m[2]) ? 'mL' : 'L'; return num(decimal(m[1]), 3) + ' ' + u; });
  quita(/(?<![\w.])(\d+(?:[.,]\d+)?)\s?(kgs?|kilos?|grs?|g|gramos?|lbs?|libras?|oz)\b\.?/i, (m) => { const u = /^(kg|kilo)/i.test(m[2]) ? 'kg' : /^(g|gr|gramo)/i.test(m[2]) ? 'g' : /^(lb|libra)/i.test(m[2]) ? 'lb' : 'oz'; return num(decimal(m[1]), 3) + ' ' + u; });
  let pack = null;
  const sustantivo = (n) => { const base = (String(unidadFactura) + ' ' + String(desc || '')); return (/\bcaj|\bcj\b/i.test(base) ? 'caja' : /\bbols/i.test(base) ? 'bolsa' : /\bfard|\bbult/i.test(base) ? 'bulto' : /\bpaq/i.test(base) ? 'paquete' : 'empaque') + ' de ' + n; };
  const m1 = quita(/(?<![\w.])(?:x|por)\s?(\d{1,3})(?:\s?(?:u|uds?|unid\w*|und))?(?![\w])/i, (m) => { pack = sustantivo(m[1]); return ''; })
    || quita(/(?<![\w.])(\d{1,3})\s?(?:u|uds?|unid\w*|und)\b\.?/i, (m) => { pack = sustantivo(m[1]); return ''; })
    || quita(/\/\s?(\d{2,3})(?!\d)/, (m) => { pack = sustantivo(m[1]); return ''; });
  if (m1 && pack) partes.push(pack);
  t = t.replace(/\b(caja|cj|bolsa|fardo|bulto|paquete)\b\s*$/i, ' ').replace(/[-/,.\s]+$/g, ' ').replace(/^[-/,.\s]+/g, ' ').replace(/\s+/g, ' ').trim();
  const nombre = t.split(' ').filter(Boolean).map((w, i) => {
    const bajo = w.toLowerCase();
    if (w.length <= 3 && w === w.toUpperCase() && /[A-ZÁÉÍÓÚÑ]/.test(w) && !PEQUENAS.has(bajo)) return w; // siglas cortas (CC, DPR) se dejan como vienen
    return i === 0 ? bajo.charAt(0).toUpperCase() + bajo.slice(1) : bajo;
  }).join(' ');
  return { nombre: nombre || String(desc || '').trim(), texto: partes.join(' · ') };
}

// Una frase corta para la fila: la primera oración, sin pasar de unos 110 caracteres
const frase = (t) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); const p = s.split(/(?<=[.!?])\s/)[0] || s; return p.length > 110 ? p.slice(0, 107).trimEnd() + '…' : p; };

export async function abrir(ctx, id, pedido = {}) {
  if (id === 'factura' && pedido.clave) return abrirFactura(ctx, pedido.clave);
  return abrirLista(ctx, pedido);
}

/* =====================================================================================================================
   Lista de facturas por recibir
   ===================================================================================================================== */
// Los filtros y el orden se guardan al tocarlos (sessionStorage; si el navegador no deja, en memoria): al entrar a una factura y volver, o al salir y volver a entrar, la lista está como se dejó.
const LLAVE_LISTA = 'fx.inv.recibir.lista.v1';
let RESPALDO_LISTA = {};
const leerLista = () => { try { const t = sessionStorage.getItem(LLAVE_LISTA); const o = t ? JSON.parse(t) : null; if (o && typeof o === 'object') return o; } catch { /* sin almacenamiento */ } return RESPALDO_LISTA; };
const guardarLista = (o) => { RESPALDO_LISTA = o; try { sessionStorage.setItem(LLAVE_LISTA, JSON.stringify(o)); } catch { /* sin almacenamiento: la lista funciona igual */ } };
const PAGINA = 30; // facturas que se pintan de una vez; «Ver más facturas» agrega otras tantas
const ESTADOS = [['todas', 'Todas, por etapas'], ['verde', 'Solo verdes'], ['ambar', 'Solo ámbar'], ['rojo', 'Solo rojas'], ['rechazadas', 'Rechazadas (no entran)']];
const ORDENES = [['proveedor', 'Por proveedor'], ['recientes', 'Más recientes primero'], ['lineas', 'Todas las líneas']];
const dm = (x) => { const d = ymdCR(x); return d ? d.split('-').reverse().slice(0, 2).join('/') : ''; };

async function abrirLista(ctx) {
  const cat = ctx.cat;
  const propia = (cat.empresas || []).some((e) => e.id === ctx.app.socId) ? ctx.app.socId : null;
  const g = leerLista();
  const empresaGuardada = 'sociedad' in g ? (g.sociedad === 'todas' ? null : (cat.empresas || []).some((e) => e.id === g.sociedad) ? g.sociedad : propia) : propia;
  const est = {
    sociedad: empresaGuardada, q: String(g.q || ''), proveedor: String(g.proveedor || ''),
    estado: ESTADOS.some(([v]) => v === g.estado) ? g.estado : 'todas', orden: g.orden === 'recientes' || g.orden === 'lineas' ? g.orden : 'proveedor', sel: new Map(), mostrarL: 120,
    mostrar: Number(g.mostrar) >= PAGINA ? Number(g.mostrar) : PAGINA, datos: null, otra: null, otraVieja: true,
  };
  const persistir = () => guardarLista({ sociedad: est.sociedad || 'todas', q: est.q, proveedor: est.proveedor, estado: est.estado, orden: est.orden, mostrar: est.mostrar });
  let vivo = true, seq = 0;
  const buscar = h('input.campo', { type: 'search', placeholder: 'Proveedor, cédula, número o artículo', 'aria-label': 'Buscar factura por recibir', autocomplete: 'off', value: est.q });
  const filtroEmp = h('div.inv-segmento.rc-seg', { role: 'group', 'aria-label': 'De qué empresa' });
  const selProv = h('select.campo', { 'aria-label': 'Proveedor', onchange: () => { est.proveedor = selProv.value; est.mostrar = PAGINA; persistir(); pintar(); } });
  const selEstado = h('select.campo', { 'aria-label': 'Estado de las facturas', onchange: () => { est.estado = selEstado.value; est.mostrar = PAGINA; persistir(); pintar(); } },
    ...ESTADOS.map(([v, t]) => h('option', { value: v, selected: v === est.estado }, t)));
  const selOrden = h('select.campo', { 'aria-label': 'Cómo ordenar la lista', onchange: () => { est.orden = selOrden.value; persistir(); pintar(); } },
    ...ORDENES.map(([v, t]) => h('option', { value: v, selected: v === est.orden }, t)));
  selEstado.value = est.estado; selOrden.value = est.orden;
  const deshechos = h('div.inv-deshechos', { 'aria-live': 'polite' });
  const lista = h('div.inv-fac-lista.rc-lista', cargando('Buscando facturas por recibir…'));
  const resumen = h('p.rc-resumen', { 'aria-live': 'polite' });
  const otraNota = h('div.inv-otra-nota');
  const campo = (txt, ctl) => h('label.etq.rc-filtro', h('span', txt), ctl);
  const contenido = [
    h('div.rc-filtros', filtroEmp,
      h('div.rc-filtros-fila', h('label.etq.inv-buscar.rc-filtro.rc-f-buscar', h('span', 'Buscar'), campoBusqueda(buscar, () => { est.q = ''; est.mostrar = PAGINA; persistir(); cargar(); })), campo('Proveedor', selProv), campo('Semáforo', selEstado), campo('Orden', selOrden))),
    resumen, otraNota, deshechos, lista];
  const alCambio = () => { if (vivo) { est.otraVieja = true; cargar(); } };
  ventana({ titulo: 'Por recibir', contenido, alCerrar: () => { vivo = false; document.removeEventListener('inv:cambio', alCambio); } }).el.classList.add('rc-vent');
  document.addEventListener('inv:cambio', alCambio);
  if (est.q) buscar.dispatchEvent(new Event('input'));
  buscar.addEventListener('input', debounce(() => { est.q = buscar.value.trim(); est.mostrar = PAGINA; persistir(); cargar(); }, 350));

  function elegir(id) {
    if (est.sociedad === id) return;
    est.sociedad = id; est.proveedor = ''; est.mostrar = PAGINA; persistir();
    est.datos = null; pintarEmpresas(); cargar();
  }
  function pintarEmpresas() {
    const b = (id, t) => h('button.btn.inv-seg', { type: 'button', 'aria-pressed': String(est.sociedad === id), onclick: () => elegir(id) }, t);
    const empresas = cat.empresas || [];
    const mi = empresas.find((e) => e.id === propia);
    // La empresa de la sesión va primero; «Las dos empresas» después
    const otras = empresas.filter((e) => e.id !== propia);
    poner(filtroEmp, ...(mi ? [b(mi.id, mi.nombre), b(null, 'Las dos empresas'), ...otras.map((e) => b(e.id, e.nombre))] : [b(null, 'Las dos empresas'), ...empresas.map((e) => b(e.id, e.nombre))]));
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
      poner(resumen);
    }
  }

  /* ---- Lo que se sabe de cada línea sin abrir la factura (para el semáforo de la fila y el botón «Recibir las N líneas seguras») ---- */
  // Es un cálculo rápido con la sugerencia que ya viene en la lista; al recibir, cada línea pasa por su semáforo completo (incluida la revisión de Claude) y lo que no lo pase se queda sin recibir.
  const pendiente = (l) => !l.estado || l.estado === 'pendiente';
  const grupoDeRubro = (id) => (cat.categorias || []).find((x) => x.id === id)?.grupo || '';
  function nivelRapido(l) {
    const sg = l.sugerencia || {};
    if (sg.no_inventario) return 'rojo';
    if (sg.fuente === 'memoria' && sg.articulo_id && Number(sg.factor) > 0) {
      if (sg.unidad === 'colon') return 'verde';
      return revisarConversion({ descripcion: l.descripcion, subtotal: l.subtotal_crc, cantidad: l.cantidad, factorActual: Number(sg.factor) }).aviso ? 'ambar' : 'verde';
    }
    return sg.categoria_id || sg.articulo_id ? 'ambar' : 'rojo';
  }
  // Seguras: las verdes y la comida preparada o suministro con rubro sugerido (entran por su valor: no hay conversión que revisar)
  const esSegura = (l) => { const n = nivelRapido(l); const sg = l.sugerencia || {}; return n === 'verde' || (n === 'ambar' && !!sg.categoria_id && grupoDeRubro(sg.categoria_id) !== 'unitario' && sg.fuente !== 'servicio'); };
  const infoFactura = (f) => {
    const ls = (f.lineas || []).filter(pendiente), puede = f.puede_recibir !== false;
    const niv = { verde: 0, ambar: 0, rojo: 0 };
    ls.forEach((l) => { niv[nivelRapido(l)]++; });
    return { ls, puede, n: ls.length, niv, seguras: puede ? ls.filter(esSegura).length : 0, todasNoInv: ls.length > 0 && ls.every((l) => (l.sugerencia || {}).no_inventario) };
  };
  // Etapas por factura: primero se ven las verdes; al aceptarlas aparecen las ámbar; al resolverlas, las rojas
  const nivelEtapa = (l) => { const v = nivelRapido(l); return v === 'verde' ? 'verde' : v === 'ambar' ? 'ambar' : 'rojo'; };
  function etapaDe(inf) {
    const forzado = ['verde', 'ambar', 'rojo'].includes(est.estado) ? [est.estado] : ['verde', 'ambar', 'rojo']; // con un color escogido solo se ve ese color
    for (const nivel of forzado) {
      const ls = inf.ls.filter((l) => nivelEtapa(l) === nivel);
      if (ls.length) return { nivel, ls, recibibles: nivel === 'rojo' ? [] : ls.filter(esSegura) };
    }
    return { nivel: null, ls: [], recibibles: [] };
  }
  const claveProv = (f) => f.proveedor_cedula || f.proveedor_nombre || 'sin dato';

  function pintar() {
    if (!est.datos) return;
    const d = est.datos, todas = d.facturas || [];
    const scroller = lista.closest('.modal-cuerpo'), yAntes = scroller ? scroller.scrollTop : 0;
    const infos = new Map(todas.map((f) => [f.clave, infoFactura(f)]));
    // Proveedores para el filtro (de lo que se ve; con cuántas facturas)
    const provs = new Map();
    todas.forEach((f) => { const k = claveProv(f); if (!provs.has(k)) provs.set(k, { nombre: proveedorTxt(f.proveedor_nombre), n: 0 }); provs.get(k).n++; });
    if (est.proveedor && !provs.has(est.proveedor)) est.proveedor = '';
    poner(selProv, h('option', { value: '' }, 'Todos los proveedores'), ...[...provs.entries()].sort((a, b) => a[1].nombre.localeCompare(b[1].nombre, 'es')).map(([k, p]) => h('option', { value: k }, p.nombre + ' (' + p.n + ')')));
    selProv.value = est.proveedor;
    const pasa = (f) => {
      const i = infos.get(f.clave);
      if (est.proveedor && claveProv(f) !== est.proveedor) return false;
      if (['verde', 'ambar', 'rojo'].includes(est.estado)) return i.puede && i.ls.some((l) => nivelEtapa(l) === est.estado);
      if (est.estado === 'rechazadas') return !i.puede;
      return true;
    };
    const facs = todas.filter(pasa);
    const totalFacs = Number((d.resumen || {}).facturas) || 0;
    const totSeg = facs.reduce((s, f) => s + infos.get(f.clave).seguras, 0), totLin = facs.reduce((s, f) => s + infos.get(f.clave).n, 0);
    poner(resumen, h('strong', plural(facs.length, 'factura por recibir', 'facturas por recibir')), ' · ' + plural(totLin, 'línea', 'líneas') + ' · ' + plural(totSeg, 'línea segura', 'líneas seguras'),
      d.truncado ? ' · se muestran las ' + todas.length + ' más recientes' + (totalFacs > todas.length ? ' de ' + totalFacs : '') + (est.sociedad ? '; use el buscador para ver las demás' : '; use el buscador o escoja una empresa para ver las demás') : '',
      h('span.tenue.inv-chico.rc-leyenda', ' Verde: segura. Ámbar: revisar. Rojo: falta algo o no es de inventario.'));
    if (!facs.length) {
      poner(lista, vacio(est.q || est.proveedor || est.estado !== 'todas' ? 'Ninguna factura por recibir coincide con lo que escogió. Cambie el filtro o el buscador.' : 'No hay facturas por recibir. Todo lo que llegó ya se recibió o se marcó «No es de inventario».'));
    } else {
      const conEmpresa = !est.sociedad;
      const filaDe = (f, conProveedor) => fila(f, infos.get(f.clave), conProveedor, conEmpresa);
      let cuerpoLista, restan = 0;
      if (est.orden === 'lineas') {
        cuerpoLista = [vistaLineas(facs, infos, conEmpresa)];
      } else if (est.orden === 'recientes') {
        const orden = [...facs].sort((a, b) => String(b.llego || b.fecha).localeCompare(String(a.llego || a.fecha)));
        cuerpoLista = orden.slice(0, est.mostrar).map((f) => filaDe(f, true));
        restan = Math.max(0, orden.length - est.mostrar);
      } else {
        // Por proveedor: lo decidido en la primera factura de un proveedor ayuda a las siguientes. Un proveedor con varias facturas lleva su renglón de título;
        // el que tiene una sola muestra su nombre en la misma fila (así una factura sigue siendo UNA fila).
        const grupos = agrupar(facs, infos);
        const cuerpoG = []; let pintadas = 0;
        const normales = grupos.filter((x) => !x.aparte), aparte = grupos.filter((x) => x.aparte);
        const poneGrupos = (gs, titulo) => {
          let tituloPuesto = false;
          for (const gr of gs) {
            if (pintadas >= est.mostrar) break;
            if (!tituloPuesto && titulo) { cuerpoG.push(h('h3.rc-sep', titulo, h('span.inv-cuenta', String(gs.length)))); tituloPuesto = true; }
            if (gr.facturas.length > 1) cuerpoG.push(h('h3.rc-prov-cab', h('strong', proveedorTxt(gr.nombre)), h('span.rc-prov-datos', plural(gr.facturas.length, 'factura', 'facturas') + ' · ' + plural(gr.lineas, 'línea', 'líneas')), gr.aparte ? h('span.chip', 'Casi nunca es de inventario') : null));
            gr.facturas.forEach((f) => cuerpoG.push(filaDe(f, gr.facturas.length === 1)));
            pintadas += gr.facturas.length;
          }
        };
        poneGrupos(normales, normales.length && aparte.length ? 'Proveedores de mercadería' : '');
        poneGrupos(aparte, 'Ferretería, combustible y servicios');
        cuerpoLista = cuerpoG;
        restan = Math.max(0, facs.length - pintadas);
      }
      poner(lista, est.orden === 'lineas' ? cuerpoLista[0] : h('div.rc-filas', cuerpoLista), restan ? h('button.btn.rc-pag', { type: 'button', onclick: () => { est.mostrar += PAGINA; persistir(); pintar(); } }, 'Ver ' + plural(Math.min(PAGINA, restan), 'factura más', 'facturas más') + ' (quedan ' + restan + ')') : null);
    }
    if (scroller && yAntes) scroller.scrollTop = yAntes;
  }
  /* ---- Vista «Todas las líneas»: cada línea de todas las facturas, las verdes primero; se marcan y se reciben juntas ---- */
  const ORD_NIVEL = { verde: 0, segura: 1, ambar: 2, rojo: 3 };
  const nivelVista = (l) => { const n = nivelRapido(l); return n === 'verde' ? 'verde' : (esSegura(l) ? 'segura' : n); };
  function vistaLineas(facs, infos, conEmpresa) {
    const todas = [];
    for (const f of facs) { const inf = infos.get(f.clave); if (!inf.puede) continue; for (const l of inf.ls) { const v = nivelVista(l); if (['verde', 'ambar', 'rojo'].includes(est.estado) && nivelEtapa(l) !== est.estado) continue; todas.push({ f, l, v }); } }
    todas.sort((a, b) => ORD_NIVEL[a.v] - ORD_NIVEL[b.v] || String(a.f.proveedor_nombre).localeCompare(String(b.f.proveedor_nombre), 'es') || String(a.f.consecutivo).localeCompare(String(b.f.consecutivo)) || a.l.linea - b.l.linea);
    const marcada = (f, l) => !!est.sel.get(f.clave)?.has(l.linea);
    const poner1 = (f, l, si) => { let s = est.sel.get(f.clave); if (!s) est.sel.set(f.clave, (s = new Set())); si ? s.add(l.linea) : s.delete(l.linea); if (!s.size) est.sel.delete(f.clave); };
    const marcarSegun = (ok) => { est.sel.clear(); let ultima = -1; todas.forEach((x, i) => { if (ok(x.v)) { poner1(x.f, x.l, true); ultima = i; } }); est.mostrarL = Math.max(est.mostrarL, ultima + 1); pintar(); }; // toda línea marcada queda a la vista
    const nMarc = [...est.sel.values()].reduce((a, s) => a + s.size, 0);
    const totMarc = todas.filter((x) => marcada(x.f, x.l)).reduce((a, x) => a + (Number(x.l.subtotal_crc) || 0), 0);
    const cuenta = { verde: 0, segura: 0, ambar: 0, rojo: 0 }; todas.forEach((x) => { cuenta[x.v]++; });
    const barra = h('div.rc-sel-barra',
      h('div.rc-sel-botones',
        h('button.btn', { type: 'button', disabled: !cuenta.verde, onclick: () => marcarSegun((v) => v === 'verde') }, 'Marcar las ' + cuenta.verde + ' verdes'),
        h('button.btn', { type: 'button', disabled: !(cuenta.verde + cuenta.segura), onclick: () => marcarSegun((v) => v === 'verde' || v === 'segura') }, 'Marcar verdes y ámbar seguras (' + (cuenta.verde + cuenta.segura) + ')'),
        h('button.btn', { type: 'button', disabled: !nMarc, onclick: () => { est.sel.clear(); pintar(); } }, 'Quitar las marcas')),
      h('p.tenue.inv-chico.rc-sel-leyenda', 'Se marcan solo las que se pueden recibir sin revisar. Las ámbar con duda y las rojas se abren con «Revisar».'));
    const hasta = Math.min(todas.length, est.mostrarL);
    const filas = todas.slice(0, hasta).map(({ f, l, v }) => {
      const sg = l.sugerencia || {};
      const destino = sg.articulo ? limpiaNombre(sg.articulo) : (sg.categoria ? 'rubro «' + sg.categoria + '»' : 'sin artículo');
      const puedeMarcar = v === 'verde' || v === 'segura';
      const caja = puedeMarcar ? h('input', { type: 'checkbox', checked: marcada(f, l), 'aria-label': 'Marcar la línea ' + l.linea + ' de la factura N.° ' + numFactura(f.consecutivo), onchange: (e) => { poner1(f, l, e.target.checked); pintar(); } }) : h('span.rc-sel-vacio');
      return h('div.rc-lin' + (marcada(f, l) ? '.marcada' : ''),
        caja, h('i.rc-lin-punto.' + (v === 'segura' ? 'ambar' : v), { 'aria-hidden': 'true', title: v === 'verde' ? 'Verde' : v === 'segura' ? 'Ámbar segura' : v === 'ambar' ? 'Ámbar: revisar' : 'Roja' }),
        h('span.rc-lin-doc', h('strong', proveedorTxt(f.proveedor_nombre)), h('small', 'N.° ' + numFactura(f.consecutivo) + ' · línea ' + l.linea + (conEmpresa ? ' · ' + (f.sociedad_nombre || '') : ''))),
        h('span.rc-lin-art', h('span.rc-seg-desc', l.descripcion || ''), h('span.rc-seg-flecha', { 'aria-hidden': 'true' }, '→'), h('span.rc-seg-art', destino)),
        h('span.rc-seg-cant.cifra', num(Number(l.cantidad) || 0, 3)),
        h('span.rc-lin-imp.cifra', money0(l.subtotal_crc)),
        puedeMarcar ? h('span.rc-lin-acc') : h('button.btn.chico', { type: 'button', onclick: () => abrirFactura(ctx, f.clave, { previa: f }) }, 'Revisar'));
    });
    const btnRecibir = h('button.btn.primario.grande', { type: 'button', disabled: !nMarc }, nMarc ? 'Recibir ' + (nMarc === 1 ? 'la línea marcada' : 'las ' + nMarc + ' líneas marcadas') + ' · ' + money0(totMarc) : 'Marque las líneas que quiere recibir');
    btnRecibir.addEventListener('click', async () => {
      if (btnRecibir.disabled) return;
      btnRecibir.disabled = true;
      const grupos = [...est.sel.entries()];
      let i = 0;
      for (const [clave, set] of grupos) {
        i++; btnRecibir.textContent = 'Recibiendo ' + i + ' de ' + grupos.length + '…';
        const f = facs.find((x) => x.clave === clave);
        await new Promise((res) => { abrirFactura(ctx, clave, { previa: f, recibirSugeridas: true, soloLineas: new Set(set), alFin: res }).catch(res); });
      }
      est.sel.clear();
      if (vivo) { est.otraVieja = true; cargar(); }
    });
    return h('div.rc-lineas', barra, h('div.rc-lin-cab', h('span'), h('span'), h('span', 'Proveedor y factura'), h('span', 'Línea → artículo'), h('span.cifra', 'Cantidad'), h('span.cifra', 'Importe'), h('span')),
      h('div.rc-lin-filas', filas),
      hasta < todas.length ? h('button.btn.rc-pag', { type: 'button', onclick: () => { est.mostrarL += 120; pintar(); } }, 'Ver ' + Math.min(120, todas.length - hasta) + ' líneas más (quedan ' + (todas.length - hasta) + ')') : null,
      h('div.rc-sel-pie', btnRecibir));
  }
  // Lo que casi nunca es de inventario (ferretería, combustible, servicios) va al final
  const SIN_INVENTARIO = /ferreter|materiales|constru|combustible|gasolin|servicentro|estaci[oó]n de servicio|repuesto|el[eé]ctric|seguro|alquiler|internet|telecom|municipalidad/i;
  function agrupar(facs, infos) {
    const grupos = new Map();
    for (const f of facs) {
      const k = claveProv(f);
      if (!grupos.has(k)) grupos.set(k, { nombre: f.proveedor_nombre, facturas: [], lineas: 0 });
      const gr = grupos.get(k); gr.facturas.push(f); gr.lineas += infos.get(f.clave).n;
    }
    return [...grupos.values()].map((gr) => {
      const ls = gr.facturas.flatMap((f) => infos.get(f.clave).ls);
      gr.aparte = SIN_INVENTARIO.test(gr.nombre || '') || (ls.length > 0 && ls.filter((l) => l.sugerencia && l.sugerencia.no_inventario).length >= ls.length * 0.8);
      gr.facturas.sort((a, b) => String(b.llego || b.fecha).localeCompare(String(a.llego || a.fecha)));
      return gr;
    }).sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es'));
  }
  const pill = (nivel, n, uno, varios) => (n ? h('span.rc-pill.' + nivel, h('i', { 'aria-hidden': 'true' }), n + ' ' + (n === 1 ? uno : varios)) : null);

  // Una fila compacta por factura: documento, proveedor, líneas, semáforo, total y las acciones, todo en una sola línea (en celular baja a dos)
  function fila(f, inf, conProveedor, conEmpresa) {
    const et = etapaDe(inf);
    const ec = f.estado_contable || {};
    const hoyLlego = f.llego && ymdCR(f.llego) === (est.datos.hoy || ctx.hoy);
    const cuando = hoyLlego ? 'hoy ' + horaCorta(f.llego) : dm(f.llego || f.fecha);
    const ver = () => abrirFactura(ctx, f.clave, { previa: f });
    const botones = [];
    if (!inf.puede) botones.push(h('button.btn', { type: 'button', onclick: ver }, 'Ver la factura'));
    else {
      if (inf.todasNoInv) botones.push(h('button.btn.primario', { type: 'button', onclick: () => pedirIgnorar(ctx, f, null, (r) => { quitarDeLista(f, r); }) }, 'Toda la factura no es de inventario'));
      else if (et.recibibles.length > 0) {
        const nR = et.recibibles.length, solo = new Set(et.recibibles.map((l) => l.linea));
        const rotulo = et.nivel === 'verde' ? (nR === 1 ? 'Recibir la línea verde' : 'Recibir las ' + nR + ' verdes') : (nR === 1 ? 'Recibir la ámbar segura' : 'Recibir las ' + nR + ' ámbar seguras');
        const bs = h('button.btn.primario', { type: 'button' }, rotulo);
        bs.addEventListener('click', async () => {
          if (bs.disabled) return;
          bs.disabled = true; bs.textContent = 'Recibiendo…';
          await new Promise((res) => { abrirFactura(ctx, f.clave, { previa: f, recibirSugeridas: true, soloLineas: solo, alFin: res }).catch(res); });
          if (bs.isConnected) { bs.disabled = false; bs.textContent = rotulo; }
        });
        botones.push(bs);
      }
      const porRevisar = inf.n - et.recibibles.length;
      botones.push(h('button.btn', { type: 'button', onclick: ver }, porRevisar > 0 && !inf.todasNoInv ? 'Revisar ' + plural(porRevisar, 'línea', 'líneas') : 'Ver la factura'));
    }
    return h('article.inv-fac.rc-fac' + (inf.puede ? '' : '.rechazada'), { 'data-clave': f.clave },
     h('div.rc-fac-fila',
      h('button.rc-fac-abrir', { type: 'button', onclick: ver, 'aria-label': 'Abrir la factura N.° ' + numFactura(f.consecutivo) + ' de ' + proveedorTxt(f.proveedor_nombre) },
        conProveedor ? h('strong.rc-fac-prov', proveedorTxt(f.proveedor_nombre)) : null,
        h('span.rc-fac-doc', 'N.° ' + numFactura(f.consecutivo) + ' · ' + cuando)),
      conEmpresa ? h('span.rc-fac-emp', empresaChip(f.sociedad_nombre, f.sociedad_codigo)) : null,
      h('span.rc-fac-estado', h('span.rc-fac-lineas', plural(inf.n, 'línea', 'líneas')),
        inf.puede ? h('span.rc-pills', pill('verde', inf.niv.verde, 'verde', 'verdes'), pill('ambar', inf.niv.ambar, 'ámbar', 'ámbar'), pill('rojo', inf.niv.rojo, 'roja', 'rojas')) : h('span.chip.mal.rc-fac-rech', ec.texto || 'Rechazada, no entra')),
      h('span.rc-fac-total.cifra', { title: 'Total con IVA' }, money0(f.total)),
      h('div.rc-fac-acc', botones)),
     listaEtapa(inf, et));
  }
  // Lo que toca decidir ahora, a la vista: solo la etapa actual de la factura (verdes, luego ámbar, luego rojas), cada línea con su artículo y cantidad
  function listaEtapa(inf, et) {
    if (!inf.puede || inf.todasNoInv || !et.nivel) return null;
    const rot = { verde: 'Verdes', ambar: 'Ámbar', rojo: 'Rojas' }[et.nivel];
    const resto = inf.ls.length - et.ls.length;
    return h('div.rc-etapa',
      h('p.rc-etapa-tit', h('i.rc-lin-punto.' + et.nivel, { 'aria-hidden': 'true' }), h('strong', rot + ' (' + et.ls.length + ')'), resto && est.estado === 'todas' ? h('span.tenue', ' · después ' + (et.nivel === 'verde' ? 'siguen las ámbar y rojas' : 'siguen las rojas') + ' (' + resto + ')') : null),
      h('ul.rc-seguras', ...et.ls.map((l) => {
        const sg = l.sugerencia || {};
        const destino = sg.articulo ? limpiaNombre(sg.articulo) : (sg.categoria ? 'rubro «' + sg.categoria + '»' : 'sin artículo');
        return h('li', h('span.rc-seg-desc', l.descripcion || ('Línea ' + l.linea)), h('span.rc-seg-flecha', { 'aria-hidden': 'true' }, '→'), h('span.rc-seg-art', destino), h('span.rc-seg-cant.cifra', num(Number(l.cantidad) || 0, 3)));
      })));
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
  pintarEmpresas();
  await cargar();
  enfocar(lista.closest('.modal-cuerpo') || lista);
}
// La razón social, en pequeño, cuando el proveedor trae nombre comercial
const razonTxt = (n) => { const r = proveedorPartes(n).razon; return r ? h('small.inv-razon', r) : null; };

/* ---------- «No es de inventario» (varias líneas o toda la factura, con motivo) ---------- */
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
export async function abrirFactura(ctx, clave, { previa = null, recibirSugeridas = false, soloLineas = null, alRecibir = null, alFin = null } = {}) {
  let autoRecibir = recibirSugeridas;
  let silencioso = recibirSugeridas; // «Recibir las N líneas seguras» desde la lista: no se abre la ventana salvo que algo necesite revisarse
  const cat = ctx.cat;
  const banda = bandaCostoPrecio(cat);
  let vivo = true;
  const cuerpo = h('div.inv-factura.rc-factura', cargando('Cargando la factura…'));
  const resultado = h('div.inv-resultado', { 'aria-live': 'polite' });
  const mostrar = () => { if (!silencioso) return; silencioso = false; ventana({ titulo: 'Factura de proveedor', volver: 'Por recibir', contenido: [resultado, cuerpo], alCerrar: () => { vivo = false; } }).el.classList.add('rc-vent'); };
  if (!silencioso) { silencioso = true; mostrar(); }
  const recordados = new Map(); // línea -> sugerencia que trajo la lista (por si la consulta de la factura no la repite)
  (previa?.lineas || []).forEach((l) => recordados.set(l.linea, l.sugerencia));
  let articulos = [];
  let iaPorLinea = new Map(); // línea -> propuesta de la IA (solo administración)
  const recordar = h('input', { type: 'checkbox', checked: true });
  // Lo que la persona ya llenó en cada línea pendiente (y si la fila está abierta): se conserva cuando la ventana se vuelve a pintar
  const memoria = new Map();

  async function cargar(primera = false) {
    let d;
    try { [d, articulos] = await Promise.all([inv.factura(clave), ctx.articulos.lista()]); }
    catch (e) {
      if (!vivo) return;
      if (autoRecibir && silencioso) { autoRecibir = false; silencioso = false; vivo = false; toastMal('No se pudo abrir la factura para recibirla: ' + ((e && e.message) || 'intente de nuevo') + ' Toque «Revisar» o «Ver la factura» para intentarlo de nuevo.'); alFin?.(); return; }
      poner(cuerpo, falla(e, () => { poner(cuerpo, cargando()); cargar(primera); }, 'No se pudo abrir la factura')); return;
    }
    if (!vivo) return;
    if (ctx.esAdmin) { const ia = await inv.iaPropuestas(clave).catch(() => []); iaPorLinea = new Map((ia || []).map((x) => [x.linea, x])); }
    if (!vivo) return;
    pintar(d);
    if (primera) enfocar(cuerpo);
  }

  // Lo que entró, en palabras; el detalle va plegado para que no empuje lo importante
  function mostrarResultado(r, repetida) {
    const rec = r.recibidas || [];
    poner(resultado, aviso('ok',
      h('p', h('strong', rec.length === 1 ? 'Se recibió 1 línea.' : 'Se recibieron ' + rec.length + ' líneas.'), repetidaTxt(repetida)),
      rec.length ? h('details.rc-res-det', h('summary', 'Ver qué entró'),
        h('ul.inv-res-lista', rec.map((x) => h('li', `Línea ${x.linea}: ${limpiaNombre(x.articulo)}, ${cantR(x.cantidad, x.unidad)} a ${x.ubicacion}` + (x.vence_en ? ', vence el ' + dma(x.vence_en) : ', no vence') + (x.unidad === 'colon' ? '' : `, ${costoTxt(x.costo_unitario)} por ${unidadTxt(x.unidad, 1)}`) + ` (${money(x.valor)} sin IVA). Empresa de origen: ${x.sociedad_origen_nombre || 'sin dato'}.`)))) : null,
      ...(r.avisos || []).map((t) => h('p.inv-res-aviso', t))));
    resultado.scrollIntoView({ block: 'nearest' });
  }

  function pintar(d) {
    const f = d.factura || {}, ec = f.estado_contable || {};
    const scroller = cuerpo.closest('.modal-cuerpo'), yAntes = scroller ? scroller.scrollTop : 0;
    const puede = f.puede_recibir !== false;
    const lineas = d.lineas || [];
    const pend = lineas.filter((l) => l.estado === 'pendiente');
    const otras = lineas.filter((l) => l.estado !== 'pendiente');
    const formas = pend.map((l) => formaLinea(f, l, puede));
    const zonaRecibir = h('div.rc-zona');
    const btnRecibir = h('button.btn.primario.grande.rc-aceptar', { type: 'button' }, 'Aceptar las líneas seguras');
    const seguras = () => formas.filter((x) => x.segura() && (!soloLineas || soloLineas.has(x.linea)));
    const resumenSem = h('p.tenue.inv-chico.rc-sem-resumen');
    const pintarBarra = () => {
      const n = seguras().length;
      rotular(btnRecibir, n === 1 ? 'Aceptar la línea segura' : 'Aceptar las ' + n + ' líneas seguras'); btnRecibir.hidden = !n;
      const c = { verde: 0, ambar: 0, rojo: 0 }; formas.forEach((x) => { c[x.semaforo().nivel || 'rojo']++; });
      resumenSem.textContent = c.verde + ' verdes, ' + c.ambar + ' ámbar, ' + c.rojo + ' rojas. ' + (c.verde ? 'Las verdes se aceptan juntas; las ámbar y rojas se abren en su fila para recibirse una por una.' : 'Las ámbar y rojas se abren en su fila para recibirse una por una.');
    };
    formas.forEach((x) => x.alCambiar(pintarBarra));
    // Un solo botón para las seguras: sin abrir cada línea y sin confirmar de nuevo. Una clave por intención (reintentar no duplica).
    const accRecibir = accionSegura({ boton: btnRecibir, zona: zonaRecibir, ocupado: 'Recibiendo…',
      hacer: async (idem) => {
        const sel0 = seguras();
        if (!sel0.length) throw new Error('Ninguna línea está lista para aceptarse sola. Revise las que dicen «Revisar».');
        for (const x of sel0) await x.preparar();
        const faltan = sel0.filter((x) => !x.tieneArticulo());
        if (faltan.length) { faltan[0].enfocarProblema(); throw new Error(faltan[0].problema() || 'No se pudo preparar una de las líneas seguras.'); }
        const mal = sel0.find((x) => x.problema());
        if (mal) { mal.enfocarProblema(); throw new Error(mal.problema()); }
        const infos = sel0.map((x) => x.aliasInfo()), r = await inv.recibir(sel0.map((x) => ({ ...x.datos(), recordar: recordar.checked })), idem);
        await guardarAliases(ctx, f, infos.map((i) => i && { ...i, recordar: recordar.checked }));
        return r;
      },
      alFallar: (e) => { if (silencioso) { silencioso = false; vivo = false; toastMal('No se pudo recibir la factura de ' + proveedorTxt(f.proveedor_nombre) + ': ' + ((e && e.message) || 'intente de nuevo') + ' Toque «Revisar» en esa factura para verla.'); } },
      alTerminar: async (r, { repetida }) => {
        const rec = r.recibidas || [];
        if (silencioso) { silencioso = false; vivo = false; ctx.articulos.olvidar(); toastOk((rec.length === 1 ? 'Se recibió 1 línea' : 'Se recibieron ' + rec.length + ' líneas') + ' de ' + proveedorTxt(f.proveedor_nombre) + '.' + repetidaTxt(repetida)); alRecibir?.(); return; }
        mostrarResultado(r, repetida);
        ctx.articulos.olvidar();
        await cargar();
      } });
    btnRecibir.addEventListener('click', () => accRecibir.ejecutar());
    const ignorarToda = h('button.btn', { type: 'button', onclick: () => pedirIgnorar(ctx, f, null, () => cargar()) }, 'Toda la factura no es de inventario');
    const contableAqui = f.sociedad_id && f.sociedad_id === ctx.app.socId;

    poner(cuerpo,
      h('header.inv-fac-detalle-cab.rc-cab',
        h('div.rc-cab-prov', h('h2', proveedorTxt(f.proveedor_nombre)), razonTxt(f.proveedor_nombre),
          h('p.tenue', tipoDocTxt(f.tipo) + ' N.° ' + numFactura(f.consecutivo) + ' · emitida ' + diaTxt(f.fecha) + ' · cédula ' + (f.proveedor_cedula || 'sin dato'))),
        h('div.rc-cab-datos', h('div.inv-fac-emp', h('small', 'A nombre de'), empresaChip(f.sociedad_nombre, f.sociedad_codigo)),
          h('div.inv-fac-estado', chipContable(ec), h('span.inv-fac-total.cifra', 'Total con IVA ' + money(f.total)), f.moneda && f.moneda !== 'CRC' ? h('span.tenue', 'Factura en ' + f.moneda + ', tipo de cambio ' + num(f.tipo_cambio, 2)) : null),
          contableAqui
            ? h('button.btn.chico', { type: 'button', onclick: () => ctx.app.ir('contabilidad', { clave: f.clave, buscar: numFactura(f.consecutivo) }) }, 'Ir a Contabilidad')
            : h('small.tenue', 'Es de ' + (f.sociedad_nombre || 'la otra empresa') + ': en Contable se responde desde una sesión de esa empresa.'))),
      !puede ? aviso('mal', h('p', h('strong', (ec.texto || 'Rechazada, no entra') + '. '), 'No se puede recibir al inventario. ' + (ec.estado === 'rechazada_por_hacienda' ? 'Espere la factura que la reemplace.' : 'Si la mercadería no se quedó, márquela «No es de inventario».')),
          // Lo mismo que le dice Contable antes de rechazar (m_recepcion.js): rechazar no mueve la bodega
          lineas.some((l) => l.estado === 'recibida') ? h('p', 'Lo que ya se recibió sigue en la bodega: rechazar la factura en Contable no lo saca. Para corregirlo, use «Deshacer la recepción» en cada línea (solo una persona administradora, y solo si ese lote todavía no se ha tocado) o registre una salida como «Devolución a proveedor», en «Salidas y mermas».') : null)
        : (f.aviso || ec.aviso) ? aviso('espera', h('p', f.aviso || ec.aviso)) : null,
      pend.length ? h('section.inv-grupo.rc-lineas', h('h3', 'Líneas por recibir', h('span.inv-cuenta', String(pend.length))),
        h('div.rc-barra',
          puede ? btnRecibir : null,
          puede ? h('label.inv-casilla.rc-recordar', recordar, h('span', 'Recordar estas decisiones para este proveedor')) : null,
          ignorarToda),
        zonaRecibir,
        puede ? resumenSem : null,
        h('div.rc-tabla', { role: 'list' },
          puede ? h('div.rc-encab', { 'aria-hidden': 'true' }, h('span', 'Estado'), h('span', 'Lo que entendí'), h('span', 'Cantidad y costo sin IVA'), h('span', 'Rubro, categoría y dónde va'), h('span', 'Acción')) : null,
          formas.map((x) => x.el)))
        : aviso('ok', h('p', 'Esta factura ya no tiene líneas por recibir.')),
      otras.length ? h('details.rc-decididas', { open: !pend.length }, h('summary', plural(otras.length, 'línea ya decidida', 'líneas ya decididas')), h('div.inv-lineas', otras.map((l) => lineaDecidida(f, l)))) : null,
      (d.notas_proveedor || []).length ? h('section.inv-grupo', h('h3', 'Notas del proveedor sobre esta factura'),
        h('ul.inv-datos-lista', d.notas_proveedor.map((n) => h('li', h('span', tipoDocTxt(n.tipo) + ' N.° ' + numFactura(n.consecutivo) + ' del ' + dma(n.fecha)), h('strong', ({ por_revisar: 'Por revisar', devuelta: 'Mercadería devuelta', ignorada: 'No afecta el inventario' })[n.estado] || n.estado || '')))),
        h('button.btn', { type: 'button', onclick: () => ctx.abrir('notas') }, 'Abrir Notas de proveedor')) : null);
    pintarBarra();
    if (scroller && yAntes && cuerpo.isConnected) scroller.scrollTop = yAntes;
    // «Recibir las N líneas seguras» desde la lista: se aceptan las verdes y la comida preparada o suministros con rubro; si algo falla se avisa y la factura se puede abrir con «Revisar»
    if (autoRecibir && !puede) { autoRecibir = false; if (silencioso) { silencioso = false; vivo = false; toastMal('La factura de ' + proveedorTxt(f.proveedor_nombre) + ' no se puede recibir ahora.'); } alFin?.(); }
    if (autoRecibir && puede) {
      autoRecibir = false;
      (async () => {
        try {
          if (!seguras().length) { if (silencioso) { silencioso = false; vivo = false; toastMal('No se recibió la factura de ' + proveedorTxt(f.proveedor_nombre) + ': ninguna línea está lista para aceptarse sola (los unitarios y lo dudoso se deciden uno a uno). Toque «Revisar» en esa factura.'); } return; }
          const r = await accRecibir.ejecutar();
          if (r == null && silencioso) mostrar(); // no se pudo confirmar (red): se abre la ventana para que se vea el «Reintentar»
        } finally { alFin?.(); }
      })();
    }
  }

  // «No es de inventario» de UNA línea: un solo toque, sin ventana de confirmación; queda en «Líneas ya decididas» con su «Deshacer»
  function botonIgnorar(f, l, clase, zona) {
    return botonSeguro('No es de inventario', clase, { zona, ocupado: 'Guardando…',
      hacer: (idem) => inv.ignorar(f.clave, [l.linea], null, recordar.checked, idem),
      alTerminar: (r, { repetida }) => { toastOk('Línea ' + l.linea + ': no es de inventario. Si fue un error, use «Deshacer» en «Líneas ya decididas».' + repetidaTxt(repetida)); return cargar(); } });
  }

  /* ---------- Una línea pendiente: una fila; si hay algo que revisar se abre en la misma fila ---------- */
  // Descripción de la línea tal como viene en la factura (filas bloqueadas)
  const descLinea = (l) => h('div.inv-linea-desc', h('strong', 'Línea ' + l.linea + ': ' + l.descripcion),
    h('small', 'En la factura: ' + num(l.cantidad, 3) + ' ' + uFac(l) + (unidadReal(l.cantidad, l.unidad).corregida ? ' (la factura dice «' + unidadReal(l.cantidad, l.unidad).original + '», pero por los decimales es peso)' : '') + ' a ' + costoTxt(l.costo_unitario_factura) + ' cada una, sin IVA · subtotal ' + money(l.subtotal_crc) + ' sin IVA' + (l.tarifa_iva != null ? ' · IVA ' + num(l.tarifa_iva, 2) + '%' : '')),
    l.cabys ? h('small', 'CABYS ' + l.cabys + (l.cabys_descripcion ? ': ' + l.cabys_descripcion : '')) : null);
  function formaLinea(f, l, puede) {
    // Factura rechazada: la línea solo se lee; lo único que se puede hacer es marcarla «No es de inventario»
    if (!puede) {
      const zonaB = h('div.rc-zona');
      const { boton } = botonIgnorar(f, l, '', zonaB);
      const el = h('article.inv-linea.rc-lin.bloqueada', { 'data-linea': l.linea, role: 'listitem' }, h('div.rc-fila.rc-fila-simple', h('div.rc-c-leido', descLinea(l)), h('div.rc-c-acc', boton)), zonaB);
      return { el, semaforo: () => ({ nivel: 'rojo' }), verde: () => false, segura: () => false, sugerida: () => false, porColones: () => false, tieneArticulo: () => false, preparar: async () => false, alCambiar() {}, problema: () => '', enfocarProblema() {}, datos: () => null, aliasInfo: () => null };
    }
    const sug = l.sugerencia || recordados.get(l.linea) || {};
    const avisarCambio = [];
    const cambio = () => avisarCambio.forEach((fn) => fn());
    let art = sug.articulo_id ? articulos.find((a) => a.id === sug.articulo_id) || (sug.articulo ? { id: sug.articulo_id, nombre: sug.articulo, unidad: sug.unidad, categoria_id: sug.categoria_id } : null) : null;
    let cantidadTocada = false;
    const enColones = () => !!art && art.unidad === 'colon';
    const valorLinea = () => Math.round(Number(l.subtotal_crc) * 100) / 100; // lo que cuesta la línea sin IVA, en colones
    const pres = leerPresentacion(l.descripcion, uFac(l));
    const nombreArt = h('strong.inv-art-nombre');
    const btnArt = h('button.btn', { type: 'button', onclick: () => escogerArticulo() }, 'Escoger artículo');
    // Rubro (de él salen la categoría, dónde se guarda y cuánto dura). El select vive fuera de la pantalla como modelo; lo que se ve es el buscador de rubros.
    const rubro = h('select.campo', { 'aria-label': 'Rubro de la línea ' + l.linea }, h('option', { value: '' }, 'Escoja el rubro…'),
      ...(cat.categorias || []).filter((c) => c.activo !== false).map((c) => h('option', { value: c.id }, c.nombre)));
    rubro.value = (art && art.categoria_id) || sug.categoria_id || '';
    const nombreNuevo = h('input.campo', { type: 'text', maxlength: 120, autocomplete: 'off', 'aria-label': 'Nombre del artículo de la línea ' + l.linea, value: (sug.articulo || l.descripcion || '').slice(0, 120) });
    const pintarBolsa = () => { const c = (cat.categorias || []).find((x) => x.id === rubro.value); filaNombre.hidden = !!art || !c || c.grupo !== 'unitario'; el.classList.toggle('por-valor', !!c && c.grupo !== 'unitario'); };
    rubro.addEventListener('change', () => { errorRubro.textContent = ''; pintarProducto(); if (art && art.categoria_id !== rubro.value) { art = null; pintarArticulo(true); cambio(); } pintarBolsa(); pintarBotones(); pintarSem(); });
    const filaNombre = h('label.etq.inv-c-nombre.rc-f-ancho', h('span', 'Nombre interno del artículo (sale de la factura; cámbielo solo si hace falta)'), nombreNuevo);
    const errorRubro = h('small.inv-eco.mal', { role: 'alert' });
    const factor = h('input.campo.inv-num', { type: 'text', inputmode: 'decimal', autocomplete: 'off', 'aria-label': 'Cuántas unidades del artículo trae cada unidad de la factura' });
    const factorEco = h('small.inv-eco');
    let notaAuto = ''; // explicación de por qué la conversión arrancó en 1 aunque el nombre diga otra cosa
    const avisoConv = h('p.inv-costo-aviso', { role: 'status', hidden: true }); // sentido comercial: ¿el costo por unidad que sale de esta conversión es creíble?
    const cantidad = campoCantidad({ etiqueta: 'Cantidad que entra', unidad: art?.unidad || '', alCambiar: () => { cantidadTocada = true; pintarCosto(); cambio(); } });
    const ubic = selectUbicacion(cat, { etiqueta: 'Dónde se guarda', alCambiar: () => { pintarSem(); cambio(); } });
    let venceEditada = false; // solo si una persona escribe la fecha se manda; si no, la base aplica la misma regla desde la fecha de la factura
    const vence = h('input.campo', { type: 'date', 'aria-label': 'Fecha de vencimiento', oninput: () => { venceEditada = true; pintarVence(); } });
    const venceEco = h('small.inv-eco');
    const noVence = h('input', { type: 'checkbox', onchange: () => { vence.disabled = noVence.checked; pintarVence(); } });
    const pintarVence = () => { venceEco.className = 'inv-eco'; if (noVence.checked) venceEco.textContent = 'No vence.'; else if (!vence.value) { venceEco.textContent = 'Escriba la fecha o marque «No vence».'; venceEco.className = 'inv-eco mal'; } else if (vence.value < ctx.hoy && venceEditada) { venceEco.textContent = 'La fecha no puede ser anterior a hoy.'; venceEco.className = 'inv-eco mal'; } else if (vence.value < ctx.hoy) { const cc = art && (cat.categorias || []).find((x) => x.id === art.categoria_id); venceEco.textContent = (!cc || cc.salida_automatica !== false) ? 'Por la fecha de la factura ya cumplió sus días: al recibirla entra y sale como consumo automático.' : 'Por la fecha de la factura ya venció.'; } else venceEco.textContent = 'Vence el ' + diaTxt(vence.value) + '.'; };
    const costoTxtEl = h('span.inv-costo');
    const costoAviso = h('p.inv-costo-aviso', { role: 'status', hidden: true });
    const relEl = h('p.inv-costo-rel', { role: 'status', hidden: true }); // la relación entre lo que cuesta y lo que se vende, cuando el artículo está emparentado con un producto del menú
    const refCosto = new Map();
    const costoInput = h('input.campo.inv-num', { type: 'text', inputmode: 'decimal', autocomplete: 'off', 'aria-label': 'Costo sin IVA por unidad del artículo' });
    const costoDet = h('details.inv-corregir', h('summary', 'Corregir el costo'), h('label.etq', 'Costo sin IVA por unidad del artículo (₡)', costoInput, h('small', 'Solo si el costo de la factura no es el correcto. Déjelo vacío para usar el de la factura.')));
    const zona = h('div.rc-zona');
    // Dos decisiones por línea, las dos ya sugeridas: el rubro (por CABYS o memoria) y la categoría a la que pertenece ese rubro (comida preparada, unitarios, suministros)
    // A qué cajón del menú va un producto nuevo según el rubro del inventario: confitería y snacks a Pulpería, energéticas y maltas a Deportivas y energéticas, aguas y yogures a Refrescos, batidos, aguas; lo demás a Gaseosas, tés y jugos
    const cajonDeRubro = (nom) => (/confiter|snack/i.test(nom) ? '17' : /energ|malta/i.test(nom) ? '12' : /agua|yogur|l[aá]cteo/i.test(nom) ? '13' : '11');
    const grupoDeRubro = (id) => (cat.categorias || []).find((x) => x.id === id)?.grupo || '';
    let bolsa = grupoDeRubro(rubro.value);
    const selCat = h('select.campo', { 'aria-label': 'Categoría de la línea ' + l.linea }, ...['comida_preparada', 'unitario', 'suministro'].map((g) => h('option', { value: g }, GRUPOS[g])));
    const llenarRubros = (g) => { const v = rubro.value; rubro.replaceChildren(h('option', { value: '' }, 'Escoja el rubro…'), ...(cat.categorias || []).filter((c) => c.activo !== false && c.grupo === g).map((c) => h('option', { value: c.id }, c.nombre))); rubro.value = grupoDeRubro(v) === g ? v : ''; if (!rubro.value) { const op = [...rubro.options].filter((o) => o.value); const sg = sug.categoria_id && op.find((o) => o.value === sug.categoria_id); rubro.value = sg ? sg.value : op[0]?.value || ''; } };
    const pintarBotones = () => { bolsa = grupoDeRubro(rubro.value) || bolsa; selCat.value = bolsa || ''; el.dataset.bolsa = bolsa; if (typeof buscar !== 'undefined') buscar.value = rubro.value || ''; };
    selCat.addEventListener('change', () => { bolsa = selCat.value; errorRubro.textContent = ''; if (art && grupoDe(cat, art) !== bolsa) { art = null; pintarArticulo(true); } llenarRubros(bolsa); pintarBolsa(); pintarBotones(); pintarSem(); cambio(); });
    // Unitarios (gaseosas, bebidas): la línea se empareja con el producto del menú que se vende, 1 a 1. Cualquier nombre que el proveedor use después para eso se recuerda y entra al mismo producto.
    const prodInput = h('input.campo', { type: 'text', autocomplete: 'off', placeholder: 'Escriba para buscar el producto que usted vende (ej. fresca, coca)…', 'aria-label': 'Producto del menú que se vende, línea ' + l.linea });
    const prodEco = h('small.inv-eco');
    const prodRes = h('div.inv-prod-res', { role: 'listbox', hidden: true });
    let prodLista = null;
    const filaProd = h('div.inv-prod-fila.rc-f-ancho', { hidden: true }, h('label.etq', h('span', 'Producto del menú que se vende'), prodInput), prodRes, prodEco);
    const malProd = (m) => { prodEco.textContent = m; prodEco.className = 'inv-eco mal'; };
    async function cargarProductos() {
      if (prodLista) return prodLista;
      try { prodLista = ((await inv.productosMenu(f.sociedad_id)) || {}).filas || []; } catch { prodLista = []; }
      return prodLista;
    }
    async function pintarProducto() {
      const uni = ctx.esAdmin && (grupoDeRubro(rubro.value) === 'unitario' || (!!art && grupoDe(cat, art) === 'unitario'));
      filaProd.hidden = !uni;
      if (!uni) return;
      await cargarProductos();
      const enl = art && prodLista.find((x) => x.articulo_id === art.id);
      if (enl) { prodInput.value = enl.nombre; prodEco.textContent = 'Este artículo es el producto «' + enl.nombre + '».'; prodEco.className = 'inv-eco'; }
    }
    async function emparentar(pr) {
      prodRes.hidden = true;
      if (!rubro.value) return malProd('Escoja primero el rubro de la línea.');
      prodInput.disabled = true; prodEco.textContent = 'Emparentando…'; prodEco.className = 'inv-eco';
      try {
        const nuevo = await inv.productoArticulo(pr.id, rubro.value, l.cabys || '', unidadSugerida(uFac(l)));
        prodLista = null; ctx.articulos.olvidar(); articulos = await ctx.articulos.lista(true);
        art = articulos.find((a) => a.id === nuevo.id) || nuevo;
        pintarArticulo(true); pintarBotones(); cambio(); guardarEstado();
        prodInput.value = pr.nombre;
        prodEco.textContent = 'Emparentado con «' + pr.nombre + '». Con «Recordar» marcado, lo que este proveedor traiga con este nombre entrará solo a este producto.'; prodEco.className = 'inv-eco';
      } catch (e) { malProd((e && e.message) || 'No se pudo emparentar. Intente de nuevo.'); }
      finally { prodInput.disabled = false; }
    }
    // Mientras se escribe sale la lista de coincidencias para tocar una (nombre o parte del nombre, sin tildes ni mayúsculas)
    prodInput.addEventListener('input', async () => {
      prodEco.textContent = '';
      const texto = prodInput.value.trim().replace(/\s+/g, ' ');
      const t = norm(texto);
      if (t.length < 2) { prodRes.hidden = true; return; }
      const ps = (await cargarProductos()).filter((x) => norm(x.nombre).includes(t)).slice(0, 8);
      const nombreNuevo2 = texto.charAt(0).toUpperCase() + texto.slice(1);
      const agregar = h('button.btn.inv-prod-op.inv-prod-nuevo', { type: 'button', onclick: () => agregarProducto(nombreNuevo2) }, h('strong', '＋ Agregar «' + nombreNuevo2 + '» al menú'), h('small', ' · con precio pendiente, igual que el yogur; se agrega en Soda y en Pollos'));
      prodRes.replaceChildren(...ps.map((x) => h('button.btn.inv-prod-op', { type: 'button', role: 'option', onclick: () => emparentar(x) }, h('strong', x.nombre), h('small', (x.precio > 0 ? ' · ' + money(x.precio) + ' con IVA' : ' · precio pendiente') + (x.articulo ? ' · ya enlazado con «' + x.articulo + '»' : '')))), agregar);
      prodRes.hidden = false;
    });
    // El producto no está en el menú: se agrega en ese momento (cajón según el rubro, precio pendiente) y la línea se empareja con él
    async function agregarProducto(nombre) {
      prodRes.hidden = true; prodInput.disabled = true; prodEco.textContent = 'Agregando «' + nombre + '» al menú…'; prodEco.className = 'inv-eco';
      try {
        const nombreCat = ((cat.categorias || []).find((x) => x.id === rubro.value)?.nombre) || '';
        const nuevo = await inv.productoCrear(nombre, f.sociedad_id, cajonDeRubro(nombreCat));
        prodLista = null;
        await emparentar({ id: nuevo.id, nombre });
        if (nuevo.nuevo) prodEco.textContent = 'Se agregó «' + nombre + '» al menú (código ' + nuevo.codigo + ', precio pendiente: fíjelo en Productos) y la línea quedó emparentada con él.';
      } catch (e) { malProd((e && e.message) || 'No se pudo agregar el producto. Intente de nuevo.'); prodInput.disabled = false; }
    }
    // Rubro: una lista visible con TODOS los rubros, agrupados por cómo se llevan (uno a uno, o bolsa por monto). Al escoger uno, la categoría se ajusta sola.
    const GRUPO_LISTA = { unitario: 'Unitarios · uno a uno (gaseosas, bebidas, confitería)', comida_preparada: 'Comida preparada · bolsa por monto (incluye Pulpería: snacks, caramelos, helados)', suministro: 'Suministros · bolsa por monto' };
    const nombreRubro = () => (cat.categorias || []).find((x) => x.id === rubro.value)?.nombre || '';
    const buscar = h('select.campo.inv-buscar-rubro', { 'aria-label': 'Rubro de la línea ' + l.linea },
      h('option', { value: '' }, 'Escoja el rubro…'),
      ...['unitario', 'comida_preparada', 'suministro'].map((g) => h('optgroup', { label: GRUPO_LISTA[g] },
        ...(cat.categorias || []).filter((c) => c.activo !== false && c.grupo === g).sort((x, y) => String(x.nombre).localeCompare(String(y.nombre), 'es')).map((c) => h('option', { value: c.id }, c.nombre)))));
    buscar.value = rubro.value || '';
    buscar.addEventListener('change', () => {
      const c = (cat.categorias || []).find((x) => x.id === buscar.value);
      if (!c) { rubro.value = ''; rubro.dispatchEvent(new Event('change')); return; }
      errorRubro.textContent = ''; bolsa = c.grupo; llenarRubros(c.grupo); rubro.value = c.id; rubro.dispatchEvent(new Event('change'));
    });
    const campoRubro = h('label.etq.rc-f-rubro', h('span', 'Rubro'), buscar);
    const campoCat = h('label.etq.rc-f-cat', h('span', 'Categoría'), selCat);
    const artFila = h('div.inv-campo-art.rc-f-art', h('span.etq', 'Artículo del inventario'), h('div.inv-art-fila', nombreArt, btnArt));
    const campoConv = h('label.etq.inv-c-conv.rc-f-conv', h('span', 'Presentación y conversión de unidades'), h('span.inv-con-unidad', h('span.inv-pre', 'Cada «' + (uFac(l) || 'unidad') + '» de la factura trae'), factor, h('span.inv-unidad.inv-u-art')), factorEco, avisoConv);
    const costoFila = h('div.inv-costo-fila.rc-costo', h('span.inv-costo-et', 'Costo sin IVA:'), costoTxtEl); // el costo sale de la factura: no se corrige a mano (si no cuadra, lo que se corrige es la conversión)
    const mas = h('details.inv-detalles.rc-mas-campos', h('summary', 'Cantidad, dónde se guarda, vencimiento y costo'),
      h('div.inv-linea-campos', cantidad.el, h('label.etq.inv-c-ubic', 'Dónde se guarda', ubic),
        h('div.etq.inv-c-vence', h('span', 'Vence'), vence, venceEco, h('label.inv-casilla.chica', noVence, h('span', 'No vence'))), costoDet));
    const sugTxt = sugerenciaTxt(sug);

    // Semáforo de la línea: verde = igual que una compra anterior de este proveedor y con sentido; ámbar = revisar; rojo = no se puede recibir así
    const ia = iaPorLinea.get(l.linea) || null;
    const iaEl = h('div.inv-ia', { hidden: !ia });
    const iaModelo = ia && /sonnet|opus/.test(ia.modelo || '') ? 'segunda revisión' : 'primera revisión';
    let sem = { nivel: 'rojo', razon: '' };
    function evaluarSem() {
      const fv = leerFactor();
      const rojo = (razon, bloquea) => ({ nivel: 'rojo', razon, bloquea: !!bloquea });
      if (sug.no_inventario) return rojo('Parece que no es de inventario (' + (sug.fuente === 'memoria' ? 'así se marcó la vez pasada' : sug.fuente === 'servicio' ? 'parece un servicio' : 'por su CABYS') + '). Si no lo es, toque «No es de inventario».');
      if (!art && !rubro.value) return rojo('Falta escoger el rubro.');
      if (!art && ia && ia.nivel === 'verde' && !sug.no_inventario) { const g0 = grupoDeRubro(rubro.value); if (g0 && g0 !== 'unitario') return { nivel: 'verde', razon: 'Entra por su valor a «' + (nombreRubro() || 'el rubro') + '» (' + money(valorLinea()) + ' sin IVA). Claude la revisó: ' + ia.razon }; }
      if (!art) return { nivel: 'ambar', razon: 'No hay un artículo igual todavía: al recibirla se crea uno nuevo en el rubro «' + (nombreRubro() || 'escogido') + '». Mire si no existe ya uno parecido.' };
      if (!Number.isFinite(fv) || fv <= 0) return rojo('Revise la conversión: debe ser mayor que cero.');
      const rev = enColones() ? { aviso: '' } : revisarConversion({ descripcion: l.descripcion, subtotal: l.subtotal_crc, cantidad: l.cantidad, factorActual: fv }, (n) => money(n));
      if (rev.aviso) return rojo('El precio por unidad no tiene sentido con esta conversión. ' + rev.aviso, true);
      const motivos = [];
      if (sug.fuente !== 'memoria') motivos.push(sug.fuente ? 'Es una sugerencia del sistema, no una compra anterior de este proveedor (' + String(FUENTES[sug.fuente] || 'por parecido').replace(/^./, (c) => c.toLowerCase()) + ').' : 'No hay una compra anterior de este proveedor con lo mismo.');
      else if (sug.articulo_id && sug.articulo_id !== art.id) motivos.push('Se cambió el artículo que recordaba el sistema.');
      if (sug.fuente === 'memoria' && sug.factor != null && Number(sug.factor) !== fv) motivos.push('La conversión es distinta a la de la vez pasada (' + num(sug.factor, 6) + ').');
      if (notaAuto && fv === 1) motivos.push('La conversión quedó en 1 porque el precio de la factura cuadra con unidades sueltas.');
      if (ia) {
        if (ia.nivel !== 'verde') motivos.push('Claude pide revisarla.');
        if (!enColones() && ia.factor != null && Number(ia.factor) !== fv) motivos.push('Claude propone una conversión de ' + num(ia.factor, 6) + ' y aquí hay ' + num(fv, 6) + '.');
        if (ia.articulo_id && art && ia.articulo_id !== art.id) motivos.push('Claude propone otro artículo.');
      }
      if (unidadReal(l.cantidad, l.unidad).corregida) motivos.push('La factura dice «' + unidadReal(l.cantidad, l.unidad).original + '» pero por los decimales es peso (kg).');
      if (!costoAviso.hidden && costoAviso.textContent) motivos.push(costoAviso.textContent);
      else {
        const r = art && refCosto.get(art.id); const c = costoCalculado(); const hist = r && r.hay ? Number(r.costo_medio_anterior) : 0;
        if (hist > 0 && c > 0 && Number(r.lotes_anteriores) >= 1 && (c / hist > 1.35 || c / hist < 1 / 1.35)) motivos.push('El costo (' + money(c) + ') es ' + num(Math.abs(c / hist - 1) * 100, 0) + ' % ' + (c > hist ? 'más alto' : 'más bajo') + ' que el de las compras anteriores (' + money(hist) + ').');
      }
      if (motivos.length) return { nivel: 'ambar', razon: motivos.join(' ') };
      return { nivel: 'verde', razon: 'Igual que la vez pasada con este proveedor: ' + limpiaNombre(art.nombre) + (enColones() ? ', entra por su valor' : ', cada una trae ' + num(fv, 6) + ' ' + unidadTxt(art.unidad, fv)) + '. El precio tiene sentido.' + (ia && ia.nivel === 'verde' ? ' Claude coincide.' : '') };
    }

    /* ----- La fila: estado, lo que se entendió, cantidad y costo, destino y la acción ----- */
    const semPunto = h('span.rc-punto', { 'aria-hidden': 'true' }), semPalabra = h('span.rc-sem-pal');
    const leidoNom = h('strong.rc-leido-nom'), leidoPres = h('span.rc-leido-pres'), leidoFac = h('small.rc-leido-fac');
    const cantL1 = h('strong.rc-cant-l1'), cantL2 = h('small.rc-cant-l2');
    const destL1 = h('strong.rc-dest-l1'), destL2 = h('small.rc-dest-l2');
    const celdaAcc = h('div.rc-c-acc');
    const filaEl = h('div.rc-fila',
      h('div.rc-c-sem', semPunto, semPalabra),
      h('div.rc-c-leido', h('div.rc-leido-l1', leidoNom, leidoPres), leidoFac),
      h('div.rc-c-cant', cantL1, cantL2),
      h('div.rc-c-dest', destL1, destL2),
      celdaAcc);
    // Botones de acción: «Recibir esta línea» (una sola línea, una sola clave), «No es de inventario» (un toque) y «Cambiar» (abre la fila de una verde)
    const btnUna = h('button.btn.rc-recibir-una', { type: 'button' }, 'Recibir esta línea');
    const aliasInfo = () => (art ? { detalle: l.descripcion, articuloNombre: art.nombre, articuloId: art.id, unidad: art.unidad, factor: Number(leerFactor()), sugerencia: sug } : null);
    const accUna = accionSegura({ boton: btnUna, zona, ocupado: 'Recibiendo…',
      hacer: async (idem) => {
        if (!(await asegurarArticulo())) throw new Error(errorRubro.textContent || 'Línea ' + l.linea + ': falta completar el rubro.');
        const p = problema(); if (p) { enfocarProblema(); throw new Error(p); }
        const info = aliasInfo(), r = await inv.recibir([{ ...datosLinea(), recordar: recordar.checked }], idem);
        await guardarAliases(ctx, f, [{ ...info, recordar: recordar.checked }]);
        return r;
      },
      alTerminar: async (r, { repetida }) => { mostrarResultado(r, repetida); ctx.articulos.olvidar(); await cargar(); } });
    btnUna.addEventListener('click', () => accUna.ejecutar());
    const { boton: ignorarBtn } = botonIgnorar(f, l, '', zona);
    const btnCambiar = h('button.btn.rc-cambiar', { type: 'button', onclick: () => { tocada = true; abierta = !abierta; pintarSem(); } }, 'Cambiar');
    const panelAcc = h('div.rc-panel-acc');
    // Dice «corto» lo que sea largo y deja «ver más»
    const razonL = h('p.rc-razon'), verMas = h('button.rc-vermas', { type: 'button', 'aria-expanded': 'false', onclick: () => { const ab = masEl.hidden; masEl.hidden = !ab; verMas.textContent = ab ? 'ver menos' : 'ver más'; verMas.setAttribute('aria-expanded', String(ab)); } }, 'ver más');
    const masEl = h('div.rc-mas', { hidden: true }, iaEl);
    // Diccionario de siglas: «SIGLA = significado» con «Confirmar» y «Corregir» (solo en las ámbar)
    const siglaEl = h('div.rc-siglas', { hidden: true });
    const pintarSiglas = () => {
      const ss = sem.nivel === 'ambar' ? siglasDe(ia) : [];
      siglaEl.hidden = !ss.length;
      poner(siglaEl, ...ss.map((s) => {
        const msg = h('small.inv-eco'), editor = h('div.rc-sigla-ed', { hidden: true });
        const nuevo = h('input.campo', { type: 'text', maxlength: 120, 'aria-label': 'Qué significa ' + s.sigla, placeholder: 'Qué significa' });
        const hecho = (t) => {
          msg.textContent = t; msg.className = 'inv-eco';
          // «Deshacer» deja la sigla como estaba (pendiente, con el significado que propuso la IA)
          const bD = h('button.btn.chico', { type: 'button', onclick: async () => { bD.disabled = true; try { const r = await DICCIONARIO.deshacer(s); s.confirmado = false; s.rechazada = false; if (r && r.significado) s.significado = r.significado; pintarSiglas(); } catch (e) { bD.disabled = false; msg.textContent = (e && e.message) || 'No se pudo deshacer.'; msg.className = 'inv-eco mal'; } } }, 'Deshacer');
          msg.append(' ', bD);
        };
        const bConf = h('button.btn.chico', { type: 'button', onclick: async () => { bConf.disabled = true; try { await DICCIONARIO.confirmar(s); hecho('Confirmada: «' + s.sigla + '» = ' + s.significado + '.'); s.confirmado = true; bCorr.hidden = bNo.hidden = true; bConf.hidden = true; } catch (e) { bConf.disabled = false; msg.textContent = (e && e.message) || 'No se pudo confirmar.'; msg.className = 'inv-eco mal'; } } }, 'Confirmar');
        const bGuardar = h('button.btn.chico.primario', { type: 'button', onclick: async () => { const t = nuevo.value.trim(); if (t.length < 2) { msg.textContent = 'Escriba qué significa (al menos 2 letras).'; msg.className = 'inv-eco mal'; return; } bGuardar.disabled = true; try { await DICCIONARIO.corregir(s, t); hecho('Corregida: «' + s.sigla + '» = ' + t + '.'); s.significado = t; s.confirmado = true; editor.hidden = true; bConf.hidden = bCorr.hidden = bNo.hidden = true; } catch (e) { bGuardar.disabled = false; msg.textContent = (e && e.message) || 'No se pudo corregir.'; msg.className = 'inv-eco mal'; } } }, 'Guardar el significado');
        editor.append(nuevo, bGuardar);
        const bCorr = h('button.btn.chico', { type: 'button', onclick: () => { editor.hidden = !editor.hidden; if (!editor.hidden) nuevo.focus(); } }, 'Corregir');
        const bNo = h('button.btn.chico', { type: 'button', onclick: async () => { bNo.disabled = true; try { await DICCIONARIO.rechazar(s); hecho('Rechazada: la IA ya no usará «' + s.sigla + '» = ' + s.significado + '.'); s.rechazada = true; bConf.hidden = bCorr.hidden = bNo.hidden = true; editor.hidden = true; } catch (e) { bNo.disabled = false; msg.textContent = (e && e.message) || 'No se pudo rechazar.'; msg.className = 'inv-eco mal'; } } }, 'No es correcta');
        return h('div.rc-sigla', h('span.rc-sigla-txt', h('strong', s.sigla), ' = ', s.significado), h('span.rc-sigla-bot', bConf, bCorr, bNo), editor, msg);
      }));
    };
    const panel = h('div.rc-panel', { hidden: true },
      h('div.rc-razon-fila', razonL, verMas), masEl, siglaEl,
      h('div.rc-campos', campoRubro, campoCat, artFila, campoConv, costoFila, filaNombre, filaProd, errorRubro),
      costoAviso, relEl, mas, panelAcc, zona);
    let abierta = null, tocada = Boolean(memoria.get(l.linea)?.tocada2); // abierta: se abre sola si hay algo que revisar, salvo que la persona la haya abierto o cerrado
    if (memoria.has(l.linea) && memoria.get(l.linea).abierta != null) abierta = memoria.get(l.linea).abierta;
    function pintarSem() {
      sem = evaluarSem();
      el.dataset.semaforo = sem.nivel;
      if (!tocada) abierta = sem.nivel === 'ambar' || (sem.nivel === 'rojo' && !sug.no_inventario);
      razonL.textContent = frase(sem.razon);
      // Lo largo (la razón completa, lo que sugiere el sistema, la propuesta de Claude) queda detrás de «ver más»
      const completa = sem.razon.length > frase(sem.razon).length;
      poner(masEl, completa ? h('p.rc-razon-full', sem.razon) : null, sugTxt ? h('p.inv-sug' + (sug.no_inventario ? '.no-inv' : ''), h('span.inv-sug-et', 'Sugerencia: '), sugTxt) : null, iaEl);
      if (ia) {
        const fv = leerFactor();
        const usar = !enColones() && ia.factor != null && Number.isFinite(fv) && Number(ia.factor) !== fv;
        iaEl.hidden = false;
        iaEl.replaceChildren(...[h('strong', 'Propuesta de Claude (' + iaModelo + '): '), ia.razon + ' ',
          usar ? h('button.btn.chico', { type: 'button', onclick: () => { factor.value = String(ia.factor).replace('.', ','); factor.dispatchEvent(new Event('input', { bubbles: true })); } }, 'Usar la conversión propuesta (' + num(ia.factor, 6) + ')') : null].filter(Boolean));
      }
      verMas.hidden = !masEl.childNodes.length || !(completa || sugTxt || ia);
      pintarSiglas();
      pintarFila();
      pintarAccion();
      el.classList.toggle('abierta', !!abierta);
      panel.hidden = !abierta;
      avisarCambio.forEach((fn) => fn());
    }
    function pintarFila() {
      semPunto.className = 'rc-punto ' + sem.nivel;
      semPalabra.textContent = sug.no_inventario && sem.nivel === 'rojo' ? 'No es de inventario' : ({ verde: 'Segura', ambar: 'Revisar', rojo: 'Falta algo' })[sem.nivel];
      const nom = art && !enColones() ? limpiaNombre(art.nombre) : ia && ia.articulo && !enColones() ? ia.articulo : pres.nombre;
      leidoNom.textContent = nom;
      const extra = art && !enColones() && !pres.texto.includes('de ') && Number(leerFactor()) > 1 ? 'cada ' + (uFac(l) || 'unidad').toLowerCase() + ' trae ' + num(leerFactor(), 6) : '';
      leidoPres.textContent = [pres.texto, extra].filter(Boolean).length ? ' · ' + [pres.texto, extra].filter(Boolean).join(' · ') : '';
      leidoFac.textContent = 'Línea ' + l.linea + ' · en la factura: «' + l.descripcion + '»';
      cantL1.textContent = num(l.cantidad, 3) + ' ' + uFac(l) + ' × ' + costoTxt(l.costo_unitario_factura);
      const c = costoCalculado(), r = art && refCosto.get(art.id), v = r && r.hay ? Number(r.precio_venta_sin_iva) : 0;
      cantL2.textContent = enColones() ? 'Entra por su valor: ' + money(valorLinea()) + ' sin IVA' : art && c != null && c > 0 ? costoTxt(c) + ' por ' + unidadTxt(art.unidad, 1) + (v > 0 ? ' · ' + num(c / v * 100, 0) + ' % del precio de venta' : '') : 'sin IVA';
      const g = bolsa || grupoDeRubro(rubro.value);
      const donde = ubic.value ? (ubic.selectedOptions[0]?.textContent || '') : '';
      destL1.textContent = nombreRubro() || (sug.no_inventario ? 'No es de inventario (sugerido)' : 'Falta escoger el rubro');
      destL1.classList.toggle('falta', !nombreRubro() && !sug.no_inventario);
      destL2.textContent = [GRUPOS[g] || '', donde].filter(Boolean).join(' · ') || ' ';
    }
    function pintarAccion() {
      const principal = sem.nivel === 'verde' ? btnCambiar : (sem.nivel === 'rojo' && sug.no_inventario) ? ignorarBtn : btnUna;
      celdaAcc.replaceChildren(principal);
      panelAcc.replaceChildren(...[btnUna, ignorarBtn].filter((b) => b !== principal));
      btnCambiar.textContent = abierta ? 'Cerrar' : 'Cambiar';
      btnUna.classList.toggle('primario', principal === btnUna);
      ignorarBtn.classList.toggle('primario', principal === ignorarBtn);
      if (!btnUna.dataset.ocupado) btnUna.disabled = !!sem.bloquea;
    }
    const el = h('article.inv-linea.rc-lin', { 'data-linea': l.linea, role: 'listitem' }, filaEl, panel);

    function ponerUnidadCant() { const u = el.querySelector('.inv-campo-cant .inv-unidad'); if (u && enColones()) u.textContent = '₡ sin IVA'; }
    function pintarArticulo(cambiar) {
      pintarProducto();
      nombreArt.textContent = art ? (art.unidad === 'colon' ? limpiaNombre(art.nombre) : art.nombre + ' (se cuenta en ' + unidadTxt(art.unidad, 2) + ')') : 'Sin escoger';
      el.classList.toggle('en-colones', enColones());
      nombreArt.classList.toggle('falta', !art);
      btnArt.textContent = art ? 'Cambiar artículo' : 'Escoger uno que ya existe';
      filaNombre.hidden = true; errorRubro.textContent = ''; if (art && art.categoria_id) rubro.value = art.categoria_id;
      el.querySelector('.inv-u-art').textContent = art ? unidadTxt(art.unidad, 2) + ' del artículo' : 'del artículo';
      cantidad.unidad(art?.unidad || ''); ponerUnidadCant();
      el.dataset.grupo = grupoDe(cat, art) || '';
      if (!cambiar) { pintarSem(); return; }
      // Valores por omisión de ese artículo: los de la sugerencia si es el mismo; si no, la regla del contrato (3.3)
      const mismo = art && sug.articulo_id === art.id;
      let fac = mismo && sug.factor != null ? Number(sug.factor) : sug.factor_sugerido != null ? Number(sug.factor_sugerido) : 1;
      // El nombre puede decir «8U» y la factura cobrar cada unidad suelta: si con ese número el costo por litro no es creíble y con 1 sí, se empieza en 1 (y se explica)
      notaAuto = '';
      if (!(mismo && sug.factor != null && sug.fuente === 'memoria') && fac !== 1) { const r0 = revisarConversion({ descripcion: l.descripcion, subtotal: l.subtotal_crc, cantidad: l.cantidad, factorActual: fac }, (n) => money(n)); fac = r0.factor; if (r0.cambiado) notaAuto = r0.aviso; }
      factor.value = String(fac).replace('.', ',');
      if (!cantidadTocada) cantidad.poner(Math.round(Number(l.cantidad) * fac * 1000) / 1000);
      ubic.value = (mismo && sug.ubicacion_id) || ubicacionPorOmision(art) || '';
      const ven = mismo ? sug.vence_en : venceDe(art);
      venceEditada = false; noVence.checked = !ven; vence.disabled = !ven; vence.value = ven || '';
      if (enColones()) aplicarColones();
      pintarFactor(); pintarCosto(); pintarVence(); pintarSem();
    }
    // Comida preparada y suministros se llevan por su valor: la línea entra por lo que costó sin IVA (cada unidad de la factura trae su precio)
    function aplicarColones() {
      const q = Number(l.cantidad) || 1;
      const fac = Math.round((valorLinea() / q) * 1e6) / 1e6;
      factor.value = String(fac).replace('.', ',');
      cantidad.poner(valorLinea()); ponerUnidadCant();
      cantidadTocada = false;
      costoInput.value = '1'; costoDet.open = false;
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
      if (!Number.isFinite(fv) || fv <= 0) { factorEco.textContent = 'Escriba cuántas trae cada una (mayor que cero, hasta 6 decimales). Si es lo mismo, escriba 1.'; factorEco.className = 'inv-eco mal'; pintarSem(); return; }
      factorEco.className = 'inv-eco';
      const rev = enColones() ? { aviso: '' } : revisarConversion({ descripcion: l.descripcion, subtotal: l.subtotal_crc, cantidad: l.cantidad, factorActual: fv }, (n) => money(n));
      // Si la persona escribió una conversión creíble no se le dice nada; si no lo es, se le explica con la cifra (no se cambia lo que escribió)
      const soloNota = !(rev.aviso && !rev.cambiado); avisoConv.textContent = rev.aviso && !rev.cambiado ? rev.aviso : (fv === 1 ? notaAuto : ''); avisoConv.classList.toggle('nota', soloNota && !!avisoConv.textContent); avisoConv.hidden = !avisoConv.textContent;
      factorEco.textContent = 'La factura dice ' + num(l.cantidad, 3) + ' × ' + num(fv, 6) + ' = ' + (art ? cantR(Math.round(Number(l.cantidad) * fv * 1000) / 1000, art.unidad) : num(Number(l.cantidad) * fv, 3)) + '. Si llegó menos, corrija la cantidad.';
      pintarSem();
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
      revisarCosto(c);
    }
    // Revisión por patrón: un costo muy lejos del precio de venta (o del costo anterior) casi siempre es un factor de caja mal escrito
    function revisarCosto(c) {
      costoAviso.hidden = true; costoAviso.textContent = '';
      relEl.hidden = true; relEl.textContent = '';
      if (c == null || !art || !(c > 0)) return;
      const id = art.id;
      if (!refCosto.has(id)) {
        refCosto.set(id, null);
        inv.costoReferencia(id).then((r) => { refCosto.set(id, r || { hay: false }); if (art && art.id === id) revisarCosto(costoCalculado()); }).catch(() => refCosto.set(id, { hay: false }));
        return;
      }
      const r = refCosto.get(id);
      if (!r || !r.hay) return;
      let t = '';
      const v = Number(r.precio_venta_sin_iva);
      if (v > 0) { const pc = c / v * 100; relEl.textContent = 'Se vende a ' + money(v) + ' sin IVA y entra a ' + money(c) + ' sin IVA: el costo es el ' + num(pc, 0) + ' % del precio de venta' + (!banda ? '.' : pc >= banda.min && pc <= banda.max ? ' (relación normal).' : ' (fuera de lo normal, revise).'); relEl.hidden = false; }
      const hist = Number(r.costo_medio_anterior);
      if (v > 0) {
        const pct = c / v * 100;
        if (banda && (pct < banda.min || pct > banda.max)) t = 'Este costo es el ' + num(pct, 0) + ' % del precio de venta sin IVA (' + money(v) + '). Lo normal está entre ' + num(banda.min, 0) + ' % y ' + num(banda.max, 0) + ' %. Revise cuántas unidades trae cada «' + (uFac(l) || 'unidad') + '» de la factura: casi seguro la conversión está mal.';
      }
      if (!t && hist > 0 && Number(r.lotes_anteriores) >= 1) {
        const razon = c / hist;
        if (razon < 0.2 || razon > 5) t = 'Este costo es ' + num(razon, 1) + ' veces el costo de las compras anteriores (' + money(hist) + '). Revise la conversión de la caja.';
      }
      if (t) { costoAviso.textContent = t; costoAviso.hidden = false; }
      pintarSem();
    }
    factor.addEventListener('input', () => { cantidadTocada = false; const fv = leerFactor(); if (Number.isFinite(fv) && fv > 0) cantidad.poner(Math.round(Number(l.cantidad) * fv * 1000) / 1000); pintarFactor(); pintarCosto(); cambio(); });
    // Sin artículo todavía: se crea con el nombre y el rubro de esta línea (o se usa el que ya tenga ese nombre) y se llenan solos la categoría, dónde se guarda y el vencimiento
    async function asegurarArticulo() {
      if (art) return true;
      if (!rubro.value) { errorRubro.textContent = 'Escoja el rubro de la línea ' + l.linea + ' para poder recibirla.'; abierta = true; tocada = true; pintarSem(); buscar.focus(); return false; }
      const nombre = nombreNuevo.value.trim();
      const crPre = (cat.categorias || []).find((x) => x.id === rubro.value);
      if ((!crPre || crPre.grupo === 'unitario') && nombre.length < 2) { errorRubro.textContent = 'Escriba el nombre del artículo (al menos 2 letras).'; abierta = true; tocada = true; pintarSem(); nombreNuevo.focus(); return false; }
      errorRubro.textContent = ''; rubro.disabled = nombreNuevo.disabled = true;
      try {
        const cr = (cat.categorias || []).find((x) => x.id === rubro.value);
        const porColones = !!cr && cr.grupo !== 'unitario';
        const nuevo = porColones
          ? (articulos.find((a) => a.categoria_id === rubro.value && a.unidad === 'colon' && a.activo !== false) || await inv.articuloRapido(cr.nombre + ' (en colones)', rubro.value, '', 'colon'))
          : await inv.articuloRapido(nombre, rubro.value, l.cabys || '', unidadSugerida(uFac(l)));
        ctx.articulos.olvidar();
        articulos = await ctx.articulos.lista(true);
        art = articulos.find((a) => a.id === nuevo.id) || nuevo;
        pintarArticulo(true); guardarEstado();
        return true;
      } catch (e) { errorRubro.textContent = (e && e.message) || 'No se pudo crear el artículo. Intente de nuevo.'; return false; }
      finally { rubro.disabled = nombreNuevo.disabled = false; }
    }
    async function escogerArticulo() {
      const opciones = articulos.filter((a) => a.activo !== false).map(opcionDeArticulo);
      const elegido = await elegirArticulo({
        titulo: 'Artículo para la línea ' + l.linea, opciones, sugerido: sug.articulo_id || null,
        ayuda: '«' + l.descripcion + '»' + (l.cabys ? ' · CABYS ' + l.cabys : '') + '. ' + (ctx.esAdmin ? '' : 'Si no está en la lista, pídale a un administrador que lo cree en «Catálogo».'),
        crear: ctx.esAdmin ? async (texto) => {
          const { formArticulo } = await import('./m_inv_catalogo.js');
          const nuevo = await formArticulo(ctx, null, { nombre: texto || l.descripcion.slice(0, 120), cabys: l.cabys || '', categoria_id: sug.categoria_id || '', unidad: unidadSugerida(uFac(l)) });
          if (!nuevo) return null;
          articulos = await ctx.articulos.lista(true);
          return opcionDeArticulo(articulos.find((a) => a.id === nuevo.id) || nuevo);
        } : null,
      });
      if (!elegido) return;
      art = elegido.a || articulos.find((a) => a.id === elegido.id) || null;
      pintarArticulo(true);
      cambio(); guardarEstado();
    }
    function guardarEstado() {
      memoria.set(l.linea, { art, factor: factor.value, cantidad: cantidad.leer(), tocada: cantidadTocada, ubic: ubic.value, vence: vence.value, editada: venceEditada, noVence: noVence.checked, costoAbierto: costoDet.open, costo: costoInput.value, abierta, tocada2: tocada });
    }
    function problema() {
      if (!art) return 'Línea ' + l.linea + ': escoja el artículo.';
      const fv = leerFactor();
      if (!Number.isFinite(fv) || fv <= 0 || fv > 100000) return 'Línea ' + l.linea + ': revise la conversión (mayor que cero y hasta 100 000).';
      if (!cantidad.valido()) return 'Línea ' + l.linea + ': revise la cantidad que entra.';
      if (!ubic.value) return 'Línea ' + l.linea + ': escoja dónde se guarda.';
      if (!noVence.checked) { if (!vence.value) return 'Línea ' + l.linea + ': escriba la fecha de vencimiento o marque «No vence».'; if (vence.value < ctx.hoy && venceEditada) return 'Línea ' + l.linea + ': la fecha de vencimiento no puede ser anterior a hoy.'; }
      if (costoDet.open && costoInput.value.trim()) { const c = leerMonto(costoInput.value); if (!Number.isFinite(c) || c < 0) return 'Línea ' + l.linea + ': el costo corregido no es un monto válido.'; }
      return '';
    }
    function enfocarProblema() { abierta = true; tocada = true; pintarSem(); el.scrollIntoView({ block: 'center' }); if (!art) buscar.focus({ preventScroll: true }); else if (cantidad.input && !cantidad.valido()) { mas.open = true; cantidad.input.focus({ preventScroll: true }); } }
    function datosLinea() {
      const x = { clave: f.clave, linea: l.linea, articulo_id: art.id, factor: String(leerFactor()), cantidad: cant(cantidad.leer()), ubicacion_id: ubic.value };
      if (noVence.checked) x.sin_vencimiento = true; else if (venceEditada) x.vence_en = vence.value;
      if (enColones()) x.costo_unitario = '1'; else if (costoDet.open && costoInput.value.trim()) x.costo_unitario = dinero(leerMonto(costoInput.value));
      return x;
    }

    if (bolsa) llenarRubros(bolsa); else if (art) bolsa = grupoDe(cat, art) || '';
    pintarArticulo(true); pintarBolsa(); pintarBotones();
    const previo = memoria.get(l.linea);
    if (previo) {
      if (previo.art) { art = articulos.find((a) => a.id === previo.art.id) || previo.art; pintarArticulo(false); }
      factor.value = previo.factor; cantidadTocada = previo.tocada;
      if (Number.isFinite(previo.cantidad)) cantidad.poner(previo.cantidad);
      ubic.value = previo.ubic; vence.value = previo.vence; venceEditada = !!previo.editada; noVence.checked = previo.noVence; vence.disabled = previo.noVence;
      costoDet.open = previo.costoAbierto; costoInput.value = previo.costo;
      pintarFactor(); pintarCosto(); pintarVence();
    }
    pintarSem();
    el.addEventListener('change', () => setTimeout(pintarBotones, 0));
    el.addEventListener('input', guardarEstado); el.addEventListener('change', guardarEstado); costoDet.addEventListener('toggle', guardarEstado);
    btnCambiar.addEventListener('click', guardarEstado);
    return {
      el,
      semaforo: () => sem,
      verde: () => sem.nivel === 'verde',
      porColones: () => { const g = grupoDeRubro(rubro.value) || (art && grupoDe(cat, art)) || ''; return !!g && g !== 'unitario'; },
      sugerida: () => !!rubro.value && !sug.no_inventario && sug.fuente !== 'servicio' && !!(sug.categoria_id || art),
      // Segura = lo que «Aceptar las líneas seguras» recibe: las verdes y la comida preparada o suministro con rubro sugerido (entran por su valor: no hay conversión que revisar)
      segura: () => sem.nivel === 'verde' || (sem.nivel === 'ambar' && !sug.no_inventario && !sem.bloquea && !!rubro.value && sug.fuente !== 'servicio' && !!(sug.categoria_id || art) && (grupoDeRubro(rubro.value) || (art && grupoDe(cat, art)) || '') !== 'unitario'),
      tieneArticulo: () => !!art,
      aliasInfo,
      preparar: asegurarArticulo,
      alCambiar: (fn) => avisarCambio.push(fn),
      linea: l.linea, problema, enfocarProblema, datos: datosLinea,
    };
  }
  function sugerenciaTxt(s) {
    if (!s || !s.fuente) return null;
    if (s.no_inventario) return (s.fuente === 'memoria' ? 'la vez pasada esto se marcó «No es de inventario»' : s.fuente === 'servicio' ? 'parece un servicio: normalmente no es de inventario' : 'por su CABYS normalmente no es de inventario') + (s.motivo ? ' (' + s.motivo + ')' : '') + '. Si es así, toque «No es de inventario».';
    if (s.articulo) return limpiaNombre(s.articulo) + ' (' + FUENTES[s.fuente] + (s.factor != null && s.fuente === 'memoria' ? ', cada una trae ' + num(s.factor, 6) + ' ' + unidadTxt(s.unidad, s.factor) : s.factor_sugerido != null ? ', por el nombre parece que cada una trae ' + num(s.factor_sugerido, 6) + ' ' + unidadTxt(s.unidad, s.factor_sugerido) : '') + ').';
    if (s.categoria) return 'por su CABYS parece del rubro «' + s.categoria + '». Al recibirla el artículo se crea solo en ese rubro (en unitarios, escoja primero el producto del menú que se vende; si ya existe un artículo, cámbielo arriba).';
    return null;
  }

  /* ---------- Una línea ya decidida: recibida, «No es de inventario» o que no aplica (una sola línea cada una) ---------- */
  function lineaDecidida(f, l) {
    const quien = (l.decidido_por_nombre || l.decidido_por) ? ' · ' + (l.decidido_por_nombre || l.decidido_por) + (l.decidido_en ? ', ' + fechaHora(l.decidido_en) : '') : '';
    const zona = h('div.rc-zona');
    if (l.estado === 'recibida') {
      const r = l.recepcion || {};
      const deshacer = ctx.esAdmin ? h('button.btn.peligro', { type: 'button', onclick: () => pedirDeshacerRecepcion(f, l, () => cargar()) }, 'Deshacer la recepción') : null;
      return h('article.inv-linea.rc-dec.decidida.recibida', { 'data-linea': l.linea },
        h('span.chip.ok', 'Recibida'),
        h('div.rc-dec-txt', h('strong', 'Línea ' + l.linea + ': ' + l.descripcion),
          h('small', `${limpiaNombre(r.articulo) || 'Artículo'}: ${cantR(r.cantidad, r.unidad)} a ${r.ubicacion || 'sin dato'}` + (r.vence_en ? ', vence el ' + dma(r.vence_en) : ', no vence') + (r.costo_unitario != null && r.unidad !== 'colon' ? ', ' + costoTxt(r.costo_unitario) + ' por ' + unidadTxt(r.unidad, 1) + ' sin IVA' : '') + quien),
          r.lote_estado && r.lote_estado !== 'activo' ? h('small.tenue', 'El lote está ' + ({ agotado: 'agotado (ya se usó todo)', vencido: 'vencido', anulado: 'anulado' })[r.lote_estado] + (r.lote_cantidad_actual != null ? ' · quedan ' + cantR(r.lote_cantidad_actual, r.unidad) : '') + '.') : null),
        deshacer ? h('div.rc-dec-acc', deshacer, zona) : null);
    }
    if (l.estado === 'ignorada') {
      const { boton } = botonSeguro('Deshacer', '', { zona, ocupado: 'Deshaciendo…', hacer: (idem) => inv.deshacerIgnorar(f.clave, [l.linea], idem), alTerminar: (r, { repetida }) => { toastOk('La línea ' + l.linea + ' volvió a «Por recibir».' + repetidaTxt(repetida)); return cargar(); } });
      boton.setAttribute('aria-label', 'Deshacer: la línea ' + l.linea + ' vuelve a «Por recibir»');
      return h('article.inv-linea.rc-dec.decidida.ignorada', { 'data-linea': l.linea },
        h('span.chip', 'No es de inventario'),
        h('div.rc-dec-txt', h('strong', 'Línea ' + l.linea + ': ' + l.descripcion), h('small', (l.motivo ? 'Motivo: ' + l.motivo : 'Sin motivo') + quien)),
        h('div.rc-dec-acc', boton, zona));
    }
    return h('article.inv-linea.rc-dec.decidida.no-aplica', { 'data-linea': l.linea },
      h('span.chip', 'No aplica'),
      h('div.rc-dec-txt', h('strong', 'Línea ' + l.linea + ': ' + l.descripcion), h('small', Number(l.cantidad) > 0 ? 'Este tipo de documento no entra al inventario.' : 'La línea trae cantidad cero: no hay nada que recibir.')));
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
