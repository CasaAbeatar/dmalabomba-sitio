// Lista de entradas y salidas de efectivo de un turno, para «Apertura y cierre de caja».
// Anotar y anular dinero pasa SIEMPRE por la misma zona y la misma ventana con motivo que usa Facturación (ui_efectivo_rapido.js): aquí no hay otra forma de hacerlo.
import { h, money, horaCorta } from './util.js';
import { anularMovimiento } from './ui_efectivo_rapido.js';

// Anula una salida o una entrada pidiendo el motivo. Devuelve true si se anuló.
export const anularSalida = (s) => anularMovimiento({ ...s, tipo: 'salida' });
export const anularEntrada = (e) => anularMovimiento({ ...e, tipo: 'entrada' });

// Lista de movimientos del turno (con botón Anular si se pasa alAnular). tipo: 'salida' | 'entrada'
export function listaSalidas(items, alAnular, tipo = 'salida') {
  const palabra = tipo === 'entrada' ? 'la entrada' : 'la salida';
  if (!items.length) return h('p.tenue-linea', tipo === 'entrada' ? 'Todavía no hay entradas de efectivo en este turno.' : 'Todavía no hay salidas de efectivo en este turno.');
  return h('div.col', items.map((s) => h('div.salida-item',
    h('div', h('div.s-mot', s.motivo), h('div.s-det', horaCorta(s.creado_en) + ' · ' + (s.creado_por || ''))),
    h('div.s-monto', money(s.monto)),
    alAnular ? h('button.btn.chico.peligro', { type: 'button', 'aria-label': 'Anular ' + palabra + ' de ' + money(s.monto) + ' por ' + s.motivo, onclick: () => alAnular(s) }, 'Anular') : null)));
}
