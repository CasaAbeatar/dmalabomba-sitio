// Anular factura: acceso directo desde la pantalla principal.
// Lista las facturas y tiquetes (hoy primero) con hora, número, cliente y total, y un botón Anular en cada uno.
// Anular = nota de crédito por el total que referencia el documento original (código 01 "Anula documento de referencia"
// y la razón escrita, como exige Hacienda). El documento original no se borra.
import { h, money, modal, toast, confirmar, hoyCR, sumaDias, horaCorta, debounce, nombrePropio, campoBusqueda, MEDIOS } from './util.js';
import { documentos } from './api_documentos.js';
import { imprimirComprobante, numeroCorto, NOMBRES_DOCUMENTO } from './imprimir.js';

if (!document.querySelector('link[data-fx-anular]')) document.head.append(h('link', { rel: 'stylesheet', href: new URL('../css/anular.css', import.meta.url).href, 'data-fx-anular': '1' }));

const TZ = 'America/Costa_Rica';
const fmtDia = new Intl.DateTimeFormat('es-CR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' });
const fmtDiaAnio = new Intl.DateTimeFormat('es-CR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const diaTxt = (ymd, conAnio) => { const t = (conAnio ? fmtDiaAnio : fmtDia).format(new Date(ymd + 'T12:00:00Z')); return t.charAt(0).toUpperCase() + t.slice(1); };
const ymdDe = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(iso));
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const NOMBRE_TIPO = { '01': 'Factura', '04': 'Tiquete' };
const conArticulo = (tipo) => (tipo === '01' ? 'la factura electrónica' : 'el tiquete electrónico');
const mediosTxt = (m) => (m ? m.split(', ').map((x) => MEDIOS[x] || x).join(' y ') : '');

// Motivos frecuentes. Hacienda pide que la nota de crédito diga por qué se anula (la razón puede tener hasta 180 letras).
const MOTIVOS = [
  'Error en el cliente (cédula o nombre)',
  'Error en el precio',
  'Error en los productos o en las cantidades',
  'El cliente devolvió la compra',
  'Se cobró dos veces',
  'Otro motivo',
];

export default {
  id: 'anular',
  titulo: 'Anular factura',
  async mount(root, app) {
    const est = { rango: 'hoy', desde: hoyCR(), hasta: hoyCR(), q: '', lista: [], cargando: false, error: null };
    let ultimaCarga = 0;

    /* ---------- controles ---------- */
    const rangoDe = (r) => {
      const hoy = hoyCR();
      if (r === 'hoy') return [hoy, hoy];
      if (r === 'ayer') { const a = sumaDias(hoy, -1); return [a, a]; }
      if (r === 'semana') { const dow = new Date(hoy + 'T12:00:00Z').getUTCDay(); return [sumaDias(hoy, -((dow + 6) % 7)), hoy]; }
      return [est.desde, est.hasta];
    };
    const titulo = h('p.an-fecha');
    const botonesRango = h('div.an-rango', { role: 'group', 'aria-label': 'Fechas a mostrar' },
      [['hoy', 'Hoy'], ['ayer', 'Ayer'], ['semana', 'Esta semana'], ['otro', 'Otras fechas']].map(([r, t]) =>
        h('button.btn', { type: 'button', 'data-r': r, onclick: () => elegirRango(r) }, t)));
    const inDesde = h('input.campo', { type: 'date', 'aria-label': 'Desde' });
    const inHasta = h('input.campo', { type: 'date', 'aria-label': 'Hasta' });
    const verFechas = h('button.btn.primario', { type: 'button', onclick: () => {
      if (!inDesde.value || !inHasta.value) return toast('Escoja la fecha de inicio y la fecha final.', 'error');
      if (inDesde.value > inHasta.value) return toast('La fecha de inicio no puede ser después de la fecha final.', 'error');
      est.desde = inDesde.value; est.hasta = inHasta.value; cargar();
    } }, 'Ver estas fechas');
    const cajaFechas = h('div.an-otras.tarjeta', { hidden: true },
      h('div.rejilla.dos', h('label.etq', 'Desde', inDesde), h('label.etq', 'Hasta', inHasta)), verFechas);
    const buscador = h('input.campo', { type: 'search', placeholder: 'Buscar por número, cliente, cédula o monto', 'aria-label': 'Buscar factura', autocomplete: 'off',
      oninput: debounce((e) => { est.q = e.target.value; pintar(); }, 150) });
    const buscadorFila = campoBusqueda(buscador, () => { est.q = ''; pintar(); });
    const refrescar = h('button.btn', { type: 'button', onclick: async () => { refrescar.disabled = true; await cargar(); refrescar.disabled = false; } }, 'Actualizar la lista');
    const zonaLista = h('div.an-lista');

    root.append(h('div.an-mod',
      h('div.fila.sep', h('h2', 'Anular una factura o tiquete'), refrescar),
      h('p.an-ayuda', 'Toque el botón Anular de la factura que se hizo mal. Se emite una nota de crédito, que es el documento que Hacienda pide para dejar sin efecto una factura. La factura original no se borra.'),
      titulo, botonesRango, cajaFechas, h('div.an-buscar', buscadorFila), zonaLista));

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
      titulo.textContent = una ? (pre ? pre + diaTxt(est.desde).toLowerCase() : diaTxt(est.desde, true)) : `Del ${diaTxt(est.desde)} al ${diaTxt(est.hasta)}`;
    }

    /* ---------- carga y lista ---------- */
    async function cargar(silencioso = false) {
      pintarControles();
      if (!silencioso) { est.cargando = true; est.error = null; pintar(); }
      try {
        // Solo facturas y tiquetes. Lo más reciente va arriba porque casi siempre se anula lo último que se hizo.
        est.lista = (await documentos(app.soc.id, est.desde, est.hasta)).filter((d) => d.tipo_doc === '01' || d.tipo_doc === '04')
          .sort((a, b) => new Date(b.fecha_emision) - new Date(a.fecha_emision));
        est.error = null;
      } catch (e) { if (!silencioso) est.error = e.message || String(e); }
      est.cargando = false; ultimaCarga = Date.now();
      pintar();
    }

    function pintar() {
      if (est.cargando && !est.lista.length) { zonaLista.replaceChildren(h('p.cargando', 'Cargando las facturas…')); return; }
      if (est.error) {
        zonaLista.replaceChildren(h('div.error-caja', 'No se pudo cargar la lista: ' + est.error), h('button.btn', { type: 'button', onclick: () => cargar() }, 'Intentar de nuevo'));
        return;
      }
      const q = norm(est.q).trim();
      const dig = q.replace(/\D/g, '');
      const visibles = est.lista.filter((d) => {
        if (!q) return true;
        const texto = norm([NOMBRE_TIPO[d.tipo_doc], d.cliente || 'consumidor final', d.cliente_identificacion, d.venta_numero, d.consecutivo, numeroCorto(d.consecutivo), mediosTxt(d.medios)].join(' '));
        if (texto.includes(q)) return true;
        const t = Number(d.total) || 0;
        return !!dig && (String(Math.trunc(t)).includes(dig) || t.toFixed(2).replace('.', '').includes(dig));
      });
      if (!visibles.length) {
        zonaLista.replaceChildren(h('p.vacio', q ? 'No hay facturas con eso. Pruebe con otra fecha o con menos letras.' : 'No hay facturas ni tiquetes en estas fechas.'));
        return;
      }
      const out = [h('div.an-cabeza', h('span', 'Hora'), h('span', 'Documento'), h('span', 'Cliente'), h('span.der', 'Total'), h('span', ''))];
      let diaPrev = null;
      const multi = est.desde !== est.hasta;
      for (const d of visibles) {
        const dia = ymdDe(d.fecha_emision);
        if (multi && dia !== diaPrev) { out.push(h('div.an-dia', diaTxt(dia, true))); diaPrev = dia; }
        out.push(fila(d));
      }
      zonaLista.replaceChildren(...out);
    }

    function fila(d) {
      const tipo = NOMBRE_TIPO[d.tipo_doc];
      const anulado = !!d.nc_id;
      let accion;
      if (anulado) {
        accion = h('span.an-estado', h('span.chip.anulado', 'Ya anulada'), h('small', 'Nota de crédito N.° ' + numeroCorto(d.nc_consecutivo)));
      } else if (d.estado === 'rechazado') {
        accion = h('span.an-estado', h('span.chip.mal', 'Rechazada por Hacienda'), h('small', 'No necesita anularse'));
      } else if (d.estado !== 'aceptado') {
        accion = h('span.an-estado', h('span.chip.espera', 'Esperando a Hacienda'), h('small', 'En un momento se podrá anular'));
      } else {
        accion = h('button.btn.peligro.an-btn', { type: 'button', 'aria-label': `Anular ${tipo.toLowerCase()} número ${numeroCorto(d.consecutivo)} por ${money(d.total)}`, onclick: () => dialogoAnular(d) }, 'Anular');
      }
      return h('div.an-fila' + (anulado ? '.anulada' : ''),
        h('span.an-hora', horaCorta(d.fecha_emision)),
        h('span.an-doc', h('b', tipo + ' N.° ' + numeroCorto(d.consecutivo)), d.medios ? h('small', mediosTxt(d.medios)) : null),
        h('span.an-cli', d.cliente ? nombrePropio(d.cliente) : h('span.tenue', 'Consumidor final')),
        h('span.an-total.der', money(d.total)),
        h('span.an-accion', accion));
    }

    /* ---------- anular con nota de crédito ---------- */
    function dialogoAnular(d) {
      const nombre = conArticulo(d.tipo_doc);
      const detalleLineas = h('div.an-lineas', h('small.tenue', 'Cargando el detalle…'));
      app.api.comprobante(d.id).then((c) => {
        const ls = c?.lineas_snapshot || [];
        if (!ls.length || !m.el.isConnected) { detalleLineas.replaceChildren(); return; }
        detalleLineas.replaceChildren(...[h('div.an-lineas-tit', 'Lo que se va a dejar sin efecto'),
          ...ls.slice(0, 10).map((l) => h('div.an-linea', h('span', `${Number(l.cantidad) || 1} × ${l.descripcion || l.nombre || 'Producto'}`), h('span.der', money(l.total ?? l.total_linea ?? 0)))),
          ls.length > 10 ? h('small.tenue', `y ${ls.length - 10} líneas más`) : null].filter(Boolean));
      }).catch(() => detalleLineas.replaceChildren());

      let elegido = null;
      const detalle = h('input.campo', { type: 'text', maxlength: 150, placeholder: 'Escriba aquí qué pasó', 'aria-label': 'Detalle del motivo' });
      const etqDetalle = h('label.etq', h('span.an-etq-det', 'Cuente brevemente qué pasó'), detalle);
      const error = h('div.error-caja', { hidden: true, role: 'alert' });
      const botonesMotivo = MOTIVOS.map((t) => h('button.btn.atajo', { type: 'button', 'aria-pressed': 'false', onclick: () => {
        elegido = t;
        botonesMotivo.forEach((b) => b.setAttribute('aria-pressed', String(b.textContent === t)));
        error.hidden = true;
        etqDetalle.querySelector('.an-etq-det').textContent = t === 'Otro motivo' ? 'Escriba cuál fue el motivo (obligatorio)' : 'Detalle (opcional)';
        detalle.focus();
      } }, t));

      const volver = h('button.btn', { type: 'button', onclick: () => m.cerrar() }, 'No anular, volver');
      const seguir = h('button.btn.peligro.grande', { type: 'button', onclick: async () => {
        const det = detalle.value.trim();
        if (!elegido) { error.textContent = 'Escoja uno de los motivos de arriba.'; error.hidden = false; return; }
        if (elegido === 'Otro motivo' && det.length < 5) { error.textContent = 'Escriba cuál fue el motivo (mínimo 5 letras).'; error.hidden = false; detalle.focus(); return; }
        // Hacienda guarda esta razón en la nota de crédito: motivo, y el detalle si lo hay (máximo 180 letras)
        const razon = (elegido === 'Otro motivo' ? det : elegido + (det ? ': ' + det : '')).slice(0, 180);
        error.hidden = true;
        seguir.disabled = true;
        try {
          const ok = await confirmar(`Se va a crear la nota de crédito por ${money(d.total)} que anula ${nombre} N.° ${numeroCorto(d.consecutivo)}. Motivo: ${razon}. Esto no se puede deshacer. ¿Anular de verdad?`, { si: 'Sí, anular', no: 'No, volver', peligro: true });
          if (!ok) return;
          const nc = await app.api.notaCredito(d.id, razon, app.terminal);
          m.cerrar();
          resultado(d, nc);
          await cargar(true);
        } catch (e) { toast(e.message || String(e), 'error', 7000); } finally { seguir.disabled = false; }
      } }, 'Anular');

      const m = modal({ titulo: 'Anular ' + (d.tipo_doc === '01' ? 'factura' : 'tiquete'), ancho: 620,
        contenido: h('div.an-dlg',
          h('div.an-resumen',
            h('div', h('b', `${NOMBRE_TIPO[d.tipo_doc]} N.° ${numeroCorto(d.consecutivo)}`), h('span.tenue', ' · ' + horaCorta(d.fecha_emision))),
            h('div', d.cliente ? nombrePropio(d.cliente) : 'Consumidor final'),
            h('div.an-resumen-total', money(d.total))),
          detalleLineas,
          h('div.an-explica',
            h('p', h('b', 'Qué pasa si sigue:')),
            h('ul',
              h('li', `Se emite una nota de crédito por ${money(d.total)} que referencia ${nombre} y la deja sin efecto ante Hacienda.`),
              h('li', 'Se anula toda la venta, no una parte. Si hay que cobrar de nuevo, haga la venta nueva en Caja.'),
              h('li', 'La nota de crédito se envía sola a Hacienda en el próximo minuto.'),
              h('li', 'Este paso no mueve dinero: si hay que devolver efectivo, lo maneja usted en la caja.'))),
          h('div.an-etq', '¿Por qué se anula? (Hacienda lo pide)'),
          h('div.an-motivos', botonesMotivo),
          etqDetalle) });
      // Los dos botones quedan fuera de la parte que se desplaza: se ven siempre, aunque la ventana sea más alta que la pantalla
      m.el.append(h('div.modal-pie.an-pie', error, volver, seguir));
    }

    function resultado(d, nc) {
      const imp = h('button.btn.primario', { type: 'button', onclick: async () => { imp.disabled = true; try { await imprimirComprobante(nc.id, { formato: 'tiquete', copias: 1 }); } catch (e) { toast(e.message || String(e), 'error', 7000); } finally { imp.disabled = false; } } }, 'Imprimir la nota de crédito');
      const nueva = h('button.btn', { type: 'button', onclick: () => { r.cerrar(); app.ir?.('caja'); } }, 'Hacer la venta de nuevo en Caja');
      const r = modal({ titulo: 'Listo, quedó anulada', ancho: 560, contenido: h('div.an-dlg',
        h('div.an-ok', h('b', `Se creó la nota de crédito N.° ${numeroCorto(nc.consecutivo)}.`), h('div', `Anula ${conArticulo(d.tipo_doc)} N.° ${numeroCorto(d.consecutivo)} por ${money(d.total)}.`)),
        h('p', nc.estado === 'aceptado' ? 'Hacienda ya la aceptó.' : 'Se enviará a Hacienda en el próximo minuto y su estado cambia solo.'),
        h('div.an-botones', imp, nueva, h('button.btn', { type: 'button', onclick: () => r.cerrar() }, 'Cerrar'))) });
    }

    /* ---------- arranque y actualización automática ---------- */
    pintarControles();
    await cargar();
    // Los documentos cambian de estado solos (en cola, enviado, aceptado): se actualiza cada 20 segundos
    const reloj = setInterval(() => {
      if (document.hidden || !root.isConnected) return;
      if (Date.now() - ultimaCarga < 15000) return;
      cargar(true);
    }, 20000);
    return () => clearInterval(reloj);
  },
};
