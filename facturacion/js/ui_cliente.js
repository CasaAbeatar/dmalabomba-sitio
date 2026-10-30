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
//     la dirección es opcional y puede estar INCOMPLETA: un solo dato (provincia, cantón, distrito, barrio u otras señas) ya vale. Lo que falta se ve
//     en pantalla como «Sin dato», no se guarda (queda vacío en la base) y no sale en la factura (js/direccion_cliente.js).
//     Ver js/ui_cedula.js para las reglas de la cédula.
//     También se elige la «Tarifa de IVA habitual de este cliente» (llave tarifa_habitual_codigo de fx_cliente_guardar): solo avisa en la
//     Caja y ofrece aplicarla; nunca se aplica sola.
//     Si la base no acepta el guardado, el motivo sale en el cuadro rojo de arriba del formulario (no en un aviso que se va solo) y el foco pasa al
//     campo del problema; lo escrito se queda. Con cambios sin guardar, cerrar la ventana (Cancelar, «Cerrar ✕», Escape, tocar fuera o Atrás)
//     pregunta antes «¿Salir sin guardar?». (Cuando el sistema cierra todas las ventanas por su cuenta, al cambiar de pantalla o al cerrar la sesión,
//     no se puede preguntar: util.js cierra sin consultar.)
import { h, modal, debounce, TIPOS_ID, toast, nombrePropio, confirmar } from './util.js';
import { api } from './api.js';
import { clientesTodos, clienteActivar } from './api_clientes.js';
import { UBICACIONES } from './data_ubicaciones.js';
import { cargarCss, campo, aviso, conBotonM, mensajeSeguro } from './ui_mant.js';
import { crearCampoIdentificacion, leerCorreos, llevaLetras, limpiarNumeroId } from './ui_cedula.js';
import { TARIFAS_CLIENTE, tarifaHabitual, clienteTraeTarifa } from './iva.js';
import { SIN_DATO, partesParaPantalla, estadoDireccion, codigoUbicacion, fueraDeLista } from './direccion_cliente.js';

export { leerCorreos };

// La dirección guardada de un cliente, con cada dato y su rótulo. Lo que falta dice «Sin dato» (solo en pantalla: en la base queda vacío y en los documentos no sale).
// Un código que no está en el catálogo dice «Código 99 (no está en la lista)», igual que la lista desplegable.
// compacto = una sola línea corrida, para las tarjetas de la lista de Clientes.
export function resumenDireccion(c, { compacto = false } = {}) {
  const partes = partesParaPantalla(c);
  return h('div.dir-resumen' + (compacto ? '.compacto' : ''), { 'aria-label': 'Dirección guardada del cliente' },
    ...partes.map((p) => h('div.dir-parte' + (p.falta ? '.falta' : '') + (p.fuera ? '.fuera' : ''), h('span.dir-et', p.etiqueta + ': '), h('span.dir-val', p.valor))));
}

// Largo como lo cuenta la base (caracteres): un emoji cuenta 1, no 2 como en .length
const largo = (t) => [...String(t ?? '')].length;
const sinTildes = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
// util.js muestra en un aviso flotante el texto que devuelve «bloqueo»; cuando la pregunta ya sale en su propia ventana ese aviso sobra:
// se le pasa un texto y se quita antes de que la pantalla se vuelva a pintar.
const sinAvisoFlotante = (texto) => { const n = document.createTextNode(texto); queueMicrotask(() => n.parentNode?.closest?.('.toast')?.remove()); return n; };

// Hoy fx_cliente_guardar pide el correo principal en todo cliente activo con cédula (Hacienda lo trata como condicional: «cuando el cliente lo requiera»).
// Si BASE DE DATOS lo vuelve opcional (ver INFORME_FRONT_CATALOGO_RONDA4.md), basta cambiar esta constante a false.
const CORREO_OBLIGATORIO = true;
// Topes de la dirección = lo que Hacienda recibe en el XML del cliente (anexo v4.4: otras señas hasta 160, barrio hasta 50; fn/xml.ts corta ahí).
// La base usa los mismos topes desde sql/30c (fx_cliente_guardar y la carga masiva: señas 160 y barrio 50); el formulario no deja escribir más de lo que viaja a Hacienda.
const MAX_SENAS = 160;
const MAX_BARRIO = 50;
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
  // Hasta 8 correos: el primero es el principal (el que se informa a Hacienda) y la factura se envía a todos. Se ven 4 espacios; «Agregar otro correo» muestra los demás de a uno.
  const previos = String(c.correo || '').split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
  const rotulosCorreo = [CORREO_OBLIGATORIO ? 'Correo principal (obligatorio)' : 'Correo principal', ...[2, 3, 4, 5, 6, 7, 8].map((n) => 'Correo ' + n + ' (opcional)')];
  const correos = rotulosCorreo.map((r, i) => h('input.campo', { type: 'text', inputmode: 'email', autocapitalize: 'none', autocomplete: 'off', spellcheck: 'false', maxlength: 160, value: previos[i] || '', 'aria-label': r }));
  const avisoCorreo = h('small.tenue');
  let visiblesCorreo = 4; // el principal y 3 opcionales; los demás aparecen al llenarse o con «Agregar otro correo»
  const cajasCorreo = correos.slice(1).map((x, i) => campo(rotulosCorreo[i + 1], x));
  const btnMasCorreo = h('button.btn', { type: 'button', onclick: () => { visiblesCorreo = Math.min(correos.length, visiblesCorreo + 1); refrescarCorreo(); correos[visiblesCorreo - 1].focus(); } }, 'Agregar otro correo');
  const telefono = h('input.campo', { type: 'tel', autocomplete: 'off', value: c.telefono || '', 'aria-label': 'Teléfono' });
  const notas = h('textarea.campo', { rows: 2, 'aria-label': 'Notas' }, c.notas || '');
  // Barrio y señas sin maxlength: el navegador cuenta un emoji como 2 y lo cortaría a la mitad. El tope se cuenta en caracteres, como la base, y se avisa en palabras.
  const senas = h('textarea.campo', { rows: 2, 'aria-label': 'Otras señas' }, c.otras_senas || '');
  const barrio = h('input.campo', { type: 'text', autocomplete: 'off', value: c.barrio || '', 'aria-label': 'Barrio' });
  // Debajo de cada campo, un contador siempre visible («Lleva 23 de 160 letras.»); si se pasa, en su lugar sale el aviso en rojo
  // («Las otras señas tienen 170 letras y Hacienda acepta hasta 160. Borre 10.»), que es el mismo texto que sale al tocar Guardar.
  const cuentaSenas = h('small.dir-cuenta'), cuentaBarrio = h('small.dir-cuenta');
  const topeSenas = h('small.dir-tope', { role: 'status', hidden: true });
  const topeBarrio = h('small.dir-tope', { role: 'status', hidden: true });
  const textoTope = (sujeto, n, max) => sujeto + ' ' + n + ' letras y Hacienda acepta hasta ' + max + '. Borre ' + (n - max) + '.';
  const vigilarTope = (el, cuenta, aviso, max, sujeto) => {
    const pintar = () => {
      const n = largo(el.value.trim()), pasa = n > max;
      cuenta.hidden = pasa; cuenta.textContent = 'Lleva ' + n + ' de ' + max + ' letras.';
      aviso.hidden = !pasa; aviso.textContent = pasa ? textoTope(sujeto, n, max) : '';
      el.setAttribute('aria-invalid', String(pasa));
    };
    el.addEventListener('input', pintar); pintar();
  };
  vigilarTope(senas, cuentaSenas, topeSenas, MAX_SENAS, 'Las otras señas tienen');
  vigilarTope(barrio, cuentaBarrio, topeBarrio, MAX_BARRIO, 'El barrio tiene');
  const prov = h('select.campo', { 'aria-label': 'Provincia' });
  const cant = h('select.campo', { 'aria-label': 'Cantón' });
  const dist = h('select.campo', { 'aria-label': 'Distrito' });
  const ayudaUbic = h('small.tenue.dir-ayuda', { role: 'status' }); // dice por qué una lista solo trae «Sin dato»: falta elegir la de arriba (el texto largo no cabe dentro de la lista)
  // Las tres listas van lado a lado. Si lo elegido en alguna es largo, pasan a ocupar el ancho completo para que se lea entero: en tres columnas
  // (computadora) caben hasta 24 caracteres; más largos son «Código 99 (no está en la lista)» y dos nombres oficiales («San Francisco de Dos Ríos»,
  // «Aguacaliente o San Francisco»). Medido con la letra de la página; en el celular ya van una debajo de otra.
  const CABE_EN_COLUMNA = 24;
  const rejillaUbic = h('div.rejilla.dir-ubic', campo('Provincia', prov), campo('Cantón', cant), campo('Distrito', dist));
  const ajustarRejilla = () => rejillaUbic.classList.toggle('a-lo-ancho', [prov, cant, dist].some((x) => [...(x.selectedOptions[0]?.textContent || '')].length > CABE_EN_COLUMNA));

  // Provincia > cantón > distrito (códigos oficiales). Cada lista empieza con «Sin dato»: elegirlo deja ese dato vacío (no se guarda ni sale en la factura).
  // Si el cliente trae un código que no está en el catálogo (por ejemplo de una carga masiva), se conserva a la vista en vez de borrarlo sin avisar,
  // con el mismo texto que el resumen «Dirección guardada» (fueraDeLista). Al cambiar la provincia o el cantón, lo de abajo vuelve a «Sin dato».
  const opcionFuera = (cod) => h('option', { value: cod }, fueraDeLista(cod));
  const pIni = codigoUbicacion(c.provincia, 1);
  prov.append(h('option', { value: '' }, SIN_DATO), ...nombresOrdenados(Object.fromEntries(Object.entries(UBICACIONES).map(([k, v]) => [k, v[0]]))).map(([k, n]) => h('option', { value: k }, n)),
    ...(pIni && !UBICACIONES[pIni] ? [opcionFuera(pIni)] : []));
  const llenarCantones = (sel, selDist) => {
    const cs = UBICACIONES[prov.value]?.[1] || {};
    cant.replaceChildren(h('option', { value: '' }, SIN_DATO), ...nombresOrdenados(cs, 1).map(([k, v]) => h('option', { value: k }, v[0])), ...(sel && !cs[sel] ? [opcionFuera(sel)] : []));
    cant.value = sel || '';
    llenarDistritos(selDist);
  };
  const llenarDistritos = (sel) => {
    const ds = UBICACIONES[prov.value]?.[1]?.[cant.value]?.[1] || {};
    dist.replaceChildren(h('option', { value: '' }, SIN_DATO), ...nombresOrdenados(ds).map(([k, n]) => h('option', { value: k }, n)), ...(sel && !ds[sel] ? [opcionFuera(sel)] : []));
    dist.value = sel || '';
    ayudaUbic.textContent = !prov.value ? 'Para elegir el cantón, primero elija la provincia.' : !cant.value ? 'Para elegir el distrito, primero elija el cantón.' : '';
    ajustarRejilla();
  };
  prov.value = pIni;
  llenarCantones(codigoUbicacion(c.canton, 2), codigoUbicacion(c.distrito, 2));
  prov.addEventListener('change', () => llenarCantones());
  cant.addEventListener('change', () => llenarDistritos());
  dist.addEventListener('change', ajustarRejilla);

  const refrescarCorreo = () => {
    const llenos = correos.reduce((a, x, i) => (x.value.trim() ? i + 1 : a), 0);
    visiblesCorreo = Math.min(correos.length, Math.max(visiblesCorreo, llenos));
    cajasCorreo.forEach((el, i) => { el.hidden = i + 1 >= visiblesCorreo; });
    btnMasCorreo.hidden = visiblesCorreo >= correos.length;
    const n = correos.filter((x) => x.value.trim()).length;
    avisoCorreo.textContent = !n ? (CORREO_OBLIGATORIO ? 'Falta el correo principal: es adonde se envía la factura.' : 'Sin correo, la factura no se envía por correo: solo se puede imprimir.')
      : n > 1 ? 'La factura se enviará al mismo tiempo a estos ' + n + ' correos.'
      : previos.length > correos.length ? 'Este cliente tenía más de ' + correos.length + ' correos. Al guardar solo se conservan los primeros ' + correos.length + '.' : '';
  };
  correos.forEach((x) => x.addEventListener('input', refrescarCorreo));
  refrescarCorreo();


  // Número de identificación, nombre y actividad: se verifican en Hacienda (js/ui_cedula.js)
  const ced = crearCampoIdentificacion({
    cliente: esNuevo ? null : c,
    // En 05 y 06 (pasaporte y otros documentos con letras) el número se busca y se compara como lo guarda la base: letras en mayúscula, sin guiones, espacios ni signos.
    // A la base se le pregunta con ese mismo texto (fx_clientes_todos busca también por letras) y se comparan los dos lados ya limpios, por si algún cliente viejo quedó guardado de otra forma.
    revisarDuplicado: async (id) => {
      const letras = llevaLetras(ced.valores().tipo_id);
      const buscado = letras ? limpiarNumeroId(id, '05') : id;
      const igual = (x) => (letras ? limpiarNumeroId(x.identificacion, '05') === buscado : x.identificacion === buscado);
      return (await clientesTodos(soc.id, buscado)).find((x) => igual(x) && x.id !== c.id) || null;
    },
    accionDuplicado: { texto: 'Abrir el cliente que ya existe', fn: (otro) => { m.cerrar(); abrirFormCliente(app, otro, { alGuardar, alCambiarEstado, titulo }); } },
    numeroInicial: esNuevo ? numeroInicial : '',
    alTerminar: () => { [correos[0]].find((x) => !x.value.trim())?.focus(); },
  });

  // Tipo 05 «Extranjero no domiciliado»: Hacienda no acepta factura para ese tipo (la base frena el cobro, sql/30a y 30b). Se avisa al elegirlo, para que nadie se entere al cobrar.
  const avisoTipo05 = aviso('ambar', 'Hacienda no acepta factura para un cliente «' + TIPOS_ID['05'] + '»: a este cliente solo se le puede emitir tiquete, sin sus datos. Si tiene cédula, DIMEX o NITE, use ese número.');
  avisoTipo05.setAttribute('role', 'status'); avisoTipo05.classList.add('aviso-tipo05'); avisoTipo05.style.marginTop = '.7rem';
  const revisarTipo05 = () => { avisoTipo05.hidden = ced.valores().tipo_id !== '05'; };
  ced.el.addEventListener('change', revisarTipo05); ced.el.addEventListener('input', revisarTipo05); ced.el.addEventListener('click', () => setTimeout(revisarTipo05, 0));
  revisarTipo05();

  // Si la base no acepta el guardado, el motivo va al cuadro de error del formulario y el foco al campo del que habla el mensaje
  const campoDelError = (t) => {
    const s = sinTildes(t);
    if (/senas/.test(s)) return senas;
    if (/barrio/.test(s)) return barrio;
    if (/primero la provincia/.test(s)) return prov;
    if (/primero el canton/.test(s)) return cant;
    if (/distrito/.test(s)) return dist;
    if (/canton/.test(s)) return cant;
    if (/provincia/.test(s)) return prov;
    if (/correo/.test(s)) { const q = /["«]([^"»]+)["»]/.exec(t)?.[1]; return correos.find((x) => q && x.value.includes(q)) || correos[0]; }
    if (/telefono/.test(s)) return telefono;
    if (/tarifa/.test(s)) return botonesTarifa.find((b) => !b.disabled) || null;
    if (/actividad/.test(s)) return ced.actividad || null;
    if (/identificacion|cedula|dimex|nite/.test(s)) return ced.ident || null;
    if (/nombre/.test(s)) return ced.nombre || null;
    return null;
  };
  let guardando = false;
  async function guardar(cerrar) {
    mostrarError('');
    const btn = m.el.querySelector('.modal-pie .primario');
    if (!btn || btn.dataset.ocupado) return; // un segundo toque mientras se guarda no hace nada
    guardando = true;
    try { await guardarYa(btn, cerrar); } finally { guardando = false; }
  }
  async function guardarYa(btn, cerrar) {
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
      // La dirección es opcional y puede ir incompleta: con un solo dato basta. Solo se cuida que quepa, contando caracteres como la base (las listas no dejan elegir
      // un cantón sin provincia ni un distrito sin cantón; un código viejo que no está en el catálogo se conserva y, si la base no lo acepta, su mensaje sale arriba).
      const sn = senas.value.trim(), bar = barrio.value.trim();
      if (largo(bar) > MAX_BARRIO) return mostrarError('El barrio es demasiado largo. ' + textoTope('Tiene', largo(bar), MAX_BARRIO), barrio);
      if (largo(sn) > MAX_SENAS) return mostrarError('Las otras señas son demasiado largas. ' + textoTope('Tienen', largo(sn), MAX_SENAS), senas);
      // (un cliente viejo o de la carga masiva con más letras de las que acepta Hacienda ve el aviso al abrirlo y se le pide acortarlas antes de guardar)
      const val = ced.valores();
      // La dirección se manda siempre completa tal como está en el formulario (lo que está en blanco se manda en blanco y la base lo deja vacío); nunca se manda «Sin dato».
      const datos = {
        id: c.id || undefined, solo_nuevo: esNuevo, sociedad_id: soc.id, tipo_id: val.tipo_id, identificacion: val.identificacion,
        nombre: val.nombre, nombre_comercial: comercial.value.trim(), correo: listaCorreos.join(', '), telefono: tel,
        provincia: prov.value, canton: cant.value, distrito: dist.value, barrio: bar, otras_senas: sn,
        actividad_codigo: val.actividad_codigo, notas: notas.value.trim(), activo, sin_verificar_motivo: val.sin_verificar_motivo,
      };
      // Contrato: la llave se manda siempre que la base la sepa leer (también en blanco, para poder quitarla); a un cliente que no la trae no se le toca
      if (traeLlave !== false) datos.tarifa_habitual_codigo = tarifaSel || null;
      let r;
      try { r = await api.clienteGuardar(datos); } catch (e) { const t = mensajeSeguro(e); return mostrarError(t, campoDelError(t)); } // la ventana sigue abierta con lo escrito
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
  estadoBtn.addEventListener('click', () => conBotonM(estadoBtn, async () => {
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
  const estadoDir = esNuevo ? null : estadoDireccion(c); // 'sin' | 'parcial' | 'completa' (null en un cliente nuevo); la lista de Clientes usa la misma función
  const conTope = (etq, ...extra) => { etq.append(...extra); return etq; };
  const masBloque = h('div.mt-form', { hidden: esNuevo, id: 'mt-mas-datos' },
    h('fieldset', h('legend', 'Otros correos (opcionales)'),
      h('div.col',
        h('small.tenue', 'Puede agregar hasta 7 correos más: a todos se les enviará la factura con su PDF y sus archivos para Hacienda.'),
        h('div.rejilla.dos', cajasCorreo),
        btnMasCorreo)),
    h('fieldset', h('legend', 'Contacto'),
      h('div.col',
        campo('Nombre comercial (si tiene)', comercial),
        campo('Teléfono (opcional)', telefono))),
    h('fieldset', h('legend', 'Dirección (opcional)'),
      h('div.col',
        h('small.tenue', 'Hacienda no pide la dirección para facturar. Escriba solo lo que sepa: con un dato ya basta. Lo que deje en «' + SIN_DATO + '» no se guarda y no sale en la factura. Provincia, cantón y distrito se eligen de las listas oficiales para evitar errores.'),
        estadoDir === 'sin' ? aviso('info', 'Este cliente no tiene dirección guardada. No hace falta para facturarle; agréguela solo si el cliente la quiere en su factura.') : null,
        estadoDir === 'parcial' ? aviso('info', 'La dirección de este cliente está incompleta, y está bien: no hace falta para facturarle. En la factura saldrá solo lo que sí tiene.') : null,
        estadoDir && estadoDir !== 'sin' ? h('div.dir-guardada', h('b', 'Dirección guardada'), resumenDireccion(c)) : null,
        rejillaUbic, ayudaUbic,
        conTope(campo('Barrio (opcional)', barrio), cuentaBarrio, topeBarrio),
        conTope(campo('Otras señas', senas, 'Por ejemplo: 200 metros norte de la iglesia, portón negro.'), cuentaSenas, topeSenas))),
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
    h('fieldset', h('legend', 'Identificación'), ced.el, avisoTipo05),
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

  // Cambios sin guardar: la persona tocó algún campo (o una tarifa) y lo que hay en el formulario ya no es lo que había al abrirlo.
  // (Lo que el sistema llena solo, como la actividad que trae Hacienda, no cuenta mientras la persona no haya tocado nada.)
  const huella = () => JSON.stringify([...cuerpo.querySelectorAll('input, select, textarea')].map((x) => (x.type === 'checkbox' || x.type === 'radio' ? x.checked : x.value)).concat(tarifaSel));
  const huella0 = huella();
  let tocado = false, preguntando = false;
  const marcar = () => { tocado = true; };
  cuerpo.addEventListener('input', marcar); cuerpo.addEventListener('change', marcar);
  botonesTarifa.forEach((b) => b.addEventListener('click', marcar));
  const hayCambios = () => tocado && huella() !== huella0;
  async function preguntarSalir() {
    if (preguntando) return;
    preguntando = true;
    const salir = await confirmar('¿Salir sin guardar? Lo que escribió se perderá.', { si: 'Salir sin guardar', no: 'Seguir editando', peligro: true });
    preguntando = false;
    if (salir) m.cerrar();
  }
  // Cancelar, «Cerrar ✕», Escape, tocar fuera y Atrás pasan por aquí (opción «bloqueo» de modal en util.js)
  const bloqueo = () => {
    if (guardando) return 'Espere un momento: se está guardando el cliente.';
    if (!hayCambios()) return '';
    preguntarSalir();
    return sinAvisoFlotante('Tiene cambios sin guardar.');
  };
  const m = modal({
    titulo: titulo || (esNuevo ? 'Agregar cliente' : 'Cliente: ' + nombrePropio(c.nombre)), contenido: cuerpo, ancho: 760, alCerrar: () => ced.destruir(), bloqueo,
    botones: [{ texto: 'Cancelar', clase: 'suave', onclick: (x) => { const b = bloqueo(); if (!b) x(); else if (typeof b === 'string') toast(b, 'error', 5000); } }, { texto: esNuevo ? 'Guardar cliente' : 'Guardar cambios', clase: 'primario', onclick: (x) => guardar(x) }],
  });
  if (esNuevo) ced.enfocar();
  return m;
}

export function selectorCliente(app, { alElegir, titulo = 'Elegir cliente' } = {}) {
  cargarCss();
  const soc = app.soc;
  const q = h('input.mt-buscar', { type: 'search', placeholder: 'Nombre, cédula, correo o teléfono', autocomplete: 'off', 'aria-label': 'Buscar cliente' });
  const lista = h('div.mt-lista.mt-lista-sel', { style: 'margin-top:.8rem', tabindex: '0', 'aria-label': 'Lista de clientes: deslice hacia abajo para ver más' });
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
          !cl.correo ? h('span.mt-sub', h('span.chip.espera', 'Sin correo'), ' Pida el correo al cliente.') : null,
          /^0+$/.test(String(cl.identificacion || '')) ? h('span.mt-sub', h('span.chip.mal', 'Falta la cédula correcta'), ' Se escribe al cobrar; sin ella no se puede cobrar a su nombre.') : null),
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
