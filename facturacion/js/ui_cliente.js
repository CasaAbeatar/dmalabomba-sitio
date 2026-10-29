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
//     El correo principal y la dirección son obligatorios; hay 3 correos más opcionales. Ver js/ui_cedula.js para las reglas de la cédula.
//     También se elige la «Tarifa de IVA habitual de este cliente» (llave tarifa_habitual_codigo de fx_cliente_guardar): solo avisa en la
//     Caja y ofrece aplicarla; nunca se aplica sola.
import { h, modal, conBoton, debounce, TIPOS_ID, toast, nombrePropio } from './util.js';
import { api } from './api.js';
import { clientesTodos, clienteActivar } from './api_clientes.js';
import { UBICACIONES } from './data_ubicaciones.js';
import { cargarCss, campo, aviso } from './ui_mant.js';
import { crearCampoIdentificacion, leerCorreos } from './ui_cedula.js';
import { TARIFAS_CLIENTE, tarifaHabitual, clienteTraeTarifa } from './iva.js';

export { leerCorreos };

const pad2 = (x) => String(x ?? '').replace(/\D/g, '').padStart(2, '0').slice(-2);
const nombresOrdenados = (obj, i) => Object.entries(obj || {}).sort((a, b) => String(i ? a[1][0] : a[1]).localeCompare(String(i ? b[1][0] : b[1]), 'es'));

export function abrirFormCliente(app, cliente, { alGuardar, alCambiarEstado, titulo } = {}) {
  cargarCss();
  const soc = app.soc;
  const c = cliente || {};
  const esNuevo = !c.id;
  let activo = c.activo !== false; // un cliente desactivado no aparece al buscar cliente para facturar
  const err = h('div.error-caja', { hidden: true, role: 'alert' });
  const mostrarError = (m, campoEl) => { err.textContent = m; err.hidden = !m; if (m) { err.scrollIntoView({ block: 'nearest' }); campoEl?.focus(); } };

  const comercial = h('input.campo', { type: 'text', autocomplete: 'off', value: c.nombre_comercial || '', 'aria-label': 'Nombre comercial' });
  // Hasta 4 correos: el primero es el principal (el único que el XML de Hacienda admite) y la factura sale a todos al mismo tiempo
  const previos = String(c.correo || '').split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
  const rotulosCorreo = ['Correo principal (obligatorio)', 'Correo 2 (opcional)', 'Correo 3 (opcional)', 'Correo 4 (opcional)'];
  const correos = rotulosCorreo.map((r, i) => h('input.campo', { type: 'text', inputmode: 'email', autocapitalize: 'none', autocomplete: 'off', spellcheck: 'false', maxlength: 160, value: previos[i] || '', 'aria-label': r }));
  const avisoCorreo = h('small.tenue');
  const telefono = h('input.campo', { type: 'tel', autocomplete: 'off', value: c.telefono || '', 'aria-label': 'Teléfono' });
  const notas = h('textarea.campo', { rows: 2, 'aria-label': 'Notas' }, c.notas || '');
  const senas = h('textarea.campo', { rows: 2, 'aria-label': 'Otras señas' }, c.otras_senas || '');
  const prov = h('select.campo', { 'aria-label': 'Provincia' });
  const cant = h('select.campo', { 'aria-label': 'Cantón' });
  const dist = h('select.campo', { 'aria-label': 'Distrito' });

  // Provincia > cantón > distrito (códigos oficiales)
  prov.append(h('option', { value: '' }, 'Elija la provincia'), ...nombresOrdenados(Object.fromEntries(Object.entries(UBICACIONES).map(([k, v]) => [k, v[0]]))).map(([k, n]) => h('option', { value: k }, n)));
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
    const n = correos.filter((x) => x.value.trim()).length;
    avisoCorreo.textContent = !n ? 'Falta el correo principal: es adonde se envía la factura.'
      : n > 1 ? 'La factura se enviará al mismo tiempo a estos ' + n + ' correos.'
      : previos.length > correos.length ? 'Este cliente tenía más de 4 correos. Al guardar solo se conservan los primeros 4.' : '';
  };
  correos.forEach((x) => x.addEventListener('input', refrescarCorreo));
  refrescarCorreo();


  // Número de identificación, nombre y actividad: se verifican en Hacienda (js/ui_cedula.js)
  const ced = crearCampoIdentificacion({
    cliente: esNuevo ? null : c,
    revisarDuplicado: async (id) => (await clientesTodos(soc.id, id)).find((x) => x.identificacion === id && x.id !== c.id) || null,
    accionDuplicado: { texto: 'Abrir el cliente que ya existe', fn: (otro) => { m.cerrar(); abrirFormCliente(app, otro, { alGuardar, alCambiarEstado, titulo }); } },
    alTerminar: () => { [correos[0], telefono].find((x) => !x.value.trim())?.focus(); },
  });

  async function guardar(cerrar) {
    mostrarError('');
    const btn = m.el.querySelector('.modal-pie .primario');
    await conBoton(btn, async () => {
      const v = await ced.validar();
      if (v) return mostrarError(v.mensaje, v.campo);
      if (!correos[0].value.trim()) return mostrarError(correos.some((x) => x.value.trim()) ? 'Escriba el correo principal en el primer espacio. Los otros correos son adicionales.' : 'Falta el correo principal: es adonde se envía la factura.', correos[0]);
      const listaCorreos = [];
      for (const cc of correos) {
        const v = cc.value.trim();
        if (!v) continue;
        const cr = leerCorreos(v);
        if (cr.error) return mostrarError(cr.error, cc);
        if (cr.lista.length !== 1) return mostrarError('Escriba un solo correo en cada espacio. Para más correos use los otros espacios.', cc);
        if (listaCorreos.includes(cr.lista[0])) return mostrarError('El correo "' + cr.lista[0] + '" está repetido.', cc);
        listaCorreos.push(cr.lista[0]);
      }
      const tel = telefono.value.replace(/\D/g, '');
      if (tel && (tel.length < 8 || tel.length > 20)) return mostrarError('El teléfono debe tener al menos 8 números.', telefono);
      // Dirección obligatoria y completa: provincia, cantón, distrito y otras señas (Hacienda pide al menos 5 letras)
      const sn = senas.value.trim();
      if (!prov.value) return mostrarError('Falta elegir la provincia de la dirección.', prov);
      if (!cant.value) return mostrarError('Falta elegir el cantón.', cant);
      if (!dist.value) return mostrarError('Falta elegir el distrito.', dist);
      if (sn.length < 5) return mostrarError('Faltan las otras señas (por ejemplo: 200 metros norte de la iglesia). Escriba al menos 5 letras.', senas);
      const val = ced.valores();
      const datos = {
        id: c.id || undefined, solo_nuevo: esNuevo, sociedad_id: soc.id, tipo_id: val.tipo_id, identificacion: val.identificacion,
        nombre: val.nombre, nombre_comercial: comercial.value.trim(), correo: listaCorreos.join(', '), telefono: tel,
        provincia: prov.value, canton: cant.value, distrito: dist.value, barrio: c.barrio || '', otras_senas: senas.value.trim(),
        actividad_codigo: val.actividad_codigo, notas: notas.value.trim(), activo, sin_verificar_motivo: val.sin_verificar_motivo,
      };
      // Contrato: la llave se manda siempre que la base la sepa leer (también en blanco, para poder quitarla); a un cliente que no la trae no se le toca
      if (traeLlave !== false) datos.tarifa_habitual_codigo = tarifaSel || null;
      const r = await api.clienteGuardar(datos);
      const tarifaNoGuardada = !!tarifaSel && !!r && (!('tarifa_habitual_codigo' in r) || String(r.tarifa_habitual_codigo ?? '') !== tarifaSel);
      toast((esNuevo ? 'Cliente agregado.' : 'Cliente guardado.') + (r?.verificado ? '' : ' Quedó marcado como sin verificar en Hacienda.')
        + (tarifaNoGuardada ? ' La tarifa de IVA habitual todavía no se pudo guardar en este sistema; se cambia línea por línea al cobrar.' : ''), tarifaNoGuardada ? 'error' : 'ok', tarifaNoGuardada ? 9000 : 3500);
      cerrar();
      alGuardar?.(r);
    });
  }

  // Estado del cliente: activo o desactivado (solo en clientes ya guardados)
  const estadoTexto = h('p.mt-estado-txt');
  const estadoBtn = h('button.btn', { type: 'button' });
  const pintarEstado = () => {
    estadoTexto.replaceChildren(activo ? h('b', 'Activo. ') : h('b', 'Desactivado. '), activo ? 'Aparece al buscar cliente para facturar.' : 'No aparece al buscar cliente para facturar. Sus facturas anteriores no cambian.');
    estadoBtn.textContent = activo ? 'Desactivar cliente' : 'Activar cliente';
    estadoBtn.className = 'btn' + (activo ? '' : ' primario');
  };
  estadoBtn.addEventListener('click', () => conBoton(estadoBtn, async () => {
    const nuevo = !activo;
    const r = await clienteActivar(c.id, nuevo);
    activo = r.activo !== false;
    pintarEstado();
    toast(activo ? 'Cliente activado. Ya aparece al buscar cliente.' : 'Cliente desactivado. Ya no aparece al buscar cliente.');
    alCambiarEstado?.(r);
  }));
  pintarEstado();

  // Tarifa de IVA habitual: se guarda con la llave tarifa_habitual_codigo. Si la base todavía no la devuelve, se avisa en palabras y no se finge que se guardó.
  const traeLlave = esNuevo ? null : clienteTraeTarifa(c); // null = no se sabe (cliente nuevo), false = la base aún no la devuelve
  const codigoInicial = String(c.tarifa_habitual_codigo ?? '').trim();
  let tarifaSel = codigoInicial === '08' ? '' : codigoInicial;
  const tarAyuda = h('p.mt-tar-ayuda', { 'aria-live': 'polite' });
  const botonesTarifa = TARIFAS_CLIENTE.map((t) => h('button.mt-tarifa-btn', {
    type: 'button', disabled: traeLlave === false, 'data-codigo': t.codigo, 'aria-pressed': String(t.codigo === tarifaSel),
    onclick: () => { tarifaSel = t.codigo; pintarTarifa(); },
  }, h('b', t.texto)));
  function pintarTarifa() {
    botonesTarifa.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.codigo === tarifaSel)));
    const t = TARIFAS_CLIENTE.find((x) => x.codigo === tarifaSel) || TARIFAS_CLIENTE[0];
    tarAyuda.textContent = t.ayuda + (tarifaSel ? ' En la caja se le avisará a la cajera y podrá aplicar esta tarifa a las líneas con un botón.' : '');
  }
  pintarTarifa();
  const bloqueTarifa = h('fieldset', h('legend', 'Tarifa de IVA habitual de este cliente'),
    h('div.col',
      h('small.tenue', 'Si este cliente casi siempre paga una tarifa distinta del IVA normal (por ejemplo una universidad pública paga 2 %), escójala aquí. Nunca se aplica sola: al elegir al cliente en la caja, el sistema avisa y ofrece un botón para aplicarla.'),
      traeLlave === false ? aviso('ambar', 'Esta opción todavía no se puede guardar en este sistema. Estará lista cuando se termine la actualización. Mientras tanto, la tarifa se cambia línea por línea al cobrar.') : null,
      h('div.mt-tarifas', { role: 'group', 'aria-label': 'Tarifa de IVA habitual' }, botonesTarifa),
      tarAyuda));

  const cuerpo = h('div.mt-form',
    err,
    esNuevo ? null : h('fieldset', h('legend', 'Estado del cliente'), h('div.col', estadoTexto, estadoBtn)),
    h('fieldset', h('legend', 'Identificación'), ced.el),
    h('fieldset', h('legend', 'Correos para enviar la factura'),
      h('div.col',
        h('small.tenue', 'El correo principal es obligatorio y es el que se informa a Hacienda. Puede agregar hasta 3 correos más, opcionales: la factura (con su PDF y los dos XML) llega a los 4 al mismo tiempo.'),
        h('div.rejilla.dos', correos.map((x, i) => campo(rotulosCorreo[i], x))),
        avisoCorreo)),
    h('fieldset', h('legend', 'Contacto'),
      h('div.col',
        campo('Nombre comercial (si tiene)', comercial),
        campo('Teléfono (opcional)', telefono))),
    h('fieldset', h('legend', 'Dirección (obligatoria)'),
      h('div.col',
        h('small.tenue', 'Provincia, cantón y distrito se eligen de las listas oficiales para evitar errores. Las otras señas se escriben.'),
        h('div.rejilla', campo('Provincia', prov), campo('Cantón', cant), campo('Distrito', dist)),
        campo('Otras señas', senas, 'Por ejemplo: 200 metros norte de la iglesia, portón negro.'))),
    bloqueTarifa,
    h('fieldset', h('legend', 'Notas internas'),
      campo('Notas (solo las ve usted, no salen en la factura)', notas)),
    !esNuevo && c.creado_en ? h('small.tenue', 'Cliente agregado el ' + new Intl.DateTimeFormat('es-CR', { timeZone: 'America/Costa_Rica', dateStyle: 'long' }).format(new Date(c.creado_en)) + '.') : null);

  const m = modal({
    titulo: titulo || (esNuevo ? 'Agregar cliente' : 'Cliente: ' + nombrePropio(c.nombre)), contenido: cuerpo, ancho: 760, alCerrar: () => ced.destruir(),
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
        h('div.mt-datos', h('span.mt-nombre', nombrePropio(cl.nombre)), h('span.mt-sub', (TIPOS_ID[cl.tipo_id] || '') + ' ' + (cl.identificacion || '') + (cl.correo ? ' · ' + cl.correo : '')),
          tarifaHabitual(cl) ? h('span.mt-sub', h('span.chip.espera', 'Paga ' + tarifaHabitual(cl).texto)) : null),
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
