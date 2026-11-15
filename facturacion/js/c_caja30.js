// Contabilidad, pestaña «Flujo de caja»: posición proyectada a 30 días. Entradas = depósitos de tarjeta (neto del BCR) y otros cobros; salidas = proveedores a su vencimiento, IVA y planilla.
import { h, money, hoyCR, esqueleto, bloqueError, textoDeError, leerNumero, toast, conBoton } from './util.js';
import { fechaDMA } from './periodo.js';
import { cargarHoja } from './ui_hojas.js';
import { autoAjustar } from './graficos.js';
import { graficoLineas } from './grafico_lineas.js';
import { llenar } from './c_comun.js';
import { caja30, caja30Guardar } from './api_contable.js';

const ddmm = (ymd) => ymd.slice(8, 10) + '/' + ymd.slice(5, 7);
const DS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

export default {
  id: 'caja30', texto: 'Flujo de caja',
  async montar(cont, ctx) {
    const { soc } = ctx;
    await cargarHoja('listados.css'); await cargarHoja('banco_caja.css');
    const cuerpo = h('div.con-raiz'); cont.append(cuerpo);
    let ficha = 0; const limpiezas = [];
    async function cargar() {
      const mi = ++ficha; limpiezas.splice(0).forEach((f) => f());
      llenar(cuerpo, esqueleto(3, 'Proyectando la caja…'));
      let r; try { r = await caja30(soc.id); } catch (er) { if (mi === ficha) llenar(cuerpo, bloqueError({ titulo: 'No se pudo proyectar la caja', mensaje: textoDeError(er), alReintentar: cargar })); return; }
      if (mi !== ficha) return;
      const s = r.resumen, p = r.parametros, dias = r.dias || [];
      const lect = h('p.lectura', { 'aria-live': 'polite' }, 'Toque o pase el cursor sobre el gráfico para ver el día.');
      const gr = h('div.gr-caja');
      limpiezas.push(autoAjustar(gr, (w) => llenar(gr, graficoLineas([{ nombre: 'Saldo proyectado', clase: s.saldo_final < 0 ? 'rojo' : 'verde', valores: dias.map((d) => d.saldo) }], dias.map((d) => ddmm(d.fecha)),
        { ancho: w, alto: 280, tituloX: 'Día (de hoy hacia adelante, 30 días)', tituloY: 'Saldo de caja proyectado (₡)', descripcion: 'Saldo de caja proyectado a 30 días',
          alSeleccionar: (i) => { const d = dias[i]; lect.textContent = DS[d.dow % 7] + ' ' + fechaDMA(d.fecha) + ': saldo ' + money(d.saldo) + ' (entradas ' + money(d.entradas_tarjeta + d.entradas_otros) + ', salidas ' + money(d.salidas_proveedores + d.salidas_iva + d.salidas_planilla) + ').'; } }))));
      const f = { saldo: h('input', { type: 'text', inputmode: 'decimal', value: String(p.saldo_inicial) }), plazo: h('input', { type: 'text', inputmode: 'numeric', value: String(p.plazo_credito_dias) }), iva: h('input', { type: 'text', inputmode: 'numeric', value: String(p.dia_iva) }), plan: h('input', { type: 'text', inputmode: 'numeric', value: String(p.dia_planilla) }) };
      const btn = h('button.btn.primario', { type: 'button' }, 'Guardar y recalcular');
      btn.addEventListener('click', () => conBoton(btn, async () => {
        const datos = { saldo_inicial: leerNumero(f.saldo.value), plazo_credito_dias: parseInt(f.plazo.value, 10), dia_iva: parseInt(f.iva.value, 10), dia_planilla: parseInt(f.plan.value, 10) };
        try { await caja30Guardar(soc.id, datos); toast('Parámetros guardados'); await cargar(); } catch (er) { toast(textoDeError(er), 'mal'); }
      }));
      const filas = dias.map((d) => h('tr', h('td', DS[d.dow % 7] + ' ' + ddmm(d.fecha)), h('td.der', money(d.entradas_tarjeta)), h('td.der', money(d.entradas_otros)), h('td.der', money(d.salidas_proveedores)), h('td.der', money(d.salidas_iva)), h('td.der', money(d.salidas_planilla)), h('td.der', money(d.neto_dia)), h('td.der' + (d.saldo < 0 ? '.bc-neg' : ''), money(d.saldo))));
      llenar(cuerpo,
        r.ventas_de_prueba ? h('div.bc-aviso', h('strong', 'Ventas de prueba. '), 'Las ventas del facturador en ambiente ' + r.ambiente + ' no cuentan como entradas. Hoy las entradas salen solo de los depósitos de tarjeta del BCR.') : null,
        h('div.con-bloque', h('h2', 'Próximos 30 días, desde ' + fechaDMA(r.hoy)),
          h('div.con-cifras',
            h('div.con-cifra', h('div.t', 'Saldo inicial'), h('div.v', money(s.saldo_inicial)), h('div.n', 'dato digitado, abajo se puede cambiar')),
            h('div.con-cifra', h('div.t', 'Entradas (neto)'), h('div.v', money(s.entradas)), h('div.n', 'tarjeta ' + money(s.entradas_tarjeta) + ' · otros ' + money(s.entradas_otros))),
            h('div.con-cifra', h('div.t', 'Salidas'), h('div.v', money(s.salidas_proveedores + s.salidas_iva + s.salidas_planilla)), h('div.n', 'proveedores ' + money(s.salidas_proveedores) + ' · IVA ' + money(s.salidas_iva) + ' · planilla ' + money(s.salidas_planilla))),
            h('div.con-cifra', h('div.t', 'Saldo a 30 días'), h('div.v' + (s.saldo_final < 0 ? '.bc-neg' : ''), money(s.saldo_final)), h('div.n', 'mínimo ' + money(s.saldo_minimo) + ' el ' + fechaDMA(s.dia_minimo)))),
          h('div', { style: 'margin-top:.8rem' }, gr, h('div.bc-leyenda', h('span', h('i' + (s.saldo_final < 0 ? '' : '.verde')), 'Saldo proyectado de caja (neto de comisión y retenciones)')), lect),
          h('ul.bc-sup',
            r.proveedores_vencidos && r.proveedores_vencidos.n ? h('li', r.proveedores_vencidos.n + ' facturas recibidas (' + money(r.proveedores_vencidos.monto) + ') ya vencieron; no se sabe si fueron pagadas, por eso no se descuentan.') : null,
            h('li', 'Todos los montos son netos de comisión del datáfono y retenciones; el IVA y la planilla salen en las fechas de la configuración.'))),
        h('div.con-bloque', h('h2', 'Supuestos'), h('p.con-ayuda', 'El saldo inicial real no se conoce: se digita a mano hasta que se cargue el estado de cuenta.'),
          h('div.bc-form', h('label', 'Saldo inicial (₡)', f.saldo), h('label', 'Plazo de crédito de proveedores (días)', f.plazo), h('label', 'Día de pago del IVA', f.iva), h('label', 'Día de pago de planilla', f.plan), btn)),
        h('div.con-bloque', h('h2', 'Día por día'), h('div.tabla-caja', h('table.con-tabla', h('thead', h('tr', h('th', 'Día'), h('th.der', 'Entra tarjeta'), h('th.der', 'Entra otros'), h('th.der', 'Sale proveedores'), h('th.der', 'Sale IVA'), h('th.der', 'Sale planilla'), h('th.der', 'Neto del día'), h('th.der', 'Saldo'))), h('tbody', filas)))));
    }
    await cargar();
    return () => limpiezas.splice(0).forEach((f) => f());
  },
};
