// Pruebas con Chrome REAL de la ruta por IP y de la direccion alterna del kit v3.9 (con el DNS falso del ejecutor imitando el NXDOMAIN del 28 nov).
//   node "prueba chrome ruta dns.mjs" preparar PERFIL               -> con DNS normal: abre el facturador, deja guardada su copia (service worker) y una marca en el almacenamiento local
//   node "prueba chrome ruta dns.mjs" pin      PERFIL IP CLAVE      -> con facturacion.dmalabomba.com bloqueado en el DNS: sin la ruta falla; con --host-resolver-rules abre el MISMO origen con la marca intacta
//   node "prueba chrome ruta dns.mjs" alterna  PERFIL CLAVE         -> con facturacion.dmalabomba.com bloqueado y www sin bloquear: la direccion alterna abre, es OTRO origen (sin la marca) y Supabase acepta su origen (CORS)
import { chromium } from 'playwright';
import fs from 'node:fs';
fs.mkdirSync('resultados', { recursive: true });
const salida = []; const dice = (t) => { const l = new Date().toISOString().slice(11, 19) + '  ' + t; console.log(l); salida.push(l); };
let fallos = 0; const ok = (c, t) => { if (!c) fallos++; dice((c ? 'OK     ' : 'FALLO  ') + t); };
const [modo, perfil, a3, a4] = process.argv.slice(2);
const SUBDOMINIO = 'https://facturacion.dmalabomba.com/'; const ALTERNA = 'https://www.dmalabomba.com/facturacion/';
const SUPA = 'https://dwlbcbtwdungyrykgahm.supabase.co';
const abrir = (dir, args = []) => chromium.launchPersistentContext(dir, { channel: 'chrome', headless: true, args });
const cors = (p, clave) => p.evaluate(async ([u, k]) => { try { const r = await fetch(u + '/functions/v1/facturador-acceso', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: k }, body: '{}' }); return { ok: true, status: r.status }; } catch (e) { return { ok: false, error: String(e) }; } }, [SUPA, modo === 'pin' ? a4 : a3]);
async function ir(p, url) { try { await p.goto(url, { waitUntil: 'load', timeout: 45000 }); return ''; } catch (e) { return e.message.split('\n')[0]; } }
try {
  if (modo === 'preparar') {
    const ctx = await abrir(perfil); const p = await ctx.newPage();
    const err = await ir(p, SUBDOMINIO); ok(err === '', 'con DNS normal el facturador abre en ' + SUBDOMINIO + (err ? ' (' + err + ')' : ''));
    await p.evaluate(async () => { await navigator.serviceWorker.ready; });
    await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(2000);
    ok(await p.evaluate(() => !!navigator.serviceWorker.controller), 'el service worker controla la pagina (guarda la copia)');
    await p.evaluate(() => localStorage.setItem('fx_marca_prueba', 'sesion-de-la-cajera'));
    ok((await p.title()).includes('Facturaci'), 'titulo ' + (await p.title()));
    await ctx.close();
  } else if (modo === 'pin') {
    const ip = a3;
    // 1) sin la ruta, en un perfil nuevo: el navegador no puede llegar (es lo que vio la cajera: DNS_PROBE_FINISHED_NXDOMAIN / ERR_NAME_NOT_RESOLVED)
    const vacio = perfil + '-sin-ruta'; const c0 = await abrir(vacio); const p0 = await c0.newPage();
    const e0 = await ir(p0, SUBDOMINIO);
    ok(/ERR_NAME_NOT_RESOLVED|ERR_NAME|DNS/.test(e0), 'sin la ruta (perfil nuevo) el nombre no resuelve: ' + e0);
    await c0.close();
    // 2) con la copia guardada y sin la ruta (la ruta 2 de la v3.8): abre desde el service worker
    const c1 = await abrir(perfil); const p1 = await c1.newPage();
    const e1 = await ir(p1, SUBDOMINIO); const t1 = e1 ? '' : await p1.title();
    ok(t1.includes('Facturaci'), 'copia guardada sin la ruta: abre el facturador desde el service worker (' + (e1 || t1) + ')');
    await c1.close();
    // 3) con la IP fijada (ruta por IP): mismo origen, pagina fresca de la red, marca intacta, Supabase acepta el origen
    const c2 = await abrir(perfil, ['--host-resolver-rules=MAP facturacion.dmalabomba.com ' + ip]); const p2 = await c2.newPage();
    const e2 = await ir(p2, SUBDOMINIO);
    ok(e2 === '', 'con --host-resolver-rules el facturador carga por la IP ' + ip + (e2 ? ' (' + e2 + ')' : ''));
    ok((await p2.title()).includes('Facturaci'), 'es la pagina real del facturador: ' + (await p2.title()));
    ok(await p2.evaluate(() => location.origin) === 'https://facturacion.dmalabomba.com', 'el origen sigue siendo https://facturacion.dmalabomba.com (certificado validado contra el nombre, sin cambiar de direccion)');
    ok(await p2.evaluate(() => localStorage.getItem('fx_marca_prueba')) === 'sesion-de-la-cajera', 'el almacenamiento local (sesion, aparato, impresion) del mismo perfil sigue ahi');
    const r = await cors(p2, a4); ok(r.ok, 'Supabase acepta el origen de la caja por la ruta por IP (CORS): ' + JSON.stringify(r));
    await p2.screenshot({ path: 'resultados/ruta por ip facturador.png' });
    await c2.close();
  } else if (modo === 'alterna') {
    const clave = a3;
    const ctx = await abrir(perfil); const p = await ctx.newPage();
    const e = await ir(p, ALTERNA); ok(e === '', 'la direccion alterna abre con facturacion.dmalabomba.com sin resolver' + (e ? ' (' + e + ')' : ''));
    ok((await p.title()).includes('Facturaci'), 'es el facturador: ' + (await p.title()));
    ok(await p.evaluate(() => location.origin) === 'https://www.dmalabomba.com', 'el origen es OTRO: https://www.dmalabomba.com');
    ok(await p.evaluate(() => localStorage.getItem('fx_marca_prueba')) === null, 'el almacenamiento local del subdominio NO se comparte: la cajera debe ingresar de nuevo en la alterna');
    const r = await cors(p, clave); ok(r.ok, 'Supabase acepta el origen www (CORS): ' + JSON.stringify(r));
    const cli = await ir(p, 'https://www.dmalabomba.com/facturacion/cliente/'); ok(cli === '', 'la pantalla del cliente tambien abre en la alterna (mismo origen que la caja)' + (cli ? ' (' + cli + ')' : ''));
    await p.screenshot({ path: 'resultados/alterna cliente.png' });
    await ctx.close();
  } else { throw new Error('modo desconocido'); }
} catch (e) { fallos++; dice('FALLO  error: ' + e.message); }
dice('Chrome ruta DNS (' + modo + '): ' + (fallos === 0 ? 'TODAS OK' : 'FALLARON ' + fallos));
fs.appendFileSync('resultados/prueba chrome ruta dns.txt', salida.join('\n') + '\n');
process.exit(fallos ? 1 : 0);
