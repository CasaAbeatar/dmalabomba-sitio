// Piezas que comparten Cotizaciones y Pedidos fijos: el editor de líneas (producto, cantidad, precio, nota) y el buscador de cliente.
import { h, money, r2, leerNumero, debounce, textoDeError } from './util.js';
import { api } from './api.js';

export const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
export const num3 = (n) => new Intl.NumberFormat('es-CR', { maximumFractionDigits: 3 }).format(Number(n) || 0);

// Editor de líneas. productos: [{ id, nombre, precio_final }]. inicial: [{ producto_id, cantidad, precio, nota }].
// Devuelve { el, leer() → [{ producto_id, cantidad, precio, nota }] (lanza Error con texto claro si algo falta), total() }.
export function editorLineas(productos, inicial = [], { alCambiar } = {}) {
  const lista = h('div.cot-lineas');
  const totalEl = h('strong.cot-total-num', money(0));
  const filas = [];
  const porId = new Map(productos.map((p) => [p.id, p]));
  const recalcular = () => { totalEl.textContent = money(filas.reduce((s, f) => s + (f.valido() ? r2(f.cant() * f.prec()) : 0), 0)); alCambiar?.(); };
  function agregar(l = {}) {
    const sel = h('select.campo', { 'aria-label': 'Producto' }, h('option', { value: '' }, 'Escoja un producto…'),
      productos.map((p) => h('option', { value: p.id, selected: p.id === l.producto_id }, p.nombre)));
    const cant = h('input.campo', { type: 'text', inputmode: 'decimal', autocomplete: 'off', value: l.cantidad != null ? String(l.cantidad) : '1', 'aria-label': 'Cantidad' });
    const prec = h('input.campo', { type: 'text', inputmode: 'decimal', autocomplete: 'off', value: l.precio != null ? String(l.precio) : '', placeholder: 'Precio', 'aria-label': 'Precio con IVA incluido' });
    const nota = h('input.campo', { type: 'text', maxlength: 200, autocomplete: 'off', value: l.nota || '', placeholder: 'Nota (opcional)', 'aria-label': 'Nota de la línea' });
    const sub = h('span.cot-sub', money(0));
    const f = {
      sel, cant: () => leerNumero(cant.value) ?? NaN, prec: () => leerNumero(prec.value) ?? NaN,
      valido: () => !!sel.value && f.cant() > 0 && f.prec() > 0,
      leer: () => ({ producto_id: sel.value, cantidad: f.cant(), precio: f.prec(), nota: nota.value.trim() || null }),
    };
    const pintarSub = () => { sub.textContent = f.valido() ? money(r2(f.cant() * f.prec())) : money(0); recalcular(); };
    sel.addEventListener('change', () => { const p = porId.get(sel.value); if (p && !prec.value.trim()) prec.value = String(Number(p.precio_final) || ''); else if (p && Number(p.precio_final) > 0) prec.value = String(Number(p.precio_final)); pintarSub(); });
    cant.addEventListener('input', pintarSub); prec.addEventListener('input', pintarSub);
    const quitar = h('button.btn.cot-quitar', { type: 'button', 'aria-label': 'Quitar esta línea', onclick: () => { if (filas.length <= 1) return; filas.splice(filas.indexOf(f), 1); fila.remove(); recalcular(); } }, 'Quitar');
    const fila = h('div.cot-linea', h('div.cot-l-prod', sel), h('label.cot-l-cant', h('span', 'Cantidad'), cant), h('label.cot-l-prec', h('span', 'Precio'), prec), h('div.cot-l-sub', h('span', 'Total'), sub), h('div.cot-l-nota', nota), quitar);
    f.fila = fila; filas.push(f); lista.append(fila); pintarSub();
    return f;
  }
  (inicial.length ? inicial : [{}]).forEach(agregar);
  const el = h('div.cot-editor', lista,
    h('div.cot-editor-pie', h('button.btn', { type: 'button', onclick: () => { const f = agregar({}); f.sel.focus(); } }, 'Agregar otra línea'), h('div.cot-total', h('span', 'Total (IVA incluido)'), totalEl)));
  return {
    el,
    total: () => r2(filas.reduce((s, f) => s + (f.valido() ? f.cant() * f.prec() : 0), 0)),
    leer() {
      const l = [];
      filas.forEach((f, i) => {
        if (!f.sel.value && !(f.prec() > 0) && filas.length > 1) return; // línea vacía: se ignora
        if (!f.sel.value) throw new Error('Línea ' + (i + 1) + ': escoja el producto.');
        if (!(f.cant() > 0)) throw new Error('Línea ' + (i + 1) + ': escriba una cantidad mayor que cero.');
        if (!(f.prec() > 0)) throw new Error('Línea ' + (i + 1) + ': escriba el precio.');
        l.push(f.leer());
      });
      if (!l.length) throw new Error('Agregue al menos un producto.');
      return l;
    },
  };
}

// Buscador de cliente: escribe y elige de la lista. alElegir(c | null). valor: { id, nombre } inicial.
export function buscadorCliente(soc, valor, alElegir) {
  let actual = valor?.id ? valor : null;
  const caja = h('div.cot-cli');
  const entrada = h('input.campo', { type: 'search', autocomplete: 'off', placeholder: 'Buscar cliente por nombre o cédula', 'aria-label': 'Buscar cliente' });
  const lista = h('ul.cot-cli-lista', { hidden: true });
  const elegido = h('div.cot-cli-elegido');
  function pintar() {
    elegido.replaceChildren();
    if (actual) elegido.append(h('span.chip.ok', actual.nombre), h('button.btn', { type: 'button', onclick: () => { actual = null; alElegir(null); pintar(); } }, 'Cambiar'));
    entrada.hidden = !!actual; if (actual) lista.hidden = true;
  }
  const buscar = debounce(async () => {
    const q = entrada.value.trim();
    if (q.length < 2) { lista.hidden = true; return; }
    try {
      const r = await api.clientes(soc, q);
      const filas = (Array.isArray(r) ? r : r?.clientes || []).slice(0, 8);
      lista.replaceChildren(...(filas.length ? filas.map((c) => h('li', h('button.btn', { type: 'button', onclick: () => { actual = { id: c.id, nombre: c.nombre }; alElegir(actual); entrada.value = ''; pintar(); } }, c.nombre, c.identificacion ? h('small', ' · ' + c.identificacion) : null))) : [h('li.tenue', 'No se encontró ningún cliente.')]));
      lista.hidden = false;
    } catch (e) { lista.replaceChildren(h('li.tenue', textoDeError(e))); lista.hidden = false; }
  }, 300);
  entrada.addEventListener('input', buscar);
  caja.append(entrada, lista, elegido); pintar();
  return { el: caja, valor: () => actual };
}
