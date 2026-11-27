// Pruebas con Chrome REAL de la contingencia del facturador (v3.8).
//   node "prueba chrome contingencia.mjs" preparar  PERFIL   -> abre el facturador (copia del repo en http://localhost:8196) con internet para que el service worker guarde su copia
//   node "prueba chrome contingencia.mjs" offline   PERFIL   -> con el servidor APAGADO: un perfil que ya guardo la copia abre el facturador; un perfil nuevo no
//   node "prueba chrome contingencia.mjs" pagina             -> la pantalla de contingencia que sirve el servidor local del kit (127.0.0.1:8766): reintenta sola y vuelve al facturador real cuando el estado pasa a ok
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { execSync } from 'node:child_process';
fs.mkdirSync('resultados', { recursive: true });
const salida = []; const dice = (t) => { const l = new Date().toISOString().slice(11, 19) + '  ' + t; console.log(l); salida.push(l); };
let fallos = 0; const ok = (c, t) => { if (!c) fallos++; dice((c ? 'OK     ' : 'FALLO  ') + t); };
const modo = process.argv[2]; const perfil = process.argv[3];
const RAIZ = path.resolve('..', 'facturacion'); const PUERTO = 8196;
const tipos = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon', '.svg': 'image/svg+xml' };
function servidor() { return new Promise((r) => { const s = http.createServer((q, res) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'; const f = path.join(RAIZ, p); if (!f.startsWith(RAIZ) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('no'); return; } res.writeHead(200, { 'Content-Type': tipos[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); }); s.listen(PUERTO, '127.0.0.1', () => r(s)); }); }
const abrir = (dir) => chromium.launchPersistentContext(dir, { channel: 'chrome', headless: true });
try {
  if (modo === 'preparar') {
    const s = await servidor(); const ctx = await abrir(perfil); const p = await ctx.newPage();
    await p.goto(`http://localhost:${PUERTO}/`, { waitUntil: 'load' });
    await p.evaluate(async () => { await navigator.serviceWorker.ready; });
    await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(2000);
    ok(await p.evaluate(() => !!navigator.serviceWorker.controller), 'con internet: el service worker del facturador controla la pagina (guarda la copia)');
    ok((await p.title()).includes('Facturaci'), 'con internet: titulo ' + (await p.title()));
    await ctx.close(); await new Promise((r) => s.close(r));
  } else if (modo === 'offline') {
    // servidor apagado (nadie escucha en el puerto): es lo que pasa cuando el dominio no resuelve
    const ctx = await abrir(perfil); const p = await ctx.newPage();
    let titulo = ''; try { await p.goto(`http://localhost:${PUERTO}/`, { waitUntil: 'load', timeout: 20000 }); titulo = await p.title(); } catch (e) { titulo = 'ERROR ' + e.message.split('\n')[0]; }
    ok(titulo.includes('Facturaci'), 'perfil con copia y sin servidor: el navegador abre el facturador desde la copia guardada (' + titulo + ')');
    await ctx.close();
    const vacio = perfil + '-vacio'; const ctx2 = await abrir(vacio); const p2 = await ctx2.newPage();
    let t2 = ''; try { await p2.goto(`http://localhost:${PUERTO}/`, { waitUntil: 'load', timeout: 20000 }); t2 = await p2.title(); } catch (e) { t2 = 'ERROR ' + e.message.split('\n')[0]; }
    ok(t2.startsWith('ERROR'), 'perfil nuevo y sin servidor: no abre nada (por eso existe la pantalla de contingencia) (' + t2 + ')');
    await ctx2.close();
  } else if (modo === 'pagina') {
    const estado = 'C:\\PantallaCliente\\datos\\facturador.json';
    const escribir = (okv, motivo, modoF) => execSync(`powershell -NoProfile -ExecutionPolicy Bypass -Command ". 'C:\\PantallaCliente\\funciones contingencia.ps1'; Guardar-Estado-Facturador ([pscustomobject]@{ ok = $${okv}; motivo = '${motivo}' }) '${modoF}' '${estado}'"`);
    escribir('false', 'dns', 'contingencia');
    const ctx = await abrir(perfil || 'C:\\perfil-pagina'); const p = await ctx.newPage();
    await p.goto('http://127.0.0.1:8766/contingencia/', { waitUntil: 'load' });
    await p.waitForTimeout(2500);
    ok((await p.title()) === 'Sin conexión al facturador', 'la pantalla local abre con su titulo (' + (await p.title()) + ')');
    const est = await p.textContent('#est');
    ok(/Sin conexi/.test(est) && /DNS/.test(est), 'muestra el motivo de la caida en lenguaje claro: ' + est);
    ok(p.url().startsWith('http://127.0.0.1:8766/contingencia/'), 'mientras el facturador sigue caido se queda en la pantalla de contingencia');
    escribir('true', 'ok', 'normal');
    await p.click('#b1');
    await p.waitForURL('https://facturacion.dmalabomba.com/**', { timeout: 30000 }).catch(() => {});
    await p.waitForTimeout(2500);
    ok(p.url().startsWith('https://facturacion.dmalabomba.com/'), 'cuando el estado pasa a ok la pantalla va sola al facturador (' + p.url() + ')');
    ok((await p.title()).includes('Facturaci'), 'y es el facturador real (' + (await p.title()) + ')');
    await ctx.close();
  } else { throw new Error('modo desconocido'); }
} catch (e) { fallos++; dice('FALLO  error: ' + e.message); }
dice('Chrome contingencia (' + modo + '): ' + (fallos === 0 ? 'TODAS OK' : 'FALLARON ' + fallos));
fs.appendFileSync('resultados/prueba chrome contingencia.txt', salida.join('\n') + '\n');
process.exit(fallos ? 1 : 0);
