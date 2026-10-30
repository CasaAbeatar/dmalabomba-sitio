// Campo de identificación con verificación en Hacienda. Lo usan el formulario de Clientes y la creación rápida de cliente en Caja.
//
//   import { crearCampoIdentificacion } from './ui_cedula.js';
//
//   const ced = crearCampoIdentificacion({
//     cliente,                      // fila de fact.clientes al editar; omitir al crear
//     revisarDuplicado(ident),      // opcional: promesa con el cliente ya guardado con ese número, o null
//     accionDuplicado: { texto, fn(clienteExistente) },
//     alTerminar(),                 // opcional: la consulta llenó todo; que el formulario lleve el foco a su siguiente campo vacío
//     numeroInicial,                // opcional (cliente nuevo): número que la persona ya había escrito en el buscador; se consulta de una vez
//   });
//   ced.el            -> bloque con: número de identificación, nombre o razón social y código de actividad (en ese orden)
//   await ced.validar() -> null si todo está bien, o { mensaje, campo } con el primer problema
//   ced.valores()     -> { tipo_id, identificacion, nombre, actividad_codigo, sin_verificar_motivo, verificado }
//
// Reglas: el número es siempre texto (se quitan guiones y espacios al pegar; nunca se pierden ceros ni se corta el primer número).
//  * Cédula física, jurídica, DIMEX y NITE (01 a 04) llevan solo números, con su largo; el tipo se detecta por la cantidad de números.
//  * Extranjero no domiciliado y no contribuyente (05 y 06: pasaportes y otros documentos) llevan letras y números, hasta 20, con las letras en
//    mayúsculas: lo mismo que guarda la base (fx_cliente_guardar) y lo que va en el XML. Se eligen con «Elegir el tipo» / «Cambiar tipo».
//  * Si se escriben letras sin haber elegido un tipo que las lleve, NO se borran: se avisa en palabras y se ofrece elegir el tipo.
// Se consulta a Hacienda mientras se escribe (solo 01 a 04; espera 0,5 s sin teclear y cancela la consulta vieja).
// De Hacienda solo se usan el nombre, el tipo y las actividades económicas (que se muestran en palabras, no como código crudo).
import { h, TIPOS_ID, fechaCorta, nombrePropio } from './util.js';
import { apiM } from './api_mantenimiento.js';
import { infoActividad, textoActividad } from './actividades.js';

let cssListo = null;
export function cargarCssCedula() {
  if (cssListo) return cssListo;
  const href = new URL('../css/cedula.css', import.meta.url).href;
  cssListo = new Promise((ok) => {
    if ([...document.querySelectorAll('link[rel=stylesheet]')].some((l) => l.href === href)) return ok();
    const l = h('link', { rel: 'stylesheet', href });
    l.addEventListener('load', () => ok());
    l.addEventListener('error', () => ok());
    document.head.append(l);
    setTimeout(ok, 2500);
  });
  return cssListo;
}

/* ---------- Reglas comunes (también las usa Caja) ---------- */
// Código de actividad tal como lo entrega Hacienda: "5610.0" (4 números, punto, 1 número) o 6 números seguidos
export const RE_ACTIVIDAD = /^(\d{4}\.\d|\d{6})$/;
export const AYUDA_ACTIVIDAD = 'El código tiene 6 caracteres: cuatro números, un punto y un número (por ejemplo 5610.0), o seis números seguidos.';
export const limpiarActividad = (s) => String(s ?? '').replace(/,/g, '.').replace(/[^0-9.]/g, '').slice(0, 6);
export const errorActividad = (v) => (!v || RE_ACTIVIDAD.test(v) ? '' : AYUDA_ACTIVIDAD);

// Mismo patrón que valida el servidor. El correo es opcional: si está vacío no hay error.
const RE_CORREO = /^\w+([-+.']\w+)*@\w+([-.]\w+)*\.\w+([-.]\w+)*$/;
export function leerCorreos(texto) {
  const lista = String(texto || '').split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  const malo = lista.find((c) => !RE_CORREO.test(c) || c.length > 160);
  return { lista, error: malo ? 'El correo «' + malo + '» no parece válido. Revise que tenga @ y un punto después, sin espacios.' : '' };
}

// Tipo de identificación según el largo del número: 9 física, 10 que empieza con 3 jurídica, 11 o 12 DIMEX, otro de 10 NITE
export function tipoDetectado(d) {
  if (d.length === 9) return '01';
  if (d.length === 10) return d[0] === '3' ? '02' : '04';
  if (d.length === 11 || d.length === 12) return '03';
  return '';
}
const LARGOS = { '01': [9, 9], '02': [10, 10], '03': [11, 12], '04': [10, 10] };
// Tipos cuyo documento puede llevar letras (pasaportes y otros): 05 extranjero no domiciliado y 06 no contribuyente
export const llevaLetras = (t) => t === '05' || t === '06';
export const MAX_ID_LETRAS = 20;
// El número como se guarda: en 05 y 06 letras y números (sin espacios, guiones ni signos; letras en mayúsculas, como hace la base), hasta 20.
// En los demás tipos solo números; pero si la persona escribió letras se conservan (en mayúsculas) para avisarle en vez de borrarlas sin decir nada.
export function limpiarNumeroId(s, tipo) {
  const t = String(s ?? '').normalize('NFC');
  if (llevaLetras(tipo) || /[A-Za-z]/.test(t)) return t.replace(/[^0-9A-Za-z]/g, '').toUpperCase().slice(0, MAX_ID_LETRAS);
  return t.replace(/\D/g, '').slice(0, MAX_ID_LETRAS);
}
const tieneLetras = (d) => /[A-Z]/.test(d);
const MOTIVOS_RAPIDOS = ['Persona recién inscrita', 'Cliente de otro país', 'Hacienda no lo muestra en la consulta'];
const MOTIVOS = {
  falto_3: 'Al número le faltaba el 3 del principio.',
  cero_de_mas: 'Al número le sobraba un 0 al principio.',
  digito_repetido: 'Al número le sobraba un número repetido.',
};
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
let contador = 0;

export function crearCampoIdentificacion(opts = {}) {
  cargarCssCedula();
  const c = opts.cliente || null;
  const nuevo = !c;
  const uid = ++contador;

  /* ---------- Estado ---------- */
  let fase = 'vacio';        // vacio | local | consultando | encontrada | no_encontrada | formato | servicio | sesion | otro
  let r = null;              // última respuesta de la función de cédula
  let seq = 0, ctrl = null, tim = null, limite = null, enCurso = Promise.resolve();
  let tocado = false;        // la persona ya salió del campo del número
  let actTocada = false;
  let tipoManual = c && (c.tipo_id === '05' || c.tipo_id === '06') ? c.tipo_id : null;
  let abrirTipo = false;
  let sinConfirmar = !!(c && c.verificacion_motivo); // "Guardar de todos modos" (un cliente guardado antes sin confirmar conserva su motivo)
  let acts = Array.isArray(c?.actividades) ? c.actividades.filter((a) => a && RE_ACTIVIDAD.test(String(a.codigo))) : [];
  let auto = { nombre: '', act: '' }; // lo último que se llenó solo desde Hacienda
  let dup = null;
  // Un cliente 05 o 06 guardado con letras (pasaporte AB123456) se carga tal cual; los demás, solo con sus números
  let ultimo = limpiarNumeroId(c?.identificacion || opts.numeroInicial || '', tipoManual);

  /* ---------- Controles ---------- */
  // Teclado de números en el celular para las cédulas; con un tipo que lleva letras (o si ya trae letras) el teclado normal, en mayúsculas
  const ident = h('input.campo.ced-num', { type: 'text', inputmode: 'numeric', autocomplete: 'off', autocorrect: 'off', autocapitalize: 'characters', spellcheck: 'false', enterkeyhint: 'next', value: ultimo, 'aria-label': 'Número de identificación', 'aria-describedby': 'ced-ayuda-' + uid });
  const ayuda = h('small.ced-ayuda', { id: 'ced-ayuda-' + uid });
  const tipoTxt = h('span.ced-tipo-txt');
  const tipoSel = h('select.campo', { hidden: true, 'aria-label': 'Tipo de identificación' }, Object.entries(TIPOS_ID).map(([k, v]) => h('option', { value: k }, v)));
  const btnTipo = h('button.btn.chico.suave', { type: 'button' }, 'Cambiar tipo');
  const tipoFila = h('div.ced-tipo', tipoTxt, btnTipo);
  const estado = h('div', { 'aria-live': 'polite' });
  const sugs = h('div.ced-sugs');
  const dupEl = h('div.ced-dup');
  const sinEl = h('div.ced-sin', { hidden: true });
  const motivo = h('input.campo', { type: 'text', maxlength: 160, autocomplete: 'off', value: c?.verificacion_motivo || '', placeholder: 'Ej. persona recién inscrita, cliente de otro país', 'aria-label': 'Motivo para guardar sin confirmar' });
  const btnSin = h('button.btn', { type: 'button' }, 'Guardar de todos modos');
  const nombre = h('input.campo.ced-nombre', { type: 'text', autocomplete: 'off', value: c?.nombre || '', placeholder: 'Lo llena Hacienda al confirmar', 'aria-label': 'Nombre o razón social' });
  const datos = h('div.ced-datos', { hidden: true });
  const actividad = h('input.campo.ced-act', { type: 'text', inputmode: 'decimal', autocomplete: 'off', maxlength: 6, value: c?.actividad_codigo || '', placeholder: 'Ej. 5610.0', 'aria-label': 'Código de actividad económica' });
  const actNota = h('div.ced-act-nota', { hidden: true });
  const actLista = h('div.ced-lista-act', { hidden: true });

  const el = h('div.ced',
    h('div.ced-bloque',
      h('label.etq', 'Número de cédula o identificación', ident),
      ayuda,
      tipoFila,
      tipoSel,
      estado, sugs, dupEl, sinEl),
    h('div.ced-bloque',
      h('label.etq', 'Nombre o razón social', nombre),
      datos),
    h('div.ced-bloque',
      h('label.etq', 'Actividad económica (código)', actividad,
        h('small', 'Hacienda lo usa en las facturas a empresas. Se llena solo si Hacienda lo tiene; si no, déjelo vacío o escríbalo. Debajo verá el nombre de la actividad.')),
      actNota, actLista));

  /* ---------- Reglas ---------- */
  function tipoActual() {
    if (r?.ok && /^0[1-4]$/.test(r.tipo || '')) return r.tipo;
    return tipoManual || (tieneLetras(ident.value) ? '' : tipoDetectado(ident.value)); // con letras el largo no dice el tipo
  }
  // Problemas que se ven sin consultar a Hacienda. grave=false significa "todavía está escribiendo".
  function errorLocal() {
    const d = ident.value, n = d.length, t = tipoActual();
    if (!n || llevaLetras(t)) return null;
    if (tieneLetras(d)) return { grave: true, titulo: t ? TIPOS_ID[t] + ' lleva solo números' : 'Este número lleva letras',
      detalle: 'Una cédula física, una jurídica, un DIMEX y un NITE llevan solo números. Si es un pasaporte u otro documento con letras, toque «Cambiar tipo» y elija «'
        + TIPOS_ID['05'] + '» o «' + TIPOS_ID['06'] + '». Si fue un error al escribir, borre la letra.' };
    if (n > 12) return { grave: true, titulo: 'Lleva ' + n + ' números y son demasiados', detalle: 'Una cédula tiene como máximo 12 números. Revise si repitió algún número.' };
    if (n < 9) return { grave: tocado, titulo: 'Lleva ' + n + (n === 1 ? ' número' : ' números') + (tocado ? ' y faltan' : ''), detalle: (tocado ? 'Faltan números. ' : 'Siga escribiendo. ') + 'Una cédula física tiene 9 números, una jurídica 10 y un DIMEX 11 o 12.' };
    const l = LARGOS[t];
    if (l && (n < l[0] || n > l[1])) return { grave: true, titulo: TIPOS_ID[t] + ' lleva ' + (l[0] === l[1] ? l[0] : l[0] + ' o ' + l[1]) + ' números', detalle: 'Usted escribió ' + n + '. Revise el número o cambie el tipo.' };
    if (t === '01' && d[0] === '0') return { grave: true, titulo: 'Una cédula física no empieza con 0', detalle: 'Revise el primer número.' };
    if (t === '02' && !r?.ok && !'234'.includes(d[0])) return { grave: true, titulo: 'Una cédula jurídica empieza con 3', detalle: 'Este número empieza con ' + d[0] + '. Revise el primer número.' };
    if (t === '04' && d[0] === '3' && !r?.ok) return { grave: true, titulo: 'Un número de 10 dígitos que empieza con 3 es cédula jurídica', detalle: 'No es un NITE. Cambie el tipo o revise el número.' };
    return null;
  }
  const puedeConsultar = () => { const t = tipoActual(); return ident.value.length >= 9 && ident.value.length <= 12 && /^0[1-4]$/.test(t) && !errorLocal(); };

  const deHacienda = () => acts.filter((x) => !x.manual); // las que Hacienda lista (las escritas a mano antes no cuentan)
  function modo() {
    if (!r?.ok) return 'libre';
    const igualNombre = norm(nombre.value) === norm(r.nombre);
    const a = actividad.value.trim();
    const igualAct = a === '' ? deHacienda().length === 0 : deHacienda().some((x) => x.codigo === a);
    return igualNombre && igualAct ? 'hacienda' : 'manual';
  }

  /* ---------- Consulta ---------- */
  function cancelar() {
    clearTimeout(tim); tim = null; clearTimeout(limite); limite = null;
    seq++;
    try { ctrl?.abort(); } catch { /* nada */ }
    ctrl = null;
  }
  // Si el número cambia, lo que vino de Hacienda para el número anterior se suelta
  function soltar() {
    if (nombre.value && nombre.value === auto.nombre) nombre.value = '';
    if (actividad.value && actividad.value === auto.act) actividad.value = '';
    auto = { nombre: '', act: '' };
    r = null;
    acts = [];
  }
  function consultar(forzar = false) {
    const d = ident.value;
    const mi = ++seq;
    try { ctrl?.abort(); } catch { /* nada */ }
    ctrl = new AbortController();
    clearTimeout(limite);
    let vencio = false;
    limite = setTimeout(() => { vencio = true; try { ctrl?.abort(); } catch { /* nada */ } }, 14000);
    fase = 'consultando'; pintar();
    const mio = ctrl;
    const p = (async () => {
      let resp;
      try { resp = await apiM.cedula(d, { forzar, signal: mio.signal }); }
      catch (e) {
        if (mi !== seq) return;
        const sesion = /sesi[oó]n|iniciar|acceso/i.test(e?.message || '');
        resp = { ok: false, estado: sesion ? 'sesion' : 'servicio', mensaje: vencio ? 'Hacienda tardó demasiado en responder.' : '' };
      }
      if (mi !== seq || d !== ident.value) return;
      clearTimeout(limite); limite = null;
      recibir(resp);
    })();
    enCurso = p;
    return p;
  }
  function recibir(resp) {
    if (!resp.ok && resp.estado === 'servicio') resp = { ...resp, mensaje: '' }; // el detalle técnico no le sirve a quien cobra
    // El padrón a veces encuentra el número aunque le sobre un 0 al inicio. Ese número no sirve para facturar: se propone el correcto en vez de aceptarlo.
    if (resp.ok && /^0[1-4]$/.test(resp.tipo || '') && LARGOS[resp.tipo]) {
      const [mn, mx] = LARGOS[resp.tipo], d = ident.value;
      if (d.length < mn || d.length > mx) {
        const limpio = d.replace(/^0+/, '');
        resp = { ok: false, estado: 'no_encontrada', cedula: d, sugerencias: limpio.length >= mn && limpio.length <= mx && limpio !== d
          ? [{ cedula: limpio, nombre: resp.nombre, tipo: resp.tipo, tipo_nombre: resp.tipo_nombre || TIPOS_ID[resp.tipo], motivo: 'cero_de_mas' }] : [] };
      }
    }
    r = resp;
    sinConfirmar = false;
    if (resp.ok) {
      fase = 'encontrada';
      const lista = Array.isArray(resp.actividades) ? resp.actividades : [];
      // Los códigos que se escribieron a mano antes en este cliente se conservan en su lista
      const previos = !nuevo && String(c.identificacion) === ident.value && Array.isArray(c.actividades) ? c.actividades.filter((x) => x && x.manual && RE_ACTIVIDAD.test(String(x.codigo)) && !lista.some((y) => y.codigo === x.codigo)) : [];
      acts = [...lista, ...previos];
      if (!nombre.value.trim() || nombre.value === auto.nombre) { nombre.value = resp.nombre; auto.nombre = resp.nombre; }
      if (lista.length && (!actividad.value.trim() || actividad.value === auto.act)) { actividad.value = lista[0].codigo; auto.act = lista[0].codigo; }
    } else {
      fase = resp.estado === 'no_encontrada' ? 'no_encontrada' : resp.estado === 'formato' ? 'formato' : resp.estado === 'sesion' ? 'sesion' : 'servicio';
      // En un cliente guardado antes sin confirmar, se conserva el motivo que ya tenía
      if (fase === 'no_encontrada' && !nuevo && c.identificacion === ident.value && c.verificacion_motivo) sinConfirmar = true;
    }
    pintar();
    if (resp.ok) siguienteCampo();
  }
  // Después de llenar solo, el foco pasa al primer campo vacío (sin quitárselo a quien ya está escribiendo en otro lado)
  function siguienteCampo() {
    const a = document.activeElement;
    if (a && a !== document.body && a !== ident) return;
    if (!nombre.value.trim()) { nombre.focus(); return; }
    opts.alTerminar?.();
  }

  /* ---------- Número ---------- */
  function reevaluar() {
    const d = ident.value, t = tipoActual();
    clearTimeout(tim); tim = null;
    if (!d) fase = 'vacio';
    else if (llevaLetras(t)) fase = 'otro';
    else if (errorLocal()) fase = 'local';
    else { fase = 'consultando'; tim = setTimeout(() => { tim = null; consultar(false); }, 500); }
    pintar();
    revisarDup();
  }
  function alEscribir() {
    const crudo = ident.value;
    // pegar "3-102-765594" deja 3102765594 (el cero del inicio se conserva); en 05 y 06 «ab 123-456» queda AB123456
    const d = limpiarNumeroId(crudo, tipoManual);
    if (d !== crudo) ident.value = d;
    if (d === ultimo) return;
    ultimo = d;
    cancelar();
    soltar();
    sinConfirmar = false;
    if (tipoManual && !llevaLetras(tipoManual)) tipoManual = null;
    reevaluar();
    opts.alCambiar?.(d);
  }
  ident.addEventListener('input', alEscribir);
  ident.addEventListener('blur', () => { tocado = true; pintar(); });
  ident.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (tim) { clearTimeout(tim); tim = null; consultar(false); } else nombre.focus(); } });

  btnTipo.addEventListener('click', () => { abrirTipo = !abrirTipo; pintar(); if (abrirTipo) tipoSel.focus(); });
  tipoSel.addEventListener('change', () => {
    const v = tipoSel.value, det = tieneLetras(ident.value) ? '' : tipoDetectado(ident.value);
    tipoManual = v === det ? null : v;
    abrirTipo = false;
    cancelar(); sinConfirmar = false; r = null;
    // Lo escrito no se pierde al cambiar de tipo: en 05 y 06 se dejan letras y números; en los demás, si había letras, se avisa (no se borran)
    const d = limpiarNumeroId(ident.value, tipoManual);
    if (d !== ident.value) ident.value = d;
    ultimo = d;
    reevaluar();
    // con un tipo que lleva letras se sigue escribiendo en el número, ya con el teclado de letras del celular
    if (llevaLetras(tipoManual)) ident.focus();
  });

  /* ---------- Duplicados ---------- */
  let timDup = null, seqDup = 0;
  function revisarDup() {
    clearTimeout(timDup); seqDup++;
    dup = null; pintarDup();
    if (!opts.revisarDuplicado) return;
    const d = ident.value;
    if (d.length < (llevaLetras(tipoActual()) ? 5 : 9) || errorLocal()) return; // un pasaporte puede tener menos de 9 letras y números; una cédula, no
    if (!nuevo && d === String(c.identificacion)) return;
    const mi = seqDup;
    timDup = setTimeout(async () => {
      try {
        const otro = await opts.revisarDuplicado(d);
        if (mi !== seqDup || d !== ident.value) return;
        dup = otro || null; pintarDup();
      } catch { /* si falla la revisión, el servidor igual avisa al guardar */ }
    }, 350);
  }
  function pintarDup() {
    if (!dup) { dupEl.replaceChildren(); return; }
    const ac = opts.accionDuplicado;
    dupEl.replaceChildren(caja('rojo', '!', 'Este cliente ya existe', nombrePropio(dup.nombre) + '. No se pueden guardar dos clientes con el mismo número.',
      ac ? h('button.btn' + (ac.primario ? '.primario' : ''), { type: 'button', onclick: () => ac.fn(dup) }, ac.texto) : null));
  }

  /* ---------- Nombre y actividad ---------- */
  nombre.addEventListener('input', () => pintar());
  actividad.addEventListener('input', () => { const v = limpiarActividad(actividad.value); if (v !== actividad.value) actividad.value = v; pintar(); });
  actividad.addEventListener('blur', () => { actTocada = true; pintar(); });
  function usarHacienda() {
    if (!r?.ok) return;
    nombre.value = r.nombre; auto.nombre = r.nombre;
    actividad.value = deHacienda()[0]?.codigo || ''; auto.act = actividad.value;
    actTocada = false;
    pintar();
    nombre.focus(); // el botón se vuelve a dibujar; el foco se queda en un lugar estable
  }
  function noUsarHacienda() {
    nombre.value = ''; actividad.value = '';
    pintar();
    nombre.focus();
  }

  /* ---------- Dibujo ---------- */
  function caja(clase, ico, titulo, detalle, ...extra) {
    return h('div.ced-estado.' + clase,
      h('span.ico', { 'aria-hidden': 'true' }, ico),
      h('div.ced-est-cuerpo', h('strong', titulo), detalle ? h('span', detalle) : null, ...extra));
  }
  // Solo se vuelve a dibujar un bloque si cambió su contenido (así no se pierde el foco al escribir en otros campos)
  const pon = (cont, clave, fabrica) => { if (cont._k === clave) return; cont._k = clave; cont.replaceChildren(...fabrica()); };
  const btnVolver = (texto = 'Volver a consultar') => h('button.btn.chico', { type: 'button', onclick: () => consultar(true) }, texto);

  function pintar() {
    const d = ident.value, n = d.length, t = tipoActual();
    const el_ = errorLocal();
    ident.classList.toggle('mal', fase === 'local' && !!el_?.grave);
    ident.classList.toggle('bien', fase === 'encontrada');

    // Ayuda bajo el número
    const conLetras = llevaLetras(t);
    ayuda.textContent = conLetras ? 'Escriba el número del documento como aparece en él: letras y números, hasta ' + MAX_ID_LETRAS + '. Los espacios y guiones se quitan solos.'
      : !n ? 'Escriba solo los números, sin guiones ni espacios. Si pega la cédula con guiones, el sistema los quita.'
      : 'Cédula física: 9 números. Jurídica: 10 números y empieza con 3. DIMEX: 11 o 12 números.';
    // Teclado del celular: de números para las cédulas; normal (con letras) para pasaportes y otros documentos, o si ya se escribieron letras
    const teclado = conLetras || tieneLetras(d) ? 'text' : 'numeric';
    if (ident.getAttribute('inputmode') !== teclado) ident.setAttribute('inputmode', teclado);

    ayuda.hidden = n > 0; // al escribir, la caja de estado ya dice lo que falta
    nombre.placeholder = ['no_encontrada', 'servicio', 'sesion', 'otro', 'formato'].includes(fase) ? 'Escriba el nombre o la razón social' : 'Lo llena Hacienda al confirmar';

    // Tipo en palabras
    tipoTxt.replaceChildren();
    if (n) {
      if (r?.ok && TIPOS_ID[r.tipo]) tipoTxt.append('Tipo: ', h('strong', TIPOS_ID[r.tipo]), h('span.via', ' (según Hacienda)'));
      else if (tipoManual) tipoTxt.append('Tipo: ', h('strong', TIPOS_ID[tipoManual]), h('span.via', ' (lo eligió usted)'));
      else if (t) tipoTxt.append('Tipo: ', h('strong', TIPOS_ID[t]), h('span.via', ' (por la cantidad de números)'));
      else if (tieneLetras(d)) tipoTxt.append('Tipo: falta elegirlo, porque el número lleva letras.');
      else tipoTxt.append('Todavía no se puede saber el tipo: faltan o sobran números.');
      if (!nuevo && c.tipo_id && TIPOS_ID[c.tipo_id] && t && c.tipo_id !== t && /^0[1-4]$/.test(c.tipo_id) && /^0[1-4]$/.test(t)) {
        tipoTxt.append(h('span.via', ' · Estaba guardado como ' + TIPOS_ID[c.tipo_id] + '. Al guardar se corrige.'));
      }
    } else if (tipoManual) tipoTxt.append('Tipo: ', h('strong', TIPOS_ID[tipoManual]), h('span.via', ' (lo eligió usted)'));
    else tipoTxt.append('¿Pasaporte u otro documento con letras? Elija primero el tipo.');
    btnTipo.hidden = !!r?.ok;
    btnTipo.textContent = n || tipoManual ? 'Cambiar tipo' : 'Elegir el tipo';
    tipoFila.hidden = false; // también sin número: así un pasaporte se puede elegir antes de escribir (en el celular, para tener el teclado con letras)
    btnTipo.setAttribute('aria-expanded', String(abrirTipo));
    tipoSel.hidden = !(abrirTipo && !r?.ok);
    tipoSel.value = t || '01';

    // Estado con color y palabras
    let nodo = null;
    const claveEstado = [fase, el_?.titulo, el_?.detalle, r?.nombre, r?.tipo, r?.estado, r?.desactualizado, r?.mensaje, t, d.length].join('|');
    if (estado._k !== claveEstado) {
    if (fase === 'local' && el_) nodo = caja(el_.grave ? 'rojo' : 'gris', el_.grave ? '✕' : '…', el_.titulo, el_.detalle);
    else if (fase === 'consultando') nodo = caja('azul', h('span.ced-giro'), 'Verificando en Hacienda', 'Un momento. Se está buscando el número ' + d + '.');
    else if (fase === 'encontrada' && r) {
      const via = r.estado === 'padron';
      nodo = caja('verde', '✓', via ? 'Existe en el padrón de personas' : 'Existe en Hacienda',
        nombrePropio(r.nombre) + (TIPOS_ID[r.tipo] ? ' · ' + TIPOS_ID[r.tipo] : ''),
        via ? h('span', 'Hacienda no muestra actividad económica para este número.') : null,
        r.desactualizado ? h('span', 'Hacienda no respondió ahora. Estos datos son de la consulta del ' + fechaCorta(r.consultado_en) + '.') : null);
    } else if (fase === 'no_encontrada') {
      nodo = caja('ambar', '!', 'Hacienda no encontró este número',
        Array.isArray(r?.sugerencias) && r.sugerencias.length ? 'Parece un error al escribirlo. Si la opción de abajo es la correcta, tóquela.'
          : /^0[34]$/.test(t) ? 'Los DIMEX y NITE no siempre aparecen en la consulta. Si el número está bien escrito, puede guardarlo así.'
          : 'Revise que no falte, sobre ni se haya cambiado ningún número. Compárelo número por número con la cédula.',
        Array.isArray(r?.sugerencias) && r.sugerencias.length ? null : btnVolver());
    } else if (fase === 'formato') nodo = caja('rojo', '✕', 'El número no tiene un largo válido', r?.mensaje || 'La cédula debe tener entre 9 y 12 números.');
    else if (fase === 'servicio') nodo = caja('gris', '-', 'Hacienda no responde en este momento',
      'Puede seguir: el cliente se guarda marcado como «sin verificar» y se confirma después. Revise bien el número, porque Hacienda rechaza las facturas con un número que no existe.' + (r?.mensaje ? ' ' + r.mensaje : ''), btnVolver());
    else if (fase === 'sesion') nodo = caja('rojo', '✕', 'Su sesión venció', 'Entre de nuevo con su usuario y PIN para poder consultar a Hacienda.');
    else if (fase === 'otro') nodo = caja('gris', '-', 'Este tipo de documento no se consulta en Hacienda', 'El número puede llevar letras y números (hasta ' + MAX_ID_LETRAS + '). Escriba el nombre completo a mano.');
    estado._k = claveEstado;
    estado.replaceChildren(...(nodo ? [nodo] : []));
    }

    // Sugerencias para errores evidentes de digitación
    const lista = fase === 'no_encontrada' && Array.isArray(r?.sugerencias) ? r.sugerencias : [];
    pon(sugs, JSON.stringify(lista), () => lista.map((s) => h('button.ced-sug', { type: 'button', onclick: () => aceptarSugerencia(s) },
      h('span.pre', '¿Quiso decir ', h('span.num', s.cedula), '?'),
      h('span.nom', nombrePropio(s.nombre)),
      h('span.mot', (MOTIVOS[s.motivo] || '') + (TIPOS_ID[s.tipo] ? ' ' + TIPOS_ID[s.tipo] + '.' : '')),
      h('span.acc', 'Sí, usar este número'))));

    // Guardar de todos modos (cédula física o jurídica que Hacienda no encuentra)
    // Cédula física o jurídica, DIMEX y NITE que Hacienda no encuentra: se pueden guardar sin verificar, siempre con un motivo escrito
    const pideMotivo = fase === 'no_encontrada' && /^0[1-4]$/.test(t || '');
    sinEl.hidden = !pideMotivo;
    if (pideMotivo) {
      pon(sinEl, 'sin:' + sinConfirmar + ':' + t, () => [sinConfirmar
        ? h('div.col',
          h('label.etq', 'Motivo (obligatorio)', motivo, h('small', 'Queda anotado y el cliente se marca como «sin verificar» en la lista.')),
          h('div.fila', MOTIVOS_RAPIDOS.map((x) => h('button.btn.chico', { type: 'button', onclick: () => { motivo.value = x; motivo.focus(); } }, x))),
          h('div.fila', h('button.btn.chico.suave', { type: 'button', onclick: () => { sinConfirmar = false; pintar(); ident.focus(); } }, 'Mejor corrijo el número')))
        : h('div.col',
          h('p', 'Si está segura o seguro de que el número es correcto, puede guardar el cliente sin la confirmación de Hacienda. Va a tener que escribir el motivo. Tenga presente que Hacienda rechaza las facturas cuyo número no existe en sus registros.'),
          btnSin)]);
    }

    // Datos de Hacienda: usar o escribirlos a mano
    const m = modo();
    datos.hidden = !r?.ok;
    if (r?.ok) {
      const igual = m === 'hacienda';
      pon(datos, [m, r.nombre, deHacienda()[0]?.codigo].join('|'), () => [
        h('div.txt', igual ? h('strong', 'Nombre y actividad iguales a los de Hacienda. ') : h('strong', 'Datos escritos por usted. '),
          igual ? 'Puede cambiarlos si hace falta.' : 'Hacienda tiene: ' + nombrePropio(r.nombre) + (deHacienda()[0] ? ' · ' + textoActividad(deHacienda()[0].codigo, acts) : '') + '.'),
        igual ? h('button.btn', { type: 'button', onclick: noUsarHacienda }, 'No usar, escribirlos yo')
          : h('button.btn.primario', { type: 'button', onclick: usarHacienda }, 'Usar los datos de Hacienda')]);
    }
    nombre.classList.toggle('hac', !!r?.ok && norm(nombre.value) === norm(r.nombre));

    // Actividad
    const a = actividad.value.trim();
    const dentro = deHacienda().find((x) => x.codigo === a);
    const mal = a !== '' && !RE_ACTIVIDAD.test(a) && (actTocada || a.length >= 6);
    actividad.classList.toggle('mal', mal);
    actividad.classList.toggle('hac', !!r?.ok && !!dentro);
    let nota = null;
    if (mal) nota = ['mal', AYUDA_ACTIVIDAD];
    else if (a && RE_ACTIVIDAD.test(a) && dentro) nota = ['ok', 'Actividad: ' + textoActividad(a, acts)];
    else if (a && RE_ACTIVIDAD.test(a) && !(r?.ok && deHacienda().length)) nota = ['', 'Actividad: ' + textoActividad(a, acts)];
    else if (a && RE_ACTIVIDAD.test(a) && r?.ok && deHacienda().length) nota = ['aviso', 'Este código no está entre las actividades que Hacienda tiene para este número. Si el cliente lo pide, puede usarlo, pero Hacienda podría rechazar la factura si no está activo en su registro.'];
    else if (!a && r?.ok && !deHacienda().length) nota = ['', 'Hacienda no tiene actividad económica para este número. Puede dejarlo vacío o escribir el código que el cliente le indique.'];
    actNota.hidden = !nota || !nota[1];
    actNota.className = 'ced-act-nota' + (nota?.[0] ? ' ' + nota[0] : '');
    actNota.textContent = nota?.[1] || '';

    actLista.hidden = acts.length < 2;
    if (acts.length >= 2) {
      pon(actLista, [!!r?.ok, a, ...acts.map((x) => x.codigo)].join('|'), () => [
        h('div.tit', (r?.ok ? (deHacienda().length > 1 ? 'Hacienda tiene ' + deHacienda().length + ' actividades para este número' : 'Actividades de este cliente') : 'Actividades guardadas de este cliente') + '. Toque la que corresponde:'),
        ...acts.map((x) => h('button.ced-opt', { type: 'button', 'aria-pressed': String(x.codigo === a), onclick: () => { actividad.value = x.codigo; actTocada = true; pintar(); } },
          h('span.desc', h('b', infoActividad(x.codigo, acts).nombre), h('small', 'Código ' + x.codigo)), x.principal ? h('span.pri', 'Principal') : x.manual ? h('span.pri.man', 'Escrito a mano') : null))]);
    }
  }

  btnSin.addEventListener('click', () => {
    sinConfirmar = true;
    const t = tipoActual();
    if (!motivo.value.trim() && (t === '03' || t === '04')) motivo.value = 'Hacienda no muestra los ' + (t === '03' ? 'DIMEX' : 'NITE') + ' en la consulta';
    pintar(); motivo.focus();
  });
  motivo.addEventListener('input', () => { /* el texto se lee al validar */ });
  function aceptarSugerencia(s) {
    ident.value = s.cedula;
    alEscribir();
    if (tim) { clearTimeout(tim); tim = null; consultar(false); }
  }

  /* ---------- Para el formulario que lo usa ---------- */
  async function validar() {
    if (fase === 'consultando') {
      if (tim) { clearTimeout(tim); tim = null; consultar(false); }
      await enCurso;
    }
    const t = tipoActual();
    if (!ident.value) return { mensaje: 'Escriba el número de identificación.', campo: ident };
    const e = errorLocal();
    if (e) return { mensaje: e.titulo + '. ' + e.detalle, campo: ident };
    if (!/^0[1-6]$/.test(t || '')) return { mensaje: 'No se pudo saber el tipo de identificación. Revise el número.', campo: ident };
    if (llevaLetras(t) && ident.value.length > MAX_ID_LETRAS) return { mensaje: 'La identificación es demasiado larga: tiene ' + ident.value.length + ' letras y números y el máximo es ' + MAX_ID_LETRAS + '.', campo: ident };
    if (dup && opts.accionDuplicado) return { mensaje: 'Ese cliente ya existe. Use el que ya está guardado.', campo: ident };
    if (fase === 'formato') return { mensaje: r?.mensaje || 'El número no tiene un largo válido.', campo: ident };
    if (fase === 'no_encontrada' && /^0[1-4]$/.test(t)) {
      if (!sinConfirmar) return { mensaje: 'Hacienda no encontró este número. Corríjalo, o toque «Guardar de todos modos» y escriba el motivo.', campo: sinEl.hidden ? ident : btnSin };
      if (motivo.value.trim().length < 3) return { mensaje: 'Escriba el motivo por el que lo guarda sin la confirmación de Hacienda.', campo: motivo };
    }
    if (nombre.value.trim().length < 3) return { mensaje: 'Escriba el nombre o la razón social (mínimo 3 letras).', campo: nombre };
    const ea = errorActividad(actividad.value.trim());
    if (ea) { actTocada = true; pintar(); return { mensaje: ea, campo: actividad }; }
    return null;
  }
  function valores() {
    const t = tipoActual() || '01';
    const ok = !!r?.ok;
    let mot = '';
    if (!ok) {
      if (fase === 'servicio' || fase === 'sesion') mot = 'Hacienda no respondió al guardar';
      else if (fase === 'otro') mot = 'Documento que no se consulta en Hacienda';
      else if (fase === 'no_encontrada') mot = motivo.value.trim() || ('No aparece en Hacienda (' + (TIPOS_ID[t] || 'sin tipo') + ')');
      else mot = motivo.value.trim();
    }
    return { tipo_id: t, identificacion: ident.value, nombre: nombre.value.trim(), actividad_codigo: actividad.value.trim(), sin_verificar_motivo: mot, verificado: ok };
  }

  /* ---------- Arranque ---------- */
  pintar();
  if (ident.value) {
    // Cliente que ya existe: se revisa de una vez para encontrar números mal guardados
    fase = 'vacio';
    reevaluar();
    if (tim) { clearTimeout(tim); tim = null; consultar(false); }
  }
  return {
    el, ident, nombre, actividad,
    validar, valores,
    enfocar: () => ident.focus(),
    estado: () => ({ fase, verificado: !!r?.ok, resp: r }),
    consultar,
    destruir: () => { cancelar(); clearTimeout(timDup); },
  };
}
