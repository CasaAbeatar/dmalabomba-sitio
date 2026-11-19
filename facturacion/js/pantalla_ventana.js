// Segunda ventana de la pantalla del cliente: la abre en el otro monitor, la vigila y la vuelve a colocar.
// Módulo aparte y opcional: nada de lo que pase aquí llega a romper la caja (todo va en try/catch y sin mensajes en la consola).
//
// CABLEADO DESDE pantalla_emisor.js (tres líneas; el emisor no se ha tocado todavía):
//   1) Arriba, junto al import de './iva.js':
//        import { abrirClienteEnOtraPantalla, detenerVentana } from './pantalla_ventana.js';
//   2) Cuerpo completo de abrirVentanaCliente() (sustituye al actual; ya no necesita ser async):
//        function abrirVentanaCliente() { if (activo && encendida && configLista) abrirClienteEnOtraPantalla({ rutaCliente: RUTA_CLIENTE, monitorCliente: opciones.monitor }); }
//   3) Dentro de detener(), justo después de «activo = false;»:
//        detenerVentana();
// Opcional (cuarta línea): el enlace manual «Abrir pantalla del cliente» del puntito usa la misma ventana con
//        import { abrirManual } ...   y   enlace.addEventListener('click', (e) => { if (abrirManual(RUTA_CLIENTE)) e.preventDefault(); });
// Con eso se puede quitar de iniciar() el listener 'pointerdown' (alPrimerToque): este módulo arma su propio reintento
// con 'pointerup' / 'click' / 'keydown' / 'touchend', que son los eventos que sí cuentan como gesto del usuario en Chrome.
//
// Cadena de apertura (contrato «CAMBIO DE ARQUITECTURA», punto 5):
//   a) Window Management API: getScreenDetails() + window.open(...) en la pantalla elegida + pantalla completa en esa ventana.
//   b) Si el kit de Windows ya abre la ventana (caja con «?kit=1») o ya hay una que contesta por el canal: no se abre otra.
//   c) Enlace manual (abrirManual): abre la ventana y el cajero la arrastra y pulsa F11.
// Todo está detrás de detección de características: en Safari y en iPhone no hay getScreenDetails y solo queda el enlace manual.

export const NOMBRE_CANAL = 'lb-pantalla-cliente'; // mismo canal que el emisor y la página del cliente
export const NOMBRE_VENTANA = 'lb-cliente';        // nombre de la ventana: abrir otra vez con el mismo nombre reutiliza la que existe
export const RUTA_CLIENTE = new URL('../cliente/', import.meta.url).href;

const VIDA_ACK = 15000;          // la ventana del cliente cuenta como abierta si contestó hace menos de esto
const ESPERA_ACK = 1500;         // cuánto se espera un «ack» antes de decidir que no hay ventana
const ESPERA_CARGA = 8000;       // cuánto se espera a que la ventana nueva cargue antes de pedir pantalla completa
const CADA_VIGILIA = 5000;       // revisión periódica de la ventana
const ENTRE_SONDEOS = 20000;     // sin ventana conocida, cada cuánto se vuelve a preguntar
const VENTANA_APERTURAS = 60000; // límite de aperturas: 3 por minuto, para no entrar en un ciclo si algo la cierra al instante
const MAX_APERTURAS = 3;
const ENTRE_REUBICACIONES = 4000;
const ESPERA_ENTRE_SONDEOS_CORTOS = 3000; // no se vuelve a esperar un «ack» si se preguntó hace menos de esto

// ---------- Estado del módulo (una sola vez por pestaña) ----------
let activo = false;
let cfg = { rutaCliente: RUTA_CLIENTE, monitorCliente: '', alAbrir: null, alFallar: null, modoKit: false };
let bc = null, ackEn = 0;
let ventana = null, detalles = null, pantalla = null;
let fase = 'inactiva';           // inactiva | iniciando | abierta | cerrada | cerrada-a-mano | una-pantalla | sin-api | sin-permiso | bloqueada | kit
let via = null;                  // api | manual | externa | kit
let completa = null;             // null: no se sabe / no se intentó; true: pantalla completa; false: se intentó y no se pudo
let motivo = null;               // último motivo de fallo
let aperturas = [];
let abriendo = null;
let timerVigilia = null, timerCambio = null;
let ultimoSondeo = 0, ultimaReubicacion = 0, reubicacionesSeguidas = 0;
let escuchasPantalla = [];
let intentoAuto = false;         // ya se pidió pantalla completa por cuenta propia en esta ventana (no se repite sin gesto)
let gesto = null;                // escucha armada para el único reintento con el primer toque del cajero
const reintentos = { abrir: false, completa: false };
let notificado = '';             // último motivo comunicado a alFallar (para no repetirlo)
let cerradaAMano = false;        // el administrador cerró la pantalla del cliente a propósito: no se reabre sola (hasta recargar la caja, volver el icono Facturador o cambiar las pantallas)
let abiertaEn = 0;               // cuándo se abrió la ventana actual (una que se cierra al instante no cuenta como cierre a propósito)
const VIDA_MINIMA = 20000;       // la ventana debe haber vivido al menos esto para que su cierre se tome como a propósito

const ahora = () => Date.now();
const seguro = (f, ...a) => { try { return typeof f === 'function' ? f(...a) : undefined; } catch { return undefined; } };
const hayVentana = () => typeof window !== 'undefined';
const responde = () => ahora() - ackEn < VIDA_ACK;
const ventanaViva = () => { try { return !!ventana && !ventana.closed; } catch { return false; } };
// La ventana se cerró (o la cerramos): su último «ack» ya no vale y no hace falta preguntar otra vez para saberlo.
function perdida() { ventana = null; completa = null; intentoAuto = false; ackEn = 0; ultimoSondeo = ahora(); }

// ---------- Elección y geometría de la pantalla ----------
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

// Devuelve la pantalla donde debe ir la ventana del cliente, o null si no hay otra que la actual.
// Orden: la marcada en monitorCliente (por nombre), la interna (isInternal), la que no es la principal, cualquiera que no sea la actual.
export function elegirPantalla(det, monitorCliente) {
  const todas = Array.from(det?.screens || []);
  if (todas.length < 2) return null;
  const actual = det.currentScreen || todas.find((p) => p.isPrimary) || todas[0];
  const otras = todas.filter((p) => p !== actual);
  if (!otras.length) return null;
  const pref = String(monitorCliente || '').trim().toLowerCase();
  return (pref && otras.find((p) => String(p.label || '').toLowerCase().includes(pref)))
    || otras.find((p) => p.isInternal)
    || otras.find((p) => !p.isPrimary)
    || otras[0];
}

// Rectángulo de la ventana en la pantalla: el área disponible (sin barras) si existe, para que el navegador no la recorte.
export function geometria(p) {
  const left = num(p?.availLeft, num(p?.left)), top = num(p?.availTop, num(p?.top));
  const width = num(p?.availWidth, num(p?.width)), height = num(p?.availHeight, num(p?.height));
  return { left, top, width, height };
}
const caracteristicas = (p) => {
  const g = geometria(p);
  return 'popup=yes,left=' + g.left + ',top=' + g.top + ',width=' + g.width + ',height=' + g.height;
};
const rectCompleto = (p) => ({ left: num(p?.left, num(p?.availLeft)), top: num(p?.top, num(p?.availTop)), width: num(p?.width, num(p?.availWidth)), height: num(p?.height, num(p?.availHeight)) });
const info = () => ({ via, pantalla: pantalla ? String(pantalla.label || '') : null, ...(pantalla ? geometria(pantalla) : {}), completa });

// ---------- Canal con la ventana del cliente ----------
function abrirCanal() {
  if (bc || typeof BroadcastChannel !== 'function') return;
  try {
    bc = new BroadcastChannel(NOMBRE_CANAL);
    bc.onmessage = (ev) => {
      const e = ev?.data?.evento;
      if (e === 'cerrar-a-mano') { alCerrarAMano(); return; }
      if (e === 'ack' || e === 'hola') {
        ackEn = ahora();
        if (cerradaAMano) { cerradaAMano = false; if (fase === 'cerrada-a-mano') fase = 'abierta'; } // la ventana volvió (alguien la abrió): se vigila otra vez
        if (e === 'hola') seguro(alHola);
      }
    };
  } catch { bc = null; }
}
// Pregunta con un «latido» y espera el «ack» de la ventana del cliente. true si contestó.
function sondear(ms = ESPERA_ACK) {
  abrirCanal();
  if (responde()) return Promise.resolve(true);
  if (!bc || ahora() - ultimoSondeo < ESPERA_ENTRE_SONDEOS_CORTOS) return Promise.resolve(false); // se acaba de preguntar y nadie contestó
  const antes = ackEn;
  ultimoSondeo = ahora();
  try { bc.postMessage({ evento: 'latido', payload: { ts: ahora() } }); } catch { return Promise.resolve(false); }
  return new Promise((ok) => {
    const t0 = ahora();
    const paso = () => (ackEn !== antes ? ok(true) : ahora() - t0 >= ms ? ok(false) : setTimeout(paso, 50));
    paso();
  });
}
// La pantalla del cliente avisó que la cerraron a propósito (botón de cierre): no se reabre sola.
function alCerrarAMano() {
  cerradaAMano = true; fase = 'cerrada-a-mano'; motivo = null; ackEn = 0;
  if (ventana && !ventanaViva()) perdida();
}
// La página del cliente avisó que acaba de cargar («hola»): si la abrimos nosotros, ya se puede pedir pantalla completa.
function alHola() { if (ventanaViva() && completa !== true) pantallaCompleta(false); }

// ---------- Fallos y estado ----------
function fallar(m, detalle) {
  motivo = m;
  if (m === 'sin-api') fase = 'sin-api';
  else if (m === 'sin-permiso') fase = 'sin-permiso';
  else if (m === 'bloqueada') fase = 'bloqueada';
  else if (m === 'una-pantalla') fase = 'una-pantalla';
  if (notificado !== m) { notificado = m; seguro(cfg.alFallar, m, detalle); }
  return estadoVentana();
}

export function estadoVentana() {
  return {
    fase, via, motivo,
    responde: responde(),
    abierta: ventanaViva() || responde(),
    completa,
    pantalla: pantalla ? { label: String(pantalla.label || ''), ...rectCompleto(pantalla) } : null,
    ultimoAck: ackEn || null,
    aperturas: aperturas.length,
  };
}

// ---------- Permiso de manejo de ventanas ----------
async function estadoPermiso() {
  if (!hayVentana() || !navigator.permissions?.query) return null;
  for (const name of ['window-management', 'window-placement']) {
    try { return (await navigator.permissions.query({ name })).state; } catch { /* nombre no reconocido: se prueba el otro */ }
  }
  return null;
}
async function obtenerDetalles() {
  if (detalles) return detalles;
  const d = await window.getScreenDetails();
  detalles = d;
  try {
    for (const ev of ['screenschange', 'currentscreenchange']) { d.addEventListener(ev, alCambiarPantallas); escuchasPantalla.push([d, ev]); }
  } catch { /* sin eventos: queda la revisión periódica */ }
  return d;
}

// ---------- Gesto del cajero: un solo reintento ----------
function armarGesto(causa) {
  if (!hayVentana() || gesto || reintentos[causa]) return; // ya se usó o ya está armado
  reintentos[causa] = true;
  const evs = ['pointerup', 'click', 'keydown', 'touchend'];
  const alGesto = () => {
    desarmarGesto();
    if (!activo) return;
    if (causa === 'abrir') intentarAbrir('gesto');
    else pantallaCompleta(true);
  };
  gesto = { evs, alGesto };
  for (const e of evs) window.addEventListener(e, alGesto, true);
}
function desarmarGesto() {
  if (!gesto) return;
  for (const e of gesto.evs) { try { window.removeEventListener(e, gesto.alGesto, true); } catch { /* ya quitado */ } }
  gesto = null;
}

// ---------- Apertura ----------
function registrarApertura() {
  const t = ahora();
  aperturas = aperturas.filter((x) => t - x < VENTANA_APERTURAS);
  aperturas.push(t);
}
const puedeAbrir = () => aperturas.filter((x) => ahora() - x < VENTANA_APERTURAS).length < MAX_APERTURAS;

function intentarAbrir(origen) {
  if (cerradaAMano && origen !== 'gesto') return Promise.resolve(estadoVentana());
  if (abriendo) return abriendo;
  abriendo = (async () => {
    try { return await abrirEnOtraPantalla(origen); } catch { return estadoVentana(); } finally { abriendo = null; }
  })();
  return abriendo;
}

async function abrirEnOtraPantalla() {
  if (!activo || !hayVentana()) return estadoVentana();
  if (cfg.modoKit) { fase = 'kit'; via = 'kit'; return estadoVentana(); }
  if (ventanaViva()) return estadoVentana();
  if (await sondear()) { if (fase !== 'abierta') fase = 'abierta'; via = via || 'externa'; motivo = null; return estadoVentana(); }
  if (!activo) return estadoVentana();
  if (typeof window.getScreenDetails !== 'function') return fallar('sin-api');
  if (!window.screen?.isExtended) { escucharCambioDePantalla(); return fallar('una-pantalla'); }
  if (!puedeAbrir()) return fallar('reaperturas');
  if ((await estadoPermiso()) === 'denied') return fallar('sin-permiso'); // denegado a propósito: no se insiste
  let det;
  try { det = await obtenerDetalles(); } catch { armarGesto('abrir'); return fallar('sin-permiso'); } // sin permiso o sin gesto: un solo reintento con el primer toque
  const p = elegirPantalla(det, cfg.monitorCliente);
  if (!p) { escucharCambioDePantalla(); return fallar('una-pantalla'); }
  let w = null;
  try { w = window.open(cfg.rutaCliente, NOMBRE_VENTANA, caracteristicas(p)); } catch { w = null; }
  if (!w) { armarGesto('abrir'); return fallar('bloqueada'); }
  ventana = w; pantalla = p; via = 'api'; fase = 'abierta'; motivo = null; notificado = ''; completa = null;
  reintentos.completa = false; abiertaEn = ahora();
  registrarApertura();
  seguro(cfg.alAbrir, info());
  armarToqueEnVentana(w);
  intentoAuto = false;
  esperarCarga(w).then(() => pantallaCompleta(false));
  return estadoVentana();
}
// Espera a que la ventana nueva conteste (cargó la página del cliente) o a que pase el máximo.
function esperarCarga(w) {
  return new Promise((ok) => {
    const t0 = ahora(), antes = ackEn;
    const paso = () => { if (!activo || ventana !== w || ackEn !== antes || ahora() - t0 >= ESPERA_CARGA) ok(); else setTimeout(paso, 100); };
    paso();
  });
}
// Si alguien toca o pulsa en la propia ventana del cliente, ese gesto sí cuenta para la pantalla completa.
function armarToqueEnVentana(w) {
  try {
    const alToque = () => { try { if (ventana === w && completa !== true) pantallaCompleta(true); } catch { /* sin pantalla completa */ } };
    for (const e of ['pointerup', 'keydown', 'touchend']) w.addEventListener(e, alToque, { once: true, capture: true });
  } catch { /* ventana sin acceso */ }
}

// conGesto = true cuando viene de un toque o clic (reintento); sin gesto se intenta una sola vez por ventana.
async function pantallaCompleta(conGesto) {
  const w = ventana;
  if (!w || !ventanaViva() || !activo) return false;
  if (!conGesto) { if (intentoAuto) return completa === true; intentoAuto = true; }
  try {
    const doc = w.document;
    if (doc.fullscreenElement) { completa = true; return true; }
    const el = doc.documentElement;
    if (!el || typeof el.requestFullscreen !== 'function') { completa = false; return false; }
    await (pantalla ? el.requestFullscreen({ screen: pantalla }) : el.requestFullscreen());
    completa = true;
    return true;
  } catch {
    completa = false;
    armarGesto('completa'); // el navegador exigió un gesto: un solo reintento con el primer toque; sin la directiva AutomaticFullscreenAllowedForUrls puede seguir fallando
    return false;
  }
}

// ---------- Recolocar si se movió o cambió la configuración de pantallas ----------
function pantallaObjetivo() {
  // La pantalla guardada puede ser un objeto viejo: se vuelve a elegir con los datos vigentes.
  const p = detalles ? elegirPantalla(detalles, cfg.monitorCliente) : pantalla;
  return p || pantalla;
}
function dentroDe(w, p) {
  const r = rectCompleto(p);
  const cx = num(w.screenX, num(w.screenLeft)) + num(w.outerWidth) / 2;
  const cy = num(w.screenY, num(w.screenTop)) + num(w.outerHeight) / 2;
  return cx >= r.left && cx < r.left + r.width && cy >= r.top && cy < r.top + r.height;
}
async function reubicar(p) {
  const w = ventana;
  if (!w || !ventanaViva() || !p) return;
  if (ahora() - ultimaReubicacion < ENTRE_REUBICACIONES || reubicacionesSeguidas >= 3) return;
  ultimaReubicacion = ahora(); reubicacionesSeguidas++;
  try { if (w.document.fullscreenElement) await w.document.exitFullscreen(); } catch { /* sigue en pantalla completa: se intenta mover igual */ }
  try {
    const g = geometria(p);
    w.moveTo(g.left, g.top);
    w.resizeTo(g.width, g.height);
  } catch { /* el navegador no deja mover esta ventana */ }
  pantalla = p;
  completa = null;
  intentoAuto = false;
  reintentos.completa = false;
  pantallaCompleta(false);
}
function revisarPosicion() {
  if (!ventanaViva()) return;
  const p = pantallaObjetivo();
  if (!p) return;
  if (dentroDe(ventana, p)) { reubicacionesSeguidas = 0; pantalla = p; return; }
  reubicar(p);
}

function alCambiarPantallas() {
  if (!activo) return;
  clearTimeout(timerCambio);
  timerCambio = setTimeout(() => { seguro(revisarCambio); }, 500); // Windows avisa varias veces seguidas al conectar o quitar un monitor
}
async function revisarCambio() {
  if (!activo) return;
  reubicacionesSeguidas = 0; reintentos.abrir = false;
  cerradaAMano = false; // cambió la configuración de pantallas: se vuelve al comportamiento normal
  const dos = detalles ? Array.from(detalles.screens || []).length >= 2 : !!window.screen?.isExtended;
  if (!dos) {
    // Quedó una sola pantalla: la ventana del cliente caería encima de la caja, se cierra y se reabre cuando vuelva la otra
    if (ventanaViva()) { try { ventana.close(); } catch { /* ya cerrada */ } }
    perdida(); fase = 'una-pantalla'; motivo = 'una-pantalla';
    return;
  }
  if (ventanaViva()) { revisarPosicion(); return; }
  if (ventana) perdida();
  intentarAbrir('cambio');
}
function escucharCambioDePantalla() {
  // Sin detalles (una sola pantalla o sin permiso aún): screen.change avisa cuando isExtended cambia
  try {
    if (!window.screen?.addEventListener || escuchasPantalla.some((x) => x[0] === window.screen)) return;
    window.screen.addEventListener('change', alCambiarPantallas);
    escuchasPantalla.push([window.screen, 'change']);
  } catch { /* sin evento */ }
}

// ---------- Vigilia periódica ----------
function vigilar() {
  try {
    if (!activo) return;
    if (ventana) {
      if (!ventanaViva()) {
        const vivio = ahora() - abiertaEn;
        perdida();
        if (cerradaAMano) { fase = 'cerrada-a-mano'; return; }
        // Cerrada después de haber estado abierta un buen rato: la cerraron a propósito y se respeta. Cerrada al instante: se reintenta.
        if (abiertaEn && vivio >= VIDA_MINIMA) { cerradaAMano = true; fase = 'cerrada-a-mano'; return; }
        fase = 'cerrada'; intentarAbrir('cerrada'); return;
      }
      revisarPosicion();
      return;
    }
    if (cerradaAMano) return;
    // Ventana que abrió otro (el kit): si contestaba y dejó de contestar, la cerraron; se respeta igual.
    if (fase === 'abierta' && via === 'externa' && ackEn > 0 && !responde()) { cerradaAMano = true; fase = 'cerrada-a-mano'; return; }
    if (cfg.modoKit) return;
    // Sin ventana conocida: solo se vuelve a intentar si la causa pudo cambiar (cerrada, una sola pantalla, o una externa que dejó de contestar)
    const puede = fase === 'cerrada' || fase === 'una-pantalla' || fase === 'iniciando' || (fase === 'abierta' && !responde());
    if (puede && ahora() - ultimoSondeo > ENTRE_SONDEOS) intentarAbrir('vigilia');
  } catch { /* la vigilia nunca estorba */ }
}

// ---------- API pública ----------
// Abre (si hace falta) la pantalla del cliente en el otro monitor y la deja vigilada. Nunca lanza errores.
// opciones: { rutaCliente, monitorCliente, alAbrir(info), alFallar(motivo, detalle) }
// Motivos de fallo: 'sin-api' (navegador sin getScreenDetails), 'una-pantalla', 'sin-permiso', 'bloqueada' (ventana emergente bloqueada), 'reaperturas'.
// Llamarla de nuevo mientras está activa no abre una segunda ventana: solo revisa si la actual responde.
export function abrirClienteEnOtraPantalla(opciones = {}) {
  try {
    if (!hayVentana()) return Promise.resolve(estadoVentana());
    cfg = {
      rutaCliente: opciones.rutaCliente || cfg.rutaCliente || RUTA_CLIENTE,
      monitorCliente: opciones.monitorCliente || cfg.monitorCliente || '',
      alAbrir: opciones.alAbrir || cfg.alAbrir,
      alFallar: opciones.alFallar || cfg.alFallar,
      modoKit: opciones.modoKit != null ? !!opciones.modoKit : modoKitDeLaDireccion(),
    };
    if (!activo) {
      activo = true; fase = 'iniciando'; motivo = null; notificado = '';
      reintentos.abrir = false; reintentos.completa = false;
      abrirCanal();
      timerVigilia = setInterval(vigilar, CADA_VIGILIA);
    }
    return intentarAbrir('inicio');
  } catch { return Promise.resolve(estadoVentana()); }
}

// El kit de Windows abre la caja con «?kit=1» cuando él mismo abre la pantalla del cliente ($AbrirClienteDesdeKit = $true):
// así este módulo no abre una segunda ventana.
function modoKitDeLaDireccion() {
  try { return new URL(location.href).searchParams.get('kit') === '1'; } catch { return false; }
}

// Enlace manual «Abrir pantalla del cliente». Se llama desde un clic. Devuelve true si abrió o enfocó la ventana
// (el llamador entonces hace preventDefault); false si el navegador la bloqueó (queda el comportamiento normal del enlace).
export function abrirManual(rutaCliente) {
  try {
    if (!hayVentana()) return false;
    const ruta = rutaCliente || cfg.rutaCliente || RUTA_CLIENTE;
    if (ventanaViva()) { seguro(() => ventana.focus()); return true; }
    const p = pantalla || (detalles ? elegirPantalla(detalles, cfg.monitorCliente) : null);
    const w = window.open(ruta, NOMBRE_VENTANA, p ? caracteristicas(p) : 'popup=yes,width=1280,height=720');
    if (!w) return false;
    ventana = w; via = 'manual'; fase = 'abierta'; motivo = null; completa = null;
    cerradaAMano = false; abiertaEn = ahora();
    if (p) pantalla = p;
    registrarApertura();
    armarToqueEnVentana(w);
    return true;
  } catch { return false; }
}

// Deja de vigilar (la caja salió de la pantalla de Caja). No cierra la ventana del cliente: sigue mostrando publicidad.
export function detenerVentana() {
  activo = false;
  clearInterval(timerVigilia); clearTimeout(timerCambio);
  timerVigilia = null; timerCambio = null;
  desarmarGesto();
  for (const [o, ev] of escuchasPantalla) { try { o.removeEventListener(ev, alCambiarPantallas); } catch { /* ya quitado */ } }
  escuchasPantalla = [];
  const b = bc; bc = null;
  setTimeout(() => { try { b?.close(); } catch { /* ya cerrado */ } }, 100);
  detalles = null; ventana = null; pantalla = null; abriendo = null;
  fase = 'inactiva'; via = null; completa = null; motivo = null; notificado = ''; ackEn = 0; aperturas = [];
  cerradaAMano = false; abiertaEn = 0;
  reintentos.abrir = false; reintentos.completa = false;
  ultimoSondeo = 0; ultimaReubicacion = 0; reubicacionesSeguidas = 0;
}
