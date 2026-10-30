// Capa de acceso a datos del facturador. Todo pasa por funciones fx_* de Supabase (revisan que el usuario tenga acceso al panel).
export const SUPA_URL = 'https://dwlbcbtwdungyrykgahm.supabase.co';
export const SUPA_KEY = 'sb_publishable_gUoYvCNka0je2rbNeWPpUA_l26vgQbO'; // clave pública; el acceso real lo controlan sesión y funciones
// supabase-js 2.45.4 viaja con el propio sitio (vendor/LEEME.txt dice de dónde salió y su SHA-256); la página no carga código de ningún CDN.
// El archivo es el paquete UMD de npm tal cual: al importarlo deja el objeto globalThis.supabase, de donde se toma createClient.
import '../vendor/supabase-js-2.45.4.umd.js';
import { describirEstado, MSG_SIN_INTERNET, MSG_GENERICO } from './util.js';
const { createClient } = globalThis.supabase;

// Sesión propia del facturador (usuario + PIN), separada de la del panel
export const sb = createClient(SUPA_URL, SUPA_KEY, { auth: { storageKey: 'sb-facturador', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });

/* ---------- Qué clase de falla es ---------- */
// La decisión «¿vale la pena intentar de nuevo?» NO sale del texto del mensaje: sale de la clase de la falla (ErrorApi.tipo), que se fija una sola vez, aquí,
// mirando el estado HTTP y el código de la base:
//   'red', 'tiempo', 'ocupado'  transitorias: no hubo conexión, se acabó el tiempo o el sistema está saturado. Una consulta puede repetirse sola una vez.
//   'sesion'                    la sesión ya no sirve: hay que entrar de nuevo.
//   'negocio'                   el sistema entendió y dijo que no («cliente inactivo», «turno cerrado», permisos, datos). Repetirlo daría lo mismo: nunca se reintenta
//                               ni se muestra como falla de red.
// Así se pueden cambiar las palabras de cualquier mensaje sin romper el reintento, y un mensaje de negocio que por casualidad diga «tardó» o «conexión» no se toma por falla de red.
const MSG_RED = MSG_SIN_INTERNET;
const MSG_OCUPADO = 'El sistema está ocupado en este momento. Espere unos segundos e intente de nuevo.';
const MSG_TARDO = 'La respuesta tardó demasiado. Intente de nuevo.';
const MSG_ACCESO_TARDO = 'La entrada tardó demasiado en responder. Intente de nuevo.';
// Cuando lo que falló era un cambio (cobrar, agregar una línea...) no se sabe si llegó a guardarse: el texto pide revisar ANTES de repetir, para no cobrar ni agregar dos veces
const MSG_RED_ESCRIBIR = 'No hay conexión con internet. Antes de repetirlo, revise si lo último que hizo quedó guardado.';
const MSG_TARDO_ESCRIBIR = 'La respuesta tardó demasiado y no se sabe si quedó guardado. Antes de repetirlo, revise si ya aparece en pantalla.';
const MSG_ACCION_FALLIDA = 'No se pudo completar la acción. Intente de nuevo; si sigue igual, avise a la persona encargada.';
const MSG_PERMISO = 'Su usuario no tiene permiso para hacer esto. Avise a la persona encargada.';
export const MSG_SESION = 'Su sesión venció. Toque «Entrar de nuevo» para seguir donde estaba.';
// Los textos de arriba son los únicos que este archivo fabrica para una falla transitoria o de sesión. Si otro archivo vuelve a envolver uno de ellos en un ErrorApi nuevo
// (api_clientes.js, api_mantenimiento.js), el tipo se recupera por igualdad exacta con la constante, nunca por palabras sueltas.
const TIPO_DE_MENSAJE = new Map([[MSG_RED, 'red'], [MSG_RED_ESCRIBIR, 'red'], [MSG_OCUPADO, 'ocupado'], [MSG_TARDO, 'tiempo'], [MSG_TARDO_ESCRIBIR, 'tiempo'], [MSG_ACCESO_TARDO, 'tiempo'], [MSG_SESION, 'sesion']]);
const TRANSITORIOS = new Set(['red', 'tiempo', 'ocupado']);

// Error con texto listo para mostrar. motivo = la razón que da el servicio de acceso cuando la hay ('empresa_desconocida', 'empresa_no_habilitada', 'sin_acceso_empresa'...)
// hint = la pista que manda el servidor cuando la hay (por ejemplo 'pin_actual' o 'cuentas_abiertas'); codigo = el código del error de la base ('P0001', 'PT401'...).
// Las pantallas deciden por estas dos y por tipo, no por el texto del mensaje.
export class ErrorApi extends Error {
  constructor(mensaje, { tipo = '', transitorio = false, estado = 0, sesion = false, motivo = '', hint = '', codigo = '' } = {}) {
    super(mensaje);
    this.tipo = tipo || TIPO_DE_MENSAJE.get(mensaje) || (sesion ? 'sesion' : transitorio ? 'ocupado' : 'negocio');
    this.transitorio = TRANSITORIOS.has(this.tipo);
    this.sesion = this.tipo === 'sesion' || sesion === true;
    this.estado = estado; this.motivo = motivo;
    this.hint = typeof hint === 'string' ? hint : '';
    this.codigo = typeof codigo === 'string' ? codigo : '';
  }
}
// Todo error de sesión que fabrica este archivo ya trae su clase (tipo 'sesion'), y un ErrorApi nuevo con el texto exacto de MSG_SESION la recupera: el texto del mensaje no se lee.
export const esSesionVencida = (e) => !!e && (e.sesion === true || e.tipo === 'sesion');
// Los textos propios del navegador cuando no hubo red («Failed to fetch», «Load failed») también cuentan como falla de red; los del sistema no se leen
const NATIVO_DE_RED = /failed to fetch|networkerror|load failed|network request failed/i;
export const esTransitorio = (e) => !!e && (e.transitorio === true || TRANSITORIOS.has(e.tipo) || (e instanceof TypeError && NATIVO_DE_RED.test(e.message || '')));
export const esErrorDeNegocio = (e) => !!e && e.tipo === 'negocio';
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

// Clasifica la respuesta de PostgREST con su estado HTTP y su código. escribe = la llamada cambia datos.
// Devuelve { tipo, mensaje }. Un error de negocio conserva el texto del sistema si lo escribió una función nuestra (código P0001 o PT4xx, ya en español);
// cualquier otro texto técnico de la base («duplicate key», «invalid input syntax», «Could not find the function») se cambia por una frase que diga qué hacer.
const CODIGO_NUESTRO = /^(P0001|PT[1-4]\d\d)$/;
function clasificarFalla(error, estado, escribe) {
  const m = String(error?.message || '');
  const codigo = String(error?.code || '');
  if (CODIGO_NUESTRO.test(codigo)) return { tipo: 'negocio', mensaje: m || MSG_GENERICO }; // mande el estado HTTP que mande: es una respuesta del negocio
  if (/AbortError|aborted/i.test(m) || codigo === '57014' || /canceling statement|statement timeout/i.test(m)) return { tipo: 'tiempo', mensaje: escribe ? MSG_TARDO_ESCRIBIR : MSG_TARDO };
  if (!estado) return { tipo: 'red', mensaje: escribe ? MSG_RED_ESCRIBIR : MSG_RED }; // sin respuesta HTTP: no hubo conexión (postgrest-js deja status 0)
  if (estado === 504 || estado === 408 || estado === 502) return { tipo: 'tiempo', mensaje: escribe ? MSG_TARDO_ESCRIBIR : MSG_TARDO };
  if (estado >= 500 || estado === 429) return { tipo: 'ocupado', mensaje: MSG_OCUPADO };
  if (codigo === '42501' || estado === 403) return { tipo: 'negocio', mensaje: MSG_PERMISO };
  return { tipo: 'negocio', mensaje: MSG_GENERICO };
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
// La sesión no sirve cuando el servidor contesta 401 (token vencido, sesión cerrada o sin empresa: PT401, PGRST301). No se lee el texto del mensaje.
const esErrorSesion = (r) => r.status === 401 || /^(PGRST30[123]|PT401)$/.test(String(r.error?.code || ''));
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
const SOLO_LECTURA = /^fx_(contexto|catalogo|clientes|venta|ventas_abiertas|turno_estado|turno_sugerencia_apertura|movimientos_efectivo|turnos|salidas|comprobante|comprobantes|comprobante_nc|comprobante_saldos|comprobante_xml|listados2?|documentos|documentos_pagina|alertas|usuarios|recibidas?|respuesta_recibida|producto_historial|venta_reemplazo_info|nota_calcular|cabys_buscar|cabys_verificar)$/;

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
        if (est === 'vencida') { avisarSesionVencida(); return { ...r, error: { ...r.error, message: MSG_SESION, sesion: true, tipo: 'sesion' } }; }
        marcarRed(false);
        return { ...r, error: { ...r.error, message: lectura ? MSG_RED : MSG_RED_ESCRIBIR, transitorio: true, tipo: 'red' } };
      }
      // El token ya se renovó y el servidor lo sigue rechazando (por ejemplo una sesión vieja que no está atada a una empresa): no sirve más, hay que entrar de nuevo
      if (renovado && esErrorSesion(r)) { avisarSesionVencida(); return { ...r, error: { ...r.error, message: MSG_SESION, sesion: true, tipo: 'sesion' } }; }
      const { tipo, mensaje } = clasificarFalla(r.error, r.status, !lectura);
      // Un error de negocio vuelve tal cual, en el primer intento: ni se repite ni toca el aviso de «sin conexión». Su texto original queda en .tecnico por si hace falta en la consola.
      if (tipo === 'negocio') return { ...r, error: { ...r.error, message: mensaje, tecnico: r.error.message, tipo: 'negocio', transitorio: false } };
      if (tipo === 'red') marcarRed(false);
      if (lectura && intento < 2) { await pausa(700); continue; } // solo una consulta se repite sola; una escritura NUNCA
      return { ...r, error: { ...r.error, message: mensaje, tecnico: r.error.message, tipo, transitorio: true } };
    }
  } finally {
    if (cambia) invalidarCatalogo();
  }
}
sb.rpc = (nombre, args, opciones) => llamar(nombre, args, opciones);

// Llama a una función fx_* y devuelve los datos; si falla lanza ErrorApi con un texto listo para mostrar.
export async function rpc(nombre, args = {}) {
  const { data, error, status } = await sb.rpc(nombre, args);
  if (error) {
    if (error.tecnico && typeof console !== 'undefined') console.debug('[' + nombre + ']', error.tecnico);
    throw new ErrorApi(error.message || MSG_GENERICO, { tipo: error.tipo || '', estado: status || 0, sesion: error.sesion === true, hint: error.hint, codigo: error.code });
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

// RESPALDO TEMPORAL. Desde el acceso por empresa, la empresa sale de la sesión: el servidor (fx_contexto) devuelve solo la empresa a la que está atada la sesión
// y `empresa_sesion` trae su id. Mientras el servicio de acceso nuevo no esté puesto en marcha, las sesiones no tienen empresa y fx_contexto devuelve todas;
// en ese caso (y solo en ese caso) se deja únicamente a los locales de esta lista. Cuando el servidor ya ate todas las sesiones, esta lista deja de usarse.
export const LOCALES_EN_PRUEBA = ['pollos'];
const soloLocalesEnPrueba = (c) => {
  if (!c || !Array.isArray(c.sociedades) || c.empresa_sesion) return c; // con empresa de sesión el servidor ya filtró
  const sociedades = c.sociedades.filter((s) => LOCALES_EN_PRUEBA.includes(String(s.codigo ?? '').toLowerCase()));
  return sociedades.length ? { ...c, sociedades } : c;
};

export const api = {
  // Inicio
  contexto: () => rpc('fx_contexto').then(soloLocalesEnPrueba), // {usuario,nombre,admin,debe_cambiar_pin,empresa_sesion (id de la empresa de la sesión, o null),sociedades:[{id,codigo,nombre,nombre_comercial,cedula,ambiente,correo,telefono,provincia,canton,distrito,otras_senas,terminales:[{sucursal,terminal,nombre}],turno|null}]}
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
  // Con cuánto abrir la caja: { sugerido, origen, ultimo_cierre: { cerrado_en, ... } } según el último cierre de ESA terminal. Es una consulta (se repite sola una vez).
  turnoSugerencia: (soc, terminal = 1) => rpc('fx_turno_sugerencia_apertura', { p_soc: soc, p_terminal: terminal }),
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
// Cada llamada tiene un tiempo máximo, igual que llamar() (25 s lectura, 45 s escritura) para las consultas a la base: si la conexión queda abierta sin respuesta, la pantalla no se queda
// esperando para siempre con el botón apagado. Pasado el tiempo sale un error de clase 'tiempo' y NO se repite sola: la función pudo haber hecho su trabajo (mandar un correo,
// responder a Hacienda), así que el texto pide revisar antes de volver a intentarlo. Las consultas puras (la cédula) usan el texto de lectura.
const TOPE_FUNCION = 60000;
const TOPE_FUNCION_DE = { 'facturador-cedula': 20000, 'facturas-recibidas': 120000 }; // la cédula espera lo que tarda Hacienda; revisar el correo puede traer muchas facturas
const FUNCION_DE_LECTURA = new Set(['facturador-cedula']);
async function pedirFuncion(nombre, cuerpo, opciones, token) {
  const ctrl = new AbortController();
  let agotado = false;
  const reloj = setTimeout(() => { agotado = true; ctrl.abort(); }, TOPE_FUNCION_DE[nombre] || TOPE_FUNCION);
  const cancelar = () => ctrl.abort();
  if (opciones.signal) { if (opciones.signal.aborted) ctrl.abort(); else opciones.signal.addEventListener('abort', cancelar, { once: true }); }
  try {
    const r = await fetch(`${SUPA_URL}/functions/v1/${nombre}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPA_KEY, Authorization: 'Bearer ' + (token || SUPA_KEY) },
      body: JSON.stringify(cuerpo),
      signal: ctrl.signal,
    });
    return { r, t: await r.text() }; // el tiempo máximo cubre también la lectura de la respuesta
  } catch (e) {
    if (agotado) throw new ErrorApi(FUNCION_DE_LECTURA.has(nombre) ? MSG_TARDO : MSG_TARDO_ESCRIBIR, { tipo: 'tiempo' });
    if (e?.name === 'AbortError') throw e; // cancelado a propósito por quien llamó
    marcarRed(false);
    throw new ErrorApi(MSG_RED, { tipo: 'red' });
  } finally {
    clearTimeout(reloj);
    opciones.signal?.removeEventListener('abort', cancelar);
  }
}
export async function funcion(nombre, cuerpo = {}, opciones = {}) {
  let renovado = false;
  for (;;) {
    const { data: s } = await sb.auth.getSession();
    const { r, t } = await pedirFuncion(nombre, cuerpo, opciones, s.session?.access_token);
    marcarRed(true);
    if (r.status === 401 && !renovado) { // el token no sirvió: se renueva una vez y se repite (la función rechazó la llamada sin hacer nada)
      renovado = true;
      const est = await renovarSesion();
      if (est === 'ok') continue;
      if (est === 'vencida') { avisarSesionVencida(); throw new ErrorApi(MSG_SESION, { sesion: true, estado: 401 }); }
      throw new ErrorApi(MSG_RED, { tipo: 'red' });
    }
    let j; try { j = JSON.parse(t); } catch { j = null; } // una página de error de la puerta de entrada no es un mensaje para la cajera
    if (!r.ok || j?.error) {
      const tipo = r.status === 504 || r.status === 408 ? 'tiempo' : r.status === 502 || r.status === 503 ? 'ocupado' : 'negocio';
      const propio = j && typeof j.error === 'string' && j.error.trim(); // el texto lo escribió la función de borde, ya en español
      throw new ErrorApi(propio || (tipo === 'tiempo' ? MSG_TARDO : tipo === 'ocupado' ? MSG_OCUPADO : MSG_ACCION_FALLIDA), { tipo, estado: r.status, hint: j && typeof j.hint === 'string' ? j.hint : '' });
    }
    return j || {};
  }
}

/* ---------- Acceso por empresa ---------- */
// Código de empresa como lo escribe la persona: sin importar mayúsculas, tildes ni espacios ("Pollós", " POLLOS " y "po llos" son "pollos"). Igual que en el servidor.
export const normalizarEmpresa = (v) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, '').slice(0, 60);

// Un intento al servicio de acceso (facturador-acceso): máximo 20 segundos. Devuelve la respuesta y su cuerpo ya leído (j es null si no era JSON).
async function intentoAcceso(cuerpo) {
  const ctrl = new AbortController();
  const reloj = setTimeout(() => ctrl.abort(), 20000);
  try {
    let r;
    try {
      r = await fetch(`${SUPA_URL}/functions/v1/facturador-acceso`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPA_KEY }, body: JSON.stringify(cuerpo), signal: ctrl.signal });
    } catch (e) {
      throw new ErrorApi(e?.name === 'AbortError' ? MSG_ACCESO_TARDO : MSG_RED, { tipo: e?.name === 'AbortError' ? 'tiempo' : 'red' });
    }
    let j = null;
    try { j = JSON.parse(await r.text()); } catch { j = null; }
    return { r, j };
  } finally { clearTimeout(reloj); }
}
// Si el servicio no respondió (red, arranque en frío, 5xx) se repite UNA vez solo. Un PIN o un usuario que no coinciden (401) NO se repiten solos: la persona los corrige.
// alReintentar() avisa a la pantalla para mostrar "Reintentando…".
async function conReintento(hacer, alReintentar) {
  let ultimo;
  for (let intento = 1; intento <= 2; intento++) {
    try { return await hacer(); }
    catch (e) {
      ultimo = e;
      // Un 429 es el servicio pidiendo que no se le insista: no se repite solo (un toque del último número no manda el PIN dos veces)
      if (!(e instanceof ErrorApi) || !e.transitorio || e.estado === 429 || intento === 2) break;
      alReintentar?.();
      await pausa(900);
    }
  }
  throw ultimo instanceof Error && ultimo.message ? ultimo : new ErrorApi('No se pudo entrar. Intente de nuevo.');
}
// El estado que se anota en el error: el del servidor; si contestó 200 con ok:false, el que corresponde al motivo (así un rechazo esperado nunca se toma por una falla)
const ESTADO_DE_MOTIVO = { falta_empresa: 400, empresa_desconocida: 404, empresa_no_habilitada: 403 };
// El ingreso NUNCA se bloquea (decisión de Emil): no hay «intentos restantes», ni hora de desbloqueo, ni espera. Un PIN o un usuario que no coinciden dicen eso y se puede intentar de inmediato.
// Un 5xx o un 429 del servicio (saturado) es una falla transitoria; todo lo demás es una respuesta clara del acceso y no se repite sola.
// Un 429 sigue siendo transitorio (en el primer paso deja usar la empresa de respaldo, así nadie queda sin poder llegar al usuario y al PIN) pero conReintento no lo repite
// y su texto no promete una espera: dice que hay mucho movimiento y que se puede intentar otra vez.
const MSG_EMPRESA_DESCONOCIDA = 'No se reconoce ese código de empresa. Revíselo e intente de nuevo.';
const MSG_ACCESO_MUCHOS = 'Hay mucho movimiento en este momento y no se pudo entrar. Intente de nuevo; si sigue igual, avise a la persona encargada.';
function errorDeAcceso(r, j) {
  const estado = r.ok ? (ESTADO_DE_MOTIVO[j.motivo] || 400) : r.status;
  const motivo = j.motivo || '';
  if (r.status === 429) return new ErrorApi(MSG_ACCESO_MUCHOS, { tipo: 'ocupado', estado, motivo });
  if (r.status >= 500) return new ErrorApi(MSG_OCUPADO, { tipo: 'ocupado', estado, motivo });
  if (motivo === 'empresa_desconocida') return new ErrorApi(MSG_EMPRESA_DESCONOCIDA, { tipo: 'negocio', estado, motivo });
  return new ErrorApi(typeof j.error === 'string' && j.error.trim() ? j.error : 'No se pudo entrar. Intente de nuevo.', { tipo: 'negocio', estado, motivo });
}
const sinRespuestaClara = (r, j) => !j || typeof j.ok !== 'boolean';
const MSG_SIN_RESPUESTA = (r) => { console.debug('[acceso] respuesta sin cuerpo claro, estado ' + r.status); return new ErrorApi('No se pudo entrar en este momento. Intente de nuevo en unos segundos.', { tipo: 'ocupado', estado: r.status }); };

// RESPALDO: la tabla de empresas conocidas de este aparato. SOLO se usa cuando no hay red o el servicio de acceso no responde (sin respuesta, error del servidor o una respuesta
// que no se entiende, como la del servicio viejo que no conocía los códigos de empresa). Cuando el servicio contesta con claridad (empresa reconocida, desconocida o no habilitada) manda el servicio.
const EMPRESAS_RESPALDO = {
  pollos: { codigo: 'pollos', codigo_acceso: 'pollos', nombre_comercial: 'Pollos La Bomba', cedula: '3102111943', cedula_tipo: '02' },
  soda: { codigo: 'soda', codigo_acceso: 'soda', nombre_comercial: 'Soda La Bomba', cedula: '3102765594', cedula_tipo: '02' },
};
function empresaDeRespaldo(codigo) {
  const e = EMPRESAS_RESPALDO[codigo];
  if (!e) throw new ErrorApi(MSG_EMPRESA_DESCONOCIDA, { tipo: 'negocio', estado: 404, motivo: 'empresa_desconocida' });
  if (!LOCALES_EN_PRUEBA.includes(e.codigo)) throw new ErrorApi(`${e.nombre_comercial} todavía no está habilitada en este facturador. Por ahora sigue con Prisma.`, { tipo: 'negocio', estado: 403, motivo: 'empresa_no_habilitada' });
  return { ...e, respaldo: true };
}

// Primer paso de la entrada: ¿existe esa empresa y está habilitada? Se lo pregunta al servicio de acceso ({ accion: 'empresa', empresa }) y devuelve
// { codigo, codigo_acceso, nombre, nombre_comercial, cedula, cedula_tipo }. Si el servicio dice que no, lanza un ErrorApi con motivo 'empresa_desconocida'
// («No se reconoce ese código de empresa. Revíselo e intente de nuevo.») o 'empresa_no_habilitada' (el texto lo da el servidor). Solo si no hay red o el servicio no responde se usa el respaldo.
export async function consultarEmpresa(escrito, { alReintentar } = {}) {
  const codigo = normalizarEmpresa(escrito);
  if (!codigo) throw new ErrorApi('Escriba el código de su empresa, por ejemplo pollos.', { estado: 400, motivo: 'falta_empresa' });
  try {
    return await conReintento(async () => {
      const { r, j } = await intentoAcceso({ accion: 'empresa', empresa: codigo });
      if (j && j.ok === true && j.empresa) return { ...j.empresa, codigo_acceso: j.empresa.codigo_acceso || j.empresa.codigo || codigo };
      if (j && j.ok === false && j.motivo) throw errorDeAcceso(r, j); // el servicio contestó con claridad: se dice lo que dijo
      throw MSG_SIN_RESPUESTA(r); // sin cuerpo claro (servicio viejo, error del servidor, otra cosa): cuenta como «no respondió»
    }, alReintentar);
  } catch (e) {
    if (e instanceof ErrorApi && e.transitorio) return empresaDeRespaldo(codigo);
    throw e;
  }
}

// Inicio de sesión con código de empresa, usuario y PIN. La sesión que se abre queda atada a esa empresa en el servidor.
// Devuelve la respuesta del servicio: { ok, nombre, debe_cambiar_pin, empresa?: { id, codigo, codigo_acceso, nombre, nombre_comercial, cedula, ambiente } }.
// `empresa` puede faltar mientras el servicio de acceso nuevo no esté en marcha: quien llama usa la empresa que ya reconoció en el primer paso.
export async function entrar(empresa, usuario, pin, { alReintentar } = {}) {
  return conReintento(async () => {
    const { r, j } = await intentoAcceso({ empresa: normalizarEmpresa(empresa), usuario, pin });
    if (sinRespuestaClara(r, j)) throw MSG_SIN_RESPUESTA(r);
    if (!j.ok) throw errorDeAcceso(r, j);
    const { error } = await sb.auth.setSession({ access_token: j.access_token, refresh_token: j.refresh_token });
    if (error) throw new ErrorApi('No se pudo abrir la sesión. Intente de nuevo.', { tipo: 'ocupado' });
    sesionRestaurada();
    reintentarSalidas(); // si un cierre de sesión anterior no llegó al servidor, se repite ahora que hay conexión
    return j;
  }, alReintentar);
}
// Cierre de sesión limpio: UNA sola llamada al servidor, que cierra solo la sesión de ESTE aparato (scope 'local'; el celular y la tableta
// del mismo usuario siguen abiertos). El servidor además invalida ese token (fx_chk exige una sesión viva), así que el token viejo ya no sirve.
// Si no hay conexión la llamada falla: entonces se borra la sesión guardada en este aparato a mano (la pantalla nunca queda "medio abierta") y el cierre
// que faltó en el servidor se anota en una cola corta para repetirlo apenas haya conexión (ver «Cierres de sesión pendientes»).
export async function salir() {
  const guardada = sesionGuardada();
  let faltoCerrar = false;
  try {
    const res = await Promise.race([sb.auth.signOut({ scope: 'local' }), pausa(4000).then(() => ({ error: true }))]);
    faltoCerrar = !!res?.error; // sin conexión, error del servidor o tiempo agotado; un 401/403/404 no cuenta: esa sesión ya no existe
  } catch { faltoCerrar = true; /* sin conexión: se borra solo aquí */ }
  // Solo se anota el código de acceso (y la hora): el código de refresco NO se guarda, porque serviría para pedir sesiones nuevas mientras el cierre no llegue al servidor.
  // Si el de acceso ya venció cuando vuelva la conexión, esa sesión queda sin nadie que pueda renovarla y se cierra sola por su tope del servidor.
  if (faltoCerrar && guardada) { guardarSalidas([...leerSalidas().filter((x) => x.a !== guardada.a), { a: guardada.a, t: Date.now() }]); vigilarSalidas(); }
  try { localStorage.removeItem('sb-facturador'); localStorage.removeItem('sb-facturador-code-verifier'); } catch { /* sin almacenamiento */ }
  invalidarCatalogo();
  sesionAvisada = false;
}

/* ---------- Cierres de sesión pendientes ---------- */
// Cuando el cierre de sesión no llega al servidor (sin internet, servidor caído o tiempo agotado), la sesión de ESTE aparato se borra igual, pero la del servidor sigue viva
// hasta su tope de 16 horas. Para no dejarla abierta, el cierre se anota en una cola corta de este aparato (máximo 3 anotaciones, que se descartan a las 16 horas) y se repite
// cuando vuelve la conexión, al abrir la página, después de entrar y cada minuto mientras haya algo pendiente. De cada sesión solo se anota su código de acceso y la hora
// (nunca el de refresco: ese sí serviría para pedir sesiones nuevas); se borra apenas el servidor confirma (o contesta que esa sesión ya no existe).
// El código de acceso dura poco y solo sirve para cerrar esa sesión. Una anotación vieja de versiones anteriores puede traer también el de refresco: se usa una vez para
// renovar y cerrar, y desaparece con el resto.
const CLAVE_SALIDAS = 'fx_salidas_pendientes', MAX_SALIDAS = 3, VIDA_SALIDA = 16 * 3600 * 1000;
function sesionGuardada() {
  try { const g = JSON.parse(localStorage.getItem('sb-facturador') || 'null'); return g && typeof g.access_token === 'string' ? { a: g.access_token, r: typeof g.refresh_token === 'string' ? g.refresh_token : '' } : null; } catch { return null; }
}
function leerSalidas() {
  try {
    const l = JSON.parse(localStorage.getItem(CLAVE_SALIDAS) || '[]');
    return (Array.isArray(l) ? l : []).filter((x) => x && typeof x.a === 'string' && typeof x.t === 'number' && Math.abs(Date.now() - x.t) < VIDA_SALIDA).slice(-MAX_SALIDAS);
  } catch { return []; }
}
function guardarSalidas(l) {
  try { if (l.length) localStorage.setItem(CLAVE_SALIDAS, JSON.stringify(l.slice(-MAX_SALIDAS))); else localStorage.removeItem(CLAVE_SALIDAS); } catch { /* sin almacenamiento: no hay cola */ }
}
// true = ya no hay nada que cerrar (el servidor lo cerró o ya no existe esa sesión); false = no se pudo hablar con el servidor, se intenta después
async function cerrarEnServidor(x) {
  const ctrl = new AbortController();
  const reloj = setTimeout(() => ctrl.abort(), 10000);
  const pedir = (ruta, cab, cuerpo) => fetch(`${SUPA_URL}/auth/v1/${ruta}`, { method: 'POST', headers: { apikey: SUPA_KEY, 'Content-Type': 'application/json', ...cab }, body: cuerpo, signal: ctrl.signal });
  const sigue = (r) => r.status >= 500 || r.status === 429 || r.status === 408;
  try {
    let r = await pedir('logout?scope=local', { Authorization: 'Bearer ' + x.a });
    if (r.status === 401 && x.r) { // el código de acceso ya venció: se renueva con el de refresco y se cierra esa sesión
      const t = await pedir('token?grant_type=refresh_token', {}, JSON.stringify({ refresh_token: x.r }));
      if (!t.ok) return !sigue(t); // 400 o parecido: esa sesión ya no existe
      const n = await t.json().catch(() => null);
      if (!n?.access_token) return false;
      x.a = n.access_token; x.r = n.refresh_token || ''; // el de refresco cambia en cada renovación: se anota el nuevo por si este cierre tampoco llega
      guardarSalidas(leerSalidas().map((y) => (y.t === x.t ? x : y)));
      r = await pedir('logout?scope=local', { Authorization: 'Bearer ' + x.a });
    }
    return !sigue(r);
  } catch { return false; } finally { clearTimeout(reloj); }
}
let salidasEnCurso = false, relojSalidas = null;
export async function reintentarSalidas() {
  if (salidasEnCurso || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
  const cola = leerSalidas();
  if (!cola.length) { guardarSalidas([]); return; }
  salidasEnCurso = true;
  try {
    for (const x of cola) {
      if (!(await cerrarEnServidor(x))) break; // sin conexión: no vale la pena probar con las demás
      guardarSalidas(leerSalidas().filter((y) => y.t !== x.t));
    }
  } finally { salidasEnCurso = false; }
}
function vigilarSalidas() {
  if (relojSalidas || !leerSalidas().length) return;
  relojSalidas = setInterval(async () => {
    await reintentarSalidas();
    if (!leerSalidas().length) { clearInterval(relojSalidas); relojSalidas = null; }
  }, 60000);
}
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => reintentarSalidas());
  document.addEventListener('app:red', (e) => { if (e.detail?.ok) reintentarSalidas(); });
  setTimeout(() => { reintentarSalidas(); vigilarSalidas(); }, 1500); // al abrir la página
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
