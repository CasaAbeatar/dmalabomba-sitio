// Anular y reimprimir: una sola ventana con los documentos de Hoy, Este mes, Mes anterior o Cualquier fecha, buscador por número, cliente, cédula, estado o monto,
// y en cada fila los botones «Reimprimir» y «Anular». La lista se pinta por tandas («Mostrar más»): la búsqueda y los filtros actúan sobre todo lo cargado. Tocar la fila abre el detalle (estado en Hacienda, «Ya lo atendí», archivos, reenvíos).
// La anulación con nota de crédito es la de m_anular.js; la impresión es la de imprimir.js.
import { h, money, modal, toast, descargar, hoyCR, sumaDias, fechaHora, horaCorta, debounce, num, r2, nombrePropio, nombreLocal, traducirHacienda, campoBusqueda, TIPOS_SERVICIO, MEDIOS, TIPOS_ID } from './util.js';
import { documentos, anulacionDe, saldosDe, permiteAnular, otrasNotas, sinEfectoDeSaldos, correoActivo, reenviarCorreo, alertaAtender, hacerVentaDeNuevo, mensajeAmable } from './api_documentos.js';
import { anularDocumento, cambiarCliente, textoCodigoNota, codigoDeNota, sustituyeSoportado, listaNotas, TEXTO_07 } from './m_anular.js';
import { devolverParte, corregirMonto, dejarSinEfecto } from './m_nota_parcial.js';
import { selectorCliente } from './ui_cliente.js';
import { sumarDocumentos, frasesDeLista, puenteConTurno, docsDelTurno } from './cuadre_turno.js';
import { imprimirComprobante, reimprimirComprobante, formatoDireccion, formatoCedula, formatoTelefono, numeroCorto, NOMBRES_DOCUMENTO } from './imprimir.js';
import { crearDescarga, nombrePeriodo } from './descargas.js';
import { textoRango } from './periodo.js';

if (!document.querySelector('link[data-fx-documentos]')) document.head.append(h('link', { rel: 'stylesheet', href: new URL('../css/documentos.css', import.meta.url).href, 'data-fx-documentos': '1' }));

const TZ = 'America/Costa_Rica';
const fmtDia = new Intl.DateTimeFormat('es-CR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fmtDiaCorto = new Intl.DateTimeFormat('es-CR', { timeZone: TZ, day: 'numeric', month: 'long' });
const diaTxt = (ymd) => { const t = fmtDia.format(new Date(ymd + 'T12:00:00Z')); return t.charAt(0).toUpperCase() + t.slice(1); };
const diaCortoTxt = (ymd) => fmtDiaCorto.format(new Date(ymd + 'T12:00:00Z'));
// Día (AAAA-MM-DD, hora de Costa Rica) de un instante. El formateador se crea una sola vez y el resultado se recuerda: con miles de documentos, crear un formateador por documento era lo más lento de la pantalla.
const fmtYmd = new Intl.DateTimeFormat('en-CA', { timeZone: TZ });
const cacheYmd = new Map();
const ymdDe = (iso) => { let v = cacheYmd.get(iso); if (v === undefined) { v = fmtYmd.format(new Date(iso)); if (cacheYmd.size > 30000) cacheYmd.clear(); cacheYmd.set(iso, v); } return v; };
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// La frase «El nuevo indicará que sustituye a este» solo se puede decir cuando la base guarde la referencia de un comprobante rechazado
// (hoy fx_cobrar_reemplazo solo reemplaza documentos aceptados que ya tienen nota de crédito). Se enciende junto con ese cambio.
const SUSTITUYE_RECHAZADO = false;
// Nombres de los estados: los mismos en toda la aplicación
const ETQ_ESTADO = { pendiente: 'Por enviar a Hacienda', enviado: 'Enviado a Hacienda', aceptado: 'Aceptado por Hacienda', rechazado: 'Rechazado por Hacienda', error: 'No se pudo enviar' };
const PAGINA_ESCRITORIO = 100, PAGINA_CELULAR = 50; // documentos por página (la búsqueda y los filtros miran todos, no solo la página)
const esCelular = () => { try { return window.matchMedia('(max-width:700px)').matches; } catch { return false; } };
const porPagina = () => (esCelular() ? PAGINA_CELULAR : PAGINA_ESCRITORIO);
const fmtMes = new Intl.DateTimeFormat('es-CR', { timeZone: 'UTC', month: 'long', year: 'numeric' });
const mesTxt = (ymd) => { const t = fmtMes.format(new Date(ymd + 'T12:00:00Z')); return t.charAt(0).toUpperCase() + t.slice(1); }; // «Octubre de 2026»
export const primerDiaMes = (ymd) => ymd.slice(0, 8) + '01';
// Último día del mes anterior y primer día del mes anterior (sirve en enero y en años bisiestos: Date.UTC con día 0 es el último día del mes anterior)
export const mesAnterior = (ymd) => { const y = Number(ymd.slice(0, 4)), m = Number(ymd.slice(5, 7)); return [new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10), new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10)]; };
const CLASE_ESTADO = { pendiente: 'espera', enviado: 'espera', aceptado: 'ok', rechazado: 'mal', error: 'mal' };
const NOMBRE_TIPO = { ...NOMBRES_DOCUMENTO, '01': 'Factura', '02': 'Nota de débito', '03': 'Nota de crédito', '04': 'Tiquete' }; // nombres cortos para la lista
const esVenta = (d) => d.tipo_doc === '01' || d.tipo_doc === '04';
const MAX_DOCUMENTOS = 1000; // fx_documentos devuelve a lo sumo 1 000 documentos por consulta (los más antiguos del rango)
const paraArchivo = (t, max = 40) => String(t || '').replace(/[^\p{L}\p{N} .,&'()-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim();
const mediosTxt = (m) => (m ? m.split(', ').map((x) => MEDIOS[x] || x).join(' y ') : '');
const signo = (d) => (d.tipo_doc === '03' ? -1 : 1);
/* ------------------------------------------------------------------ módulo */

export default {
  id: 'anular',
  titulo: 'Anular y reimprimir',
  async mount(root, app) {
    const est = { rango: 'hoy', desde: hoyCR(), hasta: hoyCR(), q: '', filtro: 'todos', tarifa: '', lista: [], cargando: false, error: null, turnoEstado: null, firma: null, pagina: 1 };
    let nCarga = 0; // cada carga lleva su número: si llega tarde la respuesta de una anterior (por ejemplo «Este mes» y enseguida «Hoy»), se descarta
    // Con la caja abierta, «Hoy» es el turno: si el turno abrió en un día anterior (cruzó la medianoche), «Hoy» arranca en la hora de apertura,
    // y el cuadre con «Apertura y cierre de caja» sigue saliendo cuando el rango es «Hoy».
    const turnoAbierto = () => app.turno || null;
    const turnoDeAyer = () => (turnoAbierto() && ymdDe(turnoAbierto().abierto_en) < hoyCR() ? turnoAbierto() : null);
    est.desde = turnoDeAyer() ? ymdDe(turnoDeAyer().abierto_en) : hoyCR();
    // Si otra pantalla pidió ver los problemas (el aviso rojo del encabezado), se abre con ese filtro y con las mismas fechas del aviso (esas fechas caen en «Cualquier fecha»)
    const pedido = app.pedido; app.pedido = null;
    if (pedido?.filtro === 'problemas') {
      est.filtro = 'problemas';
      if (pedido.desde && /^\d{4}-\d{2}-\d{2}$/.test(pedido.desde) && pedido.desde < est.hasta) { est.rango = 'otro'; est.desde = pedido.desde; }
    }
    const alFinal = pedido?.foco === 'buscar'; // el botón rojo «Anular factura» del encabezado trae el cursor al buscador
    const verDocumento = typeof pedido?.comprobante === 'string' ? pedido.comprobante : null; // «Me equivoqué» del cobro abre el documento recién emitido
    let detalleActual = null;
    let ultimaCarga = 0;
    let cacheTexto = new WeakMap(); // texto normalizado de cada documento para el buscador (se arma una vez por carga)

    /* ---------- encabezado y controles ---------- */
    const rangoDe = (r) => {
      const hoy = hoyCR();
      if (r === 'hoy') return [turnoDeAyer() ? ymdDe(turnoDeAyer().abierto_en) : hoy, hoy];
      if (r === 'mes') return [primerDiaMes(hoy), hoy]; // del día 1 a hoy, en hora de Costa Rica
      if (r === 'anterior') return mesAnterior(hoy);    // del día 1 al último día del mes anterior
      return [est.desde, est.hasta];
    };
    const titulo = h('p.doc-fecha');
    const botonesRango = h('div.doc-rango', { role: 'group', 'aria-label': 'Fechas a mostrar' },
      [['hoy', 'Hoy'], ['mes', 'Este mes'], ['anterior', 'Mes anterior'], ['otro', 'Cualquier fecha']].map(([r, t]) =>
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
    const buscador = h('input.campo#anular-buscar', { type: 'search', placeholder: 'Número, cliente, cédula, estado o monto', 'aria-label': 'Buscar documento por número, cliente, cédula, estado, monto o rango de montos, por ejemplo 5000-20000', autocomplete: 'off',
      oninput: debounce((e) => { est.q = e.target.value; est.pagina = 1; pintar(); }, 150) });
    const buscadorFila = campoBusqueda(buscador, () => { est.q = ''; est.pagina = 1; pintar(); });
    const refrescar = h('button.btn', { type: 'button', onclick: async () => { refrescar.disabled = true; await cargar(); refrescar.disabled = false; } }, 'Actualizar');
    const zonaResumen = h('div');
    const zonaCuadre = h('div.doc-cuadre-zona');
    const zonaFiltros = h('div.doc-filtros');
    const zonaLista = h('div.doc-lista');
    const zonaCabeza = h('div.doc-lista-cab');                       // «N documentos» y, a la derecha, el hueco de las descargas
    const zonaDescargas = h('div#doc-descargas.doc-descargas');       // aquí van los botones de descarga (Excel, CSV, PDF; los XML se agregan cuando exista su entrega)
    const zonaPaginas = h('div.doc-paginas');

    root.append(h('div.doc-mod',
      h('div.doc-buscar', buscadorFila),
      botonesRango, h('div.doc-fecha-fila', titulo, refrescar), cajaFechas, zonaResumen, zonaCuadre, zonaFiltros,
      h('p.doc-ayuda', 'Toque una fila para ver el detalle. «Anular» crea una nota de crédito (código 01, anulación total): el documento original no se borra. En el buscador también puede escribir un estado (aceptado, rechazado, pendiente) o un rango de montos, por ejemplo 5000-20000.'),
      zonaCabeza, zonaLista, zonaPaginas));

    function elegirRango(r) {
      est.rango = r; est.pagina = 1;
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
      if (est.rango === 'hoy' && turnoDeAyer()) { titulo.textContent = 'Hoy, desde que abrió el turno el ' + diaCortoTxt(ymdDe(turnoDeAyer().abierto_en)) + ' a las ' + horaCorta(turnoDeAyer().abierto_en); return; }
      if (est.rango === 'mes' || est.rango === 'anterior') { // el mes con palabras («Octubre de 2026») y, aparte, los días que cubre
        titulo.replaceChildren(mesTxt(est.desde), h('span.tenue', ` (del ${Number(est.desde.slice(8))} al ${Number(est.hasta.slice(8))})`));
        return;
      }
      titulo.textContent = !una ? `Del ${est.desde.slice(0, 7) === est.hasta.slice(0, 7) ? Number(est.desde.slice(8)) : diaCortoTxt(est.desde)} al ${diaCortoTxt(est.hasta)}` : est.rango === 'hoy' ? 'Hoy, ' + fmtDia.format(new Date(est.desde + 'T12:00:00Z')) : diaTxt(est.desde);
    }

    /* ---------- carga ---------- */
    async function cargar(silencioso = false) {
      const mi = ++nCarga;
      pintarControles();
      if (!silencioso) { est.cargando = true; est.error = null; est.firma = null; pintar(); }
      try {
        // Lo más reciente va arriba (igual que en «Anular factura»): lo último que hizo la cajera se ve sin bajar
        if (est.rango === 'hoy') { const [d0, h0] = rangoDe('hoy'); if (d0 !== est.desde || h0 !== est.hasta) { [est.desde, est.hasta] = [d0, h0]; pintarControles(); } } // la caja se cerró o cambió el día mientras tanto
        // «Hoy» con un turno que abrió en un día anterior arranca en la hora de apertura
        const desdeTurno = est.rango === 'hoy' && turnoDeAyer() ? new Date(turnoDeAyer().abierto_en).getTime() : 0;
        // En «Hoy» con la caja abierta también se lee el estado del turno, para mostrar cómo cuadra con «Apertura y cierre de caja» (si no se puede leer, solo falta esa explicación)
        const turnoId = est.rango === 'hoy' ? turnoAbierto()?.id : null;
        const [filas, turno] = await Promise.all([documentos(app.soc.id, est.desde, est.hasta), turnoId ? app.api.turnoEstado(turnoId).catch(() => null) : null]);
        if (mi !== nCarga) return; // llegó tarde: ya se pidió otra cosa
        const lista = filas.filter((d) => !desdeTurno || new Date(d.fecha_emision).getTime() >= desdeTurno).sort((a, b) => new Date(b.fecha_emision) - new Date(a.fecha_emision));
        // En el refresco automático solo se vuelve a pintar si algo cambió; así no se pierde lo que la cajera esté escribiendo ni se mueve la pantalla
        est.lista = lista; est.turnoEstado = turno; cacheTexto = new WeakMap();
        const firma = JSON.stringify([lista, turno]) + '|' + lista.filter(esProblema).length; // esProblema cambia con el reloj (más de 15 minutos esperando a Hacienda)
        if (silencioso && !est.error && est.firma && firma === est.firma) { ultimaCarga = Date.now(); return; }
        est.firma = firma;
        est.error = null;
      } catch (e) { if (mi !== nCarga) return; if (!silencioso) est.error = mensajeAmable(e); }
      est.cargando = false; ultimaCarga = Date.now();
      pintar();
    }

    /* ---------- resumen, filtros y lista ---------- */
    // Un monto escrito como lo escribe la gente: «5000», «5 000», «5.000», «5 000,50», «₡5000»
    const aMonto = (t) => {
      let x = String(t).replace(/[₡\s]/g, '');
      if (/,\d{1,2}$/.test(x)) x = x.replace(/\./g, '').replace(',', '.'); else if (/^\d{1,3}(\.\d{3})+$/.test(x)) x = x.replace(/\./g, ''); else x = x.replace(/,/g, '');
      return /^\d+(\.\d+)?$/.test(x) ? Number(x) : NaN;
    };
    // Las tarifas de IVA de las líneas solo se buscan si fx_documentos las trae (campo «tarifas»); si no, no se inventa nada
    const tarifasTxt = (d) => (d.tarifas == null ? '' : [].concat(d.tarifas).map((t) => (Number.isFinite(Number(t)) && String(t).trim() !== '' ? `iva ${t} ${t}%` : `iva ${t}`)).join(' '));
    // Las tarifas de un documento (fx_documentos.tarifas: «IVA 13%, IVA 2%» o «Exento») como una lista, para el filtro «Tarifa de IVA»
    const listaTarifas = (d) => (d.tarifas == null ? [] : [].concat(d.tarifas).flatMap((t) => String(t).split(',')).map((t) => t.trim()).filter(Boolean));
    const conDevolucion = (d) => Number(d.parciales_n) > 0;
    const conDebito = (d) => Number(d.debitos_n) > 0;
    let consulta = ''; // la búsqueda normalizada, una sola vez por pintura
    let ultimosVisibles = [];
    const visiblesAhora = () => ultimosVisibles;
    function coincide(d) {
      const q = est.q.trim();
      if (!q) return true;
      // Rango de montos contra el total del documento: «5000-20000» (también «5 000 - 20 000»)
      const rango = q.match(/^([₡\d][\d\s.,₡]*?)\s*-\s*([₡\d][\d\s.,₡]*)$/);
      if (rango) {
        const a = aMonto(rango[1]), b = aMonto(rango[2]);
        if (Number.isFinite(a) && Number.isFinite(b)) { const t = Number(d.total) || 0; return t >= Math.min(a, b) - 0.005 && t <= Math.max(a, b) + 0.005; }
      }
      // cliente_identificacion (la cédula) la trae fx_documentos cuando el servidor la incluye; si no viene, la búsqueda por cédula no encuentra nada y lo demás sigue igual
      // También se busca por la condición de venta («contado»), el estado en palabras y las tarifas de IVA si la lista las trae
      let texto = cacheTexto.get(d);
      if (texto === undefined) {
        texto = norm([NOMBRE_TIPO[d.tipo_doc], NOMBRES_DOCUMENTO[d.tipo_doc], d.cliente || 'consumidor final', d.cliente_identificacion, d.venta_numero, d.referencia, d.consecutivo, numeroCorto(d.consecutivo), mediosTxt(d.medios), d.ref_consecutivo, d.nc_consecutivo,
          'contado', d.estado, ETQ_ESTADO[d.estado], d.nc_id ? 'anulado' : '', tarifasTxt(d), d.nombre_simple, d.codigo_nombre, d.reemplaza_consecutivo, numeroCorto(d.reemplaza_consecutivo),
          Number(d.parciales_n) > 0 ? 'con devolucion devuelto' : '', Number(d.debitos_n) > 0 ? 'con nota de debito' : ''].join(' '));
        cacheTexto.set(d, texto);
      }
      if (texto.includes(consulta)) return true;
      if (!/^[\d\s.,₡]+$/.test(q)) return false; // solo un número escrito se compara con montos y consecutivos
      const dig = q.replace(/\D/g, '');
      if (!dig) return false;
      const t = Number(d.total) || 0;
      return String(Math.trunc(t)).includes(dig) || t.toFixed(2).replace('.', '').includes(dig) || String(d.consecutivo).includes(dig) || String(d.cliente_identificacion || '').replace(/\D/g, '').includes(dig);
    }
    const esPendiente = (d) => d.estado === 'pendiente' || d.estado === 'enviado';
    // «Con problemas» = lo mismo que cuenta el aviso rojo: rechazados (salvo los que solo traen un aviso o ya se rehicieron bien), con error, o que llevan más de 15 minutos esperando a Hacienda
    const soloAviso = (d) => { const it = traducirHacienda(d.mensaje).items; return it.length > 0 && it.every((x) => x.codigo === '-37'); };
    // ¿Ya se rehízo bien? Hay otro documento del mismo tipo, vivo (aceptado, pendiente o enviado), más nuevo y de la misma venta o del mismo comprobante de referencia.
    // Se arma un índice una sola vez por carga (con miles de documentos, recorrer la lista por cada rechazado sería lento).
    let indiceVivos = { lista: null, venta: new Map(), ref: new Map() };
    const vivos = () => {
      if (indiceVivos.lista === est.lista) return indiceVivos;
      const venta = new Map(), ref = new Map();
      for (const n of est.lista) {
        if (n.estado !== 'aceptado' && n.estado !== 'pendiente' && n.estado !== 'enviado') continue;
        const t = new Date(n.fecha_emision).getTime();
        if (n.venta_numero) { const k = n.tipo_doc + '|' + n.venta_numero; if (!(venta.get(k) >= t)) venta.set(k, t); }
        if (n.comprobante_ref) { const k = n.tipo_doc + '|' + n.comprobante_ref; if (!(ref.get(k) >= t)) ref.set(k, t); }
      }
      return (indiceVivos = { lista: est.lista, venta, ref });
    };
    const reemplazado = (d) => {
      const ix = vivos(), t = new Date(d.fecha_emision).getTime();
      return (!!d.venta_numero && ix.venta.get(d.tipo_doc + '|' + d.venta_numero) > t) || (!!d.comprobante_ref && ix.ref.get(d.tipo_doc + '|' + d.comprobante_ref) > t);
    };
    const esProblema = (d) => ((d.estado === 'error' || d.estado === 'rechazado') && !(d.estado === 'rechazado' && soloAviso(d)) && !reemplazado(d) && !d.atendida)
      || (esPendiente(d) && Date.now() - new Date(d.fecha_emision).getTime() > 15 * 60000);

    function pintar() {
      pintarControles();
      if (est.cargando && !est.lista.length) { zonaResumen.replaceChildren(); zonaCuadre.replaceChildren(); zonaFiltros.replaceChildren(); zonaCabeza.replaceChildren(); zonaPaginas.replaceChildren(); zonaLista.replaceChildren(h('p.cargando', 'Cargando los documentos…')); return; }
      if (est.error) {
        zonaResumen.replaceChildren(); zonaCuadre.replaceChildren(); zonaFiltros.replaceChildren(); zonaCabeza.replaceChildren(); zonaPaginas.replaceChildren();
        zonaLista.replaceChildren(h('div.vacio', h('p', 'No se pudieron cargar los documentos.'), h('p.tenue', est.error), h('button.btn.primario', { type: 'button', 'data-reintentar': '1', onclick: () => cargar() }, 'Intentar de nuevo')));
        return;
      }
      pintarResumen();
      const problemas = est.lista.filter(esProblema), pend = est.lista.filter(esPendiente);
      const nAcept = est.lista.reduce((a, d) => a + (d.estado === 'aceptado' ? 1 : 0), 0), nRech = est.lista.reduce((a, d) => a + (d.estado === 'rechazado' ? 1 : 0), 0);
      if (est.filtro === 'problemas' && !problemas.length) est.filtro = 'todos';
      if (est.filtro === 'pendientes' && !pend.length) est.filtro = 'todos';
      if (est.filtro === 'aceptados' && !nAcept) est.filtro = 'todos';
      if (est.filtro === 'rechazados' && !nRech) est.filtro = 'todos';
      // Documentos con devoluciones o correcciones de crédito, y con notas de débito (llaves nuevas de fx_documentos: parciales_n y debitos_n)
      const nDev = est.lista.reduce((a, d) => a + (conDevolucion(d) ? 1 : 0), 0), nDeb = est.lista.reduce((a, d) => a + (conDebito(d) ? 1 : 0), 0);
      if (est.filtro === 'devoluciones' && !nDev) est.filtro = 'todos';
      if (est.filtro === 'debitos' && !nDeb) est.filtro = 'todos';
      // Tarifas de IVA que hay en la lista: el filtro solo sale si hay más de una (si todo es IVA 13 %, filtrar no sirve de nada)
      const porTarifa = new Map();
      for (const d of est.lista) for (const t of listaTarifas(d)) porTarifa.set(t, (porTarifa.get(t) || 0) + 1);
      if (est.tarifa && !porTarifa.has(est.tarifa)) est.tarifa = '';
      const selTarifa = porTarifa.size > 1 ? h('select.campo', { 'aria-label': 'Tarifa de IVA', onchange: (e) => { est.tarifa = e.target.value; est.pagina = 1; pintar(); } },
        h('option', { value: '' }, 'Todas las tarifas'), [...porTarifa].sort((a, b) => a[0].localeCompare(b[0], 'es', { numeric: true })).map(([t, n]) => h('option', { value: t }, `${t} (${n})`))) : null;
      if (selTarifa) selTarifa.value = est.tarifa;
      zonaFiltros.replaceChildren(...[['todos', `Todos (${est.lista.length})`], problemas.length ? ['problemas', `Con problemas (${problemas.length})`] : null, pend.length ? ['pendientes', `Esperando a Hacienda (${pend.length})`] : null,
        nAcept ? ['aceptados', `Aceptados (${nAcept})`] : null, nRech ? ['rechazados', `Rechazados (${nRech})`] : null,
        nDev ? ['devoluciones', `Con devolución (${nDev})`] : null, nDeb ? ['debitos', `Con nota de débito (${nDeb})`] : null]
        .filter(Boolean).map(([k, t]) => h('button.btn' + (k === 'problemas' ? '.alerta' : ''), { type: 'button', 'aria-pressed': String(est.filtro === k), onclick: () => { est.filtro = k; est.pagina = 1; pintar(); } }, t)),
        ...(selTarifa ? [h('label.doc-tarifa', h('span', 'Tarifa de IVA'), selTarifa)] : []));
      consulta = norm(est.q.trim());
      const pasa = { todos: () => true, problemas: esProblema, pendientes: esPendiente, aceptados: (d) => d.estado === 'aceptado', rechazados: (d) => d.estado === 'rechazado', devoluciones: conDevolucion, debitos: conDebito }[est.filtro] || (() => true);
      const pasaTarifa = (d) => !est.tarifa || listaTarifas(d).includes(est.tarifa);
      const visibles = est.lista.filter((d) => pasa(d) && pasaTarifa(d) && coincide(d)); // la búsqueda y los filtros actúan sobre TODO el rango cargado
      ultimosVisibles = visibles;
      pintarLista(visibles);
    }

    function pintarResumen() {
      const s = sumarDocumentos(est.lista);
      const una = est.desde === est.hasta;
      zonaResumen.replaceChildren(h('div.doc-resumen',
        h('div.doc-neto', h('span.doc-etq', est.rango === 'hoy' ? (turnoDeAyer() ? 'Total de este turno' : 'Total de hoy') : (est.rango === 'mes' || est.rango === 'anterior') ? 'Total del mes' : una ? 'Total del día' : 'Total de las fechas elegidas'), h('b.doc-gran', money(s.neto))),
        h('span.doc-det-res', `${s.nVentas} ${s.nVentas === 1 ? 'venta' : 'ventas'}`, s.nAnul ? `, ${s.nAnul} ${s.nAnul === 1 ? 'anulación' : 'anulaciones'}` : '',
          s.nDev ? `, ${s.nDev} ${s.nDev === 1 ? 'devolución o corrección' : 'devoluciones o correcciones'}` : '', s.nND ? `, ${s.nND} ${s.nND === 1 ? 'nota de débito' : 'notas de débito'}` : '', ` · de los cuales ${money(s.iva / 100)} son IVA`)));
      pintarCuadre(s);
      // El servidor entrega a lo sumo 1 000 documentos por consulta: si se llegó al tope, el total de arriba no es el de todo el rango, y hay que decirlo
      if (est.lista.length >= MAX_DOCUMENTOS) zonaCuadre.prepend(h('div.doc-cuadre-caja', h('p.doc-cuadre-frase.alerta', { role: 'note' }, `Estas fechas tienen más de ${num(MAX_DOCUMENTOS)} documentos y aquí se ven solo los primeros ${num(MAX_DOCUMENTOS)} (los más antiguos). El total de arriba es de esos. Para ver los demás, elija un rango de fechas más corto.`)));
    }

    // Qué no suma y qué sí suma este total, y cómo cuadra con «Apertura y cierre de caja» (mismas frases y montos que en esa pantalla)
    function pintarCuadre(s) {
      const frases = frasesDeLista(s);
      // El cuadre con «Apertura y cierre de caja» sale en «Hoy» con la caja abierta: se hace con los documentos emitidos desde la apertura del turno
      const turno = est.rango === 'hoy' ? turnoAbierto() : null;
      const p = turno && est.turnoEstado ? puenteConTurno(sumarDocumentos(docsDelTurno(est.lista, turno.abierto_en)), est.turnoEstado) : null;
      const partes = frases.map((t) => h('p.doc-cuadre-frase', t));
      if (p && p.coincide && !p.turnoRech && !p.sin) partes.push(h('p.doc-cuadre-frase.ok', `El turno abierto coincide con el total vendido de «Apertura y cierre de caja» (${money(p.turnoNeto / 100)}).`));
      else if (p) {
        const fila = (txt, monto, clase = '') => h('div.doc-cuadre-fila' + clase, h('span', txt), h('b', money(monto / 100)));
        partes.push(h('details.doc-cuadre',
          h('summary.btn', `Comparar con «Apertura y cierre de caja» (${money(p.turnoNeto / 100)})`),
          h('div.doc-cuadre-cuerpo',
            fila('Total vendido en «Apertura y cierre de caja», sin las ventas anuladas', p.turnoNeto),
            p.turnoRech ? fila('Menos las ventas que Hacienda no aceptó (el cierre de caja sí las cuenta)', p.turnoRech) : null,
            p.sin ? fila(`Más ${p.sinN === 1 ? '1 documento que no salió' : p.sinN + ' documentos que no salieron'} de una cuenta cobrada en Facturación (el cierre de caja no los cuenta)`, p.sin) : null,
            p.otras ? fila('Otras diferencias, por ejemplo notas de crédito de ventas de otro turno', p.otras) : null,
            fila('Total de este turno en esta lista', p.lista, '.total'))));
      }
      zonaCuadre.replaceChildren(...(partes.length ? [h('div.doc-cuadre-caja', partes)] : []));
    }

    // La lista se pinta por páginas (100 documentos en escritorio, 50 en celular): un mes entero puede traer miles y pintarlos todos congelaría la pantalla.
    // `visibles` ya es el resultado de la búsqueda y del filtro sobre TODO lo cargado; aquí solo se decide qué página se dibuja.
    function pintarLista(visibles) {
      if (!visibles.length) {
        const hoy = est.rango === 'hoy';
        zonaCabeza.replaceChildren(); zonaPaginas.replaceChildren();
        zonaLista.replaceChildren(h('div.vacio',
          est.lista.length ? h('p', 'Ningún documento coincide con lo que buscó.')
            : h('p', hoy ? (turnoDeAyer() ? 'Todavía no hay documentos en este turno. Cuando cobre una venta en Facturación, aparecerá aquí.' : 'Todavía no hay documentos hoy. Cuando cobre una venta en Facturación, aparecerá aquí.') : 'No hay documentos en estas fechas.'),
          !est.lista.length && hoy ? h('button.btn.primario', { onclick: () => app.ir('caja') }, 'Ir a Facturación') : null));
        return;
      }
      const ps = porPagina(), paginas = Math.max(1, Math.ceil(visibles.length / ps));
      est.pagina = Math.min(Math.max(1, est.pagina), paginas);
      // Totales de cada día sobre TODOS los documentos que pasan la búsqueda (un día puede continuar en la página siguiente)
      const porDia = new Map();
      for (const d of visibles) {
        const k = ymdDe(d.fecha_emision); let x = porDia.get(k); if (!x) porDia.set(k, x = { n: 0, t: 0 });
        x.n++; if (d.estado !== 'rechazado') x.t += signo(d) * Math.round((Number(d.total) || 0) * 100);
      }
      const multi = porDia.size > 1 || est.desde !== est.hasta;
      const desde = (est.pagina - 1) * ps, trozo = visibles.slice(desde, desde + ps);
      const out = [];
      let diaActual = null;
      const enEstaPagina = new Map(); for (const d of trozo) { const k = ymdDe(d.fecha_emision); enEstaPagina.set(k, (enEstaPagina.get(k) || 0) + 1); }
      for (const d of trozo) {
        const k = ymdDe(d.fecha_emision);
        if (k !== diaActual) {
          diaActual = k;
          if (multi) {
            const x = porDia.get(k), partido = enEstaPagina.get(k) < x.n; // el día sigue en la página anterior o en la siguiente: el total es el de todo el día
            out.push(h('div.doc-dia', h('b', diaTxt(k)), h('span', `${x.n} ${x.n === 1 ? 'documento' : 'documentos'}${partido ? ' en el día' : ''}, total ${money(x.t / 100)}` + (partido ? `. En esta página: ${enEstaPagina.get(k)}` : ''))));
          }
          out.push(h('div.doc-cabeza', h('div.doc-cabeza-cols', h('span', 'Hora'), h('span', 'Documento'), h('span', 'Cliente'), h('span.der', 'Total'), h('span', 'Estado')), h('span.doc-cabeza-acc', 'Acciones')));
        }
        out.push(fila(d));
      }
      zonaLista.replaceChildren(...out);
      // Encabezado de la lista: cuántos documentos hay y cuáles se ven. El hueco #doc-descargas es para los botones de descarga (Excel, CSV, PDF, XML) que se agregan aparte.
      zonaCabeza.replaceChildren(
        h('span.doc-conteo', paginas > 1 ? `Documentos ${(desde + 1).toLocaleString('es-CR')} a ${(desde + trozo.length).toLocaleString('es-CR')} de ${visibles.length.toLocaleString('es-CR')}` : `${visibles.length.toLocaleString('es-CR')} ${visibles.length === 1 ? 'documento' : 'documentos'}`),
        zonaDescargas);
      pintarPaginas(paginas);
    }

    // Lo que se descarga: los documentos que se ven ahora (mismas fechas, estado y búsqueda; todas las páginas, no solo la que se ve), del más antiguo al más reciente.
    // Los datos son los de la pantalla: no se pide nada nuevo al servidor. Los documentos que Hacienda rechazó se muestran en su fila pero no suman.
    function opcionesDocumentos() {
      const filas = [...visiblesAhora()].sort((a, b) => new Date(a.fecha_emision) - new Date(b.fecha_emision));
      const soc = app.soc, q = est.q.trim();
      const filtroTxt = ({ problemas: 'solo los que tienen problemas', pendientes: 'solo los que esperan a Hacienda', aceptados: 'solo los aceptados por Hacienda', rechazados: 'solo los rechazados por Hacienda', devoluciones: 'solo los que tienen devolución', debitos: 'solo los que tienen nota de débito' }[est.filtro] || '') + (est.tarifa ? (est.filtro !== 'todos' ? ' · ' : '') + 'tarifa ' + est.tarifa : '');
      const filtroCorto = ({ problemas: 'con problemas', pendientes: 'esperando a Hacienda', aceptados: 'aceptados', rechazados: 'rechazados', devoluciones: 'con devolución', debitos: 'con nota de débito' }[est.filtro] || '') + (est.tarifa ? ((est.filtro !== 'todos' ? ' ' : '') + 'tarifa ' + paraArchivo(est.tarifa, 20)).trimEnd() : '');
      const tipoDe = (d) => NOMBRE_TIPO[d.tipo_doc] || 'Comprobante';
      const r2c = (n) => Math.round((Number(n) || 0) * 100) / 100;
      const notas = [
        'Ordenado del documento más antiguo al más reciente.',
        'Las notas de crédito (anulaciones, devoluciones y correcciones de monto) van con signo negativo y restan. Las notas de débito suman. Los documentos que Hacienda no aceptó se muestran, pero no suman: en «Suma al total» valen cero.',
      ];
      if (est.rango === 'hoy' && turnoDeAyer()) notas.push('«Hoy» empieza cuando se abrió el turno, el ' + diaCortoTxt(ymdDe(turnoDeAyer().abierto_en)) + ' a las ' + horaCorta(turnoDeAyer().abierto_en) + '.');
      if (est.lista.length >= MAX_DOCUMENTOS) notas.push(`Estas fechas tienen más de ${num(MAX_DOCUMENTOS)} documentos y el sistema entrega solo los primeros ${num(MAX_DOCUMENTOS)} (los más antiguos). Este archivo no trae los demás: para tenerlos todos, descargue un rango de fechas más corto.`);
      return {
        nombre: `Facturas emitidas ${nombrePeriodo(est.desde, est.hasta)}${filtroCorto ? ' ' + filtroCorto : ''}${paraArchivo(q, 30) ? ' búsqueda ' + paraArchivo(q, 30) : ''}`,
        empresa: nombreLocal(soc), cedula: soc?.cedula || '',
        titulo: 'Facturas, tiquetes y notas de crédito emitidos',
        subtitulo: 'Emitidos ' + textoRango(est.desde, est.hasta) + (filtroTxt ? ' · ' + filtroTxt : '') + (q ? ` · búsqueda: «${q}»` : ''),
        cifras: 'netas', cifrasNota: 'Montos en colones con IVA incluido; las notas de crédito restan, las notas de débito suman y lo que Hacienda rechazó no suma',
        columnas: [
          { clave: 'fecha', titulo: 'Fecha y hora de emisión', tipo: 'fechahora' },
          { clave: 'tipo', titulo: 'Tipo de documento', tipo: 'texto' },
          { clave: 'num', titulo: 'Número', tipo: 'texto' },
          { clave: 'cliente', titulo: 'Cliente', tipo: 'texto' },
          { clave: 'ced', titulo: 'Cédula del cliente', tipo: 'texto', enPdf: false },
          { clave: 'medio', titulo: 'Medio de pago', tipo: 'texto', enPdf: false },
          { clave: 'total', titulo: 'Total del documento (₡)', tipo: 'moneda' },
          { clave: 'iva', titulo: 'IVA del documento (₡)', tipo: 'moneda', enPdf: false },
          { clave: 'estado', titulo: 'Estado con Hacienda', tipo: 'texto' },
          { clave: 'nota', titulo: 'Clase de nota', tipo: 'texto', enPdf: false },
          { clave: 'obs', titulo: 'Anulación, devolución o referencia', tipo: 'texto' },
          { clave: 'suma', titulo: 'Suma al total (₡)', tipo: 'moneda' },
          { clave: 'sumaIva', titulo: 'IVA que suma (₡)', tipo: 'moneda', enPdf: false },
          { clave: 'tarifas', titulo: 'Tarifas de IVA', tipo: 'texto', enPdf: false },
          { clave: 'detalle', titulo: 'Qué dijo Hacienda', tipo: 'texto', enPdf: false },
          { clave: 'ambiente', titulo: 'Ambiente', tipo: 'texto', enPdf: false },
          { clave: 'cons', titulo: 'Consecutivo (20 dígitos)', tipo: 'texto', enPdf: false },
          { clave: 'clave', titulo: 'Clave numérica (50 dígitos)', tipo: 'texto', enPdf: false }],
        filas: filas.map((d) => {
          const sg = signo(d), nc = d.tipo_doc === '03', anulado = !!d.nc_id, cuenta = d.estado !== 'rechazado';
          const dev = Number(d.parciales_n) || 0, deb = Number(d.debitos_n) || 0;
          const obs = [anulado ? `Anulado por la nota de crédito N.° ${numeroCorto(d.nc_consecutivo)}` : '',
            (nc || d.tipo_doc === '02') && d.ref_consecutivo ? `Referencia a ${(NOMBRE_TIPO[d.ref_tipo] || 'documento').toLowerCase()} N.° ${numeroCorto(d.ref_consecutivo)}` : '',
            d.reemplaza_a ? (d.reemplaza_consecutivo ? `Sustituye al documento N.° ${numeroCorto(d.reemplaza_consecutivo)}` : 'Sustituye a un documento anulado') : '',
            dev ? `Con devolución: ${money(d.parciales_total)} en ${dev} ${dev === 1 ? 'nota' : 'notas'}` : '', deb ? `Con nota de débito: ${money(d.debitos_total)} en ${deb} ${deb === 1 ? 'nota' : 'notas'}` : ''].filter(Boolean).join('. ');
          const detalle = d.estado === 'rechazado' || d.estado === 'error' ? (traducirHacienda(d.mensaje).resumen || '') : '';
          return {
            fecha: d.fecha_emision, tipo: tipoDe(d), num: numeroCorto(d.consecutivo), cliente: d.cliente ? nombrePropio(d.cliente) : 'Consumidor final',
            ced: d.cliente_identificacion || '', medio: mediosTxt(d.medios) || (nc ? '' : 'Sin pago'),
            total: r2c(sg * (Number(d.total) || 0)), iva: r2c(sg * (Number(d.total_iva) || 0)),
            estado: ETQ_ESTADO[d.estado] || d.estado, nota: d.nombre_simple || '', obs,
            suma: cuenta ? r2c(sg * (Number(d.total) || 0)) : 0, sumaIva: cuenta ? r2c(sg * (Number(d.total_iva) || 0)) : 0,
            tarifas: d.tarifas == null ? '' : String(d.tarifas), detalle, ambiente: d.ambiente === 'produccion' ? 'Producción' : 'Pruebas',
            cons: d.consecutivo || '', clave: d.clave || '',
          };
        }),
        totales: { suma: 'suma', sumaIva: 'suma' },
        notas,
      };
    }
    zonaDescargas.append(crearDescarga(() => opcionesDocumentos(), { texto: 'Descargar', etiqueta: 'Descargar la lista de documentos que se ve ahora' }));

    // Paginación: Primera, Anterior, «Página 3 de 120», Siguiente, Última y un campo para ir a una página. Todos los controles miden 48 px o más.
    function irAPagina(n) {
      const total = Math.max(1, Math.ceil(visiblesAhora().length / porPagina()));
      est.pagina = Math.min(Math.max(1, Math.round(Number(n)) || 1), total);
      pintar();
      zonaCabeza.scrollIntoView({ block: 'start' });
    }
    function pintarPaginas(paginas) {
      if (paginas <= 1) { zonaPaginas.replaceChildren(); return; }
      const p = est.pagina;
      const boton = (txt, destino, desactivado, etiqueta) => h('button.btn', { type: 'button', disabled: desactivado, 'aria-label': etiqueta, onclick: () => irAPagina(destino) }, txt);
      const campo = h('input.campo', { type: 'number', inputmode: 'numeric', min: '1', max: String(paginas), step: '1', value: String(p), 'aria-label': `Ir a la página (de 1 a ${paginas})`,
        onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); irAPagina(campo.value); } } });
      zonaPaginas.replaceChildren(h('nav.doc-pags', { 'aria-label': 'Páginas de la lista' },
        boton('Primera', 1, p === 1, 'Ir a la primera página'), boton('Anterior', p - 1, p === 1, 'Página anterior'),
        h('span.doc-pag-txt', { role: 'status' }, `Página ${p.toLocaleString('es-CR')} de ${paginas.toLocaleString('es-CR')}`),
        boton('Siguiente', p + 1, p === paginas, 'Página siguiente'), boton('Última', paginas, p === paginas, 'Ir a la última página'),
        h('div.doc-pag-ir', h('label', { for: 'doc-pag-campo' }, 'Ir a la página'), Object.assign(campo, { id: 'doc-pag-campo' }), h('button.btn', { type: 'button', onclick: () => irAPagina(campo.value) }, 'Ir'))));
    }

    // Una fila = la zona que se toca para ver el detalle + los botones «Reimprimir» y «Anular» (o «Ver y atender» si Hacienda no lo aceptó)
    function fila(d) {
      const anulado = !!d.nc_id; // nc_id es solo la anulación total: una devolución parcial deja nc_id vacío y se lee en parciales_n
      const nc = d.tipo_doc === '03', nd = d.tipo_doc === '02';
      const tipo = NOMBRE_TIPO[d.tipo_doc] || 'Comprobante';
      const quien = `${tipo.toLowerCase()} número ${numeroCorto(d.consecutivo)} por ${money(d.total)}`;
      const nDev = Number(d.parciales_n) || 0, nDeb = Number(d.debitos_n) || 0;
      const notasTxt = (n) => (n > 1 ? ` (${n} notas)` : '');
      const reimprimir = h('button.btn.doc-bot', { type: 'button', 'aria-label': 'Reimprimir ' + quien, onclick: () => reimprimirComprobante(d.id) }, 'Reimprimir');
      let segundo = null;
      if (esVenta(d)) {
        if (anulado) segundo = null;
        else if (d.estado === 'aceptado') segundo = h('button.btn.peligro.doc-bot', { type: 'button', 'aria-label': 'Anular ' + quien, onclick: () => abrirAnular(d, { alTerminar: () => cargar(true), alVerNC: (n) => abrirDetalle(n.id) }) }, 'Anular');
        else if (d.estado === 'rechazado' || d.estado === 'error') segundo = h('button.btn.doc-bot', { type: 'button', 'aria-label': (d.atendida ? 'Ver detalle de ' : 'Ver y atender ') + quien, onclick: () => abrirDetalle(d.id) }, d.atendida ? 'Ver detalle' : 'Ver y atender'); // el nombre accesible empieza con el mismo texto que se ve
      }
      // Todavía no hay nada que anular (Hacienda no ha aceptado el documento): se dice a la vista, no solo al pasar el mouse
      const espera = esVenta(d) && !anulado && (d.estado === 'pendiente' || d.estado === 'enviado')
        ? h('div.doc-espera', { role: 'note' }, h('b', 'Esperando a Hacienda. '), 'Todavía no se puede anular: podrá hacerlo cuando Hacienda lo acepte. Toque la fila para ver qué significa y qué hacer.') : null;
      return h('div.doc-fila' + (nc ? '.nc' : '') + (nd ? '.nd' : '') + (anulado ? '.anulada' : ''),
        h('button.doc-ver', { type: 'button', onclick: () => abrirDetalle(d.id), 'aria-label': `${tipo} número ${numeroCorto(d.consecutivo)}, ${money(d.total)}${nDev ? ', con devolución' : ''}${nDeb ? ', con nota de débito' : ''}. Toque para ver el detalle` },
          h('span.c-hora', horaCorta(d.fecha_emision)),
          h('span.c-doc', h('span.nw', h('b', tipo), ' N.° ' + numeroCorto(d.consecutivo)),
            d.nombre_simple ? h('span.sub.rotulo', d.nombre_simple) : null, // Devolución, Corrección de monto, Anulación total, Anulación y sustitución, Deja sin efecto la anulación
            anulado ? h('span.sub.anul', `Anulado por la nota de crédito N.° ${numeroCorto(d.nc_consecutivo)}`) : null,
            (nc || nd) && d.ref_consecutivo ? h('span.sub', `Referencia a ${(NOMBRE_TIPO[d.ref_tipo] || 'documento').toLowerCase()} N.° ${numeroCorto(d.ref_consecutivo)}`) : null,
            d.reemplaza_a ? h('span.sub', d.reemplaza_consecutivo ? `Sustituye al documento N.° ${numeroCorto(d.reemplaza_consecutivo)}` : 'Sustituye a un documento anulado') : null,
            nDev ? h('span.sub.nota', `Devuelto: −${money(d.parciales_total)}${notasTxt(nDev)}`) : null,
            nDeb ? h('span.sub.nota', `Nota de débito: +${money(d.debitos_total)}${notasTxt(nDeb)}`) : null),
          h('span.c-cli', d.cliente ? nombrePropio(d.cliente) : h('span.tenue', 'Consumidor final'), h('span.sub', mediosTxt(d.medios) || (nc ? '' : 'Sin pago'))),
          h('span.c-total.der', (nc ? '−' : '') + money(d.total)),
          h('span.c-est', h('span.chip.' + (CLASE_ESTADO[d.estado] || ''), ETQ_ESTADO[d.estado] || d.estado), anulado ? h('span.chip.anulado', 'Anulado') : null, d.atendida && d.estado === 'rechazado' ? h('span.chip.anulado', 'Atendido') : null,
            nDev ? h('span.chip.nota', 'Con devolución') : null, nDeb ? h('span.chip.nota', 'Con nota de débito') : null)),
        h('div.doc-fbot' + (segundo ? '' : '.una'), reimprimir, segundo),
        espera);
    }

    // Una sola puerta para anular: el motivo «Error en el cliente» ofrece el camino guiado «Cambiar el cliente y hacer la venta de nuevo»
    function abrirAnular(doc, ctx = {}) {
      return anularDocumento(app, doc, { ...ctx, alCambiarCliente: () => cambiarCliente(app, doc, { alTerminar: ctx.alTerminar }),
        alDevolverParte: () => devolverParte(app, doc, { alTerminar: ctx.alTerminar, alVerNota: ctx.alVerNC }), alCorregirMonto: () => corregirMonto(app, doc, { alTerminar: ctx.alTerminar, alVerNota: ctx.alVerNC }) });
    }

    /* ---------- detalle de un documento ---------- */
    async function abrirDetalle(id) {
      const caja = h('div.doc-det', h('p.cargando', 'Cargando el documento…'));
      let vivo = true;
      let firma = null; // lo último que se pintó; el refresco automático solo vuelve a pintar si el documento cambió
      let nCarga = 0;
      let estadoVisto = null; // el estado del documento en la última lectura: si Hacienda todavía no responde, la ventana se actualiza más seguido
      const borrador = { nota: '' }; // la nota que se está escribiendo no se pierde si la ventana se vuelve a pintar
      const m = modal({ titulo: 'Detalle del documento', contenido: caja, ancho: 780, alCerrar: () => { vivo = false; clearInterval(rapido); if (detalleActual?.caja === caja) detalleActual = null; } });
      // Mientras el documento esté por enviarse o enviado, se vuelve a leer cada 5 segundos para que «Anular» se habilite solo cuando Hacienda lo acepte
      const rapido = setInterval(() => { if (vivo && !document.hidden && (estadoVisto === 'pendiente' || estadoVisto === 'enviado')) pintarDet(true); }, 5000);
      const pintarDet = async (silencioso = false) => {
        const mi = ++nCarga;
        try {
          let falloNC = false;
          // anulacionDe trae la anulación total (nc: solo la nota de crédito de código 01; una devolución parcial NO anula) y los saldos con las demás notas del documento
          const [c, { nc: ncAnula, saldos }] = await Promise.all([app.api.comprobante(id), anulacionDe(id).catch(() => { falloNC = true; return { nc: null, saldos: null }; })]);
          if (!vivo || mi !== nCarga) return;
          estadoVisto = c?.estado || null;
          if (silencioso && falloNC) return; // si no se pudo ver la nota de crédito, mejor no cambiar lo que ya se ve
          // Si el documento está anulado, se lee la nota de crédito para saber si se puede dejar sin efecto (admite_sin_efecto) o si ya se dejó sin efecto con una nota de débito (cuelga de la nota de crédito, no del documento)
          const saldosNC = ncAnula && esVenta(c) ? await saldosDe(ncAnula.id) : null;
          if (!vivo || mi !== nCarga) return;
          const sinEfecto = sinEfectoDeSaldos(saldosNC);
          const nc = sinEfecto ? null : ncAnula; // con la anulación dejada sin efecto, el documento vuelve a valer
          const nueva = JSON.stringify([c, nc, saldos, saldosNC, sinEfecto]);
          if (silencioso && nueva === firma) return; // nada cambió: no se toca la pantalla (ni el cursor, ni el teclado del celular)
          firma = nueva;
          // Si había un campo con el cursor adentro, después de pintar vuelve a quedar ahí, en el mismo lugar
          const foco = caja.contains(document.activeElement) && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)
            ? { etiqueta: document.activeElement.getAttribute('aria-label'), ini: document.activeElement.selectionStart, fin: document.activeElement.selectionEnd } : null;
          caja.replaceChildren(vistaDetalle(c, nc, { repintar: pintarDet, cerrar: m.cerrar, borrador, saldos, saldosNC, sinEfecto, ncAnula }));
          if (foco?.etiqueta) {
            const campo = [...caja.querySelectorAll('input,textarea')].find((x) => x.getAttribute('aria-label') === foco.etiqueta);
            if (campo) { campo.focus({ preventScroll: true }); try { campo.setSelectionRange(foco.ini, foco.fin); } catch { /* campo sin cursor */ } }
          }
        } catch (e) { if (vivo && mi === nCarga && !silencioso) caja.replaceChildren(h('div.error-caja', mensajeAmable(e))); }
      };
      detalleActual = { caja, repintar: pintarDet };
      await pintarDet();
    }

    function vistaDetalle(c, nc, ctx) {
      const tipoNombre = NOMBRES_DOCUMENTO[c.tipo_doc] || 'Documento';
      const esNC = c.tipo_doc === '03', esND = c.tipo_doc === '02';
      const cod = String(c.codigo_referencia || (esNC ? '01' : '')); // una nota de crédito sin código guardado se lee como 01 (anulación total)
      const nombreNota = c.nombre_simple || ''; // Anulación total, Devolución, Corrección de monto, Deja sin efecto la anulación...
      const tipoNotaTxt = nombreNota && cod ? `código ${cod} «${nombreNota}»` : textoCodigoNota(cod);
      const hechoHace = (Date.now() - new Date(c.fecha_emision).getTime()) / 60000;
      const cliente = c.cliente_snapshot && (c.cliente_snapshot.nombre || c.cliente_snapshot.identificacion) ? c.cliente_snapshot : null;
      const lineas = (c.lineas_snapshot || []).slice().sort((a, b) => (a.orden || 0) - (b.orden || 0));
      const total = Number(c.total) || 0, iva = Number(c.total_iva) || 0;
      const raiz = h('div.doc-det');

      // Avisos de vínculo
      if (nc) raiz.append(h('div.doc-aviso.anulado', h('div', h('b', 'Anulado por la nota de crédito N.° ' + numeroCorto(nc.consecutivo) + '. '), 'Este documento ya no vale.' + (nc.estado !== 'aceptado' ? ' La nota de crédito todavía está esperando la respuesta de Hacienda.' : ''),
          textoCodigoNota(codigoDeNota(nc)) ? h('div.doc-motivo', 'Tipo de nota: ' + textoCodigoNota(codigoDeNota(nc)) + '.' + (sustituyeSoportado(c) ? ' Si se hace la venta de nuevo, la venta nueva llevará el ' + TEXTO_07 + '.' : '')) : null),
        h('button.btn', { type: 'button', onclick: () => { ctx.cerrar(); abrirDetalle(nc.id); } }, 'Ver la nota de crédito')));
      // La anulación se dejó sin efecto con una nota de débito (que cuelga de la nota de crédito): el documento vuelve a valer
      if (ctx.sinEfecto && esVenta(c)) raiz.append(h('div.doc-aviso.ref', h('div', h('b', `La anulación de este documento se dejó sin efecto con la nota de débito N.° ${numeroCorto(ctx.sinEfecto.consecutivo)}. `), 'El documento vuelve a valer. Ya no admite más devoluciones, correcciones ni anulaciones.' + (ctx.sinEfecto.estado !== 'aceptado' ? ' La nota de débito todavía está esperando la respuesta de Hacienda.' : '')),
        h('button.btn', { type: 'button', onclick: () => { ctx.cerrar(); abrirDetalle(ctx.sinEfecto.id); } }, 'Ver la nota de débito')));
      if (esNC && sinEfectoDeSaldos(ctx.saldos)) { const nd = sinEfectoDeSaldos(ctx.saldos); raiz.append(h('div.doc-aviso.ref', h('div', h('b', `Esta anulación se dejó sin efecto con la nota de débito N.° ${numeroCorto(nd.consecutivo)}. `), 'El documento que se había anulado vuelve a valer.'),
        h('button.btn', { type: 'button', onclick: () => { ctx.cerrar(); abrirDetalle(nd.id); } }, 'Ver la nota de débito'))); }
      if ((esNC || esND) && c.original) {
        const sobreNota = c.original.tipo_doc === '03'; // una nota de débito que deja sin efecto la anulación se apoya en la nota de crédito
        const queHace = esNC
          ? ({ '01': 'Esta nota de crédito anula ese documento.', '06': 'Esta nota de crédito devuelve una parte de ese documento.', '02': 'Esta nota de crédito corrige el monto de ese documento: se había cobrado de más.' }[cod] || 'Esta nota de crédito corrige ese documento.')
          : sobreNota ? 'Esta nota de débito deja sin efecto la anulación: el documento vuelve a valer.' : 'Esta nota de débito corrige el monto de ese documento: se había cobrado de menos.';
        raiz.append(h('div.doc-aviso.ref', h('div', h('b', `Referencia a ${(NOMBRES_DOCUMENTO[c.original.tipo_doc] || 'documento').toLowerCase()} N.° ${numeroCorto(c.original.consecutivo)}. `), queHace, tipoNotaTxt ? h('div.doc-motivo', 'Tipo de nota: ' + tipoNotaTxt + '.') : null, c.motivo ? h('div.doc-motivo', 'Motivo: ' + c.motivo) : null),
          h('button.btn', { type: 'button', onclick: () => { ctx.cerrar(); abrirDetalle(c.original.id); } }, sobreNota ? 'Ver la nota de crédito' : 'Ver el documento original')));
      }

      // Una venta nueva que sustituye a un documento anulado (solo cuando la base guarda la referencia, código 07). fx_comprobante trae el número del documento que sustituye en `reemplaza`.
      if (c.reemplaza_a) {
        const r = c.reemplaza;
        raiz.append(h('div.doc-aviso.ref', h('div', h('b', r?.consecutivo ? `Este documento sustituye al ${(NOMBRES_DOCUMENTO[r.tipo_doc] || 'documento').toLowerCase()} N.° ${numeroCorto(r.consecutivo)}, que se anuló. ` : 'Este documento sustituye a uno que se anuló. '), 'Tipo de referencia: ' + TEXTO_07 + '.'),
          h('button.btn', { type: 'button', onclick: () => { ctx.cerrar(); abrirDetalle(c.reemplaza_a); } }, 'Ver el documento anulado')));
      }

      // Devoluciones, correcciones de monto y notas de débito de una factura o un tiquete (la anulación total se dice arriba, aparte). Una nota que quedó en error también cuenta y se ve con su estado.
      const otras = esVenta(c) ? otrasNotas(ctx.saldos) : [];
      if (otras.length) {
        const sd = ctx.saldos, dinero = (k) => (sd && Number.isFinite(Number(sd[k])) ? Number(sd[k]) : 0);
        const partes = [dinero('total_acreditado') > 0 ? `Lleva devuelto ${money(dinero('total_acreditado'))}.` : '', dinero('total_debitado') > 0 ? `Lleva ${money(dinero('total_debitado'))} en notas de débito.` : '',
          // «Lo que queda» solo se dice cuando no hay notas de débito: con ellas el valor real del documento sube y la base no manda ese número ya calculado
          sd && sd.saldo_total != null && !(dinero('total_debitado') > 0) ? `Valor que queda del documento: ${money(dinero('saldo_total'))}.` : ''].filter(Boolean).join(' ');
        raiz.append(h('div.doc-aviso.ref.notas', h('div', h('b', otras.length === 1 ? 'Este documento tiene una nota de ajuste. ' : `Este documento tiene ${otras.length} notas de ajuste. `), partes, listaNotas(sd))));
      }

      // Encabezado y estado
      raiz.append(h('div.doc-encab',
        h('div', h('div.doc-etq', tipoNombre), h('div.doc-num', 'N.° ' + numeroCorto(c.consecutivo)), h('div.tenue', fechaHora(c.fecha_emision))),
        h('div.doc-chips', h('span.chip.' + (CLASE_ESTADO[c.estado] || ''), ETQ_ESTADO[c.estado] || c.estado), c.ambiente !== 'produccion' ? h('span.chip.espera', 'Prueba, sin validez') : null, nc ? h('span.chip.anulado', 'Anulado') : null, ctx.sinEfecto ? h('span.chip.nota', 'Anulación dejada sin efecto') : null,
          (esNC || esND) && nombreNota ? h('span.chip.nota', nombreNota) : null, otras.length ? h('span.chip.nota', otras.some((n) => n.tipo_doc === '03') ? 'Con devolución' : 'Con nota de débito') : null)));
      raiz.append(textoEstado(c, !!nc));

      // Datos
      const dato = (e, v, extra) => h('div.doc-dato', h('span.doc-etq', e), h('div' + (extra ? '.' + extra : ''), v));
      raiz.append(h('div.doc-datos',
        dato('Número completo', c.consecutivo, 'mono'),
        dato('Cuenta', [c.venta?.numero, c.venta?.tipo_servicio ? TIPOS_SERVICIO[c.venta.tipo_servicio] || c.venta.tipo_servicio : null, c.venta?.referencia].filter(Boolean).join(' · ') || 'Sin datos'),
        dato('Condición de venta', 'Contado'),
        dato('Correo al cliente', c.correo_enviado_en ? `Enviado a ${c.correo_para || 'el cliente'} el ${fechaHora(c.correo_enviado_en)}` : c.correo_error ? correoAmable(c.correo_error) : 'Todavía no se ha enviado'),
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
        h('div.doc-pagos', h('div.doc-etq', esNC ? (cod === '01' ? 'Pagos del documento original' : 'Cómo se devuelve el dinero') : esND ? 'Cómo se paga la diferencia' : 'Pagos'),
          (c.pagos_snapshot || []).length ? c.pagos_snapshot.map((p) => h('div.doc-fila-t', h('span', (MEDIOS[p.medio] || p.medio) + (p.referencia ? ` (ref. ${p.referencia})` : '')), h('b', money(p.monto)))) : h('div.tenue', 'Sin pagos registrados')),
        h('div.doc-sumas',
          h('div.doc-fila-t', h('span', 'Subtotal sin IVA'), h('span', money(r2(total - iva)))),
          h('div.doc-fila-t', h('span', 'IVA'), h('span', money(iva))),
          h('div.doc-fila-t.gran', h('span', esNC ? (cod === '06' ? 'Total que se devuelve' : cod === '02' ? 'Total que se corrige' : 'Total que se anula') : esND ? 'Total de la nota de débito' : 'Total'), h('b', money(total))))));

      raiz.append(acciones(c, nc, ctx, hechoHace));
      return raiz;
    }

    // Algunos avisos traen la frase «el documento sigue siendo válido»; en un documento rechazado o anulado contradice el estado. El título de la lista ya dice «sigue siendo válido» cuando corresponde.
    const sinFrasePorEstado = (t) => String(t || '').replace(/\s*Es solo un aviso y el documento sigue siendo válido\./, '').replace(/\s{2,}/g, ' ').trim();
    function textoEstado(c, anulado = false) {
      const th = traducirHacienda(c.mensaje);
      const t = {
        pendiente: 'Está por enviarse a Hacienda. No tiene que hacer nada.',
        enviado: 'Ya se envió a Hacienda y se espera su respuesta. Esta ventana se actualiza sola.',
        aceptado: (anulado ? 'Hacienda lo aceptó, y después se anuló con una nota de crédito.' : 'Hacienda lo aceptó: el documento es válido.') + (c.ambiente !== 'produccion' ? ' Como estamos en modo de pruebas, no tiene validez tributaria.' : ''),
        rechazado: 'Hacienda no aceptó este documento, así que no es válido.',
        error: 'Todavía no se pudo enviar a Hacienda (por ejemplo, por falta de internet). No se reenvía solo: toque «Reenviar a Hacienda».',
      }[c.estado] || '';
      // Lo que dice Hacienda, en palabras simples. Si el documento fue aceptado, lo que trae es un aviso y no impide nada.
      const motivos = th.items.length
        ? h('div.doc-motivos', h('b', c.estado === 'aceptado' ? (anulado ? 'Aviso de Hacienda:' : 'Aviso de Hacienda (el documento sigue siendo válido):') : 'Qué dice Hacienda:'),
          h('ul', th.items.map((i) => h('li', sinFrasePorEstado(i.texto)))))
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
      try { return await fn(); } catch (e) { toast(mensajeAmable(e), 'error', 7000); } finally { b.disabled = false; delete b.dataset.ocupado; }
    }
    function accion({ texto, hint, clase = '', disabled = false, onclick }) {
      const b = h('button.btn.doc-acc' + (clase ? '.' + clase : ''), { type: 'button', disabled }, h('span.t', texto), hint ? h('small', hint) : null);
      if (!disabled) b.addEventListener('click', () => ejecutar(b, onclick));
      return b;
    }
    // Nombre del archivo: sin tildes (algunos navegadores lo descartan) y con guiones, no guiones bajos
    // El texto que deja la función de correo puede traer palabras técnicas: aquí se dice en palabras simples qué pasó y qué hacer (el texto original no se pierde: queda en la base)
    function correoAmable(t) {
      const x = String(t || '');
      if (/^\s*(ENVIANDO|SIN CONFIRMAR)/i.test(x)) return 'No se sabe si el correo salió. Revise la carpeta de enviados de la cuenta de correo de la empresa antes de reenviarlo.';
      if (/token|mail\.send|graph|40[13]|permiso|acceso de la aplicaci/i.test(x)) return 'No se pudo enviar el correo: el sistema no tiene permiso para usar la cuenta de correo de la empresa. Avise a la persona encargada.';
      return 'No se pudo enviar el correo al cliente. Revise que el correo del cliente esté bien escrito o avise a la persona encargada.';
    }
    const nombreArchivo = (c, sufijo) => `${norm(NOMBRES_DOCUMENTO[c.tipo_doc] || 'comprobante').replace(/\s+/g, '-')}-${c.consecutivo}-${sufijo}.xml`;

    function acciones(c, nc, ctx, hechoHace) {
      const hechoXml = async (cual, sufijo, vacio) => {
        const xml = await app.api.xml(c.id, cual);
        if (!xml) return toast(vacio, 'error', 6000);
        descargar(nombreArchivo(c, sufijo), xml);
      };
      const conCorreo = !!c.cliente_snapshot?.correo;
      const hayCorreo = correoActivo(app);
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
            toast(r?.estado === 'aceptado' ? 'Hacienda ya lo tiene aceptado.' : 'Se pidió reenviar el documento a Hacienda. Su estado cambiará solo.');
            await ctx.repintar(true); await cargar(true);
          } })
          : accion({ texto: 'Reenviar a Hacienda', disabled: true, hint: c.estado === 'aceptado' ? 'No hace falta: Hacienda ya lo aceptó' : c.estado === 'rechazado' ? 'Un documento rechazado no se reenvía' : 'Se envía solo; si tarda, aparecerá este botón' }),
        hayCorreo && conCorreo
          ? accion({ texto: 'Reenviar al cliente por correo', onclick: async () => { await reenviarCorreo(c.id); toast('Se pidió enviar el correo al cliente. Si no le llega, revise que su correo esté bien escrito.'); await ctx.repintar(true); } })
          : accion({ texto: 'Reenviar al cliente por correo', disabled: true, hint: !hayCorreo ? 'Disponible cuando se active el correo' : 'Este cliente no tiene correo' })));

      const grupos = [impr, arch, env];
      if (esVenta(c)) grupos.push(bloqueAnular(c, nc, ctx));
      else if (c.tipo_doc === '03') { const g = bloqueSinEfecto(c, ctx); if (g) grupos.push(g); }
      return h('div.doc-acciones', grupos);
    }

    function bloqueAnular(c, nc, ctx) {
      const g = h('div.doc-grupo.anular', h('h3', 'Corregir o anular'));
      const repintar = async () => { await ctx.repintar(true); await cargar(true); };
      const doc = { ...c, cliente: c.cliente_snapshot?.nombre || '' };
      const verNota = (n) => { ctx.cerrar(); abrirDetalle(n.id); };
      if (!nc && ctx.sinEfecto) { g.append(h('p.tenue', 'La anulación se dejó sin efecto, así que este documento vuelve a valer. Ya no admite más devoluciones, correcciones ni anulaciones.')); return g; }
      if (nc) {
        // Una anulación aceptada se puede dejar sin efecto con una nota de débito (la base lo dice en admite_sin_efecto de la NOTA DE CRÉDITO)
        const sinEf = ctx.saldosNC?.admite_sin_efecto === true && nc.estado === 'aceptado';
        const docNC = { id: nc.id, tipo_doc: '03', consecutivo: nc.consecutivo, total: nc.total ?? c.total, fecha_emision: nc.fecha_emision, cliente: doc.cliente };
        g.append(...[h('p.tenue', `Este documento ya fue anulado con la nota de crédito N.° ${numeroCorto(nc.consecutivo)}. No se puede anular dos veces.`),
          c.venta_id ? h('div.doc-botones',
            accion({ texto: 'Hacer la venta de nuevo en Facturación', hint: 'Copia los productos a una cuenta nueva y abre Facturación.', onclick: async () => { ctx.cerrar(); await hacerVentaDeNuevo(app, c.venta_id, toast); } }),
            accion({ texto: 'Hacer la venta de nuevo con otro cliente', hint: 'Primero elige al cliente; después abre Facturación.', onclick: async () => { selectorCliente(app, { titulo: 'Elegir el cliente de la venta nueva', alElegir: async (cl) => { ctx.cerrar(); await hacerVentaDeNuevo(app, c.venta_id, toast, cl?.id); } }); } })) : null,
          sinEf ? h('div.doc-botones',
            accion({ texto: 'Dejar sin efecto la anulación', hint: 'Úselo si la anulación fue un error: el documento vuelve a valer.', onclick: async () => { dejarSinEfecto(app, docNC, { alTerminar: repintar, alVerNota: verNota }); } })) : null].filter(Boolean));
        return g;
      }
      if (c.estado === 'aceptado') {
        const esTiquete = c.tipo_doc === '04';
        // fx_comprobante_saldos dice si se puede anular completo (admite_anulacion). Si no se puede, se muestra su frase tal cual y los dos botones quedan apagados.
        // Si no se pudo preguntar, los botones funcionan como siempre y es la base la que rechaza lo que no corresponde.
        const permiso = permiteAnular(ctx.saldos), bloq = permiso.sabe && !permiso.permite;
        // fx_comprobante_saldos también dice si admite devoluciones y correcciones (admite_notas); si no, se muestra su frase tal cual y los botones quedan apagados
        const noNotas = !!ctx.saldos && ctx.saldos.admite_notas === false;
        const motivoNotas = noNotas ? (String(ctx.saldos.motivo_no_admite || '').trim() || 'Este documento no admite devoluciones ni correcciones.') : '';
        const abrirParcial = (abrirla) => async () => { abrirla(app, doc, { alTerminar: repintar, alVerNota: verNota }); };
        g.append(...[h('p.tenue', 'Si la venta se hizo mal, se anula con una nota de crédito (código 01, anulación total). El documento original no se borra: queda guardado y enlazado a la nota. Si solo hay que devolver o corregir una parte, no hace falta anular todo: use «Devolver parte» o «Corregir un monto».'),
          bloq ? h('div.doc-espera-caja', { role: 'note' }, h('p', h('b', 'Este documento no se puede anular completo.')), h('p', permiso.motivo)) : null,
          noNotas ? h('div.doc-espera-caja', { role: 'note' }, h('p', h('b', 'No se puede devolver ni corregir una parte de este documento.')), h('p', motivoNotas)) : null,
          h('div.doc-botones',
            accion({ texto: 'Devolver parte', hint: noNotas ? 'No se puede: lea el aviso de arriba' : 'El cliente devuelve algunos productos y se le devuelve esa parte.', disabled: noNotas, onclick: abrirParcial(devolverParte) }),
            accion({ texto: 'Corregir un monto', hint: noNotas ? 'No se puede: lea el aviso de arriba' : 'Se cobró de más o de menos en un producto.', disabled: noNotas, onclick: abrirParcial(corregirMonto) }),
            accion({ texto: esTiquete ? 'El cliente pide factura' : 'Corregir el cliente de la factura', hint: bloq ? 'No se puede: lea el aviso de arriba' : esTiquete ? 'Elige al cliente, anula el tiquete y deja la factura lista para cobrar.' : 'Elige al cliente correcto, anula y deja la venta lista para cobrar.', clase: 'primario', disabled: bloq, onclick: async () => { cambiarCliente(app, doc, { alTerminar: repintar }); } }),
            accion({ texto: 'Anular con nota de crédito', hint: bloq ? 'No se puede: lea el aviso de arriba' : null, clase: 'peligro', disabled: bloq, onclick: async () => { abrirAnular(doc, { alTerminar: repintar, alVerNC: (n) => { ctx.cerrar(); abrirDetalle(n.id); } }); } }))].filter(Boolean));
      } else if (c.estado === 'rechazado') {
        g.append(h('p.tenue', 'Hacienda rechazó este comprobante, por eso no vale y no se le hace nota de crédito. Toque «Hacer la venta de nuevo en Facturación» para sacar uno correcto de inmediato.' + (SUSTITUYE_RECHAZADO ? ' El nuevo indicará que sustituye a este.' : '')), bloqueAtender(c, ctx));
      } else {
        // pendiente, enviado o con error: todavía no hay nada que anular. Se explica qué significa y qué hacer, sin prometer cuánto tarda Hacienda.
        const pend = c.estado === 'pendiente' || c.estado === 'enviado';
        g.append(h('div.doc-espera-caja',
          h('p', h('b', pend ? 'Todavía no se puede anular: Hacienda debe aceptar este documento primero.' : 'Todavía no se puede anular: este documento no ha llegado a Hacienda.')),
          h('p', 'Qué significa: una nota de crédito solo se puede hacer sobre un documento que Hacienda ya aceptó.'),
          h('p', pend ? 'Qué hacer mientras tanto: deje esta ventana abierta, se actualiza sola y el botón se habilitará cuando Hacienda lo acepte. También puede cerrarla, seguir atendiendo y volver más tarde.'
            : 'Qué hacer mientras tanto: toque «Reenviar a Hacienda» (arriba, en «Enviar»). Cuando Hacienda lo acepte podrá anularlo. Si pasa mucho tiempo, avise a la persona encargada.')),
          h('div.doc-botones',
            accion({ texto: 'Devolver parte', disabled: true, hint: 'Primero debe estar aceptado por Hacienda' }),
            accion({ texto: 'Corregir un monto', disabled: true, hint: 'Primero debe estar aceptado por Hacienda' }),
            accion({ texto: 'Anular con nota de crédito', clase: 'peligro', disabled: true, hint: 'Primero debe estar aceptado por Hacienda' }),
            accion({ texto: esTiqueteTxt(c), disabled: true, hint: 'Primero debe estar aceptado por Hacienda' })));
      }
      return g;
    }
    // Detalle de una nota de crédito: si es una anulación total aceptada, se puede dejar sin efecto con una nota de débito (admite_sin_efecto). Una devolución o una corrección no se deshace así.
    function bloqueSinEfecto(c, ctx) {
      if (!['01', '13'].includes(String(c.codigo_referencia || '01'))) return null;
      const g = h('div.doc-grupo.anular', h('h3', 'Corregir esta anulación'));
      const ya = sinEfectoDeSaldos(ctx.saldos);
      if (ya) { g.append(h('p.tenue', `Esta anulación ya se dejó sin efecto con la nota de débito N.° ${numeroCorto(ya.consecutivo)}.`)); return g; }
      const doc = { ...c, cliente: c.cliente_snapshot?.nombre || '' };
      const sabe = !!ctx.saldos && typeof ctx.saldos.admite_sin_efecto === 'boolean';
      const apagado = c.estado !== 'aceptado' || (sabe && !ctx.saldos.admite_sin_efecto);
      const hint = c.estado !== 'aceptado' ? 'Primero debe estar aceptada por Hacienda' : apagado ? 'No se puede en este momento' : 'Úselo si la anulación fue un error: el documento vuelve a valer.';
      g.append(h('p.tenue', 'Si esta anulación se hizo por error, se puede dejar sin efecto con una nota de débito: la venta vuelve a valer como estaba. Antes de hacerlo se le muestra todo para que lo revise.'),
        h('div.doc-botones', accion({ texto: 'Dejar sin efecto la anulación', hint, disabled: apagado, onclick: async () => { dejarSinEfecto(app, doc, { alTerminar: async () => { await ctx.repintar(true); await cargar(true); }, alVerNota: (n) => { ctx.cerrar(); abrirDetalle(n.id); } }); } })));
      return g;
    }
    const esTiqueteTxt = (c) => (c.tipo_doc === '04' ? 'El cliente pide factura' : 'Corregir el cliente de la factura');

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
      if (esVenta(c) && c.venta_id) caja.append(h('div.doc-botones',
        accion({ texto: 'Hacer la venta de nuevo en Facturación', hint: 'Copia los productos a una cuenta nueva y abre Facturación.', onclick: async () => { ctx.cerrar(); await hacerVentaDeNuevo(app, c.venta_id, toast); } }),
        accion({ texto: 'Hacer la venta de nuevo con otro cliente', hint: 'Primero elige al cliente; después abre Facturación.', onclick: async () => { selectorCliente(app, { titulo: 'Elegir el cliente de la venta nueva', alElegir: async (cl) => { ctx.cerrar(); await hacerVentaDeNuevo(app, c.venta_id, toast, cl?.id); } }); } })));
      return caja;
    }

    /* ---------- arranque y actualización automática ---------- */
    pintarControles();
    await cargar();
    if (alFinal) buscador.focus(); // desde el botón rojo «Anular factura»: el cursor queda en el buscador
    if (verDocumento) abrirDetalle(verDocumento); // desde «Me equivoqué» del cobro: se abre el documento recién emitido
    // Los documentos cambian de estado solos (en cola, enviado, aceptado): «Hoy» se actualiza cada 20 segundos. Un mes entero pesa mucho más:
    // «Este mes» y «Cualquier fecha» se actualizan cada minuto y «Mes anterior» solo con el botón «Actualizar».
    const reloj = setInterval(() => {
      if (document.hidden || !root.isConnected) return;
      const espera = est.rango === 'hoy' ? 15000 : est.rango === 'anterior' ? Infinity : 60000;
      if (Date.now() - ultimaCarga >= espera) cargar(true);
      detalleActual?.repintar(true);
    }, 20000);
    // Si el aparato cambia de ancho (girar el celular), el tamaño de la página cambia: se vuelve a la primera
    let mq = null; try { mq = window.matchMedia('(max-width:700px)'); } catch { /* sin matchMedia */ }
    const alCambiarAncho = () => { est.pagina = 1; if (est.lista.length && root.isConnected) pintar(); };
    mq?.addEventListener?.('change', alCambiarAncho);
    return () => { clearInterval(reloj); mq?.removeEventListener?.('change', alCambiarAncho); };
  },
};
