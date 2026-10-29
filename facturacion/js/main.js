// Arranque del facturador: inicio de sesión (usuario + PIN), cabecera, pestañas, avisos y módulos.
import { sb, api, entrar, salir, esTransitorio, esSesionVencida } from './api.js';
import { h, toast, modal, conBoton, esqueleto, bloqueError, nombreLocal, cerrarVentanas, conPunto, pinDebil, tiempoFalta, horaCorta } from './util.js';

const raiz = document.getElementById('app');
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

// Módulos en el orden en que aparecen. Cada archivo exporta por defecto { id, titulo, mount(root, app) -> (opcional) función de limpieza }
const MODULOS = [
  { id: 'caja', titulo: 'Caja', archivo: './m_caja.js' },
  { id: 'anular', titulo: 'Anular factura', archivo: './m_anular.js' },
  { id: 'documentos', titulo: 'Documentos del día', archivo: './m_documentos.js' },
  { id: 'turno', titulo: 'Cierre de caja', archivo: './m_turno.js' },
  { id: 'clientes', titulo: 'Clientes', archivo: './m_clientes.js' },
  { id: 'productos', titulo: 'Productos', archivo: './m_productos.js' },
  { id: 'listados', titulo: 'Listados', archivo: './m_listados.js' },
  { id: 'recepcion', titulo: 'Recepción', archivo: './m_recepcion.js' },
  { id: 'usuarios', titulo: 'Usuarios', archivo: './m_usuarios.js', soloAdmin: true },
];

const guardar = (k, v) => { try { localStorage.setItem('fx_' + k, v); } catch { /* sin almacenamiento */ } };
const leer = (k) => { try { return localStorage.getItem('fx_' + k); } catch { return null; } };
const SESION_INVALIDA = /venci|sin acceso|JWT|not authenticated/i;
const PIN_FACIL = 'Elija un PIN menos obvio. ';

// Estado compartido con los módulos
export const app = {
  api,
  ctx: null,
  socId: null,
  terminal: 1, // una caja por local
  get soc() { return this.ctx?.sociedades.find((s) => s.id === this.socId) || null; },
  get turno() { return this.soc?.turno || null; },
  get usuario() { return this.ctx?.usuario; },
  get admin() { return !!this.ctx?.admin; },
  moduloActual: null,
  pedido: null, // lo que una pantalla le pide a la otra al abrirla (por ejemplo { filtro: 'problemas' }); el módulo lo lee al empezar
  // Avisos del encabezado. datos = { rechazados, pendientes, recepcion_por_responder, ultimos, desde }. refrescar() vuelve a preguntar de inmediato.
  alertas: { datos: null, refrescar: () => actualizarAlertas(true), fijarRecepcion: (c) => { if (c) { recepcionCache = { pendientes_en_plazo: Number(c.pendientes_en_plazo ?? 0), vencen_pronto: Number(c.vencen_pronto ?? 0) }; recepcionHora = Date.now(); } fijarRecepcion(c); } },
  async refrescar() { // recarga sociedades y turno; avisa a la cabecera y a quien escuche
    this.ctx = await api.contexto();
    pintarCabecera();
    document.dispatchEvent(new CustomEvent('app:cambio'));
    return this.ctx;
  },
  ir(id, pedido) { this.pedido = pedido || null; irA(id, !!pedido); },
};
window.fx = app;

// Ningún error se queda callado: si algo falla dentro de un botón y nadie lo avisó, sale un mensaje claro
let ultimoAviso = { t: 0, m: '' };
window.addEventListener('unhandledrejection', (ev) => {
  const e = ev.reason;
  if (e?.name === 'AbortError') return;
  if (esSesionVencida(e)) return; // ya sale la ventana «Entrar de nuevo»
  console.error(e);
  const m = (e && e.message && !/^(TypeError|ReferenceError|SyntaxError)/.test(String(e.message))) ? e.message : 'Algo no salió como se esperaba. Intente de nuevo; si sigue igual, avise a la persona encargada.';
  if (m === ultimoAviso.m && Date.now() - ultimoAviso.t < 2500) return;
  ultimoAviso = { t: Date.now(), m };
  toast(m, 'error', 7000);
});

/* ---------- Teclado de PIN (lo usan el inicio de sesión y «Entrar de nuevo») ---------- */
// antes() puede devolver false para no aceptar el número (por ejemplo si falta el usuario). alCompletar() se llama con 4 números o al tocar «Entrar».
function crearPad({ antes, alCompletar, textoEntrar = 'Entrar' }) {
  let pin = '', ocupado = false;
  const puntos = [0, 1, 2, 3].map(() => h('i'));
  const dots = h('div.pin-puntos', { role: 'img', 'aria-label': 'PIN: 0 de 4 números escritos' }, puntos);
  const pintar = () => { puntos.forEach((p, i) => p.classList.toggle('lleno', i < pin.length)); dots.setAttribute('aria-label', 'PIN: ' + pin.length + ' de 4 números escritos'); };
  const tecla = (d) => {
    if (ocupado) return;
    if (antes && antes() === false) return;
    if (pin.length < 4) { pin += d; pintar(); if (pin.length === 4) setTimeout(alCompletar, 150); }
  };
  const borrar = () => { if (ocupado) return; pin = pin.slice(0, -1); pintar(); };
  const boton = (t, f, c) => h('button' + (c ? '.' + c : ''), { type: 'button', onclick: f }, t);
  const teclado = h('div.teclado', [1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => boton(d, () => tecla(String(d)))),
    boton('Borrar', borrar, 'texto'), boton('0', () => tecla('0')), boton(textoEntrar, () => alCompletar(), 'texto'));
  return {
    dots, teclado, tecla, borrar,
    valor: () => pin,
    limpiar: () => { pin = ''; pintar(); },
    bloquear: (si) => { ocupado = si; teclado.querySelectorAll('button').forEach((b) => { b.disabled = si; }); },
  };
}

// Texto del error de acceso. Un bloqueo dice a qué hora termina y cuánto falta; los demás mensajes siempre terminan en punto.
function textoErrorAcceso(e) {
  const m = (e && e.message) || 'No se pudo entrar. Revise la conexión e intente de nuevo.';
  const hasta = e && e.hasta ? new Date(e.hasta) : null;
  if (e && e.estado === 429 && hasta && !Number.isNaN(+hasta)) {
    const falta = tiempoFalta(hasta);
    if (!falta) return 'Ya puede intentar de nuevo.';
    const porConexion = /conexi[oó]n/i.test(m);
    return (porConexion ? 'Demasiados intentos desde esta conexión.' : 'Demasiados intentos. Por seguridad este usuario queda bloqueado.') + ' Podrá intentar de nuevo a las ' + horaCorta(hasta) + ' (faltan ' + falta + ').' + (porConexion ? '' : ' Si no quiere esperar, pida a un administrador que le reinicie el PIN.');
  }
  return conPunto(m);
}
// Los errores esperados del acceso (PIN incorrecto, bloqueo) no son fallas: no se anotan en la consola
const esErrorEsperado = (e) => !!e && [400, 401, 429].includes(e.estado);

/* ---------- Inicio de sesión ---------- */
function pantallaLogin(mensaje) {
  raiz.replaceChildren();
  const usuario = h('input.campo', { type: 'text', autocomplete: 'username', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', placeholder: 'Su usuario', 'aria-label': 'Usuario', value: leer('usuario') || '' });
  const err = h('div.error-caja', { hidden: true, role: 'alert' });
  const estado = h('div.entrando', { hidden: true, role: 'status', 'aria-live': 'polite' });
  let reloj = null;
  const mostrarError = (m) => { err.textContent = m; err.hidden = !m; };
  const mostrarEstado = (m) => { estado.textContent = m; estado.hidden = !m; };
  const alertar = (e) => {
    clearInterval(reloj);
    mostrarError(textoErrorAcceso(e));
    if (e && e.estado === 429 && e.hasta) reloj = setInterval(() => { if (!err.isConnected) return clearInterval(reloj); mostrarError(textoErrorAcceso(e)); }, 15000); // la cuenta regresiva se actualiza sola
  };
  let ocupado = false;
  const pad = crearPad({
    // Sin usuario no se acepta ningún número: así el PIN nunca queda lleno y «atascado»
    antes: () => { if (usuario.value.trim()) return true; mostrarError('Primero escriba su usuario.'); usuario.focus(); return false; },
    alCompletar: () => intentar(),
  });
  const bloquear = (si) => { ocupado = si; pad.bloquear(si); usuario.disabled = si; };
  async function intentar() {
    if (ocupado) return;
    if (!usuario.value.trim()) { pad.limpiar(); mostrarError('Escriba su usuario.'); usuario.focus(); return; }
    if (pad.valor().length < 4) { mostrarError('El PIN tiene 4 números.'); return; }
    clearInterval(reloj); mostrarError('');
    bloquear(true); mostrarEstado('Entrando…');
    try {
      const u = usuario.value.trim().toLowerCase();
      await entrar(u, pad.valor(), { alReintentar: () => mostrarEstado('El servidor tardó en responder. Reintentando…') });
      guardar('usuario', u);
      mostrarEstado('Cargando su caja…');
      await arrancar(true);
    } catch (e) {
      if (!esErrorEsperado(e)) console.error(e);
      pad.limpiar();
      alertar(e);
      mostrarEstado('');
      bloquear(false);
    }
  }
  usuario.addEventListener('input', () => { clearInterval(reloj); mostrarError(''); });
  document.onkeydown = (e) => {
    if (document.activeElement === usuario) { if (e.key === 'Enter') { e.preventDefault(); usuario.blur(); } return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^[0-9]$/.test(e.key)) { if (document.activeElement?.tagName === 'BUTTON') document.activeElement.blur(); pad.tecla(e.key); }
    else if (e.key === 'Backspace') pad.borrar();
    else if (e.key === 'Enter' && document.activeElement?.tagName !== 'BUTTON') intentar();
  };
  raiz.append(h('div.pantalla-centro', h('div.login.tarjeta',
    h('div.logos', h('img', { src: 'img/logo-soda.svg', alt: 'Soda La Bomba' }), h('img', { src: 'img/logo-pollos.svg', alt: 'Pollos La Bomba' })),
    h('h1', 'Facturación'),
    h('p.sub', 'Escriba su usuario y su PIN de 4 números'),
    mensaje ? h('div.error-caja', { role: 'alert' }, mensaje) : null,
    h('label.etq', 'Usuario', usuario),
    pad.dots, estado, err, pad.teclado)));
  if (!usuario.value) usuario.focus();
}

/* ---------- Cambio obligatorio de PIN (primer ingreso o reinicio por el administrador) ---------- */
// Revisa el PIN nuevo antes de mandarlo al servidor. Devuelve el texto del problema o ''.
function problemaPinNuevo(actual, nuevo, otra) {
  if (!/^\d{4}$/.test(actual)) return 'Escriba el PIN actual, que son 4 números.';
  if (!/^\d{4}$/.test(nuevo)) return 'El PIN nuevo debe tener 4 números.';
  const facil = pinDebil(nuevo);
  if (facil) return PIN_FACIL + facil;
  if (nuevo === actual) return 'El PIN nuevo debe ser distinto al actual.';
  if (otra != null && nuevo !== otra) return 'Los dos PIN nuevos no son iguales.';
  return '';
}
function pantallaCambioPin() {
  raiz.replaceChildren();
  const campoPin = (etiqueta, auto) => h('input.campo', { type: 'password', inputmode: 'numeric', maxlength: 4, autocomplete: auto, 'aria-label': etiqueta });
  const actual = campoPin('PIN actual', 'current-password'), nuevo = campoPin('PIN nuevo', 'new-password'), otra = campoPin('Repita el PIN nuevo', 'new-password');
  [actual, nuevo, otra].forEach((i) => i.addEventListener('input', () => { const v = i.value.replace(/\D/g, '').slice(0, 4); if (v !== i.value) i.value = v; }));
  const err = h('div.error-caja', { hidden: true, role: 'alert' });
  const mostrar = (m) => { err.textContent = m; err.hidden = !m; };
  const ok = h('button.btn.primario.grande', { type: 'button', onclick: () => conBoton(ok, async () => {
    mostrar('');
    const p = problemaPinNuevo(actual.value, nuevo.value, otra.value);
    if (p) return mostrar(p);
    try { await api.pinCambiar(actual.value, nuevo.value); toast('PIN cambiado.'); await arrancar(); } catch (e) { mostrar(conPunto(e.message)); }
  }) }, 'Guardar mi PIN nuevo');
  raiz.append(h('div.pantalla-centro', h('div.login.tarjeta.col',
    h('h1', 'Elija su PIN'),
    h('p.sub', 'Por seguridad, cambie el PIN que le dieron por uno que solo usted conozca. Tiene que ser de 4 números. Evite repetir el mismo número (1111), números seguidos (1234 o 4321) o parejas (1212).'),
    h('label.etq', 'PIN actual (el que le dieron)', actual),
    h('label.etq', 'PIN nuevo', nuevo),
    h('label.etq', 'Repita el PIN nuevo', otra),
    err, ok,
    h('button.btn.suave', { type: 'button', onclick: () => cerrarSesion() }, 'Salir'))));
  actual.focus();
}

function cambiarPinDialogo() {
  const campoPin = () => h('input.campo', { type: 'password', inputmode: 'numeric', maxlength: 4 });
  const a = campoPin(), n = campoPin(), r = campoPin();
  [a, n, r].forEach((i) => i.addEventListener('input', () => { const v = i.value.replace(/\D/g, '').slice(0, 4); if (v !== i.value) i.value = v; }));
  const err = h('div.error-caja', { hidden: true, role: 'alert' });
  modal({ titulo: 'Cambiar mi PIN', ancho: 400,
    contenido: h('div.col', h('label.etq', 'PIN actual', a), h('label.etq', 'PIN nuevo (4 números)', n), h('label.etq', 'Repita el PIN nuevo', r), err),
    botones: [{ texto: 'Cancelar', onclick: (c) => c() }, { texto: 'Guardar PIN', clase: 'primario', onclick: async (c) => {
      err.hidden = true;
      const p = problemaPinNuevo(a.value, n.value, r.value);
      if (p) { err.textContent = p; err.hidden = false; return; }
      try { await api.pinCambiar(a.value, n.value); toast('PIN cambiado.'); c(); } catch (e) { err.textContent = conPunto(e.message); err.hidden = false; }
    } }] });
}

/* ---------- Cabecera y navegación ---------- */
let cab, vista, tabs, pestCaja, alertaEl, redEl, menuEl, resizeRegistrado = false;
function pintarCabecera() {
  if (!cab || !app.ctx || !app.soc) return;
  const s = app.soc, t = app.turno;
  const sel = cab.querySelector('.soc-sel');
  const varios = app.ctx.sociedades.length > 1;
  sel.classList.toggle('uno', !varios);
  // Un solo local: solo su nombre. Varios: un botón por local, con el mismo formato de nombre (nombreLocal)
  sel.replaceChildren(...(varios
    ? app.ctx.sociedades.map((x) => h('button', { type: 'button', 'aria-pressed': String(x.id === app.socId), onclick: () => cambiarSoc(x.id) }, nombreLocal(x)))
    : [h('span.soc-nombre', nombreLocal(s))]));
  cab.querySelector('.marca img').src = 'img/logo-' + (String(s.codigo ?? '').toLowerCase() === 'pollos' ? 'pollos' : 'soda') + '.svg';
  cab.querySelector('.marca img').alt = nombreLocal(s);
  const et = cab.querySelector('.estado-turno');
  et.className = 'estado-turno ' + (t ? 'abierto' : 'cerrado');
  et.textContent = t ? 'Caja abierta desde las ' + new Date(t.abierto_en).toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Costa_Rica' }) : 'Caja cerrada: falta abrir turno';
  const amb = cab.querySelector('.amb');
  amb.textContent = s.ambiente === 'produccion' ? 'Facturas reales' : 'Modo de pruebas';
  amb.className = 'amb amb-prueba' + (s.ambiente === 'produccion' ? ' amb-prod' : '');
}

function cambiarSoc(id) {
  if (id === app.socId) return;
  app.socId = id; guardar('soc', id);
  pintarCabecera();
  api.catalogo(id).catch(() => {}); // calienta el catálogo del otro local mientras se abre la pantalla
  aplicarAlertas(null); fijarRecepcion(null); recepcionCache = null;
  actualizarAlertas(true);
  irA(app.moduloActual?.id || 'caja', true);
}

// El encabezado puede cambiar de alto (aparece o desaparece un aviso): las pantallas que se pegan debajo de él lo necesitan
function sincronizarAlturas() {
  if (!cab) return;
  const alto = cab.offsetHeight, st = document.documentElement.style;
  st.setProperty('--cab-alto', alto + 'px');
  if (st.getPropertyValue('--alto-cab')) st.setProperty('--alto-cab', alto + 'px'); // Productos
  if (st.getPropertyValue('--cab-h')) st.setProperty('--cab-h', (window.matchMedia('(max-width:979px)').matches ? 0 : alto) + 'px'); // Caja
}

/* Menú de la sesión (en pantallas angostas reúne «Cambiar mi PIN» y «Cerrar sesión») */
function abrirMenu(si) {
  if (!menuEl) return;
  menuEl.classList.toggle('abierto', si);
  menuEl.querySelector('.cab-menu')?.setAttribute('aria-expanded', String(si));
}
document.addEventListener('pointerdown', (e) => { if (menuEl?.classList.contains('abierto') && !menuEl.contains(e.target)) abrirMenu(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && menuEl?.classList.contains('abierto')) { abrirMenu(false); menuEl.querySelector('.cab-menu')?.focus(); } });

/* Pista de que las pestañas se deslizan: degradado en los bordes, botón «Más» y la pestaña activa siempre a la vista */
function actualizarPista() {
  if (!tabs || !pestCaja) return;
  const resto = tabs.scrollWidth - tabs.clientWidth - tabs.scrollLeft;
  pestCaja.classList.toggle('hay-mas', resto > 6);
  pestCaja.classList.toggle('hay-antes', tabs.scrollLeft > 6);
}
function verPestanaActiva(suave = true) {
  const b = tabs?.querySelector('button[aria-selected=true]');
  if (!b) return;
  const izq = b.offsetLeft - (tabs.clientWidth - b.offsetWidth) / 2;
  tabs.scrollTo({ left: Math.max(0, izq), behavior: suave ? 'smooth' : 'auto' });
}

/* ---------- Avisos del encabezado: documentos con problema y facturas por responder ---------- */
// Fuente: fx_alertas (contrato 3). Mientras no exista, api_documentos.js usa un valor de reserva sacado de fx_documentos.
// Se actualiza cada 60 segundos, al volver a la pestaña del navegador y cuando una pantalla lo pide con el evento 'app:alertas'.
let alSeq = 0, alTimer = null, alUltimo = 0, recepcionCache = null, recepcionHora = 0;
function aplicarAlertas(a) {
  app.alertas.datos = a;
  if (!alertaEl) return;
  const r = a ? a.rechazados : 0, p = a ? a.pendientes : 0;
  if (!r && !p) { alertaEl.hidden = true; sincronizarAlturas(); document.dispatchEvent(new CustomEvent('app:alertas-cambio', { detail: a })); return; }
  const titulo = [
    r ? (r === 1 ? 'Hacienda no aceptó 1 documento.' : 'Hacienda no aceptó ' + r + ' documentos.') : '',
    p ? (p === 1 ? '1 documento todavía no llegó a Hacienda.' : p + ' documentos todavía no llegaron a Hacienda.') : '',
  ].filter(Boolean).join(' ');
  const u = a.ultimos && a.ultimos[0];
  const detalle = u && u.mensaje ? (u.numero ? 'N.° ' + u.numero + ': ' : '') + conPunto(u.mensaje) : 'Toque «Ver» para revisar qué pasó y qué hay que hacer.';
  alertaEl.querySelector('strong').textContent = titulo;
  alertaEl.querySelector('.alerta-detalle').textContent = detalle;
  alertaEl.hidden = false;
  sincronizarAlturas();
  document.dispatchEvent(new CustomEvent('app:alertas-cambio', { detail: a }));
}
function verAlertas() {
  const a = app.alertas.datos;
  app.ir('documentos', { filtro: 'problemas', desde: a?.desde || null });
}
// Insignia de la pestaña Recepción: una sola, con la misma cifra que muestra la pantalla de Recepción
function fijarRecepcion(c) {
  const b = tabs?.querySelector('button[data-id=recepcion]');
  if (!b) return;
  b.querySelector('.pend')?.remove();
  b.removeAttribute('aria-label');
  const n = Number(c?.pendientes_en_plazo ?? 0);
  if (!c || !(n > 0)) return;
  const urge = Number(c.vencen_pronto ?? 0) > 0;
  b.append(' ', h('span.pend' + (urge ? '.urge' : ''), n + ' por responder'));
  b.setAttribute('aria-label', 'Recepción: ' + n + (n === 1 ? ' factura recibida por responder' : ' facturas recibidas por responder') + (urge ? ', algunas vencen pronto' : ''));
  actualizarPista();
}
async function actualizarAlertas(forzar = false) {
  if (!app.ctx || !app.soc || !cab) return;
  if (!forzar && Date.now() - alUltimo < 5000) return;
  alUltimo = Date.now();
  const mi = ++alSeq, soc = app.socId;
  try {
    const { alertas } = await import('./api_documentos.js');
    const a = await alertas(soc);
    if (mi !== alSeq || soc !== app.socId || !app.ctx) return;
    aplicarAlertas(a);
    if (a.recepcion_por_responder != null) {
      // fx_alertas no dice cuántas vencen pronto: se conserva lo que Recepción haya visto si la cifra no cambió
      const antes = recepcionCache && recepcionCache.pendientes_en_plazo === a.recepcion_por_responder ? recepcionCache.vencen_pronto : 0;
      recepcionCache = { pendientes_en_plazo: a.recepcion_por_responder, vencen_pronto: a.recepcion_vencen_pronto || antes };
    } else if (!recepcionCache || Date.now() - recepcionHora > 5 * 60 * 1000) {
      // Sin fx_alertas, la cifra sale de Recepción (cada 5 minutos, porque trae toda la lista)
      try { const { contarPendientes } = await import('./api_recepcion.js'); recepcionCache = await contarPendientes(soc); recepcionHora = Date.now(); } catch { /* queda la anterior */ }
    }
    if (mi === alSeq && soc === app.socId) fijarRecepcion(recepcionCache);
  } catch (e) { if (!esTransitorio(e) && !esSesionVencida(e)) console.warn('Avisos del encabezado no disponibles:', e?.message || e); }
}
function programarAlertas() {
  clearInterval(alTimer);
  alTimer = setInterval(() => { if (!document.hidden) actualizarAlertas(); }, 60 * 1000);
  const diferir = window.requestIdleCallback ? (f) => window.requestIdleCallback(f, { timeout: 2500 }) : (f) => setTimeout(f, 800);
  diferir(() => actualizarAlertas(true));
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) actualizarAlertas(); });
document.addEventListener('app:alertas', () => actualizarAlertas(true));
document.addEventListener('app:cambio', () => actualizarAlertas());

/* ---------- Sin conexión y sesión vencida ---------- */
function mostrarRed(sin) { if (redEl) { redEl.hidden = !sin; sincronizarAlturas(); } }
document.addEventListener('app:red', (e) => mostrarRed(!e.detail.ok));
window.addEventListener('offline', () => mostrarRed(true));
window.addEventListener('online', async () => {
  if (!app.ctx) return;
  try { await app.refrescar(); mostrarRed(false); } catch { /* se queda el aviso hasta que haya conexión de verdad */ }
});

document.addEventListener('app:sesion-vencida', () => mostrarSesionVencida());
// Ventana «Su sesión venció»: se queda encima de todo y no cierra nada de lo que hay detrás (cuentas abiertas, ventanas, textos escritos).
function mostrarSesionVencida() {
  if (!app.ctx || document.getElementById('sesion-vencida')) return;
  const codigo = app.ctx.usuario, nombre = app.ctx.nombre || codigo;
  const previos = [raiz, ...document.querySelectorAll('.modal-fondo')];
  previos.forEach((x) => { x.inert = true; });
  const cuerpo = h('div.modal-cuerpo');
  const fondo = h('div#sesion-vencida.modal-fondo.sesion-fondo', { role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'sv-tit' }, h('div.modal.sesion-caja', { style: 'max-width:420px' }, cuerpo));
  let reloj = null;
  const cerrar = () => { clearInterval(reloj); document.onkeydown = null; document.removeEventListener('keydown', alTeclear); fondo.remove(); previos.forEach((x) => { x.inert = false; }); };
  const paso1 = () => {
    cuerpo.replaceChildren(h('div.col',
      h('h2#sv-tit', 'Su sesión venció'),
      h('p', 'Por seguridad hay que volver a entrar con su PIN. Lo que tiene en pantalla no se cierra, y las cuentas que ya estaban guardadas siguen ahí.'),
      h('button.btn.primario.grande', { type: 'button', onclick: paso2 }, 'Entrar de nuevo'),
      h('button.btn.suave', { type: 'button', onclick: () => { cerrar(); cerrarSesion(); } }, 'Cerrar sesión y salir')));
    cuerpo.querySelector('.primario').focus();
  };
  const err = h('div.error-caja', { hidden: true, role: 'alert' });
  const estado = h('div.entrando', { hidden: true, role: 'status', 'aria-live': 'polite' });
  const pad = crearPad({ alCompletar: () => reentrar() });
  const mostrarError = (m) => { err.textContent = m; err.hidden = !m; };
  async function reentrar() {
    if (pad.valor().length < 4) { mostrarError('El PIN tiene 4 números.'); return; }
    clearInterval(reloj); mostrarError('');
    pad.bloquear(true); estado.textContent = 'Entrando…'; estado.hidden = false;
    try {
      await entrar(codigo, pad.valor());
      cerrar();
      toast('Listo, entró de nuevo. Puede seguir donde estaba.');
      try { await app.refrescar(); } catch { /* la cabecera se actualiza sola luego */ }
      actualizarAlertas(true);
      // Si alguna pantalla se quedó con el aviso «Su sesión venció» y un botón «Intentar de nuevo», se reintenta sola. Lo que ya cargó bien no se toca.
      if (vista && vista.textContent.includes('Su sesión venció')) vista.querySelectorAll('button').forEach((b) => { if (b.textContent.trim() === 'Intentar de nuevo') b.click(); });
    } catch (e) {
      if (!esErrorEsperado(e)) console.error(e);
      pad.limpiar(); mostrarError(textoErrorAcceso(e)); estado.hidden = true; pad.bloquear(false);
      if (e && e.estado === 429 && e.hasta) reloj = setInterval(() => { if (!err.isConnected) return clearInterval(reloj); mostrarError(textoErrorAcceso(e)); }, 15000);
    }
  }
  function paso2() {
    cuerpo.replaceChildren(h('div.col',
      h('h2#sv-tit', 'Escriba su PIN'),
      h('p.sub', 'Usuario: ', h('strong', nombre), '. Son 4 números.'),
      pad.dots, estado, err, pad.teclado,
      h('button.btn.suave', { type: 'button', onclick: () => { pad.limpiar(); mostrarError(''); paso1(); } }, 'Atrás')));
  }
  const alTeclear = (e) => {
    if (!cuerpo.querySelector('.teclado') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^[0-9]$/.test(e.key)) { if (document.activeElement?.tagName === 'BUTTON') document.activeElement.blur(); pad.tecla(e.key); }
    else if (e.key === 'Backspace') pad.borrar();
  };
  document.addEventListener('keydown', alTeclear);
  document.body.append(fondo);
  paso1();
}

/* ---------- Pantallas ---------- */
let limpieza = null;
let irSeq = 0;
async function irA(id, forzar) {
  const def = MODULOS.find((m) => m.id === id) || MODULOS[0];
  if (!forzar && app.moduloActual?.id === def.id) return;
  const mi = ++irSeq;
  app.moduloActual = def; guardar('mod', def.id);
  tabs.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.id === def.id)));
  verPestanaActiva();
  abrirMenu(false);
  try { limpieza?.(); } catch { /* nada */ }
  limpieza = null;
  vista.replaceChildren(esqueleto(4));
  try {
    const mod = (await import(def.archivo)).default;
    if (mi !== irSeq) return; // la persona ya cambió de pestaña
    const caja = h('div');
    vista.replaceChildren(caja);
    const fin = (await mod.mount(caja, app)) || null;
    if (mi !== irSeq) { try { fin?.(); } catch { /* nada */ } return; }
    limpieza = fin;
  } catch (e) {
    if (mi !== irSeq) return;
    if (!esSesionVencida(e)) console.error(e);
    vista.replaceChildren(bloqueError({
      titulo: 'Esta sección no se pudo abrir',
      mensaje: esTransitorio(e) || esSesionVencida(e) ? (e.message || '') : ((e && e.message) || String(e)),
      alReintentar: () => irA(def.id, true),
    }));
  } finally {
    if (mi === irSeq) app.pedido = null;
  }
}

function armarApp() {
  document.onkeydown = null;
  raiz.replaceChildren();
  const disponibles = MODULOS.filter((m) => !m.soloAdmin || app.admin);
  tabs = h('nav.pestanas', { role: 'tablist', 'aria-label': 'Secciones' }, disponibles.map((m) => h('button', { type: 'button', role: 'tab', 'data-id': m.id, 'aria-selected': 'false', onclick: () => irA(m.id) }, m.titulo)));
  tabs.addEventListener('scroll', actualizarPista, { passive: true });
  pestCaja = h('div.pest-caja', tabs,
    h('button.pest-mas', { type: 'button', 'aria-hidden': 'true', tabindex: '-1', onclick: () => tabs.scrollBy({ left: Math.max(160, tabs.clientWidth * 0.7), behavior: 'smooth' }) }, 'Más ›'));
  vista = h('main#vista');
  alertaEl = h('div.alerta-cab', { role: 'alert', hidden: true },
    h('div.alerta-in', h('div.alerta-texto', h('strong'), h('span.alerta-detalle')),
      h('button.btn.alerta-ver', { type: 'button', 'aria-label': 'Ver los documentos con problemas', onclick: verAlertas }, 'Ver')));
  redEl = h('div.sin-red', { role: 'status', hidden: true },
    h('div.sin-red-in', h('span', 'Sin conexión con el servidor. Lo que está en pantalla se conserva y todo sigue solo cuando vuelva internet.'),
      h('button.btn.chico', { type: 'button', onclick: (e) => conBoton(e.currentTarget, async () => { await app.refrescar(); mostrarRed(false); toast('Conexión recuperada.'); }) }, 'Revisar ahora')));
  menuEl = h('div.cab-usuario',
    h('button.btn.cab-menu', { type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false', 'aria-controls': 'cab-panel', onclick: () => abrirMenu(!menuEl.classList.contains('abierto')) }, 'Menú ▾'),
    h('div#cab-panel.cab-panel',
      h('span.cab-sesion', 'Sesión de ', h('strong', app.ctx.nombre || app.usuario)),
      h('button.btn.chico', { type: 'button', onclick: () => { abrirMenu(false); cambiarPinDialogo(); } }, 'Cambiar mi PIN'),
      h('button.btn.chico', { type: 'button', onclick: () => { abrirMenu(false); cerrarSesion(); } }, 'Cerrar sesión')));
  cab = h('header.cabecera',
    h('div.cab-fila',
      h('div.marca', h('img', { alt: 'La Bomba' })),
      h('div.cab-estado', h('div.soc-sel', { role: 'group', 'aria-label': 'Local' }), h('span.amb'), h('span.estado-turno')),
      // Atajo siempre visible: anular una factura no debe esconderse dentro de otra pantalla
      h('button.btn.cab-anular', { type: 'button', onclick: () => irA('anular') }, 'Anular factura'),
      menuEl),
    alertaEl, redEl, pestCaja);
  raiz.append(cab, vista);
  if (window.ResizeObserver) new ResizeObserver(() => { sincronizarAlturas(); actualizarPista(); }).observe(cab);
  if (!resizeRegistrado) { resizeRegistrado = true; window.addEventListener('resize', () => { actualizarPista(); verPestanaActiva(false); }); }
  pintarCabecera();
  const ultimo = leer('mod');
  irA(disponibles.some((m) => m.id === ultimo) ? ultimo : 'caja', true);
  verPestanaActiva(false);
  actualizarPista();
  programarAlertas(); // después de pintar: no retrasa la carga inicial
}

// Cierre de sesión limpio: detiene los avisos, cierra ventanas, borra la sesión de este aparato y deja la pantalla de entrada como nueva
let cerrando = false;
async function cerrarSesion() {
  if (cerrando) return;
  cerrando = true;
  try {
    clearInterval(alTimer); alSeq++;
    try { limpieza?.(); } catch { /* nada */ }
    limpieza = null;
    cerrarVentanas();
    document.getElementById('sesion-vencida')?.remove();
    document.getElementById('impresion-resumen')?.remove();
    document.querySelectorAll('#toasts .toast').forEach((t) => t.remove());
    await salir().catch(() => {});
    app.ctx = null; app.socId = null; app.moduloActual = null; app.pedido = null; app.alertas.datos = null;
    recepcionCache = null; recepcionHora = 0;
    cab = vista = tabs = pestCaja = alertaEl = redEl = menuEl = null;
    document.body.classList.remove('fx-caja');
    const st = document.documentElement.style;
    ['--cab-h', '--bus-h', '--alto-cab', '--cab-alto'].forEach((v) => st.removeProperty(v));
    raiz.inert = false;
    pantallaLogin();
  } finally { cerrando = false; }
}

/* ---------- Arranque ---------- */
// reciente = true cuando se acaba de iniciar sesión: si la primera consulta cae por sesión, se repite una vez antes de rendirse
async function cargarContexto(reciente) {
  try { return await api.contexto(); }
  catch (e) {
    if (reciente && SESION_INVALIDA.test(e?.message || '')) { await pausa(700); return await api.contexto(); }
    throw e;
  }
}
async function arrancar(reciente = false) {
  // Todo lo que se puede pedir a la vez se pide a la vez: contexto, catálogo del último local (queda en memoria) y el código de la última pestaña
  const guardada = leer('soc');
  const ultimo = leer('mod');
  if (guardada) api.catalogo(guardada).catch(() => {});
  const def = MODULOS.find((m) => m.id === ultimo) || MODULOS[0];
  import(def.archivo).catch(() => {});
  try {
    app.ctx = await cargarContexto(reciente);
  } catch (e) {
    if (SESION_INVALIDA.test(e?.message || '')) {
      await salir().catch(() => {});
      return pantallaLogin('Ingrese de nuevo.');
    }
    // Falla momentánea de red o del servicio: no se cierra la sesión, se ofrece reintentar
    raiz.replaceChildren(h('div.pantalla-centro', h('div.login.tarjeta.col',
      h('h1', 'Sin conexión por un momento'),
      h('p.sub', (esTransitorio(e) && e.message ? e.message + ' ' : '') + 'Su sesión sigue abierta.'),
      h('button.btn.primario.grande', { type: 'button', onclick: (ev) => conBoton(ev.currentTarget, () => arrancar()) }, 'Intentar de nuevo'),
      h('button.btn.suave', { type: 'button', onclick: async () => { await salir().catch(() => {}); pantallaLogin(); } }, 'Salir'))));
    return;
  }
  if (app.ctx.debe_cambiar_pin) return pantallaCambioPin();
  app.socId = app.ctx.sociedades.some((s) => s.id === guardada) ? guardada : app.ctx.sociedades.find((s) => String(s.codigo ?? '').toLowerCase() === 'pollos')?.id || app.ctx.sociedades[0]?.id;
  armarApp();
}

(async () => {
  try {
    const { data } = await sb.auth.getSession();
    if (data.session) await arrancar(); else pantallaLogin();
  } catch (e) { console.error(e); pantallaLogin(); }
})();
