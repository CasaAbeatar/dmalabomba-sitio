// Informes (antes Listados): reportes de ventas facturadas. Datos: fx_listados2 (ventas netas de notas de crédito), ver sql/05_listados2.sql.
import { h, money, num, fechaHora, horaCorta, fechaCorta, sumaDias, toast, nombrePropio, nombreLocal, TIPOS_SERVICIO, MEDIOS } from './util.js';
import { listados2 } from './api_listados.js';
import { mensajeAmable } from './api_documentos.js';
import { selectorPeriodo, textoRango, fechaLarga } from './periodo.js';
import { crearDescarga, nombrePeriodo } from './descargas.js';
import { graficoColumnas, graficoBarras, autoAjustar } from './graficos.js';

const cssUrl = new URL('../css/listados.css', import.meta.url).href;
const norm = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const pct = (a, b) => (b ? new Intl.NumberFormat('es-CR', { maximumFractionDigits: 1 }).format((a / b) * 100) + ' %' : '');
const dia = (ymd, o) => new Intl.DateTimeFormat('es-CR', { timeZone: 'UTC', ...o }).format(new Date(ymd + 'T12:00:00Z'));
const nombreServicio = (t) => TIPOS_SERVICIO[t] || (t === 'sin dato' ? 'Sin dato' : t);
const nombreMedio = (m) => MEDIOS[m] || m;
const todosLosDias = (d, a) => { const r = []; for (let x = d; x <= a && r.length < 800; x = sumaDias(x, 1)) r.push(x); return r; };

export default {
  id: 'listados', titulo: 'Informes',
  async mount(root, app) {
    if (!document.getElementById('css-listados')) document.head.append(h('link', { id: 'css-listados', rel: 'stylesheet', href: cssUrl }));
    const limpiezas = [];
    const nomSoc = nombreLocal(app.soc);
    let ficha = 0; // descarta respuestas viejas
    const est = { desde: null, hasta: null, turno: '', datos: null, demo: false, vista: 'arbol', orden: 'monto', ordenLista: { col: 'total', dir: -1 }, filtro: '', abiertos: new Set(), verTodos: false };

    const periodo = selectorPeriodo({ inicial: 'hoy', alCambiar: ([d, a]) => { est.turno = ''; cargar(d, a); } });
    const turnoSel = h('select.campo', { 'aria-label': 'Turno', onchange: () => { est.turno = turnoSel.value; cargar(est.desde, est.hasta, true); } });
    const turnoCaja = h('label.etq.lis-turno', 'Ver solo un turno de caja (opcional)', turnoSel);
    const rotulo = h('p.lis-rotulo');
    const resumenEl = h('div');
    const cuerpo = h('div');
    // Franja que acompaña a toda la pantalla mientras se ve la muestra, para que nadie la confunda con ventas reales
    const demoBanner = h('div.demo-banner', { hidden: true, role: 'status' }, h('strong', 'DATOS DE EJEMPLO, NO SON SUYOS'), h('span', 'Son ventas inventadas, solo para ver cómo se verán los gráficos.'),
      h('button.btn', { type: 'button', onclick: () => { est.demo = false; cargar(est.desde, est.hasta); } }, 'Volver a los datos reales'));

    root.append(
      h('div.lis-cab', h('div', h('p.tenue', 'Ventas ya facturadas de ', h('strong', nomSoc), '. Las cifras vienen de las facturas y tiquetes emitidos; las notas de crédito se restan.')),
        h('div.fila', crearDescarga(() => informeCompleto(), { texto: 'Descargar todo el informe', etiqueta: 'Descargar todo el informe de ventas, con una hoja por tabla' }),
          h('button.btn', { type: 'button', onclick: (e) => imprimir(e.currentTarget) }, 'Imprimir resumen'))),
      h('div.tarjeta.lis-filtros', periodo.el, turnoCaja),
      demoBanner, rotulo, resumenEl, cuerpo);

    async function cargar(desde, hasta, mismoTurno) {
      est.desde = desde; est.hasta = hasta;
      const mia = ++ficha;
      rotulo.textContent = 'Mostrando ' + textoRango(desde, hasta) + (est.turno ? ' · un solo turno' : ' · todos los turnos') + '. Colones (₡), IVA incluido salvo donde se indique.';
      limpiezas.splice(0).forEach((f) => f());
      resumenEl.replaceChildren(); cuerpo.replaceChildren(h('p.cargando', 'Cargando ventas…'));
      try {
        let datos;
        if (est.demo) { const { datosDemo } = await import('./listados_demo.js'); datos = datosDemo(desde, hasta); }
        else datos = await listados2(app.soc.id, desde, hasta, est.turno || null);
        if (mia !== ficha) return;
        est.datos = datos;
        demoBanner.hidden = !est.demo;
        if (!mismoTurno) llenarTurnos(datos.por_turno || []);
        est.abiertos = new Set(); est.filtro = ''; est.verTodos = false; est._iniciado = false;
        pintar();
      } catch (e) {
        if (mia !== ficha) return;
        cuerpo.replaceChildren(h('div.vacio', h('p', 'No se pudieron traer las ventas.'), h('p.tenue', mensajeAmable(e, 'Revise la conexión e intente de nuevo.')), h('button.btn', { type: 'button', onclick: () => cargar(desde, hasta) }, 'Intentar de nuevo')));
      }
    }

    // «Turno del 28/10/2026 desde las 18:29 (sigue abierto)» o «Turno del 28/10/2026 de 18:29 a 22:05». Lo más reciente primero.
    function textoTurno(t) {
      const dia0 = fechaCorta(t.abierto_en);
      const cuando = !t.cerrado_en ? `desde las ${horaCorta(t.abierto_en)} (sigue abierto)`
        : fechaCorta(t.cerrado_en) === dia0 ? `de ${horaCorta(t.abierto_en)} a ${horaCorta(t.cerrado_en)}`
          : `desde las ${horaCorta(t.abierto_en)} hasta el ${fechaCorta(t.cerrado_en)} a las ${horaCorta(t.cerrado_en)}`;
      return `Turno del ${dia0} ${cuando}`;
    }
    const turnosRecientes = (turnos) => [...turnos].sort((a, b) => new Date(b.abierto_en) - new Date(a.abierto_en));
    function llenarTurnos(turnos) {
      turnoSel.replaceChildren(h('option', { value: '' }, 'Todos los turnos'));
      turnosRecientes(turnos).forEach((t) => turnoSel.append(h('option', { value: t.id }, `${textoTurno(t)}${t.abierto_por ? ', abrió ' + nombrePropio(t.abierto_por) : ''} (${t.ventas} ${t.ventas === 1 ? 'venta' : 'ventas'})`)));
      turnoSel.value = est.turno || '';
      turnoCaja.hidden = turnos.length === 0;
    }

    /* ---------- piezas de pantalla ---------- */
    // descarga: función que arma, al bajar, lo que hay en pantalla (ver descargas.js); null si la sección no se descarga
    const seccion = (titulo, ayuda, descarga, ...hijos) => h('section.tarjeta.lis-sec',
      h('div.lis-sec-cab', h('div', h('h2', titulo), ayuda ? h('p.tenue.lis-ayuda', ayuda) : null),
        descarga ? crearDescarga(descarga, { etiqueta: 'Descargar: ' + titulo }) : null), ...hijos);

    /* ---------- lo que se descarga ---------- */
    // Encabezado común de todas las descargas: empresa, rango en palabras, turno escogido y, si se ven datos de muestra, que no son ventas reales
    const baseDescarga = (que) => ({
      nombre: (est.demo ? 'Ejemplo ' : '') + que + ' ' + nombrePeriodo(est.desde, est.hasta) + (est.turno ? ' un turno' : ''),
      empresa: nomSoc, cedula: app.soc?.cedula || '',
      subtitulo: textoRango(est.desde, est.hasta) + (est.turno ? ' · ' + (turnoSel.selectedOptions[0]?.textContent || 'un solo turno de caja') : ' · todos los turnos') + (est.demo ? ' · DATOS DE EJEMPLO, NO SON VENTAS REALES' : ''),
    });
    const conBase = (que, tabla) => ({ ...baseDescarga(que), ...tabla });
    const redondea = (n, d = 2) => { const k = 10 ** d; return Math.round((+n || 0) * k) / k; };
    const NOTA_NETAS = 'Montos con IVA incluido, sin las ventas anuladas con nota de crédito';
    const kpi = (titulo, valor, nota, extra) => h('div.tarjeta.kpi' + (extra ? '.' + extra : ''), h('div.kpi-t', titulo), h('div.kpi-v.cifra', valor), h('div.kpi-n', nota));

    function tablaSimple(cols, filas, pie) {
      return h('div.tabla-caja', h('table.tabla', h('thead', h('tr', cols.map((c) => h('th' + (c.der ? '.der' : ''), c.t)))),
        h('tbody', filas.map((f) => h('tr', f.map((v, i) => h('td' + (cols[i].der ? '.der' : ''), v))))), pie ? h('tfoot', pie) : null));
    }

    // gráfico con su lectura al tocar
    function conGrafico(tipo, datos, opc, vacioTxt) {
      if (!datos.length) return h('p.tenue', vacioTxt || 'Sin datos en este periodo.');
      const lect = h('p.lectura', { 'aria-live': 'polite' }, 'Toque o pase el cursor sobre una barra para ver el detalle.');
      const cont = h('div.gr-caja');
      let sel = -1;
      limpiezas.push(autoAjustar(cont, (w) => {
        const f = tipo === 'col' ? graficoColumnas : graficoBarras;
        cont.replaceChildren(f(datos, { ...opc, ancho: w, seleccionado: sel, alSeleccionar: (d, i) => { sel = i; lect.textContent = d.texto; } }));
      }));
      return h('div', cont, lect);
    }

    /* ---------- pintar todo ---------- */
    function pintar() {
      const d = est.datos, r = d.resumen;
      resumenEl.replaceChildren(); cuerpo.replaceChildren();
      const rech = d.rechazados || { n: r.rechazados_n || 0, total: r.rechazados_total || 0, lista: [] };
      if (!r.docs_emitidos && !r.notas_credito_n) {
        const masAmplio = periodo.id() === 'hoy' ? ['mes', 'Ver este mes'] : null;
        cuerpo.append(h('div.vacio.lis-vacio', h('h2', 'Todavía no hay ventas facturadas en este periodo'),
          h('p', est.turno ? 'Ese turno no tiene ventas con factura o tiquete en las fechas escogidas.' : 'Cuando se cobre una venta, aparecerá aquí con sus gráficos.'),
          h('div.fila', { style: 'justify-content:center' },
            masAmplio ? h('button.btn.primario', { type: 'button', onclick: () => periodo.elegir(masAmplio[0]) }, masAmplio[1]) : null,
            h('button.btn', { type: 'button', onclick: () => periodo.elegir('ayer') }, 'Ver ayer'),
            h('button.btn', { type: 'button', onclick: () => { est.demo = true; cargar(est.desde, est.hasta); } }, 'Ver un ejemplo con datos de muestra'))));
        if (rech.n > 0) cuerpo.append(avisoRechazados(rech), seccionRechazados(rech));
        return;
      }
      const ticket = r.vigentes_n ? r.vigentes_total / r.vigentes_n : 0;
      const baseNeta = (Number(r.ventas_netas) || 0) - (Number(r.iva_neto) || 0);
      resumenEl.append(...[
        h('div.rejilla.kpis',
          kpi('Ventas brutas', money(r.ventas_brutas), 'Total cobrado con IVA incluido, antes de restar notas de crédito.'),
          kpi('Notas de crédito (se restan)', (r.notas_credito > 0 ? '−' : '') + money(r.notas_credito), `${r.notas_credito_n} ${r.notas_credito_n === 1 ? 'nota' : 'notas'} de crédito con IVA incluido. Son ventas anuladas o corregidas.`),
          kpi('Ventas netas', money(r.ventas_netas), 'Ventas brutas menos notas de crédito. Incluyen el IVA.', 'resalta'),
          kpi('IVA dentro de las ventas netas', money(r.iva_neto), `Sin IVA, las ventas netas serían ${money(baseNeta)}.`),
          kpi('Documentos emitidos', num(r.docs_emitidos, 0), 'Facturas y tiquetes electrónicos. Las notas de crédito no se cuentan aquí.'),
          kpi('Promedio por venta', money(ticket), 'Ventas netas entre el número de ventas vigentes. Con IVA incluido.')),
        rech.n > 0 ? avisoRechazados(rech) : null,
        r.sin_aceptar_n > 0 ? h('p.lis-aviso', `${r.sin_aceptar_n} ${r.sin_aceptar_n === 1 ? 'documento todavía no está aceptado' : 'documentos todavía no están aceptados'} por Hacienda (por enviar o con problemas para enviar). Cuentan en las cifras igual que los aceptados.`) : null,
        Math.abs((r.vigentes_total || 0) - (r.ventas_netas || 0)) > 0.005 ? h('p.lis-aviso', `Los desgloses de abajo suman ${money(r.vigentes_total)} y las ventas netas ${money(r.ventas_netas)}: la diferencia viene de notas de crédito de este periodo que anulan ventas de otro periodo.`) : null,
      ].filter(Boolean));

      cuerpo.append(seccionDias(d), seccionHoras(d), seccionMedios(d), seccionServicio(d), seccionTarifas(d), seccionProductos(d));
      const extra = [seccionTurnos(d), seccionCajeros(d), rech.n > 0 ? seccionRechazados(rech) : null].filter(Boolean);
      if (extra.length) cuerpo.append(...extra);
      if (!est.demo) cuerpo.append(h('p.lis-pie', h('button.btn.suave.chico', { type: 'button', onclick: () => { est.demo = true; cargar(est.desde, est.hasta); } }, 'Ver un ejemplo con datos de muestra')));
    }

    // Todo el informe en un libro de Excel: una hoja por tabla, en el mismo orden de la pantalla (el PDF lleva todas las tablas y el CSV un .zip con un archivo por tabla)
    function tablaResumen(d) {
      const r = d.resumen, rech = d.rechazados || { n: r.rechazados_n || 0, total: r.rechazados_total || 0 };
      const ticket = r.vigentes_n ? r.vigentes_total / r.vigentes_n : 0;
      const baseNeta = (Number(r.ventas_netas) || 0) - (Number(r.iva_neto) || 0);
      const fila = (concepto, monto, cantidad) => ({ concepto, monto, cantidad });
      return {
        titulo: 'Resumen de ventas', cifras: 'mixtas', cifrasNota: 'Montos con IVA incluido salvo donde se indique',
        columnas: [{ clave: 'concepto', titulo: 'Concepto', tipo: 'texto' }, { clave: 'monto', titulo: 'Monto (₡)', tipo: 'moneda' }, { clave: 'cantidad', titulo: 'Cantidad de documentos', tipo: 'numero', dec: 0 }],
        filas: [
          fila('Ventas brutas (con IVA, antes de restar notas de crédito)', +r.ventas_brutas, null),
          fila('Notas de crédito (se restan, con IVA)', +r.notas_credito, +r.notas_credito_n),
          fila('Ventas netas (con IVA)', +r.ventas_netas, null),
          fila('IVA dentro de las ventas netas', +r.iva_neto, null),
          fila('Ventas netas sin IVA', redondea(baseNeta), null),
          fila('Documentos emitidos (facturas y tiquetes)', null, +r.docs_emitidos),
          fila('Promedio por venta (con IVA)', redondea(ticket), null),
          ...((+rech.n || 0) > 0 ? [fila('Rechazados por Hacienda (aparte, no suman en las ventas)', +rech.total, +rech.n)] : []),
          ...((+r.sin_aceptar_n || 0) > 0 ? [fila('Documentos todavía sin aceptar por Hacienda (cuentan en las cifras)', null, +r.sin_aceptar_n)] : [])],
      };
    }
    function informeCompleto() {
      const d = est.datos; if (!d) return { hojas: [] };
      const r = d.resumen, rech = d.rechazados || { n: r.rechazados_n || 0, total: r.rechazados_total || 0, lista: [] };
      if (!r.docs_emitidos && !r.notas_credito_n && !(+rech.n > 0)) return { hojas: [] };
      const hojas = [tablaResumen(d), seriesDias(d).length > 1 ? tablaDias(d) : null, tablaHoras(d), tablaMedios(d), tablaServicio(d), tablaTarifas(d), tablaProductos(d), tablaAbiertos(d), tablaTurnos(d), tablaCajeros(d), +rech.n > 0 ? tablaRechazados(rech) : null]
        .filter((t) => t && (t.filas || []).length);
      return { ...baseDescarga('Informe de ventas'), titulo: 'Informe de ventas', hojas };
    }

    /* ---------- ventas por día ---------- */
    function seriesDias(d) {
      const mapa = new Map((d.por_dia || []).map((x) => [x.dia, x]));
      const dias = todosLosDias(est.desde, est.hasta);
      if (dias.length > 92) { // periodos largos: se agrupa por mes
        const m = new Map();
        dias.forEach((y) => { const k = y.slice(0, 7); const x = mapa.get(y); const a = m.get(k) || { dia: k + '-01', docs: 0, ventas: 0, notas_credito: 0, netas: 0, iva: 0, mes: true }; if (x) { a.docs += +x.docs; a.ventas += +x.ventas; a.notas_credito += +x.notas_credito; a.netas += +x.netas; a.iva += +x.iva; } m.set(k, a); });
        return [...m.values()];
      }
      return dias.map((y) => mapa.get(y) || { dia: y, docs: 0, ventas: 0, notas_credito: 0, netas: 0, iva: 0 });
    }
    function tablaDias(d) {
      const serie = seriesDias(d), mes = !!(serie[0] && serie[0].mes);
      const suma = (k) => serie.reduce((a, x) => a + (+x[k] || 0), 0), r = d.resumen || {};
      const avisos = [];
      if (Math.abs(suma('netas') - (+r.ventas_netas || 0)) > 0.005) avisos.push(`La suma de las ventas netas de esta tabla (${money(suma('netas'))}) no es igual a las ventas netas del resumen (${money(r.ventas_netas)}): la diferencia viene de notas de crédito de este periodo que anulan ventas de otro periodo.`);
      if (Math.abs(suma('iva') - (+r.iva_neto || 0)) > 0.005) avisos.push(`La suma del IVA de esta tabla (${money(suma('iva'))}) no es igual al IVA del resumen (${money(r.iva_neto)}).`);
      return {
        titulo: mes ? 'Ventas por mes' : 'Ventas por día', cifras: 'netas',
        cifrasNota: 'Montos con IVA incluido. La columna de ventas netas ya tiene restadas las notas de crédito; la de ventas brutas es antes de restarlas',
        columnas: [
          { clave: 'dia', titulo: mes ? 'Mes' : 'Fecha', tipo: 'fecha', formato: mes ? 'mes' : undefined },
          ...(mes ? [] : [{ clave: 'sem', titulo: 'Día de la semana', tipo: 'texto' }]),
          { clave: 'docs', titulo: 'Documentos emitidos (número)', tipo: 'numero', dec: 0 },
          { clave: 'ventas', titulo: 'Ventas brutas (₡, con IVA)', tipo: 'moneda' },
          { clave: 'nc', titulo: 'Notas de crédito que se restan (₡, con IVA)', tipo: 'moneda' },
          { clave: 'netas', titulo: 'Ventas netas (₡, con IVA)', tipo: 'moneda' },
          { clave: 'iva', titulo: 'IVA dentro de las ventas netas (₡)', tipo: 'moneda' }],
        filas: serie.map((x) => ({ dia: x.dia, sem: mes ? '' : dia(x.dia, { weekday: 'long' }), docs: +x.docs, ventas: +x.ventas, nc: +x.notas_credito, netas: +x.netas, iva: +x.iva })),
        totales: { docs: 'suma', ventas: 'suma', nc: 'suma', netas: 'suma', iva: 'suma' },
        notas: [`Ordenado ${mes ? 'del mes más antiguo al más reciente' : 'del día más antiguo al más reciente'}. Lo que no tuvo ventas aparece en cero.`, ...avisos],
      };
    }
    function seccionDias(d) {
      const serie = seriesDias(d);
      if (serie.length <= 1) return seccion('Ventas por día', 'El periodo es de un solo día. Más abajo está el detalle por hora.', null, h('p.tenue', 'Escoja «Esta semana» o «Este mes» para ver cada día en una columna.'));
      const datos = serie.map((x) => ({ id: x.dia, etiqueta: x.mes ? dia(x.dia, { month: 'short', year: '2-digit' }) : (serie.length <= 8 ? dia(x.dia, { weekday: 'short' }).replace('.', '') + ' ' + dia(x.dia, { day: 'numeric' }) : dia(x.dia, { day: '2-digit', month: '2-digit' })), valor: +x.netas,
        texto: `${x.mes ? dia(x.dia, { month: 'long', year: 'numeric' }) : fechaLarga(x.dia)}: ventas netas ${money(x.netas)} (brutas ${money(x.ventas)}, notas de crédito ${money(x.notas_credito)}), IVA ${money(x.iva)}, ${x.docs} ${x.docs === 1 ? 'documento' : 'documentos'}.` }));
      const mes = serie[0].mes;
      return seccion(mes ? 'Ventas por mes' : 'Ventas por día', `Cada columna es ${mes ? 'un mes' : 'un día'}, de izquierda (más antiguo) a derecha (más reciente). Ventas netas: ya restadas las notas de crédito, con IVA incluido.`, () => conBase(mes ? 'Ventas por mes' : 'Ventas por día', tablaDias(d)),
        conGrafico('col', datos, { tituloX: mes ? 'Mes' : 'Día (de izquierda a derecha, en orden de fecha)', tituloY: 'Ventas netas (₡, IVA incluido)', color: 'rojo', anchoEtiqueta: mes ? 56 : 44, descripcion: 'Gráfico de columnas de ventas netas por ' + (mes ? 'mes' : 'día') }));
    }

    /* ---------- ventas por hora ---------- */
    function tablaHoras(d) {
      const porH = new Map((d.por_hora || []).map((x) => [+x.hora, x]));
      if (!porH.size) return null;
      const hs = [...porH.keys()]; const desdeH = Math.min(...hs, 7), hastaH = Math.max(...hs, 18);
      const filas = []; for (let k = desdeH; k <= hastaH; k++) { const x = porH.get(k) || { docs: 0, total: 0 }; filas.push({ hora: String(k).padStart(2, '0') + ':00', docs: +x.docs, total: +x.total }); }
      return {
        titulo: 'Ventas por hora', cifras: 'netas', cifrasNota: NOTA_NETAS,
        columnas: [{ clave: 'hora', titulo: 'Hora de inicio (la hora completa, de 24 horas)', tipo: 'texto' }, { clave: 'docs', titulo: 'Ventas (número)', tipo: 'numero', dec: 0 }, { clave: 'total', titulo: 'Monto con IVA (₡)', tipo: 'moneda' }],
        filas, totales: { docs: 'suma', total: 'suma' },
        notas: ['Suma de todos los días del periodo. Ordenado de la hora más temprana a la más tarde.'],
      };
    }
    function seccionHoras(d) {
      const porH = new Map((d.por_hora || []).map((x) => [+x.hora, x]));
      if (!porH.size) return null;
      const hs = [...porH.keys()]; const desdeH = Math.min(...hs, 7), hastaH = Math.max(...hs, 18);
      const serie = []; for (let k = desdeH; k <= hastaH; k++) serie.push({ hora: k, ...(porH.get(k) || { docs: 0, total: 0 }) });
      const etq = (k) => `${k}:00`;
      const rangoH = (k) => `${String(k).padStart(2, '0')}:00 a ${String(k).padStart(2, '0')}:59`;
      const datos = serie.map((x) => ({ id: x.hora, etiqueta: etq(x.hora), valor: +x.total, texto: `De ${rangoH(x.hora)}: ${money(x.total)} en ${x.docs} ${x.docs === 1 ? 'venta' : 'ventas'}.` }));
      const mejor = serie.reduce((a, b) => (+b.total > +a.total ? b : a), serie[0]);
      return seccion('Ventas por hora', `Suma de todos los días del periodo. Cada columna es una hora completa: la de 7:00 son las ventas entre 7:00 y 7:59. La hora con más ventas es ${etq(mejor.hora)} a ${String(mejor.hora).padStart(2, '0')}:59 (${money(mejor.total)}). No incluye ventas anuladas con nota de crédito.`, () => conBase('Ventas por hora', tablaHoras(d)),
        conGrafico('col', datos, { tituloX: 'Hora del día (24 horas)', tituloY: 'Ventas netas, sin las anuladas (₡, IVA incluido)', color: 'ambar', anchoEtiqueta: 36, descripcion: 'Gráfico de columnas de ventas por hora del día' }));
    }

    /* ---------- medio de pago y tipo de servicio ---------- */
    function tablaMedios(d) {
      const filas = d.por_medio || []; const tot = filas.reduce((a, x) => a + +x.total, 0);
      return {
        titulo: 'Ventas por medio de pago', cifras: 'netas', cifrasNota: NOTA_NETAS,
        columnas: [{ clave: 'medio', titulo: 'Medio de pago', tipo: 'texto' }, { clave: 'docs', titulo: 'Ventas (número)', tipo: 'numero', dec: 0 }, { clave: 'total', titulo: 'Monto con IVA (₡)', tipo: 'moneda' }, { clave: 'pct', titulo: '% del monto cobrado', tipo: 'porcentaje', dec: 2 }],
        filas: filas.map((x) => ({ medio: nombreMedio(x.medio), docs: +x.docs, total: +x.total, pct: tot ? redondea((+x.total / tot) * 100) : 0 })),
        totales: { total: 'suma' },
        notas: ['Una venta pagada con dos medios aparece en los dos, por eso las ventas (número) no se suman.'],
      };
    }
    function seccionMedios(d) {
      const filas = d.por_medio || []; const tot = filas.reduce((a, x) => a + +x.total, 0);
      const datos = filas.map((x) => ({ etiqueta: nombreMedio(x.medio), valor: +x.total, extra: pct(+x.total, tot), texto: `${nombreMedio(x.medio)}: ${money(x.total)} (${pct(+x.total, tot)} de lo cobrado) en ${x.docs} ${x.docs === 1 ? 'venta' : 'ventas'}.` }));
      return seccion('Por medio de pago', 'Cómo pagaron los clientes (una venta pagada con dos medios aparece en ambos). No incluye ventas anuladas.', () => conBase('Ventas por medio de pago', tablaMedios(d)),
        conGrafico('bar', datos, { tituloX: 'Monto cobrado, sin las anuladas (₡, IVA incluido)', tituloY: 'Medio de pago', descripcion: 'Barras de ventas por medio de pago' }));
    }
    function tablaServicio(d) {
      const filas = d.por_servicio || []; const tot = filas.reduce((a, x) => a + +x.total, 0);
      return {
        titulo: 'Ventas por tipo de servicio', cifras: 'netas', cifrasNota: NOTA_NETAS,
        columnas: [{ clave: 'tipo', titulo: 'Tipo de servicio', tipo: 'texto' }, { clave: 'ventas', titulo: 'Ventas (número)', tipo: 'numero', dec: 0 }, { clave: 'total', titulo: 'Monto con IVA (₡)', tipo: 'moneda' }, { clave: 'pct', titulo: '% del monto vendido', tipo: 'porcentaje', dec: 2 }, { clave: 'prom', titulo: 'Promedio por venta (₡, con IVA)', tipo: 'moneda' }],
        filas: filas.map((x) => ({ tipo: nombreServicio(x.tipo_servicio), ventas: +x.ventas, total: +x.total, pct: tot ? redondea((+x.total / tot) * 100) : 0, prom: redondea(+x.total / (+x.ventas || 1)) })),
        totales: { ventas: 'suma', total: 'suma' },
      };
    }
    function seccionServicio(d) {
      const filas = d.por_servicio || []; const tot = filas.reduce((a, x) => a + +x.total, 0);
      const datos = filas.map((x) => ({ etiqueta: nombreServicio(x.tipo_servicio), valor: +x.total, extra: pct(+x.total, tot), texto: `${nombreServicio(x.tipo_servicio)}: ${money(x.total)} (${pct(+x.total, tot)}) en ${x.ventas} ${x.ventas === 1 ? 'venta' : 'ventas'}; promedio por venta ${money(+x.total / (+x.ventas || 1))}.` }));
      return seccion('Por tipo de servicio', 'Buffet, para llevar, express o en espera. No incluye ventas anuladas.', () => conBase('Ventas por tipo de servicio', tablaServicio(d)),
        conGrafico('bar', datos, { tituloX: 'Monto vendido, sin las anuladas (₡, IVA incluido)', tituloY: 'Tipo de servicio', descripcion: 'Barras de ventas por tipo de servicio' }));
    }

    /* ---------- turnos, cajeros, IVA ---------- */
    function tablaTurnos(d) {
      const filas = [...(d.por_turno || [])].sort((x, y) => new Date(x.abierto_en) - new Date(y.abierto_en)); // en el archivo van del más antiguo al más reciente
      if (!filas.length) return null;
      return {
        titulo: 'Ventas por turno de caja', cifras: 'netas', cifrasNota: NOTA_NETAS,
        columnas: [{ clave: 'abrio', titulo: 'Abrió (fecha y hora)', tipo: 'fechahora' }, { clave: 'cerro', titulo: 'Cerró (fecha y hora)', tipo: 'fechahora' }, { clave: 'por', titulo: 'Abierto por', tipo: 'texto' }, { clave: 'ventas', titulo: 'Ventas (número)', tipo: 'numero', dec: 0 }, { clave: 'total', titulo: 'Monto con IVA (₡)', tipo: 'moneda' }],
        filas: filas.map((t) => ({ abrio: t.abierto_en, cerro: t.cerrado_en || 'Sigue abierto', por: t.abierto_por ? nombrePropio(t.abierto_por) : '', ventas: +t.ventas, total: +t.total })),
        totales: { ventas: 'suma', total: 'suma' },
        notas: ['Ordenado del turno más antiguo al más reciente.'],
      };
    }
    function seccionTurnos(d) {
      const filas = turnosRecientes(d.por_turno || []); if (!filas.length) return null;
      return seccion('Por turno de caja', 'Cada turno abre y cierra la caja. El más reciente va primero. Monto de las ventas vigentes (sin anuladas), con IVA.', () => conBase('Ventas por turno de caja', tablaTurnos(d)),
        tablaSimple([{ t: 'Turno' }, { t: 'Abrió' }, { t: 'Cerró' }, { t: 'Ventas', der: 1 }, { t: 'Monto con IVA', der: 1 }],
          filas.map((t) => [t.abierto_por ? 'Abrió ' + nombrePropio(t.abierto_por) : 'Turno', fechaHora(t.abierto_en), t.cerrado_en ? fechaHora(t.cerrado_en) : 'Sigue abierto', num(t.ventas, 0), money(t.total)])));
    }
    function tablaCajeros(d) {
      const filas = d.por_cajero || []; if (!filas.length || (filas.length === 1 && filas[0].cajero === 'Sin registrar')) return null;
      return {
        titulo: 'Ventas por cajero', cifras: 'netas', cifrasNota: NOTA_NETAS,
        columnas: [{ clave: 'cajero', titulo: 'Cajero (quien abrió la cuenta)', tipo: 'texto' }, { clave: 'ventas', titulo: 'Ventas (número)', tipo: 'numero', dec: 0 }, { clave: 'total', titulo: 'Monto con IVA (₡)', tipo: 'moneda' }],
        filas: filas.map((t) => ({ cajero: nombrePropio(t.cajero), ventas: +t.ventas, total: +t.total })),
        totales: { ventas: 'suma', total: 'suma' },
      };
    }
    function seccionCajeros(d) {
      const filas = d.por_cajero || []; if (!filas.length || (filas.length === 1 && filas[0].cajero === 'Sin registrar')) return null;
      return seccion('Por cajero', 'Quien abrió la cuenta de cada venta. Monto con IVA, sin ventas anuladas.', () => conBase('Ventas por cajero', tablaCajeros(d)),
        tablaSimple([{ t: 'Cajero' }, { t: 'Ventas', der: 1 }, { t: 'Monto con IVA', der: 1 }], filas.map((t) => [nombrePropio(t.cajero), num(t.ventas, 0), money(t.total)])));
    }
    // Una fila por tarifa de IVA (13 %, 2 %, 0 %...). Las notas de crédito restan, así que el total cuadra con las ventas netas de arriba.
    const nombreTarifa = (t) => {
      const pc = Number(t.tarifa);
      const corto = Number.isFinite(pc) ? new Intl.NumberFormat('es-CR', { maximumFractionDigits: 2 }).format(pc) + ' %' : '';
      const nom = String(t.nombre || '').trim();
      return nom && corto && !nom.includes(corto) ? `${nom} (${corto})` : (nom || corto || 'Sin tarifa');
    };
    // Acepta también la forma anterior de la función (total_con_iva, sin base)
    const tarifasNormales = (d) => (d.por_tarifa || []).map((t) => { const total = +(t.total ?? t.total_con_iva ?? 0), iva = +(t.iva ?? 0); return { ...t, total, iva, base: t.base != null ? +t.base : Math.round((total - iva) * 100) / 100, documentos: t.documentos }; });
    function tablaTarifas(d) {
      const f = tarifasNormales(d); if (!f.length) return null;
      return {
        titulo: 'Ventas por tarifa de IVA', cifras: 'netas',
        cifrasNota: 'Es lo que se declara: ventas netas con las notas de crédito ya restadas. Cada tarifa va aparte',
        columnas: [{ clave: 'nom', titulo: 'Tarifa de IVA', tipo: 'texto' }, { clave: 'pc', titulo: 'Porcentaje de IVA', tipo: 'porcentaje', dec: 2 }, { clave: 'base', titulo: 'Ventas sin IVA (₡)', tipo: 'moneda' }, { clave: 'iva', titulo: 'IVA (₡)', tipo: 'moneda' }, { clave: 'total', titulo: 'Total con IVA (₡)', tipo: 'moneda' }],
        filas: f.map((t) => ({ nom: nombreTarifa(t), pc: Number.isFinite(+t.tarifa) ? +t.tarifa : null, base: t.base, iva: t.iva, total: t.total })),
        totales: { base: 'suma', iva: 'suma', total: 'suma' }, etiquetaTotal: 'Total de todas las tarifas',
      };
    }
    function seccionTarifas(d) {
      const filas = d.por_tarifa || []; if (!filas.length) return null;
      const f = tarifasNormales(d);
      const sum = (k) => f.reduce((a, x) => a + x[k], 0);
      return seccion('Ventas por tarifa de IVA', 'Cada tarifa va aparte (por ejemplo 13 %, 2 % y 0 %). Es lo que se declara de las ventas netas: ya restadas las notas de crédito.', () => conBase('Ventas por tarifa de IVA', tablaTarifas(d)),
        tablaSimple([{ t: 'Tarifa' }, { t: 'Ventas sin IVA', der: 1 }, { t: 'IVA', der: 1 }, { t: 'Total con IVA', der: 1 }],
          f.map((t) => [nombreTarifa(t), money(t.base), money(t.iva), money(t.total)]),
          h('tr', h('td', 'Total de todas las tarifas'), h('td.der', money(sum('base'))), h('td.der', money(sum('iva'))), h('td.der', money(sum('total'))))));
    }

    /* ---------- rechazados por Hacienda: van aparte y no suman en las ventas ---------- */
    function avisoRechazados(rech) {
      const n = +rech.n || 0;
      return h('div.lis-aviso.mal',
        h('div', h('b', `${n} ${n === 1 ? 'documento fue rechazado' : 'documentos fueron rechazados'} por Hacienda`), ` (${money(rech.total)}). No cuentan en las ventas de arriba. Si eran ventas reales, hay que hacerlas de nuevo en Facturación.`),
        h('button.btn', { type: 'button', onclick: () => app.ir('anular', { filtro: 'problemas', desde: est.desde }) }, 'Ver en Anular y reimprimir'));
    }
    const nombreDocRech = (t) => ({ '01': 'Factura', '03': 'Nota de crédito', '04': 'Tiquete' }[t] || 'Documento');
    function tablaRechazados(rech) {
      const lista = [...(rech.lista || [])].sort((x, y) => new Date(x.fecha) - new Date(y.fecha)); // en el archivo van del más antiguo al más reciente
      if (!lista.length) return null;
      return {
        hoja: 'Rechazados por Hacienda', titulo: 'Documentos rechazados por Hacienda', cifras: 'brutas', cifrasNota: 'Hacienda no los aceptó: no son ventas válidas y no suman en ninguna otra tabla',
        columnas: [{ clave: 'fecha', titulo: 'Fecha y hora', tipo: 'fechahora' }, { clave: 'tipo', titulo: 'Tipo de documento', tipo: 'texto' }, { clave: 'num', titulo: 'Número', tipo: 'texto' }, { clave: 'total', titulo: 'Total (₡, con IVA)', tipo: 'moneda' }, { clave: 'msg', titulo: 'Qué dice Hacienda', tipo: 'texto' }],
        filas: lista.map((x) => ({ fecha: x.fecha, tipo: nombreDocRech(x.tipo_doc), num: String(x.numero ?? ''), total: +x.total, msg: x.mensaje || 'Sin detalle' })),
        totales: { total: 'suma' },
        notas: ['Ordenado del más antiguo al más reciente.', +rech.n > lista.length ? `Se incluyen los ${lista.length} más recientes de ${rech.n}. Los demás están en Anular y reimprimir.` : ''],
      };
    }
    function seccionRechazados(rech) {
      const lista = rech.lista || [];
      return seccion('Rechazados por Hacienda (aparte)', 'Hacienda no los aceptó, así que no son ventas válidas y no suman en nada de lo anterior. Primero el más reciente.', lista.length ? () => conBase('Documentos rechazados por Hacienda', tablaRechazados(rech)) : null,
        lista.length
          ? tablaSimple([{ t: 'Fecha y hora' }, { t: 'Documento' }, { t: 'Total', der: 1 }, { t: 'Qué dice Hacienda' }],
            lista.map((x) => [fechaHora(x.fecha), `${{ '01': 'Factura', '03': 'Nota de crédito', '04': 'Tiquete' }[x.tipo_doc] || 'Documento'} N.° ${x.numero}`, money(x.total), x.mensaje || 'Sin detalle']))
          : h('p.tenue', 'No hay detalle para mostrar.'),
        +rech.n > lista.length ? h('p.tenue', `Se muestran los ${lista.length} más recientes de ${rech.n}. Los demás están en Anular y reimprimir.`) : null);
    }

    /* ---------- productos (código de 6 dígitos: cajón + producto + modificador) ---------- */
    function partes(nombre) { const i = nombre.indexOf(', '); return i > 0 ? { base: nombre.slice(0, i), variante: nombre.slice(i + 2) } : { base: nombre, variante: '' }; }
    function etiquetaProducto(hojas, p4) {
      const ps = hojas.map((x) => partes(x.nombre));
      if (hojas.length === 1) return ps[0].variante ? ps[0].base : hojas[0].nombre;
      if (ps.every((x) => x.variante && x.base === ps[0].base)) return ps[0].base;
      const tam = hojas.map((x) => (x.nombre.match(/(\d+(?:[.,]\d+)?\s?(?:mL|ml|L|oz|g|kg))\s*$/i) || [])[1]).filter(Boolean);
      const conteo = new Map(); tam.forEach((t) => conteo.set(t, (conteo.get(t) || 0) + 1));
      const [mejor, veces] = [...conteo.entries()].sort((a, b) => b[1] - a[1])[0] || [];
      if (mejor && veces >= Math.ceil(hojas.length * 0.6)) return 'Presentación ' + mejor;
      const ult = hojas.map((x) => x.nombre.split(' ').pop().toLowerCase()); const cu = new Map(); ult.forEach((t) => cu.set(t, (cu.get(t) || 0) + 1));
      const [pal, vp] = [...cu.entries()].sort((a, b) => b[1] - a[1])[0] || [];
      if (pal && pal.length >= 4 && vp >= Math.ceil(hojas.length * 0.6)) return 'Presentación ' + pal;
      return 'Producto ' + p4.slice(2) + ' (varias presentaciones)';
    }
    function arbol(filas, filtro) {
      const f = norm(filtro);
      const cajones = new Map();
      filas.filter((x) => !x.abierto && (!f || norm(x.nombre + ' ' + x.codigo + ' ' + (x.cajon_nombre || '')).includes(f))).forEach((x) => {
        // Las líneas libres (sin producto del catálogo) van cada una por su nombre, no mezcladas en un solo «producto»
        const c = x.codigo ? x.codigo.slice(0, 2) : '--', p = x.codigo ? x.codigo.slice(0, 4) : '----' + x.nombre;
        if (!cajones.has(c)) cajones.set(c, { id: 'c' + c, codigo: c, nombre: c === '--' ? 'Sin código del catálogo (líneas libres)' : (x.cajon_nombre || 'Cajón ' + c), productos: new Map(), cantidad: 0, total: 0 });
        const cj = cajones.get(c); cj.cantidad += +x.cantidad; cj.total += +x.total;
        if (!cj.productos.has(p)) cj.productos.set(p, { id: 'p' + p, codigo: x.codigo ? p : '', hojas: [], cantidad: 0, total: 0 });
        const pr = cj.productos.get(p); pr.hojas.push(x); pr.cantidad += +x.cantidad; pr.total += +x.total;
      });
      const cmp = (a, b) => est.orden === 'codigo' ? String(a.codigo).localeCompare(String(b.codigo)) : est.orden === 'cantidad' ? b.cantidad - a.cantidad : b.total - a.total;
      const lista = [...cajones.values()].map((cj) => {
        const productos = [...cj.productos.values()].map((pr) => ({ ...pr, nombre: etiquetaProducto(pr.hojas, pr.codigo), hojas: [...pr.hojas].map((x) => ({ ...x, cantidad: +x.cantidad, total: +x.total })).sort(cmp) })).sort(cmp);
        return { ...cj, productos };
      }).sort(cmp);
      return lista;
    }

    // La lista de productos tal como está en pantalla: con la búsqueda y el orden escogidos (la usan la pantalla y la descarga)
    function filasLista(fijos) {
      const f = norm(est.filtro), { col, dir } = est.ordenLista;
      const rows = fijos.filter((x) => !f || norm(x.nombre + ' ' + x.codigo).includes(f)).map((x) => ({ ...x, cantidad: +x.cantidad, total: +x.total }));
      rows.sort((a, b) => (col === 'nombre' || col === 'codigo' ? String(a[col]).localeCompare(String(b[col])) * dir : (a[col] - b[col]) * dir));
      return rows;
    }
    // Productos vendidos tal como se ven ahora (vista, orden y búsqueda de la pantalla), en filas planas
    function tablaProductos(d) {
      const todos = (d.productos || []).filter((x) => !x.abierto); if (!todos.length) return null;
      const totalFijos = todos.reduce((a, x) => a + +x.total, 0);
      const pc = (x) => (totalFijos ? redondea((+x.total / totalFijos) * 100) : 0);
      let filas;
      if (est.vista === 'arbol') { filas = []; arbol(todos, est.filtro).forEach((cj) => cj.productos.forEach((pr) => pr.hojas.forEach((x) => filas.push({ caj: cj.nombre, prod: pr.nombre, cod: x.codigo || '', nom: x.nombre, cant: +x.cantidad, total: +x.total, pct: pc(x) })))); }
      else filas = filasLista(todos).map((x) => ({ caj: x.cajon_nombre || '', prod: partes(x.nombre).base, cod: x.codigo || '', nom: x.nombre, cant: x.cantidad, total: x.total, pct: pc(x) }));
      const notas = ['El % del total es sobre todos los productos del periodo, aunque haya una búsqueda.'];
      if (est.filtro) notas.push('Solo las filas que coinciden con la búsqueda; el total de abajo es el de estas filas.');
      if (est.vista !== 'arbol' && !est.verTodos && filas.length > 15) notas.push(`Aquí van los ${filas.length} productos, aunque la pantalla muestre solo los primeros 15.`);
      return {
        titulo: 'Productos vendidos', cifras: 'netas', cifrasNota: NOTA_NETAS + (est.filtro ? '. Búsqueda: «' + est.filtro + '»' : ''),
        columnas: [{ clave: 'caj', titulo: 'Cajón', tipo: 'texto' }, { clave: 'prod', titulo: 'Producto', tipo: 'texto' }, { clave: 'cod', titulo: 'Código (6 dígitos)', tipo: 'texto' }, { clave: 'nom', titulo: 'Nombre completo', tipo: 'texto' }, { clave: 'cant', titulo: 'Cantidad', tipo: 'numero', dec: 3 }, { clave: 'total', titulo: 'Monto con IVA (₡)', tipo: 'moneda' }, { clave: 'pct', titulo: '% del total', tipo: 'porcentaje', dec: 2 }],
        filas, totales: { cant: 'suma', total: 'suma' }, notas,
      };
    }
    function tablaAbiertos(d) {
      const abiertos = (d.productos || []).filter((x) => x.abierto); if (!abiertos.length) return null;
      return {
        hoja: 'Precio abierto o por peso', titulo: 'Productos de precio abierto o por peso', cifras: 'netas', cifrasNota: NOTA_NETAS + '. La cantidad no se puede comparar con la de los demás productos',
        columnas: [{ clave: 'cod', titulo: 'Código', tipo: 'texto' }, { clave: 'nom', titulo: 'Producto', tipo: 'texto' }, { clave: 'uni', titulo: 'Unidad', tipo: 'texto' }, { clave: 'cant', titulo: 'Cantidad o peso', tipo: 'numero', dec: 3 }, { clave: 'total', titulo: 'Monto con IVA (₡)', tipo: 'moneda' }],
        filas: abiertos.map((x) => ({ cod: x.codigo || '', nom: x.nombre, uni: x.unidad || '', cant: +x.cantidad, total: +x.total })),
        totales: { total: 'suma' }, etiquetaTotal: 'Total de precio abierto',
      };
    }
    function seccionProductos(d) {
      const filas = d.productos || [];
      if (!filas.length) return seccion('Productos vendidos', null, null, h('p.tenue', 'No hay productos vendidos en este periodo.'));
      const fijos = filas.filter((x) => !x.abierto), abiertos = filas.filter((x) => x.abierto);
      const totalFijos = fijos.reduce((a, x) => a + +x.total, 0);
      const cuerpoProd = h('div'), busca = h('input.campo', { type: 'search', placeholder: 'Por ejemplo: coca, papas, 0101', 'aria-label': 'Buscar producto', oninput: () => { est.filtro = busca.value; pintarProd(); } });
      const bVista = (id, t) => h('button.btn.chico.seg', { type: 'button', 'data-v': id, 'aria-pressed': String(est.vista === id), onclick: () => { est.vista = id; pintarProd(); } }, t);
      const bOrden = (id, t) => h('button.btn.chico.seg', { type: 'button', 'data-o': id, 'aria-pressed': String(est.orden === id), onclick: () => { est.orden = id; pintarProd(); } }, t);
      const barra = h('div.fila.lis-prod-barra');
      function pintarProd() {
        barra.replaceChildren(h('div.fila', h('span.tenue', 'Vista:'), bVista('arbol', 'Por cajón y producto'), bVista('lista', 'Lista de más vendidos')),
          est.vista === 'arbol' ? h('div.fila', h('span.tenue', 'Ordenar por:'), bOrden('monto', 'Monto'), bOrden('cantidad', 'Cantidad'), bOrden('codigo', 'Código')) : null);
        cuerpoProd.replaceChildren(est.vista === 'arbol' ? vistaArbol() : vistaLista());
      }
      const dibujarFila = (cls, nivelTxt, nombre, cant, tot, base, abrible, id, abierto, codigo) => {
        const nombreCel = abrible
          ? h('button.arbol-btn', { type: 'button', 'aria-expanded': String(abierto), onclick: () => { abierto ? est.abiertos.delete(id) : est.abiertos.add(id); pintarProd(); } }, h('span.flecha', abierto ? '▾' : '▸'), h('span', nombre), h('span.ver', abierto ? 'Ocultar' : 'Ver detalle'))
          : h('span.hoja', nombre);
        return h('tr.' + cls.replace(' ', '.'), h('td.nom', nombreCel, codigo ? h('code.cod', codigo) : null), h('td.der', num(cant, 3)), h('td.der', money(tot)), h('td.der.pc', h('span.pc-barra', h('i', { style: `width:${Math.min(100, base ? (tot / base) * 100 : 0)}%` })), pct(tot, base)));
      };
      function vistaArbol() {
        const lista = arbol(fijos, est.filtro);
        if (!lista.length) return h('p.tenue', 'Ningún producto coincide con la búsqueda.');
        if (!est.abiertos.size && !est.filtro && !est._iniciado) { lista.forEach((c) => est.abiertos.add(c.id)); est._iniciado = true; }
        const trs = [];
        lista.forEach((cj) => {
          const abre = est.abiertos.has(cj.id) || !!est.filtro;
          trs.push(dibujarFila('n1', 'Cajón', `${cj.nombre}`, cj.cantidad, cj.total, totalFijos, !est.filtro, cj.id, abre, cj.codigo !== '--' ? cj.codigo : null));
          if (!abre) return;
          cj.productos.forEach((pr) => {
            const unico = pr.hojas.length === 1 && !partes(pr.hojas[0].nombre).variante;
            if (unico) { trs.push(dibujarFila('n2 solo', 'Producto', pr.hojas[0].nombre, pr.cantidad, pr.total, totalFijos, false, pr.id, false, pr.hojas[0].codigo || null)); return; }
            const abreP = est.abiertos.has(pr.id) || !!est.filtro;
            trs.push(dibujarFila('n2', 'Producto', pr.nombre, pr.cantidad, pr.total, totalFijos, !est.filtro, pr.id, abreP, pr.codigo));
            if (abreP) pr.hojas.forEach((x) => trs.push(dibujarFila('n3', 'Modificador', partes(x.nombre).variante || x.nombre, x.cantidad, x.total, totalFijos, false, null, false, x.codigo || null)));
          });
        });
        const todo = h('div.fila', { style: 'margin:.2rem 0 .6rem' },
          h('button.btn.chico', { type: 'button', onclick: () => { lista.forEach((c) => { est.abiertos.add(c.id); c.productos.forEach((p) => est.abiertos.add(p.id)); }); pintarProd(); } }, 'Abrir todo'),
          h('button.btn.chico', { type: 'button', onclick: () => { est.abiertos.clear(); est._iniciado = true; pintarProd(); } }, 'Cerrar todo'));
        return h('div', todo, h('div.tabla-caja', h('table.tabla.arbol', h('thead', h('tr', h('th', 'Cajón, producto y detalle (marca, sabor o tamaño)'), h('th.der', 'Cantidad'), h('th.der', 'Monto con IVA'), h('th.der', '% del total'))), h('tbody', trs),
          h('tfoot', h('tr', h('td', 'Total de estos productos'), h('td.der', num(fijos.reduce((a, x) => a + +x.cantidad, 0), 3)), h('td.der', money(totalFijos)), h('td.der', ''))))), insightPapas(lista));
      }
      function vistaLista() {
        const { col, dir } = est.ordenLista;
        const rows = filasLista(fijos);
        const total = rows.length, mostrar = est.verTodos ? rows : rows.slice(0, 15);
        const th = (c, t, der) => h('th' + (der ? '.der' : ''), { 'aria-sort': col === c ? (dir > 0 ? 'ascending' : 'descending') : 'none' },
          h('button.ord', { type: 'button', onclick: () => { est.ordenLista = { col: c, dir: col === c ? -dir : (c === 'nombre' || c === 'codigo' ? 1 : -1) }; pintarProd(); } }, t, ' ', h('span.flecha', col === c ? (dir > 0 ? '▲' : '▼') : '↕')));
        if (!total) return h('p.tenue', 'Ningún producto coincide con la búsqueda.');
        return h('div', h('p.tenue', 'Toque el título de una columna para ordenar. Cada presentación (por ejemplo Coca-Cola 355 mL y Coca-Cola 600 mL) es un producto aparte.'),
          h('div.tabla-caja', h('table.tabla', h('thead', h('tr', th('codigo', 'Código'), th('nombre', 'Producto'), th('cantidad', 'Cantidad', 1), th('total', 'Monto con IVA', 1), h('th.der', '% del total'))),
            h('tbody', mostrar.map((x) => h('tr', h('td', h('code.cod', x.codigo || 'sin dato')), h('td', x.nombre), h('td.der', num(x.cantidad, 3)), h('td.der', money(x.total)), h('td.der', pct(x.total, totalFijos))))))),
          total > 15 ? h('div.fila', { style: 'margin-top:.6rem' }, h('button.btn', { type: 'button', onclick: () => { est.verTodos = !est.verTodos; pintarProd(); } }, est.verTodos ? 'Mostrar solo los 15 primeros' : `Ver los ${total} productos`)) : null);
      }
      // "Con papas": cuántas veces se vendió la opción de papas frente a los platos principales del mismo cajón
      function insightPapas(lista) {
        const out = [];
        lista.forEach((cj) => {
          const hojas = cj.productos.flatMap((p) => p.hojas);
          const cp = hojas.filter((x) => /^con papas/i.test(x.nombre)); if (!cp.length) return;
          const nCP = cp.reduce((a, x) => a + x.cantidad, 0);
          const base = hojas.filter((x) => !/^con papas/i.test(x.nombre) && !/^adicional/i.test(x.nombre)).reduce((a, x) => a + x.cantidad, 0);
          if (base > 0) out.push(h('li', `${cj.nombre}: la opción «Con papas» se vendió ${num(nCP, 0)} ${nCP === 1 ? 'vez' : 'veces'} frente a ${num(base, 0)} platos del cajón (sin contar adicionales), alrededor del ${pct(nCP, base)}.`));
        });
        return out.length ? h('div.lis-nota', h('strong', 'Cuántos salen con papas'), h('ul', out), h('small', 'Es una estimación: si un cliente pide varios platos y una sola vez «Con papas», se cuenta una sola vez.')) : null;
      }
      pintarProd();

      const cab = seccion('Productos vendidos', 'Agrupados por el código de 6 dígitos: cajón (2), producto (2) y modificador (2), igual que en el reporte «Productos vendidos» de Prisma. Sirve para ver, por ejemplo, qué marca de gaseosa se vende más. Cada tamaño es un producto distinto (Coca-Cola 355 mL y Coca-Cola 600 mL no se mezclan). No incluye ventas anuladas.', () => conBase('Productos vendidos', tablaProductos(d)),
        h('label.etq.lis-buscar', 'Buscar un producto', busca), barra, cuerpoProd);
      if (!abiertos.length) return cab;
      const totalAb = abiertos.reduce((a, x) => a + +x.total, 0);
      return h('div', cab, seccion('Precio abierto o por peso (aparte)', 'En estos productos el precio se digita a mano o se vende por peso, así que la cantidad NO se puede comparar con la de los demás productos. Por eso van separados y no suman en la tabla de arriba.', () => conBase('Productos de precio abierto o por peso', tablaAbiertos(d)),
        tablaSimple([{ t: 'Código' }, { t: 'Producto' }, { t: 'Unidad' }, { t: 'Cantidad o peso', der: 1 }, { t: 'Monto con IVA', der: 1 }],
          abiertos.map((x) => [h('code.cod', x.codigo || 'sin dato'), x.nombre, x.unidad || '', num(x.cantidad, 3), money(x.total)]),
          h('tr', h('td', { colspan: 4 }, 'Total de precio abierto'), h('td.der', money(totalAb))))));
    }

    /* ---------- imprimir resumen ---------- */
    function imprimir(btn) {
      if (!est.datos) return toast('Espere a que carguen las ventas.', 'error');
      const d = est.datos, r = d.resumen; let hoja = document.getElementById('impresion-resumen'); hoja?.remove();
      const ticket = r.vigentes_n ? r.vigentes_total / r.vigentes_n : 0;
      const serie = seriesDias(d);
      const g = (tipo, datos, opc) => { const caja = h('div.gr-caja'); if (datos.length) caja.append((tipo === 'col' ? graficoColumnas : graficoBarras)(datos, { ...opc, ancho: 680 })); return caja; };
      const porH = new Map((d.por_hora || []).map((x) => [+x.hora, x])); const hs = [...porH.keys()];
      const hSerie = []; if (hs.length) for (let k = Math.min(...hs, 7); k <= Math.max(...hs, 18); k++) hSerie.push({ etiqueta: k + ':00', valor: +(porH.get(k)?.total || 0) });
      const totM = (d.por_medio || []).reduce((a, x) => a + +x.total, 0), totS = (d.por_servicio || []).reduce((a, x) => a + +x.total, 0);
      const top = (d.productos || []).filter((x) => !x.abierto).sort((a, b) => b.total - a.total).slice(0, 15);
      hoja = h('div#impresion-resumen',
        h('h1', 'Resumen de ventas · ' + nomSoc),
        h('p', textoRango(est.desde, est.hasta) + (est.turno ? ' · un solo turno' : ' · todos los turnos') + (est.demo ? ' · DATOS DE EJEMPLO, NO SON VENTAS REALES' : '')),
        h('p.sm', 'Colones (₡). Todas las cifras incluyen IVA salvo donde se indique. Las notas de crédito se restan.'),
        h('table.imp-kpi', h('tbody',
          [['Ventas brutas (antes de notas de crédito)', money(r.ventas_brutas)], ['Notas de crédito (se restan)', '−' + money(r.notas_credito)], ['Ventas netas (con IVA)', money(r.ventas_netas)],
            ['IVA dentro de las ventas netas', money(r.iva_neto)], ['Documentos emitidos', num(r.docs_emitidos, 0)], ['Promedio por venta (con IVA)', money(ticket)]].map(([a, b]) => h('tr', h('td', a), h('td.der', b))))),
        (d.por_tarifa || []).length ? h('div', h('h2', 'Ventas por tarifa de IVA'), tablaSimple([{ t: 'Tarifa' }, { t: 'Ventas sin IVA', der: 1 }, { t: 'IVA', der: 1 }, { t: 'Total con IVA', der: 1 }],
          d.por_tarifa.map((t) => { const total = +(t.total ?? t.total_con_iva ?? 0), iva = +(t.iva ?? 0); return [nombreTarifa(t), money(t.base != null ? +t.base : total - iva), money(iva), money(total)]; }))) : null,
        (d.rechazados?.n || 0) > 0 ? h('p.sm', `Aparte: ${d.rechazados.n} ${d.rechazados.n === 1 ? 'documento rechazado' : 'documentos rechazados'} por Hacienda (${money(d.rechazados.total)}), que no suman en estas ventas.`) : null,
        serie.length > 1 ? h('div', h('h2', 'Ventas netas por ' + (serie[0].mes ? 'mes' : 'día')), g('col', serie.map((x) => ({ etiqueta: x.mes ? dia(x.dia, { month: 'short' }) : dia(x.dia, { day: '2-digit', month: '2-digit' }), valor: +x.netas })), { tituloX: serie[0].mes ? 'Mes' : 'Día (en orden de fecha)', tituloY: 'Ventas netas (₡, IVA incluido)', alto: 230, anchoEtiqueta: 44 })) : null,
        hSerie.length ? h('div', h('h2', 'Ventas por hora'), g('col', hSerie, { tituloX: 'Hora del día (24 horas)', tituloY: 'Ventas netas, sin las anuladas (₡, IVA incluido)', color: 'ambar', alto: 220, anchoEtiqueta: 36 })) : null,
        (d.por_medio || []).length ? h('div', h('h2', 'Por medio de pago'), g('bar', d.por_medio.map((x) => ({ etiqueta: nombreMedio(x.medio), valor: +x.total, extra: pct(+x.total, totM) })), { tituloX: 'Monto cobrado, sin las anuladas (₡, IVA incluido)', tituloY: 'Medio de pago' })) : null,
        (d.por_servicio || []).length ? h('div', h('h2', 'Por tipo de servicio'), g('bar', d.por_servicio.map((x) => ({ etiqueta: nombreServicio(x.tipo_servicio), valor: +x.total, extra: pct(+x.total, totS) })), { tituloX: 'Monto vendido, sin las anuladas (₡, IVA incluido)', tituloY: 'Tipo de servicio' })) : null,
        top.length ? h('div', h('h2', 'Los 15 productos con más ventas'), tablaSimple([{ t: 'Código' }, { t: 'Producto' }, { t: 'Cantidad', der: 1 }, { t: 'Monto con IVA', der: 1 }], top.map((x) => [x.codigo || '', x.nombre, num(x.cantidad, 3), money(x.total)]))) : null,
        h('p.sm', 'Impreso el ' + fechaHora(new Date()) + ' desde el facturador.'));
      document.body.append(hoja);
      const quitar = () => { hoja.remove(); window.removeEventListener('afterprint', quitar); };
      window.addEventListener('afterprint', quitar);
      setTimeout(() => window.print(), 50);
    }

    periodo.elegir('hoy');
    return () => { ficha++; limpiezas.splice(0).forEach((f) => f()); document.getElementById('impresion-resumen')?.remove(); };
  },
};
