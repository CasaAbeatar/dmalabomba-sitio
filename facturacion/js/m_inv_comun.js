// Piezas comunes del módulo Inventarios: formato, ventanas propias, la acción que escribe con su clave de repetición, selectores de artículo y ubicación.
import { h, modal, toast, num, money, textoDeError, nombrePropio, debounce } from './util.js';
import { esTransitorio, esSesionVencida } from './api.js';
import { inv, claveNueva } from './api_inventarios.js';

/* ---------- Hoja de estilos ---------- */
let cssListo = null;
export function cargarCss() {
  if (cssListo) return cssListo;
  const href = new URL('../css/inventarios.css', import.meta.url).href;
  cssListo = new Promise((ok) => {
    if ([...document.querySelectorAll('link[rel=stylesheet]')].some((l) => l.href === href)) return ok();
    const l = h('link', { rel: 'stylesheet', href, 'data-fx-inventarios': '1' });
    l.addEventListener('load', () => ok()); l.addEventListener('error', () => ok());
    document.head.append(l);
    setTimeout(ok, 2500);
  });
  return cssListo;
}

// Cambia el contenido de un elemento sin que un hijo «null» o «false» aparezca escrito («replaceChildren(null)» escribe «null»)
export const poner = (el, ...hijos) => el.replaceChildren(...hijos.flat(Infinity).filter((x) => x != null && x !== false && x !== ''));

/* ---------- Formato ---------- */
export const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
export const plural = (n, uno, varios) => `${num(n, 0)} ${Math.abs(Number(n)) === 1 ? uno : varios}`;
const UNIDADES = { kg: ['kg', 'kg'], g: ['g', 'g'], ml: ['ml', 'ml'], litro: ['litro', 'litros'], unidad: ['unidad', 'unidades'], caja: ['caja', 'cajas'], bolsa: ['bolsa', 'bolsas'], paquete: ['paquete', 'paquetes'], lata: ['lata', 'latas'], colon: ['colón', 'colones'], botella: ['botella', 'botellas'] };
// «1 unidad», «3 unidades», «12,5 kg». Una unidad que no está en la lista corta sale con su código.
export function unidadTxt(codigo, n = 2) { const u = UNIDADES[codigo]; return u ? (Math.abs(Number(n)) === 1 ? u[0] : u[1]) : String(codigo || ''); }
export const cantTxt = (n, unidad) => `${num(n, 3)} ${unidadTxt(unidad, n)}`.trim();
export const dinero = (n) => money(n);
// Costo por unidad: hasta 5 decimales cuando los tiene (₡1 234,56789), si no 2
export function costoTxt(n) {
  const v = Number(n) || 0;
  const t = new Intl.NumberFormat('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: Math.abs(v) < 100 && v % 1 ? 5 : 2 }).format(Math.abs(v));
  return (v < 0 ? '-' : '') + '₡' + t;
}
const fmtDia = new Intl.DateTimeFormat('es-CR', { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
const fmtDiaLargo = new Intl.DateTimeFormat('es-CR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fmtYmdCR = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Costa_Rica' });
// El día (AAAA-MM-DD) en Costa Rica de una fecha que puede venir como '2026-10-29' o como instante ('2026-10-30T01:48:05+00:00', que en Costa Rica todavía es el 29)
export function ymdCR(x) {
  const s = String(x ?? '');
  if (!s) return '';
  if (s.length <= 10) return s.slice(0, 10);
  try { return fmtYmdCR.format(new Date(s)); } catch { return s.slice(0, 10); }
}
// '2026-10-29' -> «jue., 29/10/2026»
export const diaTxt = (x) => { const d = ymdCR(x); return d ? fmtDia.format(new Date(d + 'T12:00:00Z')) : ''; };
export const diaLargo = (x) => { const d = ymdCR(x); if (!d) return ''; const t = fmtDiaLargo.format(new Date(d + 'T12:00:00Z')); return t.charAt(0).toUpperCase() + t.slice(1); };
export const dma = (x) => { const d = ymdCR(x); return d ? d.split('-').reverse().join('/') : ''; };
// Días para vencer en palabras. Un lote vence al TERMINAR el día de vence_en: «Vence hoy» todavía se puede usar hoy.
export function venceTxt(dias, venceEn) {
  if (venceEn == null && dias == null) return 'No vence';
  const d = Number(dias);
  if (!Number.isFinite(d)) return 'Vence el ' + dma(venceEn);
  if (d < -1) return `Venció hace ${num(-d, 0)} días`;
  if (d === -1) return 'Venció ayer';
  if (d === 0) return 'Vence hoy (último día)';
  if (d === 1) return 'Vence mañana';
  return `Vence en ${num(d, 0)} días`;
}
export const claseVence = (dias, aviso = 2) => (dias == null ? '' : dias < 0 ? 'mal' : dias <= aviso ? 'espera' : '');
// Número corto del consecutivo de una factura: los últimos 10 dígitos sin ceros a la izquierda
export const numFactura = (c) => { const n = parseInt(String(c || '').slice(-10), 10); return Number.isFinite(n) ? String(n) : String(c || ''); };
// Proveedor: Hacienda lo trae como «RAZÓN SOCIAL (Nombre comercial)». En bodega se conoce por el nombre comercial: ese va en grande y la razón social debajo.
export function proveedorPartes(n) {
  const t = String(n || '').trim();
  const m = t.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
  if (!t) return { nombre: 'Proveedor sin nombre', razon: '' };
  if (!m || !m[1]) return { nombre: nombrePropio(t), razon: '' };
  return { nombre: nombrePropio(m[2]), razon: nombrePropio(m[1]) };
}
export const proveedorTxt = (n) => proveedorPartes(n).nombre;
const TIPOS_DOC = { FacturaElectronica: 'Factura electrónica', TiqueteElectronico: 'Tiquete electrónico', NotaCreditoElectronica: 'Nota de crédito', NotaDebitoElectronica: 'Nota de débito' };
export const tipoDocTxt = (t) => TIPOS_DOC[t] || t || 'Comprobante';

// Empresa dueña de una factura o de origen de un lote, siempre a la vista. codigo 'soda' | 'pollos' da el color de la marca; sin empresa: «Sin empresa de origen».
export function empresaChip(nombre, codigo) {
  const c = String(codigo || '').toLowerCase();
  return h('span.inv-emp' + (c === 'soda' || c === 'pollos' ? '' : '.sin'), { 'data-emp': c || null }, nombre || 'Sin empresa de origen');
}

/* ---------- Lectura de lo que escribe la persona ---------- */
// Cantidades: punto o coma son el separador decimal (en bodega «1,250 kg» es un kilo y cuarto); sin separador de miles; hasta 3 decimales. NaN si no es un número.
export function leerCantidad(s) {
  const t = String(s ?? '').trim().replace(/\s+/g, '');
  if (!t || !/^\d*([.,]\d{0,3})?$/.test(t) || !/\d/.test(t)) return NaN;
  return Number(t.replace(',', '.'));
}
// Dinero por unidad: hasta 5 decimales. «1 500», «1.500» (mil quinientos), «1 500,25», «0,355». NaN si es ambiguo o no es un monto.
export function leerMonto(s) {
  let t = String(s ?? '').trim().replace(/[₡\s  ]/g, '');
  if (!t || !/^[\d.,]+$/.test(t) || !/\d/.test(t)) return NaN;
  const p = (t.match(/\./g) || []).length, c = (t.match(/,/g) || []).length;
  if (p && c) { const dec = t.lastIndexOf('.') > t.lastIndexOf(',') ? '.' : ','; const otro = dec === '.' ? ',' : '.'; const [e, d] = t.split(dec); if (t.split(dec).length !== 2) return NaN; if (!new RegExp('^\\d{1,3}(\\' + otro + '\\d{3})+$').test(e)) return NaN; t = e.split(otro).join('') + '.' + d; }
  else if (p > 1 || c > 1) { const sep = p ? '.' : ','; if (!new RegExp('^\\d{1,3}(\\' + sep + '\\d{3})+$').test(t)) return NaN; t = t.split(sep).join(''); }
  else if (p === 1) { const [e, d] = t.split('.'); if (d.length === 3 && /^[1-9]\d{0,2}$/.test(e)) t = e + d; }
  else if (c === 1) t = t.replace(',', '.');
  const [, dec = ''] = t.split('.');
  if (dec.length > 5) return NaN;
  const v = Number(t);
  return Number.isFinite(v) ? v : NaN;
}
// Campo de cantidad: teclado numérico y, debajo, lo que el sistema entendió («Se registrará: 1,25 kg»)
export function campoCantidad({ valor = '', unidad = '', etiqueta = 'Cantidad', ayuda = '', alCambiar, min0 = false } = {}) {
  const input = h('input.campo.inv-num', { type: 'text', inputmode: 'decimal', autocomplete: 'off', value: valor === '' || valor == null ? '' : String(valor).replace('.', ','), 'aria-label': etiqueta });
  const eco = h('small.inv-eco', { 'aria-live': 'polite' });
  let uni = unidad;
  const leer = () => leerCantidad(input.value);
  const pintar = () => {
    const v = leer();
    if (!input.value.trim()) { eco.textContent = ayuda; eco.className = 'inv-eco'; return; }
    if (!Number.isFinite(v)) { eco.textContent = 'Escriba solo números, con coma o punto para los decimales (hasta 3), por ejemplo 2,5.'; eco.className = 'inv-eco mal'; return; }
    if (!min0 && v <= 0) { eco.textContent = 'La cantidad tiene que ser mayor que cero.'; eco.className = 'inv-eco mal'; return; }
    eco.textContent = 'Se registrará: ' + cantTxt(v, uni); eco.className = 'inv-eco';
  };
  input.addEventListener('input', () => { pintar(); alCambiar?.(leer()); });
  pintar();
  return {
    el: h('label.etq.inv-campo-cant', etiqueta, h('span.inv-con-unidad', input, h('span.inv-unidad', unidadTxt(uni, 2))), eco),
    input, leer, valido: () => { const v = leer(); return Number.isFinite(v) && (min0 ? v >= 0 : v > 0) && v <= 1000000; },
    poner: (v) => { input.value = v == null || v === '' ? '' : String(Math.round(Number(v) * 1000) / 1000).replace('.', ','); pintar(); },
    unidad: (u) => { uni = u; input.parentElement.querySelector('.inv-unidad').textContent = unidadTxt(u, 2); pintar(); },
  };
}

/* ---------- Ventanas propias ---------- */
// Cuántas escrituras van en camino: mientras haya alguna, ninguna ventana se cierra con Escape, «Volver» ni el botón Atrás (se perdería la respuesta)
let enCamino = 0;
const bloqueoEscritura = () => (enCamino > 0 ? 'Espere un momento: se está guardando. La ventana se puede cerrar cuando termine.' : '');
// Ventana de una sección: ocupa la pantalla debajo del encabezado, con «‹ Inventarios» (o el nivel de arriba) para volver. Devuelve { cerrar, el, cuerpo }.
// bloqueo (opcional): texto mientras la ventana no se debe cerrar (por ejemplo, cantidades anotadas sin guardar)
export function ventana({ titulo, volver = 'Inventarios', contenido, alCerrar, clase = '', bloqueo = null }) {
  const cuerpo = h('div.inv.inv-ventana-in' + (clase ? '.' + clase : ''), contenido);
  const m = modal({ titulo, contenido: cuerpo, ancho: 4000, alCerrar, bloqueo: () => bloqueoEscritura() || (bloqueo ? bloqueo() : '') });
  m.el.parentElement.classList.add('inv-fondo');
  m.el.classList.add('inv-ventana');
  const b = m.el.querySelector('.modal-tit .cerrar');
  if (b) { b.textContent = '‹ ' + volver; b.setAttribute('aria-label', 'Volver a ' + volver); b.classList.add('inv-volver'); }
  // En celular o tableta la ventana no abre con el cursor en un campo (el teclado taparía la pantalla sin que se pida): el foco queda en «‹ Volver»
  if (window.matchMedia?.('(pointer:coarse)').matches && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) b?.focus({ preventScroll: true });
  return { ...m, cuerpo };
}
// Ventana encima de otra (un formulario, una confirmación con datos): tamaño normal
export function dialogo({ titulo, contenido, ancho = 620, alCerrar, botones = [] }) {
  const m = modal({ titulo, contenido: h('div.inv', contenido), ancho, alCerrar, bloqueo: bloqueoEscritura, botones });
  m.el.classList.add('inv-dialogo');
  // En celular o tableta no se abre el teclado sin que se pida: el foco va a «Cerrar» y la persona toca el campo cuando quiera escribir
  if (window.matchMedia?.('(pointer:coarse)').matches && /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || '') && m.el.contains(document.activeElement)) m.el.querySelector('.modal-tit .cerrar')?.focus({ preventScroll: true });
  return m;
}
// Pregunta con dos botones; devuelve true o false
export function preguntar(texto, { si = 'Sí, continuar', no = 'No, volver', peligro = false, detalle = null } = {}) {
  return new Promise((ok) => {
    let hecho = false;
    dialogo({ titulo: 'Confirme', ancho: 480, alCerrar: () => { if (!hecho) ok(false); },
      contenido: [h('p.conf', texto), detalle],
      botones: [{ texto: no, onclick: (c) => { hecho = true; c(); ok(false); } }, { texto: si, clase: peligro ? 'peligro' : 'primario', onclick: (c) => { hecho = true; c(); ok(true); } }] });
  });
}
// Foco al primer control útil de una ventana que terminó de cargar (en celular o tableta no se enfoca un campo de texto: abriría el teclado sin que se pida)
export function enfocar(raiz) {
  const tactil = window.matchMedia?.('(pointer:coarse)').matches;
  const act = document.activeElement;
  const fondo = raiz.closest('.modal-fondo');
  if (act && fondo && fondo.contains(act) && !act.classList.contains('inv-volver') && !act.classList.contains('cerrar')) return;
  const sel = 'button:not([disabled]), select:not([disabled])' + (tactil ? '' : ', input:not([type=hidden]):not([type=checkbox]):not([disabled])');
  const el = [...raiz.querySelectorAll(sel)].find((x) => x.offsetParent !== null && !x.closest('[hidden]'));
  el?.focus({ preventScroll: true });
}

/* ---------- Estados de carga, vacío y error ---------- */
export const cargando = (texto = 'Cargando…') => h('div.inv-cargando', { role: 'status', 'aria-live': 'polite' }, h('span.inv-girando', { 'aria-hidden': 'true' }), texto);
export const vacio = (texto, ...extra) => h('div.vacio.inv-vacio', h('p', texto), extra);
export function falla(e, alReintentar, titulo = 'No se pudo cargar') {
  return h('div.vacio.bloque-error.inv-falla', { role: 'alert' },
    h('p.bloque-error-tit', titulo),
    h('p.tenue', textoDeError(e)),
    alReintentar ? h('button.btn.primario', { type: 'button', 'data-reintentar': '1', onclick: () => alReintentar() }, 'Intentar de nuevo') : null);
}
export const aviso = (tipo, ...hijos) => h('div.inv-aviso.' + tipo, { role: tipo === 'mal' ? 'alert' : null }, hijos);

/* ---------- Acción que escribe: UNA clave por intención ---------- */
// boton: el botón que la dispara (se apaga mientras espera y aguanta el doble toque). zona: donde se dicen los errores y el «Reintentar».
// hacer(clave): hace la llamada con esa clave. alTerminar(respuesta, { repetida }): pinta el resultado.
// La clave se crea al primer toque y se REUTILIZA en cada reintento hasta que la acción termina bien: si la red se cayó y la base sí lo guardó,
// el reintento devuelve lo guardado («idem_repetida») y no duplica nada. Después de terminar bien, la próxima vez es otra intención y lleva otra clave.
// Un error del negocio (lo que dijo la base, tal cual) libera la clave en la base; se conserva igual porque sirve para el siguiente intento.
// alFallar(e) (opcional): después de un error del negocio, por ejemplo para volver a pedir lo disponible.
export function accionSegura({ boton, zona, hacer, alTerminar, alFallar, ocupado = 'Guardando…' }) {
  let clave = null, enCurso = false;
  const textoBoton = () => boton?.dataset.texto || boton?.textContent;
  if (boton && !boton.dataset.texto) boton.dataset.texto = boton.textContent;
  const decir = (...nodos) => { if (zona) poner(zona, ...nodos); };
  async function ejecutar() {
    if (enCurso) return; // doble toque o doble clic: la segunda vez no hace nada
    if (!clave) clave = claveNueva();
    const mia = clave;
    enCurso = true; enCamino++;
    if (boton) { boton.disabled = true; boton.dataset.ocupado = '1'; boton.textContent = ocupado; }
    decir(h('p.inv-guardando', { role: 'status' }, ocupado));
    let r;
    try {
      r = await hacer(mia);
    } catch (e) {
      enCurso = false; enCamino = Math.max(0, enCamino - 1);
      if (boton) { boton.disabled = false; delete boton.dataset.ocupado; boton.textContent = textoBoton(); }
      if (esTransitorio(e) || esSesionVencida(e)) {
        const reintentar = h('button.btn.primario.inv-reintentar', { type: 'button', onclick: () => ejecutar() }, 'Reintentar');
        decir(aviso('espera',
          h('p', h('strong', esSesionVencida(e) ? 'Su sesión venció antes de guardar. ' : 'No se pudo confirmar si quedó guardado: falló la conexión. '),
            esSesionVencida(e) ? 'Entre de nuevo con su PIN y toque «Reintentar».' : 'Toque «Reintentar» cuando vuelva la conexión.',
            ' Se manda con la misma clave, así que no se duplica aunque la primera vez sí haya llegado.'),
          reintentar));
        reintentar.focus({ preventScroll: true });
      } else {
        decir(aviso('mal', h('p', textoDeError(e))));
        try { alFallar?.(e); } catch { /* nada */ }
      }
      return null;
    }
    enCurso = false; enCamino = Math.max(0, enCamino - 1);
    clave = null; // terminó bien: la próxima vez es otra intención
    if (boton) { boton.disabled = false; delete boton.dataset.ocupado; boton.textContent = textoBoton(); }
    decir();
    try { await alTerminar?.(r, { repetida: !!(r && r.idem_repetida) }); } catch (e) { decir(aviso('mal', h('p', textoDeError(e)))); }
    document.dispatchEvent(new CustomEvent('app:alertas')); // la insignia del menú se pone al día
    document.dispatchEvent(new CustomEvent('inv:cambio'));
    return r;
  }
  return { ejecutar, get clave() { return clave; }, get enCurso() { return enCurso; }, olvidar: () => { if (!enCurso) clave = null; } };
}
// Botón ligado a una acción segura (atajo): devuelve { boton, accion }
export function botonSeguro(texto, clase, opciones) {
  const boton = h('button.btn' + (clase ? '.' + clase : ''), { type: 'button' }, texto);
  const accion = accionSegura({ boton, ...opciones });
  boton.addEventListener('click', () => accion.ejecutar());
  return { boton, accion };
}
// Cambia lo que dice un botón de acción segura (por ejemplo «Recibir 3 líneas»). Mientras espera respuesta no se toca: al terminar vuelve a este texto.
export function rotular(boton, texto) { boton.dataset.texto = texto; if (!boton.dataset.ocupado) boton.textContent = texto; }
export const repetidaTxt = (repetida) => (repetida ? ' Ya estaba guardado de antes: no se repitió.' : '');

/* ---------- Selectores ---------- */
// Ubicaciones activas para escoger (bodegas primero), con «Todas» opcional
export function selectUbicacion(cat, { valor = '', todas = false, etiqueta = 'Ubicación', excluir = null, soloActivas = true, alCambiar } = {}) {
  const lista = (cat.ubicaciones || []).filter((u) => (!soloActivas || u.activo !== false) && u.id !== excluir);
  const sel = h('select.campo', { 'aria-label': etiqueta, onchange: () => alCambiar?.(sel.value) },
    todas ? h('option', { value: '' }, 'Todas las bodegas y locales') : null,
    !todas && !valor ? h('option', { value: '' }, 'Escoja dónde') : null,
    lista.map((u) => h('option', { value: u.id, selected: u.id === valor }, u.nombre + (u.tipo === 'local' && u.sociedad_nombre ? '' : ''))));
  if (valor) sel.value = valor;
  return sel;
}
export const nombreUbicacion = (cat, id) => (cat.ubicaciones || []).find((u) => u.id === id)?.nombre || 'Ubicación';
export function empresaDe(cat, id) { const e = (cat.empresas || []).find((x) => x.id === id); return e ? { nombre: e.nombre, codigo: e.codigo } : null; }
export const chipEmpresaId = (cat, id, nombre) => { const e = empresaDe(cat, id); return empresaChip(e?.nombre || nombre || null, e?.codigo || null); };

// Escoger un artículo de una lista: ventana con buscador y botones grandes. opciones: [{ id, nombre, unidad, detalle, extra }]. Devuelve la opción o null.
// sugerido: id que va arriba marcado «Sugerido». crear: función opcional (solo administradores) que abre el formulario de artículo nuevo y devuelve el creado.
export function elegirArticulo({ titulo = 'Escoja el artículo', opciones, sugerido = null, ayuda = '', crear = null, textoBuscar = '', vacioTxt = 'No hay artículos para escoger.' }) {
  return new Promise((ok) => {
    let hecho = false;
    const q = h('input.campo', { type: 'search', placeholder: 'Escriba parte del nombre o el CABYS', 'aria-label': 'Buscar artículo', value: textoBuscar, autocomplete: 'off' });
    const lista = h('div.inv-opciones', { role: 'list' });
    const fin = (v) => { hecho = true; m.cerrar(); ok(v); };
    const pintar = () => {
      const t = norm(q.value);
      const filtradas = opciones.filter((o) => !t || norm(o.nombre + ' ' + (o.cabys || '') + ' ' + (o.detalle || '')).includes(t));
      filtradas.sort((a, b) => (b.id === sugerido) - (a.id === sugerido));
      poner(lista, ...filtradas.slice(0, 120).map((o) => h('button.inv-opcion' + (o.id === sugerido ? '.sugerida' : ''), { type: 'button', role: 'listitem', onclick: () => fin(o) },
        h('span.inv-op-nombre', o.nombre, o.id === sugerido ? h('span.chip.ok', 'Sugerido') : null),
        h('span.inv-op-det', [o.unidad ? 'Se cuenta en ' + unidadTxt(o.unidad, 2) : '', o.detalle || ''].filter(Boolean).join(' · ')),
        o.extra ? h('span.inv-op-extra', o.extra) : null,
        h('span.inv-op-elegir', 'Escoger'))));
      if (!filtradas.length) lista.append(vacio(t ? 'Ningún artículo coincide con «' + q.value.trim() + '».' : vacioTxt));
      else if (filtradas.length > 120) lista.append(h('p.tenue', 'Se muestran 120. Escriba más letras para encontrar los demás.'));
    };
    q.addEventListener('input', debounce(pintar, 120));
    const crearBtn = crear ? h('button.btn', { type: 'button', onclick: async () => { const n = await crear(q.value.trim()); if (n) fin(n); } }, 'Crear un artículo nuevo') : null;
    const m = dialogo({ titulo, ancho: 640, alCerrar: () => { if (!hecho) ok(null); },
      contenido: [ayuda ? h('p.tenue.inv-ayuda', ayuda) : null, h('label.etq', 'Buscar', q), lista, crearBtn ? h('div.inv-pie-crear', h('p.tenue', '¿No está en la lista?'), crearBtn) : null] });
    pintar();
  });
}

/* ---------- Datos que se reutilizan dentro del módulo ---------- */
// Lista de artículos activos (para escoger al recibir, porcionar, contar). Se vuelve a pedir después de guardar un artículo y a los 2 minutos.
export function crearCacheArticulos() {
  let promesa = null, t = 0;
  return {
    lista(forzar = false) {
      if (!forzar && promesa && Date.now() - t < 120000) return promesa;
      t = Date.now();
      promesa = inv.articulos('', null, false).then((r) => r?.articulos || [], (e) => { promesa = null; throw e; });
      return promesa;
    },
    olvidar() { promesa = null; },
  };
}
export const opcionDeArticulo = (a) => ({ id: a.id, nombre: a.nombre, unidad: a.unidad, cabys: a.cabys || '', detalle: [a.categoria, a.cabys ? 'CABYS ' + a.cabys : ''].filter(Boolean).join(' · '), extra: Number(a.existencia) > 0 ? 'Hay ' + cantTxt(a.existencia, a.unidad) + ' en total' : 'Sin existencias', a });

// Una frase del resultado de una salida o traslado: «Pollo entero: 2,5 kg (₡5 375,00)»
export const lineaItem = (it, unidad) => `${it.articulo}: ${cantTxt(it.cantidad, unidad || it.unidad)} (${money(it.valor)} sin IVA)`;
export const toastOk = (t) => toast(t, 'ok', 4500);

/* ---------- Bolsas del inventario simple ---------- */
export const GRUPOS = { comida_preparada: 'Comida preparada', unitario: 'Unitarios', suministro: 'Suministros' };
/** Bolsa a la que pertenece un artículo según la categoría (null si la categoría no tiene bolsa) */
export const grupoDe = (cat, art) => (cat?.categorias || []).find((c) => c.id === art?.categoria_id)?.grupo || null;
/** El inventario arranca en modo simple; «completo» lo activa un administrador en Configuración */
export const esSimple = (cat) => (cat?.config?.modo || 'simple') !== 'completo';
