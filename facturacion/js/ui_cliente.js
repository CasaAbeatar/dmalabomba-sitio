// Componentes de clientes reutilizables (los usa la pantalla Clientes y los puede usar Caja).
//
//   import { selectorCliente, abrirFormCliente } from './ui_cliente.js';
//
//   selectorCliente(app, { alElegir(cliente) { ... }, titulo? })
//     Abre una ventana con buscador grande (nombre, cédula, correo o teléfono) y la lista de clientes del local activo.
//     Al tocar "Elegir" llama alElegir(cliente) y cierra la ventana. El botón «Agregar cliente nuevo» está siempre a la vista (en el pie de la ventana):
//     si lo escrito en el buscador parece una cédula (9 números o más), el formulario nuevo ya empieza con ese número.
//     Al guardar el cliente nuevo también se elige solo. Devuelve { cerrar }.
//     "cliente" es la fila completa de fact.clientes: { id, tipo_id, identificacion, nombre, nombre_comercial, correo, telefono,
//     provincia, canton, distrito, barrio, otras_senas, actividad_codigo, notas, ... }.
//
//   abrirFormCliente(app, cliente|null, { alGuardar(cliente), titulo?, numeroInicial? })
//     Abre el formulario para crear (cliente = null) o ver/editar un cliente. Devuelve { cerrar }.
//     Cliente NUEVO = formulario rápido: solo lo mínimo a la vista (número de identificación verificado en Hacienda, nombre, actividad que
//     llena Hacienda y correo principal). Lo demás (otros correos, teléfono, dirección, tarifa de IVA habitual, notas) queda detrás del botón
//     «Agregar más datos del cliente» y es opcional. Al EDITAR se ve todo.
//     Reglas (v4.4 de Hacienda y fx_cliente_guardar): el correo principal es obligatorio mientras el servidor lo exija (CORREO_OBLIGATORIO);
//     la dirección es opcional pero «todo o nada»: si se escribe una parte, van provincia, cantón, distrito y otras señas (5 a 160 letras).
//     Ver js/ui_cedula.js para las reglas de la cédula.
//     También se elige la «Tarifa de IVA habitual de este cliente» (llave tarifa_habitual_codigo de fx_cliente_guardar): solo avisa en la
//     Caja y ofrece aplicarla; nunca se aplica sola.
import { h, modal, debounce, TIPOS_ID, toast, nombrePropio } from './util.js';
import { api } from './api.js';
import { clientesTodos, clienteActivar } from './api_clientes.js';
import { UBICACIONES } from './data_ubicaciones.js';
import { cargarCss, campo, aviso, conBotonM, mensajeSeguro } from './ui_mant.js';
import { crearCampoIdentificacion, leerCorreos } from './ui_cedula.js';
import { TARIFAS_CLIENTE, tarifaHabitual, clienteTraeTarifa } from './iva.js';

export { leerCorreos };

// Hoy fx_cliente_guardar pide el correo principal en todo cliente activo con cédula (Hacienda lo trata como condicional: «cuando el cliente lo requiera»).
// Si BASE DE DATOS lo vuelve opcional (ver INFORME_FRONT_CATALOGO_RONDA4.md), basta cambiar esta constante a false.
const CORREO_OBLIGATORIO = true;
const MAX_SENAS = 160; // el anexo v4.4 de Hacienda acepta de 5 a 160 caracteres en las otras señas del receptor
const pad2 = (x) => String(x ?? '').replace(/\D/g, '').padStart(2, '0').slice(-2);
const nombresOrdenados = (obj, i) => Object.entries(obj || {}).sort((a, b) => String(i ? a[1][0] : a[1]).localeCompare(String(i ? b[1][0] : b[1]), 'es'));

export function abrirFormCliente(app, cliente, { alGuardar, alCambiarEstado, titulo, numeroInicial } = {}) {
  cargarCss();
  const soc = app.soc;
  const c = cliente || {};
  const esNuevo = !c.id;
  let activo = c.activo !== false; // un cliente desactivado no aparece al buscar cliente para facturar
  const err = h('div.error-caja', { hidden: true, role: 'alert' });
  const mostrarError = (m, campoEl) => {
    err.textContent = m; err.hidden = !m;
    if (!m) return;
    if (campoEl && masBloque.hidden && masBloque.contains(campoEl)) abrirMas(true); // el campo con el problema está en «más datos»: se abre para que se vea
    err.scrollIntoView({ block: 'nearest' });
    campoEl?.focus();
  };

  const comercial = h('input.campo', { type: 'text', autocomplete: 'off', value: c.nombre_comercial || '', 'aria-label': 'Nombre comercial' });
  // Hasta 4 correos: el primero es el principal (el que se informa a Hacienda) y la factura se envía a todos
  const previos = String(c.correo || '').split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
  const rotulosCorreo = [CORREO_OBLIGATORIO ? 'Correo principal (obligatorio)' : 'Correo principal', 'Correo 2 (opcional)', 'Correo 3 (opcional)', 'Correo 4 (opcional)'];
  const correos = rotulosCorreo.map((r, i) => h('input.campo', { type: 'text', inputmode: 'email', autocapitalize: 'none', autocomplete: 'off', spellcheck: 'false', maxlength: 160, value: previos[i] || '', 'aria-label': r }));
  const avisoCorreo = h('small.tenue');
  const telefono = h('input.campo', { type: 'tel', autocomplete: 'off', value: c.telefono || '', 'aria-label': 'Teléfono' });
  const notas = h('textarea.campo', { rows: 2, 'aria-label': 'Notas' }, c.notas || '');
  const senas = h('textarea.campo', { rows: 2, maxlength: MAX_SENAS, 'aria-label': 'Otras señas' }, c.otras_senas || '');
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
    avisoCorreo.textContent = !n ? (CORREO_OBLIGATORIO ? 'Falta el correo principal: es adonde se envía la factura.' : 'Sin correo, la factura no se envía por correo: solo se puede imprimir.')
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
    numeroInicial: esNuevo ? numeroInicial : '',
    alTerminar: () => { [correos[0]].find((x) => !x.value.trim())?.focus(); },
  });

  async function guardar(cerrar) {
    mostrarError('');
    const btn = m.el.querySelector('.modal-pie .primario');
    if (!btn || btn.dataset.ocupado) return; // un segundo toque mientras se guarda no hace nada
    await conBotonM(btn, async () => {
      const v = await ced.validar();
      if (v) return mostrarError(v.mensaje, v.campo);
      if (CORREO_OBLIGATORIO && !correos[0].value.trim()) return mostrarError(correos.some((x) => x.value.trim()) ? 'Escriba el correo principal en el primer espacio. Los otros correos son adicionales.' : 'Falta el correo principal: es adonde se envía la factura.', correos[0]);
      if (!correos[0].value.trim() && correos.some((x) => x.value.trim())) return mostrarError('Escriba el correo principal en el primer espacio. Los otros correos son adicionales.', correos[0]);
      const listaCorreos = [];
      for (const cc of correos) {
        const v = cc.value.trim();
        if (!v) continue;
        const cr = leerCorreos(v);
        if (cr.error) return mostrarError(cr.error, cc);
        if (cr.lista.length !== 1) return mostrarError('Escriba un solo correo en cada espacio. Para más correos use los otros espacios.', cc);
        if (listaCorreos.includes(cr.lista[0])) return mostrarError('El correo «' + cr.lista[0] + '» está repetido.', cc);
        listaCorreos.push(cr.lista[0]);
      }
      const tel = telefono.value.replace(/\D/g, '');
      if (tel && (tel.length < 8 || tel.length > 20)) return mostrarError('El teléfono debe tener entre 8 y 20 números.', telefono);
      // Dirección opcional pero «todo o nada»: si se escribe alguna parte, deben ir provincia, cantón, distrito y otras señas (Hacienda pide de 5 a 160 letras)
      const sn = senas.value.trim();
      if (prov.value || cant.value || dist.value || sn) {
        if (!prov.value) return mostrarError('Si agrega la dirección, debe estar completa. Falta elegir la provincia (o borre lo que escribió de la dirección).', prov);
        if (!cant.value) return mostrarError('Si agrega la dirección, debe estar completa. Falta elegir el cantón.', cant);
        if (!dist.value) return mostrarError('Si agrega la dirección, debe estar completa. Falta elegir el distrito.', dist);
        if (sn.length < 5) return mostrarError('Si agrega la dirección, debe estar completa. Faltan las otras señas (por ejemplo: 200 metros norte de la iglesia). Escriba al menos 5 letras.', senas);
        if (sn.length > MAX_SENAS) return mostrarError('Las otras señas son demasiado largas: Hacienda acepta hasta ' + MAX_SENAS + ' letras. Acórtelas.', senas);
      }
      const val = ced.valores();
      const datos = {
        id: c.id || undefined, solo_nuevo: esNuevo, sociedad_id: soc.id, tipo_id: val.tipo_id, identificacion: val.identificacion,
        nombre: val.nombre, nombre_comercial: comercial.value.trim(), correo: listaCorreos.join(', '), telefono: tel,
        provincia: prov.value, canton: cant.value, distrito: dist.value, barrio: c.barrio || '', otras_senas: sn,
        actividad_codigo: val.actividad_codigo, notas: notas.value.trim(), activo, sin_verificar_motivo: val.sin_verificar_motivo,
      };
      // Contrato: la llave se manda siempre que la base la sepa leer (también en blanco, para poder quitarla); a un cliente que no la trae no se le toca
      if (traeLlave !== false) datos.tarifa_habitual_codigo = tarifaSel || null;
      const r = await api.clienteGuardar(datos);
      const tarifaNoGuardada = !!tarifaSel && !!r && (!('tarifa_habitual_codigo' in r) || String(r.tarifa_habitual_codigo ?? '') !== tarifaSel);
      toast((esNuevo ? 'Cliente agregado.' : 'Cliente guardado.') + (r?.verificado ? '' : ' Quedó marcado como sin verificar en Hacienda.')
        + (tarifaNoGuardada ? ' La tarifa de IVA habitual todavía no se pudo guardar en este sistema; se cambia producto por producto al cobrar.' : ''), tarifaNoGuardada ? 'error' : 'ok', tarifaNoGuardada ? 9000 : 3500);
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
    tarAyuda.textContent = t.ayuda + (tarifaSel ? ' Al cobrar se le avisará a la cajera y podrá aplicar esta tarifa a los productos con un botón.' : '');
  }
  pintarTarifa();
  const bloqueTarifa = h('fieldset', h('legend', 'Tarifa de IVA habitual de este cliente'),
    h('div.col',
      h('small.tenue', 'Si este cliente casi siempre paga una tarifa distinta del IVA normal (por ejemplo una universidad pública paga 2 %), escójala aquí. Nunca se aplica sola: al elegir al cliente en Facturación, el sistema avisa y ofrece un botón para aplicarla.'),
      traeLlave === false ? aviso('ambar', 'Esta opción todavía no se puede guardar en este sistema. Estará lista cuando se termine la actualización. Mientras tanto, la tarifa se cambia producto por producto al cobrar.') : null,
      h('div.mt-tarifas', { role: 'group', 'aria-label': 'Tarifa de IVA habitual' }, botonesTarifa),
      tarAyuda));

  // Datos que Hacienda no pide para facturar. En un cliente nuevo quedan detrás del botón «Agregar más datos del cliente»; al editar se ven siempre.
  const faltaDir = !esNuevo && ['01', '02', '03', '04'].includes(String(c.tipo_id)) && !(c.provincia && c.canton && c.distrito && String(c.otras_senas || '').trim().length >= 5);
  const masBloque = h('div.mt-form', { hidden: esNuevo, id: 'mt-mas-datos' },
    h('fieldset', h('legend', 'Otros correos (opcionales)'),
      h('div.col',
        h('small.tenue', 'Puede agregar hasta 3 correos más: a todos se les enviará la factura con su PDF y sus archivos para Hacienda.'),
        h('div.rejilla.dos', correos.slice(1).map((x, i) => campo(rotulosCorreo[i + 1], x))))),
    h('fieldset', h('legend', 'Contacto'),
      h('div.col',
        campo('Nombre comercial (si tiene)', comercial),
        campo('Teléfono (opcional)', telefono))),
    h('fieldset', h('legend', 'Dirección (opcional)'),
      h('div.col',
        h('small.tenue', 'Hacienda no pide la dirección para facturar. Si la agrega, debe estar completa: provincia, cantón, distrito y otras señas. Provincia, cantón y distrito se eligen de las listas oficiales para evitar errores.'),
        faltaDir ? aviso('info', 'Este cliente no tiene la dirección completa. No hace falta para facturarle; agréguela solo si el cliente la quiere en su factura.') : null,
        h('div.rejilla', campo('Provincia', prov), campo('Cantón', cant), campo('Distrito', dist)),
        campo('Otras señas', senas, 'Por ejemplo: 200 metros norte de la iglesia, portón negro. Máximo ' + MAX_SENAS + ' letras.'))),
    bloqueTarifa,
    h('fieldset', h('legend', 'Notas internas'),
      campo('Notas (solo las ve usted, no salen en la factura)', notas)));
  const masBtn = h('button.btn.mt-mas', { type: 'button', hidden: !esNuevo, 'aria-expanded': 'false', 'aria-controls': 'mt-mas-datos', onclick: () => abrirMas(masBloque.hidden) });
  function pintarMasBtn() {
    masBtn.replaceChildren(h('b', masBloque.hidden ? 'Agregar más datos del cliente (opcional)' : 'Ocultar los datos opcionales'),
      h('small', masBloque.hidden ? 'Otros correos, teléfono, dirección, tarifa de IVA habitual y notas. Hacienda no los pide para facturar.' : 'Lo que escribió aquí se guarda igual.'));
    masBtn.setAttribute('aria-expanded', String(!masBloque.hidden));
  }
  function abrirMas(abrir) { masBloque.hidden = !abrir; pintarMasBtn(); }
  pintarMasBtn();

  // La actividad económica casi siempre la llena Hacienda sola: su bloque pasa después del correo para que lo que hay que escribir quede arriba
  const actividadBloque = ced.el.querySelector('.ced-bloque:last-child');
  const cuerpo = h('div.mt-form',
    err,
    esNuevo ? null : h('fieldset', h('legend', 'Estado del cliente'), h('div.col', estadoTexto, estadoBtn)),
    h('fieldset', h('legend', 'Identificación'), ced.el),
    h('fieldset', h('legend', 'Correo para enviar la factura'),
      h('div.col',
        h('small.tenue', CORREO_OBLIGATORIO ? 'El correo principal es obligatorio: es adonde llega la factura y es el que se informa a Hacienda.' : 'El correo principal es adonde llega la factura y el que se informa a Hacienda.'),
        campo(rotulosCorreo[0], correos[0]),
        avisoCorreo)),
    h('fieldset', h('legend', 'Actividad económica'), actividadBloque),
    masBtn,
    masBloque,
    !esNuevo && c.creado_en ? h('small.tenue', 'Cliente agregado el ' + new Intl.DateTimeFormat('es-CR', { timeZone: 'America/Costa_Rica', dateStyle: 'long' }).format(new Date(c.creado_en)) + '.') : null);

  cuerpo.addEventListener('input', () => { if (!err.hidden) mostrarError(''); }); // el aviso de un intento anterior se quita en cuanto la persona corrige algo
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
  const q = h('input.mt-buscar', { type: 'search', placeholder: 'Nombre, cédula, correo o teléfono', autocomplete: 'off', 'aria-label': 'Buscar cliente' });
  const lista = h('div.mt-lista', { style: 'margin-top:.8rem' });
  let m, n = 0;
  const elegir = (cl) => { m.cerrar(); alElegir?.(cl); };
  // Si lo escrito en el buscador parece una cédula, el cliente nuevo ya empieza con ese número
  const agregarNuevo = () => {
    const digitos = q.value.replace(/\D/g, '');
    abrirFormCliente(app, null, { numeroInicial: digitos.length >= 9 ? digitos : '', alGuardar: (cl) => { m.cerrar(); alElegir?.(cl); } });
  };
  const cargar = async () => {
    const mi = ++n;
    try {
      const r = await api.clientes(soc.id, q.value.trim());
      if (mi !== n) return;
      lista.replaceChildren(...(r.length ? r.map((cl) => h('div.mt-item',
        h('div.mt-datos', h('span.mt-nombre', nombrePropio(cl.nombre)), h('span.mt-sub', (TIPOS_ID[cl.tipo_id] || '') + ' ' + (cl.identificacion || '') + (cl.correo ? ' · ' + cl.correo : '')),
          tarifaHabitual(cl) ? h('span.mt-sub', h('span.chip.espera', 'Paga ' + tarifaHabitual(cl).texto)) : null,
          cl.verificado === false ? h('span.mt-sub', h('span.chip.espera', 'Sin verificar en Hacienda'), ' Revise el número antes de cobrar: si no existe, Hacienda rechaza la factura.') : null,
          !cl.correo ? h('span.mt-sub', h('span.chip', 'Sin correo')) : null),
        h('div.mt-btns', h('button.btn.primario', { type: 'button', onclick: () => elegir(cl) }, 'Elegir')))) : [h('div.vacio', q.value ? 'No hay clientes con eso. Toque «Agregar cliente nuevo» para guardarlo.' : 'Todavía no hay clientes guardados. Toque «Agregar cliente nuevo» para guardar el primero.')]));
    } catch (e) { if (mi === n) lista.replaceChildren(h('div.error-caja', mensajeSeguro(e, 'No se pudo cargar la lista de clientes. Revise la conexión e intente de nuevo.'))); }
  };
  q.addEventListener('input', debounce(cargar, 250));
  m = modal({
    titulo, ancho: 680,
    contenido: h('div', q, lista),
    botones: [{ texto: 'Cerrar', clase: 'suave', onclick: (x) => x() }, { texto: 'Agregar cliente nuevo', clase: 'primario', onclick: () => agregarNuevo() }],
  });
  q.focus();
  cargar();
  return m;
}
