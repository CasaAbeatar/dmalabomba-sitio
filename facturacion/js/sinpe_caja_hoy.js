// «Caja para mí» · pestaña HOY: el teléfono (latido, batería, red, versión), las órdenes que se le pueden pedir y los SINPE de hoy con su cuadre de dos puntos
// (aviso del banco ↔ venta). El tercer punto, el archivo de movimientos del BCR, todavía no entra. Nada de esto frena el cobro ni el cierre.
import { h, money, toast, confirmar, conBoton } from './util.js';
import { sinpeAdmin } from './api_sinpe_admin.js';
import { zonaCarga, chip, kpi } from './sinpe_caja_ui.js';
import { diaLargo, horaCR, fechaHoraCR, haceTexto, estadoLatido, atencionTelefonos, riesgosOrdenados, textoRed, textoBateria, numTxt,
  NOMBRE_ORDEN, AYUDA_ORDEN, NOMBRE_ESTADO_ORDEN, CLASE_ESTADO_ORDEN } from './sinpe_admin_calc.js';

const CLASE_NIVEL = { ok: 'ok', tarda: 'tarda', sin: 'sin', nunca: 'sin' };
const dmaHora = (d) => fechaHoraCR(d);
const ABIERTAS = new Set(['pendiente', 'entregado']);

export function seccionHoy(ctx) {
  const { soc, nombreEmpresa } = ctx;
  let ultimaCarga = null;
  const act = h('span.sc-act', { 'aria-live': 'polite' });

  async function pedir(cmd, tel, btn, d) {
    if (cmd === 'reenviar_historial') {
      const si = await confirmar(`Se le pedirá al teléfono «${tel}» que vuelva a mandar los SMS del banco que tiene guardados. Solo pide al teléfono: no cambia ventas ni cobros. ¿Pedirlo?`, { si: 'Sí, pedir el reenvío', no: 'No, volver' });
      if (!si) return;
    }
    await conBoton(btn, async () => {
      const r = await sinpeAdmin.orden(soc, cmd, tel, 'Desde «Caja para mí»');
      if (!r || r.ok === false) { toast(r?.error || 'No se pudo pedir. Intente de nuevo.', 'error', 6000); return; }
      toast(r.duplicado ? 'Ya había una orden igual esperando; no se repitió.' : NOMBRE_ORDEN[cmd] + ': pedido. El teléfono lo recibe cuando llame.', 'ok', 6000);
      zona.recargar(true);
    });
  }

  function tarjetaTelefono(t, d) {
    const e = estadoLatido(t.minutos);
    const abiertas = (d.comandos || []).filter((c) => ABIERTAS.has(c.estado) && (c.telefono == null || c.telefono === t.telefono));
    const accion = (cmd) => {
      const previa = abiertas.find((c) => c.cmd === cmd);
      const btn = h('button.btn' + (cmd === 'latido_ya' ? '.primario' : ''), { type: 'button', disabled: !!previa, onclick: () => pedir(cmd, t.telefono, btn, d) }, previa ? 'Ya pedido' : NOMBRE_ORDEN[cmd]);
      return h('div.sc-accion', btn, h('small', previa ? `Ya hay una orden de este tipo (n.º ${previa.id}) desde el ${dmaHora(previa.creado_en)}; vence el ${dmaHora(previa.vence_en)}. ${NOMBRE_ESTADO_ORDEN[previa.estado]}.` : AYUDA_ORDEN[cmd]));
    };
    const riesgos = riesgosOrdenados(t.riesgos);
    return h('section.sc-tarjeta', { 'data-telefono': t.telefono },
      h('div.sc-cab-tarjeta', h('div', h('h2', 'Mi teléfono'), h('p.sc-ayuda', t.telefono)), chip(e.texto + (e.nivel === 'sin' || e.nivel === 'tarda' ? ' · ' + haceTexto(t.minutos) : ''), CLASE_NIVEL[e.nivel])),
      h('dl.sc-datos',
        h('dt', 'Último latido'), h('dd', t.ultimo_latido ? `${dmaHora(t.ultimo_latido)} (${haceTexto(t.minutos)})` : 'Nunca'),
        h('dt', 'Batería'), h('dd', textoBateria(t)),
        h('dt', 'Red'), h('dd', textoRed(t)),
        h('dt', 'Versión de la app'), h('dd', t.app || 'No informa su versión'),
        h('dt', 'Latidos recibidos'), h('dd', numTxt(t.conteo))),
      !t.detalle_disponible ? h('p.sc-nota', 'Este teléfono no manda el detalle de su estado (red, batería sin restricción, reenvíos fallidos): su app es de una versión anterior. Con la app nueva se verá aquí.') : null,
      riesgos.length ? h('ul.sc-riesgos', riesgos.map((r) => h('li.' + r.nivel, r.motivo))) : (t.detalle_disponible ? h('p.sc-ayuda', 'Sin avisos de riesgo del teléfono.') : null),
      h('div.sc-acciones', accion('latido_ya'), accion('reenviar_historial')));
  }

  function listaOrdenes(d) {
    const cs = d.comandos || [];
    return h('section.sc-tarjeta',
      h('div.sc-cab-tarjeta', h('div', h('h2', 'Órdenes al teléfono'), h('p.sc-ayuda', 'Las más recientes primero. El teléfono las recibe cuando llama; si pasa el tiempo sin que las reciba, vencen.'))),
      cs.length ? h('div.sc-lista', cs.map((c) => h('div.sc-fila',
        h('div.sc-fila-i', h('span.sc-nombre', NOMBRE_ORDEN[c.cmd] || c.cmd), h('small', `${c.telefono || 'Cualquier teléfono de la empresa'} · pedida ${dmaHora(c.creado_en)} por ${c.creado_por || '—'}${c.nota ? ' · ' + c.nota : ''}`)),
        h('div.sc-fila-d', chip(NOMBRE_ESTADO_ORDEN[c.estado] || c.estado, CLASE_ESTADO_ORDEN[c.estado] || 'neutro'), h('small', c.estado === 'ejecutado' ? 'Hecha ' + dmaHora(c.ejecutado_en) : c.estado === 'cancelado' ? 'Cancelada ' + dmaHora(c.cancelado_en) : 'Vence ' + dmaHora(c.vence_en)))))) : h('p.sc-vacio', 'Todavía no se ha pedido nada desde aquí.'));
  }

  function pagoFila(p) {
    const chips = [p.estado === 'revision' ? chip('En revisión', 'espera') : null, p.venta_numero ? chip('Con venta ' + p.venta_numero, 'ok') : chip('Sin venta', 'neutro'), p.origen === 'historial' ? chip('Historial', 'neutro') : null];
    return h('div.sc-fila',
      h('div.sc-fila-i', h('span.sc-nombre', p.pagador || 'Sin nombre'), h('small', `${horaCR(p.hora)}${p.referencia ? ' · ref. ' + p.referencia : ''}`)),
      h('div.sc-fila-d', h('span.sc-monto', money(p.monto)), h('span', chips)));
  }

  function bloqueHoy(d) {
    const r = d.hoy_resumen || {}, ps = d.pagos_hoy || [];
    return h('section.sc-tarjeta',
      h('div.sc-cab-tarjeta', h('div', h('h2', 'SINPE de hoy'), h('p.sc-ayuda', 'Lo que el banco avisó hoy, tal como llegó. Cifras brutas, en colones.'))),
      h('div.sc-kpis',
        kpi('Cobrados hoy', money(r.total || 0), `${numTxt(r.n || 0)} ${r.n === 1 ? 'pago' : 'pagos'}`),
        kpi('Sin venta en el facturador', money(r.sin_venta_total || 0), `${numTxt(r.sin_venta_n || 0)} ${r.sin_venta_n === 1 ? 'pago' : 'pagos'}`, r.sin_venta_n ? 'rojo' : ''),
        kpi('Último aviso del banco', r.ultimo_aviso ? horaCR(r.ultimo_aviso) : '—', r.ultimo_aviso ? dmaHora(r.ultimo_aviso) : 'Todavía no hay avisos')),
      h('div.sc-lista', { style: 'margin-top:.8rem' }, ps.length ? ps.map(pagoFila) : h('p.sc-vacio', 'Hoy todavía no ha llegado ningún aviso del banco.')));
  }

  function cuadreHoy(d) {
    const r = d.hoy_resumen || {}, conVenta = (r.n || 0) - (r.sin_venta_n || 0);
    return h('section.sc-tarjeta',
      h('div.sc-cab-tarjeta', h('div', h('h2', 'Cuadre de hoy'), h('p.sc-ayuda', 'Tres puntos: el aviso del banco (SMS), la venta del facturador y el movimiento del banco (archivo del BCR). Hoy se cuadran los dos primeros.'))),
      h('div.sc-tres',
        h('div.sc-punto-caja', h('h3', '1 · Aviso del banco'), h('div.sc-kpi-v', money(r.total || 0)), h('div.sc-kpi-n', `${numTxt(r.n || 0)} avisos hoy`)),
        h('div.sc-punto-caja', h('h3', '2 · Venta del facturador'), h('div.sc-kpi-v', `${numTxt(conVenta)} de ${numTxt(r.n || 0)}`), h('div.sc-kpi-n', conVenta === (r.n || 0) ? 'Todos los avisos de hoy tienen su venta.' : `${numTxt(r.sin_venta_n || 0)} sin venta (${money(r.sin_venta_total || 0)}).`)),
        h('div.sc-punto-caja.pendiente', h('h3', '3 · Movimiento del banco'), h('div.sc-kpi-v', 'Pendiente'), h('div.sc-kpi-n', 'Todavía no entra el archivo de movimientos del BCR. La entrada ya está lista; se cuadra por comprobante cuando se cargue.'))));
  }

  const zona = zonaCarga({
    cargar: async () => { const d = await sinpeAdmin.caja(soc); ultimaCarga = new Date(); act.textContent = 'Actualizado a las ' + horaCR(ultimaCarga); return d; },
    pintar: (d) => {
      const aten = atencionTelefonos(d.telefonos);
      return h('div.sc-panel',
        ...aten.map((a) => h('p.sc-aviso' + (a.nivel === 'alto' ? '.alto' : ''), { role: 'alert' }, a.texto)),
        ...(d.telefonos || []).map((t) => tarjetaTelefono(t, d)),
        listaOrdenes(d), bloqueHoy(d), cuadreHoy(d),
        !d.activa ? h('p.sc-aviso.info', 'La lista de SINPE de las cajeras está apagada (interruptor «sinpe_tarjeta»). Esta pantalla sigue funcionando; solo las cajeras no ven la lista.') : null);
    },
    filas: 4,
  });
  const timer = setInterval(() => { if (!document.hidden) zona.recargar(true); }, 30000);
  const el = h('div.sc-panel',
    h('div.sc-ancla', h('strong', `Hoy, ${diaLargo(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Costa_Rica' }))} · ${nombreEmpresa}`), h('span', act, ' ', h('button.btn.chico', { type: 'button', onclick: (e) => conBoton(e.currentTarget, () => zona.recargar(true)) }, 'Refrescar'))),
    zona.el);
  zona.recargar();
  return { el, destruir: () => { clearInterval(timer); zona.destruir(); } };
}
