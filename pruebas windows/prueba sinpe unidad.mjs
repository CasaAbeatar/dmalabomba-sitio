// SINPE en la caja (27 nov 2026): pruebas de la lógica pura y del emisor de la pantalla del cliente, sin navegador (solo node).
// Se corre desde «pruebas windows» (con la carpeta facturacion copiada al lado, como en el flujo de Windows) o desde la raíz del repositorio.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const raiz = fs.existsSync(path.resolve('facturacion/js')) ? path.resolve('facturacion') : path.resolve('..', 'facturacion');
const imp = (r) => import(pathToFileURL(path.join(raiz, 'js', r)).href);
const informe = [];
const prueba = async (nombre, fn) => { try { await fn(); informe.push({ nombre, ok: true }); console.log('OK   ' + nombre); } catch (e) { informe.push({ nombre, ok: false, detalle: String(e.message).slice(0, 400) }); console.log('FALLA ' + nombre + ' -> ' + e.message); } };

const C = await imp('sinpe_comprobante.js');
const ahora = new Date('2026-11-27T18:00:00Z').getTime(); // 12:00 en Costa Rica

/* ---- 1. Indicador del teléfono ---- */
await prueba('Indicador: señal hace 10 minutos = conectado', () => {
  const i = C.indicadorTelefono({ ahora: new Date(ahora).toISOString(), ultimo_latido: new Date(ahora - 10 * 60000).toISOString() });
  assert.equal(i.nivel, 'ok'); assert.match(i.texto, /conectado/);
});
await prueba('Indicador: más de 30 minutos sin señal avisa con palabras y dice que el cobro sigue igual', () => {
  const i = C.indicadorTelefono({ ahora: new Date(ahora).toISOString(), ultimo_latido: new Date(ahora - 45 * 60000).toISOString() });
  assert.equal(i.nivel, 'atraso'); assert.match(i.texto, /45 minutos/); assert.match(i.texto, /cobro sigue igual/);
});
await prueba('Indicador: días sin señal se dicen en días', () => {
  const i = C.indicadorTelefono({ ahora: new Date(ahora).toISOString(), ultimo_latido: new Date(ahora - 6 * 86400000).toISOString() });
  assert.equal(i.nivel, 'atraso'); assert.match(i.texto, /6 días/);
});
await prueba('Indicador: sin ningún latido conocido = «sin»', () => assert.equal(C.indicadorTelefono({ ahora: new Date(ahora).toISOString(), ultimo_latido: null }).nivel, 'sin'));
await prueba('Indicador: sin respuesta no inventa nada', () => { assert.equal(C.indicadorTelefono(null), null); assert.equal(C.indicadorTelefono(undefined), null); });
await prueba('Indicador: la edad se mide con el reloj del servidor aunque la computadora esté desfasada', () => {
  const i = C.indicadorTelefono({ ahora: new Date(ahora).toISOString(), ultimo_latido: new Date(ahora - 5 * 60000).toISOString() });
  assert.equal(i.nivel, 'ok');
});

/* ---- 2. Monto exacto ---- */
const hoy = new Date(ahora - 20 * 60000).toISOString(), ayer = new Date(ahora - 30 * 3600000).toISOString();
await prueba('Exacto: mismo monto, de hoy y sin usar = resaltado', () => assert.equal(C.esExacto({ monto: 8250, hora: hoy }, 8250, false, ahora), true));
await prueba('Exacto: monto con decimales de punto flotante igual', () => assert.equal(C.esExacto({ monto: '8250.00', hora: hoy }, 8250, false, ahora), true));
await prueba('Exacto: monto distinto no se resalta', () => assert.equal(C.esExacto({ monto: 8000, hora: hoy }, 8250, false, ahora), false));
await prueba('Exacto: ya usado no se resalta', () => assert.equal(C.esExacto({ monto: 8250, hora: hoy }, 8250, true, ahora), false));
await prueba('Exacto: de otro día no se resalta', () => assert.equal(C.esExacto({ monto: 8250, hora: ayer }, 8250, false, ahora), false));
await prueba('Exacto: total cero (cortesía) nunca resalta', () => assert.equal(C.esExacto({ monto: 0, hora: hoy }, 0, false, ahora), false));

/* ---- 3 y 4. Revisión del comprobante ---- */
await prueba('Comprobante repetido: avisa con el número de la venta anterior', () => {
  const n = C.revisarComprobante({ activa: true, vacio: false, repetido: true, repetido_venta: '#007', encontrado: true, otra_empresa: false, dias_antes: 0, pago: { hora: hoy, monto: 8250 } }, { total: 8250 });
  assert.ok(n.some((x) => x.tono === 'aviso' && /venta #007/.test(x.texto)));
});
await prueba('Comprobante de hoy y de esta empresa = nota verde con hora y monto', () => {
  const n = C.revisarComprobante({ activa: true, vacio: false, repetido: false, encontrado: true, otra_empresa: false, dias_antes: 0, pago: { hora: hoy, monto: 8250 } }, { total: 8250 });
  assert.equal(n.length, 1); assert.equal(n[0].tono, 'ok'); assert.match(n[0].texto, /recibido hoy a las 11:40/); assert.match(n[0].texto, /8\D250/);
});
await prueba('Comprobante de otro día: avisa la fecha', () => {
  const a = C.revisarComprobante({ activa: true, vacio: false, repetido: false, encontrado: true, otra_empresa: false, dias_antes: 1, pago: { hora: ayer, monto: 8250 } }, { total: 8250 });
  assert.match(a[0].texto, /ayer/); assert.equal(a[0].tono, 'aviso');
  const b = C.revisarComprobante({ activa: true, vacio: false, repetido: false, encontrado: true, otra_empresa: false, dias_antes: 6, pago: { hora: ayer, monto: 8250 } }, { total: 8250 });
  assert.match(b[0].texto, /hace 6 días/);
});
await prueba('Comprobante de la otra empresa: avisa y no muestra monto ni nombre', () => {
  const n = C.revisarComprobante({ activa: true, vacio: false, repetido: false, encontrado: true, otra_empresa: true }, { total: 8250 });
  assert.equal(n.length, 1); assert.match(n[0].texto, /otra empresa/); assert.doesNotMatch(n[0].texto, /₡/);
});
await prueba('Comprobante con monto distinto al cobro: nota informativa, no bloquea', () => {
  const n = C.revisarComprobante({ activa: true, vacio: false, repetido: false, encontrado: true, otra_empresa: false, dias_antes: 0, pago: { hora: hoy, monto: 5000 } }, { total: 8250 });
  assert.ok(n.some((x) => x.tono === 'info' && /solo informativo/.test(x.texto) && /cobro no se detiene/.test(x.texto)));
});
await prueba('Comprobante que no aparece: información (el aviso puede no haber llegado), no error', () => {
  const n = C.revisarComprobante({ activa: true, vacio: false, repetido: false, encontrado: false }, { total: 8250 });
  assert.equal(n.length, 1); assert.equal(n[0].tono, 'info'); assert.match(n[0].texto, /todavía no haya llegado/);
});
await prueba('Comprobante vacío, bandera apagada o sin respuesta: no se dice nada', () => {
  assert.deepEqual(C.revisarComprobante({ activa: true, vacio: true }), []);
  assert.deepEqual(C.revisarComprobante({ activa: false }), []);
  assert.deepEqual(C.revisarComprobante(null), []);
});
await prueba('refConsultable: pide al menos 4 letras o números', () => { assert.equal(C.refConsultable('12'), false); assert.equal(C.refConsultable('1-2-3'), false); assert.equal(C.refConsultable('2026-1121'), true); assert.equal(C.refConsultable('  '), false); });

/* ---- 5. Pantalla del cliente ---- */
await prueba('Nombre para el cliente: de MAYÚSCULAS a nombre propio, con tildes y ñ', () => {
  assert.equal(C.nombreParaCliente('ARAICA LARIOS TIFFANY MELANIE'), 'Araica Larios Tiffany Melanie');
  assert.equal(C.nombreParaCliente('  NÚÑEZ  ÑANDÚ\u0007 '), 'Núñez Ñandú');
  assert.equal(C.nombreParaCliente('   '), null); assert.equal(C.nombreParaCliente(null), null);
  assert.equal(C.nombreParaCliente('x'.repeat(200)).length, 60);
});
await prueba('datosParaPantalla: sin monto válido no hay nada que mostrar', () => {
  assert.deepEqual(C.datosParaPantalla({ pagador: 'JUAN PEREZ', monto: 5000 }), { nombre: 'Juan Perez', monto: 5000 });
  assert.equal(C.datosParaPantalla({ pagador: 'X', monto: 0 }), null); assert.equal(C.datosParaPantalla(null), null); assert.equal(C.datosParaPantalla({ monto: 'abc' }), null);
});

/* ---- 5b. Emisor: el nombre solo viaja cuando el SINPE está ligado a ESA venta y solo en «pago» / «pagado» ---- */
const E = await imp('pantalla_emisor.js');
const bus = new Set();
class CanalFalso { constructor() { bus.add(this); this.onmessage = null; } postMessage(m) { const copia = JSON.parse(JSON.stringify(m)); for (const o of bus) if (o !== this) o.vistos?.push(copia); registro.push(copia); } close() { bus.delete(this); } }
const registro = [];
const app = { socId: '00000000-0000-0000-0000-000000000001', terminal: 1, turno: { id: 1 }, empresa: { codigo: 'soda' } };
const cuenta = (id = 'venta-1') => ({ venta: { id, total: 8250 }, lineas: [{ descripcion: 'Casado con pollo', cantidad: 1, precio_final: 8250, total_linea: 8250, iva_tarifa: 13 }], cliente: null });
const em = E.iniciar(app, { BroadcastChannel: CanalFalso, sinVentana: true, leerConfig: async () => ({}) });
await new Promise((ok) => setTimeout(ok, 60));
const ultimoEstado = () => [...registro].reverse().find((m) => m.evento === 'estado')?.payload;
const nombres = () => JSON.stringify(registro).includes('Tiffany');

await prueba('Emisor: en la cuenta y al abrir el cobro NO viaja ningún SINPE ni nombre', () => {
  em.cuenta(cuenta()); assert.equal(ultimoEstado().estado, 'cuenta'); assert.equal(ultimoEstado().sinpe, null);
  em.pago(cuenta()); assert.equal(ultimoEstado().estado, 'pago'); assert.equal(ultimoEstado().sinpe, null); assert.equal(nombres(), false);
});
await prueba('Emisor: al escoger el SINPE de ESTA venta, «pago» lleva nombre y monto', () => {
  em.sinpe({ nombre: 'Tiffany Melanie Araica Larios', monto: 8250 }, 'venta-1');
  assert.deepEqual(ultimoEstado().sinpe, { nombre: 'Tiffany Melanie Araica Larios', monto: 8250 }); assert.equal(ultimoEstado().estado, 'pago');
});
await prueba('Emisor: al quitar el SINPE se retira de la pantalla del cliente', () => { em.sinpe(null, 'venta-1'); assert.equal(ultimoEstado().sinpe, null); });
await prueba('Emisor: un SINPE de otra venta no se muestra en esta (cuenta refrescada)', () => {
  em.sinpe({ nombre: 'Tiffany Melanie Araica Larios', monto: 8250 }, 'venta-OTRA'); em.pago(cuenta('venta-1'));
  assert.equal(ultimoEstado().sinpe, null);
  em.sinpe(null, 'venta-OTRA');
});
await prueba('Emisor: cerrar el cobro sin cobrar borra el SINPE y vuelve a «cuenta» sin nombre', () => {
  em.sinpe({ nombre: 'Tiffany Melanie Araica Larios', monto: 8250 }, 'venta-1'); assert.ok(ultimoEstado().sinpe);
  em.cerrarPago(cuenta()); assert.equal(ultimoEstado().estado, 'cuenta'); assert.equal(ultimoEstado().sinpe, null);
  em.pago(cuenta()); assert.equal(ultimoEstado().sinpe, null, 'al reabrir el cobro no queda el SINPE de antes');
});
await prueba('Emisor: pagado con SINPE conserva el nombre; el siguiente cobro empieza limpio', () => {
  em.sinpe({ nombre: 'Tiffany Melanie Araica Larios', monto: 8250 }, 'venta-1');
  em.pagado({ pagos_snapshot: [{ medio: 'sinpe', recibido: 8250 }], vuelto: 0 }, 0);
  assert.equal(ultimoEstado().estado, 'pagado'); assert.deepEqual(ultimoEstado().sinpe, { nombre: 'Tiffany Melanie Araica Larios', monto: 8250 }); assert.equal(ultimoEstado().medio, 'sinpe');
  em.cuenta(cuenta('venta-2')); em.pago(cuenta('venta-2')); // la retención de «pagado» no deja repintar enseguida: se espera
});
await prueba('Emisor: pagado en efectivo nunca lleva SINPE aunque hubiera uno escogido', async () => {
  await new Promise((ok) => setTimeout(ok, 6700));
  em.cuenta(cuenta('venta-3')); em.pago(cuenta('venta-3'));
  assert.equal(ultimoEstado().sinpe, null, 'el SINPE de la venta anterior no pasa a la siguiente');
  em.sinpe({ nombre: 'Tiffany Melanie Araica Larios', monto: 8250 }, 'venta-3');
  em.pagado({ pagos_snapshot: [{ medio: 'efectivo', recibido: 10000 }], vuelto: 1750 }, 1750);
  assert.equal(ultimoEstado().estado, 'pagado'); assert.equal(ultimoEstado().sinpe, null);
});
await prueba('Emisor: datos inválidos no rompen ni muestran nada', () => {
  em.cuenta(cuenta('venta-4')); em.pago(cuenta('venta-4'));
  em.sinpe({ nombre: 'X', monto: -5 }, 'venta-4'); assert.equal(ultimoEstado().sinpe, null);
  em.sinpe('texto', 'venta-4'); assert.equal(ultimoEstado().sinpe, null);
  em.sinpe({ nombre: 'Pedro', monto: 100 }, null); assert.equal(ultimoEstado().sinpe, null);
  assert.equal(em.fallos, 0);
});
em.detener();

const fallas = informe.filter((x) => !x.ok);
fs.mkdirSync(path.resolve('resultados'), { recursive: true });
fs.writeFileSync(path.resolve('resultados', 'sinpe-unidad.json'), JSON.stringify({ total: informe.length, fallas: fallas.length, informe }, null, 1));
console.log('\n' + (informe.length - fallas.length) + '/' + informe.length + ' pruebas bien');
process.exit(fallas.length ? 1 : 0);
