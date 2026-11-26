// sinpe-recibir v7 (26 nov 2026, app 2.12): si el servidor tiene una actualizacion ACTIVA para la version del latido, la respuesta trae "actualizacion" con firma HMAC (ACT1|v|vc|url|sha256|ts|eco) y "eco". Sin cambios para el resto. Reversa: volver a desplegar la v6 (sinpe-recibir.v6.index.ts).
// v6 (25 nov 2026, auditoria de la pantalla remota): clave HMAC por empresa. Soda (y los avisos sin empresa, como los de sinpe-correo) firman con la clave maestra;
// Pollos firma con sinpe_hmac_secreto_pollos. Con la clave de una empresa no se puede hablar como la otra. Todo lo demas igual a v5. Reversa: volver a desplegar la v5 (sinpe-recibir.v5.index.ts).
// sinpe-recibir v4 (18 nov 2026 23:15 CR): el latido guarda el detalle saneado (fact.sinpe_latido_cmd), procesa comandos_hechos y responde {ok:true, comandos:[{id,cmd}]} con las ordenes pendientes del telefono (fact.sinpe_comandos). /sms, historico y firma NO cambian. Reversa: volver a desplegar la v3 (sinpe-recibir.v3.index.ts).
// sinpe-recibir v3 (18 nov 2026): agrega la carga de mensajes anteriores (cuerpo firmado con historico:true, ts y mensajes[], app 2.6.0; ver fact.sinpe_recibir_historico). El resto es igual a v2. Reversa: volver a desplegar la v2 (sinpe-recibir.v2.index.ts).
// sinpe-recibir v2 (17 nov 2026, correcciones de la revision ciega): recibe avisos de SINPE Movil (SMS reenviado desde Android, correo del BCR) y latidos.
// Autenticacion propia (verify_jwt=false): HMAC-SHA256 del cuerpo en X-Signature (hex, con o sin "sha256="; tambien base64). Secreto en el Vault (fact.sinpe_secreto).
// Toda la logica esta en la base: fact.sinpe_recibir_aut. El cuerpo puede traer autenticado:false (lo pone sinpe-correo si el remitente no paso DMARC/DKIM): el aviso queda en revision.
// M7: el latido exige ts dentro del cuerpo firmado y se rechaza si |ahora - ts| > 300 s (evita repetir un latido viejo capturado).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const MAX_BYTES = 16 * 1024;
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

const cache: Record<string, { v: string; exp: number }> = {};
async function secreto(emp: 'soda' | 'pollos'): Promise<string | null> {
  const c = cache[emp];
  if (c && c.exp > Date.now()) return c.v;
  const { data, error } = await db.rpc('sinpe_secreto_empresa', { p_empresa: emp });
  if (error || typeof data !== 'string' || !data) return null;
  cache[emp] = { v: data, exp: Date.now() + 5 * 60_000 };
  return data;
}

const enc = new TextEncoder();
async function hmac(key: string, body: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, body));
}
const hex = (u: Uint8Array) => [...u].map((b) => b.toString(16).padStart(2, '0')).join('');
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const iguales = (a: string, b: string) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

async function fallo(motivo: string, bytes: number) {
  try { await db.rpc('sinpe_firma_fallo', { p_motivo: motivo, p_bytes: bytes }); } catch (_e) { /* no frena la respuesta */ }
  return json({ ok: false, error: 'no autorizado' }, 401);
}

// ts en segundos, milisegundos o ISO; devuelve milisegundos o null
function aMs(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v < 1e12 ? v * 1000 : v;
  if (typeof v === 'string' && v.trim()) {
    if (/^[0-9]+(\.[0-9]+)?$/.test(v.trim())) return aMs(Number(v.trim()));
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'metodo no permitido' }, 405);
  const crudo = new Uint8Array(await req.arrayBuffer());
  if (crudo.length > MAX_BYTES) return json({ ok: false, error: 'cuerpo muy grande' }, 413);
  let firma = (req.headers.get('x-signature') ?? '').trim();
  if (!firma) return await fallo('sin_firma', crudo.length);
  firma = firma.replace(/^sha256=/i, '');
  const kS = await secreto('soda'), kP = await secreto('pollos');
  if (!kS || !kP) return json({ ok: false, error: 'servicio no disponible' }, 503); // nunca deja pasar sin poder verificar
  const coincide = async (k: string) => { const e = await hmac(k, crudo); return iguales(firma.toLowerCase(), hex(e)) || iguales(firma, b64(e)); };
  const okS = await coincide(kS);
  const okP = kP === kS ? okS : await coincide(kP);
  if (!okS && !okP) return await fallo('firma_invalida', crudo.length);

  let cuerpo: Record<string, unknown>;
  try { cuerpo = JSON.parse(new TextDecoder().decode(crudo)); } catch { return json({ ok: false, error: 'json invalido' }, 400); }
  const ruta = new URL(req.url).pathname;
  const texto = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : v == null ? '' : String(v).slice(0, n));
  const empresa = texto(cuerpo.empresa, 10).toLowerCase();
  // La clave con la que se firmo debe ser la de la empresa declarada (sin empresa = Soda, como sinpe-correo).
  if (empresa === 'pollos' ? !okP : !okS) return await fallo('empresa_no_corresponde', crudo.length);

  if (cuerpo.historico === true) {
    // Carga de mensajes anteriores: lote firmado {historico:true, ts, empresa, mensajes:[{from,text,sentStamp}]} (maximo 25). No abre avisos ni toca latidos; deduplica en la base.
    const ts = aMs(cuerpo.ts);
    if (ts === null || Math.abs(Date.now() - ts) > 300_000) return json({ ok: false, error: 'lote fuera de tiempo' }, 409);
    if (empresa !== 'soda' && empresa !== 'pollos') return json({ ok: false, error: 'empresa invalida' }, 400);
    const lista = Array.isArray(cuerpo.mensajes) ? cuerpo.mensajes : [cuerpo];
    if (lista.length < 1 || lista.length > 25) return json({ ok: false, error: 'lote invalido' }, 400);
    const r = { ok: true, nuevos: 0, repetidos: 0, omitidos: 0, fallidos: 0 };
    for (const m of lista as Record<string, unknown>[]) {
      const { data, error } = await db.rpc('sinpe_recibir_historico', { p_from: texto(m.from, 80), p_text: texto(m.text, 2000), p_sent_stamp: texto(m.sentStamp, 40), p_empresa: empresa });
      if (error) { r.fallidos++; console.error(JSON.stringify({ ev: 'sinpe_historico', detalle: String(error.message).slice(0, 200) })); continue; }
      const e = (data as { estado?: string } | null)?.estado;
      if (e === 'nuevo') r.nuevos++; else if (e === 'repetido') r.repetidos++; else r.omitidos++;
    }
    return json(r);
  }

  if (cuerpo.tipo === 'latido' || ruta.endsWith('/latido')) {
    const ts = aMs(cuerpo.ts);
    if (ts === null) return json({ ok: false, error: 'latido sin ts' }, 400);
    if (Math.abs(Date.now() - ts) > 300_000) return json({ ok: false, error: 'latido fuera de tiempo' }, 409);
    const bat = Number(cuerpo.bateria);
    const tel = texto(cuerpo.telefono ?? cuerpo.from, 40);
    const bateria = Number.isFinite(bat) && bat >= 0 && bat <= 100 ? Math.round(bat) : null;
    // v4: detalle enriquecido (app 2.7.0). Solo se acepta un objeto de hasta 8 KB; la base lo sanea con lista blanca de campos, tipos y rangos.
    let det: Record<string, unknown> = {};
    if (cuerpo.detalle && typeof cuerpo.detalle === 'object' && !Array.isArray(cuerpo.detalle) && JSON.stringify(cuerpo.detalle).length <= 8192) det = cuerpo.detalle as Record<string, unknown>;
    // comandos_hechos: hasta 20 ids enteros positivos; la base solo los acepta si fueron entregados a este mismo telefono y empresa.
    const hechos = Array.isArray(det.comandos_hechos) ? (det.comandos_hechos as unknown[]).filter((x) => Number.isInteger(x) && (x as number) > 0 && (x as number) < 9e15).slice(0, 20) : [];
    const { data, error } = await db.rpc('sinpe_latido_cmd', { p_telefono: tel, p_empresa: empresa, p_bateria: bateria, p_detalle: det, p_hechos: hechos });
    if (!error && data) {
      // v7 (2.12): si hay actualizacion activa, la respuesta la lleva FIRMADA con la clave de la empresa (la app verifica en tiempo constante y que eco sea su ts)
      const d = data as Record<string, unknown>;
      const act = d.actualizacion as Record<string, unknown> | undefined;
      if (act && typeof act === 'object') {
        try {
          const eco = typeof cuerpo.ts === 'number' ? Math.trunc(cuerpo.ts) : ts;
          const tsSrv = Date.now();
          const clave = empresa === 'pollos' ? kP : kS;
          const texto2 = ['ACT1', String(act.v), String(act.vc), String(act.url), String(act.sha256), String(tsSrv), String(eco)].join('|');
          act.ts = tsSrv;
          act.firma = hex(await hmac(clave, enc.encode(texto2)));
          d.eco = eco;
        } catch (_e) { delete d.actualizacion; }
      }
      return json(d);
    }
    // Respaldo: si la funcion nueva falla, el latido se guarda como en v3 (sin detalle ni ordenes) y la app 2.5.0/2.6.0 no nota la diferencia.
    console.error(JSON.stringify({ ev: 'sinpe_latido_cmd', detalle: String(error?.message ?? 'sin datos').slice(0, 200) }));
    const r2 = await db.rpc('sinpe_latido', { p_telefono: tel, p_empresa: empresa, p_bateria: bateria, p_detalle: {} });
    if (r2.error) return json({ ok: false, error: 'no se pudo guardar' }, 500);
    return json({ ...(r2.data as Record<string, unknown>), comandos: [] });
  }

  const canal = texto(cuerpo.canal, 10).toLowerCase() === 'correo' ? 'correo' : 'sms';
  const { data, error } = await db.rpc('sinpe_recibir_aut', {
    p_canal: canal, p_from: texto(cuerpo.from, 80), p_text: texto(cuerpo.text, 2000), p_sent_stamp: texto(cuerpo.sentStamp, 40), p_empresa: empresa,
    p_autenticado: cuerpo.autenticado !== false,
  });
  // Error de base: 500 para que la app reintente (es idempotente). Un aviso que no se entiende NO es error: responde 200.
  if (error) { console.error(JSON.stringify({ ev: 'sinpe_recibir', detalle: String(error.message).slice(0, 200) })); return json({ ok: false, error: 'no se pudo guardar' }, 500); }
  return json(data);
});
