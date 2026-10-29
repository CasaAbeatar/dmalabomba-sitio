// Caja: la pantalla que usa el cajero todo el día (abrir caja, cuentas, productos, prefactura y cobro).
import { abrirSalidas } from './ui_salidas.js';
import { crearCampoIdentificacion, leerCorreos, errorActividad, limpiarActividad } from './ui_cedula.js';
import { apiM } from './api_mantenimiento.js';
import { h, money, money0, num, leerNumero, toast, modal, pedir, conBoton, debounce, TIPOS_SERVICIO, TIPOS_DOC, TIPOS_ID, MEDIOS, ESTADOS } from './util.js';

const CSS_URL = new URL('../css/caja.css', import.meta.url).href;
function cargarCss() {
  return new Promise((ok) => {
    if (document.getElementById('css-caja')) return ok();
    const l = h('link', { id: 'css-caja', rel: 'stylesheet', href: CSS_URL });
    l.onload = l.onerror = () => ok();
    document.head.append(l);
    setTimeout(ok, 1500);
  });
}

const lsGet = (k) => { try { return localStorage.getItem('fx_' + k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem('fx_' + k, v); } catch { /* sin almacenamiento */ } };
const cents = (n) => Math.round((Number(n) || 0) * 100);
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const numCuenta = (n) => '#' + String(n || '').split('-').pop();
const leerCant = (s) => Number(String(s ?? '').trim().replace(',', '.'));
const r3 = (n) => Math.round((n + Number.EPSILON) * 1000) / 1000;
const plano = (n) => String(Number(n)); // para campos de texto: sin separador de miles
const fino = () => window.matchMedia?.('(pointer:fine)').matches ?? true;
const imp = async () => {
  try { return await import('./imprimir.js'); }
  catch (e) { console.error(e); throw new Error('La impresión no está disponible por ahora. Recargue la página e intente de nuevo.'); }
};

const AYUDA_TIPO = {
  buffet: 'Cuenta rápida, sin datos del cliente',
  espera: 'Cliente que regresa a pagar',
  llevar: 'Pedido para llevar: nombre y teléfono',
  express: 'Pedido express: nombre y teléfono',
};
const RAPIDOS = [1000, 2000, 5000, 10000, 20000];

// Busca por palabras parciales en cualquier orden, sin tildes ni mayúsculas; por código completo o por prefijo
function buscarEn(productos, q) {
  const tokens = norm(q).split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const out = [];
  for (const p of productos) {
    if (!tokens.every((t) => p._n.includes(t) || p.codigo.startsWith(t))) continue;
    const t0 = tokens[0];
    let s = 4;
    if (p.codigo === t0) s = 0;
    else if (/^\d+$/.test(t0) && p.codigo.startsWith(t0)) s = 1;
    else if (p._n.startsWith(t0)) s = 2;
    else if ((' ' + p._n).includes(' ' + t0)) s = 3;
    out.push([s, p]);
  }
  out.sort((a, b) => a[0] - b[0] || (a[1].codigo < b[1].codigo ? -1 : a[1].codigo > b[1].codigo ? 1 : 0));
  return out.map((x) => x[1]);
}

// Reparte los pagos: lo que no es efectivo no puede pasar del total; el efectivo cubre el resto y da vuelto. Todo en céntimos.
function calcularPagos(entradas, totalC) {
  let noEf = 0, ef = 0;
  for (const e of entradas) { const c = cents(e.recibido); if (e.medio === 'efectivo') ef += c; else noEf += c; }
  if (noEf > totalC) return { ok: false, error: 'Tarjeta, SINPE y transferencia suman más que el total. Baje ese monto.', falta: 0, vuelto: 0, aplicados: [] };
  const resto = totalC - noEf;
  const efAplic = Math.min(ef, resto);
  const falta = totalC - noEf - efAplic;
  const vuelto = ef - efAplic;
  let restoEf = resto;
  const aplicados = [];
  for (const e of entradas) {
    const c = cents(e.recibido);
    if (e.medio === 'efectivo') {
      const a = Math.min(c, restoEf); restoEf -= a;
      if (a > 0) aplicados.push({ medio: 'efectivo', monto: a / 100, referencia: e.ref || null });
    } else if (c > 0) aplicados.push({ medio: e.medio, monto: c / 100, referencia: e.ref || null });
  }
  return { ok: falta === 0 && aplicados.length > 0, error: null, falta, vuelto, aplicados };
}

export default {
  id: 'caja',
  titulo: 'Caja',
  async mount(root, app) {
    await cargarCss();
    const api = app.api;
    const socId = app.soc.id;
    let vivo = true;
    document.body.classList.add('fx-caja');

    /* ---------- Estado ---------- */
    let catalogo = { cajones: [], productos: [] };
    let productos = [];
    const prodPorId = new Map();
    let abiertas = [];
    let cur = null; // respuesta de fx_venta de la cuenta activa
    let cajonSel = null;
    let vista = 'productos'; // celular: productos | cuenta
    let turnoMostrado = null;
    let ocupadas = 0;
    let cola = Promise.resolve();
    let buscador = null, asideCuenta = null, barraCuentas = null, barraExtras = null, gridProd = null, tabsCajon = null, barraMovil = null, cajaEl = null, buscadorWrap = null;
    const tarjetas = new Map(); // producto_id -> {badge}
    const timers = [];

    // Las acciones sobre la cuenta se hacen una tras otra para que dos toques rápidos no se pisen
    function accion(fn) {
      const p = cola.then(async () => {
        if (!vivo) return;
        ocupadas++;
        try { await fn(); }
        catch (e) { toast(e.message || String(e), 'error', 7000); if (cur && asideCuenta) pintarCuenta(); }
        finally { ocupadas--; }
      });
      cola = p;
      return p;
    }

    /* ---------- Carga de datos ---------- */
    async function cargarCatalogo() {
      catalogo = await api.catalogo(socId);
      productos = (catalogo.productos || []).slice().sort((a, b) => (a.codigo < b.codigo ? -1 : a.codigo > b.codigo ? 1 : 0));
      prodPorId.clear();
      productos.forEach((p) => { p._n = norm(p.nombre); prodPorId.set(p.id, p); });
      if (!catalogo.cajones.some((c) => c.id === cajonSel)) cajonSel = catalogo.cajones[0]?.id || null;
    }
    async function cargarAbiertas() { abiertas = (await api.ventasAbiertas(socId)) || []; }
    async function elegirInicial() {
      const guardada = lsGet('cuenta_' + socId);
      const id = abiertas.find((a) => a.id === guardada)?.id || abiertas[0]?.id || null;
      cur = id ? await api.venta(id) : null;
      guardarActiva();
    }
    function ventaVacia(v) { return { venta: v, lineas: [], pagos: [], cliente: null, comprobante: null }; }
    function sacarDeLista(id) { abiertas = abiertas.filter((a) => a.id !== id); }
    async function pasarALaSiguiente() {
      const sig = abiertas.find((a) => a.id === lsGet('cuenta_' + socId)) || abiertas[0];
      cur = sig ? await api.venta(sig.id) : null;
      guardarActiva();
    }
    function guardarActiva() { if (cur) lsSet('cuenta_' + socId, cur.venta.id); }
    function sincronizarBarra() {
      if (!cur) return;
      const v = cur.venta;
      const fila = { id: v.id, numero: v.numero, estado: v.estado, tipo_servicio: v.tipo_servicio, referencia: v.referencia, telefono: v.telefono, prefactura_numero: v.prefactura_numero, total: v.total, creado_en: v.creado_en, cliente_id: v.cliente_id, lineas: cur.lineas.length };
      const i = abiertas.findIndex((a) => a.id === v.id);
      if (i >= 0) abiertas[i] = fila; else abiertas.push(fila);
      abiertas.sort((a, b) => (a.creado_en < b.creado_en ? -1 : 1));
    }
    function repintar(irAlFinal) {
      sincronizarBarra();
      pintarBarra(); pintarCuenta(irAlFinal); pintarMovil(); actualizarInsignias();
    }

    /* ---------- Sin turno: abrir caja ---------- */
    function pintarSinTurno() {
      const fondo = h('input.campo.monto-grande', { type: 'text', inputmode: 'decimal', placeholder: '0', 'aria-label': 'Efectivo con que abre la caja', autocomplete: 'off' });
      const err = h('div.error-caja', { hidden: true });
      const abrir = h('button.btn.primario.grande', { type: 'button', style: 'width:100%' }, 'Abrir caja');
      const hacer = () => conBoton(abrir, async () => {
        err.hidden = true;
        const txt = fondo.value.trim();
        const v = txt === '' ? 0 : leerNumero(txt);
        if (!Number.isFinite(v) || v < 0) { err.textContent = 'Escriba cuánto efectivo hay en la caja al empezar, por ejemplo 20000. Si no hay, escriba 0.'; err.hidden = false; fondo.focus(); return; }
        await api.turnoAbrir(socId, app.terminal, v);
        await app.refrescar();
        if ((app.turno?.id || null) !== turnoMostrado) await iniciar();
      });
      abrir.addEventListener('click', hacer);
      fondo.addEventListener('keydown', (e) => { if (e.key === 'Enter') hacer(); });
      const atajos = [0, 10000, 20000, 50000].map((n) => h('button.btn', { type: 'button', onclick: () => { fondo.value = String(n); fondo.focus(); } }, n === 0 ? 'Sin fondo (₡0)' : money0(n)));
      root.replaceChildren(h('div.caja-abrir.tarjeta',
        h('h1', 'Abrir caja'),
        h('p', 'La caja de ' + (app.soc.nombre_comercial || app.soc.nombre) + ' está cerrada. Para empezar a vender, escriba solo el efectivo con que abre la caja.'),
        h('label.etq', 'Efectivo con que abre la caja (₡)', fondo),
        h('div.atajos', atajos),
        err, abrir));
      fondo.focus();
    }

    /* ---------- Estructura de la caja con turno abierto ---------- */
    function armarCaja() {
      barraCuentas = h('div.cuentas-bar');
      barraExtras = h('div.cuentas-extras');
      buscador = crearBuscador({ alElegir: (p) => agregarProducto(p), enLinea: false });
      buscadorWrap = h('div.buscador', buscador.el);
      tabsCajon = h('div.cajones', { role: 'group', 'aria-label': 'Cajones de productos' });
      gridProd = h('div.productos');
      asideCuenta = h('aside.caja-cuenta', { 'aria-label': 'Cuenta activa' });
      barraMovil = h('div.barra-movil');
      cajaEl = h('div.caja.v-' + vista,
        h('div.caja-cuerpo',
          h('div.caja-izq', barraCuentas, barraExtras, buscadorWrap,
            h('section.caja-catalogo', { 'aria-label': 'Productos' }, tabsCajon, gridProd)),
          asideCuenta),
        barraMovil);
      root.replaceChildren(cajaEl);
      buscador.inp.addEventListener('focus', () => { cajaEl.classList.add('bus-activo'); if (!fino()) setTimeout(irAlBuscador, 250); });
      buscador.inp.addEventListener('blur', () => cajaEl.classList.remove('bus-activo'));
      midePegajosos();
      pintarCajones(); pintarProductos();
      repintar();
      if (fino()) buscador.inp.focus();
    }
    function midePegajosos() {
      const cab = document.querySelector('.cabecera');
      if (cab) document.documentElement.style.setProperty('--cab-h', (window.matchMedia('(max-width:979px)').matches ? 0 : cab.offsetHeight) + 'px');
      if (buscadorWrap) document.documentElement.style.setProperty('--bus-h', buscadorWrap.offsetHeight + 'px');
    }
    // En celular deja el buscador arriba de la pantalla (la cabecera de la app sube y se va)
    function irAlBuscador() {
      if (!cajaEl || !window.matchMedia('(max-width:979px)').matches) return;
      window.scrollTo({ top: Math.max(0, cajaEl.getBoundingClientRect().top + window.scrollY - 4) });
    }
    function cambiarVista(v) {
      vista = v;
      cajaEl.classList.remove('v-productos', 'v-cuenta'); cajaEl.classList.add('v-' + v);
      pintarMovil();
      irAlBuscador();
    }

    /* ---------- Buscador reutilizable ---------- */
    let contadorBus = 0;
    function crearBuscador({ alElegir, enLinea }) {
      const id = 'bus-' + (++contadorBus);
      let res = [], sel = 0;
      const inp = h('input.campo.buscador-inp', { id, type: 'text', placeholder: 'Nombre o código (ej. ham dob)', 'aria-label': 'Buscar producto', autocomplete: 'off', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'search' });
      const borrar = h('button.btn', { type: 'button', hidden: true, onclick: () => { limpiar(); inp.focus(); } }, 'Borrar búsqueda');
      const lista = h('div.resultados', { role: 'listbox', 'aria-label': 'Resultados', hidden: true });
      const el = h('div.buscador-caja' + (enLinea ? '.en-linea' : ''),
        h('label.etq', { for: id }, h('span.rotulo', h('span', 'Buscar producto'), h('small', 'Escriba parte del nombre en cualquier orden (ej. ham dob) o el código de 6 dígitos')),
          h('span.buscador-fila', inp, borrar)),
        lista);
      function marcar() { [...lista.querySelectorAll('.res-item')].forEach((b, i) => b.setAttribute('aria-selected', String(i === sel))); lista.querySelector('.res-item[aria-selected=true]')?.scrollIntoView({ block: 'nearest' }); }
      function pintar() {
        const q = inp.value.trim();
        borrar.hidden = !inp.value;
        lista.replaceChildren();
        if (!q) { lista.hidden = true; res = []; return; }
        res = buscarEn(productos, q); sel = 0; lista.hidden = false;
        if (!res.length) { lista.append(h('div.res-vacio', 'No hay productos que coincidan con «' + q + '». Pruebe con menos letras.')); return; }
        res.slice(0, 50).forEach((p, i) => lista.append(h('button.res-item', {
          type: 'button', role: 'option', 'aria-selected': String(i === 0),
          onmousedown: (e) => e.preventDefault(), onclick: () => elegir(p),
        }, h('span.res-nom', p.nombre), h('span.res-pre', p.precio_abierto ? 'Precio abierto' : money(p.precio_final)),
        h('span.res-cod', p.codigo + ' · ' + (catalogo.cajones.find((c) => c.id === p.cajon_id)?.nombre || '')))));
        if (res.length > 50) lista.append(h('div.res-vacio', 'Hay ' + (res.length - 50) + ' más. Escriba más letras para acotar.'));
      }
      function limpiar() { inp.value = ''; pintar(); }
      async function elegir(p) {
        limpiar();
        if (!fino()) inp.blur();
        await alElegir(p);
        if (fino() && vivo) inp.focus();
      }
      inp.addEventListener('input', pintar);
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' && res.length) { e.preventDefault(); sel = Math.min(sel + 1, Math.min(res.length, 50) - 1); marcar(); }
        else if (e.key === 'ArrowUp' && res.length) { e.preventDefault(); sel = Math.max(sel - 1, 0); marcar(); }
        else if (e.key === 'Escape') { limpiar(); }
        else if (e.key === 'Enter') {
          e.preventDefault();
          const q = inp.value.trim();
          if (!q) return;
          const p = (/^\d{6}$/.test(q) ? productos.find((x) => x.codigo === q) : null) || res[sel];
          if (p) elegir(p); else toast('No encontré ese producto. Revise el código o el nombre.', 'error');
        }
      });
      return { el, inp, limpiar, pintar };
    }

    /* ---------- Cajones y productos ---------- */
    function pintarCajones() {
      tabsCajon.replaceChildren(...catalogo.cajones.map((c) => h('button.cajon-btn', {
        type: 'button', 'aria-pressed': String(c.id === cajonSel),
        onclick: () => { cajonSel = c.id; pintarCajones(); pintarProductos(); },
      }, c.nombre)));
    }
    function pintarProductos() {
      tarjetas.clear();
      const lista = productos.filter((p) => p.cajon_id === cajonSel);
      if (!lista.length) { gridProd.replaceChildren(h('div.vacio', { style: 'grid-column:1/-1' }, 'Este cajón no tiene productos activos.')); return; }
      const nodos = [];
      let grupo = null;
      for (const p of lista) {
        const g = p.codigo.slice(2, 4); // mismo producto o tamaño: dígitos 3 y 4 del código
        if (grupo !== null && g !== grupo) nodos.push(h('div.grupo-sep'));
        grupo = g;
        const badge = h('span.prod-cuenta', { hidden: true, 'aria-hidden': 'true' });
        const btn = h('button.prod', {
          type: 'button', 'aria-label': 'Agregar ' + p.nombre + ', ' + (p.precio_abierto ? 'precio abierto' : money(p.precio_final)),
          onclick: (e) => { e.currentTarget.classList.add('tocado'); const b = e.currentTarget; setTimeout(() => b.classList.remove('tocado'), 180); agregarProducto(p); },
        }, h('span.prod-nombre', p.nombre),
        h('span.prod-pie', h('span.prod-precio' + (p.precio_abierto ? '.abierto' : ''), p.precio_abierto ? 'Precio abierto' : money(p.precio_final)), h('span.prod-cod', p.codigo)), badge);
        tarjetas.set(p.id, badge);
        nodos.push(btn);
      }
      gridProd.replaceChildren(...nodos);
      actualizarInsignias();
    }
    function actualizarInsignias() {
      const cuenta = new Map();
      (cur?.lineas || []).forEach((l) => cuenta.set(l.producto_id, (cuenta.get(l.producto_id) || 0) + Number(l.cantidad)));
      for (const [id, badge] of tarjetas) {
        const n = cuenta.get(id);
        badge.hidden = !n;
        if (n) badge.textContent = num(n, 3);
      }
    }

    /* ---------- Barra de cuentas abiertas ---------- */
    function pintarBarra() {
      const botones = abiertas.map((c) => {
        const act = cur && cur.venta.id === c.id;
        return h('button.cuenta-btn' + (c.estado === 'prefacturada' ? '.prefact' : ''), {
          type: 'button', 'aria-pressed': String(!!act), 'data-id': c.id,
          onclick: () => { if (!act) accion(async () => { cur = await api.venta(c.id); guardarActiva(); repintar(); }); cambiarVista('cuenta'); },
        }, h('span.c-tipo', (TIPOS_SERVICIO[c.tipo_servicio] || c.tipo_servicio) + (c.estado === 'prefacturada' ? ' · prefactura' : '')),
        h('span.c-ref', c.referencia || numCuenta(c.numero)),
        h('span.c-tot', c.lineas + (Number(c.lineas) === 1 ? ' producto · ' : ' productos · ') + money(c.total)));
      });
      barraCuentas.replaceChildren(
        h('div.cuentas-lista', { role: 'group', 'aria-label': 'Cuentas abiertas' }, botones.length ? botones : h('span.cuentas-vacio', 'No hay cuentas abiertas. Toque un producto para empezar una.')),
        h('button.btn.primario', { type: 'button', onclick: nuevaCuenta }, 'Nueva cuenta'));
      barraExtras.replaceChildren(
        h('button.btn', { type: 'button', onclick: () => abrirSalidas({ api, turnoId: turnoMostrado }) }, 'Registrar salida de efectivo'),
        h('button.btn', { type: 'button', onclick: async () => { try { (await imp()).abrirAjustesImpresion(); } catch (e) { toast(e.message, 'error', 6000); } } }, 'Impresora'));
    }

    /* ---------- Ventana de datos de cuenta ---------- */
    function dialogoCuenta({ titulo, boton, inicial }) {
      return new Promise((ok) => {
        let tipo = inicial?.tipo || 'buffet';
        let hecho = false;
        const nombre = h('input.campo', { type: 'text', maxlength: 60, value: inicial?.referencia || '', autocomplete: 'off' });
        const tel = h('input.campo', { type: 'tel', inputmode: 'tel', maxlength: 20, value: inicial?.telefono || '', autocomplete: 'off' });
        const lblNombre = h('span');
        const filaTel = h('label.etq', 'Teléfono', tel);
        const err = h('div.error-caja', { hidden: true });
        const btnsTipo = Object.entries(TIPOS_SERVICIO).map(([k, v]) => h('button.tipo-btn', { type: 'button', dataset: { tipo: k }, onclick: () => { tipo = k; pintar(); } }, h('b', v), h('small', AYUDA_TIPO[k])));
        function pintar() {
          btnsTipo.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tipo === tipo)));
          lblNombre.textContent = tipo === 'buffet' ? 'Nombre o número (opcional)' : 'Nombre del cliente';
          filaTel.hidden = !(tipo === 'llevar' || tipo === 'express');
        }
        const enviar = (cerrar) => {
          const ref = nombre.value.trim(), t = tel.value.trim();
          err.hidden = true;
          if (tipo !== 'buffet' && !ref) { err.textContent = 'Escriba el nombre del cliente.'; err.hidden = false; nombre.focus(); return; }
          if ((tipo === 'llevar' || tipo === 'express') && t.replace(/\D/g, '').length < 8) { err.textContent = 'Escriba el teléfono del cliente (8 números).'; err.hidden = false; tel.focus(); return; }
          hecho = true; cerrar(); ok({ tipo, referencia: ref, telefono: (tipo === 'llevar' || tipo === 'express') ? t : '' });
        };
        let cerrarFn;
        const m = modal({ titulo, ancho: 520, alCerrar: () => { if (!hecho) ok(null); },
          contenido: h('div.col', h('div.tipos-cuenta', btnsTipo), h('label.etq', lblNombre, nombre), filaTel, err),
          botones: [{ texto: 'Cancelar', onclick: (c) => c() }, { texto: boton, clase: 'primario', onclick: (c) => enviar(c) }] });
        cerrarFn = m.cerrar;
        [nombre, tel].forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') enviar(cerrarFn); }));
        pintar();
      });
    }

    async function nuevaCuenta() {
      const d = await dialogoCuenta({ titulo: 'Nueva cuenta', boton: 'Crear cuenta' });
      if (!d) return;
      await accion(async () => {
        const v = await api.ventaCrear(socId, d.tipo, d.referencia || null, d.telefono || null, app.terminal);
        cur = ventaVacia(v); guardarActiva();
        repintar();
        toast('Cuenta creada: ' + TIPOS_SERVICIO[d.tipo] + (d.referencia ? ' de ' + d.referencia : '') + '.');
      });
      cambiarVista('productos');
      if (fino()) buscador.inp.focus();
    }
    async function editarDatos() {
      if (!cur) return;
      const v = cur.venta, id = v.id;
      const d = await dialogoCuenta({ titulo: 'Datos de la cuenta', boton: 'Guardar', inicial: { tipo: v.tipo_servicio, referencia: v.referencia, telefono: v.telefono } });
      if (!d) return;
      accion(async () => { cur = await api.ventaDatos(id, { tipo: d.tipo, referencia: d.referencia, telefono: d.telefono }); repintar(); toast('Datos guardados.'); });
    }
    function anularCuenta() {
      if (!cur) return;
      const v = cur.venta, id = v.id;
      const motivo = h('textarea.campo', { rows: 3, placeholder: 'Ej. el cliente se fue, error al digitar' });
      modal({ titulo: 'Anular cuenta', ancho: 460,
        contenido: h('div.col', h('p.conf', 'Va a anular la cuenta ' + (TIPOS_SERVICIO[v.tipo_servicio] || '') + ' ' + (v.referencia || numCuenta(v.numero)) + ' por ' + money(v.total) + '. No se puede deshacer.'), h('label.etq', 'Motivo (obligatorio)', motivo)),
        botones: [{ texto: 'No, volver', onclick: (c) => c() }, { texto: 'Sí, anular esta cuenta', clase: 'peligro', onclick: (c) => {
          const m = motivo.value.trim();
          if (m.length < 3) { toast('Escriba el motivo de la anulación.', 'error'); return; }
          c();
          accion(async () => { await api.ventaAnular(id, m); sacarDeLista(id); await pasarALaSiguiente(); repintar(); toast('Cuenta anulada.'); });
        } }] });
    }

    /* ---------- Productos en la cuenta ---------- */
    async function crearCuentaBuffet() {
      const v = await api.ventaCrear(socId, 'buffet', null, null, app.terminal);
      cur = ventaVacia(v); guardarActiva();
    }
    async function agregarProducto(p) {
      let precio = null;
      if (p.precio_abierto) {
        const v = await pedir({ titulo: p.nombre, etiqueta: 'Precio final con IVA incluido (₡)', tipo: 'number', boton: 'Agregar a la cuenta', nota: 'Escriba el monto y toque «Agregar a la cuenta» (o Enter).' });
        if (v == null) return;
        precio = leerNumero(v);
        if (!(precio > 0)) { toast('Escriba un precio mayor que cero.', 'error'); return; }
      }
      return accion(async () => {
        if (!cur) await crearCuentaBuffet();
        const antes = cur.lineas.length;
        cur = await api.lineaAgregar(cur.venta.id, p.id, 1, precio, null);
        repintar(cur.lineas.length > antes);
      });
    }
    function cambiarProducto(l) {
      let cerrarM;
      const b = crearBuscador({ enLinea: true, alElegir: async (p) => {
        if (p.id === l.producto_id) { toast('Ese es el mismo producto. Cambie la cantidad con los botones + y −.', 'error'); return; }
        cerrarM();
        let precio = null;
        if (p.precio_abierto) {
          const v = await pedir({ titulo: p.nombre, etiqueta: 'Precio final con IVA incluido (₡)', tipo: 'number', boton: 'Cambiar', nota: 'Escriba el monto y toque «Cambiar» (o Enter).' });
          if (v == null) return;
          precio = leerNumero(v);
          if (!(precio > 0)) { toast('Escriba un precio mayor que cero.', 'error'); return; }
        }
        await accion(async () => {
          await api.lineaAgregar(cur.venta.id, p.id, Number(l.cantidad), precio, l.nota || null);
          cur = await api.lineaQuitar(l.id);
          repintar();
          toast('Cambiado: ' + l.descripcion + ' por ' + p.nombre + '. El precio es el del menú.');
        });
      } });
      const m = modal({ titulo: 'Cambiar «' + l.descripcion + '» por otro producto', ancho: 600,
        contenido: h('div.col', h('p.tenue-linea', 'Se conserva la cantidad (' + num(l.cantidad, 3) + ') y la nota. El precio pasa a ser el del menú del producto nuevo.'), b.el),
        botones: [{ texto: 'Cancelar', onclick: (c) => c() }] });
      cerrarM = m.cerrar;
      b.inp.focus();
    }

    function filaLinea(l) {
      const prod = prodPorId.get(l.producto_id);
      const editada = !!prod && !prod.precio_abierto && cents(l.precio_final) !== cents(prod.precio_final);
      const cantidad = Number(l.cantidad);
      const qty = h('input.campo.cant-inp', { type: 'text', inputmode: 'decimal', value: plano(cantidad), 'aria-label': 'Cantidad de ' + l.descripcion, autocomplete: 'off' });
      const precio = h('input.campo.precio-inp', { type: 'text', inputmode: 'decimal', value: plano(l.precio_final), 'aria-label': 'Precio final con IVA de cada ' + l.descripcion, autocomplete: 'off' });
      const nota = h('input.campo.nota-inp', { type: 'text', maxlength: 120, value: l.nota || '', placeholder: 'Nota (ej. sin cebolla)', 'aria-label': 'Nota de ' + l.descripcion, autocomplete: 'off' });
      const editar = (cambio, aviso) => accion(async () => { cur = await api.lineaEditar(l.id, cambio); repintar(); if (aviso) toast(aviso); });
      qty.addEventListener('change', () => {
        const v = leerCant(qty.value);
        if (!(v > 0) || !Number.isFinite(v)) { toast('La cantidad tiene que ser mayor que cero. Para sacar el producto use «Quitar».', 'error'); qty.value = plano(cantidad); return; }
        if (r3(v) !== cantidad) editar({ cantidad: r3(v) });
      });
      precio.addEventListener('change', () => {
        const v = leerNumero(precio.value);
        if (!(v > 0) || !Number.isFinite(v)) { toast('Escriba un precio mayor que cero (con IVA incluido).', 'error'); precio.value = plano(l.precio_final); return; }
        if (cents(v) !== cents(l.precio_final)) editar({ precio: v });
      });
      nota.addEventListener('change', () => { if (nota.value.trim() !== (l.nota || '')) editar({ nota: nota.value.trim() }); });
      [qty, precio, nota].forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); i.blur(); } }));
      return h('div.linea' + (editada ? '.editada' : ''), { 'data-linea': l.id },
        h('div.linea-top', h('span.linea-nombre', l.descripcion), h('span.linea-total', money(l.total_linea))),
        h('div.linea-ctrl',
          h('div.cant',
            h('button.mm', { type: 'button', disabled: cantidad - 1 <= 0, 'aria-label': 'Quitar una unidad de ' + l.descripcion, onclick: () => editar({ cantidad: r3(cantidad - 1) }) }, '−'),
            qty,
            h('button.mm', { type: 'button', 'aria-label': 'Agregar una unidad de ' + l.descripcion, onclick: () => editar({ cantidad: r3(cantidad + 1) }) }, '+')),
          h('label.precio-et', 'Precio de cada uno, con IVA', precio)),
        editada ? h('div.etiqueta-cambio', h('span.chip.espera', 'Precio cambiado'), ' El menú dice ' + money(prod.precio_final)) : null,
        h('div.linea-pie', nota,
          h('button.btn.chico.suave', { type: 'button', onclick: () => cambiarProducto(l) }, 'Cambiar producto'),
          h('button.btn.chico.peligro', { type: 'button', 'aria-label': 'Quitar ' + l.descripcion + ' de la cuenta', onclick: () => accion(async () => { cur = await api.lineaQuitar(l.id); repintar(); toast('Quitado: ' + l.descripcion); }) }, 'Quitar')));
    }

    function pintarCuenta(irAlFinal) {
      if (!asideCuenta) return;
      const scroll = asideCuenta.querySelector('.cuenta-lineas')?.scrollTop || 0;
      if (!cur) {
        asideCuenta.replaceChildren(h('div.vacio-cuenta',
          h('h2', 'No hay cuenta abierta'),
          h('p', 'Toque un producto o búsquelo arriba para empezar una cuenta de Buffet. Si es para esperar, para llevar o express, use «Nueva cuenta».'),
          h('button.btn.primario.grande', { type: 'button', onclick: nuevaCuenta }, 'Nueva cuenta')));
        return;
      }
      const v = cur.venta;
      const puede = cur.lineas.length > 0 && Number(v.total) > 0;
      const detalle = [v.referencia, v.telefono].filter(Boolean).join(' · ');
      const prefBtn = (v.tipo_servicio === 'llevar' || v.tipo_servicio === 'express')
        ? h('button.btn.ambar', { type: 'button', disabled: !cur.lineas.length, onclick: (e) => prefacturar(e.currentTarget) }, v.estado === 'prefacturada' ? 'Imprimir prefactura otra vez' : 'Prefactura (no es factura)')
        : null;
      const lineas = h('div.cuenta-lineas', cur.lineas.length ? cur.lineas.map(filaLinea) : h('div.vacio', { style: 'margin:.8rem 0' }, 'La cuenta está vacía. Toque un producto o búsquelo arriba.'));
      asideCuenta.replaceChildren(
        h('div.cuenta-cab',
          h('div', h('h2', (TIPOS_SERVICIO[v.tipo_servicio] || v.tipo_servicio) + ' ' + numCuenta(v.numero)), h('div.sub', detalle || (v.tipo_servicio === 'buffet' ? 'Sin nombre' : 'Falta el nombre'))),
          h('button.btn.chico', { type: 'button', onclick: editarDatos }, 'Cambiar datos de la cuenta')),
        lineas,
        h('div.cuenta-pie',
          v.estado === 'prefacturada' ? h('div.aviso-pref', h('strong', 'PREFACTURA N° ' + (v.prefactura_numero || '')), 'Esto no es una factura. Sirve para que el cliente revise su cuenta. Para cobrar toque «Cobrar».') : null,
          h('div.total-fila', h('div', h('span.et', 'Total a pagar'), h('small', 'IVA incluido')), h('div.total-monto', { 'aria-live': 'polite' }, money(v.total))),
          h('button.btn.primario.grande.btn-cobrar-aside', { type: 'button', disabled: !puede, onclick: abrirCobro }, 'Cobrar'),
          h('div.acciones-cuenta', prefBtn, h('button.btn.peligro' + (prefBtn ? '' : '.ancho'), { type: 'button', onclick: anularCuenta }, 'Anular cuenta')),
          prefBtn && v.estado !== 'prefacturada' ? h('p.nota-pref', 'La prefactura es solo para que el cliente revise su cuenta. No es una factura.') : null));
      const nuevo = asideCuenta.querySelector('.cuenta-lineas');
      nuevo.scrollTop = irAlFinal ? nuevo.scrollHeight : scroll;
    }

    function pintarMovil() {
      if (!barraMovil) return;
      const total = cur ? money(cur.venta.total) : '';
      const n = cur ? cur.lineas.length : 0;
      const puede = !!cur && n > 0 && Number(cur.venta.total) > 0;
      if (vista === 'productos') {
        barraMovil.replaceChildren(h('button.btn.primario', { type: 'button', onclick: () => cambiarVista('cuenta') }, cur ? 'Ver cuenta (' + n + ') · ' + total : 'Ver cuenta'));
      } else {
        barraMovil.replaceChildren(
          h('button.btn', { type: 'button', onclick: () => cambiarVista('productos') }, 'Agregar productos'),
          h('button.btn.primario', { type: 'button', disabled: !puede, onclick: abrirCobro }, cur ? 'Cobrar ' + total : 'Cobrar'));
      }
    }

    /* ---------- Prefactura ---------- */
    async function prefacturar(btn) {
      await cola;
      if (!cur || !cur.lineas.length) return;
      const id = cur.venta.id;
      await conBoton(btn, async () => {
        if (cur.venta.estado !== 'prefacturada') {
          await accion(async () => { cur = await api.prefacturar(id); repintar(); });
        }
        try { await (await imp()).imprimirPrefactura(id); toast('Prefactura lista. Recuerde: esto no es una factura.'); }
        catch (e) { toast('La prefactura quedó creada pero no se pudo imprimir: ' + (e.message || e), 'error', 8000); }
      });
    }

    /* ---------- Cobro ---------- */
    async function abrirCobro() {
      await cola;
      if (!cur || !cur.lineas.length || !(Number(cur.venta.total) > 0)) { toast('La cuenta está vacía. Agregue productos antes de cobrar.', 'error'); return; }
      const venta = cur.venta, ventaId = venta.id;
      const totalC = cents(venta.total);
      let cliente = cur.cliente || null;
      let actividadFactura = null; // código de actividad pedido por el cliente solo para esta factura (null = la principal del cliente)
      let cedActivo = null;
      let pagos = [];
      let medio = 'efectivo';
      let auto = true;
      let cobrando = false;
      let terminado = false;
      let formato = lsGet('formato') || 'tiquete';
      if (!['tiquete', 'carta', 'ninguno'].includes(formato)) formato = 'tiquete';

      const raiz = h('div');
      let m;
      const mostrar = (n) => raiz.replaceChildren(n);

      /* Vista principal de pago */
      const docTxt = h('span.doc'), cliTxt = h('span.cli');
      const btnElegir = h('button.btn', { type: 'button', onclick: () => vistaClientes() }, 'Elegir cliente (factura)');
      const btnQuitarCli = h('button.btn.suave', { type: 'button', onclick: () => { cliente = null; actividadFactura = null; pintarCliente(); } }, 'Quitar cliente');
      const actEl = h('div.cobro-act', { hidden: true });
      const mediosBtns = Object.entries(MEDIOS).map(([k, v]) => h('button.medio-btn', { type: 'button', dataset: { medio: k }, onclick: () => { medio = k; auto = true; sugerir(); actualizar(); inpMonto.focus(); inpMonto.select(); } }, v));
      const inpMonto = h('input.campo.monto-grande', { type: 'text', inputmode: 'decimal', autocomplete: 'off', 'aria-label': 'Monto' });
      const lblMonto = h('span');
      const inpRef = h('input.campo', { type: 'text', maxlength: 60, autocomplete: 'off' });
      const refEtq = h('label.etq', 'Referencia o número de comprobante (opcional)', inpRef);
      const rapidos = h('div.rapidos',
        h('button.btn', { type: 'button', onclick: () => { auto = true; sugerir(); actualizar(); } }, 'Exacto'),
        RAPIDOS.map((n) => h('button.btn', { type: 'button', onclick: () => { inpMonto.value = String(n); auto = false; actualizar(); } }, money0(n))));
      const btnOtro = h('button.btn', { type: 'button', onclick: agregarOtro }, 'Agregar otro pago (pago mixto)');
      const listaPagos = h('div.col');
      const resumen = h('div.cobro-resumen');
      const errEl = h('div.error-caja', { hidden: true });
      const seg = h('div.seg', { role: 'group', 'aria-label': 'Qué imprimir al cobrar' },
        [['tiquete', 'Tiquete'], ['carta', 'Factura carta'], ['ninguno', 'No imprimir']].map(([k, t]) => h('button', { type: 'button', dataset: { f: k }, onclick: () => { formato = k; lsSet('formato', k); pintarFormato(); } }, t)));
      const btnVolver = h('button.btn', { type: 'button', onclick: () => m.cerrar() }, 'Volver');
      const btnCobrar = h('button.btn.primario.grande.btn-confirmar-cobro', { type: 'button', onclick: confirmarCobro }, 'Cobrar');
      const vistaPago = h('div.cobro',
        h('div.cobro-total', h('div.et', 'Total a cobrar (IVA incluido)'), h('div.monto', money(venta.total))),
        resumen,
        h('div.cobro-doc', h('div', h('div', docTxt), h('div', cliTxt)), h('div.fila', btnElegir, btnQuitarCli)),
        actEl,
        h('div.col', h('strong', 'Forma de pago'), h('div.medios', mediosBtns)),
        h('label.etq', lblMonto, inpMonto),
        rapidos, refEtq, btnOtro, listaPagos, errEl,
        h('div.col', h('strong', 'Al cobrar, imprimir'), seg),
        h('div.cobro-pie', btnVolver, btnCobrar));

      const sinErr = () => { errEl.hidden = true; };
      const conErr = (t) => { errEl.textContent = t; errEl.hidden = false; };
      const borrador = () => {
        const txt = inpMonto.value.trim();
        if (!txt) return { vacio: true };
        const v = leerNumero(txt);
        if (!Number.isFinite(v) || v <= 0) return { malo: true };
        return { v };
      };
      const entradas = () => {
        const b = borrador();
        return b.v ? [...pagos, { medio, recibido: b.v, ref: inpRef.value.trim() }] : pagos;
      };
      function sugerir() {
        if (!auto) return;
        const r = calcularPagos(pagos, totalC);
        const rest = r.error ? 0 : r.falta;
        inpMonto.value = rest > 0 ? (rest / 100).toFixed(2).replace(/\.00$/, '') : '';
      }
      function pintarCliente() {
        docTxt.textContent = 'Documento: ' + (cliente ? TIPOS_DOC['01'] : TIPOS_DOC['04'] + ' (sin cliente)');
        cliTxt.textContent = cliente ? 'Cliente: ' + cliente.nombre + ' · ' + cliente.identificacion : 'Si el cliente pide factura con su nombre, toque «Elegir cliente».';
        btnElegir.textContent = cliente ? 'Cambiar cliente' : 'Elegir cliente (factura)';
        btnQuitarCli.hidden = !cliente;
        pintarActividad();
      }

      /* Actividad del cliente para esta factura: la principal del cliente, o la que pida para esta factura */
      const codigoActividad = () => actividadFactura || cliente?.actividad_codigo || '';
      const descripcionActividad = (cod) => {
        const a = (cliente?.actividades || []).find((x) => x.codigo === cod);
        return !a ? '' : a.manual ? 'escrita a mano' : (a.descripcion || '');
      };
      function pintarActividad() {
        actEl.hidden = !cliente;
        if (!cliente) { actEl.replaceChildren(); return; }
        const cod = codigoActividad();
        const desc = descripcionActividad(cod);
        const lista = cliente.actividades || [];
        const fueraDeLista = !!cod && !!cliente.verificado && lista.some((x) => !x.manual) && !lista.some((x) => x.codigo === cod && !x.manual);
        actEl.replaceChildren(...[
          h('div.act-fila',
            h('div.act-txt', h('span.et', 'Actividad del cliente para esta factura: '),
              cod ? h('strong', cod + (desc ? ' - ' + desc : '')) : h('strong', 'sin código de actividad'),
              actividadFactura ? h('span.chip.espera', 'Solo para esta factura') : null),
            h('button.btn', { type: 'button', onclick: () => vistaActividad() }, 'Cambiar')),
          cod ? null : h('small.tenue', 'Si el cliente declara IVA y pide su actividad, toque «Cambiar» y escriba el código.'),
          fueraDeLista ? h('div.act-aviso', 'Este código no está entre las actividades que Hacienda tiene para este cliente. Hacienda podría rechazar la factura.') : null,
          !cliente.correo ? h('div.act-aviso', 'Este cliente no tiene correo. La factura se emite igual, pero no se le podrá enviar por correo.') : null,
        ].filter(Boolean));
      }
      function pintarFormato() { [...seg.children].forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.f === formato))); }
      function actualizar() {
        mediosBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.medio === medio)));
        lblMonto.textContent = medio === 'efectivo' ? 'Efectivo que entrega el cliente (₡)' : 'Monto a cobrar con ' + MEDIOS[medio] + ' (₡)';
        rapidos.hidden = medio !== 'efectivo';
        refEtq.hidden = medio === 'efectivo';
        const b = borrador();
        const r = calcularPagos(entradas(), totalC);
        sinErr();
        if (b.malo) conErr('No entiendo ese monto. Escriba solo números, por ejemplo 5000.');
        else if (r.error) conErr(r.error);
        listaPagos.replaceChildren(...pagos.map((p, i) => h('div.pago-item',
          h('div', h('div.p-med', MEDIOS[p.medio] + ' · ' + money(p.recibido)), p.ref ? h('div.p-det', 'Referencia: ' + p.ref) : null),
          h('button.btn.chico.peligro', { type: 'button', 'aria-label': 'Quitar el pago de ' + MEDIOS[p.medio], onclick: () => { pagos.splice(i, 1); auto = true; sugerir(); actualizar(); } }, 'Quitar'))));
        resumen.className = 'cobro-resumen';
        if (r.error) { resumen.replaceChildren(h('span', 'Revise los montos')); resumen.classList.add('falta'); }
        else if (r.falta > 0) { resumen.classList.add('falta'); resumen.replaceChildren(h('span', 'Falta por pagar'), h('span.grande', money(r.falta / 100))); }
        else if (r.vuelto > 0) { resumen.classList.add('vuelto'); resumen.replaceChildren(h('span', 'Pago completo. Entregue de vuelto'), h('span.grande', money(r.vuelto / 100))); }
        else if (r.ok) { resumen.classList.add('ok'); resumen.replaceChildren(h('span', 'Pago completo, sin vuelto'), h('span.grande', '✓')); }
        else { resumen.classList.add('falta'); resumen.replaceChildren(h('span', 'Falta por pagar'), h('span.grande', money(totalC / 100))); }
        btnCobrar.textContent = cobrando ? 'Cobrando…' : 'Cobrar ' + money(venta.total);
        btnCobrar.disabled = cobrando || !r.ok || !!b.malo;
        btnOtro.disabled = cobrando || !b.v || !!r.error;
      }
      function agregarOtro() {
        const b = borrador();
        if (!b.v) { conErr('Escriba primero el monto de este pago.'); return; }
        const prueba = calcularPagos([...pagos, { medio, recibido: b.v, ref: '' }], totalC);
        if (prueba.error) { conErr(prueba.error); return; }
        pagos.push({ medio, recibido: b.v, ref: inpRef.value.trim() });
        inpRef.value = ''; auto = true; sugerir(); actualizar();
        inpMonto.focus(); inpMonto.select();
      }
      inpMonto.addEventListener('input', () => { auto = false; actualizar(); });
      inpMonto.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !btnCobrar.disabled) { e.preventDefault(); confirmarCobro(); } });
      inpRef.addEventListener('input', actualizar);

      /* Elegir cliente */
      function vistaClientes() {
        const q = h('input.campo', { type: 'text', placeholder: 'Nombre, cédula o correo', autocomplete: 'off', 'aria-label': 'Buscar cliente' });
        const lista = h('div.lista-clientes');
        let seq = 0;
        async function buscar() {
          const mi = ++seq;
          lista.replaceChildren(h('p.tenue', 'Buscando…'));
          try {
            const r = await api.clientes(socId, q.value.trim());
            if (mi !== seq) return;
            if (!r.length) { lista.replaceChildren(h('div.vacio', 'No hay clientes con ese dato. Puede crearlo con el botón «Crear cliente nuevo».')); return; }
            lista.replaceChildren(...r.map((c) => h('button.cli-item', { type: 'button', onclick: () => { cliente = c; actividadFactura = null; pintarCliente(); actualizar(); mostrar(vistaPago); } },
              h('b', c.nombre), h('small', (TIPOS_ID[c.tipo_id] || '') + ' ' + c.identificacion + (c.correo ? ' · ' + c.correo : '')))));
          } catch (e) { if (mi === seq) lista.replaceChildren(h('div.error-caja', e.message || String(e))); }
        }
        q.addEventListener('input', debounce(buscar, 300));
        mostrar(h('div.col',
          h('h3', 'Elegir cliente'),
          h('p.tenue-linea', 'Con cliente se emite Factura electrónica. Sin cliente se emite Tiquete electrónico.'),
          q, lista,
          h('div.fila', h('button.btn', { type: 'button', onclick: () => mostrar(vistaPago) }, 'Volver al cobro'), h('button.btn.primario', { type: 'button', onclick: () => vistaNuevoCliente() }, 'Crear cliente nuevo'))));
        q.focus();
        buscar();
      }

      function vistaNuevoCliente() {
        const correo = h('input.campo', { type: 'text', inputmode: 'email', maxlength: 160, autocomplete: 'off', autocapitalize: 'none', 'aria-label': 'Correo electrónico' });
        const tel = h('input.campo', { type: 'tel', inputmode: 'tel', maxlength: 20, autocomplete: 'off' });
        const comercial = h('input.campo', { type: 'text', maxlength: 120, autocomplete: 'off' });
        const avisoCorreo = h('small.tenue');
        const refrescarCorreo = () => { avisoCorreo.textContent = correo.value.trim() ? '' : 'Sin correo la factura se emite igual, pero no se le puede enviar por correo.'; };
        correo.addEventListener('input', refrescarCorreo);
        refrescarCorreo();
        const err = h('div.error-caja', { hidden: true });
        const falla = (t, el) => { err.textContent = t; err.hidden = false; el?.focus(); };
        const guardar = h('button.btn.primario', { type: 'button' }, 'Guardar y usar este cliente');
        const usar = (c, aviso) => { cliente = c; actividadFactura = null; pintarCliente(); actualizar(); mostrar(vistaPago); if (aviso) toast(aviso); };
        cedActivo?.destruir();
        // Número, nombre y actividad: se verifican en Hacienda mientras se escribe (js/ui_cedula.js)
        const ced = cedActivo = crearCampoIdentificacion({
          revisarDuplicado: async (id) => (await api.clientes(socId, id)).find((c) => c.identificacion === id) || null,
          accionDuplicado: { texto: 'Usar este cliente', primario: true, fn: (ya) => usar(ya, 'Se usa el cliente que ya estaba guardado.') },
          alTerminar: () => correo.focus(),
        });
        guardar.addEventListener('click', () => conBoton(guardar, async () => {
          err.hidden = true;
          const v = await ced.validar();
          if (v) return falla(v.mensaje, v.campo);
          const cr = leerCorreos(correo.value);
          if (cr.error) return falla(cr.error, correo);
          const telDig = tel.value.replace(/\D/g, '');
          if (telDig && (telDig.length < 8 || telDig.length > 20)) return falla('El teléfono debe tener al menos 8 números.', tel);
          const val = ced.valores();
          // Si la cédula ya existe, se usa el cliente que ya está guardado para no pisar sus datos
          const ya = (await api.clientes(socId, val.identificacion)).find((c) => c.identificacion === val.identificacion);
          if (ya) return usar(ya, 'Ya existía un cliente con esa identificación. Se usa el que estaba guardado.');
          const c = await api.clienteGuardar({
            sociedad_id: socId, solo_nuevo: true, tipo_id: val.tipo_id, identificacion: val.identificacion, nombre: val.nombre,
            nombre_comercial: comercial.value.trim(), correo: cr.lista.join(', '), telefono: telDig, actividad_codigo: val.actividad_codigo,
            sin_verificar_motivo: val.sin_verificar_motivo,
          });
          usar(c, c.verificado ? 'Cliente guardado.' : 'Cliente guardado. Quedó marcado como sin verificar en Hacienda.');
        }));
        mostrar(h('div.col',
          h('h3', 'Crear cliente nuevo'),
          h('p.tenue-linea', 'Escriba la cédula: el sistema la busca en Hacienda y llena el nombre y la actividad. El correo y lo demás son opcionales.'),
          ced.el,
          h('label.etq', 'Correo electrónico (opcional)', correo, avisoCorreo),
          h('details.mas-datos', h('summary', 'Más datos (opcionales)'), h('div.col', { style: 'margin:.5rem 0' },
            h('label.etq', 'Teléfono', tel), h('label.etq', 'Nombre comercial', comercial))),
          err,
          h('div.fila', h('button.btn', { type: 'button', style: 'flex:1 1 120px', onclick: () => vistaClientes() }, 'Volver'), guardar)));
        guardar.style.flex = '2 1 200px';
        ced.enfocar();
      }

      /* Cambiar la actividad que va en ESTA factura (no cambia al cliente salvo que se marque guardarla como principal) */
      function vistaActividad() {
        let lista = (cliente.actividades || []).map((x) => ({ ...x }));
        if (cliente.actividad_codigo && !lista.some((x) => x.codigo === cliente.actividad_codigo)) lista.unshift({ codigo: cliente.actividad_codigo, descripcion: '', manual: true });
        const err = h('div.error-caja', { hidden: true });
        const nota = h('div.act-aviso.info', { hidden: true });
        const cajaLista = h('div.lista-clientes');
        const chk = h('input', { type: 'checkbox' });
        const inp = h('input.campo', { type: 'text', inputmode: 'decimal', maxlength: 6, autocomplete: 'off', placeholder: 'Ej. 5610.0', 'aria-label': 'Otro código de actividad' });
        inp.addEventListener('input', () => { const v = limpiarActividad(inp.value); if (v !== inp.value) inp.value = v; });
        let ocupado = false;
        async function elegir(cod) {
          if (ocupado) return;
          err.hidden = true;
          ocupado = true;
          try {
            if (chk.checked) {
              cliente = await apiM.clienteActividadPrincipal(cliente.id, cod);
              actividadFactura = null;
              toast('Quedó como actividad principal del cliente.');
            } else actividadFactura = cod === (cliente.actividad_codigo || '') ? null : cod;
          } catch (e) { ocupado = false; err.textContent = e.message || String(e); err.hidden = false; return; }
          ocupado = false;
          pintarCliente(); actualizar(); mostrar(vistaPago);
        }
        function pintarLista() {
          const actual = codigoActividad();
          cajaLista.replaceChildren(...(lista.length ? lista.map((x) => h('button.cli-item', { type: 'button', 'aria-pressed': String(x.codigo === actual), onclick: () => elegir(x.codigo) },
            h('b', x.codigo + (x.codigo === actual ? ' (la que está en esta factura)' : '')),
            h('small', (x.manual ? 'Escrita a mano' : (x.descripcion || 'Sin descripción')) + (x.codigo === cliente.actividad_codigo ? ' · Principal del cliente' : '')))) : [h('div.vacio', 'Este cliente no tiene actividades guardadas. Escriba el código abajo o consulte a Hacienda.')]));
        }
        const btnHac = h('button.btn', { type: 'button' }, 'Consultar actividades en Hacienda');
        btnHac.hidden = !/^0[1-4]$/.test(cliente.tipo_id || '');
        btnHac.addEventListener('click', () => conBoton(btnHac, async () => {
          btnHac.textContent = 'Consultando…';
          nota.hidden = true;
          let r = null;
          try { r = await apiM.cedula(cliente.identificacion, { forzar: true }); } catch { r = null; }
          nota.hidden = false;
          if (!r || !r.ok) { nota.textContent = 'Hacienda no respondió o no encontró este número. Puede escribir el código a mano.'; return; }
          const mapa = new Map(lista.map((x) => [x.codigo, x]));
          (r.actividades || []).forEach((a) => mapa.set(a.codigo, { ...(mapa.get(a.codigo) || {}), ...a, manual: false }));
          lista = [...mapa.values()];
          pintarLista();
          nota.textContent = (r.actividades || []).length ? 'Hacienda tiene ' + r.actividades.length + (r.actividades.length === 1 ? ' actividad' : ' actividades') + ' para este cliente. Toque la que va en la factura.' : 'Hacienda no tiene actividades registradas para este cliente. Puede escribir el código a mano.';
        }));
        const btnOtro = h('button.btn.primario', { type: 'button', style: 'flex:1 1 150px' }, 'Usar este código');
        btnOtro.addEventListener('click', () => {
          const v = inp.value.trim();
          if (!v) return falla('Escriba el código de actividad (por ejemplo 5610.0).');
          const e = errorActividad(v);
          if (e) return falla(e);
          elegir(v);
        });
        const falla = (t) => { err.textContent = t; err.hidden = false; inp.focus(); };
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); btnOtro.click(); } });
        pintarLista();
        mostrar(h('div.col',
          h('h3', 'Actividad para esta factura'),
          h('p.tenue-linea', 'Cliente: ' + cliente.nombre + '. Si el cliente tiene varias actividades, elija la que pide en esta factura. Esto no cambia los datos del cliente, salvo que marque la casilla de abajo.'),
          cajaLista, btnHac, nota,
          h('label.etq', 'O escriba otro código de actividad', inp, h('small', 'Cuatro números, un punto y un número (por ejemplo 5610.0), o seis números seguidos.')),
          h('label.cobro-chk', chk, h('span', h('b', 'Guardar también como actividad principal del cliente'), h('small', 'Si no la marca, el código vale solo para esta factura y el cliente queda como estaba.'))),
          err,
          h('div.fila', h('button.btn', { type: 'button', style: 'flex:1 1 150px', onclick: () => mostrar(vistaPago) }, 'Volver al cobro'), btnOtro)));
        inp.focus();
      }

      /* Confirmar el cobro: un solo intento a la vez; si falla la red se revisa si igual quedó cobrado */
      async function confirmarCobro() {
        if (cobrando || terminado) return;
        const b = borrador();
        const r = calcularPagos(entradas(), totalC);
        if (b.malo || !r.ok) { conErr(r.error || 'Los pagos todavía no cubren el total.'); return; }
        cobrando = true; actualizar();
        const aplicados = r.aplicados.map((p) => ({ medio: p.medio, monto: p.monto, referencia: p.referencia }));
        let comp = null, aviso = '';
        try {
          comp = await api.cobrar(ventaId, aplicados, cliente ? cliente.id : null, app.terminal, cliente ? actividadFactura : null);
        } catch (e) {
          try {
            const v = await api.venta(ventaId);
            if (v.venta.estado === 'facturada' && v.comprobante) { comp = await api.comprobante(v.comprobante.id); aviso = 'Hubo un problema de conexión, pero el cobro SÍ quedó registrado. No lo repita.'; }
          } catch { /* sin conexión: se muestra el error original */ }
          if (!comp) { cobrando = false; if (vivo && m) { actualizar(); conErr('No se pudo cobrar: ' + (e.message || e) + ' Revise e intente de nuevo; no se cobró nada.'); } return; }
        }
        terminado = true;
        m.cerrar();
        try { sacarDeLista(ventaId); cur = null; await pasarALaSiguiente(); if (vivo) repintar(); } catch { /* la barra se refresca sola */ }
        if (vivo) exito(comp, r.vuelto / 100, aviso, formato);
      }

      m = modal({ titulo: 'Cobrar', contenido: raiz, ancho: 720, alCerrar: () => { cedActivo?.destruir(); if (vivo && !terminado && buscador && fino()) buscador.inp.focus(); } });
      mostrar(vistaPago);
      pintarCliente(); pintarFormato(); sugerir(); actualizar();
      inpMonto.focus(); inpMonto.select();
    }

    /* ---------- Pantalla de éxito ---------- */
    function exito(comp, vuelto, aviso, formato) {
      const compId = comp.id;
      let abierto = true;
      const chip = h('span.chip');
      const msgEstado = h('p.tenue-linea');
      const impEstado = h('p.tenue-linea');
      const pintarEstado = (c) => {
        const e = c.estado || 'pendiente';
        chip.textContent = ESTADOS[e] || e;
        chip.className = 'chip ' + (e === 'aceptado' ? 'ok' : (e === 'rechazado' || e === 'error') ? 'mal' : 'espera');
        msgEstado.className = 'tenue-linea' + (e === 'rechazado' ? ' msg-mal' : '');
        msgEstado.textContent = e === 'aceptado' ? 'Hacienda lo aceptó.'
          : e === 'rechazado' ? 'Hacienda lo rechazó' + (c.mensaje ? ': ' + c.mensaje : '.') + ' Avise a la persona encargada; el documento queda en «Documentos del día».'
          : e === 'error' ? 'Hubo un error al enviarlo' + (c.mensaje ? ': ' + c.mensaje : '') + '. El sistema volverá a intentarlo.'
          : e === 'enviado' ? 'Enviado a Hacienda, esperando la respuesta. El cliente ya puede irse.'
          : 'En cola para enviarse a Hacienda. No hace falta esperar; el cliente ya puede irse.';
      };
      pintarEstado(comp);
      async function vigilar() {
        for (let i = 0; i < 60 && abierto && vivo; i++) {
          await new Promise((r) => setTimeout(r, 4000));
          if (!abierto || !vivo) return;
          try { const c = await api.comprobante(compId); pintarEstado(c); if (c.estado === 'aceptado' || c.estado === 'rechazado') return; } catch { /* reintenta */ }
        }
      }
      async function imprimir(fmt) {
        impEstado.className = 'tenue-linea'; impEstado.textContent = 'Enviando a la impresora…';
        try {
          await (await imp()).imprimirComprobante(compId, { formato: fmt, copias: 1 });
          impEstado.textContent = fmt === 'carta' ? 'Comprobante en formato carta enviado a imprimir.' : 'Comprobante en formato tiquete (80 mm) enviado a imprimir.';
        } catch (e) {
          impEstado.className = 'tenue-linea msg-mal';
          impEstado.textContent = 'No se pudo imprimir: ' + (e.message || e) + ' Toque «Imprimir otra vez» o revise el botón «Impresora».';
        }
      }
      let cerrarM;
      const fmtPrincipal = formato === 'carta' ? 'carta' : 'tiquete';
      const contenido = h('div.exito',
        h('div.gran', '✓ Cobro registrado'),
        aviso ? h('div.error-caja', aviso) : null,
        h('div', h('div', (TIPOS_DOC[comp.tipo_doc] || 'Comprobante') + (comp.consecutivo ? ' N° ' + comp.consecutivo : '')), h('div.gran', money(comp.total))),
        vuelto > 0 ? h('div.vuelto-caja', h('div', 'Entregue de vuelto'), h('div.monto', money(vuelto))) : h('p.tenue-linea', 'Sin vuelto.'),
        h('div.estado-caja', chip), msgEstado, impEstado,
        h('div.botones',
          h('button.btn.primario.grande', { type: 'button', onclick: () => { cerrarM(); nuevaCuenta(); } }, 'Nueva cuenta'),
          h('button.btn', { type: 'button', onclick: () => imprimir(fmtPrincipal) }, 'Imprimir otra vez'),
          h('button.btn', { type: 'button', onclick: () => imprimir('carta') }, 'Imprimir factura carta'),
          h('button.btn.suave', { type: 'button', onclick: () => cerrarM() }, 'Listo, cerrar')));
      const mo = modal({ titulo: 'Cobro listo', contenido, ancho: 520, alCerrar: () => { abierto = false; if (vivo && buscador && fino()) buscador.inp.focus(); } });
      cerrarM = mo.cerrar;
      if (formato !== 'ninguno') imprimir(fmtPrincipal); else impEstado.textContent = 'No se imprimió (usted eligió no imprimir).';
      vigilar();
    }

    /* ---------- Arranque ---------- */
    async function iniciar() {
      turnoMostrado = app.turno?.id || null;
      if (!turnoMostrado) { cur = null; pintarSinTurno(); return; }
      root.replaceChildren(h('p.cargando', 'Cargando la caja…'));
      try {
        await Promise.all([cargarCatalogo(), cargarAbiertas()]);
        await elegirInicial();
      } catch (e) {
        root.replaceChildren(h('div.vacio', h('p', 'No se pudo cargar la caja.'), h('p.tenue', e.message || String(e)), h('button.btn', { onclick: () => iniciar() }, 'Intentar de nuevo')));
        return;
      }
      armarCaja();
    }

    // Escribir con el teclado (o el lector de códigos) en cualquier parte lleva el texto al buscador
    function teclaGlobal(e) {
      if (!buscador || e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
      if (document.querySelector('.modal-fondo')) return;
      const t = e.target;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      buscador.inp.focus();
    }
    document.addEventListener('keydown', teclaGlobal);

    const alCambio = () => { if (vivo && (app.turno?.id || null) !== turnoMostrado) iniciar(); };
    document.addEventListener('app:cambio', alCambio);
    window.addEventListener('resize', midePegajosos);

    // Refresco silencioso por si otro equipo (tableta, celular) cambia las cuentas
    async function refrescoSilencioso() {
      if (!vivo || document.hidden || !cajaEl || ocupadas > 0 || document.querySelector('.modal-fondo')) return;
      try {
        const antes = JSON.stringify(abiertas.map((a) => [a.id, a.total, a.estado, a.lineas, a.referencia]));
        const nuevas = (await api.ventasAbiertas(socId)) || [];
        if (ocupadas > 0 || !vivo) return;
        if (JSON.stringify(nuevas.map((a) => [a.id, a.total, a.estado, a.lineas, a.referencia])) === antes) return;
        abiertas = nuevas;
        const enUso = document.activeElement && asideCuenta?.contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement.tagName);
        const mia = cur && abiertas.find((a) => a.id === cur.venta.id);
        if (cur && !mia) { cur = null; await elegirInicial(); }
        else if (mia && !enUso && (Number(mia.total) !== Number(cur.venta.total) || Number(mia.lineas) !== cur.lineas.length)) cur = await api.venta(cur.venta.id);
        pintarBarra(); pintarCuenta(); pintarMovil(); actualizarInsignias();
      } catch { /* sin conexión: se intenta de nuevo luego */ }
    }
    timers.push(setInterval(refrescoSilencioso, 30000));
    const alVolver = () => { if (!document.hidden) refrescoSilencioso(); };
    document.addEventListener('visibilitychange', alVolver);

    await iniciar();

    return () => {
      vivo = false;
      timers.forEach(clearInterval);
      document.removeEventListener('keydown', teclaGlobal);
      document.removeEventListener('app:cambio', alCambio);
      document.removeEventListener('visibilitychange', alVolver);
      window.removeEventListener('resize', midePegajosos);
      document.body.classList.remove('fx-caja');
    };
  },
};
