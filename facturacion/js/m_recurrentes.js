// Pedidos fijos (Administración, solo administradores): clientes que piden lo mismo cada semana, cada quince días o cada mes.
// El sistema NUNCA emite solo. Cuando toca, deja un BORRADOR; el administrador lo confirma (se abre una cuenta en Caja con lo de siempre) o lo descarta, y el cobro y la factura se hacen en Caja como cualquier venta.
// Lee fx_recurrentes; escribe con fx_recurrente_guardar, fx_recurrente_activar, fx_recurrente_generar, fx_recurrente_confirmar y fx_recurrente_descartar.
import { h, esqueleto, bloqueError, textoDeError, confirmar, conBoton, toast, modal, money, fechaCorta, TIPOS_SERVICIO, pedir } from './util.js';
import { cargarHoja } from './ui_hojas.js';
import { api } from './api.js';
import { recurrentes } from './api_cotizaciones.js';
import { editorLineas, buscadorCliente, DIAS, num3 } from './cot_comun.js';

const lista = (x) => (Array.isArray(x) ? x : []);
const FREC = { semanal: 'Cada semana', quincenal: 'Cada quince días', mensual: 'Cada mes' };
export const cuando = (p) => (p.frecuencia === 'semanal' ? 'Cada ' + DIAS[p.dia_semana] : p.frecuencia === 'mensual' ? 'El día ' + p.dia_mes + ' de cada mes' : 'Cada quince días (días 1 y 15)');
const fecha = (f) => fechaCorta(String(f).slice(0, 10) + 'T12:00:00');

export default {
  id: 'recurrentes',
  titulo: 'Pedidos fijos',
  async mount(root, app) {
    await cargarHoja('cotizaciones.css');
    if (!app.admin) {
      root.append(h('div.vacio', h('p', 'Esta pantalla es solo para administradores.'), h('button.btn', { type: 'button', onclick: () => app.ir('inicio') }, 'Volver al inicio')));
      return;
    }
    let vivo = true, nCarga = 0, productos = null;
    const cuerpo = h('div.cot-seccion');

    async function cargar(datos) {
      const mi = ++nCarga;
      if (!datos && (!cuerpo.children.length || cuerpo.querySelector('.bloque-error'))) cuerpo.replaceChildren(esqueleto(3, 'Cargando pedidos fijos…'));
      try {
        const e = datos || await recurrentes.estado(app.socId);
        if (!vivo || mi !== nCarga) return;
        app.recurrentes = { pendientes: Number(e?.pendientes) || 0 };
        pintar(e);
      } catch (er) {
        if (!vivo || mi !== nCarga) return;
        cuerpo.replaceChildren(bloqueError({ titulo: 'No se pudieron cargar los pedidos fijos', mensaje: textoDeError(er), alReintentar: () => cargar() }));
      }
    }
    const resumen = (ls) => lista(ls).map((l) => num3(l.cantidad) + ' × ' + l.producto).join(', ');
    function pintar(e) {
      const bor = lista(e.borradores), pend = bor.filter((b) => b.estado === 'pendiente'), hechos = bor.filter((b) => b.estado !== 'pendiente');
      const pl = lista(e.plantillas);
      cuerpo.replaceChildren(...[
        h('section.cot-seccion', h('h2', 'Por confirmar' + (pend.length ? ' (' + pend.length + ')' : '')),
          pend.length ? h('ul.cot-lista', pend.map(borrador)) : h('p.cot-vacio', 'No hay pedidos esperando. Cuando a un pedido fijo le toque, aparece aquí para que usted lo confirme.')),
        h('section.cot-seccion', h('h2', 'Pedidos fijos'),
          pl.length ? h('ul.cot-lista', pl.map(plantilla)) : h('p.cot-vacio', 'Todavía no hay pedidos fijos. Toque «Nuevo pedido fijo» para crear el primero.')),
        hechos.length ? h('details', h('summary', 'Últimos 30 días (' + hechos.length + ')'), h('ul.cot-lista', hechos.map((b) => h('li.cot-item', h('div.cot-item-datos', h('div.cot-item-t', b.nombre, h('span.chip.' + (b.estado === 'confirmado' ? 'ok' : 'gris'), b.estado === 'confirmado' ? 'Confirmado' : 'Descartado')),
          h('div.cot-item-s', b.cliente_nombre + ' · para el ' + fecha(b.fecha_para) + (b.venta_numero ? ' · cuenta N° ' + b.venta_numero : '') + (b.motivo ? ' · ' + b.motivo : ''))), h('div.cot-monto', money(b.total)))))) : null].filter(Boolean));
    }
    function borrador(b) {
      return h('li.cot-item.rec-bor', h('div.cot-item-datos', h('div.cot-item-t', b.nombre, h('span.chip.espera', 'Por confirmar')),
        h('div.cot-item-s', b.cliente_nombre + ' · para el ' + fecha(b.fecha_para)), h('div.cot-item-s', resumen(b.lineas))),
        h('div.cot-monto', money(b.total)),
        h('div.cot-btns', h('button.btn.primario', { type: 'button', onclick: (ev) => conBoton(ev.currentTarget, () => confirmarBorrador(b)) }, 'Confirmar y abrir cuenta'),
          h('button.btn', { type: 'button', onclick: (ev) => conBoton(ev.currentTarget, () => descartar(b)) }, 'Descartar')));
    }
    async function confirmarBorrador(b) {
      if (!app.turno?.id) { toast('Para abrir la cuenta primero hay que abrir la caja (Apertura y cierre de caja).', 'error', 6000); return; }
      if (!(await confirmar('Se abre una cuenta en Caja para ' + b.cliente_nombre + ' con ' + resumen(b.lineas) + ' (' + money(b.total) + '). No se cobra ni se factura todavía: eso se hace en Caja. ¿Continuar?', { si: 'Sí, abrir la cuenta' }))) return;
      const v = await recurrentes.confirmar(b.id, app.terminal || 1);
      toast('Listo: cuenta N° ' + (v?.venta?.numero ?? '') + ' abierta en Caja para ' + b.cliente_nombre + '.', 'ok', 6000);
      await cargar();
    }
    async function descartar(b) {
      const motivo = await pedir({ titulo: 'Descartar este pedido', etiqueta: 'Motivo (opcional)', nota: 'Por ejemplo: esta semana no pidió.', boton: 'Descartar' });
      if (motivo == null) return;
      await cargar(await recurrentes.descartar(b.id, motivo || null));
      toast('Pedido descartado. El siguiente se genera en su fecha.');
    }
    function plantilla(p) {
      return h('li.cot-item' + (p.activa ? '' : '.apagada'), h('div.cot-item-datos', h('div.cot-item-t', p.nombre, h('span.chip.' + (p.activa ? 'ok' : 'gris'), p.activa ? 'Activo' : 'En pausa')),
        h('div.cot-item-s', p.cliente_nombre + ' · ' + cuando(p) + ' · ' + (TIPOS_SERVICIO[p.tipo_servicio] || '')), h('div.cot-item-s', resumen(p.lineas)),
        h('div.cot-item-s', p.activa ? 'Próximo borrador: ' + fecha(p.proxima_fecha) : 'En pausa: no genera borradores')),
        h('div.cot-monto', money(p.total)),
        h('div.cot-btns', h('button.btn', { type: 'button', onclick: () => formulario(p) }, 'Cambiar'),
          h('button.btn', { type: 'button', onclick: (ev) => conBoton(ev.currentTarget, async () => { await cargar(await recurrentes.activar(p.id, !p.activa)); toast(p.activa ? 'Pedido en pausa.' : 'Pedido activado.'); }) }, p.activa ? 'Pausar' : 'Activar')));
    }
    async function generar(btn) {
      await conBoton(btn, async () => {
        const r = await recurrentes.generar(app.socId);
        toast(r?.nuevos > 0 ? 'Se prepararon ' + r.nuevos + (r.nuevos === 1 ? ' pedido' : ' pedidos') + ' por confirmar.' : 'No había pedidos que prepararle a hoy.', 'ok', 5000);
        await cargar(r?.estado);
      });
    }

    async function formulario(p) {
      if (!productos) {
        try { const cat = await api.catalogo(app.socId); productos = (cat?.productos || []).filter((x) => !x.modificador_nombre).sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es')); }
        catch (e) { toast(textoDeError(e), 'error', 6000); return; }
      }
      const err = h('div.error-caja', { hidden: true, role: 'alert' });
      const mostrar = (m) => { err.textContent = m; err.hidden = !m; if (m) err.scrollIntoView({ block: 'nearest' }); };
      let cli = p ? { id: p.cliente_id, nombre: p.cliente_nombre } : null;
      const buscador = buscadorCliente(app.socId, cli, (x) => { cli = x; });
      const nombre = h('input.campo', { type: 'text', maxlength: 80, autocomplete: 'off', value: p?.nombre || '', placeholder: 'Por ejemplo: Almuerzos de la bananera, martes', 'aria-label': 'Nombre del pedido' });
      const frec = h('select.campo', { 'aria-label': 'Cada cuánto' }, Object.entries(FREC).map(([k, v]) => h('option', { value: k, selected: (p?.frecuencia || 'semanal') === k }, v)));
      const dsem = h('select.campo', { 'aria-label': 'Día de la semana' }, DIAS.map((d, i) => h('option', { value: i, selected: (p?.dia_semana ?? 2) === i }, d.charAt(0).toUpperCase() + d.slice(1))));
      const dmes = h('select.campo', { 'aria-label': 'Día del mes' }, Array.from({ length: 28 }, (_, i) => h('option', { value: i + 1, selected: (p?.dia_mes ?? 1) === i + 1 }, String(i + 1))));
      const filaDia = h('label.etq');
      const pintarDia = () => {
        filaDia.replaceChildren(frec.value === 'semanal' ? 'Día de la semana' : frec.value === 'mensual' ? 'Día del mes (1 a 28)' : 'Se genera los días 1 y 15 de cada mes', frec.value === 'semanal' ? dsem : frec.value === 'mensual' ? dmes : h('span'));
      };
      frec.addEventListener('change', pintarDia); pintarDia();
      const tipo = h('select.campo', { 'aria-label': 'Tipo de cuenta' }, Object.entries(TIPOS_SERVICIO).map(([k, v]) => h('option', { value: k, selected: (p?.tipo_servicio || 'llevar') === k }, v)));
      const notas = h('textarea.campo', { rows: 2, maxlength: 300, 'aria-label': 'Notas' }, p?.notas || '');
      const ed = editorLineas(productos, lista(p?.lineas).map((l) => ({ producto_id: l.producto_id, cantidad: l.cantidad, precio: l.precio, nota: l.nota })));
      modal({
        titulo: p ? 'Cambiar pedido fijo' : 'Nuevo pedido fijo', ancho: 760,
        contenido: h('div.cot-form', err, h('label.etq', 'Nombre', nombre), h('div.etq', 'Cliente', buscador.el),
          h('div.cot-fila2', h('label.etq', 'Cada cuánto', frec), filaDia), h('label.etq', 'Tipo de cuenta', tipo),
          h('div.etq', 'Lo que pide siempre', ed.el), h('label.etq', 'Notas', notas),
          h('p.cot-aviso', 'Cuando le toque, el sistema solo deja un borrador para que usted lo confirme. No cobra ni factura solo.')),
        botones: [{ texto: 'Cancelar', onclick: (c) => c() },
          { texto: p ? 'Guardar cambios' : 'Guardar pedido fijo', clase: 'primario', onclick: async (cerrar) => {
            mostrar('');
            await conBoton(null, async () => {
              let lineas;
              try { lineas = ed.leer(); } catch (e) { mostrar(e.message); return; }
              if (!nombre.value.trim()) { mostrar('Póngale un nombre al pedido.'); return; }
              if (!cli) { mostrar('Elija el cliente.'); return; }
              try {
                const r = await recurrentes.guardar({ id: p?.id || null, sociedad_id: app.socId, nombre: nombre.value.trim(), cliente_id: cli.id, tipo_servicio: tipo.value, frecuencia: frec.value, dia_semana: frec.value === 'semanal' ? Number(dsem.value) : null, dia_mes: frec.value === 'mensual' ? Number(dmes.value) : null, notas: notas.value.trim() || null, lineas });
                cerrar(); toast('Pedido fijo guardado.'); await cargar(r);
              } catch (e) { mostrar(textoDeError(e)); }
            });
          } }],
      });
    }

    root.append(h('div.cot',
      h('div.cot-cab', h('p', 'Clientes que piden lo mismo cada semana o cada mes. El sistema prepara el pedido y usted lo confirma: nada se factura solo.'),
        h('div.cot-btns', h('button.btn', { type: 'button', onclick: (ev) => generar(ev.currentTarget) }, 'Preparar los de hoy'), h('button.btn.primario', { type: 'button', onclick: () => formulario(null) }, 'Nuevo pedido fijo'))),
      cuerpo));
    await cargar();
    return () => { vivo = false; };
  },
};
