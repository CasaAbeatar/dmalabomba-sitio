// Alertas de Hacienda (Administración, solo administradores): todo lo importante que dijo o dejó de decir Hacienda, en un solo lugar.
// La misma alerta también llega al teléfono (Panel) y al correo del administrador; aquí se ve cuáles ya llegaron y quién la atendió.
// «Ya lo atendí» pide una nota (obligatoria) y deja constancia de quién y cuándo. Una cajera no ve esta pantalla ni la tarjeta.
import { h, esqueleto, bloqueError, textoDeError, conBoton, toast, fechaHora, modal } from './util.js';
import { alertasHacienda } from './api_alertas_hacienda.js';
import { haceCuanto } from './api_respaldos.js';
import { cargarHoja } from './ui_hojas.js';

// A dónde lleva el botón «Ir a…» (módulo del facturador donde se resuelve cada tipo de alerta)
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

// Ventana para escribir qué se hizo. La nota es obligatoria: sin ella el botón avisa y no guarda.
function pedirNota(titulo) {
  return new Promise((ok) => {
    let hecho = false;
    const area = h('textarea.campo', { rows: 4, maxlength: 300, 'aria-label': 'Qué hizo', placeholder: 'Por ejemplo: Ya se corrigió y se volvió a enviar.' });
    const err = h('p.ah-error', { role: 'alert', hidden: true }, 'Escriba qué hizo. Es obligatorio.');
    const fin = (v, c) => { hecho = true; c?.(); ok(v); };
    modal({
      titulo: 'Ya lo atendí', ancho: 460, alCerrar: () => { if (!hecho) ok(null); },
      contenido: h('div.ah-nota-campo', h('p.conf', titulo), h('label.etq', 'Escriba qué hizo (obligatorio)', area), err),
      botones: [
        { texto: 'Cancelar', onclick: (c) => fin(null, c) },
        { texto: 'Guardar que ya lo atendí', clase: 'primario', onclick: (c) => { const v = area.value.trim(); if (v.length < 3) { err.hidden = false; area.focus(); return; } fin(v, c); } },
      ],
    });
    setTimeout(() => area.focus(), 50);
  });
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

    async function atender(it, btn) {
      const nota = await pedirNota(it.titulo + '. ' + it.texto);
      if (nota == null || !vivo) return;
      await conBoton(btn, async () => {
        await alertasHacienda.atender(it.id, nota);
        toast('Anotado: usted atendió esta alerta.');
        app.alertas?.refrescar?.();
        document.dispatchEvent(new CustomEvent('app:alertas-hacienda-cambio'));
        await cargar();
      });
    }

    function tarjeta(it) {
      const quien = it.atendida_en ? h('p.ah-quien', h('b', 'Atendida por ' + (it.atendida_por || 'un administrador')), ' · ' + hora(it.atendida_en) + (it.nota ? '. Nota: ' + it.nota : ''))
        : it.cerrada_en ? h('p.ah-quien', 'Se resolvió sola · ' + hora(it.cerrada_en)) : null;
      const destino = IR[it.destino];
      const botones = estado === 'abiertas' ? h('div.ah-botones',
        h('button.btn.primario', { type: 'button', onclick: (e) => atender(it, e.currentTarget) }, 'Ya lo atendí'),
        destino ? h('button.btn', { type: 'button', onclick: () => destino.ir(app) }, destino.texto) : null) : null;
      return h('li.ah-item.' + (it.cerrada_en ? 'atendida' : it.severidad),
        h('div.ah-fila', h('span.chip.' + (it.severidad === 'urgente' ? 'mal' : 'espera'), it.severidad === 'urgente' ? 'Urgente' : 'Importante'), it.es_prueba ? h('span.chip', 'Prueba') : null,
          h('span.ah-sub', it.empresa + ' · ' + haceCuanto(it.creada_en) + ' · ' + hora(it.creada_en))),
        h('p.ah-t', it.titulo),
        h('p.ah-m', it.texto),
        estado === 'abiertas' && it.que_hacer ? h('p.ah-hacer', h('b', 'Qué hacer: '), it.que_hacer) : null,
        entregas(it.entregas),
        quien, botones);
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
