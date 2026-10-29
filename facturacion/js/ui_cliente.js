// Componentes de clientes reutilizables (los usa la pantalla Clientes y los puede usar Caja).
//
//   import { selectorCliente, abrirFormCliente } from './ui_cliente.js';
//
//   selectorCliente(app, { alElegir(cliente) { ... }, titulo? })
//     Abre una ventana con buscador grande (nombre, cédula, correo o teléfono) y la lista de clientes del local activo.
//     Al tocar "Elegir" llama alElegir(cliente) y cierra la ventana. Tiene el botón "Agregar cliente nuevo":
//     al guardar el cliente nuevo también se elige solo. Devuelve { cerrar }.
//     "cliente" es la fila completa de fact.clientes: { id, tipo_id, identificacion, nombre, nombre_comercial, correo, telefono,
//     provincia, canton, distrito, barrio, otras_senas, actividad_codigo, notas, ... }.
//
//   abrirFormCliente(app, cliente|null, { alGuardar(cliente), titulo? })
//     Abre el formulario completo para crear (cliente = null) o ver/editar un cliente. Devuelve { cerrar }.
//     Orden: número de identificación (se verifica en Hacienda mientras se escribe), nombre o razón social y código de actividad
//     (se llenan solos con lo que dice Hacienda, pero se pueden cambiar) y después los datos que Hacienda no tiene (correo, teléfono, dirección).
//     El correo es opcional. Ver js/ui_cedula.js para las reglas de la cédula.
import { h, modal, conBoton, debounce, TIPOS_ID, toast } from './util.js';
import { api } from './api.js';
import { UBICACIONES } from './data_ubicaciones.js';
import { cargarCss, campo } from './ui_mant.js';
import { crearCampoIdentificacion, leerCorreos } from './ui_cedula.js';

export { leerCorreos };

const pad2 = (x) => String(x ?? '').replace(/\D/g, '').padStart(2, '0').slice(-2);
const nombresOrdenados = (obj, i) => Object.entries(obj || {}).sort((a, b) => String(i ? a[1][0] : a[1]).localeCompare(String(i ? b[1][0] : b[1]), 'es'));

export function abrirFormCliente(app, cliente, { alGuardar, titulo } = {}) {
  cargarCss();
  const soc = app.soc;
  const c = cliente || {};
  const esNuevo = !c.id;
  const err = h('div.error-caja', { hidden: true, role: 'alert' });
  const mostrarError = (m, campoEl) => { err.textContent = m; err.hidden = !m; if (m) { err.scrollIntoView({ block: 'nearest' }); campoEl?.focus(); } };

  const comercial = h('input.campo', { type: 'text', autocomplete: 'off', value: c.nombre_comercial || '', 'aria-label': 'Nombre comercial' });
  const correo = h('input.campo', { type: 'text', inputmode: 'email', autocapitalize: 'none', autocomplete: 'off', value: c.correo || '', 'aria-label': 'Correo' });
  const avisoCorreo = h('small.tenue');
  const telefono = h('input.campo', { type: 'tel', autocomplete: 'off', value: c.telefono || '', 'aria-label': 'Teléfono' });
  const notas = h('textarea.campo', { rows: 2, 'aria-label': 'Notas' }, c.notas || '');
  const barrio = h('input.campo', { type: 'text', autocomplete: 'off', value: c.barrio || '', 'aria-label': 'Barrio' });
  const senas = h('textarea.campo', { rows: 2, 'aria-label': 'Otras señas' }, c.otras_senas || '');
  const prov = h('select.campo', { 'aria-label': 'Provincia' });
  const cant = h('select.campo', { 'aria-label': 'Cantón' });
  const dist = h('select.campo', { 'aria-label': 'Distrito' });

  // Provincia > cantón > distrito (códigos oficiales)
  prov.append(h('option', { value: '' }, 'Sin indicar'), ...nombresOrdenados(Object.fromEntries(Object.entries(UBICACIONES).map(([k, v]) => [k, v[0]]))).map(([k, n]) => h('option', { value: k }, n)));
  const llenarCantones = (sel, selDist) => {
    const cs = UBICACIONES[prov.value]?.[1] || {};
    cant.replaceChildren(h('option', { value: '' }, prov.value ? 'Elija el cantón' : 'Primero elija la provincia'), ...nombresOrdenados(cs, 1).map(([k, v]) => h('option', { value: k }, v[0])));
    cant.value = sel && cs[sel] ? sel : '';
    llenarDistritos(selDist);
  };
  const llenarDistritos = (sel) => {
    const ds = UBICACIONES[prov.value]?.[1]?.[cant.value]?.[1] || {};
    dist.replaceChildren(h('option', { value: '' }, cant.value ? 'Elija el distrito' : 'Primero elija el cantón'), ...nombresOrdenados(ds).map(([k, n]) => h('option', { value: k }, n)));
    dist.value = sel && ds[sel] ? sel : '';
  };
  prov.value = UBICACIONES[String(c.provincia || '')] ? String(c.provincia) : '';
  llenarCantones(c.canton ? pad2(c.canton) : '', c.distrito ? pad2(c.distrito) : '');
  prov.addEventListener('change', () => llenarCantones());
  cant.addEventListener('change', () => llenarDistritos());

  const refrescarCorreo = () => {
    const v = correo.value.trim();
    avisoCorreo.textContent = v ? '' : 'Sin correo no se le puede enviar la factura por correo. Se puede guardar igual y agregarlo después.';
  };
  correo.addEventListener('input', refrescarCorreo);
  refrescarCorreo();

  // Número de identificación, nombre y actividad: se verifican en Hacienda (js/ui_cedula.js)
  const ced = crearCampoIdentificacion({
    cliente: esNuevo ? null : c,
    revisarDuplicado: async (id) => (await api.clientes(soc.id, id)).find((x) => x.identificacion === id && x.id !== c.id) || null,
    accionDuplicado: { texto: 'Abrir el cliente que ya existe', fn: (otro) => { m.cerrar(); abrirFormCliente(app, otro, { alGuardar, titulo }); } },
    alTerminar: () => { [correo, telefono].find((x) => !x.value.trim())?.focus(); },
  });

  async function guardar(cerrar) {
    mostrarError('');
    const btn = m.el.querySelector('.modal-pie .primario');
    await conBoton(btn, async () => {
      const v = await ced.validar();
      if (v) return mostrarError(v.mensaje, v.campo);
      const cr = leerCorreos(correo.value);
      if (cr.error) return mostrarError(cr.error, correo);
      const tel = telefono.value.replace(/\D/g, '');
      if (tel && (tel.length < 8 || tel.length > 20)) return mostrarError('El teléfono debe tener al menos 8 números.', telefono);
      const val = ced.valores();
      const r = await api.clienteGuardar({
        id: c.id || undefined, solo_nuevo: esNuevo, sociedad_id: soc.id, tipo_id: val.tipo_id, identificacion: val.identificacion,
        nombre: val.nombre, nombre_comercial: comercial.value.trim(), correo: cr.lista.join(', '), telefono: tel,
        provincia: prov.value, canton: cant.value, distrito: dist.value, barrio: barrio.value.trim(), otras_senas: senas.value.trim(),
        actividad_codigo: val.actividad_codigo, notas: notas.value.trim(), sin_verificar_motivo: val.sin_verificar_motivo,
      });
      toast((esNuevo ? 'Cliente agregado.' : 'Cliente guardado.') + (r.verificado ? '' : ' Quedó marcado como sin verificar en Hacienda.'));
      cerrar();
      alGuardar?.(r);
    });
  }

  const cuerpo = h('div.mt-form',
    err,
    h('fieldset', h('legend', 'Identificación'), ced.el),
    h('fieldset', h('legend', 'Datos que Hacienda no tiene'),
      h('div.col',
        campo('Nombre comercial (si tiene)', comercial),
        campo('Correo para enviar la factura (opcional)', correo, 'Puede escribir varios correos separados por coma. La factura llega a estos correos.'),
        avisoCorreo,
        campo('Teléfono (opcional)', telefono))),
    h('fieldset', h('legend', 'Dirección (opcional)'),
      h('div.col',
        h('div.rejilla', campo('Provincia', prov), campo('Cantón', cant), campo('Distrito', dist)),
        campo('Barrio', barrio),
        campo('Otras señas', senas, 'Por ejemplo: 200 metros norte de la iglesia, portón negro.'))),
    h('fieldset', h('legend', 'Notas internas'),
      campo('Notas (solo las ve usted, no salen en la factura)', notas)),
    !esNuevo && c.creado_en ? h('small.tenue', 'Cliente agregado el ' + new Intl.DateTimeFormat('es-CR', { timeZone: 'America/Costa_Rica', dateStyle: 'long' }).format(new Date(c.creado_en)) + '.') : null);

  const m = modal({
    titulo: titulo || (esNuevo ? 'Agregar cliente' : 'Cliente: ' + (c.nombre || '')), contenido: cuerpo, ancho: 760, alCerrar: () => ced.destruir(),
    botones: [{ texto: 'Cancelar', clase: 'suave', onclick: (x) => x() }, { texto: esNuevo ? 'Guardar cliente' : 'Guardar cambios', clase: 'primario', onclick: (x) => guardar(x) }],
  });
  if (esNuevo) ced.enfocar();
  return m;
}

export function selectorCliente(app, { alElegir, titulo = 'Elegir cliente' } = {}) {
  cargarCss();
  const soc = app.soc;
  const q = h('input.mt-buscar', { type: 'search', placeholder: 'Buscar por nombre, cédula, correo o teléfono', autocomplete: 'off', 'aria-label': 'Buscar cliente' });
  const lista = h('div.mt-lista', { style: 'margin-top:.8rem' });
  let m, n = 0;
  const elegir = (cl) => { m.cerrar(); alElegir?.(cl); };
  const cargar = async () => {
    const mi = ++n;
    try {
      const r = await api.clientes(soc.id, q.value.trim());
      if (mi !== n) return;
      lista.replaceChildren(...(r.length ? r.map((cl) => h('div.mt-item',
        h('div.mt-datos', h('span.mt-nombre', cl.nombre), h('span.mt-sub', (TIPOS_ID[cl.tipo_id] || '') + ' ' + cl.identificacion + (cl.correo ? ' · ' + cl.correo : ''))),
        h('div.mt-btns', h('button.btn.primario', { type: 'button', onclick: () => elegir(cl) }, 'Elegir')))) : [h('div.vacio', q.value ? 'No hay clientes con eso. Puede agregarlo con el botón de abajo.' : 'Todavía no hay clientes guardados.')]));
    } catch (e) { if (mi === n) lista.replaceChildren(h('div.error-caja', e.message)); }
  };
  q.addEventListener('input', debounce(cargar, 250));
  m = modal({
    titulo, ancho: 680,
    contenido: h('div', q, lista, h('div.fila', { style: 'margin-top:1rem' },
      h('button.btn', { type: 'button', onclick: () => abrirFormCliente(app, null, { alGuardar: (cl) => { m.cerrar(); alElegir?.(cl); } }) }, 'Agregar cliente nuevo'))),
    botones: [{ texto: 'Cerrar', clase: 'suave', onclick: (x) => x() }],
  });
  q.focus();
  cargar();
  return m;
}
