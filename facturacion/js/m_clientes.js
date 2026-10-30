// Clientes: base de datos de receptores para las facturas electrónicas (por local).
import { h, debounce, TIPOS_ID, nombreLocal, nombrePropio, bloqueError } from './util.js';
import { api } from './api.js';
import { clientesTodos, clienteActivar } from './api_clientes.js';
import { toast, confirmar } from './util.js';
import { abrirFormCliente, resumenDireccion } from './ui_cliente.js';
import { estadoDireccion } from './direccion_cliente.js';
import { tarifaHabitual } from './iva.js';
import { infoActividad } from './actividades.js';
import { cargarCss, diaCR, conBotonM, mensajeSeguro } from './ui_mant.js';

export default {
  id: 'clientes',
  titulo: 'Clientes',
  async mount(root, app) {
    await cargarCss();
    const soc = app.soc;
    const q = h('input.mt-buscar', { type: 'search', placeholder: 'Nombre, cédula, correo o teléfono', autocomplete: 'off', 'aria-label': 'Buscar cliente' });
    const lista = h('div');
    const resumen = h('p.mt-nota');
    let n = 0;
    // Los clientes desactivados no aparecen al buscar cliente para facturar; aquí se pueden ver y volver a activar
    const verDesactivados = h('input', { type: 'checkbox', id: 'ver-desactivados', onchange: () => cargar() });
    const casilla = h('label.mt-casilla', { for: 'ver-desactivados' }, verDesactivados, h('span', 'Mostrar también los clientes desactivados'));

    const tarjeta = (c) => h('div.mt-item' + (c.activo === false ? '.apagado' : ''),
      h('div.mt-datos',
        h('span.mt-nombre', nombrePropio(c.nombre), c.activo === false ? h('span.chip', { style: 'margin-left:.5rem' }, 'Desactivado') : null),
        c.activo === false ? h('span.mt-sub', 'No aparece al buscar cliente para facturar.') : null,
        c.nombre_comercial ? h('span.mt-sub', nombrePropio(c.nombre_comercial)) : null,
        h('span.mt-sub', (TIPOS_ID[c.tipo_id] || 'Identificación') + ': ', h('span.mt-codigo', c.identificacion || ''), ' ',
          c.verificado ? h('span.chip.ok', 'Verificado en Hacienda') : h('span.chip.espera', { title: c.verificacion_motivo || 'Todavía no se ha confirmado en Hacienda. Ábralo para verificarlo.' }, 'Sin verificar')),
        c.actividad_codigo ? h('span.mt-sub', 'Actividad económica: ' + infoActividad(c.actividad_codigo, c.actividades).nombre + ' ', h('span.mt-codigo', '(' + c.actividad_codigo + ')')) : null,
        tarifaHabitual(c) ? h('span.mt-sub', 'Tarifa de IVA habitual: ', h('span.chip.espera', tarifaHabitual(c).texto)) : null,
        c.correo ? h('span.mt-sub', 'Correo: ' + c.correo) : h('span.mt-sub', h('span.chip', 'Sin correo')),
        c.telefono ? h('span.mt-sub', 'Teléfono: ' + c.telefono) : null,
        // Dirección: sin ningún dato -> aviso suave; con algunos datos -> «Dirección incompleta» y cada dato con su rótulo («Sin dato» donde falta). Nada de esto impide facturar.
        // La marca sale de estadoDireccion (la misma función del formulario), no de las llaves falta_direccion / direccion_incompleta de la base,
        // que no miran el largo de las señas ni el catálogo: así la lista y el formulario dicen siempre lo mismo.
        ((est) => est === 'sin' ? h('span.mt-sub', h('span.chip.suave', 'Sin dirección'), ' No hace falta para facturar; se puede agregar al abrir el cliente.')
          : est === 'parcial' ? h('span.mt-sub', h('span.chip.suave', 'Dirección incompleta'), ' No hace falta para facturar.', resumenDireccion(c, { compacto: true }))
          : null)(estadoDireccion(c))),
      h('div.mt-btns', h('button.btn', { type: 'button', onclick: () => abrir(c) }, 'Ver o editar'),
        (() => { const b = h('button.btn' + (c.activo === false ? '.primario' : ''), { type: 'button', onclick: () => conBotonM(b, async () => { if (c.activo !== false && !(await confirmar('¿Desactivar a «' + nombrePropio(c.nombre) + '»? Ya no aparecerá al buscar cliente para facturar. Sus facturas anteriores no cambian y se puede activar de nuevo.', { si: 'Sí, desactivar', no: 'No, volver', peligro: true }))) return; await clienteActivar(c.id, c.activo === false); toast(c.activo === false ? 'Cliente activado. Ya aparece al buscar cliente.' : 'Cliente desactivado. Ya no aparece al buscar cliente.'); await cargar(); }) }, c.activo === false ? 'Activar' : 'Desactivar'); return b; })()));

    const abrir = (c) => abrirFormCliente(app, c, { alGuardar: () => cargar(), alCambiarEstado: () => cargar() });

    async function cargar() {
      const mi = ++n;
      const texto = q.value.trim();
      try {
        const r = verDesactivados.checked ? await clientesTodos(soc.id, texto) : await api.clientes(soc.id, texto);
        if (mi !== n) return;
        const hoy = diaCR(new Date());
        const nuevosHoy = !texto ? r.filter((c) => c.creado_en && diaCR(c.creado_en) === hoy) : [];
        const resto = r.filter((c) => !nuevosHoy.includes(c));
        const partes = [];
        if (nuevosHoy.length) partes.push(h('div.mt-seccion', 'Agregados hoy (' + nuevosHoy.length + ')'), h('div.mt-lista', nuevosHoy.map(tarjeta)));
        if (nuevosHoy.length && resto.length) partes.push(h('div.mt-seccion', 'Los demás clientes, por nombre'));
        if (resto.length || !nuevosHoy.length) partes.push(resto.length ? h('div.mt-lista', resto.map(tarjeta)) : h('div.vacio', texto ? 'No se encontró ningún cliente con «' + texto + '». Puede agregarlo con el botón «Agregar cliente».' : 'Todavía no hay clientes en este local. Toque «Agregar cliente» para guardar el primero.'));
        lista.replaceChildren(...partes);
        resumen.textContent = r.length >= 60 ? 'Se muestran los primeros 60. Escriba en el buscador para encontrar a los demás.' : (r.length ? r.length + (r.length === 1 ? ' cliente' : ' clientes') + (texto ? ' encontrados.' : ' en total.') : '');
      } catch (e) {
        if (mi !== n) return;
        resumen.textContent = '';
        lista.replaceChildren(bloqueError({ titulo: 'No se pudo cargar la lista de clientes', mensaje: mensajeSeguro(e, 'Revise la conexión e intente de nuevo.'), alReintentar: () => cargar() }));
      }
    }

    q.addEventListener('input', debounce(cargar, 250));
    root.append(
      h('div.mt-cab',
        h('div', h('h1', 'Clientes de ' + nombreLocal(soc)), h('p', 'Los clientes guardados aquí se pueden elegir al cobrar para emitir una factura electrónica a su nombre. Cada local tiene su propia lista.')),
        h('div.mt-acciones', h('button.btn.primario.grande', { type: 'button', onclick: () => { const d = q.value.replace(/\D/g, ''); abrirFormCliente(app, null, { numeroInicial: d.length >= 9 ? d : '', alGuardar: () => cargar() }); } }, 'Agregar cliente'))),
      q, casilla, resumen, lista);
    await cargar();
    if (!document.querySelector('.modal-fondo')) q.focus({ preventScroll: true }); // no le quita el foco a un formulario que ya se abrió
  },
};
