// Capa de acceso a datos del facturador. Todo pasa por funciones fx_* de Supabase (revisan que el usuario tenga acceso al panel).
export const SUPA_URL = 'https://dwlbcbtwdungyrykgahm.supabase.co';
export const SUPA_KEY = 'sb_publishable_gUoYvCNka0je2rbNeWPpUA_l26vgQbO'; // clave pública; el acceso real lo controlan sesión y funciones
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { describirEstado } from './util.js';

// Sesión propia del facturador (usuario + PIN), separada de la del panel
export const sb = createClient(SUPA_URL, SUPA_KEY, { auth: { storageKey: 'sb-facturador', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });

// Error con texto listo para mostrar. transitorio = falla de red, tiempo agotado o servidor ocupado (vale la pena intentar de nuevo).
export class ErrorApi extends Error {
  constructor(mensaje, { transitorio = false, estado = 0, hasta = null, sesion = false } = {}) { super(mensaje); this.transitorio = transitorio; this.estado = estado; this.hasta = hasta; this.sesion = sesion; }
}
export const esSesionVencida = (e) => !!e && (e.sesion === true || /sesi[oó]n venci/i.test(e.message || ''));
export const esTransitorio = (e) => !!e && (e.transitorio === true || /no se pudo conectar|servidor est[aá] ocupado|tard[oó] demasiado|no respondi[oó]/i.test(e.message || ''));

const MSG_RED = 'No se pudo conectar con el servidor. Revise la conexión a internet e intente de nuevo.';
const MSG_OCUPADO = 'El servidor está ocupado en este momento. Espere unos segundos e intente de nuevo.';
const MSG_TARDO = 'El servidor tardó demasiado en responder. Intente de nuevo.';
export const MSG_SESION = 'Su sesión venció. Toque «Entrar de nuevo» para seguir donde estaba.';
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

// Clasifica la respuesta de PostgREST: devuelve el texto claro si la falla es transitoria, o null si es un error "normal" (regla de negocio, permisos...)
function fallaTransitoria(error, estado) {
  const m = String(error?.message || '');
  if (/AbortError|aborted/i.test(m)) return MSG_TARDO;
  if (error?.code === '57014' || /canceling statement|statement timeout/i.test(m)) return MSG_TARDO;
  if (!estado) return MSG_RED; // sin respuesta HTTP: no hubo conexión (postgrest-js deja status 0)
  if (estado === 504 || estado === 408) return MSG_TARDO;
  if (estado >= 500 || estado === 429) return MSG_OCUPADO;
  return null;
}

/* ---------- Sesión vencida y conexión caída ---------- */
// Cuando la sesión ya no sirve se avisa UNA vez con el evento 'app:sesion-vencida' (main.js muestra «Entrar de nuevo» sin cerrar nada).
// Cuando se cae o vuelve la conexión se avisa con 'app:red' ({ detail: { ok } }).
let sesionAvisada = false, redOk = true, enRenovacion = null;
function avisarSesionVencida() {
  if (sesionAvisada) return;
  sesionAvisada = true;
  document.dispatchEvent(new CustomEvent('app:sesion-vencida'));
}
function marcarRed(ok) {
  if (ok === redOk) return;
  redOk = ok;
  document.dispatchEvent(new CustomEvent('app:red', { detail: { ok } }));
}
export const redDisponible = () => redOk;
export function sesionRestaurada() { sesionAvisada = false; marcarRed(true); }
const esErrorSesion = (r) => r.status === 401 || r.error?.code === 'PGRST301' || /JWT|jwt expired|not authenticated|invalid token/i.test(String(r.error?.message || ''));
// Intenta renovar la sesión una sola vez a la vez. 'ok' | 'vencida' (el servidor la rechazó) | 'red' (no hubo conexión)
function renovarSesion() {
  if (!enRenovacion) {
    enRenovacion = (async () => {
      try {
        const { data, error } = await sb.auth.refreshSession();
        if (data?.session && !error) return 'ok';
        const m = String(error?.message || '');
        return error && (error.name === 'AuthRetryableFetchError' || /fetch|network|load failed/i.test(m)) ? 'red' : 'vencida';
      } catch (e) { return /fetch|network|load failed/i.test(String(e?.message || e)) ? 'red' : 'vencida'; }
      finally { setTimeout(() => { enRenovacion = null; }, 0); }
    })();
  }
  return enRenovacion;
}

/* ---------- Catálogo en memoria ---------- */
// Se guarda por sociedad. Se descarta cuando alguien edita productos, cajones o precios (desde cualquier módulo) y a los 5 minutos.
let versionCatalogo = 0;
const cacheCatalogo = new Map(); // soc -> { v, t, promesa, datos }
const VIDA_CATALOGO = 5 * 60 * 1000;
export function invalidarCatalogo(soc) { versionCatalogo++; if (soc) cacheCatalogo.delete(soc); else cacheCatalogo.clear(); }
const CAMBIA_CATALOGO = /^fx_(producto_guardar|cajon_guardar|precios_lote)$/;
// Solo las consultas (no cambian datos) se repiten solas una vez si falla la red. Una escritura NUNCA se repite sola.
const SOLO_LECTURA = /^fx_(contexto|catalogo|clientes|venta|ventas_abiertas|turno_estado|turnos|salidas|comprobante|comprobantes|comprobante_nc|comprobante_xml|listados2?|documentos|alertas|usuarios|recibidas?|respuesta_recibida|producto_historial|cabys_buscar|cabys_verificar)$/;

// Todos los módulos llaman a sb.rpc: aquí se les da tiempo máximo, un reintento en las consultas y mensajes claros en las fallas de red.
const rpcOriginal = sb.rpc.bind(sb);
async function llamar(nombre, args, opciones) {
  const lectura = SOLO_LECTURA.test(nombre);
  const cambia = CAMBIA_CATALOGO.test(nombre);
  if (cambia) invalidarCatalogo();
  let renovado = false;
  try {
    for (let intento = 1; ; intento++) {
      const ctrl = new AbortController();
      const reloj = setTimeout(() => ctrl.abort(), lectura ? 25000 : 45000);
      let r;
      try { r = await rpcOriginal(nombre, args, opciones).abortSignal(ctrl.signal); }
      catch (e) { r = { data: null, error: { message: String(e?.message || e), code: '' }, status: 0 }; }
      finally { clearTimeout(reloj); }
      if (!r.error) { marcarRed(true); return r; }
      // Sesión vencida: se intenta renovar una vez (la llamada rechazada por el token no cambió nada, así que repetirla es seguro)
      if (!renovado && esErrorSesion(r)) {
        renovado = true;
        const est = await renovarSesion();
        if (est === 'ok') { intento--; continue; }
        if (est === 'vencida') { avisarSesionVencida(); return { ...r, error: { ...r.error, message: MSG_SESION, sesion: true } }; }
        marcarRed(false);
        return { ...r, error: { ...r.error, message: MSG_RED, transitorio: true } };
      }
      const texto = fallaTransitoria(r.error, r.status);
      if (!texto) return r;
      if (texto === MSG_RED) marcarRed(false);
      if (lectura && intento < 2) { await pausa(700); continue; }
      return { ...r, error: { ...r.error, message: texto, transitorio: true } };
    }
  } finally {
    if (cambia) invalidarCatalogo();
  }
}
sb.rpc = (nombre, args, opciones) => llamar(nombre, args, opciones);

// Llama a una función fx_* y devuelve los datos; si falla lanza ErrorApi con un texto listo para mostrar.
export async function rpc(nombre, args = {}) {
  const { data, error } = await sb.rpc(nombre, args);
  if (error) {
    const m = error.sesion || /JWT|expired|not authenticated/i.test(error.message || '') ? MSG_SESION : (error.message || 'Error desconocido');
    throw new ErrorApi(m, { transitorio: !!error.transitorio, sesion: m === MSG_SESION });
  }
  return data;
}

function catalogoDe(soc, forzar) {
  const hoy = cacheCatalogo.get(soc);
  if (!forzar && hoy && Date.now() - hoy.t < VIDA_CATALOGO && hoy.v === versionCatalogo) return hoy.promesa;
  const entrada = { v: versionCatalogo, t: Date.now(), promesa: null };
  entrada.promesa = rpc('fx_catalogo', { p_soc: soc, p_todos: false }).then((d) => { entrada.datos = d; return d; }, (e) => { if (cacheCatalogo.get(soc) === entrada) cacheCatalogo.delete(soc); throw e; });
  // Si mientras llegaba alguien editó productos, lo recibido ya no sirve de caché
  entrada.promesa.then(() => { if (entrada.v !== versionCatalogo && cacheCatalogo.get(soc) === entrada) cacheCatalogo.delete(soc); }).catch(() => {});
  cacheCatalogo.set(soc, entrada);
  return entrada.promesa;
}

// Locales que participan en esta etapa de pruebas. Por ahora solo Pollos La Bomba: Soda no aparece ni puede emitir desde
// la pantalla. Para sumar a Soda más adelante basta agregar 'soda' a esta lista.
export const LOCALES_EN_PRUEBA = ['pollos'];
const soloLocalesEnPrueba = (c) => {
  if (!c || !Array.isArray(c.sociedades)) return c;
  const sociedades = c.sociedades.filter((s) => LOCALES_EN_PRUEBA.includes(String(s.codigo ?? '').toLowerCase()));
  return sociedades.length ? { ...c, sociedades } : c;
};

export const api = {
  // Inicio
  contexto: () => rpc('fx_contexto').then(soloLocalesEnPrueba), // {usuario,nombre,admin,debe_cambiar_pin,sociedades:[{id,codigo,nombre,nombre_comercial,cedula,ambiente,correo,telefono,provincia,canton,distrito,otras_senas,terminales:[{sucursal,terminal,nombre}],turno|null}]}
  // Usuarios (PIN de 4 dígitos)
  usuarios: () => rpc('fx_usuarios'),
  usuarioGuardar: (p) => rpc('fx_usuario_guardar', { p }), // {id?, usuario, nombre, admin, activo, pin?}
  pinCambiar: (actual, nuevo) => rpc('fx_pin_cambiar', { p_actual: actual, p_nuevo: nuevo }),
  // Catálogo (productos y cajones). todos=true incluye inactivos (para administrar) y siempre consulta al servidor.
  // todos=false (lo que usa Caja) se guarda en memoria por sociedad; opciones.forzar=true lo vuelve a pedir.
  catalogo: (soc, todos = false, opciones = {}) => todos ? rpc('fx_catalogo', { p_soc: soc, p_todos: true }) : catalogoDe(soc, !!opciones.forzar),
  productoGuardar: (p) => rpc('fx_producto_guardar', { p }), // {sociedad_id,codigo(6),nombre,cabys(13),precio_final,tarifa_iva,cajon_id,activo,precio_abierto,nota}
  cajonGuardar: (p) => rpc('fx_cajon_guardar', { p }), // {sociedad_id,codigo,nombre,orden,activo}
  // Clientes
  clientes: (soc, q = '') => rpc('fx_clientes', { p_soc: soc, p_q: q }),
  // {id?,solo_nuevo?,sociedad_id,tipo_id,identificacion,nombre,nombre_comercial,correo(opcional),telefono,provincia,canton,distrito,barrio,otras_senas,actividad_codigo ("5610.0" o 6 números),notas,sin_verificar_motivo}.
  // El servidor decide verificado/verificado_en/actividades con la caché de Hacienda; el navegador no puede declararlo.
  clienteGuardar: (p) => rpc('fx_cliente_guardar', { p }),
  // Turnos y caja
  turnoAbrir: (soc, terminal, fondo = 0) => rpc('fx_turno_abrir', { p_soc: soc, p_terminal: terminal, p_fondo: fondo }),
  turnoEstado: (turno) => rpc('fx_turno_estado', { p_turno: turno }),
  // Cierre: solo se cuenta el EFECTIVO. esperado = fondo + efectivo de ventas - salidas. Siempre deja cerrar; si no coincide queda discrepancia=true y diferencia_efectivo (contado - esperado).
  // El efectivo de ventas es lo que corresponde a cada venta (monto), nunca lo que entregó el cliente (recibido).
  turnoCerrar: (turno, c) => rpc('fx_turno_cerrar', { p_turno: turno, p_efectivo: c.efectivo, p_notas: c.notas ?? null }),
  // Salidas de efectivo de la caja durante el turno (pagos a proveedor, vuelto de devolución, etc.)
  salidaRegistrar: (turno, monto, motivo) => rpc('fx_salida_registrar', { p_turno: turno, p_monto: monto, p_motivo: motivo }),
  salidaAnular: (id) => rpc('fx_salida_anular', { p_id: id }),
  salidas: (turno) => rpc('fx_salidas', { p_turno: turno }),
  turnos: (soc, limite = 30) => rpc('fx_turnos', { p_soc: soc, p_limite: limite }),
  // Ventas / cuentas
  ventaCrear: (soc, tipo = 'buffet', referencia = null, telefono = null, terminal = 1) => rpc('fx_venta_crear', { p_soc: soc, p_tipo: tipo, p_referencia: referencia, p_telefono: telefono, p_terminal: terminal }),
  venta: (id) => rpc('fx_venta', { p_venta: id }), // {venta, lineas[], pagos[], cliente, comprobante}. Cada pago en efectivo trae recibido y vuelto (nulos en pagos anteriores al 28-oct)
  ventasAbiertas: (soc) => rpc('fx_ventas_abiertas', { p_soc: soc }),
  ventaDatos: (id, d = {}) => rpc('fx_venta_datos', { p_venta: id, p_tipo: d.tipo ?? null, p_referencia: d.referencia ?? null, p_telefono: d.telefono ?? null, p_cliente: d.cliente ?? null, p_quitar_cliente: !!d.quitarCliente }),
  // extra (opcional): { descripcion, codigoTarifa }. Con descripcion o tarifa propia la línea queda aparte (no se suma a otra igual).
  lineaAgregar: (venta, producto, cantidad = 1, precio = null, nota = null, extra = {}) => rpc('fx_linea_agregar', { p_venta: venta, p_producto: producto, p_cantidad: cantidad, p_precio: precio, p_nota: nota,
    ...(extra.descripcion ? { p_descripcion: extra.descripcion } : {}), ...(extra.codigoTarifa ? { p_codigo_tarifa: extra.codigoTarifa } : {}) }),
  // c: { cantidad, precio, nota, descripcion, codigoTarifa } (solo lo que cambia). El servidor fija el porcentaje según el código de tarifa.
  lineaEditar: (linea, c = {}) => rpc('fx_linea_editar', { p_linea: linea, p_cantidad: c.cantidad ?? null, p_precio: c.precio ?? null, p_nota: c.nota ?? null, p_descripcion: c.descripcion ?? null,
    ...(c.codigoTarifa ? { p_codigo_tarifa: c.codigoTarifa } : {}) }),
  lineaQuitar: (linea) => rpc('fx_linea_quitar', { p_linea: linea }),
  ventaAnular: (id, motivo = null) => rpc('fx_venta_anular', { p_venta: id, p_motivo: motivo }),
  prefacturar: (id) => rpc('fx_prefacturar', { p_venta: id }),
  // Cobro: pagos = [{medio:'efectivo|tarjeta|sinpe|transferencia', monto, referencia?, recibido?}] y la suma de los montos debe ser igual al total.
  // En efectivo, "recibido" es lo que entregó el cliente (>= monto); el servidor guarda recibido y vuelto = recibido - monto. Sin "recibido" se asume pago exacto.
  // Devuelve el comprobante completo (ver comprobante()).
  // actividad (opcional): código de actividad del cliente SOLO para esta factura ("5610.0"); queda en el snapshot del receptor y no cambia al cliente.
  cobrar: (venta, pagos, cliente = null, terminal = 1, actividad = null) => rpc('fx_cobrar', { p_venta: venta, p_pagos: pagos, p_cliente: cliente, p_terminal: terminal, p_actividad_receptor: actividad || null }),
  // Comprobantes
  comprobante: (id) => rpc('fx_comprobante', { p_id: id }), // incluye sociedad, venta, original, cliente_snapshot, lineas_snapshot, pagos_snapshot (en efectivo con recibido y vuelto) y los totales efectivo_recibido y vuelto
  comprobantes: (soc, desde, hasta, q = '') => rpc('fx_comprobantes', { p_soc: soc, p_desde: desde, p_hasta: hasta, p_q: q }),
  xml: (id, cual = 'firmado') => rpc('fx_comprobante_xml', { p_id: id, p_cual: cual }), // 'firmado' | 'respuesta'
  reenviar: (id) => rpc('fx_reenviar', { p_id: id }),
  notaCredito: (id, motivo, terminal = 1) => rpc('fx_nota_credito', { p_id: id, p_motivo: motivo, p_terminal: terminal }),
  // Listados
  listados: (soc, desde, hasta) => rpc('fx_listados', { p_soc: soc, p_desde: desde, p_hasta: hasta }),
  // Estado en palabras de un comprobante y vigilancia hasta que Hacienda responda (ver más abajo)
  estadoComprobante: (id) => estadoComprobante(id),
  vigilarComprobante: (id, alCambiar, opciones) => vigilarComprobante(id, alCambiar, opciones),
};

// Funciones de borde (edge functions) con la sesión del usuario
// opciones.signal (AbortSignal) permite cancelar la consulta si ya no hace falta (p. ej. la cajera siguió escribiendo).
export async function funcion(nombre, cuerpo = {}, opciones = {}) {
  let renovado = false;
  for (;;) {
    const { data: s } = await sb.auth.getSession();
    let r;
    try {
      r = await fetch(`${SUPA_URL}/functions/v1/${nombre}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPA_KEY, Authorization: 'Bearer ' + (s.session?.access_token || SUPA_KEY) },
        body: JSON.stringify(cuerpo),
        signal: opciones.signal,
      });
    } catch (e) {
      if (e?.name === 'AbortError') throw e; // cancelado a propósito por quien llamó
      marcarRed(false);
      throw new ErrorApi(MSG_RED, { transitorio: true });
    }
    marcarRed(true);
    if (r.status === 401 && !renovado) { // el token no sirvió: se renueva una vez y se repite (la función rechazó la llamada sin hacer nada)
      renovado = true;
      const est = await renovarSesion();
      if (est === 'ok') continue;
      if (est === 'vencida') { avisarSesionVencida(); throw new ErrorApi(MSG_SESION, { sesion: true, estado: 401 }); }
      throw new ErrorApi(MSG_RED, { transitorio: true });
    }
    const t = await r.text();
    let j; try { j = JSON.parse(t); } catch { j = { error: t.slice(0, 200) }; }
    if (!r.ok || j.error) throw new ErrorApi(j.error || ('Error ' + r.status), { transitorio: r.status >= 502 && r.status <= 504, estado: r.status });
    return j;
  }
}

// Inicio de sesión con usuario y PIN.
// Cada intento espera como máximo 20 segundos. Si el servicio de acceso no responde (red, arranque en frío, 5xx) se repite UNA vez solo.
// Un PIN equivocado (401) o un bloqueo (429) NO se repiten: así no se gastan los 5 intentos del PIN.
// alReintentar() avisa a la pantalla para mostrar "Reintentando…".
export async function entrar(usuario, pin, { alReintentar } = {}) {
  let ultimo;
  for (let intento = 1; intento <= 2; intento++) {
    const ctrl = new AbortController();
    const reloj = setTimeout(() => ctrl.abort(), 20000);
    try {
      let r;
      try {
        r = await fetch(`${SUPA_URL}/functions/v1/facturador-acceso`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPA_KEY }, body: JSON.stringify({ usuario, pin }), signal: ctrl.signal });
      } catch (e) {
        throw new ErrorApi(e?.name === 'AbortError' ? 'El acceso tardó demasiado en responder. Intente de nuevo.' : MSG_RED, { transitorio: true });
      }
      let j = null;
      try { j = JSON.parse(await r.text()); } catch { j = null; }
      if (!j || typeof j.ok !== 'boolean') throw new ErrorApi('El servicio de acceso no respondió bien (código ' + r.status + '). Intente de nuevo en unos segundos.', { transitorio: true, estado: r.status });
      if (!j.ok) throw new ErrorApi(j.error || 'No se pudo entrar. Intente de nuevo.', { transitorio: r.status >= 500, estado: r.status, hasta: j.hasta || null });
      const { error } = await sb.auth.setSession({ access_token: j.access_token, refresh_token: j.refresh_token });
      if (error) throw new ErrorApi(error.message || 'No se pudo abrir la sesión. Intente de nuevo.', { transitorio: true });
      sesionRestaurada();
      return j;
    } catch (e) {
      ultimo = e;
      if (!(e instanceof ErrorApi) || !e.transitorio || intento === 2) break;
      alReintentar?.();
      await pausa(900);
    } finally { clearTimeout(reloj); }
  }
  throw ultimo instanceof Error && ultimo.message ? ultimo : new ErrorApi('No se pudo entrar. Intente de nuevo.');
}
// Cierre de sesión limpio: avisa al servidor (si hay conexión) y SIEMPRE borra la sesión de este aparato y el catálogo en memoria
export async function salir() {
  try { await Promise.race([sb.auth.signOut(), pausa(4000)]); } catch { /* sin conexión: se borra solo aquí */ }
  try { await sb.auth.signOut({ scope: 'local' }); } catch { /* ya estaba cerrada */ }
  invalidarCatalogo();
  sesionAvisada = false;
}

/* ---------- Estado de un comprobante (lo usan Caja, Documentos y Anular) ---------- */
// Lee el comprobante y devuelve su estado en palabras: { id, estado, final, clase:'ok'|'espera'|'mal', chip, texto, motivo, mensaje, comprobante }
// "final" es true cuando Hacienda ya respondió (aceptado o rechazado).
export async function estadoComprobante(id) {
  const c = await rpc('fx_comprobante', { p_id: id });
  return { id, mensaje: c?.mensaje || '', ...describirEstado(c?.estado, c?.mensaje), comprobante: c };
}
// Consulta el estado cada pocos segundos hasta que Hacienda responda (o pasen "max" milisegundos). alCambiar(info) se llama la primera vez y cada vez que
// cambia el estado. Devuelve una función para dejar de vigilar (llamarla al cerrar la pantalla).
export function vigilarComprobante(id, alCambiar, { cada = 4000, max = 5 * 60 * 1000 } = {}) {
  let parar = false, ultimo = null;
  (async () => {
    const fin = Date.now() + max;
    while (!parar && Date.now() < fin) {
      try {
        const info = await estadoComprobante(id);
        if (parar) return;
        if (info.estado !== ultimo) { ultimo = info.estado; alCambiar(info); }
        if (info.final) return;
      } catch { /* sin conexión: se vuelve a intentar */ }
      await pausa(cada);
    }
  })();
  return () => { parar = true; };
}
