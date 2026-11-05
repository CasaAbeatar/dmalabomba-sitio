// Prueba en Chrome real de Windows: caja a 1366x768 y, si existe, pantalla del cliente en dos tamanos.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const raiz = path.resolve(process.cwd());
const salida = path.join(raiz, 'resultados');
fs.mkdirSync(salida, { recursive: true });
const tipos = { '.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.webmanifest':'application/json','.woff2':'font/woff2' };
const servidor = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(raiz, p);
  if (!f.startsWith(raiz) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
  r.writeHead(200, { 'content-type': tipos[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(ok => servidor.listen(8123, '127.0.0.1', ok));
const base = 'http://127.0.0.1:8123';
const informe = { navegador: null, pruebas: [] };
const anotar = (nombre, ok, detalle = '') => { informe.pruebas.push({ nombre, ok, detalle }); console.log(ok ? 'OK ' : 'FALLA', nombre, detalle); };

const nav = await chromium.launch({ channel: 'chrome' });
informe.navegador = nav.version();
try {
  // 1. La caja carga a 1366x768 (pantalla de acceso, sin iniciar sesion)
  const ctx = await nav.newContext({ viewport: { width: 1366, height: 768 }, hasTouch: true });
  const pag = await ctx.newPage();
  const errores = [];
  pag.on('pageerror', e => errores.push(String(e)));
  await pag.goto(base + '/facturacion/', { waitUntil: 'load' });
  await pag.waitForTimeout(1500);
  await pag.screenshot({ path: path.join(salida, 'caja 1366x768.png') });
  const desborde = await pag.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  anotar('Caja sin desborde horizontal a 1366x768', !desborde);
  anotar('Caja sin errores de JavaScript al cargar', errores.length === 0, errores.join(' | ').slice(0, 300));

  // 2. Pantalla del cliente, si ya existe en esta rama
  if (fs.existsSync(path.join(raiz, 'facturacion/cliente/index.html'))) {
    for (const [an, al] of [[1920,1080],[1366,768]]) {
      const c2 = await nav.newContext({ viewport: { width: an, height: al } });
      const emisor = await c2.newPage();
      await emisor.goto(base + '/facturacion/', { waitUntil: 'load' });
      const cli = await c2.newPage();
      const err2 = [];
      cli.on('pageerror', e => err2.push(String(e)));
      await cli.goto(base + '/facturacion/cliente/', { waitUntil: 'load' });
      await cli.waitForTimeout(1000);
      const estados = [
        ['espera', { v:1, estado:'espera', empresa:'soda', lineas:[], subtotal:0, descuento:0, iva:0, total:0, medio:null, recibido:null, vuelto:null }],
        ['cuenta', { v:1, estado:'cuenta', empresa:'soda', lineas:[{nombre:'Casado con pollo',cant:2,total:7500,desc_pct:10},{nombre:'Fresco natural',cant:1,total:1500,desc_pct:0}], subtotal:9000, descuento:750, iva:958, total:8250, medio:null, recibido:null, vuelto:null }],
        ['pago', { v:1, estado:'pago', empresa:'soda', lineas:[], subtotal:9000, descuento:750, iva:958, total:8250, medio:'efectivo', recibido:null, vuelto:null }],
        ['pagado', { v:1, estado:'pagado', empresa:'soda', lineas:[], subtotal:9000, descuento:750, iva:958, total:8250, medio:'efectivo', recibido:10000, vuelto:1750 }],
      ];
      for (const [nombre, msg] of estados) {
        await emisor.evaluate(m => { const b = new BroadcastChannel('lb-pantalla-cliente'); b.postMessage({ ...m, ts: Date.now() }); b.close(); }, msg);
        await cli.waitForTimeout(900);
        await cli.screenshot({ path: path.join(salida, `cliente ${nombre} ${an}x${al}.png`) });
        const texto = await cli.evaluate(() => document.body.innerText);
        const desb = await cli.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1 || document.documentElement.scrollHeight > innerHeight + 1);
        anotar(`Cliente ${nombre} ${an}x${al}: sin barras de desplazamiento`, !desb);
        if (nombre === 'cuenta') anotar(`Cliente cuenta ${an}x${al}: muestra el total`, /8[.,\s]?250/.test(texto), texto.slice(0, 120).replace(/\s+/g, ' '));
      }
      anotar(`Cliente ${an}x${al}: sin errores de JavaScript`, err2.length === 0, err2.join(' | ').slice(0, 300));
      await c2.close();
    }
  } else {
    anotar('Pantalla del cliente', true, 'todavia no existe en esta rama; se omite');
  }
} finally {
  await nav.close();
  servidor.close();
}
fs.writeFileSync(path.join(salida, 'informe navegador.json'), JSON.stringify(informe, null, 2));
process.exit(informe.pruebas.some(p => !p.ok) ? 1 : 0);
