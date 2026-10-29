// Productos: catálogo del local en tres niveles como en Prisma.
//   nivel 1 cajón (2 dígitos) > nivel 2 producto (dígitos 3-4) > nivel 3 modificador u opción (dígitos 5-6, con su precio final)
//   Código de 6 dígitos CCPPMM = cajón + producto + modificador; "00" en el tercer par si se vende con un toque (sin opciones).
//   Cada artículo guarda producto_nombre (el nombre del nivel 2) y modificador_nombre (el del nivel 3); Caja los usa para armar la cascada.
// Precio siempre FINAL con IVA incluido. Nunca se borra: se desactiva.
import { h, money, r2, leerNumero, toast, modal, confirmar, conBoton, debounce, descargar, fechaHora, hoyCR } from './util.js';
import { api } from './api.js';
import { apiM } from './api_mantenimiento.js';
import { cargarCss, norm, diaCR, aviso, campo, soloDigitos, casilla } from './ui_mant.js';

const TARIFAS = [13, 4, 2, 1, 0]; // las que el generador de XML sabe enviar
const RESERVADOS = ['15', '16']; // cajones que Soda deja libres
const esProvisional = (p) => /cabys provisional/i.test(p.nota || '');
const sinPrecio = (p) => !p.precio_abierto && Number(p.precio_final) <= 0;
const pad2 = (n) => String(n).padStart(2, '0');
const aEntrada = (n) => String(r2(n)).replace('.', ','); // 1300 -> "1300"; 1300.5 -> "1300,5"
const nomSoc = (s) => s.nombre_comercial || s.nombre;
const plural = (n, a, b) => n + ' ' + (n === 1 ? a : b);

// Ventana con varios botones que devuelve el valor del botón tocado ('volver' si la cierran)
function dialogo({ titulo, contenido, botones, ancho = 600 }) {
  return new Promise((ok) => {
    let hecho = false;
    modal({ titulo, contenido, ancho, alCerrar: () => { if (!hecho) ok('volver'); },
      botones: botones.map((b) => ({ texto: b.texto, clase: b.clase || 'suave', onclick: (c) => { hecho = true; c(); ok(b.valor); } })) });
  });
}

// Nombre del grupo (dígitos 3-4): el del producto con modificador 00 o lo que tengan en común los nombres
function nombreGrupo(prods) {
  const dado = prods.find((p) => p.producto_nombre && String(p.producto_nombre).trim());
  if (dado) return String(dado.producto_nombre).trim();
  const base = prods.find((p) => p.codigo.slice(4) === '00');
  if (base) return base.nombre;
  if (prods.length === 1) return prods[0].nombre;
  const partes = prods.map((p) => p.nombre.trim().split(/\s+/));
  const comun = [];
  for (let i = 0; i < partes[0].length; i++) {
    const w = partes[0][i];
    if (partes.every((x) => x[i] && norm(x[i].replace(/[,:;]+$/, '')) === norm(w.replace(/[,:;]+$/, '')))) comun.push(w); else break;
  }
  const t = comun.join(' ').replace(/[,:;\s]+$/, '');
  return t || (prods[0].nombre + ' y otros ' + (prods.length - 1));
}

/* ---------- CSV ---------- */
const csvCelda = (v) => { const s = String(v ?? ''); return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
function leerCsv(texto) {
  texto = texto.replace(/^﻿/, '');
  const primera = texto.split(/\r?\n/)[0] || '';
  const delim = [';', '\t', ','].map((d) => [d, primera.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const filas = []; let fila = [], cel = '', q = false;
  const cerrarFila = () => { fila.push(cel); cel = ''; if (fila.some((x) => x.trim() !== '')) filas.push(fila); fila = []; };
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (q) { if (ch === '"') { if (texto[i + 1] === '"') { cel += '"'; i++; } else q = false; } else cel += ch; }
    else if (ch === '"') q = true;
    else if (ch === delim) { fila.push(cel); cel = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && texto[i + 1] === '\n') i++; cerrarFila(); }
    else cel += ch;
  }
  if (cel !== '' || fila.length) cerrarFila();
  return filas;
}
const esUnToque = (cod) => String(cod).slice(4) === '00';
const sino = (v) => /^(si|s|1|true|x|yes|verdadero)$/.test(norm(v));

export default {
  id: 'productos',
  titulo: 'Productos',
  async mount(root, app) {
    await cargarCss();
    document.documentElement.style.setProperty('--alto-cab', (document.querySelector('.cabecera')?.offsetHeight || 104) + 'px');
    const soc = app.soc;
    const otros = app.ctx.sociedades.filter((s) => s.id !== soc.id);
    let cat = { cajones: [], productos: [] };
    const otrosCat = new Map(); // id del otro local -> su catálogo
    const cabysEnCat = new Map(); // CABYS que sí están en el catálogo oficial -> {descripcion, tarifa}
    const cabysPreguntados = new Set();
    const S = { q: '', cajon: '', ver: 'activos', sel: new Set() };
    // Una opción (modificador) activa necesita el nombre del producto (nivel 2) y el de la opción (nivel 3) para verse en la cascada de Caja
    const faltaNivel = (p) => p.activo && !esUnToque(p.codigo) && (!String(p.producto_nombre || '').trim() || !String(p.modificador_nombre || '').trim());
    // Una opción (nivel 3) debería llevar su precio final; con precio abierto y ₡0 en el menú, Caja tiene que preguntarlo en cada venta
    const opcionSinPrecio = (p) => p.activo && !esUnToque(p.codigo) && Number(p.precio_final) <= 0;
    const noEnCatalogo = (p) => cabysPreguntados.has(p.cabys) && !cabysEnCat.has(p.cabys);

    /* ---------- Datos ---------- */
    async function verificarCabys() {
      const nuevos = [...new Set(cat.productos.map((p) => p.cabys))].filter((c) => !cabysPreguntados.has(c));
      for (let i = 0; i < nuevos.length; i += 300) {
        const trozo = nuevos.slice(i, i + 300);
        try {
          const r = await apiM.cabysVerificar(trozo);
          r.forEach((x) => cabysEnCat.set(x.codigo, x));
          trozo.forEach((c) => cabysPreguntados.add(c));
        } catch { /* sin verificación no se muestran avisos de CABYS */ }
      }
    }
    async function cargarOtros() {
      for (const o of otros) { try { otrosCat.set(o.id, await api.catalogo(o.id, true)); } catch { /* se vuelve a pedir al comparar */ } }
    }
    let cargandoOtros = null;
    const asegurarOtros = () => (cargandoOtros ||= cargarOtros());
    async function cargar() {
      cat = await api.catalogo(soc.id, true);
      await verificarCabys();
      S.sel = new Set([...S.sel].filter((id) => cat.productos.some((p) => p.id === id)));
      pintar();
      refrescarHoy();
    }

    /* ---------- Comparar precios con el otro local ---------- */
    // items: [{codigo, nombre, precio}]. Devuelve {dec:'volver'|'aqui'|'ambos', diffs}
    async function revisarOtroLocal(items) {
      const diffs = [];
      for (const o of otros) {
        let c;
        try { c = await api.catalogo(o.id, true); otrosCat.set(o.id, c); } catch { continue; }
        const mapa = new Map(c.productos.map((p) => [p.codigo, p]));
        for (const it of items) {
          const x = mapa.get(it.codigo);
          if (x && !x.precio_abierto && it.precio > 0 && Math.abs(Number(x.precio_final) - it.precio) > 0.004) diffs.push({ soc: o, otro: x, codigo: it.codigo, nombre: it.nombre, precio: it.precio });
        }
      }
      if (!diffs.length) return { dec: 'aqui', diffs };
      const o = diffs[0].soc;
      const dec = await dialogo({
        titulo: 'Los precios no quedarían iguales en los dos locales',
        contenido: h('div.col',
          aviso('ambar', 'Los productos que se venden en ' + nomSoc(soc) + ' y en ' + nomSoc(o) + ' deben costar lo mismo. Con este cambio, ' + plural(diffs.length, 'producto quedaría', 'productos quedarían') + ' con precio distinto.'),
          h('div.mt-previa', h('table', h('thead', h('tr', h('th', 'Código'), h('th', 'Producto'), h('th.der', 'Aquí'), h('th.der', nomSoc(o)))),
            h('tbody', diffs.slice(0, 12).map((d) => h('tr', h('td.mt-codigo', d.codigo), h('td', d.nombre), h('td.der', money(d.precio)), h('td.der', money(d.otro.precio_final))))))),
          diffs.length > 12 ? h('small.tenue', 'Y ' + (diffs.length - 12) + ' más.') : null),
        botones: [{ texto: 'Volver sin guardar', valor: 'volver' }, { texto: 'Guardar solo en ' + nomSoc(soc), valor: 'aqui' }, { texto: 'Guardar en los dos locales', valor: 'ambos', clase: 'primario' }],
        ancho: 640,
      });
      return { dec, diffs };
    }
    async function aplicarEnOtros(diffs, motivo) {
      const por = new Map();
      diffs.forEach((d) => { if (!por.has(d.soc.id)) por.set(d.soc.id, []); por.get(d.soc.id).push({ id: d.otro.id, precio: d.precio }); });
      for (const [id, cambios] of por) await apiM.preciosLote(id, cambios, motivo || 'Igualado con ' + nomSoc(soc));
    }

    /* ---------- Códigos sugeridos ---------- */
    const codigosUsados = () => {
      const s = new Set(cat.productos.map((p) => p.codigo));
      otrosCat.forEach((c) => c.productos.forEach((p) => s.add(p.codigo)));
      return s;
    };
    function siguienteProducto(cajonCod) { // XXPP00 con el siguiente PP libre
      const usados = codigosUsados(); let max = 0;
      usados.forEach((c) => { if (c.startsWith(cajonCod)) max = Math.max(max, Number(c.slice(2, 4))); });
      for (let n = max + 1; n <= 99; n++) if (![...usados].some((c) => c.startsWith(cajonCod + pad2(n)))) return cajonCod + pad2(n) + '00';
      for (let n = 1; n <= 99; n++) if (![...usados].some((c) => c.startsWith(cajonCod + pad2(n)))) return cajonCod + pad2(n) + '00';
      return cajonCod + '0100';
    }
    function siguienteModificador(grupo) { // XXPPMM con el siguiente MM libre
      const usados = codigosUsados(); let max = 0;
      usados.forEach((c) => { if (c.startsWith(grupo)) max = Math.max(max, Number(c.slice(4))); });
      for (let n = max + 1; n <= 99; n++) if (!usados.has(grupo + pad2(n))) return grupo + pad2(n);
      for (let n = 1; n <= 99; n++) if (!usados.has(grupo + pad2(n))) return grupo + pad2(n);
      return grupo + '01';
    }
    function siguienteCajon() { // lowest libre en los dos locales, saltando los reservados
      const usados = new Set(cat.cajones.map((c) => c.codigo));
      otrosCat.forEach((c) => c.cajones.forEach((x) => usados.add(x.codigo)));
      for (let n = 1; n <= 99; n++) { const c = pad2(n); if (!usados.has(c) && !RESERVADOS.includes(c)) return c; }
      return '';
    }

    /* ---------- Pantalla ---------- */
    const buscar = h('input.mt-buscar', { type: 'search', placeholder: 'Buscar por nombre, código o CABYS', autocomplete: 'off', 'aria-label': 'Buscar producto' });
    const selCajon = h('select.campo', { 'aria-label': 'Cajón' });
    const selVer = h('select.campo', { 'aria-label': 'Qué productos ver' });
    const lista = h('div');
    const resumen = h('div.mt-resumen');
    const hoyBox = h('div.mt-aviso.info', { style: 'margin-bottom:.9rem' }, 'Revisando los cambios de hoy…');
    const barraTxt = h('strong');
    const barra = h('div.mt-barra-sel', { hidden: true },
      h('div', barraTxt),
      h('div.fila',
        h('button.btn', { type: 'button', onclick: () => { S.sel.clear(); pintarSel(); } }, 'Quitar la selección'),
        h('button.btn.primario', { type: 'button', onclick: () => abrirLote() }, 'Cambiar precios de lo seleccionado')));

    buscar.addEventListener('input', debounce(() => { S.q = buscar.value.trim(); pintar(); }, 200));
    selCajon.addEventListener('change', () => { S.cajon = selCajon.value; pintar(); });
    selVer.addEventListener('change', () => { S.ver = selVer.value; pintar(); });

    async function refrescarHoy() {
      try {
        const hist = await apiM.productoHistorial(soc.id, null, 500);
        const hoy = diaCR(new Date());
        const deHoy = hist.filter((x) => diaCR(x.cambiado_en) === hoy);
        const prods = new Set(deHoy.map((x) => x.producto_id)).size;
        hoyBox.replaceChildren(h('div.fila.sep', h('span', h('strong', 'Hoy: '), deHoy.length ? plural(prods, 'producto cambiado', 'productos cambiados') + ' (' + plural(deHoy.length, 'cambio', 'cambios') + ').' : 'todavía no se ha cambiado ningún producto.'),
          h('button.btn', { type: 'button', onclick: () => mostrarHistorial(null) }, 'Ver quién cambió qué')));
      } catch { hoyBox.replaceChildren(h('div.fila.sep', h('span', 'Los cambios de productos quedan registrados con quién los hizo.'), h('button.btn', { type: 'button', onclick: () => mostrarHistorial(null) }, 'Ver quién cambió qué'))); }
    }

    function pasa(p) {
      if (S.cajon && p.codigo.slice(0, 2) !== S.cajon) return false;
      if (S.ver === 'activos' && !p.activo) return false;
      if (S.ver === 'inactivos' && p.activo) return false;
      if (S.ver === 'confirmar' && !esProvisional(p)) return false;
      if (S.ver === 'nivel' && !faltaNivel(p)) return false;
      if (S.ver === 'opcion0' && !opcionSinPrecio(p)) return false;
      if (S.ver === 'precio' && !(p.precio_abierto || sinPrecio(p))) return false;
      if (S.ver === 'cabys' && !noEnCatalogo(p)) return false;
      if (S.q) {
        const hay = norm(p.nombre + ' ' + p.codigo + ' ' + p.cabys + ' ' + (p.nota || '') + ' ' + (p.producto_nombre || '') + ' ' + (p.modificador_nombre || ''));
        if (!norm(S.q).split(/\s+/).every((w) => hay.includes(w))) return false;
      }
      return true;
    }

    function chkMultiple(ids, aria) {
      const c = casilla((on) => { ids.forEach((id) => (on ? S.sel.add(id) : S.sel.delete(id))); pintarSel(); }, aria);
      c.input.dataset.ids = ids.join(',');
      return c.el;
    }
    function pintarSel() {
      root.querySelectorAll('.mt-chk input').forEach((i) => {
        const ids = (i.dataset.ids || '').split(',').filter(Boolean);
        const n = ids.filter((x) => S.sel.has(x)).length;
        i.checked = ids.length > 0 && n === ids.length;
        i.indeterminate = n > 0 && n < ids.length;
      });
      barra.hidden = S.sel.size === 0;
      barraTxt.textContent = plural(S.sel.size, 'producto seleccionado', 'productos seleccionados');
    }

    function pintar() {
      const t = cat.productos;
      const cuenta = { opcion0: t.filter(opcionSinPrecio).length, nivel: t.filter(faltaNivel).length, activos: t.filter((p) => p.activo).length, todos: t.length, confirmar: t.filter(esProvisional).length, precio: t.filter((p) => p.precio_abierto || sinPrecio(p)).length, cabys: t.filter(noEnCatalogo).length, inactivos: t.filter((p) => !p.activo).length };
      selVer.replaceChildren(...[['activos', 'Productos activos'], ['todos', 'Todos (incluye desactivados)'], ['confirmar', 'Por confirmar CABYS'], ['nivel', 'Sin nombre de producto u opción'], ['opcion0', 'Opciones sin precio fijo (₡0)'], ['precio', 'Precio abierto o sin precio'], ['cabys', 'CABYS fuera del catálogo'], ['inactivos', 'Desactivados']]
        .map(([k, n]) => h('option', { value: k, selected: S.ver === k }, n + ' (' + cuenta[k] + ')')));
      const cajonesOrd = [...cat.cajones].sort((a, b) => (a.orden - b.orden) || a.codigo.localeCompare(b.codigo));
      selCajon.replaceChildren(h('option', { value: '' }, 'Todos los cajones'), ...cajonesOrd.map((c) => h('option', { value: c.codigo, selected: S.cajon === c.codigo }, c.codigo + ' · ' + c.nombre + (c.activo ? '' : ' (desactivado)'))));
      resumen.replaceChildren(...[
        h('span.chip.ok', plural(cuenta.activos, 'producto activo', 'productos activos')),
        cuenta.opcion0 ? h('button.btn.chico.ambar', { type: 'button', onclick: () => { S.ver = 'opcion0'; pintar(); } }, plural(cuenta.opcion0, 'opción sin precio fijo (₡0): pide el precio al vender', 'opciones sin precio fijo (₡0): piden el precio al vender')) : null,
        cuenta.nivel ? h('button.btn.chico.ambar', { type: 'button', onclick: () => { S.ver = 'nivel'; pintar(); } }, plural(cuenta.nivel, 'opción sin nombre de producto u opción', 'opciones sin nombre de producto u opción')) : null,
        cuenta.confirmar ? h('button.btn.chico.ambar', { type: 'button', onclick: () => { S.ver = 'confirmar'; pintar(); } }, plural(cuenta.confirmar, 'producto por confirmar CABYS', 'productos por confirmar CABYS')) : null,
        cuenta.precio ? h('span.chip', plural(cuenta.precio, 'con precio abierto o sin precio', 'con precio abierto o sin precio')) : null,
        cuenta.cabys ? h('span.chip.espera', plural(cuenta.cabys, 'CABYS fuera del catálogo', 'CABYS fuera del catálogo')) : null,
        cuenta.inactivos ? h('span.chip.gris', plural(cuenta.inactivos, 'desactivado', 'desactivados')) : null].filter(Boolean));

      const vis = t.filter(pasa).sort((a, b) => a.codigo.localeCompare(b.codigo));
      const porCajon = new Map();
      vis.forEach((p) => { const k = p.codigo.slice(0, 2); if (!porCajon.has(k)) porCajon.set(k, []); porCajon.get(k).push(p); });
      const conocidos = new Set(cajonesOrd.map((c) => c.codigo));
      const filtrando = !!S.q || !['activos', 'todos'].includes(S.ver);
      const secciones = [];
      const construir = (cj, codigo, prods) => {
        const ids = prods.map((p) => p.id);
        const porGrupo = new Map();
        prods.forEach((p) => { const g = p.codigo.slice(0, 4); if (!porGrupo.has(g)) porGrupo.set(g, []); porGrupo.get(g).push(p); });
        const cuerpo = [];
        for (const [g, ps] of porGrupo) {
          const todos = t.filter((p) => p.codigo.startsWith(g));
          cuerpo.push(h('div.mt-grupo-cab',
            h('div.tit', chkMultiple(ps.map((p) => p.id), 'Seleccionar el grupo ' + g), h('div', h('strong', g + ' · ' + nombreGrupo(todos)), h('div.tenue', { style: 'font-size:.85rem' }, todos.some((x) => !esUnToque(x.codigo)) ? 'Producto con ' + plural(todos.filter((x) => !esUnToque(x.codigo) && x.activo).length, 'opción', 'opciones') : 'Producto que se cobra con un toque'))),
            h('div.mt-btns', h('button.btn', { type: 'button', onclick: () => abrirProducto({ modo: 'modificador', grupo: g }) }, 'Agregar opción a este producto'))));
          ps.forEach((p) => cuerpo.push(fila(p)));
        }
        if (!prods.length) cuerpo.push(h('div.vacio', { style: 'border:0;border-radius:0' }, 'Este cajón todavía no tiene productos.'));
        return h('section.mt-cajon',
          h('header.mt-cajon-cab',
            h('div.fila', { style: 'flex-wrap:nowrap' }, ids.length ? chkMultiple(ids, 'Seleccionar todo el cajón ' + codigo) : null,
              h('div', h('h2', codigo + ' · ' + (cj ? cj.nombre : 'Sin cajón'), cj && !cj.activo ? h('span.chip.gris', { style: 'margin-left:.5rem' }, 'Desactivado') : null),
                h('small.tenue', plural(prods.length, 'producto', 'productos') + (RESERVADOS.includes(codigo) && soc.codigo === 'soda' ? ' · reservado' : '')))),
            h('div.mt-btns',
              cj ? h('button.btn', { type: 'button', onclick: () => abrirCajon(cj) }, 'Editar cajón') : null,
              h('button.btn', { type: 'button', onclick: () => abrirProducto({ modo: 'nuevo', cajon: codigo }) }, 'Agregar producto aquí'))),
          h('div.mt-cajon-cuerpo', cuerpo));
      };
      cajonesOrd.forEach((cj) => {
        if (S.cajon && S.cajon !== cj.codigo) return;
        const prods = porCajon.get(cj.codigo) || [];
        if (!prods.length && (filtrando || (!cj.activo && S.ver === 'activos'))) return;
        secciones.push(construir(cj, cj.codigo, prods));
      });
      porCajon.forEach((prods, codigo) => { if (!conocidos.has(codigo)) secciones.push(construir(null, codigo, prods)); });
      lista.replaceChildren(...(secciones.length ? secciones : [h('div.vacio', S.q ? 'No hay productos con "' + S.q + '" en esta vista.' : 'No hay productos en esta vista.')]));
      pintarSel();
    }

    function fila(p) {
      const sub = [];
      if (!p.activo) sub.push(h('span.chip.gris', 'Desactivado'));
      if (esUnToque(p.codigo)) sub.push(h('span.chip', 'Un toque'));
      else if (faltaNivel(p)) sub.push(h('span.chip.mal', 'Falta el nombre ' + (!String(p.producto_nombre || '').trim() ? 'del producto' : 'de la opción')));
      else if (!String(p.producto_nombre || '').trim() || !String(p.modificador_nombre || '').trim()) sub.push(h('span.chip.gris', 'Sin nombre de producto u opción'));
      else sub.push(h('span.chip', 'Opción «' + String(p.modificador_nombre).trim() + '» de «' + String(p.producto_nombre).trim() + '»'));
      if (p.descripcion_libre) sub.push(h('span.chip', 'Descripción libre'));
      if (esProvisional(p)) sub.push(h('span.chip.espera', 'Confirmar CABYS'));
      if (p.precio_abierto) sub.push(h('span.chip', 'Precio abierto'));
      else if (sinPrecio(p)) sub.push(h('span.chip.mal', 'Falta el precio'));
      if (noEnCatalogo(p)) sub.push(h('span.chip.espera', 'CABYS fuera del catálogo'));
      sub.push(h('span', 'CABYS ' + p.cabys + ' · IVA ' + Number(p.tarifa_iva) + '%'));
      if (p.nota && !esProvisional(p)) sub.push(h('span', '· ' + p.nota));
      let precio;
      if (p.precio_abierto) precio = h('div.precio', h('span.abierto', 'Se pide al vender'));
      else {
        const inp = h('input', { type: 'text', inputmode: 'decimal', value: aEntrada(p.precio_final), 'aria-label': 'Precio final de ' + p.nombre });
        const gb = h('button.btn.primario', { type: 'button', hidden: true, onclick: () => guardarPrecio(p, inp, gb) }, 'Guardar');
        inp.addEventListener('input', () => { const v = leerNumero(inp.value); const cambio = Number.isFinite(v) && Math.abs(v - Number(p.precio_final)) > 0.004; inp.classList.toggle('sucio', cambio); gb.hidden = !cambio; });
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !gb.hidden) guardarPrecio(p, inp, gb); if (e.key === 'Escape') { inp.value = aEntrada(p.precio_final); inp.dispatchEvent(new Event('input')); } });
        precio = h('div.precio', h('span.pref', '₡'), inp, gb);
      }
      return h('div.mt-fila' + (p.activo ? '' : '.apagado'),
        h('div.chkc', chkMultiple([p.id], 'Seleccionar ' + p.nombre)),
        h('div.cod', p.codigo),
        h('div.nom', h('div', h('strong', p.nombre)), h('div.sub', sub)),
        precio,
        h('div.acc',
          h('button.btn', { type: 'button', onclick: () => abrirProducto({ modo: 'editar', p }) }, 'Editar'),
          h('button.btn' + (p.activo ? '.peligro' : ''), { type: 'button', onclick: (e) => alternarActivo(p, e.currentTarget) }, p.activo ? 'Desactivar' : 'Activar')));
    }

    async function guardarPrecio(p, inp, btn) {
      const nuevo = r2(leerNumero(inp.value));
      if (!Number.isFinite(nuevo) || nuevo <= 0) return toast('Escriba un precio mayor que cero. Si el precio cambia cada vez, edite el producto y marque "Precio abierto".', 'error', 6000);
      await conBoton(btn, async () => {
        const rev = await revisarOtroLocal([{ codigo: p.codigo, nombre: p.nombre, precio: nuevo }]);
        if (rev.dec === 'volver') return;
        await apiM.preciosLote(soc.id, [{ id: p.id, precio: nuevo }], 'Precio cambiado en la lista');
        if (rev.dec === 'ambos') await aplicarEnOtros(rev.diffs);
        p.precio_final = nuevo;
        inp.value = aEntrada(nuevo); inp.classList.remove('sucio'); btn.hidden = true;
        toast(p.nombre + ': ' + money(nuevo) + (rev.dec === 'ambos' ? ' (en los dos locales)' : ''));
        refrescarHoy();
        if (S.ver === 'precio') pintar();
      });
    }

    async function alternarActivo(p, btn) {
      const ok = await confirmar(p.activo ? '¿Desactivar "' + p.nombre + '"? Deja de aparecer en Caja. No se borra nada y se puede activar de nuevo.' : '¿Activar "' + p.nombre + '"? Volverá a aparecer en Caja.', { si: p.activo ? 'Sí, desactivar' : 'Sí, activar', peligro: p.activo });
      if (!ok) return;
      await conBoton(btn, async () => { await api.productoGuardar(cuerpoProducto(p, { activo: !p.activo })); toast(p.activo ? 'Producto desactivado.' : 'Producto activado.'); await cargar(); });
    }
    const cuerpoProducto = (p, extra = {}) => ({ sociedad_id: soc.id, cajon_id: p.cajon_id, codigo: p.codigo, nombre: p.nombre, cabys: p.cabys, precio_final: Number(p.precio_final), tarifa_iva: Number(p.tarifa_iva), activo: p.activo, precio_abierto: p.precio_abierto, nota: p.nota || null, producto_nombre: p.producto_nombre || null, modificador_nombre: p.modificador_nombre || null, descripcion_libre: !!p.descripcion_libre, ...extra });

    /* ---------- Formulario de producto ---------- */
    async function abrirProducto({ modo, p, cajon, grupo }) {
      await asegurarOtros();
      const esEd = modo === 'editar';
      const hermanos = modo === 'modificador' ? cat.productos.filter((x) => x.codigo.startsWith(grupo)).sort((a, b) => a.codigo.localeCompare(b.codigo)) : [];
      const hermano = hermanos[hermanos.length - 1];
      const cajonesOrd = [...cat.cajones].sort((a, b) => (a.orden - b.orden) || a.codigo.localeCompare(b.codigo));
      if (!cajonesOrd.length) return toast('Primero cree un cajón con el botón "Agregar cajón".', 'error');
      const cajonInicial = esEd ? p.codigo.slice(0, 2) : modo === 'modificador' ? grupo.slice(0, 2) : (cajon || S.cajon || cajonesOrd.find((c) => c.activo)?.codigo || cajonesOrd[0].codigo);
      const err = h('div.error-caja', { hidden: true, role: 'alert' });
      const mostrar = (m, el) => { err.textContent = m; err.hidden = !m; if (m) { err.scrollIntoView({ block: 'nearest' }); el?.focus(); } };

      const selC = h('select.campo', { 'aria-label': 'Cajón', disabled: esEd || modo === 'modificador' },
        cajonesOrd.map((c) => h('option', { value: c.codigo, selected: c.codigo === cajonInicial }, c.codigo + ' · ' + c.nombre + (c.activo ? '' : ' (desactivado)'))));
      const codigo = soloDigitos(h('input.campo', { type: 'text', inputmode: 'numeric', autocomplete: 'off', readonly: esEd, value: esEd ? p.codigo : modo === 'modificador' ? siguienteModificador(grupo) : siguienteProducto(cajonInicial), 'aria-label': 'Código de 6 dígitos' }), 6);
      const decod = h('small.tenue');
      const nombre = h('textarea.campo', { rows: 2, 'aria-label': 'Nombre' }, esEd ? p.nombre : '');
      const avisoNombre = h('div', { hidden: true });
      // Nombres de los niveles 2 y 3 (producto y opción). Caja arma la cascada con ellos.
      const grupoProds = modo === 'modificador' ? cat.productos.filter((x) => x.codigo.startsWith(grupo)) : [];
      const prodNom = h('input.campo', { type: 'text', maxlength: 80, autocomplete: 'off', placeholder: 'Ej. Hamburguesa', 'aria-label': 'Nombre del producto (nivel 2)',
        value: esEd ? (p.producto_nombre || '') : modo === 'modificador' ? (hermanos.find((x) => x.producto_nombre)?.producto_nombre || nombreGrupo(grupoProds)) : '' });
      const modNom = h('input.campo', { type: 'text', maxlength: 80, autocomplete: 'off', placeholder: 'Ej. Doble', 'aria-label': 'Nombre de la opción (nivel 3)', value: esEd ? (p.modificador_nombre || '') : '' });
      const bloqueNiveles = h('div.col');
      const avisosCodigo = h('div.col', { 'aria-live': 'polite' });
      const libre = h('input', { type: 'checkbox', checked: esEd && !!p.descripcion_libre });
      let nombreAuto = ''; // lo último que se escribió solo en «Nombre o descripción»
      const cabysInp = soloDigitos(h('input.campo', { type: 'text', inputmode: 'numeric', autocomplete: 'off', value: esEd ? p.cabys : hermano?.cabys || '', 'aria-label': 'CABYS de 13 números' }), 13);
      const cabysEstado = h('div');
      const buscarCabys = h('input.campo', { type: 'search', autocomplete: 'off', placeholder: 'Escriba el nombre del producto o el inicio de un código CABYS', 'aria-label': 'Buscar en el catálogo CABYS' });
      const resultados = h('div');
      const tarifa = h('select.campo', { 'aria-label': 'IVA' }, TARIFAS.map((t) => h('option', { value: t, selected: t === (esEd ? Number(p.tarifa_iva) : hermano ? Number(hermano.tarifa_iva) : 13) }, t === 0 ? '0 % (exento)' : t + ' %' + (t === 13 ? ' (tarifa general)' : ''))));
      const avisoIva = h('div', { hidden: true });
      const precio = h('input.campo', { type: 'text', inputmode: 'decimal', autocomplete: 'off', value: esEd && !p.precio_abierto ? aEntrada(p.precio_final) : '', 'aria-label': 'Precio final con IVA incluido' });
      const desglose = h('small.tenue');
      const avisoPrecio = h('div', { hidden: true });
      const abierto = h('input', { type: 'checkbox', checked: esEd && p.precio_abierto });
      const activo = h('input', { type: 'checkbox', checked: esEd ? p.activo : true });
      const nota = h('textarea.campo', { rows: 2, 'aria-label': 'Nota' }, esEd ? p.nota || '' : '');
      const cajaProv = h('div', { hidden: !(esEd && esProvisional(p)) });
      let infoCabys = null;

      const quedaActivo = () => (esEd ? activo.checked : true);
      // Revisa el código CCPPMM contra el menú. errores = no deja guardar; pendientes = falta escribir algo (se pide al guardar)
      const revisarCodigo = () => {
        const c = codigo.value, errores = [], pendientes = [];
        if (c.length !== 6) return { errores, pendientes, completo: false };
        const cj = cat.cajones.find((x) => x.codigo === selC.value);
        const ccpp = c.slice(0, 4), mm = c.slice(4);
        if (cj && c.slice(0, 2) !== cj.codigo) errores.push('El código tiene que empezar con el código del cajón (' + cj.codigo + ').');
        if (!esEd) { const ya = cat.productos.find((x) => x.codigo === c); if (ya) errores.push('Ese código ya lo usa «' + ya.nombre + '». Toque «Sugerir el siguiente código libre».'); }
        const pn = prodNom.value.trim(), mn = modNom.value.trim();
        const demas = cat.productos.filter((x) => x.activo && x.id !== p?.id && x.codigo !== c && x.codigo.startsWith(ccpp));
        if (mm === '00') {
          const conOp = demas.find((x) => !esUnToque(x.codigo));
          if (conOp && quedaActivo()) errores.push('El producto ' + ccpp + ' ya tiene opciones (por ejemplo ' + conOp.codigo + '). Un producto con opciones no se cobra solo: use un código que no termine en 00.');
        } else if (quedaActivo()) {
          const suelto = demas.find((x) => esUnToque(x.codigo));
          if (suelto) errores.push('El producto ' + ccpp + ' ya existe como artículo suelto (' + suelto.codigo + ' «' + suelto.nombre + '»). Un producto con opciones no se cobra solo: desactive ese artículo o use otro número de producto.');
          if (!pn) pendientes.push('Falta el nombre del producto (nivel 2), por ejemplo «Hamburguesa».');
          if (!mn) pendientes.push('Falta el nombre de la opción (nivel 3), por ejemplo «Doble».');
          const rep = mn && demas.find((x) => !esUnToque(x.codigo) && norm(x.modificador_nombre || '') === norm(mn));
          if (rep) errores.push('Ya existe la opción «' + mn + '» en este producto (código ' + rep.codigo + '). Use otro nombre.');
          const otroNombre = pn && demas.find((x) => !esUnToque(x.codigo) && x.producto_nombre && norm(x.producto_nombre) !== norm(pn));
          if (otroNombre) pendientes.push('Las otras opciones de este producto se llaman «' + otroNombre.producto_nombre + '». Si es el mismo producto, escriba el mismo nombre para que se vean juntas en Caja.');
        }
        return { errores, pendientes, completo: true };
      };
      const decodificar = () => {
        const c = codigo.value;
        decod.textContent = c.length === 6
          ? 'Cajón ' + c.slice(0, 2) + ' (nivel 1) · Producto ' + c.slice(2, 4) + ' (nivel 2) · Opción ' + c.slice(4) + (c.slice(4) === '00' ? ' (se vende con un toque, sin opciones)' : ' (nivel 3)')
          : 'El código tiene 6 números: cajón (2) + producto (2) + opción (2). Lleva ' + c.length + '.';
        const r = revisarCodigo();
        avisosCodigo.replaceChildren(...r.errores.map((t) => aviso('rojo', t)), ...r.pendientes.map((t) => aviso('ambar', t)),
          ...(r.completo && !r.errores.length && !r.pendientes.length ? [aviso('verde', 'El código está bien: no choca con otro producto del menú.')] : []));
        // Los nombres de producto y de opción solo se piden cuando el código lleva opción (no termina en 00)
        const conOpcion = c.length === 6 && c.slice(4) !== '00';
        bloqueNiveles.replaceChildren(...(conOpcion
          ? [campo('Nombre del producto (nivel 2)', prodNom, 'Es lo que se ve en el segundo paso de Caja, por ejemplo «Hamburguesa». Todas las opciones del mismo producto llevan el mismo nombre.'),
             campo('Nombre de la opción (nivel 3)', modNom, 'Es lo que se ve en el tercer paso, por ejemplo «Doble». Déjelo vacío si el producto se vende con un toque (el código termina en 00).')]
          : c.length === 6 ? [h('small.tenue', 'Este artículo se vende con un toque: no lleva nombre de producto ni de opción. En Caja sale con el nombre de abajo. Si quiere que tenga opciones (tamaños, sabores), cambie los dos últimos números del código a 01, 02 y así.')] : []));
      };
      const componerNombre = () => {
        if (codigo.value.slice(4) === '00') return;
        if (nombre.value.trim() && nombre.value !== nombreAuto) return; // la persona ya lo escribió a su manera
        nombreAuto = [prodNom.value.trim(), modNom.value.trim()].filter(Boolean).join(', ');
        nombre.value = nombreAuto; refrescarNombre();
      };
      const refrescarIva = () => {
        const v = leerNumero(precio.value), t = Number(tarifa.value);
        desglose.textContent = abierto.checked ? 'El precio se pedirá al momento de vender.' : Number.isFinite(v) && v > 0 ? 'Con ' + t + '% de IVA incluido: ' + money(r2(v - v / (1 + t / 100))) + ' son de IVA y ' + money(r2(v / (1 + t / 100))) + ' son del producto.' : 'Escriba el precio que paga el cliente, con el IVA incluido.';
        if (infoCabys && Number(infoCabys.tarifa) !== t) { avisoIva.hidden = false; avisoIva.replaceChildren(aviso('ambar', 'El catálogo CABYS indica IVA de ' + Number(infoCabys.tarifa) + '% para este código y usted eligió ' + t + '%. Revíselo.')); } else avisoIva.hidden = true;
        avisoPrecio.hidden = true;
        if (modo === 'modificador' && !abierto.checked && Number.isFinite(v) && v > 0) {
          const igual = hermanos.find((x) => !x.precio_abierto && Math.abs(Number(x.precio_final) - v) < 0.005);
          if (igual) { avisoPrecio.hidden = false; avisoPrecio.replaceChildren(aviso('info', '"' + igual.nombre + '" (' + igual.codigo + ') ya cuesta lo mismo. Se crea un modificador nuevo solo cuando el precio es distinto.')); }
        }
      };
      const refrescarAbierto = () => { precio.disabled = abierto.checked; if (abierto.checked) precio.value = ''; refrescarIva(); };
      libre.addEventListener('change', refrescarIva);
      const refrescarNombre = () => {
        const n = norm(nombre.value);
        const igual = n ? cat.productos.find((x) => x.id !== p?.id && x.activo && norm(x.nombre) === n) : null;
        avisoNombre.hidden = !igual;
        if (igual) avisoNombre.replaceChildren(aviso('ambar', 'Ya hay otro producto con este mismo nombre (' + igual.codigo + '). En los reportes se confundirían: agregue el tamaño o un detalle, por ejemplo "355 mL".'));
      };
      const mostrarCabys = (info, c) => {
        infoCabys = info;
        if (c.length !== 13) { cabysEstado.replaceChildren(c ? aviso('info', 'El CABYS tiene 13 números. Lleva ' + c.length + '.') : ''); refrescarIva(); return; }
        if (info) cabysEstado.replaceChildren(aviso('verde', h('strong', 'En el catálogo CABYS: '), info.descripcion + ' · IVA ' + Number(info.tarifa) + '%'));
        else cabysEstado.replaceChildren(aviso('ambar', h('strong', 'Ese código no aparece en el catálogo CABYS. '), 'Puede guardarlo, pero revise que esté bien escrito para que Hacienda no rechace la factura.'));
        refrescarIva();
      };
      const verificar = debounce(async () => {
        const c = cabysInp.value;
        if (c.length !== 13) return mostrarCabys(null, c);
        try { const r = await apiM.cabysVerificar([c]); if (cabysInp.value === c) mostrarCabys(r[0] || null, c); } catch { cabysEstado.replaceChildren(); }
      }, 300);
      const buscarEnCatalogo = debounce(async () => {
        const q = buscarCabys.value.trim();
        if (q.length < 2) { resultados.replaceChildren(); return; }
        try {
          const r = await apiM.cabysBuscar(q);
          if (q !== buscarCabys.value.trim()) return;
          resultados.replaceChildren(r.length ? h('div.mt-resultados', r.map((x) => h('button.mt-res', { type: 'button', onclick: () => {
            cabysInp.value = x.codigo;
            if (TARIFAS.includes(Number(x.tarifa))) tarifa.value = String(Number(x.tarifa));
            resultados.replaceChildren(); buscarCabys.value = '';
            mostrarCabys(x, x.codigo);
          } }, h('span.cod', x.codigo), h('span.desc', x.descripcion), h('span.iva', 'IVA ' + Number(x.tarifa) + '%')))) : aviso('info', 'No se encontró nada con eso. Pruebe con otra palabra más simple, por ejemplo "hamburguesa", "bebida" o "pollo".'));
        } catch (e) { resultados.replaceChildren(aviso('rojo', 'No se pudo buscar en el catálogo: ' + e.message)); }
      }, 300);

      if (esEd && esProvisional(p)) {
        cajaProv.append(aviso('ambar', h('strong', 'Este CABYS es provisional. '), 'Busque el código correcto abajo, o si ya lo revisó y está bien, confírmelo.',
          h('div.fila', h('button.btn', { type: 'button', onclick: () => { nota.value = nota.value.replace(/CABYS provisional,?\s*confirmar\.?/i, '').trim(); cajaProv.hidden = true; toast('Listo: la marca de CABYS provisional se quita al guardar.'); } }, 'Ya confirmé este CABYS'))));
      }
      selC.addEventListener('change', () => { if (!esEd && modo === 'nuevo') codigo.value = siguienteProducto(selC.value); decodificar(); });
      codigo.addEventListener('input', decodificar);
      [prodNom, modNom].forEach((i) => i.addEventListener('input', () => { componerNombre(); decodificar(); }));
      if (esEd) activo.addEventListener('change', decodificar);
      nombre.addEventListener('input', refrescarNombre);
      cabysInp.addEventListener('input', verificar);
      buscarCabys.addEventListener('input', buscarEnCatalogo);
      tarifa.addEventListener('change', refrescarIva);
      precio.addEventListener('input', refrescarIva);
      abierto.addEventListener('change', refrescarAbierto);

      async function guardar(cerrar) {
        mostrar('');
        const cj = cat.cajones.find((c) => c.codigo === selC.value);
        if (!cj) return mostrar('Elija el cajón.', selC);
        const cod = codigo.value;
        if (!/^\d{6}$/.test(cod)) return mostrar('El código debe tener 6 números (ahora lleva ' + cod.length + ').', codigo);
        const rc = revisarCodigo();
        if (rc.errores.length) return mostrar(rc.errores[0], codigo);
        if (rc.pendientes.length && /^Falta/.test(rc.pendientes[0])) return mostrar(rc.pendientes[0], rc.pendientes[0].includes('opción') ? modNom : prodNom);
        const unToque = esUnToque(cod);
        if (!nombre.value.trim()) return mostrar('Escriba el nombre del producto.', nombre);
        if (!/^\d{13}$/.test(cabysInp.value)) return mostrar('El CABYS debe tener 13 números (ahora lleva ' + cabysInp.value.length + '). Use el buscador para encontrarlo.', cabysInp);
        let pr = 0;
        if (!abierto.checked) {
          const txt = precio.value.trim();
          pr = txt === '' && libre.checked ? 0 : r2(leerNumero(precio.value));
          if (!Number.isFinite(pr) || pr < 0 || (pr === 0 && !libre.checked)) return mostrar(unToque
            ? 'Escriba el precio final. El precio no puede ser ₡0; si cambia cada vez que se vende, marque «Precio abierto».'
            : 'Una opción no puede costar ₡0. Escriba su precio final (la opción lleva su propio precio, no es un recargo) o marque «Precio abierto» si cambia cada vez.', precio);
        }
        const cuerpo = { sociedad_id: soc.id, cajon_id: cj.id, codigo: cod, nombre: nombre.value.trim(), cabys: cabysInp.value, precio_final: pr, tarifa_iva: Number(tarifa.value), activo: quedaActivo(), precio_abierto: abierto.checked, nota: nota.value.trim() || null,
          descripcion_libre: libre.checked, modificador_nombre: unToque ? null : (modNom.value.trim() || null) };
        if (!unToque) cuerpo.producto_nombre = prodNom.value.trim() || null;
        if (!esEd) cuerpo.solo_nuevo = true; // el servidor avisa si el código ya existe, en vez de pisar otro artículo
        const btn = m.el.querySelector('.modal-pie .primario');
        await conBoton(btn, async () => {
          let rev = { dec: 'aqui', diffs: [] };
          const cambioPrecio = !abierto.checked && (!esEd || p.precio_abierto || Math.abs(Number(p.precio_final) - pr) > 0.004);
          if (cambioPrecio) { rev = await revisarOtroLocal([{ codigo: cod, nombre: cuerpo.nombre, precio: pr }]); if (rev.dec === 'volver') return; }
          await api.productoGuardar(cuerpo);
          if (rev.dec === 'ambos') await aplicarEnOtros(rev.diffs);
          toast(esEd ? 'Producto guardado.' : 'Producto agregado.');
          cerrar();
          await cargar();
        });
      }

      const titulo = esEd ? 'Editar producto' : modo === 'modificador' ? 'Agregar opción a ' + nombreGrupo(cat.productos.filter((x) => x.codigo.startsWith(grupo))) : 'Agregar producto';
      const m = modal({
        titulo, ancho: 780,
        contenido: h('div.mt-form', err,
          modo === 'modificador' ? aviso('info', 'Una opción (nivel 3) es un tamaño, sabor o presentación con su propio precio final dentro de un producto. No es un recargo: es el artículo que se cobra. Se copiaron el CABYS y el IVA de «' + (hermano?.nombre || '') + '».') : null,
          h('fieldset', h('legend', 'Código y nombre'),
            h('div.col',
              campo('Cajón', selC),
              h('div.col', { style: 'gap:.3rem' }, campo('Código de 6 números', codigo, esEd ? 'El código no se puede cambiar. Si necesita otro, cree un producto nuevo y desactive este.' : null), decod,
                esEd ? null : h('div.fila', h('button.btn', { type: 'button', onclick: () => { codigo.value = modo === 'modificador' ? siguienteModificador(grupo) : siguienteProducto(selC.value); decodificar(); } }, 'Sugerir el siguiente código libre'))),
              avisosCodigo,
              bloqueNiveles,
              campo('Nombre o descripción (el que sale en la factura)', nombre, 'Sin límite de largo. En la factura electrónica Hacienda solo recibe los primeros 200 caracteres. Si llena los nombres de arriba, este se arma solo y usted lo puede cambiar.'),
              avisoNombre)),
          h('fieldset', h('legend', 'CABYS y IVA'),
            h('div.col',
              cajaProv,
              campo('CABYS (13 números)', cabysInp), cabysEstado,
              h('div.col', { style: 'gap:.2rem' }, campo('Buscar en el catálogo CABYS', buscarCabys, 'Escriba lo que vende (por ejemplo "hamburguesa" o "gaseosa") y toque el código correcto.'), resultados),
              campo('IVA de este producto', tarifa), avisoIva)),
          h('fieldset', h('legend', 'Precio'),
            h('div.col',
              campo('Precio final con IVA incluido (₡)', precio, 'Es lo que paga el cliente. Con él se calcula todo en la factura.'), desglose, avisoPrecio,
              h('label.mt-interruptor', abierto, h('span', 'Precio abierto', h('small', 'Se pide el precio cada vez que se vende (por ejemplo, productos por peso o precio variable).'))),
              h('label.mt-interruptor', libre, h('span', 'Descripción libre', h('small', 'Quien cobra escribe qué se vendió y el precio en cada venta (por ejemplo «Servicio de alimentación» para un banquete). Sirve para los genéricos 180100 y 180200.'))))),
          h('fieldset', h('legend', 'Otros datos'),
            h('div.col',
              esEd ? h('label.mt-interruptor', activo, h('span', 'Producto activo', h('small', 'Si lo desmarca, deja de aparecer en Caja. No se borra.'))) : null,
              campo('Nota (opcional)', nota),
              esEd ? h('div.fila', h('button.btn', { type: 'button', onclick: () => mostrarHistorial(p) }, 'Ver los cambios de este producto')) : null))),
        botones: [{ texto: 'Cancelar', clase: 'suave', onclick: (c) => c() }, { texto: esEd ? 'Guardar cambios' : 'Guardar producto', clase: 'primario', onclick: (c) => guardar(c) }],
      });
      decodificar(); refrescarAbierto(); refrescarNombre(); verificar();
      if (!esEd) nombre.focus();
      return m;
    }

    /* ---------- Formulario de cajón ---------- */
    async function abrirCajon(cj) {
      await asegurarOtros();
      const esEd = !!cj;
      const err = h('div.error-caja', { hidden: true, role: 'alert' });
      const mostrar = (m, el) => { err.textContent = m; err.hidden = !m; el?.focus(); };
      const cod = soloDigitos(h('input.campo', { type: 'text', inputmode: 'numeric', readonly: esEd, value: esEd ? cj.codigo : siguienteCajon(), 'aria-label': 'Código del cajón' }), 2);
      const nom = h('input.campo', { type: 'text', autocomplete: 'off', value: esEd ? cj.nombre : '', 'aria-label': 'Nombre del cajón' });
      const orden = h('input.campo', { type: 'text', inputmode: 'numeric', value: esEd ? cj.orden : cod.value, 'aria-label': 'Orden' });
      const activo = h('input', { type: 'checkbox', checked: esEd ? cj.activo : true });
      const m = modal({
        titulo: esEd ? 'Editar cajón ' + cj.codigo : 'Agregar cajón', ancho: 520,
        contenido: h('div.mt-form', err,
          campo('Código del cajón (2 números)', cod, esEd ? 'El código no se puede cambiar.' : 'Los cajones 15 y 16 de Soda quedan reservados; se sugiere el siguiente libre en los dos locales.'),
          campo('Nombre del cajón', nom, 'Ejemplo: Postres'),
          campo('Orden en que aparece en Caja', orden, 'Número menor aparece primero.'),
          esEd ? h('label.mt-interruptor', activo, h('span', 'Cajón activo', h('small', 'Desactivar un cajón no borra sus productos.'))) : null),
        botones: [{ texto: 'Cancelar', clase: 'suave', onclick: (c) => c() }, { texto: 'Guardar cajón', clase: 'primario', onclick: async (c) => {
          mostrar('');
          if (!/^\d{2}$/.test(cod.value)) return mostrar('El código del cajón tiene 2 números.', cod);
          if (!esEd && cat.cajones.some((x) => x.codigo === cod.value)) return mostrar('Ya existe el cajón ' + cod.value + '.', cod);
          if (!nom.value.trim()) return mostrar('Escriba el nombre del cajón.', nom);
          const ord = parseInt(orden.value, 10);
          if (!Number.isFinite(ord)) return mostrar('El orden es un número, por ejemplo 20.', orden);
          if (!esEd && RESERVADOS.includes(cod.value) && soc.codigo === 'soda' && !(await confirmar('El cajón ' + cod.value + ' está reservado en Soda. ¿Quiere crearlo de todos modos?', { si: 'Sí, crearlo' }))) return;
          const btn = m.el.querySelector('.modal-pie .primario');
          await conBoton(btn, async () => {
            await api.cajonGuardar({ sociedad_id: soc.id, codigo: cod.value, nombre: nom.value.trim(), orden: ord, activo: esEd ? activo.checked : true });
            toast('Cajón guardado.'); c(); await cargar();
          });
        } }],
      });
      nom.focus();
    }

    /* ---------- Cambio de precios en lote ---------- */
    async function abrirLote() {
      const elegidos = cat.productos.filter((p) => S.sel.has(p.id)).sort((a, b) => a.codigo.localeCompare(b.codigo));
      if (!elegidos.length) return;
      await cargarOtros();
      const modo = h('select.campo', { 'aria-label': 'Qué hacer con los precios' }, [['sube_monto', 'Subir una cantidad en colones'], ['baja_monto', 'Bajar una cantidad en colones'], ['sube_pct', 'Subir un porcentaje'], ['baja_pct', 'Bajar un porcentaje'], ['fijar', 'Poner el mismo precio a todos']].map(([v, n]) => h('option', { value: v }, n)));
      const valor = h('input.campo', { type: 'text', inputmode: 'decimal', autocomplete: 'off', 'aria-label': 'Valor' });
      const etqValor = h('span', 'Cantidad en colones');
      const redondeo = h('select.campo', { 'aria-label': 'Redondeo' }, [[0, 'No redondear (con céntimos)'], [1, 'Al colón'], [5, 'Al múltiplo de ₡5'], [10, 'Al múltiplo de ₡10'], [25, 'Al múltiplo de ₡25'], [50, 'Al múltiplo de ₡50'], [100, 'Al múltiplo de ₡100']].map(([v, n]) => h('option', { value: v, selected: v === 5 }, n)));
      const motivo = h('input.campo', { type: 'text', autocomplete: 'off', placeholder: 'Opcional. Ejemplo: Aumento de proveedores', 'aria-label': 'Motivo' });
      const previa = h('div'), resumenL = h('div'), err = h('div.error-caja', { hidden: true, role: 'alert' });
      let plan = [];

      const calcular = () => {
        const v = leerNumero(valor.value), md = modo.value, rd = Number(redondeo.value);
        etqValor.textContent = md.endsWith('_pct') ? 'Porcentaje (%)' : md === 'fijar' ? 'Precio nuevo con IVA incluido (₡)' : 'Cantidad en colones';
        redondeo.disabled = md === 'fijar';
        plan = elegidos.map((p) => {
          const actual = Number(p.precio_final);
          const f = { p, actual, nuevo: null, estado: 'cambia', motivo: '' };
          if (p.precio_abierto) { f.estado = 'omitido'; f.motivo = 'Precio abierto: no lleva precio fijo'; return f; }
          if (!Number.isFinite(v) || v < 0) { f.estado = 'omitido'; f.motivo = 'Escriba el valor'; return f; }
          let n;
          if (md === 'sube_monto') n = actual + v; else if (md === 'baja_monto') n = actual - v; else if (md === 'sube_pct') n = actual * (1 + v / 100); else if (md === 'baja_pct') n = actual * (1 - v / 100); else n = v;
          n = md !== 'fijar' && rd > 0 ? Math.round(n / rd) * rd : r2(n);
          f.nuevo = r2(n);
          if (f.nuevo <= 0) { f.estado = 'omitido'; f.motivo = 'Quedaría en ₡0 o menos'; } else if (Math.abs(f.nuevo - actual) < 0.005) { f.estado = 'omitido'; f.motivo = 'Sin cambio'; }
          return f;
        });
        const cambian = plan.filter((f) => f.estado === 'cambia');
        const otro = otros[0] && otrosCat.get(otros[0].id);
        const mapaOtro = otro ? new Map(otro.productos.map((x) => [x.codigo, x])) : null;
        previa.replaceChildren(h('div.mt-previa', h('table',
          h('thead', h('tr', h('th', 'Código'), h('th', 'Producto'), h('th.der', 'Precio actual'), h('th.der', 'Precio nuevo'), h('th.der', 'Diferencia'), mapaOtro ? h('th.der', nomSoc(otros[0])) : null)),
          h('tbody', plan.map((f) => {
            const x = mapaOtro?.get(f.p.codigo);
            const dif = f.nuevo != null ? f.nuevo - f.actual : 0;
            return h('tr' + (f.estado === 'omitido' ? '.omitido' : ''),
              h('td.mt-codigo', f.p.codigo), h('td', f.p.nombre),
              h('td.der', f.p.precio_abierto ? 'Abierto' : money(f.actual)),
              h('td.der', f.estado === 'cambia' ? h('strong', money(f.nuevo)) : f.motivo),
              h('td.der' + (dif > 0 ? '.sube' : dif < 0 ? '.baja' : ''), f.estado === 'cambia' ? (dif > 0 ? '+' : '−') + money(Math.abs(dif)) : ''),
              mapaOtro ? h('td.der', x ? (x.precio_abierto ? 'Abierto' : money(x.precio_final)) : 'No está') : null);
          })))));
        resumenL.replaceChildren(aviso(cambian.length ? 'verde' : 'info', cambian.length ? 'Se cambiarán ' + plural(cambian.length, 'precio', 'precios') + (plan.length - cambian.length ? ' y ' + plural(plan.length - cambian.length, 'producto queda igual', 'productos quedan igual') + '.' : '.') : 'Todavía no hay ningún precio que cambiar. Escriba el valor.'));
        aplicarBtn().textContent = cambian.length ? 'Aplicar a ' + plural(cambian.length, 'producto', 'productos') : 'Aplicar cambios';
        aplicarBtn().disabled = !cambian.length;
      };
      const aplicarBtn = () => m.el.querySelector('.modal-pie .primario');
      [modo, valor, redondeo].forEach((e) => e.addEventListener('input', calcular));

      const m = modal({
        titulo: 'Cambiar precios de ' + plural(elegidos.length, 'producto', 'productos'), ancho: 900,
        contenido: h('div.mt-form', err,
          aviso('info', 'Primero escoja qué hacer y vea la vista previa. Nada se cambia hasta que toque "Aplicar". Los precios son siempre finales, con IVA incluido.'),
          h('div.rejilla',
            campo('Qué hacer', modo),
            h('label.etq', etqValor, valor),
            campo('Redondeo del precio nuevo', redondeo)),
          campo('Motivo del cambio (queda en el registro)', motivo),
          resumenL, previa),
        botones: [{ texto: 'Cancelar', clase: 'suave', onclick: (c) => c() }, { texto: 'Aplicar cambios', clase: 'primario', onclick: async (c) => {
          err.hidden = true;
          const cambian = plan.filter((f) => f.estado === 'cambia');
          if (!cambian.length) return;
          await conBoton(aplicarBtn(), async () => {
            const rev = await revisarOtroLocal(cambian.map((f) => ({ codigo: f.p.codigo, nombre: f.p.nombre, precio: f.nuevo })));
            if (rev.dec === 'volver') return;
            const r = await apiM.preciosLote(soc.id, cambian.map((f) => ({ id: f.p.id, precio: f.nuevo })), motivo.value.trim() || 'Cambio de precios en lote');
            if (rev.dec === 'ambos') await aplicarEnOtros(rev.diffs, motivo.value.trim() || 'Cambio de precios en lote');
            toast('Listo: ' + plural(r.cambiados, 'precio cambiado', 'precios cambiados') + (rev.dec === 'ambos' ? ' en los dos locales.' : '.'));
            S.sel.clear(); c(); await cargar();
          });
        } }],
      });
      valor.focus();
      calcular();
    }

    /* ---------- Historial ---------- */
    async function mostrarHistorial(p) {
      const cuerpo = h('div.mt-hist', h('p.cargando', 'Cargando…'));
      modal({ titulo: p ? 'Cambios de ' + p.nombre : 'Quién cambió qué en ' + nomSoc(soc), contenido: cuerpo, ancho: 720, botones: [{ texto: 'Cerrar', clase: 'suave', onclick: (c) => c() }] });
      const describir = (x) => {
        const d = x.despues, a = x.antes;
        switch (x.campo) {
          case 'creado': return 'Producto creado' + (Number(d) > 0 ? ' con precio ' + money(d) : '');
          case 'precio_final': return 'Precio: ' + money(a) + ' → ' + money(d);
          case 'nombre': return 'Nombre: "' + a + '" → "' + d + '"';
          case 'cabys': return 'CABYS: ' + a + ' → ' + d;
          case 'tarifa_iva': return 'IVA: ' + Number(a) + '% → ' + Number(d) + '%';
          case 'activo': return d === 'true' ? 'Se activó' : 'Se desactivó';
          case 'precio_abierto': return d === 'true' ? 'Pasó a precio abierto' : 'Dejó de ser precio abierto';
          case 'producto_nombre': return 'Nombre del producto (nivel 2): "' + (a || '') + '" → "' + (d || '') + '"';
          case 'modificador_nombre': return 'Nombre de la opción (nivel 3): "' + (a || '') + '" → "' + (d || '') + '"';
          case 'descripcion_libre': return d === 'true' ? 'Pasó a descripción libre' : 'Dejó de ser descripción libre';
          case 'nota': return 'Nota: "' + (a || '') + '" → "' + (d || '') + '"';
          default: return x.campo;
        }
      };
      try {
        const hist = await apiM.productoHistorial(soc.id, p?.id || null, 300);
        if (!hist.length) return cuerpo.replaceChildren(h('div.vacio', 'Todavía no hay cambios registrados.'));
        const hoy = diaCR(new Date());
        const porLote = {}; hist.forEach((x) => { if (x.lote) porLote[x.lote] = (porLote[x.lote] || 0) + 1; });
        const partes = []; let dia = '';
        hist.forEach((x) => {
          const d = diaCR(x.cambiado_en);
          if (d !== dia) { dia = d; partes.push(h('h3', d === hoy ? 'Hoy' : new Intl.DateTimeFormat('es-CR', { timeZone: 'America/Costa_Rica', dateStyle: 'full' }).format(new Date(x.cambiado_en)))); }
          partes.push(h('div.ev',
            h('div.hora', new Intl.DateTimeFormat('es-CR', { timeZone: 'America/Costa_Rica', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(x.cambiado_en))),
            h('div', h('div', p ? null : h('span.mt-codigo', x.codigo + ' '), p ? null : h('strong', x.nombre + ': '), describir(x)),
              h('div.quien', 'Lo hizo ' + (x.usuario || 'alguien') + (x.lote && porLote[x.lote] > 1 ? ' · cambio en lote' : '') + (x.motivo ? ' · ' + x.motivo : '')))));
        });
        cuerpo.replaceChildren(...partes);
      } catch (e) { cuerpo.replaceChildren(h('div.error-caja', e.message || 'No se pudo cargar el historial.')); }
    }

    /* ---------- Exportar e importar CSV ---------- */
    function exportar() {
      const nombreCajon = new Map(cat.cajones.map((c) => [c.codigo, c.nombre]));
      const filas = [['Cajón', 'Código', 'Nombre', 'CABYS', 'Precio final (IVA incluido)', 'IVA %', 'Precio abierto', 'Activo', 'Nota', 'Nombre del producto (nivel 2)', 'Nombre de la opción (nivel 3)', 'Descripción libre']];
      [...cat.productos].sort((a, b) => a.codigo.localeCompare(b.codigo)).forEach((p) => filas.push([nombreCajon.get(p.codigo.slice(0, 2)) || '', p.codigo, p.nombre, p.cabys, String(r2(p.precio_final)).replace('.', ','), Number(p.tarifa_iva), p.precio_abierto ? 'Sí' : 'No', p.activo ? 'Sí' : 'No', p.nota || '', p.producto_nombre || '', p.modificador_nombre || '', p.descripcion_libre ? 'Sí' : 'No']));
      descargar('productos ' + (soc.codigo || 'local') + ' ' + hoyCR() + '.csv', '﻿' + filas.map((f) => f.map(csvCelda).join(';')).join('\r\n'), 'text/csv;charset=utf-8');
      toast('Archivo descargado: ' + plural(cat.productos.length, 'producto', 'productos') + '. Se abre con Excel.');
    }

    function importar() {
      const archivo = h('input', { type: 'file', accept: '.csv,.txt,text/csv', hidden: true });
      const cuerpo = h('div.mt-form');
      const inicio = () => cuerpo.replaceChildren(
        aviso('info', 'Puede cambiar muchos productos a la vez con un archivo de Excel guardado como CSV. Lo más fácil: toque "Exportar CSV", cambie lo que necesite en Excel y súbalo aquí. Antes de guardar verá una vista previa de cada cambio.'),
        h('div.fila', h('button.btn.primario.grande', { type: 'button', onclick: () => archivo.click() }, 'Elegir el archivo CSV')),
        h('small.tenue', 'Columnas: Código, Nombre, CABYS, Precio final, IVA %, Precio abierto, Activo, Nota, Nombre del producto (nivel 2), Nombre de la opción (nivel 3) y Descripción libre. Los productos que no estén en el archivo no se tocan.'));
      archivo.addEventListener('change', async () => {
        const f = archivo.files[0]; if (!f) return;
        let filas;
        try { filas = leerCsv(await f.text()); } catch { return toast('No se pudo leer el archivo.', 'error'); }
        previa(filas, f.name);
      });
      function previa(filas, nombreArchivo) {
        if (filas.length < 2) return cuerpo.replaceChildren(aviso('rojo', 'El archivo no tiene filas de productos.'), h('div.fila', h('button.btn', { type: 'button', onclick: inicio }, 'Elegir otro archivo')));
        if (filas.length > 1501) return cuerpo.replaceChildren(aviso('rojo', 'El archivo tiene demasiadas filas (máximo 1500). Divídalo en partes.'), h('div.fila', h('button.btn', { type: 'button', onclick: inicio }, 'Elegir otro archivo')));
        const enc = filas[0].map((x) => norm(x).replace(/[_\s]+/g, ' ').trim());
        const col = (...nombres) => enc.findIndex((e) => nombres.some((n) => e === n || e.startsWith(n + ' ')));
        const C = { cod: col('codigo', 'cod'), nom: col('nombre', 'descripcion', 'producto', 'detalle'), cab: col('cabys'), pre: col('precio final', 'precio', 'precio con iva'), iva: col('iva', 'tarifa', 'tarifa iva', 'impuesto'), abi: col('precio abierto', 'abierto'), act: col('activo'), not: col('nota', 'notas'), pnom: col('nombre del producto', 'producto nivel 2', 'nivel 2'), mnom: col('nombre de la opcion', 'nombre del modificador', 'opcion', 'modificador', 'nivel 3'), lib: col('descripcion libre', 'texto libre') };
        if (C.cod < 0) return cuerpo.replaceChildren(aviso('rojo', 'No encontré la columna "Código" en la primera fila del archivo.'), h('div.fila', h('button.btn', { type: 'button', onclick: inicio }, 'Elegir otro archivo')));
        const porCodigo = new Map(cat.productos.map((p) => [p.codigo, p]));
        const vistos = new Set();
        const plan = filas.slice(1).map((r, i) => {
          const g = (k) => (C[k] >= 0 ? String(r[C[k]] ?? '').trim() : null);
          let cod = (g('cod') || '').replace(/\D/g, ''); if (cod.length === 5) cod = '0' + cod;
          const it = { linea: i + 2, cod, estado: 'error', msg: '', cambios: [], cuerpo: null };
          if (!/^\d{6}$/.test(cod)) { it.msg = 'Código inválido'; return it; }
          if (vistos.has(cod)) { it.msg = 'Código repetido en el archivo'; return it; }
          vistos.add(cod);
          const ex = porCodigo.get(cod);
          const cj = cat.cajones.find((c) => c.codigo === cod.slice(0, 2));
          if (!cj) { it.msg = 'No existe el cajón ' + cod.slice(0, 2); return it; }
          const nombre = g('nom') != null && g('nom') !== '' ? g('nom') : ex?.nombre;
          const cabys = g('cab') != null && g('cab') !== '' ? g('cab').replace(/\D/g, '') : ex?.cabys;
          const abierto = g('abi') != null && g('abi') !== '' ? sino(g('abi')) : ex?.precio_abierto ?? false;
          let precio = ex ? Number(ex.precio_final) : 0;
          if (g('pre') != null && g('pre') !== '') { precio = r2(leerNumero(g('pre'))); if (!Number.isFinite(precio) || precio < 0) { it.msg = 'Precio inválido'; return it; } }
          const tarifa = g('iva') != null && g('iva') !== '' ? Number(String(g('iva')).replace('%', '').replace(',', '.')) : ex ? Number(ex.tarifa_iva) : 13;
          const activo = g('act') != null && g('act') !== '' ? sino(g('act')) : ex ? ex.activo : true;
          const nota = g('not') != null ? g('not') : ex?.nota || '';
          // Si el archivo no trae estas columnas se conserva lo que ya está guardado
          const pnom = C.pnom >= 0 ? g('pnom') : (ex?.producto_nombre || '');
          const mnom = C.mnom >= 0 ? g('mnom') : (ex?.modificador_nombre || '');
          const libre = g('lib') != null && g('lib') !== '' ? sino(g('lib')) : ex?.descripcion_libre ?? false;
          if (!nombre) { it.msg = 'Falta el nombre'; return it; }
          if (esUnToque(cod) && mnom) { it.msg = 'Un código que termina en 00 no lleva nombre de opción'; return it; }
          if (!esUnToque(cod) && activo && (!pnom || !mnom)) { it.msg = 'Falta el nombre del producto o de la opción (niveles 2 y 3)'; return it; }
          if (!/^\d{13}$/.test(cabys || '')) { it.msg = 'CABYS debe tener 13 números'; return it; }
          if (!TARIFAS.includes(tarifa)) { it.msg = 'IVA debe ser 13, 4, 2, 1 o 0'; return it; }
          if (!abierto && !libre && !(precio > 0)) { it.msg = 'Precio en ₡0 (use Precio abierto = Sí)'; return it; }
          it.cuerpo = { sociedad_id: soc.id, cajon_id: cj.id, codigo: cod, nombre, cabys, precio_final: abierto ? 0 : precio, tarifa_iva: tarifa, activo, precio_abierto: abierto, nota: nota || null, descripcion_libre: libre };
          if (C.pnom >= 0 || ex?.producto_nombre) it.cuerpo.producto_nombre = pnom || null;
          it.cuerpo.modificador_nombre = mnom || null;
          if (!ex) { it.estado = 'nuevo'; it.msg = 'Producto nuevo'; return it; }
          const dif = [];
          if (ex.nombre !== nombre) dif.push('nombre');
          if (ex.cabys !== cabys) dif.push('CABYS');
          if (!abierto && Math.abs(Number(ex.precio_final) - precio) > 0.004) dif.push('precio ' + money(ex.precio_final) + ' → ' + money(precio));
          if (Number(ex.tarifa_iva) !== tarifa) dif.push('IVA');
          if (ex.precio_abierto !== abierto) dif.push('precio abierto');
          if (ex.activo !== activo) dif.push(activo ? 'activar' : 'desactivar');
          if ((ex.nota || '') !== (nota || '')) dif.push('nota');
          if ((ex.producto_nombre || '') !== (pnom || '')) dif.push('nombre del producto');
          if ((ex.modificador_nombre || '') !== (mnom || '')) dif.push('nombre de la opción');
          if (!!ex.descripcion_libre !== libre) dif.push('descripción libre');
          if (!dif.length) { it.estado = 'igual'; it.msg = 'Sin cambios'; return it; }
          it.estado = 'cambia'; it.msg = dif.join(', '); it.precioNuevo = abierto ? 0 : precio; it.cambioPrecio = dif.some((d) => d.startsWith('precio ')); return it;
        });
        const n = (e) => plan.filter((x) => x.estado === e).length;
        const aplicables = plan.filter((x) => x.estado === 'nuevo' || x.estado === 'cambia');
        const etiqueta = { nuevo: 'span.chip.ok', cambia: 'span.chip.espera', igual: 'span.chip.gris', error: 'span.chip.mal' };
        const textoEst = { nuevo: 'Nuevo', cambia: 'Cambia', igual: 'Igual', error: 'No se importa' };
        const progreso = h('div');
        const btnAplicar = h('button.btn.primario', { type: 'button', disabled: !aplicables.length, onclick: () => aplicar() }, aplicables.length ? 'Importar ' + plural(aplicables.length, 'cambio', 'cambios') : 'No hay nada que importar');
        async function aplicar() {
          await conBoton(btnAplicar, async () => {
            const preciosAComparar = aplicables.filter((x) => x.estado === 'nuevo' || x.cambioPrecio).filter((x) => !x.cuerpo.precio_abierto).map((x) => ({ codigo: x.cod, nombre: x.cuerpo.nombre, precio: x.cuerpo.precio_final }));
            const rev = preciosAComparar.length ? await revisarOtroLocal(preciosAComparar) : { dec: 'aqui', diffs: [] };
            if (rev.dec === 'volver') return;
            let hechos = 0; const fallos = []; let i = 0;
            const trabajador = async () => {
              while (i < aplicables.length) {
                const it = aplicables[i++];
                try { await api.productoGuardar(it.cuerpo); hechos++; } catch (e) { fallos.push(it.cod + ': ' + e.message); }
                progreso.replaceChildren(aviso('info', 'Guardando… ' + (hechos + fallos.length) + ' de ' + aplicables.length));
              }
            };
            await Promise.all([trabajador(), trabajador(), trabajador(), trabajador()]);
            if (rev.dec === 'ambos') { try { await aplicarEnOtros(rev.diffs, 'Igualado desde importación'); } catch (e) { fallos.push('Otro local: ' + e.message); } }
            await cargar();
            if (fallos.length) progreso.replaceChildren(aviso('rojo', plural(hechos, 'producto guardado', 'productos guardados') + '. No se pudieron guardar ' + fallos.length + ': ' + fallos.slice(0, 5).join(' | ')));
            else { toast('Importación lista: ' + plural(hechos, 'producto guardado', 'productos guardados') + '.'); mm.cerrar(); }
          });
        }
        cuerpo.replaceChildren(
          aviso(aplicables.length ? 'verde' : 'info', h('strong', nombreArchivo + ': '), plural(n('nuevo'), 'nuevo', 'nuevos') + ', ' + plural(n('cambia'), 'con cambios', 'con cambios') + ', ' + plural(n('igual'), 'igual', 'iguales') + ', ' + plural(n('error'), 'con error (no se importa)', 'con error (no se importan)') + '.'),
          h('div.mt-previa', { style: 'max-height:360px' }, h('table', h('thead', h('tr', h('th', 'Fila'), h('th', 'Código'), h('th', 'Producto'), h('th', 'Qué pasa'), h('th', 'Detalle'))),
            h('tbody', plan.map((x) => h('tr' + (x.estado === 'igual' || x.estado === 'error' ? '.omitido' : ''), h('td', x.linea), h('td.mt-codigo', x.cod), h('td', x.cuerpo?.nombre || ''), h('td', h(etiqueta[x.estado], textoEst[x.estado])), h('td', x.msg)))))),
          progreso,
          h('div.fila', h('button.btn', { type: 'button', onclick: inicio }, 'Elegir otro archivo'), btnAplicar));
      }
      const mm = modal({ titulo: 'Importar productos desde CSV', contenido: h('div', cuerpo, archivo), ancho: 900, botones: [{ texto: 'Cerrar', clase: 'suave', onclick: (c) => c() }] });
      inicio();
    }

    /* ---------- Armado ---------- */
    root.append(
      h('div.mt-cab',
        h('div', h('h1', 'Productos de ' + nomSoc(soc)), h('p', 'Nivel 1 cajón, nivel 2 producto, nivel 3 opción (modificador). El precio es siempre el final, con IVA incluido. Nada se borra: se desactiva.')),
        h('div.mt-acciones',
          h('button.btn.primario.grande', { type: 'button', onclick: () => abrirProducto({ modo: 'nuevo' }) }, 'Agregar producto'),
          h('button.btn.grande', { type: 'button', onclick: () => abrirCajon(null) }, 'Agregar cajón'))),
      hoyBox,
      h('div.mt-filtros', buscar, selCajon, selVer),
      resumen,
      h('div.mt-herr',
        h('span.rotulo', 'Herramientas'),
        h('button.btn', { type: 'button', onclick: () => { cat.productos.filter(pasa).forEach((p) => S.sel.add(p.id)); pintarSel(); toast('Marcados los productos que se ven. Ahora toque "Cambiar precios de lo seleccionado".'); } }, 'Marcar todo lo que se ve'),
        h('button.btn', { type: 'button', onclick: () => mostrarHistorial(null) }, 'Historial de cambios'),
        h('button.btn', { type: 'button', onclick: exportar }, 'Exportar CSV'),
        h('button.btn', { type: 'button', onclick: importar }, 'Importar CSV')),
      h('p.mt-nota', 'Para cambiar varios precios a la vez, marque los productos con la casilla de la izquierda (o todo un grupo o cajón) y use la barra que aparece abajo.'),
      lista, barra);

    try { await cargar(); } catch (e) { lista.replaceChildren(h('div.error-caja', e.message || 'No se pudo cargar el catálogo.')); }
    asegurarOtros();
    return () => document.documentElement.style.removeProperty('--alto-cab');
  },
};
