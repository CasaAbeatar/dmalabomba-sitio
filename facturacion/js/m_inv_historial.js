// Historial: el libro de movimientos (fx_inv_movimientos), de solo agregar. Abre con lo de HOY; se puede ver cualquier periodo de hasta 400 días,
// por tipo, por bodega o local y buscando por artículo, motivo o persona. Cada fila dice quién la hizo, por qué y de qué empresa venía la mercadería.
import { h, money, fechaHora, horaCorta, debounce, campoBusqueda } from './util.js';
import { selectorPeriodo, textoRango } from './periodo.js';
import { inv } from './api_inventarios.js';
import { ventana, cargando, falla, vacio, aviso, cantTxt, plural, chipEmpresaId, selectUbicacion, enfocar, norm, numFactura, poner } from './m_inv_comun.js';

const dias = (a, b) => Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400000);

export async function abrir(ctx, _id, pedido = {}) {
  const cat = ctx.cat;
  const est = { tipo: pedido.tipo || '', ubicacion: '', q: '', datos: null };
  let vivo = true, seq = 0;
  const periodo = selectorPeriodo({ inicial: 'hoy', alCambiar: () => cargar() });
  const tipo = h('select.campo', { 'aria-label': 'Tipo de movimiento', onchange: () => { est.tipo = tipo.value; cargar(); } },
    h('option', { value: '' }, 'Todos los tipos'), (cat.tipos_movimiento || []).filter((t) => t.codigo !== 'venta').map((t) => h('option', { value: t.codigo, selected: t.codigo === est.tipo }, t.nombre)));
  const ubic = selectUbicacion(cat, { todas: true, soloActivas: false, etiqueta: 'Bodega o local', alCambiar: (v) => { est.ubicacion = v; cargar(); } });
  const buscar = h('input.campo', { type: 'search', placeholder: 'Artículo, motivo o persona', 'aria-label': 'Buscar en el historial', autocomplete: 'off' });
  buscar.addEventListener('input', debounce(() => { est.q = buscar.value.trim(); if (est.datos) pintar(); }, 200));
  const rotulo = h('p.inv-rotulo');
  const lista = h('div.inv-hist', cargando('Cargando el historial…'));
  const resumen = h('div.inv-resumen');
  const alCambio = () => { if (vivo) cargar(); };
  document.addEventListener('inv:cambio', alCambio);
  const v = ventana({ titulo: 'Historial', contenido: [
    h('div.inv-ventana-cab', h('p', 'Todas las entradas y salidas del inventario, con quién las hizo y por qué. Nada se borra: una corrección queda como otro movimiento.')),
    h('div.tarjeta.inv-periodo', periodo.el),
    h('div.inv-filtros.cuatro', h('label.etq', 'Tipo', tipo), h('label.etq', 'Bodega o local', ubic), h('label.etq.inv-buscar', 'Buscar', campoBusqueda(buscar, () => { est.q = ''; pintar(); }))),
    rotulo, lista, resumen], alCerrar: () => { vivo = false; document.removeEventListener('inv:cambio', alCambio); } });

  async function cargar() {
    const mia = ++seq;
    const [desde, hasta] = periodo.rango();
    if (dias(desde, hasta) > 400) { poner(lista, aviso('espera', h('p', 'Escoja un periodo de 400 días o menos.'))); poner(resumen, ); return; }
    rotulo.textContent = 'Movimientos ' + (desde === hasta && desde === ctx.hoy ? 'de hoy, ' : '') + textoRango(desde, hasta) + '. Lo más reciente va primero.';
    poner(lista, cargando('Cargando el historial…'));
    try {
      const d = await inv.movimientos(desde, hasta, { tipo: est.tipo || null, ubicacion: est.ubicacion || null, limite: 2000 });
      if (!vivo || mia !== seq) return;
      est.datos = d; pintar();
    } catch (e) { if (vivo && mia === seq) poner(lista, falla(e, cargar, 'No se pudo cargar el historial')); }
  }
  function pintar() {
    const t = norm(est.q);
    const filas = (est.datos.filas || []).filter((m) => !t || norm([m.articulo, m.motivo, m.usuario_nombre, m.usuario, m.tipo_nombre].join(' ')).includes(t));
    if (!filas.length) { poner(lista, vacio(t ? 'Nada coincide con «' + est.q + '».' : 'No hubo movimientos en este periodo.')); poner(resumen, ); return; }
    const porDia = new Map();
    filas.forEach((m) => { const d = m.fecha || String(m.creado_en).slice(0, 10); if (!porDia.has(d)) porDia.set(d, []); porDia.get(d).push(m); });
    poner(lista, ...[...porDia.entries()].map(([d, ms]) => h('section.inv-hist-dia', h('h3.inv-grupo-tit', d === ctx.hoy ? 'Hoy' : textoRango(d, d), h('span.inv-cuenta', String(ms.length))),
      h('ul.inv-movs', ms.map((m) => h('li.inv-mov.completo',
        h('span.inv-mov-hora.cifra', horaCorta(m.creado_en)),
        h('span.inv-mov-dato',
          h('strong', m.articulo), h('span.inv-mov-tipo' + (Number(m.cantidad) < 0 ? '.sale' : '.entra'), m.tipo_nombre),
          h('small', m.ubicacion + (m.contraparte_ubicacion ? (Number(m.cantidad) < 0 ? ' → hacia ' : ' ← desde ') + m.contraparte_ubicacion : '')),
          m.motivo ? h('small', 'Por qué: «' + m.motivo + '»' + (m.dias_vencido ? ' (' + plural(m.dias_vencido, 'día vencido', 'días vencido') + ')' : '')) : null,
          h('small', 'Lo hizo: ' + (m.usuario === 'sistema' ? 'el sistema, solo (vencimiento de las 5:30)' : m.usuario_nombre || m.usuario || 'sin dato') + ' · ' + fechaHora(m.creado_en)),
          h('span.inv-mov-extra', chipEmpresaId(cat, m.sociedad_origen_id, m.sociedad_origen_nombre),
            m.factura_clave ? h('button.btn.chico', { type: 'button', onclick: async () => (await import('./m_inv_recibir.js')).abrirFactura(ctx, m.factura_clave) }, 'Ver la factura' + (m.factura_linea ? ' (línea ' + m.factura_linea + ')' : '')) : null,
            m.nota_clave ? h('small', 'Nota de proveedor N.° ' + numFactura(String(m.nota_clave).slice(21, 41))) : null)),
        h('span.inv-mov-cant.cifra' + (Number(m.cantidad) < 0 ? '.sale' : '.entra'), (Number(m.cantidad) > 0 ? '+' : '') + cantTxt(m.cantidad, m.unidad)),
        h('span.inv-mov-val.cifra', money(m.valor))))))),
    est.datos.truncado ? aviso('espera', h('p', 'Hay más de 2 000 movimientos: se muestran los más recientes. Escoja un periodo más corto o un tipo.')) : null);
    // Agregados del periodo: lo que entró y lo que salió, al costo sin IVA
    const entra = filas.filter((m) => Number(m.valor) > 0).reduce((s, m) => s + Number(m.valor), 0);
    const sale = filas.filter((m) => Number(m.valor) < 0).reduce((s, m) => s + Number(m.valor), 0);
    const porTipo = new Map();
    filas.forEach((m) => { const x = porTipo.get(m.tipo_nombre) || { n: 0, v: 0 }; x.n++; x.v += Number(m.valor) || 0; porTipo.set(m.tipo_nombre, x); });
    poner(resumen, h('h3', 'Resumen de lo que se ve'),
      h('ul.inv-datos-lista',
        h('li', h('span', 'Entró (al costo, sin IVA)'), h('strong.cifra', money(entra))),
        h('li', h('span', 'Salió (al costo, sin IVA)'), h('strong.cifra', money(-sale))),
        ...[...porTipo.entries()].map(([n, x]) => h('li', h('span', n), h('strong.cifra', plural(x.n, 'movimiento', 'movimientos') + ' · ' + money(x.v))))),
      h('p.tenue.inv-chico', 'Las salidas se restan (valor negativo).'));
  }
  await cargar();
  enfocar(v.cuerpo);
}
