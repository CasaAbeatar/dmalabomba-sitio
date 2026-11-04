// Informe semanal (Administración, solo administradores). Muestra el informe que arma la función claude-semanal: planilla y costos con gráficos de ejes rotulados.
// Pestaña «Esta semana»: abre con la fecha de hoy, cuándo se hizo el informe y el informe más reciente. Pestaña «Semanas anteriores»: el historial, una semana a la vez.
// Lee fx_ia_informes_semanales (lista, sin el HTML) y fx_ia_informe_semanal (uno completo). Solo lee: no cambia nada.
// Seguridad: el HTML pasa por documentoInformeSeguro (lista de etiquetas permitidas) y va en un iframe con sandbox sin scripts (ver html_seguro.js).
import { h, esqueleto, bloqueError, textoDeError, hoyCR } from './util.js';
import { cargarHoja } from './ui_hojas.js';
import { rpc } from './api.js';
import { documentoInformeSeguro } from './html_seguro.js';

const TZ = 'America/Costa_Rica';
const fLargo = new Intl.DateTimeFormat('es-CR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fHora = new Intl.DateTimeFormat('es-CR', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true });
const fDia = new Intl.DateTimeFormat('es-CR', { timeZone: TZ, day: 'numeric', month: 'long', year: 'numeric' });
const mayus = (t) => t.charAt(0).toLocaleUpperCase('es') + t.slice(1);
const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(d));
const diasEntre = (a, b) => Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400000);
const lista = (x) => (Array.isArray(x) ? x.filter((i) => i && typeof i === 'object') : []);

// Marco aislado: sandbox sin scripts. Se permite el mismo origen solo para poder medir su alto y ajustarlo (sin scripts no puede tocar nada).
export function marcoDeInforme(documento, titulo) {
  const marco = h('iframe.sm-marco', { title: titulo || 'Informe semanal', sandbox: 'allow-same-origin', loading: 'lazy', referrerpolicy: 'no-referrer' });
  marco.srcdoc = documento;
  const ajustar = () => {
    try { const d = marco.contentDocument; if (d?.documentElement) marco.style.height = Math.max(320, Math.ceil(d.body.getBoundingClientRect().height) + 12) + 'px'; } catch { /* sin acceso: queda el alto mínimo */ }
  };
  marco.addEventListener('load', ajustar);
  if (typeof ResizeObserver === 'function') { const ro = new ResizeObserver(ajustar); ro.observe(marco); marco.addEventListener('load', () => { try { ro.observe(marco.contentDocument.body); } catch { /* nada */ } }); }
  return marco;
}

function cuerpoDe(inf) {
  const doc = inf.html ? documentoInformeSeguro(inf.html) : null;
  if (doc) return marcoDeInforme(doc, inf.titulo);
  const parrafos = String(inf.texto || '').split(/\n\n+/).filter(Boolean);
  return h('div.sm-texto',
    inf.html ? h('p.sm-nota', 'El gráfico de este informe no se pudo mostrar; abajo va el texto.') : h('p.sm-nota', 'Este informe es de antes de que los informes llevaran gráficos: solo tiene texto.'),
    parrafos.length ? parrafos.map((p) => h('p', p)) : h('p.tenue', 'Este informe no tiene texto.'));
}

export default {
  id: 'semanal',
  titulo: 'Informe semanal',
  async mount(root, app) {
    await cargarHoja('semanal.css');
    if (!app.admin) {
      root.append(h('div.vacio', h('p', 'Esta pantalla es solo para administradores.'), h('button.btn', { type: 'button', onclick: () => app.ir('inicio') }, 'Volver al inicio')));
      return;
    }
    let vivo = true, nCarga = 0;
    const est = { informes: [], tab: 'actual', elegido: null, cache: new Map() };
    const cuerpo = h('div.sm-cuerpo');
    root.append(h('div.sm', cuerpo));

    async function cargarLista() {
      const mi = ++nCarga;
      cuerpo.replaceChildren(esqueleto(3, 'Buscando los informes…'));
      try {
        const r = await rpc('fx_ia_informes_semanales', { p_limite: 52 });
        if (!vivo || mi !== nCarga) return;
        if (!r?.permitido) { cuerpo.replaceChildren(h('div.vacio', h('p', 'Esta pantalla es solo para administradores.'))); return; }
        est.informes = lista(r.informes);
        if (!est.elegido || !est.informes.some((i) => i.id === est.elegido)) est.elegido = (est.informes[1] || est.informes[0] || {}).id || null;
        pintar();
      } catch (e) {
        if (!vivo || mi !== nCarga) return;
        cuerpo.replaceChildren(bloqueError({ titulo: 'No se pudieron cargar los informes', mensaje: textoDeError(e), alReintentar: () => cargarLista() }));
      }
    }

    async function traer(id) {
      if (est.cache.has(id)) return est.cache.get(id);
      const r = await rpc('fx_ia_informe_semanal', { p_id: id });
      if (!r?.permitido || !r.hay) throw new Error('Ese informe ya no está disponible.');
      est.cache.set(id, r);
      return r;
    }

    // Pinta un informe dentro de `zona` (con su propio «cargando» y su propio «reintentar»)
    async function mostrar(zona, id) {
      zona.replaceChildren(esqueleto(3, 'Abriendo el informe…'));
      try {
        const inf = await traer(id);
        if (!vivo || !zona.isConnected) return;
        zona.replaceChildren(cuerpoDe(inf));
      } catch (e) {
        if (!vivo || !zona.isConnected) return;
        zona.replaceChildren(bloqueError({ titulo: 'No se pudo abrir el informe', mensaje: textoDeError(e), alReintentar: () => mostrar(zona, id) }));
      }
    }

    function pestanas() {
      const b = (id, texto) => h('button.btn', { type: 'button', 'aria-pressed': String(est.tab === id), onclick: () => { est.tab = id; pintar(); } }, texto);
      return h('div.sm-pestanas', { role: 'group', 'aria-label': 'Qué informe ver' }, b('actual', 'Esta semana'), b('historial', 'Semanas anteriores' + (est.informes.length > 1 ? ' (' + (est.informes.length - 1) + ')' : '')));
    }

    function cabeza(hoy) {
      return h('div.sm-hoy', h('span.sm-et', 'Hoy'), h('h2', mayus(fLargo.format(new Date(hoy + 'T12:00:00Z')))),
        h('p.tenue', 'El informe junta lo de los últimos 7 días con la planilla y las compras de los últimos meses. Las cifras dicen si son brutas o netas; en planilla y costos, pagar menos va en verde y pagar más en rojo.'));
    }

    function pintar() {
      const hoy = hoyCR();
      if (!est.informes.length) {
        cuerpo.replaceChildren(cabeza(hoy), h('div.vacio.sm-vacio', h('h3', 'Todavía no hay informes semanales'), h('p', 'Cuando se genere el primero aparecerá aquí, con sus gráficos.')));
        return;
      }
      const ultimo = est.informes[0];
      const zona = h('div.sm-zona', { 'aria-live': 'polite' });
      let contenido;
      if (est.tab === 'actual') {
        const dias = diasEntre(ymd(ultimo.creado_en), hoy);
        const rancio = dias > 7;
        contenido = [
          h('div.sm-meta', h('div', h('span.sm-et', 'Informe más reciente'), h('p.sm-titulo', ultimo.titulo), h('p.tenue', 'Se generó el ' + fDia.format(new Date(ultimo.creado_en)) + ' a las ' + fHora.format(new Date(ultimo.creado_en)) + (dias === 0 ? ' (hoy)' : dias === 1 ? ' (ayer)' : ' (hace ' + dias + ' días)') + '.')),
            ultimo.con_graficos ? null : h('span.sm-chip', 'Solo texto')),
          rancio ? h('p.sm-aviso', { role: 'status' }, 'Este informe tiene más de una semana: el de esta semana todavía no se ha generado.') : null,
          zona];
        mostrar(zona, ultimo.id);
      } else {
        const previos = est.informes.slice(1);
        if (!previos.length) contenido = [h('div.vacio.sm-vacio', h('p', 'Todavía no hay semanas anteriores. Este es el primer informe.'))];
        else {
          const filas = h('ul.sm-semanas', previos.map((i) => h('li', h('button.sm-semana', { type: 'button', 'aria-pressed': String(i.id === est.elegido), onclick: () => { est.elegido = i.id; pintar(); } },
            h('span.sm-semana-f', fDia.format(new Date(i.creado_en))), h('span.sm-semana-t', i.con_graficos ? 'Con gráficos' : 'Solo texto')))));
          contenido = [h('div.sm-historial', h('div.sm-lado', h('span.sm-et', 'Semanas anteriores'), filas), h('div.sm-detalle', est.elegido ? h('p.sm-titulo', (previos.find((i) => i.id === est.elegido) || {}).titulo || '') : null, zona))];
          if (est.elegido) mostrar(zona, est.elegido);
        }
      }
      cuerpo.replaceChildren(cabeza(hoy), pestanas(), ...contenido.filter(Boolean));
    }

    await cargarLista();
    return () => { vivo = false; nCarga++; };
  },
};
