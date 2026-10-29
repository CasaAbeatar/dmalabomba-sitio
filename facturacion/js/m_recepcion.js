// Recepción de facturas de proveedores: lo que llega a los correos de contabilidad, y su respuesta a Hacienda (MensajeReceptor 1 aceptar, 2 aceptar parcialmente, 3 rechazar).
// Plazo: 8 días hábiles desde que la factura llegó al correo. Datos: fx_recibidas / fx_recibida (solo lectura, ver sql/06_recepcion.sql).
import { h, money, num, fechaHora, debounce, modal, confirmar, pedir, conBoton, toast, nombrePropio, nombreLocal, campoBusqueda, hoyCR } from './util.js';
import { recibidas, recibida, responder, consultarRespuesta, revisarCorreo } from './api_recepcion.js';
import { mensajeAmable } from './api_documentos.js';
import { selectorPeriodo, textoRango, fechaDMA } from './periodo.js';
import { crearDescarga, nombrePeriodo } from './descargas.js';

const cssUrl = new URL('../css/recepcion.css', import.meta.url).href;
const TIPOS = { FacturaElectronica: 'Factura electrónica', TiqueteElectronico: 'Tiquete electrónico', NotaCreditoElectronica: 'Nota de crédito', NotaDebitoElectronica: 'Nota de débito', FacturaElectronicaCompra: 'Factura de compra', FacturaElectronicaExportacion: 'Factura de exportación' };
const nombreTipo = (t) => TIPOS[t] || t || 'Comprobante';
const limpiarNombre = (n) => String(n || 'Proveedor sin nombre').replace(/\s*\(([^()]*)\)\s*$/, (m, a) => (n.toUpperCase().startsWith(a.toUpperCase()) ? '' : m));
// Para mostrar: sin mayúsculas sostenidas (el archivo y el CSV conservan el nombre tal como viene en la factura)
const nomProv = (n) => nombrePropio(limpiarNombre(n));
const diaSemana = (ymd) => new Intl.DateTimeFormat('es-CR', { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(String(ymd).slice(0, 10) + 'T12:00:00Z'));
const plural = (n, u, p) => `${n} ${Math.abs(n) === 1 ? u : p}`;

// Estado de una factura para mostrar: {texto, clase, sub}
export function estadoFila(f) {
  const rec = f.receptor_estado, hac = f.hacienda_estado;
  if (!f.requiere) return { texto: 'No necesita respuesta', clase: '', sub: 'Los tiquetes y facturas de compra no se aceptan ni se rechazan.' };
  if (hac === '3') return { texto: 'Rechazada por Hacienda', clase: 'mal', sub: 'Hacienda no la aceptó; no hay que responderla.' };
  const cuando = (f.receptor_en ? 'El ' + fechaHora(f.receptor_en) : '') + (f.receptor_envio === 'enviado' ? ' · Enviada a Hacienda, falta que Hacienda la confirme' : '');
  if (rec === '1') return { texto: 'Aceptada', clase: 'ok', sub: cuando };
  if (rec === '2') return { texto: 'Aceptada parcialmente', clase: 'espera', sub: cuando };
  if (rec === '3') return { texto: 'Rechazada por usted', clase: 'mal', sub: cuando };
  const intento = ['error', 'pendiente', 'rechazado'].includes(f.receptor_envio) ? ' · Un intento de respuesta no llegó a Hacienda' : '';
  const d = f.dias_restantes, lim = f.vence ? 'Límite: ' + diaSemana(f.vence) + intento : intento.slice(3);
  if (d < 0) return { texto: `Plazo vencido hace ${plural(-d, 'día hábil', 'días hábiles')}`, clase: 'mal', sub: lim, nivel: 'vencida' };
  if (d === 0) return { texto: 'Último día para responder: hoy', clase: 'mal', sub: lim, nivel: 'pronto' };
  if (d <= 2) return { texto: `Quedan ${plural(d, 'día hábil', 'días hábiles')}`, clase: 'espera', sub: lim, nivel: 'pronto' };
  return { texto: `Quedan ${plural(d, 'día hábil', 'días hábiles')}`, clase: '', sub: lim, nivel: 'plazo' };
}

export default {
  id: 'recepcion', titulo: 'Contable',
  async mount(root, app) {
    if (!document.getElementById('css-recepcion')) document.head.append(h('link', { id: 'css-recepcion', rel: 'stylesheet', href: cssUrl }));
    const soc = app.soc; const nomLocal = nombreLocal(soc);
    let ficha = 0, vivo = true;
    const est = { vista: 'pendientes', q: '', datos: null, conteo: null, per: { pendientes: 'hoy', todas: 'hoy', vencidas: 'mes' } };

    const periodo = selectorPeriodo({ inicial: 'hoy', alCambiar: () => cargar() });
    const periodoCaja = h('div.tarjeta.rec-periodo', periodo.el);
    const buscar = h('input.campo', { type: 'search', placeholder: 'Proveedor, cédula o número de factura', 'aria-label': 'Buscar por proveedor o número de factura', oninput: debounce(() => { est.q = buscar.value.trim(); cargar(); }, 350) });
    const kpis = h('div.rejilla.rec-kpis');
    const tabs = h('div.rec-vistas', { role: 'group', 'aria-label': 'Qué facturas ver' });
    const rotulo = h('p.rec-rotulo');
    const resumen = h('div.rec-resumen');
    const lista = h('div.rec-lista');
    const estadoCorreo = h('p.rec-correo-estado', { hidden: true, 'aria-live': 'polite' });
    const btnCorreo = h('button.btn', { type: 'button', onclick: () => conBoton(btnCorreo, buscarCorreo) }, 'Buscar facturas nuevas en el correo');

    root.append(
      h('div.rec-cab', h('div', h('h2', 'Facturas de proveedores'),
        h('p.tenue', 'Facturas que llegaron a los correos de contabilidad a nombre de ', h('strong', nomLocal), soc?.cedula ? ` (cédula ${soc.cedula})` : '', '. Aquí no aparecen las facturas que emiten nuestros propios negocios.')),
        h('div.rec-cab-botones', btnCorreo)),
      estadoCorreo, kpis, tabs, periodoCaja, h('label.etq.rec-buscar', 'Buscar', campoBusqueda(buscar, () => { est.q = ''; cargar(); })), rotulo, resumen, lista);

    /* ---------- revisar el correo ---------- */
    async function buscarCorreo() {
      estadoCorreo.hidden = false; estadoCorreo.className = 'rec-correo-estado'; estadoCorreo.textContent = 'Revisando los correos de contabilidad (los últimos 3 días). Puede tardar hasta un minuto, no cierre esta pantalla…';
      btnCorreo.textContent = 'Revisando el correo…';
      try {
        const r = await revisarCorreo();
        const bz = r.buzones || [];
        const sum = (k) => bz.reduce((a, b) => a + (+b[k] || 0), 0);
        const errs = bz.flatMap((b) => b.errores || []);
        estadoCorreo.className = 'rec-correo-estado ' + (errs.length ? 'aviso' : 'ok');
        estadoCorreo.textContent = `Se revisaron ${plural(sum('correos'), 'correo', 'correos')} de ${plural(bz.length, 'buzón', 'buzones')}; ${plural(sum('comprobantes'), 'comprobante leído', 'comprobantes leídos')} y ${plural(sum('mensajes_hacienda'), 'respuesta de Hacienda', 'respuestas de Hacienda')}.` + (errs.length ? ` ${errs.length === 1 ? 'Un correo no se pudo leer' : errs.length + ' correos no se pudieron leer'}. Avise a la persona encargada.` : '');
        if (vivo) await cargar();
      } catch (e) {
        const sinPuente = /failed to fetch|networkerror|load failed/i.test(String(e.message || e));
        estadoCorreo.className = 'rec-correo-estado ' + (sinPuente ? 'aviso' : 'error');
        estadoCorreo.textContent = sinPuente
          ? 'La revisión manual del correo todavía no se puede hacer desde esta pantalla. No pasa nada: el sistema revisa solo los correos de contabilidad varias veces al día y las facturas nuevas aparecen aquí. Lo que ya estaba guardado se sigue viendo.'
          : 'No se pudo revisar el correo ahora. Las facturas que ya estaban guardadas se siguen viendo. Intente de nuevo en unos minutos.';
      } finally { btnCorreo.textContent = 'Buscar facturas nuevas en el correo'; }
    }

    /* ---------- carga ---------- */
    const modo = () => (est.vista === 'pendientes' ? 'pendientes' : est.vista === 'vencidas' ? 'vencidas' : 'todas');
    async function cargar() {
      const mia = ++ficha;
      const [desde, hasta] = periodo.rango();
      periodoCaja.hidden = est.vista === 'pendientes';
      pintarTabs();
      lista.replaceChildren(h('p.cargando', 'Cargando facturas…')); resumen.replaceChildren();
      rotulo.textContent = est.vista === 'pendientes'
        ? 'Facturas que llegaron y todavía no tienen respuesta, con el plazo de 8 días hábiles que les queda. Las más urgentes van primero.'
        : (est.vista === 'vencidas' ? 'Facturas sin respuesta registrada cuyo plazo de 8 días hábiles ya pasó, que llegaron ' : 'Facturas que llegaron ') + (est.vista === 'pendientes' ? '' : textoRango(desde, hasta) + '.');
      try {
        const d = await recibidas(soc.id, desde, hasta, est.q, modo());
        if (mia !== ficha || !vivo) return;
        est.datos = d; est.conteo = d.conteo;
        pintarKpis(); pintarTabs(); pintarLista();
        marcarPestana(d.conteo);
      } catch (e) {
        if (mia !== ficha) return;
        lista.replaceChildren(h('div.vacio', h('p', 'No se pudieron traer las facturas.'), h('p.tenue', mensajeAmable(e, 'Revise la conexión e intente de nuevo.')), h('button.btn', { type: 'button', onclick: () => cargar() }, 'Intentar de nuevo')));
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
        kpi('Plazo vencido sin respuesta', num(venc, 0), c.vencidas_antiguas ? `${num(c.vencidas_antiguas, 0)} son de hace más de un mes. Este sistema todavía no tiene ninguna respuesta registrada, así que incluye las que se hayan aceptado por otro medio.` : 'Facturas cuyo plazo ya pasó.', venc ? 'vencida' : ''));
    }
    const kpi = (t, v, n, extra) => h('div.tarjeta.kpi' + (extra ? '.' + extra : ''), h('div.kpi-t', t), h('div.kpi-v.cifra', v), h('div.kpi-n', n));

    function pintarTabs() {
      const c = est.conteo || {};
      const venc = (c.vencidas_recientes || 0) + (c.vencidas_antiguas || 0);
      const b = (id, t, n) => h('button.btn.rec-vista', { type: 'button', 'aria-pressed': String(est.vista === id), onclick: () => { if (est.vista === id) return; est.per[est.vista] = periodo.id(); est.vista = id; const p = est.per[id]; if (p && p !== 'otro' && p !== periodo.id()) periodo.elegir(p); else cargar(); } }, t, n != null ? h('span.rec-n', num(n, 0)) : null);
      tabs.replaceChildren(b('pendientes', 'Pendientes de responder', c.pendientes_en_plazo ?? null), b('todas', 'Todas las facturas', null), b('vencidas', 'Plazo vencido', venc || null));
    }

    /* ---------- lista ---------- */
    function pintarLista() {
      const d = est.datos, filas = d.filas || [];
      const r = d.resumen || {};
      resumen.replaceChildren();
      if (!filas.length) {
        const msg = est.q ? 'Ninguna factura coincide con la búsqueda.' : est.vista === 'pendientes' ? 'No hay facturas pendientes de responder. Todo está al día.' : est.vista === 'vencidas' ? 'No hay facturas con el plazo vencido en este periodo.' : 'No llegaron facturas de proveedores en este periodo.';
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
      if (d.otras_cedulas > 0) lista.append(h('p.tenue.rec-otras', `Además llegaron ${plural(d.otras_cedulas, 'comprobante', 'comprobantes')} a nombre de otra cédula (por ejemplo del otro local o de una persona). No se muestran aquí.`));
    }
    function fila(f) {
      const e = estadoFila(f); const nota = f.tipo === 'NotaCreditoElectronica';
      return h('button.rec-fila' + (e.nivel ? '.' + e.nivel : ''), { type: 'button', onclick: () => abrirDetalle(f.clave), 'aria-label': `Ver detalle de la factura ${f.consecutivo || ''} de ${nomProv(f.emisor_nombre)}` },
        h('span.rec-fecha', h('strong', diaSemana(f.llego)), h('small', fechaHora(f.llego).slice(-5))),
        h('span.rec-prov', h('strong', nomProv(f.emisor_nombre)), h('small', `${nombreTipo(f.tipo)} ${f.consecutivo ? '· ' + f.consecutivo.slice(-10) : ''} · cédula ${f.emisor_cedula || 'sin dato'}`)),
        h('span.rec-monto.der', h('small.rec-et', 'Total'), (nota ? '−' : '') + money(f.total)),
        h('span.rec-monto.der', h('small.rec-et', 'IVA'), (nota ? '−' : '') + money(f.iva)),
        h('span.rec-estado', h('span.chip' + (e.clase ? '.' + e.clase : ''), e.texto), e.sub ? h('small', e.sub) : null),
        h('span.rec-ver', 'Ver detalle'));
    }
    // Lo que se descarga: la lista que se ve ahora (misma vista, periodo y búsqueda), del más antiguo al más reciente. Los datos son los de la pantalla, no se piden de nuevo.
    function opcionesLista() {
      const d = est.datos; if (!d) return { filas: [] };
      const r = d.resumen || {};
      const [desde, hasta] = periodo.rango();
      const pend = est.vista === 'pendientes', venc = est.vista === 'vencidas';
      const filas = [...(d.filas || [])].sort((a, b) => new Date(a.llego) - new Date(b.llego));
      const hoy = hoyCR();
      const notas = ['Ordenado de la factura que llegó primero a la que llegó último.', 'Las notas de crédito van con signo negativo: restan del total.'];
      if (d.truncado) notas.push(`Esta lista trae solo las ${filas.length} facturas más recientes de las ${r.n}. El total de toda la búsqueda es ${money(r.total)} con IVA, ${money(r.iva)} de IVA y ${money(r.neto)} sin IVA. Para ver las demás use un periodo más corto o el buscador.`);
      if (d.otras_cedulas > 0) notas.push(`Además llegaron ${plural(d.otras_cedulas, 'comprobante', 'comprobantes')} a nombre de otra cédula (por ejemplo del otro local o de una persona). No están en esta lista.`);
      return {
        nombre: pend ? `Facturas de proveedores pendientes ${nombrePeriodo(hoy, hoy)}` : `Facturas de proveedores${venc ? ' con plazo vencido' : ''} ${nombrePeriodo(desde, hasta)}`,
        empresa: nomLocal, cedula: soc?.cedula || '',
        titulo: pend ? 'Facturas de proveedores pendientes de responder' : venc ? 'Facturas de proveedores con el plazo vencido' : 'Facturas de proveedores',
        subtitulo: (pend ? 'Sin respuesta y dentro del plazo de 8 días hábiles' : (venc ? 'Sin respuesta y con el plazo ya vencido, que llegaron ' : 'Llegaron ') + textoRango(desde, hasta)) + (est.q ? ` · búsqueda: «${est.q}»` : ''),
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
          { clave: 'clave', titulo: 'Clave numérica (50 dígitos)', tipo: 'texto', enPdf: false }],
        filas: filas.map((f) => {
          const e = estadoFila(f); const sg = f.tipo === 'NotaCreditoElectronica' ? -1 : 1;
          return { llego: f.llego, fecha: f.fecha, prov: limpiarNombre(f.emisor_nombre), ced: f.emisor_cedula || '', tipo: nombreTipo(f.tipo), cons: f.consecutivo || '', total: sg * +f.total, iva: sg * +f.iva, neto: sg * +f.neto, resp: e.texto, detalle: e.sub || '', limite: f.pendiente && f.vence ? f.vence : '', dias: f.pendiente ? +f.dias_restantes : '', clave: f.clave || '' };
        }),
        totales: { total: 'suma', iva: 'suma', neto: 'suma' },
        notas,
      };
    }

    /* ---------- detalle ---------- */
    async function abrirDetalle(clave) {
      const cuerpo = h('div', h('p.cargando', 'Cargando la factura…'));
      const m = modal({ titulo: 'Factura de proveedor', contenido: cuerpo, ancho: 940 });
      m.el.classList.add('rec-modal');
      m.el.parentElement.style.gridTemplateColumns = 'minmax(0, 1fr)'; // evita que una tabla ancha empuje la ventana fuera del celular
      await pintarDetalle(cuerpo, clave);
    }
    async function pintarDetalle(cuerpo, clave, aviso) {
      let d;
      try { d = await recibida(clave); } catch (e) { cuerpo.replaceChildren(h('div.error-caja', 'No se pudo abrir la factura. ' + mensajeAmable(e, 'Revise la conexión e intente de nuevo.'))); return; }
      const f = d.factura, nota = f.tipo === 'NotaCreditoElectronica', sg = nota ? '−' : '';
      const e = estadoFila({ ...d, ...f, requiere: d.requiere, dias_restantes: d.dias_restantes });
      const dato = (t, v) => h('div.rec-dato', h('small', t), h('div', v));
      const moneda = f.moneda !== 'CRC';
      const lineas = d.lineas || [];
      const hacTxt = { '1': 'Aceptada por Hacienda', '2': 'Aceptada parcialmente por Hacienda', '3': 'Rechazada por Hacienda' }[d.hacienda_estado] || 'Sin respuesta de Hacienda en el correo';
      const respuesta = h('div.rec-resp');
      pintarRespuesta(respuesta, d, clave, cuerpo, e);
      cuerpo.replaceChildren(
        ...(aviso ? [h('div.rec-ok', aviso)] : []),
        h('div.rec-detalle-cab', h('div', h('h2', nomProv(f.emisor_nombre)), h('p.tenue', `${nombreTipo(f.tipo)} · consecutivo ${f.consecutivo || 'sin dato'} · cédula del proveedor ${f.emisor_cedula || 'sin dato'}`)),
          h('div.fila', h('span.chip' + (e.clase ? '.' + e.clase : ''), e.texto),
            lineas.length ? crearDescarga(() => opcionesFactura(d, e), { texto: 'Descargar esta factura', etiqueta: 'Descargar las líneas de esta factura' }) : null)),
        h('div.rec-datos',
          dato('Emitida', fechaHora(f.fecha)), dato('Llegó al correo', fechaHora(f.llego)), dato('Correo', f.buzon || 'sin dato'),
          dato('Compra para', d.local ? d.local.nombre : (f.receptor_nombre || 'sin dato')), dato('Cédula del receptor', f.receptor_cedula || 'sin dato'), dato('Condición de venta', { '01': 'Contado', '02': 'Crédito' }[f.condicion_venta] || f.condicion_venta || 'sin dato'),
          dato('Respuesta de Hacienda al proveedor', hacTxt), moneda ? dato('Moneda', `${f.moneda}, tipo de cambio ${num(f.tipo_cambio, 5)}`) : null),
        h('h3', 'Líneas de la factura'),
        lineas.length ? h('div.tabla-caja', h('table.tabla', h('thead', h('tr', h('th', '#'), h('th', 'Detalle'), h('th.der', 'Cantidad'), h('th.der', 'Precio unitario'), h('th.der', 'Sin IVA'), h('th.der', 'IVA'), h('th.der', 'Total'))),
          h('tbody', lineas.map((l) => h('tr', h('td', l.linea > 999 ? '' : l.linea), h('td', l.detalle || '', l.cabys ? h('small.tenue', ' CABYS ' + l.cabys) : null), h('td.der', { 'data-et': 'Cantidad' }, num(l.cantidad, 3)), h('td.der', { 'data-et': 'Precio' }, money(l.precio_unitario)), h('td.der', { 'data-et': 'Sin IVA' }, money(l.subtotal)), h('td.der', { 'data-et': 'IVA' }, money(l.impuesto)), h('td.der', { 'data-et': 'Total' }, money(l.total_linea)))))))
          : h('p.tenue', 'Esta factura no trae líneas guardadas.'),
        h('div.rec-totales',
          h('div', h('span', 'Compra sin IVA'), h('strong.cifra', sg + money(f.neto))),
          h('div', h('span', 'IVA soportado (IVA que se pagó al proveedor)'), h('strong.cifra', sg + money(f.iva))),
          h('div.total', h('span', nota ? 'Total de la nota de crédito (resta de lo que se debe)' : 'Total de la factura con IVA'), h('strong.cifra', sg + money(f.total))),
          moneda ? h('small.tenue', `Montos convertidos a colones. En ${f.moneda} el total es ${num(f.total_orig, 2)}.`) : null),
        respuesta,
        h('details.rec-tecnico', h('summary', 'Datos técnicos'), h('p.tenue', 'Clave numérica: ', h('code', f.clave)), (d.mensajes || []).map((x) => h('p.tenue', `${x.tipo} · estado ${x.estado || 'sin dato'} · ${x.recibido ? fechaHora(x.recibido) : ''}${x.detalle && x.detalle !== '.' ? ' · ' + x.detalle : ''}`))));
    }

    // Lo que se descarga de una factura abierta: sus líneas, con los totales que se ven abajo
    function opcionesFactura(d, e) {
      const f = d.factura, nota = f.tipo === 'NotaCreditoElectronica', sg = nota ? -1 : 1;
      const corto = f.consecutivo ? f.consecutivo.slice(-10).replace(/^0+(?=\d)/, '') : '';
      return {
        nombre: `${nota ? 'Nota de crédito de proveedor' : 'Factura de proveedor'} ${limpiarNombre(f.emisor_nombre)} ${corto}`.trim(),
        empresa: nomLocal, cedula: soc?.cedula || '',
        titulo: nota ? 'Nota de crédito de un proveedor' : 'Factura de un proveedor',
        subtitulo: `${limpiarNombre(f.emisor_nombre)} · ${nombreTipo(f.tipo)} · consecutivo ${f.consecutivo || 'sin dato'} · cédula del proveedor ${f.emisor_cedula || 'sin dato'} · emitida ${fechaHora(f.fecha)} · ${e.texto}`,
        cifras: 'brutas', cifrasNota: 'Montos del comprobante tal como vienen, en colones' + (f.moneda !== 'CRC' ? `; la factura está en ${f.moneda} y aquí se muestra convertida` : ''),
        columnas: [
          { clave: 'n', titulo: 'Línea', tipo: 'numero', dec: 0 }, { clave: 'det', titulo: 'Detalle', tipo: 'texto' }, { clave: 'cabys', titulo: 'CABYS', tipo: 'texto' },
          { clave: 'cant', titulo: 'Cantidad', tipo: 'numero', dec: 3 }, { clave: 'pu', titulo: 'Precio unitario (₡)', tipo: 'moneda', decMax: 5 },
          { clave: 'sub', titulo: 'Sin IVA (₡)', tipo: 'moneda' }, { clave: 'iva', titulo: 'IVA (₡)', tipo: 'moneda' }, { clave: 'tot', titulo: 'Total de la línea (₡)', tipo: 'moneda' }],
        filas: (d.lineas || []).map((l) => ({ n: l.linea > 999 ? '' : l.linea, det: l.detalle || '', cabys: l.cabys || '', cant: l.cantidad, pu: l.precio_unitario, sub: l.subtotal, iva: l.impuesto, tot: l.total_linea })),
        totales: { sub: sg * +f.neto, iva: sg * +f.iva, tot: sg * +f.total }, etiquetaTotal: nota ? 'Total de la nota de crédito' : 'Total de la factura',
        notas: [nota ? 'Los totales de una nota de crédito van en negativo: restan de lo que se debe.' : ''],
      };
    }

    function pintarRespuesta(caja, d, clave, cuerpo, e) {
      caja.replaceChildren();
      const f = d.factura;
      const quien = `la factura ${f.consecutivo || ''} de ${nomProv(f.emisor_nombre)}`;
      const err = h('div.error-caja', { hidden: true });
      if (d.propia) { caja.append(h('p.tenue', 'Este comprobante lo emitió uno de nuestros propios negocios; no es una compra a un proveedor.')); return; }
      if (!d.requiere) { caja.append(h('h3', 'Respuesta a Hacienda'), h('p', 'Este tipo de comprobante no necesita que usted lo acepte ni lo rechace.')); return; }
      if (d.hacienda_estado === '3') { caja.append(h('h3', 'Respuesta a Hacienda'), h('p', 'Hacienda rechazó esta factura cuando el proveedor la envió, así que no hay nada que responder.')); return; }
      if (d.receptor_estado) {
        const t = { '1': 'Usted aceptó esta factura completa.', '2': 'Usted aceptó esta factura parcialmente.', '3': 'Usted rechazó esta factura.' }[d.receptor_estado];
        const procesando = d.receptor_envio === 'enviado';
        const btnConsulta = h('button.btn.grande', { type: 'button', onclick: () => conBoton(btnConsulta, async () => {
          const r = await consultarRespuesta(clave);
          await pintarDetalle(cuerpo, clave, r.estado === 'aceptado' ? 'Hacienda ya recibió y aceptó su respuesta.' : 'Su respuesta se envió. Vuelva a revisar en un momento para ver si Hacienda ya la confirmó.');
          if (vivo) cargar();
        }) }, 'Revisar si Hacienda ya la procesó');
        caja.append(...[h('h3', 'Respuesta a Hacienda'), h('p.rec-ok', t + (d.receptor_en ? ' El ' + fechaHora(d.receptor_en) + '.' : '')),
          procesando ? h('p.tenue', 'Su respuesta ya se envió. Falta que Hacienda la confirme.') : h('p.tenue', d.receptor_envio === 'aceptado' ? 'Hacienda ya recibió y aceptó su respuesta.' : 'Su respuesta quedó guardada en este sistema.'),
          procesando ? btnConsulta : null].filter(Boolean));
        return;
      }
      const vencida = d.dias_restantes < 0;
      const enviar = async (btn, accion, motivo, extra) => {
        err.hidden = true;
        const txt = btn.textContent; btn.disabled = true; btn.textContent = 'Enviando…';
        try {
          const r = await responder(clave, accion, motivo, extra);
          if (r && r.ok === false) throw new Error('Hacienda no aceptó su respuesta' + (r.detalle ? ': ' + r.detalle : '.') + ' Puede intentarlo de nuevo.');
          toast('Respuesta enviada: ' + ({ aceptar: 'factura aceptada', parcial: 'aceptada parcialmente', rechazar: 'factura rechazada' }[accion]) + '.');
          await pintarDetalle(cuerpo, clave, r?.estado === 'aceptado' ? 'Hacienda recibió y aceptó su respuesta.' : 'Su respuesta se envió. Falta que Hacienda la confirme: vuelva a abrir esta factura en un momento para ver si ya quedó.');
          if (vivo) cargar();
        } catch (ex) {
          err.textContent = ex.message || String(ex); err.hidden = false; err.scrollIntoView({ block: 'nearest' });
          btn.disabled = false; btn.textContent = txt;
        }
      };
      // Aceptar: se elige cómo se trata el IVA (lo normal es acreditarlo completo)
      const pedirAceptar = () => new Promise((ok) => {
        let hecho = false;
        const trato = h('select.campo', { 'aria-label': 'Cómo se trata el IVA de esta compra' },
          h('option', { value: '01' }, 'El IVA se acredita completo (lo normal)'),
          h('option', { value: '04' }, 'Es un gasto: el IVA no se acredita'),
          h('option', { value: '03' }, 'Es un bien de capital (equipo o maquinaria)'));
        const fin = (v, c) => { hecho = true; c?.(); ok(v); };
        modal({ titulo: 'Aceptar la factura', ancho: 480, alCerrar: () => { if (!hecho) ok(null); },
          contenido: h('div', h('p', `¿Aceptar ${quien} por ${money(f.total)}? Se le avisa a Hacienda que usted la recibió conforme.`), h('label.etq', '¿Cómo se trata el IVA de esta compra?', trato)),
          botones: [{ texto: 'No, volver', onclick: (c) => fin(null, c) }, { texto: 'Sí, aceptar la factura', clase: 'primario', onclick: (c) => fin(trato.value, c) }] });
      });
      // Aceptar parcialmente: porcentaje de IVA que sí se acredita y el motivo
      const pedirParcial = () => new Promise((ok) => {
        let hecho = false;
        const pct = h('input.campo', { type: 'number', min: '0', max: '100', step: '1', inputmode: 'numeric', placeholder: 'Por ejemplo: 50', 'aria-label': 'Porcentaje del IVA que se acredita' });
        const motivo = h('textarea.campo', { rows: 3, maxlength: '160', 'aria-label': 'Motivo' });
        const cuanto = h('small.tenue', 'Escriba el porcentaje para ver cuánto IVA se acreditaría.');
        const aviso = h('div.error-caja', { hidden: true });
        pct.addEventListener('input', () => { const v = Number(pct.value); cuanto.textContent = pct.value !== '' && v >= 0 && v <= 100 ? `Se acreditarían unos ${money(Math.round(f.iva * v) / 100)} de los ${money(f.iva)} de IVA de esta factura.` : 'Escriba un número entre 0 y 100.'; });
        const fin = (v, c) => { hecho = true; c?.(); ok(v); };
        modal({ titulo: 'Aceptar parcialmente', ancho: 500, alCerrar: () => { if (!hecho) ok(null); },
          contenido: h('div',
            h('p', `Use esta opción si solo una parte de ${quien} es correcta o se puede acreditar.`),
            h('label.etq', 'Porcentaje del IVA que sí se acredita (de 0 a 100)', pct, cuanto),
            h('label.etq', 'Motivo: qué parte no acepta y por qué', motivo, h('small', 'Hacienda lo recibe junto con la respuesta. Máximo 160 letras.')), aviso),
          botones: [{ texto: 'Cancelar', onclick: (c) => fin(null, c) }, { texto: 'Enviar respuesta', clase: 'primario', onclick: (c) => {
            const v = Number(pct.value), m = motivo.value.trim();
            if (pct.value === '' || !(v >= 0 && v <= 100)) { aviso.textContent = 'Escriba el porcentaje de IVA que se acredita, un número entre 0 y 100.'; aviso.hidden = false; return; }
            if (m.length < 5) { aviso.textContent = 'Escriba el motivo con un poco más de detalle (al menos 5 letras).'; aviso.hidden = false; return; }
            fin({ proporcion: v, motivo: m.slice(0, 160) }, c);
          } }] });
      });
      const pedirMotivo = async (titulo, etiqueta) => {
        for (;;) {
          const t = await pedir({ titulo, etiqueta, multilinea: true, nota: 'Hacienda lo recibe junto con la respuesta. Máximo 160 letras.', boton: 'Enviar respuesta' });
          if (t == null) return null;
          if (t.trim().length >= 5) return t.trim().slice(0, 160);
          toast('Escriba el motivo con un poco más de detalle (al menos 5 letras).', 'error');
        }
      };
      const bA = h('button.btn.primario.grande', { type: 'button', onclick: async () => { const c = await pedirAceptar(); if (c) enviar(bA, 'aceptar', '', { condicion_impuesto: c }); } }, 'Aceptar');
      const bP = h('button.btn.grande', { type: 'button', onclick: async () => { const r = await pedirParcial(); if (r) enviar(bP, 'parcial', r.motivo, { condicion_impuesto: '02', proporcion: r.proporcion }); } }, 'Aceptar parcialmente');
      const bR = h('button.btn.peligro.grande', { type: 'button', onclick: async () => { const t = await pedirMotivo('Rechazar la factura', 'Motivo: por qué rechaza esta factura'); if (t && await confirmar('¿Rechazar esta factura? Se le avisa a Hacienda que usted NO la acepta.', { si: 'Sí, rechazar', no: 'No, volver', peligro: true })) enviar(bR, 'rechazar', t); } }, 'Rechazar');
      const pruebas = app.soc && app.soc.ambiente && app.soc.ambiente !== 'produccion';
      caja.append(...[h('h3', 'Respuesta a Hacienda'),
        h('p.rec-plazo' + (vencida ? '.vencida' : ''), e.texto + (e.sub ? '. ' + e.sub : '') + '.', vencida ? ' Todavía puede intentar responder, pero el plazo ya pasó.' : ''),
        pruebas ? h('p.lis-aviso', 'El sistema está en modo de pruebas. Las respuestas a facturas reales de proveedores todavía no se envían a Hacienda: si lo intenta, el sistema se lo explica y no se pierde nada.') : null,
        ['error', 'pendiente', 'rechazado'].includes(d.receptor_envio) ? h('p.lis-aviso', 'Un intento anterior de responder esta factura no llegó a Hacienda' + (d.receptor_detalle ? ': ' + d.receptor_detalle : '.') + ' Puede intentarlo de nuevo.') : null,
        h('div.rec-acciones', bA, bP, bR),
        h('ul.rec-ayuda', h('li', h('strong', 'Aceptar: '), 'la compra llegó bien y la factura está correcta. Es lo normal.'), h('li', h('strong', 'Aceptar parcialmente: '), 'hay una parte con error o solo se acredita parte del IVA. Pide un porcentaje y un motivo.'), h('li', h('strong', 'Rechazar: '), 'la compra no es nuestra o la factura está mal. Pide un motivo.')),
        err].filter(Boolean));
    }

    cargar();
    return () => { vivo = false; ficha++; };
  },
};
