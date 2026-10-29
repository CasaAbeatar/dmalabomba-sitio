// Caja: la pantalla que usa el cajero todo el día (abrir caja, cuentas, productos, prefactura y cobro).
import { crearZonaEfectivo } from './ui_efectivo_rapido.js';
import { errorActividad, limpiarActividad } from './ui_cedula.js';
import { selectorCliente } from './ui_cliente.js';
import { apiM } from './api_mantenimiento.js';
import { esTransitorio } from './api.js';
import { TARIFAS_IVA, tarifaDeLinea, desgloseIva, tarifaHabitual } from './iva.js';
import { infoActividad, textoActividad } from './actividades.js';
import { h, money, money0, num, leerNumero, toast, modal, pedir, confirmar, conBoton, esqueleto, bloqueError, nombreLocal, TIPOS_SERVICIO, TIPOS_DOC, TIPOS_ID, MEDIOS, describirEstado, traducirHacienda, numeroDoc, nombrePropio } from './util.js';

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
// Lo que se muestra en lugar del precio: el genérico pide detalle y precio al agregarlo
const textoPrecio = (p) => (p.descripcion_libre ? 'Detalle y precio' : p.precio_abierto ? 'Precio abierto' : money(p.precio_final));
const fino = () => window.matchMedia?.('(pointer:fine)').matches ?? true;
// Lleva un campo a la parte que sí se ve de su ventana cuando se abre el teclado del celular (el pie con los botones lo tapaba).
// Se repite un instante después porque el teclado tarda en abrirse, y otra vez si la ventana visible cambia de tamaño.
// Si el teclado tapa la parte de abajo SIN achicar la página (iPhone y Android recientes), se agrega espacio al final del contenido
// mientras el campo tiene el foco, para que pueda subir lo suficiente. El espacio va dentro del contenido (no en la ventana) para que el
// pie fijo con «Volver» y «Cobrar» no cambie de lugar.
function llevarALaVista(el) {
  const cont = el.closest('.modal-cuerpo');
  const relleno = el.closest('.cobro') || cont;
  const ir = () => {
    if (!el.isConnected || document.activeElement !== el) return;
    const vv = window.visualViewport;
    const tapado = vv ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0;
    if (relleno) relleno.style.paddingBottom = tapado > 80 ? tapado + 'px' : '';
    try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch { el.scrollIntoView(); }
    if (tapado > 80) {
      const r = el.getBoundingClientRect(), limite = vv.offsetTop + vv.height - 16;
      if (r.bottom > limite) (cont || document.scrollingElement).scrollTop += r.bottom - limite;
    }
  };
  setTimeout(ir, 60);
  setTimeout(ir, 350);
  const vv = window.visualViewport;
  if (vv) vv.addEventListener('resize', ir);
  el.addEventListener('blur', () => {
    if (vv) vv.removeEventListener('resize', ir);
    if (relleno) relleno.style.paddingBottom = '';
  }, { once: true });
}
// Envuelve lo que hace un botón: si algo falla, se avisa en palabras en vez de dejar un error sin atender en la consola
const seguro = (fn) => (...a) => Promise.resolve().then(() => fn(...a)).catch((e) => { console.error(e); toast((e && e.message) || 'Algo no salió bien. Intente de nuevo.', 'error', 7000); });
// Motivos que se tocan de un solo toque al anular una cuenta abierta
const MOTIVOS_ANULAR = ['El cliente se fue', 'Error al digitar', 'El cliente no recogió el pedido', 'Cuenta repetida'];
let moduloImp = null;
const imp = async () => {
  try { moduloImp = await import('./imprimir.js'); return moduloImp; }
  catch (e) { console.error(e); throw new Error('La impresión no está disponible por ahora. Recargue la página e intente de nuevo.'); }
};
// Ajustes de impresión de ESTE aparato: son los mismos que edita el botón «Impresora» (imprimir.js: leerAjustes).
// Si el módulo de impresión todavía no cargó, se leen directo de donde él los guarda con los mismos valores por defecto.
function ajustesImp() {
  try { if (moduloImp?.leerAjustes) return moduloImp.leerAjustes(); } catch { /* se usa la lectura directa */ }
  let g = {};
  try { g = JSON.parse(localStorage.getItem('fx_impresion') || '{}') || {}; } catch { g = {}; }
  return { papel: Number(g.papel) === 58 ? 58 : 80, copias: Math.min(5, Math.max(1, parseInt(g.copias, 10) || 1)), auto: !!g.auto, formato: g.formato === 'carta' ? 'carta' : 'tiquete', hoja: g.hoja === 'a4' ? 'a4' : 'carta' };
}
const textoImpresion = (a) => (a.formato === 'carta' ? 'factura carta' : 'tiquete de ' + a.papel + ' mm') + ', ' + a.copias + (a.copias === 1 ? ' copia' : ' copias');
// Estado del comprobante para la pantalla de éxito. Es el de describirEstado (util.js) más un caso: Hacienda lo aceptó PERO dejó un aviso
// (por ejemplo, la ubicación del emisor). En ese caso se dice «Aceptado con aviso» y el aviso en palabras simples, para que no parezca un rechazo.
function describirCobro(estado, mensaje) {
  const d = describirEstado(estado, mensaje);
  const items = traducirHacienda(mensaje).items;
  if (d.estado === 'aceptado') {
    const avisos = items.filter((i) => i.codigo);
    if (!avisos.length) return d;
    return { ...d, chip: 'Aceptado con aviso', clase: 'espera',
      texto: 'Cobro registrado. Hacienda aceptó el comprobante, pero dejó un aviso: ' + avisos.map((i) => i.texto).join(' ') + ' No hace falta repetir el cobro.' };
  }
  if (d.estado === 'rechazado') {
    // El código -37 (provincia, cantón o distrito del emisor) es solo un aviso: no es la causa del rechazo, así que no se mezcla con el motivo real
    const causas = items.filter((i) => i.codigo !== '-37');
    if (causas.length && causas.length < items.length) {
      return { ...d, texto: 'Cobro registrado, pero Hacienda no aceptó el comprobante. Motivo: ' + causas.map((i) => i.texto).join(' ') + ' Avise a la persona encargada; el documento queda en «Documentos del día».' };
    }
  }
  return d;
}
// Firma de una cuenta (para saber si un cambio que falló por la red sí llegó al servidor)
const firmaCuenta = (c) => JSON.stringify([c.venta.total, c.venta.estado, (c.lineas || []).map((l) => [l.id, Number(l.cantidad), cents(l.precio_final), l.nota || '', l.producto_id, l.descripcion, l.codigo_tarifa_iva || '', Number(l.tarifa_iva)])]);

const AYUDA_TIPO = {
  buffet: 'Cuenta rápida, sin datos del cliente',
  espera: 'Cliente que regresa a pagar',
  llevar: 'Pedido para llevar: nombre y teléfono',
  express: 'Pedido express: nombre y teléfono',
};
const RAPIDOS = [1000, 2000, 5000, 10000, 20000];

// Cuentas con un cobro en camino ahora mismo. Vale para todo el módulo (no solo para una ventana): así ninguna ventana nueva, ni la Caja montada otra vez,
// puede enviar la misma venta dos veces.
const ventasEnCobro = new Set();
// Cuentas cuyo cobro se envió pero no se pudo confirmar (sin conexión): no se vuelve a cobrar hasta que se revise con «Revisar si se cobró».
const ventasEnDuda = new Set();

// Si el cobro termina cuando la Caja ya no está en pantalla (la persona cambió de pantalla con el cobro en camino), el resultado no se pierde de vista nunca:
// sale una ventana con el número del documento, el estado y, si la impresión automática está encendida, se imprime igual.
function avisoCobroSinCaja(comp, app, aviso) {
  const aj = ajustesImp();
  const num = numeroDoc(comp.consecutivo);
  const nombreDoc = comp.tipo_doc === '01' ? 'factura' : 'tiquete';
  const impEstado = h('p.tenue-linea', { role: 'status' });
  const d = describirCobro(comp.estado, comp.mensaje);
  const imprimir = async (fmt) => {
    impEstado.className = 'tenue-linea'; impEstado.textContent = 'Enviando a la impresora…';
    try {
      await (await imp()).imprimirComprobante(comp.id, { formato: fmt, copias: aj.copias });
      impEstado.textContent = 'Se abrió la impresión. Si no salió, toque el botón otra vez.';
    } catch (e) { impEstado.className = 'tenue-linea msg-mal'; impEstado.textContent = 'No se pudo imprimir: ' + (e.message || e) + ' Toque el botón otra vez.'; }
  };
  const texto = 'Cobro registrado, ' + nombreDoc + (num ? ' N.° ' + num : '') + ' por ' + money(comp.total) + '.';
  toast(texto, 'ok', 12000);
  modal({ titulo: 'Cobro registrado', ancho: 480,
    contenido: h('div.exito',
      h('div.gran', '✓ ' + texto),
      aviso ? h('div.error-caja', aviso) : null,
      h('p.tenue-linea', 'El cobro terminó mientras estaba en otra pantalla. ' + d.texto),
      impEstado,
      h('div.botones',
        h('button.btn.primario.grande', { type: 'button', onclick: () => imprimir(aj.formato === 'carta' ? 'carta' : 'tiquete') }, aj.formato === 'carta' ? 'Imprimir factura carta' : 'Imprimir tiquete'),
        h('button.btn', { type: 'button', onclick: () => app.ir('anular') }, 'Ver en «Anular y reimprimir»'))),
    botones: [{ texto: 'Listo', clase: 'primario', onclick: (c) => c() }] });
  if (aj.auto) imprimir(aj.formato === 'carta' ? 'carta' : 'tiquete');
}

// Dirección del cliente incompleta (solo avisa si la base mandó esos datos: así no se asusta a nadie por una llave que no llegó)
const direccionIncompleta = (c) => !!c && ('provincia' in c || 'otras_senas' in c) && (!c.provincia || !c.canton || !c.distrito || String(c.otras_senas || '').trim().length < 5);

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
  if (ef > 0 && efAplic === 0) return { ok: false, error: 'El total ya está cubierto con los otros medios de pago. Quite el monto en efectivo o baje el otro pago.', falta: 0, vuelto: 0, aplicados: [] };
  let restoEf = resto;
  const aplicados = [];
  for (const e of entradas) {
    const c = cents(e.recibido);
    if (e.medio === 'efectivo') {
      const a = Math.min(c, restoEf); restoEf -= a;
      if (a > 0) aplicados.push({ medio: 'efectivo', monto: a / 100, referencia: e.ref || null });
    } else if (c > 0) aplicados.push({ medio: e.medio, monto: c / 100, referencia: e.ref || null });
  }
  // Cada pago en efectivo lleva lo que entregó el cliente ("recibido"): lo aplicado a la venta, y el vuelto va en el último pago en efectivo.
  const efectivos = aplicados.filter((a) => a.medio === 'efectivo');
  efectivos.forEach((a) => { a.recibido = a.monto; });
  if (efectivos.length && vuelto > 0) { const u = efectivos[efectivos.length - 1]; u.recibido = (Math.round(u.monto * 100) + vuelto) / 100; }
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
    let catalogoJson = '';
    let barraAviso = null, avisoEl = null;
    let productos = [];
    const prodPorId = new Map();
    let abiertas = [];
    let cur = null; // respuesta de fx_venta de la cuenta activa
    let cajonSel = null;
    let grupoSel = null; // nivel 3: clave de 4 dígitos (cajón + producto) cuyos modificadores se están viendo; null = nivel 2
    let vista = 'productos'; // celular: productos | cuenta
    let turnoMostrado = null;
    let ocupadas = 0;
    let cola = Promise.resolve();
    let zonaEfectivo = null; // las cajitas de entrada y salida de efectivo (arriba a la derecha); se actualizan solas, sin tocar la cuenta
    let buscador = null, asideCuenta = null, barraCuentas = null, barraExtras = null, gridProd = null, tabsCajon = null, barraMovil = null, cajaEl = null, buscadorWrap = null;
    const tarjetas = new Map(); // producto_id -> {badge}
    const tarjetasGrupo = new Map(); // clave de producto con modificadores -> badge con el total de sus modificadores en la cuenta
    const timers = [];

    // Las acciones sobre la cuenta se hacen una tras otra para que dos toques rápidos no se pisen.
    // Si la falla es de red o del servidor (transitoria), la cuenta se queda como estaba en pantalla y sale «Intentar de nuevo».
    function quitarAviso() { avisoEl?.remove(); avisoEl = null; }
    function avisoDeRed(e, fn, antes, idCuenta) {
      quitarAviso();
      const intentar = h('button.btn.primario', { type: 'button' }, 'Intentar de nuevo');
      intentar.addEventListener('click', () => conBoton(intentar, async () => {
        // Antes de repetir se lee la cuenta del servidor: si el cambio sí había llegado, no se vuelve a hacer (así no se duplica un producto)
        const v = await api.venta(idCuenta);
        cur = v; guardarActiva();
        if (firmaCuenta(v) !== antes) { quitarAviso(); repintar(); toast('El cambio sí se había guardado. La cuenta se actualizó con lo que hay en el servidor; revise que esté como esperaba.'); return; }
        quitarAviso();
        await accion(fn);
      }));
      avisoEl = h('div.aviso-red', { role: 'alert' },
        h('div.aviso-red-txt', h('strong', 'El último cambio no se guardó. '), (e.message || '') + ' Su cuenta sigue en pantalla.'),
        h('div.fila', intentar, h('button.btn', { type: 'button', onclick: quitarAviso }, 'Dejar la cuenta como está')));
      barraAviso?.replaceChildren(avisoEl);
    }
    // estado (opcional): recibe { ok } o { error }, para que una ventana pueda quedarse abierta si el servidor rechazó lo escrito
    function accion(fn, estado) {
      const p = cola.then(async () => {
        if (!vivo) return;
        ocupadas++;
        const antes = cur ? firmaCuenta(cur) : null, idCuenta = cur?.venta?.id || null;
        try { await fn(); if (estado) estado.ok = true; if (avisoEl) quitarAviso(); }
        catch (e) {
          if (estado) estado.error = e;
          if (esTransitorio(e) && idCuenta) avisoDeRed(e, fn, antes, idCuenta);
          else toast(e.message || String(e), 'error', 7000);
          // Alguien desactivó ese producto desde otro aparato: se vuelve a pedir el menú para que ya no aparezca
          if (/desactivado y no se puede vender/i.test(e?.message || '')) setTimeout(revisarCatalogo, 500);
          if (cur && asideCuenta) pintarCuenta();
        }
        finally { ocupadas--; }
      });
      cola = p;
      return p;
    }

    /* ---------- Carga de datos ---------- */
    // El catálogo queda en memoria (api.catalogo): al volver a la Caja o cambiar de local no se pide otra vez hasta que alguien edite productos
    function usarCatalogo(c) {
      catalogo = c;
      catalogoJson = JSON.stringify(c);
      productos = (c.productos || []).map((p) => ({ ...p, _n: norm(p.nombre) })).sort((a, b) => (a.codigo < b.codigo ? -1 : a.codigo > b.codigo ? 1 : 0));
      prodPorId.clear();
      productos.forEach((p) => prodPorId.set(p.id, p));
      if (!c.cajones.some((x) => x.id === cajonSel)) cajonSel = c.cajones[0]?.id || null;
    }
    async function cargarCatalogo() { usarCatalogo(await api.catalogo(socId)); }
    // Cada 5 minutos se vuelve a pedir en silencio por si se cambió un precio desde otro aparato
    async function revisarCatalogo() {
      if (!vivo || document.hidden || !cajaEl || ocupadas > 0 || document.querySelector('.modal-fondo')) return;
      try {
        const nuevo = await api.catalogo(socId, false, { forzar: true });
        if (!vivo || JSON.stringify(nuevo) === catalogoJson) return;
        usarCatalogo(nuevo);
        pintarCajones(); pintarProductos();
        if (cur) { cur = await api.venta(cur.venta.id); repintar(); }
        toast('Se actualizaron los productos o precios del menú.');
      } catch { /* sin conexión: queda el menú que ya está en pantalla */ }
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
      zonaEfectivo?.destruir();
      zonaEfectivo = crearZonaEfectivo({ turnoId: null, alAbrirCaja: () => { try { fondo.scrollIntoView({ block: 'center' }); } catch { /* nada */ } fondo.focus(); } });
      const atajos = [0, 10000, 20000, 50000].map((n) => h('button.btn', { type: 'button', onclick: () => { fondo.value = String(n); fondo.focus(); } }, n === 0 ? 'Sin fondo (₡0)' : money0(n)));
      root.replaceChildren(h('div.caja-sin-turno', zonaEfectivo.el), h('div.caja-abrir.tarjeta',
        h('h1', 'Abrir caja'),
        h('p', 'La caja de ' + nombreLocal(app.soc) + ' está cerrada. Para empezar a vender, escriba solo el efectivo con que abre la caja.'),
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
      barraAviso = h('div.avisos-caja');
      zonaEfectivo?.destruir();
      zonaEfectivo = crearZonaEfectivo({ turnoId: turnoMostrado });
      cajaEl = h('div.caja.v-' + vista,
        barraAviso,
        h('div.caja-cuerpo',
          h('div.caja-izq', barraCuentas, barraExtras, buscadorWrap,
            h('section.caja-catalogo', { 'aria-label': 'Productos' }, tabsCajon, gridProd)),
          h('div.caja-der', zonaEfectivo.el, asideCuenta)),
        barraMovil);
      root.replaceChildren(cajaEl);
      buscador.inp.addEventListener('focus', () => { cajaEl.classList.add('bus-activo'); if (!fino()) setTimeout(irAlBuscador, 250); });
      // La barra compacta se queda un instante después de cerrar el teclado: si no, al tocar «Cobrar» el botón se movería antes de soltar el dedo y el toque se perdería
      buscador.inp.addEventListener('blur', () => setTimeout(() => { if (cajaEl && document.activeElement !== buscador.inp) cajaEl.classList.remove('bus-activo'); }, 300));
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
        }, h('span.res-nom', p.nombre), h('span.res-pre' + (p.descripcion_libre || p.precio_abierto ? '.abierto' : ''), textoPrecio(p)),
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
        onclick: () => { cajonSel = c.id; grupoSel = null; pintarCajones(); pintarProductos(); },
      }, c.nombre)));
    }
    // Cascada de 3 niveles, igual que Prisma: cajón (nivel 1) → producto (nivel 2) → modificador (nivel 3).
    // Un artículo con modificador_nombre pertenece a un producto con opciones (código CCPPMM, mismo CCPP).
    // Los demás se cobran con un toque en el nivel 2. El modificador es el artículo final: lleva su propio precio, CABYS e IVA.
    function nivelesDelCajon(lista) {
      const salida = [], grupos = new Map();
      for (const p of lista) {
        if (!p.modificador_nombre) { salida.push({ directo: p }); continue; }
        const clave = p.codigo.slice(0, 4);
        let g = grupos.get(clave);
        if (!g) { g = { clave, nombre: p.producto_nombre || p.nombre, opciones: [] }; grupos.set(clave, g); salida.push({ grupo: g }); }
        g.opciones.push(p);
      }
      return salida;
    }
    const sonido = (b) => { b.classList.add('tocado'); setTimeout(() => b.classList.remove('tocado'), 180); };
    function tarjetaArticulo(p, nombre, alAgregar) {
      const badge = h('span.prod-cuenta', { hidden: true, 'aria-hidden': 'true' });
      const btn = h('button.prod', {
        type: 'button', 'aria-label': 'Agregar ' + p.nombre + ', ' + (p.descripcion_libre ? 'se escribe el detalle y el precio' : p.precio_abierto ? 'precio abierto' : money(p.precio_final)),
        onclick: (e) => { sonido(e.currentTarget); alAgregar?.(); agregarProducto(p); },
      }, h('span.prod-nombre', nombre),
      h('span.prod-pie', h('span.prod-precio' + (p.precio_abierto || p.descripcion_libre ? '.abierto' : ''), textoPrecio(p)), h('span.prod-cod', p.codigo)), badge);
      tarjetas.set(p.id, badge);
      return btn;
    }
    function tarjetaGrupo(g) {
      const precios = g.opciones.filter((p) => !p.precio_abierto && !p.descripcion_libre && Number(p.precio_final) > 0).map((p) => Number(p.precio_final));
      const min = precios.length ? Math.min(...precios) : null, max = precios.length ? Math.max(...precios) : null;
      const n = g.opciones.length;
      const resumen = min == null ? 'Precio abierto' : min === max ? money(min) : 'desde ' + money(min);
      const badge = h('span.prod-cuenta', { hidden: true, 'aria-hidden': 'true' });
      const btn = h('button.prod.prod-grupo', {
        type: 'button', 'aria-label': 'Abrir ' + g.nombre + ', ' + n + (n === 1 ? ' opción' : ' opciones') + ', ' + resumen,
        onclick: (e) => { sonido(e.currentTarget); grupoSel = g.clave; pintarProductos(); gridProd.scrollTop = 0; },
      }, h('span.prod-cab', h('span.prod-nombre', g.nombre), h('span.prod-opciones', n + (n === 1 ? ' opción ›' : ' opciones ›'))),
      h('span.prod-pie', min != null && min !== max ? h('span.prod-precio', h('small.prod-desde', 'desde '), money(min)) : h('span.prod-precio' + (min == null ? '.abierto' : ''), resumen)), badge);
      tarjetasGrupo.set(g.clave, badge);
      return btn;
    }
    function pintarProductos() {
      tarjetas.clear(); tarjetasGrupo.clear();
      tabsCajon.hidden = false;
      const lista = productos.filter((p) => p.cajon_id === cajonSel);
      if (!lista.length) { gridProd.replaceChildren(h('div.vacio', { style: 'grid-column:1/-1' }, 'Este cajón no tiene productos activos.')); return; }
      const niveles = nivelesDelCajon(lista);
      const abierto = grupoSel && niveles.map((x) => x.grupo).find((g) => g && g.clave === grupoSel);
      if (grupoSel && !abierto) grupoSel = null; // el catálogo cambió y ese producto ya no existe
      tabsCajon.hidden = !!abierto; // en el nivel 3 solo se ven las opciones; «Volver» regresa al nivel 2
      if (abierto) {
        // Nivel 3: modificadores del producto elegido, cada uno con su precio final. Al tocar uno se agrega y se vuelve al nivel 2.
        const cajon = catalogo.cajones.find((c) => c.id === cajonSel);
        const volver = () => { grupoSel = null; pintarProductos(); gridProd.scrollTop = 0; };
        gridProd.replaceChildren(
          h('div.nivel3-cab',
            h('button.btn.volver', { type: 'button', onclick: volver, 'aria-label': 'Volver a ' + (cajon?.nombre || 'los productos') }, '‹ Volver'),
            h('div.nivel3-tit', h('strong', abierto.nombre), h('small', 'Toque la opción que desea agregar a la cuenta'))),
          ...abierto.opciones.map((p) => tarjetaArticulo(p, p.modificador_nombre, volver)));
        actualizarInsignias();
        gridProd.querySelector('.nivel3-cab')?.scrollIntoView({ block: 'nearest' });
        return;
      }
      gridProd.replaceChildren(...niveles.map((x) => (x.grupo ? tarjetaGrupo(x.grupo) : tarjetaArticulo(x.directo, x.directo.nombre))));
      actualizarInsignias();
    }
    function actualizarInsignias() {
      const cuenta = new Map(), porGrupo = new Map();
      (cur?.lineas || []).forEach((l) => {
        const n = Number(l.cantidad);
        cuenta.set(l.producto_id, (cuenta.get(l.producto_id) || 0) + n);
        const p = prodPorId.get(l.producto_id);
        if (p?.modificador_nombre) { const k = p.codigo.slice(0, 4); porGrupo.set(k, (porGrupo.get(k) || 0) + n); }
      });
      for (const [id, badge] of tarjetas) {
        const n = cuenta.get(id);
        badge.hidden = !n;
        if (n) badge.textContent = num(n, 3);
      }
      for (const [clave, badge] of tarjetasGrupo) {
        const n = porGrupo.get(clave);
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
      // La tira se desliza de lado a lado: un degradado en el borde y un texto avisan que hay más cuentas fuera de la pantalla
      const lista = h('div.cuentas-lista', { role: 'group', 'aria-label': 'Cuentas abiertas' }, botones.length ? botones : h('span.cuentas-vacio', 'No hay cuentas abiertas. Toque un producto para empezar una.'));
      const pista = h('div.cuentas-pista', { 'aria-hidden': 'true' }, 'Hay ' + abiertas.length + ' cuentas abiertas. Deslice hacia los lados para ver todas ›');
      const envoltura = h('div.cuentas-envoltura', lista, h('span.cuentas-borde.izq', { 'aria-hidden': 'true' }), h('span.cuentas-borde.der', { 'aria-hidden': 'true' }), pista);
      const pistaViva = () => {
        const mas = lista.scrollWidth - lista.clientWidth - lista.scrollLeft > 6;
        envoltura.classList.toggle('mas-der', mas);
        envoltura.classList.toggle('mas-izq', lista.scrollLeft > 6);
      };
      lista.addEventListener('scroll', pistaViva, { passive: true });
      barraCuentas.replaceChildren(envoltura, h('button.btn.primario', { type: 'button', onclick: seguro(nuevaCuenta) }, 'Nueva cuenta'));
      // La cuenta activa se deja a la vista y se revisa si quedan cuentas escondidas hacia un lado
      requestAnimationFrame(() => {
        lista.querySelector('.cuenta-btn[aria-pressed=true]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        pistaViva();
      });
      barraExtras.replaceChildren(
        h('button.btn', { type: 'button', onclick: seguro(async () => { try { (await imp()).abrirAjustesImpresion(); } catch (e) { toast(e.message, 'error', 6000); } }) }, 'Impresora'));
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
      const v = cur.venta, id = v.id, n = cur.lineas.length;
      const nombreCuenta = (TIPOS_SERVICIO[v.tipo_servicio] || '') + ' ' + (v.referencia || numCuenta(v.numero));
      const motivo = h('textarea.campo', { rows: 3, maxlength: 200, placeholder: 'Ej. el cliente se fue, error al digitar', 'aria-label': 'Motivo de la anulación' });
      const err = h('div.error-caja', { hidden: true, role: 'alert' });
      const rapidos = h('div.fila', MOTIVOS_ANULAR.map((t) => h('button.btn.chico', { type: 'button', onclick: () => { motivo.value = t; err.hidden = true; motivo.focus(); } }, t)));
      modal({ titulo: 'Anular cuenta', ancho: 480,
        contenido: h('div.col',
          h('p.conf', 'Va a anular la cuenta ' + nombreCuenta.trim() + (n ? ' con ' + n + (n === 1 ? ' producto' : ' productos') + ' por ' + money(v.total) : ' (está vacía)') + '. No se cobra nada y no se puede deshacer.'),
          v.estado === 'prefacturada' ? h('p.tenue-linea', 'Esta cuenta ya tenía prefactura. La prefactura no es una factura, así que no hay nada que anular en Hacienda.') : null,
          h('label.etq', 'Motivo (obligatorio)', motivo),
          h('div.etq', 'O toque uno de estos:'), rapidos, err),
        botones: [{ texto: 'No, volver', onclick: (c) => c() }, { texto: 'Sí, anular esta cuenta', clase: 'peligro', onclick: (c) => {
          const txt = motivo.value.trim();
          if (txt.length < 3) { err.textContent = 'Escriba el motivo de la anulación (por ejemplo: el cliente se fue).'; err.hidden = false; motivo.focus(); return; }
          c();
          accion(async () => { await api.ventaAnular(id, txt); sacarDeLista(id); await pasarALaSiguiente(); repintar(); toast('Cuenta anulada.'); });
        } }] });
      motivo.focus();
    }

    /* ---------- Productos en la cuenta ---------- */
    async function crearCuentaBuffet() {
      const v = await api.ventaCrear(socId, 'buffet', null, null, app.terminal);
      cur = ventaVacia(v); guardarActiva();
    }
    async function agregarProducto(p) {
      if (p.descripcion_libre) { dialogoLinea({ producto: p }); return; }
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
    /* ---------- Línea libre: detalle, cantidad, precio con IVA y tarifa de IVA ---------- */
    // Sirve para agregar el producto genérico («Servicio de alimentación») y para editar cualquier línea de la cuenta.
    // El precio final con IVA se conserva: la base se calcula hacia atrás con la tarifa elegida (el servidor y el XML hacen el cálculo exacto).
    function dialogoLinea({ producto, linea }) {
      const nueva = !linea;
      const prod = producto || prodPorId.get(linea.producto_id) || null;
      const tarIni = nueva ? tarifaDeLinea({ tarifa_iva: prod?.tarifa_iva ?? 13 }) : tarifaDeLinea(linea);
      let codigo = tarIni.codigo;
      const desc = h('textarea.campo.lin-desc', { rows: 3, maxlength: 200, 'aria-label': 'Detalle que sale en la factura', placeholder: 'Ej. 40 sándwiches y 100 refrescos' });
      desc.value = nueva ? (prod?.descripcion_libre ? '' : prod?.nombre || '') : linea.descripcion;
      const cuenta = h('small.tenue');
      const qty = h('input.campo', { type: 'text', inputmode: 'decimal', autocomplete: 'off', 'aria-label': 'Cantidad', value: nueva ? '1' : plano(linea.cantidad) });
      const precio = h('input.campo', { type: 'text', inputmode: 'decimal', autocomplete: 'off', 'aria-label': 'Precio final de cada uno, con IVA incluido', placeholder: 'Ej. 150000',
        value: nueva ? (Number(prod?.precio_final) > 0 ? plano(prod.precio_final) : '') : plano(linea.precio_final) });
      const err = h('div.error-caja', { hidden: true, role: 'alert' });
      const prev = h('div.lin-prev', { 'aria-live': 'polite' });
      const botTarifa = new Map();
      const sinCodigo = !tarIni.codigo; // línea vieja con 0 % y sin código: se muestra tal cual hasta que se elija una tarifa
      const boton = (t) => {
        const b = h('button.btn.tarifa-btn', { type: 'button', 'aria-pressed': String(t.codigo === codigo), onclick: () => { codigo = t.codigo; marcar(); pinta(); } }, t.nombre);
        botTarifa.set(t.codigo, b); return b;
      };
      const frecuentes = TARIFAS_IVA.filter((t) => t.frecuente).map(boton);
      const otras = TARIFAS_IVA.filter((t) => !t.frecuente).map(boton);
      const otraSel = !!codigo && TARIFAS_IVA.find((t) => t.codigo === codigo && !t.frecuente);
      function marcar() { for (const [c, b] of botTarifa) b.setAttribute('aria-pressed', String(c === codigo)); }
      const tarifaActual = () => TARIFAS_IVA.find((t) => t.codigo === codigo) || tarIni;
      const leer = () => {
        const d = desc.value.replace(/\s+/g, ' ').trim();
        const q = leerCant(qty.value), pr = leerNumero(precio.value);
        if (d.length < 3) return { error: 'Escriba el detalle de lo que se vende (mínimo 3 letras).', foco: desc };
        if (d.length > 200) return { error: 'El detalle puede tener hasta 200 letras.', foco: desc };
        if (!(q > 0) || !Number.isFinite(q)) return { error: 'La cantidad tiene que ser mayor que cero.', foco: qty };
        if (!(pr > 0) || !Number.isFinite(pr)) return { error: 'Escriba el precio final de cada uno, con IVA incluido, mayor que cero.', foco: precio };
        const qq = r3(q), tot = Math.round(qq * cents(pr));
        if (tot <= 0) return { error: 'El total de la línea no puede ser cero.', foco: qty };
        if (tot > 9999999999) return { error: 'El monto es demasiado grande. Revise la cantidad y el precio.', foco: precio };
        return { d, qq, pr, tot: tot / 100 };
      };
      function pinta() {
        cuenta.textContent = desc.value.length + ' de 200 letras';
        const r = leer();
        const q = r3(leerCant(qty.value)), pr = leerNumero(precio.value);
        const total = r.tot ?? (q > 0 && pr > 0 ? Math.round(q * cents(pr)) / 100 : 0);
        const t = tarifaActual(), dg = desgloseIva(total, t.pct);
        prev.replaceChildren(
          h('div.lin-prev-tit', 'Así saldrá en la factura'),
          h('div.lin-prev-det', desc.value.replace(/\s+/g, ' ').trim() || 'Escriba arriba el detalle de lo que se vende'),
          h('div.lin-prev-fila', h('span', (q > 0 ? num(q, 3) : '0') + ' × ' + money(pr > 0 ? pr : 0) + ' con IVA'), h('span', money(total))),
          h('div.lin-prev-fila.tenue', h('span', 'Base sin IVA (calculada hacia atrás)'), h('span', money(dg.base))),
          h('div.lin-prev-fila.tenue', h('span', 'IVA ' + t.nombre), h('span', money(dg.iva))),
          h('div.lin-prev-fila.total', h('span', 'Total de la línea, con IVA'), h('b', money(total))));
      }
      [desc, qty, precio].forEach((i) => i.addEventListener('input', pinta));
      const cancelar = h('button.btn', { type: 'button', onclick: () => m.cerrar() }, 'Cancelar');
      const guardar = h('button.btn.primario.grande', { type: 'button' }, nueva ? 'Agregar a la cuenta' : 'Guardar cambios');
      guardar.addEventListener('click', async () => {
        const r = leer();
        if (r.error) { err.textContent = r.error; err.hidden = false; r.foco?.focus(); return; }
        err.hidden = true;
        const st = {};
        guardar.disabled = true;
        const cambioTarifa = codigo && codigo !== tarIni.codigo ? codigo : null;
        if (nueva) {
          await accion(async () => {
            if (!cur) await crearCuentaBuffet();
            cur = await api.lineaAgregar(cur.venta.id, prod.id, r.qq, r.pr, null, { descripcion: r.d, codigoTarifa: cambioTarifa });
            repintar(true);
            toast('Agregado a la cuenta: ' + (r.d.length > 60 ? r.d.slice(0, 60) + '…' : r.d));
          }, st);
        } else {
          const cambios = {};
          if (r.d !== linea.descripcion) cambios.descripcion = r.d;
          if (r.qq !== Number(linea.cantidad)) cambios.cantidad = r.qq;
          if (cents(r.pr) !== cents(linea.precio_final)) cambios.precio = r.pr;
          if (cambioTarifa) cambios.codigoTarifa = cambioTarifa;
          if (!Object.keys(cambios).length) { m.cerrar(); toast('No hubo cambios en la línea.'); return; }
          await accion(async () => { cur = await api.lineaEditar(linea.id, cambios); repintar(); toast('Línea actualizada.'); }, st);
        }
        // Si el servidor rechazó lo escrito, la ventana sigue abierta para corregir; si fue la red, el aviso «Intentar de nuevo» se encarga
        if (st.error && !esTransitorio(st.error)) { guardar.disabled = false; return; }
        m.cerrar();
      });
      const m = modal({ titulo: nueva ? 'Agregar: ' + (prod?.nombre || 'línea') : 'Editar línea', ancho: 640,
        contenido: h('div.lin-dlg',
          nueva && prod?.descripcion_libre ? h('p.tenue-linea', 'Escriba lo que se vende y el precio final con IVA incluido. Puede agregar este servicio varias veces en la misma factura.') : h('p.tenue-linea', 'Cambie lo que necesite. El precio final con IVA se conserva: el IVA se calcula hacia atrás.'),
          h('label.etq', 'Detalle que sale en la factura', desc), cuenta,
          h('div.lin-nums', h('label.etq', 'Cantidad', qty), h('label.etq', 'Precio final de cada uno, con IVA incluido (₡)', precio)),
          h('div.etq', 'Tarifa de IVA'),
          h('div.tarifas', { role: 'group', 'aria-label': 'Tarifa de IVA' }, frecuentes),
          h('details.otras-tarifas', { open: !!otraSel }, h('summary', 'Otras tarifas'), h('div.tarifas', otras)),
          sinCodigo ? h('small.tenue', 'Esta línea tiene ' + tarIni.nombre + ' sin tipo definido. Elija una tarifa solo si necesita cambiarla.') : null,
          prev, err,
          h('div.lin-pie', cancelar, guardar)) });
      pinta();
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

    // Cada línea ocupa UNA fila de unos 64 px: nombre, cantidad (menos, número, más) y total, con el botón «Opciones» al lado.
    // Todo lo demás (precio de cada uno con IVA, nota, detalle e IVA, cambiar producto y quitar) está dentro de «Opciones».
    const lineasAbiertas = new Set();
    // Lo que se lee bajo el nombre de una línea cuya tarifa no es la normal
    const rotuloIva = (t) => t.pct > 0 ? 'IVA ' + String(t.pct).replace('.', ',') + ' %' : t.codigo === '01' ? 'IVA 0 % (no sujeto)' : t.codigo === '11' ? 'IVA 0 % sin derecho a crédito' : 'Exenta de IVA';
    function filaLinea(l) {
      const prod = prodPorId.get(l.producto_id);
      const editada = !!prod && !prod.precio_abierto && cents(l.precio_final) !== cents(prod.precio_final);
      const cantidad = Number(l.cantidad);
      const qty = h('input.campo.cant-inp', { type: 'text', inputmode: 'decimal', value: plano(cantidad), 'aria-label': 'Cantidad de ' + l.descripcion, autocomplete: 'off' });
      const precio = h('input.campo.precio-inp', { type: 'text', inputmode: 'decimal', value: plano(l.precio_final), 'aria-label': 'Precio final con IVA de cada ' + l.descripcion, autocomplete: 'off' });
      const nota = h('input.campo.nota-inp', { type: 'text', maxlength: 120, value: l.nota || '', placeholder: 'Ej. sin cebolla', 'aria-label': 'Nota de ' + l.descripcion, autocomplete: 'off' });
      const editar = (cambio, aviso) => accion(async () => { cur = await api.lineaEditar(l.id, cambio); repintar(); if (aviso) toast(aviso); });
      qty.addEventListener('change', () => {
        const v = leerCant(qty.value);
        if (!(v > 0) || !Number.isFinite(v)) { toast('La cantidad tiene que ser mayor que cero. Para sacar el producto use «Opciones» y luego «Quitar de la cuenta».', 'error'); qty.value = plano(cantidad); return; }
        if (r3(v) !== cantidad) editar({ cantidad: r3(v) });
      });
      precio.addEventListener('change', () => {
        const v = leerNumero(precio.value);
        if (!(v > 0) || !Number.isFinite(v)) { toast('Escriba un precio mayor que cero (con IVA incluido).', 'error'); precio.value = plano(l.precio_final); return; }
        if (cents(v) !== cents(l.precio_final)) editar({ precio: v });
      });
      nota.addEventListener('change', () => { if (nota.value.trim() !== (l.nota || '')) editar({ nota: nota.value.trim() }); });
      [qty, precio, nota].forEach((i) => {
        i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); i.blur(); } });
        i.addEventListener('focus', () => llevarALaVista(i));
      });
      const tar = tarifaDeLinea(l);
      const detalleCambiado = !!prod && !prod.descripcion_libre && l.descripcion !== prod.nombre;
      const tarifaCambiada = !!prod && Number(l.tarifa_iva) !== Number(prod.tarifa_iva);
      const abierta = lineasAbiertas.has(l.id);
      // Solo se rotula lo que sale de lo normal: otra tarifa, otro detalle u otro precio que el del menú
      const marcas = [];
      if (tarifaCambiada || tar.pct !== 13) marcas.push(h('span' + (tarifaCambiada ? '.amb' : ''), rotuloIva(tar)));
      if (detalleCambiado) marcas.push(h('span.amb', 'Detalle cambiado'));
      if (editada) marcas.push(h('span.amb', 'Precio cambiado (el menú dice ' + money(prod.precio_final) + ')'));
      if (l.nota && !abierta) marcas.push(h('span.nota-vista', 'Nota: ' + l.nota));
      const id = l.id;
      const mas = h('button.btn.mas-btn', { type: 'button', 'aria-expanded': String(abierta), 'aria-label': (abierta ? 'Cerrar las opciones de ' : 'Abrir las opciones de ') + l.descripcion,
        onclick: () => {
          if (abierta) lineasAbiertas.delete(id); else lineasAbiertas.add(id);
          pintarCuenta();
          asideCuenta?.querySelector('[data-linea="' + id + '"]')?.scrollIntoView({ block: 'nearest' });
        } }, abierta ? 'Cerrar' : 'Opciones');
      return h('div.linea' + (editada ? '.editada' : '') + (detalleCambiado || tarifaCambiada ? '.personalizada' : '') + (abierta ? '.abierta' : ''), { 'data-linea': l.id },
        h('div.linea-nombre', l.descripcion),
        h('div.cant',
          h('button.mm', { type: 'button', disabled: cantidad - 1 <= 0, 'aria-label': 'Quitar una unidad de ' + l.descripcion, onclick: () => editar({ cantidad: r3(cantidad - 1) }) }, '−'),
          qty,
          h('button.mm', { type: 'button', 'aria-label': 'Agregar una unidad de ' + l.descripcion, onclick: () => editar({ cantidad: r3(cantidad + 1) }) }, '+')),
        h('div.linea-total', money(l.total_linea)),
        mas,
        marcas.length ? h('div.linea-sub', marcas) : null,
        abierta ? h('div.linea-pie',
          h('label.etq.pie-precio', 'Precio de cada uno con IVA (₡)', precio),
          h('label.etq.pie-nota', 'Nota para esta línea', nota),
          h('div.pie-botones',
            h('button.btn', { type: 'button', onclick: () => dialogoLinea({ linea: l }) }, 'Editar detalle e IVA'),
            h('button.btn', { type: 'button', onclick: () => cambiarProducto(l) }, 'Cambiar producto'),
            h('button.btn.peligro', { type: 'button', 'aria-label': 'Quitar ' + l.descripcion + ' de la cuenta', onclick: () => accion(async () => { cur = await api.lineaQuitar(l.id); lineasAbiertas.delete(l.id); repintar(); toast('Quitado: ' + l.descripcion); }) }, 'Quitar de la cuenta'))) : null);
    }

    /* ---------- Cliente de la cuenta y tarifa de IVA habitual ---------- */
    // El cliente se puede elegir ANTES de cobrar (aquí) o dentro de la ventana de cobro; en los dos casos queda guardado en la cuenta.
    const sinAviso = new Set(); // 'cuenta:cliente' donde la cajera pidió dejar el IVA normal: no se vuelve a insistir en esa cuenta
    async function asignarCliente(cl) {
      if (!cur) return false;
      const id = cur.venta.id, st = {};
      await accion(async () => {
        cur = await api.ventaDatos(id, cl ? { cliente: cl.id } : { quitarCliente: true });
        repintar();
        toast(cl ? 'Cliente elegido: ' + nombrePropio(cl.nombre) + '. Se emitirá una factura electrónica a su nombre.' : 'Cliente quitado. Se emitirá un tiquete electrónico.');
      }, st);
      return !st.error;
    }
    function elegirClienteCuenta() { selectorCliente(app, { alElegir: (cl) => { asignarCliente(cl); } }); }
    // Pone la tarifa del cliente en todas las líneas que todavía no la llevan. El precio final de cada línea no cambia: el IVA se calcula hacia atrás.
    async function aplicarTarifaCliente(t) {
      const st = {};
      await accion(async () => {
        const ids = cur.lineas.filter((l) => tarifaDeLinea(l).codigo !== t.codigo).map((l) => l.id);
        for (const idl of ids) cur = await api.lineaEditar(idl, { codigoTarifa: t.codigo });
        repintar();
        if (ids.length) toast('Listo: ' + t.texto + ' en ' + ids.length + (ids.length === 1 ? ' línea' : ' líneas') + '. El precio final de cada una no cambia.');
      }, st);
      return !st.error;
    }
    // Aviso con palabras claras y botón grande. No aplica nada solo. alAplicar() se llama con la tarifa del cliente.
    function avisoTarifaCliente(cl, alAplicar, alRepintar = () => repintar()) {
      const t = tarifaHabitual(cl);
      if (!t || !cur) return null;
      const llave = cur.venta.id + ':' + cl.id;
      const pend = cur.lineas.filter((l) => tarifaDeLinea(l).codigo !== t.codigo);
      const frase = 'Este cliente normalmente ' + t.frase + '.';
      if (!cur.lineas.length) return h('div.aviso-tarifa', h('strong', frase), h('small', 'Cuando agregue productos aparecerá un botón para aplicarla a todas las líneas. No se aplica sola.'));
      if (!pend.length) return h('div.aviso-tarifa.lista', h('strong', 'Todas las líneas llevan ' + t.texto + '.'), h('small', 'El precio final de cada línea no cambió: solo cambia cuánto del precio es IVA.'));
      if (sinAviso.has(llave)) return h('div.aviso-tarifa.suave', h('div', h('strong', frase), h('small', 'En esta cuenta se dejó el IVA normal.')),
        h('button.btn.chico', { type: 'button', onclick: () => { sinAviso.delete(llave); alRepintar(); } }, 'Ver la opción otra vez'));
      return h('div.aviso-tarifa', { role: 'group', 'aria-label': 'Tarifa de IVA habitual del cliente' },
        h('strong', frase),
        h('small', 'No se aplica sola. El precio final de cada línea no cambia: solo cambia cuánto del precio es IVA.'),
        h('div.aviso-botones',
          h('button.btn.primario', { type: 'button', onclick: (e) => conBoton(e.currentTarget, () => alAplicar(t)) }, t.boton + (pend.length < cur.lineas.length ? ' (' + pend.length + ' de ' + cur.lineas.length + ')' : '')),
          h('button.btn.chico', { type: 'button', onclick: () => { sinAviso.add(llave); alRepintar(); } }, 'No, dejar el IVA normal')));
    }
    function panelCliente() {
      const cl = cur.cliente || null;
      if (!cl) {
        return h('div.cuenta-cliente',
          h('div.cc-fila',
            h('div.cc-txt', h('strong', 'Sin cliente'), h('small', 'Sale tiquete electrónico')),
            h('button.btn.chico', { type: 'button', onclick: elegirClienteCuenta }, 'Elegir cliente')));
      }
      return h('div.cuenta-cliente.con',
        h('div.cc-fila',
          h('div.cc-txt', h('strong', { title: nombrePropio(cl.nombre) }, 'Factura a nombre de ' + nombrePropio(cl.nombre)), h('small', (TIPOS_ID[cl.tipo_id] || 'Identificación') + ' ' + (cl.identificacion || ''))),
          h('div.fila', h('button.btn.chico', { type: 'button', onclick: elegirClienteCuenta }, 'Cambiar cliente'), h('button.btn.chico', { type: 'button', onclick: seguro(() => asignarCliente(null)) }, 'Quitar cliente'))),
        avisoTarifaCliente(cl, aplicarTarifaCliente));
    }

    function pintarCuenta(irAlFinal) {
      if (!asideCuenta) return;
      const scroll = asideCuenta.querySelector('.cuenta-lineas')?.scrollTop || 0;
      if (!cur) {
        asideCuenta.replaceChildren(h('div.vacio-cuenta',
          h('h2', 'No hay cuenta abierta'),
          h('p', 'Toque un producto o búsquelo arriba para empezar una cuenta de Buffet. Si es para esperar, para llevar o express, use «Nueva cuenta».'),
          h('button.btn.primario.grande', { type: 'button', onclick: seguro(nuevaCuenta) }, 'Nueva cuenta')));
        return;
      }
      const v = cur.venta;
      const puede = cur.lineas.length > 0 && Number(v.total) > 0;
      const detalle = [v.referencia, v.telefono].filter(Boolean).join(' · ');
      // Clientes en espera, para llevar y express pueden pedir ver su cuenta antes de pagar: la prefactura NO es un comprobante
      const prefBtn = (v.tipo_servicio === 'espera' || v.tipo_servicio === 'llevar' || v.tipo_servicio === 'express')
        ? h('button.btn.ambar', { type: 'button', disabled: !cur.lineas.length, onclick: (e) => prefacturar(e.currentTarget) }, v.estado === 'prefacturada' ? 'Imprimir prefactura otra vez' : 'Prefactura (no es factura)')
        : null;
      // El cliente y su aviso de tarifa van dentro de la parte que se desliza: así nunca le quitan lugar a las líneas
      const lineas = h('div.cuenta-lineas', panelCliente(),
        h('div.cuenta-items', cur.lineas.length ? cur.lineas.map(filaLinea) : h('div.vacio', { style: 'margin:.8rem 0' }, 'La cuenta está vacía. Toque un producto o búsquelo arriba.')));
      asideCuenta.replaceChildren(
        h('div.cuenta-cab',
          h('div', h('h2', (TIPOS_SERVICIO[v.tipo_servicio] || v.tipo_servicio) + ' ' + numCuenta(v.numero)), h('div.sub', detalle || (v.tipo_servicio === 'buffet' ? 'Sin nombre' : 'Falta el nombre'))),
          h('button.btn.chico', { type: 'button', onclick: editarDatos }, 'Cambiar datos de la cuenta')),
        lineas,
        h('div.cuenta-pie',
          v.estado === 'prefacturada' ? h('div.aviso-pref', h('strong', 'PREFACTURA N.° ' + (v.prefactura_numero || '')), 'No es una factura: es solo para que el cliente revise su cuenta.') : null,
          h('div.pie-cobro',
            h('div.total-fila', h('span.et', 'Total a pagar (IVA incluido)'), h('div.total-monto', { 'aria-live': 'polite' }, money(v.total))),
            h('button.btn.primario.grande.btn-cobrar-aside', { type: 'button', disabled: !puede, onclick: seguro(abrirCobro) }, 'Cobrar')),
          h('div.acciones-cuenta', prefBtn, h('button.btn.peligro' + (prefBtn ? '' : '.ancho'), { type: 'button', onclick: anularCuenta }, 'Anular esta cuenta'))));
      const nuevo = asideCuenta.querySelector('.cuenta-lineas');
      nuevo.scrollTop = irAlFinal ? nuevo.scrollHeight : scroll;
    }

    // Barra de abajo en celular. Con el teclado abierto (buscando un producto) se queda solo un botón «Cobrar» pequeño, sobre el teclado:
    // así siempre se puede cobrar sin cerrar el teclado, y la lista de resultados no pierde lugar.
    const sinQuitarFoco = (e) => e.preventDefault(); // tocar un botón de la barra no cierra el teclado ni mueve la barra antes de tiempo
    function pintarMovil() {
      if (!barraMovil) return;
      const total = cur ? money(cur.venta.total) : '';
      const n = cur ? cur.lineas.length : 0;
      const puede = !!cur && n > 0 && Number(cur.venta.total) > 0;
      barraMovil.classList.toggle('sin-cobro', !puede);
      const cobrar = puede ? h('button.btn.primario.bm-cobrar', { type: 'button', 'aria-label': 'Cobrar ' + total, onmousedown: sinQuitarFoco, onclick: seguro(abrirCobro) }, 'Cobrar', h('span.bm-total', ' ' + total)) : null;
      if (vista === 'productos') {
        barraMovil.replaceChildren(h('button.btn.bm-ver', { type: 'button', onmousedown: sinQuitarFoco, onclick: () => cambiarVista('cuenta') }, cur ? 'Ver cuenta (' + n + ')' : 'Ver cuenta'), ...(cobrar ? [cobrar] : []));
      } else {
        barraMovil.replaceChildren(
          h('button.btn.bm-ver', { type: 'button', onmousedown: sinQuitarFoco, onclick: () => cambiarVista('productos') }, 'Agregar productos'),
          puede ? cobrar : h('button.btn.primario.bm-cobrar', { type: 'button', disabled: true }, 'Cobrar'));
      }
    }

    /* ---------- Prefactura ---------- */
    async function prefacturar(btn) {
      await cola;
      if (!cur || !cur.lineas.length) return;
      const id = cur.venta.id;
      await conBoton(btn, async () => {
        if (cur.venta.estado !== 'prefacturada') {
          const st = {};
          await accion(async () => { cur = await api.prefacturar(id); repintar(); }, st);
          if (st.error) return; // no se pudo crear: no se imprime nada que parezca prefactura
        }
        try { await (await imp()).imprimirPrefactura(id); toast('Se abrió la impresión de la prefactura. Recuerde: esto no es una factura.'); }
        catch (e) { toast('La prefactura quedó creada pero no se pudo imprimir: ' + (e.message || e) + ' Toque «Imprimir prefactura otra vez».', 'error', 8000); }
      });
    }

    /* ---------- Cobro ---------- */
    let cobroAbierto = false; // hay una ventana «Cobrar» abierta (o abriéndose): un Enter repetido no abre otra encima
    async function abrirCobro() {
      if (cobroAbierto) return;
      cobroAbierto = true;
      let creada = false;
      try { await abrirCobroVentana(() => { creada = true; }); }
      finally { if (!creada) cobroAbierto = false; }
    }
    async function abrirCobroVentana(avisarCreada) {
      await cola;
      if (!cur || !cur.lineas.length || !(Number(cur.venta.total) > 0)) { toast('La cuenta está vacía. Agregue productos antes de cobrar.', 'error'); return; }
      let venta = cur.venta;
      const ventaId = venta.id;
      if (ventasEnCobro.has(ventaId)) { toast('Esta cuenta tiene un cobro en camino. Espere unos segundos a que termine.', 'error'); return; }
      let totalC = cents(venta.total);
      let cliente = cur.cliente || null;
      let actividadFactura = null; // código de actividad pedido por el cliente solo para esta factura (null = la principal del cliente)
      let pagos = [];
      let medio = 'efectivo';
      let auto = true;
      let cobrando = false;
      let terminado = false;
      let duda = ventasEnDuda.has(ventaId); // el cobro anterior de esta cuenta no se pudo confirmar
      const abiertaEn = performance.now();

      const raiz = h('div');
      let m;
      const mostrar = (n) => raiz.replaceChildren(n);

      /* Vista principal de pago */
      const docTxt = h('span.doc'), cliTxt = h('span.cli');
      // Elegir o crear cliente: la ventana completa de Clientes (ui_cliente.js). Al crear uno nuevo trae los 4 correos, la dirección y la verificación en Hacienda.
      // El cliente también queda guardado en la cuenta (así se ve igual en cualquier aparato y en la prefactura)
      const elegirCliente = (c) => {
        cliente = c; actividadFactura = null; pintarCliente(); actualizar();
        asignarCliente(c).then((ok) => { if (ok && !terminado && cur?.cliente?.id === c.id) { cliente = cur.cliente; pintarCliente(); } });
      };
      const btnElegir = h('button.btn', { type: 'button', onclick: () => selectorCliente(app, { alElegir: elegirCliente }) }, 'Elegir cliente (factura)');
      const btnQuitarCli = h('button.btn.suave', { type: 'button', onclick: () => { cliente = null; actividadFactura = null; pintarCliente(); asignarCliente(null); } }, 'Quitar cliente');
      const actEl = h('div.cobro-act', { hidden: true });
      const tarEl = h('div.cobro-tarifa', { hidden: true });
      const montoTotal = h('div.monto', money(venta.total));
      const mediosBtns = Object.entries(MEDIOS).map(([k, v]) => h('button.medio-btn', { type: 'button', dataset: { medio: k }, onclick: () => { medio = k; auto = true; sugerir(); actualizar(); inpMonto.focus(); inpMonto.select(); } }, v));
      const inpMonto = h('input.campo.monto-grande', { type: 'text', inputmode: 'decimal', autocomplete: 'off', 'aria-label': 'Monto' });
      const lblMonto = h('span');
      const inpRef = h('input.campo', { type: 'text', maxlength: 60, autocomplete: 'off' });
      const refTxt = h('span');
      const refEtq = h('label.etq', refTxt, inpRef);
      const rapidos = h('div.rapidos',
        h('button.btn', { type: 'button', onclick: () => { auto = true; sugerir(); actualizar(); } }, 'Exacto'),
        RAPIDOS.map((n) => h('button.btn', { type: 'button', onclick: () => { inpMonto.value = String(n); auto = false; actualizar(); } }, money0(n))));
      const btnOtro = h('button.btn', { type: 'button', onclick: agregarOtro }, 'Agregar otro pago (pago mixto)');
      const listaPagos = h('div.col');
      const resumen = h('div.cobro-resumen');
      const errEl = h('div.error-caja', { hidden: true, role: 'alert' });
      const btnRevisar = h('button.btn', { type: 'button', hidden: true }, 'Revisar si se cobró');
      // Impresión: se usan los ajustes de este aparato (botón «Impresora»); aquí solo se muestran y se pueden abrir para cambiarlos
      const resImp = h('div.cobro-imp');
      const abrirAjustes = async () => { try { (await imp()).abrirAjustesImpresion(); } catch (e) { toast(e.message, 'error', 6000); } };
      let claveImp = '';
      function pintarImp() {
        const a = ajustesImp();
        const clave = JSON.stringify([a.auto, a.formato, a.papel, a.copias]);
        if (clave === claveImp) return;
        claveImp = clave;
        resImp.replaceChildren(
          h('div.cobro-imp-txt', h('strong', 'Impresión al cobrar'),
            h('div.tenue-linea', a.auto ? 'Se imprime sola: ' + textoImpresion(a) + '.' : 'No se imprime sola. Al terminar el cobro aparece el botón «Imprimir tiquete».')),
          h('button.btn', { type: 'button', onclick: abrirAjustes }, 'Cambiar ajustes de impresión'));
      }
      const vigilaAjustes = new MutationObserver(() => pintarImp());
      vigilaAjustes.observe(document.body, { childList: true });
      const btnVolver = h('button.btn', { type: 'button', onclick: () => { if (!cobrando) m.cerrar(); } }, 'Volver');
      // Un Enter que llega solo (tecla sostenida, o el Enter que acaba de abrir esta ventana) no cobra: el cobro necesita un toque o un Enter a propósito
      const btnCobrar = h('button.btn.primario.grande.btn-confirmar-cobro', { type: 'button', onclick: (ev) => { if (ev.detail === 0 && performance.now() - abiertaEn < 500) return; confirmarCobro(); } }, 'Cobrar');
      btnCobrar.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.repeat) e.preventDefault(); });
      const vistaPago = h('div.cobro',
        h('div.cobro-total', h('div.et', 'Total a cobrar (IVA incluido)'), montoTotal),
        resumen,
        listaPagos,
        h('div.cobro-doc', h('div', h('div', docTxt), h('div', cliTxt)), h('div.fila', btnElegir, btnQuitarCli)),
        tarEl,
        actEl,
        h('div.col', h('strong', 'Forma de pago'), h('div.medios', mediosBtns)),
        h('label.etq', lblMonto, inpMonto),
        rapidos, refEtq, btnOtro, errEl, btnRevisar,
        resImp,
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
        cliTxt.textContent = cliente ? 'Cliente: ' + nombrePropio(cliente.nombre) + ' · ' + cliente.identificacion : 'Si el cliente pide factura con su nombre, toque «Elegir cliente».';
        btnElegir.textContent = cliente ? 'Cambiar cliente' : 'Elegir cliente (factura)';
        btnQuitarCli.hidden = !cliente;
        pintarTarifa();
        pintarActividad();
      }
      // Tarifa de IVA habitual del cliente: avisa con palabras claras y ofrece aplicarla (nunca la aplica sola)
      async function aplicarEnCobro(t) {
        const ok = await aplicarTarifaCliente(t);
        if (!ok || !cur || terminado) return;
        venta = cur.venta; totalC = cents(venta.total); montoTotal.textContent = money(venta.total);
        pintarTarifa(); sugerir(); actualizar();
      }
      function pintarTarifa() {
        const a = cliente && cur ? avisoTarifaCliente(cliente, aplicarEnCobro, pintarTarifa) : null;
        tarEl.hidden = !a;
        tarEl.replaceChildren(...(a ? [a] : []));
      }

      /* Actividad del cliente para esta factura: la principal del cliente, o la que pida para esta factura */
      const codigoActividad = () => actividadFactura || cliente?.actividad_codigo || '';
      const manualActividad = (cod) => !!(cliente?.actividades || []).find((x) => x.codigo === cod && x.manual);
      function pintarActividad() {
        actEl.hidden = !cliente;
        if (!cliente) { actEl.replaceChildren(); return; }
        const cod = codigoActividad();
        const lista = cliente.actividades || [];
        const fueraDeLista = !!cod && !!cliente.verificado && lista.some((x) => !x.manual) && !lista.some((x) => x.codigo === cod && !x.manual);
        actEl.replaceChildren(...[
          h('div.act-fila',
            h('div.act-txt', h('span.et', 'Actividad del cliente para esta factura: '),
              cod ? h('strong', textoActividad(cod, lista)) : h('strong', 'sin actividad económica'),
              cod && manualActividad(cod) ? h('span.chip', 'Escrita a mano') : null,
              actividadFactura ? h('span.chip.espera', 'Solo para esta factura') : null),
            h('button.btn', { type: 'button', onclick: () => vistaActividad() }, 'Cambiar')),
          cod ? null : h('small.tenue', 'Si el cliente declara IVA y pide que se anote su actividad, toque «Cambiar» y escriba el código.'),
          fueraDeLista ? h('div.act-aviso', 'Este código no está entre las actividades que Hacienda tiene para este cliente. Hacienda podría rechazar la factura.') : null,
          !cliente.correo ? h('div.act-aviso', 'Este cliente no tiene correo. La factura se emite igual, pero no se le podrá enviar por correo.') : null,
          direccionIncompleta(cliente) ? h('div.act-aviso', 'A este cliente le falta la dirección completa (provincia, cantón, distrito y otras señas). La factura se emite igual; complétela en Clientes cuando pueda.') : null,
        ].filter(Boolean));
      }
      function actualizar() {
        mediosBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.medio === medio)));
        lblMonto.textContent = medio === 'efectivo' ? 'Efectivo que entrega el cliente (₡)' : 'Monto a cobrar con ' + MEDIOS[medio] + ' (₡)';
        rapidos.hidden = medio !== 'efectivo';
        refEtq.hidden = medio === 'efectivo';
        refTxt.textContent = medio === 'tarjeta' ? 'Número de autorización o voucher (opcional)'
          : medio === 'sinpe' ? 'Número de comprobante del SINPE Móvil (recomendado: ayuda a cuadrar la caja)'
          : 'Número de referencia de la transferencia (recomendado: ayuda a cuadrar la caja)';
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
        btnCobrar.disabled = cobrando || duda || !r.ok || !!b.malo;
        btnOtro.disabled = cobrando || !b.v || !!r.error;
        btnVolver.disabled = cobrando;
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
      [inpMonto, inpRef].forEach((i) => i.addEventListener('focus', () => llevarALaVista(i)));
      // Enter en el monto solo pasa el foco al botón «Cobrar» de la ventana; el cobro lo confirma otro toque o otro Enter
      inpMonto.addEventListener('keydown', (e) => { if (e.key !== 'Enter') return; e.preventDefault(); if (!e.repeat && !btnCobrar.disabled) btnCobrar.focus(); });
      inpRef.addEventListener('input', actualizar);

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
          // Un código que Hacienda no tiene para este cliente puede hacer que rechacen la factura: se pide confirmación antes de seguir
          const deHac = lista.filter((x) => !x.manual);
          if (cliente.verificado && deHac.length && !deHac.some((x) => x.codigo === cod)) {
            const sigue = await confirmar('El código ' + cod + ' (' + infoActividad(cod, lista).nombre + ') no está entre las actividades que Hacienda tiene para este cliente. Hacienda puede rechazar la factura. ¿Quiere usarlo de todos modos?', { si: 'Sí, usarlo de todos modos', no: 'No, volver' });
            if (!sigue) return;
          }
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
            h('b', infoActividad(x.codigo, lista).nombre + (x.codigo === actual ? ' (la que está en esta factura)' : '')),
            h('small', 'Código ' + x.codigo + (x.manual ? ' · escrita a mano' : '') + (x.codigo === cliente.actividad_codigo ? ' · principal del cliente' : '')))) : [h('div.vacio', 'Este cliente no tiene actividades guardadas. Escriba el código abajo o consulte a Hacienda.')]));
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
          h('p.tenue-linea', 'Cliente: ' + nombrePropio(cliente.nombre) + '. Si el cliente tiene varias actividades, elija la que pide en esta factura. Esto no cambia los datos del cliente, salvo que marque la casilla de abajo.'),
          cajaLista, btnHac, nota,
          h('label.etq', 'O escriba otro código de actividad', inp, h('small', 'Cuatro números, un punto y un número (por ejemplo 5610.0), o seis números seguidos.')),
          h('label.cobro-chk', chk, h('span', h('b', 'Guardar también como actividad principal del cliente'), h('small', 'Si no la marca, el código vale solo para esta factura y el cliente queda como estaba.'))),
          err,
          h('div.fila', h('button.btn', { type: 'button', style: 'flex:1 1 150px', onclick: () => mostrar(vistaPago) }, 'Volver al cobro'), btnOtro)));
        inp.focus();
      }

      /* Confirmar el cobro: un solo intento a la vez; si falla la red se revisa si igual quedó cobrado */
      // Pregunta al servidor qué pasó con esta cuenta: 'cobrado' (trae el comprobante), 'no' (sigue abierta) o 'desconocido' (sin conexión)
      async function verificarCobro() {
        try {
          const v = await api.venta(ventaId);
          if (v.venta.estado === 'facturada' && v.comprobante) return { estado: 'cobrado', comp: await api.comprobante(v.comprobante.id) };
          return { estado: 'no' };
        } catch { return { estado: 'desconocido' }; }
      }
      async function terminar(comp, aviso, vueltoLocal) {
        terminado = true;
        duda = false; ventasEnDuda.delete(ventaId); ventasEnCobro.delete(ventaId);
        m.cerrar();
        if (!vivo) { avisoCobroSinCaja(comp, app, aviso); return; } // la Caja ya no está en pantalla: se avisa igual
        try { sacarDeLista(ventaId); cur = null; await pasarALaSiguiente(); if (vivo) repintar(); } catch { /* la barra se refresca sola */ }
        if (vivo) zonaEfectivo?.refrescar(); // el cobro en efectivo cambia el «Efectivo esperado en caja»
        if (vivo) exito(comp, vueltoLocal, aviso); else avisoCobroSinCaja(comp, app, aviso);
      }
      async function confirmarCobro() {
        if (cobrando || terminado || duda || ventasEnCobro.has(ventaId)) return;
        const b = borrador();
        const r = calcularPagos(entradas(), totalC);
        if (b.malo || !r.ok) { conErr(r.error || 'Los pagos todavía no cubren el total.'); return; }
        cobrando = true; ventasEnCobro.add(ventaId); btnRevisar.hidden = true; actualizar();
        // En efectivo se manda también "recibido" (lo que entregó el cliente): el servidor guarda el vuelto y lo imprime en el tiquete
        const aplicados = r.aplicados.map((p) => (p.medio === 'efectivo' ? { medio: p.medio, monto: p.monto, referencia: p.referencia, recibido: p.recibido } : { medio: p.medio, monto: p.monto, referencia: p.referencia }));
        let comp = null;
        try {
          comp = await api.cobrar(ventaId, aplicados, cliente ? cliente.id : null, app.terminal, cliente ? actividadFactura : null);
        } catch (e) {
          const v = await verificarCobro();
          if (v.estado === 'cobrado') {
            // Solo se habla de conexión si de verdad fue un problema de conexión; si el servidor dijo que la cuenta ya estaba cobrada, se dice eso
            const msg = esTransitorio(e) ? 'Hubo un problema de conexión, pero el cobro SÍ quedó registrado. No lo repita.' : 'Esta cuenta ya estaba cobrada. El cobro quedó registrado una sola vez; no lo repita.';
            await terminar(v.comp, msg, r.vuelto / 100); return;
          }
          cobrando = false;
          if (v.estado === 'desconocido') { duda = true; ventasEnDuda.add(ventaId); }
          ventasEnCobro.delete(ventaId);
          if (!vivo || !m) return;
          actualizar();
          if (v.estado === 'no') conErr('No se pudo cobrar: ' + (e.message || e) + ' No se cobró nada. Revise e intente de nuevo.');
          else { conErr('No se pudo confirmar si el cobro quedó registrado (' + (e.message || e) + '). No lo repita todavía: cuando vuelva la conexión toque «Revisar si se cobró».'); btnRevisar.hidden = false; }
          return;
        }
        await terminar(comp, '', r.vuelto / 100);
      }
      btnRevisar.addEventListener('click', () => conBoton(btnRevisar, async () => {
        const v = await verificarCobro();
        if (v.estado === 'cobrado') await terminar(v.comp, 'El cobro SÍ quedó registrado. No lo repita.', 0);
        else if (v.estado === 'no') { duda = false; ventasEnDuda.delete(ventaId); btnRevisar.hidden = true; actualizar(); conErr('Confirmado: no se cobró nada. Puede tocar «Cobrar» de nuevo.'); }
        else conErr('Todavía no hay conexión con el servidor. Espere unos segundos y toque «Revisar si se cobró» otra vez.');
      }));

      // Con el cobro en camino la ventana no se puede cerrar (ni con Escape, ni tocando fuera, ni con «Volver», ni con el botón Atrás)
      m = modal({ titulo: 'Cobrar', contenido: raiz, ancho: 720,
        bloqueo: () => (cobrando ? 'El cobro va en camino. Espere a que termine; la ventana se cierra sola.' : ''),
        alCerrar: () => { cobroAbierto = false; vigilaAjustes.disconnect(); if (vivo && !terminado && buscador && fino()) buscador.inp.focus(); } });
      avisarCreada();
      mostrar(vistaPago);
      pintarCliente(); pintarImp(); sugerir(); actualizar();
      if (duda) { conErr('El cobro anterior de esta cuenta no se pudo confirmar. No lo repita todavía: toque «Revisar si se cobró».'); btnRevisar.hidden = false; }
      inpMonto.focus(); inpMonto.select();
    }

    /* ---------- Pantalla de éxito ---------- */
    // comp = comprobante que devolvió el servidor (con pagos_snapshot: en efectivo trae recibido y vuelto). vueltoLocal solo sirve si el servidor no lo trajo.
    function exito(comp, vueltoLocal, aviso) {
      const aj = ajustesImp();
      const compId = comp.id;
      let abierto = true;
      const chip = h('span.chip');
      const msgEstado = h('p.tenue-linea');
      const impEstado = h('p.tenue-linea', { role: 'status' });
      // Los textos salen de describirCobro (describirEstado de util.js más el caso «aceptado con aviso»): nunca dicen que algo "ya está" si la base no lo sabe
      const pintarEstado = (c) => {
        const d = describirCobro(c.estado, c.mensaje);
        chip.textContent = d.chip;
        chip.className = 'chip ' + (d.clase === 'ok' ? 'ok' : d.clase === 'mal' ? 'mal' : 'espera');
        msgEstado.className = 'tenue-linea' + (d.clase === 'mal' ? ' msg-mal' : '');
        msgEstado.textContent = d.texto;
      };
      pintarEstado(comp);
      // Consulta el estado cada 4 segundos hasta que Hacienda responda o se cierre esta ventana
      let dejarDeVigilar = () => {};
      const vigilar = () => { dejarDeVigilar = api.vigilarComprobante(compId, (e) => { if (abierto && vivo) pintarEstado({ estado: e.estado, mensaje: e.mensaje }); }, { cada: 4000, max: 240000 }); };
      async function imprimir(fmt) {
        impEstado.className = 'tenue-linea'; impEstado.textContent = 'Enviando a la impresora…';
        try {
          await (await imp()).imprimirComprobante(compId, { formato: fmt, copias: aj.copias });
          // La página solo sabe que abrió la impresión: no puede saber si la persona la canceló o si salió el papel
          impEstado.textContent = fmt === 'carta'
            ? 'Se abrió la impresión de la factura carta (' + aj.copias + (aj.copias === 1 ? ' copia' : ' copias') + '). Si no salió, toque el botón otra vez.'
            : 'Se abrió la impresión del tiquete de ' + aj.papel + ' mm (' + aj.copias + (aj.copias === 1 ? ' copia' : ' copias') + '). Si no salió, toque «Imprimir otra vez».';
        } catch (e) {
          impEstado.className = 'tenue-linea msg-mal';
          impEstado.textContent = 'No se pudo imprimir: ' + (e.message || e) + ' Toque el botón de imprimir otra vez o revise el botón «Impresora».';
        }
      }
      // Pagos, efectivo recibido y vuelto: salen de lo que guardó el servidor
      const pagos = Array.isArray(comp.pagos_snapshot) ? comp.pagos_snapshot : [];
      const recibido = pagos.filter((p) => p.medio === 'efectivo' && p.recibido != null).reduce((t, p) => t + Number(p.recibido), 0);
      const vuelto = comp.vuelto != null && Number.isFinite(Number(comp.vuelto)) ? Number(comp.vuelto) : vueltoLocal;
      const pagosEl = pagos.length ? h('div.exito-pagos', { 'aria-label': 'Cómo pagó el cliente', role: 'group' },
        pagos.map((p) => h('div.ex-fila', h('span', MEDIOS[p.medio] || p.medio), h('b', money(p.monto)))),
        recibido > 0 ? h('div.ex-fila.recibido', h('span', 'Efectivo que entregó el cliente'), h('b', money(recibido))) : null) : null;
      let cerrarM;
      const fmtPrincipal = aj.formato === 'carta' ? 'carta' : 'tiquete';
      const nombrePrincipal = fmtPrincipal === 'carta' ? 'factura carta' : 'tiquete';
      const contenido = h('div.exito',
        h('div.gran', '✓ Cobro registrado'),
        aviso ? h('div.error-caja', aviso) : null,
        h('div', h('div', (TIPOS_DOC[comp.tipo_doc] || 'Comprobante') + (numeroDoc(comp.consecutivo) ? ' N.° ' + numeroDoc(comp.consecutivo) : '')), h('div.gran', money(comp.total))),
        pagosEl,
        vuelto > 0 ? h('div.vuelto-caja', h('div', 'Entregue de vuelto'), h('div.monto', money(vuelto))) : h('p.tenue-linea', 'Sin vuelto.'),
        h('div.estado-caja', chip), msgEstado, impEstado,
        h('div.botones',
          h('button.btn.primario.grande', { type: 'button', onclick: () => { cerrarM(); nuevaCuenta(); } }, 'Nueva cuenta'),
          h('button.btn', { type: 'button', onclick: () => imprimir(fmtPrincipal) }, aj.auto ? 'Imprimir otra vez' : 'Imprimir ' + nombrePrincipal),
          h('button.btn', { type: 'button', onclick: () => imprimir(fmtPrincipal === 'carta' ? 'tiquete' : 'carta') }, fmtPrincipal === 'carta' ? 'Imprimir tiquete' : 'Imprimir factura carta'),
          h('button.btn.suave', { type: 'button', onclick: () => cerrarM() }, 'Listo, cerrar'),
          h('button.btn.peligro', { type: 'button', onclick: () => { cerrarM(); app.ir('anular'); } }, 'Me equivoqué: anular esta factura')));
      const mo = modal({ titulo: 'Cobro listo', contenido, ancho: 520, alCerrar: () => { abierto = false; dejarDeVigilar(); if (vivo && buscador && fino()) buscador.inp.focus(); } });
      cerrarM = mo.cerrar;
      if (aj.auto) imprimir(fmtPrincipal);
      else impEstado.textContent = 'No se imprimió sola (la impresión automática está apagada en «Impresora»). Toque «Imprimir ' + nombrePrincipal + '» si el cliente lo quiere.';
      vigilar();
    }

    /* ---------- Arranque ---------- */
    // «Hacer la venta de nuevo en Caja» (Anular factura) deja en sessionStorage['fx.caja.abrir'] el id de la cuenta nueva que se creó con
    // las mismas líneas. Se lee UNA sola vez (y se borra al leerla), se deja como cuenta activa y, si no se pudo abrir, se avisa con palabras.
    const CLAVE_ABRIR = 'fx.caja.abrir';
    let pedida = null; // id pedido, mientras no se abra la caja o no se haya podido leer
    function leerPedida() {
      try {
        const id = sessionStorage.getItem(CLAVE_ABRIR);
        if (id != null) sessionStorage.removeItem(CLAVE_ABRIR);
        if (id && String(id).trim()) pedida = String(id).trim();
      } catch { /* sin almacenamiento: no hay cuenta pedida */ }
    }
    let avisoApertura = null; // { ok, texto } se muestra al terminar de armar la caja
    async function abrirPedida() {
      const id = pedida; pedida = null;
      try {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error('El número de la cuenta no es válido.');
        const v = await api.venta(id);
        if (!v?.venta) throw new Error('No se encontró esa cuenta.');
        if (v.venta.estado !== 'abierta' && v.venta.estado !== 'prefacturada') {
          throw new Error('Esa cuenta ya no está abierta (ya se cobró o se anuló).');
        }
        cur = v; guardarActiva();
        if (!abiertas.some((x) => x.id === id)) sincronizarBarra();
        const n = v.lineas.length;
        avisoApertura = { ok: true, texto: 'Se abrió la cuenta «' + (v.venta.referencia || numCuenta(v.venta.numero)) + '» con ' + n + (n === 1 ? ' producto' : ' productos') + '. Revísela y cóbrela cuando esté lista.' };
      } catch (e) {
        const crudo = String(e?.message || '');
        const claro = /uuid|invalid input/i.test(crudo) ? 'El número de la cuenta no es válido.' : (crudo || 'No se sabe el motivo.');
        avisoApertura = { ok: false, texto: (/[.!?]$/.test(claro) ? claro : claro + '.') + ' Busque la cuenta nueva entre las cuentas abiertas, o repita la corrección desde «Anular factura».' };
        await elegirInicial();
      }
    }
    function mostrarAvisoApertura() {
      const a = avisoApertura; avisoApertura = null;
      if (!a || !barraAviso) return;
      if (a.ok) { toast(a.texto, 'ok', 8000); return; }
      const cerrar = h('button.btn', { type: 'button', onclick: () => { n.remove(); } }, 'Entendido');
      const n = h('div.aviso-red', { role: 'alert' }, h('div.aviso-red-txt', h('strong', 'No se pudo abrir la cuenta de la corrección. '), a.texto), h('div.fila', cerrar));
      barraAviso.prepend(n);
    }
    async function iniciar() {
      zonaEfectivo?.destruir(); zonaEfectivo = null;
      turnoMostrado = app.turno?.id || null;
      leerPedida();
      if (!turnoMostrado) { cur = null; pintarSinTurno(); return; }
      root.replaceChildren(esqueleto(4, 'Cargando la caja…'));
      try {
        await Promise.all([cargarCatalogo(), cargarAbiertas()]);
        if (pedida) await abrirPedida(); else await elegirInicial();
      } catch (e) {
        if (!vivo) return;
        root.replaceChildren(bloqueError({ titulo: 'No se pudo cargar la caja', mensaje: e.message || String(e), alReintentar: () => iniciar() }));
        return;
      }
      armarCaja();
      mostrarAvisoApertura();
    }

    // Escribir con el teclado (o el lector de códigos) en cualquier parte lleva el texto al buscador
    function teclaGlobal(e) {
      if (!buscador || e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
      if (document.querySelector('.modal-fondo')) return;
      const t = e.target;
      if (t && t.closest && t.closest('.efz-tarjeta')) return; // escribiendo en la tarjeta de efectivo: el texto no se lleva al buscador
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      buscador.inp.focus();
    }
    document.addEventListener('keydown', teclaGlobal);

    const alCambio = () => { if (vivo && (app.turno?.id || null) !== turnoMostrado) iniciar(); };
    document.addEventListener('app:cambio', alCambio);
    window.addEventListener('resize', midePegajosos);
    // La barra de abajo se sube sobre el teclado cuando este tapa la parte de abajo sin achicar la página (iPhone y Android recientes)
    const vvTeclado = window.visualViewport;
    const alTeclado = () => { if (!cajaEl) return; cajaEl.style.setProperty('--teclado', Math.max(0, Math.round(window.innerHeight - vvTeclado.height - vvTeclado.offsetTop)) + 'px'); cajaEl.style.setProperty('--vv-alto', Math.round(vvTeclado.height) + 'px'); };
    if (vvTeclado) { vvTeclado.addEventListener('resize', alTeclado); vvTeclado.addEventListener('scroll', alTeclado); }

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
    timers.push(setInterval(revisarCatalogo, 5 * 60 * 1000));
    imp().catch(() => {}); // deja listo el módulo de impresión para leer sus ajustes al cobrar
    const alVolver = () => { if (!document.hidden) refrescoSilencioso(); };
    document.addEventListener('visibilitychange', alVolver);

    await iniciar();

    return () => {
      vivo = false;
      timers.forEach(clearInterval);
      zonaEfectivo?.destruir(); zonaEfectivo = null;
      document.removeEventListener('keydown', teclaGlobal);
      document.removeEventListener('app:cambio', alCambio);
      document.removeEventListener('visibilitychange', alVolver);
      window.removeEventListener('resize', midePegajosos);
      if (vvTeclado) { vvTeclado.removeEventListener('resize', alTeclado); vvTeclado.removeEventListener('scroll', alTeclado); }
      document.body.classList.remove('fx-caja');
    };
  },
};
