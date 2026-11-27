// SINPE en la caja (27 nov 2026): prueba en Chrome real, con respuestas de ejemplo (sin tocar la base):
//  1) la lista de SINPE: indicador del teléfono y resalte del monto exacto; 2) la pastilla «Ver SINPE» con «sin señal»;
//  3) las notas bajo el comprobante (repetido, otro día, otra empresa, no aparece) y que NUNCA bloquean;
//  4) la pantalla del cliente de punta a punta con la caja (BroadcastChannel real): «Pago recibido ₡X» con nombre solo cuando el SINPE está ligado a esa venta.
// Se corre desde «pruebas windows» (con la carpeta facturacion copiada al lado) o desde la raíz del repositorio. Guarda capturas en «resultados».
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const raiz = fs.existsSync(path.resolve('facturacion/js')) ? path.resolve('.') : path.resolve('..');
const salida = path.resolve(process.env.SALIDA || 'resultados');
fs.mkdirSync(salida, { recursive: true });
const tipos = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/json', '.woff2': 'font/woff2', '.txt': 'text/plain' };
const servidor = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(raiz, p);
  if (!f.startsWith(raiz) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
  r.writeHead(200, { 'content-type': tipos[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise((ok) => servidor.listen(Number(process.env.PUERTO || 8124), '127.0.0.1', ok));
const base = 'http://127.0.0.1:' + (process.env.PUERTO || 8124);
const informe = { navegador: null, pruebas: [] };
const anotar = (nombre, ok, detalle = '') => { informe.pruebas.push({ nombre, ok: !!ok, detalle }); console.log(ok ? 'OK   ' : 'FALLA', nombre, detalle); };

const HARNESS = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/facturacion/css/app.css"><title>SINPE en la caja (prueba)</title></head>
<body style="background:#fbf8f2"><div id="r" style="max-width:660px;margin:1rem auto;padding:0 .75rem"></div>
<script type="module" src="/__h/sinpe.js"></script></body></html>`;
// El código de Supabase que viaja con el sitio busca una etiqueta <script src> en la página: por eso el arnés usa un archivo y no código dentro del HTML
const HARNESS_JS = `import { listaSinpe, escogerSinpe, notasComprobante } from '/facturacion/js/ui_sinpe.js';
import { flotanteSinpe } from '/facturacion/js/sinpe_flotante.js';
window.H = { listaSinpe, escogerSinpe, notasComprobante, flotanteSinpe }; window.listo = true;`;
const conHarness = async (ctx) => {
  await ctx.route('**/__h/sinpe.html', (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HARNESS }));
  await ctx.route('**/__h/sinpe.js', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: HARNESS_JS }));
  await ctx.route('**/__h/emisor.js', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: EMISOR_JS }));
  await ctx.route('**/__h/emisor.html', (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset="utf-8"><title>caja</title><script type="module" src="/__h/emisor.js"></script>' }));
};
const EMISOR_JS = `import { iniciar } from '/facturacion/js/pantalla_emisor.js';
window.em = iniciar({ socId: '00000000-0000-0000-0000-000000000001', terminal: 1, turno: { id: 1 }, empresa: { codigo: 'soda' } }, { sinVentana: true, leerConfig: async () => ({}) }); window.listo = true;`;

const nav = await chromium.launch({ channel: 'chrome' });
informe.navegador = nav.version();
const ahoraISO = () => new Date().toISOString();
const hace = (min) => new Date(Date.now() - min * 60000).toISOString();
const pagos = () => [
  { id: 'p1', hora: hace(12), monto: 8250, pagador: 'ARAICA LARIOS TIFFANY MELANIE', telefono: '****-1234', detalle: 'Casado', comprobante: '2026112715284002322660417', usado: false },
  { id: 'p2', hora: hace(40), monto: 8250, pagador: 'JIMENEZ SOTO CARLOS', telefono: '****-5678', detalle: '', comprobante: '2026112714000000000000001', usado: true, usado_venta: '#012' },
  { id: 'p3', hora: hace(55), monto: 3200, pagador: 'MORA VARGAS ANA', telefono: '', detalle: '', comprobante: '2026112713000000000000002', usado: false },
];

try {
  /* ====== 1 a 3. Componentes de la caja con respuestas de ejemplo ====== */
  for (const [nombreVista, an, al] of [['escritorio', 1366, 768], ['telefono', 390, 844]]) {
    const ctx = await nav.newContext({ viewport: { width: an, height: al }, hasTouch: nombreVista === 'telefono' });
    await conHarness(ctx);
    const pag = await ctx.newPage();
    const errores = []; pag.on('pageerror', (e) => errores.push(String(e)));
    await pag.goto(base + '/__h/sinpe.html'); await pag.waitForFunction(() => window.listo);

    // 1a. Teléfono conectado + monto exacto
    await pag.evaluate(({ ps, ahora, lat }) => {
      const api = { lista: async () => ({ activa: true, ahora, ultimo_aviso: ps[0].hora, ultimo_latido: lat, pagos: ps }), usar: async () => ({ ok: true }), revisar: async () => ({ activa: true, vacio: true }) };
      window.esc = window.H.escogerSinpe({ soc: 's', empresa: 'soda', ventaId: 'v1', ventaNumero: '#013', total: 8250, api, alCambiar: (p) => { window.elegido = p; } });
      document.getElementById('r').replaceChildren(window.esc.el);
    }, { ps: pagos(), ahora: ahoraISO(), lat: hace(8) });
    await pag.waitForSelector('.sinpe-fila');
    const ok1 = await pag.evaluate(() => ({ ind: document.querySelector('.sinpe-ind')?.dataset.nivel, indTxt: document.querySelector('.sinpe-ind-txt')?.textContent, exactos: [...document.querySelectorAll('.sinpe-fila.exacto')].map((f) => f.dataset.id), chips: [...document.querySelectorAll('.sinpe-chip.exacto')].map((c) => c.textContent) }));
    anotar(`[${nombreVista}] Indicador: teléfono conectado (punto verde y palabras)`, ok1.ind === 'ok' && /conectado/.test(ok1.indTxt), JSON.stringify(ok1));
    anotar(`[${nombreVista}] La lista no escribe la palabra «null» (el selector de período solo existe en Administración)`, await pag.evaluate(() => !/null/.test(document.querySelector('.sinpe-lista-caja').textContent)));
    anotar(`[${nombreVista}] Monto exacto: solo el SINPE de hoy, sin usar y del mismo monto se resalta, con la leyenda escrita`, ok1.exactos.length === 1 && ok1.exactos[0] === 'p1' && /Coincide con el cobro/.test(ok1.chips[0] || ''), JSON.stringify(ok1.exactos));
    await pag.screenshot({ path: path.join(salida, `sinpe caja lista conectado ${nombreVista}.png`) });

    // 1b. Teléfono sin señal
    await pag.evaluate(({ ps, ahora, lat }) => {
      window.esc.destruir();
      const api = { lista: async () => ({ activa: true, ahora, ultimo_aviso: ps[0].hora, ultimo_latido: lat, pagos: ps }), usar: async () => ({ ok: true }) };
      window.esc = window.H.escogerSinpe({ soc: 's', empresa: 'soda', ventaId: 'v1', ventaNumero: '#013', total: 9999, api });
      document.getElementById('r').replaceChildren(window.esc.el);
    }, { ps: pagos(), ahora: ahoraISO(), lat: hace(95) });
    await pag.waitForSelector('.sinpe-fila');
    const ok2 = await pag.evaluate(() => ({ ind: document.querySelector('.sinpe-ind')?.dataset.nivel, txt: document.querySelector('.sinpe-ind-txt')?.textContent, exactos: document.querySelectorAll('.sinpe-fila.exacto').length, botones: document.querySelectorAll('.sinpe-fila button').length }));
    anotar(`[${nombreVista}] Indicador: sin señal por más de 30 min avisa con palabras y que el cobro sigue igual`, ok2.ind === 'atraso' && /1 hora/.test(ok2.txt) && /cobro sigue igual/.test(ok2.txt), ok2.txt);
    anotar(`[${nombreVista}] Con un monto que no coincide con nadie no se resalta nada y los SINPE se pueden escoger igual`, ok2.exactos === 0 && ok2.botones >= 2);
    await pag.screenshot({ path: path.join(salida, `sinpe caja lista sin senal ${nombreVista}.png`) });

    // 2. Pastilla «Ver SINPE»
    await pag.evaluate(({ ps, ahora, lat }) => {
      window.esc.destruir();
      const api = { lista: async () => ({ activa: true, ahora, ultimo_aviso: ps[0].hora, ultimo_latido: lat, pagos: ps }) };
      window.fl = window.H.flotanteSinpe({ soc: 's', empresa: 'soda', api, intervaloCerradaMs: 400 });
    }, { ps: pagos(), ahora: ahoraISO(), lat: hace(70) });
    await pag.waitForSelector('.sinpe-flot-sen:not([hidden])', { timeout: 4000 });
    const pil = await pag.evaluate(() => ({ txt: document.querySelector('.sinpe-flot-pastilla').textContent, aria: document.querySelector('.sinpe-flot-pastilla').getAttribute('aria-label') }));
    anotar(`[${nombreVista}] Pastilla «Ver SINPE» dice «sin señal» con palabras cuando el teléfono no responde`, /sin señal/.test(pil.txt) && /no da señal/.test(pil.aria), JSON.stringify(pil));
    await pag.screenshot({ path: path.join(salida, `sinpe caja pastilla sin senal ${nombreVista}.png`), clip: { x: 0, y: Math.max(0, al - 120), width: an, height: 120 } });
    await pag.evaluate(() => window.fl.destruir());
    await pag.evaluate(({ ps, ahora, lat }) => {
      const api = { lista: async () => ({ activa: true, ahora, ultimo_aviso: ps[0].hora, ultimo_latido: lat, pagos: ps }) };
      window.fl = window.H.flotanteSinpe({ soc: 's2', empresa: 'soda', api, intervaloCerradaMs: 400 });
    }, { ps: pagos(), ahora: ahoraISO(), lat: hace(3) });
    await pag.waitForTimeout(900);
    anotar(`[${nombreVista}] Pastilla sin aviso cuando el teléfono está bien`, await pag.evaluate(() => document.querySelector('.sinpe-flot-sen').hidden));
    await pag.evaluate(() => window.fl.destruir());

    // 3. Notas del comprobante: nunca bloquean y nunca esperan a la base para que la caja funcione
    const casos = [
      ['repetido', { activa: true, vacio: false, repetido: true, repetido_venta: '#007', encontrado: true, otra_empresa: false, dias_antes: 0, pago: { hora: hace(20), monto: 8250 } }, /ya se usó en la venta #007/],
      ['otro día', { activa: true, vacio: false, repetido: false, encontrado: true, otra_empresa: false, dias_antes: 6, pago: { hora: hace(6 * 1440), monto: 8250 } }, /hace 6 días/],
      ['otra empresa', { activa: true, vacio: false, repetido: false, encontrado: true, otra_empresa: true }, /otra empresa/],
      ['no aparece', { activa: true, vacio: false, repetido: false, encontrado: false }, /no aparece entre los SINPE recibidos/],
      ['de hoy', { activa: true, vacio: false, repetido: false, encontrado: true, otra_empresa: false, dias_antes: 0, pago: { hora: hace(10), monto: 8250 } }, /recibido hoy/],
    ];
    for (const [nombre, res, rx] of casos) {
      const txt = await pag.evaluate(async (res) => {
        const api = { revisar: async () => res };
        const n = window.H.notasComprobante({ soc: 's', ventaId: 'v1', total: 8250, api, esperaMs: 20 });
        document.getElementById('r').replaceChildren(n.el); n.revisar('2026112715284002322660417', true);
        await new Promise((ok) => setTimeout(ok, 200));
        const t = n.el.hidden ? '' : n.el.innerText; n.destruir(); return t;
      }, res);
      anotar(`[${nombreVista}] Comprobante «${nombre}» muestra su nota`, rx.test(txt), txt.replace(/\n/g, ' | '));
    }
    // captura con varias notas a la vista
    await pag.evaluate(async () => {
      const res = { activa: true, vacio: false, repetido: true, repetido_venta: '#007', encontrado: true, otra_empresa: false, dias_antes: 1, pago: { hora: new Date(Date.now() - 30 * 3600000).toISOString(), monto: 5000 } };
      const n = window.H.notasComprobante({ soc: 's', ventaId: 'v1', total: 8250, api: { revisar: async () => res }, esperaMs: 10 });
      const caja = document.createElement('label'); caja.className = 'etq'; caja.innerHTML = '<span>Número de comprobante del SINPE Móvil (recomendado: ayuda a cuadrar la caja)</span>';
      const i = document.createElement('input'); i.className = 'campo'; i.value = '2026112715284002322660417'; caja.append(i);
      document.getElementById('r').replaceChildren(caja, n.el); n.revisar(i.value, true); await new Promise((ok) => setTimeout(ok, 150));
    });
    await pag.screenshot({ path: path.join(salida, `sinpe caja notas comprobante ${nombreVista}.png`) });
    // sin comprobante consultable, apagado o con falla de la base: no se dice nada
    const calla = await pag.evaluate(async () => {
      const salidas = [];
      for (const [ref, activo, api] of [['12', true, { revisar: async () => ({ activa: true, vacio: false, repetido: true }) }], ['2026112715284002322660417', false, { revisar: async () => ({ activa: true, vacio: false, repetido: true }) }], ['2026112715284002322660417', true, { revisar: async () => { throw new Error('sin internet'); } }]]) {
        const n = window.H.notasComprobante({ soc: 's', api, esperaMs: 10 }); n.revisar(ref, activo); await new Promise((ok) => setTimeout(ok, 120)); salidas.push(n.el.hidden && !n.el.textContent); n.destruir();
      }
      return salidas;
    });
    anotar(`[${nombreVista}] Sin comprobante válido, con SINPE apagado o con la base caída no se dice nada ni se rompe`, calla.every(Boolean), JSON.stringify(calla));
    // varias teclas seguidas: solo se pregunta una vez, por el último valor
    const unaSola = await pag.evaluate(async () => {
      let llamadas = []; const api = { revisar: async (s, r) => { llamadas.push(r); return { activa: true, vacio: false, repetido: false, encontrado: false }; } };
      const n = window.H.notasComprobante({ soc: 's', api, esperaMs: 60 });
      for (const v of ['2026', '20261', '202611', '2026112715']) { n.revisar(v, true); await new Promise((ok) => setTimeout(ok, 15)); }
      await new Promise((ok) => setTimeout(ok, 250)); n.destruir(); return llamadas;
    });
    anotar(`[${nombreVista}] Escribir de corrido hace una sola pregunta a la base (la del último valor)`, unaSola.length === 1 && unaSola[0] === '2026112715', JSON.stringify(unaSola));
    anotar(`[${nombreVista}] Sin errores de JavaScript`, errores.length === 0, errores.join(' | ').slice(0, 300));
    await ctx.close();
  }

  /* ====== 4. Pantalla del cliente de punta a punta: caja (emisor real) y cliente en el mismo navegador ====== */
  for (const [nombreVista, an, al] of [['1920x1080', 1920, 1080], ['1366x768', 1366, 768], ['vertical', 1080, 1920]]) {
    const ctx = await nav.newContext({ viewport: { width: an, height: al } });
    await conHarness(ctx);
    const caja = await ctx.newPage(); await caja.goto(base + '/__h/emisor.html'); await caja.waitForFunction(() => window.listo);
    const cli = await ctx.newPage();
    const errs = []; cli.on('pageerror', (e) => errs.push(String(e)));
    await cli.goto(base + '/facturacion/cliente/', { waitUntil: 'load' }); await cli.waitForTimeout(1200);
    const hacer = (f, ...a) => caja.evaluate(([f, a]) => { const c = (id) => ({ venta: { id, total: 8250 }, lineas: [{ descripcion: 'Casado con pollo', cantidad: 1, precio_final: 8250, total_linea: 8250, iva_tarifa: 13 }], cliente: null }); window.em[f](...a.map((x) => (x && x.__cuenta ? c(x.__cuenta) : x))); }, [f, a]);
    const vista = () => cli.evaluate(() => document.body.dataset.vista);
    const texto = () => cli.evaluate(() => document.body.innerText);
    const visible = (id) => cli.evaluate((id) => { const e = document.getElementById(id); return !!e && !e.hidden && e.getClientRects().length > 0; }, id);

    await hacer('cuenta', { __cuenta: 'v1' }); await cli.waitForTimeout(500);
    anotar(`[cliente ${nombreVista}] En la cuenta no hay SINPE ni nombre`, (await vista()) === 'cuenta' && !/Tiffany|Pago recibido/.test(await texto()));
    await hacer('pago', { __cuenta: 'v1' }); await cli.waitForTimeout(900);
    anotar(`[cliente ${nombreVista}] Al abrir el cobro todavía no hay «Pago recibido» ni nombre`, (await vista()) === 'pago' && !(await visible('pg-sinpe')) && !/Tiffany|Pago recibido/.test(await texto()));
    await cli.screenshot({ path: path.join(salida, `cliente pago sin sinpe ${nombreVista}.png`) });
    await hacer('sinpe', { nombre: 'Tiffany Melanie Araica Larios', monto: 8250 }, 'v1'); await cli.waitForTimeout(900);
    const t1 = await texto();
    anotar(`[cliente ${nombreVista}] Ligado el SINPE a la venta: «Pago recibido ₡8 250» con el nombre del pagador`, (await visible('pg-sinpe')) && /Pago recibido\s+₡8\D?250/.test(t1) && /Tiffany Melanie Araica Larios/.test(t1), t1.replace(/\s+/g, ' ').slice(0, 160));
    const desborde = await cli.evaluate(() => { const e = document.getElementById('pg-sinpe'); const r = e.getBoundingClientRect(); return r.left < 0 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1 || document.documentElement.scrollWidth > innerWidth + 1; });
    anotar(`[cliente ${nombreVista}] El aviso cabe en la pantalla sin cortarse`, !desborde);
    await cli.screenshot({ path: path.join(salida, `cliente pago recibido sinpe ${nombreVista}.png`) });
    await hacer('sinpe', null, 'v1'); await cli.waitForTimeout(700);
    anotar(`[cliente ${nombreVista}] Si la cajera quita el SINPE, el aviso y el nombre desaparecen`, !(await visible('pg-sinpe')) && !/Tiffany/.test(await texto()));
    // el nombre nunca viaja a otra cuenta: cerrar el cobro sin cobrar
    await hacer('sinpe', { nombre: 'Tiffany Melanie Araica Larios', monto: 8250 }, 'v1'); await cli.waitForTimeout(500);
    await hacer('cerrarPago', { __cuenta: 'v1' }); await cli.waitForTimeout(900);
    anotar(`[cliente ${nombreVista}] Cerrar el cobro sin cobrar vuelve a la cuenta sin nombre`, (await vista()) === 'cuenta' && !/Tiffany|Pago recibido/.test(await texto()));
    // cobro completo con SINPE
    await hacer('pago', { __cuenta: 'v1' }); await hacer('sinpe', { nombre: 'Tiffany Melanie Araica Larios', monto: 8250 }, 'v1'); await cli.waitForTimeout(500);
    await hacer('pagado', { pagos_snapshot: [{ medio: 'sinpe', recibido: 8250 }], vuelto: 0 }, 0); await cli.waitForTimeout(900);
    const t2 = await texto();
    anotar(`[cliente ${nombreVista}] Cobrado con SINPE: «Muchas gracias» y «SINPE Móvil recibido de» con el nombre`, (await vista()) === 'pagado' && (await visible('pd-sinpe')) && /SINPE Móvil recibido de Tiffany Melanie Araica Larios/.test(t2), t2.replace(/\s+/g, ' ').slice(0, 200));
    await cli.screenshot({ path: path.join(salida, `cliente pagado sinpe ${nombreVista}.png`) });
    // tras los 6 s vuelve a la espera y no queda el nombre en la página
    await cli.waitForTimeout(7600);
    const html = await cli.evaluate(() => document.documentElement.innerHTML);
    anotar(`[cliente ${nombreVista}] Pasado el «pagado» no queda el nombre en la página ni se guardó en el navegador`, !/Tiffany/.test(html) && (await cli.evaluate(() => !JSON.stringify({ ...localStorage, ...sessionStorage }).includes('Tiffany'))));
    anotar(`[cliente ${nombreVista}] Sin errores de JavaScript`, errs.length === 0, errs.join(' | ').slice(0, 300));
    await ctx.close();
  }

  /* ====== 4b. Vista previa de la pantalla del cliente (?demo) con y sin nombre ====== */
  {
    const ctx = await nav.newContext({ viewport: { width: 1920, height: 1080 } });
    const pag = await ctx.newPage(); const e3 = []; pag.on('pageerror', (e) => e3.push(String(e)));
    await pag.goto(base + '/facturacion/cliente/?demo=pago&sinpe=1&medio=sinpe', { waitUntil: 'load' }); await pag.waitForTimeout(1200);
    const a = await pag.evaluate(() => document.getElementById('pg-sinpe').innerText);
    await pag.goto(base + '/facturacion/cliente/?demo=pago&sinpe=sin-nombre&medio=sinpe', { waitUntil: 'load' }); await pag.waitForTimeout(1200);
    const b = await pag.evaluate(() => document.getElementById('pg-sinpe').innerText);
    anotar('Vista previa de la pantalla del cliente con y sin nombre', /Tiffany/.test(a) && /SINPE Móvil/.test(b) && !/Tiffany/.test(b), (a + ' // ' + b).replace(/\s+/g, ' '));
    anotar('Vista previa sin errores de JavaScript', e3.length === 0, e3.join(' | '));
    await ctx.close();
  }
} finally {
  fs.writeFileSync(path.join(salida, 'sinpe-caja.json'), JSON.stringify(informe, null, 1));
  await nav.close(); servidor.close();
}
const fallas = informe.pruebas.filter((x) => !x.ok);
console.log('\n' + (informe.pruebas.length - fallas.length) + '/' + informe.pruebas.length + ' pruebas bien');
process.exit(fallas.length ? 1 : 0);
