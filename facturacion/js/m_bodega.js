// Bodega (Administración): qué hay en cada local, mínimos PROPUESTOS con su explicación, alertas de bajo mínimo, conteo físico y ajuste con motivo.
// Una sola pantalla con cuatro pestañas; todas abren con lo de HOY y después lo demás. Datos: fx_bodega_tablero (api_bodega.js, sql 70).
// REGLA: ningún mínimo se activa solo. Una propuesta queda como propuesta hasta que un administrador la aprueba aquí.
// Roles (la base los revisa): admin hace todo; conteo solo cuenta y NO ve lo que dice el sistema (conteo ciego); lectura solo mira.
import { h, num, money, toast, textoDeError, fechaHora } from './util.js';
import { cargarHoja } from './ui_hojas.js';
import { bodega } from './api_bodega.js';
import { cargarCss, cargando, falla, aviso, poner, plural, cantTxt, leerCantidad, norm, accionSegura, preguntar, diaLargo } from './m_inv_comun.js';

const ROL_TXT = { admin: 'Administración', conteo: 'Solo conteo', lectura: 'Solo lectura' };
const lista = (x) => (Array.isArray(x) ? x.filter((i) => i && typeof i === 'object') : []);
const vacioTxt = (n) => (n == null ? '' : String(n).replace('.', ','));

// La frase que explica una propuesta, con los números que la producen
export function explicacion(f, par) {
  const p = f.propuesta;
  if (!p) return 'Sin consumo en los últimos 30 días: no se propone mínimo.';
  const dias = Number(p.dias_observados), u = f.unidad;
  const partes = [`Se consumieron ${cantTxt(p.consumo_30d, u)} en ${dias === 1 ? '1 día observado' : dias + ' días observados'}, o sea ${cantTxt(p.consumo_diario, u)} por día.`];
  const cob = par?.cobertura_dias, min = par?.dias_observados_min;
  if (cob == null) partes.push('Faltan definir los días de cobertura para calcular el mínimo.');
  else partes.push(`Con ${num(cob, 1)} días de cobertura, el mínimo propuesto es ${cantTxt(p.minimo_sugerido, u)} (consumo por día × días de cobertura, hacia arriba).`);
  if (min == null) partes.push('Faltan definir los días de historia mínimos.');
  else if (p.historia_suficiente === false) partes.push(`Todavía no es confiable: se piden ${num(min, 0)} días de historia y hay ${dias}.`);
  if (p.cv_pct != null) partes.push(`El consumo diario varía ${num(p.cv_pct, 1)} % (coeficiente de variación; desviación estándar ${cantTxt(p.sd_diaria, u)}). Con pocos días es solo una pista.`);
  return partes.join(' ');
}
const estadoMin = (f) => {
  const p = f.propuesta;
  if (!p) return f.minimo != null ? ['aprobado', 'Mínimo aprobado'] : ['sin', 'Sin consumo'];
  if (p.aprobable) return f.minimo != null && Number(f.minimo) === Number(p.minimo_sugerido) ? ['aprobado', 'Aprobado'] : ['listo', 'Listo para aprobar'];
  if (p.minimo_sugerido == null && /cobertura/i.test(p.estado || '')) return ['espera', 'Faltan parámetros'];
  if (p.historia_suficiente === false) return ['espera', 'Falta historia'];
  return ['espera', 'Todavía no'];
};

export default {
  id: 'bodega',
  titulo: 'Bodega',
  async mount(root, app) {
    await Promise.all([cargarHoja('bodega.css'), cargarCss()]);
    let vivo = true, seq = 0;
    const est = { d: null, tab: null, q: '', cat: '', local: '', soloBajo: false, minFiltro: 'listos', conteoLocal: '', cont: new Map(), nota: '', motivo: '', sel: new Set(), motivoPend: '', personas: null };
    const cuerpo = h('div.bd');
    root.append(cuerpo);
    const rol = () => est.d?.rol, esAdmin = () => rol() === 'admin', ciego = () => rol() === 'conteo';

    async function cargar(silencioso = false) {
      const mia = ++seq;
      if (!silencioso || !est.d) poner(cuerpo, cargando('Cargando la bodega…'));
      try {
        const d = await bodega.tablero();
        if (!vivo || mia !== seq) return;
        if (!d?.permitido) { poner(cuerpo, h('div.vacio', h('p', 'Esta pantalla es solo para administradores y personas autorizadas para la bodega.'), h('button.btn', { type: 'button', onclick: () => app.ir('inicio') }, 'Volver al inicio'))); return; }
        est.d = d;
        if (!est.tab || !tabs().some((t) => t[0] === est.tab)) est.tab = tabs()[0][0];
        if (!est.conteoLocal) est.conteoLocal = (lista(d.ubicaciones).find((u) => u.tipo === 'local') || lista(d.ubicaciones)[0] || {}).id || '';
        const ids = new Set(lista(d.conteos_pendientes).map((c) => c.id));
        est.sel = new Set([...est.sel].filter((i) => ids.has(i)));
        pintar();
      } catch (e) {
        if (!vivo || mia !== seq) return;
        poner(cuerpo, falla(e, () => cargar(), 'No se pudo cargar la bodega'));
      }
    }
    const tabs = () => (ciego() ? [['conteo', 'Conteo']] : [['hoy', 'Hoy'], ['existencias', 'Existencias'], ['minimos', 'Mínimos'], ['conteo', 'Conteo']]);
    const filas = () => lista(est.d?.filas), par = () => est.d?.parametros || {}, ubic = () => lista(est.d?.ubicaciones);
    const bajos = () => filas().filter((f) => f.bajo_minimo);
    const listos = () => filas().filter((f) => f.propuesta?.aprobable && !(f.minimo != null && Number(f.minimo) === Number(f.propuesta.minimo_sugerido)));
    const hayMinimos = () => filas().some((f) => f.minimo != null && Number(f.minimo) > 0);

    function pintar() {
      const t = tabs();
      poner(cuerpo,
        h('div.bd-cab', h('div', h('span.bd-et', 'Hoy'), h('h2', diaLargo(est.d.hoy)), h('p.tenue', 'Bodega central y locales de las dos empresas. Los mínimos solo avisan cuando un administrador los aprueba.')),
          h('span.bd-rol', ROL_TXT[rol()] || '')),
        t.length > 1 ? h('div.bd-tabs', { role: 'group', 'aria-label': 'Secciones de la bodega' }, t.map(([id, txt]) => h('button.btn', { type: 'button', 'data-tab': id, 'aria-pressed': String(est.tab === id), onclick: () => { est.tab = id; pintar(); } },
          txt, id === 'hoy' && bajos().length ? h('span.bd-n.mal', String(bajos().length)) : id === 'minimos' && listos().length ? h('span.bd-n', String(listos().length)) : id === 'conteo' && lista(est.d.conteos_pendientes).length && !ciego() ? h('span.bd-n', String(lista(est.d.conteos_pendientes).length)) : null))) : null,
        h('div.bd-seccion', { 'data-seccion': est.tab }, est.tab === 'hoy' ? vistaHoy() : est.tab === 'existencias' ? vistaExistencias() : est.tab === 'minimos' ? vistaMinimos() : vistaConteo()));
    }

    /* ---------- HOY ---------- */
    function vistaHoy() {
      const b = bajos(), l = listos(), pend = lista(est.d.conteos_pendientes);
      const p = par(), sinParam = p.cobertura_dias == null || p.dias_observados_min == null;
      const tarj = (n, tit, txt, tab, mal) => h('button.bd-tarj' + (n && mal ? '.mal' : ''), { type: 'button', 'data-tarj': tab, onclick: () => { est.tab = tab; pintar(); } }, h('span.bd-tarj-n.cifra', num(n, 0)), h('span.bd-tarj-t', tit), h('span.bd-tarj-d', txt), h('span.bd-tarj-v', 'Ver'));
      const bajaria = filas().filter((f) => f.minimo == null && f.propuesta?.minimo_sugerido != null && Number(f.existencia) < Number(f.propuesta.minimo_sugerido));
      return [
        h('div.bd-tarjs', tarj(b.length, 'Bajo el mínimo', b.length ? 'Hay que pedir o trasladar más.' : hayMinimos() ? 'Todo está sobre su mínimo.' : 'Todavía no hay mínimos aprobados.', 'existencias', true),
          tarj(l.length, 'Mínimos por aprobar', l.length ? 'Propuestas listas para decidir.' : 'Ninguna propuesta lista todavía.', 'minimos', false),
          tarj(pend.length, 'Conteos por decidir', pend.length ? 'Esperan que alguien los aplique o descarte.' : 'No hay conteos pendientes.', 'conteo', false)),
        sinParam ? aviso('espera', h('p', h('strong', 'Faltan dos datos para proponer mínimos: '), 'los días de cobertura y los días de historia mínimos. Mientras no estén, la bodega no propone nada.'),
          h('button.btn', { type: 'button', onclick: () => { est.tab = 'minimos'; pintar(); } }, 'Definirlos en Mínimos')) : null,
        h('h3', 'Bajo el mínimo'),
        b.length ? h('ul.bd-lista', b.map((f) => h('li.bd-alerta', h('strong', f.articulo), h('span.tenue', ' en ' + f.ubicacion), h('span', ` Hay ${cantTxt(f.existencia, f.unidad)}, el mínimo es ${cantTxt(f.minimo, f.unidad)}: faltan ${cantTxt(Number(f.minimo) - Number(f.existencia), f.unidad)}.`))))
          : h('div.vacio', h('p', hayMinimos() ? 'Nada está por debajo de su mínimo.' : 'Todavía no hay mínimos aprobados, por eso no hay alertas. Cuando se aprueben en la pestaña Mínimos, aquí aparecerá lo que baje de su mínimo.')),
        bajaria.length ? [h('h3', 'Bajaría del mínimo propuesto (aún no es una alerta)'), h('ul.bd-lista', bajaria.slice(0, 15).map((f) => h('li', h('strong', f.articulo), h('span.tenue', ' en ' + f.ubicacion), h('span', ` Hay ${cantTxt(f.existencia, f.unidad)} y se propone ${cantTxt(f.propuesta.minimo_sugerido, f.unidad)}.`))))] : null,
        !p.cobertura_dias && !est.d.parametros ? null : h('p.tenue.bd-pie', 'El inventario arrancó el 30 de octubre: hay poco consumo registrado y por eso casi no hay propuestas. Se irán llenando solas con los días.')];
    }

    /* ---------- EXISTENCIAS ---------- */
    function vistaExistencias() {
      const cats = [...new Set(filas().map((f) => f.categoria))].sort((a, b) => a.localeCompare(b, 'es'));
      const q = norm(est.q);
      const pivot = new Map();
      for (const f of filas()) {
        if (est.local && f.ubicacion_id !== est.local) continue;
        if (est.cat && f.categoria !== est.cat) continue;
        if (q && !norm(f.articulo).includes(q)) continue;
        if (est.soloBajo && !f.bajo_minimo) continue;
        if (!pivot.has(f.articulo_id)) pivot.set(f.articulo_id, { f, por: new Map() });
        pivot.get(f.articulo_id).por.set(f.ubicacion_id, f);
      }
      const cols = ubic().filter((u) => !est.local || u.id === est.local);
      const art = [...pivot.values()].sort((a, b) => a.f.categoria.localeCompare(b.f.categoria, 'es') || a.f.articulo.localeCompare(b.f.articulo, 'es'));
      const sel = (et, val, ops, alC) => h('label.etq', et, h('select.campo', { onchange: (e) => alC(e.target.value) }, ops.map(([v, t]) => h('option', { value: v, selected: v === val }, t))));
      const buscar = h('input.campo', { type: 'search', placeholder: 'Nombre del artículo', 'aria-label': 'Buscar artículo', value: est.q, autocomplete: 'off' });
      buscar.addEventListener('input', () => { est.q = buscar.value; clearTimeout(buscar._t); buscar._t = setTimeout(() => { const pos = buscar.selectionStart; pintar(); const n = cuerpo.querySelector('input[type=search]'); n?.focus(); n?.setSelectionRange(pos, pos); }, 250); });
      return [
        h('div.bd-filtros', sel('Bodega o local', est.local, [['', 'Todas'], ...ubic().map((u) => [u.id, u.nombre])], (v) => { est.local = v; pintar(); }),
          sel('Categoría', est.cat, [['', 'Todas'], ...cats.map((c) => [c, c])], (v) => { est.cat = v; pintar(); }), h('label.etq', 'Buscar', buscar)),
        h('label.inv-casilla.bd-chk', h('input', { type: 'checkbox', checked: est.soloBajo, onchange: (e) => { est.soloBajo = e.target.checked; pintar(); } }), h('span', 'Ver solo lo que está bajo el mínimo')),
        !art.length ? h('div.vacio', h('p', 'Ningún artículo coincide con lo que escogió.')) : h('div.bd-tabla-caja', h('table.bd-tabla',
          h('thead', h('tr', h('th', 'Artículo'), cols.map((u) => h('th.num', u.nombre)))),
          h('tbody', art.map(({ f, por }) => h('tr', h('th', { scope: 'row' }, h('span.bd-art', f.articulo), h('small.tenue', f.categoria)),
            cols.map((u) => { const c = por.get(u.id); return h('td.num' + (c?.bajo_minimo ? '.mal' : ''), { 'data-et': u.nombre }, c ? [h('span.cifra', cantTxt(c.existencia, c.unidad)), c.minimo != null && Number(c.minimo) > 0 ? h('small.tenue', 'mínimo ' + cantTxt(c.minimo, c.unidad)) : null, c.bajo_minimo ? h('small.bd-bajo', 'Bajo el mínimo') : null] : h('span.tenue', '—')); })))))),
        h('p.tenue.bd-pie', 'Cantidades en la unidad de cada artículo; los de valor se llevan en colones (sin IVA). «mínimo» aparece solo si un administrador ya lo aprobó.')];
    }

    /* ---------- MÍNIMOS ---------- */
    function vistaMinimos() {
      const p = par(), admin = esAdmin();
      const inC = h('input.campo', { type: 'text', inputmode: 'decimal', 'aria-label': 'Días de cobertura', value: vacioTxt(p.cobertura_dias), disabled: !admin, autocomplete: 'off' });
      const inD = h('input.campo', { type: 'text', inputmode: 'numeric', 'aria-label': 'Días de historia mínimos', value: vacioTxt(p.dias_observados_min), disabled: !admin, autocomplete: 'off' });
      const zonaP = h('div');
      const guardar = h('button.btn.primario', { type: 'button' }, 'Guardar los dos datos');
      const accP = accionSegura({ boton: guardar, zona: zonaP, ocupado: 'Guardando…', hacer: async () => {
        const c = inC.value.trim() === '' ? null : leerCantidad(inC.value), d = inD.value.trim() === '' ? null : leerCantidad(inD.value);
        if (c !== null && (!Number.isFinite(c) || c <= 0 || c > 60)) throw new Error('Los días de cobertura deben ser un número entre 1 y 60.');
        if (d !== null && (!Number.isFinite(d) || d < 1 || d > 30 || !Number.isInteger(d))) throw new Error('Los días de historia mínimos deben ser un número entero entre 1 y 30.');
        return bodega.parametrosGuardar({ cobertura_dias: c, dias_observados_min: d });
      }, alTerminar: async () => { toast('Datos guardados. Las propuestas se recalcularon.'); await cargar(true); } });
      guardar.addEventListener('click', () => accP.ejecutar());
      const todas = filas().filter((f) => f.propuesta || f.minimo != null);
      const nL = listos().length;
      const ver = todas.filter((f) => est.minFiltro === 'todos' || (est.minFiltro === 'listos' ? f.propuesta?.aprobable && estadoMin(f)[0] === 'listo' : estadoMin(f)[0] === 'aprobado'));
      const chip = (id, t) => h('button.btn', { type: 'button', 'aria-pressed': String(est.minFiltro === id), onclick: () => { est.minFiltro = id; pintar(); } }, t);
      const bulk = admin && nL >= 2 ? h('button.btn', { type: 'button', onclick: async () => {
        if (!(await preguntar(`¿Aprobar los ${nL} mínimos listos tal como se proponen? Desde ese momento van a avisar «bajo el mínimo».`, { si: 'Sí, aprobarlos' }))) return;
        const acc = accionSegura({ hacer: (k) => bodega.minimosAprobar(listos().map((f) => ({ articulo_id: f.articulo_id, ubicacion_id: f.ubicacion_id, minimo: f.propuesta.minimo_sugerido })), k), alTerminar: async (r) => { toast(plural(r.aprobados?.length || 0, 'mínimo aprobado', 'mínimos aprobados') + '.'); await cargar(true); }, zona: zonaP });
        acc.ejecutar();
      } }, `Aprobar los ${nL} listos como se proponen`) : null;
      return [
        h('section.bd-param', h('h3', 'Datos que define la administración'),
          h('p.tenue', 'Mínimo propuesto = consumo por día × días de cobertura, redondeado hacia arriba. El consumo sale de las salidas reales de los últimos 30 días (consumo, venta y merma).'),
          h('div.bd-param-campos', h('label.etq', 'Días de cobertura', h('small', 'Cuántos días de consumo quiere tener siempre en cada local.'), inC),
            h('label.etq', 'Días de historia mínimos', h('small', 'Cuántos días de movimiento hacen confiable el promedio.'), inD)),
          h('p.tenue', p.actualizado_por ? `Última vez: ${p.actualizado_por}, ${fechaHora(p.actualizado_en)}.` : 'Todavía no se han definido.'),
          admin ? guardar : h('p.tenue', 'Solo un administrador puede cambiarlos.'), zonaP),
        h('div.bd-resumen', h('span', h('strong.cifra', num(nL, 0)), ' listos para aprobar'), h('span', h('strong.cifra', num(todas.filter((f) => estadoMin(f)[0] === 'espera').length, 0)), ' esperando historia o datos'), h('span', h('strong.cifra', num(todas.filter((f) => estadoMin(f)[0] === 'aprobado').length, 0)), ' ya aprobados')),
        h('div.bd-filtro-fila', h('div.bd-tabs.dos', { role: 'group', 'aria-label': 'Qué mínimos ver' }, chip('listos', 'Listos para aprobar'), chip('aprobados', 'Ya aprobados'), chip('todos', 'Todos')), bulk),
        ver.length ? h('div.bd-tarjetas', ver.map(tarjetaMinimo)) : h('div.vacio', h('p', est.minFiltro === 'listos' ? 'Todavía no hay propuestas listas. Con el consumo de los próximos días y los dos datos de arriba irán apareciendo; en «Todos» se ve cada artículo con su explicación.' : 'No hay mínimos en esta lista.'))];
    }
    function tarjetaMinimo(f) {
      const [clase, txt] = estadoMin(f), p = f.propuesta, admin = esAdmin();
      let cuerpoAprob = null;
      if (admin && p?.aprobable) {
        const inp = h('input.campo', { type: 'text', inputmode: 'decimal', value: vacioTxt(p.minimo_sugerido), 'aria-label': 'Mínimo a aprobar de ' + f.articulo, autocomplete: 'off' });
        const zona = h('div'), btn = h('button.btn.primario', { type: 'button' }, 'Aprobar este mínimo');
        const acc = accionSegura({ boton: btn, zona, hacer: (k) => { const v = leerCantidad(inp.value); if (!Number.isFinite(v) || v < 0) throw new Error('Escriba el mínimo con números, por ejemplo 12 o 2,5.'); return bodega.minimosAprobar([{ articulo_id: f.articulo_id, ubicacion_id: f.ubicacion_id, minimo: v }], k); },
          alTerminar: async () => { toast('Mínimo aprobado: ' + f.articulo + ' en ' + f.ubicacion + '.'); await cargar(true); } });
        btn.addEventListener('click', () => acc.ejecutar());
        cuerpoAprob = h('div.bd-aprobar', h('label.etq', 'Mínimo a aprobar (puede cambiarlo)', inp), btn, zona);
      }
      return h('article.bd-min.' + clase, h('div.bd-min-cab', h('div', h('strong', f.articulo), h('span.tenue', ' en ' + f.ubicacion)), h('span.bd-chip.' + clase, txt)),
        h('dl.bd-datos', h('div', h('dt', 'Hay hoy'), h('dd.cifra', cantTxt(f.existencia, f.unidad))), h('div', h('dt', 'Mínimo vigente'), h('dd.cifra', f.minimo != null ? cantTxt(f.minimo, f.unidad) : 'Ninguno')),
          p ? h('div', h('dt', 'Consumo 30 días'), h('dd.cifra', cantTxt(p.consumo_30d, f.unidad))) : null, p ? h('div', h('dt', 'Días observados'), h('dd.cifra', num(p.dias_observados, 0))) : null,
          p ? h('div', h('dt', 'Mínimo propuesto'), h('dd.cifra', p.minimo_sugerido != null ? cantTxt(p.minimo_sugerido, f.unidad) : 'Sin calcular')) : null),
        h('p.bd-expl', explicacion(f, par())), cuerpoAprob);
    }

    /* ---------- CONTEO ---------- */
    function vistaConteo() {
      const admin = esAdmin(), pend = lista(est.d.conteos_pendientes), puedeContar = admin || ciego();
      const bloquePend = pend.length ? h('section.bd-pend', h('h3', 'Conteos por decidir'), pendientes(pend, admin)) : h('div.vacio', h('p', 'No hay conteos pendientes.'));
      return [bloquePend, puedeContar ? formConteo(admin) : h('p.tenue', 'Su usuario puede mirar la bodega, no contar.'), admin ? ajustes() : null, admin ? personas() : null];
    }
    function pendientes(pend, admin) {
      const zona = h('div');
      const mot = h('input.campo', { type: 'text', maxlength: 200, placeholder: 'Por ejemplo: faltaba una caja anotada', 'aria-label': 'Motivo', value: est.motivoPend, oninput: (e) => { est.motivoPend = e.target.value; } });
      const fila = (c) => h('li.bd-pend-fila', admin ? h('label.inv-casilla', h('input', { type: 'checkbox', checked: est.sel.has(c.id), onchange: (e) => { e.target.checked ? est.sel.add(c.id) : est.sel.delete(c.id); } }), h('span.solo-lectores', 'Elegir')) : null,
        h('div', h('strong', c.articulo), h('span.tenue', ' en ' + c.ubicacion), h('p.bd-pend-n', `Contado ${cantTxt(c.contado, c.unidad)}` + (c.sistema_al_contar != null ? `; el sistema decía ${cantTxt(c.sistema_al_contar, c.unidad)}; diferencia ${Number(c.diferencia) > 0 ? '+' : ''}${cantTxt(c.diferencia, c.unidad)}.` : '.')),
          h('small.tenue', `${c.contado_por}, ${fechaHora(c.contado_en)}` + (c.nota ? ' · ' + c.nota : '') + (c.sistema_ahora != null && Number(c.sistema_ahora) !== Number(c.sistema_al_contar) ? ` · Ahora el sistema dice ${cantTxt(c.sistema_ahora, c.unidad)}; el ajuste suma la diferencia a lo de ahora.` : ''))));
      if (!admin) return h('ul.bd-pend-lista', pend.map(fila));
      const bA = h('button.btn.primario', { type: 'button' }, 'Aplicar al inventario'), bD = h('button.btn', { type: 'button' }, 'Descartar');
      const exigir = () => { if (!est.sel.size) throw new Error('Marque al menos un conteo.'); if (est.motivoPend.trim().length < 3) throw new Error('Escriba el motivo (al menos 3 letras).'); };
      const aA = accionSegura({ boton: bA, zona, hacer: (k) => { exigir(); return bodega.conteoAplicar([...est.sel], est.motivoPend.trim(), k); }, alTerminar: async (r) => { est.motivoPend = ''; toast(plural(r.renglones?.length || 0, 'ajuste aplicado', 'ajustes aplicados') + '.'); await cargar(true); } });
      const aD = accionSegura({ boton: bD, zona, hacer: async () => { exigir(); return bodega.conteoDescartar([...est.sel], est.motivoPend.trim()); }, alTerminar: async (r) => { est.motivoPend = ''; toast(plural(r.descartados || 0, 'conteo descartado', 'conteos descartados') + '.'); await cargar(true); } });
      bA.addEventListener('click', () => aA.ejecutar()); bD.addEventListener('click', () => aD.ejecutar());
      est.sel = est.sel.size ? est.sel : new Set(pend.map((c) => c.id));
      return [h('ul.bd-pend-lista', pend.map(fila)), h('label.etq', 'Motivo (obligatorio para aplicar o descartar)', mot), h('div.bd-botones', bD, bA), zona];
    }
    function formConteo(admin) {
      const ub = est.conteoLocal;
      const del = filas().filter((f) => f.ubicacion_id === ub && (ciego() || Number(f.existencia) > 0)).sort((a, b) => a.categoria.localeCompare(b.categoria, 'es') || a.articulo.localeCompare(b.articulo, 'es'));
      const sel = h('select.campo', { 'aria-label': 'Local que se cuenta', onchange: (e) => { est.conteoLocal = e.target.value; est.cont = new Map(); pintar(); } }, ubic().map((u) => h('option', { value: u.id, selected: u.id === ub }, u.nombre)));
      const resumen = h('p.tenue.bd-cont-res');
      const dif = new Map();
      const actualizar = () => { const n = [...est.cont.values()].filter((v) => String(v).trim() !== '').length; resumen.textContent = n ? plural(n, 'artículo contado', 'artículos contados') + ' en esta lista.' : 'Escriba solo lo que contó; los demás se dejan en blanco.'; };
      const fil = (f) => {
        const inp = h('input.campo', { type: 'text', inputmode: 'decimal', autocomplete: 'off', 'aria-label': 'Cantidad contada de ' + f.articulo, value: est.cont.get(f.articulo_id) ?? '' });
        const d = h('small.bd-dif');
        const pinta = () => { const v = leerCantidad(inp.value); if (!inp.value.trim()) { d.textContent = ''; d.className = 'bd-dif'; return; } if (!Number.isFinite(v)) { d.textContent = 'Escriba solo números.'; d.className = 'bd-dif mal'; return; } if (admin) { const x = v - Number(f.existencia); d.textContent = x === 0 ? 'Coincide con el sistema' : (x > 0 ? '+' : '') + cantTxt(x, f.unidad); d.className = 'bd-dif' + (x === 0 ? ' ok' : ''); } };
        inp.addEventListener('input', () => { est.cont.set(f.articulo_id, inp.value); pinta(); actualizar(); }); pinta();
        return h('li.bd-cont-fila', h('div', h('span.bd-art', f.articulo), h('small.tenue', f.categoria + (admin ? ' · el sistema dice ' + cantTxt(f.existencia, f.unidad) : ''))), h('div.bd-cont-in', inp, h('span.tenue', f.unidad === 'colon' ? '₡' : ''), d));
      };
      const zona = h('div'), nota = h('input.campo', { type: 'text', maxlength: 200, placeholder: 'Opcional: por ejemplo «conteo de la noche»', 'aria-label': 'Nota del conteo', value: est.nota, oninput: (e) => { est.nota = e.target.value; } });
      const mot = h('input.campo', { type: 'text', maxlength: 200, placeholder: 'Por ejemplo: llegó una caja sin anotar', 'aria-label': 'Motivo del ajuste', value: est.motivo, oninput: (e) => { est.motivo = e.target.value; } });
      const items = () => { const r = []; for (const [id, v] of est.cont) { if (!String(v).trim()) continue; const n = leerCantidad(v); const f = del.find((x) => x.articulo_id === id); if (!Number.isFinite(n) || n < 0) throw new Error('Revise la cantidad de «' + (f?.articulo || 'un artículo') + '»: use solo números.'); r.push({ articulo_id: id, contado: n }); } if (!r.length) throw new Error('Escriba la cantidad contada de al menos un artículo.'); return r; };
      const hecho = async (r) => { est.cont = new Map(); est.nota = ''; est.motivo = ''; const n = r.renglones?.length || 0; toast(plural(n, 'artículo guardado', 'artículos guardados') + '.'); await cargar(true); };
      const bG = h('button.btn' + (admin ? '' : '.primario'), { type: 'button' }, admin ? 'Guardar para decidir después' : 'Enviar el conteo');
      const aG = accionSegura({ boton: bG, zona, hacer: (k) => bodega.conteoGuardar(ub, items(), est.nota, false, null, k), alTerminar: hecho }); bG.addEventListener('click', () => aG.ejecutar());
      let bY = null;
      if (admin) { bY = h('button.btn.primario', { type: 'button' }, 'Guardar y ajustar el inventario'); const aY = accionSegura({ boton: bY, zona, hacer: (k) => { if (est.motivo.trim().length < 3) throw new Error('Escriba el motivo del ajuste (al menos 3 letras).'); return bodega.conteoGuardar(ub, items(), est.nota, true, est.motivo.trim(), k); }, alTerminar: hecho }); bY.addEventListener('click', () => aY.ejecutar()); }
      actualizar();
      return h('section.bd-conteo', h('h3', 'Contar un local'),
        h('p.tenue', ciego() ? 'Cuente lo que hay y escríbalo. Esta lista no muestra lo que dice el sistema, para que el conteo sea independiente.' : 'Escriba lo que contó. Un administrador puede guardar el conteo para decidir después, o ajustar el inventario de una vez con su motivo.'),
        h('label.etq', 'Local o bodega que se cuenta', sel), resumen,
        del.length ? h('ul.bd-cont-lista', del.map(fil)) : h('div.vacio', h('p', 'No hay artículos con existencia en este lugar.')),
        h('label.etq', 'Nota del conteo', nota), admin ? h('label.etq', 'Motivo del ajuste (solo si ajusta el inventario)', mot) : null, h('div.bd-botones', bG, bY), zona);
    }
    function ajustes() {
      const a = lista(est.d.ajustes_recientes);
      return h('section.bd-ajustes', h('h3', 'Ajustes recientes'), h('p.tenue', 'Quién cambió las existencias a mano, cuándo y por qué.'),
        a.length ? h('div.bd-tabla-caja', h('table.bd-tabla', h('thead', h('tr', ['Cuándo', 'Artículo', 'Local', 'Cambio', 'Motivo', 'Quién'].map((t, i) => h('th' + (i === 3 ? '.num' : ''), t)))),
          h('tbody', a.map((m) => h('tr', h('td', { 'data-et': 'Cuándo' }, fechaHora(m.creado_en)), h('td', { 'data-et': 'Artículo' }, m.articulo), h('td', { 'data-et': 'Local' }, m.ubicacion),
            h('td.num', { 'data-et': 'Cambio' }, (Number(m.cantidad) > 0 ? '+' : '') + cantTxt(m.cantidad, m.unidad)), h('td', { 'data-et': 'Motivo' }, m.motivo || ''), h('td', { 'data-et': 'Quién' }, m.usuario || '')))))) : h('div.vacio', h('p', 'Todavía no hay ajustes manuales.')));
    }
    function personas() {
      const caja = h('div.bd-personas');
      const det = h('details.bd-det', h('summary', 'Quién puede contar o mirar la bodega'), caja);
      async function traer() {
        poner(caja, cargando('Cargando personas…'));
        try {
          const r = await bodega.personas(); est.personas = lista(r.personas).filter((p) => !p.admin);
          poner(caja, h('p.tenue', 'Los administradores ya pueden hacerlo todo. «Solo contar» no muestra lo que dice el sistema; «Solo mirar» no puede cambiar nada.'),
            est.personas.length ? h('ul.bd-per-lista', est.personas.map((p) => h('li', h('span', h('strong', p.nombre || p.usuario), h('small.tenue', ' ' + p.usuario)),
              h('select.campo', { 'aria-label': 'Permiso de ' + (p.nombre || p.usuario), onchange: async (e) => { try { await bodega.rolGuardar(p.id, e.target.value); toast('Permiso guardado.'); } catch (x) { toast(textoDeError(x), 'error', 7000); await traer(); } } },
                [['ninguno', 'Sin acceso'], ['conteo', 'Solo contar'], ['lectura', 'Solo mirar']].map(([v, t]) => h('option', { value: v, selected: p.rol_bodega === v }, t)))))) : h('p.tenue', 'No hay otras personas con usuario.'));
        } catch (e) { poner(caja, falla(e, traer, 'No se pudieron cargar las personas')); }
      }
      det.addEventListener('toggle', () => { if (det.open && !est.personas) traer(); });
      return det;
    }

    await cargar();
    return () => { vivo = false; seq++; };
  },
};
