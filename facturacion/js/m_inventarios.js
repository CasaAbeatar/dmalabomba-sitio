// Módulo Inventarios (dentro de Administración). La bodega central es del GRUPO: Soda La Bomba y Pollos La Bomba ven lo mismo.
// La ventana del módulo abre con lo de HOY (vencidos, lo que vence pronto, lo que está bajo el mínimo y lo que falta recibir), después las secciones en palabras
// y al final el valor del inventario (al costo, sin IVA). Cada sección abre en su propia ventana (m_inv_*.js), con «‹ Inventarios» para volver.
// Datos: api_inventarios.js (contrato CONTRATO_INVENTARIOS.md). Las acciones que escriben llevan su clave de repetición (m_inv_comun.js, accionSegura).
import { h, money, num, hoyCR, toast, textoDeError } from './util.js';
import { inv } from './api_inventarios.js';
import { cargarCss, cargando, falla, plural, diaLargo, crearCacheArticulos, empresaChip, poner, GRUPOS } from './m_inv_comun.js';

// Las secciones, en el orden en que se ven. cargar() trae su archivo solo cuando se abre.
const SECCIONES = [
  { id: 'recibir', titulo: 'Por recibir', desc: 'Facturas de proveedores con líneas que todavía no entran a la bodega', cargar: () => import('./m_inv_recibir.js') },
  { id: 'existencias', titulo: 'Existencias', desc: 'Qué hay en cada bodega y local, con sus lotes y vencimientos', cargar: () => import('./m_inv_existencias.js') },
  { id: 'mover', titulo: 'Mover entre bodegas', desc: 'Pasar mercadería de la bodega central a un local, o de un lugar a otro', cargar: () => import('./m_inv_mover.js') },
  { id: 'salidas', titulo: 'Salidas y mermas', desc: 'Lo que se usó, lo que se dañó o se botó, y el porcionado', cargar: () => import('./m_inv_mover.js') },
  { id: 'conteo', titulo: 'Conteo físico', desc: 'Contar lo que hay de verdad y corregir lo que dice el sistema', cargar: () => import('./m_inv_conteo.js') },
  { id: 'historial', titulo: 'Historial', desc: 'Todas las entradas y salidas, con quién las hizo y por qué', cargar: () => import('./m_inv_historial.js') },
  { id: 'notas', titulo: 'Notas de proveedor', desc: 'Notas de crédito y débito de proveedores por revisar', cargar: () => import('./m_inv_notas.js') },
  { id: 'catalogo', titulo: 'Catálogo', desc: 'Artículos, categorías, ubicaciones, reglas CABYS, correcciones y ajustes', soloAdmin: true, cargar: () => import('./m_inv_catalogo.js') },
];

export default {
  id: 'inventarios', titulo: 'Inventarios',
  async mount(root, app) {
    await cargarCss();
    let vivo = true, seq = 0;
    let pedido = app.pedido; // { seccion, clave } si otra pantalla pidió abrir algo concreto (se atiende una sola vez)
    const ctx = {
      app, cat: null, hoy: hoyCR(), articulos: crearCacheArticulos(),
      get vivo() { return vivo; },
      // Administrador: lo dice la base (fx_inv_catalogos.es_admin); mientras no llega, lo que dice la sesión. La base lo vuelve a revisar en cada acción.
      get esAdmin() { return this.cat ? !!this.cat.es_admin : !!app.admin; },
      abrir: (id, p) => abrirSeccion(id, p),
      async recargarCatalogos() { const c = await inv.catalogos(); ctx.cat = c; ctx.hoy = c.hoy || hoyCR(); return c; },
      refrescarInicio: () => cargarHoy(),
    };
    const cuerpo = h('div.inv.inv-inicio');
    root.append(cuerpo);
    poner(cuerpo, cargando('Cargando el inventario…'));

    async function abrirSeccion(id, p = null) {
      const s = SECCIONES.find((x) => x.id === id) || (id === 'hoy' ? { id: 'hoy', titulo: 'Avisos de hoy', cargar: () => import('./m_inv_hoy.js') } : null)
        || (id === 'factura' ? { id: 'factura', cargar: () => import('./m_inv_recibir.js') } : null);
      if (!s || (s.soloAdmin && !ctx.esAdmin)) return;
      try {
        if (!ctx.cat) await ctx.recargarCatalogos();
        const mod = await s.cargar();
        if (!vivo) return;
        await mod.abrir(ctx, id, p || {});
      } catch (e) {
        toast(textoDeError(e), 'error', 7000);
      }
    }

    /* ---------- Lo de hoy, las secciones y el valor ---------- */
    async function cargarHoy() {
      const mia = ++seq;
      try {
        const [cat, al, val] = await Promise.all([ctx.cat ? Promise.resolve(ctx.cat) : ctx.recargarCatalogos(), inv.alertas(), inv.valorizacion()]);
        if (!vivo || mia !== seq) return;
        ctx.cat = cat; ctx.hoy = al.hoy || cat.hoy || ctx.hoy;
        pintar(al, val);
      } catch (e) {
        if (!vivo || mia !== seq) return;
        poner(cuerpo, falla(e, () => { poner(cuerpo, cargando('Cargando el inventario…')); cargarHoy(); }, 'No se pudo cargar el inventario'));
      }
    }

    // Las tarjetas de hoy y las secciones se crean una sola vez y después solo se ponen al día: así, al volver de una ventana, el foco regresa al botón que la abrió
    const tarjetas = new Map();
    function tarjetaHoy({ n, titulo, texto, clase = '', boton, onclick, id }) {
      let b = tarjetas.get(id);
      if (!b) { b = h('button', { type: 'button', 'data-hoy': id }); tarjetas.set(id, b); }
      b.className = 'inv-hoy-tarj' + (clase ? ' ' + clase : '') + (n ? '' : ' cero');
      b.onclick = onclick;
      poner(b, h('span.inv-hoy-n.cifra', num(n, 0)), h('span.inv-hoy-tit', titulo), h('span.inv-hoy-txt', texto), h('span.inv-hoy-ver', boton));
      return b;
    }
    let partes = null; // { hoyTit, rejilla, extras, valor } cuando ya se pintó una vez
    function pintar(a, v) {
      const dias = Number(a.dias_aviso ?? ctx.cat?.config?.dias_aviso ?? 2);
      const vencidos = a.vencidos || [], pronto = a.vencen_pronto || [], bajo = a.bajo_minimo || [];
      const botar = vencidos.filter((x) => x.salio_hoy).length;
      const lista = [
        tarjetaHoy({ id: 'vencidos', n: vencidos.length, titulo: vencidos.length === 1 ? 'Vencido' : 'Vencidos', clase: vencidos.length ? 'urgente' : '',
          texto: vencidos.length ? [botar ? (botar === 1 ? '1 lote salió hoy del sistema: hay que botarlo.' : botar + ' lotes salieron hoy del sistema: hay que botarlos.') : '', vencidos.length - botar ? (vencidos.length - botar === 1 ? '1 todavía cuenta en el inventario.' : (vencidos.length - botar) + ' todavía cuentan en el inventario.') : ''].filter(Boolean).join(' ') : 'No hay nada vencido.',
          boton: 'Ver los vencidos', onclick: () => abrirSeccion('hoy', { foco: 'vencidos' }) }),
        tarjetaHoy({ id: 'pronto', n: pronto.length, titulo: dias === 0 ? 'Vencen hoy' : `Vencen hoy o en ${dias === 1 ? '1 día' : dias + ' días'}`, clase: pronto.length ? 'pronto' : '',
          texto: pronto.length ? 'Úselos primero.' : 'Nada vence en estos días.', boton: 'Ver qué vence', onclick: () => abrirSeccion('hoy', { foco: 'pronto' }) }),
        tarjetaHoy({ id: 'minimo', n: bajo.length, titulo: 'Bajo el mínimo', clase: bajo.length ? 'pronto' : '',
          texto: bajo.length ? 'Hay que pedir o trasladar más.' : 'Todo está sobre su mínimo.', boton: 'Ver cuáles', onclick: () => abrirSeccion('hoy', { foco: 'minimo' }) }),
        tarjetaHoy({ id: 'recibir', n: a.por_recibir || 0, titulo: (a.por_recibir === 1 ? 'Línea' : 'Líneas') + ' por recibir',
          texto: a.por_recibir ? `De ${plural(a.facturas_por_recibir || 0, 'factura', 'facturas')} de proveedores de las dos empresas.` : 'No hay facturas por recibir.', boton: 'Abrir Por recibir', onclick: () => abrirSeccion('recibir') }),
      ];
      const extras = [];
      if (a.notas_por_revisar > 0) extras.push(h('button.btn.inv-hoy-extra', { type: 'button', onclick: () => abrirSeccion('notas') }, plural(a.notas_por_revisar, 'nota de proveedor por revisar', 'notas de proveedor por revisar')));
      (a.conteos_abiertos || []).forEach((c) => extras.push(h('button.btn.inv-hoy-extra', { type: 'button', onclick: () => abrirSeccion('conteo', { conteo: c.id }) }, 'Conteo abierto en ' + c.ubicacion + (c.iniciado_por_nombre ? ' (lo empezó ' + c.iniciado_por_nombre + ')' : ''))));

      if (!partes || !partes.rejilla.isConnected) {
        const secciones = SECCIONES.filter((s) => !s.soloAdmin || ctx.esAdmin);
        const menu = h('div.inv-menu', secciones.map((s) => h('button.inv-sec', { type: 'button', 'data-sec': s.id, onclick: () => abrirSeccion(s.id) },
          h('span.inv-sec-tit', s.titulo), h('span.inv-sec-desc', s.desc), s.soloAdmin ? h('span.inv-sec-solo', 'Solo administradores') : null)));
        partes = { hoyTit: h('h2#inv-hoy-tit'), rejilla: h('div.inv-hoy-rejilla'), extras: h('div.inv-hoy-extras'), valor: h('div.inv-valor-caja') };
        poner(cuerpo,
          h('section.inv-hoy', { 'aria-labelledby': 'inv-hoy-tit' },
            h('div.inv-hoy-cab', h('div', h('span.hoy-et', 'Hoy'), partes.hoyTit),
              h('p.tenue', 'La bodega central y los locales son de las dos empresas: Soda La Bomba y Pollos La Bomba ven lo mismo.')),
            partes.rejilla, partes.extras),
          h('section.inv-secciones', { 'aria-labelledby': 'inv-sec-tit' }, h('h2#inv-sec-tit', '¿Qué quiere hacer?'), menu),
          partes.valor);
      }
      partes.hoyTit.textContent = diaLargo(ctx.hoy);
      poner(partes.rejilla, lista);
      poner(partes.extras, extras); partes.extras.hidden = !extras.length;
      poner(partes.valor, valor(v));
    }

    // Valor del inventario: total, por ubicación y por empresa de origen. Las barras son de línea fina y proporcionales al valor.
    function valor(v) {
      const total = Number(v?.total || 0);
      const barras = (filas, nombre, chip) => {
        const max = Math.max(1, ...filas.map((f) => Number(f.valor) || 0));
        return h('ul.inv-barras', filas.map((f) => h('li',
          h('span.inv-barra-nom', chip ? chip(f) : f[nombre]),
          h('span.inv-barra-pista', { 'aria-hidden': 'true' }, h('i', { style: `width:${Math.max(0.5, (Number(f.valor) || 0) / max * 100)}%` })),
          h('strong.inv-barra-val.cifra', money(f.valor)))));
      };
      const porUbic = (v?.por_ubicacion || []), porEmp = (v?.por_empresa || []);
      return h('section.inv-valor', { 'aria-labelledby': 'inv-val-tit' },
        h('div.inv-valor-cab', h('h2#inv-val-tit', 'Valor del inventario'), h('p.tenue', 'Al costo de compra, sin IVA (cifras netas de IVA), en colones. Incluye todo lo que hay hoy en bodega y locales.')),
        h('div.inv-valor-total', h('span', 'Total'), h('strong.cifra', money(total)), h('small.tenue', plural(v?.cantidad_lotes || 0, 'lote con existencia', 'lotes con existencia'))),
        h('div.inv-valor-rejilla',
          h('div', h('h3', 'Por bodega o local'), porUbic.length ? barras(porUbic, 'ubicacion') : h('p.tenue', 'Todavía no hay existencias.')),
          h('div', h('h3', 'Por empresa de origen'), h('p.tenue.inv-chico', 'La empresa a cuyo nombre vino la factura de esa mercadería.'),
            porEmp.length ? barras(porEmp, 'sociedad_nombre', (f) => empresaChip(f.sociedad_nombre, (ctx.cat?.empresas || []).find((e) => e.id === f.sociedad_id)?.codigo)) : h('p.tenue', 'Todavía no hay existencias.')),
          h('div', h('h3', 'Por rubro contable'), (v?.por_categoria || []).length ? barras((v.por_categoria || []).slice().sort((a, b) => Number(b.valor) - Number(a.valor)), 'categoria') : h('p.tenue', 'Todavía no hay existencias.')),
          h('div', h('h3', 'Por bolsa de venta'), h('p.tenue.inv-chico', 'Solo agrupa los rubros para descontar por ventas.'),
            (v?.por_grupo || []).length ? barras((v.por_grupo || []).map((g) => ({ valor: g.valor, nombre: GRUPOS[g.grupo] || 'Sin bolsa' })), 'nombre') : h('p.tenue', 'Todavía no hay existencias.'))),
        porCabys(v));
    }

    // Vista para la contadora: los mismos artículos agrupados por los niveles del CABYS (2, 3 o 5 dígitos). No se edita: el rubro de arriba manda.
    const NIVELES = [{ n: 2, t: 'División' }, { n: 3, t: 'Grupo' }, { n: 5, t: 'Clase' }];
    function porCabys(v) {
      const arts = (v?.por_articulo || []);
      const caja = h('div.inv-cabys-caja');
      let nivel = 2;
      const pintarNivel = () => {
        const m = new Map();
        arts.forEach((a) => {
          const c = String(a.cabys || '').replace(/\D/g, '');
          const k = c.length >= nivel ? c.slice(0, nivel) : 'sin';
          const g = m.get(k) || { k, valor: 0, arts: [] };
          g.valor += Number(a.valor) || 0; g.arts.push(a); m.set(k, g);
        });
        const filas = [...m.values()].sort((a, b) => (a.k === 'sin') - (b.k === 'sin') || a.k.localeCompare(b.k));
        poner(caja, filas.length ? h('div.inv-cabys-lista', filas.map((g) => h('details.inv-cabys-fila',
          h('summary', h('strong', g.k === 'sin' ? 'Sin CABYS' : g.k), h('span.tenue', ' ' + plural(g.arts.length, 'artículo', 'artículos')), h('strong.cifra', money(g.valor))),
          h('ul.inv-datos-lista.compacta', g.arts.map((a) => h('li', h('span', a.articulo + (a.cabys ? ' · ' + a.cabys : '') + (a.cabys_descripcion ? ' · ' + a.cabys_descripcion : '')), h('strong.cifra', money(a.valor)))))))) : h('p.tenue', 'Todavía no hay existencias.'));
      };
      const botones = h('div.inv-seg-grupo', { role: 'group', 'aria-label': 'Nivel del CABYS' }, NIVELES.map((x) => h('button.btn.inv-seg', { type: 'button', 'aria-pressed': String(x.n === nivel),
        onclick: (e) => { nivel = x.n; botones.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); pintarNivel(); } }, x.t + ' (' + x.n + ' dígitos)')));
      pintarNivel();
      return h('div.inv-cabys', h('h3', 'Por CABYS'), h('p.tenue.inv-chico', 'Los mismos artículos agrupados por los niveles del CABYS, para cuadrar con el IVA. Si un proveedor puso mal el código, el rubro de arriba es el que vale.'), botones, caja);
    }

    // Después de cualquier cambio (recibir, sacar, contar) lo de hoy se vuelve a pedir, sin mover el foco
    let tCambio = null;
    const alCambiar = () => { clearTimeout(tCambio); tCambio = setTimeout(() => { if (vivo) cargarHoy(); }, 400); };
    document.addEventListener('inv:cambio', alCambiar);
    await cargarHoy();
    // Lo que pidió otra pantalla (por ejemplo { seccion: 'factura', clave } desde Contable) se abre aunque lo de hoy no haya cargado
    if (pedido?.seccion && vivo) { const p = pedido; pedido = null; abrirSeccion(p.seccion, p); }
    return () => { vivo = false; seq++; clearTimeout(tCambio); document.removeEventListener('inv:cambio', alCambiar); };
  },
};
