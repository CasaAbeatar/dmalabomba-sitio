// Cotizaciones (Administración, solo administradores). Una cotización NO es un comprobante electrónico: no se envía a Hacienda.
// Se crea, se manda al cliente (correo o impresa), se marca aceptada o rechazada y, si aceptó, se pasa a una cuenta de Caja sin volver a escribirla; allí se cobra y se factura como siempre.
// Lee fx_cotizaciones y fx_cotizacion; escribe con fx_cotizacion_guardar, fx_cotizacion_estado y fx_cotizacion_convertir.
import { h, esqueleto, bloqueError, textoDeError, confirmar, conBoton, toast, modal, money, fechaCorta, hoyCR, sumaDias, esc } from './util.js';
import { cargarHoja } from './ui_hojas.js';
import { api } from './api.js';
import { cotizaciones } from './api_cotizaciones.js';
import { editorLineas, buscadorCliente, num3 } from './cot_comun.js';

const ESTADOS = { borrador: 'Borrador', enviada: 'Enviada', aceptada: 'Aceptada', rechazada: 'Rechazada', convertida: 'Pasada a Caja', vencida: 'Vencida' };
const CLASE = { borrador: 'gris', enviada: 'espera', aceptada: 'ok', rechazada: 'mal', convertida: 'ok', vencida: 'mal' };
const chip = (e) => h('span.chip.' + (CLASE[e] || 'gris'), ESTADOS[e] || e);
const lista = (x) => (Array.isArray(x) ? x : []);

// Documento para imprimir o guardar como PDF (el navegador ofrece «Guardar como PDF»). Dice claramente que no es un comprobante electrónico.
export function htmlCotizacion(d) {
  const c = d.cotizacion, em = d.emisor || {}, cli = d.cliente;
  const filas = lista(d.lineas).map((l) => `<tr><td>${esc(l.descripcion)}${l.nota ? `<br><small>${esc(l.nota)}</small>` : ''}</td><td class="n">${num3(l.cantidad)}</td><td class="n">${esc(money(l.precio_final))}</td><td class="n">${esc(money(l.total_linea))}</td></tr>`).join('');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(c.numero)}</title><style>
body{font:14px/1.4 Helvetica,Arial,sans-serif;color:#1d1a17;margin:28px}h1{font-size:22px;margin:0}h2{font-size:15px;margin:18px 0 6px}
table{width:100%;border-collapse:collapse}th,td{padding:6px 8px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top}.n{text-align:right}
.tot{text-align:right;font-size:18px;font-weight:700;margin-top:12px}.pie{margin-top:24px;font-size:12px;color:#555}.cab{display:flex;justify-content:space-between;gap:20px}</style></head><body>
<div class="cab"><div><h1>${esc(em.nombre_comercial || em.nombre || '')}</h1><div>${esc(em.nombre || '')}</div><div>Cédula jurídica ${esc(em.cedula || '')}</div><div>${esc([em.telefono, em.correo].filter(Boolean).join(' · '))}</div></div>
<div style="text-align:right"><h1>Cotización</h1><div><strong>${esc(c.numero)}</strong></div><div>Fecha: ${esc(fechaCorta(c.creado_en))}</div><div>Válida hasta: ${esc(fechaCorta(c.vigencia_hasta + 'T12:00:00'))}</div></div></div>
<h2>Para</h2><div>${esc(c.cliente_nombre || '')}${cli?.identificacion ? ' · ' + esc(cli.identificacion) : ''}</div>
<h2>Detalle</h2><table><thead><tr><th>Descripción</th><th class="n">Cantidad</th><th class="n">Precio</th><th class="n">Total</th></tr></thead><tbody>${filas}</tbody></table>
<div class="tot">Total: ${esc(money(c.total))} <small style="font-weight:400">(IVA incluido)</small></div>
${c.notas ? `<h2>Notas</h2><div>${esc(c.notas)}</div>` : ''}
<div class="pie">Esta cotización es solo informativa y no es un comprobante electrónico ni sirve como factura. Los precios incluyen el impuesto de valor agregado y pueden cambiar después de la fecha de validez.</div></body></html>`;
}
function imprimirDoc(html) {
  const f = h('iframe', { 'aria-hidden': 'true', style: 'position:fixed;right:0;bottom:0;width:0;height:0;border:0' });
  document.body.append(f);
  f.srcdoc = html;
  f.onload = () => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch { toast('No se pudo abrir la impresión en este aparato.', 'error'); } setTimeout(() => f.remove(), 60000); };
}
export function textoCorreo(d) {
  const c = d.cotizacion, em = d.emisor || {};
  const lineas = lista(d.lineas).map((l) => '- ' + num3(l.cantidad) + ' × ' + l.descripcion + ': ' + money(l.total_linea)).join('\n');
  return 'Buen día' + (c.cliente_nombre ? ' ' + c.cliente_nombre : '') + ',\n\nLe compartimos la cotización ' + c.numero + ':\n\n' + lineas + '\n\nTotal (IVA incluido): ' + money(c.total) + '\nVálida hasta el ' + fechaCorta(c.vigencia_hasta + 'T12:00:00') + '.\n' + (c.notas ? '\n' + c.notas + '\n' : '') + '\nQuedamos atentos.\n' + (em.nombre_comercial || em.nombre || '');
}

export default {
  id: 'cotizaciones',
  titulo: 'Cotizaciones',
  async mount(root, app) {
    await cargarHoja('cotizaciones.css');
    if (!app.admin) {
      root.append(h('div.vacio', h('p', 'Esta pantalla es solo para administradores.'), h('button.btn', { type: 'button', onclick: () => app.ir('inicio') }, 'Volver al inicio')));
      return;
    }
    let vivo = true, nCarga = 0, productos = null;
    const cuerpo = h('div.cot-seccion');
    const filtro = h('select.campo', { 'aria-label': 'Filtrar por estado' }, h('option', { value: '' }, 'Todas'), Object.entries(ESTADOS).map(([k, v]) => h('option', { value: k }, v)));
    const buscar = h('input.campo', { type: 'search', autocomplete: 'off', placeholder: 'Buscar por número o cliente', 'aria-label': 'Buscar cotización' });
    let tBuscar = null;
    filtro.addEventListener('change', () => cargar());
    buscar.addEventListener('input', () => { clearTimeout(tBuscar); tBuscar = setTimeout(() => cargar(), 300); });

    async function cargar() {
      const mi = ++nCarga;
      if (!cuerpo.children.length || cuerpo.querySelector('.bloque-error')) cuerpo.replaceChildren(esqueleto(3, 'Cargando cotizaciones…'));
      try {
        const filas = lista(await cotizaciones.lista(app.socId, filtro.value, buscar.value.trim()));
        if (!vivo || mi !== nCarga) return;
        cuerpo.replaceChildren(filas.length ? h('ul.cot-lista', filas.map(item)) : h('p.cot-vacio', filtro.value || buscar.value ? 'No hay cotizaciones con ese filtro.' : 'Todavía no hay cotizaciones. Toque «Nueva cotización» para hacer la primera.'));
      } catch (e) {
        if (!vivo || mi !== nCarga) return;
        cuerpo.replaceChildren(bloqueError({ titulo: 'No se pudieron cargar las cotizaciones', mensaje: textoDeError(e), alReintentar: () => cargar() }));
      }
    }
    function item(c) {
      return h('li.cot-item', h('div.cot-item-datos',
        h('div.cot-item-t', c.numero, chip(c.estado_efectivo || c.estado)),
        h('div.cot-item-s', c.cliente_nombre, ' · ', c.n_lineas + (Number(c.n_lineas) === 1 ? ' línea' : ' líneas'), ' · válida hasta ', fechaCorta(c.vigencia_hasta + 'T12:00:00'), c.venta_numero ? ' · cuenta N° ' + c.venta_numero : '')),
        h('div.cot-monto', money(c.total)),
        h('div.cot-btns', h('button.btn.primario', { type: 'button', onclick: () => ver(c.id) }, 'Abrir')));
    }
    async function catalogo() {
      if (!productos) { const cat = await api.catalogo(app.socId); productos = (cat?.productos || []).filter((p) => !p.modificador_nombre).sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es')); }
      return productos;
    }

    /* ---------- Nueva o editar ---------- */
    async function formulario(d) {
      let prods;
      try { prods = await catalogo(); } catch (e) { toast(textoDeError(e), 'error', 6000); return; }
      const c = d?.cotizacion || null;
      const err = h('div.error-caja', { hidden: true, role: 'alert' });
      const mostrar = (m) => { err.textContent = m; err.hidden = !m; if (m) err.scrollIntoView({ block: 'nearest' }); };
      let cli = c?.cliente_id ? { id: c.cliente_id, nombre: d.cotizacion.cliente_nombre } : null;
      const buscador = buscadorCliente(app.socId, cli, (x) => { cli = x; });
      const texto = h('input.campo', { type: 'text', maxlength: 120, autocomplete: 'off', value: c && !c.cliente_id ? c.cliente_texto || '' : '', placeholder: 'o escriba el nombre de a quién se cotiza', 'aria-label': 'Nombre de a quién se cotiza' });
      const correo = h('input.campo', { type: 'email', autocomplete: 'off', value: c?.correo || '', 'aria-label': 'Correo' });
      const tel = h('input.campo', { type: 'tel', inputmode: 'numeric', autocomplete: 'off', maxlength: 20, value: c?.telefono || '', 'aria-label': 'Teléfono' });
      const vig = h('input.campo', { type: 'date', value: c?.vigencia_hasta || sumaDias(hoyCR(), 15), min: hoyCR(), 'aria-label': 'Válida hasta' });
      const notas = h('textarea.campo', { rows: 2, maxlength: 400, 'aria-label': 'Notas' }, c?.notas || '');
      const ed = editorLineas(prods, lista(d?.lineas).map((l) => ({ producto_id: l.producto_id, cantidad: l.cantidad, precio: l.precio_final, nota: l.nota })));
      const m = modal({
        titulo: c ? 'Cambiar ' + c.numero : 'Nueva cotización', ancho: 760,
        contenido: h('div.cot-form', err,
          h('div.etq', 'Cliente', buscador.el, texto),
          h('div.cot-fila2', h('label.etq', 'Correo del cliente', correo), h('label.etq', 'Teléfono', tel)),
          h('label.etq', 'Válida hasta', vig),
          h('div.etq', 'Productos', ed.el),
          h('label.etq', 'Notas (salen en la cotización)', notas)),
        botones: [{ texto: 'Cancelar', onclick: (x) => x() },
          { texto: c ? 'Guardar cambios' : 'Guardar cotización', clase: 'primario', onclick: async (cerrar, btn) => {
            mostrar('');
            await conBoton(btn, async () => {
              let lineas;
              try { lineas = ed.leer(); } catch (e) { mostrar(e.message); return; }
              if (!cli && !texto.value.trim()) { mostrar('Elija un cliente o escriba el nombre de a quién se cotiza.'); return; }
              try {
                const r = await cotizaciones.guardar({ id: c?.id || null, sociedad_id: app.socId, cliente_id: cli?.id || null, cliente_texto: cli ? null : texto.value.trim(), correo: correo.value.trim() || null, telefono: tel.value.trim() || null, vigencia_hasta: vig.value || null, notas: notas.value.trim() || null, lineas });
                cerrar(); toast('Cotización ' + r.cotizacion.numero + ' guardada.'); await cargar(); ver(r.cotizacion.id);
              } catch (e) { mostrar(textoDeError(e)); }
            });
          } }],
      });
      void m;
    }

    /* ---------- Ver una cotización ---------- */
    async function ver(id) {
      let d;
      try { d = await cotizaciones.ver(id); } catch (e) { toast(textoDeError(e), 'error', 6000); return; }
      const c = d.cotizacion, cerrada = ['convertida'].includes(c.estado), editable = ['borrador', 'enviada'].includes(c.estado);
      const ef = c.estado_efectivo || c.estado;
      let cerrarModal = () => {};
      const refrescar = async (nuevo) => { cerrarModal(); await cargar(); ver((nuevo || c).id); };
      const accion = (texto, fn, clase = '') => h('button.btn' + (clase ? '.' + clase : ''), { type: 'button', onclick: (e) => conBoton(e.currentTarget, fn) }, texto);
      const botones = [];
      if (!cerrada) {
        if (ef !== 'rechazada') botones.push(accion('Pasar a Caja', async () => {
          if (!app.turno?.id) { toast('Para pasarla a Caja primero hay que abrir la caja (Apertura y cierre de caja).', 'error', 6000); return; }
          if (!(await confirmar('Se crea una cuenta abierta en Caja con estos productos y precios (' + money(c.total) + '). Allí se cobra y se factura como siempre. ¿Continuar?', { si: 'Sí, pasar a Caja' }))) return;
          const v = await cotizaciones.convertir(c.id, app.terminal || 1);
          toast('Listo: cuenta N° ' + (v?.venta?.numero ?? '') + ' abierta en Caja.', 'ok', 6000);
          await refrescar();
        }, 'primario'));
        if (editable) botones.push(accion('Cambiar', async () => { cerrarModal(); await formulario(d); }));
      }
      const imprimir = accion('Imprimir o guardar PDF', async () => { imprimirDoc(htmlCotizacion(d)); if (c.estado === 'borrador') { await cotizaciones.estado(c.id, 'enviada', 'impresa'); await refrescar(); } });
      const mail = accion('Enviar por correo', async () => {
        const asunto = 'Cotización ' + c.numero + ' — ' + (d.emisor?.nombre_comercial || d.emisor?.nombre || '');
        window.location.href = 'mailto:' + encodeURIComponent(c.correo || d.cliente?.correo || '') + '?subject=' + encodeURIComponent(asunto) + '&body=' + encodeURIComponent(textoCorreo(d));
        if (['borrador', 'enviada'].includes(c.estado)) { await cotizaciones.estado(c.id, 'enviada', 'correo'); toast('Marcada como enviada. Si no se abrió su correo, use «Imprimir o guardar PDF» y adjúntelo.', 'ok', 7000); await refrescar(); }
      });
      botones.push(imprimir, mail);
      if (!cerrada) {
        if (ef === 'borrador' || ef === 'enviada' || ef === 'vencida') botones.push(accion('Aceptó', async () => { await cotizaciones.estado(c.id, 'aceptada'); await refrescar(); }), accion('Rechazó', async () => { if (await confirmar('¿Marcar esta cotización como rechazada por el cliente?', { si: 'Sí, rechazada' })) { await cotizaciones.estado(c.id, 'rechazada'); await refrescar(); } }));
        if (ef === 'aceptada' || ef === 'rechazada') botones.push(accion('Volver a borrador', async () => { await cotizaciones.estado(c.id, 'borrador'); await refrescar(); }));
      }
      const tabla = h('table.cot-det-tabla', h('thead', h('tr', h('th', 'Producto'), h('th.n', 'Cantidad'), h('th.n', 'Precio'), h('th.n', 'Total'))),
        h('tbody', lista(d.lineas).map((l) => h('tr', h('td', l.descripcion, l.nota ? h('div.tenue', l.nota) : null), h('td.n', num3(l.cantidad)), h('td.n', money(l.precio_final)), h('td.n', money(l.total_linea))))));
      const m = modal({
        titulo: c.numero, ancho: 720,
        contenido: h('div.cot-det',
          h('div', chip(ef), cerrada ? h('span.cot-ya', ' Ya está en la cuenta N° ' + (c.venta_numero ?? '')) : null),
          h('dl.cot-det-datos', h('dt', 'Cliente'), h('dd', c.cliente_nombre || ''), c.correo ? [h('dt', 'Correo'), h('dd', c.correo)] : null, c.telefono ? [h('dt', 'Teléfono'), h('dd', c.telefono)] : null,
            h('dt', 'Válida hasta'), h('dd', fechaCorta(c.vigencia_hasta + 'T12:00:00')), c.enviada_en ? [h('dt', 'Enviada'), h('dd', fechaCorta(c.enviada_en) + (c.enviada_via ? ' (' + c.enviada_via + ')' : ''))] : null),
          tabla, h('div.cot-monto', 'Total: ' + money(c.total) + ' (IVA incluido)'), c.notas ? h('p', c.notas) : null,
          ef === 'vencida' ? h('p.cot-aviso', 'Esta cotización ya venció. Para pasarla a Caja, cámbiele la vigencia (y revise los precios).') : null,
          h('p.cot-ya', 'No es un comprobante electrónico: no se envía a Hacienda. La factura se emite hasta que se cobra en Caja.'),
          h('div.cot-btns', botones)),
        botones: [{ texto: 'Cerrar', onclick: (x) => x() }],
      });
      cerrarModal = m.cerrar || (() => {});
    }

    root.append(h('div.cot',
      h('div.cot-cab', h('p', 'Precios para un cliente antes de venderle. Cuando acepta, se pasa a Caja sin volver a escribirla; no se envía a Hacienda hasta que se cobra.'), h('button.btn.primario', { type: 'button', onclick: () => formulario(null) }, 'Nueva cotización')),
      h('div.cot-filtros', buscar, filtro), cuerpo));
    await cargar();
    return () => { vivo = false; clearTimeout(tBuscar); };
  },
};
