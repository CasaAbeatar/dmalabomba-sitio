// Telefono simulado: escucha cada 4 s; en sesion manda cuadros cada ~0,8 s, ejecuta (finge) las acciones y las confirma.
import fs from 'node:fs'; import crypto from 'node:crypto';
const S = fs.readFileSync('/tmp/pantalla/.sec/s', 'utf8');
const URL_ = process.env.PHONE_URL;
const hmac = (k, t) => crypto.createHmac('sha256', k).update(t).digest('hex');
const f = (n) => fs.readFileSync(`/tmp/pantalla/frames/f${n}.b64`, 'utf8');
let sid = null, seq = 0, actual = 0, enviado = -1, conf = [], res = {}, hecho = new Set();
async function pedir(c) { const t = JSON.stringify(c); const r = await fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Signature': hmac(S, t) }, body: t }); const x = await r.text(); if (r.headers.get('x-signature') !== hmac(S, x)) throw new Error('respuesta sin firma valida'); const j = JSON.parse(x); if (j.eco !== c.ts) throw new Error('eco distinto'); return j; }
function ejecutar(a) { if (hecho.has(a.id)) { return; } hecho.add(a.id); console.log(new Date().toISOString(), 'ACCION', JSON.stringify(a).replace(/"t":"[^"]*"/, '"t":"<texto>"')); if (a.a === 'toque') actual = (actual + 1) % 3; if (a.a === 'atras' || a.a === 'inicio') actual = 0; conf.push(a.id); res[a.id] = 'ok'; }
const fin = Date.now() + 12 * 60_000;
while (Date.now() < fin) {
  try {
    if (!sid) {
      const j = await pedir({ tipo: 'pantalla', fase: 'escucha', ts: Date.now(), empresa: 'pollos', app: 'sim', pantalla_encendida: true, bloqueada: false });
      if (j.sesion) { sid = j.sid; seq = 0; enviado = -1; hecho.clear(); console.log('SESION', sid); (j.acciones || []).forEach(ejecutar); } else await new Promise((r) => setTimeout(r, 4000));
    } else {
      seq++;
      const cambio = enviado !== actual;
      const j = await pedir({ tipo: 'pantalla', fase: 'cuadro', ts: Date.now(), empresa: 'pollos', sid, seq, w: 540, h: 1170, ...(cambio ? { jpg: f(actual) } : { sin_cambio: true }), pantalla_encendida: true, bloqueada: false, confirmadas: conf, resultados: res });
      if (cambio) enviado = actual; conf = []; res = {};
      if (!j.sesion) { console.log('SESION TERMINADA'); sid = null; continue; }
      (j.acciones || []).forEach(ejecutar);
      await new Promise((r) => setTimeout(r, 800));
    }
  } catch (e) { console.log('ERROR', e.message); await new Promise((r) => setTimeout(r, 2000)); }
}
