// Documentos del día: lista de comprobantes (hoy primero), detalle, impresión, descargas, reenvío y anulación con nota de crédito.
import { h, money, modal, toast, confirmar, descargar, hoyCR, sumaDias, fechaHora, horaCorta, debounce, num, r2, nombrePropio, traducirHacienda, campoBusqueda, TIPOS_SERVICIO, MEDIOS, TIPOS_ID } from './util.js';
import { documentos, ncDe, CORREO_ACTIVO, reenviarCorreo } from './api_documentos.js';
import { imprimirComprobante, formatoDireccion, formatoCedula, formatoTelefono, numeroCorto, NOMBRES_DOCUMENTO } from './imprimir.js';

if (!document.querySelector('link[data-fx-documentos]')) document.head.append(h('link', { rel: 'stylesheet', href: new URL('../css/documentos.css', import.meta.url).href, 'data-fx-documentos': '1' }));

const TZ = 'America/Costa_Rica';
const fmtDia = new Intl.DateTimeFormat('es-CR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fmtDiaCorto = new Intl.DateTimeFormat('es-CR', { timeZone: TZ, day: 'numeric', month: 'long' });
const diaTxt = (ymd) => { const t = fmtDia.format(new Date(ymd + 'T12:00:00Z')); return t.charAt(0).toUpperCase() + t.slice(1); };
const diaCortoTxt = (ymd) => fmtDiaCorto.format(new Date(ymd + 'T12:00:00Z'));
const ymdDe = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(iso));
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const centimos = (n) => Math.round((Number(n) || 0) * 100);

const ETQ_ESTADO = { pendiente: 'En cola', enviado: 'Enviado', aceptado: 'Aceptado', rechazado: 'Rechazado', error: 'Con error' };
const CLASE_ESTADO = { pendiente: 'espera', enviado: 'espera', aceptado: 'ok', rechazado: 'mal', error: 'mal' };
const NOMBRE_TIPO = { ...NOMBRES_DOCUMENTO, '01': 'Factura', '03': 'Nota de crédito', '04': 'Tiquete' }; // nombres cortos para la lista
const esVenta = (d) => d.tipo_doc === '01' || d.tipo_doc === '04';
const mediosTxt = (m) => (m ? m.split(', ').map((x) => MEDIOS[x] || x).join(' y ') : '');
const signo = (d) => (d.tipo_doc === '03' ? -1 : 1);
// "la factura electrónica" / "el tiquete electrónico"; con a=true: "a la factura electrónica" / "al tiquete electrónico"
const conArticulo = (tipo, a = false) => {
  const nombre = (NOMBRES_DOCUMENTO[tipo] || 'documento').toLowerCase();
  const fem = tipo === '01' || tipo === '03' || tipo === '02';
  return fem ? (a ? 'a la ' : 'la ') + nombre : (a ? 'al ' : 'el ') + nombre;
};

/* ------------------------------------------------------------------ módulo */

export default {
  id: 'documentos',
  titulo: 'Documentos del día',
  async mount(root, app) {
    const est = { rango: 'hoy', desde: hoyCR(), hasta: hoyCR(), q: '', filtro: 'todos', lista: [], cargando: false, error: null };
    // Si otra pantalla pidió ver los problemas (el aviso rojo del encabezado), se abre con ese filtro y con las mismas fechas del aviso
    const pedido = app.pedido; app.pedido = null;
    if (pedido?.filtro === 'problemas') {
      est.filtro = 'problemas';
      if (pedido.desde && /^\d{4}-\d{2}-\d{2}$/.test(pedido.desde) && pedido.desde < est.hasta) { est.rango = 'otro'; est.desde = pedido.desde; }
    }
    let detalleActual = null;
    let ultimaCarga = 0;

    /* ---------- encabezado y controles ---------- */
    const rangoDe = (r) => {
      const hoy = hoyCR();
      if (r === 'hoy') return [hoy, hoy];
      if (r === 'ayer') { const a = sumaDias(hoy, -1); return [a, a]; }
      if (r === 'semana') { const dow = new Date(hoy + 'T12:00:00Z').getUTCDay(); return [sumaDias(hoy, -((dow + 6) % 7)), hoy]; }
      return [est.desde, est.hasta];
    };
    const titulo = h('p.doc-fecha');
    const botonesRango = h('div.doc-rango', { role: 'group', 'aria-label': 'Fechas a mostrar' },
      [['hoy', 'Hoy'], ['ayer', 'Ayer'], ['semana', 'Esta semana'], ['otro', 'Otras fechas']].map(([r, t]) =>
        h('button.btn', { type: 'button', 'data-r': r, onclick: () => elegirRango(r) }, t)));
    const inDesde = h('input.campo', { type: 'date', 'aria-label': 'Desde' });
    const inHasta = h('input.campo', { type: 'date', 'aria-label': 'Hasta' });
    const verFechas = h('button.btn.primario', { type: 'button', onclick: () => {
      if (!inDesde.value || !inHasta.value) return toast('Escoja la fecha de inicio y la fecha final.', 'error');
      if (inDesde.value > inHasta.value) return toast('La fecha de inicio no puede ser después de la fecha final.', 'error');
      est.desde = inDesde.value; est.hasta = inHasta.value; cargar();
    } }, 'Ver estas fechas');
    const cajaFechas = h('div.doc-otras.tarjeta', { hidden: true },
      h('div.rejilla.dos', h('label.etq', 'Desde', inDesde), h('label.etq', 'Hasta', inHasta)), verFechas);
    const buscador = h('input.campo', { type: 'search', placeholder: 'Buscar por número, cliente o monto', 'aria-label': 'Buscar documento', autocomplete: 'off',
      oninput: debounce((e) => { est.q = e.target.value; pintar(); }, 150) });
    const buscadorFila = campoBusqueda(buscador, () => { est.q = ''; pintar(); });
    const refrescar = h('button.btn', { type: 'button', onclick: async () => { refrescar.disabled = true; await cargar(); refrescar.disabled = false; } }, 'Actualizar la lista');
    const zonaResumen = h('div');
    const zonaFiltros = h('div.doc-filtros');
    const zonaLista = h('div.doc-lista');

    root.append(h('div.doc-mod',
      h('div.fila.sep', h('h2', 'Documentos del día'), refrescar),
      titulo, botonesRango, cajaFechas, zonaResumen,
      h('div.doc-buscar', buscadorFila), zonaFiltros, zonaLista));

    function elegirRango(r) {
      est.rango = r;
      if (r === 'otro') {
        inDesde.value = est.desde || hoyCR(); inHasta.value = est.hasta || hoyCR();
        cajaFechas.hidden = false; pintarControles(); return;
      }
      cajaFechas.hidden = true;
      [est.desde, est.hasta] = rangoDe(r);
      cargar();
    }
    function pintarControles() {
      botonesRango.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.r === est.rango)));
      const una = est.desde === est.hasta;
      const pre = est.rango === 'hoy' ? 'Hoy, ' : est.rango === 'ayer' ? 'Ayer, ' : '';
      titulo.textContent = !una ? `Del ${diaCortoTxt(est.desde)} al ${diaCortoTxt(est.hasta)}` : pre ? pre + fmtDia.format(new Date(est.desde + 'T12:00:00Z')) : diaTxt(est.desde);
    }

    /* ---------- carga ---------- */
    async function cargar(silencioso = false) {
      pintarControles();
      if (!silencioso) { est.cargando = true; est.error = null; pintar(); }
      try {
        // Lo más reciente va arriba (igual que en «Anular factura»): lo último que hizo la cajera se ve sin bajar
        est.lista = (await documentos(app.soc.id, est.desde, est.hasta)).slice().sort((a, b) => new Date(b.fecha_emision) - new Date(a.fecha_emision));
        est.error = null;
      } catch (e) { if (!silencioso) est.error = e.message || String(e); }
      est.cargando = false; ultimaCarga = Date.now();
      pintar();
    }

    /* ---------- resumen, filtros y lista ---------- */
    function coincide(d) {
      const q = est.q.trim();
      if (!q) return true;
      const texto = norm([NOMBRE_TIPO[d.tipo_doc], NOMBRES_DOCUMENTO[d.tipo_doc], d.cliente || 'consumidor final', d.venta_numero, d.referencia, d.consecutivo, numeroCorto(d.consecutivo), mediosTxt(d.medios), d.ref_consecutivo, d.nc_consecutivo].join(' '));
      if (texto.includes(norm(q))) return true;
      const dig = q.replace(/\D/g, '');
      if (!dig) return false;
      const t = Number(d.total) || 0;
      return String(Math.trunc(t)).includes(dig) || t.toFixed(2).replace('.', '').includes(dig) || String(d.consecutivo).includes(dig);
    }
    const esPendiente = (d) => d.estado === 'pendiente' || d.estado === 'enviado';
    // «Con problemas» = lo mismo que cuenta el aviso rojo: rechazados (salvo los que solo traen un aviso o ya se rehicieron bien), con error, o que llevan más de 15 minutos esperando a Hacienda
    const soloAviso = (d) => { const it = traducirHacienda(d.mensaje).items; return it.length > 0 && it.every((x) => x.codigo === '-37'); };
    const reemplazado = (d) => est.lista.some((n) => n.id !== d.id && n.tipo_doc === d.tipo_doc && ['aceptado', 'pendiente', 'enviado'].includes(n.estado) && new Date(n.fecha_emision) > new Date(d.fecha_emision)
      && ((d.venta_numero && n.venta_numero === d.venta_numero) || (d.comprobante_ref && n.comprobante_ref === d.comprobante_ref)));
    const esProblema = (d) => ((d.estado === 'error' || d.estado === 'rechazado') && !(d.estado === 'rechazado' && soloAviso(d)) && !reemplazado(d))
      || (esPendiente(d) && Date.now() - new Date(d.fecha_emision).getTime() > 15 * 60000);

    function pintar() {
      pintarControles();
      if (est.cargando && !est.lista.length) { zonaResumen.replaceChildren(); zonaFiltros.replaceChildren(); zonaLista.replaceChildren(h('p.cargando', 'Cargando los documentos…')); return; }
      if (est.error) {
        zonaResumen.replaceChildren(); zonaFiltros.replaceChildren();
        zonaLista.replaceChildren(h('div.vacio', h('p', 'No se pudieron cargar los documentos.'), h('p.tenue', est.error), h('button.btn.primario', { onclick: () => cargar() }, 'Intentar de nuevo')));
        return;
      }
      pintarResumen();
      const problemas = est.lista.filter(esProblema), pend = est.lista.filter(esPendiente);
      if (est.filtro === 'problemas' && !problemas.length) est.filtro = 'todos';
      if (est.filtro === 'pendientes' && !pend.length) est.filtro = 'todos';
      zonaFiltros.replaceChildren(...[['todos', `Todos (${est.lista.length})`], problemas.length ? ['problemas', `Con problemas (${problemas.length})`] : null, pend.length ? ['pendientes', `Esperando a Hacienda (${pend.length})`] : null]
        .filter(Boolean).map(([k, t]) => h('button.btn' + (k === 'problemas' ? '.alerta' : ''), { type: 'button', 'aria-pressed': String(est.filtro === k), onclick: () => { est.filtro = k; pintar(); } }, t)));
      const visibles = est.lista.filter((d) => coincide(d) && (est.filtro === 'todos' || (est.filtro === 'problemas' ? esProblema(d) : esPendiente(d))));
      pintarLista(visibles);
    }

    function pintarResumen() {
      let ventas = 0, anul = 0, iva = 0, nVentas = 0, nNC = 0;
      for (const d of est.lista) {
        if (d.estado === 'rechazado') continue; // un documento rechazado no existe para Hacienda
        if (d.tipo_doc === '03') { anul += centimos(d.total); iva -= centimos(d.total_iva); nNC++; }
        else if (esVenta(d)) { ventas += centimos(d.total); iva += centimos(d.total_iva); nVentas++; }
      }
      const neto = (ventas - anul) / 100;
      const una = est.desde === est.hasta;
      zonaResumen.replaceChildren(h('div.doc-resumen.tarjeta',
        h('div.doc-neto',
          h('div.doc-etq', una ? (est.rango === 'hoy' ? 'Total de hoy' : 'Total del día') : 'Total de las fechas elegidas'),
          h('div.doc-gran', money(neto)),
          h('div.doc-sub', 'Con IVA incluido, ya restadas las anulaciones')),
        h('div.doc-cifras',
          h('div', h('span.doc-etq', 'Ventas'), h('b', money(ventas / 100)), h('small', `${nVentas} ${nVentas === 1 ? 'documento' : 'documentos'}`)),
          h('div', h('span.doc-etq', 'Anulaciones'), h('b', (anul ? '−' : '') + money(anul / 100)), h('small', `${nNC} ${nNC === 1 ? 'nota de crédito' : 'notas de crédito'}`)),
          h('div', h('span.doc-etq', 'IVA incluido'), h('b', money(iva / 100)), h('small', 'del total de arriba')))));
    }

    function pintarLista(visibles) {
      if (!visibles.length) {
        zonaLista.replaceChildren(h('div.vacio',
          est.lista.length ? h('p', 'Ningún documento coincide con lo que buscó.')
            : h('p', est.rango === 'hoy' ? 'Todavía no hay documentos hoy. Cuando cobre una venta en Caja, aparecerá aquí.' : 'No hay documentos en estas fechas.'),
          !est.lista.length && est.rango === 'hoy' ? h('button.btn.primario', { onclick: () => app.ir('caja') }, 'Ir a Caja') : null));
        return;
      }
      const dias = new Map();
      for (const d of visibles) { const k = ymdDe(d.fecha_emision); if (!dias.has(k)) dias.set(k, []); dias.get(k).push(d); }
      const multi = dias.size > 1 || est.desde !== est.hasta;
      const out = [];
      for (const [dia, docs] of dias) {
        if (multi) {
          let t = 0; for (const d of docs) if (d.estado !== 'rechazado') t += signo(d) * centimos(d.total);
          out.push(h('div.doc-dia', h('b', diaTxt(dia)), h('span', `${docs.length} ${docs.length === 1 ? 'documento' : 'documentos'}, total ${money(t / 100)}`)));
        }
        out.push(h('div.doc-cabeza', h('span', 'Hora'), h('span', 'Documento'), h('span', 'Cliente'), h('span', 'Pago'), h('span.der', 'Total'), h('span', 'Estado')));
        for (const d of docs) out.push(fila(d));
      }
      zonaLista.replaceChildren(...out);
    }

    function fila(d) {
      const anulado = !!d.nc_id;
      const nc = d.tipo_doc === '03';
      const tipo = NOMBRE_TIPO[d.tipo_doc] || 'Comprobante';
      return h('button.doc-fila' + (nc ? '.nc' : '') + (anulado ? '.anulada' : ''), { type: 'button', onclick: () => abrirDetalle(d.id), 'aria-label': `${tipo} número ${numeroCorto(d.consecutivo)}, ${money(d.total)}. Toque para ver el detalle` },
        h('span.c-hora', horaCorta(d.fecha_emision)),
        h('span.c-doc', h('span.nw', h('b', tipo), ' N.° ' + numeroCorto(d.consecutivo)),
          anulado ? h('span.sub.anul', `Anulado por la nota de crédito N.° ${numeroCorto(d.nc_consecutivo)}`) : null,
          nc && d.ref_consecutivo ? h('span.sub', `Referencia a ${(NOMBRE_TIPO[d.ref_tipo] || 'documento').toLowerCase()} N.° ${numeroCorto(d.ref_consecutivo)}`) : null,
          null),
        h('span.c-cli', d.cliente ? nombrePropio(d.cliente) : h('span.tenue', 'Consumidor final')),
        h('span.c-pago', mediosTxt(d.medios) || h('span.tenue', 'Sin pago')),
        h('span.c-total.der', (nc ? '−' : '') + money(d.total)),
        h('span.c-est', h('span.chip.' + (CLASE_ESTADO[d.estado] || ''), ETQ_ESTADO[d.estado] || d.estado), anulado ? h('span.chip.anulado', 'Anulado') : null));
    }

    /* ---------- detalle de un documento ---------- */
    async function abrirDetalle(id) {
      const caja = h('div.doc-det', h('p.cargando', 'Cargando el documento…'));
      let vivo = true;
      const m = modal({ titulo: 'Detalle del documento', contenido: caja, ancho: 780, alCerrar: () => { vivo = false; if (detalleActual?.caja === caja) detalleActual = null; } });
      const pintarDet = async (silencioso = false) => {
        try {
          const [c, nc] = await Promise.all([app.api.comprobante(id), ncDe(id).catch(() => null)]);
          if (!vivo) return;
          caja.replaceChildren(vistaDetalle(c, nc, { repintar: pintarDet, cerrar: m.cerrar }));
        } catch (e) { if (vivo && !silencioso) caja.replaceChildren(h('div.error-caja', e.message || String(e))); }
      };
      detalleActual = { caja, repintar: pintarDet };
      await pintarDet();
    }

    function vistaDetalle(c, nc, ctx) {
      const tipoNombre = NOMBRES_DOCUMENTO[c.tipo_doc] || 'Documento';
      const esNC = c.tipo_doc === '03';
      const hechoHace = (Date.now() - new Date(c.fecha_emision).getTime()) / 60000;
      const cliente = c.cliente_snapshot && (c.cliente_snapshot.nombre || c.cliente_snapshot.identificacion) ? c.cliente_snapshot : null;
      const lineas = (c.lineas_snapshot || []).slice().sort((a, b) => (a.orden || 0) - (b.orden || 0));
      const total = Number(c.total) || 0, iva = Number(c.total_iva) || 0;
      const raiz = h('div.doc-det');

      // Avisos de vínculo
      if (nc) raiz.append(h('div.doc-aviso.anulado', h('div', h('b', 'Anulado por la nota de crédito N.° ' + numeroCorto(nc.consecutivo) + '. '), 'Este documento ya no vale.' + (nc.estado !== 'aceptado' ? ' La nota de crédito todavía está esperando la respuesta de Hacienda.' : '')),
        h('button.btn', { type: 'button', onclick: () => { ctx.cerrar(); abrirDetalle(nc.id); } }, 'Ver la nota de crédito')));
      if (esNC && c.original) raiz.append(h('div.doc-aviso.ref', h('div', h('b', `Referencia a ${(NOMBRES_DOCUMENTO[c.original.tipo_doc] || 'documento').toLowerCase()} N.° ${numeroCorto(c.original.consecutivo)}. `), 'Esta nota de crédito anula ese documento.', c.motivo ? h('div.doc-motivo', 'Motivo: ' + c.motivo) : null),
        h('button.btn', { type: 'button', onclick: () => { ctx.cerrar(); abrirDetalle(c.original.id); } }, 'Ver el documento original')));

      // Encabezado y estado
      raiz.append(h('div.doc-encab',
        h('div', h('div.doc-etq', tipoNombre), h('div.doc-num', 'N.° ' + numeroCorto(c.consecutivo)), h('div.tenue', fechaHora(c.fecha_emision))),
        h('div.doc-chips', h('span.chip.' + (CLASE_ESTADO[c.estado] || ''), ETQ_ESTADO[c.estado] || c.estado), c.ambiente !== 'produccion' ? h('span.chip.espera', 'Prueba, sin validez') : null, nc ? h('span.chip.anulado', 'Anulado') : null)));
      raiz.append(textoEstado(c));

      // Datos
      const dato = (e, v, extra) => h('div.doc-dato', h('span.doc-etq', e), h('div' + (extra ? '.' + extra : ''), v));
      raiz.append(h('div.doc-datos',
        dato('Número completo', c.consecutivo, 'mono'),
        dato('Venta', [c.venta?.numero, c.venta?.tipo_servicio ? TIPOS_SERVICIO[c.venta.tipo_servicio] || c.venta.tipo_servicio : null, c.venta?.referencia].filter(Boolean).join(' · ') || 'Sin datos'),
        dato('Condición de venta', 'Contado'),
        dato('Correo al cliente', c.correo_enviado_en ? `Enviado a ${c.correo_para || 'el cliente'} el ${fechaHora(c.correo_enviado_en)}` : c.correo_error ? 'No se pudo enviar: ' + c.correo_error : 'Todavía no se ha enviado'),
        dato('Clave numérica de 50 dígitos', c.clave, 'mono')));

      // Cliente
      raiz.append(h('div.doc-seccion', h('h3', 'Cliente'),
        cliente ? h('div.doc-cliente', h('b', nombrePropio(cliente.nombre || '')),
          cliente.nombre_comercial ? h('div', nombrePropio(cliente.nombre_comercial)) : null,
          cliente.identificacion ? h('div', (TIPOS_ID[cliente.tipo_id] || 'Identificación') + ' ' + formatoCedula(cliente.identificacion, cliente.tipo_id)) : null,
          cliente.correo ? h('div', 'Correo: ' + cliente.correo) : null,
          cliente.telefono ? h('div', 'Teléfono: ' + formatoTelefono(cliente.telefono)) : null,
          formatoDireccion(cliente) ? h('div', 'Dirección: ' + formatoDireccion(cliente)) : null)
          : h('p.tenue', c.tipo_doc === '04' ? 'Consumidor final: es un tiquete, no lleva datos del cliente.' : 'Sin datos del cliente.')));

      // Líneas y totales
      raiz.append(h('div.doc-seccion', h('h3', 'Lo que se facturó'),
        h('div.tabla-caja', h('table.tabla',
          h('thead', h('tr', h('th', 'Cant.'), h('th', 'Descripción'), h('th.der', 'Precio con IVA'), h('th.der', 'Total'))),
          h('tbody', lineas.map((l) => h('tr', h('td.cifra', num(l.cantidad)), h('td', l.descripcion || '', l.nota ? h('div.tenue', l.nota) : null), h('td.der', money(l.precio_final)), h('td.der', money(l.total_linea)))))))));
      raiz.append(h('div.doc-totales',
        h('div.doc-pagos', h('div.doc-etq', esNC ? 'Pagos del documento original' : 'Pagos'),
          (c.pagos_snapshot || []).length ? c.pagos_snapshot.map((p) => h('div.doc-fila-t', h('span', (MEDIOS[p.medio] || p.medio) + (p.referencia ? ` (ref. ${p.referencia})` : '')), h('b', money(p.monto)))) : h('div.tenue', 'Sin pagos registrados')),
        h('div.doc-sumas',
          h('div.doc-fila-t', h('span', 'Subtotal sin IVA'), h('span', money(r2(total - iva)))),
          h('div.doc-fila-t', h('span', 'IVA'), h('span', money(iva))),
          h('div.doc-fila-t.gran', h('span', esNC ? 'Total acreditado' : 'Total'), h('b', money(total))))));

      raiz.append(acciones(c, nc, ctx, hechoHace));
      return raiz;
    }

    function textoEstado(c) {
      const th = traducirHacienda(c.mensaje);
      const t = {
        pendiente: 'Está en cola y se enviará a Hacienda en el próximo minuto. No tiene que hacer nada.',
        enviado: 'Ya se envió a Hacienda y se espera su respuesta. Normalmente tarda menos de un minuto.',
        aceptado: 'Hacienda lo aceptó: el documento es válido.' + (c.ambiente !== 'produccion' ? ' Como estamos en modo de pruebas, no tiene validez tributaria.' : ''),
        rechazado: 'Hacienda no aceptó este documento, así que no es válido y no necesita nota de crédito. Si fue una venta real, hay que hacerla de nuevo en Caja.',
        error: 'Todavía no se pudo enviar a Hacienda (por ejemplo, por falta de internet). El sistema vuelve a intentarlo solo; también puede tocar «Reenviar a Hacienda».',
      }[c.estado] || '';
      // Lo que dice Hacienda, en palabras simples. Si el documento fue aceptado, lo que trae es un aviso y no impide nada.
      const motivos = th.items.length
        ? h('div.doc-motivos', h('b', c.estado === 'aceptado' ? 'Aviso de Hacienda (el documento sigue siendo válido):' : 'Qué dice Hacienda:'),
          h('ul', th.items.map((i) => h('li', i.texto))))
        : null;
      // El texto original queda plegado, con las comillas y corchetes quitados, por si alguien de soporte lo necesita
      const tecnico = c.mensaje
        ? h('details', h('summary.btn', 'Ver el texto original de Hacienda'),
          h('div.doc-tecnico', th.items.map((i) => h('p', (i.codigo ? `Código ${i.codigo}: ` : '') + i.original)),
            h('details.doc-crudo', h('summary.btn', 'Texto técnico sin cambios'), h('pre', String(c.mensaje)))))
        : null;
      return h('div.doc-estado.' + (CLASE_ESTADO[c.estado] || ''), h('p', t), motivos, tecnico);
    }

    /* ---------- acciones ---------- */
    async function ejecutar(b, fn) {
      b.disabled = true; b.dataset.ocupado = '1';
      try { return await fn(); } catch (e) { toast(e.message || String(e), 'error', 7000); } finally { b.disabled = false; delete b.dataset.ocupado; }
    }
    function accion({ texto, hint, clase = '', disabled = false, onclick }) {
      const b = h('button.btn.doc-acc' + (clase ? '.' + clase : ''), { type: 'button', disabled }, h('span.t', texto), hint ? h('small', hint) : null);
      if (!disabled) b.addEventListener('click', () => ejecutar(b, onclick));
      return b;
    }
    // Nombre del archivo: sin tildes (algunos navegadores lo descartan) y con guiones, no guiones bajos
    const nombreArchivo = (c, sufijo) => `${norm(NOMBRES_DOCUMENTO[c.tipo_doc] || 'comprobante').replace(/\s+/g, '-')}-${c.consecutivo}-${sufijo}.xml`;

    function acciones(c, nc, ctx, hechoHace) {
      const hechoXml = async (cual, sufijo, vacio) => {
        const xml = await app.api.xml(c.id, cual);
        if (!xml) return toast(vacio, 'error', 6000);
        descargar(nombreArchivo(c, sufijo), xml);
      };
      const conCorreo = !!c.cliente_snapshot?.correo;
      const recuperable = c.estado === 'rechazado' && /conexi|timeout|temporal|no disponible|token|intente de nuevo/i.test(c.mensaje || '');
      const puedeReenviar = c.estado === 'error' || recuperable || ((c.estado === 'pendiente' || c.estado === 'enviado') && hechoHace > 3);

      const impr = h('div.doc-grupo', h('h3', 'Imprimir'), h('div.doc-botones',
        accion({ texto: 'Imprimir tiquete', clase: 'primario', onclick: () => imprimirComprobante(c.id, { formato: 'tiquete', copias: 1 }) }),
        accion({ texto: 'Imprimir factura carta', onclick: () => imprimirComprobante(c.id, { formato: 'carta', copias: 1 }) })));

      const arch = h('div.doc-grupo', h('h3', 'Archivos para contabilidad'), h('div.doc-botones',
        accion({ texto: 'Descargar XML firmado', onclick: () => hechoXml('firmado', 'firmado', 'Este documento todavía no tiene el XML firmado.') }),
        accion({ texto: 'Descargar respuesta de Hacienda', hint: (c.estado === 'aceptado' || c.estado === 'rechazado') ? null : 'Disponible cuando Hacienda responda', disabled: !(c.estado === 'aceptado' || c.estado === 'rechazado'),
          onclick: () => hechoXml('respuesta', 'respuesta-hacienda', 'Hacienda todavía no ha enviado su respuesta.') })));

      const env = h('div.doc-grupo', h('h3', 'Enviar'), h('div.doc-botones',
        puedeReenviar
          ? accion({ texto: 'Reenviar a Hacienda', onclick: async () => {
            const r = await app.api.reenviar(c.id);
            toast(r?.estado === 'aceptado' ? 'Hacienda ya lo tiene aceptado.' : 'Listo, se mandó a reenviar. En unos segundos cambiará el estado.');
            await ctx.repintar(true); await cargar(true);
          } })
          : accion({ texto: 'Reenviar a Hacienda', disabled: true, hint: c.estado === 'aceptado' ? 'No hace falta: Hacienda ya lo aceptó' : c.estado === 'rechazado' ? 'Un documento rechazado no se reenvía' : 'Se envía solo; si tarda más de 3 minutos aparecerá este botón' }),
        CORREO_ACTIVO && conCorreo
          ? accion({ texto: 'Reenviar al cliente por correo', onclick: async () => { await reenviarCorreo(c.id); toast('Listo, se envió el correo al cliente.'); await ctx.repintar(true); } })
          : accion({ texto: 'Reenviar al cliente por correo', disabled: true, hint: !CORREO_ACTIVO ? 'Disponible cuando se active el correo' : 'Este cliente no tiene correo' })));

      const grupos = [impr, arch, env];
      if (esVenta(c)) grupos.push(bloqueAnular(c, nc, ctx));
      return h('div.doc-acciones', grupos);
    }

    function bloqueAnular(c, nc, ctx) {
      const g = h('div.doc-grupo.anular', h('h3', 'Corregir o anular'));
      if (nc) {
        g.append(h('p.tenue', `Este documento ya fue anulado con la nota de crédito N.° ${numeroCorto(nc.consecutivo)}. No se puede anular dos veces.`));
        return g;
      }
      if (c.estado === 'aceptado') {
        g.append(h('p.tenue', 'Si la venta se hizo mal, se anula con una nota de crédito. El documento original no se borra: queda guardado y enlazado a la nota.'),
          h('div.doc-botones', accion({ texto: 'Anular con nota de crédito', clase: 'peligro', onclick: () => dialogoAnular(c, ctx) })));
      } else if (c.estado === 'rechazado') {
        g.append(h('p.tenue', 'Hacienda rechazó este documento, así que ya no vale y no necesita nota de crédito.'));
      } else {
        g.append(h('p.tenue', 'Para anularlo hay que esperar a que Hacienda lo acepte (normalmente menos de un minuto). Cierre esta ventana y vuelva a abrirla en un momento.'),
          h('div.doc-botones', accion({ texto: 'Anular con nota de crédito', clase: 'peligro', disabled: true, hint: 'Primero debe estar aceptado por Hacienda' })));
      }
      return g;
    }

    /* ---------- anular con nota de crédito ---------- */
    function dialogoAnular(c, ctx) {
      const nombre = conArticulo(c.tipo_doc);
      const atajos = ['Error en el precio', 'Cliente devolvió el producto', 'Se facturó al cliente equivocado', 'Otro'];
      const campo = h('input.campo', { type: 'text', maxlength: 180, placeholder: 'Escriba aquí el motivo', 'aria-label': 'Motivo de la anulación' });
      const error = h('div.error-caja', { hidden: true });
      let elegido = null;
      const btnAtajos = atajos.map((t) => h('button.btn.atajo', { type: 'button', 'aria-pressed': 'false', onclick: () => {
        elegido = t; btnAtajos.forEach((b) => b.setAttribute('aria-pressed', String(b.textContent === t)));
        error.hidden = true;
        if (t === 'Otro') { campo.value = ''; campo.focus(); } else campo.value = t;
      } }, t));
      const volver = h('button.btn', { type: 'button', onclick: () => m.cerrar() }, 'No anular, volver');
      const seguir = h('button.btn.peligro.grande', { type: 'button', onclick: () => ejecutar(seguir, async () => {
        const motivo = campo.value.trim();
        if (motivo.length < 4 || motivo === 'Otro') { error.textContent = 'Escoja uno de los motivos de arriba o escriba cuál fue (mínimo 4 letras).'; error.hidden = false; campo.focus(); return; }
        error.hidden = true;
        const ok = await confirmar(`Se va a crear la nota de crédito por ${money(c.total)} que anula ${nombre} N.° ${numeroCorto(c.consecutivo)}. Motivo: ${motivo}. Esto no se puede deshacer. ¿Anular de verdad?`, { si: 'Sí, anular con nota de crédito', no: 'No, volver', peligro: true });
        if (!ok) return;
        const creada = await app.api.notaCredito(c.id, motivo, app.terminal);
        m.cerrar();
        mostrarResultadoNC(c, creada, ctx);
        await ctx.repintar(true); await cargar(true);
      }) }, 'Anular con nota de crédito');

      const m = modal({ titulo: 'Anular con nota de crédito', ancho: 600,
        contenido: h('div.doc-anular',
          h('div.doc-explica',
            h('p', h('b', 'Qué va a pasar si sigue:')),
            h('ul',
              h('li', `Se crea una nota de crédito por ${money(c.total)}. Es el documento oficial que le dice a Hacienda que ${nombre} N.° ${numeroCorto(c.consecutivo)} queda sin efecto.`),
              h('li', 'Se anula toda la venta, no una parte. La factura original no se borra: queda guardada y enlazada a la nota de crédito.'),
              h('li', 'La nota de crédito se envía sola a Hacienda en el próximo minuto.'),
              h('li', 'Si la venta debe cobrarse otra vez bien hecha, después de anular haga la venta nueva en Caja.'),
              h('li', 'El dinero que haya que devolverle al cliente lo maneja usted en la caja; este paso no mueve dinero.'))),
          h('div.doc-etq', 'Motivo (obligatorio)'),
          h('div.doc-atajos', btnAtajos),
          h('label.etq', 'Motivo que quedará escrito en la nota de crédito', campo),
          ) });
      // Los dos botones quedan fuera de la parte que se desplaza: se ven siempre, aunque la ventana sea más alta que la pantalla
      m.el.append(h('div.modal-pie.doc-pie-anular', error, volver, seguir));
    }

    function mostrarResultadoNC(original, nc, ctx) {
      const imp = h('button.btn.primario', { type: 'button', onclick: () => ejecutar(imp, () => imprimirComprobante(nc.id, { formato: 'tiquete', copias: 1 })) }, 'Imprimir la nota de crédito');
      const ver = h('button.btn', { type: 'button', onclick: () => { r.cerrar(); abrirDetalle(nc.id); } }, 'Ver la nota de crédito');
      const r = modal({ titulo: 'Documento anulado', ancho: 560, contenido: h('div.doc-resultado',
        h('div.doc-aviso.ref', h('div', h('b', `Listo. Se creó la nota de crédito N.° ${numeroCorto(nc.consecutivo)}.`), h('div', `Está enlazada ${conArticulo(original.tipo_doc, true)} N.° ${numeroCorto(original.consecutivo)}, que ahora aparece como "Anulado por la nota de crédito N.° ${numeroCorto(nc.consecutivo)}".`))),
        h('p', `Estado de la nota de crédito: ${ETQ_ESTADO[nc.estado] || nc.estado}. ` + (nc.estado === 'aceptado' ? 'Hacienda ya la aceptó.' : 'Se enviará a Hacienda en el próximo minuto y su estado cambiará solo.')),
        h('div.doc-botones.res', imp, ver, h('button.btn', { type: 'button', onclick: () => r.cerrar() }, 'Cerrar'))) });
    }

    /* ---------- arranque y actualización automática ---------- */
    pintarControles();
    await cargar();
    // Los documentos cambian de estado solos (en cola, enviado, aceptado): se actualiza la lista cada 20 segundos
    const reloj = setInterval(() => {
      if (document.hidden || !root.isConnected) return;
      if (Date.now() - ultimaCarga < 15000) return;
      cargar(true); detalleActual?.repintar(true);
    }, 20000);
    return () => clearInterval(reloj);
  },
};
