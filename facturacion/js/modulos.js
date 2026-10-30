// Registro de MÓDULOS del facturador. El inicio, la pantalla de Administración y el enrutador (main.js) se arman SOLO a partir de esta lista.
//
// CÓMO SE AGREGA UN MÓDULO NUEVO (por ejemplo Inventarios):
//   1. Crear js/m_inventarios.js con `export default { id: 'inventarios', titulo: 'Inventarios', async mount(root, app) { ...; return () => limpieza } }`.
//   2. Agregar UNA línea en la lista de abajo, por ejemplo:
//        { id: 'inventarios', titulo: 'Inventarios', descripcion: 'Existencias, entradas y salidas', grupo: 'admin', ruta: 'admin/inventarios', icono: 'producto', orden: 50, cargar: () => import('./m_inventarios.js') },
//      grupo 'principal' = tarjeta en el inicio; grupo 'admin' = tarjeta dentro de Administración.
//      (icono: uno de los dibujos de ui_inicio.js; si hace falta uno nuevo se agrega ahí en una línea. Sin dibujo se usa el de «producto».)
//   Con eso aparece la tarjeta, la ventana con su barra «‹ Inicio» o «‹ Administración», la dirección #admin/inventarios, el botón Atrás y la recarga en el mismo lugar.
//
// Campos de cada módulo:
//   id            nombre corto y fijo (otros módulos lo usan en app.ir('caja'); no se cambia). `alias`: otros ids que llevan al mismo módulo.
//   titulo        el nombre que se lee en la tarjeta y en la barra de la ventana
//   descripcion   UNA línea que explica para qué sirve
//   grupo         'principal' (inicio) o 'admin' (dentro de Administración)
//   ruta          lo que va después del # en la dirección
//   cargar        import dinámico del archivo del módulo (default export con mount)
//   icono         nombre del dibujo de línea fina (ver ui_inicio.js)
//   orden         posición dentro de su grupo
//   insignia(app) opcional: devuelve null, un texto («1 por responder») o { texto, urgente } para mostrar en la tarjeta sin entrar
//   soloAdmin     opcional: solo para administradores. A quien no lo es (el cajero) la tarjeta NO le aparece (no sale en gris) y, si escribe la dirección a mano, vuelve al inicio.
//                 TODO el grupo «admin» y la pantalla de Administración llevan soloAdmin: la persona de caja ve solo Facturación, Anular y reimprimir, Clientes y Apertura y cierre de caja.
//                 Ocultar la tarjeta no protege los datos: la base de datos exige además el permiso de administrador en las funciones de estos módulos.
//   destacado     opcional: tarjeta roja (la acción principal)
//   pantalla      opcional: en lugar de `cargar`, una pantalla que arma main.js con los módulos del grupo (solo 'admin')

// Texto de la insignia de Contable (facturas recibidas por responder, las que vencen pronto y las que ya vencieron), con la cifra que traen fx_alertas o Recepción.
// Sigue visible cuando todo lo pendiente ya venció; «vencidas» (plazo ya pasado, llegaron en los últimos 25 días) se distingue de «vencen pronto» (2 días hábiles o menos).
function insigniaContable(app) {
  const c = app.recepcion;
  const n = Math.max(0, Number(c?.pendientes_en_plazo ?? 0) || 0), venc = Math.max(0, Number(c?.vencidas ?? 0) || 0);
  if (!(n > 0) && !(venc > 0)) return null;
  const v = Math.min(n, Math.max(0, Number(c?.vencen_pronto ?? 0) || 0));
  const partes = [n > 0 ? n + ' por responder' : '', v > 0 ? v + (v === 1 ? ' vence pronto' : ' vencen pronto') : '', venc > 0 ? venc + (venc === 1 ? ' vencida' : ' vencidas') : ''].filter(Boolean);
  return { texto: partes.join(' · '), urgente: v > 0 || venc > 0 };
}
// Insignia de Inventarios, con la cifra de fx_inv_alertas_resumen (main.js la pide junto con los avisos, sin cargar el módulo): «2 vencidos · 14 por recibir». Roja si hay vencidos.
function insigniaInventarios(app) {
  const r = app.inventario, n = (k) => Math.max(0, Number(r?.[k] ?? 0) || 0);
  const partes = [n('vencidos') ? n('vencidos') + (n('vencidos') === 1 ? ' vencido' : ' vencidos') : '', n('por_recibir') ? n('por_recibir') + ' por recibir' : '',
    n('vencen_pronto') ? n('vencen_pronto') + ' vencen pronto' : '', n('bajo_minimo') ? n('bajo_minimo') + ' bajo el mínimo' : ''].filter(Boolean);
  return partes.length ? { texto: partes.slice(0, 2).join(' · '), urgente: !!r?.urgente || n('vencidos') > 0 } : null;
}
// Insignias de los dos módulos solo para administradores. main.js (avisos_admin.js) llena app.respaldo y app.seguridad junto con los avisos del encabezado.
// Respaldos: «1 aviso», roja si es urgente. Usuarios: avisos de ingreso sin atender (muchos intentos fallidos de PIN), siempre rojos.
function insigniaRespaldos(app) {
  const r = app.respaldo, n = Math.max(0, Number(r?.problemas ?? 0) || 0);
  return n > 0 ? { texto: n === 1 ? '1 aviso' : n + ' avisos', urgente: !!r.urgente } : null;
}
function insigniaUsuarios(app) {
  const n = Math.max(0, Number(app.seguridad?.pendientes ?? 0) || 0);
  return n > 0 ? { texto: n === 1 ? '1 aviso de ingreso' : n + ' avisos de ingreso', urgente: true } : null;
}

export const MODULOS = [
  // Inicio: los cinco módulos principales, en este orden (3 arriba y 2 más anchos abajo en pantalla ancha; una columna en celular)
  { id: 'caja', emite: true, titulo: 'Facturación', descripcion: 'Cobrar una venta, cuentas en espera, para llevar y express', grupo: 'principal', ruta: 'facturar', icono: 'facturar', orden: 10, destacado: true, cargar: () => import('./m_caja.js') },
  { id: 'anular', emite: true, alias: ['documentos'], titulo: 'Anular y reimprimir', descripcion: 'Anular una factura o tiquete, o volver a imprimirlo', grupo: 'principal', ruta: 'anular', icono: 'impresora', orden: 20, cargar: () => import('./m_documentos.js') },
  { id: 'clientes', titulo: 'Clientes', descripcion: 'Buscar, agregar o corregir clientes', grupo: 'principal', ruta: 'clientes', icono: 'personas', orden: 30, cargar: () => import('./m_clientes.js') },
  { id: 'turno', emite: true, alias: ['admin/cierre', 'cierre'], titulo: 'Apertura y cierre de caja', descripcion: 'Abrir la caja, contar el efectivo y cerrar el turno', grupo: 'principal', ruta: 'turno', icono: 'caja', orden: 40, cargar: () => import('./m_turno.js') },
  // Administración: su descripción sale de los módulos del grupo «admin» y su insignia es la primera que tenga alguno de ellos
  { id: 'admin', titulo: 'Administración', grupo: 'principal', ruta: 'admin', icono: 'ajustes', orden: 50, soloAdmin: true, pantalla: 'admin' },
  // Dentro de Administración
  { id: 'productos', titulo: 'Productos', descripcion: 'Menú, precios, cajones de productos y CABYS', grupo: 'admin', ruta: 'admin/productos', icono: 'producto', orden: 10, soloAdmin: true, cargar: () => import('./m_productos.js') },
  { id: 'listados', titulo: 'Informes', descripcion: 'Ventas por hora y por día, por tarifa de IVA y por medio de pago', grupo: 'admin', ruta: 'admin/informes', icono: 'barras', orden: 20, soloAdmin: true, cargar: () => import('./m_listados.js') },
  { id: 'emitidas', alias: ['facturas-emitidas'], titulo: 'Facturas emitidas', descripcion: 'Buscar facturas y tiquetes de cualquier fecha y ver si Hacienda los aceptó', grupo: 'admin', ruta: 'admin/facturas-emitidas', icono: 'emitidas', orden: 25, soloAdmin: true, cargar: () => import('./m_facturas_emitidas.js') },
  { id: 'recepcion', titulo: 'Contable', descripcion: 'Facturas de proveedores y respuesta a Hacienda', grupo: 'admin', ruta: 'admin/contable', icono: 'libro', orden: 30, soloAdmin: true, insignia: insigniaContable, cargar: () => import('./m_recepcion.js') },
  { id: 'inventarios', titulo: 'Inventarios', descripcion: 'Bodega central y locales: lo que entra, lo que sale y lo que vence', grupo: 'admin', ruta: 'admin/inventarios', icono: 'bodega', orden: 35, soloAdmin: true, insignia: insigniaInventarios, cargar: () => import('./m_inventarios.js') },
  { id: 'usuarios', titulo: 'Usuarios', descripcion: 'Usuarios, PIN y quién ingresó', grupo: 'admin', ruta: 'admin/usuarios', icono: 'usuario', orden: 40, soloAdmin: true, insignia: insigniaUsuarios, cargar: () => import('./m_usuarios.js') },
  { id: 'numeracion', titulo: 'Numeración', descripcion: 'En qué modo está el sistema, qué número sigue y qué falta para facturar de verdad', grupo: 'admin', ruta: 'admin/numeracion', icono: 'numeracion', orden: 45, soloAdmin: true, cargar: () => import('./m_numeracion.js') },
  { id: 'avisos', titulo: 'Avisos', descripcion: 'Quién recibe los avisos de efectivo por WhatsApp y cómo van', grupo: 'admin', ruta: 'admin/avisos', icono: 'aviso', orden: 47, soloAdmin: true, cargar: () => import('./m_avisos.js') },
  { id: 'respaldos', titulo: 'Respaldos', descripcion: 'Estado de las copias de seguridad y de la última prueba', grupo: 'admin', ruta: 'admin/respaldos', icono: 'respaldo', orden: 50, soloAdmin: true, insignia: insigniaRespaldos, cargar: () => import('./m_respaldos.js') },
];

/* ---------- Consultas sobre el registro (las usa main.js) ---------- */
const PADRE = { principal: 'inicio', admin: 'admin' };
const ordenados = (l) => l.slice().sort((a, b) => (a.orden || 0) - (b.orden || 0));
export const modulosDe = (grupo, app) => ordenados(MODULOS.filter((m) => m.grupo === grupo && (!m.soloAdmin || !app || app.admin)));
export const hayModulo = (idORuta) => buscar(idORuta);
export function buscar(clave) {
  const k = String(clave ?? '').replace(/^#\/?/, '').toLowerCase();
  if (!k) return null;
  return MODULOS.find((m) => m.id === k || m.ruta === k || (m.alias || []).includes(k)) || null;
}
// A dónde regresa la barra «‹» de un módulo: 'inicio' o la pantalla de Administración
export const padreDe = (m) => (m ? PADRE[m.grupo] || 'inicio' : 'inicio');
export const tituloPadre = (m) => (padreDe(m) === 'admin' ? 'Administración' : 'Inicio');
// Insignia de una tarjeta, siempre como { texto, urgente } o null. La tarjeta de una pantalla (Administración) toma la de sus módulos; la urgente tiene prioridad.
export function insigniaDe(m, app) {
  let r = null;
  if (m.pantalla === 'admin') {
    const todas = modulosDe('admin', app).map((x) => insigniaDe(x, app)).filter(Boolean);
    r = todas.find((x) => x.urgente) || todas[0] || null;
  } else if (typeof m.insignia === 'function') {
    try { r = m.insignia(app); } catch { r = null; }
  }
  if (r == null || r === '' || r === 0) return null;
  return typeof r === 'object' ? r : { texto: String(r), urgente: false };
}
// «Cierre de caja, productos, informes, contable y usuarios»
export function descripcionDe(m, app) {
  if (m.pantalla === 'admin') {
    const t = modulosDe('admin', app).map((x, i) => (i === 0 ? x.titulo : x.titulo.charAt(0).toLowerCase() + x.titulo.slice(1)));
    return t.length > 1 ? t.slice(0, -1).join(', ') + ' y ' + t[t.length - 1] : t.join('');
  }
  // Empresa «solo recepción» (hoy Soda): Facturar no está habilitado aquí, y la tarjeta lo dice sin entrar
  if (m.emite && app?.soc?.puede_emitir === false) return 'No disponible en esta empresa';
  return m.descripcion || '';
}
