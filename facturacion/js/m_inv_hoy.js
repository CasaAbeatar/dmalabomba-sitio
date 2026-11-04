// Avisos de HOY del inventario: lo vencido, lo que vence pronto y lo que está bajo el mínimo. Cada aviso se atiende como en Contable («Ya lo atendí»,
// fx_inv_alerta_atender): una alerta de vencimiento atendida no vuelve; una de mínimo vuelve cuando entra mercadería y sigue bajo el mínimo.
import { h, money, fechaHora, num } from './util.js';
import { inv } from './api_inventarios.js';
import { ventana, dialogo, cargando, falla, vacio, aviso, cantTxt, venceTxt, claseVence, dma, plural, diaLargo, accionSegura, enfocar, toastOk, poner } from './m_inv_comun.js';

export async function abrir(ctx, _id, pedido = {}) {
  const cuerpo = h('div.inv-hoy-detalle', cargando('Cargando los avisos de hoy…'));
  let vivo = true;
  const alCambio = () => { if (vivo) cargar(false); };
  document.addEventListener('inv:cambio', alCambio);
  ventana({ titulo: 'Avisos de hoy', contenido: cuerpo, alCerrar: () => { vivo = false; document.removeEventListener('inv:cambio', alCambio); } });

  async function cargar(primera = true) {
    let a;
    try { a = await inv.alertas(); } catch (e) { poner(cuerpo, falla(e, () => { poner(cuerpo, cargando()); cargar(); })); return; }
    if (!vivo) return;
    pintar(a);
    if (primera) {
      const sec = pedido.foco && cuerpo.querySelector('[data-grupo="' + pedido.foco + '"]');
      if (sec) { sec.scrollIntoView({ block: 'start' }); sec.querySelector('h3')?.focus({ preventScroll: true }); } else enfocar(cuerpo);
    }
  }

  // «Ya lo atendí» con una nota opcional. No lleva clave de repetición: atender dos veces la misma alerta no hace nada nuevo (ya_atendida).
  function atender(al, { titulo, texto, ayuda }) {
    const nota = h('textarea.campo', { rows: 2, maxlength: 300, 'aria-label': 'Nota (opcional)', placeholder: ayuda });
    const zona = h('div');
    const ok = h('button.btn.primario', { type: 'button' }, 'Sí, ya lo atendí');
    const acc = accionSegura({ boton: ok, zona, ocupado: 'Guardando…',
      hacer: () => inv.alertaAtender(al.tipo, String(al.referencia), String(al.estado_clave), nota.value.trim() || null),
      alTerminar: (r) => { d.cerrar(); toastOk(r?.ya_atendida ? 'Ese aviso ya estaba atendido' + (r.atendido_por_nombre ? ' por ' + r.atendido_por_nombre : '') + '.' : 'Listo: el aviso quedó atendido.'); } });
    ok.addEventListener('click', () => acc.ejecutar());
    const d = dialogo({ titulo, ancho: 520, contenido: [h('p', texto), h('label.etq', 'Nota (opcional)', nota, h('small', 'Queda guardada con su nombre y la hora.')), zona],
      botones: [{ texto: 'No, volver', onclick: (c) => c() }] });
    d.el.querySelector('.modal-pie').append(ok);
  }

  // Factura que la empresa rechazó (o aceptó solo en parte) y cuya mercadería ya estaba recibida en la bodega: el mensaje ya salió a Hacienda, pero la bodega sigue con esas existencias.
  // «Ya lo atendí» pide una nota (queda con su nombre). Si se deshace la recepción, el aviso se cierra solo.
  function atenderRechazo(al) {
    const nota = h('textarea.campo', { rows: 2, maxlength: 300, 'aria-label': 'Nota obligatoria', placeholder: 'Por ejemplo: el proveedor sí entregó y la factura se corrige con una nota de crédito' });
    const zona = h('div');
    const ok = h('button.btn.primario', { type: 'button' }, 'Sí, ya lo atendí');
    const acc = accionSegura({ boton: ok, zona, ocupado: 'Guardando…',
      hacer: () => inv.receptorAtender(al.id, nota.value.trim()),
      alTerminar: () => { d.cerrar(); toastOk('Listo: el aviso quedó atendido.'); document.dispatchEvent(new CustomEvent('app:alertas')); } });
    ok.addEventListener('click', () => {
      if (nota.value.trim().length < 3) { poner(zona, h('p.error-caja', { role: 'alert' }, 'Escriba una nota corta (al menos 3 letras) para dejar constancia.')); nota.focus(); return; }
      acc.ejecutar();
    });
    const d = dialogo({ titulo: 'Ya lo atendí', ancho: 520,
      contenido: [h('p', 'Si la mercadería sí se queda en la bodega, escriba por qué. Si hay que sacarla, mejor deshaga la recepción: el aviso se apaga solo.'),
        h('label.etq', 'Nota (obligatoria)', nota, h('small', 'Queda guardada con su nombre y la hora.')), zona],
      botones: [{ texto: 'No, volver', onclick: (c) => c() }] });
    d.el.querySelector('.modal-pie').append(ok);
  }
  function filaRechazo(al) {
    const parcial = String(al.estado_mensaje) === '2', ls = al.lineas || [];
    const lineas = ls.slice(0, 6).map((l) => h('li', h('span', l.descripcion || l.articulo || 'Línea ' + l.linea), h('span.cifra', (num(l.cantidad_factura, 2) + ' ' + (l.unidad_factura || '')).trim() + (l.ubicacion ? ' · ' + l.ubicacion : ''))));
    if (ls.length > 6) lineas.push(h('li.tenue', 'y ' + plural(ls.length - 6, 'línea más', 'líneas más')));
    return h('li.inv-al.inv-al-rech', { 'data-tipo': 'rechazo_con_bodega' },
      h('div.inv-al-dato',
        h('strong.inv-al-art', al.proveedor || 'Proveedor sin nombre'),
        h('span.inv-al-texto', al.texto),
        h('span.inv-al-sub.inv-al-clave', 'Factura ' + al.clave),
        h('span.inv-al-sub', plural(ls.length, 'línea sigue', 'líneas siguen') + ' recibida' + (ls.length === 1 ? '' : 's') + ' en la bodega:'),
        h('ul.inv-al-lineas', lineas)),
      h('span.chip.mal', parcial ? 'Aceptada solo en parte' : 'Rechazada'),
      h('div.inv-al-btns',
        h('button.btn.primario', { type: 'button', onclick: async () => (await import('./m_inv_recibir.js')).abrirFactura(ctx, al.clave) }, 'Abrir la factura y deshacer la recepción'),
        h('button.btn', { type: 'button', onclick: () => atenderRechazo(al) }, 'Ya lo atendí')));
  }

  function fila(al, partes) {
    return h('li.inv-al', { 'data-tipo': al.tipo },
      h('div.inv-al-dato',
        h('strong.inv-al-art', al.articulo),
        h('span.inv-al-sub', al.ubicacion + ' · ' + partes.cantidad),
        partes.extra ? h('span.inv-al-sub', partes.extra) : null),
      partes.chip,
      h('div.inv-al-btns', partes.botones));
  }

  function pintar(a) {
    const dias = Number(a.dias_aviso ?? 2);
    const vencidos = a.vencidos || [], pronto = a.vencen_pronto || [], bajo = a.bajo_minimo || [], rechazos = a.rechazos_con_bodega || [];
    const grupo = (id, titulo, explica, items, clase) => h('section.inv-grupo' + (clase ? '.' + clase : ''), { 'data-grupo': id },
      h('h3', { tabindex: -1 }, titulo, h('span.inv-cuenta', String(items.length))), h('p.tenue.inv-chico', explica),
      items.length ? h('ul.inv-al-lista', items) : vacio(id === 'vencidos' ? 'No hay nada vencido.' : id === 'pronto' ? 'Nada vence en estos días.' : 'Todo está sobre su mínimo.'));
    const sacar = (al) => h('button.btn', { type: 'button', onclick: () => ctx.abrir('salidas', { tipo: 'merma', ubicacion: al.ubicacion_id, articulo: al.articulo_id, lote: al.lote_id, cantidad: al.cantidad, motivo: 'Se venció' }) }, 'Sacar como merma');

    const lVencidos = vencidos.map((al) => fila(al, {
      cantidad: cantTxt(al.cantidad, al.unidad) + ' · ' + money(al.valor) + ' sin IVA',
      extra: 'Venció el ' + dma(al.vence_en),
      chip: al.salio_hoy ? h('span.chip.mal', 'Ya salió del sistema hoy: bótelo') : h('span.chip.mal', 'Todavía cuenta en el inventario'),
      botones: al.salio_hoy
        ? [h('button.btn.primario', { type: 'button', onclick: () => atender(al, { titulo: 'Ya lo boté', texto: `¿Ya se botó «${al.articulo}» de ${al.ubicacion}? El sistema ya lo sacó solo esta mañana; esto solo apaga el aviso.`, ayuda: 'Por ejemplo: se botó a las 7 de la mañana' }) }, 'Ya lo boté')]
        : [sacar(al), h('button.btn', { type: 'button', onclick: () => atender(al, { titulo: 'Ya lo atendí', texto: `¿Apagar el aviso de «${al.articulo}» en ${al.ubicacion}? Si se botó, sáquelo primero como merma para que el inventario quede bien.`, ayuda: 'Por ejemplo: se revisó y todavía sirve' }) }, 'Ya lo atendí')],
    }));
    const lPronto = pronto.map((al) => fila(al, {
      cantidad: cantTxt(al.cantidad, al.unidad) + ' · ' + money(al.valor) + ' sin IVA',
      extra: 'Fecha de vencimiento: ' + dma(al.vence_en),
      chip: h('span.chip.' + (claseVence(al.dias_para_vencer, dias) || 'espera'), venceTxt(al.dias_para_vencer, al.vence_en)),
      botones: [h('button.btn', { type: 'button', onclick: () => atender(al, { titulo: 'Ya lo atendí', texto: `¿Apagar el aviso de «${al.articulo}» en ${al.ubicacion}? El aviso no vuelve para este lote.`, ayuda: 'Por ejemplo: se va a usar hoy en el almuerzo' }) }, 'Ya lo atendí')],
    }));
    const lBajo = bajo.map((al) => fila(al, {
      cantidad: 'Hay ' + cantTxt(al.existencia, al.unidad) + ' y el mínimo es ' + cantTxt(al.minimo, al.unidad),
      extra: 'Faltan ' + cantTxt(al.faltante, al.unidad) + ' para llegar al mínimo',
      chip: h('span.chip.espera', 'Bajo el mínimo'),
      botones: [h('button.btn', { type: 'button', onclick: () => atender(al, { titulo: 'Ya lo atendí', texto: `¿Apagar el aviso de «${al.articulo}» en ${al.ubicacion}? Vuelve a salir si entra mercadería y sigue bajo el mínimo.`, ayuda: 'Por ejemplo: ya se le pidió al proveedor' }) }, 'Ya lo atendí')],
    }));
    const conteos = a.conteos_abiertos || [];
    poner(cuerpo, 
      h('div.inv-ventana-cab', h('div', h('span.hoy-et', 'Hoy'), h('h2', diaLargo(a.hoy))), h('p.tenue', 'Lo más urgente va primero. Los valores son al costo, sin IVA.')),
      rechazos.length ? grupo('rechazos', 'Facturas rechazadas con mercadería en bodega', 'El mensaje ya salió a Hacienda, pero la mercadería de estas facturas sigue contada en la bodega. Deshaga la recepción para que las existencias queden respaldadas.', rechazos.map(filaRechazo), 'urgente') : null,
      grupo('vencidos', 'Vencidos', 'Lo que salió hoy del sistema por vencimiento (hay que botarlo) y lo vencido que todavía cuenta en el inventario.', lVencidos, vencidos.length ? 'urgente' : ''),
      grupo('pronto', dias === 0 ? 'Vencen hoy' : `Vencen hoy o en los próximos ${dias === 1 ? 'día' : dias + ' días'}`, 'Un lote se puede usar hasta el final del día de su vencimiento. Use primero lo que vence primero.', lPronto),
      grupo('minimo', 'Bajo el mínimo', 'Artículos con menos existencia que el mínimo de esa bodega o local.', lBajo),
      h('section.inv-grupo', { 'data-grupo': 'otros' }, h('h3', { tabindex: -1 }, 'También pendiente'),
        h('div.inv-hoy-extras',
          h('button.btn', { type: 'button', onclick: () => ctx.abrir('recibir') }, a.por_recibir ? plural(a.por_recibir, 'línea por recibir', 'líneas por recibir') + ' en ' + plural(a.facturas_por_recibir || 0, 'factura', 'facturas') : 'Por recibir: nada pendiente'),
          h('button.btn', { type: 'button', onclick: () => ctx.abrir('notas') }, a.notas_por_revisar ? plural(a.notas_por_revisar, 'nota de proveedor por revisar', 'notas de proveedor por revisar') : 'Notas de proveedor: nada por revisar'),
          conteos.map((c) => h('button.btn', { type: 'button', onclick: () => ctx.abrir('conteo', { conteo: c.id }) }, 'Conteo abierto en ' + c.ubicacion + ' desde ' + fechaHora(c.iniciado_en))))),
      vencidos.length || pronto.length || bajo.length || rechazos.length ? null : aviso('ok', h('p', 'Hoy no hay avisos de vencimiento ni de mínimos.')));
  }
  await cargar();
}
