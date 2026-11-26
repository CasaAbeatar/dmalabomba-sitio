// abrir_ajuste, salud y adb a traves del worker (vista previa o produccion). Empresa pollos. Uso: PHONE_URL=.../pantalla VISOR_URL=.../remoto/api ORIGIN=... node prueba-visor-212.mjs
import fs from 'node:fs'; import crypto from 'node:crypto';
const S = fs.readFileSync('/tmp/pantalla/.sec/s', 'utf8'), V = fs.readFileSync('/tmp/pantalla/.sec/v', 'utf8');
const B = process.env.BASE || 'https://vista-pantalla.sinpe-pagos.pages.dev';
const PHONE_URL = process.env.PHONE_URL || B + '/pantalla', VISOR_URL = process.env.VISOR_URL || B + '/remoto/api', ORIGIN = process.env.ORIGIN || B;
const ADMIN = 'cd0a5000-ca9e-4389-a432-6908a80e57d3', OTRO = 'ad4cb95a-2086-41df-bc71-214675e8a0d3', EMP = 'pollos';
const hmac = (k, t) => crypto.createHmac('sha256', k).update(t).digest('hex');
const b64u = (s) => Buffer.from(s).toString('base64url');
const ficha = (u) => { const c = b64u(JSON.stringify({ u, e: Date.now() + 600000 })); return `v1.${c}.${hmac(V, 'v1.' + c)}`; };
let ok = 0, mal = 0; const check = (n, c, e = '') => { if (c) { ok++; console.log('PASS', n, e); } else { mal++; console.log('FAIL', n, e); } };
async function tel(c) { const t = JSON.stringify(c); const r = await fetch(PHONE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Signature': hmac(S, t) }, body: t }); return r.json(); }
async function visor(op, extra, token) { const r = await fetch(VISOR_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ op, token, ...extra }) }); return { status: r.status, j: await r.json().catch(() => null) }; }
const T = ficha(ADMIN), TO = ficha(OTRO);
const f0 = fs.readFileSync('/tmp/pantalla/frames/f0.b64', 'utf8');
{ const a = await visor('abrir', { empresa: EMP }, T); if (a.j?.sid) await visor('cerrar', { sid: a.j.sid }, T); }
const a = await visor('abrir', { empresa: EMP }, T); const sid = a.j?.sid; check('abrir sesion', !!sid);
await tel({ tipo: 'pantalla', fase: 'escucha', ts: Date.now(), empresa: EMP, app: '2.12.0' });
const c1 = await tel({ tipo: 'pantalla', fase: 'cuadro', ts: Date.now(), empresa: EMP, sid, seq: 1, w: 540, h: 1170, jpg: f0, pantalla_encendida: true, bloqueada: false });
check('cuadro guardado', c1.ok === true);
const rl = await visor('leer', { sid, desde: -1 }, T); const seq = rl.j?.cuadro?.seq;
const que = ['bateria', 'app', 'acceso_notificaciones', 'accesibilidad', 'inicio_apps', 'ahorro_energia'];
const ids = [];
for (const q of que) { const r = await visor('accion', { sid, a: 'abrir_ajuste', params: { que: q }, cuadro_seq: seq }, T); check('abrir_ajuste ' + q, r.j?.ok === true, JSON.stringify(r.j)); ids.push(r.j?.id); }
for (const malo of [{ que: 'wifi' }, { que: 'bateria; rm -rf' }, { que: 5 }, {}, { que: ['bateria'] }]) { const r = await visor('accion', { sid, a: 'abrir_ajuste', params: malo, cuadro_seq: seq }, T); check('abrir_ajuste invalido ' + JSON.stringify(malo), r.j?.ok === false && r.j.error === 'ajuste no permitido', JSON.stringify(r.j)); }
const r2 = await visor('accion', { sid, a: 'abrir_ajuste', params: { que: 'bateria' }, cuadro_seq: seq }, TO); check('no administrador -> 403', r2.status === 403, r2.status);
const e = await tel({ tipo: 'pantalla', fase: 'cuadro', ts: Date.now(), empresa: EMP, sid, seq: 2, sin_cambio: true, pantalla_encendida: true, bloqueada: false });
const acc = e.acciones || [];
check('el telefono recibe abrir_ajuste con "que" y cuadro_seq', acc.length === 5 && acc.every((x) => x.a === 'abrir_ajuste' && que.includes(x.que) && x.cuadro_seq === seq), JSON.stringify(acc.slice(0, 2)));
const conf = acc.map((x) => x.id), res = Object.fromEntries(acc.map((x) => [x.id, 'ok:ACTION_IGNORE_BATTERY.1']));
const e2 = await tel({ tipo: 'pantalla', fase: 'cuadro', ts: Date.now(), empresa: EMP, sid, seq: 3, sin_cambio: true, pantalla_encendida: true, bloqueada: false, confirmadas: conf, resultados: res });
const rl2 = await visor('leer', { sid, desde: seq }, T);
check('el visor ve el resultado ok:<texto>', (rl2.j?.ultimas || []).some((x) => x.a === 'abrir_ajuste' && /^ok:/.test(x.resultado)), JSON.stringify(rl2.j?.ultimas?.[0]));
const sa = await visor('salud', { empresa: EMP }, T); check('salud admin ok (estructura)', sa.j?.ok === true && Array.isArray(sa.j.telefonos), JSON.stringify(sa.j).slice(0, 100));
const so = await visor('salud', { empresa: EMP }, TO); check('salud no admin 403', so.status === 403, so.status);
const sx = await visor('salud', { empresa: 'xx' }, T); check('salud empresa invalida', sx.j?.ok === false, JSON.stringify(sx.j));
const ad = await visor('adb', { empresa: EMP, telefono: 'prueba-212-sim', cmd: 'abrir' }, T); check('adb abrir (telefono 2.12)', ad.j?.ok === true && (ad.j.id || ad.j.duplicado), JSON.stringify(ad.j));
const ad2 = await visor('adb', { empresa: EMP, telefono: 'prueba-212-viejo', cmd: 'abrir' }, T); check('adb telefono con app anterior -> rechazado', ad2.j?.ok === false, JSON.stringify(ad2.j));
const ad3 = await visor('adb', { empresa: EMP, telefono: 'prueba-212-sim', cmd: 'abrir' }, TO); check('adb no admin 403', ad3.status === 403, ad3.status);
await visor('cerrar', { sid }, T);
console.log(`${ok} PASS, ${mal} FAIL`); process.exit(mal ? 1 : 0);
