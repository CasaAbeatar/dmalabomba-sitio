// Avisos que solo ven los administradores y que llegan junto con los avisos del encabezado (main.js los pide cada 60 segundos, junto con fx_alertas):
//   - Respaldos: una franja bajo el encabezado, solo cuando hay un aviso abierto (si todo está en orden no se ve nada), y la insignia de la tarjeta «Respaldos».
//   - Seguridad del ingreso: la insignia de la tarjeta «Usuarios» (avisos de muchos intentos fallidos de PIN sin atender).
// Guardan lo último que supieron en app.respaldo y app.seguridad; modulos.js lee esas dos para las insignias.
import { h } from './util.js';
import { cargarHoja } from './ui_hojas.js';
import { esTransitorio, esSesionVencida } from './api.js';
import { respaldos, normalizarRespaldo } from './api_respaldos.js';
import { seguridad, normalizarSeguridad } from './api_seguridad.js';

// Lo que dice la franja. En pantallas bajas va una sola línea; en las altas, un título y el aviso completo.
export function textoAvisoRespaldo(r, baja = false) {
  if (!r || !(r.problemas > 0)) return null;
  const mas = r.problemas > 1 ? ' Hay ' + (r.problemas - 1) + (r.problemas === 2 ? ' aviso más.' : ' avisos más.') : '';
  const msg = String(r.mensaje || 'El respaldo tiene un problema.').trim();
  const msgP = /[.!?]$/.test(msg) ? msg : msg + '.';
  // En una línea corta, la cantidad va primero para que, si el texto se corta al final, no se pierda: «Respaldos (2 avisos): La copia de los datos falló…»
  if (baja) return { titulo: 'Respaldos' + (r.problemas > 1 ? ' (' + r.problemas + ' avisos)' : '') + ': ' + msgP, detalle: '' };
  return {
    titulo: r.problemas === 1 ? 'Hay un aviso sobre los respaldos.' : 'Hay ' + r.problemas + ' avisos sobre los respaldos.',
    detalle: msgP + mas + ' Toque «Ver respaldos» para ver qué pasó.',
  };
}

export function crearAvisosAdmin(app, { alCambiar } = {}) {
  cargarHoja('respaldos.css');
  const titulo = h('strong'), detalle = h('span.alerta-detalle');
  const el = h('div.alerta-resp', { role: 'status', hidden: true },
    h('div.alerta-in', h('div.alerta-texto', titulo, detalle),
      h('button.btn.alerta-ver', { type: 'button', 'aria-label': 'Ver el estado de los respaldos', onclick: () => app.ir('respaldos') }, 'Ver respaldos')));
  const baja = window.matchMedia ? window.matchMedia('(max-height:899px)') : { matches: false };
  function pintar() {
    const t = app.admin ? textoAvisoRespaldo(app.respaldo, baja.matches) : null;
    if (!t) { el.hidden = true; return; }
    titulo.textContent = t.titulo;
    detalle.textContent = t.detalle;
    detalle.hidden = !t.detalle;
    el.classList.toggle('urgente', !!app.respaldo.urgente);
    el.hidden = false;
  }
  baja.addEventListener?.('change', pintar);

  // Pregunta las dos cosas a la vez. `vigente()` dice si la respuesta todavía sirve (no cambió la empresa ni se cerró la sesión). Una falla no borra lo que ya se sabía:
  // no poder preguntar no quiere decir que el aviso se resolvió.
  async function actualizar(vigente = () => true) {
    if (!app.admin) { app.respaldo = null; app.seguridad = null; pintar(); return; }
    const [a, b] = await Promise.allSettled([respaldos.resumen(), seguridad.alertas()]);
    if (!vigente()) return;
    if (a.status === 'fulfilled') app.respaldo = normalizarRespaldo(a.value);
    else if (!esTransitorio(a.reason) && !esSesionVencida(a.reason)) console.warn('Avisos de respaldos no disponibles:', a.reason?.message || a.reason);
    if (b.status === 'fulfilled') app.seguridad = normalizarSeguridad(b.value);
    else if (!esTransitorio(b.reason) && !esSesionVencida(b.reason)) console.warn('Avisos de seguridad del ingreso no disponibles:', b.reason?.message || b.reason);
    pintar();
    try { alCambiar?.(); } catch { /* la insignia es un adorno: si falla, el aviso igual ya se pintó */ }
  }
  return { el, actualizar, pintar };
}
