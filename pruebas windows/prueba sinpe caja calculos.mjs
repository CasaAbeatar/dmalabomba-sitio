// Pruebas de las cuentas y los textos de «Caja para mí» (facturacion/js/sinpe_admin_calc.js). Sin navegador ni base de datos: datos inventados, solo de prueba.
// Se corren con: node --test "prueba sinpe caja calculos.mjs"   (desde la carpeta «pruebas windows», con la carpeta facturacion copiada al lado, o desde la raíz con la ruta de abajo)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const candidatos = ['./facturacion/js/sinpe_admin_calc.js', '../facturacion/js/sinpe_admin_calc.js'];
const ruta = candidatos.map((c) => path.resolve(c)).find((c) => fs.existsSync(c));
const C = await import(pathToFileURL(ruta).href);

test('versiones: se leen aunque traigan fecha o la palabra ota', () => {
  assert.deepEqual(C.versionPartes('2.11.0'), [2, 11, 0]);
  assert.deepEqual(C.versionPartes('3.5 19nov'), [3, 5, 0]);
  assert.deepEqual(C.versionPartes('3.7 ota 26nov'), [3, 7, 0]);
  assert.equal(C.versionPartes('sin versión'), null);
  assert.equal(C.versionPartes(null), null);
});
test('versiones: comparar', () => {
  assert.equal(C.compararVersion('2.11.0', '2.12.0'), -1);
  assert.equal(C.compararVersion('2.12.0', '2.12'), 0);
  assert.equal(C.compararVersion('3.0.1', '2.99.9'), 1);
  assert.equal(C.compararVersion('x', '2.0'), null);
});
test('latido: «llama al día», «tarda», «sin señal», «nunca»', () => {
  assert.equal(C.estadoLatido(5).nivel, 'ok');
  assert.equal(C.estadoLatido(C.TARDA_MIN).nivel, 'ok');
  assert.equal(C.estadoLatido(C.TARDA_MIN + 1).nivel, 'tarda');
  assert.equal(C.estadoLatido(C.SIN_SENAL_MIN).nivel, 'tarda');
  assert.equal(C.estadoLatido(C.SIN_SENAL_MIN + 1).nivel, 'sin');
  assert.equal(C.estadoLatido(null).nivel, 'nunca');
});
test('hace cuánto', () => {
  assert.equal(C.haceTexto(0), 'ahora mismo');
  assert.equal(C.haceTexto(12), 'hace 12 min');
  assert.equal(C.haceTexto(200), 'hace 3 h 20 min');
  assert.equal(C.haceTexto(120), 'hace 2 h');
  assert.equal(C.haceTexto(1440), 'hace 1 día');
  assert.equal(C.haceTexto(1440 * 6), 'hace 6 días');
});
test('batería y red: dicen «No informa» cuando el teléfono no lo manda', () => {
  assert.equal(C.textoBateria({ bateria: null }), 'No informa');
  assert.equal(C.textoBateria({ bateria: 80, cargando: true }), '80 % · cargando');
  assert.equal(C.textoRed({}), 'No informa');
  assert.match(C.textoRed({ tipo_red: 'wifi', red_validada: true }), /con internet/);
});
test('banderas del kit: sin reglas no se inventa ninguna incompatibilidad', () => {
  const b = C.banderasKit({ telefonos: [{ telefono: 'T1', app: '2.11.0', minutos: 5 }], equipos: [{ estacion: 'e1', nombre: 'Caja 1', version_kit: '3.5 19nov', minutos: 10 }], reglas: [] });
  assert.ok(!b.some((x) => x.nivel === 'alto'));
  assert.ok(b.some((x) => /reglas de compatibilidad/.test(x.titulo)));
});
test('banderas del kit: sin señal, sin versión y regla de app mínima', () => {
  const tels = [{ telefono: 'T1', app: '2.10.0', minutos: 300 }, { telefono: 'T2', app: null, minutos: 3 }];
  const b = C.banderasKit({ telefonos: tels, equipos: [], reglas: [{ tipo: 'app_minima', app_min: '2.11.0', motivo: 'prueba' }] });
  assert.ok(b.some((x) => x.nivel === 'alto' && /no llama/.test(x.titulo)));
  assert.ok(b.some((x) => /no informa su versión/.test(x.titulo)));
  assert.ok(b.some((x) => x.nivel === 'alto' && /más vieja que la mínima/.test(x.titulo)));
  assert.equal(b[0].nivel, 'alto', 'lo grave va primero');
});
test('banderas del kit: regla app_exige_kit marca el cruce incompatible', () => {
  const b = C.banderasKit({ telefonos: [{ telefono: 'T1', app: '2.12.0', minutos: 1 }], equipos: [{ estacion: 'e1', nombre: 'Caja 1', version_kit: '3.5', minutos: 1 }], reglas: [{ tipo: 'app_exige_kit', app_min: '2.12.0', kit_min: '3.7.0' }] });
  assert.ok(b.some((x) => x.nivel === 'alto' && /pide el kit 3\.7\.0/.test(x.titulo)));
});
test('banderas del kit: el manifiesto avisa de una versión publicada más nueva', () => {
  const m = { lanzamientos: [{ serie: 2, version: '3.7 ota 26nov', estaciones: ['e1'] }] };
  const b = C.banderasKit({ telefonos: [], equipos: [{ estacion: 'e1', nombre: 'Caja 1', version_kit: '3.5 19nov', minutos: 1 }], manifiesto: m });
  assert.ok(b.some((x) => x.nivel === 'info' && /más nueva/.test(x.titulo)));
});
test('media, desviación estándar muestral y coeficiente de variación', () => {
  const r = C.resumenNumeros([2, 4, 4, 4, 5, 5, 7, 9]);
  assert.equal(r.n, 8);
  assert.equal(r.media, 5);
  assert.ok(Math.abs(r.sd - 2.138089935) < 1e-6);
  assert.ok(Math.abs(r.cv - 2.138089935 / 5) < 1e-6);
  assert.deepEqual(C.resumenNumeros([]), { n: 0, media: null, sd: null, cv: null });
  assert.equal(C.resumenNumeros([7]).sd, null);
});
test('recorte de horas: sin horas vacías en las puntas, con las del medio', () => {
  const ph = Array.from({ length: 24 }, (_, h) => ({ hora: h, n: [9, 12, 13].includes(h) ? 3 : 0 }));
  assert.deepEqual(C.recorteHoras(ph).map((x) => x.hora), [9, 10, 11, 12, 13]);
  assert.deepEqual(C.recorteHoras([]), []);
});
test('filtro de la lista: por nombre sin tildes, referencia y monto escrito de varias formas', () => {
  const p = { pagador: 'María Pérez', referencia: '123456789', monto: 5000, detalle: '' };
  assert.ok(C.coincidePago(p, 'maria'));
  assert.ok(C.coincidePago(p, '5.000'));
  assert.ok(C.coincidePago(p, '5 000'));
  assert.ok(C.coincidePago(p, '4567'));
  assert.ok(!C.coincidePago(p, 'juan'));
  assert.ok(C.coincidePago(p, ''));
});
test('tabla para la contadora: orden cronológico (enero primero), suma y nombres claros', () => {
  const d = { filas: [
    { hora: '2026-11-03T15:00:00Z', monto: 3000, referencia: '222', estado: 'asignado', origen: 'en_vivo', pagador: 'Prueba Dos', venta_numero: 'V-2', clave: 'K2' },
    { hora: '2026-11-01T15:00:00Z', monto: 2000, referencia: '111', estado: 'sin_asignar', origen: 'historial', pagador: 'Prueba Uno', venta_numero: null, clave: null }] };
  const t = C.tablaInformeMes(d);
  assert.equal(t.filas.length, 2);
  assert.equal(t.filas[0].fecha, '2026-11-01', 'el día 1 va primero');
  assert.equal(t.filas.reduce((a, f) => a + f.monto, 0), 5000);
  assert.deepEqual(t.columnas.map((c) => c.clave).slice(0, 3), ['fecha', 'hora', 'monto']);
  assert.equal(t.cifras, 'brutas');
  assert.ok(t.columnas.some((c) => /Clave de la factura/.test(c.titulo)));
});
test('resumen del mes: la diferencia es avisos del banco menos medio 06', () => {
  const t = C.tablaResumenMes({ resumen: { n: 10, total: 100000, con_venta_n: 8, con_venta_total: 90000, con_clave_n: 7, con_clave_total: 80000, sin_venta_n: 2, sin_venta_total: 10000 }, medio06_facturas: { n: 7, total: 80000 }, notas_credito_mes: { n: 0, total: 0 } });
  const dif = t.filas.find((f) => /Diferencia/.test(f.concepto));
  assert.equal(dif.monto, 20000);
});
test('serie por hora: queda cronológica y avisa que es solo la parte SINPE', () => {
  const t = C.tablaSerieHoras({ nota: 'Solo la parte pagada con SINPE Móvil', filas: [{ dia: '2026-11-02', hora: 12, n: 2, total: 9000 }, { dia: '2026-11-02', hora: 13, n: 1, total: 3000 }] });
  assert.equal(t.filas[0].hora, 12);
  assert.match(t.notas[0], /SINPE/);
});
test('texto de la hora: trae promedio, desviación estándar y variación', () => {
  const s = C.lecturaHora({ hora: 12, n: 40, dia_media: 2.5, dia_sd: 1.2, dia_cv: 0.48, ticket_media: 4000, ticket_sd: 1500, ticket_cv: 0.375 });
  assert.match(s, /12:00 a 13:00/);
  assert.match(s, /desviación estándar/);
});
