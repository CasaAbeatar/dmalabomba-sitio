// Conteo físico: empezar (fx_inv_conteo_iniciar), anotar lo contado (fx_inv_conteo_registrar), confirmar (administrador, fx_inv_conteo_confirmar) o cancelar.
// Lo que no se contó NO se toca. Para que el conteo sea confiable, se cuenta sin ver lo que dice el sistema (conteo ciego); solo un administrador puede mostrarlo.
import { h, money, num, fechaHora, debounce } from './util.js';
import { inv, cant } from './api_inventarios.js';
import { ventana, dialogo, cargando, falla, vacio, aviso, cantTxt, unidadTxt, plural, selectUbicacion, nombreUbicacion, campoCantidad, accionSegura, botonSeguro, repetidaTxt, enfocar, toastOk, elegirArticulo, opcionDeArticulo, preguntar, norm, poner } from './m_inv_comun.js';

const ESTADO = { abierto: ['Abierto', 'espera'], confirmado: ['Confirmado', 'ok'], cancelado: ['Cancelado', ''] };
const chipEstado = (e) => { const [t, c] = ESTADO[e] || [e, '']; return h('span.chip' + (c ? '.' + c : ''), t); };

export async function abrir(ctx, _id, pedido = {}) {
  const abiertos = h('div', cargando('Cargando conteos…'));
  const anteriores = h('div');
  let vivo = true, datos = [];
  const btnEmpezar = h('button.btn.primario.grande', { type: 'button', onclick: () => empezar() }, 'Empezar un conteo');
  const alCambio = () => { if (vivo) cargar(); };
  document.addEventListener('inv:cambio', alCambio);
  const v = ventana({ titulo: 'Conteo físico', contenido: [
    h('div.inv-ventana-cab', h('p', 'Cuente lo que hay de verdad en una bodega o local. Puede anotar de a poco y corregir mientras el conteo siga abierto. Al confirmar, el sistema corrige solo lo que se contó.')),
    h('div.inv-acciones-grandes', btnEmpezar),
    h('section.inv-grupo', h('h3', 'Conteos abiertos'), abiertos),
    h('section.inv-grupo', h('h3', 'Conteos anteriores'), anteriores)],
  alCerrar: () => { vivo = false; document.removeEventListener('inv:cambio', alCambio); } });

  async function cargar() {
    let d;
    try { d = await inv.conteos(null, null, 50); } catch (e) { if (vivo) poner(abiertos, falla(e, cargar, 'No se pudieron cargar los conteos')); return; }
    if (!vivo) return;
    datos = d.conteos || [];
    const ab = datos.filter((c) => c.estado === 'abierto'), otros = datos.filter((c) => c.estado !== 'abierto');
    const fila = (c) => h('button.inv-conteo-fila', { type: 'button', onclick: () => abrirConteo(ctx, c.id) },
      h('span.inv-conteo-dato', h('strong', c.ubicacion), h('small', 'Lo empezó ' + (c.iniciado_por_nombre || c.iniciado_por || 'sin dato') + ', ' + fechaHora(c.iniciado_en) + (c.cerrado_en ? ' · cerrado por ' + (c.cerrado_por_nombre || c.cerrado_por || 'sin dato') + ', ' + fechaHora(c.cerrado_en) : '') + (c.nota ? ' · «' + c.nota + '»' : ''))),
      h('span.inv-conteo-prog.cifra', plural(c.contadas || 0, 'contado', 'contados') + ' de ' + num(c.lineas || 0, 0)),
      chipEstado(c.estado), h('span.inv-exis-ver', c.estado === 'abierto' ? 'Seguir contando' : 'Ver'));
    poner(abiertos, ab.length ? h('div.inv-conteos', ab.map(fila)) : vacio('No hay ningún conteo abierto.'));
    poner(anteriores, otros.length ? h('div.inv-conteos', otros.map(fila)) : vacio('Todavía no hay conteos anteriores.'));
  }
  function empezar() {
    const ocupadas = new Set(datos.filter((c) => c.estado === 'abierto').map((c) => c.ubicacion_id));
    const sel = selectUbicacion(ctx.cat, { etiqueta: 'Dónde se va a contar' });
    [...sel.options].forEach((o) => { if (ocupadas.has(o.value)) { o.disabled = true; o.textContent += ' (ya tiene un conteo abierto)'; } });
    const nota = h('input.campo', { type: 'text', maxlength: 300, 'aria-label': 'Nota (opcional)', placeholder: 'Por ejemplo: conteo de fin de mes' });
    const zona = h('div');
    const ok = h('button.btn.primario', { type: 'button' }, 'Empezar el conteo');
    const acc = accionSegura({ boton: ok, zona, ocupado: 'Empezando…',
      hacer: (idem) => { if (!sel.value) throw new Error('Escoja dónde se va a contar.'); return inv.conteoIniciar(sel.value, nota.value.trim() || null, idem); },
      alTerminar: (r, { repetida }) => { d.cerrar(); toastOk('Conteo empezado en ' + (r.conteo?.ubicacion || nombreUbicacion(ctx.cat, sel.value)) + '.' + repetidaTxt(repetida)); abrirConteo(ctx, r.conteo?.id, r); } });
    ok.addEventListener('click', () => acc.ejecutar());
    const d = dialogo({ titulo: 'Empezar un conteo', ancho: 520, contenido: [h('p', 'El sistema guarda lo que dice que hay en este momento. Después anote lo que cuente.'), h('label.etq', 'Dónde se va a contar', sel), h('label.etq', 'Nota (opcional)', nota), zona], botones: [{ texto: 'No, volver', onclick: (c) => c() }] });
    d.el.querySelector('.modal-pie').append(ok);
  }
  await cargar();
  enfocar(v.cuerpo);
  if (pedido.conteo) abrirConteo(ctx, pedido.conteo);
}

/* ---------- Un conteo ---------- */
export async function abrirConteo(ctx, id, inicial = null) {
  if (!id) return;
  let vivo = true, mostrar = false, datos = null, filtro = '';
  const anotados = new Map(); // articulo_id -> { campo, guardado }
  const cuerpo = h('div.inv-conteo', cargando('Cargando el conteo…'));
  const resultado = h('div', { 'aria-live': 'polite' });
  const sinGuardar = () => [...anotados.values()].filter((x) => x.campo.input.value.trim() !== x.guardado).length;
  ventana({ titulo: 'Conteo', volver: 'Conteo físico', contenido: [resultado, cuerpo], alCerrar: () => { vivo = false; },
    bloqueo: () => (sinGuardar() ? 'Hay cantidades anotadas sin guardar. Toque «Guardar lo contado» (o «Descartar lo no guardado») antes de salir.' : '') });

  async function cargar() {
    try { datos = await inv.conteo(id); } catch (e) { if (vivo) poner(cuerpo, falla(e, cargar, 'No se pudo abrir el conteo')); return; }
    if (vivo) pintar();
  }
  function pintar() {
    const c = datos.conteo || {}, lineas = datos.lineas || [];
    const abierto = c.estado === 'abierto';
    anotados.clear();
    const contadas = lineas.filter((l) => l.contado != null).length;
    const zona = h('div');
    const estadoGuardar = h('p.inv-sin-guardar', { 'aria-live': 'polite' });
    const btnGuardar = h('button.btn.primario.grande', { type: 'button' }, 'Guardar lo contado');
    const pintarEstado = () => { const n = sinGuardar(); poner(estadoGuardar, n ? plural(n, 'artículo anotado sin guardar', 'artículos anotados sin guardar') : 'Todo lo anotado está guardado.', n ? h('button.btn.chico.suave', { type: 'button', onclick: () => { anotados.forEach((x) => x.campo.poner(x.guardado === '' ? '' : x.guardado.replace(',', '.'))); pintarEstado(); } }, 'Descartar lo no guardado') : null); estadoGuardar.classList.toggle('pendiente', n > 0); };
    const accGuardar = accionSegura({ boton: btnGuardar, zona, ocupado: 'Guardando…',
      hacer: (idem) => {
        const items = [];
        for (const [artId, x] of anotados) {
          if (x.campo.input.value.trim() === x.guardado || !x.campo.input.value.trim()) continue;
          if (!x.campo.valido()) { x.campo.input.focus(); throw new Error('Revise la cantidad de «' + x.nombre + '» (un número, puede ser 0).'); }
          items.push({ articulo_id: artId, contado: cant(x.campo.leer()) });
        }
        if (!items.length) throw new Error('No hay nada nuevo que guardar. Escriba lo que contó en cada artículo.');
        return inv.conteoRegistrar(id, items, idem);
      },
      alTerminar: (r, { repetida }) => { datos = r; toastOk('Se guardó lo contado.' + repetidaTxt(repetida)); pintar(); } });
    btnGuardar.addEventListener('click', () => accGuardar.ejecutar());
    const buscar = h('input.campo', { type: 'search', placeholder: 'Buscar un artículo de la lista', 'aria-label': 'Buscar en el conteo', value: filtro, autocomplete: 'off' });
    const listaEl = h('div.inv-conteo-lineas');
    const ver = h('input', { type: 'checkbox', checked: mostrar, onchange: () => { mostrar = ver.checked; pintar(); } });
    const lineaEl = (l) => {
      const campo = campoCantidad({ etiqueta: 'Contado', unidad: l.unidad, min0: true, valor: l.contado ?? '', alCambiar: () => pintarEstado() });
      if (!abierto) campo.input.disabled = true;
      anotados.set(l.articulo_id, { campo, guardado: campo.input.value.trim(), nombre: l.articulo });
      const dif = l.diferencia != null ? Number(l.diferencia) : null;
      return h('div.inv-conteo-linea' + (l.contado != null ? '.contada' : ''), { 'data-art': l.articulo_id, 'data-nombre': norm(l.articulo) },
        h('div.inv-conteo-art', h('strong', l.articulo), h('small', [l.categoria, 'se cuenta en ' + unidadTxt(l.unidad || 'unidad', 2)].filter(Boolean).join(' · ')),
          l.contado != null ? h('small.inv-anotado', 'Anotado: ' + cantTxt(l.contado, l.unidad) + (l.contado_por_nombre ? ' por ' + l.contado_por_nombre : '') + (l.contado_en ? ', ' + fechaHora(l.contado_en) : '')) : h('small.inv-falta', 'Sin contar')),
        campo.el,
        mostrar ? h('div.inv-conteo-sis',
          h('small', 'El sistema dice: ' + cantTxt(l.existencia_actual ?? l.esperado_al_contar ?? l.esperado_inicio, l.unidad) + ' (al empezar: ' + cantTxt(l.esperado_inicio, l.unidad) + ')'),
          dif != null ? h('span.chip' + (dif === 0 ? '.ok' : '.espera'), dif === 0 ? 'Coincide' : (dif > 0 ? 'Sobran ' : 'Faltan ') + cantTxt(Math.abs(dif), l.unidad)) : null,
          l.ajuste != null ? h('small', 'Ajuste aplicado: ' + num(l.ajuste, 3)) : null) : null);
    };
    const pintarLista = () => {
      const t = norm(filtro);
      const ls = lineas.filter((l) => !t || norm(l.articulo).includes(t));
      poner(listaEl, ...(ls.length ? ls.map(lineaEl) : [vacio(t ? 'Ningún artículo de este conteo coincide con «' + filtro + '».' : 'Este conteo no tiene artículos. Agregue los que va a contar.')]));
      pintarEstado();
    };
    buscar.addEventListener('input', debounce(() => { filtro = buscar.value.trim(); listaEl.querySelectorAll('.inv-conteo-linea').forEach((el) => { el.hidden = !!filtro && !el.dataset.nombre.includes(norm(filtro)); }); }, 150));
    const agregar = h('button.btn', { type: 'button', onclick: async () => {
      const ya = new Set(lineas.map((l) => l.articulo_id));
      const arts = (await ctx.articulos.lista()).filter((a) => a.activo !== false && !ya.has(a.id));
      const o = await elegirArticulo({ titulo: 'Agregar un artículo al conteo', opciones: arts.map(opcionDeArticulo), ayuda: 'Para un artículo que encontró y que el sistema no tenía aquí. Se agrega con «el sistema dice: 0».' });
      if (!o) return;
      lineas.push({ articulo_id: o.id, articulo: o.nombre, unidad: o.unidad, categoria: o.a?.categoria, esperado_inicio: 0, existencia_actual: 0, esperado_al_contar: null, contado: null, diferencia: null });
      pintarLista();
      listaEl.querySelector(`[data-art="${o.id}"] input`)?.focus();
    } }, 'Agregar un artículo que no está en la lista');
    const btnConfirmar = ctx.esAdmin && abierto ? h('button.btn.grande', { type: 'button', onclick: () => confirmar() }, 'Confirmar el conteo y corregir el inventario') : null;
    const btnCancelar = abierto ? h('button.btn.peligro', { type: 'button', onclick: () => cancelar() }, 'Cancelar el conteo') : null;

    poner(cuerpo, 
      h('div.inv-ventana-cab', h('div', h('h2', c.ubicacion || 'Conteo'), h('p.tenue', 'Lo empezó ' + (c.iniciado_por_nombre || c.iniciado_por || 'sin dato') + ', ' + fechaHora(c.iniciado_en) + (c.nota ? ' · «' + c.nota + '»' : ''))), chipEstado(c.estado)),
      h('p.inv-progreso', h('strong', plural(contadas, 'artículo contado', 'artículos contados') + ' de ' + num(lineas.length, 0)), h('span.inv-progreso-pista', { 'aria-hidden': 'true' }, h('i', { style: `width:${lineas.length ? Math.round(contadas / lineas.length * 100) : 0}%` }))),
      abierto ? (ctx.esAdmin ? h('label.inv-casilla', ver, h('span', 'Mostrar lo que dice el sistema (solo administradores; para contar es mejor no verlo)')) : aviso('info', h('p', 'Cuente sin mirar lo que dice el sistema: así el conteo sale más confiable. Escriba 0 si no hay nada.')))
        : (ctx.esAdmin ? h('label.inv-casilla', ver, h('span', 'Mostrar lo que decía el sistema y las diferencias')) : null),
      !abierto ? aviso(c.estado === 'confirmado' ? 'ok' : 'info', h('p', c.estado === 'confirmado' ? 'Este conteo ya se confirmó: el inventario se corrigió con lo contado' + (c.cerrado_por_nombre ? ' (lo confirmó ' + c.cerrado_por_nombre + ', ' + fechaHora(c.cerrado_en) + ')' : '') + '.' : 'Este conteo se canceló: no cambió nada del inventario.')) : null,
      h('label.etq', 'Buscar', buscar),
      listaEl,
      abierto ? h('div.inv-barra-recibir', estadoGuardar, h('div.inv-barra-btns', agregar, btnGuardar), zona) : null,
      abierto ? h('div.inv-barra-btns.fin', btnConfirmar, btnCancelar) : null,
      abierto && !ctx.esAdmin ? h('p.tenue.inv-chico', 'Cuando termine, avise a un administrador para que confirme el conteo y se corrija el inventario.') : null);
    pintarLista();
  }

  async function confirmar() {
    if (sinGuardar()) return preguntar('Hay cantidades anotadas sin guardar. Guárdelas primero con «Guardar lo contado».', { si: 'Entendido', no: 'Volver' });
    const lineas = datos.lineas || [];
    const contadas = lineas.filter((l) => l.contado != null);
    const difs = contadas.filter((l) => Number(l.diferencia) !== 0);
    const zona = h('div');
    const ok = h('button.btn.primario', { type: 'button' }, 'Sí, confirmar y corregir');
    const acc = accionSegura({ boton: ok, zona, ocupado: 'Confirmando…',
      hacer: (idem) => inv.conteoConfirmar(id, idem),
      alTerminar: async (r, { repetida }) => {
        d.cerrar();
        poner(resultado, aviso('ok', h('p', h('strong', 'Conteo confirmado.'), ' ' + plural((r.ajustes || []).length, 'artículo se corrigió', 'artículos se corrigieron') + ', ' + plural(r.sin_cambio || 0, 'coincidió', 'coincidieron') + '. Valor de los ajustes, al costo sin IVA: ' + money(r.valor_ajustes) + '.' + repetidaTxt(repetida)),
          (r.ajustes || []).length ? h('ul.inv-res-lista', r.ajustes.map((a) => h('li', a.articulo + ': el sistema decía ' + cantTxt(a.esperado, a.unidad) + ', se contó ' + cantTxt(a.contado, a.unidad) + ' (' + (Number(a.diferencia) > 0 ? '+' : '') + num(a.diferencia, 3) + ', ' + money(a.valor) + ')'))) : null,
          (r.no_contados || []).length ? h('p', 'No se contaron y no se tocaron: ' + r.no_contados.map((x) => x.articulo).join(', ') + '.') : null));
        await cargar();
        resultado.scrollIntoView({ block: 'nearest' });
      } });
    ok.addEventListener('click', () => acc.ejecutar());
    const d = dialogo({ titulo: 'Confirmar el conteo', ancho: 560, contenido: [
      h('p', 'El inventario se corrige con lo contado: lo que sobra entra y lo que falta sale. Esto lo puede hacer solo un administrador.'),
      h('ul.inv-datos-lista', h('li', h('span', 'Artículos contados'), h('strong', num(contadas.length, 0) + ' de ' + num(lineas.length, 0))),
        h('li', h('span', 'Con diferencia'), h('strong', num(difs.length, 0))),
        h('li', h('span', 'Sin contar (no se tocan)'), h('strong', num(lineas.length - contadas.length, 0)))),
      zona], botones: [{ texto: 'No, volver', onclick: (c) => c() }] });
    d.el.querySelector('.modal-pie').append(ok);
  }
  function cancelar() {
    const motivo = h('input.campo', { type: 'text', maxlength: 200, 'aria-label': 'Motivo (opcional)', placeholder: 'Por ejemplo: se empezó en la ubicación equivocada' });
    const zona = h('div');
    const { boton } = botonSeguro('Sí, cancelar el conteo', 'peligro', { zona, ocupado: 'Cancelando…',
      hacer: (idem) => { const m = motivo.value.trim(); if (m && m.length < 3) throw new Error('El motivo tiene que tener al menos 3 letras, o déjelo vacío.'); return inv.conteoCancelar(id, m || null, idem); },
      alTerminar: async (r, { repetida }) => { anotados.clear(); d.cerrar(); toastOk('El conteo se canceló. No cambió nada del inventario.' + repetidaTxt(repetida)); await cargar(); } });
    const d = dialogo({ titulo: 'Cancelar el conteo', ancho: 520, contenido: [h('p', 'Lo anotado se descarta y el inventario no cambia.'), h('label.etq', 'Motivo (opcional)', motivo), zona], botones: [{ texto: 'No, volver', onclick: (c) => c() }] });
    d.el.querySelector('.modal-pie').append(boton);
  }
  if (inicial?.conteo) { datos = inicial; pintar(); } else await cargar();
  enfocar(cuerpo);
}
