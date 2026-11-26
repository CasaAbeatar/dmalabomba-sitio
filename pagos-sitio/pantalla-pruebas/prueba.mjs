// Prueba del servidor de pantalla remota: simula el telefono (firma HMAC) y el visor (ficha firmada). Empresa de prueba: pollos.
// Uso: node prueba.mjs   (PHONE_URL y VISOR_URL se pueden cambiar para probar el worker de vista previa)
import fs from 'node:fs';
import crypto from 'node:crypto';

const S = fs.readFileSync('/tmp/pantalla/.sec/s', 'utf8');
const V = fs.readFileSync('/tmp/pantalla/.sec/v', 'utf8');
const FN = 'https://dwlbcbtwdungyrykgahm.supabase.co/functions/v1';
const PHONE_URL = process.env.PHONE_URL || FN + '/sinpe-pantalla';
const VISOR_URL = process.env.VISOR_URL || FN + '/sinpe-pantalla-visor';
const ORIGIN = process.env.ORIGIN || 'https://pagos.dmalabomba.com';
const ADMIN = 'cd0a5000-ca9e-4389-a432-6908a80e57d3';
const OTRO = 'ad4cb95a-2086-41df-bc71-214675e8a0d3';
const EMP = 'pollos';

const hmac = (k, t) => crypto.createHmac('sha256', k).update(t).digest('hex');
const b64u = (s) => Buffer.from(s).toString('base64url');
const ficha = (u, e = Date.now() + 600000, clave = V) => { const c = b64u(JSON.stringify({ u, e })); return `v1.${c}.${hmac(clave, 'v1.' + c)}`; };
const f = (n) => fs.readFileSync(`/tmp/pantalla/frames/f${n}.b64`, 'utf8');

let ok = 0, mal = 0;
const check = (nombre, cond, extra = '') => { if (cond) { ok++; console.log('PASS', nombre, extra); } else { mal++; console.log('FAIL', nombre, extra); } };

async function tel(cuerpo, { firma, texto, sinFirma } = {}) {
  const t = texto ?? JSON.stringify(cuerpo);
  const h = { 'Content-Type': 'application/json' };
  if (!sinFirma) h['X-Signature'] = firma ?? hmac(S, t);
  const r = await fetch(PHONE_URL, { method: 'POST', headers: h, body: t });
  const txt = await r.text();
  let j = null; try { j = JSON.parse(txt); } catch {}
  const sig = r.headers.get('x-signature');
  const sigOk = !!sig && sig === hmac(S, txt);
  return { status: r.status, j, sigOk, sig, txt };
}
const base = (fase, extra = {}) => ({ tipo: 'pantalla', fase, ts: Date.now(), empresa: EMP, app: '2.10.0', ...extra });
async function visor(op, extra = {}, token) {
  const r = await fetch(VISOR_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ op, token, ...extra }) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j, cors: r.headers.get('access-control-allow-origin') };
}

const T = ficha(ADMIN);
// ---- limpieza previa: cerrar cualquier sesion de prueba abierta
{ const a = await visor('abrir', { empresa: EMP }, T); if (a.j?.sid) await visor('cerrar', { sid: a.j.sid }, T); }

// ---- telefono: autenticacion
{
  if (process.env.NEG !== '0') {
    const r1 = await tel(base('escucha'), { sinFirma: true }); check('sin firma -> 401', r1.status === 401, r1.status);
    const r2 = await tel(base('escucha'), { firma: 'a'.repeat(64) }); check('firma invalida -> 401', r2.status === 401, r2.status);
  }
  const viejo = base('escucha'); viejo.ts = Date.now() - 400000;
  const r3 = await tel(viejo); check('ts viejo -> 409 y respuesta firmada', r3.status === 409 && r3.sigOk, `${r3.status} firmaOk=${r3.sigOk}`);
  const r4 = await tel({ ...base('escucha'), tipo: 'latido' }); check('tipo distinto -> 400', r4.status === 400, r4.status);
  const r5 = await tel({ ...base('escucha'), empresa: 'x' }); check('empresa invalida -> 400', r5.status === 400, r5.status);
  const grande = JSON.stringify({ ...base('cuadro', { sid: crypto.randomUUID(), seq: 1, w: 540, h: 1170 }), jpg: 'A'.repeat(300 * 1024) });
  const r6 = await fetch(PHONE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Signature': hmac(S, grande) }, body: grande });
  check('cuerpo > 256 KB -> 413', r6.status === 413, r6.status);
  const r7 = await fetch(PHONE_URL, { method: 'GET' }); check('GET -> 405', r7.status === 405, r7.status);
}
// ---- sin sesion: no se guarda nada
{
  const e = base('escucha', { pantalla_encendida: true, bloqueada: false });
  const r = await tel(e);
  check('escucha sin sesion -> sesion:false, firmada, eco', r.status === 200 && r.j?.sesion === false && r.sigOk && r.j?.eco === e.ts, JSON.stringify(r.j));
  const c = base('cuadro', { sid: crypto.randomUUID(), seq: 1, w: 540, h: 1170, jpg: f(0), sin_cambio: false });
  const rc = await tel(c);
  check('cuadro sin sesion -> sesion:false (no se guarda)', rc.status === 200 && rc.j?.sesion === false && rc.sigOk, JSON.stringify(rc.j));
}
// ---- visor: autenticacion
{
  const a = await visor('abrir', { empresa: EMP }); check('visor sin ficha -> 401', a.status === 401, a.status);
  const b = await visor('abrir', { empresa: EMP }, ficha(ADMIN, Date.now() + 600000, 'otra-clave')); check('ficha falsificada -> 401', b.status === 401, b.status);
  const c = await visor('abrir', { empresa: EMP }, ficha(ADMIN, Date.now() - 1000)); check('ficha vencida -> 401 vencida', c.status === 401 && c.j?.vencida === true, JSON.stringify(c.j));
  const d = await visor('abrir', { empresa: EMP }, ficha(OTRO)); check('usuario NO administrador general -> 403', d.status === 403 && d.j?.ok === false, `${d.status} ${JSON.stringify(d.j)}`);
  const e = process.env.NEG === '0' ? { status: 401 } : await visor('entrar', { usuario: 'noexiste', pin: '0000' }); check('login con usuario inexistente -> 401 (tras espera)', e.status === 401 || e.status === 429, `${e.status} ${JSON.stringify(e.j)}`);
  const g = await visor('entrar', { usuario: 'x', pin: '1' }); check('login con usuario invalido -> 400', g.status === 400, g.status);
}
// ---- sesion completa
let sid;
{
  const a = await visor('abrir', { empresa: EMP }, T);
  check('abrir sesion (administrador)', a.status === 200 && a.j?.ok && a.j?.sid && a.j?.resta_s > 590, JSON.stringify(a.j));
  sid = a.j.sid;
  check('cors del visor para pagos.dmalabomba.com', a.cors === ORIGIN || ORIGIN.startsWith('http://') , String(a.cors));
  const a2 = await visor('abrir', { empresa: EMP }, T); check('segunda apertura reutiliza la sesion', a2.j?.sid === sid && a2.j?.reutilizada === true);
  const e = await tel(base('escucha'));
  check('escucha con sesion -> sesion:true y sid', e.j?.sesion === true && e.j?.sid === sid && e.sigOk, JSON.stringify(e.j));
  const c1 = base('cuadro', { sid, seq: 1, w: 540, h: 1170, jpg: f(0), sin_cambio: false, pantalla_encendida: true, bloqueada: false });
  const r1 = await tel(c1); check('cuadro guardado', r1.j?.ok && r1.j?.sesion === true && Array.isArray(r1.j.acciones) && r1.sigOk, JSON.stringify(r1.j));
  const l = await visor('leer', { sid, desde: -1 }, T);
  check('visor lee el cuadro (con imagen)', l.j?.viva && l.j?.cuadro?.jpg === f(0) && l.j.cuadro.w === 540, `seq=${l.j?.cuadro?.seq} edad=${l.j?.cuadro?.edad_s}`);
  const l2 = await visor('leer', { sid, desde: 1 }, T);
  check('lectura con el mismo seq no repite la imagen', l2.j?.cuadro && !('jpg' in l2.j.cuadro));
  // acciones desde el visor
  const t1 = await visor('accion', { sid, a: 'toque', params: { x: 0.5, y: 0.8 } }, T);
  const t2 = await visor('accion', { sid, a: 'deslizar', params: { x1: 0.5, y1: 0.8, x2: 0.5, y2: 0.2, ms: 300 } }, T);
  const t3 = await visor('accion', { sid, a: 'texto', params: { t: 'hola 123' } }, T);
  const t4 = await visor('accion', { sid, a: 'atras' }, T);
  check('acciones validas encoladas', [t1, t2, t3, t4].every((x) => x.j?.ok), [t1, t2, t3, t4].map((x) => x.j?.id).join(','));
  const m1 = await visor('accion', { sid, a: 'toque', params: { x: 2, y: 0.5 } }, T);
  const m2 = await visor('accion', { sid, a: 'apagar' }, T);
  const m3 = await visor('accion', { sid, a: 'texto', params: { t: 'x'.repeat(201) } }, T);
  check('acciones invalidas rechazadas', !m1.j?.ok && !m2.j?.ok && !m3.j?.ok, [m1, m2, m3].map((x) => x.j?.error).join(' | '));
  const c2 = base('cuadro', { sid, seq: 2, w: 540, h: 1170, jpg: f(1), sin_cambio: false, pantalla_encendida: true, bloqueada: false });
  const r2 = await tel(c2);
  const ids = (r2.j?.acciones || []).map((x) => x.id);
  check('el telefono recibe las 4 acciones (firmadas)', ids.length === 4 && r2.sigOk && r2.j.acciones[2].t === 'hola 123' && r2.j.acciones[0].a === 'toque', JSON.stringify(r2.j?.acciones));
  const r2b = await tel(base('cuadro', { sid, seq: 3, w: 540, h: 1170, sin_cambio: true }));
  check('sin reconfirmar, dentro de 6 s no se reentregan', (r2b.j?.acciones || []).length === 0, JSON.stringify(r2b.j?.acciones));
  await new Promise((r) => setTimeout(r, 6500));
  const r2c = await tel(base('cuadro', { sid, seq: 4, w: 540, h: 1170, sin_cambio: true }));
  check('tras 6 s sin confirmar se reentregan (el telefono ejecuta cada id una vez)', (r2c.j?.acciones || []).length === 4, String((r2c.j?.acciones || []).length));
  const r3 = await tel(base('cuadro', { sid, seq: 5, w: 540, h: 1170, jpg: f(2), sin_cambio: false, confirmadas: ids, resultados: { [ids[0]]: 'ok', [ids[1]]: 'ok', [ids[2]]: 'ok', [ids[3]]: 'fallo' } }));
  check('confirmadas: no vuelven a salir', (r3.j?.acciones || []).length === 0 && r3.j?.sesion === true, JSON.stringify(r3.j));
  const l3 = await visor('leer', { sid, desde: -1 }, T);
  check('visor ve resultados y pendientes 0', l3.j?.pendientes === 0 && l3.j?.ultimas?.length >= 4, JSON.stringify(l3.j?.ultimas));
  const pr = await visor('prorrogar', { sid }, T); check('prorrogar', pr.j?.ok && pr.j?.resta_s > 590, JSON.stringify(pr.j));
  const nt = await tel({ ...base('cuadro', { sid, seq: 6, w: 540, h: 1170 }), jpg: '!!no-es-base64!!' }); check('imagen no base64 -> 400', nt.status === 400, nt.status);
  const cl = await visor('cerrar', { sid }, T); check('cerrar', cl.j?.ok && cl.j?.cerrada, JSON.stringify(cl.j));
  const r4 = await tel(base('escucha')); check('tras cerrar el telefono sale del modo rapido (sesion:false)', r4.j?.sesion === false);
  const r5 = await tel(base('cuadro', { sid, seq: 7, w: 540, h: 1170, jpg: f(0) })); check('cuadro tras cerrar no se guarda', r5.j?.sesion === false);
  const l4 = await visor('leer', { sid, desde: -1 }, T); check('visor: sesion cerrada, sin cuadro', l4.j?.viva === false && !l4.j?.cuadro, JSON.stringify(l4.j?.motivo_cierre));
}
console.log(`\nSID=${sid}\nRESULTADO: ${ok} bien, ${mal} mal`);
process.exit(mal ? 1 : 0);
