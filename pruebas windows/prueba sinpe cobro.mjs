// Prueba de punta a punta de la ventana de cobro de la caja (m_caja.js real, no un arnés) con el SINPE de la lista, en Chrome real.
// El navegador carga el facturador de esta rama tal cual; lo único simulado es el servidor (Supabase): un servidor de mentira con estado, que contesta las funciones fx_*
// con la misma forma que las verdaderas. Así la prueba no toca la base de nadie, no usa claves ni datos reales y se puede repetir. Usuario de la sesión: «zzcajera» (empresa de pruebas).
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const raiz = path.resolve(process.cwd());
const salida = path.resolve(process.env.CAPTURAS || path.join(raiz, 'resultados'));
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
await new Promise((ok) => servidor.listen(Number(process.env.PUERTO || 8127), '127.0.0.1', ok));
const base = 'http://127.0.0.1:' + (process.env.PUERTO || 8127);
const informe = { navegador: null, pruebas: [] };
const anotar = (nombre, ok, detalle = '') => { informe.pruebas.push({ nombre, ok: !!ok, detalle }); console.log(ok ? 'OK   ' : 'FALLA', nombre, detalle); };
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

/* ================= Servidor de mentira (con estado) ================= */
const SOC = 'a0000000-0000-4000-8000-000000000001';
const TURNO = 'b0000000-0000-4000-8000-000000000001';
const uid = (() => { let n = 0; return (p = 'c') => `${p}0000000-0000-4000-8000-${String(++n).padStart(12, '0')}`; })();
const hace = (min) => new Date(Date.now() - min * 60000).toISOString();
const crearMundo = () => ({
  usuario: { usuario: 'zzcajera', nombre: 'ZZ Cajera', admin: false }, turno: null, ventas: new Map(), lineas: new Map(), pagos: [], comprobantes: new Map(), numero: 0, nComp: 0, conteos: [], cobros: [], llamadas: [], cierres: [],
  // SINPE: la bandera, la lista y las fallas que se le pueden provocar
  sinpe: { activa: true, ultimo_latido: hace(5), pagos: [], ajenos: [], usados: new Map(), falla: { flags: false, lista: false, revisar: false, usar: false }, lento: 0 },
  productos: [
    { id: 'd0000000-0000-4000-8000-000000000001', sociedad_id: SOC, cajon_id: 'e0000000-0000-4000-8000-000000000001', codigo: '010001', nombre: 'Casado con pollo', cabys: '6332100000100', precio_final: 3000, tarifa_iva: 13, unidad: 'Unid', es_servicio: false, activo: true, precio_abierto: false, nota: null, descripcion_libre: false, producto_nombre: 'Casado con pollo', modificador_nombre: null, nombre_venta: 'Casado con pollo' },
    { id: 'd0000000-0000-4000-8000-000000000002', sociedad_id: SOC, cajon_id: 'e0000000-0000-4000-8000-000000000001', codigo: '010002', nombre: 'Fresco natural', cabys: '2399000000100', precio_final: 1500, tarifa_iva: 13, unidad: 'Unid', es_servicio: false, activo: true, precio_abierto: false, nota: null, descripcion_libre: false, producto_nombre: 'Fresco natural', modificador_nombre: null, nombre_venta: 'Fresco natural' },
  ],
  cajones: [{ id: 'e0000000-0000-4000-8000-000000000001', sociedad_id: SOC, codigo: '01', nombre: 'Almuerzos', orden: 1, activo: true }],
});
let mundo = crearMundo();
const nuevoMundo = () => { mundo = crearMundo(); };
const totalDe = (vid) => (mundo.lineas.get(vid) || []).filter((l) => !l.quitada).reduce((s, l) => s + Number(l.total_linea), 0);
const err = (message, code = 'P0001', hint = '') => ({ __error: { message, code, hint, details: '' } });
const cuenta = (vid) => {
  const v = mundo.ventas.get(vid); if (!v) return err('Venta no existe');
  v.total = totalDe(vid);
  const comp = [...mundo.comprobantes.values()].find((c) => c.venta_id === vid);
  return { venta: v, lineas: (mundo.lineas.get(vid) || []).filter((l) => !l.quitada), pagos: mundo.pagos.filter((p) => p.venta_id === vid), cliente: null, comprobante: comp ? { ...comp, lineas_snapshot: undefined, pagos_snapshot: undefined } : null };
};
const sociedad = () => ({ id: SOC, codigo: 'pollos', codigo_acceso: 'pollos', nombre: 'Empresa de pruebas', nombre_comercial: 'Empresa de pruebas', cedula: null, ambiente: 'pruebas', correo: null, telefono: null, provincia: null, canton: null, distrito: null, otras_senas: null, terminales: [{ sucursal: 1, terminal: 1, nombre: 'Caja 1' }], turno: mundo.turno });
const numeroDe = (v) => '#' + String(v.numero).padStart(3, '0');
const pagoSinpeApi = (p) => ({ id: p.id, hora: p.hora, monto: p.monto, pagador: p.pagador, telefono: p.telefono || '', detalle: p.detalle || '', comprobante: p.comprobante, usado: mundo.sinpe.usados.has(p.id), usado_venta: mundo.sinpe.usados.get(p.id) || null });
const rpcs = {
  fx_contexto: () => ({ usuario: mundo.usuario.usuario, nombre: mundo.usuario.nombre, admin: mundo.usuario.admin, debe_cambiar_pin: false, empresa_sesion: SOC, sociedades: [sociedad()] }),
  fx_turno_sugerencia_apertura: () => ({ hay_turno_abierto: !!mundo.turno, turno_abierto_id: mundo.turno?.id || null, hay_cierre_anterior: false, sugerido: null, origen: null, horas_desde_cierre: null, ultimo_cierre: null }),
  fx_turno_abrir: (a) => { const ya = !!mundo.turno; if (!ya) mundo.turno = { id: TURNO, sociedad_id: SOC, terminal: 1, abierto_por: 'zzcajera', abierto_en: new Date().toISOString(), fondo_inicial: Number(a.p_fondo || 0), cerrado_por: null, cerrado_en: null, contado_efectivo: null, notas: null, numero_cierre: null, conteos_n: 0 }; return { ...mundo.turno, ya_abierto: ya }; },
  fx_turno_estado: () => {
    const t = mundo.turno; const vistos = [...mundo.ventas.values()].filter((v) => v.estado === 'abierta' || v.estado === 'prefacturada'); // el servidor cuenta todas las cuentas abiertas, vacías o no
    // Cierre ciego: lo que ve la cajera (sin lo esperado ni la diferencia), igual que fx_turno_estado para quien no es administrador
    return { turno: t, fondo: t?.fondo_inicial || 0, salidas: [], entradas: [], total_salidas: 0, total_entradas: 0, abiertas: vistos.length, ambiente: 'pruebas', contado_efectivo: t?.contado_efectivo ?? null, conteos: mundo.conteos.map((c, i) => ({ n: i + 1, monto: c, faltante: null, en: new Date().toISOString() })), ciego: true };
  },
  fx_venta_anular: (a) => { const v = mundo.ventas.get(a.p_venta); if (v) v.estado = 'anulada'; return { ok: true }; },
  fx_turno_conteo: (a) => { mundo.conteos.push(Number(a.p_efectivo)); const esperado = mundo.turno.fondo_inicial + mundo.pagos.filter((p) => p.medio === 'efectivo').reduce((s, p) => s + p.monto, 0); return { intento: mundo.conteos.length, recontar: Math.abs(Number(a.p_efectivo) - esperado) > 0.01, puede_cerrar: true }; },
  fx_turno_cerrar: (a) => {
    // Igual que fx_turno_cerrar de verdad: cualquier cuenta abierta o prefacturada del local, vacía o no, impide cerrar (hint «cuentas_abiertas»)
    const abiertas = [...mundo.ventas.values()].filter((v) => v.estado === 'abierta' || v.estado === 'prefacturada');
    if (abiertas.length) return err(abiertas.length === 1 ? 'Todavía hay 1 cuenta abierta. Cóbrela o anúlela antes de cerrar la caja.' : 'Todavía hay ' + abiertas.length + ' cuentas abiertas. Cóbrelas o anúlelas antes de cerrar la caja.', 'P0001', 'cuentas_abiertas');
    mundo.cierres.push({ efectivo: a.p_efectivo, notas: a.p_notas });
    mundo.turno = { ...mundo.turno, cerrado_por: 'zzcajera', cerrado_en: new Date().toISOString(), contado_efectivo: Number(a.p_efectivo), numero_cierre: 1 };
    const t = mundo.turno; mundo.turnoCerrado = t; mundo.turno = null;
    return { turno: t, fondo: t.fondo_inicial, salidas: [], entradas: [], total_salidas: 0, total_entradas: 0, abiertas: 0, ambiente: 'pruebas', contado_efectivo: t.contado_efectivo, conteos: [], ciego: true };
  },
  fx_catalogo: () => ({ cajones: mundo.cajones, productos: mundo.productos }),
  fx_ventas_abiertas: () => [...mundo.ventas.values()].filter((v) => v.estado === 'abierta' || v.estado === 'prefacturada').map((v) => ({ id: v.id, numero: v.numero, estado: v.estado, tipo_servicio: v.tipo_servicio, referencia: v.referencia, telefono: v.telefono, prefactura_numero: v.prefactura_numero, total: totalDe(v.id), creado_en: v.creado_en, cliente_id: v.cliente_id, lineas: (mundo.lineas.get(v.id) || []).filter((l) => !l.quitada).length, prefactura_revision: v.prefactura_revision, prefactura_vigente: v.prefactura_vigente })),
  fx_venta_crear: (a) => { const id = uid('f'); const v = { id, sociedad_id: SOC, turno_id: TURNO, numero: ++mundo.numero, canal: 'caja', estado: 'abierta', cliente_id: null, total: 0, creado_por: 'zzcajera', creado_en: new Date().toISOString(), cerrado_en: null, tipo_servicio: a.p_tipo, referencia: a.p_referencia, telefono: a.p_telefono, prefactura_numero: null, prefacturada_en: null, anulada_motivo: null, prefactura_revision: 0, prefactura_vigente: false, otros_cargos: 0, correos_elegidos: null }; mundo.ventas.set(id, v); mundo.lineas.set(id, []); return v; },
  fx_venta: (a) => cuenta(a.p_venta),
  fx_linea_agregar: (a) => { const p = mundo.productos.find((x) => x.id === a.p_producto); const ls = mundo.lineas.get(a.p_venta); const cant = Number(a.p_cantidad || 1); const ex = ls.find((l) => l.producto_id === p.id && !l.quitada); if (ex) { ex.cantidad += cant; ex.total_linea = ex.cantidad * ex.precio_final; } else ls.push({ id: uid('9'), venta_id: a.p_venta, producto_id: p.id, descripcion: p.nombre, cabys: p.cabys, tarifa_iva: p.tarifa_iva, es_servicio: false, cantidad: cant, precio_final: p.precio_final, total_linea: cant * p.precio_final, nota: null, orden: ls.length + 1, quitada: false, codigo_tarifa_iva: '08', unidad: 'Unid', codigo_comercial: null, precio_catalogo: p.precio_final, exoneracion: null, descuento: null }); return cuenta(a.p_venta); },
  fx_venta_reemplazo_info: () => ({ ok: true, reemplaza: false }),
  fx_sinpe_flags: () => { if (mundo.sinpe.falla.flags) return err('falla', 'XX000'); return { activa: mundo.sinpe.activa }; },
  fx_sinpe_lista: () => { const s = mundo.sinpe; if (s.falla.lista) return err('no hay respuesta', 'XX000'); return { activa: s.activa, ahora: new Date().toISOString(), ultimo_aviso: s.pagos[0]?.hora || null, ultimo_latido: s.ultimo_latido, pagos: s.pagos.map(pagoSinpeApi) }; },
  fx_sinpe_ref_revisar: (a) => {
    const s = mundo.sinpe; if (s.falla.revisar) return err('no hay respuesta', 'XX000');
    const ref = String(a.p_ref || '').trim(); if (!/^\d{10,}$/.test(ref)) return { activa: true, vacio: true };
    const p = s.pagos.find((x) => x.comprobante === ref); const ajeno = s.ajenos.find((x) => x.comprobante === ref);
    if (!p && !ajeno) return { activa: true, vacio: false, encontrado: false, repetido: false };
    if (ajeno) return { activa: true, vacio: false, encontrado: true, repetido: false, otra_empresa: true };
    const uso = s.usados.get(p.id); const v = a.p_venta ? mundo.ventas.get(a.p_venta) : null; const miNumero = v ? numeroDe(v) : null;
    return { activa: true, vacio: false, encontrado: true, repetido: !!uso && uso !== miNumero, repetido_venta: uso || null, otra_empresa: false, dias_antes: Math.floor((Date.now() - new Date(p.hora).getTime()) / 86400000), pago: { hora: p.hora, monto: p.monto } };
  },
  fx_sinpe_usar: (a) => { const s = mundo.sinpe; if (s.falla.usar) return err('no hay respuesta', 'XX000'); const v = a.p_venta ? mundo.ventas.get(a.p_venta) : null; if (a.p_usado === false) s.usados.delete(a.p_pago); else s.usados.set(a.p_pago, v ? numeroDe(v) : '#000'); return { ok: true }; },
  fx_cobrar: (a) => {
    const v = mundo.ventas.get(a.p_venta); if (!v) return err('Venta no existe'); if (v.estado === 'facturada') return err('La venta ya está cobrada');
    const total = totalDe(a.p_venta); const suma = a.p_pagos.reduce((s, p) => s + Number(p.monto), 0);
    if (Math.abs(suma - total) > 0.01) return err('Los pagos no suman el total');
    v.estado = 'facturada'; v.cerrado_en = new Date().toISOString();
    const pagos = a.p_pagos.map((p) => ({ id: uid('8'), venta_id: v.id, turno_id: TURNO, medio: p.medio, monto: Number(p.monto), referencia: p.referencia || null, creado_en: new Date().toISOString(), recibido: p.recibido ?? null, vuelto: p.recibido ? p.recibido - p.monto : null, cobrado_por: 'zzcajera' }));
    mundo.pagos.push(...pagos);
    const id = uid('7'); const comp = { id, sociedad_id: SOC, venta_id: v.id, tipo_doc: '04', consecutivo: '00100001040000000' + String(++mundo.nComp).padStart(3, '0'), clave: '5062711260031010000000010000104000000000' + String(mundo.nComp).padStart(2, '0') + '00000001', situacion: 'normal', fecha_emision: new Date().toISOString(), cliente_id: null, total, total_iva: Math.round(total * 13 / 113 * 100) / 100, estado: 'procesando', mensaje: null, ambiente: 'pruebas', creado_en: new Date().toISOString(), cliente_snapshot: null, lineas_snapshot: mundo.lineas.get(v.id).map((l) => ({ ...l })), pagos_snapshot: pagos.map((p) => ({ medio: p.medio, monto: p.monto, referencia: p.referencia, recibido: p.recibido, vuelto: p.vuelto })), terminal: 1, emitido_por: 'zzcajera' };
    mundo.comprobantes.set(id, comp);
    // El medio de pago que viaja al servidor es el que la caja arma; la lista del SINPE ya no interviene en nada de esto
    mundo.cobros.push({ venta: v.id, pagos: a.p_pagos.map((p) => ({ ...p })), cliente: a.p_cliente });
    return { ...comp, sociedad: sociedad(), venta: v };
  },
  fx_comprobante: (a) => { const c = mundo.comprobantes.get(a.p_id); return c ? { ...c, sociedad: sociedad(), venta: mundo.ventas.get(c.venta_id), original: null, efectivo_recibido: null, vuelto: null } : err('No existe'); },
};
const manejarRpc = (nombre, args, yaAnotada = false) => {
  if (!yaAnotada) mundo.llamadas.push({ fn: nombre, args, t: Date.now() });
  const f = rpcs[nombre];
  if (!f) { mundo.sinImplementar = mundo.sinImplementar || new Set(); mundo.sinImplementar.add(nombre); return null; }
  return f(args || {});
};
const instalarServidor = async (ctx) => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ sub: 'u-zz', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 86400 * 30, aud: 'authenticated' }) + '.firma';
  // Sesión de prueba: un token de mentira que solo sirve contra este servidor de mentira (no es ninguna clave ni contraseña real)
  await ctx.addInitScript(({ jwt }) => { try { if (!localStorage.getItem('sb-facturador')) localStorage.setItem('sb-facturador', JSON.stringify({ access_token: jwt, refresh_token: 'r', expires_in: 2592000, expires_at: Math.floor(Date.now() / 1000) + 2592000, token_type: 'bearer', user: { id: 'u-zz', aud: 'authenticated', role: 'authenticated' } })); } catch { /* nada */ } }, { jwt });
  await ctx.route(/supabase\.co/, async (route) => {
    const q = route.request(); const u = new URL(q.url());
    const cab = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    if (q.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cab });
    const m = u.pathname.match(/^\/rest\/v1\/rpc\/(\w+)/);
    if (m) {
      let args = {}; try { args = JSON.parse(q.postData() || '{}'); } catch { /* nada */ }
      const lento = /^fx_sinpe_/.test(m[1]) ? mundo.sinpe.lento : 0;
      mundo.llamadas.push({ fn: m[1], args, t: Date.now() }); // se anota al llegar, no al contestar
      if (lento) await pausa(lento);
      const res = manejarRpc(m[1], args, true);
      if (res && res.__error) return route.fulfill({ status: 400, contentType: 'application/json', headers: cab, body: JSON.stringify(res.__error) });
      return route.fulfill({ status: 200, contentType: 'application/json', headers: cab, body: JSON.stringify(res ?? null) });
    }
    mundo.llamadas.push({ fn: q.method() + ' ' + u.pathname, t: Date.now() });
    return route.fulfill({ status: 200, contentType: 'application/json', headers: cab, body: u.pathname.startsWith('/rest/') ? '[]' : '{}' });
  });
};
export { nuevoMundo };

const nav = await chromium.launch({ channel: 'chrome' });
informe.navegador = nav.version();

/* ================= Pasos de la prueba ================= */
const C = { c1: '2026112715284002322660417', c2: '2026112714000000000000001', c3: '2026112713000000000000002', ayer: '2026112614000000000000004', ajeno: '2026112712000000000000005', nuevo: '2026112711000000000000006', libre: '2026112710000000000000007' };
const sembrar = () => {
  mundo.sinpe.pagos = [
    { id: 'p1', hora: hace(12), monto: 7500, pagador: 'ARAICA LARIOS TIFFANY MELANIE', telefono: '****-1234', detalle: 'Casado', comprobante: C.c1 },
    { id: 'p2', hora: hace(40), monto: 7500, pagador: 'JIMENEZ SOTO CARLOS', telefono: '****-5678', detalle: '', comprobante: C.c2 },
    { id: 'p3', hora: hace(55), monto: 3200, pagador: 'MORA VARGAS ANA', telefono: '', detalle: '', comprobante: C.c3 },
    { id: 'p4', hora: hace(30 * 60), monto: 7500, pagador: 'VARGAS ROJAS LUIS', telefono: '', detalle: '', comprobante: C.ayer },
  ];
  mundo.sinpe.ajenos = [{ comprobante: C.ajeno }];
};
const sesion = async ({ ancho, alto, usuario = null, cliente = false, antes = null }) => {
  nuevoMundo(); sembrar(); if (usuario) mundo.usuario = usuario; if (antes) antes();
  const ctx = await nav.newContext({ viewport: { width: ancho, height: alto }, hasTouch: ancho < 600 });
  await instalarServidor(ctx);
  const pag = await ctx.newPage();
  const errores = [];
  pag.on('pageerror', (e) => errores.push(String(e)));
  pag.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errores.push('consola: ' + m.text()); });
  await pag.goto(base + '/facturacion/?depurar', { waitUntil: 'load' }); await pag.waitForSelector('text=Abrir caja', { timeout: 15000 });
  let cli = null;
  if (cliente) {
    cli = await ctx.newPage(); cli.on('pageerror', (e) => errores.push('cliente: ' + String(e)));
    await cli.goto(base + '/facturacion/cliente/', { waitUntil: 'load' }); await cli.waitForTimeout(1200);
    await pag.bringToFront();
  }
  return { ctx, pag, cli, errores };
};
// Espera sondeando con evaluate: waitForFunction evalúa texto y la política de seguridad de la página (script-src 'self') lo bloquea en Chrome de Windows.
const esperar = async (pag, fn, ms = 15000) => { const t0 = Date.now(); for (;;) { if (await pag.evaluate(fn)) return; if (Date.now() - t0 > ms) throw new Error('Se acabó el tiempo esperando: ' + String(fn).slice(0, 80)); await pag.waitForTimeout(100); } };
const modalTxt = (pag) => pag.evaluate(() => { const m = [...document.querySelectorAll('.modal-fondo')].pop(); return m ? m.innerText : ''; });
const abrirCaja = async (pag, fondo = '20000') => {
  await pag.getByText('Abrir caja', { exact: true }).first().click();
  await pag.locator('input').first().fill(fondo);
  await pag.getByRole('button', { name: 'Abrir caja' }).last().click();
  await pag.waitForSelector('button.prod', { timeout: 15000 });
};
const armar = async (pag, casados = 2, frescos = 1) => {
  for (let i = 0; i < casados; i++) await pag.locator('button.prod', { hasText: 'Casado con pollo' }).click();
  for (let i = 0; i < frescos; i++) await pag.locator('button.prod', { hasText: 'Fresco natural' }).click();
  await pag.waitForTimeout(700);
};
const abrirCobro = async (pag) => { const ancho = await pag.evaluate(() => innerWidth); await (ancho < 600 ? pag.getByRole('button', { name: /^Cobrar ₡/ }) : pag.getByRole('button', { name: 'Cobrar', exact: true })).click(); await pag.waitForSelector('button.medio-btn', { timeout: 10000 }); await pag.waitForTimeout(500); };
const medio = (pag, m) => pag.locator('button.medio-btn[data-medio=' + m + ']').click();
const cobrarYa = async (pag) => {
  const t0 = Date.now();
  await pag.locator('.modal-fondo').last().getByRole('button', { name: /^Cobrar ₡/ }).click();
  await esperar(pag, () => /Cobro registrado/.test(document.body.innerText), 15000);
  return Date.now() - t0;
};
const cerrarExito = async (pag) => {
  await pag.getByRole('button', { name: 'Listo, cerrar' }).click();
  try { await esperar(pag, () => !document.querySelector('.modal-fondo'), 6000); }
  catch { const t = await modalTxt(pag); await pag.screenshot({ path: path.join(salida, 'cobro modal que no cierra.png') }); throw new Error('Después de «Listo, cerrar» sigue una ventana abierta: ' + t.replace(/\n/g, ' | ').slice(0, 300)); }
  await pag.waitForTimeout(300);
};
const botonCobrar = (pag) => pag.locator('.modal-fondo').last().getByRole('button', { name: /^Cobrar ₡/ });
const notas = (pag) => pag.evaluate(() => { const e = document.querySelector('.sinpe-ref-notas'); return e && !e.hidden ? e.innerText.replace(/\s+/g, ' ').trim() : ''; });
const escribirRef = async (pag, v) => { const i = pag.locator('.modal-fondo').last().locator('input.campo').last(); await i.fill(v); await pag.waitForTimeout(900); };
const sinNull = (t) => !/\bnull\b|undefined|NaN/.test(t);
const ultimoCobro = () => mundo.cobros[mundo.cobros.length - 1];
const bad = (e) => e.filter((x) => !/favicon|sw\.js|manifest/i.test(x));

try {
  /* ==================== A. ESCRITORIO 1366x768, con la pantalla del cliente abierta ==================== */
  {
    const { ctx, pag, cli, errores } = await sesion({ ancho: 1366, alto: 768, cliente: true });
    const vista = () => cli.evaluate(() => document.body.dataset.vista);
    const textoCli = () => cli.evaluate(() => document.body.innerText);
    const visibleCli = (id) => cli.evaluate((id) => { const e = document.getElementById(id); return !!e && !e.hidden && e.getClientRects().length > 0; }, id);
    const sinpeLlamadas = (desde) => mundo.llamadas.slice(desde).filter((l) => /^fx_sinpe_/.test(l.fn)).map((l) => l.fn);

    // 1. Abrir caja
    await abrirCaja(pag);
    anotar('[A] Abrir caja con el usuario de caja de la empresa de pruebas', !!mundo.turno && /Caja abierta/.test(await pag.evaluate(() => document.body.innerText)));
    anotar('[A] La pastilla «Ver SINPE» está en la caja y la caja no escribe «null»', await pag.locator('text=Ver SINPE').count() > 0 && sinNull(await pag.evaluate(() => document.body.innerText)));
    // 1b. La lista flotante de la caja (esquina)
    await pag.getByText('Ver SINPE', { exact: true }).first().click(); await pag.waitForSelector('.sinpe-fila', { timeout: 8000 });
    const flot = await pag.evaluate(() => document.body.innerText);
    anotar('[A] Lista flotante: muestra los SINPE y el indicador del teléfono, sin «null»', /Teléfono de SINPE conectado/.test(flot) && /ARAICA LARIOS/.test(flot) && sinNull(flot));
    await pag.screenshot({ path: path.join(salida, 'cobro A 1 lista flotante escritorio.png') });
    await pag.keyboard.press('Escape'); await pag.waitForTimeout(400);
    if (await pag.locator('.sinpe-fila').count()) { const x = pag.getByRole('button', { name: /Cerrar|✕|×/ }).last(); await x.click({ timeout: 2000 }).catch(() => {}); }

    // 2. Armar venta y abrir el cobro
    await armar(pag);
    await abrirCobro(pag);
    await cli.waitForTimeout(900);
    anotar('[A] Pantalla del cliente: al abrir el cobro pasa a «pago» sin «Pago recibido» ni nombre', (await vista()) === 'pago' && !(await visibleCli('pg-sinpe')) && !/Tiffany|Pago recibido/.test(await textoCli()));
    await cli.screenshot({ path: path.join(salida, 'cobro A 2 cliente pago sin sinpe.png') });
    // 3. Medio SINPE: lista, indicador, monto exacto
    await medio(pag, 'sinpe'); await pag.waitForSelector('.sinpe-fila');
    const m1 = await pag.evaluate(() => ({ t: document.querySelector('.modal-fondo:last-of-type').innerText, ind: document.querySelector('.sinpe-ind')?.dataset.nivel, exactos: [...document.querySelectorAll('.sinpe-fila.exacto')].map((f) => f.dataset.id), cobrarOff: [...document.querySelectorAll('.modal-fondo:last-of-type button')].find((b) => /^Cobrar ₡/.test(b.innerText))?.disabled }));
    anotar('[A] Cobro con SINPE: indicador «conectado», sin «null», y «Cobrar» disponible sin escoger nada', m1.ind === 'ok' && sinNull(m1.t) && m1.cobrarOff === false, JSON.stringify({ ind: m1.ind, cobrarOff: m1.cobrarOff }));
    anotar('[A] Monto exacto: se resaltan solo los de hoy y sin usar del mismo monto (p1 y p2), no el de ayer ni el de otro monto', m1.exactos.sort().join() === 'p1,p2', m1.exactos.join());
    await pag.screenshot({ path: path.join(salida, 'cobro A 3 cobro sinpe lista escritorio.png') });
    // 4. Escoger un SINPE de la lista -> comprobante lleno, pantalla del cliente con «Pago recibido» y nombre
    await pag.locator('.sinpe-fila[data-id=p1] button').click(); await pag.waitForTimeout(1000);
    const ref1 = await pag.locator('.modal-fondo').last().locator('input.campo').last().inputValue();
    anotar('[A] Escoger un SINPE de la lista llena el comprobante', ref1 === C.c1, ref1);
    await cli.waitForTimeout(700);
    const tc = await textoCli();
    anotar('[A] Pantalla del cliente con el pago ligado: «Pago recibido ₡7 500» y el nombre del pagador', (await visibleCli('pg-sinpe')) && /Pago recibido\s+₡7\D?500/.test(tc) && /Tiffany|Araica/i.test(tc), tc.replace(/\s+/g, ' ').slice(0, 140));
    await cli.screenshot({ path: path.join(salida, 'cobro A 4 cliente pago recibido con nombre.png') });
    anotar('[A] La base anota el SINPE como usado en esta venta', mundo.sinpe.usados.get('p1') === '#001', String(mundo.sinpe.usados.get('p1')));
    await pag.screenshot({ path: path.join(salida, 'cobro A 4 sinpe escogido escritorio.png') });
    // 5. Retirar el SINPE
    await pag.locator('.sinpe-elegido').getByRole('button', { name: 'Quitar' }).click(); await pag.waitForTimeout(900);
    const ref2 = await pag.locator('.modal-fondo').last().locator('input.campo').last().inputValue();
    anotar('[A] Retirar el SINPE: el comprobante se vacía y la lista vuelve', ref2 === '' && (await pag.locator('.sinpe-fila').count()) >= 3, JSON.stringify(ref2));
    await cli.waitForTimeout(500);
    anotar('[A] Retirar el SINPE: la pantalla del cliente deja de mostrar el pago y el nombre', !(await visibleCli('pg-sinpe')) && !/Tiffany|Araica/i.test(await textoCli()));
    anotar('[A] Retirar el SINPE: la base lo libera', !mundo.sinpe.usados.has('p1'));
    await botonCobrar(pag).waitFor();
    anotar('[A] Sin SINPE escogido «Cobrar» sigue disponible', await botonCobrar(pag).isEnabled());
    // 6. Cerrar el cobro sin cobrar con un SINPE escogido: nada queda ligado
    await pag.locator('.sinpe-fila[data-id=p1] button').click(); await pag.waitForTimeout(700);
    await pag.locator('.modal-fondo').last().getByRole('button', { name: /Cerrar/ }).first().click(); await pag.waitForTimeout(1000);
    anotar('[A] Cerrar el cobro con un SINPE escogido: la pantalla del cliente vuelve a la cuenta sin nombre', (await vista()) === 'cuenta' && !/Tiffany|Araica|Pago recibido/i.test(await textoCli()));
    anotar('[A] Cerrar el cobro con un SINPE escogido: la base lo libera y la cuenta sigue abierta', !mundo.sinpe.usados.has('p1') && [...mundo.ventas.values()][0].estado === 'abierta');
    // 7. Cobrar con SINPE escogido (venta #1)
    await abrirCobro(pag); await medio(pag, 'sinpe'); await pag.waitForSelector('.sinpe-fila');
    await pag.locator('.sinpe-fila[data-id=p1] button').click(); await pag.waitForTimeout(900);
    await cli.waitForTimeout(500);
    const ms1 = await cobrarYa(pag);
    const c1 = ultimoCobro();
    anotar('[A] Cobro con SINPE: el medio que viaja al servidor es «sinpe» (el XML lo pasa a 06) con el comprobante escogido', c1.pagos.length === 1 && c1.pagos[0].medio === 'sinpe' && c1.pagos[0].monto === 7500 && c1.pagos[0].referencia === C.c1, JSON.stringify(c1.pagos));
    const exitoTxt = await pag.evaluate(() => document.body.innerText);
    anotar('[A] El tiquete dice «SINPE Móvil» por el total y no escribe «null»', /Cobro registrado/.test(exitoTxt) && /SINPE Móvil\s+₡7\D?500,00/.test(exitoTxt) && sinNull(exitoTxt), exitoTxt.match(/Tiquete[^\n]*\n[^\n]*\n[^\n]*\n[^\n]*/)?.[0]?.replace(/\n/g, ' | '));
    await pag.screenshot({ path: path.join(salida, 'cobro A 7 cobro registrado escritorio.png') });
    await cli.waitForTimeout(600);
    const tp = await textoCli();
    anotar('[A] Pantalla del cliente cobrada con SINPE: «Muchas gracias» y «SINPE Móvil recibido de» con el nombre', (await vista()) === 'pagado' && (await visibleCli('pd-sinpe')) && /SINPE Móvil recibido de Araica Larios Tiffany Melanie/.test(tp), tp.replace(/\s+/g, ' ').slice(0, 160));
    await cli.screenshot({ path: path.join(salida, 'cobro A 7 cliente pagado con nombre.png') });
    anotar('[A] Cobrar con SINPE conserva el SINPE como usado en la venta #001', mundo.sinpe.usados.get('p1') === '#001');
    await cerrarExito(pag);
    await cli.waitForTimeout(6800);
    anotar('[A] Tras el «pagado» la pantalla del cliente vuelve sola y no queda el nombre en la página ni en el navegador', !/Tiffany|Araica/i.test(await cli.evaluate(() => document.documentElement.innerHTML)) && (await cli.evaluate(() => !/Tiffany|Araica/i.test(JSON.stringify({ ...localStorage, ...sessionStorage })))));

    // 8. Segunda venta: comprobante repetido, de otro día, de otra empresa, que no aparece
    await armar(pag); await abrirCobro(pag); await medio(pag, 'sinpe'); await pag.waitForSelector('.sinpe-fila');
    const usado = await pag.evaluate(() => ({ p1: document.querySelector('.sinpe-fila[data-id=p1]')?.className, t: document.querySelector('.sinpe-fila[data-id=p1]')?.innerText.replace(/\s+/g, ' ') }));
    anotar('[A] Segunda venta: el SINPE ya usado sale como «Usado en la venta #001» y sin resaltar como exacto', /usado/.test(usado.p1) && !/exacto/.test(usado.p1) && /Usado en la venta #001/.test(usado.t), usado.t);
    const casos = [
      ['repetido', C.c1, /ya se usó en la venta #001/],
      ['de otro día', C.ayer, /ayer, no hoy/],
      ['de otra empresa', C.ajeno, /otra empresa/],
      ['que no aparece', C.nuevo, /no aparece entre los SINPE/],
      ['de hoy y bueno', C.c2, /recibido hoy a las .* por ₡7 500/],
    ];
    for (const [nombre, ref, rx] of casos) {
      await escribirRef(pag, ref);
      const n = await notas(pag); const cobrable = await botonCobrar(pag).isEnabled();
      anotar(`[A] Comprobante ${nombre}: la nota sale y «Cobrar» sigue disponible`, rx.test(n) && cobrable, n);
      if (nombre === 'de otra empresa') anotar('[A] Comprobante de otra empresa: no muestra monto ni nombre de esa empresa', !/₡|ARAICA|JIMENEZ|MORA|VARGAS/i.test(n), n);
      if (nombre === 'repetido') await pag.screenshot({ path: path.join(salida, 'cobro A 8 comprobante repetido escritorio.png') });
      if (nombre === 'de otro día') await pag.screenshot({ path: path.join(salida, 'cobro A 8 comprobante de otro dia escritorio.png') });
      if (nombre === 'de otra empresa') await pag.screenshot({ path: path.join(salida, 'cobro A 8 comprobante de otra empresa escritorio.png') });
    }
    // 8b. Escribir el comprobante a mano (sin escoger de la lista) y cobrar: el cobro sale y la pantalla del cliente NO muestra nombre
    await escribirRef(pag, C.c2);
    await cli.waitForTimeout(500);
    anotar('[A] Comprobante escrito a mano (sin ligar de la lista): la pantalla del cliente no muestra «Pago recibido» ni nombre', !(await visibleCli('pg-sinpe')) && !/Jimenez|Carlos|Pago recibido/i.test(await textoCli()));
    await cobrarYa(pag);
    const c2 = ultimoCobro();
    anotar('[A] Segunda venta cobrada aunque el comprobante tuviera notas: medio «sinpe» y el comprobante escrito', c2.pagos[0].medio === 'sinpe' && c2.pagos[0].referencia === C.c2, JSON.stringify(c2.pagos));
    anotar('[A] Cobro escrito a mano: la pantalla del cliente cobra sin nombre', (await vista()) === 'pagado' && !/Jimenez|Carlos/i.test(await textoCli()));
    await cerrarExito(pag);

    // 9. Fallas de SINPE: el cobro nunca depende de eso (venta 3: lista, revisión y marca caídas; venta 4: lenta)
    mundo.sinpe.falla = { flags: false, lista: true, revisar: true, usar: true };
    await armar(pag); await abrirCobro(pag); await medio(pag, 'sinpe'); await pag.waitForTimeout(1500);
    const f1 = await modalTxt(pag);
    anotar('[A] Con la lista de SINPE caída la caja lo dice con palabras (sin «null») y deja cobrar', /No se pudieron consultar los SINPE/.test(f1) && sinNull(f1) && (await botonCobrar(pag).isEnabled()), f1.match(/No se pudieron[^\n]*/)?.[0]);
    await escribirRef(pag, C.libre);
    anotar('[A] Con la revisión del comprobante caída no sale ninguna nota ni error y deja cobrar', (await notas(pag)) === '' && (await botonCobrar(pag).isEnabled()));
    await pag.screenshot({ path: path.join(salida, 'cobro A 9 sinpe caido escritorio.png') });
    await cobrarYa(pag);
    anotar('[A] Con todo SINPE caído el cobro con SINPE Móvil sale igual (comprobante escrito a mano)', ultimoCobro().pagos[0].medio === 'sinpe' && ultimoCobro().pagos[0].referencia === C.libre, JSON.stringify(ultimoCobro().pagos));
    await cerrarExito(pag);
    // lenta: el cobro no espera a la lista
    mundo.sinpe.falla = { flags: false, lista: false, revisar: false, usar: false }; mundo.sinpe.lento = 9000;
    await armar(pag); await abrirCobro(pag); await medio(pag, 'sinpe'); await escribirRef(pag, C.libre);
    const ms3 = await cobrarYa(pag);
    anotar('[A] Con SINPE muy lento (9 s) el cobro sale en menos de 4 s: no espera a la lista ni a la revisión', ms3 < 4000, ms3 + ' ms');
    await cerrarExito(pag); mundo.sinpe.lento = 0;
    // teléfono sin señal: aviso, pero se cobra
    mundo.sinpe.ultimo_latido = hace(50);
    await armar(pag); await abrirCobro(pag); await medio(pag, 'sinpe'); await pag.waitForSelector('.sinpe-fila');
    const at = await pag.evaluate(() => ({ nivel: document.querySelector('.sinpe-ind')?.dataset.nivel, t: document.querySelector('.sinpe-ind')?.innerText.replace(/\s+/g, ' ') }));
    anotar('[A] Teléfono sin señal 50 min: aviso con palabras y «el cobro sigue igual»; «Cobrar» disponible', at.nivel === 'atraso' && /no da señal desde hace 50 minutos/.test(at.t) && /el cobro sigue igual/.test(at.t) && (await botonCobrar(pag).isEnabled()), at.t);
    await pag.screenshot({ path: path.join(salida, 'cobro A 9 telefono sin senal escritorio.png') });
    await pag.locator('.sinpe-fila[data-id=p3] button').click(); await pag.waitForTimeout(500); // escoger uno de monto distinto: solo informa
    const dif = await modalTxt(pag);
    anotar('[A] SINPE de otro monto: dice que es solo informativo y deja cobrar', /solo informativo: el cobro no se detiene/.test(dif) && (await botonCobrar(pag).isEnabled()));
    await cobrarYa(pag); await cerrarExito(pag);

    // 10. Efectivo, tarjeta y pago mixto no se tocan por SINPE
    mundo.sinpe.ultimo_latido = hace(5);
    await armar(pag); await abrirCobro(pag); await pag.waitForTimeout(1500);
    const desde = mundo.llamadas.length;
    await medio(pag, 'efectivo');
    await pag.locator('.modal-fondo').last().getByRole('button', { name: 'Exacto' }).click().catch(() => {});
    await pag.waitForTimeout(1000);
    await cobrarYa(pag);
    anotar('[A] Cobro en efectivo: medio «efectivo», sin lista ni notas, y sin revisar ni marcar nada de SINPE (la pastilla «Ver SINPE» sigue su sondeo aparte)', ultimoCobro().pagos[0].medio === 'efectivo' && sinpeLlamadas(desde).filter((f) => f !== 'fx_sinpe_lista').length === 0 && !(await pag.locator('.sinpe-fila').count()), JSON.stringify(sinpeLlamadas(desde)));
    await cerrarExito(pag);
    await armar(pag); await abrirCobro(pag); await medio(pag, 'tarjeta');
    await cobrarYa(pag);
    anotar('[A] Cobro con tarjeta: medio «tarjeta»', ultimoCobro().pagos[0].medio === 'tarjeta');
    await cerrarExito(pag);
    // Express: una cuenta de tipo «express» con ese nombre (se nombra en el servidor de mentira; el cobro la lee como cualquier otra) y se cobra con SINPE
    await pag.getByRole('button', { name: 'Cuenta nueva' }).click(); await pag.waitForTimeout(800);
    await armar(pag);
    for (const v of mundo.ventas.values()) if (v.estado === 'abierta' && (mundo.lineas.get(v.id) || []).length) { v.tipo_servicio = 'express'; v.referencia = 'Express'; }
    await abrirCobro(pag); await medio(pag, 'sinpe'); await pag.waitForSelector('.sinpe-fila');
    const ex = await modalTxt(pag);
    anotar('[A] Cuenta «Express»: el cobro con SINPE muestra la lista sin «null»', sinNull(ex) && /SINPE Móvil recibidos/.test(ex));
    await pag.locator('.sinpe-fila[data-id=p3] button').click(); await pag.waitForTimeout(500);
    await cobrarYa(pag);
    anotar('[A] Cuenta «Express» cobrada con SINPE: medio «sinpe»', ultimoCobro().pagos[0].medio === 'sinpe');
    await cerrarExito(pag);

    // 11. Pago mixto SINPE + efectivo, con la pantalla del cliente abierta
    await armar(pag, 2, 0); await abrirCobro(pag);
    await pag.getByText('Pagar con dos medios (pago mixto)').click(); await pag.waitForTimeout(600);
    await medio(pag, 'sinpe'); await pag.waitForSelector('.sinpe-fila');
    await pag.locator('.sinpe-fila[data-id=p3] button').click(); await pag.waitForTimeout(800);
    await pag.locator('.modal-fondo').last().locator('input.monto-grande').fill('3200'); await pag.waitForTimeout(300);
    await pag.getByRole('button', { name: 'Agregar este pago y elegir otro medio' }).click(); await pag.waitForTimeout(700);
    await medio(pag, 'efectivo'); await pag.waitForTimeout(500);
    await pag.screenshot({ path: path.join(salida, 'cobro A 11 pago mixto escritorio.png') });
    await cobrarYa(pag);
    const cm = ultimoCobro().pagos;
    anotar('[A] Pago mixto: SINPE ₡3 200 con su comprobante + efectivo ₡2 800 (el resto)', cm.length === 2 && cm[0].medio === 'sinpe' && cm[0].monto === 3200 && cm[0].referencia === C.c3 && cm[1].medio === 'efectivo' && cm[1].monto === 2800, JSON.stringify(cm));
    await cerrarExito(pag);

    // 12. Cierre de caja con todo lo de SINPE caído
    mundo.sinpe.falla = { flags: true, lista: true, revisar: true, usar: true };
    await pag.getByRole('button', { name: /Volver al inicio/ }).click(); await pag.waitForTimeout(800);
    await pag.getByRole('button', { name: 'Cerrar caja' }).first().click(); await pag.waitForSelector('text=Cerrar la caja');
    const cierreTxt = await pag.evaluate(() => document.body.innerText);
    anotar('[A] Pantalla de cierre de la cajera: no hay nada de SINPE, no sale «null» y no hay cuentas abiertas', !/SINPE/i.test(cierreTxt) && sinNull(cierreTxt) && /Todo cobrado/.test(cierreTxt) || (/Cuentas abiertas/.test(cierreTxt) && !/Hay \d+ cuentas? abierta/.test(cierreTxt)), (cierreTxt.match(/CUENTAS ABIERTAS[\s\S]{0,40}/)?.[0] || '').replace(/\n/g, ' '));
    await pag.screenshot({ path: path.join(salida, 'cobro A 12 cierre escritorio.png') });
    const efEsperado = 20000 + mundo.pagos.filter((p) => p.medio === 'efectivo').reduce((a, p) => a + p.monto, 0);
    await pag.locator('input').first().fill(String(efEsperado));
    await pag.getByRole('button', { name: 'Cerrar caja' }).last().click();
    await esperar(pag, () => /Caja cerrada/.test(document.body.innerText), 15000).catch(() => {});
    anotar('[A] Cierre de caja con SINPE sin respuesta: la caja se cierra (la cuenta vacía de después del último cobro no estorba)', !!mundo.turnoCerrado && mundo.cierres.length === 1, 'cierres=' + mundo.cierres.length + ' ' + (await pag.evaluate(() => document.body.innerText)).replace(/\n/g, ' ').slice(0, 120));
    await pag.screenshot({ path: path.join(salida, 'cobro A 12 caja cerrada escritorio.png') });
    anotar('[A] Ningún aviso de pantalla ni error de JavaScript en toda la prueba', bad(errores).length === 0, bad(errores).join(' | ').slice(0, 400));
    anotar('[A] Funciones del servidor sin implementar en el servidor de mentira (solo ajustes ajenos a SINPE)', [...(mundo.sinImplementar || [])].every((f) => /^(fx_tipos_identificacion_permitidos|fx_pantalla_config_leer)$/.test(f)), [...(mundo.sinImplementar || [])].join(','));
    await ctx.close();
  }

  /* ==================== B. CELULAR 390x844 ==================== */
  {
    const { ctx, pag, errores } = await sesion({ ancho: 390, alto: 844 });
    await abrirCaja(pag);
    await armar(pag);
    await abrirCobro(pag); await medio(pag, 'sinpe'); await pag.waitForSelector('.sinpe-fila');
    const desb = await pag.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    anotar('[B celular] Cobro con SINPE: la lista cabe sin desborde horizontal', !desb);
    await pag.screenshot({ path: path.join(salida, 'cobro B 1 cobro sinpe celular.png') });
    await pag.locator('.sinpe-fila[data-id=p1] button').click(); await pag.waitForTimeout(900);
    await escribirRef(pag, C.ayer);
    anotar('[B celular] Nota de comprobante de otro día visible y «Cobrar» disponible', /ayer/.test(await notas(pag)) && (await botonCobrar(pag).isEnabled()), await notas(pag));
    await pag.screenshot({ path: path.join(salida, 'cobro B 2 nota comprobante celular.png') });
    await cobrarYa(pag);
    anotar('[B celular] Cobro con SINPE sale desde el celular', ultimoCobro().pagos[0].medio === 'sinpe');
    await pag.screenshot({ path: path.join(salida, 'cobro B 3 cobro registrado celular.png') });
    await cerrarExito(pag);
    anotar('[B celular] Sin errores de JavaScript', bad(errores).length === 0, bad(errores).join(' | ').slice(0, 300));
    await ctx.close();
  }

  /* ==================== C. SINPE apagado o con la bandera caída ==================== */
  for (const [nombre, antes] of [['bandera apagada', () => { mundo.sinpe.activa = false; }], ['bandera sin respuesta', () => { mundo.sinpe.falla.flags = true; }]]) {
    const { ctx, pag, errores } = await sesion({ ancho: 1366, alto: 768, antes });
    await abrirCaja(pag); await armar(pag); await abrirCobro(pag); await medio(pag, 'sinpe'); await pag.waitForTimeout(800);
    const t = await modalTxt(pag);
    anotar(`[C] ${nombre}: no hay lista ni indicador ni notas de SINPE en el cobro, y se cobra con SINPE Móvil como siempre`, !(await pag.locator('.sinpe-fila, .sinpe-ind').count()) && sinNull(t) && (await botonCobrar(pag).isEnabled()));
    await escribirRef(pag, C.c1);
    anotar(`[C] ${nombre}: escribir un comprobante no dispara ninguna revisión`, (await notas(pag)) === '' && !mundo.llamadas.some((l) => l.fn === 'fx_sinpe_ref_revisar'));
    await cobrarYa(pag);
    anotar(`[C] ${nombre}: el cobro con SINPE sale con medio «sinpe»`, ultimoCobro().pagos[0].medio === 'sinpe' && ultimoCobro().pagos[0].referencia === C.c1);
    anotar(`[C] ${nombre}: sin errores de JavaScript`, bad(errores).length === 0, bad(errores).join(' | ').slice(0, 300));
    await ctx.close();
  }

  /* ==================== D. Perfil de Dixia: Pagos SINPE (administradora) ==================== */
  {
    const { ctx, pag, errores } = await sesion({ ancho: 1366, alto: 768, usuario: { usuario: 'dixia', nombre: 'Dixia', admin: true } });
    await pag.waitForTimeout(1500);
    const t0 = await pag.evaluate(() => document.body.innerText);
    anotar('[D] Perfil de Dixia: el inicio muestra la tarjeta «Pagos SINPE»', /Pagos SINPE/.test(t0), t0.replace(/\s+/g, ' ').slice(0, 120));
    await pag.screenshot({ path: path.join(salida, 'cobro D 1 inicio dixia.png') });
    await pag.locator('button', { hasText: 'Pagos SINPE' }).first().click(); await pag.waitForSelector('.sinpe-fila', { timeout: 8000 });
    const t1 = await pag.evaluate(() => document.body.innerText);
    anotar('[D] Perfil de Dixia: Pagos SINPE muestra la lista (con períodos) sin «null»', /ARAICA LARIOS/.test(t1) && /Hoy/.test(t1) && sinNull(t1));
    await pag.screenshot({ path: path.join(salida, 'cobro D 2 pagos sinpe dixia.png') });
    anotar('[D] Perfil de Dixia: sin errores de JavaScript', bad(errores).length === 0, bad(errores).join(' | ').slice(0, 300));
    await ctx.close();
  }

  /* ==================== E. Permisos de «Caja para mí»: la cajera no la ve, no entra y no le llega nada de administración (revisión 27 nov 2026) ==================== */
  {
    const admFn = (l) => /^fx_sinpe_adm_/.test(l.fn);
    // E1: cajera (usuario zzcajera, admin: false): ni en el menú, ni en la búsqueda, ni escribiendo la dirección a mano
    const c = await sesion({ ancho: 1366, alto: 768 });
    await c.pag.waitForTimeout(1200);
    const txt0 = await c.pag.evaluate(() => document.body.innerText);
    anotar('[E] Cajera: ni «Caja para mí» ni «Pagos SINPE» aparecen en la pantalla', !/Caja para m/i.test(txt0) && !/Pagos SINPE/.test(txt0), txt0.replace(/\s+/g, ' ').slice(0, 100));
    for (const ruta of ['caja-para-mi', 'admin/caja-para-mi', 'sinpe_caja']) {
      await c.pag.evaluate((r) => { location.hash = r; }, ruta); await c.pag.waitForTimeout(700);
      const t = await c.pag.evaluate(() => document.body.innerText); const h = await c.pag.evaluate(() => location.hash);
      anotar('[E] Cajera: escribir la dirección «' + ruta + '» a mano no abre la pantalla de administración', !/Solo para el administrador|Mi teléfono|Órdenes al teléfono|Conciliaci/i.test(t) && !/caja-para-mi/.test(h), h);
    }
    anotar('[E] Cajera: ninguna llamada a fx_sinpe_adm_* sale de su sesión', !mundo.llamadas.some(admFn), mundo.llamadas.filter(admFn).map((l) => l.fn).join(','));
    anotar('[E] Cajera: sin errores de JavaScript', bad(c.errores).length === 0, bad(c.errores).join(' | ').slice(0, 300));
    await c.ctx.close();
    // E2: administradora (dixia): sí la ve en el menú y la pantalla abre (el servidor de mentira no implementa fx_sinpe_adm_*: solo se comprueba la puerta)
    const a = await sesion({ ancho: 1366, alto: 768, usuario: { usuario: 'dixia', nombre: 'Dixia', admin: true } });
    await a.pag.waitForTimeout(1200);
    const ta = await a.pag.evaluate(() => document.body.innerText);
    anotar('[E] Administradora: «Caja para mí» aparece en el menú', /Caja para m/i.test(ta));
    await a.pag.evaluate(() => { location.hash = 'caja-para-mi'; }); await a.pag.waitForTimeout(1200);
    const tb = await a.pag.evaluate(() => document.body.innerText);
    anotar('[E] Administradora: «Caja para mí» abre con sus pestañas', /Solo para el administrador/.test(tb) && /SINPE sin factura/.test(tb), tb.replace(/\s+/g, ' ').slice(0, 100));
    await a.ctx.close();
  }
} finally {
  fs.writeFileSync(path.join(salida, 'sinpe-cobro.json'), JSON.stringify(informe, null, 1));
  await nav.close(); servidor.close();
}
const fallas = informe.pruebas.filter((x) => !x.ok);
console.log('\n' + (informe.pruebas.length - fallas.length) + '/' + informe.pruebas.length + ' pruebas bien');
process.exit(fallas.length ? 1 : 0);
