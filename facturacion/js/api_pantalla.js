// Acceso a datos de «Pantalla del cliente» (solo administradores). Pasa por el rpc() de api.js, que no se toca.
// Usa fx_pantalla_config_leer / fx_pantalla_config_guardar (ajustes por caja) y fx_anuncio_guardar, fx_anuncio_lista, fx_anuncio_borrar y fx_anuncio_url_subida.
// Los archivos viven en el bucket privado «pantalla-anuncios»: se suben, se ven (url firmada) y se borran con la sesión del administrador.
import { rpc, sb } from './api.js';

const BUCKET = 'pantalla-anuncios';
export const MAX_BYTES = 25 * 1024 * 1024;
export const FORMATOS = {
  imagen: { 'image/jpeg': 'JPG', 'image/png': 'PNG', 'image/webp': 'WebP' },
  video: { 'video/mp4': 'MP4', 'video/webm': 'WebM' },
};
export const EMPRESAS = { soda: 'Soda La Bomba', pollos: 'Pollos La Bomba', papea: 'Papea', grupo: 'Todo el grupo' };
export const SEG_MIN = 3, SEG_MAX = 60;
export const GRACIAS_MIN = 1, GRACIAS_MAX = 15;

const lista = (d, clave) => (Array.isArray(d) ? d : Array.isArray(d?.[clave]) ? d[clave] : []);
const entero = (x, def = null) => { const n = Number(x); return Number.isFinite(n) ? Math.floor(n) : def; };
const fechaYMD = (x) => (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}/.test(x) ? x.slice(0, 10) : null);

export function normalizarAnuncio(a) {
  if (!a || typeof a !== 'object' || !a.id) return null;
  return {
    id: String(a.id), empresa: EMPRESAS[a.empresa] ? a.empresa : 'grupo', titulo: String(a.titulo ?? ''),
    tipo: a.tipo === 'video' ? 'video' : 'imagen', archivo: a.archivo == null ? null : String(a.archivo),
    segundos: Math.min(SEG_MAX, Math.max(SEG_MIN, entero(a.segundos, 8))), orden: entero(a.orden, 0),
    desde: fechaYMD(a.desde), hasta: fechaYMD(a.hasta), activo: a.activo !== false, url: null,
  };
}
// Ajustes de la pantalla del cliente de una caja. Lo que falte se completa con los valores de siempre.
export function normalizarConfig(c) {
  const o = (Array.isArray(c) ? c[0] : c) || {};
  return { activa: o.activa !== false, segundosPagado: Math.min(GRACIAS_MAX, Math.max(GRACIAS_MIN, entero(o.segundos_pagado, 6))), publicidadEnCuenta: o.publicidad_en_cuenta !== false };
}

export const config = {
  leer: (soc, terminal) => rpc('fx_pantalla_config_leer', { p_soc: soc, p_terminal: terminal }).then(normalizarConfig),
  guardar: (soc, terminal, c) => rpc('fx_pantalla_config_guardar', { p_soc: soc, p_terminal: terminal, p_config: { activa: c.activa, segundos_pagado: c.segundosPagado, publicidad_en_cuenta: c.publicidadEnCuenta } }),
};

export const anuncios = {
  // La lista trae los datos; las vistas previas se piden aparte (url firmada, sin esperar si falla)
  async lista(soc) {
    const l = (await rpc('fx_anuncio_lista', { p_soc: soc }).then((d) => lista(d, 'anuncios'))).map(normalizarAnuncio).filter(Boolean).sort((a, b) => a.orden - b.orden);
    const rutas = l.map((a) => a.archivo).filter(Boolean);
    if (rutas.length) {
      try {
        const { data } = await sb.storage.from(BUCKET).createSignedUrls(rutas, 3600);
        const por = new Map((data || []).filter((x) => x && !x.error).map((x) => [x.path, x.signedUrl]));
        l.forEach((a) => { a.url = por.get(a.archivo) || null; });
      } catch { /* sin vista previa: el anuncio igual se ve en la lista */ }
    }
    return l;
  },
  guardar: (a) => rpc('fx_anuncio_guardar', { p_anuncio: {
    ...(a.id ? { id: a.id } : {}), empresa: a.empresa, titulo: a.titulo, tipo: a.tipo, archivo: a.archivo, segundos: a.segundos, orden: a.orden,
    desde: a.desde || null, hasta: a.hasta || null, activo: a.activo !== false } }),
  // Borra la fila y después el archivo de Storage (si el archivo no se pudo quitar, la fila ya no existe y no se muestra)
  async borrar(id) {
    const r = await rpc('fx_anuncio_borrar', { p_id: id });
    if (r?.archivo) { try { await sb.storage.from(r.bucket || BUCKET).remove([r.archivo]); } catch { /* queda huérfano, sin consecuencias para el cliente */ } }
  },
  // Pide el nombre reservado y sube el archivo con la sesión del administrador. Devuelve la ruta que se guarda en «archivo».
  async subir(archivo, tipo) {
    const r = await rpc('fx_anuncio_url_subida', { p_nombre: archivo.name || 'anuncio', p_tipo: archivo.type || tipo });
    const ruta = r?.ruta;
    if (!ruta) throw new Error('El sistema no reservó el nombre del archivo. Intente de nuevo en un momento.');
    if (r.max_bytes && archivo.size > r.max_bytes) throw new Error('El archivo es más pesado de lo permitido (25 MB).');
    let res;
    try { res = await sb.storage.from(r.bucket || BUCKET).upload(ruta, archivo, { contentType: r.tipo || archivo.type, upsert: false }); } catch { throw new Error('No hay conexión con internet. Revise la conexión e intente de nuevo.'); }
    if (res?.error) throw new Error('No se pudo subir el archivo. Intente de nuevo; si sigue igual, avise a la persona encargada.');
    return ruta;
  },
};
