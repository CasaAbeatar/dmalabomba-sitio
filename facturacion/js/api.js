// Capa de acceso a datos del facturador. Todo pasa por funciones fx_* de Supabase (revisan que el usuario tenga acceso al panel).
export const SUPA_URL = 'https://dwlbcbtwdungyrykgahm.supabase.co';
export const SUPA_KEY = 'sb_publishable_gUoYvCNka0je2rbNeWPpUA_l26vgQbO'; // clave pública; el acceso real lo controlan sesión y funciones
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

// Sesión propia del facturador (usuario + PIN), separada de la del panel
export const sb = createClient(SUPA_URL, SUPA_KEY, { auth: { storageKey: 'sb-facturador', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });

export class ErrorApi extends Error {}

async function rpc(nombre, args = {}) {
  const { data, error } = await sb.rpc(nombre, args);
  if (error) {
    let m = error.message || 'Error desconocido';
    if (/JWT|expired|not authenticated/i.test(m)) m = 'Su sesión venció. Recargue la página e ingrese de nuevo.';
    throw new ErrorApi(m);
  }
  return data;
}

export const api = {
  // Inicio
  contexto: () => rpc('fx_contexto'), // {usuario,nombre,admin,debe_cambiar_pin,sociedades:[{id,codigo,nombre,nombre_comercial,cedula,ambiente,correo,telefono,provincia,canton,distrito,otras_senas,terminales:[{sucursal,terminal,nombre}],turno|null}]}
  // Usuarios (PIN de 4 dígitos)
  usuarios: () => rpc('fx_usuarios'),
  usuarioGuardar: (p) => rpc('fx_usuario_guardar', { p }), // {id?, usuario, nombre, admin, activo, pin?}
  pinCambiar: (actual, nuevo) => rpc('fx_pin_cambiar', { p_actual: actual, p_nuevo: nuevo }),
  // Catálogo (productos y cajones). todos=true incluye inactivos (para administrar)
  catalogo: (soc, todos = false) => rpc('fx_catalogo', { p_soc: soc, p_todos: todos }),
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
  turnoCerrar: (turno, c) => rpc('fx_turno_cerrar', { p_turno: turno, p_efectivo: c.efectivo, p_notas: c.notas ?? null }),
  // Salidas de efectivo de la caja durante el turno (pagos a proveedor, vuelto de devolución, etc.)
  salidaRegistrar: (turno, monto, motivo) => rpc('fx_salida_registrar', { p_turno: turno, p_monto: monto, p_motivo: motivo }),
  salidaAnular: (id) => rpc('fx_salida_anular', { p_id: id }),
  salidas: (turno) => rpc('fx_salidas', { p_turno: turno }),
  turnos: (soc, limite = 30) => rpc('fx_turnos', { p_soc: soc, p_limite: limite }),
  // Ventas / cuentas
  ventaCrear: (soc, tipo = 'buffet', referencia = null, telefono = null, terminal = 1) => rpc('fx_venta_crear', { p_soc: soc, p_tipo: tipo, p_referencia: referencia, p_telefono: telefono, p_terminal: terminal }),
  venta: (id) => rpc('fx_venta', { p_venta: id }), // {venta, lineas[], pagos[], cliente, comprobante}
  ventasAbiertas: (soc) => rpc('fx_ventas_abiertas', { p_soc: soc }),
  ventaDatos: (id, d = {}) => rpc('fx_venta_datos', { p_venta: id, p_tipo: d.tipo ?? null, p_referencia: d.referencia ?? null, p_telefono: d.telefono ?? null, p_cliente: d.cliente ?? null, p_quitar_cliente: !!d.quitarCliente }),
  lineaAgregar: (venta, producto, cantidad = 1, precio = null, nota = null) => rpc('fx_linea_agregar', { p_venta: venta, p_producto: producto, p_cantidad: cantidad, p_precio: precio, p_nota: nota }),
  lineaEditar: (linea, c = {}) => rpc('fx_linea_editar', { p_linea: linea, p_cantidad: c.cantidad ?? null, p_precio: c.precio ?? null, p_nota: c.nota ?? null, p_descripcion: c.descripcion ?? null }),
  lineaQuitar: (linea) => rpc('fx_linea_quitar', { p_linea: linea }),
  ventaAnular: (id, motivo = null) => rpc('fx_venta_anular', { p_venta: id, p_motivo: motivo }),
  prefacturar: (id) => rpc('fx_prefacturar', { p_venta: id }),
  // Cobro: pagos = [{medio:'efectivo|tarjeta|sinpe|transferencia', monto, referencia?}] y su suma debe ser igual al total. Devuelve el comprobante completo (ver comprobante()).
  // actividad (opcional): código de actividad del cliente SOLO para esta factura ("5610.0"); queda en el snapshot del receptor y no cambia al cliente.
  cobrar: (venta, pagos, cliente = null, terminal = 1, actividad = null) => rpc('fx_cobrar', { p_venta: venta, p_pagos: pagos, p_cliente: cliente, p_terminal: terminal, p_actividad_receptor: actividad || null }),
  // Comprobantes
  comprobante: (id) => rpc('fx_comprobante', { p_id: id }), // incluye sociedad, venta, original, cliente_snapshot, lineas_snapshot, pagos_snapshot
  comprobantes: (soc, desde, hasta, q = '') => rpc('fx_comprobantes', { p_soc: soc, p_desde: desde, p_hasta: hasta, p_q: q }),
  xml: (id, cual = 'firmado') => rpc('fx_comprobante_xml', { p_id: id, p_cual: cual }), // 'firmado' | 'respuesta'
  reenviar: (id) => rpc('fx_reenviar', { p_id: id }),
  notaCredito: (id, motivo, terminal = 1) => rpc('fx_nota_credito', { p_id: id, p_motivo: motivo, p_terminal: terminal }),
  // Listados
  listados: (soc, desde, hasta) => rpc('fx_listados', { p_soc: soc, p_desde: desde, p_hasta: hasta }),
};

// Funciones de borde (edge functions) con la sesión del usuario
// opciones.signal (AbortSignal) permite cancelar la consulta si ya no hace falta (p. ej. la cajera siguió escribiendo).
export async function funcion(nombre, cuerpo = {}, opciones = {}) {
  const { data: s } = await sb.auth.getSession();
  const r = await fetch(`${SUPA_URL}/functions/v1/${nombre}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPA_KEY, Authorization: 'Bearer ' + (s.session?.access_token || SUPA_KEY) },
    body: JSON.stringify(cuerpo),
    signal: opciones.signal,
  });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = { error: t.slice(0, 200) }; }
  if (!r.ok || j.error) throw new ErrorApi(j.error || ('Error ' + r.status));
  return j;
}

// Inicio de sesión con usuario y PIN
export async function entrar(usuario, pin) {
  const r = await fetch(`${SUPA_URL}/functions/v1/facturador-acceso`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPA_KEY }, body: JSON.stringify({ usuario, pin }) });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new ErrorApi(j.error || 'No se pudo entrar. Intente de nuevo.');
  const { error } = await sb.auth.setSession({ access_token: j.access_token, refresh_token: j.refresh_token });
  if (error) throw new ErrorApi(error.message);
  return j;
}
export const salir = () => sb.auth.signOut();
