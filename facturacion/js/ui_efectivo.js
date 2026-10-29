// Entradas y salidas de efectivo de la caja: formulario, lista mezclada y anulación con motivo.
// Reemplaza a ui_salidas.js en las pantallas que quieran las dos cosas juntas (Apertura y cierre de caja y Facturación).
// Regla de caja: debe haber en caja = fondo + ventas en efectivo + ENTRADAS - salidas - devoluciones en efectivo.
import { h, money, leerNumero, toast, modal, conBoton, textoDeError, horaCorta, esqueleto } from './util.js';
import { efectivo } from './api_avisos.js';

/* ---------- Hoja de estilos (css/avisos.css), una sola vez ---------- */
let cssListo = null;
export function cargarCssAvisos() {
  if (cssListo) return cssListo;
  const href = new URL('../css/avisos.css', import.meta.url).href;
  cssListo = new Promise((ok) => {
    if ([...document.querySelectorAll('link[rel=stylesheet]')].some((l) => l.href === href)) return ok();
    const l = h('link', { rel: 'stylesheet', href });
    l.addEventListener('load', () => ok());
    l.addEventListener('error', () => ok());
    document.head.append(l);
    setTimeout(ok, 2500);
  });
  return cssListo;
}

export const MOTIVOS = {
  salida: ['Pago a proveedor', 'Compra de hielo', 'Devolución de dinero (la venta ya está anulada)', 'Otro'],
  entrada: ['Refuerzo de cambio', 'Aporte de gerencia', 'Otro'],
};
// Esta línea va después de guardar: la página no puede saber si el aviso salió, por eso va en futuro
export const TEXTO_GUARDADO = 'Guardado. Se avisará a quienes reciben avisos.';

const suma = (l) => Math.round(l.reduce((s, x) => s + Number(x.monto || 0), 0) * 100) / 100;
// Totales de una lista de movimientos (sin contar los anulados)
export function totales(movs) {
  const vivos = (movs || []).filter((m) => !m.anulada);
  return { entradas: suma(vivos.filter((m) => m.tipo === 'entrada')), salidas: suma(vivos.filter((m) => m.tipo === 'salida')) };
}
// Mezcla las listas de fx_turno_estado (entradas y salidas vigentes) en una sola, de la hora más temprana a la más tardía
export function juntar(entradas, salidas) {
  return [...(entradas || []).map((x) => ({ ...x, tipo: 'entrada' })), ...(salidas || []).map((x) => ({ ...x, tipo: 'salida' }))]
    .sort((a, b) => new Date(a.creado_en) - new Date(b.creado_en));
}

/* ---------- Fila de la cuenta del cierre: «+ Entradas de efectivo» ---------- */
export function filaEntradas(totalEntradas) {
  return h('div.calc-fila', h('span', h('span.op', '+'), 'Entradas de efectivo'), h('span.v', money(totalEntradas)));
}

/* ---------- Lista de movimientos con signo y color ---------- */
// movs: [{ tipo, id, monto, motivo, creado_por_nombre|creado_por, creado_en, anulada, anulada_por, anulada_motivo }]
// alAnular(mov) aparece como botón «Anular» en los vigentes. Entrada en verde fino con «+», salida en rojo fino con «-».
export function listaMovimientos(movs, { alAnular, vacio = 'Todavía no hay entradas ni salidas de efectivo en este turno.' } = {}) {
  if (!movs || !movs.length) return h('p.tenue-linea', vacio);
  return h('ul.efe-lista', { 'aria-label': 'Entradas y salidas de efectivo de este turno' }, movs.map((m) => {
    const entrada = m.tipo === 'entrada';
    const signo = entrada ? '+' : '-';
    const quien = m.creado_por_nombre || m.creado_por || '';
    return h('li.efe-mov.' + (entrada ? 'entrada' : 'salida') + (m.anulada ? '.anulada' : ''),
      h('div.efe-mov-txt',
        h('div.efe-mot', m.motivo),
        h('div.efe-det', (entrada ? 'Entrada' : 'Salida') + ' · ' + horaCorta(m.creado_en) + (quien ? ' · ' + quien : '')),
        m.anulada ? h('div.efe-anul', h('span.chip.espera', 'Anulada'), ' ', (m.anulada_por ? 'por ' + m.anulada_por : '') + (m.anulada_motivo ? ': ' + m.anulada_motivo : '')) : null),
      h('div.efe-cifra', { 'aria-label': (entrada ? 'Entrada de ' : 'Salida de ') + money(m.monto) }, signo + ' ' + money(m.monto)),
      !m.anulada && alAnular
        ? h('button.btn.chico.peligro', { type: 'button', 'aria-label': 'Anular ' + (entrada ? 'la entrada' : 'la salida') + ' de ' + money(m.monto) + ' por ' + m.motivo, onclick: () => alAnular(m) }, 'Anular')
        : null);
  }));
}

/* ---------- Anular con motivo ---------- */
// Pide el motivo y anula. Devuelve true si se anuló.
export function anularMovimiento(mov) {
  return new Promise((fin) => {
    const entrada = mov.tipo === 'entrada';
    let hecho = false;
    const motivo = h('textarea.campo', { rows: 3, maxlength: 200, placeholder: 'Ej. se anotó dos veces por error', 'aria-label': 'Motivo de la anulación' });
    const err = h('div.error-caja', { hidden: true, role: 'alert' });
    const m = modal({
      titulo: entrada ? 'Anular entrada de efectivo' : 'Anular salida de efectivo', ancho: 480,
      alCerrar: () => { if (!hecho) fin(false); },
      contenido: h('div.col',
        h('p.conf', (entrada ? 'La entrada de ' : 'La salida de ') + money(mov.monto) + ' (' + mov.motivo + ') ' + (entrada ? 'dejará de contarse en la caja.' : 'dejará de restarse: el dinero vuelve a contarse como si estuviera en la caja.')),
        h('p.tenue-linea', 'Se avisará a quienes reciben avisos por WhatsApp.'),
        h('label.etq', 'Motivo de la anulación (obligatorio)', motivo),
        err),
      botones: [
        { texto: 'No, dejarla', onclick: (c) => { hecho = true; c(); fin(false); } },
        { texto: entrada ? 'Sí, anular la entrada' : 'Sí, anular la salida', clase: 'peligro', onclick: async () => {
          err.hidden = true;
          const t = motivo.value.trim();
          if (t.length < 3) { err.textContent = 'Escriba por qué se anula (mínimo 3 letras).'; err.hidden = false; motivo.focus(); return; }
          try {
            await (entrada ? efectivo.entradaAnular(mov.id, t) : efectivo.salidaAnular(mov.id, t));
            hecho = true; m.cerrar(); toast(entrada ? 'Entrada anulada.' : 'Salida anulada.'); fin(true);
          } catch (e) { err.textContent = textoDeError(e); err.hidden = false; }
        } },
      ],
    });
    motivo.focus();
  });
}

/* ---------- Ventana para registrar una entrada o una salida y ver los movimientos del turno ---------- */
// tipo: cuál queda escogida al abrir ('salida' o 'entrada'). alCambiar() se llama cada vez que cambia algo (para repintar el cierre de caja).
export async function abrirEfectivo({ turnoId, tipo = 'salida', alCambiar } = {}) {
  await cargarCssAvisos();
  let actual = tipo === 'entrada' ? 'entrada' : 'salida';
  let vivo = true;
  const monto = h('input.campo.efe-monto-campo', { type: 'text', inputmode: 'decimal', placeholder: '0', autocomplete: 'off', 'aria-label': 'Monto en colones' });
  const motivo = h('input.campo', { type: 'text', maxlength: 120, autocomplete: 'off', 'aria-label': 'Motivo' });
  const err = h('div.error-caja', { hidden: true, role: 'alert' });
  const guardado = h('div.efe-guardado', { hidden: true, role: 'status' }, TEXTO_GUARDADO);
  const zona = h('div.col', esqueleto(2, 'Cargando los movimientos…'));
  const resumen = h('p.efe-resumen');
  const chips = h('div.efe-chips', { role: 'group', 'aria-label': 'Motivos frecuentes' });
  const titulo = h('h3.efe-sub');
  const guardar = h('button.btn.grande.efe-guardar', { type: 'button' });
  const opcion = (t, rotulo, ayuda) => h('button.efe-op.' + t, { type: 'button', role: 'radio', onclick: () => elegir(t) }, h('span.efe-op-tit', rotulo), h('span.efe-op-ayuda', ayuda), h('span.efe-op-marca', 'Escogida'));
  const opSalida = opcion('salida', 'Salida de efectivo', 'Sale dinero de la caja');
  const opEntrada = opcion('entrada', 'Entrada de efectivo', 'Entra dinero a la caja');
  const grupo = h('div.efe-ops', { role: 'radiogroup', 'aria-label': '¿Entra o sale dinero?' }, opSalida, opEntrada);

  function pintarChips() {
    chips.replaceChildren(...MOTIVOS[actual].map((t) => {
      const b = h('button.efe-chip', { type: 'button', 'aria-pressed': String(motivo.value.trim() === t), onclick: () => {
        if (t === 'Otro') { motivo.value = ''; motivo.focus(); } else { motivo.value = t; }
        guardado.hidden = true; pintarChips();
      } }, t);
      return b;
    }));
  }
  function elegir(t) {
    actual = t;
    [[opSalida, 'salida'], [opEntrada, 'entrada']].forEach(([b, k]) => { b.classList.toggle('elegida', actual === k); b.setAttribute('aria-checked', String(actual === k)); });
    motivo.placeholder = t === 'entrada' ? 'Ej. Refuerzo de cambio' : 'Ej. Pago a proveedor';
    monto.setAttribute('aria-label', 'Monto que ' + (t === 'entrada' ? 'entra a' : 'sale de') + ' la caja, en colones');
    titulo.textContent = t === 'entrada' ? 'Dinero que entra a la caja' : 'Dinero que sale de la caja';
    guardar.textContent = t === 'entrada' ? 'Guardar entrada de efectivo' : 'Guardar salida de efectivo';
    guardar.className = 'btn grande efe-guardar ' + t;
    err.hidden = true;
    pintarChips();
  }

  async function refrescar() {
    try {
      const l = await efectivo.movimientos(turnoId);
      if (!vivo) return;
      const t = totales(l);
      resumen.textContent = l.some((m) => !m.anulada) ? `Entradas del turno: + ${money(t.entradas)}. Salidas del turno: - ${money(t.salidas)}.` : '';
      zona.replaceChildren(listaMovimientos(l, { alAnular: async (m) => { if (await anularMovimiento(m)) { await refrescar(); alCambiar?.(); } } }));
    } catch (e) { if (vivo) zona.replaceChildren(h('div.error-caja', textoDeError(e))); }
  }

  const hacer = () => conBoton(guardar, async () => {
    err.hidden = true; guardado.hidden = true;
    const v = leerNumero(monto.value);
    const m = motivo.value.trim();
    if (!Number.isFinite(v) || v <= 0) { err.textContent = actual === 'entrada' ? 'Escriba cuánto dinero entró a la caja, por ejemplo 5000.' : 'Escriba cuánto dinero salió de la caja, por ejemplo 5000.'; err.hidden = false; monto.focus(); return; }
    if (m.length < 3) { err.textContent = actual === 'entrada' ? 'Escriba de dónde viene el dinero (es obligatorio).' : 'Escriba para qué salió el dinero (es obligatorio).'; err.hidden = false; motivo.focus(); return; }
    await (actual === 'entrada' ? efectivo.entradaRegistrar(turnoId, v, m) : efectivo.salidaRegistrar(turnoId, v, m));
    monto.value = ''; motivo.value = ''; pintarChips();
    guardado.hidden = false; // Guardado. Se avisará a quienes reciben avisos.
    await refrescar();
    alCambiar?.();
    monto.focus();
  });
  guardar.addEventListener('click', hacer);
  [monto, motivo].forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); hacer(); } }));
  monto.addEventListener('input', () => { guardado.hidden = true; });
  motivo.addEventListener('input', () => { guardado.hidden = true; pintarChips(); });

  elegir(actual);
  modal({
    titulo: 'Entradas y salidas de efectivo', ancho: 620, alCerrar: () => { vivo = false; },
    contenido: h('div.col.efe',
      h('p.tenue-linea', 'Anote aquí el dinero que entra o sale de la caja y que no es una venta. Así el cierre de caja cuadra.'),
      grupo,
      titulo,
      h('label.etq', 'Monto (₡)', monto),
      h('div.etq', h('span', 'Motivo (obligatorio)'), chips, motivo),
      err, guardar, guardado,
      h('hr.efe-sep'),
      h('h3.efe-sub', 'Movimientos de este turno'),
      resumen, zona),
    botones: [{ texto: 'Listo, cerrar', clase: 'primario', onclick: (c) => c() }],
  });
  monto.focus();
  refrescar();
}
