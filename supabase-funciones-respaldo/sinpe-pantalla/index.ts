// sinpe-pantalla v1 (25 nov 2026): pantalla remota del telefono de SINPE (app 2.10.0). Protocolo en PROTOCOLO.md.
// Autenticacion propia (verify_jwt=false): X-Signature = HMAC-SHA256 del cuerpo (hex), con el secreto de fact.sinpe_secreto, igual que sinpe-recibir.
// ts dentro del cuerpo firmado y a menos de 300 s. Cuerpo maximo 256 KB. TODA respuesta posterior a la firma va firmada (X-Signature = HMAC del cuerpo de respuesta)
// y trae eco = ts de la peticion, para que el telefono ate la respuesta a su peticion y no acepte una respuesta vieja repetida.
// Toda la logica esta en la base (public.sinpe_pantalla_*). Esta funcion no toca sinpe-recibir ni los latidos.
// Reversa: borrar la funcion (la app 2.10.0 solo la usa si el telefono tiene el servicio de accesibilidad activo).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const MAX_BYTES = 256 * 1024;
const MAX_JPG = 240 * 1024;
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

let cache: { v: string; exp: number } | null = null;
async function secreto(): Promise<string | null> {
  if (cache && cache.exp > Date.now()) return cache.v;
  const { data, error } = await db.rpc('sinpe_secreto');
  if (error || typeof data !== 'string' || !data) return null;
  cache = { v: data, exp: Date.now() + 5 * 60_000 };
  return data;
}

const enc = new TextEncoder();
async function hmac(key: string, body: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, body));
}
const hex = (u: Uint8Array) => [...u].map((b) => b.toString(16).padStart(2, '0')).join('');
const iguales = (a: string, b: string) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

function aMs(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v < 1e12 ? v * 1000 : v;
  if (typeof v === 'string' && /^[0-9]+$/.test(v.trim())) return aMs(Number(v.trim()));
  return null;
}

async function fallo(motivo: string, bytes: number) {
  try { await db.rpc('sinpe_firma_fallo', { p_motivo: 'pantalla_' + motivo, p_bytes: bytes }); } catch (_e) { /* no frena la respuesta */ }
  return new Response(JSON.stringify({ ok: false, error: 'no autorizado' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
}

// Respuesta firmada con el mismo secreto. eco = ts de la peticion; ts = reloj del servidor (ms).
async function firmada(sec: string, eco: number | null, cuerpo: Record<string, unknown>, status = 200): Promise<Response> {
  const texto = JSON.stringify({ ...cuerpo, eco, ts: Date.now() });
  const f = hex(await hmac(sec, enc.encode(texto)));
  return new Response(texto, { status, headers: { 'Content-Type': 'application/json', 'X-Signature': f, 'Cache-Control': 'no-store' } });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const entero = (v: unknown, min: number, max: number): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null);

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response(JSON.stringify({ ok: false, error: 'metodo no permitido' }), { status: 405, headers: { 'Content-Type': 'application/json' } });
  const crudo = new Uint8Array(await req.arrayBuffer());
  if (crudo.length > MAX_BYTES) return new Response(JSON.stringify({ ok: false, error: 'cuerpo muy grande' }), { status: 413, headers: { 'Content-Type': 'application/json' } });
  let firma = (req.headers.get('x-signature') ?? '').trim();
  if (!firma) return await fallo('sin_firma', crudo.length);
  firma = firma.replace(/^sha256=/i, '');
  const sec = await secreto();
  if (!sec) return new Response(JSON.stringify({ ok: false, error: 'servicio no disponible' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  const esperado = hex(await hmac(sec, crudo));
  if (!iguales(firma.toLowerCase(), esperado)) return await fallo('firma_invalida', crudo.length);

  let c: Record<string, unknown>;
  try { c = JSON.parse(new TextDecoder().decode(crudo)); } catch { return await firmada(sec, null, { ok: false, error: 'json invalido' }, 400); }
  const ts = aMs(c.ts);
  if (ts === null) return await firmada(sec, null, { ok: false, error: 'sin ts' }, 400);
  if (Math.abs(Date.now() - ts) > 300_000) return await firmada(sec, ts, { ok: false, error: 'fuera de tiempo' }, 409);
  if (c.tipo !== 'pantalla') return await firmada(sec, ts, { ok: false, error: 'tipo invalido' }, 400);
  const empresa = (typeof c.empresa === 'string' ? c.empresa : '').slice(0, 10).toLowerCase();
  if (empresa !== 'soda' && empresa !== 'pollos') return await firmada(sec, ts, { ok: false, error: 'empresa invalida' }, 400);
  const bool = (v: unknown) => (typeof v === 'boolean' ? v : null);
  const fase = c.fase;

  try {
    if (fase === 'escucha') {
      const { data, error } = await db.rpc('sinpe_pantalla_escucha', { p_empresa: empresa, p_encendida: bool(c.pantalla_encendida), p_bloqueada: bool(c.bloqueada) });
      if (error || !data) throw new Error(error?.message ?? 'sin datos');
      return await firmada(sec, ts, data as Record<string, unknown>);
    }
    if (fase === 'cuadro') {
      if (typeof c.sid !== 'string' || !UUID.test(c.sid)) return await firmada(sec, ts, { ok: false, error: 'sid invalido' }, 400);
      const seq = entero(c.seq, 0, 2_000_000_000);
      if (seq === null) return await firmada(sec, ts, { ok: false, error: 'seq invalido' }, 400);
      const sinCambio = c.sin_cambio === true;
      let w = 0, h = 0, jpg: string | null = null;
      if (!sinCambio) {
        const w1 = entero(c.w, 16, 4096), h1 = entero(c.h, 16, 4096);
        if (w1 === null || h1 === null) return await firmada(sec, ts, { ok: false, error: 'tamano invalido' }, 400);
        if (typeof c.jpg !== 'string' || c.jpg.length < 8 || c.jpg.length > MAX_JPG || !B64.test(c.jpg)) return await firmada(sec, ts, { ok: false, error: 'imagen invalida' }, 400);
        w = w1; h = h1; jpg = c.jpg;
      }
      const conf = Array.isArray(c.confirmadas) ? (c.confirmadas as unknown[]).filter((x) => Number.isInteger(x) && (x as number) > 0 && (x as number) < 9e15).slice(0, 20) : [];
      const res: Record<string, string> = {};
      if (c.resultados && typeof c.resultados === 'object' && !Array.isArray(c.resultados)) {
        for (const [k, v] of Object.entries(c.resultados as Record<string, unknown>).slice(0, 20)) {
          if (/^[0-9]{1,15}$/.test(k) && typeof v === 'string') res[k] = v.slice(0, 40);
        }
      }
      const { data, error } = await db.rpc('sinpe_pantalla_guardar', {
        p_empresa: empresa, p_sid: c.sid, p_seq: seq, p_w: w || null, p_h: h || null, p_jpg: jpg, p_sin_cambio: sinCambio,
        p_encendida: bool(c.pantalla_encendida), p_bloqueada: bool(c.bloqueada), p_conf: conf, p_res: res,
      });
      if (error || !data) throw new Error(error?.message ?? 'sin datos');
      return await firmada(sec, ts, data as Record<string, unknown>);
    }
    if (fase === 'fin') {
      if (typeof c.sid !== 'string' || !UUID.test(c.sid)) return await firmada(sec, ts, { ok: false, error: 'sid invalido' }, 400);
      const { data, error } = await db.rpc('sinpe_pantalla_fin', { p_empresa: empresa, p_sid: c.sid });
      if (error || !data) throw new Error(error?.message ?? 'sin datos');
      return await firmada(sec, ts, data as Record<string, unknown>);
    }
    return await firmada(sec, ts, { ok: false, error: 'fase invalida' }, 400);
  } catch (e) {
    console.error(JSON.stringify({ ev: 'sinpe_pantalla', fase: String(fase).slice(0, 12), detalle: String((e as Error).message).slice(0, 200) }));
    return await firmada(sec, ts, { ok: false, error: 'no se pudo procesar' }, 500);
  }
});
