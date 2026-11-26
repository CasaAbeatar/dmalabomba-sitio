// Prueba del servidor 2.12 (latido con salud, alertas, ordenes adb, actualizacion firmada). Empresa pollos (sin datos reales de Soda). Telefono simulado: prueba-212-sim
import fs from 'node:fs'; import crypto from 'node:crypto';
const S = fs.readFileSync('/tmp/pantalla/.sec/s', 'utf8');
const URL_ = (process.env.FN || 'https://dwlbcbtwdungyrykgahm.supabase.co/functions/v1') + '/sinpe-recibir';
const hmac = (k, t) => crypto.createHmac('sha256', k).update(t).digest('hex');
let ok = 0, mal = 0; const check = (n, c, e = '') => { if (c) { ok++; console.log('PASS', n, e); } else { mal++; console.log('FAIL', n, e); } };
export async function latido(detalle, { bateria = 80, tel = 'prueba-212-sim', hechos } = {}) {
  const ts = Date.now(); const d = { ...detalle }; if (hechos) d.comandos_hechos = hechos;
  const cuerpo = { tipo: 'latido', ts, empresa: 'pollos', telefono: tel, bateria, detalle: d };
  const t = JSON.stringify(cuerpo);
  const r = await fetch(URL_ + '/latido', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Signature': hmac(S, t) }, body: t });
  return { status: r.status, j: await r.json().catch(() => null), ts };
}
if ((process.argv[1] || '').endsWith('prueba-212.mjs')) {
  let r = await latido({ app: '2.12.0', cargando: false, carga: { cargando: true }, red: { tipo: 'wifi', validada: true, senal: 3 }, sms: { inbox_ultimo_ms: 0, sin_reenviar: 0 }, actualizacion_estado: 'ninguna', x: 'basura' });
  check('latido 2.12 -> 200 ok', r.status === 200 && r.j?.ok === true && Array.isArray(r.j.comandos), JSON.stringify(r.j));
  check('sin actualizacion activa no hay campo', !('actualizacion' in (r.j || {})));
  r = await latido({ app: '2.11.0', cargando: true });
  check('latido 2.11 compatible', r.status === 200 && r.j?.ok === true);
  console.log(`${ok} PASS, ${mal} FAIL`); process.exit(mal ? 1 : 0);
}
