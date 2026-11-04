// Alertas de Hacienda (Administración, solo administradores): todo lo importante que dijo o dejó de decir Hacienda, en un solo lugar.
// La misma alerta también llega al teléfono (Panel) y al correo del administrador; aquí se ve cuáles ya llegaron y quién la atendió.
// «Ya lo atendí» pide una nota (obligatoria) y deja constancia de quién y cuándo. Una cajera no ve esta pantalla ni la tarjeta.
import { h, esqueleto, bloqueError, textoDeError, conBoton, toast, fechaHora, money } from './util.js';
import { alertasHacienda } from './api_alertas_hacienda.js';
import { haceCuanto } from './api_respaldos.js';
import { cargarHoja } from './ui_hojas.js';
import { panelCabys, pedirNotaAtencion } from './cabys_analisis.js';

// A dónde lleva el botón «Ir a…» (módulo del facturador donde se resuelve cada tipo de alerta)
const TIPOS_FACTURA = ['cabys_distinto', 'tarifa_distinta', 'precio_distinto']; // alertas con análisis de una factura de proveedor
const IR = {
  emitidas: { texto: 'Ir a Facturas emitidas', ir: (app) => app.ir('emitidas') },
  contabilidad: { texto: 'Ir a Contabilidad', ir: (app) => app.ir('contabilidad') },
  inventarios: { texto: 'Ir a Inventarios', ir: (app) => app.ir('inventarios', { seccion: 'hoy', foco: 'rechazos' }) },
  anular: { texto: 'Ir a Anular y reimprimir', ir: (app) => app.ir('anular', { propuestas: true }) },
  numeracion: { texto: 'Ir a Numeración', ir: (app) => app.ir('numeracion') },
};

const hora = (f) => fechaHora(f);
// Cómo llegó la alerta por cada medio, en palabras sencillas
function entregas(e) {
  const p = e?.panel || {}, c = e?.correo || {}, b = e?.bandeja || {};
  const panel = p.estado === 'enviada' ? 'Enviado ' + hora(p.en) : p.estado === 'sin_destino' ? 'Ningún teléfono tiene los avisos activados'
    : p.estado === 'fallida' ? 'No se pudo enviar' : p.estado === 'omitida' ? 'No hizo falta' : 'En camino';
  const correo = c.estado === 'enviado' ? 'Enviado ' + hora(c.en) + (c.para ? ' a ' + c.para : '') : c.estado === 'sin_confirmar' ? 'No se sabe si salió: revise el correo enviado'
    : c.estado === 'fallido' ? 'No se pudo enviar' : c.estado === 'omitida' ? 'No hizo falta' : 'En camino';
  return h('ul.ah-entregas', { 'aria-label': 'Por dónde llegó este aviso' },
    h('li', h('b', 'En el facturador'), h('span', b.en ? 'Desde ' + hora(b.en) : 'Ahora')),
    h('li', h('b', 'En el teléfono'), h('span', panel)),
    h('li', h('b', 'Por correo'), h('span', correo)));
}

export default {
  id: 'alertas_hacienda',
  titulo: 'Alertas de Hacienda',
  async mount(root, app) {
    await cargarHoja('alertas_hacienda.css');
    if (!app.admin) {
      root.append(h('div.vacio', h('p', 'Esta pantalla es solo para administradores.'), h('button.btn', { type: 'button', onclick: () => app.ir('inicio') }, 'Volver al inicio')));
      return;
    }
    let estado = 'abiertas', vivo = true, nCarga = 0;
    const cuerpo = h('div.ah-cuerpo');
    const bAbiertas = h('button.btn', { type: 'button', 'aria-pressed': 'true', onclick: () => cambiar('abiertas') }, 'Por atender');
    const bAtendidas = h('button.btn', { type: 'button', 'aria-pressed': 'false', onclick: () => cambiar('atendidas') }, 'Ya atendidas');

    function cambiar(e) {
      if (e === estado) return;
      estado = e;
      bAbiertas.setAttribute('aria-pressed', String(e === 'abiertas'));
      bAtendidas.setAttribute('aria-pressed', String(e === 'atendidas'));
      cargar();
    }

    async function atenderAlerta(it, btn) {
      const nota = await pedirNotaAtencion(it.titulo + '. ' + it.texto);
      if (nota == null || !vivo) return;
      await conBoton(btn, async () => {
        await alertasHacienda.atender(it.id, nota);
        toast('Anotado: usted atendió esta alerta.');
        app.alertas?.refrescar?.();
        document.dispatchEvent(new CustomEvent('app:alertas-hacienda-cambio'));
        await cargar();
      });
    }

    // Lo que se ve según el tipo de alerta: quién, cuál, con qué impacto y qué hacer, sin salir de la tarjeta
    const datosFactura = (d) => h('p.ah-factura', h('strong', d.proveedor), ` · factura n.º ${d.numero}`, d.fecha_texto ? ` · del ${d.fecha_texto}` : '', d.total != null ? ` · total ${money(d.total)}` : '');
    function cuerpoPorTipo(it, d) {
      if (TIPOS_FACTURA.includes(it.tipo) && d.proveedor) {
        return h('div', datosFactura(d), panelCabys(d, { sinEncabezado: true, solo: it.tipo === 'tarifa_distinta' ? 'tarifa' : it.tipo === 'precio_distinto' ? 'precio' : 'cabys' }));
      }
      if (it.tipo === 'plazo_8_dias' && d.proveedor) {
        const dias = +d.dias_habiles;
        return h('div.ah-bloque', datosFactura(d),
          h('p', h('strong', 'Fecha límite: '), d.vence_texto || '', Number.isFinite(dias) ? (dias <= 0 ? ' (es hoy o ya pasó)' : ` (quedan ${dias} ${dias === 1 ? 'día hábil' : 'días hábiles'})`) : ''),
          h('p', h('strong', 'Si no responde: '), d.que_pasa_si_no || ''),
          h('p', h('strong', 'Cómo responder: '), d.como || ''));
      }
      if (d.numero && (d.campo || d.motivo || d.tipo_nombre)) {
        return h('div.ah-bloque',
          h('p.ah-factura', h('strong', `${(d.tipo_nombre || 'Comprobante').replace(/^./, (c) => c.toUpperCase())} n.º ${d.numero}`), d.fecha_texto ? ` · del ${d.fecha_texto}` : '', d.total != null ? ` · ${money(d.total)}` : ''),
          d.motivo ? h('p', h('strong', 'Lo que dijo Hacienda: '), d.motivo) : null,
          d.campo ? h('p', h('strong', 'Qué falló: '), d.campo) : null,
          d.como_corregir ? h('p', h('strong', 'Cómo corregirlo: '), d.como_corregir) : null);
      }
      return null;
    }

    function tarjeta(it) {
      const d = it.detalle && typeof it.detalle === 'object' ? it.detalle : {};
      const quien = it.atendida_en ? h('p.ah-quien', h('b', 'Atendida por ' + (it.atendida_por || 'un administrador')), ' · ' + hora(it.atendida_en) + (it.nota ? '. Nota: ' + it.nota : ''))
        : it.cerrada_en ? h('p.ah-quien', 'Se resolvió sola · ' + hora(it.cerrada_en)) : null;
      const destino = IR[it.destino];
      const clave = d.clave || it.clave_ref;
      const conFactura = (TIPOS_FACTURA.includes(it.tipo) || it.tipo === 'plazo_8_dias') && /^\d{50}$/.test(String(clave || ''));
      const atender = (btn) => atenderAlerta(it, btn);
      const detalleCuerpo = cuerpoPorTipo(it, d);
      const trae = TIPOS_FACTURA.includes(it.tipo) && d.proveedor; // el panel de CABYS ya explica cómo atenderla
      // Un solo botón grande con palabras para ir a la factura; «Ya lo atendí» (con nota obligatoria) queda al lado. El panel de CABYS ya trae su propio «Ya lo atendí».
      const botones = estado === 'abiertas' ? h('div.ah-botones',
        conFactura ? h('button.btn.primario.grande', { type: 'button', onclick: () => app.ir('contabilidad', { clave }) }, 'Abrir esta factura') : null,
        h('button.btn' + (conFactura ? '' : '.primario'), { type: 'button', onclick: (e) => atender(e.currentTarget) }, 'Ya lo atendí'),
        !conFactura && destino ? h('button.btn', { type: 'button', onclick: () => destino.ir(app) }, destino.texto) : null) : null;
      return h('li.ah-item.' + (it.cerrada_en ? 'atendida' : it.severidad),
        h('div.ah-fila', h('span.chip.' + (it.severidad === 'urgente' ? 'mal' : 'espera'), it.severidad === 'urgente' ? 'Urgente' : 'Importante'), it.es_prueba ? h('span.chip', 'Prueba') : (it.ambiente && it.ambiente !== 'produccion' ? h('span.chip', 'Ambiente de pruebas') : null),
          h('span.ah-sub', it.empresa + ' · ' + haceCuanto(it.creada_en) + ' · ' + hora(it.creada_en))),
        h('p.ah-t', it.titulo),
        h('p.ah-m', it.texto),
        detalleCuerpo,
        estado === 'abiertas' && it.que_hacer && !trae ? h('p.ah-hacer', h('b', 'Qué hacer: '), it.que_hacer) : null,
        botones,
        entregas(it.entregas),
        quien);
    }

    async function cargar() {
      const mi = ++nCarga;
      if (!cuerpo.children.length || cuerpo.querySelector('.bloque-error')) cuerpo.replaceChildren(esqueleto(3, 'Buscando alertas…'));
      let r;
      try { r = await alertasHacienda.lista(estado); } catch (e) {
        if (!vivo || mi !== nCarga) return;
        cuerpo.replaceChildren(bloqueError({ titulo: 'No se pudieron cargar las alertas', mensaje: textoDeError(e), alReintentar: () => cargar() }));
        return;
      }
      if (!vivo || mi !== nCarga) return;
      const items = Array.isArray(r?.items) ? r.items : [];
      if (!items.length) {
        cuerpo.replaceChildren(h('div.ah-vacio', { role: 'status' },
          h('h2', estado === 'abiertas' ? 'No hay alertas por atender' : 'Todavía no hay alertas atendidas'),
          h('p', estado === 'abiertas' ? 'Cuando Hacienda rechace algo o haya algo que revisar, aparecerá aquí y le llegará al teléfono y al correo.' : 'Aquí se verá quién atendió cada alerta y qué hizo.')));
        return;
      }
      cuerpo.replaceChildren(h('ul.ah-lista', items.map(tarjeta)));
    }

    root.append(h('div.ah',
      h('div.ah-cab', h('p', 'Aquí llega todo lo importante de Hacienda. A usted también le avisamos al teléfono y por correo.'),
        h('button.btn', { type: 'button', onclick: (e) => conBoton(e.currentTarget, () => cargar()) }, 'Revisar de nuevo')),
      h('div.ah-pestanas', { role: 'group', 'aria-label': 'Qué alertas ver' }, bAbiertas, bAtendidas),
      cuerpo));
    await cargar();
    return () => { vivo = false; nCarga++; };
  },
};
