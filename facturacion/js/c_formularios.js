// Contabilidad, pestaña «Formularios» (fases 4 y 5): D-150 de IVA y D-270. Abre con lo que vence primero.
// Este módulo prepara las cifras y guarda lo que se presentó; la presentación se hace en TRIBU-CR. Las cifras de IVA vienen de fx_iva_mes (el mismo cálculo del módulo Contable).
import { h, money, hoyCR, esqueleto, bloqueError, textoDeError, toast, conBoton } from './util.js';
import { fechaDMA } from './periodo.js';
import { llenar } from './c_comun.js';
import { d150, declaracionGuardar, d150Presentar, parametroGuardar, declaraciones } from './api_contable.js';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const nombreMes = (per) => { const [a, m] = per.split('-').map(Number); return MESES[m - 1] + ' de ' + a; };
export const sumaMes = (per, n) => { const [a, m] = per.split('-').map(Number); const t = a * 12 + (m - 1) + n; return Math.floor(t / 12) + '-' + String((t % 12) + 1).padStart(2, '0'); };
const num = (t) => { const s = String(t ?? '').replace(/\s/g, '').replace(',', '.'); if (s === '') return ''; return /^-?\d+(\.\d+)?$/.test(s) ? s : null; };
const dm = (n) => money(n);

export default {
  id: 'formularios', texto: 'Formularios',
  async montar(cont, ctx) {
    const { soc, memoria } = ctx;
    const bCal = h('div.con-bloque'), bD150 = h('div.con-bloque'), bD270 = h('div.con-bloque');
    cont.append(h('div.con-raiz', bCal, bD150, bD270));
    const hoy = hoyCR();
    // El D-150 que toca ahora: el del mes anterior (vence el 15 del mes en curso)
    let per = memoria.d150Mes || sumaMes(hoy.slice(0, 7), -1);
    let ficha = 0;

    async function cargarD150() {
      const mi = ++ficha;
      llenar(bD150, h('h2', 'D-150, declaración del IVA'), esqueleto(2, 'Calculando el IVA de ' + nombreMes(per) + '…'));
      let d; try { d = await d150(soc.id, per + '-01'); } catch (e) { if (mi === ficha) llenar(bD150, h('h2', 'D-150, declaración del IVA'), bloqueError({ titulo: 'No se pudo calcular el IVA', mensaje: textoDeError(e), alReintentar: cargarD150 })); return; }
      if (mi !== ficha) return;
      pintarD150(d);
    }

    function pintarD150(d) {
      const c = d.casillas, ent = d.entradas || {}, dec = d.declaracion, presentada = dec?.estado === 'presentada';
      const campos = {};
      const campo = (clave, etiqueta, ayuda) => {
        const i = h('input.campo', { type: 'text', inputmode: 'decimal', value: ent[clave] ?? (clave === 'saldo_favor_anterior' && c.saldo_favor_anterior ? String(c.saldo_favor_anterior) : ''), placeholder: '0', disabled: presentada, 'aria-label': etiqueta });
        campos[clave] = i;
        return h('label.etq', etiqueta, i, ayuda ? h('span.con-nota', ayuda) : null);
      };
      const tarifas = (lista, esCredito) => (lista || []).map((t) => h('tr', h('td', t.descripcion || t.codigo_tarifa), h('td.der', dm(t.base)), h('td.der', dm(esCredito ? t.iva_comprobantes ?? t.iva : t.iva)), esCredito ? h('td.der', dm(t.iva_acreditable)) : null));
      const dif = (x) => Math.abs(x) < 0.01 ? h('span.chip.ok', 'Cuadra') : h('span.chip.mal', 'Diferencia ' + dm(x));
      const num2 = h('input.campo', { type: 'text', placeholder: 'Número de comprobante de TRIBU-CR', 'aria-label': 'Número de comprobante de TRIBU-CR' });
      const nomP = h('input.campo', { type: 'text', value: d.profesional?.nombre || '', placeholder: 'Nombre', 'aria-label': 'Nombre del profesional' });
      const cedP = h('input.campo', { type: 'text', value: d.profesional?.cedula || '', placeholder: 'Cédula', inputmode: 'numeric', 'aria-label': 'Cédula del profesional' });
      const sinC = d.advertencias?.sin_confirmar, tarde = d.advertencias?.llegaron_tarde;
      llenar(bD150,
        h('div.con-fila', h('h2', { style: 'flex:1' }, 'D-150, declaración del IVA'), presentada ? h('span.chip.ok', 'Presentada' + (dec.version > 1 ? ' (versión ' + dec.version + ')' : '')) : dec ? h('span.chip', 'Borrador') : h('span.chip', 'Sin guardar')),
        h('div.con-fila', h('button.btn.chico', { type: 'button', onclick: () => { per = sumaMes(per, -1); memoria.d150Mes = per; cargarD150(); } }, '‹ Mes anterior'), h('strong', { style: 'min-width:11rem;text-align:center' }, nombreMes(per)),
          h('button.btn.chico', { type: 'button', disabled: per >= hoy.slice(0, 7), onclick: () => { per = sumaMes(per, 1); memoria.d150Mes = per; cargarD150(); } }, 'Mes siguiente ›'),
          h('span.con-nota', 'Se presenta a más tardar el ' + fechaDMA(d.vence) + ' (o el siguiente día hábil)')),
        d.ventas_de_prueba ? h('p.con-nota.con-mas', 'Cifras de PRUEBAS (' + d.ambiente + '): no sirven para declarar.') : null,
        h('h3', { style: 'margin-top:1rem' }, 'Ventas (IVA cobrado)'),
        h('div.tabla-caja', h('table.con-tabla', h('thead', h('tr', h('th', 'Tarifa'), h('th.der', 'Base'), h('th.der', 'IVA'))), h('tbody', tarifas(d.ventas_por_tarifa, false)),
          h('tfoot', h('tr.con-grupo', h('td', 'IVA de las ventas'), h('td'), h('td.der', dm(c.debito_ventas)))))),
        h('h3', { style: 'margin-top:1rem' }, 'Compras (IVA pagado)'),
        h('div.tabla-caja', h('table.con-tabla', h('thead', h('tr', h('th', 'Tarifa'), h('th.der', 'Base'), h('th.der', 'IVA del comprobante'), h('th.der', 'IVA acreditable'))), h('tbody', tarifas(d.compras_por_tarifa, true)),
          h('tfoot', h('tr.con-grupo', h('td', 'IVA acreditable'), h('td'), h('td'), h('td.der', dm(c.credito_acreditable)))))),
        c.proporcionalidad < 100 ? h('p.con-nota', 'Proporcionalidad aplicada: ' + c.proporcionalidad + ' % → crédito proporcional ' + dm(c.credito_proporcional) + '. La contadora define este porcentaje.') : null,
        h('h3', { style: 'margin-top:1rem' }, 'Lo que usted completa'),
        h('div.con-form', campo('saldo_favor_anterior', 'Saldo a favor del mes anterior', 'Si el mes anterior se presentó aquí, se trae solo.'), campo('retenciones_tarjeta', 'Retenciones de tarjeta', 'Vienen en el reporte de los bancos.'),
          campo('pagos_a_cuenta', 'Otros pagos o créditos aplicados'), campo('servicios_exterior_debito', 'IVA por servicios del exterior (débito)', 'Con factura de compra electrónica.'), campo('servicios_exterior_credito', 'IVA por servicios del exterior (crédito)')),
        h('div.con-cifras', { style: 'margin:1rem 0' }, h('div.con-cifra', h('div.t', 'IVA a pagar'), h('div.v', dm(c.a_pagar))), h('div.con-cifra', h('div.t', 'Saldo a favor para el mes siguiente'), h('div.v', dm(c.saldo_favor)))),
        h('h3', 'Cuadre con el libro contable'),
        h('div.tabla-caja', h('table.con-tabla', h('tbody',
          h('tr', h('td', 'IVA de ventas: declaración ' + dm(d.cuadre_libro.debito_declaracion) + ' · libro ' + dm(d.cuadre_libro.debito_libro)), h('td.der', dif(d.cuadre_libro.debito_diferencia))),
          h('tr', h('td', 'IVA de compras: declaración ' + dm(d.cuadre_libro.credito_declaracion) + ' · libro ' + dm(d.cuadre_libro.credito_libro)), h('td.der', dif(d.cuadre_libro.credito_diferencia)))))),
        h('p.con-nota', d.cuadre_libro.texto),
        sinC && sinC.n_docs > 0 ? h('p.con-nota', sinC.n_docs + ' factura(s) de compra no tienen la aceptación de la empresa confirmada en este sistema (IVA ' + dm(sinC.iva_acreditable) + '). ' + sinC.texto) : null,
        tarde && tarde.n_docs > 0 ? h('p.con-nota', tarde.n_docs + ' factura(s) llegaron tarde (IVA ' + dm(tarde.iva_acreditable) + '). ' + tarde.texto) : null,
        h('details', { style: 'margin-top:.6rem' }, h('summary', 'Sección de profesional'),
          h('p.con-ayuda', 'Los formularios de IVA llevan los datos del profesional que los prepara o firma. Se guardan una vez para todos los meses.'),
          h('div.con-form', h('label.etq', 'Nombre', nomP), h('label.etq', 'Cédula', cedP)),
          h('div.con-acciones', h('button.btn', { type: 'button', onclick: (e) => conBoton(e.currentTarget, async () => { try { await parametroGuardar(soc.id, 'profesional_nombre', nomP.value.trim() || null, !!nomP.value.trim()); await parametroGuardar(soc.id, 'profesional_cedula', cedP.value.trim() || null, !!cedP.value.trim()); toast('Datos del profesional guardados'); } catch (er) { toast(textoDeError(er), 'error'); } }) }, 'Guardar profesional'))),
        presentada ? h('p.con-ayuda', 'Presentada el ' + fechaDMA(String(dec.presentado_en).slice(0, 10)) + ' por ' + dec.presentado_por + ' con el comprobante ' + dec.numero_presentacion + '. Si hay que corregir algo, al guardar nuevas cifras se abre una versión rectificativa.') : null,
        h('div.con-acciones',
          h('button.btn.primario', { type: 'button', onclick: (e) => conBoton(e.currentTarget, async () => {
            const ent2 = {}; for (const [k, i] of Object.entries(campos)) { const v = num(i.value); if (v === null) { toast('Revise el monto de «' + i.getAttribute('aria-label') + '»', 'error'); i.focus(); return; } if (v !== '') ent2[k] = v; }
            try { await declaracionGuardar(soc.id, 'D150', per, ent2); toast(presentada ? 'Se abrió una versión rectificativa' : 'Cifras guardadas'); await cargarD150(); } catch (er) { toast(textoDeError(er), 'error'); }
          }) }, presentada ? 'Guardar como versión rectificativa' : 'Guardar las cifras'),
          h('button.btn', { type: 'button', onclick: async () => { const t = 'D-150 ' + nombreMes(per) + '. IVA ventas ' + dm(c.debito_ventas) + '; IVA acreditable ' + dm(c.credito_proporcional) + '; a pagar ' + dm(c.a_pagar) + '; saldo a favor ' + dm(c.saldo_favor); try { await navigator.clipboard.writeText(t); toast('Resumen copiado'); } catch { toast(t, 'ok', 8000); } } }, 'Copiar el resumen')),
        !presentada && dec ? h('div.con-fila', { style: 'margin-top:.8rem' }, num2, h('button.btn', { type: 'button', onclick: (e) => conBoton(e.currentTarget, async () => {
          try { await d150Presentar(soc.id, per + '-01', num2.value.trim()); toast('Marcada como presentada'); await cargarD150(); await cargarCalendario(); } catch (er) { toast(textoDeError(er), 'error'); }
        }) }, 'Ya la presenté en TRIBU-CR')) : null,
        !presentada && !dec ? h('p.con-nota', 'Guarde las cifras primero; después podrá marcar la declaración como presentada.') : null);
    }

    /* ---------- Calendario: lo que vence primero ---------- */
    async function cargarCalendario() {
      let lista = []; try { lista = await declaraciones(soc.id, 'D150'); } catch { lista = []; }
      const hecho = (p) => lista.some((x) => x.periodo === p && x.estado === 'presentada');
      const filas = [];
      for (let n = -1; n >= -3; n--) { const p = sumaMes(hoy.slice(0, 7), n); filas.push({ p, vence: sumaMes(p, 1) + '-15', hecho: hecho(p) }); }
      filas.sort((a, b) => a.vence.localeCompare(b.vence));
      llenar(bCal, h('h2', 'Lo que vence'), h('p.con-ayuda', 'Hoy es ' + fechaDMA(hoy) + '. Del más antiguo al más reciente.'),
        h('div.tabla-caja', h('table.con-tabla', h('thead', h('tr', h('th', 'Formulario'), h('th', 'Período'), h('th', 'Vence'), h('th', 'Estado'), h('th', ''))),
          h('tbody', filas.map((f) => h('tr', h('td', 'D-150 IVA'), h('td', nombreMes(f.p)), h('td', fechaDMA(f.vence)), h('td', f.hecho ? h('span.chip.ok', 'Presentado') : f.vence < hoy ? h('span.chip.mal', 'Vencido') : h('span.chip', 'Pendiente')),
            h('td', h('button.btn.chico', { type: 'button', onclick: () => { per = f.p; memoria.d150Mes = per; cargarD150(); bD150.scrollIntoView?.({ behavior: 'smooth' }); } }, 'Abrir'))))))));
    }

    await Promise.all([cargarCalendario(), cargarD150()]);
    if (ctx.fase5) await ctx.fase5(bD270);
  },
};
