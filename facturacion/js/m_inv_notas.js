// Notas de proveedor: notas de crédito y débito que los proveedores mandan a nuestras empresas (fx_inv_notas_proveedor). Ninguna toca el inventario sola.
// Por cada nota: enlazarla con su factura (fx_inv_nota_enlazar), devolver la mercadería (solo crédito, fx_inv_nota_devolver) o «No afecta el inventario»
// (fx_inv_nota_ignorar), que se puede volver a revisar (fx_inv_nota_reabrir).
import { h, money, num, fechaHora } from './util.js';
import { inv } from './api_inventarios.js';
import { ventana, dialogo, cargando, falla, vacio, aviso, cantTxt, dma, plural, empresaChip, numFactura, proveedorTxt, proveedorPartes, tipoDocTxt, selectUbicacion, botonSeguro, accionSegura, repetidaTxt, enfocar, toastOk, poner } from './m_inv_comun.js';

const ESTADOS = [['por_revisar', 'Por revisar'], ['devuelta', 'Mercadería devuelta'], ['ignorada', 'No afectan el inventario'], ['todas', 'Todas']];
const ESTADO_TXT = { por_revisar: ['Por revisar', 'espera'], devuelta: ['Mercadería devuelta', 'ok'], ignorada: ['No afecta el inventario', ''] };

export async function abrir(ctx) {
  const cat = ctx.cat;
  let estado = 'por_revisar', vivo = true, seq = 0;
  const filtro = h('div.inv-segmento', { role: 'group', 'aria-label': 'Qué notas ver' });
  const lista = h('div.inv-notas', cargando('Cargando notas de proveedor…'));
  const alCambio = () => { if (vivo) cargar(); };
  document.addEventListener('inv:cambio', alCambio);
  const v = ventana({ titulo: 'Notas de proveedor', contenido: [
    h('div.inv-ventana-cab', h('p', 'Notas de crédito y débito que los proveedores mandaron a Soda La Bomba o a Pollos La Bomba, de facturas que ya tienen mercadería recibida. Una nota no cambia el inventario hasta que usted decida.')),
    filtro, lista], alCerrar: () => { vivo = false; document.removeEventListener('inv:cambio', alCambio); } });

  const pintarFiltro = () => poner(filtro, ...ESTADOS.map(([id, t]) => h('button.btn.inv-seg', { type: 'button', 'aria-pressed': String(estado === id), onclick: () => { if (estado === id) return; estado = id; pintarFiltro(); cargar(); } }, t)));
  async function cargar() {
    const mia = ++seq;
    poner(lista, cargando('Cargando notas de proveedor…'));
    let d;
    try { d = await inv.notasProveedor(estado, 100); } catch (e) { if (vivo && mia === seq) poner(lista, falla(e, cargar, 'No se pudieron cargar las notas')); return; }
    if (!vivo || mia !== seq) return;
    const notas = d.notas || [];
    poner(lista, ...(notas.length ? notas.map(tarjeta) : [vacio(estado === 'por_revisar' ? 'No hay notas de proveedor por revisar.' : 'No hay notas en esta lista.')]));
  }
  function tarjeta(n) {
    const credito = n.tipo === 'NotaCreditoElectronica';
    const [et, cl] = ESTADO_TXT[n.estado] || [n.estado, ''];
    const zona = h('div');
    const btns = [];
    if (n.estado === 'por_revisar') {
      if (credito) btns.push(h('button.btn.primario', { type: 'button', onclick: () => devolver(n) }, 'Devolver mercadería'));
      btns.push(h('button.btn', { type: 'button', onclick: () => noAfecta(n) }, 'No afecta el inventario'));
    }
    if (n.estado === 'ignorada') {
      const { boton } = botonSeguro('Volver a revisar', '', { zona, ocupado: 'Guardando…', hacer: (idem) => inv.notaReabrir(n.clave, idem), alTerminar: (r, { repetida }) => { toastOk('La nota volvió a «Por revisar».' + repetidaTxt(repetida)); } });
      btns.push(boton);
    }
    const factura = n.factura
      ? h('div.inv-nota-fac', h('p', h('strong', 'Corrige la factura N.° ' + numFactura(n.factura.consecutivo)), ' del ' + dma(n.factura.fecha) + ' · ' + plural(n.factura.lineas_recibidas || 0, 'línea recibida', 'líneas recibidas') + (n.enlace_fuente === 'persona' ? ' · la enlazó una persona' : n.enlace_fuente === 'xml' ? ' · lo dice la nota' : '')),
        h('button.btn.chico', { type: 'button', onclick: async () => (await import('./m_inv_recibir.js')).abrirFactura(ctx, n.factura.clave) }, 'Ver la factura'))
      : h('div.inv-nota-fac', h('p', h('strong', 'No se sabe a qué factura corrige. '), (n.candidatas || []).length ? 'Escoja la que corresponde (las más parecidas van primero):' : 'No hay facturas parecidas con mercadería recibida.'),
        h('ul.inv-candidatas', (n.candidatas || []).map((c) => {
          const z = h('div');
          const { boton } = botonSeguro('Enlazar con esta factura', 'chico', { zona: z, ocupado: 'Enlazando…', hacer: (idem) => inv.notaEnlazar(n.clave, c.clave, idem), alTerminar: (r, { repetida }) => toastOk('Nota enlazada con la factura N.° ' + numFactura(c.consecutivo) + '.' + repetidaTxt(repetida)) });
          return h('li', h('span', 'Factura N.° ' + numFactura(c.consecutivo) + ' del ' + dma(c.fecha) + ' · ' + plural(c.lineas_recibidas || 0, 'línea recibida', 'líneas recibidas') + (c.coincidencias ? ' · ' + plural(c.coincidencias, 'línea igual', 'líneas iguales') : '')), boton, z);
        })));
    return h('article.inv-nota', { 'data-clave': n.clave },
      h('div.inv-fac-cab',
        h('div.inv-fac-prov', h('strong', proveedorTxt(n.proveedor_nombre)), proveedorPartes(n.proveedor_nombre).razon ? h('small', proveedorPartes(n.proveedor_nombre).razon) : null, h('small', tipoDocTxt(n.tipo) + ' N.° ' + numFactura(n.consecutivo) + ' · ' + dma(n.fecha) + ' · total ' + money(n.total) + (n.moneda && n.moneda !== 'CRC' ? ' (' + n.moneda + ')' : ''))),
        h('div.inv-fac-emp', h('small', 'A nombre de'), empresaChip(n.sociedad_nombre, (cat.empresas || []).find((e) => e.id === n.sociedad_id)?.codigo))),
      h('div.inv-fac-estado', h('span.chip' + (cl ? '.' + cl : ''), et), n.motivo ? h('small', 'Motivo: ' + n.motivo) : null, n.decidido_por_nombre ? h('small', 'Lo decidió ' + n.decidido_por_nombre + (n.decidido_en ? ', ' + fechaHora(n.decidido_en) : '')) : null),
      !credito ? aviso('info', h('p', 'Una nota de débito no devuelve mercadería: solo se marca «No afecta el inventario».')) : null,
      h('ul.inv-fac-lineas', (n.lineas || []).map((l) => h('li', h('span', l.descripcion + (l.articulo ? ' → ' + l.articulo : '')), h('span.tenue.cifra', num(l.cantidad, 3) + ' ' + (l.unidad || '') + ' · ' + money(l.subtotal_crc) + ' sin IVA')))),
      factura,
      btns.length ? h('div.inv-fac-btns', btns) : null, zona);
  }
  function noAfecta(n) {
    const motivo = h('input.campo', { type: 'text', maxlength: 200, 'aria-label': 'Motivo (opcional)', placeholder: 'Por ejemplo: es un descuento, no se devolvió nada' });
    const zona = h('div');
    const ok = h('button.btn.primario', { type: 'button' }, 'Sí, no afecta el inventario');
    const acc = accionSegura({ boton: ok, zona, ocupado: 'Guardando…',
      hacer: (idem) => { const m = motivo.value.trim(); if (m && m.length < 3) throw new Error('El motivo tiene que tener al menos 3 letras, o déjelo vacío.'); return inv.notaIgnorar(n.clave, m || null, idem); },
      alTerminar: (r, { repetida }) => { d.cerrar(); toastOk('Listo: la nota quedó como «No afecta el inventario».' + repetidaTxt(repetida)); } });
    ok.addEventListener('click', () => acc.ejecutar());
    const d = dialogo({ titulo: 'No afecta el inventario', ancho: 520, contenido: [h('p', 'La nota sale de «Por revisar» y el inventario no cambia. Se puede volver a revisar después.'), h('label.etq', 'Motivo (opcional)', motivo), zona], botones: [{ texto: 'No, volver', onclick: (c) => c() }] });
    d.el.querySelector('.modal-pie').append(ok);
  }
  async function devolver(n) {
    const { editorItems, opcionesDe } = await import('./m_inv_mover.js');
    const bodega = (cat.ubicaciones || []).find((u) => u.tipo === 'bodega' && u.predeterminada && u.activo !== false);
    let ubic = bodega?.id || '';
    const inicial = (n.lineas || []).filter((l) => l.articulo_id).map((l) => ({ articulo: l.articulo_id, cantidad: Math.round(Number(l.cantidad) * Number(l.factor || 1) * 1000) / 1000 }));
    const items = editorItems(ctx, { fuente: () => opcionesDe(ubic, true), inicial });
    const sel = selectUbicacion(cat, { valor: ubic, etiqueta: 'De dónde sale', alCambiar: async (x) => { ubic = x; await items.cargar(); } });
    const motivo = h('input.campo', { type: 'text', maxlength: 200, 'aria-label': 'Motivo (opcional)', placeholder: 'Devolución a proveedor' });
    const zona = h('div');
    const ok = h('button.btn.primario', { type: 'button' }, 'Devolver');
    const acc = accionSegura({ boton: ok, zona, ocupado: 'Devolviendo…',
      hacer: (idem) => {
        if (!ubic) throw new Error('Escoja de dónde sale.');
        const p = items.problema(); if (p) throw new Error(p);
        const m = motivo.value.trim(); if (m && m.length < 3) throw new Error('El motivo tiene que tener al menos 3 letras, o déjelo vacío.');
        return inv.notaDevolver(n.clave, ubic, items.items(), m || null, idem);
      },
      alTerminar: (r, { repetida }) => { d.cerrar(); toastOk('Listo: se devolvió mercadería por ' + money(r.valor_total) + ' (al costo, sin IVA).' + repetidaTxt(repetida)); } });
    ok.addEventListener('click', () => acc.ejecutar());
    const d = dialogo({ titulo: 'Devolver mercadería', ancho: 760, contenido: [
      h('p', 'Sale del inventario lo que se le devolvió a ' + proveedorTxt(n.proveedor_nombre) + '. Primero sale lo de la factura enlazada y después lo que vence primero.'),
      h('label.etq', 'De dónde sale', sel), h('h3', 'Qué se devolvió'), items.el, h('label.etq', 'Motivo (opcional)', motivo), zona],
      botones: [{ texto: 'No, volver', onclick: (c) => c() }] });
    d.el.querySelector('.modal-pie').append(ok);
    await items.cargar(true);
  }
  pintarFiltro();
  await cargar();
  enfocar(v.cuerpo);
}
