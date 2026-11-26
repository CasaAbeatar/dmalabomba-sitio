// Pruebas del servidor de la pantalla remota (fork E, 25 nov 2026). Simula el telefono de POLLOS (PRUEBA) con su clave propia.
// Uso: PK=<archivo con la clave de Pollos> node prueba-servidor-e.mjs  (la clave maestra de Soda no se usa aqui: se prueba con firmas hechas en la base)
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
const URL_ = 'https://dwlbcbtwdungyrykgahm.supabase.co/functions/v1/sinpe-pantalla';
const K = readFileSync(process.env.PK, 'utf8').trim();
const firma = (k, t) => createHmac('sha256', k).update(t).digest('hex');
let n = 0, bien = 0;
const ok = (c, m, x = '') => { n++; if (c) bien++; console.log((c ? 'OK   ' : 'FALLA') + ' ' + m + (x ? ' -> ' + x : '')); };
async function enviar(cuerpo, key = K, firmaForzada = null) {
  const t = JSON.stringify(cuerpo);
  const r = await fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Signature': firmaForzada ?? firma(key, t) }, body: t });
  const txt = await r.text();
  let j = null; try { j = JSON.parse(txt); } catch {}
  return { st: r.status, j, txt, sig: r.headers.get('x-signature'), t };
}
const base = (extra = {}) => ({ tipo: 'pantalla', empresa: 'pollos', ts: Date.now(), ...extra });
let ultimoTs = Date.now();
const ts = () => (ultimoTs = Math.max(ultimoTs + 1, Date.now()));

// escucha valida: respuesta firmada con la clave de Pollos y eco = ts
let c = base({ fase: 'escucha', ts: ts(), pantalla_encendida: true, bloqueada: false });
let r = await enviar(c);
ok(r.st === 200 && r.j?.ok === true, 'escucha con la clave de Pollos', r.txt.slice(0, 80));
ok(r.sig === firma(K, r.txt), 'la respuesta viene firmada con la clave de Pollos');
ok(r.j?.eco === c.ts, 'eco = ts de la peticion');
// repeticion exacta (mismo cuerpo y firma): rechazada
const rep = await enviar(c);
ok(rep.st === 409 && rep.j?.error === 'repetida', 'repeticion exacta rechazada (409 repetida)', rep.txt.slice(0, 80));
// ts menor al ultimo aceptado
const viejo = await enviar(base({ fase: 'escucha', ts: c.ts - 5000 }));
ok(viejo.st === 409 && viejo.j?.error === 'repetida', 'ts anterior al ultimo aceptado rechazado', viejo.txt.slice(0, 60));
// la clave maestra (la de Soda) no vale para Pollos: se prueba con la firma de la base, ver prueba-sql
// cuerpo de Soda firmado con la clave de Pollos: rechazado
const sodaConPollos = await enviar(base({ empresa: 'soda', fase: 'escucha', ts: ts() }));
ok(sodaConPollos.st === 401, 'cuerpo de Soda firmado con la clave de Pollos -> 401', sodaConPollos.txt.slice(0, 60));
// firma mala
const mala = await enviar(base({ fase: 'escucha', ts: ts() }), K, 'a'.repeat(64));
ok(mala.st === 401, 'firma invalida -> 401');
// sid desconocido: sin sesion, sin error
const SID = '00000000-0000-4000-8000-00000000e0e0';
const cu = await enviar(base({ fase: 'cuadro', ts: ts(), sid: SID, seq: 1, w: 540, h: 1170, jpg: 'QUJDREVGR0g=', pantalla_encendida: true, bloqueada: false }));
ok(cu.st === 200 && cu.j?.sesion === false, 'cuadro con sid desconocido: sesion=false', cu.txt.slice(0, 80));
ok(cu.j?.eco !== undefined && cu.sig === firma(K, cu.txt), 'respuesta de cuadro firmada con eco');
const fi = await enviar(base({ fase: 'fin', ts: ts(), sid: SID }));
ok(fi.st === 200 && fi.j?.ok === true, 'fin con sid desconocido', fi.txt.slice(0, 60));
const fase = await enviar(base({ fase: 'otra', ts: ts() }));
ok(fase.st === 400, 'fase invalida -> 400');
console.log(`\n${bien}/${n} pruebas bien`);
process.exit(bien === n ? 0 : 1);
