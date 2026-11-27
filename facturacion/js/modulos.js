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

import { sinpeActivo } from './bandera_sinpe.js';

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

// Alertas de Hacienda (solo administradores): cuántas siguen por atender. Roja si hay alguna urgente.
function insigniaAlertasHacienda(app) {
  const n = Math.max(0, Number(app.alertasHacienda?.abiertas ?? 0) || 0);
  return n > 0 ? { texto: n === 1 ? '1 por atender' : n + ' por atender', urgente: Number(app.alertasHacienda?.urgentes) > 0 } : null;
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
  { id: 'productos', titulo: 'Productos', descripcion: 'Lo que se vende: nombres, precios y los botones de la caja', grupo: 'admin', ruta: 'admin/productos', icono: 'producto', orden: 10, soloAdmin: true, cargar: () => import('./m_productos.js') },
  { id: 'listados', titulo: 'Informes', descripcion: 'Ventas por hora y por día, por tarifa de IVA y por medio de pago', grupo: 'admin', ruta: 'admin/informes', icono: 'barras', orden: 20, soloAdmin: true, cargar: () => import('./m_listados.js') },
  { id: 'semanal', alias: ['informe-semanal'], titulo: 'Informe semanal', descripcion: 'El informe de la semana con sus gráficos de planilla y costos, y el historial de semanas', grupo: 'admin', ruta: 'admin/informe-semanal', icono: 'barras', orden: 21, soloAdmin: true, cargar: () => import('./m_semanal.js') },
  { id: 'pago_sin_factura', alias: ['pago-sin-factura'], titulo: 'Pago sin factura', descripcion: 'Registrar lo pagado a quien no factura y emitir la factura electrónica de compra', grupo: 'admin', ruta: 'admin/pago-sin-factura', icono: 'libro', orden: 26, soloAdmin: true, cargar: () => import('./m_pago_sin_factura.js') },
  { id: 'cotizaciones', titulo: 'Cotizaciones', descripcion: 'Precios para un cliente: se mandan, se aceptan y pasan a Caja sin volver a escribirlas', grupo: 'admin', ruta: 'admin/cotizaciones', icono: 'libro', orden: 27, soloAdmin: true, cargar: () => import('./m_cotizaciones.js') },
  // SINPE Móvil confirmado por el banco: solo existe mientras la bandera fact.config «sinpe_tarjeta» esté encendida (requiere: 'sinpe')
  { id: 'sinpe', alias: ['pagos-sinpe'], titulo: 'Pagos SINPE', descripcion: 'SINPE Móvil que avisó el banco, tal como llegan, para consultar', grupo: 'admin', ruta: 'admin/pagos-sinpe', icono: 'caja', orden: 26.5, soloAdmin: true, requiere: 'sinpe', cargar: () => import('./m_sinpe.js') },
  // «Caja para mí»: el teléfono de los SINPE, SINPE sin factura, conciliación, informes y kit ↔ app. Solo administrador; no depende de la bandera de las cajeras. (27 nov 2026)
  { id: 'sinpe_caja', alias: ['caja-para-mi'], titulo: 'Caja para mí', descripcion: 'Mi teléfono de SINPE, lo que no tiene factura, la conciliación y los informes', grupo: 'admin', ruta: 'admin/caja-para-mi', icono: 'caja', orden: 26.6, soloAdmin: true, cargar: () => import('./m_sinpe_caja.js') },
  { id: 'recurrentes', alias: ['pedidos-fijos'], titulo: 'Pedidos fijos', descripcion: 'Clientes que piden lo mismo cada semana o cada mes: el sistema lo prepara y usted lo confirma', grupo: 'admin', ruta: 'admin/pedidos-fijos', icono: 'emitidas', orden: 27.5, soloAdmin: true, insignia: (app) => { const n = Number(app.recurrentes?.pendientes) || 0; return n > 0 ? { texto: n === 1 ? '1 por confirmar' : n + ' por confirmar', urgente: false } : null; }, cargar: () => import('./m_recurrentes.js') },
  { id: 'emitidas', alias: ['facturas-emitidas'], titulo: 'Facturas emitidas', descripcion: 'Buscar facturas y tiquetes de cualquier fecha y ver si Hacienda los aceptó', grupo: 'admin', ruta: 'admin/facturas-emitidas', icono: 'emitidas', orden: 25, soloAdmin: true, cargar: () => import('./m_facturas_emitidas.js') },
  { id: 'contabilidad', alias: ['recepcion', 'contable', 'admin/contable'], titulo: 'Contabilidad', descripcion: 'Facturas de proveedores y respuesta a Hacienda, cuentas, asientos, IVA, formularios y estados', grupo: 'admin', ruta: 'admin/contabilidad', icono: 'libro', orden: 30, soloAdmin: true, insignia: insigniaContable, cargar: () => import('./m_contabilidad.js') },
  { id: 'inventarios', titulo: 'Inventarios', descripcion: 'Bodega central y locales: lo que entra, lo que sale y lo que vence', grupo: 'admin', ruta: 'admin/inventarios', icono: 'bodega', orden: 35, soloAdmin: true, insignia: insigniaInventarios, cargar: () => import('./m_inventarios.js') },
  { id: 'bodega', titulo: 'Bodega', descripcion: 'Qué hay en cada local, mínimos propuestos, alertas de bajo mínimo y conteo físico', grupo: 'admin', ruta: 'admin/bodega', icono: 'bodega', orden: 36, soloAdmin: true, dentroDe: 'inventarios', cargar: () => import('./m_bodega.js') },
  { id: 'usuarios', titulo: 'Usuarios', descripcion: 'Las personas que usan el sistema, su clave y quién ingresó', grupo: 'admin', ruta: 'admin/usuarios', icono: 'usuario', orden: 40, soloAdmin: true, insignia: insigniaUsuarios, cargar: () => import('./m_usuarios.js') },
  { id: 'numeracion', titulo: 'Numeración', descripcion: 'En qué modo está el sistema, qué número sigue y qué falta para facturar de verdad', grupo: 'admin', ruta: 'admin/numeracion', icono: 'numeracion', orden: 45, soloAdmin: true, cargar: () => import('./m_numeracion.js') },
  { id: 'pantalla_cliente', alias: ['pantalla-cliente'], titulo: 'Pantalla del cliente', descripcion: 'Emparejar la pantalla que mira el cliente y manejar la publicidad que se muestra', grupo: 'admin', ruta: 'admin/pantalla-cliente', icono: 'aviso', orden: 45.5, soloAdmin: true, cargar: () => import('./m_pantalla_cliente.js') },
  { id: 'alertas_hacienda', alias: ['alertas-hacienda'], titulo: 'Alertas de Hacienda', descripcion: 'Rechazos, plazos y fallas con Hacienda: qué pasó y quién lo atendió', grupo: 'admin', ruta: 'admin/alertas-hacienda', icono: 'aviso', orden: 46, soloAdmin: true, insignia: insigniaAlertasHacienda, cargar: () => import('./m_alertas_hacienda.js') },
  { id: 'contingencia', titulo: 'Venta de contingencia', descripcion: 'Registrar lo cobrado con el talonario provisional cuando no hubo internet ni sistema', grupo: 'admin', ruta: 'admin/contingencia', icono: 'impresora', orden: 46.5, soloAdmin: true, cargar: () => import('./m_contingencia.js') },
  { id: 'avisos', titulo: 'Avisos de efectivo', descripcion: 'Quién recibe por WhatsApp el aviso cuando hay mucho efectivo en la caja, y si le llegó', grupo: 'admin', ruta: 'admin/avisos', icono: 'aviso', orden: 47, soloAdmin: true, cargar: () => import('./m_avisos.js') },
  { id: 'configuracion', titulo: 'Configuración', descripcion: 'La impresora de este aparato: papel, copias e impresión automática', grupo: 'admin', ruta: 'admin/configuracion', icono: 'impresora', orden: 55, soloAdmin: true, cargar: () => import('./m_configuracion.js') },
  { id: 'respaldos', titulo: 'Respaldos', descripcion: 'Estado de las copias de seguridad y de la última prueba', grupo: 'admin', ruta: 'admin/respaldos', icono: 'respaldo', orden: 50, soloAdmin: true, insignia: insigniaRespaldos, cargar: () => import('./m_respaldos.js') },
];

/* ---------- Consultas sobre el registro (las usa main.js) ---------- */
const PADRE = { principal: 'inicio', admin: 'admin' };
const ordenados = (l) => l.slice().sort((a, b) => (a.orden || 0) - (b.orden || 0));
// Un módulo con `requiere: 'sinpe'` solo existe con la bandera encendida; apagada (lo normal) no aparece en ninguna lista ni se abre por dirección
export const habilitado = (m) => !m || !m.requiere || (m.requiere === 'sinpe' && sinpeActivo());
export const modulosDe = (grupo, app) => ordenados(MODULOS.filter((m) => m.grupo === grupo && !m.dentroDe && (!m.soloAdmin || !app || app.admin) && habilitado(m)));
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

// Navegación lateral del administrador (aprobada 9 nov 2026): 6 grupos, dos niveles. Un módulo aparece en UN solo grupo; los ids no cambian.
// `nav.hoy` es la pantalla de inicio (Hoy). El orden dentro de cada grupo es el de esta lista. En el celular: Hoy, Vender, Inventario, Conta y «Más» (Informes y Sistema).
export const GRUPOS_NAV = [
  { id: 'hoy', titulo: 'Hoy', ruta: 'inicio', icono: 'caja', items: [] },
  { id: 'vender', titulo: 'Vender', corto: 'Vender', icono: 'facturar', items: ['caja', 'turno', 'anular', 'clientes', 'sinpe', 'sinpe_caja', 'cotizaciones', 'contingencia'] },
  { id: 'inventario', titulo: 'Inventario', corto: 'Inventario', icono: 'bodega', items: ['inventarios', 'productos'] },
  { id: 'conta', titulo: 'Contabilidad', corto: 'Conta', icono: 'libro', items: ['contabilidad', 'alertas_hacienda', 'pago_sin_factura'] },
  { id: 'informes', titulo: 'Informes', corto: 'Informes', icono: 'barras', items: ['listados', 'semanal', 'emitidas'] },
  { id: 'sistema', titulo: 'Sistema', corto: 'Sistema', icono: 'ajustes', items: ['usuarios', 'numeracion', 'pantalla_cliente', 'avisos', 'configuracion', 'respaldos'] },
];
export const grupoNavDe = (id) => GRUPOS_NAV.find((g) => g.items.includes(id)) || null;

// Perfil de Dixia (la dueña, 9 nov 2026): su Hoy son solo estas 4 tarjetas grandes y, por eso, no se repiten en la columna izquierda. Solo cambia lo que se ve: los permisos siguen en el servidor.
export const RAPIDOS_DIXIA = ['caja', 'anular', 'clientes', 'turno'];
export const esDixia = (app) => String(app?.usuario || app?.ctx?.usuario || '').toLowerCase() === 'dixia';
export const itemsDeGrupo = (g, app) => esDixia(app) ? g.items.filter((id) => !RAPIDOS_DIXIA.includes(id)) : g.items;
