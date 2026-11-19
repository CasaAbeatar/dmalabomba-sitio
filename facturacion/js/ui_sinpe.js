// Lista de consulta «SINPE Móvil recibidos» (caja, Express y administración).
// Decisión de Emil (17 nov 2026, Libro: pagos.sinpe_movil.alcance_simple): es solo una lista para mirar. Un cliente dice «ya pagué», la cajera busca aquí
// quién, a qué hora, cuánto y el detalle, tal como vienen en el SMS, y sigue con el cobro. NADA se ata al SINPE: el cobro, el pedido Express y el cierre
// nunca dependen de esta lista. Opcional: tocar un SINPE pone su comprobante en el cobro (fact.pagos.referencia) y lo marca «Ya lo usé».
import { h, money, horaCorta, textoDeError } from './util.js';
import { sinpe as apiSinpe } from './api_sinpe.js';

const CSS_SINPE = new URL('../css/sinpe.css', import.meta.url).href;
export function cargarCssSinpe() {
  return new Promise((ok) => {
    if (document.getElementById('css-sinpe')) return ok();
    const l = h('link', { id: 'css-sinpe', rel: 'stylesheet', href: CSS_SINPE });
    l.onload = l.onerror = () => ok();
    document.head.append(l);
    setTimeout(ok, 1500);
  });
}
const TZ = 'America/Costa_Rica';
const horaConSegundos = (d) => new Intl.DateTimeFormat('es-CR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(d));
const diaCR = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(d));
const quitarTildes = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch { return []; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento: la marca queda solo mientras la pantalla está abierta */ } };

export function textoUltimoAviso(r) {
  if (!r || !r.ultimo_aviso) return 'Todavía no se ha recibido ningún aviso del banco.';
  const mismoDia = diaCR(r.ultimo_aviso) === diaCR(r.ahora || Date.now());
  return 'Último aviso del banco recibido: ' + horaCorta(r.ultimo_aviso) + (mismoDia ? '' : ' (de otro día)');
}
// Coincide con el nombre, el detalle o el comprobante; o con el monto si lo escrito son números (5000, 5.000 o 5 000)
export function coincide(p, consulta) {
  const q = quitarTildes(consulta).trim();
  if (!q) return true;
  const digitos = q.replace(/[\s.,₡]/g, '');
  if (/^\d+$/.test(digitos)) {
    const entero = String(Math.round(Number(p.monto) || 0));
    if (entero.includes(digitos) || (p.comprobante || '').includes(digitos)) return true;
  }
  return [p.pagador, p.telefono, p.detalle, p.comprobante].some((t) => quitarTildes(t).includes(q));
}
export function nombreDia(d, ahora) {
  const hoy = diaCR(ahora || Date.now()), ayer = diaCR(new Date(new Date(ahora || Date.now()) - 864e5));
  const x = diaCR(d);
  if (x === hoy) return 'Hoy';
  if (x === ayer) return 'Ayer';
  return new Intl.DateTimeFormat('es-CR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(d));
}

// opciones: soc (id de la empresa), empresa ('soda'|'pollos'), alEscoger(pago) (si existe, cada SINPE se puede escoger para el cobro), alQuitar(pago),
// ventaId / ventaNumero (a qué venta queda ligado un SINPE escogido: «Usado en la venta N»), api, intervaloMs
export function listaSinpe({ soc, empresa = 'soda', alEscoger = null, alQuitar = null, ventaId = null, ventaNumero = '', api = apiSinpe, intervaloMs = 6000, titulo = 'SINPE Móvil recibidos', alCargar = null } = {}) {
  cargarCssSinpe();
  const raiz = h('section.sinpe-lista-caja', { dataset: { emp: empresa }, 'aria-label': titulo });
  let r = null, falla = '', cargando = false, muerto = false, consulta = '', timer = null, ultimoUsado = null, manualActiva = false, repetir = false, actualizadoEn = null;
  const clave = 'fx_sinpe_usados_' + (soc || '');
  const locales = new Map(lsGet(clave)); // id -> número de la venta donde se usó (respaldo en este equipo si la base no responde)
  const buscador = h('input.campo', { type: 'search', 'aria-label': 'Buscar por nombre o monto', placeholder: 'Nombre o monto', autocomplete: 'off', maxlength: 60, value: '' });
  buscador.addEventListener('input', () => { consulta = buscador.value; pintarFilas(); });
  const cuerpo = h('div.sinpe-filas', { role: 'list' });
  const ultimo = h('span.sinpe-ultimo', { role: 'status' }, 'Buscando los avisos del banco…');
  const actualizado = h('span.sinpe-act', { role: 'status' }, '');
  const btnActualizar = h('button.btn.sinpe-refrescar', { type: 'button', onclick: () => cargar(true) }, 'Refrescar');
  const aviso = h('div.sinpe-aviso', { hidden: true, role: 'status' });
  raiz.append(
    h('div.sinpe-banda', h('span', titulo), h('span.sinpe-hoy', 'Más reciente primero')),
    h('div.sinpe-barra', h('div.sinpe-barra-txt', ultimo, actualizado), btnActualizar),
    h('div.sinpe-buscar', buscador),
    aviso, cuerpo);

  const usado = (p) => !!p.usado || locales.has(p.id);
  const ventaDe = (p) => p.usado_venta || locales.get(p.id) || '';
  function pintarFilas() {
    if (muerto) return;
    ultimo.textContent = r ? textoUltimoAviso(r) : (falla ? 'No se pudo consultar el banco ahora.' : 'Buscando los avisos del banco…');
    btnActualizar.disabled = cargando && manualActiva; btnActualizar.textContent = cargando && manualActiva ? 'Actualizando…' : 'Refrescar';
    actualizado.textContent = cargando && manualActiva ? 'Actualizando…' : (actualizadoEn ? 'Actualizado a las ' + horaConSegundos(actualizadoEn) : '');
    aviso.hidden = !falla; aviso.textContent = falla ? falla + ' Se puede tocar «Refrescar» para intentar otra vez; el cobro no depende de esta lista.' : '';
    if (!r) { cuerpo.replaceChildren(h('p.sinpe-vacio', falla ? '' : 'Cargando los SINPE Móvil recibidos…')); return; }
    const todos = [...(r.pagos || [])].sort((a, b) => new Date(b.hora) - new Date(a.hora));
    const lista = todos.filter((p) => coincide(p, consulta));
    if (!lista.length) { cuerpo.replaceChildren(h('p.sinpe-vacio', todos.length ? 'Ningún SINPE coincide con «' + consulta.trim() + '». Podría no haber llegado el aviso todavía.' : 'Todavía no hay SINPE Móvil recibidos en estos días.')); return; }
    const nodos = []; let dia = null;
    for (const p of lista) {
      const d = diaCR(p.hora);
      if (d !== dia) { dia = d; nodos.push(h('h3.sinpe-dia', nombreDia(p.hora, r.ahora))); }
      nodos.push(fila(p));
    }
    cuerpo.replaceChildren(...nodos);
  }
  function fila(p) {
    const u = usado(p);
    const nombre = p.pagador || 'Sin nombre en el aviso';
    const sub = [p.telefono, p.detalle].filter(Boolean).join(' · ');
    const izq = h('div.sinpe-izq', h('strong.sinpe-nombre', nombre), h('small', sub || 'Sin detalle en el aviso'));
    const der = h('div.sinpe-der', h('strong.sinpe-monto', money(p.monto)), h('small', horaCorta(p.hora) + (p.comprobante ? ' · comprobante ' + p.comprobante : ' · sin comprobante')));
    const marca = u ? h('span.sinpe-chip.neutro', '● ' + (ventaDe(p) ? 'Usado en la venta ' + ventaDe(p) : 'Ya lo usé') + (p.usado_por ? ' (' + p.usado_por + ')' : '')) : null;
    const accion = alEscoger
      ? (u
        ? h('button.btn.chico', { type: 'button', 'aria-label': 'Quitar la marca del SINPE de ' + nombre, onclick: (e) => { e.stopPropagation(); quitar(p); } }, 'Quitar')
        : h('button.btn.chico.primario', { type: 'button', 'aria-label': 'Escoger el SINPE de ' + nombre + ' por ' + money(p.monto), onclick: () => escoger(p) }, 'Escoger este SINPE'))
      : null;
    return h('div.sinpe-fila' + (u ? '.usado' : '') + (p.prueba ? '.prueba' : ''), { role: 'listitem', dataset: { id: p.id } }, izq, der, marca || h('span'), accion || h('span'));
  }
  async function marcar(p, valor) {
    if (valor) locales.set(p.id, ventaNumero || ''); else locales.delete(p.id);
    lsSet(clave, [...locales].slice(-200));
    p.usado = valor; p.usado_venta = valor ? (ventaNumero || null) : null; if (!valor) p.usado_por = null;
    pintarFilas();
    try { await api.usar(p.id, valor, valor ? ventaId : null); } catch { /* la marca ya quedó en este equipo; si la base no responde, no pasa nada */ }
  }
  function escoger(p) { ultimoUsado = p; marcar(p, true); try { alEscoger?.(p); } catch { /* el cobro sigue igual */ } }
  function quitar(p) { if (ultimoUsado && ultimoUsado.id === p.id) ultimoUsado = null; marcar(p, false); try { alQuitar?.(p); } catch { /* nada */ } }
  async function cargar(manual = false) {
    if (muerto) return;
    if (cargando) { if (manual) { repetir = true; manualActiva = true; pintarFilas(); } return; } // un toque en «Refrescar» durante un refresco automático pide otra consulta al terminar
    cargando = true; manualActiva = manual; if (manual) pintarFilas();
    try { const x = await api.lista(soc); if (muerto) return; if (x && x.activa !== false) { r = x; actualizadoEn = Date.now(); try { alCargar?.(x); } catch { /* nada */ } } falla = ''; }
    catch (e) { falla = 'No se pudieron consultar los SINPE Móvil (' + textoDeError(e) + ').'; }
    cargando = false; manualActiva = false; pintarFilas();
    if (repetir && !muerto) { repetir = false; cargar(true); }
  }
  const alVolver = () => { if (!document.hidden) cargar(); };
  document.addEventListener('visibilitychange', alVolver);
  timer = setInterval(() => { if (!document.hidden) cargar(); }, intervaloMs);
  pintarFilas(); cargar();
  return {
    el: raiz, recargar: () => cargar(true), ultimoEscogido: () => ultimoUsado, quitar,
    destruir() { muerto = true; clearInterval(timer); document.removeEventListener('visibilitychange', alVolver); },
  };
}

// Bloque del cobro con SINPE Móvil. Decisión de Emil (17 nov 2026, 21:17 CR): un solo paso. Al elegir SINPE Móvil la lista de recibidos ya está a la vista, en línea bajo el medio de pago
// (sin botón intermedio), con filtro, «Refrescar» y «Escoger este SINPE» en cada fila. Al escoger uno se llena el comprobante, se muestra el resumen con «Quitar» y la lista se recoge.
// Quitar la elección vuelve a mostrar la lista. Escoger es opcional: «Cobrar» nunca depende de esto (la diferencia de monto es solo informativa).
export function escogerSinpe({ soc, empresa = 'soda', ventaId, ventaNumero = '', total = 0, alCambiar = () => {}, api = apiSinpe } = {}) {
  cargarCssSinpe();
  const raiz = h('section.sinpe-escoger', { dataset: { emp: empresa }, 'aria-label': 'SINPE Móvil' });
  let elegido = null, lista = null, conservado = false, muerto = false;
  const nota = h('p.sinpe-nota', 'Es opcional: también se puede cobrar con SINPE Móvil sin escoger uno de la lista.');
  const hueco = h('div.sinpe-hueco');
  const tarjeta = h('div.sinpe-elegido', { hidden: true, role: 'status' });
  raiz.append(tarjeta, hueco, nota);
  const diferencia = (p) => {
    const d = Math.round((Number(p.monto) - Number(total)) * 100) / 100;
    if (d === 0) return 'El monto del SINPE coincide con el cobro.';
    return 'El SINPE es ' + money(Math.abs(d)) + (d > 0 ? ' mayor' : ' menor') + ' que el cobro. Es solo informativo: el cobro no se detiene.';
  };
  function pintarElegido() {
    tarjeta.hidden = !elegido;
    if (!elegido) { tarjeta.replaceChildren(); return; }
    const p = elegido;
    tarjeta.replaceChildren(
      h('div.sinpe-elegido-fila', h('div.sinpe-izq', h('strong.sinpe-nombre', p.pagador || 'Sin nombre en el aviso'), h('small', [p.telefono, p.detalle].filter(Boolean).join(' · ') || 'Sin detalle en el aviso')),
        h('div.sinpe-der', h('strong.sinpe-monto', money(p.monto)), h('small', horaCorta(p.hora) + (p.comprobante ? ' · comprobante ' + p.comprobante : ' · sin comprobante')))),
      h('div.sinpe-elegido-pie', h('span.sinpe-chip.neutro', '● Usado en la venta ' + (ventaNumero || '')), h('button.btn.chico', { type: 'button', onclick: () => quitar() }, 'Quitar')),
      h('p.sinpe-nota', diferencia(p)));
  }
  function mostrarLista() {
    if (lista || muerto || elegido) return;
    lista = listaSinpe({ soc, empresa, ventaId, ventaNumero, api,
      alEscoger: (p) => { elegido = p; recoger(); pintarElegido(); alCambiar(p); },
      alQuitar: (p) => { if (elegido && elegido.id === p.id) { elegido = null; pintarElegido(); alCambiar(null); mostrarLista(); } } });
    hueco.replaceChildren(lista.el); nota.hidden = false;
  }
  function recoger() { if (lista) { lista.destruir(); lista = null; } hueco.replaceChildren(); nota.hidden = true; }
  function quitar() { const p = elegido; elegido = null; pintarElegido(); if (p) { try { api.usar(p.id, false, null).catch(() => {}); } catch { /* nada */ } const k = 'fx_sinpe_usados_' + (soc || ''); const m = new Map(lsGet(k)); m.delete(p.id); lsSet(k, [...m]); } alCambiar(null); mostrarLista(); }
  mostrarLista();
  return {
    el: raiz, elegido: () => elegido,
    conservar() { conservado = true; }, // el cobro salió: el SINPE queda «Usado en la venta N»
    destruir() { muerto = true; if (elegido && !conservado) quitar(); recoger(); },
  };
}
