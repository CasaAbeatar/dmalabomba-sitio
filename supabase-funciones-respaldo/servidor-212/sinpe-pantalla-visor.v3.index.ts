// sinpe-pantalla-visor v2 (25 nov 2026, auditoria): exige la cabecera x-visor-worker (solo el worker de pagos.dmalabomba.com puede llamarla), bloqueo por intentos fallidos,
// ficha de 15 min, CORS solo de origenes exactos, cuadro_seq en las acciones.
// v1 (25 nov 2026): lado del navegador de la pantalla remota (pagos.dmalabomba.com/remoto).
// Autenticacion: el MISMO usuario y PIN del facturador (fxs_login_intento_atomico, con su candado, freno y espera fija de 3 s tras fallo), empresa 'soda',
// y ademas administrador general activo (fact.usuarios.admin_general). Emil no tiene que guardar ninguna clave nueva.
// Tras entrar se entrega una ficha firmada (HMAC con la clave pantalla_visor_clave del Vault, distinta de la del telefono) que dura 15 min y no se puede alargar.
// Cada llamada vuelve a comprobar en la base que el usuario sigue siendo administrador general activo.
// Toda la logica de sesiones esta en la base (public.sinpe_pantalla_*, solo service_role). Esta funcion no toca nada del telefono ni del dinero.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TTL_MS = 15 * 60_000;
const ESPERA_FALLO_MS = 3000;
const EMPRESA_LOGIN = 'soda';
const MAX_BODY = 8 * 1024;

const ORIGENES = ['https://pagos.dmalabomba.com', 'https://vista-pantalla.sinpe-pagos.pages.dev'];
const origenOk = (o: string) => ORIGENES.includes(o);
const cors = (req: Request): Record<string, string> => {
  const o = req.headers.get('origin') ?? '';
  return origenOk(o) ? { 'Access-Control-Allow-Origin': o, 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Max-Age': '600', Vary: 'Origin' } : {};
};
const json = (req: Request, b: unknown, s = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors(req), 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra } });
const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

const enc = new TextEncoder();
let cache: { v: string; exp: number } | null = null;
async function clave(): Promise<string | null> {
  if (cache && cache.exp > Date.now()) return cache.v;
  const { data, error } = await db.rpc('sinpe_pantalla_clave');
  if (error || typeof data !== 'string' || !data) return null;
  cache = { v: data, exp: Date.now() + 5 * 60_000 };
  return data;
}
async function hmacHex(key: string, texto: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(texto)))].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const iguales = (a: string, b: string) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
const b64u = (s: string) => btoa(String.fromCharCode(...enc.encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const deb64u = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));

async function emitir(uid: string): Promise<string | null> {
  const k = await clave(); if (!k) return null;
  const carga = b64u(JSON.stringify({ u: uid, e: Date.now() + TTL_MS }));
  return `v1.${carga}.${await hmacHex(k, 'v1.' + carga)}`;
}
// Devuelve el id de usuario si la ficha es valida y vigente; 'vencida' si solo vencio; null si no vale.
async function verificar(token: unknown): Promise<string | null | 'vencida'> {
  if (typeof token !== 'string' || token.length > 400) return null;
  const p = token.split('.');
  if (p.length !== 3 || p[0] !== 'v1') return null;
  const k = await clave(); if (!k) return null;
  if (!iguales(p[2], await hmacHex(k, 'v1.' + p[1]))) return null;
  try {
    const c = JSON.parse(deb64u(p[1]));
    if (typeof c.u !== 'string' || !UUID.test(c.u) || typeof c.e !== 'number') return null;
    return c.e > Date.now() ? c.u : 'vencida';
  } catch { return null; }
}

// Secreto compartido con el worker (Vault: pantalla_visor_worker_secreto; en Cloudflare Pages: VISOR_WORKER_SECRETO). Sin la cabecera correcta no se responde nada util.
let cacheW: { v: string; exp: number } | null = null;
async function secretoWorker(): Promise<string | null> {
  if (cacheW && cacheW.exp > Date.now()) return cacheW.v;
  const { data, error } = await db.rpc('sinpe_pantalla_worker_secreto');
  if (error || typeof data !== 'string' || !data) return null;
  cacheW = { v: data, exp: Date.now() + 5 * 60_000 };
  return data;
}

const ipDe = (req: Request) => (req.headers.get('x-ip-cliente') || req.headers.get('cf-connecting-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0] || '').trim().slice(0, 64);

async function rpc(nombre: string, args: Record<string, unknown>): Promise<{ ok: boolean; data?: any; detalle?: string }> {
  try {
    const { data, error } = await db.rpc(nombre, args);
    if (error) return { ok: false, detalle: error.message };
    return { ok: true, data };
  } catch (e) { return { ok: false, detalle: (e as Error).message }; }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== 'POST') return json(req, { ok: false, error: 'Metodo no permitido' }, 405);
  const sw = await secretoWorker();
  const cab = (req.headers.get('x-visor-worker') ?? '').trim();
  if (!sw || !cab || !iguales(cab, sw)) return json(req, { ok: false, error: 'Prohibido' }, 403);
  const texto = await req.text();
  if (texto.length > MAX_BODY) return json(req, { ok: false, error: 'Cuerpo muy grande' }, 413);
  let b: any = {};
  try { b = JSON.parse(texto); } catch { return json(req, { ok: false, error: 'JSON invalido' }, 400); }
  if (!b || typeof b !== 'object' || Array.isArray(b)) return json(req, { ok: false, error: 'JSON invalido' }, 400);
  const ip = ipDe(req);

  // ---------------- entrar: usuario y PIN del facturador ----------------
  if (b.op === 'entrar') {
    const usuario = String(b.usuario ?? '').trim().toLowerCase();
    const pin = typeof b.pin === 'string' || typeof b.pin === 'number' ? String(b.pin).slice(0, 64) : '';
    if (!/^[a-z0-9._-]{2,30}$/.test(usuario)) return json(req, { ok: false, error: 'Escriba su usuario y su clave.' }, 400);
    // Bloqueo: 8 fallos por usuario (o 20 por direccion) en 15 min bloquean 30 min. Misma respuesta exista o no el usuario, y no se llega a tocar el candado del facturador.
    const est = await rpc('sinpe_pantalla_visor_estado', { p_usuario: usuario, p_ip: ip || null });
    if (est.ok && est.data?.bloqueado === true) {
      await pausa(ESPERA_FALLO_MS);
      return json(req, { ok: false, error: 'Demasiados intentos. Intente de nuevo en unos minutos.', bloqueado: true }, 429, { 'Retry-After': String(Math.min(1800, Math.max(60, Number(est.data.espera_s) || 1800))) });
    }
    const emp = await rpc('fxs_empresa_por_codigo', { p_codigo: EMPRESA_LOGIN });
    if (!emp.ok || !emp.data?.id) return json(req, { ok: false, error: 'No se pudo verificar el acceso en este momento. Intente de nuevo en unos segundos.', transitorio: true }, 503, { 'Retry-After': '3' });
    const r = await rpc('fxs_login_intento_atomico', { p_usuario: usuario, p_pin: pin, p_ip: ip || null, p_empresa: emp.data.id, p_confiable: false });
    if (!r.ok || !r.data || typeof r.data !== 'object') return json(req, { ok: false, error: 'No se pudo verificar el acceso en este momento. Intente de nuevo en unos segundos.', transitorio: true }, 503, { 'Retry-After': '3' });
    if (r.data.motivo === 'espera') {
      const s = Math.min(3, Math.max(1, Math.round(Number(r.data.retry_after) || 3)));
      return json(req, { ok: false, motivo: 'espera', espera: s, error: `Espere ${s} segundo${s === 1 ? '' : 's'} e intente de nuevo.` }, 429, { 'Retry-After': String(s) });
    }
    const malo = async () => { await rpc('sinpe_pantalla_visor_fallo', { p_usuario: usuario, p_ip: ip || null }); await pausa(ESPERA_FALLO_MS); return json(req, { ok: false, error: 'Usuario o clave incorrecta.' }, 401); };
    if (!r.data.ok) return await malo();
    const uid = String(r.data.id ?? r.data.usuario_id ?? '');
    if (!UUID.test(uid)) return await malo();
    // Misma respuesta y misma espera que un PIN malo: no se revela si el PIN era correcto pero la persona no es administrador general.
    const adm = await rpc('sinpe_pantalla_es_admin_pub', { p_usuario: uid });
    if (!adm.ok || adm.data !== true) { console.log(JSON.stringify({ ev: 'pantalla_visor', ok: false, motivo: 'no_admin' })); return await malo(); }
    const tk = await emitir(uid);
    if (!tk) return json(req, { ok: false, error: 'Servicio no disponible' }, 503);
    console.log(JSON.stringify({ ev: 'pantalla_visor', ok: true, op: 'entrar' }));
    return json(req, { ok: true, token: tk, vence_s: TTL_MS / 1000 });
  }

  // ---------------- el resto exige ficha ----------------
  const uid = await verificar(b.token);
  if (uid === 'vencida') return json(req, { ok: false, vencida: true, error: 'Su ingreso vencio (dura 15 minutos). Entre de nuevo.' }, 401);
  if (!uid) return json(req, { ok: false, error: 'No autorizado' }, 401);
  const sid = typeof b.sid === 'string' && UUID.test(b.sid) ? b.sid : null;
  let r: { ok: boolean; data?: any; detalle?: string };
  switch (b.op) {
    case 'abrir': r = await rpc('sinpe_pantalla_abrir', { p_usuario: uid, p_empresa: String(b.empresa ?? 'soda').slice(0, 10), p_ip: ip || null }); break;
    case 'leer': if (!sid) return json(req, { ok: false, error: 'sid invalido' }, 400);
      r = await rpc('sinpe_pantalla_leer', { p_usuario: uid, p_sid: sid, p_desde: Number.isInteger(b.desde) ? b.desde : -1 }); break;
    case 'accion': if (!sid) return json(req, { ok: false, error: 'sid invalido' }, 400);
      r = await rpc('sinpe_pantalla_accion_v2', { p_usuario: uid, p_sid: sid, p_a: String(b.a ?? '').slice(0, 20), p_params: b.params && typeof b.params === 'object' && !Array.isArray(b.params) ? b.params : {}, p_cuadro_seq: Number.isInteger(b.cuadro_seq) && b.cuadro_seq >= 0 && b.cuadro_seq <= 2_000_000_000 ? b.cuadro_seq : null }); break;
    case 'salud': r = await rpc('sinpe_pantalla_salud_v1', { p_usuario: uid, p_empresa: String(b.empresa ?? 'soda').slice(0, 10) }); break;
    case 'adb': r = await rpc('sinpe_pantalla_adb_v1', { p_usuario: uid, p_empresa: String(b.empresa ?? 'soda').slice(0, 10), p_telefono: String(b.telefono ?? '').slice(0, 40), p_cmd: b.cmd === 'cerrar' ? 'cerrar_adb' : 'abrir_adb' }); break;
    case 'prorrogar': if (!sid) return json(req, { ok: false, error: 'sid invalido' }, 400);
      r = await rpc('sinpe_pantalla_prorrogar_v2', { p_usuario: uid, p_sid: sid }); break;
    case 'cerrar': if (!sid) return json(req, { ok: false, error: 'sid invalido' }, 400);
      r = await rpc('sinpe_pantalla_cerrar', { p_usuario: uid, p_sid: sid, p_motivo: 'visor' }); break;
    default: return json(req, { ok: false, error: 'op invalida' }, 400);
  }
  if (!r.ok || !r.data) { console.error(JSON.stringify({ ev: 'pantalla_visor', op: String(b.op).slice(0, 12), detalle: String(r.detalle ?? '').slice(0, 160) })); return json(req, { ok: false, error: 'No se pudo procesar' }, 500); }
  if (r.data.ok === false && r.data.error === 'no autorizado') return json(req, r.data, 403);
  return json(req, r.data);
});
