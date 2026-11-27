// Prueba fork L: respuestas de latido firmadas (X-Signature = HMAC-SHA256 hex del cuerpo exacto), Pollos y Soda (telefono prueba-*, es_prueba).
// Uso: FN=https://.../functions/v1 SLUG=sinpe-recibir-prueba-l node prueba-firma.mjs
import fs from 'node:fs'; import crypto from 'node:crypto';
const KS = { pollos: fs.readFileSync('/tmp/pantalla/.sec/s', 'utf8'), soda: fs.readFileSync('/tmp/pantalla/.sec/k', 'utf8') };
const A = fs.readFileSync('/tmp/pantalla/.sec/a', 'utf8');
const BASE = process.env.FN || 'https://dwlbcbtwdungyrykgahm.supabase.co/functions/v1';
const URL_ = BASE + '/' + (process.env.SLUG || 'sinpe-recibir');
const hmac = (k, t) => crypto.createHmac('sha256', k).update(t).digest('hex');
let ok = 0, mal = 0; const check = (n, c, e = '') => { if (c) { ok++; console.log('PASS', n, e); } else { mal++; console.log('FAIL', n, e); } };
async function latido(emp, detalle, { tel, ts = Date.now(), clave = KS[emp] } = {}) {
  const cuerpo = { tipo: 'latido', ts, empresa: emp, telefono: tel || `prueba-l-${emp}`, bateria: 80, detalle };
  const t = JSON.stringify(cuerpo);
  const r = await fetch(URL_ + '/latido', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Signature': hmac(clave, t) }, body: t });
  const buf = Buffer.from(await r.arrayBuffer());
  return { status: r.status, buf, firma: r.headers.get('x-signature'), j: (() => { try { return JSON.parse(buf.toString('utf8')); } catch { return null; } })(), ts };
}
const valida = (emp, r) => r.firma && r.firma === hmac(KS[emp], r.buf);
for (const emp of ['pollos', 'soda']) {
  let r = await latido(emp, { app: '2.11.0', cargando: true });
  check(`${emp}: latido 200 ok`, r.status === 200 && r.j?.ok === true && Array.isArray(r.j.comandos), JSON.stringify(r.j));
  check(`${emp}: X-Signature presente, hex minuscula 64`, /^[0-9a-f]{64}$/.test(r.firma || ''), r.firma);
  check(`${emp}: firma recalculada sobre los bytes exactos coincide`, valida(emp, r));
  check(`${emp}: sin ordenes tambien firmada (comandos vacio)`, r.j?.comandos?.length === 0 && valida(emp, r));
  const otra = emp === 'pollos' ? 'soda' : 'pollos';
  check(`${emp}: NO coincide con la clave de la otra empresa`, r.firma !== hmac(KS[otra], r.buf));
  check(`${emp}: cuerpo con 1 byte distinto -> no valida`, r.firma !== hmac(KS[emp], Buffer.concat([r.buf, Buffer.from(' ')])));
}
// con orden pendiente (pollos): se crea una por SQL aparte? aqui solo verificamos compat: cuerpo JSON sin campos nuevos
let r = await latido('pollos', { app: '2.11.0' });
check('pollos: formato del cuerpo sin cambios (claves)', JSON.stringify(Object.keys(r.j).sort()) === JSON.stringify(['comandos', 'empresa', 'latido', 'ok']), Object.keys(r.j).join());
// error: firma mala sigue siendo 401 sin firma de respuesta
const t = JSON.stringify({ tipo: 'latido', ts: Date.now(), empresa: 'pollos', telefono: 'prueba-l-pollos', detalle: {} });
const e = await fetch(URL_ + '/latido', { method: 'POST', headers: { 'X-Signature': hmac('mala', t) }, body: t });
check('firma mala -> 401', e.status === 401);
// oferta de actualizacion (Pollos, fila de prueba)
const FNA = BASE + '/sinpe-actualizacion';
const act = async (b) => { const x = await fetch(FNA, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-actualizacion-secreto': A }, body: JSON.stringify(b) }); return { s: x.status, j: await x.json().catch(() => null) }; };
const URLAPK = 'https://pagos.dmalabomba.com/instalar/reenviador-sms-la-bomba-2.11.0.apk';
const SHA = '2163fad5f4c48f4030fbbe4fd8d53d90165b5c9f19de0f2498a7157c2852f8e1';
if (process.env.OFERTA !== '0') {
  let g = await act({ op: 'registrar', empresa: 'pollos', telefono: 'prueba-l-pollos', v: '2.12.0', vc: 22, url: URLAPK, sha256: SHA, nota: 'prueba fork L (apk 2.11.0 como maqueta)' });
  const id = g.j?.id; check('registrar fila de prueba', g.j?.ok === true, JSON.stringify(g.j));
  r = await latido('pollos', { app: '2.11.0' }); check('registrada sin activar: sin oferta', !r.j.actualizacion && valida('pollos', r));
  g = await act({ op: 'verificar', id }); check('verificar sha', g.j?.coincide === true, JSON.stringify(g.j));
  g = await act({ op: 'activar', id }); check('activar', g.j?.ok === true && g.j.activa === true, JSON.stringify(g.j));
  r = await latido('pollos', { app: '2.11.0' }); const u = r.j.actualizacion;
  check('oferta presente y respuesta firmada', !!u && u.vc === 22 && valida('pollos', r));
  check('ts de la oferta = emision (ahora, +-30 s)', !!u && Math.abs(Date.now() - u.ts) < 30000, String(u?.ts));
  check('firma ACT1 valida', !!u && u.firma === hmac(KS.pollos, ['ACT1', u.v, u.vc, u.url, u.sha256, u.ts, r.j.eco].join('|')));
  check('eco = ts del latido', r.j.eco === r.ts, `${r.j.eco} ${r.ts}`);
  g = await act({ op: 'desactivar', id }); check('desactivar', g.j?.ok === true, JSON.stringify(g.j));
  r = await latido('pollos', { app: '2.11.0' }); check('desactivada: sin oferta (firmada)', !r.j.actualizacion && valida('pollos', r));
}
console.log(`${ok} PASS, ${mal} FAIL`); process.exit(mal ? 1 : 0);
