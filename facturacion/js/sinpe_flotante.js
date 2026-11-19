// Lista flotante «SINPE» de la caja (bandera sinpe_tarjeta). Decisión de Emil (17 nov 2026, 21:14 CR): la lista fija era invasiva; ahora es una pastilla pequeña
// («Ver SINPE») en la esquina inferior que, al tocarla, abre una ventana flotante con la misma lista de solo lectura. Se cierra con «Cerrar», con Esc o tocando fuera,
// y nunca se abre sola: si entra un SINPE, la pastilla solo muestra la marca «nuevo» (sin números, totales ni conteos). Nada del cobro ni del cierre depende de ella.
import { h } from './util.js';
import { listaSinpe, cargarCssSinpe } from './ui_sinpe.js';
import { sinpe as apiSinpe } from './api_sinpe.js';

const ssGet = (k) => { try { const v = sessionStorage.getItem(k); return v === null ? null : JSON.parse(v); } catch { return null; } };
const ssSet = (k, v) => { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento: la marca «nuevo» vale solo mientras la pantalla está abierta */ } };

export function flotanteSinpe({ soc, empresa = 'soda', api = apiSinpe, intervaloMs = 6000, intervaloCerradaMs = 15000, anclaje = null } = {}) {
  cargarCssSinpe();
  const clave = 'fx_sinpe_vistos_' + (soc || '');
  const previo = ssGet(clave);
  let vistos = Array.isArray(previo) ? new Set(previo) : null; // null: todavía no se conoce lo que ya había (la primera consulta fija el punto de partida sin marcar nada como nuevo)
  let abierto = false, nuevo = false, muerto = false, sondeando = false, lista = null, ventana = null;
  const guardar = () => ssSet(clave, [...vistos].slice(-300));
  const marca = h('span.sinpe-flot-nuevo', { hidden: true }, 'nuevo');
  const pastilla = h('button.sinpe-flot-pastilla', { type: 'button', dataset: { emp: empresa }, 'aria-haspopup': 'dialog', 'aria-expanded': 'false', onclick: () => abrir() },
    h('span.sinpe-flot-texto', 'Ver SINPE'), marca);
  const pintarPastilla = () => {
    marca.hidden = !nuevo;
    pastilla.setAttribute('aria-label', nuevo ? 'Ver la lista de SINPE: hay un SINPE nuevo' : 'Ver la lista de SINPE');
    pastilla.classList.toggle('abierta', abierto);
  };
  const verIds = (r) => {
    const ids = (r?.pagos || []).map((p) => p.id);
    if (vistos === null) { vistos = new Set(ids); guardar(); return false; }
    return ids.some((i) => !vistos.has(i));
  };
  async function sondear() {
    if (muerto || abierto || document.hidden || sondeando) return;
    sondeando = true;
    try {
      const x = await api.lista(soc);
      if (muerto || abierto || !x || x.activa === false) return;
      if (verIds(x) && !nuevo) { nuevo = true; pintarPastilla(); }
    } catch { /* sin respuesta: la pastilla se queda como está; el cobro no depende de ella */ }
    finally { sondeando = false; }
  }
  const alPuntero = (e) => { if (abierto && ventana && !ventana.contains(e.target) && !pastilla.contains(e.target)) cerrar(false); };
  const alTeclado = (e) => { if (abierto && e.key === 'Escape') { e.preventDefault(); cerrar(true); } };
  function abrir() {
    if (abierto || muerto) return;
    abierto = true; nuevo = false; pastilla.setAttribute('aria-expanded', 'true');
    lista = listaSinpe({ soc, empresa, api, intervaloMs, titulo: 'SINPE recibidos',
      alCargar: (r) => { if (vistos === null) vistos = new Set(); for (const p of r.pagos || []) vistos.add(p.id); guardar(); } });
    const btnCerrar = h('button.btn.sinpe-flot-cerrar', { type: 'button', 'aria-label': 'Cerrar la lista de SINPE', onclick: () => cerrar(true) }, 'Cerrar');
    ventana = h('div.sinpe-flot-ventana', { role: 'dialog', 'aria-label': 'SINPE recibidos', tabindex: '-1', dataset: { emp: empresa } },
      h('div.sinpe-flot-cab', h('strong', 'SINPE recibidos'), btnCerrar), lista.el);
    document.body.append(ventana);
    pintarPastilla();
    try { btnCerrar.focus({ preventScroll: true }); } catch { /* nada */ }
  }
  function cerrar(devolverFoco) {
    if (!abierto) return;
    abierto = false; pastilla.setAttribute('aria-expanded', 'false');
    lista?.destruir(); lista = null; ventana?.remove(); ventana = null;
    pintarPastilla();
    if (devolverFoco) { try { pastilla.focus({ preventScroll: true }); } catch { /* nada */ } }
  }
  const alVolver = () => { if (!document.hidden) sondear(); };
  document.addEventListener('pointerdown', alPuntero, true);
  document.addEventListener('keydown', alTeclado);
  document.addEventListener('visibilitychange', alVolver);
  const timer = setInterval(sondear, intervaloCerradaMs);
  (anclaje || document.body).append(pastilla); if (anclaje) pastilla.classList.add('en-fila'); pintarPastilla(); sondear();
  return {
    el: pastilla, estaAbierta: () => abierto, hayNuevo: () => nuevo, sondear, cerrar: () => cerrar(false),
    destruir() {
      muerto = true; clearInterval(timer);
      document.removeEventListener('pointerdown', alPuntero, true); document.removeEventListener('keydown', alTeclado); document.removeEventListener('visibilitychange', alVolver);
      lista?.destruir(); lista = null; ventana?.remove(); ventana = null; pastilla.remove();
    },
  };
}
