// Mover por categoría (7 nov 2026): se escoge la bodega de donde sale, se entra a una categoría (p. ej. Carnes y aves),
// se ven los productos que hay allí y se marcan los que van a otra bodega (con «Todo» o una cantidad). Usa el mismo traslado de siempre (inv.trasladar, primero lo que vence primero).
import { h, money } from './util.js';
import { inv } from './api_inventarios.js';
import { formulario } from './m_inv_mover.js';
import { cargarCssPantallas } from './inv_pantallas_css.js';
import { cargarCss, poner, cargando, falla, vacio, aviso, cantTxt, campoCantidad, selectUbicacion, nombreUbicacion, repetidaTxt, plural, norm, dma } from './m_inv_comun.js';

export async function formTrasladoCategoria(ctx, pre = {}) {
  cargarCss(); cargarCssPantallas();
  const cat = ctx.cat;
  const bodega = (cat.ubicaciones || []).find((u) => u.tipo === 'bodega' && u.predeterminada && u.activo !== false);
  let origen = pre.origen || bodega?.id || '';
  let categoria = (cat.categorias || []).find((c) => c.id === pre.categoriaId)?.nombre || '';
  let q = '';
  let filas = [];            // existencias del origen
  let seq = 0;
  const marcadas = new Map(); // articulo_id -> { f, campo }
  const unidades = new Map();
  const selO = selectUbicacion(cat, { valor: origen, etiqueta: 'Desde dónde', alCambiar: (v) => { origen = v; marcadas.clear(); pintarDestino(); cargar(); } });
  const destCaja = h('div');
  let selD = null;
  const pintarDestino = () => { const prev = selD?.value; selD = selectUbicacion(cat, { valor: prev && prev !== origen ? prev : '', etiqueta: 'Hacia dónde', excluir: origen }); poner(destCaja, h('label.etq', 'Hacia dónde', selD)); };
  pintarDestino();
  const motivo = h('input.campo', { type: 'text', maxlength: 200, 'aria-label': 'Motivo (opcional)', placeholder: 'Por ejemplo: para el turno de la noche' });
  const catsCaja = h('div.inv-mc-cats', { role: 'group', 'aria-label': 'Categoría' });
  const buscar = h('input.campo', { type: 'search', placeholder: 'Buscar en esta categoría', 'aria-label': 'Buscar', autocomplete: 'off' });
  buscar.addEventListener('input', () => { q = norm(buscar.value); pintarLista(); });
  const lista = h('div.inv-mc-lista', cargando('Cargando productos…'));
  const resumen = h('p.inv-mc-resumen', { 'aria-live': 'polite' });

  const disponible = (f) => Math.max(0, Number(f.cantidad) - Number(f.cantidad_vencida || 0));

  async function cargar() {
    const mia = ++seq;
    poner(lista, cargando('Cargando productos…'));
    if (!origen) { poner(lista, vacio('Escoja primero desde qué bodega o local sale.')); return; }
    try {
      const d = await inv.existencias(origen, null, '', false);
      if (mia !== seq) return;
      filas = (d.filas || []).filter((f) => disponible(f) > 0);
      filas.forEach((f) => unidades.set(f.articulo_id, f.unidad));
      if (categoria && !filas.some((f) => f.categoria === categoria)) categoria = '';
      pintarCats(); pintarLista();
    } catch (e) { if (mia === seq) poner(lista, falla(e, cargar, 'No se pudieron cargar los productos')); }
  }
  function pintarCats() {
    const nombres = [...new Set(filas.map((f) => f.categoria || 'Sin categoría'))].sort((a, b) => a.localeCompare(b, 'es'));
    const btn = (nom, txt, n) => h('button.btn.inv-seg', { type: 'button', 'aria-pressed': String(categoria === nom), onclick: () => { categoria = nom; pintarCats(); pintarLista(); } }, txt, h('span.inv-cuenta', String(n)));
    poner(catsCaja, btn('', 'Todas', filas.length), ...nombres.map((n) => btn(n === 'Sin categoría' ? '__sin' : n, n, filas.filter((f) => (f.categoria || 'Sin categoría') === n).length)));
  }
  function actualizarResumen() {
    const n = marcadas.size;
    resumen.textContent = n ? 'Va a mover ' + plural(n, 'producto', 'productos') + (selD?.value ? ' a ' + nombreUbicacion(cat, selD.value) : '') + '.' : 'Marque los productos que quiere mover y escriba cuánto de cada uno.';
  }
  function pintarLista() {
    const ver = filas.filter((f) => {
      const c = f.categoria || 'Sin categoría';
      if (categoria === '__sin' ? c !== 'Sin categoría' : categoria && c !== categoria) return false;
      return !q || norm(f.articulo).includes(q);
    });
    if (!ver.length) { poner(lista, vacio(q ? 'Ningún producto coincide con la búsqueda.' : 'No hay productos disponibles aquí.')); actualizarResumen(); return; }
    poner(lista, ver.map((f) => {
      const hay = disponible(f);
      const previo = marcadas.get(f.articulo_id);
      const campo = previo?.campo || campoCantidad({ etiqueta: 'Cuánto', unidad: f.unidad });
      const chk = h('input', { type: 'checkbox', 'aria-label': 'Mover ' + f.articulo, checked: !!previo });
      const todo = h('button.btn.chico', { type: 'button', onclick: () => { campo.poner(hay); chk.checked = true; marcadas.set(f.articulo_id, { f, campo }); actualizarResumen(); } }, 'Todo');
      chk.addEventListener('change', () => { if (chk.checked) marcadas.set(f.articulo_id, { f, campo }); else marcadas.delete(f.articulo_id); actualizarResumen(); });
      campo.input.addEventListener('input', () => { if (campo.input.value.trim() && !chk.checked) { chk.checked = true; marcadas.set(f.articulo_id, { f, campo }); actualizarResumen(); } });
      return h('div.inv-mc-fila' + (previo ? '.marcada' : ''),
        h('label.inv-mc-nombre', chk, h('span', h('strong', f.articulo), h('small.tenue', ' Hay ' + cantTxt(hay, f.unidad) + (f.proximo_vencimiento ? ' · vence ' + dma(f.proximo_vencimiento) : '')))),
        h('div.inv-mc-cant', campo.el, todo));
    }));
    actualizarResumen();
  }

  const mia = formulario({ titulo: 'Mover productos por categoría', boton: 'Mover lo marcado', ocupado: 'Trasladando…',
    partes: [
      h('div.inv-form-fila', h('label.etq', 'Desde dónde', selO), destCaja),
      h('h3', 'Entre a una categoría'), catsCaja,
      h('label.etq', 'Buscar', buscar), lista, resumen,
      h('label.etq', 'Motivo (opcional)', motivo)],
    hacer: (idem) => {
      if (!origen) throw new Error('Escoja desde dónde sale.');
      if (!selD.value) throw new Error('Escoja hacia dónde va.');
      if (!marcadas.size) throw new Error('Marque al menos un producto.');
      const items = [];
      for (const [id, { f, campo }] of marcadas) {
        const v = campo.leer();
        if (!campo.valido()) throw new Error('Escriba cuánto mover de «' + f.articulo + '» (o toque «Todo»).');
        if (v > disponible(f) + 1e-9) throw new Error('De «' + f.articulo + '» solo hay ' + cantTxt(disponible(f), f.unidad) + ' que se pueden mover.');
        items.push({ articulo_id: id, cantidad: Math.round(v * 1000) / 1000 });
      }
      const m = motivo.value.trim().replace(/\s+/g, ' ');
      if (m && m.length < 3) throw new Error('El motivo tiene que tener al menos 3 letras, o déjelo vacío.');
      return inv.trasladar(origen, selD.value, items, m || null, idem);
    },
    resultado: (r, { repetida }) => aviso('ok', h('p', h('strong', 'Listo: se trasladó de ' + nombreUbicacion(cat, r.origen_id) + ' a ' + nombreUbicacion(cat, r.destino_id) + '.'), ' Valor al costo, sin IVA: ' + money(r.valor_total) + '.' + repetidaTxt(repetida)),
      h('ul.inv-res-lista', (r.items || []).map((it) => h('li', it.articulo + ': ' + cantTxt(it.cantidad, unidades.get(it.articulo_id)) + ' (' + money(it.valor) + ')')))),
    otro: () => formTrasladoCategoria(ctx, { origen, categoriaId: '' }),
    alFallar: (e) => { if (e?.codigo === 'P0001') cargar(); } });
  void mia;
  await cargar();
}
