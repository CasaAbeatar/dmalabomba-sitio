// Prueba en Chrome de «Caja para mí» (SINPE, solo administrador). Monta la pantalla con una empresa y datos INVENTADOS (nada real: ni cédulas, ni pagadores, ni referencias de banco)
// interceptando las llamadas a public.fx_sinpe_adm_*; recorre cada pestaña en computadora y en celular, guarda capturas y revisa:
//   sin desborde horizontal, sin errores de JavaScript, sin fondos negros, la pestaña solo para administrador, las órdenes que pide al teléfono y el error con «Intentar de nuevo».
// Uso: node "prueba sinpe caja admin.mjs"   (con la carpeta facturacion copiada al lado, como hace el flujo de Windows). CAPTURAS=ruta cambia dónde guarda las imágenes.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const raiz = path.resolve(process.cwd());
const salida = path.resolve(process.env.CAPTURAS || path.join(raiz, 'resultados', 'sinpe caja'));
fs.mkdirSync(salida, { recursive: true });
const tipos = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const servidor = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(raiz, p);
  if (!f.startsWith(raiz) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
  r.writeHead(200, { 'content-type': tipos[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise((ok) => servidor.listen(8124, '127.0.0.1', ok));
const base = 'http://127.0.0.1:8124/sinpe-caja/montar.html';

/* ---------------- datos inventados ---------------- */
const ahora = new Date();
const ymdCR = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Costa_Rica' }).format(d);
const hoy = ymdCR(ahora);
const sumaDias = (ymd, n) => { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const iso = (ymd, h, m = 0) => new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10), h + 6, m)).toISOString(); // Costa Rica = UTC-6, sin horario de verano
const haceMin = (n) => new Date(ahora.getTime() - n * 60000).toISOString();
let sem = 7; const azar = () => { sem = (sem * 16807) % 2147483647; return sem / 2147483647; };
const NOMBRES = ['Cliente Prueba Uno', 'Cliente Prueba Dos', 'Cliente Prueba Tres', 'Cliente Prueba Cuatro', 'Cliente Prueba Cinco'];
let idPago = 9000;
const pago = (ymd, h, m, monto, o = {}) => ({ id: ++idPago, hora: iso(ymd, h, m), monto, referencia: o.sinRef ? null : String(900000000 + idPago), pagador: o.pagador ?? NOMBRES[idPago % 5], detalle: null, estado: o.estado || (o.venta ? 'asignado' : 'sin_asignar'), origen: o.origen || 'en_vivo', venta_numero: o.venta || null, via: null, clave: o.clave || null, tipo_doc: o.clave ? '01' : null, comprobante_estado: o.clave ? 'aceptado' : null });

const pagosHoy = [pago(hoy, 12, 41, 8500, { venta: 'T-1042', clave: '50612112600310100000000010000010100001042112345678' }), pago(hoy, 12, 5, 3000, { venta: 'T-1040' }), pago(hoy, 11, 20, 12500), pago(hoy, 9, 55, 4500, { venta: 'T-1031' })];
const ultimaHoy = pagosHoy[0].hora;
const telefono = (o = {}) => ({ telefono: 'telefono-prueba-1', ultimo_latido: haceMin(7), minutos: 7, bateria: 63, conteo: 1840, app: '2.11.0', riesgos: [{ nivel: 'info', motivo: 'La app no está exenta del ahorro de batería' }], tipo_red: 'wifi', cargando: true, red_validada: true, detalle_disponible: true, ...o });
const caja = (o = {}) => ({ ahora: ahora.toISOString(), empresa: 'pollos', hoy, activa: true, telefonos: [telefono()], salud: {},
  hoy_resumen: { n: 4, total: 28500, sin_venta_n: 1, sin_venta_total: 12500, revision_n: 0, ultimo_aviso: ultimaHoy }, pagos_hoy: pagosHoy,
  comandos: [{ id: 31, telefono: 'telefono-prueba-1', cmd: 'latido_ya', creado_en: haceMin(300), creado_por: 'facturador:admin', vence_en: haceMin(270), entregado_en: haceMin(298), ejecutado_en: haceMin(298), cancelado_en: null, nota: 'Desde «Caja para mí»', estado: 'ejecutado' },
    { id: 30, telefono: null, cmd: 'reenviar_historial', creado_en: haceMin(2000), creado_por: 'panel', vence_en: haceMin(560), entregado_en: null, ejecutado_en: null, cancelado_en: null, nota: null, estado: 'vencido' }], ...o });

const diasAtras = (n) => sumaDias(hoy, -n);
const pagosSinFactura = [];
for (let i = 1; i <= 9; i++) { const dia = diasAtras(i); const k = 1 + Math.floor(azar() * 3); for (let j = 0; j < k; j++) pagosSinFactura.push(pago(dia, 10 + Math.floor(azar() * 9), Math.floor(azar() * 60), 2000 + Math.floor(azar() * 14) * 500, { origen: i > 6 ? 'historial' : 'en_vivo' })); }
const porDia = (lista) => { const m = new Map(); for (const p of lista) { const d = ymdCR(new Date(p.hora)); if (!m.has(d)) m.set(d, []); m.get(d).push(p); } return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([dia, ps]) => ({ dia, n: ps.length, total: ps.reduce((a, p) => a + p.monto, 0), pagos: ps.sort((a, b) => (a.hora < b.hora ? 1 : -1)) })); };
const sinFactura = () => ({ empresa: 'pollos', desde: diasAtras(30), hasta: hoy, total_n: pagosSinFactura.length, total: pagosSinFactura.reduce((a, p) => a + p.monto, 0), tope: 1500, truncado: false, por_dia: porDia(pagosSinFactura) });

const concil = () => ({ empresa: 'pollos', desde: diasAtras(30), hasta: hoy,
  avisos: { n: 120, total: 612500 }, ventas: { n: 112, total: 574000, sin_referencia: 18 }, avisos_con_venta: { n: 108, total: 548000 }, avisos_sin_venta: { n: 12, total: 64500 },
  ventas_con_aviso: { n: 108, total: 548000 }, ventas_sin_aviso: { n: 4, total: 26000 }, monto_distinto_n: 1, posibles_n: 1,
  banco: { cargado: false, n: 0, total: 0, avisos_sin_banco_n: null, banco_sin_aviso_n: null, movimientos_en_total: 0 },
  lista_avisos_sin_venta: pagosSinFactura.slice(0, 6).map((p) => ({ id: p.id, hora: p.hora, monto: p.monto, referencia: p.referencia, pagador: p.pagador, origen: p.origen })),
  lista_ventas_sin_aviso: [{ id: 5001, hora: iso(diasAtras(2), 13, 10), monto: 6500, referencia: '777000111', venta_numero: 'T-0988', cobrado_por: 'cajera1' }, { id: 5002, hora: iso(diasAtras(4), 18, 2), monto: 9000, referencia: null, venta_numero: 'T-0950', cobrado_por: 'cajera2' }],
  lista_monto_distinto: [{ aviso_id: 9100, fecha_pago: iso(diasAtras(3), 12, 0), aviso_monto: 5000, venta_numero: 'T-0970', venta_monto: 5500, referencia: '888000222' }],
  lista_posibles: [{ pago_id: 5003, venta_numero: 'T-0960', monto: 4000, creado_en: iso(diasAtras(5), 14, 3), aviso_id: 9101, fecha_pago: iso(diasAtras(5), 14, 9), minutos: 6 }] });

// Un mes completo de pagos para el informe de la contadora y la estadística
const mesPagos = [];
const finMes = (ymd) => { const d = new Date(ymd.slice(0, 7) + '-01T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0); return d.toISOString().slice(0, 10); };
function pagosDeRango(desde, hasta) {
  sem = 11; idPago = 20000; const out = [];
  for (let d = desde; d <= hasta; d = sumaDias(d, 1)) {
    const dow = new Date(d + 'T12:00:00Z').getUTCDay(); if (dow === 0) continue; // domingo cerrado en la prueba
    for (let h = 9; h <= 20; h++) { const pico = h === 12 || h === 13 || h === 18 ? 3 : 1; const k = Math.floor(azar() * (pico + 1)); for (let j = 0; j < k; j++) { const v = azar() < 0.8; out.push(pago(d, h, Math.floor(azar() * 60), 2000 + Math.floor(azar() * 16) * 500, v ? { venta: 'T-' + (idPago), clave: azar() < 0.85 ? '506' + String(idPago).padStart(47, '0') : null } : {})); } }
  }
  return out;
}
const informeMes = (mes) => {
  const d0 = mes.slice(0, 7) + '-01', d1 = finMes(d0); const tope = d1 > hoy ? hoy : d1;
  const ps = pagosDeRango(d0, tope);
  const sum = (f) => ps.filter(f).reduce((a, p) => a + p.monto, 0), cnt = (f) => ps.filter(f).length;
  const conClave = (p) => !!p.clave;
  return { empresa: 'pollos', mes: d0, desde: d0, hasta: d1, medio06_facturas: { n: cnt(conClave), total: sum(conClave) - 4500 }, notas_credito_mes: { n: 1, total: 4500 },
    resumen: { n: ps.length, total: sum(() => true), con_venta_n: cnt((p) => p.venta_numero), con_venta_total: sum((p) => p.venta_numero), con_clave_n: cnt(conClave), con_clave_total: sum(conClave), sin_venta_n: cnt((p) => !p.venta_numero), sin_venta_total: sum((p) => !p.venta_numero), revision_n: 0, historial_n: 0 },
    ultimo_aviso: ps.length ? ps[ps.length - 1].hora : null, filas: ps.slice(0, 3000) };
};
function estadistica(desde, hasta) {
  const ps = pagosDeRango(desde, hasta); if (!ps.length) return { empresa: 'pollos', desde, hasta, vacio: true };
  const dias = []; for (let d = desde; d <= hasta; d = sumaDias(d, 1)) dias.push(d);
  const val = (xs) => { const n = xs.length, m = xs.reduce((a, x) => a + x, 0) / n; const sd = n > 1 ? Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (n - 1)) : null; return { n, m, sd, cv: sd != null && m > 0 ? sd / m : null }; };
  const dia = (p) => ymdCR(new Date(p.hora)); const horaDe = (p) => +new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Costa_Rica', hour: '2-digit', hour12: false }).format(new Date(p.hora));
  const porDia = dias.map((d) => { const x = ps.filter((p) => dia(p) === d); return { dia: d, n: x.length, total: x.reduce((a, p) => a + p.monto, 0) }; });
  const montos = ps.map((p) => p.monto); const r = val(montos); const sorted = [...montos].sort((a, b) => a - b); const q = (f) => sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))];
  const rd = (k) => val(porDia.map((x) => x[k]));
  const porHora = Array.from({ length: 24 }, (_, h) => { const xs = ps.filter((p) => horaDe(p) === h); const v = xs.length ? val(xs.map((p) => p.monto)) : null; const dv = val(dias.map((d) => xs.filter((p) => dia(p) === d).length));
    return { hora: h, n: xs.length, total: xs.reduce((a, p) => a + p.monto, 0), ticket_media: v?.m ?? null, ticket_sd: v?.sd ?? null, ticket_cv: v?.cv ?? null, dia_media: dv.m, dia_sd: dv.sd, dia_cv: dv.cv }; });
  const porDow = [1, 2, 3, 4, 5, 6, 7].map((w) => { const ds = porDia.filter((x) => { const g = new Date(x.dia + 'T12:00:00Z').getUTCDay() || 7; return g === w; }); const xs = ps.filter((p) => (new Date(dia(p) + 'T12:00:00Z').getUTCDay() || 7) === w); const v = xs.length ? val(xs.map((p) => p.monto)) : null; const a = val(ds.map((x) => x.n)), t = val(ds.map((x) => x.total));
    return { dow: w, dias: ds.length, n: xs.length, total: xs.reduce((s, p) => s + p.monto, 0), ticket_media: v?.m ?? null, ticket_sd: v?.sd ?? null, ticket_cv: v?.cv ?? null, dia_n_media: a.m, dia_n_sd: a.sd, dia_n_cv: a.cv, dia_total_media: t.m, dia_total_sd: t.sd, dia_total_cv: t.cv }; });
  const cajeras = new Map(); ps.forEach((p, i) => { const c = p.venta_numero ? (i % 2 ? 'cajera1' : 'cajera2') : ''; if (!cajeras.has(c)) cajeras.set(c, []); cajeras.get(c).push(p.monto); });
  return { empresa: 'pollos', desde, hasta, dato_desde: dias[0], dato_hasta: dias[dias.length - 1], dias: dias.length,
    resumen: { n: ps.length, total: montos.reduce((a, x) => a + x, 0), media: r.m, sd: r.sd, cv: r.cv, mediana: q(0.5), p90: q(0.9), maximo: sorted[sorted.length - 1] },
    resumen_dia: { n_media: rd('n').m, n_sd: rd('n').sd, n_cv: rd('n').cv, total_media: rd('total').m, total_sd: rd('total').sd, total_cv: rd('total').cv, dias_con_pagos: porDia.filter((x) => x.n > 0).length },
    ultimo_aviso: ps[ps.length - 1].hora, dias_sin_avisos_al_final: 0, por_hora: porHora, por_dow: porDow, por_dia: porDia,
    por_cajera: [...cajeras.entries()].map(([c, xs]) => { const v = val(xs); return { cajera: c, n: xs.length, total: xs.reduce((a, x) => a + x, 0), media: v.m, sd: v.sd, cv: v.cv }; }).sort((a, b) => b.n - a.n) };
}
function serie(desde, hasta) {
  const ps = pagosDeRango(desde, hasta); const m = new Map();
  for (const p of ps) { const d = ymdCR(new Date(p.hora)); const h = +new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Costa_Rica', hour: '2-digit', hour12: false }).format(new Date(p.hora)); const k = d + '|' + h; const x = m.get(k) || { dia: d, hora: h, n: 0, total: 0 }; x.n++; x.total += p.monto; m.set(k, x); }
  return { empresa: 'pollos', desde, hasta, nota: 'Solo la parte pagada con SINPE Móvil (cifras brutas, en colones). No incluye efectivo ni tarjeta, ni lo que se pagó sin que llegara el aviso del banco.', ultimo_aviso: ps.length ? ps[ps.length - 1].hora : null, filas: [...m.values()].sort((a, b) => (a.dia + String(a.hora).padStart(2, '0') < b.dia + String(b.hora).padStart(2, '0') ? -1 : 1)) };
}
const versiones = () => ({ ahora: ahora.toISOString(), empresa: 'pollos',
  telefonos: [{ telefono: 'telefono-prueba-1', app: '2.11.0', ultimo_latido: haceMin(7), minutos: 7, bateria: 63, detalle_disponible: true }, { telefono: 'telefono-prueba-2', app: null, ultimo_latido: haceMin(400), minutos: 400, bateria: 20, detalle_disponible: false }],
  equipos: [{ estacion: 'caja-prueba-1', nombre: 'Caja 1 de prueba', activo: true, ultimo_latido: haceMin(12), minutos: 12, version_kit: '3.5 19nov', version_facturador: '2.9.0', internet_ok: true }, { estacion: 'caja-prueba-2', nombre: 'Caja 2 de prueba', activo: true, ultimo_latido: null, minutos: null, version_kit: null, version_facturador: null, internet_ok: null }],
  reglas: [] });

/* ---------------- servidor falso ---------------- */
let llamadas = [];
let fallar = new Set();
function responder(nombre, args) {
  if (fallar.has(nombre)) return { estado: 500, cuerpo: { code: 'XX000', message: 'falla inventada para la prueba', details: null, hint: null } };
  switch (nombre) {
    case 'fx_sinpe_adm_caja': return { estado: 200, cuerpo: caja() };
    case 'fx_sinpe_adm_orden': return { estado: 200, cuerpo: { ok: true, id: 99, vence_en: haceMin(-30) } };
    case 'fx_sinpe_adm_sin_factura': return { estado: 200, cuerpo: sinFactura() };
    case 'fx_sinpe_adm_conciliacion': return { estado: 200, cuerpo: concil() };
    case 'fx_sinpe_adm_informe_mes': return { estado: 200, cuerpo: informeMes(args.p_mes) };
    case 'fx_sinpe_adm_estadistica': return { estado: 200, cuerpo: estadistica(args.p_desde, args.p_hasta) };
    case 'fx_sinpe_adm_serie_horas': return { estado: 200, cuerpo: serie(args.p_desde, args.p_hasta) };
    case 'fx_sinpe_adm_versiones': return { estado: 200, cuerpo: versiones() };
    default: return { estado: 404, cuerpo: { code: 'PGRST202', message: 'función no existe en la prueba: ' + nombre } };
  }
}
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
async function conectarFalso(ctx) {
  await ctx.route('**/rest/v1/rpc/*', async (ruta) => {
    const q = ruta.request();
    if (q.method() === 'OPTIONS') return ruta.fulfill({ status: 204, headers: cors });
    const nombre = new URL(q.url()).pathname.split('/').pop();
    let args = {}; try { args = JSON.parse(q.postData() || '{}'); } catch { /* sin cuerpo */ }
    llamadas.push({ nombre, args });
    const r = responder(nombre, args);
    return ruta.fulfill({ status: r.estado, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(r.cuerpo) });
  });
  await ctx.route(/\/(auth|functions)\/v1\//, (ruta) => ruta.fulfill({ status: 401, headers: { ...cors, 'content-type': 'application/json' }, body: '{"message":"sin sesión en la prueba"}' }));
  await ctx.route('**/fonts.g*apis.com/**', (ruta) => ruta.abort());
}

/* ---------------- revisiones ---------------- */
const informe = { navegador: null, pruebas: [] };
const anotar = (nombre, ok, detalle = '') => { informe.pruebas.push({ nombre, ok, detalle }); console.log(ok ? 'OK ' : 'FALLA', nombre, detalle ? '· ' + detalle : ''); };
const nombreArchivo = (s) => s.replace(/[^a-z0-9áéíóúñ ]+/gi, '').trim();

async function revisar(pag, etiqueta, erroresPagina) {
  const r = await pag.evaluate(() => {
    const ancho = document.documentElement.clientWidth;
    const desborde = document.documentElement.scrollWidth > ancho + 1;
    const anchos = [...document.querySelectorAll('#raiz *')].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && (b.right > ancho + 1) && !e.closest('[hidden]'); }).slice(0, 4).map((e) => e.tagName.toLowerCase() + '.' + String(e.className).slice(0, 40));
    const negros = [...document.querySelectorAll('#raiz *')].filter((e) => { const c = getComputedStyle(e).backgroundColor; const m = /rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)/.exec(c); return m && (m[4] === undefined || +m[4] > 0.5) && +m[1] < 45 && +m[2] < 45 && +m[3] < 45; }).slice(0, 4).map((e) => e.tagName.toLowerCase() + '.' + String(e.className).slice(0, 40));
    const desliza = [...document.querySelectorAll('#raiz *')].filter((e) => { const s = getComputedStyle(e); return (s.overflowX === 'auto' || s.overflowX === 'scroll') && e.scrollWidth > e.clientWidth + 1; }).slice(0, 4).map((e) => e.tagName.toLowerCase() + '.' + String(e.className).slice(0, 40));
    return { desborde, anchos, negros, desliza };
  });
  anotar(`${etiqueta}: sin desborde horizontal`, !r.desborde && !r.anchos.length, r.anchos.join(', '));
  anotar(`${etiqueta}: nada que se deslice de lado`, !r.desliza.length, r.desliza.join(', '));
  anotar(`${etiqueta}: sin fondos negros`, !r.negros.length, r.negros.join(', '));
  anotar(`${etiqueta}: sin errores de JavaScript`, erroresPagina.length === 0, erroresPagina.slice(0, 3).join(' | ').slice(0, 300));
}

const nav = await chromium.launch({ channel: 'chrome' });
informe.navegador = nav.version();
const PERFILES = [['pc', { width: 1366, height: 900 }, false], ['celular', { width: 390, height: 844 }, true]];
try {
  for (const [nombrePerfil, vista, tactil] of PERFILES) {
    const ctx = await nav.newContext({ viewport: vista, hasTouch: tactil, isMobile: tactil, deviceScaleFactor: tactil ? 2 : 1, locale: 'es-CR', timezoneId: 'America/Costa_Rica' });
    await conectarFalso(ctx);
    const pag = await ctx.newPage();
    const errores = [];
    pag.on('pageerror', (e) => errores.push(String(e)));
    pag.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|favicon/i.test(m.text())) errores.push(m.text()); });
    llamadas = []; fallar = new Set();
    await pag.goto(base, { waitUntil: 'load' });
    await pag.waitForFunction(() => window.__listo || window.__errorMontar, null, { timeout: 15000 });
    anotar(`${nombrePerfil}: la pantalla se monta`, await pag.evaluate(() => !!window.__listo), await pag.evaluate(() => window.__errorMontar || ''));
    const foto = async (nombre, completa = true) => { await pag.waitForTimeout(350); await pag.screenshot({ path: path.join(salida, `${nombrePerfil} ${nombreArchivo(nombre)}.png`), fullPage: completa }); };
    const pestana = async (id) => { await pag.click('#sc-tab-' + id); await pag.waitForTimeout(700); };

    // HOY
    await pag.waitForSelector('.sc-tarjeta', { timeout: 10000 });
    anotar(`${nombrePerfil} hoy: trae la tarjeta del teléfono con batería y red`, /63 %/.test(await pag.innerText('#raiz')) && /Wi.?Fi/.test(await pag.innerText('#raiz')));
    anotar(`${nombrePerfil} hoy: muestra los tres puntos del cuadre (el tercero pendiente)`, /Pendiente/i.test(await pag.innerText('#raiz')) && /3 · Movimiento del banco/i.test(await pag.innerText('#raiz')));
    await foto('1 hoy');
    await revisar(pag, `${nombrePerfil} hoy`, errores);
    // pedir latido: llama a la orden con los datos correctos
    const antes = llamadas.length;
    await pag.click('button:has-text("Pedir latido")');
    await pag.waitForTimeout(600);
    const orden = llamadas.slice(antes).find((l) => l.nombre === 'fx_sinpe_adm_orden');
    anotar(`${nombrePerfil} hoy: «Pedir latido» manda la orden latido_ya al teléfono`, !!orden && orden.args.p_cmd === 'latido_ya' && orden.args.p_telefono === 'telefono-prueba-1', JSON.stringify(orden?.args || {}));
    // reenviar historial: pide confirmación; si se dice que no, no manda nada
    const antes2 = llamadas.length;
    await pag.click('button:has-text("Reenviar historial")');
    await pag.waitForTimeout(500);
    const hayConfirmacion = await pag.locator('button:has-text("No, volver")').count();
    anotar(`${nombrePerfil} hoy: «Reenviar historial» pregunta antes de pedir`, hayConfirmacion > 0);
    await foto('1b hoy confirmar reenvio', false);
    if (hayConfirmacion) await pag.click('button:has-text("No, volver")');
    await pag.waitForTimeout(400);
    anotar(`${nombrePerfil} hoy: si se dice «No», no se manda ninguna orden`, !llamadas.slice(antes2).some((l) => l.nombre === 'fx_sinpe_adm_orden'));

    // SINPE sin factura
    await pestana('sin_factura');
    await pag.waitForSelector('.sc-fila, .sc-vacio', { timeout: 8000 });
    await foto('2 sin factura');
    await revisar(pag, `${nombrePerfil} sin factura`, errores);
    const dias = await pag.$$eval('.sc-dia-titulo, .sc-dia h3, .sc-dia > header', (els) => els.map((e) => e.textContent.trim()));
    anotar(`${nombrePerfil} sin factura: la lista está agrupada por día`, (await pag.locator('.sc-fila').count()) > 3, `filas=${await pag.locator('.sc-fila').count()}`);
    // el buscador y su memoria al cambiar de pestaña y volver
    const buscador = pag.locator('input.sc-buscar');
    if (await buscador.count()) {
      await buscador.fill('prueba uno'); await pag.waitForTimeout(500);
      await pestana('kit'); await pestana('sin_factura'); await pag.waitForTimeout(400);
      const valor = await pag.locator('input.sc-buscar').inputValue();
      anotar(`${nombrePerfil} sin factura: al volver a la pestaña se conserva el filtro escrito`, valor === 'prueba uno', valor);
      await pag.locator('input.sc-buscar').fill('');
    }

    // Conciliación
    await pestana('conciliacion');
    await pag.waitForSelector('.sc-tres, .sc-punto-caja', { timeout: 8000 });
    anotar(`${nombrePerfil} conciliación: el archivo del banco figura como «todavía no disponible»`, /todavía no disponible/i.test(await pag.innerText('#raiz')));
    await foto('3 conciliacion');
    await revisar(pag, `${nombrePerfil} conciliación`, errores);

    // Informes: mes, estadística, serie
    await pestana('informes');
    await pag.waitForSelector('.sc-kpi', { timeout: 10000 });
    await foto('4a informe del mes');
    await revisar(pag, `${nombrePerfil} informe del mes`, errores);
    anotar(`${nombrePerfil} informe del mes: dice «cifras brutas» y trae el botón para la contadora`, /brutas/i.test(await pag.innerText('#raiz')) && (await pag.locator('button:has-text("contadora")').count()) > 0);
    await pag.click('button[data-id=estadistica]'); await pag.waitForTimeout(1200);
    await pag.waitForSelector('svg', { timeout: 10000 }).catch(() => {});
    await foto('4b estadistica');
    await revisar(pag, `${nombrePerfil} estadística`, errores);
    const textoEst = await pag.innerText('#raiz');
    anotar(`${nombrePerfil} estadística: muestra desviación estándar y coeficiente de variación`, /desviación estándar/i.test(textoEst) && /variación/i.test(textoEst));
    await pag.click('button[data-id=serie]'); await pag.waitForTimeout(1200);
    await foto('4c serie por hora');
    await revisar(pag, `${nombrePerfil} serie por hora`, errores);
    anotar(`${nombrePerfil} serie por hora: avisa que es solo la parte pagada con SINPE`, /solo la parte/i.test(await pag.innerText('#raiz')));

    // Kit y app
    await pestana('kit');
    await pag.waitForSelector('.sc-tabla, .sc-aviso, .sc-tarjeta', { timeout: 8000 });
    anotar(`${nombrePerfil} kit y app: es de solo lectura (sin botones de acción)`, (await pag.locator('#sc-tab-kit ~ * button.primario, .sc-panel button.btn.primario').count()) === 0);
    await foto('5 kit y app');
    await revisar(pag, `${nombrePerfil} kit y app`, errores);

    // Falla del servidor: se explica y se puede reintentar
    fallar = new Set(['fx_sinpe_adm_versiones']);
    await pestana('hoy'); await pestana('kit'); await pag.waitForTimeout(1200);
    const reintento = await pag.locator('button:has-text("Intentar de nuevo")').count();
    anotar(`${nombrePerfil} falla del servidor: ofrece «Intentar de nuevo» en la misma pestaña`, reintento > 0);
    await foto('6 falla con reintento', false);
    fallar = new Set();
    if (reintento) { await pag.click('button:has-text("Intentar de nuevo")'); await pag.waitForTimeout(1000); }
    anotar(`${nombrePerfil} falla del servidor: al reintentar se recupera`, (await pag.locator('button:has-text("Intentar de nuevo")').count()) === 0);

    // Teléfono sin señal desde hace horas: aviso alto
    const sinSenal = caja({ telefonos: [telefono({ minutos: 9 * 60 + 12, ultimo_latido: haceMin(552), bateria: 8, cargando: false, tipo_red: 'mobile', red_validada: false, riesgos: [{ nivel: 'critico', motivo: 'La batería está casi agotada y no está cargando' }] })] });
    await pag.route('**/rest/v1/rpc/fx_sinpe_adm_caja', (ruta) => ruta.request().method() === 'OPTIONS' ? ruta.fulfill({ status: 204, headers: cors }) : ruta.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(sinSenal) }));
    await pestana('hoy'); await pag.waitForTimeout(700);
    anotar(`${nombrePerfil} hoy: un teléfono sin señal desde hace horas se anuncia arriba`, (await pag.locator('[role=alert]').count()) > 0 && /Sin señal/.test(await pag.innerText('#raiz')));
    await foto('7 telefono sin senal');
    await revisar(pag, `${nombrePerfil} teléfono sin señal`, errores);
    await ctx.close();
  }

  // Quien no es administrador no ve la pantalla
  const ctx2 = await nav.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, locale: 'es-CR' });
  await conectarFalso(ctx2);
  const p2 = await ctx2.newPage(); llamadas = [];
  await p2.goto(base + '?admin=0', { waitUntil: 'load' });
  await p2.waitForFunction(() => window.__listo || window.__errorMontar, null, { timeout: 15000 });
  const txt = await p2.innerText('#raiz');
  anotar('Quien no es administrador: ve solo el aviso y ninguna pestaña', /solo para administradores/i.test(txt) && (await p2.locator('.sc-tab').count()) === 0);
  anotar('Quien no es administrador: la pantalla no le pide nada al servidor', llamadas.length === 0, llamadas.map((l) => l.nombre).join(','));
  await p2.screenshot({ path: path.join(salida, 'celular no administrador.png') });
  await ctx2.close();
} finally {
  await nav.close();
  servidor.close();
}
fs.writeFileSync(path.join(salida, 'informe sinpe caja.json'), JSON.stringify(informe, null, 2));
process.exit(informe.pruebas.some((p) => !p.ok) ? 1 : 0);
