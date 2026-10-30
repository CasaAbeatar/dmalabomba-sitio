// Contable: facturas de proveedores que llegan a los correos de contabilidad, su respuesta a Hacienda (Mensaje Receptor 1 aceptar, 2 aceptar parcialmente, 3 rechazar) y el IVA del mes.
// Plazo: 8 días hábiles contados desde el inicio del mes siguiente a la fecha de la factura (lo calcula SQL, fx_plazo_receptor). Datos: fx_recibidas / fx_recibida (solo lectura) y CONTRATO_CONTABLE.md.
// Respuestas: función de borde facturador-receptor v8. Antes de enviar se pide «calcular» (no envía nada) y se muestra en palabras qué recibirá Hacienda, el IVA que se acredita y el gasto.
import { h, money, num, fechaHora, horaCorta, debounce, modal, conBoton, toast, nombrePropio, nombreLocal, campoBusqueda, hoyCR, sumaDias } from './util.js';
import { recibidas, recibida, respuestaGuardada, responder, calcularRespuesta, consultarRespuesta, revisarCorreo, alertasRecepcion, atenderAviso, otraCedula, ivaMes, ivaMesDetalle } from './api_recepcion.js';
import { mensajeAmable } from './api_documentos.js';
import { selectorPeriodo, textoRango } from './periodo.js';
import { crearDescarga, nombrePeriodo } from './descargas.js';

const cssUrl = new URL('../css/recepcion.css', import.meta.url).href;
const TZ = 'America/Costa_Rica';
const TIPOS = { FacturaElectronica: 'Factura electrónica', TiqueteElectronico: 'Tiquete electrónico', NotaCreditoElectronica: 'Nota de crédito', NotaDebitoElectronica: 'Nota de débito', FacturaElectronicaCompra: 'Factura de compra', FacturaElectronicaExportacion: 'Factura de exportación' };
const nombreTipo = (t) => TIPOS[t] || t || 'Comprobante';
const esNC = (t) => t === 'NotaCreditoElectronica', esND = (t) => t === 'NotaDebitoElectronica';
const limpiarNombre = (n) => String(n || 'Proveedor sin nombre').replace(/\s*\(([^()]*)\)\s*$/, (m, a) => (n.toUpperCase().startsWith(a.toUpperCase()) ? '' : m));
// Para mostrar: sin mayúsculas sostenidas (el archivo y el CSV conservan el nombre tal como viene en la factura)
const nomProv = (n) => nombrePropio(limpiarNombre(n));
// Para el nombre del archivo: solo letras, números y signos comunes, y corto (el nombre del proveedor o lo que se buscó puede traer cualquier cosa)
const paraArchivo = (t, max = 40) => String(t || '').replace(/[^\p{L}\p{N} .,&'()-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim();
// Fechas: un día suelto (AAAA-MM-DD, como «vence») se lee tal cual; una fecha con hora (como «llegó») se pasa a la hora de Costa Rica (M5).
const diaSemana = (ymd) => new Intl.DateTimeFormat('es-CR', { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(String(ymd).slice(0, 10) + 'T12:00:00Z'));
const diaSemanaCR = (ts) => (ts ? new Intl.DateTimeFormat('es-CR', { timeZone: TZ, weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(ts)) : '');
const plural = (n, u, p) => `${num(n, 0)} ${Math.abs(n) === 1 ? u : p}`;
const mesDe = (ymd) => String(ymd).slice(0, 7);
const nombreMes = (aaaamm) => new Intl.DateTimeFormat('es-CR', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(aaaamm + '-15T12:00:00Z'));
/** «₡12 345,67» o «USD 1 234,50»: el mismo formato que usa la función de borde en el detalle que recibe Hacienda (receptor.ts, montoTexto). */
export function montoTexto(n, moneda = 'CRC') {
  const v = Math.round((Math.abs(Number(n) || 0) + Number.EPSILON) * 100) / 100;
  const [e, d] = v.toFixed(2).split('.');
  return (Number(n) < 0 ? '-' : '') + (moneda === 'CRC' || !moneda ? '₡' : moneda + ' ') + e.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ',' + d;
}
const largo = (t) => Array.from(String(t || '')).length;
// Condición del IVA (nota 18 del anexo v4.4), en palabras para quien responde
const CONDICIONES = [
  { c: '01', t: 'Todo el IVA se usa como crédito fiscal', d: 'Lo normal en compras para el negocio: mercadería, insumos y servicios. El IVA que pagó se resta del IVA que se le paga a Hacienda en la declaración del mes.' },
  { c: '02', t: 'Solo una parte del IVA se usa como crédito fiscal', d: 'Cuando la compra se usa en parte para algo que no es del negocio o la tarifa que se puede acreditar es menor. Escriba el porcentaje; el resto del IVA se suma al gasto.' },
  { c: '03', t: 'Es un bien de capital (equipo, maquinaria, mobiliario)', d: 'El IVA se usa como crédito fiscal y la compra queda como un activo del negocio, no como gasto del mes.' },
  { c: '04', t: 'Es un gasto: el IVA no se usa como crédito fiscal', d: 'El IVA pagado no se resta en la declaración del IVA. Todo el monto, con el IVA, se registra como gasto.' },
];
const TEXTO_CONDICION = Object.fromEntries(CONDICIONES.map((x) => [x.c, x.t]));

// Estado de una factura para mostrar: {texto, clase, sub, nivel}
export function estadoFila(f) {
  const rec = f.receptor_estado, hac = f.hacienda_estado;
  if (!f.requiere) return { texto: 'No necesita respuesta', clase: '', sub: 'Los tiquetes y facturas de compra no se aceptan ni se rechazan.' };
  if (hac === '3' && f.hacienda_cuadra !== false) return { texto: 'Rechazada por Hacienda', clase: 'mal', sub: 'Hacienda no la aceptó cuando el proveedor la envió; no hay que responderla.' };
  const cuando = (f.receptor_en ? 'El ' + fechaHora(f.receptor_en) : '') + (f.receptor_envio === 'enviado' ? ' · Llegó a Hacienda, falta que Hacienda la confirme' : '');
  if (rec === '1') return { texto: 'Aceptada', clase: 'ok', sub: cuando };
  if (rec === '2') return { texto: 'Aceptada parcialmente', clase: 'espera', sub: cuando };
  if (rec === '3') return { texto: 'Rechazada por usted', clase: 'mal', sub: cuando };
  const intento = f.receptor_envio === 'rechazado' ? ' · Hacienda rechazó la respuesta anterior: hay que enviar otra'
    : f.receptor_envio === 'error' ? ' · Hacienda no recibió el intento anterior'
    : f.receptor_envio === 'pendiente' ? ' · Un intento anterior quedó sin confirmar' : '';
  const correo = f.receptor_reportado ? ' · Llegó por correo un aviso de respuesta, sin verificar' : '';
  const d = f.dias_restantes, extra = intento + correo, lim = f.vence ? 'Límite: ' + diaSemana(f.vence) + extra : extra.slice(3);
  if (d < 0) return { texto: `Plazo vencido hace ${plural(-d, 'día hábil', 'días hábiles')}`, clase: 'mal', sub: lim, nivel: 'vencida' };
  if (d === 0) return { texto: 'Último día para responder: hoy', clase: 'mal', sub: lim, nivel: 'pronto' };
  if (d <= 2) return { texto: `Quedan ${plural(d, 'día hábil', 'días hábiles')}`, clase: 'espera', sub: lim, nivel: 'pronto' };
  return { texto: `Quedan ${plural(d, 'día hábil', 'días hábiles')}`, clase: '', sub: lim, nivel: 'plazo' };
}
// Insignia del tipo de comprobante: la nota de crédito resta y la de débito suma (k)
const chipTipo = (t) => (esNC(t) ? h('span.chip.rec-tipo.nc', 'Nota de crédito: resta') : esND(t) ? h('span.chip.rec-tipo.nd', 'Nota de débito: suma') : null);

export default {
  id: 'recepcion', titulo: 'Contable',
  async mount(root, app) {
    if (!document.getElementById('css-recepcion')) document.head.append(h('link', { id: 'css-recepcion', rel: 'stylesheet', href: cssUrl }));
    const soc = app.soc; const nomLocal = nombreLocal(soc);
    let ficha = 0, vivo = true;
    // Toques que caen en lo de abajo justo después de cerrar una ventana (doble toque en el celular): se ignoran durante un momento
    let guardaHasta = 0;
    const guardar = () => { guardaHasta = Date.now() + 750; };
    const tocable = (fn) => (e) => { if (Date.now() < guardaHasta) { e?.preventDefault?.(); return; } fn(e); };
    const est = { vista: 'pendientes', q: '', datos: null, conteo: null, per: { todas: 'hoy', vencidas: 'mes' }, vencTodo: true, mes: mesDe(hoyCR()), avisos: null };

    const periodo = selectorPeriodo({ inicial: 'hoy', alCambiar: () => cargar() });
    const periodoCaja = h('div.tarjeta.rec-periodo', periodo.el);
    const buscar = h('input.campo', { type: 'search', placeholder: 'Proveedor, cédula o número de factura', 'aria-label': 'Buscar por proveedor o número de factura', oninput: debounce(() => { est.q = buscar.value.trim(); cargar(); }, 350) });
    const buscarCaja = h('label.etq.rec-buscar', 'Buscar', campoBusqueda(buscar, () => { est.q = ''; cargar(); }));
    const avisosCaja = h('div.rec-avisos', { hidden: true, 'aria-live': 'polite' });
    const kpis = h('div.rejilla.rec-kpis');
    const tabs = h('div.rec-vistas', { role: 'group', 'aria-label': 'Qué ver' });
    const vencFiltro = h('div.rec-venc-filtro', { hidden: true, role: 'group', 'aria-label': 'Qué facturas vencidas ver' });
    const rotulo = h('p.rec-rotulo');
    const resumen = h('div.rec-resumen');
    const lista = h('div.rec-lista');
    const ivaCaja = h('div.rec-iva', { hidden: true });
    const estadoCorreo = h('div.rec-correo-estado', { hidden: true, 'aria-live': 'polite' });
    const btnCorreo = h('button.btn', { type: 'button', onclick: () => conBoton(btnCorreo, buscarCorreo) }, 'Buscar facturas nuevas en el correo');

    root.append(
      h('div.rec-cab', h('div', h('h2', 'Facturas de proveedores'),
        h('p.tenue', 'Facturas que llegaron a los correos de contabilidad a nombre de ', h('strong', nomLocal), soc?.cedula ? ` (cédula ${soc.cedula})` : '', '. Aquí no aparecen los comprobantes que la empresa se emite a sí misma.')),
        h('div.rec-cab-botones', btnCorreo)),
      estadoCorreo, avisosCaja, kpis, tabs, vencFiltro, periodoCaja, buscarCaja, rotulo, resumen, lista, ivaCaja);

    /* ---------- revisar el correo ---------- */
    async function buscarCorreo() {
      estadoCorreo.hidden = false; estadoCorreo.className = 'rec-correo-estado'; estadoCorreo.replaceChildren('Revisando los correos de contabilidad (los últimos 3 días). Puede tardar hasta un minuto, no cierre esta pantalla…');
      btnCorreo.textContent = 'Revisando el correo…';
      try {
        const r = await revisarCorreo();
        const bz = r.buzones || [];
        const sum = (k) => bz.reduce((a, b) => a + (+b[k] || 0), 0);
        const errs = bz.flatMap((b) => b.errores || []);
        const sinXml = sum('n_sin_xml'), ejemplos = bz.flatMap((b) => b.sin_xml || []).slice(0, 3);
        estadoCorreo.className = 'rec-correo-estado ' + (errs.length || sinXml ? 'aviso' : 'ok');
        estadoCorreo.replaceChildren(
          h('p', `Se revisaron ${plural(sum('correos'), 'correo', 'correos')} de ${plural(bz.length, 'buzón', 'buzones')}; ${plural(sum('comprobantes'), 'comprobante leído', 'comprobantes leídos')} y ${plural(sum('mensajes_hacienda'), 'respuesta de Hacienda', 'respuestas de Hacienda')}.`),
          sinXml ? h('p', h('strong', sinXml === 1 ? '1 correo traía una factura sin XML' : `${num(sinXml, 0)} correos traían una factura sin XML`), ' (por ejemplo, solo el PDF). Sin el XML no se puede responder a Hacienda ni usar el IVA: pídale el XML al proveedor.') : null,
          ejemplos.length ? h('ul.rec-ejemplos', ejemplos.map((t) => h('li', String(t)))) : null,
          errs.length ? h('p', `${errs.length === 1 ? 'Un correo no se pudo leer' : errs.length + ' correos no se pudieron leer'}. Avise a la persona encargada.`) : null);
        if (vivo) { await cargar(); cargarAvisos(); }
      } catch (e) {
        const sinPuente = /failed to fetch|networkerror|load failed/i.test(String(e.message || e));
        estadoCorreo.className = 'rec-correo-estado ' + (sinPuente ? 'aviso' : 'error');
        estadoCorreo.replaceChildren(sinPuente
          ? 'La revisión manual del correo todavía no se puede hacer desde esta pantalla. No pasa nada: el sistema revisa solo los correos de contabilidad varias veces al día y las facturas nuevas aparecen aquí. Lo que ya estaba guardado se sigue viendo.'
          : 'No se pudo revisar el correo ahora. Las facturas que ya estaban guardadas se siguen viendo. Intente de nuevo en unos minutos.');
      } finally { btnCorreo.textContent = 'Buscar facturas nuevas en el correo'; }
    }

    /* ---------- avisos de hoy: facturas y correos sin XML (fx_alertas) ---------- */
    async function cargarAvisos() {
      let a;
      try { a = await alertasRecepcion(soc.id); } catch { return; } // sin avisos no se muestra nada; la lista sigue igual
      if (!vivo) return;
      est.avisos = a; pintarAvisos();
    }
    function pintarAvisos() {
      const a = est.avisos || {};
      const items = Array.isArray(a.recepcion_sin_xml_ultimos) ? a.recepcion_sin_xml_ultimos : [];
      const nFact = +a.recepcion_sin_xml || 0, nCorreo = +a.correos_sin_xml || 0;
      if (!nFact && !nCorreo) { avisosCaja.hidden = true; avisosCaja.replaceChildren(); return; }
      const partes = [nFact ? (nFact === 1 ? 'De 1 factura llegó la respuesta de Hacienda pero no el XML' : `De ${num(nFact, 0)} facturas llegó la respuesta de Hacienda pero no el XML`) : '', nCorreo ? (nCorreo === 1 ? '1 correo traía adjuntos sin XML' : `${num(nCorreo, 0)} correos traían adjuntos sin XML`) : ''].filter(Boolean);
      avisosCaja.hidden = false;
      avisosCaja.replaceChildren(
        h('div.rec-aviso-tit', h('strong', 'Facturas sin XML'), h('span', partes.join('. ') + '. Sin el XML no se pueden responder a Hacienda ni usar para el crédito del IVA: pídaselo al proveedor.')),
        items.length ? h('ul.rec-sinxml', items.map((x) => {
          const btn = h('button.btn.chico', { type: 'button', onclick: tocable(() => conBoton(btn, async () => {
            await atenderAviso(soc.id, x.tipo, x.ref);
            toast('Aviso marcado como revisado.');
            est.avisos = { ...est.avisos, recepcion_sin_xml_ultimos: items.filter((y) => y !== x), [x.tipo === 'correo_sin_xml' ? 'correos_sin_xml' : 'recepcion_sin_xml']: Math.max(0, (+est.avisos[x.tipo === 'correo_sin_xml' ? 'correos_sin_xml' : 'recepcion_sin_xml'] || 1) - 1) };
            pintarAvisos(); app.alertas?.refrescar?.();
          })) }, 'Ya lo revisé');
          const txt = x.tipo === 'correo_sin_xml'
            ? [h('strong', x.asunto ? String(x.asunto) : 'Correo sin XML'), h('small', `Correo del ${fechaHora(x.recibido)}`)]
            : [h('strong', nomProv(x.proveedor)), h('small', `${x.cedula ? 'Cédula ' + x.cedula + ' · ' : ''}${x.monto != null ? 'Total ' + money(x.monto) : ''}${x.iva != null ? ' · IVA ' + money(x.iva) : ''}${x.recibido ? ' · ' + fechaHora(x.recibido) : ''}`)];
          return h('li', h('div', ...txt), btn);
        })) : null);
    }

    /* ---------- carga ---------- */
    const modo = () => (est.vista === 'pendientes' ? 'pendientes' : est.vista === 'vencidas' ? 'vencidas' : 'todas');
    // La pestaña «Plazo vencido» abre con TODAS las vencidas (lo mismo que cuenta su número); se puede filtrar por fecha de llegada (M4)
    const rangoActual = () => (est.vista === 'vencidas' && est.vencTodo ? [sumaDias(hoyCR(), -800), hoyCR()] : est.vista === 'pendientes' ? [null, null] : periodo.rango());
    async function cargar() {
      if (est.vista === 'iva') return cargarIva();
      const mia = ++ficha;
      const [desde, hasta] = rangoActual();
      const lst = est.vista !== 'iva';
      [buscarCaja, rotulo, resumen, lista].forEach((x) => { x.hidden = !lst; }); ivaCaja.hidden = true;
      periodoCaja.hidden = est.vista === 'pendientes' || (est.vista === 'vencidas' && est.vencTodo);
      pintarTabs(); pintarVencFiltro();
      lista.replaceChildren(h('p.cargando', 'Cargando facturas…')); resumen.replaceChildren();
      rotulo.textContent = est.vista === 'pendientes'
        ? 'Facturas que llegaron y todavía no tienen respuesta, con los días hábiles que les quedan. El plazo es de 8 días hábiles y se cuenta desde el inicio del mes siguiente a la fecha de la factura. Las más urgentes van primero.'
        : est.vista === 'vencidas'
          ? (est.vencTodo ? 'Todas las facturas sin respuesta cuyo plazo de 8 días hábiles ya pasó, sin importar cuándo llegaron. Las más recientes van primero.' : 'Facturas sin respuesta cuyo plazo de 8 días hábiles ya pasó, que llegaron ' + textoRango(desde, hasta) + '.')
          : 'Facturas que llegaron ' + textoRango(desde, hasta) + '.';
      try {
        const d = await recibidas(soc.id, desde, hasta, est.q, modo());
        if (mia !== ficha || !vivo) return;
        est.datos = d; est.conteo = d.conteo; est.rango = [desde, hasta];
        pintarKpis(); pintarTabs(); pintarLista();
        marcarPestana(d.conteo);
      } catch (e) {
        if (mia !== ficha) return;
        lista.replaceChildren(h('div.vacio', h('p', 'No se pudieron traer las facturas.'), h('p.tenue', mensajeAmable(e, 'Revise la conexión e intente de nuevo.')), h('button.btn', { type: 'button', 'data-reintentar': '1', onclick: () => cargar() }, 'Intentar de nuevo')));
      }
    }

    // La insignia de las tarjetas de Contable y de Administración la dibuja el inicio (ui_inicio.js, con la cifra de app.recepcion), con la misma cifra que esta pantalla y el aviso de arriba
    const marcarPestana = (c) => app.alertas?.fijarRecepcion?.(c);

    function pintarKpis() {
      const c = est.conteo || {}; const venc = (c.vencidas_recientes || 0) + (c.vencidas_antiguas || 0);
      kpis.replaceChildren(
        kpi('Llegaron hoy', num(c.llegaron_hoy || 0, 0), 'Facturas y notas que entraron hoy a los correos de contabilidad.'),
        kpi('Pendientes de responder', num(c.pendientes_en_plazo || 0, 0), 'Dentro del plazo de 8 días hábiles. Mientras no se acepten, su IVA no se acredita.', c.pendientes_en_plazo ? 'alerta' : ''),
        kpi('Vencen en 2 días hábiles o menos', num(c.vencen_pronto || 0, 0), c.vencen_hoy ? `${plural(c.vencen_hoy, 'vence', 'vencen')} hoy.` : 'Conviene responderlas primero.', c.vencen_pronto ? 'pronto' : ''),
        kpi('IVA de las pendientes', money(c.iva_en_riesgo || 0), 'IVA pagado a proveedores en facturas aún sin aceptar y dentro del plazo.'),
        kpi('Plazo vencido sin respuesta', num(venc, 0), c.vencidas_antiguas ? `${num(c.vencidas_antiguas, 0)} llegaron hace más de 25 días. Si alguna se respondió desde otro sistema, aquí sigue como pendiente.` : 'Facturas cuyo plazo ya pasó.', venc ? 'vencida' : ''));
    }
    const kpi = (t, v, n, extra) => h('div.tarjeta.kpi' + (extra ? '.' + extra : ''), h('div.kpi-t', t), h('div.kpi-v.cifra', v), h('div.kpi-n', n));

    function irA(id) {
      if (est.vista === id) return;
      if (['todas', 'vencidas'].includes(est.vista) && !(est.vista === 'vencidas' && est.vencTodo)) est.per[est.vista] = periodo.id();
      est.vista = id;
      const p = est.per[id];
      if (['todas', 'vencidas'].includes(id) && !(id === 'vencidas' && est.vencTodo) && p && p !== 'otro' && p !== periodo.id()) periodo.elegir(p); else cargar();
    }
    function pintarTabs() {
      const c = est.conteo || {};
      const venc = (c.vencidas_recientes || 0) + (c.vencidas_antiguas || 0);
      const b = (id, t, n) => h('button.btn.rec-vista', { type: 'button', 'aria-pressed': String(est.vista === id), onclick: tocable(() => irA(id)) }, t, n != null ? h('span.rec-n', num(n, 0)) : null);
      tabs.replaceChildren(b('pendientes', 'Pendientes de responder', c.pendientes_en_plazo ?? null), b('todas', 'Todas las facturas', null), b('vencidas', 'Plazo vencido', venc || null), b('iva', 'IVA del mes', null));
    }
    function pintarVencFiltro() {
      vencFiltro.hidden = est.vista !== 'vencidas';
      if (vencFiltro.hidden) return;
      const b = (todo, t) => h('button.btn.chico', { type: 'button', 'aria-pressed': String(est.vencTodo === todo), onclick: () => { if (est.vencTodo === todo) return; est.vencTodo = todo; if (!todo && est.per.vencidas && est.per.vencidas !== periodo.id() && est.per.vencidas !== 'otro') periodo.elegir(est.per.vencidas); else cargar(); } }, t);
      vencFiltro.replaceChildren(b(true, 'Todas las vencidas'), b(false, 'Solo las que llegaron en un periodo'));
    }

    /* ---------- lista ---------- */
    function pintarLista() {
      const d = est.datos, filas = d.filas || [];
      const r = d.resumen || {};
      resumen.replaceChildren();
      if (!filas.length) {
        const msg = est.q ? 'Ninguna factura coincide con la búsqueda.' : est.vista === 'pendientes' ? 'No hay facturas pendientes de responder. Todo está al día.' : est.vista === 'vencidas' ? (est.vencTodo ? 'No hay facturas con el plazo vencido.' : 'No hay facturas con el plazo vencido que hayan llegado en este periodo.') : 'No llegaron facturas de proveedores en este periodo.';
        lista.replaceChildren(h('div.vacio', h('p', msg), est.vista === 'todas' && periodo.id() === 'hoy' ? h('div.fila', { style: 'justify-content:center' }, h('button.btn.primario', { type: 'button', onclick: () => periodo.elegir('mes') }, 'Ver este mes')) : null));
        pieOtras(d); return;
      }
      resumen.append(h('div.rec-resumen-fila',
        h('span', h('strong', plural(r.n, 'factura', 'facturas')), est.vista === 'pendientes' ? ' sin responder' : ''),
        h('span', 'Total con IVA (notas de crédito restadas): ', h('strong.cifra', money(r.total))),
        h('span', 'IVA pagado a proveedores: ', h('strong.cifra', money(r.iva))),
        h('span', 'Compras sin IVA: ', h('strong.cifra', money(r.neto))),
        crearDescarga(() => opcionesLista(), { texto: 'Descargar', etiqueta: 'Descargar la lista de facturas de proveedores que se ve ahora' })));
      lista.replaceChildren(
        h('div.rec-enc', h('span', 'Llegó'), h('span', 'Proveedor y comprobante'), h('span.der', 'Total con IVA'), h('span.der', 'IVA'), h('span', 'Respuesta a Hacienda')),
        ...filas.map(fila));
      if (d.truncado) lista.append(h('p.lis-aviso', 'Se muestran las 500 más recientes. Use el buscador o un periodo más corto para ver las demás.'));
      pieOtras(d);
    }
    function pieOtras(d) {
      const n = +d.otras_cedulas || 0, sr = +d.sin_receptor || 0;
      if (!(n > 0) && !(sr > 0)) return;
      const txt = [n > 0 ? `${plural(n, 'comprobante', 'comprobantes')} a nombre de otra cédula (por ejemplo de una persona o de otra empresa)` : '', sr > 0 ? `${plural(sr, 'tiquete o comprobante', 'tiquetes o comprobantes')} sin cédula de receptor` : ''].filter(Boolean).join(' y ');
      lista.append(h('div.rec-otras', h('p.tenue', `Además llegaron a estos correos ${txt}. No se muestran en la lista.`),
        n > 0 ? h('button.btn.chico', { type: 'button', onclick: tocable(() => verOtraCedula()) }, 'Ver cuáles son') : null));
    }
    async function verOtraCedula() {
      const [d0, h0] = est.rango || [null, null], hoy = hoyCR();
      const desde = d0 || sumaDias(hoy, -30), hasta = h0 || hoy;
      const cuerpo = h('div', h('p.cargando', 'Cargando…'));
      const m = modal({ titulo: 'Comprobantes a nombre de otra cédula', contenido: cuerpo, ancho: 860, alCerrar: guardar });
      m.el.classList.add('rec-modal');
      try {
        const r = await otraCedula(soc.id, desde, hasta);
        const fs = [...(r.filas || [])].sort((a, b) => new Date(a.llego) - new Date(b.llego));
        cuerpo.replaceChildren(h('p.tenue', `Llegaron ${textoRango(desde, hasta)} a los correos de ${nomLocal}. No son compras de esta empresa: no se responden desde aquí.`),
          fs.length ? h('ul.rec-otra-lista', fs.map((f) => h('li', h('div', h('strong', f.motivo === 'otra_empresa_del_grupo' ? 'Comprobante de la otra empresa del grupo' : nomProv(f.emisor_nombre)),
            h('small', [nombreTipo(f.tipo), f.consecutivo ? 'consecutivo ' + f.consecutivo.slice(-10) : '', 'llegó ' + fechaHora(f.llego), f.receptor_cedula ? 'a nombre de la cédula ' + f.receptor_cedula : 'sin cédula de receptor'].filter(Boolean).join(' · ')),
            f.motivo_texto ? h('small', f.motivo_texto) : null),
            f.total != null ? h('span.cifra', money(f.total)) : null))) : h('p.vacio', 'No hay comprobantes a nombre de otra cédula en este periodo.'));
      } catch (e) { cuerpo.replaceChildren(h('div.error-caja', 'No se pudo traer la lista. ' + mensajeAmable(e, 'Intente de nuevo en un momento.'))); }
    }
    function fila(f) {
      const e = estadoFila(f); const nota = esNC(f.tipo);
      const avisos = [f.aviso_buzon, f.lineas_aviso, f.del_grupo ? 'Compra a la otra empresa del grupo.' : ''].filter(Boolean);
      return h('button.rec-fila' + (e.nivel ? '.' + e.nivel : ''), { type: 'button', onclick: tocable(() => abrirDetalle(f.clave)), 'aria-label': `Ver detalle de ${nombreTipo(f.tipo).toLowerCase()} ${f.consecutivo || ''} de ${nomProv(f.emisor_nombre)}` },
        h('span.rec-fecha', h('strong', diaSemanaCR(f.llego)), h('small', horaCorta(f.llego))),
        h('span.rec-prov', h('strong', nomProv(f.emisor_nombre)), h('small', `${nombreTipo(f.tipo)} ${f.consecutivo ? '· ' + f.consecutivo.slice(-10) : ''} · cédula ${f.emisor_cedula || 'sin dato'}`), chipTipo(f.tipo),
          avisos.length ? h('small.rec-aviso-fila', avisos.join(' ')) : null),
        h('span.rec-monto.der', h('small.rec-et', 'Total'), (nota ? '−' : '') + money(f.total)),
        h('span.rec-monto.der', h('small.rec-et', 'IVA'), (nota ? '−' : '') + money(f.iva)),
        h('span.rec-estado', h('span.chip' + (e.clase ? '.' + e.clase : ''), e.texto), e.sub ? h('small', e.sub) : null),
        h('span.rec-ver', 'Ver detalle'));
    }
    // Lo que se descarga: la lista que se ve ahora (misma vista, periodo y búsqueda), del más antiguo al más reciente. Los datos son los de la pantalla, no se piden de nuevo.
    function opcionesLista() {
      const d = est.datos; if (!d) return { filas: [] };
      const r = d.resumen || {};
      const [desde, hasta] = est.rango || rangoActual();
      const pend = est.vista === 'pendientes', venc = est.vista === 'vencidas';
      const filas = [...(d.filas || [])].sort((a, b) => new Date(a.llego) - new Date(b.llego));
      const hoy = hoyCR();
      const notas = ['Ordenado de la factura que llegó primero a la que llegó último.', 'Las notas de crédito van con signo negativo: restan del total. Las notas de débito suman.'];
      if (!d.truncado) notas.push('La fila Total es la misma cifra de la pantalla: se suman los montos exactos (5 decimales) y se redondea una sola vez. Sumar las filas ya redondeadas puede dar un céntimo de diferencia.');
      if (d.truncado) notas.push(`Esta lista trae solo las ${filas.length} facturas más recientes de las ${r.n}. El total de toda la búsqueda es ${money(r.total)} con IVA, ${money(r.iva)} de IVA y ${money(r.neto)} sin IVA. Para ver las demás use un periodo más corto o el buscador.`);
      if (d.otras_cedulas > 0) notas.push(`Además llegaron ${plural(d.otras_cedulas, 'comprobante', 'comprobantes')} a nombre de otra cédula (por ejemplo de una persona o de otra empresa). No están en esta lista.`);
      const periodoTxt = pend ? '' : venc && est.vencTodo ? 'todas' : nombrePeriodo(desde, hasta);
      return {
        nombre: (pend ? `Facturas de proveedores pendientes ${nombrePeriodo(hoy, hoy)}` : `Facturas de proveedores${venc ? ' con plazo vencido' : ''} ${periodoTxt}`).trim() + (paraArchivo(est.q, 30) ? ` búsqueda ${paraArchivo(est.q, 30)}` : ''),
        empresa: nomLocal, cedula: soc?.cedula || '',
        titulo: pend ? 'Facturas de proveedores pendientes de responder' : venc ? 'Facturas de proveedores con el plazo vencido' : 'Facturas de proveedores',
        subtitulo: (pend ? 'Sin respuesta y dentro del plazo de 8 días hábiles' : venc ? (est.vencTodo ? 'Sin respuesta y con el plazo ya vencido, sin importar cuándo llegaron' : 'Sin respuesta y con el plazo ya vencido, que llegaron ' + textoRango(desde, hasta)) : 'Llegaron ' + textoRango(desde, hasta)) + (est.q ? ` · búsqueda: «${est.q}»` : ''),
        cifras: 'netas', cifrasNota: 'Montos en colones con IVA incluido; las notas de crédito ya están restadas (van en negativo)',
        columnas: [
          { clave: 'llego', titulo: 'Llegó al correo (fecha y hora)', tipo: 'fechahora' },
          { clave: 'fecha', titulo: 'Fecha de emisión', tipo: 'fechahora', enPdf: false },
          { clave: 'prov', titulo: 'Proveedor', tipo: 'texto' },
          { clave: 'ced', titulo: 'Cédula del proveedor', tipo: 'texto' },
          { clave: 'tipo', titulo: 'Tipo de comprobante', tipo: 'texto' },
          { clave: 'cons', titulo: 'Consecutivo', tipo: 'texto' },
          { clave: 'total', titulo: 'Total con IVA (₡)', tipo: 'moneda' },
          { clave: 'iva', titulo: 'IVA pagado (₡)', tipo: 'moneda' },
          { clave: 'neto', titulo: 'Compra sin IVA (₡)', tipo: 'moneda' },
          { clave: 'resp', titulo: 'Respuesta a Hacienda', tipo: 'texto' },
          { clave: 'detalle', titulo: 'Detalle de la respuesta', tipo: 'texto', enPdf: false },
          { clave: 'limite', titulo: 'Fecha límite para responder', tipo: 'fecha' },
          { clave: 'dias', titulo: 'Días hábiles que quedan', tipo: 'numero', dec: 0, enPdf: false },
          { clave: 'avisos', titulo: 'Avisos', tipo: 'texto', enPdf: false },
          { clave: 'clave', titulo: 'Clave numérica (50 dígitos)', tipo: 'texto', enPdf: false }],
        filas: filas.map((f) => {
          const e = estadoFila(f); const sg = esNC(f.tipo) ? -1 : 1;
          return { llego: f.llego, fecha: f.fecha, prov: limpiarNombre(f.emisor_nombre), ced: f.emisor_cedula || '', tipo: nombreTipo(f.tipo) + (esNC(f.tipo) ? ' (resta)' : esND(f.tipo) ? ' (suma)' : ''), cons: f.consecutivo || '', total: sg * +f.total, iva: sg * +f.iva, neto: sg * +f.neto, resp: e.texto, detalle: e.sub || '', limite: f.pendiente && f.vence ? f.vence : '', dias: f.pendiente ? +f.dias_restantes : '', avisos: [f.aviso_buzon, f.lineas_aviso].filter(Boolean).join(' '), clave: f.clave || '' };
        }),
        // Regla única de redondeo (CONTRATO_CONTABLE.md 3.1): la fila Total es la cifra de la pantalla, no la suma de filas redondeadas
        totales: d.truncado ? { total: 'suma', iva: 'suma', neto: 'suma' } : { total: +r.total || 0, iva: +r.iva || 0, neto: +r.neto || 0 },
        notas,
      };
    }

    /* ---------- detalle ---------- */
    async function abrirDetalle(clave) {
      const cuerpo = h('div', h('p.cargando', 'Cargando la factura…'));
      const m = modal({ titulo: 'Factura de proveedor', contenido: cuerpo, ancho: 940, alCerrar: guardar });
      m.el.classList.add('rec-modal');
      m.el.parentElement.style.gridTemplateColumns = 'minmax(0, 1fr)'; // evita que una tabla ancha empuje la ventana fuera del celular
      await pintarDetalle(cuerpo, clave);
    }
    async function pintarDetalle(cuerpo, clave, aviso) {
      let d, guardada = null;
      try {
        const [a, b] = await Promise.allSettled([recibida(clave), respuestaGuardada(clave)]);
        if (a.status === 'rejected') throw a.reason;
        d = a.value; guardada = b.status === 'fulfilled' ? b.value : null;
      } catch (e) { cuerpo.replaceChildren(h('div.error-caja', 'No se pudo abrir la factura. ' + mensajeAmable(e, 'Revise la conexión e intente de nuevo.'))); return; }
      const f = d.factura, nota = esNC(f.tipo), sg = nota ? '−' : '';
      const e = estadoFila({ ...d, ...f, requiere: d.requiere, dias_restantes: d.dias_restantes });
      const dato = (t, v) => h('div.rec-dato', h('small', t), h('div', v));
      const moneda = f.moneda !== 'CRC';
      const lineas = d.lineas || [];
      const hacTxt = { '1': 'Aceptada por Hacienda', '2': 'Aceptada parcialmente por Hacienda', '3': d.hacienda_cuadra === false ? 'Llegó por correo un rechazo que no coincide con esta factura (sin verificar)' : 'Rechazada por Hacienda' }[d.hacienda_estado] || 'Sin respuesta de Hacienda en el correo';
      const avisos = [d.aviso_buzon, d.lineas_aviso, d.verificacion_nota, d.del_grupo ? 'La emitió la otra empresa del grupo: es una compra normal y hay que responderla.' : ''].filter(Boolean);
      const respuesta = h('div.rec-resp');
      pintarRespuesta(respuesta, d, guardada, clave, cuerpo, e);
      const desg = Array.isArray(d.desglose) ? d.desglose : [];
      cuerpo.replaceChildren(
        ...(aviso ? [h('div.' + (aviso.mal ? 'error-caja' : 'rec-ok'), aviso.texto || aviso)] : []),
        h('div.rec-detalle-cab', h('div', h('h2', nomProv(f.emisor_nombre)), h('p.tenue', `${nombreTipo(f.tipo)} · consecutivo ${f.consecutivo || 'sin dato'} · cédula del proveedor ${f.emisor_cedula || 'sin dato'}`)),
          h('div.fila', chipTipo(f.tipo), h('span.chip' + (e.clase ? '.' + e.clase : ''), e.texto),
            lineas.length ? crearDescarga(() => opcionesFactura(d, e), { texto: 'Descargar esta factura', etiqueta: 'Descargar las líneas de esta factura' }) : null)),
        avisos.length ? h('ul.rec-avisos-det', avisos.map((t) => h('li', t))) : null,
        h('div.rec-datos',
          dato('Emitida', fechaHora(f.fecha)), dato('Llegó al correo', fechaHora(f.llego)), dato('Correo', f.buzon || 'sin dato'),
          dato('Compra para', d.local ? d.local.nombre : (f.receptor_nombre || 'sin dato')), dato('Cédula del receptor', f.receptor_cedula || 'sin dato'), dato('Condición de venta', { '01': 'Contado', '02': 'Crédito' }[f.condicion_venta] || f.condicion_venta || 'sin dato'),
          dato('Respuesta de Hacienda al proveedor', hacTxt), moneda ? dato('Moneda', `${f.moneda}, tipo de cambio ${num(f.tipo_cambio, 5)}`) : null,
          d.credito && d.credito.texto ? dato('Crédito fiscal', d.credito.texto) : null,
          d.inventario && d.inventario.tiene_inventario ? dato('Inventarios', `${plural(+d.inventario.lineas_recibidas || 0, 'línea recibida', 'líneas recibidas')} en bodega`) : null),
        h('h3', 'Líneas de la factura'),
        lineas.length ? h('div.tabla-caja', h('table.tabla', h('thead', h('tr', h('th', '#'), h('th', 'Detalle'), h('th.der', 'Cantidad'), h('th.der', 'Precio unitario'), h('th.der', 'Sin IVA'), h('th.der', 'IVA'), h('th.der', 'Total'))),
          h('tbody', lineas.map((l) => h('tr', h('td', l.linea > 999 ? '' : l.linea), h('td', l.detalle || '', l.cabys ? h('small.tenue', ' CABYS ' + l.cabys) : null), h('td.der', { 'data-et': 'Cantidad' }, num(l.cantidad, 3)), h('td.der', { 'data-et': 'Precio' }, money(l.precio_unitario)), h('td.der', { 'data-et': 'Sin IVA' }, money(l.subtotal)), h('td.der', { 'data-et': 'IVA' }, money(l.impuesto)), h('td.der', { 'data-et': 'Total' }, money(l.total_linea)))))))
          : h('p.tenue', 'Esta factura no trae líneas guardadas.'),
        d.lineas_aviso ? h('p.lis-aviso', d.lineas_aviso) : null,
        desg.length ? h('details.rec-desglose', h('summary', 'Impuestos de la factura, por tarifa'),
          h('ul', desg.filter((x) => x.fuente === 'resumen' || !desg.some((y) => y.fuente === 'resumen')).map((x) => h('li', `${x.codigo_impuesto === '01' ? 'IVA' : 'Impuesto ' + (x.codigo_impuesto || 'sin código')}${x.tarifa != null ? ' ' + num(x.tarifa, 2) + ' %' : ''}: `, h('strong.cifra', montoTexto(x.neto ?? x.monto, f.moneda)), x.base != null ? ` sobre ${montoTexto(x.base, f.moneda)}` : '')))) : null,
        h('div.rec-totales',
          h('div', h('span', 'Compra sin IVA'), h('strong.cifra', sg + money(f.neto))),
          h('div', h('span', 'IVA soportado (IVA que se pagó al proveedor)'), h('strong.cifra', sg + money(f.iva))),
          h('div.total', h('span', nota ? 'Total de la nota de crédito (resta de lo que se debe)' : esND(f.tipo) ? 'Total de la nota de débito (se suma a lo que se debe)' : 'Total de la factura con IVA'), h('strong.cifra', sg + money(f.total))),
          moneda ? h('small.tenue', `Montos convertidos a colones. En ${f.moneda} el total es ${num(f.total_orig, 2)}.`) : null),
        respuesta,
        h('details.rec-tecnico', h('summary', 'Datos técnicos'), h('p.tenue', 'Clave numérica: ', h('code', f.clave)), (d.mensajes || []).map((x) => h('p.tenue', `${x.tipo} · estado ${x.estado || 'sin dato'} · ${x.recibido ? fechaHora(x.recibido) : ''}${x.detalle && x.detalle !== '.' ? ' · ' + x.detalle : ''}`))));
    }

    // Lo que se descarga de una factura abierta: sus líneas, con los totales que se ven abajo
    function opcionesFactura(d, e) {
      const f = d.factura, nota = esNC(f.tipo), sg = nota ? -1 : 1;
      const corto = f.consecutivo ? f.consecutivo.slice(-10).replace(/^0+(?=\d)/, '') : '';
      const nombreDoc = nota ? 'Nota de crédito de proveedor' : esND(f.tipo) ? 'Nota de débito de proveedor' : 'Factura de proveedor';
      return {
        nombre: `${nombreDoc} ${paraArchivo(limpiarNombre(f.emisor_nombre))} ${corto}`.replace(/\s+/g, ' ').trim(),
        empresa: nomLocal, cedula: soc?.cedula || '',
        titulo: nota ? 'Nota de crédito de un proveedor' : esND(f.tipo) ? 'Nota de débito de un proveedor' : 'Factura de un proveedor',
        subtitulo: `${limpiarNombre(f.emisor_nombre)} · ${nombreTipo(f.tipo)} · consecutivo ${f.consecutivo || 'sin dato'} · cédula del proveedor ${f.emisor_cedula || 'sin dato'} · emitida ${fechaHora(f.fecha)} · ${e.texto}`,
        cifras: 'brutas', cifrasNota: 'Montos del comprobante tal como vienen, en colones' + (f.moneda !== 'CRC' ? `; la factura está en ${f.moneda} y aquí se muestra convertida` : ''),
        columnas: [
          { clave: 'n', titulo: 'Línea', tipo: 'numero', dec: 0 }, { clave: 'det', titulo: 'Detalle', tipo: 'texto' }, { clave: 'cabys', titulo: 'CABYS', tipo: 'texto' },
          { clave: 'cant', titulo: 'Cantidad', tipo: 'numero', dec: 3 }, { clave: 'pu', titulo: 'Precio unitario (₡)', tipo: 'moneda', decMax: 5 },
          { clave: 'sub', titulo: 'Sin IVA (₡)', tipo: 'moneda' }, { clave: 'iva', titulo: 'IVA (₡)', tipo: 'moneda' }, { clave: 'tot', titulo: 'Total de la línea (₡)', tipo: 'moneda' }],
        filas: (d.lineas || []).map((l) => ({ n: l.linea > 999 ? '' : l.linea, det: l.detalle || '', cabys: l.cabys || '', cant: l.cantidad, pu: l.precio_unitario, sub: l.subtotal, iva: l.impuesto, tot: l.total_linea })),
        totales: { sub: sg * +f.neto, iva: sg * +f.iva, tot: sg * +f.total }, etiquetaTotal: nota ? 'Total de la nota de crédito' : esND(f.tipo) ? 'Total de la nota de débito' : 'Total de la factura',
        notas: [nota ? 'Los totales de una nota de crédito van en negativo: restan de lo que se debe.' : '', d.lineas_aviso || ''].filter(Boolean),
      };
    }

    /* ---------- respuesta a Hacienda ---------- */
    const textoRespuesta = { '1': 'Usted aceptó esta factura completa.', '2': 'Usted aceptó esta factura solo en parte.', '3': 'Usted rechazó esta factura.' };
    function pintarRespuesta(caja, d, guardada, clave, cuerpo, e) {
      caja.replaceChildren();
      const f = d.factura;
      const quien = `${esNC(f.tipo) ? 'la nota de crédito' : esND(f.tipo) ? 'la nota de débito' : 'la factura'} ${f.consecutivo ? f.consecutivo.slice(-10).replace(/^0+(?=\d)/, '') : ''} de ${nomProv(f.emisor_nombre)}`.replace(/\s+/g, ' ');
      if (d.propia) { caja.append(h('p.tenue', 'Este comprobante lo emitió esta misma empresa; no es una compra a un proveedor.')); return; }
      if (!d.requiere) { caja.append(h('h3', 'Respuesta a Hacienda'), h('p', 'Este tipo de comprobante no necesita que usted lo acepte ni lo rechace. Los tiquetes no sirven para usar el IVA como crédito fiscal: si lo necesita, pida al proveedor una factura electrónica a nombre de la empresa.')); return; }
      if (d.hacienda_estado === '3' && d.hacienda_cuadra !== false) { caja.append(h('h3', 'Respuesta a Hacienda'), h('p', 'Hacienda rechazó esta factura cuando el proveedor la envió, así que no tiene validez y no hay nada que responder. Espere la factura que la reemplace.')); return; }
      const g = guardada && guardada.estado_envio ? guardada : null;
      if (d.receptor_estado) {
        const t = textoRespuesta[d.receptor_estado];
        const procesando = d.receptor_envio === 'enviado';
        const btnConsulta = h('button.btn.grande', { type: 'button', onclick: tocable(() => conBoton(btnConsulta, async () => {
          const r = await consultarRespuesta(clave);
          await pintarDetalle(cuerpo, clave, avisoConsulta(r));
          if (vivo) cargar();
        })) }, 'Revisar si Hacienda ya la procesó');
        caja.append(...[h('h3', 'Respuesta a Hacienda'), h('p.rec-ok', t + (d.receptor_en ? ' El ' + fechaHora(d.receptor_en) + '.' : '')),
          g ? resumenGuardada(g, f) : null,
          d.receptor_estado === '2' ? h('p.lis-aviso', 'El proveedor tiene que emitir una nota de crédito por la parte que usted no aceptó. Cuando llegue, acéptela: así su IVA se resta del crédito fiscal.') : null,
          d.receptor_estado === '3' ? h('p.lis-aviso', 'El proveedor tiene que anular esta factura con una nota de crédito y, si corresponde, emitir una nueva.') : null,
          procesando ? h('p.tenue', 'Su respuesta llegó a Hacienda. Falta que Hacienda la confirme.') : h('p.tenue', d.receptor_envio === 'aceptado' ? 'Hacienda recibió y aceptó su respuesta.' : 'Su respuesta quedó guardada en este sistema.'),
          procesando ? btnConsulta : null].filter(Boolean));
        return;
      }
      const vencida = d.dias_restantes < 0;
      const err = h('div.error-caja', { hidden: true });
      const pruebas = app.soc && app.soc.ambiente && app.soc.ambiente !== 'produccion';
      // Intento anterior que no quedó (a): rechazado por Hacienda, no recibido o sin confirmar
      const env = d.receptor_envio, det = d.receptor_detalle || (g && g.respuesta_hacienda) || '';
      const previo = g ? ` (era: ${describirGuardada(g, f)})` : '';
      const avisoPrevio = env === 'rechazado' ? `Hacienda recibió la respuesta anterior${previo} y la rechazó${det ? ': ' + det : '.'} Hay que enviar una respuesta nueva.`
        : env === 'error' ? `Hacienda no recibió el intento anterior${previo}${det ? ': ' + det : '.'} Puede intentarlo de nuevo.`
        : env === 'pendiente' ? `Un intento anterior${previo} quedó sin confirmar: todavía no se sabe si llegó a Hacienda. Antes de enviar otra respuesta, el sistema le pregunta a Hacienda por el anterior.` : '';
      const btnRevisar = env === 'pendiente' || env === 'error' ? h('button.btn', { type: 'button', onclick: tocable(() => conBoton(btnRevisar, async () => { const r = await consultarRespuesta(clave); await pintarDetalle(cuerpo, clave, avisoConsulta(r)); if (vivo) cargar(); })) }, 'Revisar si el intento anterior llegó a Hacienda') : null;
      const bA = h('button.btn.primario.grande', { type: 'button', onclick: tocable(() => abrirRespuesta('aceptar')) }, 'Aceptar');
      const bP = h('button.btn.grande', { type: 'button', onclick: tocable(() => abrirRespuesta('parcial')) }, 'Aceptar parcialmente');
      const bR = h('button.btn.peligro.grande', { type: 'button', onclick: tocable(() => abrirRespuesta('rechazar')) }, 'Rechazar');
      const acciones = [bA, bP, bR];
      const enCamino = h('p.rec-en-camino', { hidden: true, 'aria-live': 'polite' }, 'Hay una respuesta de esta factura en camino a Hacienda. Espere el resultado antes de enviar otra.');
      const bloquear = (si) => { acciones.forEach((b) => { b.disabled = si; }); enCamino.hidden = !si; };
      caja.append(...[h('h3', 'Respuesta a Hacienda'),
        h('p.rec-plazo' + (vencida ? '.vencida' : ''), e.texto + (e.sub ? '. ' + e.sub : '') + '.', vencida ? ' Todavía puede intentar responder, pero el plazo ya pasó.' : ''),
        pruebas ? h('p.lis-aviso', 'El sistema está en modo de pruebas. Las respuestas a facturas reales de proveedores todavía no se envían a Hacienda: puede revisar lo que se enviaría, y el sistema le explica que no se envía nada.') : null,
        d.receptor_reportado ? h('p.lis-aviso', `Llegó por correo un aviso de que esta factura ya se ${({ '1': 'aceptó', '2': 'aceptó en parte', '3': 'rechazó' })[d.receptor_reportado] || 'respondió'} desde otro sistema${d.receptor_reportado_en ? ' el ' + fechaHora(d.receptor_reportado_en) : ''}. No está verificado. Si ya se respondió por otro medio, no la responda otra vez.`) : null,
        avisoPrevio ? h('p.lis-aviso' + (env === 'rechazado' ? '.mal' : ''), avisoPrevio) : null,
        btnRevisar,
        h('div.rec-acciones', ...acciones), enCamino,
        h('ul.rec-ayuda',
          h('li', h('strong', 'Aceptar: '), 'la compra llegó completa y la factura está correcta. Después se elige cómo se usa el IVA: todo como crédito fiscal, solo una parte, bien de capital o gasto.'),
          h('li', h('strong', 'Aceptar parcialmente: '), 'solo una parte de la compra está correcta (por ejemplo, llegó menos mercadería o un precio está mal). Se escribe el monto que sí acepta y el motivo; el proveedor tiene que hacer una nota de crédito por el resto.'),
          h('li', h('strong', 'Rechazar: '), 'la compra no es de la empresa o la factura está mal en todo. Se escribe el motivo; el proveedor tiene que anularla con una nota de crédito.')),
        err].filter(Boolean));

      /* ----- ventana de respuesta: 1) datos, 2) revisar lo que se enviará, 3) enviando, 4) resultado ----- */
      function abrirRespuesta(tipo) {
        let paso = 'datos', enviando = false, cerrada = false;
        const cuerpoV = h('div.rec-dlg');
        const titulos = { aceptar: 'Aceptar la factura', parcial: 'Aceptar parcialmente', rechazar: 'Rechazar la factura' };
        const m = modal({ titulo: titulos[tipo], contenido: cuerpoV, ancho: 600,
          bloqueo: () => (enviando ? 'Espere: la respuesta va en camino a Hacienda. No cierre esta ventana.' : ''),
          alCerrar: () => { cerrada = true; guardar(); if (!enviando) bloquear(false); } });
        m.el.classList.add('rec-modal', 'rec-dlg-modal');
        bloquear(true); enCamino.hidden = true; // mientras la ventana está abierta, los botones de abajo no se pueden tocar
        const total = moneda() ? +f.total_orig : +f.total, mon = f.moneda || 'CRC';
        const valores = { condicion: '01', proporcion: '', monto: '', motivo: '' };
        pintarDatos();

        function pie(...botones) { return h('div.rec-pie', ...botones); }
        function radioCondiciones(alCambiar) {
          const pct = h('input.campo.rec-pct', { type: 'number', min: '1', max: '99', step: '1', inputmode: 'numeric', placeholder: 'Por ejemplo: 50', value: valores.proporcion, 'aria-label': 'Porcentaje del IVA que se usa como crédito' });
          const pctTxt = h('small.tenue');
          const pctCaja = h('label.etq.rec-pct-caja', { hidden: valores.condicion !== '02' }, 'Porcentaje del IVA que sí se usa como crédito (de 1 a 99)', pct, pctTxt);
          const ivaF = moneda() ? +f.iva_orig : +f.iva;
          const verPct = () => { const v = Number(pct.value); valores.proporcion = pct.value; pctTxt.textContent = pct.value !== '' && v > 0 && v < 100 ? `Unos ${montoTexto(Math.round(ivaF * v) / 100, mon)} de los ${montoTexto(ivaF, mon)} de IVA de esta factura. El cálculo exacto se muestra antes de enviar.` : 'Escriba un número entre 1 y 99.'; alCambiar?.(); };
          pct.addEventListener('input', verPct); if (valores.proporcion !== '') verPct();
          const grupo = h('div.rec-opciones', { role: 'radiogroup', 'aria-label': 'Cómo se usa el IVA de esta compra' }, CONDICIONES.map((o) => {
            const r = h('input', { type: 'radio', name: 'cond-' + clave.slice(-8), value: o.c, checked: valores.condicion === o.c, onchange: () => { valores.condicion = o.c; pctCaja.hidden = o.c !== '02'; if (o.c === '02') pct.focus(); alCambiar?.(); } });
            return h('label.rec-opcion', r, h('span', h('strong', o.t), h('small', o.d)));
          }));
          return h('fieldset.rec-cond', h('legend', '¿Cómo se usa el IVA de esta compra?'), grupo, pctCaja);
        }
        function pintarDatos() {
          paso = 'datos';
          const aviso = h('div.error-caja', { hidden: true });
          const partes = [];
          if (tipo === 'aceptar') {
            partes.push(h('p', `Va a avisar a Hacienda que recibió conforme ${quien}, por ${montoTexto(total, mon)}.`), radioCondiciones());
          } else if (tipo === 'parcial') {
            const monto = h('input.campo', { type: 'text', inputmode: 'decimal', placeholder: 'Por ejemplo: 25000', value: valores.monto, 'aria-label': 'Monto que sí acepta, con IVA' });
            const ncTxt = h('small.tenue');
            const motivo = h('textarea.campo', { rows: 3, 'aria-label': 'Motivo: qué parte no acepta y por qué' }, valores.motivo);
            const cuenta = h('small.tenue');
            const leerMonto = () => { const t = String(monto.value).replace(/[₡\s]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'); const n = Number(t); return t !== '' && Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN; };
            const prefijo = () => { const n = leerMonto(); return `Se acepta ${montoTexto(Number.isFinite(n) ? n : 0, mon)} de ${montoTexto(total, mon)}. `; };
            const ver = () => {
              valores.monto = monto.value; valores.motivo = motivo.value;
              const n = leerMonto();
              ncTxt.textContent = Number.isFinite(n) && n > 0 && n < total ? `El proveedor tendrá que emitir una nota de crédito por ${montoTexto(total - n, mon)}.` : `Escriba un monto mayor que cero y menor que el total (${montoTexto(total, mon)}).`;
              const libre = 160 - largo(prefijo());
              const usado = largo(motivo.value.trim());
              cuenta.textContent = usado > libre ? `El motivo es muy largo: Hacienda recibirá solo las primeras ${libre} letras.` : `Quedan ${libre - usado} letras. Hacienda recibirá: «${prefijo()}${motivo.value.trim() || '…'}».`;
            };
            monto.addEventListener('input', ver); motivo.addEventListener('input', ver); ver();
            partes.push(h('p', `Use esta opción si solo una parte de ${quien} es correcta. El total es ${montoTexto(total, mon)}.`),
              h('label.etq', `Monto que sí acepta, con IVA${mon !== 'CRC' ? ' (en ' + mon + ', la moneda de la factura)' : ''}`, monto, ncTxt),
              h('label.etq', 'Motivo: qué parte no acepta y por qué', motivo, cuenta),
              radioCondiciones());
            valores._leer = leerMonto;
          } else {
            const motivo = h('textarea.campo', { rows: 3, 'aria-label': 'Motivo del rechazo' }, valores.motivo);
            const cuenta = h('small.tenue');
            const ver = () => { valores.motivo = motivo.value; const u = largo(motivo.value.trim()); cuenta.textContent = u > 160 ? 'El motivo es muy largo: máximo 160 letras.' : `Hacienda lo recibe junto con la respuesta. Quedan ${160 - u} letras.`; };
            motivo.addEventListener('input', ver); ver();
            partes.push(h('p', `Va a avisar a Hacienda que NO acepta ${quien}.`), h('label.etq', 'Motivo: por qué rechaza esta factura', motivo, cuenta));
            if (d.inventario && d.inventario.tiene_inventario) partes.push(h('p.lis-aviso', `Esta factura ya tiene ${plural(+d.inventario.lineas_recibidas || 0, 'línea recibida', 'líneas recibidas')} en Inventarios. Si la rechaza, revise también la bodega.`));
          }
          const bRev = h('button.btn.primario', { type: 'button' }, 'Revisar antes de enviar');
          bRev.addEventListener('click', () => conBoton(bRev, async () => {
            aviso.hidden = true;
            const extra = {};
            let motivo = String(valores.motivo || '').trim();
            if (tipo !== 'rechazar') {
              extra.condicion_impuesto = valores.condicion;
              if (valores.condicion === '02') { const v = Number(valores.proporcion); if (valores.proporcion === '' || !(v > 0 && v < 100)) return mal('Escriba el porcentaje del IVA que sí se usa como crédito: un número entre 1 y 99.'); extra.proporcion = v; }
            }
            if (tipo === 'parcial') {
              const n = valores._leer();
              if (!(Number.isFinite(n) && n > 0 && n < total)) return mal(`Escriba el monto que sí acepta: más de cero y menos que el total (${montoTexto(total, mon)}).`);
              if (largo(motivo) < 5) return mal('Escriba el motivo con un poco más de detalle (al menos 5 letras).');
              extra.monto_aceptado = n;
              const libre = 160 - largo(`Se acepta ${montoTexto(n, mon)} de ${montoTexto(total, mon)}. `);
              motivo = Array.from(motivo).slice(0, libre).join('');
            }
            if (tipo === 'rechazar') { if (largo(motivo) < 5) return mal('Escriba el motivo del rechazo con un poco más de detalle (al menos 5 letras).'); if (largo(motivo) > 160) return mal('El motivo es muy largo: máximo 160 letras.'); }
            let c;
            try { c = await calcularRespuesta(clave, tipo, motivo, extra); } catch (ex) { return mal(mensajeAmable(ex, 'No se pudo revisar la respuesta. Intente de nuevo.')); }
            if (cerrada) return;
            pintarConfirmacion(c, motivo, extra);
          }));
          const bNo = h('button.btn', { type: 'button', onclick: () => m.cerrar() }, 'Cancelar');
          function mal(t) { aviso.textContent = t; aviso.hidden = false; aviso.scrollIntoView({ block: 'nearest' }); }
          cuerpoV.replaceChildren(...partes, aviso, pie(bNo, bRev));
        }
        function pintarConfirmacion(r, motivo, extra) {
          paso = 'revisar';
          const c = r.calculo || {}, cm = c.moneda || mon;
          const nombreMensaje = { 1: 'Aceptación de la factura completa (mensaje 1)', 2: 'Aceptación parcial (mensaje 2)', 3: 'Rechazo de la factura (mensaje 3)' }[c.mensaje] || 'Respuesta';
          const filaC = (t, v, cls = '') => h('div.rec-conf-fila' + cls, h('span', t), h('strong.cifra', v));
          const notas = [];
          if (+c.iva_devuelto > 0) notas.push(`Esta factura trae ${montoTexto(c.iva_devuelto, cm)} de IVA devuelto (servicios de salud pagados con tarjeta): ese IVA no se acredita.`);
          if (+c.otros_impuestos > 0) notas.push(`Trae ${montoTexto(c.otros_impuestos, cm)} de impuestos que no son IVA (por ejemplo selectivo de consumo o combustibles): no se acreditan y van al gasto.`);
          if (c.con_xml === false && c.mensaje !== 3) notas.push('No se encontró el desglose de impuestos de esta factura: el cálculo toma todo el impuesto como IVA.');
          if (esNC(f.tipo) && c.mensaje !== 3) notas.push('Es una nota de crédito: al aceptarla, este IVA se resta del crédito fiscal del mes.');
          if (esND(f.tipo) && c.mensaje !== 3) notas.push('Es una nota de débito: al aceptarla, este IVA se suma al crédito fiscal del mes.');
          if (cm !== 'CRC') notas.push(`Los montos van en ${cm}, la moneda de la factura${c.tipo_cambio ? `, con tipo de cambio ${num(c.tipo_cambio, 5)}` : ''}.`);
          const p = r.previa;
          if (p && p.estado == null) notas.push('Llegó por correo un aviso de que esta factura ya se respondió desde otro sistema (sin verificar). Si ya se respondió, no la envíe otra vez.');
          else if (p && ['pendiente', 'error'].includes(p.estado)) notas.push(`Hay un intento anterior sin confirmar («${p.descripcion}»). Antes de enviar, el sistema le pregunta a Hacienda si llegó; si llegó, no se envía esta.`);
          else if (p && p.estado === 'rechazado') notas.push('Hacienda rechazó la respuesta anterior: esta sale como una respuesta nueva.');
          const bloques = [
            h('p.rec-conf-intro', 'Revise con calma. Esto es exactamente lo que recibirá Hacienda:'),
            h('div.rec-conf',
              filaC('Respuesta', nombreMensaje),
              c.mensaje === 2 ? filaC('Parte que acepta', `${montoTexto(c.monto_aceptado, cm)} de ${montoTexto(c.total, cm)}`) : null,
              c.mensaje === 2 ? filaC('Nota de crédito que debe emitir el proveedor', montoTexto(c.nota_credito, cm), '.aviso') : null,
              c.mensaje !== 3 ? filaC('Cómo se usa el IVA', (TEXTO_CONDICION[c.condicion] || c.condicion_texto || '') + (c.condicion === '02' && c.proporcion != null ? ` (${num(c.proporcion, 2)} %)` : '')) : null,
              filaC('IVA que se acreditará', montoTexto(c.mensaje === 3 ? 0 : c.acreditar, cm), '.grande'),
              filaC('Gasto que se registra', montoTexto(c.mensaje === 3 ? 0 : c.gasto, cm)),
              filaC('IVA de la factura', montoTexto(c.impuesto, cm)),
              h('div.rec-conf-det', h('span', 'Texto que recibe Hacienda'), h('q', c.detalle || ''))),
            c.mensaje === 3 ? h('p.tenue', 'Con un rechazo no se acredita IVA ni se registra gasto con esta factura. El proveedor tiene que anularla con una nota de crédito.') : null,
            c.mensaje === 2 ? h('p.tenue', 'El IVA y el gasto se registran por la factura completa; cuando llegue la nota de crédito del proveedor y la acepte, su IVA se resta. Así queda el monto real de la compra.') : null,
            notas.length ? h('ul.rec-conf-notas', notas.map((t) => h('li', t))) : null];
          if (!r.se_puede_enviar) {
            cuerpoV.replaceChildren(...bloques, h('div.lis-aviso.rec-bloqueo', h('strong', 'Todavía no se puede enviar. '), r.bloqueo || ''), pie(h('button.btn', { type: 'button', onclick: () => pintarDatos() }, 'Volver a cambiar'), h('button.btn.primario', { type: 'button', onclick: () => m.cerrar() }, 'Entendido, cerrar')));
            return;
          }
          const bSi = h('button.btn.' + (c.mensaje === 3 ? 'peligro' : 'primario'), { type: 'button' }, c.mensaje === 3 ? 'Sí, enviar el rechazo a Hacienda' : 'Sí, enviar a Hacienda');
          const bNo = h('button.btn', { type: 'button', onclick: () => { if (!enviando) pintarDatos(); } }, 'No, volver a cambiar');
          // Un segundo toque del mismo dedo (doble toque sobre «Revisar antes de enviar») no cuenta como «Sí, enviar»: el botón espera un momento antes de aceptar toques
          const listoEn = Date.now() + 800;
          bSi.addEventListener('click', () => { if (enviando || paso !== 'revisar' || Date.now() < listoEn) return; enviar(c, motivo, extra, bSi, bNo); });
          cuerpoV.replaceChildren(...bloques, pie(bNo, bSi));
          bSi.focus({ preventScroll: true });
        }
        async function enviar(c, motivo, extra, bSi, bNo) {
          enviando = true; paso = 'enviando';
          bSi.disabled = true; bNo.disabled = true; bSi.textContent = 'Enviando a Hacienda…';
          const espera = h('p.rec-enviando', { 'aria-live': 'polite' }, 'Enviando la respuesta a Hacienda. Puede tardar unos segundos; no cierre esta ventana.');
          cuerpoV.append(espera);
          let r = null, fallo = null;
          try { r = await responder(clave, tipo, motivo, { ...extra, esperado: c.mensaje === 3 ? undefined : { acreditar: c.acreditar, gasto: c.gasto } }); } catch (ex) { fallo = ex; }
          enviando = false;
          const res = resultado(r, fallo, c);
          if (vivo) cargar();
          if (cerrada) return;
          paso = 'resultado';
          const bCerrar = h('button.btn.primario', { type: 'button', onclick: () => m.cerrar() }, 'Cerrar');
          cuerpoV.replaceChildren(h('div.' + (res.mal ? 'error-caja' : 'rec-ok'), res.texto), res.extra ? h('p.tenue', res.extra) : null, pie(res.reintentar ? h('button.btn', { type: 'button', onclick: () => pintarDatos() }, 'Volver a la respuesta') : null, bCerrar));
          bCerrar.focus({ preventScroll: true });
          // la factura de abajo se vuelve a pintar con lo que quedó (los botones de respuesta desaparecen si ya se respondió)
          pintarDetalle(cuerpo, clave, res.mal ? null : { texto: res.texto });
        }
      }
      function moneda() { return f.moneda && f.moneda !== 'CRC' && f.total_orig != null; }
    }
    // Texto del resultado de un envío, en palabras
    function resultado(r, fallo, c) {
      if (fallo) return { mal: true, texto: (fallo.message || String(fallo)), extra: /no se envió|no se perdió/i.test(fallo.message || '') ? '' : 'Revise el mensaje. Si dice que no se envió nada, puede corregir y volver a intentar.', reintentar: true };
      const desc = r.enviado?.descripcion || c?.descripcion || '';
      if (r.estado === 'rechazado') return { mal: true, texto: 'Hacienda revisó su respuesta y no la aceptó' + (r.detalle ? ': ' + r.detalle : '.') + ' Tiene que enviar una respuesta nueva.', reintentar: true };
      if (r.estado === 'aceptado') return { texto: `Hacienda recibió y aceptó su respuesta: «${desc}».`, extra: r.reenvio ? 'Era la misma respuesta de un intento anterior; no se gastó otro número.' : '' };
      if (r.estado === 'enviado') return { texto: `Su respuesta llegó a Hacienda: «${desc}». Falta que Hacienda la confirme; vuelva a abrir esta factura en un momento para ver el resultado.` };
      return { mal: true, texto: r.error || 'Hacienda no respondió. Vuelva a intentar en un momento; no se perdió nada.', reintentar: true };
    }
    // Lo que dijo Hacienda al consultar (a): el rechazo no se esconde
    function avisoConsulta(r) {
      if (r.estado === 'aceptado') return { texto: 'Hacienda recibió y aceptó su respuesta.' };
      if (r.estado === 'rechazado') return { mal: true, texto: 'Hacienda revisó su respuesta y la rechazó' + (r.detalle ? ': ' + r.detalle : '.') + ' Tiene que enviar una respuesta nueva desde esta misma ventana.' };
      if (r.estado === 'enviado') return { texto: 'Su respuesta llegó a Hacienda y todavía está en revisión. Vuelva a revisar en un momento.' };
      return { mal: true, texto: r.detalle || 'Hacienda todavía no tiene esta respuesta. Puede volver a responder la factura.' };
    }
    function describirGuardada(g, f) {
      const mon = f.moneda || 'CRC';
      const n = String(g.estado_mensaje || ''), base = n === '1' ? 'Aceptar' : n === '2' ? 'Aceptar parcialmente' : n === '3' ? 'Rechazar' : 'Respuesta';
      if (n === '3' || !g.condicion_impuesto) return base;
      const t = TEXTO_CONDICION[g.condicion_impuesto] || '';
      return `${base}, ${t.charAt(0).toLowerCase() + t.slice(1)}, IVA ${montoTexto(+g.monto_acreditar || 0, mon)}`;
    }
    function resumenGuardada(g, f) {
      const mon = f.moneda || 'CRC', n = String(g.estado_mensaje || '');
      const dd = (t, v) => (v == null || v === '' ? null : h('div.rec-conf-fila', h('span', t), h('strong.cifra', v)));
      return h('div.rec-conf.rec-guardada',
        n !== '3' && g.condicion_impuesto ? dd('Cómo se usa el IVA', TEXTO_CONDICION[g.condicion_impuesto] || g.condicion_impuesto) : null,
        n !== '3' && g.monto_acreditar != null ? dd('IVA acreditado', montoTexto(+g.monto_acreditar, mon)) : null,
        n !== '3' && g.monto_gasto != null ? dd('Gasto registrado', montoTexto(+g.monto_gasto, mon)) : null,
        g.detalle_mensaje ? h('div.rec-conf-det', h('span', 'Texto que recibió Hacienda'), h('q', g.detalle_mensaje)) : null,
        dd('Número del mensaje', g.consecutivo_receptor || null));
    }

    /* ---------- IVA del mes (fx_iva_mes y fx_iva_mes_detalle) ---------- */
    async function cargarIva() {
      const mia = ++ficha;
      [buscarCaja, rotulo, resumen, lista, periodoCaja, vencFiltro].forEach((x) => { x.hidden = true; });
      ivaCaja.hidden = false; pintarTabs();
      const mesCaja = selectorMes();
      ivaCaja.replaceChildren(mesCaja, h('p.cargando', 'Calculando el IVA del mes…'));
      try {
        const d = await ivaMes(soc.id, est.mes + '-01');
        if (mia !== ficha || !vivo) return;
        est.iva = d;
        ivaCaja.replaceChildren(mesCaja, ...pintarIva(d));
      } catch (e) {
        if (mia !== ficha) return;
        const noHay = /fx_iva_mes|function|does not exist|no existe|schema cache/i.test(String(e?.message || ''));
        ivaCaja.replaceChildren(mesCaja, h('div.vacio', h('p', noHay ? 'El cálculo del IVA del mes todavía no está activado en el sistema.' : 'No se pudo calcular el IVA del mes.'), h('p.tenue', noHay ? 'Las facturas y sus respuestas se siguen viendo en las otras pestañas.' : mensajeAmable(e, 'Revise la conexión e intente de nuevo.')), h('button.btn', { type: 'button', onclick: () => cargar() }, 'Intentar de nuevo')));
      }
    }
    function selectorMes() {
      const hoy = hoyCR(), este = mesDe(hoy), pasado = mesDe(sumaDias(este + '-01', -1));
      const otro = h('input.campo', { type: 'month', value: est.mes, max: este, 'aria-label': 'Otro mes' });
      const b = (m, t) => h('button.btn.per-btn', { type: 'button', 'aria-pressed': String(est.mes === m), onclick: tocable(() => { est.mes = m; cargar(); }) }, t);
      return h('div.tarjeta.rec-mes', h('div.per-botones', { role: 'group', 'aria-label': 'Mes' }, b(este, 'Este mes'), b(pasado, 'Mes pasado')),
        h('div.rec-mes-otro', h('label.etq', 'Otro mes', otro), h('button.btn', { type: 'button', onclick: () => { if (/^\d{4}-\d{2}$/.test(otro.value) && otro.value <= este) { est.mes = otro.value; cargar(); } else toast('Escoja un mes que ya haya empezado.', 'error'); } }, 'Ver ese mes')));
    }
    function pintarIva(d) {
      const db = d.debito || {}, cr = d.credito || {}, ne = d.neto || {};
      const mesTxt = nombreMes(d.mes || est.mes);
      const verBtn = (lado, grupo, titulo) => h('button.btn.chico', { type: 'button', onclick: tocable(() => verDetalleIva(lado, grupo, titulo)) }, 'Ver comprobantes');
      const tablaT = (cols, filas) => h('div.tabla-caja', h('table.tabla.rec-iva-tabla', h('thead', h('tr', cols.map((c) => h('th' + (c.der ? '.der' : ''), c.t)))), h('tbody', filas)));
      const sinConf = cr.sin_confirmar || {};
      const pruebas = d.ambiente && d.ambiente !== 'produccion';
      return [
        h('p.rec-rotulo', `IVA de ${mesTxt}: el que se cobró en las ventas (débito fiscal) y el de las compras a proveedores que se puede acreditar (crédito fiscal). Montos en colones; las notas de crédito restan.`),
        pruebas || d.ventas_de_prueba ? h('p.lis-aviso', 'El sistema está en modo de pruebas: las ventas de este mes son de prueba y no van en la declaración real.') : null,
        h('div.rejilla.rec-iva-kpis',
          kpi('IVA cobrado en ventas', money(db.iva || 0), `Débito fiscal: ${plural(+db.n_docs || 0, 'comprobante', 'comprobantes')} de ${mesTxt}.`),
          kpi('IVA de compras que se acredita', money(cr.iva_acreditable || 0), `Crédito fiscal: ${plural(+cr.n_docs || 0, 'factura aceptada', 'facturas aceptadas')}.`),
          kpi(+ne.a_favor > 0 ? 'Saldo a favor' : 'Diferencia a pagar', money(+ne.a_favor > 0 ? ne.a_favor : (ne.a_pagar ?? ne.diferencia ?? 0)), ne.texto || 'Débito menos crédito.', +ne.a_pagar > 0 ? 'alerta' : '')),
        sinConf.n_docs ? h('div.lis-aviso.rec-sin-conf', h('span', sinConf.texto || `${plural(+sinConf.n_docs, 'factura', 'facturas')} sin aceptar: su IVA (${money(sinConf.iva_acreditable || 0)}) todavía no se acredita.`), h('button.btn.chico', { type: 'button', onclick: tocable(() => irA('pendientes')) }, 'Ver las pendientes')) : null,
        h('div.fila.sep.rec-iva-desc', h('h3', 'IVA cobrado en ventas, por tarifa'), crearDescarga(() => opcionesIva(d), { texto: 'Descargar el IVA del mes', etiqueta: 'Descargar el IVA del mes con el detalle de cada comprobante' })),
        (db.por_tarifa || []).length ? tablaT([{ t: 'Tarifa' }, { t: 'Base', der: 1 }, { t: 'IVA', der: 1 }, { t: 'Comprobantes', der: 1 }, { t: '' }],
          (db.por_tarifa || []).map((x) => h('tr', h('td', x.descripcion || `${num(x.tarifa, 2)} %`), h('td.der', { 'data-et': 'Base' }, money(x.base)), h('td.der', { 'data-et': 'IVA' }, money(x.iva)), h('td.der', { 'data-et': 'Comprobantes' }, num(x.n_docs || 0, 0)), h('td', x.ref ? verBtn(x.ref.lado, x.ref.grupo, `Ventas: ${x.descripcion || num(x.tarifa, 2) + ' %'}`) : null))))
          : h('p.tenue', 'No hay ventas con IVA en este mes.'),
        h('h3', 'IVA de compras a proveedores, por tarifa'),
        (cr.por_tarifa || []).length ? tablaT([{ t: 'Tarifa' }, { t: 'Base', der: 1 }, { t: 'IVA de las facturas', der: 1 }, { t: 'IVA que se acredita', der: 1 }, { t: 'Facturas', der: 1 }, { t: '' }],
          (cr.por_tarifa || []).map((x) => h('tr', h('td', x.descripcion || `${num(x.tarifa, 2)} %`), h('td.der', { 'data-et': 'Base' }, money(x.base)), h('td.der', { 'data-et': 'IVA facturas' }, money(x.iva_comprobantes)), h('td.der', { 'data-et': 'Se acredita' }, money(x.iva_acreditable)), h('td.der', { 'data-et': 'Facturas' }, num(x.n_docs || 0, 0)), h('td', x.ref ? verBtn(x.ref.lado, x.ref.grupo, `Compras: ${x.descripcion || num(x.tarifa, 2) + ' %'}`) : null))))
          : h('p.tenue', 'No hay compras aceptadas con IVA en este mes.'),
        (cr.por_condicion || []).length ? h('ul.rec-iva-cond', (cr.por_condicion || []).map((x) => h('li', h('span', x.texto || TEXTO_CONDICION[x.condicion] || x.condicion), h('strong.cifra', money(x.iva_acreditable))))) : null,
        (+cr.gasto_sin_credito > 0 || +cr.otros_impuestos > 0) ? h('p.tenue', [+cr.gasto_sin_credito > 0 ? `IVA que va al gasto (no se acredita): ${money(cr.gasto_sin_credito)}.` : '', +cr.otros_impuestos > 0 ? `Impuestos que no son IVA: ${money(cr.otros_impuestos)}.` : ''].filter(Boolean).join(' ')) : null,
        excluidos('Ventas que no entran en el débito', db.excluidos),
        excluidos('Compras que no entran en el crédito', cr.excluidos),
        (d.decisiones_contador || []).length ? h('details.rec-tecnico', h('summary', 'Para revisar con la contadora'), h('ul', d.decisiones_contador.map((t) => h('li', String(t))))) : null,
        (d.reglas || []).length ? h('details.rec-tecnico', h('summary', 'Cómo se calcula'), h('ul', d.reglas.map((x) => h('li', String(x.regla || ''), x.fuente ? h('small.tenue', ' (' + x.fuente + ')') : null))), d.redondeo ? h('p.tenue', String(d.redondeo)) : null) : null,
      ].filter(Boolean);
      function excluidos(titulo, l) {
        if (!Array.isArray(l) || !l.length) return null;
        return h('div.rec-excl', h('h3', titulo), h('ul', l.map((x) => h('li', h('span', x.texto || x.motivo, ` (${plural(+x.n_docs || 0, 'comprobante', 'comprobantes')}${x.iva != null ? ', IVA ' + money(x.iva) : ''})`), x.ref ? verBtn(x.ref.lado, x.ref.grupo, titulo + ': ' + (x.texto || x.motivo)) : null))));
      }
    }
    async function verDetalleIva(lado, grupo, titulo) {
      const cuerpo = h('div', h('p.cargando', 'Cargando los comprobantes…'));
      const m = modal({ titulo, contenido: cuerpo, ancho: 980, alCerrar: guardar });
      m.el.classList.add('rec-modal');
      m.el.parentElement.style.gridTemplateColumns = 'minmax(0, 1fr)';
      try {
        const r = await ivaMesDetalle(soc.id, est.mes + '-01', lado, grupo);
        const fs = [...(r.filas || [])].sort((a, b) => String(a.fecha_emision).localeCompare(String(b.fecha_emision)));
        const credito = String(lado).includes('credito');
        const t = r.totales || {};
        cuerpo.replaceChildren(
          h('div.fila.sep', h('p.tenue', `${plural(r.n ?? fs.length, 'comprobante', 'comprobantes')} de ${nombreMes(est.mes)}, del más antiguo al más reciente.${credito ? ' Toque una factura para abrirla.' : ''}`),
            crearDescarga(() => opcionesDetalleIva(fs, titulo, lado, t), { texto: 'Descargar', etiqueta: 'Descargar estos comprobantes' })),
          h('div.rec-iva-tot', h('span', 'Base: ', h('strong.cifra', money(t.base || 0))), h('span', 'IVA: ', h('strong.cifra', money(t.iva || 0))), credito ? h('span', 'Se acredita: ', h('strong.cifra', money(t.iva_acreditable || 0))) : null),
          fs.length ? h('div.rec-iva-lista', fs.map((x) => {
            const cont = [h('span.rec-fecha', h('strong', diaSemanaCR(x.fecha_emision)), h('small', horaCorta(x.fecha_emision))),
              h('span.rec-prov', h('strong', nomProv(x.contraparte_nombre || 'Sin nombre')), h('small', `${nombreTipo(x.tipo)}${x.consecutivo ? ' · ' + String(x.consecutivo).slice(-10) : ''}${x.contraparte_cedula ? ' · cédula ' + x.contraparte_cedula : ''}${x.respuesta ? ' · ' + x.respuesta : ''}`), chipTipo(x.tipo)),
              h('span.rec-monto.der', h('small.rec-et', 'IVA'), money((+x.signo || 1) * (+x.iva || 0))),
              credito ? h('span.rec-monto.der', h('small.rec-et', 'Se acredita'), money((+x.signo || 1) * (+x.iva_acreditable || 0))) : h('span')];
            return credito && x.clave ? h('button.rec-fila.rec-fila-iva', { type: 'button', onclick: tocable(() => abrirDetalle(x.clave)) }, ...cont) : h('div.rec-fila.rec-fila-iva', ...cont);
          })) : h('p.vacio', 'No hay comprobantes en este grupo.'),
          r.truncado ? h('p.lis-aviso', 'La lista es muy larga y se cortó. La descarga del IVA del mes trae todos.') : null);
      } catch (e) { cuerpo.replaceChildren(h('div.error-caja', 'No se pudo traer el detalle. ' + mensajeAmable(e, 'Intente de nuevo en un momento.'))); }
    }
    const COLS_DETALLE = [
      { clave: 'fecha', titulo: 'Fecha de emisión', tipo: 'fechahora' }, { clave: 'lado', titulo: 'Lado', tipo: 'texto' }, { clave: 'nombre', titulo: 'Cliente o proveedor', tipo: 'texto' },
      { clave: 'ced', titulo: 'Cédula', tipo: 'texto' }, { clave: 'tipo', titulo: 'Tipo de comprobante', tipo: 'texto' }, { clave: 'cons', titulo: 'Consecutivo', tipo: 'texto' },
      { clave: 'tarifa', titulo: 'Tarifa (%)', tipo: 'numero', dec: 2 }, { clave: 'base', titulo: 'Base (₡)', tipo: 'moneda' }, { clave: 'iva', titulo: 'IVA (₡)', tipo: 'moneda' },
      { clave: 'acr', titulo: 'IVA que se acredita (₡)', tipo: 'moneda' }, { clave: 'cond', titulo: 'Condición del IVA', tipo: 'texto', enPdf: false }, { clave: 'resp', titulo: 'Respuesta', tipo: 'texto', enPdf: false },
      { clave: 'motivo', titulo: 'Por qué no entra', tipo: 'texto', enPdf: false }, { clave: 'clave', titulo: 'Clave numérica (50 dígitos)', tipo: 'texto', enPdf: false }];
    const LADOS = { debito: 'Venta (débito)', credito: 'Compra (crédito)', excluido_debito: 'Venta que no entra', excluido_credito: 'Compra que no entra' };
    const filaDetalle = (x) => { const s = +x.signo || 1; return { fecha: x.fecha_emision, lado: LADOS[x.lado] || x.lado || '', nombre: x.contraparte_nombre || '', ced: x.contraparte_cedula || '', tipo: nombreTipo(x.tipo), cons: x.consecutivo || '', tarifa: x.tarifa ?? '', base: s * (+x.base || 0), iva: s * (+x.iva || 0), acr: x.iva_acreditable == null ? '' : s * (+x.iva_acreditable || 0), cond: x.condicion_impuesto ? (TEXTO_CONDICION[x.condicion_impuesto] || x.condicion_impuesto) : '', resp: x.respuesta || '', motivo: x.motivo || '', clave: x.clave || '' }; };
    function opcionesDetalleIva(fs, titulo, lado, t) {
      return {
        nombre: `IVA ${nombreMes(est.mes)} ${paraArchivo(titulo, 40)}`.replace(/\s+/g, ' ').trim(), empresa: nomLocal, cedula: soc?.cedula || '',
        titulo: `IVA de ${nombreMes(est.mes)}`, subtitulo: titulo, cifras: 'netas', cifrasNota: 'Montos en colones; las notas de crédito restan',
        columnas: COLS_DETALLE, filas: fs.map(filaDetalle),
        totales: { base: +t.base || 0, iva: +t.iva || 0, ...(String(lado).includes('credito') ? { acr: +t.iva_acreditable || 0 } : {}) },
        notas: ['Ordenado del comprobante más antiguo al más reciente.', 'La fila Total sale de sumar los montos exactos y redondear una sola vez.'],
      };
    }
    // Descarga del IVA del mes: resumen por tarifa (débito y crédito), lo que no entra y el detalle de cada comprobante (se pide al bajar)
    async function opcionesIva(d) {
      const mesTxt = nombreMes(d.mes || est.mes), db = d.debito || {}, cr = d.credito || {}, ne = d.neto || {};
      const det = await ivaMesDetalle(soc.id, est.mes + '-01', 'todo', null);
      const fs = [...(det.filas || [])].sort((a, b) => String(a.fecha_emision).localeCompare(String(b.fecha_emision)));
      const base = { empresa: nomLocal, cedula: soc?.cedula || '', cifras: 'netas', cifrasNota: 'Montos en colones; las notas de crédito restan' };
      return {
        nombre: `IVA del mes ${mesTxt}`, ...base, titulo: `IVA de ${mesTxt}`,
        hojas: [
          { hoja: 'Resumen', titulo: `IVA de ${mesTxt}: resumen`, subtitulo: ne.texto || '', ...base,
            columnas: [{ clave: 'que', titulo: 'Concepto', tipo: 'texto' }, { clave: 'monto', titulo: 'Monto (₡)', tipo: 'moneda' }],
            filas: [{ que: 'IVA cobrado en ventas (débito fiscal)', monto: +db.iva || 0 }, { que: 'IVA de compras que se acredita (crédito fiscal)', monto: +cr.iva_acreditable || 0 }, { que: 'IVA de las facturas de compra (sin importar si se acredita)', monto: +cr.iva_comprobantes || 0 }, { que: 'IVA que va al gasto (no se acredita)', monto: +cr.gasto_sin_credito || 0 }, { que: 'Impuestos de compras que no son IVA', monto: +cr.otros_impuestos || 0 }, { que: +ne.a_favor > 0 ? 'Saldo a favor' : 'Diferencia a pagar', monto: +ne.a_favor > 0 ? +ne.a_favor : +(ne.a_pagar ?? ne.diferencia ?? 0) }],
            notas: [...(d.decisiones_contador || []).map(String), d.redondeo ? String(d.redondeo) : ''].filter(Boolean) },
          { hoja: 'Ventas por tarifa', titulo: 'IVA cobrado en ventas, por tarifa', ...base,
            columnas: [{ clave: 'tar', titulo: 'Tarifa', tipo: 'texto' }, { clave: 'base', titulo: 'Base (₡)', tipo: 'moneda' }, { clave: 'iva', titulo: 'IVA (₡)', tipo: 'moneda' }, { clave: 'n', titulo: 'Comprobantes', tipo: 'numero', dec: 0 }],
            filas: (db.por_tarifa || []).map((x) => ({ tar: x.descripcion || `${num(x.tarifa, 2)} %`, base: +x.base || 0, iva: +x.iva || 0, n: +x.n_docs || 0 })), totales: { base: +db.base_gravada || 'suma', iva: +db.iva || 0, n: +db.n_docs || 'suma' } },
          { hoja: 'Compras por tarifa', titulo: 'IVA de compras a proveedores, por tarifa', ...base,
            columnas: [{ clave: 'tar', titulo: 'Tarifa', tipo: 'texto' }, { clave: 'base', titulo: 'Base (₡)', tipo: 'moneda' }, { clave: 'ivac', titulo: 'IVA de las facturas (₡)', tipo: 'moneda' }, { clave: 'acr', titulo: 'IVA que se acredita (₡)', tipo: 'moneda' }, { clave: 'n', titulo: 'Facturas', tipo: 'numero', dec: 0 }],
            filas: (cr.por_tarifa || []).map((x) => ({ tar: x.descripcion || `${num(x.tarifa, 2)} %`, base: +x.base || 0, ivac: +x.iva_comprobantes || 0, acr: +x.iva_acreditable || 0, n: +x.n_docs || 0 })), totales: { ivac: +cr.iva_comprobantes || 0, acr: +cr.iva_acreditable || 0, n: +cr.n_docs || 'suma' } },
          { hoja: 'Detalle', titulo: 'Cada comprobante del mes', subtitulo: 'Ventas, compras y lo que no entra, del más antiguo al más reciente', ...base,
            columnas: COLS_DETALLE, filas: fs.map(filaDetalle), notas: det.truncado ? ['El detalle trae los primeros 20 000 comprobantes.'] : [] },
        ],
      };
    }

    cargar();
    cargarAvisos();
    return () => { vivo = false; ficha++; };
  },
};
