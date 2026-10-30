// Catálogo de Inventarios (solo administradores; la base lo vuelve a revisar con fx_es_admin): artículos con sus mínimos, categorías con su vigencia en días,
// ubicaciones, reglas CABYS, la memoria de equivalencias, correcciones y ajustes, y la configuración.
import { h, money, num, fechaHora, debounce, campoBusqueda } from './util.js';
import { inv, cant } from './api_inventarios.js';
import { ventana, dialogo, cargando, falla, vacio, aviso, cantTxt, unidadTxt, plural, empresaChip, accionSegura, botonSeguro, repetidaTxt, enfocar, toastOk, elegirArticulo, opcionDeArticulo, poner, dma, numFactura, proveedorTxt, chipEmpresaId } from './m_inv_comun.js';

const SUB = [
  { id: 'articulos', titulo: 'Artículos', desc: 'Lo que se guarda en bodega: unidad, CABYS, vencimiento y mínimos' },
  { id: 'categorias', titulo: 'Categorías', desc: 'Grupos de artículos, adónde entran y cuántos días duran' },
  { id: 'ubicaciones', titulo: 'Ubicaciones', desc: 'La bodega central, los locales y otros lugares' },
  { id: 'cabys', titulo: 'Reglas CABYS', desc: 'Qué categoría sugerir según el código CABYS de la factura' },
  { id: 'memoria', titulo: 'Memoria de equivalencias', desc: 'Lo que el sistema recuerda de cada proveedor al recibir' },
  { id: 'ajustes', titulo: 'Correcciones y ajustes', desc: 'Corregir existencias, entrada manual, líneas «No es de inventario» y abrir una factura por su clave' },
  { id: 'config', titulo: 'Configuración', desc: 'Desde qué fecha entran las facturas y con cuántos días se avisa' },
];

export async function abrir(ctx) {
  if (!ctx.esAdmin) return;
  const v = ventana({ titulo: 'Catálogo', contenido: [
    h('div.inv-ventana-cab', h('p', 'Datos maestros del inventario. Solo los administradores pueden cambiarlos; cada cambio queda en la bitácora.')),
    h('div.inv-menu', SUB.map((s) => h('button.inv-sec', { type: 'button', 'data-sub': s.id, onclick: () => abrirSub(ctx, s.id) }, h('span.inv-sec-tit', s.titulo), h('span.inv-sec-desc', s.desc))))] });
  enfocar(v.cuerpo);
}
function abrirSub(ctx, id) {
  ({ articulos: verArticulos, categorias: verCategorias, ubicaciones: verUbicaciones, cabys: verCabys, memoria: verMemoria, ajustes: verAjustes, config: verConfig })[id]?.(ctx);
}
// Un formulario de administrador: el botón guarda con su clave de repetición y al terminar cierra y avisa
// alCerrar(guardado): se llama al cerrar la ventana, con lo que devolvió la base si se guardó (o null si se canceló)
function formAdmin({ titulo, ancho = 640, partes, boton = 'Guardar', hacer, alGuardar, alCerrar }) {
  const zona = h('div');
  const ok = h('button.btn.primario', { type: 'button' }, boton);
  let res = null;
  const acc = accionSegura({ boton: ok, zona, ocupado: 'Guardando…', hacer, alTerminar: async (r, info) => { res = r; d.cerrar(); await alGuardar?.(r, info); } });
  ok.addEventListener('click', () => acc.ejecutar());
  const d = dialogo({ titulo, ancho, contenido: [h('div.inv-form', partes), zona], botones: [{ texto: 'Cancelar', onclick: (c) => c() }], alCerrar: () => alCerrar?.(res) });
  d.el.querySelector('.modal-pie').append(ok);
  return d;
}
const texto = (valor = '', o = {}) => h('input.campo', { type: 'text', value: valor ?? '', autocomplete: 'off', ...o });
const casilla = (checked, t) => { const i = h('input', { type: 'checkbox', checked: !!checked }); return { i, el: h('label.inv-casilla', i, h('span', t)) }; };
const enteroONulo = (s, nombre, min = 0, max = 100000) => { const t = String(s ?? '').trim(); if (!t) return null; if (!/^\d+$/.test(t) || Number(t) < min || Number(t) > max) throw new Error(nombre + ': escriba un número entero de ' + min + ' a ' + num(max, 0) + ', o déjelo vacío.'); return Number(t); };
const nombreValido = (s) => { const t = String(s ?? '').trim().replace(/\s+/g, ' '); if (t.length < 2 || t.length > 120) throw new Error('El nombre tiene que tener de 2 a 120 letras.'); return t; };
const selCategoria = (ctx, valor, conVacia = true) => h('select.campo', { 'aria-label': 'Categoría' }, conVacia ? h('option', { value: '' }, 'Escoja la categoría') : null,
  (ctx.cat.categorias || []).filter((c) => c.activo !== false || c.id === valor).map((c) => h('option', { value: c.id, selected: c.id === valor }, c.nombre + (c.activo === false ? ' (desactivada)' : ''))));
const selUnidad = (ctx, valor) => h('select.campo', { 'aria-label': 'Unidad' }, (ctx.cat.unidades || []).map((u) => h('option', { value: u.codigo, selected: u.codigo === valor }, u.nombre + ' (' + u.codigo + ')')));
const recargar = async (ctx) => { try { await ctx.recargarCatalogos(); } catch { /* se queda el anterior */ } ctx.articulos.olvidar(); };

/* ---------- Artículos ---------- */
// Formulario de un artículo (nuevo o existente). pre: valores para un artículo nuevo (desde «Por recibir»). Devuelve el artículo guardado o null.
export function formArticulo(ctx, art, pre = {}) {
  return new Promise((ok) => {
    const a = art || {};
    const nombre = texto(a.nombre ?? pre.nombre ?? '', { maxlength: 120, 'aria-label': 'Nombre del artículo' });
    const categ = selCategoria(ctx, a.categoria_id ?? pre.categoria_id ?? '');
    const unidad = selUnidad(ctx, a.unidad ?? pre.unidad ?? 'unidad');
    const cabys = texto(a.cabys ?? pre.cabys ?? '', { inputmode: 'numeric', maxlength: 13, 'aria-label': 'CABYS (13 números, opcional)' });
    cabys.addEventListener('input', () => { const v = cabys.value.replace(/\D/g, '').slice(0, 13); if (v !== cabys.value) cabys.value = v; });
    const vig = texto(a.vigencia_dias ?? '', { inputmode: 'numeric', maxlength: 5, 'aria-label': 'Días que dura' });
    const vigAyuda = h('small');
    const noVence = casilla(a.no_vence, 'No vence nunca (aunque su categoría sí venza)');
    const activo = casilla(a.activo !== false, 'Activo (se puede recibir y escoger)');
    const obs = h('textarea.campo', { rows: 2, maxlength: 300, 'aria-label': 'Observación (opcional)' }, a.observacion || '');
    const minimos = (ctx.cat.ubicaciones || []).filter((u) => u.activo !== false).map((u) => {
      const actual = (a.minimos || []).find((m) => m.ubicacion_id === u.id)?.minimo;
      const i = texto(actual != null && Number(actual) > 0 ? String(actual).replace('.', ',') : '', { inputmode: 'decimal', 'aria-label': 'Mínimo en ' + u.nombre, placeholder: 'Sin mínimo' });
      return { u, i, el: h('label.etq', u.nombre, i) };
    });
    const pintarVig = () => { const c = (ctx.cat.categorias || []).find((x) => x.id === categ.value); vigAyuda.textContent = 'Vacío = lo que diga la categoría' + (c ? ' («' + c.nombre + '»: ' + (c.vigencia_dias == null ? 'no vence' : c.vigencia_dias === 0 ? 'vence el mismo día' : plural(c.vigencia_dias, 'día', 'días')) + ')' : '') + '.'; };
    categ.addEventListener('change', () => { pintarVig(); if (!art) { const c = (ctx.cat.categorias || []).find((x) => x.id === categ.value); if (c?.unidad) unidad.value = c.unidad; } });
    pintarVig();
    formAdmin({ titulo: art ? 'Artículo: ' + a.nombre : 'Artículo nuevo', ancho: 700, alCerrar: (r) => ok(r),
      partes: [h('label.etq', 'Nombre', nombre), h('div.inv-form-fila', h('label.etq', 'Categoría', categ), h('label.etq', 'Se cuenta en', unidad)),
        h('div.inv-form-fila', h('label.etq', 'CABYS (opcional)', cabys, h('small', '13 números. Sirve para sugerirlo solo al recibir.')), h('label.etq', 'Días que dura', vig, vigAyuda)),
        noVence.el, art ? activo.el : null, h('label.etq', 'Observación (opcional)', obs),
        h('h3', 'Mínimos'), h('p.tenue.inv-chico', 'Si la existencia baja de este número, sale el aviso «Bajo el mínimo». Vacío o 0 = sin mínimo.'), h('div.inv-form-fila.tres', minimos.map((m) => m.el))],
      hacer: (idem) => {
        const p = { nombre: nombreValido(nombre.value), categoria_id: categ.value || null, unidad: unidad.value, cabys: cabys.value.trim() || null, vigencia_dias: enteroONulo(vig.value, 'Días que dura', 0, 36500), no_vence: noVence.i.checked, observacion: obs.value.trim() || null };
        if (!p.categoria_id) throw new Error('Escoja la categoría.');
        if (p.cabys && p.cabys.length !== 13) throw new Error('El CABYS tiene 13 números (o déjelo vacío).');
        p.minimos = minimos.map((m) => { const t = m.i.value.trim().replace(',', '.'); if (t && !/^\d+(\.\d{1,3})?$/.test(t)) throw new Error('El mínimo de ' + m.u.nombre + ' no es un número válido.'); return { ubicacion_id: m.u.id, minimo: t ? cant(Number(t)) : '0' }; }).filter((m) => art || Number(m.minimo) > 0);
        if (art) { p.id = a.id; p.activo = activo.i.checked; }
        return inv.articuloGuardar(p, idem);
      },
      alGuardar: async (r, { repetida }) => { toastOk((art ? 'Artículo guardado.' : 'Artículo creado: ' + (r?.nombre || '') + '.') + repetidaTxt(repetida)); await recargar(ctx); } });
  });
}
async function verArticulos(ctx) {
  let vivo = true, seq = 0, q = '', categoria = '', inactivos = false;
  const buscar = h('input.campo', { type: 'search', placeholder: 'Nombre o CABYS', 'aria-label': 'Buscar artículo', autocomplete: 'off' });
  buscar.addEventListener('input', debounce(() => { q = buscar.value.trim(); cargar(); }, 300));
  const categ = h('select.campo', { 'aria-label': 'Categoría', onchange: () => { categoria = categ.value; cargar(); } }, h('option', { value: '' }, 'Todas las categorías'), (ctx.cat.categorias || []).map((c) => h('option', { value: c.id }, c.nombre)));
  const chk = h('input', { type: 'checkbox', onchange: () => { inactivos = chk.checked; cargar(); } });
  const lista = h('div.inv-cat-lista', cargando());
  const nuevo = h('button.btn.primario', { type: 'button', onclick: async () => { if (await formArticulo(ctx, null)) cargar(); } }, 'Agregar artículo');
  const v = ventana({ titulo: 'Artículos', volver: 'Catálogo', contenido: [h('div.inv-ventana-cab', h('p', 'Toque un artículo para cambiarlo. Un artículo no se borra: se desactiva.'), nuevo),
    h('div.inv-filtros.cuatro', h('label.etq.inv-buscar', 'Buscar', campoBusqueda(buscar, () => { q = ''; cargar(); })), h('label.etq', 'Categoría', categ)),
    h('label.inv-casilla', chk, h('span', 'Mostrar también los desactivados')), lista], alCerrar: () => { vivo = false; } });
  async function cargar() {
    const mia = ++seq;
    let d; try { d = await inv.articulos(q, categoria || null, inactivos); } catch (e) { if (vivo && mia === seq) poner(lista, falla(e, cargar)); return; }
    if (!vivo || mia !== seq) return;
    const arts = d.articulos || [];
    poner(lista, ...(arts.length ? arts.map((a) => h('button.inv-cat-fila' + (a.activo === false ? '.apagado' : ''), { type: 'button', onclick: async () => { if (await formArticulo(ctx, a)) cargar(); } },
      h('span.inv-cat-dato', h('strong', a.nombre, a.activo === false ? h('span.chip', 'Desactivado') : null),
        h('small', [a.categoria, 'se cuenta en ' + unidadTxt(a.unidad, 2), a.cabys ? 'CABYS ' + a.cabys : 'sin CABYS', a.no_vence || a.vigencia_efectiva == null ? 'no vence' : 'dura ' + plural(a.vigencia_efectiva, 'día', 'días')].join(' · ')),
        (a.minimos || []).filter((m) => Number(m.minimo) > 0).length ? h('small', 'Mínimos: ' + a.minimos.filter((m) => Number(m.minimo) > 0).map((m) => m.ubicacion + ' ' + cantTxt(m.minimo, a.unidad)).join(', ')) : null),
      h('span.inv-cat-num.cifra', cantTxt(a.existencia, a.unidad), h('small', money(a.valor))), h('span.inv-exis-ver', 'Cambiar'))) : [vacio(q ? 'Ningún artículo coincide.' : 'Todavía no hay artículos. Toque «Agregar artículo».')]),
    d.truncado ? aviso('espera', h('p', 'Se muestran los primeros 1 000. Use el buscador.')) : null);
  }
  await cargar();
  enfocar(v.cuerpo);
}

/* ---------- Categorías ---------- */
async function verCategorias(ctx) {
  const lista = h('div.inv-cat-lista');
  const pintar = () => poner(lista, ...((ctx.cat.categorias || []).length ? ctx.cat.categorias.map((c) => h('button.inv-cat-fila' + (c.activo === false ? '.apagado' : ''), { type: 'button', onclick: () => formCategoria(ctx, c, pintar) },
    h('span.inv-cat-dato', h('strong', c.nombre, c.activo === false ? h('span.chip', 'Desactivada') : null),
      h('small', ['entra a ' + (c.entrada_ubicacion_id ? (ctx.cat.ubicaciones || []).find((u) => u.id === c.entrada_ubicacion_id)?.nombre || 'una ubicación fija' : c.entrada === 'local' ? 'el local de la empresa de la factura' : 'la bodega central'),
        c.vigencia_dias == null ? 'no vence' : c.vigencia_dias === 0 ? 'vence el mismo día' : 'dura ' + plural(c.vigencia_dias, 'día', 'días'),
        c.vigencia_dias != null ? (c.salida_automatica ? 'al vencer sale sola' : 'al vencer solo avisa') : '', plural(c.articulos || 0, 'artículo', 'artículos')].filter(Boolean).join(' · '))),
    h('span.inv-exis-ver', 'Cambiar'))) : [vacio('Todavía no hay categorías.')]));
  const nuevo = h('button.btn.primario', { type: 'button', onclick: () => formCategoria(ctx, null, pintar) }, 'Agregar categoría');
  const v = ventana({ titulo: 'Categorías', volver: 'Catálogo', contenido: [h('div.inv-ventana-cab', h('p', 'La vigencia son los días completos que se puede usar, contando el día en que entra: con 7, lo que entra un lunes se usa hasta el domingo y el lunes siguiente sale solo. «Sale sola» lo saca del inventario cada mañana a las 5:30, como consumo.'), nuevo), lista] });
  pintar(); enfocar(v.cuerpo);
}
function formCategoria(ctx, c, alGuardar) {
  const x = c || {};
  const nombre = texto(x.nombre, { maxlength: 120, 'aria-label': 'Nombre' });
  const entrada = h('select.campo', { 'aria-label': 'Adónde entra' }, h('option', { value: 'bodega', selected: x.entrada !== 'local' }, 'A la bodega central'), h('option', { value: 'local', selected: x.entrada === 'local' }, 'Directo al local de la empresa de la factura'));
  const fija = h('select.campo', { 'aria-label': 'Ubicación fija (opcional)' }, h('option', { value: '' }, 'Ninguna: según lo de arriba'), (ctx.cat.ubicaciones || []).filter((u) => u.activo !== false).map((u) => h('option', { value: u.id, selected: u.id === x.entrada_ubicacion_id }, u.nombre)));
  const vig = texto(x.vigencia_dias ?? '', { inputmode: 'numeric', maxlength: 5, 'aria-label': 'Días que dura' });
  const sale = casilla(x.salida_automatica ?? true, 'Al cumplir sus días, sale sola del inventario (si no, solo avisa)');
  const unidad = selUnidad(ctx, x.unidad || 'unidad');
  const orden = texto(x.orden ?? '', { inputmode: 'numeric', maxlength: 4, 'aria-label': 'Orden' });
  const activo = casilla(x.activo !== false, 'Activa');
  const obs = h('textarea.campo', { rows: 2, maxlength: 300, 'aria-label': 'Observación' }, x.observacion || '');
  formAdmin({ titulo: c ? 'Categoría: ' + c.nombre : 'Categoría nueva',
    partes: [h('label.etq', 'Nombre', nombre), h('label.etq', 'Adónde entra al recibir', entrada), h('label.etq', 'Ubicación fija (opcional)', fija),
      h('div.inv-form-fila', h('label.etq', 'Días que dura', vig, h('small', 'Vacío = no vence. 1 = solo el día en que entra. 7 = una semana completa contando ese día.')), h('label.etq', 'Unidad para artículos nuevos', unidad)),
      sale.el, h('div.inv-form-fila', h('label.etq', 'Orden en las listas (opcional)', orden), c ? activo.el : h('span')), h('label.etq', 'Observación (opcional)', obs)],
    hacer: (idem) => {
      const p = { nombre: nombreValido(nombre.value), entrada: entrada.value, entrada_ubicacion_id: fija.value || null, vigencia_dias: enteroONulo(vig.value, 'Días que dura', 0, 36500), salida_automatica: sale.i.checked, unidad: unidad.value, observacion: obs.value.trim() || null };
      const o = enteroONulo(orden.value, 'Orden', 0, 9999); if (o != null) p.orden = o;
      if (c) { p.id = c.id; p.activo = activo.i.checked; }
      return inv.categoriaGuardar(p, idem);
    },
    alGuardar: async (r, { repetida }) => { toastOk('Categoría guardada.' + repetidaTxt(repetida)); await recargar(ctx); alGuardar?.(); } });
}

/* ---------- Ubicaciones ---------- */
async function verUbicaciones(ctx) {
  const lista = h('div.inv-cat-lista');
  const pintar = () => poner(lista, ...(ctx.cat.ubicaciones || []).map((u) => h('button.inv-cat-fila' + (u.activo === false ? '.apagado' : ''), { type: 'button', onclick: () => formUbicacion(ctx, u, pintar) },
    h('span.inv-cat-dato', h('strong', u.nombre, u.predeterminada ? h('span.chip.ok', 'Predeterminada') : null, u.activo === false ? h('span.chip', 'Desactivada') : null),
      h('small', [u.tipo === 'local' ? 'Local' : 'Bodega', u.codigo, u.observacion].filter(Boolean).join(' · ')),
      u.tipo === 'local' ? h('small', 'Empresa: ', empresaChip(u.sociedad_nombre, (ctx.cat.empresas || []).find((e) => e.id === u.sociedad_id)?.codigo)) : null),
    h('span.inv-exis-ver', 'Cambiar'))));
  const nuevo = h('button.btn.primario', { type: 'button', onclick: () => formUbicacion(ctx, null, pintar) }, 'Agregar ubicación');
  const v = ventana({ titulo: 'Ubicaciones', volver: 'Catálogo', contenido: [h('div.inv-ventana-cab', h('p', 'Una bodega es de las dos empresas; un local es de una empresa. No se puede desactivar una ubicación que todavía tiene existencias.'), nuevo), lista] });
  pintar(); enfocar(v.cuerpo);
}
function formUbicacion(ctx, u, alGuardar) {
  const x = u || {};
  const codigo = texto(x.codigo, { maxlength: 30, 'aria-label': 'Código', autocapitalize: 'characters' });
  codigo.addEventListener('input', () => { const t = codigo.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 30); if (t !== codigo.value) codigo.value = t; });
  const nombre = texto(x.nombre, { maxlength: 120, 'aria-label': 'Nombre' });
  const tipo = h('select.campo', { 'aria-label': 'Tipo' }, h('option', { value: 'bodega', selected: x.tipo !== 'local' }, 'Bodega (de las dos empresas)'), h('option', { value: 'local', selected: x.tipo === 'local' }, 'Local (de una empresa)'));
  const emp = h('select.campo', { 'aria-label': 'Empresa del local' }, h('option', { value: '' }, 'Escoja la empresa'), (ctx.cat.empresas || []).map((e) => h('option', { value: e.id, selected: e.id === x.sociedad_id }, e.nombre)));
  const empCaja = h('label.etq', 'Empresa del local', emp);
  const pintarTipo = () => { empCaja.hidden = tipo.value !== 'local'; };
  tipo.addEventListener('change', pintarTipo); pintarTipo();
  const pred = casilla(x.predeterminada, 'Predeterminada (adonde entra lo que no tiene otra regla)');
  const orden = texto(x.orden ?? '', { inputmode: 'numeric', maxlength: 4, 'aria-label': 'Orden' });
  const activo = casilla(x.activo !== false, 'Activa');
  const obs = h('textarea.campo', { rows: 2, maxlength: 300, 'aria-label': 'Observación' }, x.observacion || '');
  formAdmin({ titulo: u ? 'Ubicación: ' + u.nombre : 'Ubicación nueva',
    partes: [h('div.inv-form-fila', h('label.etq', 'Código', codigo, h('small', 'Letras mayúsculas, números y _, por ejemplo CUARTO_FRIO.')), h('label.etq', 'Nombre', nombre)),
      h('div.inv-form-fila', h('label.etq', 'Tipo', tipo), empCaja), pred.el, h('div.inv-form-fila', h('label.etq', 'Orden (opcional)', orden), u ? activo.el : h('span')), h('label.etq', 'Observación (opcional)', obs)],
    hacer: (idem) => {
      if (!/^[A-Z0-9_]{2,30}$/.test(codigo.value)) throw new Error('El código tiene que tener de 2 a 30 letras mayúsculas, números o _.');
      if (tipo.value === 'local' && !emp.value) throw new Error('Escoja la empresa del local.');
      const p = { codigo: codigo.value, nombre: nombreValido(nombre.value), tipo: tipo.value, sociedad_id: tipo.value === 'local' ? emp.value : null, predeterminada: pred.i.checked, observacion: obs.value.trim() || null };
      const o = enteroONulo(orden.value, 'Orden', 0, 9999); if (o != null) p.orden = o;
      if (u) { p.id = u.id; p.activo = activo.i.checked; }
      return inv.ubicacionGuardar(p, idem);
    },
    alGuardar: async (r, { repetida }) => { toastOk('Ubicación guardada.' + repetidaTxt(repetida)); await recargar(ctx); alGuardar?.(); } });
}

/* ---------- Reglas CABYS ---------- */
async function verCabys(ctx) {
  const lista = h('div.inv-cat-lista', cargando());
  let vivo = true;
  async function cargar() {
    let d; try { d = await inv.cabysReglas(); } catch (e) { if (vivo) poner(lista, falla(e, cargar)); return; }
    if (!vivo) return;
    const filas = d.filas || [];
    poner(lista, ...(filas.length ? filas.map((r) => h('button.inv-cat-fila' + (r.activo === false ? '.apagado' : ''), { type: 'button', onclick: () => formCabys(ctx, r, cargar) },
      h('span.inv-cat-dato', h('strong', 'CABYS que empieza con ' + r.prefijo, r.activo === false ? h('span.chip', 'Desactivada') : null), h('small', (r.no_inventario ? 'No es de inventario' : 'Categoría: ' + (r.categoria || 'sin dato')) + (r.nota ? ' · ' + r.nota : ''))),
      h('span.inv-exis-ver', 'Cambiar'))) : [vacio('Todavía no hay reglas CABYS.')]));
  }
  const nuevo = h('button.btn.primario', { type: 'button', onclick: () => formCabys(ctx, null, cargar) }, 'Agregar regla');
  const v = ventana({ titulo: 'Reglas CABYS', volver: 'Catálogo', contenido: [h('div.inv-ventana-cab', h('p', 'Al recibir una línea sin artículo, el sistema sugiere la categoría según el comienzo de su CABYS. Gana la regla más larga. Solo es una sugerencia: la persona siempre confirma.'), nuevo), lista], alCerrar: () => { vivo = false; } });
  await cargar(); enfocar(v.cuerpo);
}
function formCabys(ctx, r, alGuardar) {
  const x = r || {};
  const prefijo = texto(x.prefijo, { inputmode: 'numeric', maxlength: 13, 'aria-label': 'El CABYS empieza con', disabled: !!r });
  prefijo.addEventListener('input', () => { const t = prefijo.value.replace(/\D/g, '').slice(0, 13); if (t !== prefijo.value) prefijo.value = t; });
  const destino = h('select.campo', { 'aria-label': 'Qué sugerir' }, h('option', { value: '' }, 'Escoja qué sugerir'), h('option', { value: '__no', selected: !!x.no_inventario }, 'No es de inventario'),
    (ctx.cat.categorias || []).filter((c) => c.activo !== false).map((c) => h('option', { value: c.id, selected: c.id === x.categoria_id }, 'Categoría: ' + c.nombre)));
  const nota = texto(x.nota, { maxlength: 300, 'aria-label': 'Nota' });
  const activo = casilla(x.activo !== false, 'Activa');
  formAdmin({ titulo: r ? 'Regla CABYS ' + r.prefijo : 'Regla CABYS nueva',
    partes: [h('label.etq', 'El CABYS empieza con', prefijo, h('small', 'De 1 a 13 números.')), h('label.etq', 'Qué sugerir', destino), h('label.etq', 'Nota (opcional)', nota), activo.el],
    hacer: () => {
      if (!/^\d{1,13}$/.test(prefijo.value)) throw new Error('Escriba de 1 a 13 números.');
      if (!destino.value) throw new Error('Escoja qué sugerir.');
      return inv.cabysReglaGuardar({ prefijo: prefijo.value, ...(destino.value === '__no' ? { no_inventario: true, categoria_id: null } : { categoria_id: destino.value, no_inventario: false }), nota: nota.value.trim() || null, activo: activo.i.checked });
    },
    alGuardar: () => { toastOk('Regla guardada.'); alGuardar?.(); } });
}

/* ---------- Memoria de equivalencias ---------- */
async function verMemoria(ctx) {
  let vivo = true, seq = 0, q = '';
  const buscar = h('input.campo', { type: 'search', placeholder: 'Proveedor, CABYS, descripción o artículo', 'aria-label': 'Buscar en la memoria', autocomplete: 'off' });
  buscar.addEventListener('input', debounce(() => { q = buscar.value.trim(); cargar(); }, 300));
  const lista = h('div.inv-cat-lista', cargando());
  async function cargar() {
    const mia = ++seq;
    let d; try { d = await inv.equivalencias(q, 200); } catch (e) { if (vivo && mia === seq) poner(lista, falla(e, cargar)); return; }
    if (!vivo || mia !== seq) return;
    const filas = d.filas || [];
    poner(lista, ...(filas.length ? filas.map((r) => h('button.inv-cat-fila' + (r.activo === false ? '.apagado' : ''), { type: 'button', onclick: () => formMemoria(ctx, r, cargar) },
      h('span.inv-cat-dato', h('strong', r.descripcion_norm, r.activo === false ? h('span.chip', 'Desactivada') : null),
        h('small', (r.proveedor_nombre ? r.proveedor_nombre + ' · ' : '') + 'cédula ' + r.proveedor_cedula + (r.cabys ? ' · CABYS ' + r.cabys : '')),
        h('small', r.ignorar ? 'Se sugiere «No es de inventario»' + (r.motivo ? ' (' + r.motivo + ')' : '') : '→ ' + (r.articulo || 'sin artículo') + (r.factor != null ? ', cada una trae ' + num(r.factor, 6) : '')),
        h('small', 'Usada ' + plural(r.veces || 0, 'vez', 'veces') + (r.ultimo_uso ? ', la última ' + fechaHora(r.ultimo_uso) : ''))),
      h('span.inv-exis-ver', 'Cambiar'))) : [vacio(q ? 'Nada coincide.' : 'La memoria se llena sola al recibir facturas.')]));
  }
  const v = ventana({ titulo: 'Memoria de equivalencias', volver: 'Catálogo', contenido: [h('div.inv-ventana-cab', h('p', 'Lo que el sistema recuerda de cada proveedor: qué artículo es y cuántas trae cada unidad de la factura. Se corrige aquí si se recordó mal.')),
    h('label.etq.inv-buscar', 'Buscar', campoBusqueda(buscar, () => { q = ''; cargar(); })), lista], alCerrar: () => { vivo = false; } });
  await cargar(); enfocar(v.cuerpo);
}
function formMemoria(ctx, r, alGuardar) {
  let art = r.articulo_id ? { id: r.articulo_id, nombre: r.articulo } : null;
  const btnArt = h('button.btn', { type: 'button', onclick: async () => { const o = await elegirArticulo({ titulo: 'Artículo', opciones: (await ctx.articulos.lista()).filter((a) => a.activo !== false).map(opcionDeArticulo), sugerido: art?.id }); if (o) { art = { id: o.id, nombre: o.nombre }; btnArt.textContent = o.nombre; } } }, art ? art.nombre : 'Escoger artículo');
  const factor = texto(r.factor != null ? String(r.factor).replace('.', ',') : '', { inputmode: 'decimal', 'aria-label': 'Cuántas trae cada unidad de la factura' });
  const ignorar = casilla(r.ignorar, 'Sugerir «No es de inventario»');
  const motivo = texto(r.motivo, { maxlength: 200, 'aria-label': 'Motivo' });
  const activo = casilla(r.activo !== false, 'Activa (se usa para sugerir)');
  formAdmin({ titulo: 'Memoria: ' + r.descripcion_norm,
    partes: [h('p.tenue', 'Proveedor ' + (r.proveedor_nombre || r.proveedor_cedula) + (r.cabys ? ' · CABYS ' + r.cabys : '')), h('div.etq', h('span', 'Artículo'), btnArt),
      h('label.etq', 'Cuántas trae cada unidad de la factura', factor), ignorar.el, h('label.etq', 'Motivo (opcional)', motivo), activo.el],
    hacer: () => {
      const p = { id: r.id, ignorar: ignorar.i.checked, activo: activo.i.checked, motivo: motivo.value.trim() || null };
      if (art) p.articulo_id = art.id;
      const t = factor.value.trim().replace(',', '.');
      if (t) { if (!/^\d*(\.\d{1,6})?$/.test(t) || !(Number(t) > 0)) throw new Error('Escriba la conversión como un número mayor que cero.'); p.factor = t; }
      return inv.equivalenciaGuardar(p);
    },
    alGuardar: () => { toastOk('Memoria corregida.'); alGuardar?.(); } });
}

/* ---------- Correcciones y ajustes ---------- */
// Las líneas marcadas «No es de inventario», por la fecha en que se marcaron (fx_inv_ignoradas, contrato 5.6 bis). Sirve para encontrar una línea que alguien marcó por error
// sin saber de qué factura venía, y devolverla a «Por recibir». Si la factura está rechazada en Contable no se ofrece devolverla: igual no se podría recibir.
const ymdMas = (ymd, n) => { const d = new Date(String(ymd) + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
function seccionIgnoradas(ctx) {
  const hoy = ctx.cat.hoy || new Date().toISOString().slice(0, 10);
  let seq = 0, q = '';
  const desde = h('input.campo', { type: 'date', value: ymdMas(hoy, -30), max: hoy, 'aria-label': 'Marcadas desde' });
  const hasta = h('input.campo', { type: 'date', value: hoy, max: hoy, 'aria-label': 'Marcadas hasta' });
  const buscar = h('input.campo', { type: 'search', placeholder: 'Proveedor, factura, descripción o motivo', 'aria-label': 'Buscar entre las líneas marcadas', autocomplete: 'off' });
  const lista = h('div.inv-lista-ign', { 'aria-live': 'polite' });
  async function cargar() {
    const mia = ++seq;
    if (!desde.value || !hasta.value || desde.value > hasta.value) { poner(lista, aviso('espera', h('p', 'Revise las fechas: la fecha final no puede ser anterior a la inicial.'))); return; }
    poner(lista, cargando());
    let d; try { d = await inv.ignoradas(desde.value, hasta.value, q, 200); } catch (e) { if (mia === seq) poner(lista, falla(e, cargar)); return; }
    if (mia !== seq) return;
    const filas = d.lineas || [];
    poner(lista,
      filas.length ? h('p.tenue.inv-chico', plural(d.n, 'línea marcada', 'líneas marcadas') + ' en ' + plural(d.facturas, 'factura', 'facturas') + '.' + (d.truncado ? ' Se muestran las primeras ' + filas.length + ': acorte las fechas o busque por proveedor.' : '')) : null,
      ...(filas.length ? filas.map(fila) : [vacio(q ? 'Ninguna línea marcada coincide con esa búsqueda.' : 'No hay líneas marcadas «No es de inventario» en esas fechas.')]));
  }
  function fila(r) {
    const zona = h('div');
    const rechazada = r.puede_recibir === false;
    const pie = [];
    if (!rechazada) {
      const { boton } = botonSeguro('Volver a «Por recibir»', '', { zona, ocupado: 'Devolviendo…',
        hacer: (idem) => inv.deshacerIgnorar(r.clave, [r.linea], idem),
        alTerminar: (res, { repetida }) => { toastOk('La línea volvió a «Por recibir».' + repetidaTxt(repetida)); return cargar(); } });
      pie.push(boton);
    }
    pie.push(h('button.btn', { type: 'button', onclick: async () => (await import('./m_inv_recibir.js')).abrirFactura(ctx, r.clave) }, 'Abrir la factura'));
    return h('article.inv-linea.decidida.ignorada', { 'data-clave': r.clave, 'data-linea': r.linea },
      h('div.inv-linea-cab', h('div.inv-linea-desc', h('strong', r.descripcion || 'Línea ' + r.linea), chipEmpresaId(ctx.cat, r.sociedad_id, r.sociedad_nombre))),
      h('p.inv-linea-res', proveedorTxt(r.proveedor_nombre) + ' · factura N.° ' + numFactura(r.consecutivo) + ', línea ' + r.linea + ' · ' + cantTxt(r.cantidad, r.unidad) + ' · ' + money(r.subtotal_crc) + ' sin IVA'),
      h('p.inv-linea-res', 'Marcada el ' + dma(r.marcada_dia || r.marcada_en) + (r.marcada_por_nombre || r.marcada_por ? ' por ' + (r.marcada_por_nombre || r.marcada_por) : '') + (r.motivo ? ': «' + r.motivo + '»' : '. Sin motivo.')),
      rechazada ? aviso('espera', h('p', 'Esta factura está rechazada en Contable y no se puede recibir al inventario, así que no se devuelve a «Por recibir».')) : null,
      h('div.inv-linea-pie', pie, zona));
  }
  desde.addEventListener('change', cargar); hasta.addEventListener('change', cargar);
  buscar.addEventListener('input', debounce(() => { q = buscar.value.trim(); cargar(); }, 300));
  setTimeout(cargar, 0);
  return h('section.inv-grupo', h('h3', 'Líneas marcadas «No es de inventario»'),
    h('p.tenue.inv-chico', 'Aquí aparecen las líneas que alguien marcó como «No es de inventario» (un flete, un servicio, tornillos). Si una se marcó por error, se devuelve a «Por recibir» y se recibe como cualquier otra.'),
    h('div.inv-form-fila.tres', h('label.etq', 'Marcadas desde', desde), h('label.etq', 'Hasta', hasta), h('label.etq.inv-buscar', 'Buscar', campoBusqueda(buscar, () => { q = ''; buscar.value = ''; cargar(); }))),
    lista);
}
async function verAjustes(ctx) {
  const mover = () => import('./m_inv_mover.js');
  const clave = texto('', { inputmode: 'numeric', maxlength: 50, 'aria-label': 'Clave de la factura (50 números)', placeholder: '50 números' });
  clave.addEventListener('input', () => { const t = clave.value.replace(/\D/g, '').slice(0, 50); if (t !== clave.value) clave.value = t; });
  const err = h('div');
  const v = ventana({ titulo: 'Correcciones y ajustes', volver: 'Catálogo', contenido: [
    h('div.inv-ventana-cab', h('p', 'Correcciones que solo puede hacer un administrador. Todo queda en el historial y en la bitácora.')),
    h('div.inv-acciones-grandes',
      h('button.btn.grande', { type: 'button', onclick: async () => (await mover()).formAjuste(ctx, {}) }, 'Corregir existencias'),
      h('button.btn.grande', { type: 'button', onclick: async () => (await mover()).formEntradaManual(ctx, {}) }, 'Entrada manual')),
    seccionIgnoradas(ctx),
    h('section.inv-grupo', h('h3', 'Abrir una factura por su clave'),
      h('p.tenue.inv-chico', 'Para deshacer una recepción o un «No es de inventario» de una factura que ya no está en «Por recibir». La clave está en Contable, en «Datos técnicos».'),
      h('div.inv-form-fila', h('label.etq', 'Clave de la factura', clave), h('div.etq', h('span', ' '), h('button.btn.primario', { type: 'button', onclick: async () => {
        poner(err, );
        if (clave.value.length !== 50) { poner(err, aviso('mal', h('p', 'La clave tiene 50 números.'))); return; }
        (await import('./m_inv_recibir.js')).abrirFactura(ctx, clave.value);
      } }, 'Abrir la factura'))), err)] });
  enfocar(v.cuerpo);
}

/* ---------- Configuración ---------- */
async function verConfig(ctx) {
  const c = ctx.cat.config || {};
  const desde = h('input.campo', { type: 'date', value: c.recepcion_desde || '', 'aria-label': 'Facturas emitidas desde' });
  const dias = texto(c.dias_aviso ?? 2, { inputmode: 'numeric', maxlength: 2, 'aria-label': 'Días de aviso' });
  const zona = h('div');
  const ok = h('button.btn.primario', { type: 'button' }, 'Guardar la configuración');
  const acc = accionSegura({ boton: ok, zona, ocupado: 'Guardando…',
    hacer: () => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(desde.value)) throw new Error('Escoja la fecha desde la que entran las facturas.');
      const n = enteroONulo(dias.value, 'Días de aviso', 0, 30); if (n == null) throw new Error('Escriba con cuántos días de anticipación se avisa (0 a 30).');
      return inv.configGuardar({ recepcion_desde: desde.value, dias_aviso: n });
    },
    alTerminar: async () => { toastOk('Configuración guardada.'); await recargar(ctx); } });
  ok.addEventListener('click', () => acc.ejecutar());
  const v = ventana({ titulo: 'Configuración', volver: 'Catálogo', contenido: [
    h('div.inv-form',
      h('label.etq', 'Facturas emitidas desde', desde, h('small', 'Solo las facturas emitidas desde este día salen en «Por recibir».')),
      h('label.etq', 'Avisar con cuántos días de anticipación', dias, h('small', 'El aviso «Vencen pronto» incluye hoy y los próximos días que diga aquí (0 a 30).')),
      zona, h('div.inv-barra-btns', ok))] });
  enfocar(v.cuerpo);
}
