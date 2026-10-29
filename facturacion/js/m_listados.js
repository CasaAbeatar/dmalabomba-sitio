// Listados: reportes de ventas facturadas. Datos: fx_listados2 (ventas netas de notas de crédito), ver sql/05_listados2.sql.
import { h, money, num, fechaHora, horaCorta, fechaCorta, sumaDias, toast, TIPOS_SERVICIO, MEDIOS } from './util.js';
import { listados2 } from './api_listados.js';
import { selectorPeriodo, textoRango, fechaLarga } from './periodo.js';
import { csvBajar } from './csv.js';
import { graficoColumnas, graficoBarras, autoAjustar } from './graficos.js';

const cssUrl = new URL('../css/listados.css', import.meta.url).href;
const norm = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const pct = (a, b) => (b ? new Intl.NumberFormat('es-CR', { maximumFractionDigits: 1 }).format((a / b) * 100) + ' %' : '');
const dia = (ymd, o) => new Intl.DateTimeFormat('es-CR', { timeZone: 'UTC', ...o }).format(new Date(ymd + 'T12:00:00Z'));
const nombreServicio = (t) => TIPOS_SERVICIO[t] || (t === 'sin dato' ? 'Sin dato' : t);
const nombreMedio = (m) => MEDIOS[m] || m;
const todosLosDias = (d, a) => { const r = []; for (let x = d; x <= a && r.length < 800; x = sumaDias(x, 1)) r.push(x); return r; };

export default {
  id: 'listados', titulo: 'Listados',
  async mount(root, app) {
    if (!document.getElementById('css-listados')) document.head.append(h('link', { id: 'css-listados', rel: 'stylesheet', href: cssUrl }));
    const limpiezas = [];
    let ficha = 0; // descarta respuestas viejas
    const est = { desde: null, hasta: null, turno: '', datos: null, demo: false, vista: 'arbol', orden: 'monto', ordenLista: { col: 'total', dir: -1 }, filtro: '', abiertos: new Set(), verTodos: false };

    const periodo = selectorPeriodo({ inicial: 'hoy', alCambiar: ([d, a]) => { est.turno = ''; cargar(d, a); } });
    const turnoSel = h('select.campo', { 'aria-label': 'Turno', onchange: () => { est.turno = turnoSel.value; cargar(est.desde, est.hasta, true); } });
    const turnoCaja = h('label.etq.lis-turno', 'Ver solo un turno de caja (opcional)', turnoSel);
    const rotulo = h('p.lis-rotulo');
    const resumenEl = h('div');
    const cuerpo = h('div');
    const demoBanner = h('div.demo-banner', { hidden: true }, h('strong', 'DATOS DE EJEMPLO. '), 'Lo que ve aquí no son ventas reales, es solo una muestra para ver cómo se verán los gráficos. ',
      h('button.btn.chico', { type: 'button', onclick: () => { est.demo = false; cargar(est.desde, est.hasta); } }, 'Volver a los datos reales'));

    root.append(
      h('div.lis-cab', h('div', h('h1', 'Listados de ventas'), h('p.tenue', 'Ventas ya facturadas de ', h('strong', app.soc?.nombre_comercial || app.soc?.nombre || ''), '. Las cifras vienen de las facturas y tiquetes emitidos; las notas de crédito se restan.')),
        h('button.btn', { type: 'button', onclick: (e) => imprimir(e.currentTarget) }, 'Imprimir resumen')),
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
        cuerpo.replaceChildren(h('div.vacio', h('p', 'No se pudieron traer las ventas.'), h('p.tenue', e.message || String(e)), h('button.btn', { type: 'button', onclick: () => cargar(desde, hasta) }, 'Intentar de nuevo')));
      }
    }

    function llenarTurnos(turnos) {
      turnoSel.replaceChildren(h('option', { value: '' }, 'Todos los turnos'));
      turnos.forEach((t) => turnoSel.append(h('option', { value: t.id }, `Turno del ${fechaCorta(t.abierto_en)}, ${horaCorta(t.abierto_en)} a ${t.cerrado_en ? horaCorta(t.cerrado_en) : 'en curso'}${t.abierto_por ? ' · abrió ' + t.abierto_por : ''} (${t.ventas} ${t.ventas === 1 ? 'venta' : 'ventas'})`)));
      turnoSel.value = est.turno || '';
      turnoCaja.hidden = turnos.length === 0;
    }

    /* ---------- piezas de pantalla ---------- */
    const seccion = (titulo, ayuda, csv, ...hijos) => h('section.tarjeta.lis-sec',
      h('div.lis-sec-cab', h('div', h('h2', titulo), ayuda ? h('p.tenue.lis-ayuda', ayuda) : null),
        csv ? h('button.btn.chico', { type: 'button', onclick: csv }, 'Descargar en Excel (CSV)') : null), ...hijos);
    const nombreArchivo = (que) => `${que} ${app.soc?.nombre_comercial || app.soc?.codigo || ''} ${est.desde}${est.desde === est.hasta ? '' : ' a ' + est.hasta}`;
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
      if (!r.docs_emitidos && !r.notas_credito_n) {
        const masAmplio = periodo.id() === 'hoy' ? ['mes', 'Ver este mes'] : null;
        cuerpo.append(h('div.vacio.lis-vacio', h('h2', 'Todavía no hay ventas facturadas en este periodo'),
          h('p', est.turno ? 'Ese turno no tiene ventas con factura o tiquete en las fechas escogidas.' : 'Cuando se cobre una venta, aparecerá aquí con sus gráficos.'),
          h('div.fila', { style: 'justify-content:center' },
            masAmplio ? h('button.btn.primario', { type: 'button', onclick: () => periodo.elegir(masAmplio[0]) }, masAmplio[1]) : null,
            h('button.btn', { type: 'button', onclick: () => periodo.elegir('ayer') }, 'Ver ayer'),
            h('button.btn', { type: 'button', onclick: () => { est.demo = true; cargar(est.desde, est.hasta); } }, 'Ver un ejemplo con datos de muestra'))));
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
          kpi('Ticket promedio', money(ticket), 'Ventas netas entre el número de ventas vigentes. Con IVA incluido.')),
        r.sin_aceptar_n > 0 ? h('p.lis-aviso', `${r.sin_aceptar_n} ${r.sin_aceptar_n === 1 ? 'documento todavía no está aceptado' : 'documentos todavía no están aceptados'} por Hacienda (en cola o con error). Cuentan en las cifras igual que los aceptados.`) : null,
        Math.abs((r.vigentes_total || 0) - (r.ventas_netas || 0)) > 0.005 ? h('p.lis-aviso', `Los desgloses de abajo suman ${money(r.vigentes_total)} y las ventas netas ${money(r.ventas_netas)}: la diferencia viene de notas de crédito de este periodo que anulan ventas de otro periodo.`) : null,
      ].filter(Boolean));

      cuerpo.append(seccionDias(d), seccionHoras(d), seccionMedios(d), seccionServicio(d), seccionProductos(d));
      const extra = [seccionTurnos(d), seccionCajeros(d), seccionIva(d)].filter(Boolean);
      if (extra.length) cuerpo.append(...extra);
      if (!est.demo) cuerpo.append(h('p.lis-pie', h('button.btn.suave.chico', { type: 'button', onclick: () => { est.demo = true; cargar(est.desde, est.hasta); } }, 'Ver un ejemplo con datos de muestra')));
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
    function seccionDias(d) {
      const serie = seriesDias(d);
      const csv = () => csvBajar(nombreArchivo('Ventas por dia'), ['Fecha', 'Documentos', 'Ventas brutas (con IVA)', 'Notas de crédito (con IVA)', 'Ventas netas (con IVA)', 'IVA neto'],
        serie.map((x) => [x.dia, +x.docs, +x.ventas, +x.notas_credito, +x.netas, +x.iva]));
      if (serie.length <= 1) return seccion('Ventas por día', 'El periodo es de un solo día. Más abajo está el detalle por hora.', null, h('p.tenue', 'Escoja "Esta semana" o "Este mes" para ver cada día en una columna.'));
      const datos = serie.map((x) => ({ id: x.dia, etiqueta: x.mes ? dia(x.dia, { month: 'short', year: '2-digit' }) : (serie.length <= 8 ? dia(x.dia, { weekday: 'short' }).replace('.', '') + ' ' + dia(x.dia, { day: 'numeric' }) : dia(x.dia, { day: '2-digit', month: '2-digit' })), valor: +x.netas,
        texto: `${x.mes ? dia(x.dia, { month: 'long', year: 'numeric' }) : fechaLarga(x.dia)}: ventas netas ${money(x.netas)} (brutas ${money(x.ventas)}, notas de crédito ${money(x.notas_credito)}), IVA ${money(x.iva)}, ${x.docs} ${x.docs === 1 ? 'documento' : 'documentos'}.` }));
      const mes = serie[0].mes;
      return seccion(mes ? 'Ventas por mes' : 'Ventas por día', `Cada columna es ${mes ? 'un mes' : 'un día'}, de izquierda (más antiguo) a derecha (más reciente). Ventas netas: ya restadas las notas de crédito, con IVA incluido.`, csv,
        conGrafico('col', datos, { tituloX: mes ? 'Mes' : 'Día (de izquierda a derecha, en orden de fecha)', tituloY: 'Ventas netas (₡, IVA incluido)', color: 'rojo', anchoEtiqueta: mes ? 56 : 44, descripcion: 'Gráfico de columnas de ventas netas por ' + (mes ? 'mes' : 'día') }));
    }

    /* ---------- ventas por hora ---------- */
    function seccionHoras(d) {
      const porH = new Map((d.por_hora || []).map((x) => [+x.hora, x]));
      if (!porH.size) return null;
      const hs = [...porH.keys()]; const desdeH = Math.min(...hs, 7), hastaH = Math.max(...hs, 18);
      const serie = []; for (let k = desdeH; k <= hastaH; k++) serie.push({ hora: k, ...(porH.get(k) || { docs: 0, total: 0 }) });
      const etq = (k) => `${k}:00`;
      const rangoH = (k) => `${String(k).padStart(2, '0')}:00 a ${String(k).padStart(2, '0')}:59`;
      const datos = serie.map((x) => ({ id: x.hora, etiqueta: etq(x.hora), valor: +x.total, texto: `De ${rangoH(x.hora)}: ${money(x.total)} en ${x.docs} ${x.docs === 1 ? 'venta' : 'ventas'}.` }));
      const mejor = serie.reduce((a, b) => (+b.total > +a.total ? b : a), serie[0]);
      const csv = () => csvBajar(nombreArchivo('Ventas por hora'), ['Hora (inicio)', 'Ventas (número)', 'Monto con IVA'], serie.map((x) => [etq(x.hora), +x.docs, +x.total]));
      return seccion('Ventas por hora', `Suma de todos los días del periodo. La hora con más ventas es ${etq(mejor.hora)} a ${String(mejor.hora).padStart(2, '0')}:59 (${money(mejor.total)}). No incluye ventas anuladas con nota de crédito.`, csv,
        conGrafico('col', datos, { tituloX: 'Hora del día (formato de 24 horas, la columna de 7:00 son las ventas entre 7:00 y 7:59)', tituloY: 'Ventas (₡, IVA incluido)', color: 'ambar', anchoEtiqueta: 36, descripcion: 'Gráfico de columnas de ventas por hora del día' }));
    }

    /* ---------- medio de pago y tipo de servicio ---------- */
    function seccionMedios(d) {
      const filas = d.por_medio || []; const tot = filas.reduce((a, x) => a + +x.total, 0);
      const datos = filas.map((x) => ({ etiqueta: nombreMedio(x.medio), valor: +x.total, extra: pct(+x.total, tot), texto: `${nombreMedio(x.medio)}: ${money(x.total)} (${pct(+x.total, tot)} de lo cobrado) en ${x.docs} ${x.docs === 1 ? 'venta' : 'ventas'}.` }));
      const csv = () => csvBajar(nombreArchivo('Ventas por medio de pago'), ['Medio de pago', 'Ventas (número)', 'Monto con IVA', 'Porcentaje'], filas.map((x) => [nombreMedio(x.medio), +x.docs, +x.total, tot ? Math.round((+x.total / tot) * 1000) / 10 : 0]));
      return seccion('Por medio de pago', 'Cómo pagaron los clientes (una venta pagada con dos medios aparece en ambos). No incluye ventas anuladas.', csv,
        conGrafico('bar', datos, { tituloX: 'Monto cobrado (₡, IVA incluido)', tituloY: 'Medio de pago', descripcion: 'Barras de ventas por medio de pago' }));
    }
    function seccionServicio(d) {
      const filas = d.por_servicio || []; const tot = filas.reduce((a, x) => a + +x.total, 0);
      const datos = filas.map((x) => ({ etiqueta: nombreServicio(x.tipo_servicio), valor: +x.total, extra: pct(+x.total, tot), texto: `${nombreServicio(x.tipo_servicio)}: ${money(x.total)} (${pct(+x.total, tot)}) en ${x.ventas} ${x.ventas === 1 ? 'venta' : 'ventas'}; promedio por venta ${money(+x.total / (+x.ventas || 1))}.` }));
      const csv = () => csvBajar(nombreArchivo('Ventas por tipo de servicio'), ['Tipo de servicio', 'Ventas (número)', 'Monto con IVA', 'Porcentaje', 'Promedio por venta'], filas.map((x) => [nombreServicio(x.tipo_servicio), +x.ventas, +x.total, tot ? Math.round((+x.total / tot) * 1000) / 10 : 0, Math.round((+x.total / (+x.ventas || 1)) * 100) / 100]));
      return seccion('Por tipo de servicio', 'Buffet, para llevar, express o en espera. No incluye ventas anuladas.', csv,
        conGrafico('bar', datos, { tituloX: 'Monto vendido (₡, IVA incluido)', tituloY: 'Tipo de servicio', descripcion: 'Barras de ventas por tipo de servicio' }));
    }

    /* ---------- turnos, cajeros, IVA ---------- */
    function seccionTurnos(d) {
      const filas = d.por_turno || []; if (!filas.length) return null;
      const csv = () => csvBajar(nombreArchivo('Ventas por turno'), ['Abrió', 'Cerró', 'Abierto por', 'Ventas (número)', 'Monto con IVA'], filas.map((t) => [fechaHora(t.abierto_en), t.cerrado_en ? fechaHora(t.cerrado_en) : 'En curso', t.abierto_por || '', +t.ventas, +t.total]));
      return seccion('Por turno de caja', 'Cada turno abre y cierra la caja. Monto de las ventas vigentes (sin anuladas), con IVA.', csv,
        tablaSimple([{ t: 'Turno' }, { t: 'Abrió' }, { t: 'Cerró' }, { t: 'Ventas', der: 1 }, { t: 'Monto con IVA', der: 1 }],
          filas.map((t) => [t.abierto_por ? 'Abrió ' + t.abierto_por : 'Turno', fechaHora(t.abierto_en), t.cerrado_en ? fechaHora(t.cerrado_en) : 'En curso', num(t.ventas, 0), money(t.total)])));
    }
    function seccionCajeros(d) {
      const filas = d.por_cajero || []; if (!filas.length || (filas.length === 1 && filas[0].cajero === 'Sin registrar')) return null;
      const csv = () => csvBajar(nombreArchivo('Ventas por cajero'), ['Cajero', 'Ventas (número)', 'Monto con IVA'], filas.map((t) => [t.cajero, +t.ventas, +t.total]));
      return seccion('Por cajero', 'Quien abrió la cuenta de cada venta. Monto con IVA, sin ventas anuladas.', csv,
        tablaSimple([{ t: 'Cajero' }, { t: 'Ventas', der: 1 }, { t: 'Monto con IVA', der: 1 }], filas.map((t) => [t.cajero, num(t.ventas, 0), money(t.total)])));
    }
    function seccionIva(d) {
      const filas = d.por_tarifa || []; if (!filas.length) return null;
      const csv = () => csvBajar(nombreArchivo('IVA por tarifa'), ['Tarifa de IVA (%)', 'Ventas con IVA', 'IVA', 'Ventas sin IVA'], filas.map((t) => [+t.tarifa, +t.total_con_iva, +t.iva, Math.round((+t.total_con_iva - +t.iva) * 100) / 100]));
      return seccion('IVA por tarifa', 'Desglose del IVA de las ventas vigentes (sin anuladas), línea por línea.', csv,
        tablaSimple([{ t: 'Tarifa' }, { t: 'Ventas con IVA', der: 1 }, { t: 'IVA', der: 1 }, { t: 'Ventas sin IVA', der: 1 }],
          filas.map((t) => [(+t.tarifa) + ' %', money(t.total_con_iva), money(t.iva), money(+t.total_con_iva - +t.iva)])));
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
        const c = x.codigo ? x.codigo.slice(0, 2) : '--', p = x.codigo ? x.codigo.slice(0, 4) : '----';
        if (!cajones.has(c)) cajones.set(c, { id: 'c' + c, codigo: c, nombre: c === '--' ? 'Sin código del catálogo (líneas libres)' : (x.cajon_nombre || 'Cajón ' + c), productos: new Map(), cantidad: 0, total: 0 });
        const cj = cajones.get(c); cj.cantidad += +x.cantidad; cj.total += +x.total;
        if (!cj.productos.has(p)) cj.productos.set(p, { id: 'p' + p, codigo: p, hojas: [], cantidad: 0, total: 0 });
        const pr = cj.productos.get(p); pr.hojas.push(x); pr.cantidad += +x.cantidad; pr.total += +x.total;
      });
      const cmp = (a, b) => est.orden === 'codigo' ? String(a.codigo).localeCompare(String(b.codigo)) : est.orden === 'cantidad' ? b.cantidad - a.cantidad : b.total - a.total;
      const lista = [...cajones.values()].map((cj) => {
        const productos = [...cj.productos.values()].map((pr) => ({ ...pr, nombre: etiquetaProducto(pr.hojas, pr.codigo), hojas: [...pr.hojas].map((x) => ({ ...x, cantidad: +x.cantidad, total: +x.total })).sort(cmp) })).sort(cmp);
        return { ...cj, productos };
      }).sort(cmp);
      return lista;
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
        const f = norm(est.filtro), { col, dir } = est.ordenLista;
        let rows = fijos.filter((x) => !f || norm(x.nombre + ' ' + x.codigo).includes(f)).map((x) => ({ ...x, cantidad: +x.cantidad, total: +x.total }));
        rows.sort((a, b) => (col === 'nombre' || col === 'codigo' ? String(a[col]).localeCompare(String(b[col])) * dir : (a[col] - b[col]) * dir));
        const total = rows.length, mostrar = est.verTodos ? rows : rows.slice(0, 15);
        const th = (c, t, der) => h('th' + (der ? '.der' : ''), { 'aria-sort': col === c ? (dir > 0 ? 'ascending' : 'descending') : 'none' },
          h('button.ord', { type: 'button', onclick: () => { est.ordenLista = { col: c, dir: col === c ? -dir : (c === 'nombre' || c === 'codigo' ? 1 : -1) }; pintarProd(); } }, t, ' ', h('span.flecha', col === c ? (dir > 0 ? '▲' : '▼') : '↕')));
        if (!total) return h('p.tenue', 'Ningún producto coincide con la búsqueda.');
        return h('div', h('p.tenue', 'Toque el título de una columna para ordenar. Cada presentación (por ejemplo Coca-Cola 355 mL y Coca-Cola 600 mL) es un producto aparte.'),
          h('div.tabla-caja', h('table.tabla', h('thead', h('tr', th('codigo', 'Código'), th('nombre', 'Producto'), th('cantidad', 'Cantidad', 1), th('total', 'Monto con IVA', 1), h('th.der', '% del total'))),
            h('tbody', mostrar.map((x) => h('tr', h('td', h('code.cod', x.codigo || 's/d')), h('td', x.nombre), h('td.der', num(x.cantidad, 3)), h('td.der', money(x.total)), h('td.der', pct(x.total, totalFijos))))))),
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
          if (base > 0) out.push(h('li', `${cj.nombre}: la opción "Con papas" se vendió ${num(nCP, 0)} ${nCP === 1 ? 'vez' : 'veces'} frente a ${num(base, 0)} platos del cajón (sin contar adicionales), alrededor del ${pct(nCP, base)}.`));
        });
        return out.length ? h('div.lis-nota', h('strong', 'Cuántos salen con papas'), h('ul', out), h('small', 'Es una estimación: si un cliente pide varios platos y una sola vez "Con papas", se cuenta una sola vez.')) : null;
      }
      pintarProd();

      const csvProd = () => {
        const lista = arbol(fijos, '');
        const rows = []; lista.forEach((cj) => cj.productos.forEach((pr) => pr.hojas.forEach((x) => rows.push([cj.nombre, pr.nombre, x.codigo || '', x.nombre, +x.cantidad, +x.total, totalFijos ? Math.round((+x.total / totalFijos) * 10000) / 100 : 0]))));
        csvBajar(nombreArchivo('Productos vendidos'), ['Cajón', 'Producto', 'Código', 'Nombre completo', 'Cantidad', 'Monto con IVA', '% del total'], rows);
      };
      const cab = seccion('Productos vendidos', 'Agrupados por el código de 6 dígitos: cajón (2), producto (2) y modificador (2), igual que en el reporte "Productos vendidos" de Prisma. Sirve para ver, por ejemplo, qué marca de gaseosa se vende más. Cada tamaño es un producto distinto (Coca-Cola 355 mL y Coca-Cola 600 mL no se mezclan). No incluye ventas anuladas.', csvProd,
        h('label.etq.lis-buscar', 'Buscar un producto', busca), barra, cuerpoProd);
      if (!abiertos.length) return cab;
      const totalAb = abiertos.reduce((a, x) => a + +x.total, 0);
      const csvAb = () => csvBajar(nombreArchivo('Productos de precio abierto o por peso'), ['Código', 'Producto', 'Unidad', 'Cantidad', 'Monto con IVA'], abiertos.map((x) => [x.codigo || '', x.nombre, x.unidad || '', +x.cantidad, +x.total]));
      return h('div', cab, seccion('Precio abierto o por peso (aparte)', 'En estos productos el precio se digita a mano o se vende por peso, así que la cantidad NO se puede comparar con la de los demás productos. Por eso van separados y no suman en la tabla de arriba.', csvAb,
        tablaSimple([{ t: 'Código' }, { t: 'Producto' }, { t: 'Unidad' }, { t: 'Cantidad o peso', der: 1 }, { t: 'Monto con IVA', der: 1 }],
          abiertos.map((x) => [h('code.cod', x.codigo || 's/d'), x.nombre, x.unidad || '', num(x.cantidad, 3), money(x.total)]),
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
        h('h1', 'Resumen de ventas · ' + (app.soc?.nombre_comercial || app.soc?.nombre || '')),
        h('p', textoRango(est.desde, est.hasta) + (est.turno ? ' · un solo turno' : ' · todos los turnos') + (est.demo ? ' · DATOS DE EJEMPLO, NO SON VENTAS REALES' : '')),
        h('p.sm', 'Colones (₡). Todas las cifras incluyen IVA salvo donde se indique. Las notas de crédito se restan.'),
        h('table.imp-kpi', h('tbody',
          [['Ventas brutas (antes de notas de crédito)', money(r.ventas_brutas)], ['Notas de crédito (se restan)', '−' + money(r.notas_credito)], ['Ventas netas (con IVA)', money(r.ventas_netas)],
            ['IVA dentro de las ventas netas', money(r.iva_neto)], ['Documentos emitidos', num(r.docs_emitidos, 0)], ['Ticket promedio (con IVA)', money(ticket)]].map(([a, b]) => h('tr', h('td', a), h('td.der', b))))),
        serie.length > 1 ? h('div', h('h2', 'Ventas netas por ' + (serie[0].mes ? 'mes' : 'día')), g('col', serie.map((x) => ({ etiqueta: x.mes ? dia(x.dia, { month: 'short' }) : dia(x.dia, { day: '2-digit', month: '2-digit' }), valor: +x.netas })), { tituloX: serie[0].mes ? 'Mes' : 'Día (en orden de fecha)', tituloY: 'Ventas netas (₡, IVA incluido)', alto: 230, anchoEtiqueta: 44 })) : null,
        hSerie.length ? h('div', h('h2', 'Ventas por hora'), g('col', hSerie, { tituloX: 'Hora del día (24 horas)', tituloY: 'Ventas (₡, IVA incluido)', color: 'ambar', alto: 220, anchoEtiqueta: 36 })) : null,
        (d.por_medio || []).length ? h('div', h('h2', 'Por medio de pago'), g('bar', d.por_medio.map((x) => ({ etiqueta: nombreMedio(x.medio), valor: +x.total, extra: pct(+x.total, totM) })), { tituloX: 'Monto cobrado (₡, IVA incluido)', tituloY: 'Medio de pago' })) : null,
        (d.por_servicio || []).length ? h('div', h('h2', 'Por tipo de servicio'), g('bar', d.por_servicio.map((x) => ({ etiqueta: nombreServicio(x.tipo_servicio), valor: +x.total, extra: pct(+x.total, totS) })), { tituloX: 'Monto vendido (₡, IVA incluido)', tituloY: 'Tipo de servicio' })) : null,
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
