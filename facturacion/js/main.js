// Arranque del facturador: inicio de sesión (usuario + PIN), cabecera, pestañas y módulos.
import { sb, api, entrar, salir } from './api.js';
import { h, $, toast, modal, conBoton } from './util.js';

const raiz = document.getElementById('app');

// Módulos en el orden en que aparecen. Cada archivo exporta por defecto { id, titulo, mount(root, app) -> (opcional) función de limpieza }
const MODULOS = [
  { id: 'caja', titulo: 'Caja', archivo: './m_caja.js' },
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
  async refrescar() { // recarga sociedades y turno; avisa a la cabecera y a quien escuche
    this.ctx = await api.contexto();
    pintarCabecera();
    document.dispatchEvent(new CustomEvent('app:cambio'));
    return this.ctx;
  },
  ir(id) { irA(id); },
};
window.fx = app;

/* ---------- Inicio de sesión ---------- */
function pantallaLogin(mensaje) {
  raiz.replaceChildren();
  let pin = '';
  const puntos = [0, 1, 2, 3].map(() => h('i'));
  const usuario = h('input.campo', { type: 'text', autocomplete: 'username', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', placeholder: 'Su usuario', 'aria-label': 'Usuario', value: leer('usuario') || '' });
  const err = h('div.error-caja', { hidden: true });
  const pintar = () => puntos.forEach((p, i) => p.classList.toggle('lleno', i < pin.length));
  const mostrarError = (m) => { err.textContent = m; err.hidden = !m; };
  let ocupado = false;
  const intentar = async () => {
    if (ocupado) return;
    if (!usuario.value.trim()) { mostrarError('Escriba su usuario.'); usuario.focus(); return; }
    if (pin.length < 4) { mostrarError('El PIN tiene 4 números.'); return; }
    ocupado = true; mostrarError('');
    try {
      await entrar(usuario.value.trim().toLowerCase(), pin);
      guardar('usuario', usuario.value.trim().toLowerCase());
      await arrancar();
    } catch (e) { pin = ''; pintar(); mostrarError(e.message); }
    finally { ocupado = false; }
  };
  const tecla = (d) => { if (pin.length < 4) { pin += d; pintar(); mostrarError(''); if (pin.length === 4) setTimeout(intentar, 150); } };
  const borrar = () => { pin = pin.slice(0, -1); pintar(); };
  const boton = (t, f, c) => h('button' + (c ? '.' + c : ''), { type: 'button', onclick: f }, t);
  const teclado = h('div.teclado', [1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => boton(d, () => tecla(String(d)))),
    boton('Borrar', borrar, 'texto'), boton('0', () => tecla('0')), boton('Entrar', intentar, 'texto'));
  document.onkeydown = (e) => {
    if (document.activeElement === usuario) { if (e.key === 'Enter') { e.preventDefault(); $('.teclado button:nth-child(11)')?.focus(); } return; }
    if (/^[0-9]$/.test(e.key)) tecla(e.key); else if (e.key === 'Backspace') borrar(); else if (e.key === 'Enter') intentar();
  };
  raiz.append(h('div.pantalla-centro', h('div.login.tarjeta',
    h('div.logos', h('img', { src: 'img/logo-soda.svg', alt: 'Soda La Bomba' }), h('img', { src: 'img/logo-pollos.svg', alt: 'Pollos La Bomba' })),
    h('h1', 'Facturación'),
    h('p.sub', 'Escriba su usuario y su PIN de 4 números'),
    mensaje ? h('div.error-caja', mensaje) : null,
    h('label.etq', 'Usuario', usuario),
    h('div.pin-puntos', { 'aria-label': 'PIN' }, puntos),
    err, teclado)));
  if (!usuario.value) usuario.focus();
}

/* ---------- Cambio obligatorio de PIN (primer ingreso o reinicio por el administrador) ---------- */
function pantallaCambioPin() {
  raiz.replaceChildren();
  const actual = h('input.campo', { type: 'password', inputmode: 'numeric', maxlength: 4, autocomplete: 'current-password', 'aria-label': 'PIN actual' });
  const nuevo = h('input.campo', { type: 'password', inputmode: 'numeric', maxlength: 4, autocomplete: 'new-password', 'aria-label': 'PIN nuevo' });
  const otra = h('input.campo', { type: 'password', inputmode: 'numeric', maxlength: 4, autocomplete: 'new-password', 'aria-label': 'Repita el PIN nuevo' });
  const err = h('div.error-caja', { hidden: true });
  const ok = h('button.btn.primario.grande', { type: 'button', onclick: () => conBoton(ok, async () => {
    err.hidden = true;
    if (!/^\d{4}$/.test(nuevo.value)) return mostrar('El PIN nuevo debe tener 4 números.');
    if (nuevo.value !== otra.value) return mostrar('Los dos PIN nuevos no son iguales.');
    try { await api.pinCambiar(actual.value, nuevo.value); toast('PIN cambiado.'); await arrancar(); } catch (e) { mostrar(e.message); }
  }) }, 'Guardar mi PIN nuevo');
  const mostrar = (m) => { err.textContent = m; err.hidden = false; };
  raiz.append(h('div.pantalla-centro', h('div.login.tarjeta.col',
    h('h1', 'Elija su PIN'),
    h('p.sub', 'Por seguridad, cambie el PIN que le dieron por uno que solo usted conozca. Tiene que ser de 4 números; evite 1234 o repetir el mismo número.'),
    h('label.etq', 'PIN actual (el que le dieron)', actual),
    h('label.etq', 'PIN nuevo', nuevo),
    h('label.etq', 'Repita el PIN nuevo', otra),
    err, ok,
    h('button.btn.suave', { type: 'button', onclick: async () => { await salir(); pantallaLogin(); } }, 'Salir'))));
  actual.focus();
}

/* ---------- Cabecera y navegación ---------- */
let cab, vista, tabs;
function pintarCabecera() {
  if (!cab) return;
  const s = app.soc, t = app.turno;
  const sel = cab.querySelector('.soc-sel');
  sel.replaceChildren(...app.ctx.sociedades.map((x) => h('button', { type: 'button', 'aria-pressed': String(x.id === app.socId), onclick: () => cambiarSoc(x.id) }, x.nombre_comercial || x.nombre)));
  cab.querySelector('.marca img').src = 'img/logo-' + (s.codigo === 'pollos' ? 'pollos' : 'soda') + '.svg';
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
  irA(app.moduloActual?.id || 'caja', true);
}

let limpieza = null;
async function irA(id, forzar) {
  const def = MODULOS.find((m) => m.id === id) || MODULOS[0];
  if (!forzar && app.moduloActual?.id === def.id) return;
  app.moduloActual = def; guardar('mod', def.id);
  tabs.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.id === def.id)));
  try { limpieza?.(); } catch { /* nada */ }
  limpieza = null;
  vista.replaceChildren(h('p.cargando', 'Cargando…'));
  try {
    const mod = (await import(def.archivo)).default;
    const caja = h('div');
    vista.replaceChildren(caja);
    limpieza = (await mod.mount(caja, app)) || null;
  } catch (e) {
    console.error(e);
    vista.replaceChildren(h('div.vacio', h('p', 'Esta sección no se pudo abrir.'), h('p.tenue', e.message || String(e)), h('button.btn', { onclick: () => irA(def.id, true) }, 'Intentar de nuevo')));
  }
}

function armarApp() {
  document.onkeydown = null;
  raiz.replaceChildren();
  const disponibles = MODULOS.filter((m) => !m.soloAdmin || app.admin);
  tabs = h('nav.pestanas', { role: 'tablist' }, disponibles.map((m) => h('button', { role: 'tab', 'data-id': m.id, 'aria-selected': 'false', onclick: () => irA(m.id) }, m.titulo)));
  vista = h('main#vista');
  cab = h('header.cabecera',
    h('div.cab-fila',
      h('div.marca', h('img', { alt: 'La Bomba' })),
      h('div.soc-sel', { role: 'group', 'aria-label': 'Local' }),
      h('span.amb'),
      h('span.estado-turno'),
      h('div.usuario-caja', h('span', 'Sesión de ', h('strong', app.ctx.nombre || app.usuario)),
        h('button.btn.chico', { type: 'button', onclick: () => cambiarPinDialogo() }, 'Cambiar mi PIN'),
        h('button.btn.chico', { type: 'button', onclick: async () => { await salir(); app.ctx = null; pantallaLogin(); } }, 'Cerrar sesión'))),
    tabs);
  raiz.append(cab, vista);
  pintarCabecera();
  const ultimo = leer('mod');
  irA(disponibles.some((m) => m.id === ultimo) ? ultimo : 'caja', true);
}

function cambiarPinDialogo() {
  const a = h('input.campo', { type: 'password', inputmode: 'numeric', maxlength: 4 });
  const n = h('input.campo', { type: 'password', inputmode: 'numeric', maxlength: 4 });
  const r = h('input.campo', { type: 'password', inputmode: 'numeric', maxlength: 4 });
  modal({ titulo: 'Cambiar mi PIN', ancho: 400,
    contenido: h('div.col', h('label.etq', 'PIN actual', a), h('label.etq', 'PIN nuevo (4 números)', n), h('label.etq', 'Repita el PIN nuevo', r)),
    botones: [{ texto: 'Cancelar', onclick: (c) => c() }, { texto: 'Guardar PIN', clase: 'primario', onclick: async (c) => {
      if (n.value !== r.value) return toast('Los dos PIN nuevos no son iguales.', 'error');
      try { await api.pinCambiar(a.value, n.value); toast('PIN cambiado.'); c(); } catch (e) { toast(e.message, 'error', 6000); }
    } }] });
}

/* ---------- Arranque ---------- */
async function arrancar() {
  try {
    app.ctx = await api.contexto();
  } catch (e) {
    if (/venci|sin acceso|JWT|not authenticated/i.test(e.message || '')) {
      await salir().catch(() => {});
      return pantallaLogin('Ingrese de nuevo.');
    }
    // Falla momentánea de red o del servicio: no se cierra la sesión, se ofrece reintentar
    raiz.replaceChildren(h('div.pantalla-centro', h('div.login.tarjeta.col',
      h('h1', 'Sin conexión por un momento'),
      h('p.sub', 'No se pudo cargar. Su sesión sigue abierta. Revise la conexión e intente de nuevo.'),
      h('button.btn.primario.grande', { type: 'button', onclick: () => arrancar() }, 'Intentar de nuevo'),
      h('button.btn.suave', { type: 'button', onclick: async () => { await salir(); pantallaLogin(); } }, 'Salir'))));
    return;
  }
  if (app.ctx.debe_cambiar_pin) return pantallaCambioPin();
  const guardada = leer('soc');
  app.socId = app.ctx.sociedades.some((s) => s.id === guardada) ? guardada : app.ctx.sociedades.find((s) => s.codigo === 'pollos')?.id || app.ctx.sociedades[0]?.id;
  armarApp();
}

(async () => {
  const { data } = await sb.auth.getSession();
  if (data.session) await arrancar(); else pantallaLogin();
})();
