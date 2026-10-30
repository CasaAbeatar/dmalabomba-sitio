// Datos del módulo Inventarios. Todo pasa por las funciones fx_inv_* de Supabase (contrato: CONTRATO_INVENTARIOS.md). api.js no se toca.
// La bodega es del GRUPO: ninguna función filtra por la empresa de la sesión; cada lote y cada movimiento trae su empresa de origen.
//
// Lecturas: api.js solo repite sola una consulta si su nombre está en SOLO_LECTURA, y ahí no están las fx_inv_*. Por eso leer() repite UNA vez, aquí, la consulta que
// falló por la red, el tiempo o un sistema ocupado (nunca una respuesta de negocio). Si algún día se agregan a SOLO_LECTURA, api.js ya habrá repetido y su mensaje será el
// de lectura (MSG_SIN_INTERNET): en ese caso aquí no se repite otra vez.
// Escrituras: NUNCA se repiten solas. Cada una lleva p_idem, la clave de repetición que la pantalla genera UNA vez por intención de la persona (ver claveNueva) y reutiliza
// en los reintentos: el servidor no duplica nada y devuelve la respuesta guardada con "idem_repetida": true.
import { rpc, ErrorApi, esTransitorio } from './api.js';
import { MSG_SIN_INTERNET } from './util.js';

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const MSG_TARDO_LECTURA = 'La respuesta tardó demasiado. Intente de nuevo.';
// La función todavía no existe en la base (la migración no se ha aplicado): PostgREST contesta 404 con el código PGRST202
export const faltaFuncion = (e) => !!e && (e.codigo === 'PGRST202' || e.estado === 404);
export const MSG_SIN_ACTIVAR = 'Esta parte de Inventarios todavía no está activada en el sistema. Avise a la persona encargada.';

async function leer(nombre, args = {}) {
  for (let intento = 1; ; intento++) {
    try { return await rpc(nombre, args); }
    catch (e) {
      if (faltaFuncion(e)) throw new ErrorApi(MSG_SIN_ACTIVAR, { tipo: 'negocio', estado: 404, codigo: e.codigo });
      if (!esTransitorio(e)) throw e;
      const yaRepetida = e.message === MSG_SIN_INTERNET || e.message === MSG_TARDO_LECTURA;
      if (intento < 2 && !yaRepetida) { await pausa(700); continue; }
      // El texto de api.js para una escritura («antes de repetirlo, revise si quedó guardado») no aplica a una consulta
      const texto = e.tipo === 'red' ? MSG_SIN_INTERNET : e.tipo === 'tiempo' ? MSG_TARDO_LECTURA : e.message;
      throw new ErrorApi(texto, { tipo: e.tipo, estado: e.estado, codigo: e.codigo });
    }
  }
}
async function escribir(nombre, args) {
  try { return await rpc(nombre, args); }
  catch (e) {
    if (faltaFuncion(e)) throw new ErrorApi(MSG_SIN_ACTIVAR, { tipo: 'negocio', estado: 404, codigo: e.codigo });
    throw e;
  }
}

// Una clave de repetición nueva: 8 a 100 caracteres de A-Z a-z 0-9 _ . : - (contrato 1.1). Un uuid sirve tal cual.
export function claveNueva() {
  try { if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID(); } catch { /* sin crypto.randomUUID (página sin https) */ }
  const b = new Uint8Array(16);
  try { globalThis.crypto.getRandomValues(b); } catch { for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256); }
  return 'inv-' + [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

// Números como texto con punto decimal (contrato 1: «se recomienda texto»). Cantidades con 3 decimales; dinero con 5.
const texto = (n, dec) => (n == null || n === '' ? null : String(Math.round(Number(n) * 10 ** dec) / 10 ** dec));
export const cant = (n) => texto(n, 3);
export const dinero = (n) => texto(n, 5);

export const inv = {
  /* ---------- Lecturas (cualquier usuario) ---------- */
  catalogos: () => leer('fx_inv_catalogos'),
  articulos: (q = '', categoria = null, incluirInactivos = false) => leer('fx_inv_articulos', { p_q: q, p_categoria: categoria, p_incluir_inactivos: !!incluirInactivos }),
  cabysSugerencia: (cabys) => leer('fx_inv_cabys_sugerencia', { p_cabys: cabys }),
  pendientes: (sociedad = null, q = '', limite = 100) => leer('fx_inv_pendientes', { p_sociedad: sociedad, p_q: q, p_limite: limite }),
  factura: (clave) => leer('fx_inv_factura', { p_clave: clave }),
  facturaEstado: (clave) => leer('fx_inv_factura_estado', { p_clave: clave }),
  existencias: (ubicacion = null, categoria = null, q = '', incluirCeros = false) => leer('fx_inv_existencias', { p_ubicacion: ubicacion, p_categoria: categoria, p_q: q, p_incluir_ceros: !!incluirCeros }),
  lotes: (articulo = null, ubicacion = null, incluirAgotados = false, limite = 200) => leer('fx_inv_lotes', { p_articulo: articulo, p_ubicacion: ubicacion, p_incluir_agotados: !!incluirAgotados, p_limite: limite }),
  movimientos: (desde, hasta, { articulo = null, ubicacion = null, tipo = null, limite = 500 } = {}) => leer('fx_inv_movimientos', { p_desde: desde, p_hasta: hasta, p_articulo: articulo, p_ubicacion: ubicacion, p_tipo: tipo, p_limite: limite }),
  alertas: () => leer('fx_inv_alertas'),
  alertasResumen: () => leer('fx_inv_alertas_resumen'),
  valorizacion: () => leer('fx_inv_valorizacion'),
  mermas: (desde, hasta) => leer('fx_inv_mermas', { p_desde: desde, p_hasta: hasta }),
  conteos: (ubicacion = null, estado = null, limite = 50) => leer('fx_inv_conteos', { p_ubicacion: ubicacion, p_estado: estado, p_limite: limite }),
  conteo: (id) => leer('fx_inv_conteo', { p_conteo: id }),
  equivalencias: (q = '', limite = 200) => leer('fx_inv_equivalencias', { p_q: q, p_limite: limite }),
  cabysReglas: () => leer('fx_inv_cabys_reglas'),
  notasProveedor: (estado = 'por_revisar', limite = 100) => leer('fx_inv_notas_proveedor', { p_estado: estado, p_limite: limite }),
  // Las líneas marcadas «No es de inventario» por la fecha en que se marcaron (contrato 5.6 bis, migración 24j). desde y hasta: AAAA-MM-DD; sin ellas, los últimos 30 días.
  ignoradas: (desde = null, hasta = null, q = '', limite = 200) => leer('fx_inv_ignoradas', { p_desde: desde, p_hasta: hasta, p_q: q, p_limite: limite }),

  /* ---------- Operación (cualquier usuario). idem = la clave de la intención ---------- */
  // lineas: [{ clave, linea, articulo_id, factor?, cantidad?, ubicacion_id?, vence_en?, sin_vencimiento?, costo_unitario?, recordar?, nota? }]
  recibir: (lineas, idem) => escribir('fx_inv_recibir', { p_lineas: lineas, p_idem: idem }),
  ignorar: (clave, lineas = null, motivo = null, recordar = true, idem) => escribir('fx_inv_ignorar', { p_clave: clave, p_lineas: lineas, p_motivo: motivo, p_recordar: !!recordar, p_idem: idem }),
  deshacerIgnorar: (clave, lineas = null, idem) => escribir('fx_inv_deshacer_ignorar', { p_clave: clave, p_lineas: lineas, p_idem: idem }),
  trasladar: (origen, destino, items, motivo = null, idem) => escribir('fx_inv_trasladar', { p_origen: origen, p_destino: destino, p_items: items, p_motivo: motivo, p_idem: idem }),
  salida: (tipo, ubicacion, items, motivo, idem) => escribir('fx_inv_salida', { p_tipo: tipo, p_ubicacion: ubicacion, p_items: items, p_motivo: motivo, p_idem: idem }),
  porcionar: (ubicacion, origen, resultados, motivo = null, idem) => escribir('fx_inv_porcionar', { p_ubicacion: ubicacion, p_origen: origen, p_resultados: resultados, p_motivo: motivo, p_idem: idem }),
  conteoIniciar: (ubicacion, nota = null, idem) => escribir('fx_inv_conteo_iniciar', { p_ubicacion: ubicacion, p_nota: nota, p_idem: idem }),
  conteoRegistrar: (conteo, items, idem) => escribir('fx_inv_conteo_registrar', { p_conteo: conteo, p_items: items, p_idem: idem }),
  conteoCancelar: (conteo, motivo = null, idem) => escribir('fx_inv_conteo_cancelar', { p_conteo: conteo, p_motivo: motivo, p_idem: idem }),
  notaEnlazar: (nota, factura, idem) => escribir('fx_inv_nota_enlazar', { p_clave_nota: nota, p_clave_factura: factura, p_idem: idem }),
  notaDevolver: (nota, ubicacion, items, motivo = null, idem) => escribir('fx_inv_nota_devolver', { p_clave_nota: nota, p_ubicacion: ubicacion, p_items: items, p_motivo: motivo, p_idem: idem }),
  notaIgnorar: (nota, motivo = null, idem) => escribir('fx_inv_nota_ignorar', { p_clave_nota: nota, p_motivo: motivo, p_idem: idem }),
  notaReabrir: (nota, idem) => escribir('fx_inv_nota_reabrir', { p_clave_nota: nota, p_idem: idem }),
  // Idempotente por naturaleza (como fx_alerta_atender): no lleva clave
  alertaAtender: (tipo, referencia, estadoClave, nota = null) => escribir('fx_inv_alerta_atender', { p_tipo: tipo, p_referencia: referencia, p_estado_clave: estadoClave, p_nota: nota }),

  /* ---------- Administrador (la base lo vuelve a revisar con fx_es_admin) ---------- */
  conteoConfirmar: (conteo, idem) => escribir('fx_inv_conteo_confirmar', { p_conteo: conteo, p_idem: idem }),
  ajustar: (ubicacion, items, motivo, idem) => escribir('fx_inv_ajustar', { p_ubicacion: ubicacion, p_items: items, p_motivo: motivo, p_idem: idem }),
  entradaManual: (ubicacion, sociedad, items, motivo, idem) => escribir('fx_inv_entrada_manual', { p_ubicacion: ubicacion, p_sociedad: sociedad, p_items: items, p_motivo: motivo, p_idem: idem }),
  recepcionDeshacer: (clave, linea, motivo, idem) => escribir('fx_inv_recepcion_deshacer', { p_clave: clave, p_linea: linea, p_motivo: motivo, p_idem: idem }),
  // Cualquier sesión: crea el artículo desde una línea de factura con solo el rubro (si ya existe uno con ese nombre, devuelve ese)
  articuloRapido: (nombre, categoria, cabys, unidad) => escribir('fx_inv_articulo_rapido', { p_nombre: nombre, p_categoria_id: categoria, p_cabys: cabys || null, p_unidad: unidad || null }),
  articuloGuardar: (p, idem) => escribir('fx_inv_articulo_guardar', { p, p_idem: idem }),
  categoriaGuardar: (p, idem) => escribir('fx_inv_categoria_guardar', { p, p_idem: idem }),
  ubicacionGuardar: (p, idem) => escribir('fx_inv_ubicacion_guardar', { p, p_idem: idem }),
  // Estas tres no llevan clave de repetición en el contrato (7): guardar dos veces lo mismo deja lo mismo
  cabysReglaGuardar: (p) => escribir('fx_inv_cabys_regla_guardar', { p }),
  equivalenciaGuardar: (p) => escribir('fx_inv_equivalencia_guardar', { p }),
  configGuardar: (p) => escribir('fx_inv_config_guardar', { p }),
};

// Insignia del menú (main.js la pide con los avisos del encabezado, sin cargar el módulo). Si la función todavía no existe, no se vuelve a preguntar en 10 minutos.
let sinResumenHasta = 0;
export async function alertasResumen() {
  if (Date.now() < sinResumenHasta) return null;
  try { return await rpc('fx_inv_alertas_resumen'); }
  catch (e) { if (faltaFuncion(e)) sinResumenHasta = Date.now() + 10 * 60 * 1000; throw e; }
}
