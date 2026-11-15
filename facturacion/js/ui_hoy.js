// «Hoy»: la pantalla de inicio del administrador. Reemplaza la cuadrícula de tarjetas: lo de hoy primero (caja, ventas), lo que requiere atención y los accesos de siempre.
// Todas las cifras salen de las mismas funciones del servidor que ya usan los informes; aquí no se calcula nada que decida dinero.
import { h, money, horaCorta, hoyCR } from './util.js';
import { modulosDe, buscar, insigniaDe, esDixia, RAPIDOS_DIXIA } from './modulos.js';
import { listados2 } from './api_listados.js';

const saludo = () => { const hr = Number(new Intl.DateTimeFormat('es-CR', { hour: 'numeric', hour12: false, timeZone: 'America/Costa_Rica' }).format(new Date())); return hr < 12 ? 'Buenos días' : hr < 18 ? 'Buenas tardes' : 'Buenas noches'; };

export function pantallaHoy(app, { alAbrir, alCerrarCaja, alAbrirCaja, abrirAtencion }) {
  const t = app.turno;
  const fecha = new Intl.DateTimeFormat('es-CR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Costa_Rica' }).format(new Date());
  const nombre = String(app.ctx?.nombre || app.usuario || '').split(' ')[0];
  const cifra = (et, valor, nota) => h('div.hoy-cifra', h('span.hoy-et', et), h('strong.hoy-valor', valor), h('small.tenue', nota || ' '));
  const vV = h('strong.hoy-valor', '…'), vN = h('strong.hoy-valor', '…'), vD = h('strong.hoy-valor', '…');
  const cifras = h('div.hoy-cifras', { 'aria-live': 'polite' },
    h('div.hoy-cifra', h('span.hoy-et', 'Ventas de hoy'), vV, h('small.tenue', 'sin IVA ni propinas')),
    h('div.hoy-cifra', h('span.hoy-et', 'Facturas y tiquetes'), vN, h('small.tenue', 'vigentes hoy')),
    h('div.hoy-cifra', h('span.hoy-et', 'Documentos emitidos'), vD, h('small.tenue', 'incluye anulados')));
  const hoy = hoyCR();
  listados2(app.soc.id, hoy, hoy).then((r) => {
    const x = (r && (r.resumen || r)) || {};
    vV.textContent = money(Number(x.ventas_netas || 0));
    vN.textContent = String(x.vigentes_n ?? 0);
    vD.textContent = String(x.docs_emitidos ?? 0);
  }).catch(() => { vV.textContent = vN.textContent = vD.textContent = '—'; });

  if (esDixia(app)) {
    const grandes = RAPIDOS_DIXIA.map(buscar).filter(Boolean);
    return h('div.inicio.hoy.hoy-dixia', h('header.hoy-cab', h('h1', saludo() + (nombre ? ', ' + nombre : '')), h('p.tenue', fecha.charAt(0).toUpperCase() + fecha.slice(1))),
      h('div.hoy-accesos.hoy-grandes', grandes.map((m) => h('button.hoy-acceso', { type: 'button', onclick: () => alAbrir(m) }, h('b', m.titulo), h('span', typeof m.descripcion === 'string' ? m.descripcion : '')))));
  }
  const caja = h('div.hoy-caja' + (t ? '' : '.cerrada'), { role: 'status' },
    h('div', h('span.hoy-et', 'Caja'), h('strong', t ? 'Abierta desde las ' + horaCorta(t.abierto_en) : 'Cerrada')),
    t ? h('button.btn', { type: 'button', onclick: alCerrarCaja }, 'Cerrar caja') : h('button.btn.primario', { type: 'button', onclick: alAbrirCaja }, 'Abrir caja'));

  const rapidos = ['caja', 'anular', 'clientes', 'turno'].map(buscar).filter(Boolean);
  const accesos = h('div.hoy-accesos', rapidos.map((m) => h('button.hoy-acceso' + (m.destacado ? '.destacado' : ''), { type: 'button', onclick: () => alAbrir(m) }, h('b', m.titulo), h('span', typeof m.descripcion === 'string' ? m.descripcion : ''))));

  // Lo que pide atención, resumido: las insignias de los módulos (las mismas de siempre). El detalle completo vive en la columna «Requiere atención».
  const cuerpoAtn = h('div.hoy-atn');
  const pintarAtn = () => {
    const pend = modulosDe('admin', app).filter((m) => m.id !== 'recurrentes').map((m) => ({ m, i: insigniaDe(m, app) })).filter((x) => x.i).sort((a, b) => (b.i.urgente ? 1 : 0) - (a.i.urgente ? 1 : 0));
    cuerpoAtn.replaceChildren(pend.length ? h('div.hoy-pend', pend.map(({ m, i }) => h('button.hoy-pend-item' + (i.urgente ? '.urgente' : ''), { type: 'button', onclick: () => alAbrir(m) }, h('b', m.titulo), h('span', i.texto)))) : h('p.tenue', 'Nada pendiente por ahora.'));
  };
  pintarAtn();
  // los datos llegan después de pintar: se vuelve a escribir mientras esta pantalla esté a la vista
  const ev = ['app:alertas', 'app:alertas-cambio', 'app:alertas-hacienda-cambio', 'app:atencion'];
  const alCambiar = () => { if (!cuerpoAtn.isConnected) { ev.forEach((e) => document.removeEventListener(e, alCambiar)); return; } pintarAtn(); };
  ev.forEach((e) => document.addEventListener(e, alCambiar));
  const atencion = h('section.hoy-sec', h('h2', 'Lo que pide su atención'), cuerpoAtn,
    h('button.btn.suave.hoy-ver-atn', { type: 'button', onclick: abrirAtencion }, 'Ver todo en «Atención»'));

  return h('div.inicio.hoy', h('header.hoy-cab', h('h1', saludo() + (nombre ? ', ' + nombre : '')), h('p.tenue', fecha.charAt(0).toUpperCase() + fecha.slice(1))),
    caja, cifras, h('section.hoy-sec', h('h2', 'Vender'), accesos), atencion);
}
