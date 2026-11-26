// sinpe-actualizacion v1 (26 nov 2026, app Sinpe 2.12): registra, verifica, activa y desactiva actualizaciones automaticas de la app.
// NADA se activa solo: quien activa (Claude/Emil) llama aqui con el secreto vault `sinpe_actualizacion_secreto` (cabecera x-actualizacion-secreto). Activar descarga la URL
// (solo https://pagos.dmalabomba.com/instalar/<archivo>.apk, sin redirecciones), calcula su sha256 y SOLO si coincide con el registrado pone la fila activa (rpc sinpe_actualizacion_activar).
// Reversa: borrar la funcion; parada de emergencia: {op:'desactivar'} o select public.sinpe_actualizacion_desactivar().
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const URL_OK = /^https:\/\/pagos\.dmalabomba\.com\/instalar\/[A-Za-z0-9._-]{1,100}\.apk$/;
const MAX = 60 * 1024 * 1024;
const iguales = (a: string, b: string) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

async function sha256Url(url: string): Promise<{ sha?: string; bytes?: number; error?: string }> {
  if (!URL_OK.test(url)) return { error: 'url no permitida' };
  const r = await fetch(url, { redirect: 'error', headers: { 'Cache-Control': 'no-cache' } });
  if (!r.ok || !r.body) return { error: 'descarga ' + r.status };
  const largo = Number(r.headers.get('content-length') ?? '0');
  if (largo > MAX) return { error: 'archivo muy grande' };
  const h = new Uint8Array(await r.arrayBuffer());
  if (h.length > MAX || h.length < 1000) return { error: 'tamano invalido' };
  if (!(h[0] === 0x50 && h[1] === 0x4b)) return { error: 'no parece un APK (zip)' };
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', h));
  return { sha: [...d].map((b) => b.toString(16).padStart(2, '0')).join(''), bytes: h.length };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'metodo no permitido' }, 405);
  const { data: sec, error: e0 } = await db.rpc('sinpe_actualizacion_secreto');
  const dado = (req.headers.get('x-actualizacion-secreto') ?? '').trim();
  if (e0 || typeof sec !== 'string' || !sec || !iguales(dado, sec)) return json({ ok: false, error: 'no autorizado' }, 401);
  let c: Record<string, unknown>;
  try { c = await req.json(); } catch { return json({ ok: false, error: 'json invalido' }, 400); }
  const op = String(c.op ?? '');
  if (op === 'registrar') {
    const { data, error } = await db.rpc('sinpe_actualizacion_registrar', { p_empresa: String(c.empresa ?? ''), p_telefono: c.telefono ? String(c.telefono) : null, p_v: String(c.v ?? ''), p_vc: Number(c.vc), p_url: String(c.url ?? ''), p_sha256: String(c.sha256 ?? ''), p_nota: c.nota ? String(c.nota) : null });
    if (error) return json({ ok: false, error: error.message.slice(0, 200) }, 400);
    return json(data);
  }
  if (op === 'verificar' || op === 'activar') {
    const id = Number(c.id);
    if (!Number.isInteger(id) || id < 1) return json({ ok: false, error: 'id invalido' }, 400);
    const { data: fila, error } = await db.rpc('sinpe_actualizacion_leer', { p_id: id });
    if (error || !fila) return json({ ok: false, error: 'no existe' }, 404);
    const r = await sha256Url(String(fila.url));
    if (r.error || !r.sha) return json({ ok: false, error: r.error ?? 'sin sha' }, 502);
    const coincide = r.sha === fila.sha256;
    if (op === 'verificar') return json({ ok: true, coincide, sha256_url: r.sha, sha256_registrada: fila.sha256, bytes: r.bytes });
    if (!coincide) return json({ ok: false, error: 'el sha256 de la URL no coincide con el registrado', sha256_url: r.sha, sha256_registrada: fila.sha256 }, 409);
    const { data, error: e2 } = await db.rpc('sinpe_actualizacion_activar', { p_id: id, p_sha256_descargada: r.sha, p_por: 'sinpe-actualizacion' });
    if (e2) return json({ ok: false, error: e2.message.slice(0, 200) }, 400);
    return json(data);
  }
  if (op === 'desactivar') {
    const { data, error } = await db.rpc('sinpe_actualizacion_desactivar', { p_id: c.id ? Number(c.id) : null });
    if (error) return json({ ok: false, error: error.message.slice(0, 200) }, 400);
    return json(data);
  }
  return json({ ok: false, error: 'operacion invalida' }, 400);
});
