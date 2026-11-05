// Pantalla del cliente (la que mira el cliente, en la pantalla de la computadora todo en uno).
// Recibe lo que la caja publica por BroadcastChannel('lb-pantalla-cliente') (mismo navegador, mismo origen): ya no hay internet de por medio,
// ni código de emparejamiento, ni canal de Supabase. Mensajes con el esquema del contrato: «estado» y «latido».
// La publicidad se pide con la sesión que la caja ya dejó en este navegador (fx_pantalla_anuncios, solo authenticated) y se guarda en Cache Storage.
// Sin sesión o sin internet: se muestra la publicidad guardada, sin ningún aviso visible; solo una línea discreta en la consola.
import { crearRotador } from './anuncios.js';

const SUPA_URL = 'https://dwlbcbtwdungyrykgahm.supabase.co';
const SUPA_KEY = 'sb_publishable_gUoYvCNka0je2rbNeWPpUA_l26vgQbO'; // la misma clave pública de js/api.js; el acceso real lo controla la sesión
const LLAVE_SESION = 'sb-facturador'; // sesión del facturador (la escribe la caja; esta página solo la lee, nunca la renueva para no pisar su renovación)
const LLAVE_SOC = 'pc-soc';
const NOMBRE_CANAL = 'lb-pantalla-cliente';
const CADUCA_MS = 20000;      // sin «estado» ni «latido» en 20 s: vuelve a la publicidad
let PAGADO_MS = 6000;         // «pagado» dura 6 s (configurable: segundos_pagado)
const ANUNCIOS_CADA_MS = 10 * 60 * 1000;
const RECARGA_MS = 24 * 3600 * 1000;

const $ = (id) => document.getElementById(id);
const aviso = (...a) => { try { console.info('[pantalla cliente]', ...a); } catch { /* nada */ } };
const params = new URLSearchParams(location.search);

/* ---------- Formato (igual que money/money0 del facturador: ₡12 345 o ₡12 345,50) ---------- */
const nf0 = new Intl.NumberFormat('es-CR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nfc = new Intl.NumberFormat('es-CR', { maximumFractionDigits: 3 });
const colones = (n) => { const v = Math.round((Number(n) || 0) * 100) / 100; return '₡' + (Number.isInteger(v) ? nf0 : nf2).format(v); };
const esNum = (x) => typeof x === 'number' && Number.isFinite(x);

const EMPRESAS = { soda: 'Soda La Bomba', pollos: 'Pollos La Bomba' };
const MEDIOS = { efectivo: 'Pago en efectivo', tarjeta: 'Pago con tarjeta', sinpe: 'Pago con SINPE Móvil', mixto: 'Pago combinado' };

/* ---------- Datos del cliente (solo en memoria: nunca a localStorage, Cache Storage, IndexedDB ni consola) ---------- */
let cliente = null;           // cliente ya limpio, o null
const limpioTxt = (x, max) => (x == null ? '' : String(x)).replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
function limpiarCliente(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return null;
  const tipo = /^0[1-6]$/.test(String(c.tipo_id)) ? String(c.tipo_id) : '';
  const id = limpioTxt(c.identificacion, 25).replace(/\s+/g, '');
  const nombre = limpioTxt(c.nombre, 140), comercial = limpioTxt(c.nombre_comercial, 140), personal = limpioTxt(c.nombre_personal, 140);
  const correo = limpioTxt(c.correo, 160).replace(/\s+/g, '');
  if (!id && !nombre && !comercial && !personal && !correo) return null;
  return { tipo, id, nombre, comercial, personal, correo };
}
// Cédula con separadores: física 1-0234-0567, jurídica 3-101-123456, DIMEX 3-4-4 (11) o 4-4-4 (12), NITE 3-3-4; extranjero y no contribuyente, tal cual
function formatoId(tipo, id) {
  if (!/^\d+$/.test(id)) return id;
  const L = id.length;
  if (tipo === '01' && L === 9) return id[0] + '-' + id.slice(1, 5) + '-' + id.slice(5);
  if (tipo === '02' && L === 10) return id[0] + '-' + id.slice(1, 4) + '-' + id.slice(4);
  if (tipo === '03' && L === 11) return id.slice(0, 3) + '-' + id.slice(3, 7) + '-' + id.slice(7);
  if (tipo === '03' && L === 12) return id.slice(0, 4) + '-' + id.slice(4, 8) + '-' + id.slice(8);
  if (tipo === '04' && L === 10) return id.slice(0, 3) + '-' + id.slice(3, 6) + '-' + id.slice(6);
  return id;
}
const ROT_ID = { '01': 'Confirme su cédula', '02': 'Confirme su cédula jurídica', '03': 'Confirme su DIMEX', '04': 'Confirme su NITE' };
const rotId = (tipo) => ROT_ID[tipo] || 'Confirme su identificación';
// Letra que se achica sola hasta caber en su espacio, sin cortar ni abreviar.
// Primero en una línea hasta `minUna`; si aún no cabe, la parte en varias líneas (en puntos naturales) y sigue achicando hasta `minParte`.
// Modo «partido»: el texto sigue completo; solo se permiten saltos de línea (en el correo, después de . @ - _)
function ponParte(el) {
  if (el.classList.contains('parte')) return;
  el.classList.add('parte');
  if (el.classList.contains('cli-cor-v')) { partirCorreo(el); }
}
function quitaParte(el) {
  if (!el.classList.contains('parte')) return;
  el.classList.remove('parte');
  if (el.classList.contains('cli-cor-v')) el.querySelectorAll('.cli-cor-l').forEach((l) => { l.textContent = l.textContent; });
}
function achicar(el, max, minUna, minParte, lineas, siempreParte) {
  quitaParte(el); el.style.fontSize = max + 'rem';
  const una = () => !el.clientWidth || el.scrollWidth <= el.clientWidth + 1;
  const altoOk = () => !el.clientWidth || el.scrollHeight <= (lineas || 1) * parseFloat(getComputedStyle(el).fontSize) * 1.25 + 2;
  let f = max;
  if (!siempreParte) {
    while (!una() && f > minUna) { f = Math.max(minUna, f - Math.max(0.1, f * 0.04)); el.style.fontSize = f + 'rem'; }
    if (una() || !minParte) return f;
    ponParte(el); f = Math.min(f, minUna + 0.4); el.style.fontSize = f + 'rem';
    while (!altoOk() && f > minParte) { f = Math.max(minParte, f - 0.1); el.style.fontSize = f + 'rem'; }
    return f;
  }
  ponParte(el);
  while (!altoOk() && f > minUna) { f = Math.max(minUna, f - Math.max(0.1, f * 0.03)); el.style.fontSize = f + 'rem'; }
  return f;
}
// El correo se escribe completo; solo si hay que partirlo, se parte después de . @ - _ (no cambia el texto)
function ponCorreo(el, t) { vaciar(el); listaCorreos(t).forEach((x) => { const l = document.createElement('span'); l.className = 'cli-cor-l'; l.textContent = x; el.append(l); }); }
// Puede haber varios correos en un solo texto, separados por coma o punto y coma: cada uno va en su línea
function listaCorreos(t) { return String(t).split(/[,;]+/).map((x) => x.trim()).filter(Boolean).slice(0, 5); }
function partirCorreo(el) { el.querySelectorAll('.cli-cor-l').forEach((l) => { const t = l.textContent; vaciar(l); (t.match(/[^.@_-]*[.@_-]?/g) || []).filter(Boolean).forEach((trozo) => { l.append(document.createTextNode(trozo)); l.append(document.createElement('wbr')); }); }); }
const nodo = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
// Pinta el bloque en `host`. modo: 'completo' (cuenta y pago) o 'pagado' (solo el aviso del correo)
function pintarCliente(host, modo, forzar) {
  const c = cliente;
  // Si es el mismo cliente y el mismo tamaño de pantalla, no se vuelve a armar ni a medir (solo cambió otra parte de la cuenta)
  const huella = c ? modo + '|' + document.documentElement.clientWidth + 'x' + document.documentElement.clientHeight + '|' + JSON.stringify(c) : '';
  if (!forzar && c && host._h === huella && !host.hidden) return;
  vaciar(host);
  host._h = '';
  if (!c || (modo === 'pagado' && !c.correo)) { host.hidden = true; return; }
  host._h = huella;
  host.hidden = false;
  if (modo === 'pagado') {
    host.append(nodo('p', 'cli-hint', 'Le enviaremos su factura a:'));
    const v = nodo('p', 'cli-cor-v'); ponCorreo(v, c.correo); host.append(v);
    const varios = v.children.length > 1;
    achicar(v, varios ? 3.8 : 4.6, 3.2, 2.4, 2 * v.children.length); return;
  }
  const nom = c.nombre || c.personal;
  const nombreEl = nom || (c.comercial && c.comercial !== nom) ? nodo('p', 'cli-nom') : null;
  if (nombreEl) {
    nombreEl.append(document.createTextNode(nom || c.comercial));
    if (nom && c.comercial && c.comercial.toLowerCase() !== nom.toLowerCase() && c.tipo !== '01') nombreEl.append(nodo('span', 'cli-com', c.comercial));
    host.append(nombreEl);
  }
  const fila = nodo('div', 'cli-fila');
  let cedV = null, corV = null;
  if (c.id) {
    const col = nodo('div', 'cli-col'); col.append(nodo('p', 'cli-rot', rotId(c.tipo)));
    cedV = nodo('p', 'cli-ced-v', formatoId(c.tipo, c.id)); col.append(cedV); fila.append(col);
  }
  const col2 = nodo('div', 'cli-col');
  if (c.correo) {
    col2.append(nodo('p', 'cli-rot', 'Confirme su correo'), nodo('p', 'cli-hint', 'Le enviaremos su factura a:'));
    corV = nodo('p', 'cli-cor-v'); ponCorreo(corV, c.correo); col2.append(corV);
  } else { col2.classList.add('cli-sin-col'); col2.append(nodo('p', 'cli-sin', 'Sin correo registrado')); }
  fila.append(col2); host.append(fila);
  fitCliente(host);
}
// Medidas del bloque (se repiten al cambiar el tamaño de la pantalla o al cargar la letra)
function fitCliente(host) {
  if (host.hidden) return;
  const nom = host.querySelector('.cli-nom'), ced = host.querySelector('.cli-ced-v'), cor = host.querySelector('.cli-cor-v'), fila = host.querySelector('.cli-fila');
  const tam = (v) => { const t = getComputedStyle(host).getPropertyValue(v).trim(); return parseFloat(t) || 0; };
  if (nom) achicar(nom, tam('--sz-nom'), 2.6, 0, host.querySelector('.cli-com') ? 3.4 : 2, true);
  fila.classList.remove('ancho');
  if (ced) achicar(ced, tam('--sz-ced'), 3, 0);
  if (cor) {
    const szc = tam('--sz-cor') * (cor.children.length > 1 ? 0.8 : 1);
    const f = achicar(cor, szc, 3.2, 0);
    const sobra = cor.scrollWidth > cor.clientWidth + 1;
    // si en media fila queda muy chico, el correo pasa a una fila propia con todo el ancho; y si aun así no cabe en una línea, se parte
    if (f < szc * 0.72 || sobra) {
      if (getComputedStyle(fila).gridTemplateColumns.split(' ').length > 1) { fila.classList.add('ancho'); if (ced) achicar(ced, tam('--sz-ced'), 3, 0); }
      achicar(cor, szc, 3.2, 2.4, 2 * cor.children.length);
    }
  }
}
// El bloque solo existe en la vista que se está mostrando; las otras quedan vacías
const HOSTS = { cuenta: ['cu-cli', 'completo'], pago: ['pg-cli', 'completo'], pagado: ['pd-cli', 'pagado'] };
function vaciarOtros(vistaActual) {
  Object.keys(HOSTS).forEach((k) => { if (k === vistaActual) return; const e = $(HOSTS[k][0]); if (e.childNodes.length || !e.hidden) { vaciar(e); e.hidden = true; e._h = ''; } });
  $('v-pago').classList.toggle('con-cli', vistaActual === 'pago' && !$('pg-cli').hidden); $('v-pagado').classList.toggle('con-cli', vistaActual === 'pagado' && !$('pd-cli').hidden);
}
function repintarCliente() {
  const h = HOSTS[vista]; if (!h) return;
  pintarCliente($(h[0]), h[1], true); vaciarOtros(vista);
}
function borrarCliente() {
  cliente = null;
  ['cu-cli', 'pg-cli', 'pd-cli'].forEach((id) => { const e = $(id); vaciar(e); e.hidden = true; e._h = ''; });
  $('v-pago').classList.remove('con-cli'); $('v-pagado').classList.remove('con-cli');
}

/* ---------- Vistas ---------- */
let vista = '';
function ir(v) {
  if (v === vista) return;
  vista = v;
  if (v === 'espera') borrarCliente();
  firmaPintada = '';
  document.body.dataset.vista = v;
  rotador.activar(v === 'espera' || (v === 'cuenta' && document.body.dataset.pubCuenta !== 'no'));
}
// Letra del monto: si no cabe en su espacio, se achica sola (el CSS multiplica el tamaño por --ajuste)
function ajustar(el, ancho) {
  el.style.setProperty('--ajuste', '1');
  const w = el.scrollWidth;
  if (w > ancho && w > 0) el.style.setProperty('--ajuste', String(Math.max(0.3, ancho / w - 0.01)));
}
function ajustarTotalCuenta() {
  const t = $('cu-total'), pie = t.closest('.cu-pie'), sub = $('cu-sub');
  const horizontal = getComputedStyle(pie).flexDirection === 'row';
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
  ajustar(t, pie.clientWidth - (horizontal ? sub.offsetWidth + 4 * rem : 0));
}

const vaciar = (el) => { while (el.firstChild) el.removeChild(el.firstChild); };
function texto(id, t) { const e = $(id); if (e.textContent !== t) e.textContent = t; return e; }

function pintarCuenta(s) {
  texto('cu-emp', EMPRESAS[s.empresa] || '');
  cliente = s.cliente; pintarCliente($('cu-cli'), 'completo'); vaciarOtros('cuenta');
  const lista = $('cu-lista');
  vaciar(lista);
  const filas = s.lineas.map((l) => {
    const f = document.createElement('div'); f.className = 'cu-fila';
    const c = document.createElement('span'); c.className = 'cu-cant'; c.textContent = nfc.format(l.cant) + ' ×';
    const n = document.createElement('span'); n.className = 'cu-nombre'; n.textContent = l.nombre;
    if (l.desc_pct > 0) { const d = document.createElement('span'); d.className = 'cu-desc'; d.textContent = 'Descuento ' + nfc.format(l.desc_pct) + ' %'; n.append(d); }
    const t = document.createElement('span'); t.className = 'cu-imp monto'; t.textContent = colones(l.total);
    f.append(c, n, t); return f;
  });
  // Pie: subtotal, descuento, IVA y total
  const sub = $('cu-sub'); vaciar(sub);
  const par = (rot, val, clase) => { const dt = document.createElement('dt'); dt.textContent = rot; const dd = document.createElement('dd'); dd.className = 'monto'; dd.textContent = val; if (clase) { dt.className = clase; dd.className += ' ' + clase; } sub.append(dt, dd); };
  if (s.descuento > 0) { par('Subtotal', colones(s.subtotal)); par('Descuento', '−' + colones(s.descuento), 'neg'); }
  if (s.iva > 0) par('IVA incluido', colones(s.iva));
  texto('cu-total', colones(s.total));
  // Cabida: baja el tamaño en pasos; si aún así no cabe, las líneas más viejas se resumen en una sola
  lista.dataset.n = '0';
  let ocultas = 0;
  const poner = () => { vaciar(lista); if (ocultas > 0) lista.append(resumen(ocultas)); filas.slice(ocultas).forEach((f) => lista.append(f)); };
  const resumen = (k) => {
    const f = document.createElement('div'); f.className = 'cu-fila cu-previas';
    const c = document.createElement('span'); c.className = 'cu-cant'; c.textContent = '';
    const n = document.createElement('span'); n.className = 'cu-nombre';
    const suma = s.lineas.slice(0, k).reduce((a, l) => a + (l.desc_pct > 0 ? l.total * (1 - l.desc_pct / 100) : l.total), 0);
    n.textContent = (k === 1 ? '1 producto anterior' : k + ' productos anteriores');
    const t = document.createElement('span'); t.className = 'cu-imp monto'; t.textContent = colones(suma);
    f.append(c, n, t); return f;
  };
  const cabe = () => lista.scrollHeight <= lista.clientHeight + 1;
  poner();
  for (let nivel = 0; nivel <= 3 && !cabe(); nivel++) { lista.dataset.n = String(nivel); poner(); }
  if (!cabe()) {
    // búsqueda binaria de cuántas líneas viejas se resumen (pocas pasadas de medición en equipos modestos)
    let lo = 1, hi = filas.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; ocultas = mid; poner(); if (cabe()) hi = mid; else lo = mid + 1; }
    ocultas = Math.max(1, Math.min(filas.length - 1, lo)); poner();
  }
  // el resumen reemplaza una fila: si por él aún no cabe, se oculta una más
  ajustarTotalCuenta();
}

function pintarPago(s) {
  cliente = s.cliente; pintarCliente($('pg-cli'), 'completo'); vaciarOtros('pago');
  texto('pg-rotulo', 'Total a pagar');
  const t = texto('pg-total', colones(s.total));
  texto('pg-medio', MEDIOS[s.medio] || '');
  // ajustar después de mostrar la vista (medición necesita que sea visible)
  requestAnimationFrame(() => ajustar(t, $('v-pago').clientWidth * 0.88));
}

function pintarPagado(s) {
  if (s.cliente) cliente = s.cliente;  // si la caja no lo manda en «pagado», se usa el de la cuenta (solo en memoria)
  pintarCliente($('pd-cli'), 'pagado'); vaciarOtros('pagado');
  const t = texto('pd-total', colones(s.total));
  const det = $('pd-det'); vaciar(det);
  const par = (rot, val) => { const dt = document.createElement('dt'); dt.textContent = rot; const dd = document.createElement('dd'); dd.className = 'monto'; dd.textContent = val; det.append(dt, dd); };
  if (esNum(s.recibido) && s.recibido > 0) par('Recibido', colones(s.recibido));
  else if (MEDIOS[s.medio]) par('Forma de pago', MEDIOS[s.medio].replace(/^Pago (en |con )?/, '').replace(/^./, (c) => c.toUpperCase()));
  const hayVuelto = esNum(s.vuelto) && s.vuelto > 0;
  $('v-pagado').classList.toggle('sin-vuelto', !hayVuelto);
  $('pd-vuelto-r').hidden = !hayVuelto; $('pd-vuelto').hidden = !hayVuelto;
  const v = $('pd-vuelto');
  if (hayVuelto) v.textContent = colones(s.vuelto);
  requestAnimationFrame(() => { const w = $('v-pagado').clientWidth; ajustar(t, w * 0.88); if (hayVuelto) ajustar(v, w * 0.88 - 0); });
}

/* ---------- Estado recibido ---------- */
let ultimaRecepcion = 0, ultimoTs = 0, timerPagado = 0, pagadoTs = 0, pagadoActivo = false;
let soc = '';
try { soc = params.get('soc') || localStorage.getItem(LLAVE_SOC) || ''; } catch { /* nada */ }

function limpiar(m) {
  if (!m || typeof m !== 'object') return null;
  const est = m.estado;
  if (!['espera', 'cuenta', 'pago', 'pagado'].includes(est)) return null;
  const lineas = Array.isArray(m.lineas) ? m.lineas.filter((l) => l && typeof l === 'object').map((l) => ({
    nombre: String(l.nombre == null ? '' : l.nombre).slice(0, 140),
    cant: esNum(Number(l.cant)) ? Number(l.cant) : 1,
    total: esNum(Number(l.total)) ? Number(l.total) : 0,
    desc_pct: esNum(Number(l.desc_pct)) && Number(l.desc_pct) > 0 ? Number(l.desc_pct) : 0,
  })) : [];
  const n = (x) => (esNum(Number(x)) && x !== null && x !== '' ? Number(x) : null);
  return {
    estado: est, empresa: m.empresa === 'soda' ? 'soda' : m.empresa === 'pollos' ? 'pollos' : '',
    lineas, subtotal: n(m.subtotal) ?? lineas.reduce((a, l) => a + l.total, 0), descuento: n(m.descuento) || 0, iva: n(m.iva) || 0,
    total: n(m.total) ?? 0, medio: ['efectivo', 'tarjeta', 'sinpe', 'mixto'].includes(m.medio) ? m.medio : null,
    recibido: n(m.recibido), vuelto: n(m.vuelto), ts: n(m.ts) ?? Date.now(),
    cliente: est === 'cuenta' || est === 'pago' || est === 'pagado' ? limpiarCliente(m.cliente) : null,
  };
}

let firmaPintada = '';
const firmaDe = (s) => JSON.stringify([s.estado, s.empresa, s.lineas, s.subtotal, s.descuento, s.iva, s.total, s.medio, s.cliente]);
function aplicar(s) {
  if (s.ts && s.ts < ultimoTs) return;           // un mensaje viejo llegado tarde no pisa a uno más nuevo
  const anteriorTs = ultimoTs; ultimoTs = Math.max(ultimoTs, s.ts || 0);
  if (pagadoActivo && s.estado === 'espera') return; // «pagado» se muestra sus 6 s completos
  if (s.estado === 'pagado') {
    if (s.ts === pagadoTs && s.ts === anteriorTs) return; // el mismo cobro repetido no reinicia los 6 s
    pagadoTs = s.ts; pagadoActivo = true;
    pintarPagado(s); ir('pagado');
    clearTimeout(timerPagado);
    timerPagado = setTimeout(() => { pagadoActivo = false; if (vista === 'pagado') ir('espera'); }, PAGADO_MS);
    return;
  }
  clearTimeout(timerPagado); pagadoActivo = false;
  // Sin repintar cuando el mensaje repite lo que ya se ve (solo se actualiza lo que cambia)
  const firma = firmaDe(s);
  if ((s.estado === 'cuenta' || s.estado === 'pago') && vista === s.estado && firma === firmaPintada) return;
  if (s.estado === 'cuenta' && s.lineas.length) { ir('cuenta'); pintarCuenta(s); firmaPintada = firma; return; }
  if (s.estado === 'pago') { ir('pago'); pintarPago(s); firmaPintada = firma; return; }
  ir('espera');
}

let canalCaja = null;
function enviar(m) { try { if (canalCaja) canalCaja.postMessage(m); else localStorage.setItem('lb-pantalla-cliente-resp', JSON.stringify(m)); } catch { /* nada */ } }

function recibir(d) {
  if (!d || typeof d !== 'object') return;
  const ev = d.evento || d.event || d.tipo || d.type || '';
  const carga = (d.payload && typeof d.payload === 'object') ? d.payload : (d.datos && typeof d.datos === 'object') ? d.datos : d;
  if (carga && Number.isInteger(carga.terminal) && carga.terminal > 0) terminal = carga.terminal;
  if (carga && typeof carga.soc === 'string' && /^[0-9a-f-]{36}$/i.test(carga.soc) && carga.soc !== soc) {
    soc = carga.soc; try { localStorage.setItem(LLAVE_SOC, soc); } catch { /* nada */ }
    pedirAnuncios();
  }
  const esEstado = ev === 'estado' || (!ev && carga.estado);
  const esLatido = ev === 'latido' || (!ev && !carga.estado && 'ts' in carga);
  if (esLatido) { ultimaRecepcion = Date.now(); enviar({ evento: 'ack', payload: { ts: esNum(Number(carga.ts)) ? Number(carga.ts) : Date.now() } }); return; }
  if (!esEstado) return;
  const s = limpiar(carga);
  if (!s) return;
  ultimaRecepcion = Date.now();
  aplicar(s);
}

/* ---------- Publicidad ---------- */
const rotador = crearRotador({ escena: $('anuncios'), capaA: $('an-a'), capaB: $('an-b') });

function tokenDeSesion() {
  try {
    const g = JSON.parse(localStorage.getItem(LLAVE_SESION) || 'null');
    const t = g && g.access_token;
    if (typeof t !== 'string') return '';
    const exp = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp;
    return exp * 1000 > Date.now() + 15000 ? t : '';
  } catch { return ''; }
}

let terminal = parseInt(params.get('terminal') || '1', 10) || 1;
async function pedirConfig() {
  const t = tokenDeSesion();
  if (!soc || !t || params.get('demo')) return;
  try {
    const r = await fetch(SUPA_URL + '/rest/v1/rpc/fx_pantalla_config_leer', { method: 'POST', cache: 'no-store', credentials: 'omit',
      headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_soc: soc, p_terminal: terminal }) });
    if (!r.ok) return;
    let c = await r.json(); if (Array.isArray(c)) c = c[0];
    if (!c || typeof c !== 'object') return;
    document.body.dataset.pubCuenta = c.publicidad_en_cuenta === false ? 'no' : 'si';
    const sp = Number(c.segundos_pagado); if (Number.isFinite(sp) && sp >= 2 && sp <= 30) PAGADO_MS = sp * 1000;
  } catch { /* se queda con lo de siempre */ }
}

let pidiendo = false;
async function pedirAnuncios() {
  if (pidiendo || params.get('demo')) return;
  if (!soc) { aviso('sin sociedad conocida todavía; se usa la publicidad guardada'); return; }
  const t = tokenDeSesion();
  if (!t) { aviso('sin sesión vigente; se usa la publicidad guardada'); return; }
  pidiendo = true;
  try {
    const r = await fetch(SUPA_URL + '/rest/v1/rpc/fx_pantalla_anuncios', {
      method: 'POST', cache: 'no-store', credentials: 'omit',
      headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_soc: soc }),
    });
    if (!r.ok) throw new Error('http ' + r.status);
    let lista = await r.json();
    if (lista && !Array.isArray(lista) && Array.isArray(lista.anuncios)) lista = lista.anuncios;
    await rotador.sincronizar(lista);
    pedirConfig();
  } catch (e) { aviso('no se pudo actualizar la publicidad, sigue la guardada:', e && e.message); }
  finally { pidiendo = false; }
}

/* ---------- Vista previa sin caja: ?demo=cuenta|pago|pagado|espera|todo ---------- */

const CLIENTES_DEMO = {
  fisica: { tipo_id: '01', identificacion: '102340567', nombre: 'MARÍA JOSÉ NÚÑEZ ÁLVAREZ', nombre_comercial: null, nombre_personal: null, correo: 'maria.nunez@gmail.com' },
  juridica: { tipo_id: '02', identificacion: '3101123456', nombre: 'INVERSIONES DEL PACÍFICO SOCIEDAD ANÓNIMA', nombre_comercial: 'Restaurante La Esquina del Sabor', nombre_personal: null, correo: 'contabilidad@esquinadelsabor.co.cr' },
  dimex: { tipo_id: '03', identificacion: '155812345678', nombre: 'JOHN ALEXANDER SMITH', nombre_comercial: null, nombre_personal: null, correo: 'john.smith@outlook.com' },
  nite: { tipo_id: '04', identificacion: '6000001234', nombre: 'ANA LUCÍA PEÑA', nombre_comercial: null, nombre_personal: null, correo: 'ana.pena@correo.cr' },
  extranjero: { tipo_id: '05', identificacion: 'X1234567', nombre: 'HANS MÜLLER', nombre_comercial: null, nombre_personal: null, correo: 'hans@example.de' },
  sincorreo: { tipo_id: '01', identificacion: '304560789', nombre: 'LUIS DIEGO ARAYA MORA', nombre_comercial: null, nombre_personal: null, correo: null },
  varios: { tipo_id: '02', identificacion: '3101555666', nombre: 'COMERCIAL ALFA SOCIEDAD ANÓNIMA', nombre_comercial: null, nombre_personal: null, correo: 'ventas@comercial-alfa.co.cr, contabilidad@comercial-alfa.co.cr, gerencia@comercial-alfa.co.cr' },
  confusos: { tipo_id: '01', identificacion: '101110111', nombre: 'ÓSCAR ILLESCAS LLOBERA', nombre_comercial: null, nombre_personal: null, correo: 'Il1O0.l1Il_oO0@mail.com' },
  largo: { tipo_id: '02', identificacion: '3101987654', nombre: 'CORPORACIÓN INTERNACIONAL DE ALIMENTOS Y BEBIDAS DE CENTROAMÉRICA SOCIEDAD ANÓNIMA', nombre_comercial: 'Distribuidora Mayorista de Productos Alimenticios y Bebidas Refrigeradas del Valle Central', nombre_personal: null, correo: 'departamento.de.compras.y.proveedores.facturacion.electronica@corporacion-internacional-de-alimentos-y-bebidas.co.cr' },
};
function muestra(estado) {
  const n = Math.min(60, Math.max(1, parseInt(params.get('lineas') || (estado === 'cuenta' ? '5' : '3'), 10) || 5));
  const base = [['Casado con pollo', 2, 7500, 0], ['Gallo pinto con huevo', 1, 2800, 0], ['Fresco natural', 2, 2400, 0], ['Pollo frito, combo familiar con papas', 1, 9800, 10], ['Tortilla palmeada', 3, 2100, 0]];
  const lineas = []; for (let i = 0; i < n; i++) { const b = base[i % base.length]; lineas.push({ nombre: params.get('largo') && i === 0 ? 'Combo especial de pollo frito crujiente con papas, ensalada de repollo, tortillas y fresco natural de mora en leche' : b[0], cant: b[1], total: b[2], desc_pct: b[3] }); }
  const subtotal = lineas.reduce((a, l) => a + l.total, 0);
  const descuento = lineas.reduce((a, l) => a + l.total * l.desc_pct / 100, 0);
  const total = Math.round((subtotal - descuento) * 100) / 100;
  const iva = Math.round(total * 13 / 113 * 100) / 100;
  const efectivo = params.get('medio') ? params.get('medio') === 'efectivo' : true;
  const recibido = efectivo ? Math.ceil(total / 1000) * 1000 + 5000 : null;
  return { v: 1, estado, empresa: params.get('empresa') === 'pollos' ? 'pollos' : 'soda', lineas: estado === 'espera' ? [] : lineas, subtotal, descuento, iva, total,
    medio: estado === 'cuenta' || estado === 'espera' ? null : (efectivo ? 'efectivo' : params.get('medio')), recibido: estado === 'pagado' ? recibido : null,
    vuelto: estado === 'pagado' && efectivo && params.get('vuelto') !== '0' ? recibido - total : null, ts: Date.now(),
    cliente: estado !== 'espera' && CLIENTES_DEMO[params.get('cliente')] ? CLIENTES_DEMO[params.get('cliente')] : null };
}

function demo(modo) {
  const url = (f) => new URL('../img/' + f, location.href).href;
  rotador.sincronizar([{ id: 'demo-soda', tipo: 'imagen', url: url('logo-soda.svg'), segundos: 6, orden: 1 }, { id: 'demo-pollos', tipo: 'imagen', url: url('logo-pollos.svg'), segundos: 6, orden: 2 }], { soloMostrar: true });
  const mostrar = (e) => { pagadoActivo = false; ultimoTs = 0; ultimaRecepcion = Date.now(); aplicar(limpiar(muestra(e))); };
  if (modo === 'todo') {
    const ciclo = ['espera', 'cuenta', 'pago', 'pagado']; let i = 0;
    const paso = () => { mostrar(ciclo[i++ % 4]); };
    paso(); setInterval(() => { clearTimeout(timerPagado); pagadoActivo = false; paso(); }, 7000);
  } else {
    mostrar(['espera', 'cuenta', 'pago', 'pagado'].includes(modo) ? modo : 'espera');
    if (modo === 'pagado') { clearTimeout(timerPagado); pagadoActivo = false; } // en la vista previa no vuelve solo
    setInterval(() => { ultimaRecepcion = Date.now(); }, 5000);
  }
}

/* ---------- Arranque ---------- */
ir('espera');
const modoDemo = params.get('demo');
if (modoDemo) demo(modoDemo);
else {
  rotador.cargarGuardados().then(() => pedirAnuncios());
  // BroadcastChannel (Chrome, Edge, Safari 15.4 o más). Alternativa si falta: la caja escribe el mensaje JSON en localStorage['lb-pantalla-cliente-msg'] y aquí se oye el evento «storage».
  const entrada = (e) => { try { recibir(e.data); } catch (err) { aviso('mensaje ignorado:', err && err.message); } };
  if (typeof BroadcastChannel === 'function') {
    try {
      const ch = new BroadcastChannel(NOMBRE_CANAL);
      ch.onmessage = entrada;
      canalCaja = ch;
      ch.postMessage({ evento: 'hola', payload: { ts: Date.now() } }); // la caja reenvía el estado vigente y marca esta pantalla como abierta
    } catch (e) { aviso('BroadcastChannel no disponible'); }
  } else {
    aviso('sin BroadcastChannel: se usa localStorage');
    addEventListener('storage', (e) => { if (e.key === 'lb-pantalla-cliente-msg' && e.newValue) { try { recibir(JSON.parse(e.newValue)); } catch { /* nada */ } } });
  }
  setInterval(pedirAnuncios, ANUNCIOS_CADA_MS);
  addEventListener('storage', (e) => { if (e.key === LLAVE_SESION) pedirAnuncios(); });
  addEventListener('online', pedirAnuncios);
  // Caducidad: si la caja deja de dar señales, el cliente vuelve a ver publicidad
  setInterval(() => {
    if (vista !== 'espera' && Date.now() - ultimaRecepcion > CADUCA_MS) { clearTimeout(timerPagado); pagadoActivo = false; ir('espera'); }
  }, 1000);
}

// Pantalla siempre encendida, sin menú contextual ni arrastres, y recarga diaria en la publicidad para no acumular memoria
try { navigator.wakeLock && navigator.wakeLock.request('screen').catch(() => {}); } catch { /* nada */ }
document.addEventListener('visibilitychange', () => { rotador.pausar(document.hidden); if (!document.hidden) { try { navigator.wakeLock && navigator.wakeLock.request('screen').catch(() => {}); } catch { /* nada */ } } });
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('dragstart', (e) => e.preventDefault());
addEventListener('resize', () => { if (cliente) { repintarCliente(); } if (vista === 'cuenta') ajustarTotalCuenta(); });
try { document.fonts && document.fonts.addEventListener && document.fonts.addEventListener('loadingdone', () => { if (cliente) repintarCliente(); }); document.fonts && document.fonts.load && document.fonts.load('700 1em "Atkinson Hyperlegible"').catch(() => {}); } catch { /* nada */ }
const inicio = Date.now();
setInterval(() => { if (!modoDemo && vista === 'espera' && Date.now() - inicio > RECARGA_MS) location.reload(); }, 60000);

if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js', { scope: './' }).catch((e) => aviso('sin service worker:', e && e.message));
