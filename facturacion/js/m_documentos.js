// Anular y reimprimir: una sola ventana con los documentos de Hoy, Este mes, Mes anterior o Cualquier fecha, buscador por número, cliente, cédula, estado o monto,
// y en cada fila los botones «Reimprimir» y «Anular». La lista se pinta por tandas («Mostrar más»): la búsqueda y los filtros actúan sobre todo lo cargado. Tocar la fila abre el detalle (estado en Hacienda, «Ya lo atendí», archivos, reenvíos).
// La anulación con nota de crédito es la de m_anular.js; la impresión es la de imprimir.js.
import { h, money, modal, toast, descargar, hoyCR, sumaDias, fechaHora, horaCorta, debounce, num, r2, nombrePropio, nombreLocal, traducirHacienda, campoBusqueda, TIPOS_SERVICIO, MEDIOS, TIPOS_ID } from './util.js';
import { documentosPagina, DOCUMENTOS_POR_PAGINA, anulacionDe, permiteAnular, otrasNotas, sinEfectoDeSaldos, correoActivo, reenviarCorreo, alertaAtender, copiarVentaParaRehacer, abrirCuentaNueva, mensajeAmable } from './api_documentos.js';
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
// Cuántas tandas de 1 000 se vuelven a pedir cuando la lista se reconstruye: el refresco automático (cada 15 a 60 segundos) hasta 5 000 documentos, y «Actualizar» o lo que sigue a una acción hasta 12 000.
// Si la persona había cargado más, se vuelve a cargar hasta ese tope y la pantalla lo dice con palabras.
const MAX_TANDAS_AUTO = 5, MAX_TANDAS_MANUAL = 12;
const NOMBRE_MAX = 150; // las letras que caben en el nombre de un archivo (descargas_comun.js lo corta ahí)
const TXT_NUEVOS = 'Hay documentos nuevos. Toque «Actualizar todo lo que se ve» para verlos todos.';
const MSG_SIN_MAS = 'No se pudieron traer más documentos de estas fechas. Elija fechas más cortas, por ejemplo un solo día.';
const esCelular = () => { try { return window.matchMedia('(max-width:700px)').matches; } catch { return false; } };
const porPagina = () => (esCelular() ? PAGINA_CELULAR : PAGINA_ESCRITORIO);
const fmtMes = new Intl.DateTimeFormat('es-CR', { timeZone: 'UTC', month: 'long', year: 'numeric' });
const mesTxt = (ymd) => { const t = fmtMes.format(new Date(ymd + 'T12:00:00Z')); return t.charAt(0).toUpperCase() + t.slice(1); }; // «Octubre de 2026»
export const primerDiaMes = (ymd) => ymd.slice(0, 8) + '01';
// Último día del mes anterior y primer día del mes anterior (sirve en enero y en años bisiestos: Date.UTC con día 0 es el último día del mes anterior)
export const mesAnterior = (ymd) => { const y = Number(ymd.slice(0, 4)), m = Number(ymd.slice(5, 7)); return [new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10), new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10)]; };
// Lo que se dice cuando un filtro se quita solo porque ya no hay ningún documento así
const ORACION_FILTRO = { problemas: 'No hay documentos con problemas', pendientes: 'No hay documentos esperando a Hacienda', aceptados: 'No hay documentos aceptados', rechazados: 'No hay documentos rechazados', devoluciones: 'No hay documentos con devolución', debitos: 'No hay documentos con nota de débito' };
const CLASE_ESTADO = { pendiente: 'espera', enviado: 'espera', aceptado: 'ok', rechazado: 'mal', error: 'mal' };
const NOMBRE_TIPO = { ...NOMBRES_DOCUMENTO, '01': 'Factura', '02': 'Nota de débito', '03': 'Nota de crédito', '04': 'Tiquete' }; // nombres cortos para la lista
const esVenta = (d) => d.tipo_doc === '01' || d.tipo_doc === '04';
const paraArchivo = (t, max = 40) => String(t || '').replace(/[^\p{L}\p{N} .,&'()-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim();
const mediosTxt = (m) => (m ? m.split(', ').map((x) => MEDIOS[x] || x).join(' y ') : '');
const signo = (d) => (d.tipo_doc === '03' ? -1 : 1);
// «la factura», «el tiquete», «la nota de crédito»... para decir a qué documento se refiere una nota
const ARTICULO_DOC = { '01': 'la factura', '04': 'el tiquete', '03': 'la nota de crédito', '02': 'la nota de débito' };
const conArticulo = (t) => ARTICULO_DOC[t] || 'el documento';
// Lo que hace una nota con el documento al que se refiere, en palabras de uso diario (nota de crédito 01 o 13: anula; 02 o 06: corrige; nota de débito sobre una nota de crédito: deja sin efecto la anulación)
const fraseReferencia = (d) => {
  const n = numeroCorto(d.ref_consecutivo), a = conArticulo(d.ref_tipo);
  if (d.tipo_doc === '03') return ['01', '13'].includes(String(d.codigo_referencia || '01')) ? `Anula ${a} N.° ${n}` : `Corrige ${a} N.° ${n}`;
  if (d.ref_tipo === '03') return `Deja sin efecto la anulación N.° ${n}`;
  return `Corrige ${a} N.° ${n}`;
};
/* ------------------------------------------------------------------ módulo */

export default {
  id: 'anular',
  titulo: 'Anular y reimprimir',
  async mount(root, app) {
    const est = { rango: 'hoy', desde: hoyCR(), hasta: hoyCR(), q: '', filtro: 'todos', tarifa: '', lista: [], cargando: false, error: null, turnoEstado: null, firma: null, pagina: 1,
      // La base entrega los documentos por tandas de 1 000, los más nuevos primero: base = la primera tanda, antiguos = lo que se cargó después con «Cargar los documentos más antiguos».
      // tandas = cuántas tandas hay cargadas, n = cuántas posiciones de la lista de la base cubren (es el desplazamiento de la tanda siguiente).
      // sinPaginas = la base no sabe entregar más (versión sin la función de páginas); orden = 'recientes' o 'antiguos' según lo que entregó la base.
      base: [], antiguos: new Map(), total: 0, tandas: 1, n: 0, hayMasBase: false, sinPaginas: false, orden: 'recientes', cargandoMas: false, errorMas: null,
      avisoRecarga: null,  // lo que la pantalla le dice a la persona si al reconstruir la lista no pudo volver a cargar todo
      avisoFiltro: null,   // por qué un filtro volvió a «Todos» (nunca en silencio)
      avisoNuevos: null,   // entraron documentos nuevos que el reloj no pudo sumar sin quitar nada de lo cargado: se dice y se pide «Actualizar»
      errorActualizar: null }; // «Actualizar» falló (sin conexión, por ejemplo): la lista de antes se queda a la vista y el error sale arriba
    const cargados = () => est.base.length + est.antiguos.size;
    // Faltan documentos si el rango tiene más de los cargados, o si la base avisó que hay más (hay_mas) aunque no sepa cuántos
    const hayMas = () => est.total > cargados() || est.hayMasBase;
    const puedeMas = () => hayMas() && !est.sinPaginas;
    const faltan = () => Math.max(est.total - cargados(), 0);
    let nCarga = 0; // cada carga lleva su número: si llega tarde la respuesta de una anterior (por ejemplo «Este mes» y enseguida «Hoy»), se descarta
    let nRango = 0; // sube solo cuando se cambian las fechas o se empieza de cero: una tanda pedida de otras fechas no se mezcla con esta lista
    let silenciosos = 0; // lecturas silenciosas en camino (el reloj, o lo que sigue a una acción): «Cargar» espera a que terminen y el reloj no se encima sobre «Cargar»
    let lecturas = 0;    // sube cada vez que cambia lo que hay cargado (se reemplaza, se amplía o se le suma algo arriba): una tanda pedida antes de ese cambio ya no encaja
    let esperandoActualizar = false; // la persona tocó «Actualizar» (aunque todavía esté esperando que termine otra tanda)
    const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));
    let promesaMas = null; // la tanda de «Cargar los documentos más antiguos» que va en camino
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
    // «Actualizar» conserva lo que ya se cargó (vuelve a pedir las mismas tandas, todas de una vez); solo cambiar de fechas empieza de cero.
    // El botón dice qué está haciendo («Actualizando…») y, mientras tanto, «Cargar» queda apagado con su frase.
    async function actualizarTodo() {
      if (esperandoActualizar || est.cargando) return;
      esperandoActualizar = true; pintarControles();
      try { if (est.cargandoMas && promesaMas) await promesaMas.catch(() => {}); await cargar('actualizar'); } finally { esperandoActualizar = false; pintarControles(); }
    }
    const refrescar = h('button.btn', { type: 'button', 'data-actualizar': '1', onclick: actualizarTodo }, 'Actualizar todo lo que se ve');
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
      const ocupado = est.cargando || esperandoActualizar;
      refrescar.textContent = ocupado ? 'Actualizando…' : 'Actualizar todo lo que se ve'; refrescar.disabled = ocupado; refrescar.setAttribute('aria-busy', String(ocupado));
      const una = est.desde === est.hasta;
      if (est.rango === 'hoy' && turnoDeAyer()) { titulo.textContent = 'Hoy, desde que abrió el turno el ' + diaCortoTxt(ymdDe(turnoDeAyer().abierto_en)) + ' a las ' + horaCorta(turnoDeAyer().abierto_en); return; }
      if (est.rango === 'mes' || est.rango === 'anterior') { // el mes con palabras («Octubre de 2026») y, aparte, los días que cubre
        titulo.replaceChildren(mesTxt(est.desde), h('span.tenue', ` (del ${Number(est.desde.slice(8))} al ${Number(est.hasta.slice(8))})`));
        return;
      }
      titulo.textContent = !una ? `Del ${est.desde.slice(0, 7) === est.hasta.slice(0, 7) ? Number(est.desde.slice(8)) : diaCortoTxt(est.desde)} al ${diaCortoTxt(est.hasta)}` : est.rango === 'hoy' ? 'Hoy, ' + fmtDia.format(new Date(est.desde + 'T12:00:00Z')) : diaTxt(est.desde);
    }

    /* ---------- carga ---------- */
    // La base entrega los documentos por desplazamiento (la más nueva primero). Si entra un documento nuevo entre dos lecturas, todo se corre un lugar y
    // mezclar tandas de lecturas distintas deja un hueco o repite uno. Por eso varias tandas SOLO se unen si todas dicen el mismo total (nada entró en medio);
    // si no, se vuelve a pedir desde el principio (hasta 3 veces) y la pantalla se actualiza una sola vez, al final, con una lista que es de una sola lectura.
    async function traerTandas(k, mi, primera) {
      const soc = app.soc.id, d = est.desde, hh = est.hasta;
      let ultimo = null;
      for (let intento = 1; intento <= 3; intento++) {
        const pags = [intento === 1 && primera ? primera : await documentosPagina(soc, d, hh)];
        if (mi !== nCarga) return null;
        if (pags[0].sinPaginas) return { pags, coherente: true, fallo: null };
        let coherente = true, fallo = null;
        while (pags.length < k) {
          const n = pags.reduce((a, p) => a + p.documentos.length, 0);
          if (n >= (pags[0].total || 0)) break; // ya no hay más antiguos
          let p;
          try { p = await documentosPagina(soc, d, hh, n); } catch (e) { fallo = e; break; }
          if (mi !== nCarga) return null;
          if ((p.total || 0) !== (pags[0].total || 0)) { coherente = false; break; } // entró un documento en medio: las posiciones se corrieron
          if (!p.documentos.length) { fallo = new Error(MSG_SIN_MAS); break; } // faltan documentos y no entregó ninguno: nunca se da por completo lo que no lo está
          pags.push(p);
        }
        ultimo = { pags, coherente, fallo };
        if (coherente || fallo) return ultimo;
      }
      return ultimo;
    }
    // Deja en pantalla las tandas leídas (todas de la misma lectura): reemplaza la primera, los antiguos, el total y los contadores
    function aplicarTandas(pags) {
      est.base = pags[0].documentos;
      est.antiguos = new Map();
      const ya = new Set(est.base.map((x) => x.id));
      for (const p of pags.slice(1)) for (const x of p.documentos) if (!ya.has(x.id)) { ya.add(x.id); est.antiguos.set(x.id, x); }
      est.tandas = pags.length;
      est.n = pags.reduce((a, p) => a + p.documentos.length, 0);
      est.total = Math.max(pags[0].total || 0, cargados());
      est.hayMasBase = !!pags[pags.length - 1].hay_mas && est.total <= cargados(); // una base que avisa «hay más» sin decir cuántos
      est.sinPaginas = !!pags[0].sinPaginas; est.orden = pags[0].orden || 'recientes';
      lecturas++;
    }
    // El reloj no vuelve a leer más de MAX_TANDAS_AUTO tandas (serían miles de filas cada minuto) y tampoco quita nada de lo que la persona ya cargó: lee solo la primera tanda
    // y le suma arriba lo nuevo. Eso solo es seguro si lo nuevo es exactamente lo que explica que el total haya subido y está todo arriba de lo que ya se conocía (así no queda ningún hueco).
    // Si no, no toca nada y lo dice. Devuelve true si pudo sumarlo.
    function sumarNuevos(pag0) {
      const conocidos = new Set(est.base.map((x) => x.id)); for (const id of est.antiguos.keys()) conocidos.add(id);
      const docs = pag0.documentos, k = docs.findIndex((x) => conocidos.has(x.id)); // lugar del primer documento que ya se conocía
      const crecio = (pag0.total || 0) - est.total;
      if (k <= 0 || crecio !== k || !docs.slice(k).every((x) => conocidos.has(x.id))) return false;
      const enBase = new Set(docs.map((x) => x.id)), resto = new Map();
      for (const x of [...est.base, ...est.antiguos.values()]) if (!enBase.has(x.id)) resto.set(x.id, x);
      est.base = docs; est.antiguos = resto; est.n += k; est.total = pag0.total; lecturas++;
      return true;
    }
    // modo: 'nuevo' (primera vez o cambio de fechas: empieza de cero, una tanda), 'actualizar' (botón «Actualizar»: vuelve a pedir lo que ya estaba cargado),
    // 'tras' (después de anular, devolver o corregir: igual, pero sin pantalla de espera), 'auto' (el reloj: no molesta, y solo reconstruye si cambió el total),
    // 'mas' (la tanda siguiente no encajó porque entró un documento: se reconstruye con una tanda más)
    async function cargar(modo = 'nuevo') {
      const silencioso = modo === 'auto' || modo === 'tras' || modo === 'mas';
      if (modo === 'auto' && (silenciosos > 0 || est.cargandoMas || est.cargando)) return; // el siguiente reloj lo vuelve a intentar
      if (modo === 'tras' && est.cargandoMas && promesaMas) await promesaMas.catch(() => {}); // una acción no se pierde por una tanda en camino: espera y luego actualiza
      const mi = ++nCarga;
      if (modo === 'nuevo') nRango++;
      pintarControles();
      if (modo === 'nuevo') {
        // Otras fechas: se vacía todo para no mostrar el total viejo con el rótulo nuevo mientras llega la respuesta
        est.cargando = true; est.error = null; est.errorActualizar = null; est.firma = null; est.errorMas = null; est.avisoRecarga = null; est.avisoFiltro = null; est.avisoNuevos = null;
        est.lista = []; est.base = []; est.antiguos = new Map(); est.total = 0; est.tandas = 1; est.n = 0; est.hayMasBase = false; est.sinPaginas = false; est.orden = 'recientes'; est.pagina = 1; lecturas++;
        pintar();
      } else if (modo === 'actualizar') { est.cargando = true; est.error = null; est.errorActualizar = null; est.firma = null; est.errorMas = null; est.avisoNuevos = null; pintar(); }
      if (silencioso) silenciosos++;
      try {
        // Lo más reciente va arriba (igual que en «Anular factura»): lo último que hizo la cajera se ve sin bajar
        if (est.rango === 'hoy') { const [d0, h0] = rangoDe('hoy'); if (d0 !== est.desde || h0 !== est.hasta) { [est.desde, est.hasta] = [d0, h0]; pintarControles(); } } // la caja se cerró o cambió el día mientras tanto
        // «Hoy» con un turno que abrió en un día anterior arranca en la hora de apertura
        const desdeTurno = est.rango === 'hoy' && turnoDeAyer() ? new Date(turnoDeAyer().abierto_en).getTime() : 0;
        // En «Hoy» con la caja abierta también se lee el estado del turno, para mostrar cómo cuadra con «Apertura y cierre de caja» (si no se puede leer, solo falta esa explicación)
        const turnoId = est.rango === 'hoy' ? turnoAbierto()?.id : null;
        const [pag0, turno] = await Promise.all([documentosPagina(app.soc.id, est.desde, est.hasta), turnoId ? app.api.turnoEstado(turnoId).catch(() => null) : null]);
        if (mi !== nCarga) return; // llegó tarde: ya se pidió otra cosa
        // Cuántas tandas se quieren se calcula AHORA, con lo que hay cargado ahora (no con lo que había cuando empezó esta lectura): las que cubren lo que ya se veía más los documentos nuevos
        const cubrir = Math.min(pag0.total || 0, est.n + Math.max(0, (pag0.total || 0) - est.total));
        const quiere = modo === 'nuevo' ? 1 : modo === 'mas' ? Math.max(1, est.tandas + 1) : Math.max(1, est.tandas, Math.ceil(cubrir / DOCUMENTOS_POR_PAGINA));
        const tope = modo === 'auto' ? MAX_TANDAS_AUTO : MAX_TANDAS_MANUAL;
        const hayAntiguos = modo !== 'nuevo' && (est.tandas > 1 || modo === 'mas') && !pag0.sinPaginas;
        if (!hayAntiguos) { aplicarTandas([pag0]); if (modo !== 'mas') est.avisoRecarga = null; est.avisoNuevos = null; }
        else if (modo === 'auto' && pag0.total === est.total && !est.hayMasBase) {
          // Nada entró desde la última lectura: las posiciones siguen siendo las mismas, solo se refresca la primera tanda y los antiguos se conservan
          est.base = pag0.documentos; lecturas++;
          for (const x of est.base) est.antiguos.delete(x.id); // lo que ya viene en la primera tanda no se cuenta dos veces
        } else if (modo === 'auto' && quiere > MAX_TANDAS_AUTO) {
          // Hay más cargado de lo que el reloj vuelve a leer: se suma lo nuevo arriba sin quitar nada, o se avisa que hay que tocar «Actualizar»
          est.avisoNuevos = pag0.total === est.total || sumarNuevos(pag0) ? null : TXT_NUEVOS;
        } else {
          // Cambió el total (entró o se creó algún documento): lo ya cargado se reconstruye entero, de una sola lectura, y recién entonces se actualiza la pantalla
          const res = await traerTandas(Math.min(quiere, tope), mi, pag0);
          if (!res || mi !== nCarga) return;
          if (modo === 'auto' && (!res.coherente || res.fallo)) return; // el refresco automático no deja una lista a medias: conserva la que había y reintenta pronto
          if (modo === 'actualizar' && res.fallo) throw res.fallo; // «Actualizar» que no pudo leer todo no cambia lo que se ve: se queda la lista de antes y sale el error arriba
          const antes = cargados();
          aplicarTandas(res.pags);
          est.avisoNuevos = null;
          let aviso = null;
          if (res.fallo) { est.errorMas = mensajeAmable(res.fallo); if (modo !== 'mas' || cargados() < antes) aviso = `No se pudieron volver a cargar todos los documentos: solo se ven los ${num(cargados())} más recientes y los más antiguos se quitaron de la lista. Toque «Cargar» para traerlos otra vez.`; }
          else if (!res.coherente) aviso = `Entraron documentos nuevos mientras se actualizaba y solo se pudieron volver a cargar los ${num(cargados())} documentos más recientes. Toque «Cargar» para traer el resto.`;
          else if (quiere > tope) aviso = `Se volvieron a cargar los ${num(cargados())} documentos más recientes (el máximo de una vez). Los más antiguos se quitaron de la lista: toque «Cargar» si los necesita.`;
          est.avisoRecarga = aviso;
        }
        const lista = armarLista(desdeTurno);
        // En el refresco automático solo se vuelve a pintar si algo cambió; así no se pierde lo que la cajera esté escribiendo ni se mueve la pantalla
        est.lista = lista; est.turnoEstado = turno; cacheTexto = new WeakMap();
        const firma = firmaDe(lista, turno);
        if (silencioso && !est.error && est.firma && firma === est.firma) { ultimaCarga = Date.now(); return; }
        est.firma = firma;
        est.error = null; est.errorActualizar = null;
      } catch (e) {
        if (mi !== nCarga) return;
        if (modo === 'mas') { est.errorMas = mensajeAmable(e); return; }
        if (silencioso) return; // el refresco automático no muestra errores: la pantalla sigue como estaba y se vuelve a intentar pronto
        if (modo === 'actualizar' && est.lista.length) est.errorActualizar = mensajeAmable(e); // la lista que se veía se queda; el error sale arriba con su «Intentar de nuevo»
        else est.error = mensajeAmable(e);
      } finally { if (silencioso) silenciosos--; }
      est.cargando = false; ultimaCarga = Date.now();
      if (modo !== 'mas') pintar(); // con «mas» pinta quien lo pidió, al terminar
    }
    // «Hoy» con un turno que abrió en un día anterior arranca en la hora de apertura
    const desdeTurnoAhora = () => (est.rango === 'hoy' && turnoDeAyer() ? new Date(turnoDeAyer().abierto_en).getTime() : 0);
    // La primera tanda más lo que se cargó después, desde la hora de apertura del turno si hace falta, y con lo más reciente arriba
    function armarLista(desdeTurno = desdeTurnoAhora()) {
      return est.base.concat([...est.antiguos.values()]).filter((d) => !desdeTurno || new Date(d.fecha_emision).getTime() >= desdeTurno).sort((a, b) => new Date(b.fecha_emision) - new Date(a.fecha_emision));
    }
    // esProblema cambia con el reloj (más de 15 minutos esperando a Hacienda), por eso entra en la firma
    const firmaDe = (lista, turno) => JSON.stringify([lista, turno]) + '|' + lista.filter(esProblema).length + '|' + cargados() + '/' + est.total + '|' + est.tandas + '|' + (est.avisoRecarga || '') + '|' + (est.errorMas || '') + '|' + (est.avisoNuevos || '');
    // Después de anular, devolver o corregir (o de reenviar, o de atender): se vuelve a leer todo lo que estaba cargado, así la fila de un documento de la parte antigua también cambia
    const refrescarTras = () => cargar('tras');
    // El botón «Cargar» tiene el foco del teclado: al volver a pintar la pantalla el foco se devuelve ahí (o, si el botón ya no hace falta, a la lista)
    const botonMas = '[data-cargar-antiguos],[data-cargar-buscar]';
    const quienTieneFoco = () => { const a = document.activeElement; return a && root.contains(a) && a.matches?.(botonMas) ? (a.hasAttribute('data-cargar-buscar') ? 'data-cargar-buscar' : 'data-cargar-antiguos') : null; };
    const devolverFoco = (attr) => {
      if (!attr) return;
      const b = root.querySelector(`[${attr}]`) || root.querySelector(botonMas);
      if (b) { try { b.focus({ preventScroll: true }); } catch { /* nada */ } return; }
      const z = zonaCabeza.childElementCount ? zonaCabeza : zonaLista; z.tabIndex = -1; try { z.focus({ preventScroll: true }); } catch { /* nada */ }
    };
    // Trae la tanda siguiente (los documentos más antiguos del rango) y la suma a lo que ya se ve. Una tanda son hasta 1 000 documentos.
    // Termina SIEMPRE pintando la pantalla (con la tanda, con el aviso de error o con la lista nueva) y devuelve el foco al botón.
    // Reglas para que nunca quede un hueco ni se dé por completo lo que no lo está:
    //  - no corre a la vez que una lectura silenciosa (el reloj o lo que sigue a una acción): espera a que termine y recién ahí mira dónde va lo cargado;
    //  - la tanda solo se suma si, al llegar, lo cargado sigue siendo lo mismo que al pedirla y el total no cambió; si no, se descarta y se reconstruye todo de una sola lectura;
    //  - una tanda vacía con documentos todavía por cargar no baja el total: también se reconstruye (y, si sigue sin entregar nada, se dice).
    function cargarAntiguos() {
      if (est.cargandoMas || est.cargando || !puedeMas()) return promesaMas;
      const miRango = nRango, foco = quienTieneFoco();
      est.cargandoMas = true; est.errorMas = null; pintar(); devolverFoco(foco);
      promesaMas = (async () => {
        try {
          while (silenciosos > 0) await esperar(60);
          if (miRango !== nRango || est.cargando || !puedeMas()) return; // se cambiaron las fechas mientras tanto, o la lectura que terminó ya trajo todo
          const miLectura = lecturas, n0 = est.n, total0 = est.total;
          const pag = await documentosPagina(app.soc.id, est.desde, est.hasta, n0);
          if (miRango !== nRango) return; // se cambiaron las fechas (o se empezó de cero) mientras tanto: esta tanda es de otra lista
          const noEncaja = miLectura !== lecturas || est.n !== n0 // lo cargado cambió mientras llegaba la tanda
            || (pag.total || 0) !== total0 // entró un documento mientras tanto: las posiciones se corrieron
            || (!pag.documentos.length && n0 < (pag.total || 0)); // faltan documentos y no entregó ninguno
          if (noEncaja) { await cargar('mas'); return; } // la tanda se descarta y se reconstruye todo de una sola lectura
          const ya = new Set(est.base.map((d) => d.id));
          for (const d of pag.documentos) if (!ya.has(d.id)) est.antiguos.set(d.id, d);
          est.n += pag.documentos.length; if (pag.documentos.length) est.tandas++;
          est.total = Math.max(pag.total || 0, cargados()); // nunca se baja el total de lo que dijo la base
          est.hayMasBase = !!pag.hay_mas && est.total <= cargados() && pag.documentos.length > 0;
          est.avisoRecarga = null; lecturas++;
          est.lista = armarLista(); cacheTexto = new WeakMap(); est.firma = firmaDe(est.lista, est.turnoEstado);
        } catch (e) { if (miRango === nRango) est.errorMas = mensajeAmable(e); }
        finally { est.cargandoMas = false; pintar(); devolverFoco(foco); }
      })();
      return promesaMas;
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
      // Documentos con devoluciones o correcciones de crédito, y con notas de débito (llaves nuevas de fx_documentos: parciales_n y debitos_n)
      const nDev = est.lista.reduce((a, d) => a + (conDevolucion(d) ? 1 : 0), 0), nDeb = est.lista.reduce((a, d) => a + (conDebito(d) ? 1 : 0), 0);
      // Un filtro sin ningún documento vuelve a «Todos», pero nunca en silencio: si faltan documentos por cargar el filtro se queda (puede que lo que busca esté en los que faltan) y si no, se dice por qué cambió
      const cuentaFiltro = { problemas: problemas.length, pendientes: pend.length, aceptados: nAcept, rechazados: nRech, devoluciones: nDev, debitos: nDeb };
      if (est.filtro in cuentaFiltro && !cuentaFiltro[est.filtro] && !puedeMas()) {
        est.avisoFiltro = `${ORACION_FILTRO[est.filtro]} en estas fechas, así que se muestran todos los documentos.`;
        est.filtro = 'todos';
      }
      // Tarifas de IVA que hay en la lista: el filtro solo sale si hay más de una (si todo es IVA 13 %, filtrar no sirve de nada)
      const porTarifa = new Map();
      for (const d of est.lista) for (const t of listaTarifas(d)) porTarifa.set(t, (porTarifa.get(t) || 0) + 1);
      if (est.tarifa && !porTarifa.has(est.tarifa)) est.tarifa = '';
      const selTarifa = porTarifa.size > 1 ? h('select.campo', { 'aria-label': 'Tarifa de IVA', onchange: (e) => { est.tarifa = e.target.value; est.pagina = 1; pintar(); } },
        h('option', { value: '' }, 'Todas las tarifas'), [...porTarifa].sort((a, b) => a[0].localeCompare(b[0], 'es', { numeric: true })).map(([t, n]) => h('option', { value: t }, `${t} (${n})`))) : null;
      if (selTarifa) selTarifa.value = est.tarifa;
      // Cada filtro sale si tiene documentos; el que está elegido sale siempre (aunque diga 0 mientras faltan documentos por cargar)
      const chip = (k, t, n) => (n || est.filtro === k ? [k, `${t} (${num(n)})`] : null);
      zonaFiltros.replaceChildren(...[['todos', `Todos (${num(est.lista.length)})`], chip('problemas', 'Con problemas', problemas.length), chip('pendientes', 'Esperando a Hacienda', pend.length),
        chip('aceptados', 'Aceptados', nAcept), chip('rechazados', 'Rechazados', nRech),
        chip('devoluciones', 'Con devolución', nDev), chip('debitos', 'Con nota de débito', nDeb)]
        .filter(Boolean).map(([k, t]) => h('button.btn' + (k === 'problemas' ? '.alerta' : ''), { type: 'button', 'aria-pressed': String(est.filtro === k), onclick: () => { est.filtro = k; est.avisoFiltro = null; est.pagina = 1; pintar(); } }, t)),
        ...(selTarifa ? [h('label.doc-tarifa', h('span', 'Tarifa de IVA'), selTarifa)] : []));
      if (est.avisoFiltro) zonaFiltros.append(h('p.doc-aviso-filtro', { role: 'status' }, est.avisoFiltro));
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
      // Mientras falten documentos por cargar, el total NO es el del turno, el día o el mes: la tarjeta lo dice con palabras
      const rotulo = hayMas() ? `Total de los ${num(cargados())} documentos ${est.orden === 'antiguos' ? 'más antiguos' : 'más recientes'}`
        : est.rango === 'hoy' ? (turnoDeAyer() ? 'Total de este turno' : 'Total de hoy') : (est.rango === 'mes' || est.rango === 'anterior') ? 'Total del mes' : una ? 'Total del día' : 'Total de las fechas elegidas';
      zonaResumen.replaceChildren(h('div.doc-resumen',
        h('div.doc-neto', h('span.doc-etq', rotulo), h('b.doc-gran', money(s.neto))),
        h('span.doc-det-res', `${num(s.nVentas)} ${s.nVentas === 1 ? 'venta' : 'ventas'}`, s.nAnul ? `, ${num(s.nAnul)} ${s.nAnul === 1 ? 'anulación' : 'anulaciones'}` : '',
          s.nDev ? `, ${num(s.nDev)} ${s.nDev === 1 ? 'devolución o corrección' : 'devoluciones o correcciones'}` : '', s.nND ? `, ${num(s.nND)} ${s.nND === 1 ? 'nota de débito' : 'notas de débito'}` : '', ` · de los cuales ${money(s.iva / 100)} son IVA`)));
      pintarCuadre(s);
      // El servidor entrega los documentos por tandas de 1 000, los más nuevos primero: si faltan los más antiguos, el total de arriba no es el de todo el rango, y hay que decirlo
      if (hayMas()) zonaCuadre.prepend(avisoFaltan());
      if (est.avisoNuevos) zonaCuadre.prepend(h('p.doc-aviso-nuevos.an-aviso', { role: 'status' }, est.avisoNuevos));
      // «Actualizar» falló: lo que se ve es lo de antes y el error sale arriba, con su botón para intentar otra vez
      if (est.errorActualizar) zonaCuadre.prepend(h('div.doc-aviso-actualizar.error-caja', { role: 'alert' },
        h('p', h('b', 'No se pudo actualizar la lista. '), est.errorActualizar), h('p', 'Lo que se ve abajo es lo de antes: pueden faltar documentos nuevos.'),
        h('button.btn.primario', { type: 'button', 'data-reintentar-actualizar': '1', onclick: actualizarTodo }, 'Intentar de nuevo')));
    }
    // El aviso de que faltan documentos: recuadro ámbar con lo que pasa, lo que falta, y el botón para cargar lo que falta
    function avisoFaltan() {
      const f = faltan(), una = est.desde === est.hasta;
      const alcance = est.rango === 'hoy' ? (turnoDeAyer() ? 'del turno completo' : 'de todo el día') : (est.rango === 'mes' || est.rango === 'anterior') ? 'de todo el mes' : una ? 'de todo el día' : 'de todas las fechas elegidas';
      const titulo = f > 0 ? (f === 1 ? 'Falta 1 documento más antiguo.' : `Faltan ${num(f)} documentos más antiguos.`) : 'Puede haber más documentos de los que se ven.';
      const sinCargar = est.sinPaginas
        ? `En estas fechas hay más documentos de los que esta pantalla puede traer de una vez: se ven los ${num(cargados())} ${est.orden === 'antiguos' ? 'más antiguos' : 'primeros'}. Para ver los demás, elija fechas más cortas, por ejemplo un solo día.`
        : f > 0 ? `Estas fechas tienen ${num(est.total)} documentos y aquí se ven los ${num(cargados())} más recientes. Este total todavía no es el ${alcance}.`
          : `Aquí se ven ${num(cargados())} documentos y hay más de estas fechas que todavía no se cargaron. Este total todavía no es el ${alcance}.`;
      // Mientras se actualiza la lista, «Cargar» queda apagado y dice por qué (las dos cosas a la vez dejarían la lista a medias)
      const boton = puedeMas() ? h('button.btn.primario', { type: 'button', 'data-cargar-antiguos': '1', 'aria-busy': String(est.cargandoMas), disabled: est.cargando, onclick: cargarAntiguos },
        est.cargandoMas ? 'Cargando…' : f > 0 && f <= DOCUMENTOS_POR_PAGINA ? (f === 1 ? 'Cargar el documento que falta' : `Cargar los ${num(f)} documentos que faltan`) : 'Cargar más documentos antiguos') : null;
      return h('div.doc-faltan.an-aviso', { role: 'note' },
        h('p.doc-cuadre-frase.alerta', h('b', titulo + ' '), sinCargar),
        est.avisoRecarga ? h('p.doc-cuadre-frase', est.avisoRecarga) : null,
        boton,
        boton && est.cargando ? h('p.doc-cuadre-frase.tenue', { role: 'status' }, 'Espere un momento: se está actualizando la lista. Cuando termine podrá cargar los que faltan.') : null,
        est.errorMas ? h('div.error-caja', { role: 'alert' }, est.errorMas) : null);
    }

    // Qué no suma y qué sí suma este total, y cómo cuadra con «Apertura y cierre de caja» (mismas frases y montos que en esa pantalla)
    function pintarCuadre(s) {
      const frases = frasesDeLista(s);
      // El cuadre con «Apertura y cierre de caja» sale en «Hoy» con la caja abierta: se hace con los documentos emitidos desde la apertura del turno
      const turno = est.rango === 'hoy' ? turnoAbierto() : null;
      // Con documentos sin cargar no se compara: lo que falta aparecería como una diferencia con la caja que no es real
      const faltaCargar = hayMas() && !!turno && !!est.turnoEstado;
      const p = turno && est.turnoEstado && !faltaCargar ? puenteConTurno(sumarDocumentos(docsDelTurno(est.lista, turno.abierto_en)), est.turnoEstado) : null;
      const partes = frases.map((t) => h('p.doc-cuadre-frase', t));
      if (faltaCargar) partes.push(h('p.doc-cuadre-frase', puedeMas() ? 'Para comparar con «Apertura y cierre de caja», primero cargue los documentos que faltan.' : 'No se puede comparar con «Apertura y cierre de caja» porque faltan documentos que esta pantalla no puede cargar.'));
      else if (p && p.coincide && !p.turnoRech && !p.sin) partes.push(h('p.doc-cuadre-frase.ok', `El turno abierto coincide con el total vendido de «Apertura y cierre de caja» (${money(p.turnoNeto / 100)}).`));
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
        // Si faltan documentos por cargar, «no coincide» solo es cierto para los cargados: se dice cuántos se miraron y cuántos faltan, y se ofrece cargarlos y buscar otra vez
        const f = faltan();
        const faltanTxt = f > 0 ? `Se buscó entre los ${num(cargados())} documentos cargados; ${f === 1 ? 'falta 1 más antiguo' : `faltan ${num(f)} más antiguos`}.` : `Se buscó entre los ${num(cargados())} documentos cargados; hay más de estas fechas sin cargar.`;
        zonaLista.replaceChildren(h('div.vacio',
          est.lista.length ? h('p', 'Ningún documento coincide con lo que buscó.')
            : h('p', hoy ? (turnoDeAyer() ? 'Todavía no hay documentos en este turno. Cuando cobre una venta en Facturación, aparecerá aquí.' : 'Todavía no hay documentos hoy. Cuando cobre una venta en Facturación, aparecerá aquí.') : 'No hay documentos en estas fechas.'),
          est.lista.length && hayMas() ? h('p.tenue', faltanTxt) : null,
          est.lista.length && puedeMas() ? h('button.btn.primario', { type: 'button', 'data-cargar-buscar': '1', 'aria-busy': String(est.cargandoMas), disabled: est.cargando, onclick: cargarAntiguos },
            est.cargandoMas ? 'Cargando…' : (f > 0 && f <= DOCUMENTOS_POR_PAGINA ? `Cargar los ${num(f)} documentos que faltan y buscar de nuevo` : 'Cargar más documentos antiguos y buscar de nuevo')) : null,
          est.lista.length && puedeMas() && est.cargando ? h('p.tenue', { role: 'status' }, 'Espere un momento: se está actualizando la lista.') : null,
          est.lista.length && est.errorMas ? h('div.error-caja', { role: 'alert' }, est.errorMas) : null,
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
      // Faltan documentos por cargar: el día del documento más viejo cargado (o del más nuevo, si la base entregó los más antiguos) puede estar incompleto, y su total no es el del día entero
      const diaIncompleto = hayMas() && est.lista.length ? ymdDe(est.lista[est.orden === 'antiguos' ? 0 : est.lista.length - 1].fecha_emision) : null;
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
            const incompleto = k === diaIncompleto;
            out.push(h('div.doc-dia' + (incompleto ? '.incompleto' : ''), h('b', diaTxt(k)), h('span', incompleto
              ? `${num(x.n)} ${x.n === 1 ? 'documento cargado' : 'documentos cargados'} de este día, total ${money(x.t / 100)}. Faltan documentos de este día: este total no es el del día completo.` + (partido ? ` En esta página: ${num(enEstaPagina.get(k))}.` : '')
              : `${num(x.n)} ${x.n === 1 ? 'documento' : 'documentos'}${partido ? ' en el día' : ''}, total ${money(x.t / 100)}` + (partido ? `. En esta página: ${num(enEstaPagina.get(k))}` : ''))));
          }
          out.push(h('div.doc-cabeza', h('div.doc-cabeza-cols', h('span', 'Hora'), h('span', 'Documento'), h('span', 'Cliente'), h('span.der', 'Total'), h('span', 'Estado')), h('span.doc-cabeza-acc', 'Acciones')));
        }
        out.push(fila(d));
      }
      zonaLista.replaceChildren(...out);
      // Encabezado de la lista: cuántos documentos hay y cuáles se ven. El hueco #doc-descargas es para los botones de descarga (Excel, CSV, PDF, XML) que se agregan aparte.
      // Mientras falten documentos por cargar, los números dicen «cargados»: la lista y la búsqueda solo ven lo que está cargado
      const cg = hayMas() ? ' cargados' : '';
      const filtrando = !!est.q.trim() || est.filtro !== 'todos' || !!est.tarifa;
      zonaCabeza.replaceChildren(...[
        h('span.doc-conteo', paginas > 1 ? `Documentos ${num(desde + 1)} a ${num(desde + trozo.length)} de ${num(visibles.length)}${cg}` : `${num(visibles.length)} ${visibles.length === 1 ? 'documento' : 'documentos'}${hayMas() ? (visibles.length === 1 ? ' cargado' : ' cargados') : ''}`),
        hayMas() && filtrando ? h('span.doc-conteo-nota', `La búsqueda y los filtros miran solo los ${num(cargados())} documentos cargados.`) : null,
        zonaDescargas].filter(Boolean)); // replaceChildren escribiría «null» como texto
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
      // Archivo parcial: si faltan documentos por cargar, el archivo lo dice arriba (subtítulo, que sale en Excel y en PDF) y en el nombre (que es lo único que viaja en el CSV), con el número REAL de filas
      const parcial = hayMas();
      const filtrado = !!q || est.filtro !== 'todos' || !!est.tarifa;
      const cuales = est.orden === 'antiguos' ? 'más antiguos' : 'más recientes';
      const faltanN = faltan();
      const textoParcial = !parcial ? '' : filtrado
        ? `ARCHIVO PARCIAL: trae ${num(filas.length)} ${filas.length === 1 ? 'fila' : 'filas'} que salen solo de los ${num(cargados())} documentos ${cuales} cargados; ${faltanN > 0 ? `faltan ${num(faltanN)} documentos por cargar` : 'hay más documentos de estas fechas sin cargar'}.`
        : `ARCHIVO PARCIAL: trae ${num(filas.length)} de los ${num(est.total)} documentos de estas fechas (los ${cuales}); ${faltanN > 0 ? `faltan ${num(faltanN)}` : 'hay más sin cargar'}.`;
      if (parcial) notas.push(textoParcial + (puedeMas() ? ' Para tener los demás, toque «Cargar» en la pantalla antes de descargar, o elija un rango de fechas más corto.' : ' Elija un rango de fechas más corto para tenerlos todos.'));
      // El nombre lleva primero lo que no se puede perder («parcial 12 filas, faltan 300 sin cargar») y recién después el filtro y la búsqueda, que se recortan si no caben (un nombre se corta a 150 letras)
      const parcialNombre = !parcial ? '' : filtrado ? `parcial ${num(filas.length)} ${filas.length === 1 ? 'fila' : 'filas'}${faltanN > 0 ? `, faltan ${num(faltanN)} sin cargar` : ''}` : `parcial ${num(filas.length)} de ${num(est.total)}`;
      let nombre = `Facturas emitidas ${nombrePeriodo(est.desde, est.hasta)}${parcialNombre ? ' ' + parcialNombre : ''}`;
      if (filtroCorto && NOMBRE_MAX - nombre.length - 1 >= 8) nombre += ' ' + paraArchivo(filtroCorto, NOMBRE_MAX - nombre.length - 1);
      if (paraArchivo(q, 30) && NOMBRE_MAX - nombre.length - ' búsqueda '.length >= 4) nombre += ' búsqueda ' + paraArchivo(q, Math.min(30, NOMBRE_MAX - nombre.length - ' búsqueda '.length));
      return {
        nombre,
        empresa: nombreLocal(soc), cedula: soc?.cedula || '',
        titulo: 'Facturas, tiquetes y notas de crédito emitidos',
        subtitulo: (parcial ? textoParcial + ' · ' : '') + 'Emitidos ' + textoRango(est.desde, est.hasta) + (filtroTxt ? ' · ' + filtroTxt : '') + (q ? ` · búsqueda: «${q}»` : ''),
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
            (nc || d.tipo_doc === '02') && d.ref_consecutivo ? fraseReferencia(d) : '',
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
        else if (d.estado === 'aceptado' && (nDev > 0 || nDeb > 0)) segundo = h('button.btn.peligro.doc-bot', { type: 'button', disabled: true, 'aria-label': `Anular ${quien}. No disponible: ya tiene ${nDeb > 0 ? 'una nota de débito' : 'una devolución o una corrección'}` }, 'Anular'); // la base tampoco deja anular completo un documento con notas (admite_anulacion = false); en el detalle se ve por qué y qué sí se puede hacer
        else if (d.estado === 'aceptado') segundo = h('button.btn.peligro.doc-bot', { type: 'button', 'aria-label': 'Anular ' + quien, onclick: () => abrirAnular(d, { alTerminar: () => refrescarTras(), alVerNC: (n) => abrirDetalle(n.id) }) }, 'Anular');
        else if (d.estado === 'rechazado' || d.estado === 'error') segundo = h('button.btn.doc-bot', { type: 'button', 'aria-label': (d.atendida ? 'Ver detalle de ' : 'Ver y atender ') + quien, onclick: () => abrirDetalle(d.id) }, d.atendida ? 'Ver detalle' : 'Ver y atender'); // el nombre accesible empieza con el mismo texto que se ve
      }
      // Todavía no hay nada que anular (Hacienda no ha aceptado el documento): se dice a la vista, no solo al pasar el mouse
      const espera = esVenta(d) && !anulado && (d.estado === 'pendiente' || d.estado === 'enviado')
        ? h('div.doc-espera', { role: 'note' }, h('b', 'Esperando a Hacienda. '), 'Todavía no se puede anular: podrá hacerlo cuando Hacienda lo acepte. Toque la fila para ver qué significa y qué hacer.')
        : esVenta(d) && !anulado && d.estado === 'aceptado' && (nDev > 0 || nDeb > 0)
          ? h('div.doc-espera', { role: 'note' }, h('b', 'No se anula completo. '), `Ya tiene ${nDeb > 0 && nDev > 0 ? 'una devolución o corrección y una nota de débito' : nDeb > 0 ? 'una nota de débito' : 'una devolución o una corrección'}. Toque la fila: ahí puede devolver otra parte o corregir un monto.`) : null;
      return h('div.doc-fila' + (nc ? '.nc' : '') + (nd ? '.nd' : '') + (anulado ? '.anulada' : ''),
        h('button.doc-ver', { type: 'button', onclick: () => abrirDetalle(d.id), 'aria-label': `${tipo} número ${numeroCorto(d.consecutivo)}, ${money(d.total)}${nDev ? ', con devolución' : ''}${nDeb ? ', con nota de débito' : ''}. Toque para ver el detalle` },
          h('span.c-hora', horaCorta(d.fecha_emision)),
          h('span.c-doc', h('span.nw', h('b', tipo), ' N.° ' + numeroCorto(d.consecutivo)),
            d.nombre_simple ? h('span.sub.rotulo', d.nombre_simple) : null, // Devolución, Corrección de monto, Anulación total, Anulación y sustitución, Deja sin efecto la anulación
            anulado ? h('span.sub.anul', `Anulado por la nota de crédito N.° ${numeroCorto(d.nc_consecutivo)}`) : null,
            (nc || nd) && d.ref_consecutivo ? h('span.sub', fraseReferencia(d)) : null,
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
    // ¿Esta venta ya se volvió a hacer? Sí cuando hay otro documento vivo (ni rechazado ni anulado) que la reemplaza (reemplaza_a) o que sale de su copia («Corrección de #N», como la nombra la base al copiarla).
    // Solo se sabe con lo que está cargado en la lista: si el documento nuevo no está ahí no se afirma nada, y la base rechaza el duplicado con su propio mensaje (que la pantalla muestra tal cual).
    const rehechoPor = (c) => {
      if (!c || !esVenta(c)) return null;
      const ref = c.venta?.numero ? 'Corrección de #' + c.venta.numero : null, t = new Date(c.fecha_emision).getTime();
      return est.lista.find((r) => r.id !== c.id && esVenta(r) && r.estado !== 'rechazado' && !r.nc_id && (r.reemplaza_a === c.id || (!!ref && r.referencia === ref && new Date(r.fecha_emision).getTime() > t))) || null;
    };
    async function abrirDetalle(id) {
      const caja = h('div.doc-det', h('p.cargando', 'Cargando el documento…'));
      let vivo = true;
      let firma = null; // lo último que se pintó; el refresco automático solo vuelve a pintar si el documento cambió
      let nCarga = 0;
      let saldosVistos = false; // ya se pudieron leer las notas de este documento en una pintura anterior
      let estadoVisto = null; // el estado del documento en la última lectura: si Hacienda todavía no responde, la ventana se actualiza más seguido
      const borrador = { nota: '' }; // la nota que se está escribiendo no se pierde si la ventana se vuelve a pintar
      const m = modal({ titulo: 'Detalle del documento', contenido: caja, ancho: 780, alCerrar: () => { vivo = false; clearInterval(rapido); if (detalleActual?.caja === caja) detalleActual = null; } });
      // Mientras el documento esté por enviarse o enviado, se vuelve a leer cada 5 segundos para que «Anular» se habilite solo cuando Hacienda lo acepte
      const rapido = setInterval(() => { if (vivo && !document.hidden && (estadoVisto === 'pendiente' || estadoVisto === 'enviado')) pintarDet(true); }, 5000);
      const pintarDet = async (silencioso = false) => {
        const mi = ++nCarga;
        try {
          let falloNC = false;
          // anulacionDe trae la anulación total vigente (nc: solo la nota de crédito de código 01; una devolución parcial NO anula), los saldos con las demás notas del documento y, si el documento
          // está anulado, los saldos de la nota de crédito: ahí está si se puede dejar sin efecto (admite_sin_efecto) o si ya se dejó sin efecto con una nota de débito (cuelga de la nota de crédito, no del documento)
          const [c, an] = await Promise.all([app.api.comprobante(id), anulacionDe(id).catch(() => { falloNC = true; return { nc: null, saldos: null, ncAnulacion: null, saldosNC: null, sinEfecto: null }; })]);
          if (!vivo || mi !== nCarga) return;
          estadoVisto = c?.estado || null;
          if (silencioso && falloNC) return; // si no se pudo ver la nota de crédito, mejor no cambiar lo que ya se ve
          // Si la lectura de las notas falló esta vez (saldos vacíos) y antes sí se habían leído, se conserva lo anterior: no se apagan avisos ni se prenden botones por un fallo pasajero
          if (silencioso && !an.saldos && saldosVistos) return;
          const { nc, saldos, ncAnulacion: ncAnula, saldosNC, sinEfecto } = an; // con la anulación dejada sin efecto, nc es null: el documento vuelve a valer
          const nueva = JSON.stringify([c, nc, saldos, saldosNC, sinEfecto, falloNC, rehechoPor(c)?.id || null]);
          if (silencioso && nueva === firma) return; // nada cambió: no se toca la pantalla (ni el cursor, ni el teclado del celular)
          firma = nueva; saldosVistos = !!saldos;
          // Si había un campo con el cursor adentro, después de pintar vuelve a quedar ahí, en el mismo lugar
          const foco = caja.contains(document.activeElement) && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)
            ? { etiqueta: document.activeElement.getAttribute('aria-label'), ini: document.activeElement.selectionStart, fin: document.activeElement.selectionEnd } : null;
          caja.replaceChildren(vistaDetalle(c, nc, { repintar: pintarDet, cerrar: m.cerrar, borrador, saldos, saldosNC, sinEfecto, ncAnula, falloNC }));
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
      // No se pudo leer si el documento está anulado: no se dice ni que sí ni que no
      if (ctx.falloNC && esVenta(c)) raiz.append(h('div.doc-aviso.ref', h('div', h('b', 'No se pudo comprobar si este documento está anulado. '), 'Revise la conexión. Mientras tanto, no dé por hecho que sigue valiendo.'),
        h('button.btn', { type: 'button', 'data-reintentar': '1', onclick: (e) => ejecutar(e.currentTarget, () => ctx.repintar()) }, 'Intentar de nuevo')));
      // La anulación se dejó sin efecto con una nota de débito (que cuelga de la nota de crédito): el documento vuelve a valer
      if (ctx.sinEfecto && esVenta(c)) raiz.append(h('div.doc-aviso.ref', h('div', h('b', `La anulación de este documento se dejó sin efecto con la nota de débito N.° ${numeroCorto(ctx.sinEfecto.consecutivo)}. `), 'El documento vuelve a valer.' + (ctx.sinEfecto.estado !== 'aceptado' ? ' La nota de débito todavía está esperando la respuesta de Hacienda.' : '') + ' Lo que se puede hacer con él se dice abajo, en «Corregir o anular».'),
        h('button.btn', { type: 'button', onclick: () => { ctx.cerrar(); abrirDetalle(ctx.sinEfecto.id); } }, 'Ver la nota de débito')));
      if (esNC && sinEfectoDeSaldos(ctx.saldos)) { const nd = sinEfectoDeSaldos(ctx.saldos); raiz.append(h('div.doc-aviso.ref', h('div', h('b', `Esta anulación se dejó sin efecto con la nota de débito N.° ${numeroCorto(nd.consecutivo)}. `), 'El documento que se había anulado vuelve a valer.'),
        h('button.btn', { type: 'button', onclick: () => { ctx.cerrar(); abrirDetalle(nd.id); } }, 'Ver la nota de débito'))); }
      if ((esNC || esND) && c.original) {
        const sobreNota = c.original.tipo_doc === '03'; // una nota de débito que deja sin efecto la anulación se apoya en la nota de crédito
        const num_ = numeroCorto(c.original.consecutivo), a = conArticulo(c.original.tipo_doc);
        // Lo que hace la nota, en palabras: anula, corrige o deja sin efecto la anulación (el código de Hacienda queda aparte, en «Tipo de nota»)
        const [lead, queHace] = esNC
          ? (['01', '13'].includes(cod) ? [`Esta nota anula ${a} N.° ${num_}.`, 'Deja sin efecto todo el documento.']
            : cod === '06' ? [`Esta nota corrige ${a} N.° ${num_}.`, 'Devuelve una parte de ese documento.']
              : cod === '02' ? [`Esta nota corrige ${a} N.° ${num_}.`, 'Corrige el monto: se había cobrado de más.'] : [`Esta nota corrige ${a} N.° ${num_}.`, ''])
          : sobreNota ? [`Esta nota deja sin efecto la anulación de ${a} N.° ${num_}.`, 'El documento vuelve a valer.'] : [`Esta nota corrige ${a} N.° ${num_}.`, 'Corrige el monto: se había cobrado de menos.'];
        raiz.append(h('div.doc-aviso.ref', h('div', h('b', lead + ' '), queHace, tipoNotaTxt ? h('div.doc-motivo', 'Tipo de nota: ' + tipoNotaTxt + '.') : null, c.motivo ? h('div.doc-motivo', 'Motivo: ' + c.motivo) : null),
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
      // Desde fx_23i la lista trae también la nota de débito 01 que dejó sin efecto la anulación: esa ya tiene su aviso arriba y no cobra nada nuevo, así que no se cuenta aquí
      // como «una nota de débito» (sí sale en la lista, con su nombre «Deja sin efecto la anulación»)
      const esDeSinEfecto = (n) => n.tipo_doc === '02' && String(n.codigo_referencia) === '01';
      const propias = otras.filter((n) => !esDeSinEfecto(n));
      if (propias.length) {
        const sd = ctx.saldos, dinero = (k) => (sd && Number.isFinite(Number(sd[k])) ? Number(sd[k]) : 0);
        const partes = [dinero('total_acreditado') > 0 ? `Lleva devuelto ${money(dinero('total_acreditado'))}.` : '', dinero('total_debitado') > 0 ? `Lleva ${money(dinero('total_debitado'))} en notas de débito.` : '',
          // «Lo que queda» solo se dice cuando no hay notas de débito: con ellas el valor real del documento sube y la base no manda ese número ya calculado
          sd && sd.saldo_total != null && !(dinero('total_debitado') > 0) ? `Valor que queda del documento: ${money(dinero('saldo_total'))}.` : ''].filter(Boolean).join(' ');
        // Qué notas tiene, en palabras de uso diario: una devolución o corrección (nota de crédito) o una nota de débito
        const nCred = propias.filter((n) => n.tipo_doc === '03').length, nDeb = propias.length - nCred;
        const tiene = [nCred ? (nCred === 1 ? 'una devolución o una corrección' : `${num(nCred)} devoluciones o correcciones`) : '', nDeb ? (nDeb === 1 ? 'una nota de débito' : `${num(nDeb)} notas de débito`) : ''].filter(Boolean).join(' y ');
        raiz.append(h('div.doc-aviso.ref.notas', h('div', h('b', `Este documento tiene ${tiene}. `), partes, listaNotas(sd))));
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

      // Líneas y totales. El título dice qué hace el documento: una factura lo que se facturó, una nota de crédito lo que se devuelve, una nota de débito lo que se cobra en esa nota.
      // En el celular la columna «Precio con IVA» se oculta para que «Total» quepa entera: el precio de cada producto se lee debajo de su nombre.
      raiz.append(h('div.doc-seccion', h('h3', esNC ? 'Lo que se devuelve' : esND ? 'Lo que se cobra en esta nota' : 'Lo que se facturó'),
        h('div.tabla-caja', h('table.tabla',
          h('thead', h('tr', h('th', 'Cant.'), h('th', 'Descripción'), h('th.der.col-precio', 'Precio con IVA'), h('th.der', 'Total'))),
          h('tbody', lineas.map((l) => h('tr', h('td.cifra', num(l.cantidad)), h('td', l.descripcion || '', l.nota ? h('div.tenue', l.nota) : null, h('div.tenue.doc-precio-cel', `${num(l.cantidad)} × ${money(l.precio_final)}`)), h('td.der.col-precio', money(l.precio_final)), h('td.der', money(l.total_linea)))))))));
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
      try { return await fn(); } catch (e) { toast(mensajeAmable(e), 'error', 7000); } finally { b.disabled = b.dataset.apagado === '1'; delete b.dataset.ocupado; } // apagado = la acción ya no corresponde (por ejemplo, la venta ya se rehízo)
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
            await ctx.repintar(true); await refrescarTras();
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
      const repintar = async () => { await ctx.repintar(true); await refrescarTras(); };
      const doc = { ...c, cliente: c.cliente_snapshot?.nombre || '' };
      const verNota = (n) => { ctx.cerrar(); abrirDetalle(n.id); };
      // Con la anulación sin efecto el documento vuelve a valer: sigue al bloque normal, donde la base dice qué se puede (admite_anulacion: no se anula completo otra vez;
      // admite_notas: con la nota de débito 01 aceptada sí se devuelve o se corrige una parte, mientras Hacienda no la acepta no). Aquí no se inventan reglas.
      if (nc) {
        // Una anulación aceptada se puede dejar sin efecto con una nota de débito (la base lo dice en admite_sin_efecto de la NOTA DE CRÉDITO)
        const sinEf = ctx.saldosNC?.admite_sin_efecto === true && nc.estado === 'aceptado';
        const docNC = { id: nc.id, tipo_doc: '03', consecutivo: nc.consecutivo, total: nc.total ?? c.total, fecha_emision: nc.fecha_emision, cliente: doc.cliente };
        g.append(...[h('p.tenue', `Este documento ya fue anulado con la nota de crédito N.° ${numeroCorto(nc.consecutivo)}. No se puede anular dos veces.`),
          c.venta_id ? bloqueRehacer(c, ctx) : null,
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
        // Si no se pudo comprobar si el documento ya está anulado, los cuatro botones quedan apagados con su razón a la vista; con «Intentar de nuevo» se encienden si la lectura sale bien
        const sinComprobar = !!ctx.falloNC;
        const motivoNotas = noNotas ? (String(ctx.saldos.motivo_no_admite || '').trim() || 'Este documento no admite devoluciones ni correcciones.') : '';
        const abrirParcial = (abrirla) => async () => { abrirla(app, doc, { alTerminar: repintar, alVerNota: verNota }); };
        g.append(...[h('p.tenue', !nc && ctx.sinEfecto ? 'La anulación se dejó sin efecto, así que este documento vuelve a valer. Abajo se dice qué se puede hacer con él.'
          : 'Si la venta se hizo mal, se anula con una nota de crédito (código 01, anulación total). El documento original no se borra: queda guardado y enlazado a la nota. Si solo hay que devolver o corregir una parte, no hace falta anular todo: use «Devolver parte» o «Corregir un monto».'),
          // Si no se pudieron leer las notas del documento, se dice: los botones quedan activos y es la base la que rechaza lo que no corresponda
          !ctx.saldos && !ctx.falloNC ? h('div.doc-espera-caja', { role: 'note' }, h('p', h('b', 'No se pudo comprobar si tiene devoluciones.')), h('p', 'Revise la conexión. Mientras tanto no dé por hecho que no tiene devoluciones ni correcciones; si no corresponde, el sistema no deja anular.'),
            h('div.doc-botones', h('button.btn', { type: 'button', 'data-reintentar': '1', onclick: (e) => ejecutar(e.currentTarget, () => ctx.repintar()) }, 'Intentar de nuevo'))) : null,
          sinComprobar ? h('div.doc-espera-caja', { role: 'note' }, h('p', h('b', 'No se puede anular ni corregir todavía.')), h('p', 'Primero hay que comprobar si este documento ya está anulado y no se pudo. Revise la conexión y toque «Intentar de nuevo».'),
            h('div.doc-botones', h('button.btn', { type: 'button', 'data-reintentar': '1', onclick: (e) => ejecutar(e.currentTarget, () => ctx.repintar()) }, 'Intentar de nuevo'))) : null,
          bloq ? h('div.doc-espera-caja', { role: 'note' }, h('p', h('b', 'Este documento no se puede anular completo.')), h('p', permiso.motivo)) : null,
          noNotas ? h('div.doc-espera-caja', { role: 'note' }, h('p', h('b', 'No se puede devolver ni corregir una parte de este documento.')), h('p', motivoNotas)) : null,
          h('div.doc-botones',
            accion({ texto: 'Devolver parte', hint: noNotas || sinComprobar ? 'No se puede: lea el aviso de arriba' : 'El cliente devuelve algunos productos y se le devuelve esa parte.', disabled: noNotas || sinComprobar, onclick: abrirParcial(devolverParte) }),
            accion({ texto: 'Corregir un monto', hint: noNotas || sinComprobar ? 'No se puede: lea el aviso de arriba' : 'Se cobró de más o de menos en un producto.', disabled: noNotas || sinComprobar, onclick: abrirParcial(corregirMonto) }),
            accion({ texto: esTiquete ? 'El cliente pide factura' : 'Corregir el cliente de la factura', hint: bloq || sinComprobar ? 'No se puede: lea el aviso de arriba' : esTiquete ? 'Anula el tiquete y deja la factura lista para cobrar con el cliente que usted elija.' : 'Anula la factura y deja la venta lista para cobrar con el cliente correcto.', clase: 'primario', disabled: bloq || sinComprobar, onclick: async () => { cambiarCliente(app, doc, { alTerminar: repintar }); } }),
            accion({ texto: 'Anular con nota de crédito', hint: bloq || sinComprobar ? 'No se puede: lea el aviso de arriba' : null, clase: 'peligro', disabled: bloq || sinComprobar, onclick: async () => { abrirAnular(doc, { alTerminar: repintar, alVerNC: (n) => { ctx.cerrar(); abrirDetalle(n.id); } }); } }))].filter(Boolean));
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
      const g = h('div.doc-grupo.anular', h('h3', 'Dejar sin efecto esta anulación'));
      const ya = sinEfectoDeSaldos(ctx.saldos);
      if (ya) { g.append(h('p.tenue', `Esta anulación ya se dejó sin efecto con la nota de débito N.° ${numeroCorto(ya.consecutivo)}.`)); return g; }
      const doc = { ...c, cliente: c.cliente_snapshot?.nombre || '' };
      const sabe = !!ctx.saldos && typeof ctx.saldos.admite_sin_efecto === 'boolean';
      const apagado = c.estado !== 'aceptado' || (sabe && !ctx.saldos.admite_sin_efecto);
      const hint = c.estado !== 'aceptado' ? 'Primero debe estar aceptada por Hacienda' : apagado ? 'No se puede en este momento' : 'Úselo si la anulación fue un error: el documento vuelve a valer.';
      g.append(h('p.tenue', 'Si esta anulación se hizo por error, se puede dejar sin efecto con una nota de débito: la venta vuelve a valer como estaba. Antes de hacerlo se le muestra todo para que lo revise.'),
        h('div.doc-botones', accion({ texto: 'Dejar sin efecto la anulación', hint, disabled: apagado, onclick: async () => { dejarSinEfecto(app, doc, { alTerminar: async () => { await ctx.repintar(true); await refrescarTras(); }, alVerNota: (n) => { ctx.cerrar(); abrirDetalle(n.id); } }); } })));
      return g;
    }
    const esTiqueteTxt = (c) => (c.tipo_doc === '04' ? 'El cliente pide factura' : 'Corregir el cliente de la factura');

    /* ---------- rehacer la venta: «Hacer la venta de nuevo» ---------- */
    // Copia los productos a una cuenta nueva y recién entonces abre Facturación. Si la copia falla NO se abre Facturación ni se manda a armar la venta a mano: se muestra lo que dijo la base
    // y un botón «Intentar de nuevo» (la base no duplica: si la copia ya se había creado, devuelve esa misma). Si la base dice que la venta ya se corrigió con otra venta cobrada, se dice con palabras y no se ofrece rehacerla.
    function bloqueRehacer(c, ctx) {
      const caja = h('div.doc-rehacer');
      const hecha = rehechoPor(c);
      const ver = hecha ? h('button.btn', { type: 'button', onclick: () => { ctx.cerrar(); abrirDetalle(hecha.id); } }, 'Ver el documento nuevo') : null;
      const fallo = h('div.an-clon-fallo', { hidden: true, role: 'alert' });
      const botones = [];
      let enCopia = false;
      const intentar = async (clienteId) => {
        if (enCopia) return;
        enCopia = true; fallo.hidden = true;
        let r;
        try { r = await copiarVentaParaRehacer(c.venta_id, clienteId); } finally { enCopia = false; }
        if (r.ok) { ctx.cerrar(); abrirCuentaNueva(app, r.id, toast, r.sinCliente); return; }
        const reintento = r.motivo === 'ya_corregida' || r.sinReintento ? null : r.motivo === 'sin_funcion' ? h('button.btn', { type: 'button', onclick: () => { ctx.cerrar(); app.ir('caja'); } }, 'Ir a Facturación')
          : h('button.btn.primario', { type: 'button', 'data-reintentar-copia': '1', onclick: (e) => ejecutar(e.currentTarget, () => intentar(clienteId)) }, 'Intentar de nuevo');
        fallo.replaceChildren(...[h('p', r.motivo === 'ya_corregida' ? (/no hace falta/i.test(r.mensaje) ? null : h('b', 'No hace falta hacer la venta de nuevo. ')) : h('b', 'No se pudo copiar la venta. '), r.mensaje), reintento].filter(Boolean));
        fallo.hidden = false;
        if (r.motivo === 'ya_corregida') botones.forEach((b) => { b.dataset.apagado = '1'; b.disabled = true; });
        try { fallo.scrollIntoView({ block: 'nearest' }); } catch { /* nada */ }
      };
      const bUno = accion({ texto: 'Hacer la venta de nuevo en Facturación', hint: hecha ? 'Ya se hizo de nuevo' : 'Copia los productos a una cuenta nueva y abre Facturación.', disabled: !!hecha, onclick: () => intentar(null) });
      const bOtro = accion({ texto: 'Hacer la venta de nuevo con otro cliente', hint: hecha ? 'Ya se hizo de nuevo' : 'Primero elija al cliente; después se abre Facturación.', disabled: !!hecha,
        onclick: async () => { selectorCliente(app, { titulo: 'Elegir el cliente de la venta nueva', alElegir: async (cl) => { await intentar(cl?.id); } }); } });
      botones.push(bUno, bOtro);
      if (hecha) caja.append(h('div.doc-aviso.ref', h('div', h('b', `Esta venta ya se volvió a hacer con ${conArticulo(hecha.tipo_doc)} N.° ${numeroCorto(hecha.consecutivo)}. `), 'No hace falta hacerla otra vez. Si ese documento también tiene un error, anúlelo primero.'), ver));
      caja.append(h('div.doc-botones', bUno, bOtro), fallo);
      return caja;
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
          await ctx.repintar(true); await refrescarTras();
        } });
        caja.append(h('label.etq', 'Nota (opcional)', h('small', 'Sirve para que otra persona sepa qué se hizo.'), nota), ya);
      }
      if (esVenta(c) && c.venta_id) caja.append(bloqueRehacer(c, ctx));
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
      if (Date.now() - ultimaCarga >= espera) cargar('auto');
      detalleActual?.repintar(true);
    }, 20000);
    // Si el aparato cambia de ancho (girar el celular), el tamaño de la página cambia: se vuelve a la primera
    let mq = null; try { mq = window.matchMedia('(max-width:700px)'); } catch { /* sin matchMedia */ }
    const alCambiarAncho = () => { est.pagina = 1; if (est.lista.length && root.isConnected) pintar(); };
    mq?.addEventListener?.('change', alCambiarAncho);
    return () => { clearInterval(reloj); mq?.removeEventListener?.('change', alCambiarAncho); };
  },
};
