// Cascarón del administrador (9 nov 2026): barra lateral de 6 grupos, columna «Requiere atención», barra inferior en el celular y búsqueda «Buscar o ir a…».
// Solo se arma para administradores. La caja (facturar) y la persona de caja no cambian: allí los lados se esconden o ni existen.
// Los permisos NO viven aquí: cada módulo y cada función del servidor (fx_*) los vuelven a exigir.
import { h, modal, toast } from './util.js';
import { cambiarEmpresa } from './api.js';
import { cargarBanderaSinpe } from './api_sinpe.js';
import { listaVerComo } from './ver_como.js';
import { MODULOS, GRUPOS_NAV, grupoNavDe, buscar, insigniaDe, itemsDeGrupo, esDixia, habilitado } from './modulos.js';

const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const visibles = (app) => MODULOS.filter((m) => (m.soloAdmin ? app.admin : true) && habilitado(m));

export function crearShell({ app, raiz, cab, vista, bandas, ir, subir, cambiarPin, cerrarSesion }) {
  document.body.classList.add('fx-admin');
  raiz.classList.add('fx-shell');
  if (esDixia(app)) raiz.classList.add('sin-rail'); // Dixia no ve la columna de alertas (9 nov 2026)
  try { if ((navigator.hardwareConcurrency || 8) <= 2 || (navigator.deviceMemory || 8) <= 2) document.body.classList.add('sin-cristal'); } catch { /* nada */ }

  const modDe = (id) => buscar(id);
  const insigniaTxt = (m) => { const i = insigniaDe(m, app); if (!i) return null; const n = /\d+/.exec(i.texto); return h('span.nv-ins' + (i.urgente ? '.urgente' : ''), { title: i.texto, 'aria-label': i.texto }, n ? n[0] : '!'); };

  /* ---------- Barra lateral ---------- */
  const brand = h('div.nv-marca',
    h('span.nv-logo', { 'aria-hidden': 'true' }, 'DMA'),
    h('span.nv-marca-txt', h('b', 'Grupo DMA-La Bomba')));
  // Empresa en la que se está trabajando: grande y clara (logo + nombre), para quien cambia entre empresas
  const codEmp = String(app.soc?.codigo_acceso || app.soc?.codigo || '').toLowerCase();
  const logoEmp = codEmp === 'soda' ? 'img/logo-soda.svg' : 'img/logo-pollos.svg';
  const empresa = h('div.nv-empresa', { 'data-emp': codEmp === 'soda' ? 'soda' : 'pollos', role: 'status' },
    h('span.nv-emp-logo', h('img', { src: logoEmp, alt: '' })),
    h('span.nv-emp-txt', h('small', 'Está trabajando en'), h('strong', app.soc?.nombre_comercial || app.soc?.nombre || '')));
  const nav = h('nav.fx-nav', { 'aria-label': 'Secciones del sistema' }, h('div.nv-fija', brand, empresa)); // la marca y la empresa quedan fijas arriba: no se mueven al desplazar el menú
  const botonesNav = new Map(); // id de módulo -> botón
  const botonHoy = h('button.nv-item.nv-hoy', { type: 'button', 'data-nav': 'hoy', onclick: () => ir('inicio') }, h('span.nv-tit', 'Hoy'));
  nav.append(botonHoy);
  for (const g of GRUPOS_NAV.filter((x) => x.items.length)) {
    const mods = itemsDeGrupo(g, app).map(modDe).filter(Boolean).filter((m) => (!m.soloAdmin || app.admin) && habilitado(m));
    if (!mods.length) continue;
    nav.append(h('div.nv-grupo', { 'data-grupo': g.id },
      h('div.nv-grupo-tit', g.titulo),
      mods.map((m) => { const b = h('button.nv-item', { type: 'button', 'data-nav': m.id, onclick: () => ir(m.id) }, h('span.nv-tit', m.titulo)); botonesNav.set(m.id, b); return b; })));
  }
  // Cambiar de empresa: un toque y se abre la otra empresa (sin volver a escribir la clave)
  const otra = codEmp === 'soda' ? { cod: 'pollos', nom: 'Pollos La Bomba', logo: 'img/logo-pollos.svg' } : { cod: 'soda', nom: 'Soda La Bomba', logo: 'img/logo-soda.svg' };
  const btnCambio = h('button.nv-cambio', { type: 'button', onclick: async () => {
    if (btnCambio.disabled) return;
    btnCambio.disabled = true; btnCambio.querySelector('b').textContent = 'Abriendo ' + otra.nom + '…';
    try { await cambiarEmpresa(otra.cod); try { localStorage.setItem('fx_empresa', JSON.stringify({ codigo: otra.cod, nombre: otra.nom })); } catch { /* nada */ } location.hash = ''; location.reload(); }
    catch (e) { btnCambio.disabled = false; btnCambio.querySelector('b').textContent = 'Cambiar a ' + otra.nom; try { toast?.(e?.message || 'No se pudo cambiar de empresa.', 'error'); } catch { /* nada */ } }
  } }, h('span.nv-emp-logo.chico', h('img', { src: otra.logo, alt: '' })), h('span.nv-cambio-txt', h('small', 'Cambiar de empresa'), h('b', 'Cambiar a ' + otra.nom)));
  const pie = h('div.nv-pie',
    app.admin ? btnCambio : null,
    h('span.nv-sesion', 'Sesión de ', h('strong', app.nombreVisible || app.usuario)),
    app.vistaComo ? null : listaVerComo(app),
    h('button.nv-item', { type: 'button', onclick: cambiarPin }, h('span.nv-tit', 'Cambiar mi clave')),
    h('button.nv-item', { type: 'button', onclick: cerrarSesion }, h('span.nv-tit', 'Cerrar sesión')));
  nav.append(pie);

  /* ---------- Columna «Requiere atención» ---------- */
  const lista = h('div.rail-lista');
  const vacio = h('p.rail-vacio', 'Todo al día. Aquí aparece lo que necesite su atención.');
  bandas.filter(Boolean).forEach((b) => lista.append(b));
  const cuenta = h('span.rail-n', '0');
  const cerrarRail = h('button.btn.chico.rail-x', { type: 'button', onclick: () => abrirRail(false) }, 'Cerrar');
  const rail = h('aside.fx-rail#fx-rail', { 'aria-label': 'Requiere atención' },
    h('div.rail-cab', h('h2', 'Requiere atención'), cuenta, cerrarRail), h('a.btn.rail-panel', { href: 'https://panel.dmalabomba.com/', target: '_self' }, 'Ir al panel ›'), h('p.rail-ayuda', 'Toque una tarjeta o su botón para resolver cada aviso.'), lista, vacio,
    h('p.rail-nota', 'Lo que el sistema hace solo (reintentos, respaldos, sondeo de Hacienda) no se muestra aquí.'));
  const vela = h('div.fx-vela', { hidden: true, onclick: () => abrirRail(false) });
  const btnAtencion = h('button.btn.cab-atencion', { type: 'button', 'aria-controls': 'fx-rail', 'aria-expanded': 'false', onclick: () => abrirRail(!rail.classList.contains('abierto')) }, 'Atención ', h('span.cab-atn'));
  function abrirRail(si) {
    rail.classList.toggle('abierto', si); vela.hidden = !si;
    btnAtencion.setAttribute('aria-expanded', String(si));
    if (si) cerrarRail.focus({ preventScroll: true }); else if (document.activeElement && rail.contains(document.activeElement)) btnAtencion.focus({ preventScroll: true });
  }
  const contar = () => {
    const n = bandas.filter((b) => b && !b.hidden).length;
    cuenta.textContent = String(n); cuenta.hidden = !n; vacio.hidden = n > 0;
    const chip = btnAtencion.querySelector('.cab-atn'); chip.textContent = n ? String(n) : ''; chip.hidden = !n;
    btnAtencion.classList.toggle('con-aviso', n > 0);
    raiz.dataset.atencion = String(n);
    btnAtencion.setAttribute('aria-label', n ? 'Atención: ' + n + (n === 1 ? ' aviso' : ' avisos') : 'Atención: nada pendiente');
    barraN.textContent = n ? String(n) : ''; barraN.hidden = !n;
    document.dispatchEvent(new CustomEvent('app:atencion', { detail: { n } }));
  };
  const obs = window.MutationObserver ? new MutationObserver(contar) : null;
  bandas.filter(Boolean).forEach((b) => obs?.observe(b, { attributes: true, attributeFilter: ['hidden', 'class'] }));

  /* ---------- Búsqueda «Buscar o ir a…» ---------- */
  function abrirBusqueda() {
    const entrada = h('input.campo.bus-in', { type: 'search', placeholder: 'Buscar o ir a… (Productos, Contabilidad, Usuarios)', 'aria-label': 'Buscar o ir a' });
    const res = h('div.bus-res', { role: 'listbox' });
    let cerrarM = null;
    const pintar = () => {
      const q = norm(entrada.value).trim();
      const lis = visibles(app).filter((m) => !m.dentroDe || true).filter((m) => m.pantalla !== 'admin')
        .filter((m) => !q || norm(m.titulo + ' ' + (m.descripcion || '') + ' ' + (m.alias || []).join(' ')).includes(q));
      res.replaceChildren(...(lis.length ? lis.map((m) => h('button.bus-item', { type: 'button', role: 'option', onclick: () => { cerrarM?.(); ir(m.id); } },
        h('b', m.titulo), h('span', typeof m.descripcion === 'string' ? m.descripcion : '')))
        : [h('p.tenue', 'No hay nada con «' + entrada.value + '».')]));
    };
    entrada.addEventListener('input', pintar);
    entrada.addEventListener('keydown', (e) => {
      const items = [...res.querySelectorAll('.bus-item')];
      if (e.key === 'Enter') { e.preventDefault(); items[0]?.click(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); items[0]?.focus(); }
    });
    res.addEventListener('keydown', (e) => {
      const items = [...res.querySelectorAll('.bus-item')], i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); items[Math.min(i + 1, items.length - 1)]?.focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); (i <= 0 ? entrada : items[i - 1]).focus(); }
    });
    pintar();
    const m = modal({ titulo: 'Buscar o ir a…', contenido: h('div.bus', entrada, res), ancho: 560 });
    cerrarM = m?.cerrar || m?._cerrar || (() => document.querySelector('.modal-fondo')?._cerrar?.());
    setTimeout(() => entrada.focus(), 30);
  }
  const btnBuscar = h('button.btn.cab-buscar', { type: 'button', onclick: abrirBusqueda }, h('span', 'Buscar o ir a…'), h('kbd', 'Ctrl K'));
  const teclaBuscar = (e) => {
    if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 'k') { if (!document.body.classList.contains('fx-admin') || !raiz.isConnected) return; e.preventDefault(); if (!document.querySelector('.modal-fondo')) abrirBusqueda(); }
  };

  /* ---------- Barra inferior del celular ---------- */
  const barraN = h('span.bb-n', { hidden: true });
  const hoja = h('div.fx-hoja', { hidden: true, role: 'dialog', 'aria-label': 'Más opciones' });
  const hojaVela = h('div.fx-vela.hoja-vela', { hidden: true, onclick: () => cerrarHoja() });
  function cerrarHoja() { hoja.hidden = true; hojaVela.hidden = true; barra.querySelectorAll('[aria-expanded=true]').forEach((b) => b.setAttribute('aria-expanded', 'false')); }
  function abrirHoja(ids, titulo, boton) {
    const mods = ids.map(modDe).filter(Boolean).filter(habilitado);
    hoja.replaceChildren(h('div.hoja-tit', titulo, h('button.btn.chico', { type: 'button', onclick: cerrarHoja }, 'Cerrar')),
      h('div.hoja-rejilla', mods.map((m) => h('button.hoja-item', { type: 'button', onclick: () => { cerrarHoja(); ir(m.id); } }, h('b', m.titulo), insigniaTxt(m)))));
    hoja.hidden = false; hojaVela.hidden = false;
    barra.querySelectorAll('[aria-expanded=true]').forEach((b) => b.setAttribute('aria-expanded', 'false')); boton?.setAttribute('aria-expanded', 'true');
    hoja.querySelector('.hoja-item')?.focus();
  }
  const dest5 = [
    { id: 'hoy', txt: 'Hoy', alIr: () => { cerrarHoja(); ir('inicio'); } },
    ...['vender', 'inventario', 'conta'].map((gid) => { const g = GRUPOS_NAV.find((x) => x.id === gid); return { id: gid, txt: g.corto, alIr: (b) => abrirHoja(itemsDeGrupo(g, app), g.titulo, b) }; }),
    { id: 'mas', txt: 'Más', alIr: (b) => abrirHoja([...GRUPOS_NAV.find((x) => x.id === 'informes').items, ...GRUPOS_NAV.find((x) => x.id === 'sistema').items], 'Informes y sistema', b) },
  ];
  const barra = h('nav.fx-barra', { 'aria-label': 'Navegación' }, dest5.map((d) => h('button.bb-item', { type: 'button', 'data-bb': d.id, 'aria-expanded': 'false', onclick: (e) => d.alIr(e.currentTarget) }, h('span.bb-txt', d.txt), d.id === 'hoy' ? barraN : null)));

  /* ---------- Pistas de desplazamiento: avisan cuando hay más contenido arriba o abajo ---------- */
  function pistas(el) {
    const arr = h('div.pista.pista-arriba', { 'aria-hidden': 'true' }, h('span', '▴ Hay más arriba'));
    const abj = h('div.pista.pista-abajo', { 'aria-hidden': 'true' }, h('span', '▾ Hay más abajo'));
    const fija = el.querySelector('.nv-fija');
    if (fija) { fija.after(arr); const ajustar = () => { arr.style.top = fija.offsetHeight + 'px'; }; ajustar(); setTimeout(ajustar, 300); window.addEventListener('resize', ajustar); } else el.prepend(arr);
    el.append(abj);
    const act = () => { el.classList.toggle('mas-arriba', el.scrollTop > 8); el.classList.toggle('mas-abajo', el.scrollHeight - el.clientHeight - el.scrollTop > 8); };
    el.addEventListener('scroll', act, { passive: true }); window.addEventListener('resize', act);
    window.ResizeObserver && new ResizeObserver(act).observe(el);
    setTimeout(act, 60); setTimeout(act, 700); setTimeout(act, 2000);
  }
  pistas(nav); pistas(rail);
  // Cada tarjeta de la columna se toca entera: lleva al mismo lugar que su botón
  lista.addEventListener('click', (e) => { if (e.target.closest('button,a')) return; const b = e.target.closest('.alerta-in')?.querySelector('button'); b?.click(); });
  lista.addEventListener('mouseover', () => {});

  /* ---------- Armado ---------- */
  const volver = h('div.fx-volver', h('button.btn.fx-volver-btn', { type: 'button', onclick: () => ir('inicio') }, h('span', { 'aria-hidden': 'true' }, '←'), ' Volver al inicio'));
  const centro = h('div.fx-centro', cab, volver, vista);
  raiz.replaceChildren(nav, centro, rail, barra, vela, hojaVela, hoja);
  // botones del encabezado (después del título): buscar y atención
  const fila = cab.querySelector('.cab-fila');
  const anular = fila?.querySelector('.cab-anular');
  if (fila) fila.insertBefore(h('div.cab-acciones', btnAtencion), anular || null); // 16 nov 2026: se quitó la barra «Buscar o ir a…» (orden de Emil); la función sigue disponible por si se reactiva
  contar();

  const marcar = (dest, tipo) => {
    const g = dest && dest.id ? grupoNavDe(dest.id) : null;
    const hoy = tipo === 'inicio' || tipo === 'admin';
    raiz.dataset.vista = tipo; raiz.dataset.grupo = hoy ? 'hoy' : (g?.id || '');
    nav.querySelectorAll('.nv-item[data-nav]').forEach((b) => { const on = hoy ? b.dataset.nav === 'hoy' : b.dataset.nav === dest?.id; b.classList.toggle('on', on); if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    barra.querySelectorAll('.bb-item').forEach((b) => { const id = b.dataset.bb; const on = hoy ? id === 'hoy' : (id === g?.id || (id === 'mas' && (g?.id === 'informes' || g?.id === 'sistema'))); b.classList.toggle('on', on); });
    cerrarHoja(); abrirRail(false);
  };
  const repintar = () => {
    botonesNav.forEach((b, id) => { b.querySelector('.nv-ins')?.remove(); const m = modDe(id); const i = m && insigniaTxt(m); if (i) b.append(i); });
    contar();
  };
  // SINPE Móvil: la bandera se lee después de armar el menú; cuando se enciende (o apaga), «Pagos SINPE» aparece o desaparece del grupo Vender sin recargar
  const sincronizarSinpe = () => {
    const m = modDe('sinpe'); if (!m || !app.admin) return;
    const hay = botonesNav.has('sinpe');
    if (habilitado(m) && !hay) {
      const grupo = nav.querySelector('.nv-grupo[data-grupo=vender]'); if (!grupo) return;
      const b = h('button.nv-item', { type: 'button', 'data-nav': m.id, onclick: () => ir(m.id) }, h('span.nv-tit', m.titulo));
      botonesNav.set(m.id, b);
      const despuesDe = botonesNav.get('clientes');
      if (despuesDe && despuesDe.parentElement === grupo) despuesDe.after(b); else grupo.append(b);
      repintar();
    } else if (!habilitado(m) && hay) { botonesNav.get('sinpe').remove(); botonesNav.delete('sinpe'); repintar(); }
  };
  document.addEventListener('app:sinpe-bandera', sincronizarSinpe);
  if (app.admin) cargarBanderaSinpe().catch(() => {}); // la bandera se pregunta una vez; apagada (lo normal) no cambia el menú
  const eventos = ['app:alertas', 'app:alertas-cambio', 'app:alertas-hacienda-cambio', 'app:cambio'];
  eventos.forEach((e) => document.addEventListener(e, repintar));
  repintar();

  return {
    marcar, repintar, abrirRail, abrirBusqueda,
    destruir() {
      eventos.forEach((e) => document.removeEventListener(e, repintar));
      document.removeEventListener('app:sinpe-bandera', sincronizarSinpe);
      obs?.disconnect();
      document.body.classList.remove('fx-admin', 'sin-cristal'); raiz.classList.remove('fx-shell', 'sin-rail'); delete raiz.dataset.vista; delete raiz.dataset.grupo; delete raiz.dataset.atencion;
    },
  };
}
