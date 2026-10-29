// Anular y reimprimir: una sola ventana con los documentos del día (Este turno primero, Hoy, Ayer y otras fechas), buscador por número, cliente, cédula o monto,
// y en cada fila los botones «Reimprimir» y «Anular». Tocar la fila abre el detalle (estado en Hacienda, «Ya lo atendí», archivos, reenvíos).
// La anulación con nota de crédito es la de m_anular.js; la impresión es la de imprimir.js.
import { h, money, modal, toast, descargar, hoyCR, sumaDias, fechaHora, horaCorta, debounce, num, r2, nombrePropio, traducirHacienda, campoBusqueda, TIPOS_SERVICIO, MEDIOS, TIPOS_ID } from './util.js';
import { documentos, ncDe, CORREO_ACTIVO, reenviarCorreo, alertaAtender, hacerVentaDeNuevo } from './api_documentos.js';
import { anularDocumento } from './m_anular.js';
import { sumarDocumentos, frasesDeLista, puenteConTurno } from './cuadre_turno.js';
import { imprimirComprobante, reimprimirComprobante, formatoDireccion, formatoCedula, formatoTelefono, numeroCorto, NOMBRES_DOCUMENTO } from './imprimir.js';

if (!document.querySelector('link[data-fx-documentos]')) document.head.append(h('link', { rel: 'stylesheet', href: new URL('../css/documentos.css', import.meta.url).href, 'data-fx-documentos': '1' }));

const TZ = 'America/Costa_Rica';
const fmtDia = new Intl.DateTimeFormat('es-CR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fmtDiaCorto = new Intl.DateTimeFormat('es-CR', { timeZone: TZ, day: 'numeric', month: 'long' });
const diaTxt = (ymd) => { const t = fmtDia.format(new Date(ymd + 'T12:00:00Z')); return t.charAt(0).toUpperCase() + t.slice(1); };
const diaCortoTxt = (ymd) => fmtDiaCorto.format(new Date(ymd + 'T12:00:00Z'));
const ymdDe = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(iso));
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const ETQ_ESTADO = { pendiente: 'En cola', enviado: 'Enviado', aceptado: 'Aceptado', rechazado: 'Rechazado', error: 'Con error' };
const CLASE_ESTADO = { pendiente: 'espera', enviado: 'espera', aceptado: 'ok', rechazado: 'mal', error: 'mal' };
const NOMBRE_TIPO = { ...NOMBRES_DOCUMENTO, '01': 'Factura', '03': 'Nota de crédito', '04': 'Tiquete' }; // nombres cortos para la lista
const esVenta = (d) => d.tipo_doc === '01' || d.tipo_doc === '04';
const mediosTxt = (m) => (m ? m.split(', ').map((x) => MEDIOS[x] || x).join(' y ') : '');
const signo = (d) => (d.tipo_doc === '03' ? -1 : 1);
/* ------------------------------------------------------------------ módulo */

export default {
  id: 'anular',
  titulo: 'Anular y reimprimir',
  async mount(root, app) {
    const est = { rango: 'hoy', desde: hoyCR(), hasta: hoyCR(), q: '', filtro: 'todos', lista: [], cargando: false, error: null, turnoEstado: null, firma: null };
    let nCarga = 0; // cada carga lleva su número: si llega tarde la respuesta de una anterior (por ejemplo «Ayer» y enseguida «Hoy»), se descarta
    // «Este turno» es el primer filtro (desde la hora en que se abrió la caja). Si el turno abierto empezó antes de hoy (cruzó la medianoche), es el que se abre por omisión.
    const turnoAbierto = () => app.turno || null;
    if (turnoAbierto() && ymdDe(turnoAbierto().abierto_en) < hoyCR()) { est.rango = 'turno'; est.desde = ymdDe(turnoAbierto().abierto_en); }
    // Si otra pantalla pidió ver los problemas (el aviso rojo del encabezado), se abre con ese filtro y con las mismas fechas del aviso
    const pedido = app.pedido; app.pedido = null;
    if (pedido?.filtro === 'problemas') {
      est.filtro = 'problemas';
      if (pedido.desde && /^\d{4}-\d{2}-\d{2}$/.test(pedido.desde) && pedido.desde < est.hasta) { est.rango = 'otro'; est.desde = pedido.desde; }
    }
    const alFinal = pedido?.foco === 'buscar'; // el botón rojo «Anular factura» del encabezado trae el cursor al buscador
    let detalleActual = null;
    let ultimaCarga = 0;

    /* ---------- encabezado y controles ---------- */
    const rangoDe = (r) => {
      const hoy = hoyCR();
      if (r === 'turno' && turnoAbierto()) return [ymdDe(turnoAbierto().abierto_en), hoy];
      if (r === 'hoy') return [hoy, hoy];
      if (r === 'ayer') { const a = sumaDias(hoy, -1); return [a, a]; }
      if (r === 'semana') { const dow = new Date(hoy + 'T12:00:00Z').getUTCDay(); return [sumaDias(hoy, -((dow + 6) % 7)), hoy]; }
      return [est.desde, est.hasta];
    };
    const titulo = h('p.doc-fecha');
    const botonesRango = h('div.doc-rango', { role: 'group', 'aria-label': 'Fechas a mostrar' },
      [turnoAbierto() ? ['turno', 'Este turno'] : null, ['hoy', 'Hoy'], ['ayer', 'Ayer'], ['otro', 'Otras fechas']].filter(Boolean).map(([r, t]) =>
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
    const buscador = h('input.campo#anular-buscar', { type: 'search', placeholder: 'Número, cliente, cédula o monto', 'aria-label': 'Buscar documento por número, cliente, cédula o monto', autocomplete: 'off',
      oninput: debounce((e) => { est.q = e.target.value; pintar(); }, 150) });
    const buscadorFila = campoBusqueda(buscador, () => { est.q = ''; pintar(); });
    const refrescar = h('button.btn', { type: 'button', onclick: async () => { refrescar.disabled = true; await cargar(); refrescar.disabled = false; } }, 'Actualizar');
    const zonaResumen = h('div');
    const zonaCuadre = h('div.doc-cuadre-zona');
    const zonaFiltros = h('div.doc-filtros');
    const zonaLista = h('div.doc-lista');

    root.append(h('div.doc-mod',
      h('div.doc-buscar', buscadorFila),
      botonesRango, h('div.doc-fecha-fila', titulo, refrescar), cajaFechas, zonaResumen, zonaCuadre, zonaFiltros,
      h('p.doc-ayuda', 'Toque una fila para ver el detalle. «Anular» crea una nota de crédito: el documento original no se borra.'),
      zonaLista));

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
      if (est.rango === 'turno' && turnoAbierto()) { titulo.textContent = 'Este turno: desde el ' + diaCortoTxt(ymdDe(turnoAbierto().abierto_en)) + ' a las ' + horaCorta(turnoAbierto().abierto_en) + ', hasta ahora'; return; }
      titulo.textContent = !una ? `Del ${diaCortoTxt(est.desde)} al ${diaCortoTxt(est.hasta)}` : pre ? pre + fmtDia.format(new Date(est.desde + 'T12:00:00Z')) : diaTxt(est.desde);
    }

    /* ---------- carga ---------- */
    async function cargar(silencioso = false) {
      const mi = ++nCarga;
      pintarControles();
      if (!silencioso) { est.cargando = true; est.error = null; est.firma = null; pintar(); }
      try {
        // Lo más reciente va arriba (igual que en «Anular factura»): lo último que hizo la cajera se ve sin bajar
        if (est.rango === 'turno' && !turnoAbierto()) { est.rango = 'hoy'; [est.desde, est.hasta] = rangoDe('hoy'); pintarControles(); } // la caja se cerró mientras tanto
        const desdeTurno = est.rango === 'turno' ? new Date(turnoAbierto().abierto_en).getTime() : 0;
        // En «Este turno» también se lee el estado del turno, para mostrar cómo cuadra esta cifra con la de «Apertura y cierre de caja» (si no se puede leer, solo falta esa explicación)
        const turnoId = est.rango === 'turno' ? turnoAbierto()?.id : null;
        const [filas, turno] = await Promise.all([documentos(app.soc.id, est.desde, est.hasta), turnoId ? app.api.turnoEstado(turnoId).catch(() => null) : null]);
        if (mi !== nCarga) return; // llegó tarde: ya se pidió otra cosa
        const lista = filas.filter((d) => !desdeTurno || new Date(d.fecha_emision).getTime() >= desdeTurno).sort((a, b) => new Date(b.fecha_emision) - new Date(a.fecha_emision));
        // En el refresco automático solo se vuelve a pintar si algo cambió; así no se pierde lo que la cajera esté escribiendo ni se mueve la pantalla
        est.lista = lista; est.turnoEstado = turno;
        const firma = JSON.stringify([lista, turno]) + '|' + lista.filter(esProblema).length; // esProblema cambia con el reloj (más de 15 minutos esperando a Hacienda)
        if (silencioso && !est.error && est.firma && firma === est.firma) { ultimaCarga = Date.now(); return; }
        est.firma = firma;
        est.error = null;
      } catch (e) { if (mi !== nCarga) return; if (!silencioso) est.error = e.message || String(e); }
      est.cargando = false; ultimaCarga = Date.now();
      pintar();
    }

    /* ---------- resumen, filtros y lista ---------- */
    function coincide(d) {
      const q = est.q.trim();
      if (!q) return true;
      // cliente_identificacion (la cédula) la trae fx_documentos cuando el servidor la incluye; si no viene, la búsqueda por cédula no encuentra nada y lo demás sigue igual
      const texto = norm([NOMBRE_TIPO[d.tipo_doc], NOMBRES_DOCUMENTO[d.tipo_doc], d.cliente || 'consumidor final', d.cliente_identificacion, d.venta_numero, d.referencia, d.consecutivo, numeroCorto(d.consecutivo), mediosTxt(d.medios), d.ref_consecutivo, d.nc_consecutivo].join(' '));
      if (texto.includes(norm(q))) return true;
      if (!/^[\d\s.,₡]+$/.test(q)) return false; // solo un número escrito se compara con montos y consecutivos
      const dig = q.replace(/\D/g, '');
      if (!dig) return false;
      const t = Number(d.total) || 0;
      return String(Math.trunc(t)).includes(dig) || t.toFixed(2).replace('.', '').includes(dig) || String(d.consecutivo).includes(dig) || String(d.cliente_identificacion || '').replace(/\D/g, '').includes(dig);
    }
    const esPendiente = (d) => d.estado === 'pendiente' || d.estado === 'enviado';
    // «Con problemas» = lo mismo que cuenta el aviso rojo: rechazados (salvo los que solo traen un aviso o ya se rehicieron bien), con error, o que llevan más de 15 minutos esperando a Hacienda
    const soloAviso = (d) => { const it = traducirHacienda(d.mensaje).items; return it.length > 0 && it.every((x) => x.codigo === '-37'); };
    const reemplazado = (d) => est.lista.some((n) => n.id !== d.id && n.tipo_doc === d.tipo_doc && ['aceptado', 'pendiente', 'enviado'].includes(n.estado) && new Date(n.fecha_emision) > new Date(d.fecha_emision)
      && ((d.venta_numero && n.venta_numero === d.venta_numero) || (d.comprobante_ref && n.comprobante_ref === d.comprobante_ref)));
    const esProblema = (d) => ((d.estado === 'error' || d.estado === 'rechazado') && !(d.estado === 'rechazado' && soloAviso(d)) && !reemplazado(d) && !d.atendida)
      || (esPendiente(d) && Date.now() - new Date(d.fecha_emision).getTime() > 15 * 60000);

    function pintar() {
      pintarControles();
      if (est.cargando && !est.lista.length) { zonaResumen.replaceChildren(); zonaCuadre.replaceChildren(); zonaFiltros.replaceChildren(); zonaLista.replaceChildren(h('p.cargando', 'Cargando los documentos…')); return; }
      if (est.error) {
        zonaResumen.replaceChildren(); zonaCuadre.replaceChildren(); zonaFiltros.replaceChildren();
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
      const s = sumarDocumentos(est.lista);
      const una = est.desde === est.hasta;
      zonaResumen.replaceChildren(h('div.doc-resumen',
        h('div.doc-neto', h('span.doc-etq', est.rango === 'turno' ? 'Total de este turno' : una ? (est.rango === 'hoy' ? 'Total de hoy' : 'Total del día') : 'Total de las fechas elegidas'), h('b.doc-gran', money(s.neto))),
        h('span.doc-det-res', `${s.nVentas} ${s.nVentas === 1 ? 'venta' : 'ventas'}`, s.nNC ? `, ${s.nNC} ${s.nNC === 1 ? 'anulación' : 'anulaciones'}` : '', ` · IVA incluido ${money(s.iva / 100)}`)));
      pintarCuadre(s);
    }

    // Qué no suma y qué sí suma este total, y cómo cuadra con «Apertura y cierre de caja» (mismas frases y montos que en esa pantalla)
    function pintarCuadre(s) {
      const frases = frasesDeLista(s);
      const p = est.rango === 'turno' ? puenteConTurno(s, est.turnoEstado) : null;
      const partes = frases.map((t) => h('p.doc-cuadre-frase', t));
      if (p && p.coincide && !p.turnoRech && !p.sin) partes.push(h('p.doc-cuadre-frase.ok', `Coincide con el total vendido de «Apertura y cierre de caja» (${money(p.turnoNeto / 100)}).`));
      else if (p) {
        const fila = (txt, monto, clase = '') => h('div.doc-cuadre-fila' + clase, h('span', txt), h('b', money(monto / 100)));
        partes.push(h('details.doc-cuadre',
          h('summary.btn', `Comparar con «Apertura y cierre de caja» (${money(p.turnoNeto / 100)})`),
          h('div.doc-cuadre-cuerpo',
            fila('Total vendido en «Apertura y cierre de caja», sin las ventas anuladas', p.turnoNeto),
            p.turnoRech ? fila('Menos las ventas cuyo documento Hacienda no aceptó (allá sí se suman)', p.turnoRech) : null,
            p.sin ? fila(`Más ${p.sinN === 1 ? '1 documento sin cuenta de caja' : p.sinN + ' documentos sin cuenta de caja'} (allá no se suman)`, p.sin) : null,
            p.otras ? fila('Otras diferencias, por ejemplo notas de crédito de ventas de otro turno', p.otras) : null,
            fila('Total de esta lista', p.lista, '.total'))));
      }
      zonaCuadre.replaceChildren(...(partes.length ? [h('div.doc-cuadre-caja', partes)] : []));
    }

    function pintarLista(visibles) {
      if (!visibles.length) {
        zonaLista.replaceChildren(h('div.vacio',
          est.lista.length ? h('p', 'Ningún documento coincide con lo que buscó.')
            : h('p', est.rango === 'turno' ? 'Todavía no hay documentos en este turno. Cuando cobre una venta en Facturación, aparecerá aquí.' : est.rango === 'hoy' ? 'Todavía no hay documentos hoy. Cuando cobre una venta en Facturación, aparecerá aquí.' : 'No hay documentos en estas fechas.'),
          !est.lista.length && (est.rango === 'hoy' || est.rango === 'turno') ? h('button.btn.primario', { onclick: () => app.ir('caja') }, 'Ir a Facturación') : null));
        return;
      }
      const dias = new Map();
      for (const d of visibles) { const k = ymdDe(d.fecha_emision); if (!dias.has(k)) dias.set(k, []); dias.get(k).push(d); }
      const multi = dias.size > 1 || est.desde !== est.hasta;
      const out = [];
      for (const [dia, docs] of dias) {
        if (multi) {
          let t = 0; for (const d of docs) if (d.estado !== 'rechazado') t += signo(d) * Math.round((Number(d.total) || 0) * 100);
          out.push(h('div.doc-dia', h('b', diaTxt(dia)), h('span', `${docs.length} ${docs.length === 1 ? 'documento' : 'documentos'}, total ${money(t / 100)}`)));
        }
        out.push(h('div.doc-cabeza', h('div.doc-cabeza-cols', h('span', 'Hora'), h('span', 'Documento'), h('span', 'Cliente'), h('span.der', 'Total'), h('span', 'Estado')), h('span.doc-cabeza-acc', 'Acciones')));
        for (const d of docs) out.push(fila(d));
      }
      zonaLista.replaceChildren(...out);
    }

    // Una fila = la zona que se toca para ver el detalle + los botones «Reimprimir» y «Anular» (o «Ver y atender» si Hacienda no lo aceptó)
    function fila(d) {
      const anulado = !!d.nc_id;
      const nc = d.tipo_doc === '03';
      const tipo = NOMBRE_TIPO[d.tipo_doc] || 'Comprobante';
      const quien = `${tipo.toLowerCase()} número ${numeroCorto(d.consecutivo)} por ${money(d.total)}`;
      const reimprimir = h('button.btn.doc-bot', { type: 'button', 'aria-label': 'Reimprimir ' + quien, onclick: () => reimprimirComprobante(d.id) }, 'Reimprimir');
      let segundo = null;
      if (esVenta(d)) {
        if (anulado) segundo = null;
        else if (d.estado === 'aceptado') segundo = h('button.btn.peligro.doc-bot', { type: 'button', 'aria-label': 'Anular ' + quien, onclick: () => anularDocumento(app, d, { alTerminar: () => cargar(true), alVerNC: (n) => abrirDetalle(n.id) }) }, 'Anular');
        else if (d.estado === 'rechazado' || d.estado === 'error') segundo = h('button.btn.doc-bot', { type: 'button', 'aria-label': (d.atendida ? 'Ver detalle de ' : 'Ver y atender ') + quien, onclick: () => abrirDetalle(d.id) }, d.atendida ? 'Ver detalle' : 'Ver y atender'); // el nombre accesible empieza con el mismo texto que se ve
        else segundo = h('button.btn.peligro.doc-bot', { type: 'button', disabled: true, title: 'Se podrá anular cuando Hacienda lo acepte (casi siempre menos de un minuto)', 'aria-label': 'Anular ' + quien + '. Todavía no se puede: Hacienda no lo ha aceptado' }, 'Anular');
      }
      return h('div.doc-fila' + (nc ? '.nc' : '') + (anulado ? '.anulada' : ''),
        h('button.doc-ver', { type: 'button', onclick: () => abrirDetalle(d.id), 'aria-label': `${tipo} número ${numeroCorto(d.consecutivo)}, ${money(d.total)}. Toque para ver el detalle` },
          h('span.c-hora', horaCorta(d.fecha_emision)),
          h('span.c-doc', h('span.nw', h('b', tipo), ' N.° ' + numeroCorto(d.consecutivo)),
            anulado ? h('span.sub.anul', `Anulado por la nota de crédito N.° ${numeroCorto(d.nc_consecutivo)}`) : null,
            nc && d.ref_consecutivo ? h('span.sub', `Referencia a ${(NOMBRE_TIPO[d.ref_tipo] || 'documento').toLowerCase()} N.° ${numeroCorto(d.ref_consecutivo)}`) : null),
          h('span.c-cli', d.cliente ? nombrePropio(d.cliente) : h('span.tenue', 'Consumidor final'), h('span.sub', mediosTxt(d.medios) || (nc ? '' : 'Sin pago'))),
          h('span.c-total.der', (nc ? '−' : '') + money(d.total)),
          h('span.c-est', h('span.chip.' + (CLASE_ESTADO[d.estado] || ''), ETQ_ESTADO[d.estado] || d.estado), anulado ? h('span.chip.anulado', 'Anulado') : null, d.atendida && d.estado === 'rechazado' ? h('span.chip.anulado', 'Atendido') : null)),
        h('div.doc-fbot' + (segundo ? '' : '.una'), reimprimir, segundo));
    }

    /* ---------- detalle de un documento ---------- */
    async function abrirDetalle(id) {
      const caja = h('div.doc-det', h('p.cargando', 'Cargando el documento…'));
      let vivo = true;
      let firma = null; // lo último que se pintó; el refresco automático solo vuelve a pintar si el documento cambió
      let nCarga = 0;
      const borrador = { nota: '' }; // la nota que se está escribiendo no se pierde si la ventana se vuelve a pintar
      const m = modal({ titulo: 'Detalle del documento', contenido: caja, ancho: 780, alCerrar: () => { vivo = false; if (detalleActual?.caja === caja) detalleActual = null; } });
      const pintarDet = async (silencioso = false) => {
        const mi = ++nCarga;
        try {
          let falloNC = false;
          const [c, nc] = await Promise.all([app.api.comprobante(id), ncDe(id).catch(() => { falloNC = true; return null; })]);
          if (!vivo || mi !== nCarga) return;
          if (silencioso && falloNC) return; // si no se pudo ver la nota de crédito, mejor no cambiar lo que ya se ve
          const nueva = JSON.stringify([c, nc]);
          if (silencioso && nueva === firma) return; // nada cambió: no se toca la pantalla (ni el cursor, ni el teclado del celular)
          firma = nueva;
          // Si había un campo con el cursor adentro, después de pintar vuelve a quedar ahí, en el mismo lugar
          const foco = caja.contains(document.activeElement) && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)
            ? { etiqueta: document.activeElement.getAttribute('aria-label'), ini: document.activeElement.selectionStart, fin: document.activeElement.selectionEnd } : null;
          caja.replaceChildren(vistaDetalle(c, nc, { repintar: pintarDet, cerrar: m.cerrar, borrador }));
          if (foco?.etiqueta) {
            const campo = [...caja.querySelectorAll('input,textarea')].find((x) => x.getAttribute('aria-label') === foco.etiqueta);
            if (campo) { campo.focus({ preventScroll: true }); try { campo.setSelectionRange(foco.ini, foco.fin); } catch { /* campo sin cursor */ } }
          }
        } catch (e) { if (vivo && mi === nCarga && !silencioso) caja.replaceChildren(h('div.error-caja', e.message || String(e))); }
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
        rechazado: 'Hacienda no aceptó este documento, así que no es válido y no necesita nota de crédito. Si fue una venta real, hay que hacerla de nuevo en Facturación.',
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
          h('div.doc-botones', accion({ texto: 'Anular con nota de crédito', clase: 'peligro', onclick: () => anularDocumento(app, { ...c, cliente: c.cliente_snapshot?.nombre || '' }, { alTerminar: async () => { await ctx.repintar(true); await cargar(true); }, alVerNC: (n) => { ctx.cerrar(); abrirDetalle(n.id); } }) })));
      } else if (c.estado === 'rechazado') {
        g.append(h('p.tenue', 'Hacienda rechazó este documento, así que ya no vale y no necesita nota de crédito.'), bloqueAtender(c, ctx));
      } else {
        g.append(h('p.tenue', 'Para anularlo hay que esperar a que Hacienda lo acepte (normalmente menos de un minuto). Cierre esta ventana y vuelva a abrirla en un momento.'),
          h('div.doc-botones', accion({ texto: 'Anular con nota de crédito', clase: 'peligro', disabled: true, hint: 'Primero debe estar aceptado por Hacienda' })));
      }
      return g;
    }

    /* ---------- documento rechazado: «Ya lo atendí» y rehacer la venta ---------- */
    // «Ya lo atendí» saca el documento del aviso rojo del encabezado (fx_alerta_atender). El documento NO se borra: sigue en esta ventana y en Informes.
    function bloqueAtender(c, ctx) {
      const caja = h('div.doc-atender');
      const at = c.atendida; // { por, en, nota } o null
      if (at) {
        caja.append(h('div.doc-aviso.ref', h('div', h('b', 'Ya está marcado como atendido. '), 'Ya no sale en el aviso rojo, y el documento sigue en esta ventana y en Informes.',
          h('div.doc-motivo', [at.por ? 'Lo marcó ' + at.por + '. ' : '', at.en ? fechaHora(at.en) : '', at.nota ? '. Nota: ' + at.nota : ''].join('')))));
      } else {
        const nota = h('input.campo', { type: 'text', maxlength: 300, placeholder: 'Por ejemplo: se hizo la venta de nuevo en Facturación', 'aria-label': 'Nota (opcional)', autocomplete: 'off', value: ctx.borrador?.nota || '',
          oninput: (e) => { if (ctx.borrador) ctx.borrador.nota = e.target.value; } });
        const ya = accion({ texto: 'Ya lo atendí', hint: 'Apaga el aviso rojo. El documento no se borra.', clase: 'primario.grande', onclick: async () => {
          await alertaAtender(c.id, nota.value);
          toast('Quedó anotado como atendido. El documento sigue en esta ventana y en Informes.');
          app.alertas?.refrescar?.();
          await ctx.repintar(true); await cargar(true);
        } });
        caja.append(h('label.etq', 'Nota (opcional)', h('small', 'Sirve para que otra persona sepa qué se hizo.'), nota), ya);
      }
      if (esVenta(c) && c.venta_id) caja.append(h('div.doc-botones', accion({ texto: 'Hacer la venta de nuevo en Facturación', hint: 'Copia las líneas a una cuenta nueva y abre Facturación.', onclick: async () => { ctx.cerrar(); await hacerVentaDeNuevo(app, c.venta_id, toast); } })));
      return caja;
    }

    /* ---------- arranque y actualización automática ---------- */
    pintarControles();
    await cargar();
    if (alFinal) buscador.focus(); // desde el botón rojo «Anular factura»: el cursor queda en el buscador
    // Los documentos cambian de estado solos (en cola, enviado, aceptado): se actualiza la lista cada 20 segundos
    const reloj = setInterval(() => {
      if (document.hidden || !root.isConnected) return;
      if (Date.now() - ultimaCarga < 15000) return;
      cargar(true); detalleActual?.repintar(true);
    }, 20000);
    return () => clearInterval(reloj);
  },
};
