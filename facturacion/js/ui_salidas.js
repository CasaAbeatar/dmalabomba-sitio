// Salidas de efectivo de la caja (pago a proveedor, compra, devolución a cliente...). Lo usan Caja y Cierre de caja.
import { h, money, leerNumero, toast, modal, confirmar, conBoton, fechaHora, horaCorta } from './util.js';

const MOTIVOS = ['Pago a proveedor', 'Compra de hielo', 'Devolución a cliente'];

// Pide confirmación y anula una salida. Devuelve true si se anuló.
export async function anularSalida(api, s) {
  const ok = await confirmar('¿Anular la salida de ' + money(s.monto) + ' (' + s.motivo + ')? El dinero vuelve a contarse como si estuviera en la caja.', { si: 'Sí, anular la salida', no: 'No, dejarla', peligro: true });
  if (!ok) return false;
  try { await api.salidaAnular(s.id); toast('Salida anulada.'); return true; }
  catch (e) { toast(e.message || String(e), 'error', 7000); return false; }
}

// Lista de salidas (con botón Anular si se pasa alAnular)
export function listaSalidas(salidas, alAnular) {
  if (!salidas.length) return h('p.tenue-linea', 'Todavía no hay salidas de efectivo en este turno.');
  return h('div.col', salidas.map((s) => h('div.salida-item',
    h('div', h('div.s-mot', s.motivo), h('div.s-det', horaCorta(s.creado_en) + ' · ' + (s.creado_por || ''))),
    h('div.s-monto', money(s.monto)),
    alAnular ? h('button.btn.chico.peligro', { type: 'button', 'aria-label': 'Anular la salida de ' + money(s.monto) + ' por ' + s.motivo, onclick: () => alAnular(s) }, 'Anular') : null)));
}

// Ventana para registrar una salida y ver/anular las del turno. alCambiar se llama cada vez que cambia algo.
export function abrirSalidas({ api, turnoId, alCambiar }) {
  const monto = h('input.campo.monto-grande', { type: 'text', inputmode: 'decimal', placeholder: '0', autocomplete: 'off', 'aria-label': 'Monto que sale de la caja' });
  const motivo = h('input.campo', { type: 'text', maxlength: 120, autocomplete: 'off', placeholder: 'Ej. Pago a proveedor' });
  const err = h('div.error-caja', { hidden: true });
  const zona = h('div.col');
  const total = h('strong');
  const guardar = h('button.btn.primario.grande', { type: 'button', style: 'width:100%' }, 'Registrar salida de efectivo');
  const chips = h('div.atajos', { style: 'justify-content:flex-start;margin:.2rem 0 0' }, MOTIVOS.map((t) => h('button.btn.chico', { type: 'button', onclick: () => { motivo.value = t; motivo.focus(); } }, t)));
  let vivo = true;

  async function refrescar() {
    try {
      const l = await api.salidas(turnoId);
      if (!vivo) return;
      const suma = l.reduce((s, x) => s + Number(x.monto), 0);
      total.textContent = l.length ? 'Total de salidas del turno: ' + money(suma) : '';
      zona.replaceChildren(listaSalidas(l, async (s) => { if (await anularSalida(api, s)) { await refrescar(); alCambiar?.(); } }));
    } catch (e) { zona.replaceChildren(h('div.error-caja', e.message || String(e))); }
  }
  const hacer = () => conBoton(guardar, async () => {
    err.hidden = true;
    const v = leerNumero(monto.value);
    const m = motivo.value.trim();
    if (!Number.isFinite(v) || v <= 0) { err.textContent = 'Escriba cuánto dinero salió de la caja, por ejemplo 5000.'; err.hidden = false; monto.focus(); return; }
    if (m.length < 3) { err.textContent = 'Escriba para qué salió el dinero (es obligatorio).'; err.hidden = false; motivo.focus(); return; }
    await api.salidaRegistrar(turnoId, v, m);
    toast('Salida registrada: ' + money(v) + ' (' + m + ').');
    monto.value = ''; motivo.value = '';
    await refrescar();
    alCambiar?.();
    monto.focus();
  });
  guardar.addEventListener('click', hacer);
  [monto, motivo].forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); hacer(); } }));

  modal({
    titulo: 'Salida de efectivo', ancho: 600, alCerrar: () => { vivo = false; },
    contenido: h('div.col',
      h('p.tenue-linea', 'Use esto cuando sale dinero de la caja que no es un vuelto: pago a un proveedor, una compra, una devolución a un cliente. Así el cierre de caja cuadra.'),
      h('label.etq', 'Monto que sale de la caja (₡)', monto),
      h('label.etq', 'Motivo (obligatorio)', motivo),
      chips, err, guardar,
      h('hr', { style: 'border:0;border-top:1px solid var(--linea);width:100%;margin:.4rem 0' }),
      h('h3', 'Salidas de este turno'),
      zona, total),
    botones: [{ texto: 'Listo, cerrar', clase: 'primario', onclick: (c) => c() }],
  });
  monto.focus();
  refrescar();
}
