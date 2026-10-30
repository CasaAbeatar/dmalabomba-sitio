// Arranque del facturador: inicio de sesión (código de empresa, usuario y PIN), cabecera, inicio con módulos, navegación por dirección (#) y avisos.
// Nunca se muestra dentro de otra página (un marco): GitHub Pages no deja poner cabeceras y una etiqueta meta no admite frame-ancestors, así que se corta aquí.
if (window.top !== window.self) { document.documentElement.replaceChildren(); throw new Error('El facturador no se muestra dentro de otra página.'); }
import { sb, api, entrar, salir, consultarEmpresa, normalizarEmpresa, esTransitorio, esSesionVencida } from './api.js';
import { h, toast, modal, conBoton, esqueleto, bloqueError, nombreLocal, cerrarVentanas, asentarVentanas, popEsDeVentana, conPunto, pinDebil, textoDeError, MSG_SIN_INTERNET } from './util.js';
import { buscar, padreDe } from './modulos.js';
import { pantallaInicio, pantallaAdmin, pintarInsignias } from './ui_inicio.js';

const raiz = document.getElementById('app');
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

const guardar = (k, v) => { try { localStorage.setItem('fx_' + k, v); } catch { /* sin almacenamiento */ } };
const leer = (k) => { try { return localStorage.getItem('fx_' + k); } catch { return null; } };
// Una sesión que ya no sirve se reconoce por su clase de error (api.js), no por palabras. Única excepción: fx_chk contesta «Sin acceso al facturador» (esa frase exacta, con código
// P0001) cuando el usuario fue desactivado; el día que fx_chk lo diga con el código PT403 basta el código (ErrorApi.codigo). Un 403 por otro motivo (el permiso de una función,
// una regla de la puerta de entrada) NO cierra la sesión: sale la pantalla de «Intentar de nuevo» con el mensaje que mandó el sistema.
const esSinAcceso = (e) => !!e && (e.codigo === 'PT403' || /^sin acceso al facturador\.?$/i.test(String(e.message || '').trim()));
const PIN_FACIL = 'Elija un PIN menos obvio. ';

// El PIN con el que la persona acaba de entrar, SOLO en memoria (nunca en el aparato) y solo para el cambio obligatorio de PIN: ese PIN ya se comprobó al entrar, así que la pantalla no
// lo vuelve a pedir. El servidor igual lo verifica al cambiarlo. Se olvida al cambiar el PIN, al salir, cuando la sesión no tiene cambio pendiente y a los pocos minutos.
const VIDA_PIN_DE_ENTRADA = 5 * 60 * 1000;
let pinDeEntrada = null; // { pin, hasta }
const recordarPinDeEntrada = (pin) => { pinDeEntrada = /^\d{4}$/.test(String(pin)) ? { pin: String(pin), hasta: Date.now() + VIDA_PIN_DE_ENTRADA } : null; };
const olvidarPinDeEntrada = () => { pinDeEntrada = null; };
const pinDeEntradaVigente = () => (pinDeEntrada && Date.now() < pinDeEntrada.hasta ? pinDeEntrada.pin : '');

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
  // La empresa de esta sesión: sale de la sociedad que devuelve el servidor, no de lo que haya en el aparato. codigo = el que se escribe para entrar.
  get empresa() { const s = this.soc; return s ? { id: s.id, codigo: String(s.codigo_acceso || s.codigo || '').toLowerCase(), nombre: nombreLocal(s), cedula: s.cedula || null } : null; },
  moduloActual: null, // el módulo (o pantalla) que se ve: una entrada de modulos.js o INICIO
  recepcion: null, // { pendientes_en_plazo, vencen_pronto, vencidas } de las facturas recibidas; alimenta las insignias de Contable y Administración
  inventario: null, // { vencidos, vencen_pronto, bajo_minimo, por_recibir, notas_por_revisar, urgente } de fx_inv_alertas_resumen; alimenta la insignia de Inventarios
  pedido: null, // lo que una pantalla le pide a la otra al abrirla (por ejemplo { filtro: 'problemas' }); el módulo lo lee al empezar
  // Avisos del encabezado. datos = { rechazados, pendientes, recepcion_por_responder, ultimos, desde }. refrescar() vuelve a preguntar de inmediato.
  alertas: { datos: null, refrescar: () => actualizarAlertas(true), fijarRecepcion: (c) => { if (c) { recepcionCache = { pendientes_en_plazo: Number(c.pendientes_en_plazo ?? 0), vencen_pronto: Number(c.vencen_pronto ?? 0), vencidas: vencidasDe(c) }; recepcionHora = Date.now(); } fijarRecepcion(recepcionCache && c ? recepcionCache : c); } },
  async refrescar() { // recarga sociedades y turno; avisa a la cabecera y a quien escuche
    this.ctx = await api.contexto();
    pintarCabecera();
    document.dispatchEvent(new CustomEvent('app:cambio'));
    return this.ctx;
  },
  // Abre un módulo por su id, su alias o su dirección (app.ir('caja'), app.ir('anular', { foco: 'buscar' }), app.ir('inicio')). Cambia la dirección (#) y el historial.
  ir(id, pedido) { this.pedido = pedido || null; ir(id); },
};
// Para revisar el sistema desde las herramientas del navegador: solo en la computadora de pruebas (localhost) y si la dirección lleva ?depurar. En la página publicada no existe.
try { if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && new URLSearchParams(location.search).has('depurar')) window.fx = app; } catch { /* sin acceso a la dirección */ }

// Ningún error se queda callado: si algo falla dentro de un botón y nadie lo avisó, sale un mensaje claro
let ultimoAviso = { t: 0, m: '' };
window.addEventListener('unhandledrejection', (ev) => {
  const e = ev.reason;
  if (e?.name === 'AbortError') return;
  if (esSesionVencida(e)) return; // ya sale la ventana «Entrar de nuevo»
  console.error(e);
  const m = textoDeError(e); // un error del sistema trae su frase clara; uno de programa o de red sale con la frase general o la de «sin internet»
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

// Texto del error de acceso. El ingreso NUNCA se bloquea: no hay esperas, ni hora de desbloqueo, ni intentos que se acaban; siempre se puede probar de nuevo en seguida.
// Un usuario o un PIN que no coinciden se dicen con palabras claras (sin revelar cuál de los dos falló). cambiarEmpresa = false en la ventana «Su sesión venció», donde la empresa y el usuario no se cambian.
function textoErrorAcceso(e, { cambiarEmpresa = true } = {}) {
  if (e && (e.motivo === 'empresa_desconocida' || e.motivo === 'empresa_no_habilitada')) return conPunto(e.message);
  if (e && e.motivo === 'sin_acceso_empresa') return 'Ese usuario no tiene acceso a esta empresa.' + (cambiarEmpresa ? ' Si trabaja en otro negocio, toque «Cambiar de empresa».' : ' Avise a la persona encargada.');
  if (e && e.estado === 401) {
    return cambiarEmpresa
      ? 'Usuario o PIN incorrecto. Intente de nuevo.' // corto a propósito: de una sola línea el teclado completo cabe en pantallas de 800 px de alto sin deslizar
      : 'El PIN no coincide. Escríbalo otra vez con cuidado; puede intentarlo de nuevo ahora mismo.';
  }
  return conPunto((e && e.message) || 'No se pudo entrar. Revise la conexión e intente de nuevo.');
}
// Los errores esperados del acceso (usuario o PIN que no coinciden, empresa no reconocida) no son fallas: no se anotan en la consola
const esErrorEsperado = (e) => !!e && [400, 401, 403, 404, 429].includes(e.estado);

/* ---------- Inicio de sesión: código de empresa, usuario y PIN ---------- */
// Paso 1: «Código de su empresa». Paso 2: la empresa reconocida en grande, usuario y PIN. La empresa queda recordada en este aparato (solo es comodidad:
// la que manda es la de la sesión, que ata el servidor), así que al volver a entrar, y después de cerrar sesión, se pasa directo al paso 2 con «Cambiar de empresa».
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function empresaRecordada() {
  try {
    const v = JSON.parse(leer('empresa') || 'null');
    if (!v || !/^[a-z0-9._-]{1,30}$/.test(String(v.codigo || ''))) return null;
    return { codigo: v.codigo, nombre: String(v.nombre || '').slice(0, 80), cedula: v.cedula ? String(v.cedula).slice(0, 20) : null, id: UUID.test(String(v.id || '')) ? v.id : null };
  } catch { return null; }
}
function recordarEmpresa(e) {
  if (!e?.codigo) return;
  guardar('empresa', JSON.stringify({ codigo: String(e.codigo).toLowerCase(), nombre: e.nombre || '', cedula: e.cedula || null, id: e.id || null }));
}
// La respuesta del servicio de acceso (o un registro de sociedad) a lo que se guarda y se muestra
const infoEmpresa = (e) => ({ id: e.id || null, codigo: String(e.codigo_acceso || e.codigo || '').toLowerCase(), nombre: nombreLocal(e) || 'Su empresa', cedula: e.cedula || null });
const limpiarUsuario = (v) => normalizarEmpresa(v).slice(0, 30);
// 3102111943 -> 3-102-111943 (cédula jurídica)
const cedulaJuridica = (c) => { const d = String(c ?? '').replace(/\D/g, ''); return d.length === 10 ? d[0] + '-' + d.slice(1, 4) + '-' + d.slice(4) : d; };
// Logo de cada empresa. Mientras no se sabe cuál es (pantalla de entrada, empresa que no está en la tabla) se usa un dibujo neutro que no es de ningún negocio.
const LOGOS = { pollos: 'img/logo-pollos.svg', soda: 'img/logo-soda.svg' };
const LOGO_NEUTRO = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="4" y="4" width="56" height="56" rx="14" fill="#fbf8f2" stroke="#8f8672" stroke-width="3"/><path d="M20 16h24v34l-4-3-4 3-4-3-4 3-4-3-4 3z" fill="none" stroke="#B81622" stroke-width="3" stroke-linejoin="round"/><path d="M26 25h12M26 32h12" stroke="#B81622" stroke-width="3" stroke-linecap="round"/></svg>');
const logoDe = (codigo) => LOGOS[String(codigo || '').toLowerCase()] || LOGO_NEUTRO;
// Ícono de la pestaña del navegador: el de la empresa de la sesión, o el neutro mientras no se sabe
function iconoPestana(codigo) {
  let l = document.querySelector('link[rel~="icon"]');
  if (!l) { l = document.createElement('link'); l.rel = 'icon'; document.head.append(l); }
  l.type = 'image/svg+xml';
  const href = logoDe(codigo);
  if (l.getAttribute('href') !== href) l.setAttribute('href', href);
}
iconoPestana(null);

function pantallaLogin(mensaje) {
  const emp = empresaRecordada();
  if (emp) pantallaUsuario(emp, mensaje); else pantallaCodigo({ mensaje });
}

// Paso 1
function pantallaCodigo({ mensaje = '', error = '', aviso: avisoInicial = '', codigo = '' } = {}) {
  raiz.replaceChildren();
  document.onkeydown = null;
  const campo = h('input.campo.grande', { type: 'text', autocomplete: 'off', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', maxlength: 60, placeholder: 'pollos', 'aria-label': 'Código de su empresa', 'aria-describedby': 'emp-ayuda', value: codigo });
  const err = h('div.error-caja', { hidden: true, role: 'alert' });
  const aviso = h('div.emp-aviso', { hidden: true, role: 'alert' });
  const mostrar = (m, suave = false) => { err.hidden = suave || !m; aviso.hidden = !suave || !m; (suave ? aviso : err).textContent = m || ''; };
  const seguir = h('button.btn.primario.grande.emp-seguir', { type: 'button', onclick: () => continuar() }, 'Continuar');
  let ocupado = false;
  async function continuar() {
    if (ocupado) return;
    if (!normalizarEmpresa(campo.value)) { mostrar('Escriba el código de su empresa, por ejemplo pollos.'); campo.focus(); return; }
    mostrar('');
    ocupado = true; seguir.disabled = true; campo.disabled = true; seguir.textContent = 'Buscando su empresa…';
    try {
      const e = await consultarEmpresa(campo.value, { alReintentar: () => { seguir.textContent = 'La respuesta tardó. Intentando de nuevo…'; } });
      const info = infoEmpresa(e);
      recordarEmpresa(info);
      pantallaUsuario(info);
    } catch (e) {
      if (!esErrorEsperado(e)) console.error(e);
      // «No está habilitada» no es un error de quien escribe: se dice con calma, en ámbar
      mostrar(textoErrorAcceso(e), e.motivo === 'empresa_no_habilitada');
      ocupado = false; seguir.disabled = false; campo.disabled = false; seguir.textContent = 'Continuar';
      campo.focus(); campo.select();
    }
  }
  campo.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); continuar(); } });
  campo.addEventListener('input', () => mostrar(''));
  raiz.append(h('div.pantalla-centro', h('div.login.tarjeta',
    h('div.logos', h('img', { src: 'img/logo-soda.svg', alt: 'Soda La Bomba' }), h('img', { src: 'img/logo-pollos.svg', alt: 'Pollos La Bomba' })),
    h('h1', 'Facturación'),
    h('p.sub', 'Primero escriba el código de su empresa'),
    mensaje ? h('div.error-caja', { role: 'alert' }, mensaje) : null,
    h('label.etq.emp-etq', 'Código de su empresa', campo),
    h('p#emp-ayuda.emp-ayuda', 'Es el código de su negocio, por ejemplo pollos'),
    err, aviso, seguir)));
  if (error) mostrar(error); else if (avisoInicial) mostrar(avisoInicial, true);
  campo.focus();
  if (campo.value) campo.select();
}

// Paso 2
function pantallaUsuario(emp, mensaje) {
  raiz.replaceChildren();
  const recordado = leer('usuario') || '';
  const usuario = h('input.campo', { type: 'text', autocomplete: 'username', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', placeholder: 'Su usuario', 'aria-label': 'Usuario', value: recordado });
  // En un aparato que usan varias personas el usuario de la vez anterior aparece escrito: se avisa con palabras y, al tocar el campo, queda seleccionado para escribir encima
  const notaUsuario = recordado ? h('small.tenue.usr-nota', 'Es el último usuario que entró en este aparato. Si usted es otra persona, escriba el suyo.') : null;
  const err = h('div.error-caja', { hidden: true, role: 'alert' });
  const estado = h('div.entrando', { hidden: true, role: 'status', 'aria-live': 'polite' });
  const mostrarError = (m) => { err.textContent = m; err.hidden = !m; };
  const mostrarEstado = (m) => { estado.textContent = m; estado.hidden = !m; };
  const alertar = (e) => mostrarError(textoErrorAcceso(e));
  let ocupado = false;
  const pad = crearPad({
    // Sin usuario no se acepta ningún número: así el PIN nunca queda lleno y «atascado»
    antes: () => { if (usuario.value.trim()) return true; mostrarError('Primero escriba su usuario.'); usuario.focus(); return false; },
    alCompletar: () => intentar(),
  });
  const cambiar = h('button.btn.emp-cambiar', { type: 'button', onclick: () => { if (!ocupado) pantallaCodigo({ codigo: emp.codigo }); } }, 'Cambiar de empresa'); // el código queda escrito y seleccionado: si fue un toque sin querer, basta «Continuar»
  const bloquear = (si) => { ocupado = si; pad.bloquear(si); usuario.disabled = si; cambiar.disabled = si; };
  // Cuenta regresiva cuando el servidor pide esperar (demora acotada del ingreso, nunca un bloqueo). No borra lo digitado; al llegar a 0 vuelve a habilitar el teclado.
  let relojEspera = null;
  function cuentaEspera(seg) {
    if (relojEspera) clearInterval(relojEspera);
    let queda = seg;
    bloquear(true);
    const pintar = () => mostrarError('Espere ' + queda + ' segundo' + (queda === 1 ? '' : 's') + ' e intente de nuevo.');
    pintar();
    relojEspera = setInterval(() => {
      queda -= 1;
      if (queda <= 0) { clearInterval(relojEspera); relojEspera = null; mostrarError(''); bloquear(false); if (!usuario.value) usuario.focus(); }
      else pintar();
    }, 1000);
  }
  async function intentar() {
    if (ocupado) return;
    if (!usuario.value.trim()) { pad.limpiar(); mostrarError('Escriba su usuario.'); usuario.focus(); return; }
    if (pad.valor().length < 4) { mostrarError('El PIN tiene 4 números.'); return; }
    mostrarError('');
    bloquear(true); mostrarEstado('Entrando…');
    try {
      const u = limpiarUsuario(usuario.value); // «María », «MARIA» y «ma ria» entran como «maria»: un usuario válido nunca lleva mayúsculas, tildes ni espacios
      const j = await entrar(emp.codigo, u, pad.valor(), { alReintentar: () => mostrarEstado('La respuesta tardó. Intentando de nuevo…') });
      recordarPinDeEntrada(pad.valor()); // solo en memoria: si hay que cambiar el PIN, no se vuelve a pedir el que acaba de comprobarse
      guardar('usuario', u);
      // El servicio de acceso nuevo devuelve la empresa de la sesión. Si todavía no la devuelve, vale la que se reconoció en el paso 1 (respaldo temporal).
      recordarEmpresa(j && j.empresa ? infoEmpresa(j.empresa) : emp);
      mostrarEstado('Cargando su caja…');
      await arrancar(true);
    } catch (e) {
      if (!esErrorEsperado(e)) console.error(e);
      // La empresa dejó de existir o de estar habilitada entre el paso 1 y ahora: se vuelve al código con el mensaje
      if (e && (e.motivo === 'empresa_desconocida' || e.motivo === 'empresa_no_habilitada')) { pantallaCodigo({ codigo: emp.codigo, [e.motivo === 'empresa_no_habilitada' ? 'aviso' : 'error']: textoErrorAcceso(e) }); return; }
      // El servidor pide esperar unos segundos (hubo muchos intentos desde esta conexión o con este usuario): cuenta regresiva, sin borrar el PIN ya escrito
      if (e && e.motivo === 'espera') { mostrarEstado(''); cuentaEspera(Math.max(1, Number(e.espera) || 5)); return; }
      pad.limpiar();
      alertar(e);
      mostrarEstado('');
      bloquear(false);
    }
  }
  usuario.addEventListener('input', () => { mostrarError(''); if (notaUsuario) notaUsuario.hidden = true; });
  usuario.addEventListener('focus', () => { if (usuario.value) usuario.select(); });
  document.onkeydown = (e) => {
    if (document.activeElement === usuario) { if (e.key === 'Enter') { e.preventDefault(); usuario.blur(); } return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^[0-9]$/.test(e.key)) { if (document.activeElement?.tagName === 'BUTTON') document.activeElement.blur(); pad.tecla(e.key); }
    else if (e.key === 'Backspace') pad.borrar();
    else if (e.key === 'Enter' && document.activeElement?.tagName !== 'BUTTON') intentar();
  };
  const ced = cedulaJuridica(emp.cedula);
  raiz.append(h('div.pantalla-centro', h('div.login.tarjeta.login-usuario',
    h('div.emp-reconocida', { role: 'status', 'data-emp': emp.codigo === 'soda' ? 'soda' : 'pollos' },
      h('img.emp-logo', { src: logoDe(emp.codigo), alt: '' }),
      h('div.emp-texto',
        h('span.emp-et', 'Entrando a:'),
        h('strong.emp-nombre', emp.nombre || 'Su empresa'),
        ced ? h('span.emp-ced', 'Cédula jurídica ' + ced) : null),
      cambiar),
    h('p.sub', 'Escriba su usuario y su PIN de 4 números'),
    mensaje ? h('div.error-caja', { role: 'alert' }, mensaje) : null,
    h('label.etq', 'Usuario', usuario, notaUsuario),
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
// pedirActual = true fuerza el campo «PIN actual» (cuando no se recuerda el PIN con el que se entró, o el servidor no lo aceptó). aviso = una frase para arriba de los campos.
function pantallaCambioPin({ pedirActual = false, aviso = '' } = {}) {
  raiz.replaceChildren();
  // Si la persona acaba de entrar con su PIN en esta pantalla, ese PIN ya se comprobó: no se le pide otra vez (ahí se equivocaban y el freno de fx_pin_cambiar las dejaba fuera).
  // Si recargó la página con la sesión abierta no hay nada que recordar y el campo se muestra como siempre.
  const conocido = !pedirActual && !!pinDeEntradaVigente();
  const campoPin = (etiqueta, auto) => h('input.campo', { type: 'password', inputmode: 'numeric', maxlength: 4, autocomplete: auto, 'aria-label': etiqueta });
  const actual = conocido ? null : campoPin('PIN actual', 'current-password'), nuevo = campoPin('PIN nuevo', 'new-password'), otra = campoPin('Repita el PIN nuevo', 'new-password');
  [actual, nuevo, otra].filter(Boolean).forEach((i) => i.addEventListener('input', () => { const v = i.value.replace(/\D/g, '').slice(0, 4); if (v !== i.value) i.value = v; }));
  const err = h('div.error-caja', { hidden: true, role: 'alert' });
  const mostrar = (m) => { err.textContent = m; err.hidden = !m; };
  const ok = h('button.btn.primario.grande', { type: 'button', onclick: () => conBoton(ok, async () => {
    mostrar('');
    const pinActual = actual ? actual.value : pinDeEntradaVigente();
    if (!actual && !pinActual) return pantallaCambioPin({ pedirActual: true, aviso: 'Por seguridad, escriba otra vez el PIN actual, el que le dieron.' }); // pasaron unos minutos desde que entró
    const p = problemaPinNuevo(pinActual, nuevo.value, otra.value);
    if (p) return mostrar(p);
    try {
      await api.pinCambiar(pinActual, nuevo.value);
      olvidarPinDeEntrada();
      toast('PIN cambiado.');
      await arrancar();
    } catch (e) {
      // El servidor dice por su pista (hint) que el PIN actual no coincide: el que se recordaba ya no vale (por ejemplo, el administrador lo reinició mientras tanto). Se pide el campo.
      if (!actual && e?.hint === 'pin_actual') { olvidarPinDeEntrada(); return pantallaCambioPin({ pedirActual: true, aviso: 'No se pudo confirmar su PIN actual. Escríbalo otra vez, el que le dieron.' }); }
      mostrar(conPunto(textoDeError(e)));
    }
  }) }, 'Guardar mi PIN nuevo');
  raiz.append(h('div.pantalla-centro', h('div.login.tarjeta.col',
    h('h1', 'Elija su PIN'),
    h('p.sub', 'Por seguridad, cambie el PIN que le dieron por uno que solo usted conozca. Tiene que ser de 4 números. Evite repetir el mismo número (1111), números seguidos (1234 o 4321) o parejas (1212).'),
    actual ? h('label.etq', 'PIN actual (el que le dieron)', actual) : null,
    h('label.etq', 'PIN nuevo', nuevo),
    h('label.etq', 'Repita el PIN nuevo', otra),
    err, ok,
    h('button.btn.suave', { type: 'button', onclick: () => cerrarSesion() }, 'Salir'))));
  if (aviso) mostrar(aviso);
  (actual || nuevo).focus();
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
      try { await api.pinCambiar(a.value, n.value); toast('PIN cambiado.'); c(); } catch (e) { err.textContent = conPunto(textoDeError(e)); err.hidden = false; }
    } }] });
}

/* ---------- Cabecera ---------- */
// Una sola cabecera para todo el sistema, sin pestañas. Lo que muestra depende de la vista (cab.dataset.vista):
//   inicio    logo, «Anular factura» y el menú de la sesión
//   ventana   «‹ Inicio» + título del módulo
//   admin     igual que ventana (la pantalla de Administración)
//   sub       «‹ Administración» + «Inicio» + título (los módulos que viven dentro de Administración)
//   facturar  una sola fila delgada: «‹ Inicio», título, caja y «Anular factura» (deja el máximo de espacio a la caja)
// Arriba va siempre una franja con el nombre del negocio y, si aplica, MODO DE PRUEBAS.
let cab, vista, alertaEl, redEl, menuEl, tituloEl, volverEl, inicioEl;
const EMPRESAS_CON_COLOR = ['pollos', 'soda'];
// Código corto de la empresa de la sesión ('pollos' | 'soda'); decide el color de la franja
const codigoEmpresa = (s) => { const c = String(s?.codigo ?? '').toLowerCase(); return EMPRESAS_CON_COLOR.includes(c) ? c : 'pollos'; };
function pintarCabecera() {
  if (!cab || !app.ctx || !app.soc) return;
  const s = app.soc, t = app.turno, emp = codigoEmpresa(s);
  cab.dataset.emp = emp;
  cab.querySelector('.cab-emp').textContent = nombreLocal(s);
  const logo = cab.querySelector('.marca img');
  const codigoReal = String(s.codigo_acceso || s.codigo || '').toLowerCase();
  logo.src = logoDe(codigoReal);
  logo.alt = nombreLocal(s);
  iconoPestana(codigoReal);
  const et = cab.querySelector('.estado-turno');
  et.className = 'estado-turno ' + (t ? 'abierto' : 'cerrado');
  et.textContent = t ? 'Caja abierta desde las ' + new Date(t.abierto_en).toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Costa_Rica' }) : 'Caja cerrada';
  const amb = cab.querySelector('.amb');
  amb.textContent = s.ambiente === 'produccion' ? 'Facturas reales' : 'Modo de pruebas';
  amb.className = 'amb ' + (s.ambiente === 'produccion' ? 'amb-prod' : 'amb-prueba');
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


/* ---------- Avisos del encabezado: documentos con problema y facturas por responder ---------- */
// Fuente: fx_alertas (contrato 3). Mientras no exista, api_documentos.js usa un valor de reserva sacado de fx_documentos.
// Se actualiza cada 60 segundos, al volver a la pestaña del navegador y cuando una pantalla lo pide con el evento 'app:alertas'.
let alSeq = 0, alTimer = null, alUltimo = 0, recepcionCache = null, recepcionHora = 0;
// Pantalla baja (menos de 900 px de alto): el aviso es UNA línea compacta, «Hacienda no aceptó 1 documento. Ver». En pantallas altas va completo, con el motivo.
const pantallaBaja = window.matchMedia ? window.matchMedia('(max-height:899px)') : { matches: false };
pantallaBaja.addEventListener?.('change', () => { if (alertaEl && app.alertas.datos) aplicarAlertas(app.alertas.datos); });
// «La ubicación del emisor no coincide con Hacienda (es solo un aviso)» (código -37) no es el motivo del rechazo: no se mezcla en el aviso rojo
const sinAvisoUbicacion = (t) => String(t || '').replace(/\s*La ubicaci[oó]n del emisor no coincide con Hacienda[^.]*\.?/i, '').replace(/\s+/g, ' ').trim();
function aplicarAlertas(a) {
  app.alertas.datos = a;
  if (!alertaEl) return;
  const r = a ? a.rechazados : 0, p = a ? a.pendientes : 0;
  if (!r && !p) { alertaEl.hidden = true; sincronizarAlturas(); document.dispatchEvent(new CustomEvent('app:alertas-cambio', { detail: a })); return; }
  const docs = (n) => (n === 1 ? '1 documento' : n + ' documentos');
  const titulo = pantallaBaja.matches
    ? (r && p ? 'Hacienda no aceptó ' + docs(r) + ' y ' + (p === 1 ? '1 todavía no llegó a Hacienda.' : p + ' todavía no llegaron a Hacienda.')
      : r ? 'Hacienda no aceptó ' + docs(r) + '.' : docs(p) + (p === 1 ? ' no ha llegado a Hacienda.' : ' no han llegado a Hacienda.'))
    : [r ? 'Hacienda no aceptó ' + docs(r) + '.' : '', p ? (p === 1 ? '1 documento todavía no llegó a Hacienda.' : p + ' documentos todavía no llegaron a Hacienda.') : ''].filter(Boolean).join(' ');
  const u = a.ultimos && a.ultimos[0];
  const motivo = u ? sinAvisoUbicacion(u.mensaje) : '';
  const detalle = motivo ? (u.numero ? 'N.° ' + u.numero + ': ' : '') + conPunto(motivo) : 'Toque «Ver cuáles son» para revisar qué pasó y qué hay que hacer.';
  alertaEl.querySelector('strong').textContent = titulo;
  alertaEl.querySelector('.alerta-detalle').textContent = detalle;
  alertaEl.hidden = false;
  sincronizarAlturas();
  document.dispatchEvent(new CustomEvent('app:alertas-cambio', { detail: a }));
}
function verAlertas() {
  const a = app.alertas.datos;
  app.ir('anular', { filtro: 'problemas', desde: a?.desde || null });
}
// Cifra de facturas recibidas por responder: la misma que muestra Contable. Alimenta las insignias de las tarjetas de Contable y de Administración.
// Vencidas para la insignia: las que llegaron en los últimos 25 días con el plazo ya pasado (fx_alertas.recepcion_vencidas, o vencidas_recientes del conteo de Contable)
function vencidasDe(c) { return Math.max(0, Number(c?.vencidas ?? c?.recepcion_vencidas ?? c?.vencidas_recientes ?? 0) || 0); }
function fijarRecepcion(c) {
  const n = Number(c?.pendientes_en_plazo ?? 0), venc = vencidasDe(c);
  // Ámbar: hay facturas por responder dentro del plazo. Rojo: algunas vencen pronto (en 2 días hábiles o menos) o ya vencieron. Con solo vencidas la insignia sigue visible.
  app.recepcion = c && (n > 0 || venc > 0) ? { pendientes_en_plazo: n, vencen_pronto: Math.max(0, Number(c.vencen_pronto ?? 0)), vencidas: venc } : null;
  if (cab && vista && (app.moduloActual === INICIO || app.moduloActual?.pantalla === 'admin')) pintarInsignias(vista, app);
}
async function actualizarAlertas(forzar = false) {
  if (!app.ctx || !app.soc || !cab) return;
  if (!forzar && Date.now() - alUltimo < 5000) return;
  alUltimo = Date.now();
  const mi = ++alSeq, soc = app.socId;
  actualizarInventario(mi);
  try {
    const { alertas } = await import('./api_documentos.js');
    const a = await alertas(soc);
    if (mi !== alSeq || soc !== app.socId || !app.ctx) return;
    aplicarAlertas(a);
    if (a.recepcion_por_responder != null) {
      // fx_alertas trae recepcion_vencen_pronto. Si una versión vieja de la función no lo manda, se conserva lo que Recepción haya visto si la cifra no cambió
      const antes = recepcionCache && recepcionCache.pendientes_en_plazo === a.recepcion_por_responder ? recepcionCache.vencen_pronto : 0;
      // recepcion_vencidas: si la función todavía no la trae, se usa la que vio Contable (o el conteo de Recepción cada 5 minutos)
      let venc = a.recepcion_vencidas != null ? Number(a.recepcion_vencidas) : recepcionCache?.vencidas;
      if (venc == null || (a.recepcion_vencidas == null && Date.now() - recepcionHora > 5 * 60 * 1000)) { try { const { contarPendientes } = await import('./api_recepcion.js'); venc = vencidasDe(await contarPendientes(soc)); recepcionHora = Date.now(); } catch { venc = venc ?? 0; } }
      recepcionCache = { pendientes_en_plazo: a.recepcion_por_responder, vencen_pronto: a.recepcion_vencen_pronto != null ? a.recepcion_vencen_pronto : antes, vencidas: venc };
    } else if (!recepcionCache || Date.now() - recepcionHora > 5 * 60 * 1000) {
      // Sin fx_alertas, la cifra sale de Recepción (cada 5 minutos, porque trae toda la lista)
      try { const { contarPendientes } = await import('./api_recepcion.js'); recepcionCache = await contarPendientes(soc); recepcionHora = Date.now(); } catch { /* queda la anterior */ }
    }
    if (mi === alSeq && soc === app.socId) fijarRecepcion(recepcionCache);
  } catch (e) { if (!esTransitorio(e) && !esSesionVencida(e)) console.warn('Avisos del encabezado no disponibles:', e?.message || e); }
}
// Insignia de Inventarios (fx_inv_alertas_resumen, una consulta liviana): se pide junto con los avisos, sin cargar el módulo. La bodega es del grupo: no depende de la empresa.
async function actualizarInventario(mi) {
  try {
    const { alertasResumen } = await import('./api_inventarios.js');
    const r = await alertasResumen();
    if (mi !== alSeq || !app.ctx) return;
    app.inventario = r || null;
    if (cab && vista && (app.moduloActual === INICIO || app.moduloActual?.pantalla === 'admin')) pintarInsignias(vista, app);
  } catch { /* sin conexión o sin la función: la insignia se queda como estaba */ }
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

// Qué hacer (y qué no) cuando se cae el internet, según CONTINGENCIA.md. La ventana solo dice qué hacer: no afirma nada que la página no pueda saber
// (si un cobro en camino se hizo o no, o si lo último que se agregó llegó a guardarse).
function abrirAyudaSinRed() {
  const bloque = (titulo, items, clase = '') => h('section.ayuda-red-bloque' + (clase ? '.' + clase : ''), h('h3', titulo), h('ul', items.map((t) => h('li', t))));
  modal({
    titulo: 'Si no hay internet', ancho: 600,
    contenido: h('div.ayuda-red',
      h('p.ayuda-red-intro', 'Deje esta pantalla abierta. Cuando la conexión vuelva, el aviso amarillo se quita; si tarda, toque «Revisar ahora».'),
      bloque('Qué hacer', [
        'Si el local tiene un segundo internet (los datos de un celular o el otro router), conecte la caja a ese y toque «Revisar ahora».',
        'Si no hay ninguna forma de conectarse, anote cada venta en el cuaderno de contingencia: hora, productos, monto, forma de pago y, si el cliente pide factura, su cédula y su correo.',
        'Cuando vuelva la conexión, facture en orden lo que anotó y avise a la persona encargada.',
      ]),
      bloque('Qué NO hacer', [
        'No cobre otra vez una cuenta si no está segura de que no se cobró. Un cobro que iba en camino puede haberse hecho aunque la pantalla no lo muestre.',
        'No anule una factura solo porque se cayó el internet.',
        'No recargue la página ni cierre la sesión mientras no haya conexión: lo que está en pantalla se conserva mientras siga abierta.',
      ], 'no'),
      bloque('Las cuentas abiertas', [
        'Las cuentas que ya estaban abiertas se guardan en el sistema, no en este aparato. Lo último que agregó justo cuando se cayó el internet podría no haberse guardado: revíselo cuando vuelva la conexión.',
      ]),
      bloque('Cómo saber si ya se cobró', [
        'Cuando vuelva la conexión, vea si la cuenta sigue entre las cuentas abiertas: si sigue ahí, no se cobró.',
        'Si ya no está, abra «Anular y reimprimir» y busque la venta: si aparece con su número, sí se cobró.',
        'Si la cuenta dice que el cobro quedó en duda, toque «Revisar si se cobró» en esa cuenta antes de volver a cobrar.',
      ])),
    botones: [{ texto: 'Entendido', clase: 'primario', onclick: (c) => c() }],
  });
}

document.addEventListener('app:sesion-vencida', () => mostrarSesionVencida());
// Ventana «Su sesión venció»: se queda encima de todo y no cierra nada de lo que hay detrás (cuentas abiertas, ventanas, textos escritos).
function mostrarSesionVencida() {
  if (!app.ctx || document.getElementById('sesion-vencida')) return;
  const codigo = app.ctx.usuario, nombre = app.ctx.nombre || codigo;
  // La empresa de la sesión que venció: en este diálogo no se puede cambiar. Si por alguna razón no se conoce, la última que se usó en este aparato; 'pollos' es el respaldo temporal.
  const emp = app.empresa || (empresaRecordada() ? { codigo: empresaRecordada().codigo, nombre: empresaRecordada().nombre } : { codigo: 'pollos', nombre: 'Pollos La Bomba' });
  const previos = [raiz, ...document.querySelectorAll('.modal-fondo')];
  const focoPrevio = document.activeElement; // al volver a entrar, el foco regresa a donde estaba (el campo o botón que se usaba)
  previos.forEach((x) => { x.inert = true; });
  // El botón Atrás (util.js) le pregunta a la ventana de arriba, con su _bloqueo, si se puede cerrar: mientras «Su sesión venció» esté puesta, ninguna ventana de debajo se cierra
  // con Atrás y lo que la persona tenía escrito se conserva. Al cerrar esta ventana cada una recupera el bloqueo que tenía.
  const bloqueosPrevios = previos.map((x) => x._bloqueo);
  previos.forEach((x) => { if (typeof x._cerrar === 'function') x._bloqueo = () => 'Primero entre de nuevo con su PIN. Así lo que escribió no se pierde.'; });
  const cuerpo = h('div.modal-cuerpo');
  const fondo = h('div#sesion-vencida.modal-fondo.sesion-fondo', { role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'sv-tit' }, h('div.modal.sesion-caja', { style: 'max-width:420px' }, cuerpo));
  const cerrar = () => {
    document.onkeydown = null;
    document.removeEventListener('keydown', alTeclear);
    window.removeEventListener('keydown', alTeclaDeVentana, true);
    fondo.remove();
    previos.forEach((x, i) => { x.inert = false; if (typeof x._cerrar === 'function') x._bloqueo = bloqueosPrevios[i]; });
    if (focoPrevio && focoPrevio !== document.body && focoPrevio.isConnected) { try { focoPrevio.focus({ preventScroll: true }); } catch { /* nada */ } }
  };
  const paso1 = () => {
    cuerpo.replaceChildren(h('div.col',
      h('h2#sv-tit', 'Su sesión venció'),
      h('p', 'Por seguridad hay que volver a entrar con su PIN. Lo que tiene en pantalla no se cierra, y las cuentas que ya estaban guardadas siguen ahí.'),
      h('button.btn.primario.grande', { type: 'button', onclick: paso2 }, 'Entrar de nuevo'),
      h('button.btn.suave', { type: 'button', onclick: () => { cerrar(); cerrarSesion(); } }, 'Cerrar sesión y salir'),
      h('small.tenue', 'Si cierra la sesión, lo que escribió y todavía no se guardó se pierde.')));
    cuerpo.querySelector('.primario').focus();
  };
  const err = h('div.error-caja', { hidden: true, role: 'alert' });
  const estado = h('div.entrando', { hidden: true, role: 'status', 'aria-live': 'polite' });
  const pad = crearPad({ alCompletar: () => reentrar() });
  const mostrarError = (m) => { err.textContent = m; err.hidden = !m; };
  async function reentrar() {
    if (pad.valor().length < 4) { mostrarError('El PIN tiene 4 números.'); return; }
    mostrarError('');
    pad.bloquear(true); estado.textContent = 'Entrando…'; estado.hidden = false;
    try {
      await entrar(emp.codigo, codigo, pad.valor());
      cerrar();
      toast('Listo, entró de nuevo. Puede seguir donde estaba.');
      try { await app.refrescar(); } catch { /* la cabecera se actualiza sola luego */ }
      actualizarAlertas(true);
      // Si alguna pantalla se quedó con un aviso de falla y su botón de «Intentar de nuevo», se reintenta sola. Lo que ya cargó bien no se toca.
      // El botón se reconoce por su marca data-reintentar (la pone bloqueError en util.js), no por lo que dice.
      // Solo llevan la marca los botones que repiten una LECTURA; los que repiten un cambio (cobrar, agregar una línea) no la llevan y nunca se tocan solos.
      if (vista) vista.querySelectorAll('[data-reintentar]').forEach((b) => b.click());
    } catch (e) {
      if (!esErrorEsperado(e)) console.error(e);
      // El servidor pide esperar unos segundos: cuenta regresiva en esta ventana, sin borrar el PIN escrito
      if (e && e.motivo === 'espera') {
        estado.hidden = true; pad.bloquear(true);
        let queda = Math.max(1, Number(e.espera) || 5);
        const pintar = () => mostrarError('Espere ' + queda + ' segundo' + (queda === 1 ? '' : 's') + ' e intente de nuevo.');
        pintar();
        const tt = setInterval(() => { queda -= 1; if (queda <= 0) { clearInterval(tt); mostrarError(''); pad.bloquear(false); } else pintar(); }, 1000);
        return;
      }
      pad.limpiar(); mostrarError(textoErrorAcceso(e, { cambiarEmpresa: false })); estado.hidden = true; pad.bloquear(false);
    }
  }
  function paso2() {
    cuerpo.replaceChildren(h('div.col',
      h('h2#sv-tit', 'Escriba su PIN'),
      h('p.sub.sv-quien', h('span', 'Empresa: ', h('strong', emp.nombre || 'Su empresa')), h('span', 'Usuario: ', h('strong', nombre)), h('span', 'El PIN son 4 números.')),
      pad.dots, estado, err, pad.teclado,
      h('button.btn.suave', { type: 'button', onclick: () => { pad.limpiar(); mostrarError(''); paso1(); } }, 'Atrás')));
    cuerpo.querySelector('.teclado button')?.focus(); // el botón que se tocó desaparece: el foco pasa al teclado y no se pierde en la página
  }
  const alTeclear = (e) => {
    if (!cuerpo.querySelector('.teclado') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^[0-9]$/.test(e.key)) { if (document.activeElement?.tagName === 'BUTTON') document.activeElement.blur(); pad.tecla(e.key); }
    else if (e.key === 'Backspace') pad.borrar();
  };
  document.addEventListener('keydown', alTeclear);
  // Escape y Tab se atienden ANTES que la ventana de debajo (escucha en la fase de captura de window): Escape no la cierra y Tab no le mueve el foco a algo que está inerte.
  // Tab da la vuelta dentro de esta ventana.
  const alTeclaDeVentana = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return; }
    if (e.key !== 'Tab') return;
    e.stopPropagation();
    const botones = [...cuerpo.querySelectorAll('button:not([disabled])')].filter((b) => b.offsetParent !== null);
    if (!botones.length) { e.preventDefault(); return; }
    const primero = botones[0], ultimo = botones[botones.length - 1], en = document.activeElement;
    if (!fondo.contains(en)) { e.preventDefault(); (e.shiftKey ? ultimo : primero).focus(); }
    else if (e.shiftKey && en === primero) { e.preventDefault(); ultimo.focus(); }
    else if (!e.shiftKey && en === ultimo) { e.preventDefault(); primero.focus(); }
  };
  window.addEventListener('keydown', alTeclaDeVentana, true);
  document.body.append(fondo);
  paso1();
}

/* ---------- Navegación: dirección (#), historial y pantallas ---------- */
// Cada pantalla tiene su dirección: #inicio, #facturar, #anular, #clientes, #turno, #admin, #admin/productos, #admin/informes, #admin/contable, #admin/usuarios.
// La lista de módulos sale de modulos.js. El botón Atrás del navegador o del celular regresa a la pantalla anterior y recargar deja en el mismo lugar.
// «#admin/cierre» es el nombre viejo del cierre de caja: se corrige solo a #turno.
const INICIO = { id: 'inicio', titulo: 'Inicio', ruta: 'inicio', grupo: 'principal' };
const tipoDe = (d) => (d === INICIO ? 'inicio' : d.pantalla === 'admin' ? 'admin' : d.id === 'caja' ? 'facturar' : d.grupo === 'admin' ? 'sub' : 'ventana');
// De cualquier forma de nombrar una pantalla (id, alias, dirección con o sin #) al destino. Lo desconocido, o lo que no le toca a esta persona, va al inicio.
function destinoDe(clave) {
  let k = '';
  try { k = decodeURIComponent(String(clave ?? '')); } catch { k = String(clave ?? ''); }
  k = k.replace(/^#\/?/, '').trim().toLowerCase();
  if (!k || k === 'inicio') return INICIO;
  const m = buscar(k);
  if (!m || (m.soloAdmin && !app.admin)) return INICIO;
  return m;
}
// Cada entrada del historial guarda de dónde se vino ({ de: 'admin' }): así «‹ Administración» e «‹ Inicio» usan el botón Atrás en lugar de apilar entradas repetidas
const rutaActual = () => location.hash.replace(/^#/, '').toLowerCase();
async function ir(clave) {
  if (!cab) return;
  // Si hay una ventana abierta (o el navegador todavía está quitando su entrada del historial) se cierra y se espera, para que no se pisen
  await asentarVentanas();
  if (!cab) return;
  const dest = destinoDe(clave);
  if (rutaActual() === dest.ruta) {
    // Ya está en esa dirección: solo se vuelve a mostrar si traía un pedido o si la pantalla no es la que se ve
    if (app.pedido || app.moduloActual?.id !== dest.id) mostrar(dest, true);
    return;
  }
  try { history.pushState({ de: rutaActual() }, '', '#' + dest.ruta); } catch { location.hash = dest.ruta; return; } // sin historial: el cambio de dirección dispara hashchange
  mostrar(dest);
}
// Subir un nivel («‹ Inicio», «‹ Administración», Escape): si la pantalla anterior es justo esa, se retrocede en el historial; si no (se recargó la página, o se llegó por un aviso), se va a ella
async function subir(clave) {
  await asentarVentanas();
  const dest = destinoDe(clave);
  if (history.state && history.state.de === dest.ruta) { history.back(); return; }
  ir(clave);
}
// Un popstate que solo cerró una ventana (botón Atrás con una ventana abierta) no cambia de pantalla: lo atiende util.js
const alCambiarDireccion = () => { if (cab && app.ctx && !popEsDeVentana()) mostrar(destinoDe(location.hash)); };
window.addEventListener('popstate', alCambiarDireccion);
window.addEventListener('hashchange', alCambiarDireccion);

// Qué tarjeta lleva el foco al volver al inicio o a Administración: la del módulo del que se viene
let veniaDe = null;
function pintarVista(dest) {
  const tipo = tipoDe(dest);
  cab.dataset.vista = tipo;
  tituloEl.textContent = dest.titulo;
  const aAdmin = tipo === 'sub';
  volverEl.replaceChildren(h('span', { 'aria-hidden': 'true' }, '‹'), ' ', aAdmin ? 'Administración' : 'Inicio');
  volverEl.setAttribute('aria-label', aAdmin ? 'Volver a Administración' : 'Volver al inicio');
  volverEl.onclick = () => subir(aAdmin ? 'admin' : 'inicio');
  document.title = (dest === INICIO ? 'Facturación' : dest.titulo) + ' · La Bomba';
}

// Foco inicial: la tarjeta del inicio (o la del módulo del que se viene) y, en una ventana, su primer control útil, salvo que el módulo ya haya puesto el foco
function primerControl(raizV) {
  const tactil = window.matchMedia?.('(pointer:coarse)').matches; // en tableta o celular un campo de texto abriría el teclado sin que se pida
  const lista = [...raizV.querySelectorAll('button:not([disabled]), a[href], select:not([disabled]), summary' + (tactil ? '' : ', input:not([type=hidden]):not([disabled]), textarea:not([disabled])'))];
  return lista.find((el) => el.offsetParent !== null && !el.closest('[hidden], [inert]')) || null;
}
function enfocarInicial(dest) {
  const tipo = tipoDe(dest);
  const hacer = () => {
    if (!vista || app.moduloActual !== dest) return;
    const act = document.activeElement;
    if (act && act !== document.body && vista.contains(act)) return;
    if (document.querySelector('.modal-fondo')) return;
    let el = null;
    if (tipo === 'inicio' || tipo === 'admin') el = (veniaDe && vista.querySelector('.mod-tarjeta[data-mod="' + veniaDe + '"]')) || vista.querySelector('.mod-tarjeta');
    else if (tipo === 'ventana' || tipo === 'sub') el = primerControl(vista);
    el?.focus({ preventScroll: true });
  };
  if (tipo === 'inicio' || tipo === 'admin') hacer(); else setTimeout(hacer, 350);
}

let limpieza = null;
let irSeq = 0;
// Muestra una pantalla. forzar = volver a armarla aunque ya sea la que se ve. opciones.sinFoco = no mover el foco (cuando solo se repinta).
async function mostrar(dest, forzar = false, { sinFoco = false } = {}) {
  if (!cab) return;
  // La dirección se corrige siempre (alias, rutas que no existen), aunque la pantalla ya sea la que se ve
  if (location.hash.toLowerCase() !== '#' + dest.ruta) { try { history.replaceState(history.state, '', '#' + dest.ruta); } catch { /* sin historial */ } }
  if (!forzar && app.moduloActual?.id === dest.id) return;
  const mi = ++irSeq;
  // Al cambiar de pantalla no puede quedar ninguna ventana abierta encima (una ventana de «Cobrar» huérfana cobraría sin mostrar el tiquete)
  if (app.moduloActual && app.moduloActual.id !== dest.id) { veniaDe = app.moduloActual.id; cerrarVentanas(); }
  app.moduloActual = dest;
  pintarVista(dest);
  abrirMenu(false);
  try { limpieza?.(); } catch { /* nada */ }
  limpieza = null;
  if (!sinFoco) window.scrollTo(0, 0);
  const tipo = tipoDe(dest);
  if (tipo === 'inicio' || tipo === 'admin') {
    const alAbrir = (m) => ir(m.id);
    vista.replaceChildren(tipo === 'inicio'
      ? pantallaInicio(app, { alAbrir, alCerrarCaja: () => ir('turno'), alAbrirCaja: () => ir('caja') })
      : pantallaAdmin(app, { alAbrir }));
    app.pedido = null;
    if (!sinFoco) enfocarInicial(dest);
    if (tipo === 'inicio') diferir(() => { import('./m_caja.js').catch(() => {}); }); // la caja es lo que más se usa: queda lista antes del primer toque
    return;
  }
  vista.replaceChildren(esqueleto(4));
  try {
    const mod = (await dest.cargar()).default;
    if (mi !== irSeq) return; // la persona ya cambió de pantalla
    const caja = h('div');
    vista.replaceChildren(caja);
    const fin = (await mod.mount(caja, app)) || null;
    if (mi !== irSeq) { try { fin?.(); } catch { /* nada */ } return; }
    limpieza = fin;
    if (!sinFoco) enfocarInicial(dest);
  } catch (e) {
    if (mi !== irSeq) return;
    if (!esSesionVencida(e)) console.error(e);
    vista.replaceChildren(bloqueError({
      titulo: 'Esta pantalla no se pudo abrir',
      // Un error del sistema ya trae su frase; el de red del navegador («Failed to fetch» al cargar la pantalla) y cualquier otro se explican con palabras de la cajera
      mensaje: e && typeof e.tipo === 'string' ? e.message : (esTransitorio(e) ? MSG_SIN_INTERNET + ' Si sigue igual, recargue la página.' : 'Revise la conexión e intente de nuevo; si sigue igual, recargue la página.'),
      alReintentar: () => mostrar(dest, true),
    }));
  } finally {
    if (mi === irSeq) app.pedido = null;
  }
}
const diferir = (f) => (window.requestIdleCallback ? window.requestIdleCallback(f, { timeout: 3000 }) : setTimeout(f, 1200));

// Escape regresa un nivel: de un módulo de Administración a Administración, y de ahí (o de cualquier otra ventana) al inicio.
// No actúa en el inicio ni en Facturación, ni con una ventana abierta, ni escribiendo en un campo.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || e.defaultPrevented || !cab || !app.moduloActual) return;
  if (document.querySelector('.modal-fondo') || menuEl?.classList.contains('abierto')) return;
  const t = e.target;
  if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
  const d = app.moduloActual, tipo = tipoDe(d);
  if (tipo === 'inicio' || tipo === 'facturar') return;
  e.preventDefault();
  subir(tipo === 'sub' ? 'admin' : 'inicio');
});

function armarApp(reciente = false) {
  document.onkeydown = null;
  raiz.replaceChildren();
  vista = h('main#vista');
  alertaEl = h('div.alerta-cab', { role: 'alert', hidden: true },
    h('div.alerta-in', h('div.alerta-texto', h('strong'), h('span.alerta-detalle')),
      h('button.btn.alerta-ver', { type: 'button', 'aria-label': 'Ver cuáles son los documentos con problemas', onclick: verAlertas }, 'Ver cuáles son')));
  redEl = h('div.sin-red', { role: 'status', hidden: true },
    h('div.sin-red-in',
      h('span.sin-red-txt', h('strong', 'Sin conexión a internet. '), h('span.sin-red-mas', 'Cuando vuelva la conexión este aviso se quita solo. Lo último que hizo podría no haberse guardado: revíselo antes de repetirlo. '), 'Si un cobro quedó en duda, no lo repita: primero revise si ya se cobró.'),
      h('div.sin-red-btns',
        h('button.btn.chico', { type: 'button', onclick: abrirAyudaSinRed }, 'Qué hacer y qué no hacer'),
        h('button.btn.chico', { type: 'button', onclick: (e) => conBoton(e.currentTarget, async () => { await app.refrescar(); mostrarRed(false); toast('Conexión recuperada.'); }) }, 'Revisar ahora'))));
  menuEl = h('div.cab-usuario',
    h('button.btn.cab-menu', { type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false', 'aria-controls': 'cab-panel', onclick: () => abrirMenu(!menuEl.classList.contains('abierto')) }, 'Menú ▾'),
    h('div#cab-panel.cab-panel',
      h('span.cab-sesion', 'Sesión de ', h('strong', app.ctx.nombre || app.usuario)),
      h('button.btn.chico', { type: 'button', onclick: () => { abrirMenu(false); cambiarPinDialogo(); } }, 'Cambiar mi PIN'),
      h('button.btn.chico', { type: 'button', onclick: () => { abrirMenu(false); cerrarSesion(); } }, 'Cerrar sesión')));
  volverEl = h('button.btn.cab-volver', { type: 'button' });
  inicioEl = h('button.btn.cab-inicio', { type: 'button', onclick: () => subir('inicio') }, 'Inicio');
  tituloEl = h('h1.cab-titulo');
  cab = h('header.cabecera', { 'data-vista': 'inicio' },
    h('div.cab-franja', h('div.cab-franja-in', h('span.cab-emp'), h('span.amb'))),
    h('div.cab-fila',
      volverEl, inicioEl,
      h('div.marca', h('img', { alt: 'La Bomba' })),
      tituloEl,
      h('div.cab-estado', h('span.estado-turno')),
      // Atajo siempre visible: anular una factura no debe esconderse dentro de otra pantalla. Lleva a «Anular y reimprimir» con el cursor en el buscador.
      h('button.btn.cab-anular', { type: 'button', onclick: irAAnular }, 'Anular y reimprimir'),
      menuEl),
    alertaEl, redEl);
  raiz.append(cab, vista);
  if (window.ResizeObserver) new ResizeObserver(() => sincronizarAlturas()).observe(cab);
  pintarCabecera();
  // Recién entró: al inicio. Si recargó la página, o regresó tras un fallo, se queda en la dirección que tenía.
  mostrar(reciente ? INICIO : destinoDe(location.hash), true);
  programarAlertas(); // después de pintar: no retrasa la carga inicial
}
function irAAnular() {
  // Si ya está en «Anular y reimprimir», basta con llevar el cursor al buscador y no se pierde lo que se ve
  const b = app.moduloActual?.id === 'anular' ? document.getElementById('anular-buscar') : null;
  if (b) { b.focus(); b.select?.(); return; }
  app.ir('anular', { foco: 'buscar' });
}
// Cuando cambian los datos de la caja (turno abierto o cerrado) el inicio se repinta sin mover el foco
document.addEventListener('app:cambio', () => { if (cab && app.moduloActual === INICIO) mostrar(INICIO, true, { sinFoco: true }); });

// Cierre de sesión limpio: detiene los avisos, cierra ventanas, borra la sesión de este aparato y deja la pantalla de entrada como nueva
let cerrando = false;
async function cerrarSesion() {
  if (cerrando) return;
  cerrando = true;
  try {
    clearInterval(alTimer); alSeq++;
    try { limpieza?.(); } catch { /* nada */ }
    limpieza = null;
    await cerrarVentanas();
    document.getElementById('sesion-vencida')?.remove();
    document.getElementById('impresion-resumen')?.remove();
    document.querySelectorAll('#toasts .toast').forEach((t) => t.remove());
    await salir().catch(() => {});
    olvidarPinDeEntrada();
    app.ctx = null; app.socId = null; app.moduloActual = null; app.pedido = null; app.alertas.datos = null; app.recepcion = null; app.inventario = null;
    recepcionCache = null; recepcionHora = 0; veniaDe = null;
    cab = vista = alertaEl = redEl = menuEl = tituloEl = volverEl = inicioEl = null;
    document.body.classList.remove('fx-caja');
    iconoPestana(null);
    const st = document.documentElement.style;
    ['--cab-h', '--bus-h', '--alto-cab', '--cab-alto'].forEach((v) => st.removeProperty(v));
    try { history.replaceState(null, '', location.pathname + location.search); } catch { /* sin historial */ } // la próxima persona no hereda la dirección
    document.title = 'Facturación · La Bomba';
    raiz.inert = false;
    pantallaLogin();
  } finally { cerrando = false; }
}


/* ---------- Arranque ---------- */
// reciente = true cuando se acaba de iniciar sesión: si la primera consulta cae por sesión, se repite una vez antes de rendirse
async function cargarContexto(reciente) {
  try { return await api.contexto(); }
  catch (e) {
    if (reciente && (esSesionVencida(e) || esSinAcceso(e))) { await pausa(700); return await api.contexto(); }
    throw e;
  }
}
async function arrancar(reciente = false) {
  // Todo lo que se puede pedir a la vez se pide a la vez: contexto, catálogo del último local (queda en memoria) y el módulo de la dirección (#) si recargó la página
  const recordada = empresaRecordada();
  if (recordada?.id) api.catalogo(recordada.id).catch(() => {}); // si la sesión es de otra empresa el servidor lo rechaza y no pasa nada
  if (!reciente && location.hash) { const m = buscar(location.hash); m?.cargar?.().catch(() => {}); }
  try {
    app.ctx = await cargarContexto(reciente);
  } catch (e) {
    if (esSesionVencida(e) || esSinAcceso(e)) {
      olvidarPinDeEntrada();
      await salir().catch(() => {});
      return pantallaLogin(esSinAcceso(e) && !esSesionVencida(e) ? 'Su usuario ya no tiene acceso al facturador. Hable con la persona encargada.' : 'Su sesión ya no está abierta. Entre de nuevo.');
    }
    // Falla momentánea de red o del servicio: no se cierra la sesión, se ofrece reintentar
    raiz.replaceChildren(h('div.pantalla-centro', h('div.login.tarjeta.col',
      h('h1', esTransitorio(e) ? 'Sin conexión por un momento' : 'No se pudo abrir el sistema'),
      h('p.sub', (e && typeof e.tipo === 'string' && e.message ? conPunto(e.message) + ' ' : '') + 'No se cerró su sesión.'),
      h('button.btn.primario.grande', { type: 'button', onclick: (ev) => conBoton(ev.currentTarget, () => arrancar()) }, 'Intentar de nuevo'),
      h('button.btn.suave', { type: 'button', onclick: async () => { olvidarPinDeEntrada(); await salir().catch(() => {}); pantallaLogin(); } }, 'Salir'))));
    return;
  }
  // El PIN de entrada solo se guarda en memoria para el cambio obligatorio: si no hay cambio pendiente, se olvida de una vez
  if (!app.ctx.debe_cambiar_pin) olvidarPinDeEntrada();
  if (app.ctx.debe_cambiar_pin) return pantallaCambioPin();
  // La empresa de la sesión la dice el servidor (empresa_sesion). Mientras una sesión no esté atada a ninguna (servicio de acceso viejo), se usa la que se escogió
  // al entrar en este aparato y, como último respaldo, 'pollos'.
  const sociedades = app.ctx.sociedades;
  const codigoDe = (s) => String(s.codigo_acceso || s.codigo || '').toLowerCase();
  const delServidor = app.ctx.empresa_sesion && sociedades.find((s) => s.id === app.ctx.empresa_sesion);
  app.socId = (delServidor || sociedades.find((s) => codigoDe(s) === recordada?.codigo) || sociedades.find((s) => codigoDe(s) === 'pollos') || sociedades[0])?.id;
  if (app.soc) recordarEmpresa(infoEmpresa(app.soc)); // lo que se recuerda para la próxima entrada es lo que dice la sesión
  armarApp(reciente);
}

(async () => {
  try {
    const { data } = await sb.auth.getSession();
    if (data.session) await arrancar(); else pantallaLogin();
  } catch (e) { console.error(e); pantallaLogin(); }
})();
