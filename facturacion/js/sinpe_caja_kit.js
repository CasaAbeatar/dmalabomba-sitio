// «Caja para mí» · KIT ↔ APP: cada lado dice su versión y aquí se ve si se llevan bien. Solo se mira; nada se cambia desde esta pantalla.
// App del teléfono: la versión viene en el latido (fact.sinpe_latidos). Kit de la caja: viene en el latido de la computadora (public.equipos_latidos).
// Las reglas de compatibilidad están en fact.sinpe_compat_reglas (hoy vacía: ninguna se inventa). Si el sitio publica el manifiesto del kit (OTA), también se compara con él.
import { h } from './util.js';
import { sinpeAdmin, leerManifiestoKit } from './api_sinpe_admin.js';
import { zonaCarga, chip, tablaApilable } from './sinpe_caja_ui.js';
import { fechaHoraCR, haceTexto, estadoLatido, banderasKit } from './sinpe_admin_calc.js';

const CLASE_NIVEL = { ok: 'ok', tarda: 'tarda', sin: 'sin', nunca: 'sin' };
const CLASE_BANDERA = { alto: 'alto', medio: '', info: 'info' };
const ROTULO_BANDERA = { alto: 'Hay que atenderlo', medio: 'Conviene revisarlo', info: 'Para saber' };

export function seccionKit(ctx) {
  const { soc, nombreEmpresa } = ctx;
  function pintar([d, manifiesto]) {
    const banderas = banderasKit({ telefonos: d.telefonos, equipos: d.equipos, reglas: d.reglas, manifiesto });
    const pub = (e) => {
      const l = (manifiesto?.lanzamientos || []).filter((x) => (x.estaciones || []).includes(e.estacion)).sort((a, b) => (b.serie || 0) - (a.serie || 0))[0];
      return l ? l.version : (manifiesto ? 'Ninguna para esta caja' : 'No se pudo leer');
    };
    return h('div.sc-panel',
      h('section.sc-tarjeta', h('h2', 'Banderas'), h('p.sc-ayuda', 'Lo que no cuadra entre el teléfono y la computadora de caja. Las más importantes primero.'),
        h('div.sc-panel', { style: 'margin-top:.6rem' }, banderas.map((b) => h('p.sc-aviso' + (CLASE_BANDERA[b.nivel] ? '.' + CLASE_BANDERA[b.nivel] : ''), h('strong', ROTULO_BANDERA[b.nivel] + ': '), b.titulo + '. ', b.detalle)))),
      h('section.sc-tarjeta', h('h2', 'App del teléfono'), h('p.sc-ayuda', 'Versión que informa cada teléfono en su último latido.'),
        d.telefonos.length ? tablaApilable([{ t: 'Teléfono', cab: true }, { t: 'Versión de la app' }, { t: 'Último latido', ancha: true }, { t: 'Estado' }],
          d.telefonos.map((t) => { const e = estadoLatido(t.minutos); return [t.telefono, t.app || 'No informa', `${fechaHoraCR(t.ultimo_latido)} (${haceTexto(t.minutos)})`, chip(e.texto, CLASE_NIVEL[e.nivel])]; })) : h('p.sc-vacio', 'No hay teléfonos registrados para esta empresa.')),
      h('section.sc-tarjeta', h('h2', 'Kit de la computadora de caja'), h('p.sc-ayuda', 'Versión que informa cada computadora y la que está publicada para ella en el manifiesto del kit.'),
        d.equipos.length ? tablaApilable([{ t: 'Computadora', cab: true }, { t: 'Kit instalado' }, { t: 'Kit publicado' }, { t: 'Facturador', ancha: true }, { t: 'Último latido', ancha: true }, { t: 'Estado' }],
          d.equipos.map((e) => { const s = estadoLatido(e.minutos); return [e.nombre || e.estacion, e.version_kit || 'No informa', pub(e), e.version_facturador || 'No informa', e.ultimo_latido ? `${fechaHoraCR(e.ultimo_latido)} (${haceTexto(e.minutos)})` : 'Nunca ha informado', chip(s.texto, CLASE_NIVEL[s.nivel])]; })) : h('p.sc-vacio', 'No hay computadoras de caja registradas para esta empresa.')),
      h('section.sc-tarjeta', h('h2', 'Reglas de compatibilidad'), h('p.sc-ayuda', 'Qué versión de la app necesita cada versión del kit, y al revés. Se cargan en la base cuando se definan.'),
        d.reglas.length ? tablaApilable([{ t: 'Regla', cab: true }, { t: 'App' }, { t: 'Kit' }, { t: 'Motivo', ancha: true }],
          d.reglas.map((r) => [{ app_minima: 'La app no debe ser más vieja que…', kit_minimo: 'El kit no debe ser más viejo que…', app_exige_kit: 'Si la app es de… o más nueva, el kit debe ser…', kit_exige_app: 'Si el kit es de… o más nuevo, la app debe ser…' }[r.tipo] || r.tipo, r.app_min || '—', r.kit_min || '—', r.motivo || ''])) : h('p.sc-vacio', 'Todavía no hay reglas cargadas.')),
      h('p.sc-ayuda', `Empresa: ${nombreEmpresa}. Solo se mira: desde aquí no se cambia nada del teléfono ni de la caja.`));
  }
  const zona = zonaCarga({ cargar: () => Promise.all([sinpeAdmin.versiones(soc), leerManifiestoKit()]), pintar, filas: 4 });
  const el = h('div.sc-panel', h('p.sc-ayuda', 'Cada lado informa su versión y esta pantalla avisa si no se llevan bien. Es solo para mirar.'), zona.el);
  zona.recargar();
  return { el, destruir: () => zona.destruir() };
}
