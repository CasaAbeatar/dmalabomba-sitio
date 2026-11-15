// Salidas automáticas del modelo (7 nov 2026): lo que el modelo de salida descuenta solo, por categoría y por producto (fx_inv_modelo_panel, solo administrador, solo lectura).
// Misma forma que Existencias: lo de HOY arriba (con filtros en un toque), filtros, lista en grupos con subtotal, cada fila abre su detalle, y al final el cuadro de totales de lo que se ve.
// Cifras netas (lo descontado menos lo revertido), en colones al costo y sin IVA. Los textos largos del modelo viven en su manual, no aquí.
import { h, money, num, fechaHora, debounce, campoBusqueda } from './util.js';
import { graficoColumnas, autoAjustar } from './graficos.js';
import { inv } from './api_inventarios.js';
import { cargarCssPantallas } from './inv_pantallas_css.js';
import { cargarCss, ventana, cargando, falla, vacio, aviso, cantTxt, dma, plural, enfocar, poner, norm, GRUPOS } from './m_inv_comun.js';

const memoria = { vista: 'categorias', categoria: '', nivel: '', estado: '', q: '' }; // el filtro se conserva al volver atrás
const ESTADOS = { descuenta: 'Descuenta', en_observacion: 'En observación', sin_descuento: 'Sin descuento', inactiva: 'Inactiva' };
const claseEstado = (e) => (e === 'descuenta' ? 'ok' : e === 'en_observacion' ? 'espera' : e === 'sin_descuento' ? 'mal' : '');
const NIVELES = { categoria_completa: 'Categoría completa', por_producto: 'Por producto' };
const nivelTxt = (x) => x.nivel_detalle_texto || NIVELES[x.nivel_detalle] || x.nivel_detalle || '';
const neto = (k) => Number(k.descontado?.neto_crc) || 0;
const pct = (n) => (n == null ? 'sin dato' : num(n, 1) + ' %');

export async function abrir(ctx) {
  await cargarCss(); cargarCssPantallas();
  const est = memoria;
  let vivo = true, seq = 0, datos = null, quitarGrafico = null;
  const vistas = h('div.inv-segmento', { role: 'group', 'aria-label': 'Ver por' });
  const hoyInfo = h('div.inv-resumen');
  const hoyCaja = h('div.inv-hoy-filtros', { role: 'group', 'aria-label': 'Ver solo', hidden: true });
  const categ = h('select.campo', { 'aria-label': 'Categoría', onchange: () => { est.categoria = categ.value; pintar(); } });
  const nivel = h('select.campo', { 'aria-label': 'Nivel de detalle', onchange: () => { est.nivel = nivel.value; pintar(); } },
    h('option', { value: '' }, 'Todos los niveles'), Object.entries(NIVELES).map(([v, t]) => h('option', { value: v }, t)));
  nivel.value = est.nivel;
  const buscar = h('input.campo', { type: 'search', placeholder: 'Nombre de la categoría o del producto', 'aria-label': 'Buscar', autocomplete: 'off', value: est.q });
  buscar.addEventListener('input', debounce(() => { est.q = buscar.value.trim(); pintar(); }, 250));
  const grafCaja = h('div.gr-caja');
  const lectura = h('p.lectura.inv-lectura', { 'aria-live': 'polite' }, 'Toque una columna para ver el detalle de ese día.');
  const grafSec = h('section', h('h3', 'Descontado por día, últimos 14 días'), grafCaja, lectura);
  const lista = h('div.inv-exis', cargando('Cargando las salidas del modelo…'));
  const totales = h('div.inv-resumen');
  const extras = h('div');
  ventana({ titulo: 'Salidas automáticas del modelo', volver: 'Salidas y mermas', contenido: [
    h('div.inv-ventana-cab', h('p', 'Lo que el modelo de salida descuenta solo del inventario, por categoría y por producto. Es solo para mirar: aquí no se cambia nada. Cifras netas (lo descontado menos lo revertido), al costo y sin IVA.')),
    hoyInfo, hoyCaja, vistas,
    h('div.inv-filtros.cuatro', h('label.etq', 'Categoría', categ), h('label.etq', 'Nivel de detalle', nivel), h('label.etq.inv-buscar', 'Buscar', campoBusqueda(buscar, () => { est.q = ''; pintar(); }))),
    grafSec, lista, totales, extras],
  alCerrar: () => { vivo = false; quitarGrafico?.(); } });

  async function cargar() {
    const mia = ++seq;
    try {
      const d = await inv.modeloPanel();
      if (!vivo || mia !== seq) return;
      datos = d;
      poner(categ, h('option', { value: '' }, 'Todas las categorías'), [...(d.categorias || [])].map((k) => k.categoria).sort((a, b) => a.localeCompare(b, 'es')).map((n) => h('option', { value: n }, n)));
      categ.value = est.categoria;
      pintarHoy(); pintar(); pintarExtras();
    } catch (e) { if (vivo && mia === seq) poner(lista, falla(e, () => { poner(lista, cargando('Cargando las salidas del modelo…')); cargar(); }, 'No se pudo cargar el modelo de salidas')); }
  }

  function pintarHoy() {
    const r = datos.resumen || {}, da = r.descontado_acumulado || {}, u = r.unitarios || {};
    const prox = (r.proximas_corridas || []).filter((c) => !c.tecnico);
    poner(hoyInfo, h('h3', 'Hoy'),
      h('ul.inv-datos-lista',
        h('li', h('span', 'El modelo'), h('strong', r.rige_hoy ? 'Rige hoy' + (r.activo_desde ? ', descuenta desde el ' + dma(r.activo_desde) : '') : 'No rige hoy')),
        r.ultima_corrida?.dia_aplicado ? h('li', h('span', 'Último día aplicado'), h('strong', dma(r.ultima_corrida.dia_aplicado) + ' (corrió el ' + fechaHora(r.ultima_corrida.ejecutada_en) + ')')) : null,
        ...prox.map((c) => h('li', h('span', 'Próxima corrida'), h('strong', c.descripcion + ', ' + c.proxima_hora_costa_rica))),
        h('li', h('span', 'Alertas abiertas'), h('strong.cifra' + ((datos.alertas || []).length ? '.mal' : ''), String((datos.alertas || []).length)))),
      r.ventas_reales?.texto ? h('p.tenue.inv-chico', r.ventas_reales.texto) : null);
    est.resumen = { da, u, c: r.categorias || {} };
  }

  const todas = () => (est.vista === 'categorias' ? datos.categorias : datos.productos) || [];
  const textoDe = (x) => norm((x.categoria || '') + ' ' + (x.producto || ''));
  // lo que cumple categoría, nivel y búsqueda (sin el estado: los botones de «Hoy» cuentan sobre esto)
  const base = () => todas().filter((x) => (!est.categoria || x.categoria === est.categoria) && (!est.nivel || x.nivel_detalle === est.nivel) && (!est.q || textoDe(x).includes(norm(est.q))));

  function pintar() {
    if (!datos) return;
    poner(vistas, ...[['categorias', 'Por categoría'], ['productos', 'Por producto']].map(([id, t]) => h('button.btn.inv-seg', { type: 'button', 'aria-pressed': String(est.vista === id), onclick: () => { est.vista = id; pintar(); } }, t, h('span.inv-cuenta', String((id === 'categorias' ? datos.categorias : datos.productos).length)))));
    const b = base();
    const cuenta = (e) => b.filter((x) => x.estado === e).length;
    hoyCaja.hidden = false;
    const btn = (id, clase) => h('button.btn.inv-seg' + (cuenta(id) && clase ? '.' + clase : ''), { type: 'button', 'aria-pressed': String(est.estado === id), onclick: () => { est.estado = est.estado === id ? '' : id; pintar(); } }, ESTADOS[id], h('span.inv-cuenta', String(cuenta(id))));
    poner(hoyCaja, h('span.hoy-et', 'Ver solo'), btn('descuenta'), btn('en_observacion', 'pronto'), btn('sin_descuento', 'urgente'), btn('inactiva'),
      est.estado ? h('button.btn.suave', { type: 'button', onclick: () => { est.estado = ''; pintar(); } }, 'Ver todo') : null);
    const ver = b.filter((x) => !est.estado || x.estado === est.estado);
    pintarGrafico(ver);
    if (!ver.length) { poner(lista, vacio(est.estado || est.categoria || est.nivel || est.q ? 'Nada coincide con esos filtros.' : 'El modelo todavía no tiene datos.')); }
    else {
      const grupos = new Map();
      ver.forEach((x) => { const g = est.vista === 'categorias' ? (GRUPOS[x.grupo] || 'Otras') : x.categoria; if (!grupos.has(g)) grupos.set(g, []); grupos.get(g).push(x); });
      poner(lista, ...[...grupos.entries()].map(([g, xs]) => {
        const sub = est.vista === 'categorias' ? ' · neto ' + money(xs.reduce((s, k) => s + neto(k), 0)) : ' · descontado ' + money(xs.reduce((s, p) => s + (Number(p.descontado_crc) || 0), 0));
        return h('section.inv-exis-grupo', h('h3.inv-grupo-tit', g, h('small.tenue', plural(xs.length, est.vista === 'categorias' ? 'categoría' : 'producto', est.vista === 'categorias' ? 'categorías' : 'productos') + sub)),
          h('div.inv-exis-lista', xs.map(est.vista === 'categorias' ? filaCategoria : filaProducto)));
      }));
    }
    pintarTotales(ver);
  }

  function pintarGrafico(ver) {
    quitarGrafico?.(); quitarGrafico = null;
    const nombres = new Set(ver.map((x) => x.categoria));
    const cats = (datos.categorias || []).filter((k) => nombres.has(k.categoria));
    const porDia = new Map();
    cats.forEach((k) => (k.descontado?.dias14 || []).forEach((d) => porDia.set(d.fecha, (porDia.get(d.fecha) || 0) + (Number(d.monto) || 0))));
    const dias = [...porDia.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    grafSec.hidden = !dias.length;
    if (!dias.length) return;
    lectura.textContent = 'Toque una columna para ver el detalle de ese día.';
    const d = dias.map(([f, v]) => ({ etiqueta: f.slice(8, 10), valor: Math.round(v * 100) / 100, texto: dma(f) + ': descontado neto ' + money(v) + ', al costo sin IVA.' }));
    quitarGrafico = autoAjustar(grafCaja, (w) => poner(grafCaja, graficoColumnas(d, {
      ancho: w, alto: 240, tituloX: 'Día de consumo, del ' + dma(dias[0][0]) + ' al ' + dma(dias[dias.length - 1][0]), tituloY: 'Descontado neto en colones', color: 'ambar', anchoEtiqueta: 26,
      descripcion: 'Lo que el modelo descontó cada día, en colones netos al costo sin IVA, de lo que muestran los filtros', alSeleccionar: (x) => { lectura.textContent = x.texto; } })));
  }

  function filaCategoria(k) {
    const chips = [h('span.chip' + (claseEstado(k.estado) ? '.' + claseEstado(k.estado) : ''), k.estado_texto || ESTADOS[k.estado] || k.estado), h('span.chip', nivelTxt(k))];
    return h('button.inv-exis-fila', { type: 'button', onclick: () => detalleCategoria(k), 'aria-label': 'Ver el detalle de ' + k.categoria },
      h('span.inv-exis-art', h('strong', k.categoria), h('small', [k.tasa_diaria ? 'Tasa: ' + num(k.tasa_diaria.valor, 1) + ' ' + k.tasa_diaria.unidad : 'Sin tasa todavía', 'Saldo ' + money(k.saldo?.valor_crc || 0)].join(' · '))),
      h('span.inv-exis-cant.cifra', 'Neto ' + money(neto(k))),
      h('span.inv-exis-chips', chips),
      h('span.inv-exis-val.cifra', 'Bruto ' + money(k.descontado?.bruto_crc || 0)),
      h('span.inv-exis-ver', 'Ver detalle'));
  }
  function filaProducto(p) {
    const desc = p.descontado_unidades != null ? cantTxt(p.descontado_unidades, 'unidad') + ' (' + money(p.descontado_crc || 0) + ')' : money(p.descontado_crc || 0);
    const chips = [h('span.chip' + (claseEstado(p.estado) ? '.' + claseEstado(p.estado) : ''), ESTADOS[p.estado] || p.estado || ''), h('span.chip', p.origen_texto || p.origen || ''), h('span.chip' + (p.elegible ? '.ok' : ''), p.elegible ? 'Elegible' : 'No elegible')];
    return h('button.inv-exis-fila', { type: 'button', onclick: () => detalleProducto(p), 'aria-label': 'Ver el detalle de ' + p.producto },
      h('span.inv-exis-art', h('strong', p.producto), h('small', [p.categoria, nivelTxt(p)].filter(Boolean).join(' · '))),
      h('span.inv-exis-cant.cifra', 'Descontado ' + desc),
      h('span.inv-exis-chips', chips),
      h('span.inv-exis-val.cifra', 'Tasa ' + num(p.tasa_diaria, 2) + ' ' + (p.unidad_tasa || '')),
      h('span.inv-exis-ver', 'Ver detalle'));
  }

  function pintarTotales(ver) {
    const cats = est.vista === 'categorias' ? ver : (datos.categorias || []).filter((k) => new Set(ver.map((x) => x.categoria)).has(k.categoria));
    const suma = (f) => cats.reduce((s, k) => s + (Number(k.descontado?.[f]) || 0), 0);
    const da = est.resumen?.da || {}, c = est.resumen?.c || {}, u = est.resumen?.u || {};
    const filtrado = est.estado || est.categoria || est.nivel || est.q;
    poner(totales, h('h3', 'Lo que se ve'),
      h('ul.inv-datos-lista',
        h('li', h('span', 'Descontado neto (reversas ya restadas)'), h('strong.cifra', money(suma('neto_crc')))),
        h('li', h('span', 'Descontado bruto (dato aparte)'), h('strong.cifra', money(suma('bruto_crc')))),
        h('li', h('span', 'Revertido'), h('strong.cifra', money(suma('revertido_crc')))),
        h('li', h('span', 'Saldo de esas categorías'), h('strong.cifra', money(cats.reduce((s, k) => s + (Number(k.saldo?.valor_crc) || 0), 0))))),
      h('p.tenue.inv-chico', filtrado ? 'Solo de lo que coincide con los filtros de arriba.' : 'De todas las categorías.'),
      h('h3', 'De todo el modelo'),
      h('ul.inv-datos-lista',
        h('li', h('span', 'Categorías que descuentan'), h('strong.cifra', (c.descuentan ?? 0) + ' de ' + (c.activas ?? 0) + ' activas')),
        h('li', h('span', 'En observación · sin descuento · inactivas'), h('strong.cifra', (c.en_observacion ?? 0) + ' · ' + (c.sin_descuento ?? 0) + ' · ' + (c.inactivas ?? 0))),
        h('li', h('span', 'Productos con descuento propio (descuentan · elegibles · total)'), h('strong.cifra', (u.cubiertos ?? 0) + ' · ' + (u.elegibles ?? 0) + ' · ' + (u.productos ?? 0))),
        h('li', h('span', 'Descontado neto acumulado'), h('strong.cifra', money(da.neto_crc || 0))),
        h('li', h('span', 'Descontado bruto acumulado'), h('strong.cifra', money(da.bruto_crc || 0))),
        h('li', h('span', 'Revertido acumulado'), h('strong.cifra', money(da.revertido_crc || 0)))),
      da.nota ? h('p.tenue.inv-chico', da.nota) : null);
  }

  function pintarExtras() {
    const al = datos.alertas || [], gl = datos.glosario || [], nt = datos.nota_tecnica_transicion;
    poner(extras,
      al.length ? h('section.inv-resumen', h('h3', 'Alertas abiertas'), al.map((a) => aviso('espera', h('p', a.texto || a.mensaje || JSON.stringify(a))))) : null,
      gl.length ? h('details.inv-resumen', h('summary', h('strong', 'Glosario: qué quiere decir cada término')), h('dl', gl.map((g) => [h('dt', h('strong', g.termino)), h('dd', g.texto)]))) : null,
      nt ? h('details.inv-resumen', h('summary', h('strong', nt.titulo || 'Nota técnica de transición')), h('p.tenue.inv-chico', nt.texto)) : null,
      h('p.tenue.inv-chico', 'Datos al ' + dma(datos.fecha_de_corte) + '.'));
  }

  // detalle de una categoría: misma ventana de detalle que los lotes de Existencias
  function detalleCategoria(k) {
    const d = k.descontado || {}, e = k.evidencia || {}, cal = k.calibracion || {}, uc = k.ultima_corrida || {};
    const caja = h('div.gr-caja'); const lect = h('p.lectura.inv-lectura', 'Toque una columna para ver el detalle de ese día.');
    const dias = (d.dias14 || []).slice().sort((a, b) => a.fecha.localeCompare(b.fecha));
    let quitar = null;
    const prods = (datos.productos || []).filter((p) => p.categoria === k.categoria && p.nivel_detalle === 'por_producto');
    ventana({ titulo: k.categoria, volver: 'Salidas automáticas del modelo', contenido: [
      h('div.inv-ventana-cab', h('p', h('span.chip' + (claseEstado(k.estado) ? '.' + claseEstado(k.estado) : ''), k.estado_texto || ESTADOS[k.estado]), ' ', h('span.chip', nivelTxt(k)), ' · Saldo ', h('strong', money(k.saldo?.valor_crc || 0)), ' sin IVA'),
        k.motivo ? h('p', k.motivo) : null),
      dias.length ? h('section', h('h3', 'Descontado por día, últimos 14 días'), caja, lect) : null,
      h('div.inv-resumen', h('h3', 'Lo descontado'),
        h('ul.inv-datos-lista',
          h('li', h('span', 'Neto (reversas ya restadas)'), h('strong.cifra', money(neto(k)))),
          h('li', h('span', 'Bruto'), h('strong.cifra', money(d.bruto_crc || 0))),
          h('li', h('span', 'Revertido'), h('strong.cifra', money(d.revertido_crc || 0))),
          d.primer_dia ? h('li', h('span', 'Primer día descontado'), h('strong', dma(d.primer_dia))) : null,
          d.ultimo_dia ? h('li', h('span', 'Último día descontado'), h('strong', dma(d.ultimo_dia))) : null,
          k.tasa_diaria ? h('li', h('span', 'Tasa diaria estimada'), h('strong.cifra', num(k.tasa_diaria.valor, 2) + ' ' + k.tasa_diaria.unidad)) : null)),
      uc.dia ? h('div.inv-resumen', h('h3', 'Última corrida (día ' + dma(uc.dia) + ')'),
        h('ul.inv-datos-lista',
          h('li', h('span', 'Saldo antes de descontar'), h('strong.cifra', money(uc.saldo_antes || 0))),
          h('li', h('span', 'Lo que el modelo pedía descontar'), h('strong.cifra', money(uc.pedido || 0))),
          h('li', h('span', 'Reserva que debe quedar'), h('strong.cifra', money(uc.reserva || 0))),
          h('li', h('span', 'Lo que se descontó'), h('strong.cifra', money(uc.descontado || 0))))) : null,
      h('div.inv-resumen', h('h3', 'Qué tan bien acierta'),
        h('ul.inv-datos-lista',
          h('li', h('span', 'Error del modelo'), h('strong.cifra', pct(e.error_modelo_pct))),
          h('li', h('span', 'Error de un cálculo simple, para comparar'), h('strong.cifra', pct(e.error_calculo_simple_pct))),
          h('li', h('span', 'Días de compra que usa'), h('strong.cifra', e.dias_de_compra != null ? num(e.dias_de_compra, 0) : 'sin dato')),
          h('li', h('span', 'Pruebas con datos históricos'), h('strong.cifra', e.pruebas_historicas != null ? num(e.pruebas_historicas, 0) : 'sin dato')),
          h('li', h('span', 'Factor de calibración'), h('strong.cifra', cal.factor_actual != null ? num(cal.factor_actual, 3) : 'sin dato')),
          cal.factor_origen ? h('li', h('span', 'De dónde sale ese factor'), h('strong', cal.factor_origen)) : null,
          cal.proximo_conteo ? h('li', h('span', 'Próximo conteo físico'), h('strong', dma(cal.proximo_conteo))) : null)),
      (k.notas || []).length ? h('div.inv-resumen', h('h3', 'Notas'), k.notas.map((n) => h('p.tenue.inv-chico', n))) : null,
      prods.length ? h('section.inv-exis-grupo', h('h3.inv-grupo-tit', 'Productos de esta categoría', h('small.tenue', plural(prods.length, 'producto', 'productos'))), h('div.inv-exis-lista', prods.map(filaProducto))) : null],
    alCerrar: () => quitar?.() });
    if (dias.length) {
      const dd = dias.map((x) => ({ etiqueta: x.fecha.slice(8, 10), valor: Number(x.monto) || 0, texto: dma(x.fecha) + ': descontado neto ' + money(x.monto) + ', al costo sin IVA.' }));
      quitar = autoAjustar(caja, (w) => poner(caja, graficoColumnas(dd, { ancho: w, alto: 220, tituloX: 'Día de consumo, del ' + dma(dias[0].fecha) + ' al ' + dma(dias[dias.length - 1].fecha), tituloY: 'Descontado neto en colones', color: 'ambar', anchoEtiqueta: 26,
        descripcion: 'Lo que el modelo descontó cada día de ' + k.categoria + ', en colones netos al costo sin IVA', alSeleccionar: (x) => { lect.textContent = x.texto; } })));
    }
  }

  function detalleProducto(p) {
    const e = p.evidencia || {};
    ventana({ titulo: p.producto, volver: 'Salidas automáticas del modelo', contenido: [
      h('div.inv-ventana-cab', h('p', h('span.chip' + (claseEstado(p.estado) ? '.' + claseEstado(p.estado) : ''), ESTADOS[p.estado] || p.estado), ' ', h('span.chip', p.origen_texto || p.origen || ''), ' ', h('span.chip' + (p.elegible ? '.ok' : ''), p.elegible ? 'Elegible' : 'No elegible'), ' · ', p.categoria), p.motivo ? h('p', p.motivo) : null),
      h('div.inv-resumen', h('h3', 'Lo descontado'),
        h('ul.inv-datos-lista',
          h('li', h('span', 'Descontado'), h('strong.cifra', p.descontado_unidades != null ? cantTxt(p.descontado_unidades, 'unidad') + ' · ' + money(p.descontado_crc || 0) : money(p.descontado_crc || 0))),
          h('li', h('span', 'Estimado del período'), h('strong.cifra', money(p.estimado_periodo || 0))),
          h('li', h('span', 'Real del período'), h('strong.cifra', money(p.real_periodo || 0))),
          h('li', h('span', 'Tasa diaria'), h('strong.cifra', num(p.tasa_diaria, 2) + ' ' + (p.unidad_tasa || ''))),
          p.dias_observados != null ? h('li', h('span', 'Días observados'), h('strong.cifra', num(p.dias_observados, 0))) : null)),
      h('div.inv-resumen', h('h3', 'Qué tan bien acierta'),
        h('ul.inv-datos-lista',
          h('li', h('span', 'Error del modelo'), h('strong.cifra', pct(e.error_modelo_pct))),
          h('li', h('span', 'Error de un cálculo simple, para comparar'), h('strong.cifra', pct(e.error_calculo_simple_pct))),
          h('li', h('span', 'Días de compra que usa'), h('strong.cifra', e.dias_de_compra != null ? num(e.dias_de_compra, 0) : 'sin dato')),
          h('li', h('span', 'Pruebas con datos históricos'), h('strong.cifra', e.pruebas_historicas != null ? num(e.pruebas_historicas, 0) : 'sin dato'))))] });
  }

  await cargar();
  enfocar(lista.closest('.modal-cuerpo'));
}
