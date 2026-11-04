// Venta de contingencia (Administración, solo administradores): se usa solo cuando no hubo ninguna red ni sistema y se cobró con el talonario provisional.
// Una sola pantalla, cinco datos: número del provisional, fecha y hora, productos, cómo pagó y cliente (opcional). La decisión se toma aquí mismo.
// Abajo se ven los provisionales ya registrados y hasta cuándo hay para enviarlos a Hacienda.
import { h, esqueleto, bloqueError, textoDeError, conBoton, toast, money, fechaHora, fechaCorta, MEDIOS, TIPOS_DOC, r2 } from './util.js';
import { cargarHoja } from './ui_hojas.js';
import { api } from './api.js';
import { contingencia } from './api_contingencia.js';
import { fechaProvisionalISO, numeroProvisionalValido } from './contingencia_texto.js';

const ESTADOS = { pendiente: 'Esperando a Hacienda', enviado: 'Esperando a Hacienda', aceptado: 'Aceptado por Hacienda', rechazado: 'Rechazado por Hacienda', error: 'No se pudo enviar' };
const ahoraLocalCR = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Costa_Rica', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()).replace(' ', 'T');

export default {
  id: 'contingencia',
  titulo: 'Venta de contingencia',
  async mount(root, app) {
    await cargarHoja('contingencia.css');
    if (!app.admin) {
      root.append(h('div.vacio', h('p', 'Esta pantalla es solo para administradores.'), h('button.btn', { type: 'button', onclick: () => app.ir('inicio') }, 'Volver al inicio')));
      return;
    }
    let vivo = true, productos = [], cant = new Map(), medio = 'efectivo', cliente = null, busca = '';
    const soc = app.socId;
    const formEl = h('div'), regEl = h('section.ct-reg');
    const total = () => r2(productos.reduce((s, p) => s + (cant.get(p.id) || 0) * Number(p.precio_final || 0), 0));

    const numero = h('input', { id: 'ct-numero', type: 'text', inputmode: 'text', maxlength: 20, autocomplete: 'off', placeholder: 'Por ejemplo 000123' });
    const fecha = h('input', { id: 'ct-fecha', type: 'datetime-local', max: ahoraLocalCR(), value: ahoraLocalCR() });
    const error = h('p.ct-error', { role: 'alert', hidden: true });
    const totalEl = h('span.ct-total', money(0));
    const botonReg = h('button.btn.primario.grande', { type: 'button' }, 'Registrar la venta');
    const prodsEl = h('div.ct-prods'), cliEl = h('div'), mediosEl = h('div.ct-medios', { role: 'group', 'aria-label': 'Cómo pagó' });
    const mostrarError = (m) => { error.textContent = m || ''; error.hidden = !m; };

    function pintarProductos() {
      prodsEl.replaceChildren(...productos.map((p) => {
        const out = h('output', String(cant.get(p.id) || 0));
        const cambiar = (d) => { mostrarError(''); cant.set(p.id, Math.max(0, Math.min(99, (cant.get(p.id) || 0) + d))); out.textContent = String(cant.get(p.id)); totalEl.textContent = money(total()); };
        return h('div.ct-prod', h('div.ct-prod-n', p.nombre, h('small', money(p.precio_final))),
          h('div.ct-cant', h('button', { type: 'button', 'aria-label': 'Quitar uno de ' + p.nombre, onclick: () => cambiar(-1) }, '−'), out, h('button', { type: 'button', 'aria-label': 'Agregar uno de ' + p.nombre, onclick: () => cambiar(1) }, '+')));
      }));
    }
    function pintarMedios() {
      mediosEl.replaceChildren(...Object.entries(MEDIOS).map(([k, t]) => h('button', { type: 'button', 'aria-pressed': String(medio === k), onclick: () => { medio = k; pintarMedios(); } }, t)));
    }
    async function pintarCliente(lista = []) {
      if (cliente) { cliEl.replaceChildren(h('div.ct-cli-ok', h('span', cliente.nombre), h('button.btn.chico.suave', { type: 'button', onclick: () => { cliente = null; pintarCliente(); } }, 'Quitar'))); return; }
      const q = h('input.ct-buscar', { type: 'search', placeholder: 'Nombre o cédula', value: busca, 'aria-label': 'Buscar cliente' });
      let t;
      q.addEventListener('input', () => { busca = q.value; clearTimeout(t); t = setTimeout(async () => { if (busca.trim().length < 3) return pintarCliente([]).then(() => document.getElementById('ct-cli')?.focus()); try { const r = await api.clientes(soc, busca.trim()); await pintarCliente((Array.isArray(r) ? r : r?.clientes || []).slice(0, 5)); document.querySelector('.ct-buscar')?.focus(); } catch { /* sin lista */ } }, 300); });
      cliEl.replaceChildren(...[q, lista.length ? h('ul.ct-res', lista.map((c) => h('li', h('button', { type: 'button', onclick: () => { cliente = { id: c.id, nombre: c.nombre }; pintarCliente(); } }, c.nombre + (c.identificacion ? ' · ' + c.identificacion : ''))))) : null].filter(Boolean));
    }
    const campo = (et, ayuda, ...contenido) => h('div.ct-campo', et.tagName ? et : h('div.ct-et', et), h('div', ...contenido, ayuda ? h('small', ayuda) : null));

    async function registrar() {
      mostrarError('');
      const num = numero.value.trim(), iso = fechaProvisionalISO(fecha.value);
      if (!numeroProvisionalValido(num)) return mostrarError('Escriba el número impreso del provisional: solo letras, números y guion.');
      if (!iso) return mostrarError('Escriba la fecha y hora que dice el provisional.');
      const lineas = productos.filter((p) => (cant.get(p.id) || 0) > 0);
      if (!lineas.length) return mostrarError('Agregue al menos un producto.');
      await conBoton(botonReg, async () => {
        let venta = null;
        try {
          const v = await api.ventaCrear(soc, 'express', 'Provisional ' + num, null, 1);
          venta = v?.id || v?.venta?.id || v;
          for (const p of lineas) await api.lineaAgregar(venta, p.id, cant.get(p.id));
          const ven = await api.venta(venta);
          const t = Number(ven?.venta?.total ?? total());
          const c = await contingencia.registrar(venta, [{ medio, monto: t }], num, iso, cliente?.id || null, 1);
          cant = new Map(); cliente = null; busca = ''; numero.value = ''; pintarProductos(); pintarCliente(); totalEl.textContent = money(0);
          formEl.prepend(h('div.ct-ok', { role: 'status' }, 'Listo. El provisional n.º ' + num + ' quedó registrado y se enviará a Hacienda en un momento. Entregue el original al cliente solo si no lo hizo ya.'));
          setTimeout(() => formEl.querySelector('.ct-ok')?.remove(), 9000);
          void c; await cargarRegistro();
        } catch (e) {
          if (venta && typeof venta === 'string') { try { await api.ventaAnular(venta, 'Contingencia no registrada'); } catch { /* queda abierta */ } }
          mostrarError(textoDeError(e));
        }
      });
    }
    botonReg.addEventListener('click', registrar);

    async function cargarRegistro() {
      try {
        const l = await contingencia.lista(soc);
        const a = Array.isArray(l) ? l : [];
        regEl.replaceChildren(h('h2', 'Ya registrados'), ...(a.length ? a.map((x) => h('div.ct-fila',
          h('div', h('strong', 'Provisional n.º ' + x.provisional_numero), h('small.tenue', fechaHora(x.provisional_fecha))),
          h('div', (TIPOS_DOC[x.tipo_doc] || 'Comprobante') + ' ' + (x.numero || ''), h('small.tenue', ESTADOS[x.estado] || x.estado)),
          h('div', h('strong', money(x.total)), h('small.tenue', 'Enviar antes del ' + fechaCorta(x.vence))))) : [h('p.tenue', 'Todavía no hay ventas de contingencia.')]));
      } catch (e) { regEl.replaceChildren(bloqueError({ titulo: 'No se pudo ver lo registrado', mensaje: textoDeError(e), alReintentar: cargarRegistro })); }
    }

    const caja = h('div.ct', h('p.ct-intro', 'Úselo solo si no hubo internet ni sistema y se cobró con el talonario provisional. Copie aquí lo que dice el papel; el comprobante electrónico sale con esa fecha y hora.'), formEl, regEl);
    root.append(caja);
    formEl.replaceChildren(esqueleto(3, 'Cargando productos…'));
    try {
      const cat = await api.catalogo(soc);
      productos = (cat?.productos || []).filter((p) => !p.modificador_nombre && Number(p.precio_final) > 0);
    } catch (e) { formEl.replaceChildren(bloqueError({ titulo: 'No se pudieron cargar los productos', mensaje: textoDeError(e), alReintentar: () => app.ir('admin/contingencia') })); cargarRegistro(); return () => { vivo = false; }; }
    pintarProductos(); pintarMedios(); pintarCliente();
    formEl.replaceChildren(h('div.ct-form',
      campo(h('label', { for: 'ct-numero' }, 'Número del provisional'), 'Tal como está impreso en el talonario.', numero),
      campo(h('label', { for: 'ct-fecha' }, 'Fecha y hora'), 'La que se escribió en el papel.', fecha),
      campo('Productos', null, prodsEl),
      campo('Cómo pagó', null, mediosEl),
      campo('Cliente', 'Solo si pidió factura a su nombre.', cliEl),
      error,
      h('div.ct-pie', h('div', h('small.tenue', 'Total'), h('div', totalEl)), botonReg)));
    await cargarRegistro();
    return () => { vivo = false; void vivo; };
  },
};
