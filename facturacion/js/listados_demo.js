// MODO DEMOSTRACIÓN: datos inventados que se generan solo en el navegador para ver el aspecto de Listados. No se guarda nada en la base.
import { sumaDias } from './util.js';

const CAJONES = { '01': 'Hamburguesas, pollo y pizzas', '02': 'Tex-Mex', '05': 'Casados y platos fuertes', '08': 'Papas', '11': 'Gaseosas, tés y jugos', '13': 'Refrescos, batidos, aguas y calientes', '17': 'Pulpería' };
// [codigo, nombre, precio, peso de popularidad, abierto]
const CAT = [
  ['010101', 'Hamburguesa, Sencilla', 1475, 9], ['010102', 'Hamburguesa, Quesoburguesa', 1775, 8], ['010103', 'Hamburguesa, Clásica', 2775, 6], ['010105', 'Hamburguesa, Bacon', 3475, 4],
  ['010201', 'Adicional de hamburguesa, Queso amarillo', 500, 5], ['010301', 'Pollo frito, Pechuga y ala', 2300, 10], ['010302', 'Pollo frito, Cadera y muslo', 1800, 9], ['010503', 'Pizza, Pepperoni', 9000, 1.5],
  ['010600', 'Con papas, hamburguesas y pollo', 1200, 9], ['020101', 'Tacos, Sencillo', 2000, 3], ['020201', 'Burrito, Pollo o res', 2000, 3], ['021000', 'Con papas, Tex-Mex', 1200, 2],
  ['050101', 'Casado, Pollo', 4000, 7], ['050104', 'Casado, Carne', 4000, 5], ['050105', 'Casado, Bistec', 4650, 4], ['080101', 'Papas fritas, Pequeñas', 1200, 6], ['080102', 'Papas fritas, Grandes', 2500, 4],
  ['110101', 'Coca-Cola Original 355 mL', 800, 8], ['110102', 'Coca-Cola Zero 355 mL', 800, 3], ['110103', 'Fanta sabores 355 mL', 800, 2.5], ['110106', 'Pepsi 355 mL', 600, 2],
  ['110201', 'Coca-Cola Original 600 mL', 1200, 7], ['110202', 'Coca-Cola Zero 600 mL', 1200, 2.5], ['110203', 'Fanta sabores 600 mL', 1200, 2], ['110305', 'Coca-Cola Original 3 L', 3000, 1.5],
  ['130100', 'Refresco natural', 1000, 6], ['130405', 'Bebida caliente, Café con leche', 1200, 3],
  ['110207', 'Pepsi 600 mL', 0, 1.5, true, 'Sp'], ['170100', 'Galletas', 0, 1.2, true, 'Unid'], ['030300', 'Tamal de cerdo', 0, 1, true, 'Sp'],
];
const HORAS = { 7: 3, 8: 4, 9: 4, 10: 6, 11: 12, 12: 16, 13: 14, 14: 8, 15: 5, 16: 5, 17: 7, 18: 9, 19: 7, 20: 3 };

function semilla(n) { let t = n >>> 0; return () => { t += 0x6D2B79F5; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; }; }
const elegir = (rnd, pares) => { const tot = pares.reduce((a, p) => a + p[1], 0); let x = rnd() * tot; for (const p of pares) { x -= p[1]; if (x <= 0) return p[0]; } return pares[pares.length - 1][0]; };
const r2 = (n) => Math.round(n * 100) / 100;

export function datosDemo(desde, hasta) {
  // Para no generar de más, se muestran como máximo los últimos 120 días del rango
  let d0 = desde; const dias = []; for (let d = desde; d <= hasta && dias.length < 800; d = sumaDias(d, 1)) dias.push(d);
  const usar = dias.slice(-120); d0 = usar[0];
  const rnd = semilla(20261028 + usar.length);
  const porDia = [], porHora = new Map(), porMedio = new Map(), porServ = new Map(), porCaj = new Map(), prods = new Map(), turnos = [], tarifa = { total: 0, iva: 0 };
  const R = { docs_emitidos: 0, ventas_brutas: 0, iva_brutas: 0, notas_credito_n: 0, notas_credito: 0, iva_notas_credito: 0, vigentes_n: 0, vigentes_total: 0, sin_aceptar_n: 0 };
  const cajeros = [['Marisol Vargas', 5], ['Kevin Rojas', 3], ['Dixia Martínez', 2]];
  usar.forEach((dia, idx) => {
    const dow = new Date(dia + 'T12:00:00Z').getUTCDay();
    const base = [70, 78, 82, 85, 92, 118, 104][dow] || 80;
    const n = Math.round(base * (0.85 + rnd() * 0.3));
    const dd = { dia, docs: 0, ventas: 0, notas_credito: 0, netas: 0, iva: 0 };
    let tv = 0;
    for (let k = 0; k < n; k++) {
      const lineas = []; const nl = 1 + Math.floor(rnd() * 3.2);
      for (let j = 0; j < nl; j++) {
        const it = elegir(rnd, CAT.map((c) => [c, c[3]]));
        const ab = !!it[4]; const precio = ab ? (Math.round((800 + rnd() * 3200) / 50) * 50) : it[2]; const cant = ab ? 1 : (rnd() < 0.2 ? 2 : 1);
        lineas.push({ it, cant, precio, total: r2(precio * cant) });
      }
      const total = r2(lineas.reduce((a, l) => a + l.total, 0)), iva = r2(lineas.reduce((a, l) => a + r2(l.total * 13 / 113), 0));
      const hora = +elegir(rnd, Object.entries(HORAS).map(([h, w]) => [h, w]));
      dd.docs++; dd.ventas += total; R.docs_emitidos++; R.ventas_brutas += total; R.iva_brutas += iva;
      if (rnd() < 0.02) { dd.notas_credito += total; R.notas_credito_n++; R.notas_credito += total; R.iva_notas_credito += iva; dd.iva -= iva; continue; }
      dd.iva += iva; R.vigentes_n++; R.vigentes_total += total; tv += total;
      const hh = porHora.get(hora) || { hora, docs: 0, total: 0 }; hh.docs++; hh.total += total; porHora.set(hora, hh);
      const u = rnd(); const pagos = u < 0.5 ? [['efectivo', total]] : u < 0.75 ? [['tarjeta', total]] : u < 0.95 ? [['sinpe', total]] : [['efectivo', r2(total / 2)], ['tarjeta', r2(total - r2(total / 2))]];
      pagos.forEach(([m, mt]) => { const x = porMedio.get(m) || { medio: m, docs: 0, total: 0 }; x.docs++; x.total += mt; porMedio.set(m, x); });
      const sv = elegir(rnd, [['buffet', 5], ['llevar', 3], ['express', 3], ['espera', 1]]); const xs = porServ.get(sv) || { tipo_servicio: sv, ventas: 0, total: 0 }; xs.ventas++; xs.total += total; porServ.set(sv, xs);
      const cj = elegir(rnd, cajeros); const xc = porCaj.get(cj) || { cajero: cj, ventas: 0, total: 0 }; xc.ventas++; xc.total += total; porCaj.set(cj, xc);
      lineas.forEach((l) => { const key = l.it[0]; const x = prods.get(key) || { codigo: l.it[0], nombre: l.it[1], cajon_nombre: CAJONES[l.it[0].slice(0, 2)] || null, abierto: !!l.it[4], unidad: l.it[5] || 'Sp', cantidad: 0, total: 0 }; x.cantidad += l.cant; x.total += l.total; prods.set(key, x); });
      tarifa.total += total; tarifa.iva += iva;
    }
    dd.netas = r2(dd.ventas - dd.notas_credito); dd.ventas = r2(dd.ventas); dd.notas_credito = r2(dd.notas_credito); dd.iva = r2(dd.iva);
    porDia.push(dd);
    turnos.push({ id: 'demo-' + dia, abierto_en: `${dia}T07:00:00-06:00`, cerrado_en: `${dia}T21:00:00-06:00`, abierto_por: 'Marisol', ventas: dd.docs, total: r2(tv) });
  });
  R.ventas_netas = r2(R.ventas_brutas - R.notas_credito); R.iva_neto = r2(R.iva_brutas - R.iva_notas_credito);
  ['ventas_brutas', 'iva_brutas', 'notas_credito', 'iva_notas_credito', 'vigentes_total'].forEach((k) => { R[k] = r2(R[k]); });
  const ord = (m) => [...m.values()].map((x) => ({ ...x, total: r2(x.total) })).sort((a, b) => b.total - a.total);
  return {
    resumen: R, por_dia: porDia, por_hora: [...porHora.values()].sort((a, b) => a.hora - b.hora).map((x) => ({ ...x, total: r2(x.total) })),
    por_medio: ord(porMedio), por_servicio: ord(porServ), por_cajero: ord(porCaj), por_turno: turnos.slice(-8), productos: ord(prods),
    por_tarifa: [{ tarifa: 13, total_con_iva: r2(tarifa.total), iva: r2(tarifa.iva) }],
  };
}
