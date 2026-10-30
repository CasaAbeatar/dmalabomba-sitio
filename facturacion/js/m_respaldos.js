// Respaldos (Administración, solo administradores): si el sistema está guardando copias de seguridad de los datos y de los comprobantes, si esas copias se pueden recuperar,
// y el aviso abierto en palabras sencillas. Lee fx_respaldo_estado (resumen + últimas pruebas) y marca avisos con fx_respaldo_alerta_atender. No muestra nombres técnicos del almacenamiento.
// Los avisos de atraso (id null) no se marcan: se quitan solos cuando la copia vuelve a salir bien.
import { h, esqueleto, bloqueError, textoDeError, confirmar, conBoton, toast, fechaHora } from './util.js';
import { respaldos, normalizarRespaldo, haceCuanto } from './api_respaldos.js';
import { cargarHoja } from './ui_hojas.js';

const HORAS_COPIA = 26, DIAS_PRUEBA = 8; // los mismos límites con que la base abre sus avisos
const horasDesde = (f) => (f ? (Date.now() - new Date(f).getTime()) / 3600000 : null);

const TIPO_PRUEBA = { restauracion: 'Prueba de cada noche', trimestral: 'Revisión completa del trimestre' };

// Una tarjeta con la última copia: cuánto hace, la fecha exacta y si está al día
function tarjetaCopia(titulo, fecha, ayuda) {
  const hs = horasDesde(fecha), alDia = hs != null && hs <= HORAS_COPIA;
  return h('div.tarjeta.rsp-dato' + (alDia ? '' : '.mal'),
    h('div.rsp-t', titulo),
    h('div.rsp-v', fecha ? haceCuanto(fecha) : 'Todavía no hay copia'),
    fecha ? h('div.rsp-n', fechaHora(fecha)) : null,
    h('span.chip.' + (alDia ? 'ok' : 'mal'), alDia ? 'Al día' : fecha ? 'Atrasada' : 'Sin copia'),
    h('p.rsp-ayuda', ayuda));
}
function tarjetaPrueba(p) {
  const dias = p ? horasDesde(p.fecha) / 24 : null;
  const bien = !!p && p.ok && dias <= DIAS_PRUEBA;
  const chip = !p ? ['mal', 'Sin pruebas'] : !p.ok ? ['mal', 'Salió mal'] : dias > DIAS_PRUEBA ? ['mal', 'Atrasada'] : ['ok', 'Salió bien'];
  return h('div.tarjeta.rsp-dato' + (bien ? '' : '.mal'),
    h('div.rsp-t', 'Última prueba de restauración'),
    h('div.rsp-v', p ? haceCuanto(p.fecha) : 'Todavía no hay pruebas'),
    p ? h('div.rsp-n', fechaHora(p.fecha)) : null,
    h('span.chip.' + chip[0], chip[1]),
    h('p.rsp-ayuda', 'Cada noche el sistema recupera un comprobante al azar desde la copia y comprueba que está completo. Así se sabe que la copia sirve de verdad.'));
}

export default {
  id: 'respaldos',
  titulo: 'Respaldos',
  async mount(root, app) {
    await cargarHoja('respaldos.css');
    if (!app.admin) {
      root.append(h('div.vacio', h('p', 'Esta pantalla es solo para administradores.'), h('button.btn', { type: 'button', onclick: () => app.ir('inicio') }, 'Volver al inicio')));
      return;
    }
    const cuerpo = h('div.rsp-cuerpo');
    let nCarga = 0; // cada carga lleva su número: si llega tarde la respuesta de una anterior, se descarta
    let vivo = true;

    async function cargar() {
      const mi = ++nCarga;
      if (!cuerpo.children.length || cuerpo.querySelector('.bloque-error')) cuerpo.replaceChildren(esqueleto(3, 'Revisando las copias…'));
      let est;
      try { est = await respaldos.estado(); } catch (e) {
        if (!vivo || mi !== nCarga) return;
        cuerpo.replaceChildren(bloqueError({ titulo: 'No se pudo revisar el estado de las copias', mensaje: textoDeError(e), alReintentar: () => cargar() }));
        return;
      }
      if (!vivo || mi !== nCarga) return;
      const r = normalizarRespaldo(est?.resumen);
      if (!r) { cuerpo.replaceChildren(bloqueError({ titulo: 'No hay información de las copias', mensaje: 'El sistema no devolvió el estado de los respaldos. Intente de nuevo en un momento.', alReintentar: () => cargar() })); return; }
      cuerpo.replaceChildren(...pintar(r, Array.isArray(est?.pruebas) ? est.pruebas : []));
    }

    async function atender(a, btn) {
      const ok = await confirmar('¿Ya revisó este aviso? Se anota que usted lo atendió y deja de aparecer en el encabezado. Si el problema sigue, la copia seguirá sin hacerse.', { si: 'Sí, marcar como atendido', no: 'No, volver' });
      if (!ok || !vivo) return;
      await conBoton(btn, async () => {
        await respaldos.atender(a.id);
        toast('Aviso marcado como atendido.');
        app.alertas?.refrescar?.();
        await cargar();
      });
    }

    function avisoDe(a) {
      const btn = h('button.btn', { type: 'button', onclick: (e) => atender(a, e.currentTarget) }, 'Marcar como atendido');
      return h('li.rsp-aviso' + (a.urgente ? '.urgente' : ''),
        h('p.rsp-aviso-t', a.mensaje || 'El respaldo tiene un problema.'),
        h('p.rsp-aviso-m', [a.desde ? 'Desde el ' + fechaHora(a.desde) : '', a.veces > 1 ? 'Se repitió ' + a.veces + ' veces' : ''].filter(Boolean).join(' · ')),
        a.id != null ? btn : h('p.rsp-aviso-m', 'Este aviso se quita solo cuando la copia vuelva a salir bien.'));
    }

    function pintar(r, pruebas) {
      const hay = r.problemas > 0;
      const estado = hay
        ? h('div.rsp-estado.' + (r.urgente ? 'rojo' : 'ambar'), { role: 'status' },
          h('h2', r.problemas === 1 ? 'Hay un aviso sobre las copias' : 'Hay ' + r.problemas + ' avisos sobre las copias'),
          r.alertas.length ? h('ul.rsp-avisos', r.alertas.map(avisoDe)) : h('p', r.mensaje || 'El respaldo tiene un problema.'))
        : h('div.rsp-estado.verde', { role: 'status' }, h('h2', 'Todo en orden'), h('p', 'Las copias de seguridad están al día y la última prueba salió bien.'));
      const lista = pruebas.filter((p) => p && p.fecha).slice(0, 5);
      return [
        estado,
        h('div.rsp-rejilla',
          tarjetaCopia('Última copia de los datos', r.ultimo_respaldo, 'Ventas, clientes, productos, turnos y todo lo demás. Se copia cada noche.'),
          tarjetaCopia('Última copia de los comprobantes', r.ultimo_respaldo_xml, 'Los comprobantes electrónicos que se enviaron a Hacienda. Se guardan uno por uno y nunca se borran.'),
          tarjetaPrueba(r.ultima_prueba)),
        lista.length ? h('section.tarjeta.rsp-pruebas', h('h3', 'Pruebas recientes'),
          h('ul', lista.map((p) => h('li', h('span', fechaHora(p.fecha) + ' · ' + (TIPO_PRUEBA[p.tipo] || 'Prueba')), h('span.chip.' + (p.ok ? 'ok' : 'mal'), p.ok ? 'Salió bien' : 'Salió mal'))))) : null,
        h('details.tarjeta.rsp-como', h('summary', 'Cómo funcionan las copias'),
          h('ul',
            h('li', 'La ley obliga a guardar los comprobantes electrónicos por lo menos 5 años. Cada uno se guarda como un archivo propio, y ese archivo no se borra ni se cambia.'),
            h('li', 'Los datos se copian cada noche. Las copias de cada día se conservan 35 días y la primera de cada mes se conserva para siempre.'),
            h('li', 'Además, todo se copia al OneDrive de la empresa: esa es la copia que queda fuera del sistema.'),
            h('li', 'Si una copia falla, el sistema la vuelve a intentar solo. Si pasa más de un día sin copia, o más de una semana sin prueba, aparece un aviso aquí y arriba en la pantalla.'),
            h('li', 'Nadie tiene que hacer nada para que las copias se hagan.'))),
      ].filter(Boolean);
    }

    root.append(
      h('div.rsp',
        h('div.rsp-cab',
          h('p', 'Aquí se ve si el sistema está guardando copias de seguridad de sus datos y de sus comprobantes, y si esas copias se pueden recuperar cuando haga falta.'),
          h('button.btn', { type: 'button', onclick: (e) => conBoton(e.currentTarget, () => cargar()) }, 'Revisar de nuevo')),
        cuerpo));
    await cargar();
    return () => { vivo = false; nCarga++; };
  },
};
