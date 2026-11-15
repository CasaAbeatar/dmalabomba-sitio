// Contabilidad, tarjeta «IVA del período» (en vivo): IVA cobrado en ventas, IVA acreditable de compras y lo que saldría a pagar o a favor.
// Usa fx_contable_iva_periodo, que llama al mismo cálculo de fx_iva_mes (la fuente única del D-150): aquí no se calcula nada aparte.
// Se refresca sola cada minuto mientras la pantalla esté abierta y devuelve la función que apaga el temporizador.
import { h, money, hoyCR, esqueleto, bloqueError, textoDeError } from './util.js';
import { fechaDMA } from './periodo.js';
import { llenar } from './c_comun.js';
import { ivaPeriodo } from './api_contable.js';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const nombreMes = (per) => { const [a, m] = per.split('-').map(Number); return MESES[m - 1] + ' de ' + a; };
const sumaMes = (per, n) => { const [a, m] = per.split('-').map(Number); const t = a * 12 + (m - 1) + n; return Math.floor(t / 12) + '-' + String((t % 12) + 1).padStart(2, '0'); };
const hora = (iso) => new Intl.DateTimeFormat('es-CR', { timeZone: 'America/Costa_Rica', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

export async function montarIva(bloque, ctx, { alIrAFormularios } = {}) {
  const { soc, memoria } = ctx;
  const hoyMes = hoyCR().slice(0, 7);
  let per = memoria.ivaMes || hoyMes, ficha = 0, vivo = true, cargando = false;

  async function cargar(silencioso = false) {
    if (cargando) return;
    cargando = true; const mi = ++ficha;
    if (!silencioso) llenar(bloque, h('h2', 'IVA del período'), esqueleto(2, 'Calculando el IVA de ' + nombreMes(per) + '…'));
    let d;
    try { d = await ivaPeriodo(soc.id, per + '-01'); }
    catch (e) { cargando = false; if (vivo && mi === ficha && !silencioso) llenar(bloque, h('h2', 'IVA del período'), bloqueError({ titulo: 'No se pudo calcular el IVA', mensaje: textoDeError(e), alReintentar: () => cargar() })); return; }
    cargando = false;
    if (vivo && mi === ficha) pintar(d);
  }

  const variacion = (actual, previo) => {
    if (previo == null || Math.abs(previo) < 0.01) return null;
    const p = ((actual - previo) / Math.abs(previo)) * 100;
    return (p >= 0 ? '+' : '') + p.toFixed(1).replace('.', ',') + ' % frente al mes anterior';
  };

  function pintar(d) {
    const aPagar = d.a_pagar_estimado > 0.004;
    const dec = d.declaracion, presentada = dec?.estado === 'presentada';
    const anterior = d.anterior || {};
    const cifra = (t, v, nota, clase) => h('div.con-cifra' + (clase ? '.' + clase : ''), h('div.t', t), h('div.v', money(v)), nota ? h('div.n', nota) : null);
    llenar(bloque,
      h('div.con-fila', h('h2', { style: 'flex:1' }, 'IVA del período'),
        presentada ? h('span.chip.ok', 'D-150 presentada') : dec ? h('span.chip', 'Borrador del D-150') : h('span.chip', d.es_mes_actual ? 'En curso' : 'Sin presentar')),
      h('div.con-fila', h('button.btn.chico', { type: 'button', 'aria-label': 'Mes anterior', onclick: () => { per = sumaMes(per, -1); memoria.ivaMes = per; cargar(); } }, '‹ Mes anterior'),
        h('strong', { style: 'min-width:11rem;text-align:center' }, nombreMes(per)),
        h('button.btn.chico', { type: 'button', disabled: per >= hoyMes, 'aria-label': 'Mes siguiente', onclick: () => { per = sumaMes(per, 1); memoria.ivaMes = per; cargar(); } }, 'Mes siguiente ›'),
        d.es_mes_actual ? null : h('button.btn.chico', { type: 'button', onclick: () => { per = hoyMes; memoria.ivaMes = per; cargar(); } }, 'Ir al mes en curso')),
      d.ventas_de_prueba ? h('p.con-nota.con-mas', 'Cifras de PRUEBAS (' + d.ambiente + '): el débito real del mes todavía sale del sistema anterior (Prisma).') : null,
      h('div.con-cifras.iva-cifras', { style: 'margin:.8rem 0' },
        cifra('IVA cobrado en ventas', d.debito, d.docs_debito + ' comprobante(s)' + (variacion(d.debito, anterior.debito) ? ' · ' + variacion(d.debito, anterior.debito) : '')),
        cifra('IVA pagado en compras (acreditable)', d.credito, d.docs_credito + ' comprobante(s)' + (variacion(d.credito, anterior.credito) ? ' · ' + variacion(d.credito, anterior.credito) : '')),
        cifra(aPagar ? 'IVA por pagar (estimado)' : 'Saldo a favor (estimado)', aPagar ? d.a_pagar_estimado : d.a_favor_estimado,
          d.saldo_favor_anterior > 0 ? 'Ya descuenta ' + money(d.saldo_favor_anterior) + ' de saldo a favor del mes anterior' : 'Débito menos crédito del mes', aPagar ? 'iva-pagar' : 'iva-favor')),
      h('p.con-nota', 'Se presenta a más tardar el ' + fechaDMA(d.vence) + (d.dias_habiles >= 0 ? ' (faltan ' + d.dias_habiles + ' día(s) hábil(es))' : ' (venció hace ' + Math.abs(d.dias_habiles) + ' día(s) hábil(es))') + '. Las retenciones de tarjeta y otros créditos los completa la contadora en «Formularios».'),
      d.sin_confirmar && d.sin_confirmar.n_docs > 0 ? h('p.con-nota', d.sin_confirmar.n_docs + ' factura(s) de compra no tienen la aceptación de la empresa confirmada (IVA ' + money(d.sin_confirmar.iva_acreditable) + '): mientras no se confirmen, ese crédito está en duda.') : null,
      h('div.iva-pie', h('span.con-nota', 'En vivo · actualizado a las ' + hora(d.actualizado)),
        alIrAFormularios ? h('button.btn.chico', { type: 'button', onclick: () => alIrAFormularios(per) }, 'Abrir el D-150 de ' + nombreMes(per)) : null));
  }

  await cargar();
  const reloj = setInterval(() => { if (vivo && !document.hidden) cargar(true); }, 60000);
  return () => { vivo = false; clearInterval(reloj); };
}
