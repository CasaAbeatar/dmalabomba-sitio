// Pruebas de facturacion/js/pantalla_ventana.js en Chromium y WebKit (Playwright). Se corre desde la raiz del repo:
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node "pruebas ventana/prueba ventana.mjs"
const pw = await import('playwright').catch(() => import('/opt/npm-tools/node_modules/playwright/index.mjs'));
const { chromium, webkit } = pw.default?.chromium ? pw.default : pw;
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const raiz = path.resolve(process.cwd());
const tipos = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
const PAGINA = `<!doctype html><meta charset=utf-8><title>caja</title><script type=module>
import * as v from '/facturacion/js/pantalla_ventana.js'; window.v = v; window.llamadas = { abrir: [], fallar: [] };
window.iniciar = (o = {}) => v.abrirClienteEnOtraPantalla({ rutaCliente: '/__cliente.html', ...o, alAbrir: (i) => window.llamadas.abrir.push(i), alFallar: (m) => window.llamadas.fallar.push(m) });
window.listo = true;</script><body>caja</body>`;
const CLIENTE = `<!doctype html><meta charset=utf-8><title>cliente</title><body>cliente<script>
const c = new BroadcastChannel('lb-pantalla-cliente');
c.onmessage = (e) => { if (e.data && e.data.evento === 'latido') c.postMessage({ evento: 'ack', payload: { ts: Date.now() } }); };
c.postMessage({ evento: 'hola', payload: { ts: Date.now() } });</script>`;
const srv = http.createServer((q, r) => {
  const p = decodeURIComponent(q.url.split('?')[0]);
  if (p === '/__caja.html') { r.writeHead(200, { 'content-type': tipos['.html'] }); return r.end(PAGINA); }
  if (p === '/__cliente.html') { r.writeHead(200, { 'content-type': tipos['.html'] }); return r.end(CLIENTE); }
  const f = path.join(raiz, p);
  if (!f.startsWith(raiz) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
  r.writeHead(200, { 'content-type': tipos[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
const base = 'http://127.0.0.1:' + srv.address().port;

let total = 0, malas = 0;
const anotar = (nombre, ok, detalle = '') => { total++; if (!ok) malas++; console.log(ok ? 'OK   ' : 'FALLA', nombre, ok ? '' : detalle); };
const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));

// Pantallas del escenario: AON 1366x768 tactil principal (la caja) y HP 1920x1080 secundaria
const ESCENARIOS = {
  internaHP: { interna: true }, sinInternaHP: { interna: false },
};
function guion({ pantallas = 'dos', interna = true, api = true, permiso = 'ok', ventanaFalsa = false, extras = 0 } = {}) {
  return `(() => {
    const mk = (o) => Object.assign({ isPrimary: false, isInternal: false, label: '' }, o);
    const aon = mk({ label: 'AON TouchMax-156', left: 0, top: 0, width: 1366, height: 768, availLeft: 0, availTop: 0, availWidth: 1366, availHeight: 728, isPrimary: true });
    const hp = mk({ label: 'HP All-in-One', left: 1366, top: 0, width: 1920, height: 1080, availLeft: 1366, availTop: 0, availWidth: 1920, availHeight: 1080, isInternal: ${interna} });
    const det = new EventTarget(); det.screens = ${pantallas === 'una' ? '[aon]' : '[aon, hp]'}; det.currentScreen = aon;
    ${extras ? "det.screens.push(mk({ label: 'Monitor tercero', left: 3286, top: 0, width: 1920, height: 1080, availLeft: 3286, availTop: 0, availWidth: 1920, availHeight: 1080 }));" : ''}
    window.__det = det; window.__aon = aon; window.__hp = hp;
    window.__calls = { details: 0, open: [], consola: [] };
    for (const m of ['error', 'warn']) { const o = console[m].bind(console); console[m] = (...a) => { window.__calls.consola.push(a.join(' ')); o(...a); }; }
    Object.defineProperty(screen, 'isExtended', { configurable: true, get: () => ${pantallas === 'una' ? 'false' : 'true'} });
    ${api ? `window.getScreenDetails = async () => { window.__calls.details++; ${permiso === 'ok' ? 'return det;' : "throw new DOMException('Permission denied', 'NotAllowedError');"} };` : 'delete window.getScreenDetails;'}
    ${permiso === 'denegado' ? "navigator.permissions.query = async () => ({ state: 'denied' });" : permiso === 'pregunta' ? "const q0 = navigator.permissions.query.bind(navigator.permissions); navigator.permissions.query = async (o) => { if (o.name === 'window-management') return { state: 'prompt' }; return q0(o); };" : ''}
    const abrirReal = window.open.bind(window);
    window.open = (u, n, f) => {
      window.__calls.open.push({ u, n, f });
      ${ventanaFalsa ? `
      const w = { closed: false, screenX: 1366, screenY: 0, outerWidth: 1920, outerHeight: 1080, moves: [], sizes: [], fs: [], fsFalla: 0,
        focus() { w.enfocada = (w.enfocada || 0) + 1; }, close() { w.closed = true; w.cerrada = true; },
        moveTo(x, y) { w.moves.push([x, y]); w.screenX = x; w.screenY = y; }, resizeTo(a, b) { w.sizes.push([a, b]); w.outerWidth = a; w.outerHeight = b; },
        addEventListener() {},
        document: { fullscreenElement: null, exitFullscreen: async () => {}, documentElement: { requestFullscreen: async (o) => { w.fs.push(o && o.screen && o.screen.label); if (w.fsFalla > 0) { w.fsFalla--; throw new TypeError('gesto'); } w.document.fullscreenElement = {}; } } } };
      window.__w = w;
      setTimeout(() => { const c = new BroadcastChannel('lb-pantalla-cliente'); c.postMessage({ evento: 'hola', payload: {} }); setTimeout(() => c.close(), 50); }, 150);
      return w;` : 'return abrirReal(u, n, f);'}
    };
  })();`;
}

async function caso(tipo, nombre, opts, fn) {
  const nav = await tipo.launch();
  const ctx = await nav.newContext({ viewport: { width: 1366, height: 768 }, hasTouch: true });
  const pag = await ctx.newPage();
  const errores = [];
  pag.on('pageerror', (e) => errores.push(String(e)));
  pag.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errores.push(m.type() + ': ' + m.text()); });
  await pag.addInitScript(guion(opts));
  await pag.goto(base + '/__caja.html' + (opts.consulta || ''));
  await pag.waitForFunction(() => window.listo);
  try { await fn({ pag, ctx, errores }); } catch (e) { anotar(nombre + ' (excepcion de la prueba)', false, String(e).slice(0, 300)); }
  await nav.close();
}
const ev = (pag, f, a) => pag.evaluate(f, a);

// 1. Dos pantallas, HP interna: abre en la HP con las medidas de la HP, una sola ventana, el cliente contesta
await caso(chromium, 'dos pantallas con isInternal', { interna: true }, async ({ pag, ctx, errores }) => {
  const est = await ev(pag, () => window.iniciar());
  const ab = await ev(pag, () => window.__calls.open);
  anotar('Chromium, HP interna: abre una sola ventana', ab.length === 1, JSON.stringify(ab));
  anotar('Chromium, HP interna: medidas y posicion de la HP', /left=1366,top=0,width=1920,height=1080/.test(ab[0]?.f || ''), ab[0]?.f);
  anotar('Chromium, HP interna: nombre de ventana lb-cliente', ab[0]?.n === 'lb-cliente');
  anotar('Chromium, HP interna: fase abierta y via api', est.fase === 'abierta' && est.via === 'api', JSON.stringify(est));
  await espera(600);
  const e2 = await ev(pag, () => window.v.estadoVentana());
  anotar('Chromium, HP interna: la ventana contesta (hola/ack)', e2.responde === true && e2.abierta === true, JSON.stringify(e2));
  anotar('Chromium, HP interna: alAbrir recibe la pantalla HP', (await ev(pag, () => window.llamadas.abrir))[0]?.pantalla === 'HP All-in-One');
  const r = await ev(pag, () => window.iniciar());
  anotar('Chromium, segunda llamada no abre otra ventana', (await ev(pag, () => window.__calls.open)).length === 1);
  anotar('Chromium, HP interna: la ventana es real (popup)', ctx.pages().length === 2);
  anotar('Chromium, HP interna: sin mensajes en la consola', errores.length === 0, errores.join(' | '));
});

// 2. Sin isInternal en ninguna: usa la que no es principal
await caso(chromium, 'dos pantallas sin isInternal', { interna: false }, async ({ pag, errores }) => {
  await ev(pag, () => window.iniciar());
  const ab = await ev(pag, () => window.__calls.open);
  anotar('Chromium, sin isInternal: abre en la pantalla no principal', ab.length === 1 && /left=1366,top=0/.test(ab[0].f), JSON.stringify(ab));
  anotar('Chromium, sin isInternal: sin mensajes en la consola', errores.length === 0, errores.join(' | '));
});

// 3. monitorCliente manda sobre isInternal; tres pantallas
await caso(chromium, 'tres pantallas, monitorCliente', { interna: true, extras: 1 }, async ({ pag }) => {
  await ev(pag, () => window.iniciar({ monitorCliente: 'tercero' }));
  const ab = await ev(pag, () => window.__calls.open);
  anotar('Chromium, monitorCliente "tercero" elige esa pantalla aunque la HP sea interna', ab.length === 1 && /left=3286,top=0/.test(ab[0].f), JSON.stringify(ab));
});
await caso(chromium, 'monitorCliente igual a la pantalla de la caja', { interna: true }, async ({ pag }) => {
  await ev(pag, () => window.iniciar({ monitorCliente: 'AON' }));
  const ab = await ev(pag, () => window.__calls.open);
  anotar('Chromium, monitorCliente que apunta a la pantalla de la caja se ignora y usa la otra', ab.length === 1 && /left=1366/.test(ab[0].f), JSON.stringify(ab));
});

// 4. Sin la API
await caso(chromium, 'sin getScreenDetails', { api: false }, async ({ pag, errores }) => {
  const est = await ev(pag, () => window.iniciar());
  anotar('Chromium sin API: fase sin-api y no abre', est.fase === 'sin-api' && (await ev(pag, () => window.__calls.open)).length === 0, JSON.stringify(est));
  anotar('Chromium sin API: alFallar("sin-api") una vez', JSON.stringify(await ev(pag, () => window.llamadas.fallar)) === '["sin-api"]');
  anotar('Chromium sin API: sin mensajes en la consola', errores.length === 0, errores.join(' | '));
});
// 5. Una pantalla
await caso(chromium, 'una pantalla', { pantallas: 'una' }, async ({ pag }) => {
  const est = await ev(pag, () => window.iniciar());
  anotar('Chromium una pantalla: fase una-pantalla, no abre, no pide detalles', est.fase === 'una-pantalla' && (await ev(pag, () => window.__calls.open)).length === 0 && (await ev(pag, () => window.__calls.details)) === 0, JSON.stringify(est));
});
// 6. Permiso denegado de forma explicita: no se insiste
await caso(chromium, 'permiso denegado', { permiso: 'denegado' }, async ({ pag, errores }) => {
  const est = await ev(pag, () => window.iniciar());
  await ev(pag, () => { window.dispatchEvent(new Event('click')); });
  await espera(300);
  anotar('Chromium permiso denegado: fase sin-permiso', est.fase === 'sin-permiso', JSON.stringify(est));
  anotar('Chromium permiso denegado: no llama a getScreenDetails ni abre ventanas', (await ev(pag, () => window.__calls.details)) === 0 && (await ev(pag, () => window.__calls.open)).length === 0);
  anotar('Chromium permiso denegado: sin mensajes en la consola', errores.length === 0, errores.join(' | '));
});
// 7. Permiso que se rechaza al llamar (sin gesto): un solo reintento con el primer toque
await caso(chromium, 'permiso rechazado, un reintento', { permiso: 'pregunta-rechaza' }, async ({ pag, errores }) => {
  // getScreenDetails rechaza siempre
  await ev(pag, () => { window.getScreenDetails = async () => { window.__calls.details++; throw new DOMException('x', 'NotAllowedError'); }; });
  const est = await ev(pag, () => window.iniciar());
  anotar('Chromium permiso rechazado: fase sin-permiso tras el primer intento', est.fase === 'sin-permiso' && (await ev(pag, () => window.__calls.details)) === 1, JSON.stringify(est));
  await pag.mouse.click(50, 50); await espera(400);
  anotar('Chromium permiso rechazado: el primer toque reintenta una vez', (await ev(pag, () => window.__calls.details)) === 2);
  await pag.mouse.click(60, 60); await pag.mouse.click(70, 70); await espera(400);
  anotar('Chromium permiso rechazado: despues no insiste', (await ev(pag, () => window.__calls.details)) === 2);
  anotar('Chromium permiso rechazado: sin mensajes en la consola', errores.length === 0, errores.join(' | '));
});
// 8. Ventana ya abierta (otra pagina del mismo contexto que contesta por el canal)
await caso(chromium, 'ventana ya abierta', {}, async ({ pag, ctx }) => {
  const cli = await ctx.newPage();
  await cli.goto(base + '/__cliente.html');
  await espera(300);
  const est = await ev(pag, () => window.iniciar());
  anotar('Chromium ventana existente: no abre otra y la reconoce', (await ev(pag, () => window.__calls.open)).length === 0 && est.fase === 'abierta' && est.via === 'externa', JSON.stringify(est));
  anotar('Chromium ventana existente: estadoVentana dice responde', (await ev(pag, () => window.v.estadoVentana())).responde === true);
});
// 9. Modo kit
await caso(chromium, 'modo kit', { consulta: '?kit=1' }, async ({ pag }) => {
  const est = await ev(pag, () => window.iniciar());
  anotar('Chromium con ?kit=1: no abre ventana (la abre el kit)', est.fase === 'kit' && (await ev(pag, () => window.__calls.open)).length === 0, JSON.stringify(est));
});
// 10. Pantalla completa con gesto: un fallo, un reintento
await caso(chromium, 'pantalla completa', { ventanaFalsa: true }, async ({ pag, errores }) => {
  await ev(pag, () => { window.__pre = true; });
  // la ventana falsa falla la primera vez
  await ev(pag, () => { const o = window.open; window.open = (...a) => { const w = o(...a); w.fsFalla = 1; return w; }; });
  await ev(pag, () => window.iniciar());
  await espera(700);
  anotar('Pantalla completa: pide requestFullscreen con la pantalla elegida', (await ev(pag, () => window.__w.fs))[0] === 'HP All-in-One', JSON.stringify(await ev(pag, () => window.__w.fs)));
  anotar('Pantalla completa: tras un rechazo queda completa=false', (await ev(pag, () => window.v.estadoVentana())).completa === false);
  await pag.mouse.click(40, 40); await espera(400);
  anotar('Pantalla completa: reintento con el primer toque funciona', (await ev(pag, () => window.v.estadoVentana())).completa === true && (await ev(pag, () => window.__w.fs)).length === 2, JSON.stringify(await ev(pag, () => window.__w.fs)));
  anotar('Pantalla completa: sin mensajes en la consola', errores.length === 0, errores.join(' | '));
});
await caso(chromium, 'pantalla completa rechazada siempre', { ventanaFalsa: true }, async ({ pag }) => {
  await ev(pag, () => { const o = window.open; window.open = (...a) => { const w = o(...a); w.fsFalla = 99; return w; }; });
  await ev(pag, () => window.iniciar());
  await espera(700);
  for (let i = 0; i < 3; i++) { await pag.mouse.click(40 + i, 40); await espera(200); }
  anotar('Pantalla completa siempre rechazada: solo 1 intento + 1 reintento', (await ev(pag, () => window.__w.fs)).length === 2, JSON.stringify(await ev(pag, () => window.__w.fs)));
});
// 11. Cambio de pantallas: la HP cambia de lugar; luego queda una sola pantalla; luego vuelve
await caso(chromium, 'cambio de pantallas', { ventanaFalsa: true }, async ({ pag }) => {
  await ev(pag, () => window.iniciar());
  await espera(500);
  await ev(pag, () => { const h = window.__hp; Object.assign(h, { left: -1920, availLeft: -1920 }); window.__det.dispatchEvent(new Event('screenschange')); });
  await espera(1300);
  const mv = await ev(pag, () => ({ m: window.__w.moves, s: window.__w.sizes }));
  anotar('Cambio de pantallas: la ventana se mueve a la nueva posicion de la HP', JSON.stringify(mv.m.at(-1)) === '[-1920,0]' && JSON.stringify(mv.s.at(-1)) === '[1920,1080]', JSON.stringify(mv));
  anotar('Cambio de pantallas: no abre una segunda ventana', (await ev(pag, () => window.__calls.open)).length === 1);
  await ev(pag, () => { window.__det.screens = [window.__aon]; window.__det.dispatchEvent(new Event('screenschange')); });
  await espera(900);
  anotar('Se queda una sola pantalla: la ventana del cliente se cierra (no tapa la caja)', (await ev(pag, () => window.__w.cerrada)) === true && (await ev(pag, () => window.v.estadoVentana())).fase === 'una-pantalla');
  await ev(pag, () => { window.__det.screens = [window.__aon, window.__hp]; window.__det.dispatchEvent(new Event('screenschange')); });
  await espera(1500);
  anotar('Vuelve la segunda pantalla: se reabre una ventana nueva', (await ev(pag, () => window.__calls.open)).length === 2);
});
// 12. Ventana cerrada: se reabre; limite de 3 aperturas por minuto
await caso(chromium, 'ventana cerrada', { ventanaFalsa: true }, async ({ pag, errores }) => {
  await ev(pag, () => window.iniciar());
  await espera(400);
  for (let i = 0; i < 4; i++) {
    await ev(pag, () => { window.__w.closed = true; window.__det.dispatchEvent(new Event('currentscreenchange')); });
    await espera(1100);
  }
  const n = (await ev(pag, () => window.__calls.open)).length;
  anotar('Ventana cerrada: se reabre, pero no mas de 3 aperturas por minuto', n === 3, 'aperturas=' + n);
  anotar('Ventana cerrada: avisa fallo "reaperturas" al pasar el limite', (await ev(pag, () => window.llamadas.fallar)).includes('reaperturas'));
  anotar('Ventana cerrada: sin mensajes en la consola', errores.length === 0, errores.join(' | '));
});
// 12b. La vigilia periodica (cada 5 s) detecta una ventana arrastrada a la pantalla equivocada y una ventana cerrada
await caso(chromium, 'vigilia', { ventanaFalsa: true }, async ({ pag }) => {
  await ev(pag, () => window.iniciar());
  await espera(400);
  await ev(pag, () => { window.__w.screenX = 100; window.__w.screenY = 100; window.__w.outerWidth = 800; window.__w.outerHeight = 600; });
  await espera(5600);
  const mv = await ev(pag, () => window.__w.moves);
  anotar('Vigilia: una ventana arrastrada a la pantalla de la caja vuelve a la HP', JSON.stringify(mv.at(-1)) === '[1366,0]', JSON.stringify(mv));
  await ev(pag, () => { window.__w.closed = true; });
  await espera(5600);
  anotar('Vigilia: una ventana cerrada se vuelve a abrir sola', (await ev(pag, () => window.__calls.open)).length === 2);
});
// 12c. v3.3: cerrada a mano (boton de la pantalla del cliente) o cerrada despues de un buen rato: no se reabre sola
await caso(chromium, 'cerrada a mano por mensaje', { ventanaFalsa: true }, async ({ pag, errores }) => {
  await ev(pag, () => window.iniciar());
  await espera(400);
  await ev(pag, () => { const c = new BroadcastChannel('lb-pantalla-cliente'); c.postMessage({ evento: 'cerrar-a-mano', payload: {} }); setTimeout(() => c.close(), 100); window.__w.closed = true; });
  await espera(6000);
  const e = await ev(pag, () => window.v.estadoVentana());
  anotar('Cerrada a mano (mensaje): no se reabre sola', (await ev(pag, () => window.__calls.open)).length === 1, JSON.stringify(e));
  anotar('Cerrada a mano (mensaje): fase cerrada-a-mano', e.fase === 'cerrada-a-mano', JSON.stringify(e));
  await ev(pag, () => window.iniciar());
  anotar('Cerrada a mano: llamar de nuevo a iniciar tampoco la reabre', (await ev(pag, () => window.__calls.open)).length === 1);
  await ev(pag, () => { window.__det.dispatchEvent(new Event('currentscreenchange')); });
  await espera(3200);
  anotar('Cerrada a mano: un cambio de pantallas vuelve al comportamiento normal (se reabre)', (await ev(pag, () => window.__calls.open)).length === 2);
  anotar('Cerrada a mano: sin mensajes en la consola', errores.length === 0, errores.join(' | '));
});
await caso(chromium, 'cerrada tras un buen rato', { ventanaFalsa: true }, async ({ pag }) => {
  await ev(pag, () => window.iniciar());
  await espera(400);
  await ev(pag, () => { const d = Date.now.bind(Date); Date.now = () => d() + 25000; window.__w.closed = true; });
  await espera(6000);
  anotar('Cerrada tras 20 s o mas abierta: se respeta, no se reabre', (await ev(pag, () => window.__calls.open)).length === 1);
});
// 13. Enlace manual
await caso(chromium, 'enlace manual', {}, async ({ pag, ctx }) => {
  await pag.evaluate(() => { document.body.innerHTML = '<button id=b>abrir</button>'; document.getElementById('b').onclick = () => { window.__r = window.v.abrirManual('/__cliente.html'); }; });
  await pag.click('#b'); await espera(400);
  anotar('Enlace manual: abre la ventana con nombre lb-cliente', (await ev(pag, () => window.__r)) === true && (await ev(pag, () => window.__calls.open)).length === 1 && ctx.pages().length === 2);
  await pag.click('#b'); await espera(300);
  anotar('Enlace manual: la segunda vez enfoca la misma y no abre otra', (await ev(pag, () => window.__calls.open)).length === 1 && ctx.pages().length === 2);
  const est = await ev(pag, () => window.v.estadoVentana());
  anotar('Enlace manual: estado via manual y abierta', est.via === 'manual' && est.abierta, JSON.stringify(est));
  await ev(pag, () => window.iniciar());
  anotar('Enlace manual: la apertura automatica no duplica la ventana manual', (await ev(pag, () => window.__calls.open)).length === 1);
});
// 14. detenerVentana no cierra la ventana y deja el modulo limpio
await caso(chromium, 'detener', { ventanaFalsa: true }, async ({ pag }) => {
  await ev(pag, () => window.iniciar());
  await espera(300);
  await ev(pag, () => window.v.detenerVentana());
  const e = await ev(pag, () => window.v.estadoVentana());
  anotar('detenerVentana: fase inactiva y la ventana del cliente sigue abierta', e.fase === 'inactiva' && (await ev(pag, () => window.__w.cerrada)) !== true, JSON.stringify(e));
});
// 15. elegirPantalla (pura)
await caso(chromium, 'elegirPantalla', {}, async ({ pag }) => {
  const r = await ev(pag, () => {
    const a = { label: 'A', isPrimary: true }, b = { label: 'B', isPrimary: false, isInternal: false }, c = { label: 'C', isPrimary: false, isInternal: true };
    return [window.v.elegirPantalla({ screens: [a], currentScreen: a }, '') === null, window.v.elegirPantalla({ screens: [a, b, c], currentScreen: a }, '').label, window.v.elegirPantalla({ screens: [a, b, c], currentScreen: a }, 'b').label, window.v.elegirPantalla({ screens: [a, b], currentScreen: b }, '').label];
  });
  anotar('elegirPantalla: una sola pantalla da null; prefiere interna; luego marcada por nombre; usa la otra si la caja esta en la secundaria', JSON.stringify(r) === '[true,"C","B","A"]', JSON.stringify(r));
});

// 16. WebKit: sin getScreenDetails; nada debe romperse
await caso(webkit, 'webkit', { api: false }, async ({ pag, errores }) => {
  const est = await ev(pag, () => window.iniciar());
  anotar('WebKit: sin API queda en sin-api sin lanzar errores', est.fase === 'sin-api' && JSON.stringify(await ev(pag, () => window.llamadas.fallar)) === '["sin-api"]', JSON.stringify(est));
  const r = await ev(pag, () => { try { return typeof window.v.abrirManual('/__cliente.html'); } catch (e) { return 'lanza ' + e; } });
  anotar('WebKit: abrirManual no lanza (devuelve booleano)', r === 'boolean', String(r));
  anotar('WebKit: detenerVentana no lanza', await ev(pag, () => { try { window.v.detenerVentana(); return true; } catch { return false; } }));
  anotar('WebKit: sin errores de pagina', errores.length === 0, errores.join(' | '));
});
// 17. WebKit sin tocar nada: el modulo carga con el entorno real (sin simulacion)
{
  const nav = await webkit.launch();
  const pag = await (await nav.newContext()).newPage();
  const errores = [];
  pag.on('pageerror', (e) => errores.push(String(e)));
  await pag.goto(base + '/__caja.html'); await pag.waitForFunction(() => window.listo);
  const est = await pag.evaluate(() => window.iniciar());
  anotar('WebKit real: no hay getScreenDetails y el modulo lo maneja', typeof (await pag.evaluate(() => window.getScreenDetails)) === 'undefined' ? est.fase === 'sin-api' : true, JSON.stringify(est));
  anotar('WebKit real: sin errores', errores.length === 0, errores.join(' | '));
  await nav.close();
}
// 18. Chromium real sin simulacion: una sola pantalla (headless)
{
  const nav = await chromium.launch();
  const pag = await (await nav.newContext()).newPage();
  const errores = [];
  pag.on('pageerror', (e) => errores.push(String(e)));
  await pag.goto(base + '/__caja.html'); await pag.waitForFunction(() => window.listo);
  const est = await pag.evaluate(() => window.iniciar());
  anotar('Chromium real sin simulacion (una pantalla): no abre nada y no falla', ['una-pantalla', 'sin-api'].includes(est.fase) && errores.length === 0, JSON.stringify(est) + errores.join('|'));
  await nav.close();
}

srv.close();
console.log(`\n${total - malas} de ${total} pruebas bien`);
process.exit(malas ? 1 : 0);
