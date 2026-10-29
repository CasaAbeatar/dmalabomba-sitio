// Clientes: base de datos de receptores para las facturas electrónicas (por local).
import { h, debounce, TIPOS_ID } from './util.js';
import { api } from './api.js';
import { abrirFormCliente } from './ui_cliente.js';
import { cargarCss, diaCR } from './ui_mant.js';

export default {
  id: 'clientes',
  titulo: 'Clientes',
  async mount(root, app) {
    await cargarCss();
    const soc = app.soc;
    const q = h('input.mt-buscar', { type: 'search', placeholder: 'Buscar por nombre, cédula, correo o teléfono', autocomplete: 'off', 'aria-label': 'Buscar cliente' });
    const lista = h('div');
    const resumen = h('p.mt-nota');
    let n = 0;

    const tarjeta = (c) => h('div.mt-item',
      h('div.mt-datos',
        h('span.mt-nombre', c.nombre),
        c.nombre_comercial ? h('span.mt-sub', c.nombre_comercial) : null,
        h('span.mt-sub', (TIPOS_ID[c.tipo_id] || 'Identificación') + ': ', h('span.mt-codigo', c.identificacion), ' ',
          c.verificado ? h('span.chip.ok', 'Verificado en Hacienda') : h('span.chip.espera', { title: c.verificacion_motivo || 'Todavía no se ha confirmado en Hacienda. Ábralo para verificarlo.' }, 'Sin verificar')),
        c.actividad_codigo ? h('span.mt-sub', 'Actividad económica: ', h('span.mt-codigo', c.actividad_codigo)) : null,
        c.correo ? h('span.mt-sub', 'Correo: ' + c.correo) : h('span.mt-sub', h('span.chip', 'Sin correo')),
        c.telefono ? h('span.mt-sub', 'Teléfono: ' + c.telefono) : null),
      h('div.mt-btns', h('button.btn', { type: 'button', onclick: () => abrir(c) }, 'Ver o editar')));

    const abrir = (c) => abrirFormCliente(app, c, { alGuardar: () => cargar() });

    async function cargar() {
      const mi = ++n;
      const texto = q.value.trim();
      try {
        const r = await api.clientes(soc.id, texto);
        if (mi !== n) return;
        const hoy = diaCR(new Date());
        const nuevosHoy = !texto ? r.filter((c) => c.creado_en && diaCR(c.creado_en) === hoy) : [];
        const resto = r.filter((c) => !nuevosHoy.includes(c));
        const partes = [];
        if (nuevosHoy.length) partes.push(h('div.mt-seccion', 'Agregados hoy (' + nuevosHoy.length + ')'), h('div.mt-lista', nuevosHoy.map(tarjeta)));
        if (nuevosHoy.length && resto.length) partes.push(h('div.mt-seccion', 'Los demás clientes, por nombre'));
        if (resto.length || !nuevosHoy.length) partes.push(resto.length ? h('div.mt-lista', resto.map(tarjeta)) : h('div.vacio', texto ? 'No se encontró ningún cliente con "' + texto + '". Puede agregarlo con el botón "Agregar cliente".' : 'Todavía no hay clientes en este local. Toque "Agregar cliente" para guardar el primero.'));
        lista.replaceChildren(...partes);
        resumen.textContent = r.length >= 60 ? 'Se muestran los primeros 60. Escriba en el buscador para encontrar a los demás.' : (r.length ? r.length + (r.length === 1 ? ' cliente' : ' clientes') + (texto ? ' encontrados.' : ' en total.') : '');
      } catch (e) { if (mi === n) lista.replaceChildren(h('div.error-caja', e.message || 'No se pudo cargar la lista.')); }
    }

    q.addEventListener('input', debounce(cargar, 250));
    root.append(
      h('div.mt-cab',
        h('div', h('h1', 'Clientes de ' + (soc.nombre_comercial || soc.nombre)), h('p', 'Los clientes guardados aquí se pueden elegir al cobrar para emitir una factura electrónica a su nombre. Cada local tiene su propia lista.')),
        h('div.mt-acciones', h('button.btn.primario.grande', { type: 'button', onclick: () => abrirFormCliente(app, null, { alGuardar: () => cargar() }) }, 'Agregar cliente'))),
      q, resumen, lista);
    await cargar();
    if (!document.querySelector('.modal-fondo')) q.focus({ preventScroll: true }); // no le quita el foco a un formulario que ya se abrió
  },
};
