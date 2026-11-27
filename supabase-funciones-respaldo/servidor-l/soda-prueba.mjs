import fs from 'node:fs'; import crypto from 'node:crypto';
const K = fs.readFileSync('/tmp/pantalla/.sec/k', 'utf8'); const P = fs.readFileSync('/tmp/pantalla/.sec/s', 'utf8');
const URL_ = 'https://dwlbcbtwdungyrykgahm.supabase.co/functions/v1/sinpe-recibir/latido';
const h = (k, t) => crypto.createHmac('sha256', k).update(t).digest('hex');
for (const [emp, k] of [['soda', K], ['pollos', P]]) {
  const t = JSON.stringify({ tipo: 'latido', ts: Date.now(), empresa: emp, telefono: `prueba-l-${emp}`, bateria: 77, detalle: { app: '2.11.0' } });
  const r = await fetch(URL_, { method: 'POST', headers: { 'X-Signature': h(k, t) }, body: t }); const b = Buffer.from(await r.arrayBuffer());
  const f = r.headers.get('x-signature');
  console.log(emp, r.status, 'cuerpo_ok=' + (JSON.parse(b.toString()).ok === true), 'x-signature=' + (f ? (f === h(k, b) ? 'presente y VALIDA' : 'presente e INVALIDA') : 'ausente'));
}
