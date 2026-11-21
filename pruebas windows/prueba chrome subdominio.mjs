// Prueba con Chrome REAL de Windows (con las directivas que escribio el paso 5 del kit v3.6): desde una pagina del subdominio y desde www,
// el navegador debe poder leer la publicidad del servidor local (127.0.0.1:8766); desde un sitio ajeno no.
import { chromium } from 'playwright';
import fs from 'node:fs';
fs.mkdirSync('resultados', { recursive: true });
const salida = [];
const dice = (t) => { const l = new Date().toISOString().slice(11, 19) + '  ' + t; console.log(l); salida.push(l); };
let fallos = 0;
const nav = await chromium.launch({ channel: 'chrome', headless: true });
dice('Chrome ' + nav.version());
async function leerDesde(pagina) {
  const ctx = await nav.newContext();
  const p = await ctx.newPage();
  try { await p.goto(pagina, { waitUntil: 'domcontentloaded', timeout: 45000 }); } catch (e) { dice('   (no cargo ' + pagina + ': ' + e.message.split('\n')[0] + ')'); }
  dice('   origen real de la pagina: ' + await p.evaluate(() => location.origin));
  const r = await p.evaluate(async () => {
    try { const x = await fetch('http://127.0.0.1:8766/lista?e=soda'); return { ok: true, status: x.status, acao: x.headers.get('access-control-allow-origin'), texto: (await x.text()).slice(0, 90) }; }
    catch (e) { return { ok: false, error: String(e) }; }
  });
  await ctx.close();
  return r;
}
const casos = [
  ['https://facturacion.dmalabomba.com/cliente/', true],
  ['https://www.dmalabomba.com/', true],
  ['https://example.com/', false],
];
for (const [url, debe] of casos) {
  const r = await leerDesde(url);
  const ok = debe ? (r.ok && r.status === 200) : !r.ok;
  if (!ok) fallos++;
  dice((ok ? 'OK     ' : 'FALLO  ') + 'fetch a la publicidad local desde ' + url + ' (debe ' + (debe ? 'poder' : 'NO poder') + '): ' + JSON.stringify(r));
}
await nav.close();
dice('Chrome real: ' + (fallos === 0 ? 'TODAS OK' : 'FALLARON ' + fallos));
fs.writeFileSync('resultados/prueba chrome subdominio.txt', salida.join('\n') + '\n');
process.exit(fallos ? 1 : 0);
