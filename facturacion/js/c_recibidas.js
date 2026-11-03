// Contabilidad, pestaña «Recibidas»: las facturas de proveedores que llegan a los correos de contabilidad y su respuesta a Hacienda (aceptar, aceptar parcialmente, rechazar) y el IVA del mes.
// Antes era el módulo «Contable». La pantalla vive en m_recepcion.js y aquí solo se monta dentro de Contabilidad; el pedido de otra pantalla ({ clave, buscar }) lo lee ella misma de app.pedido.
export default {
  id: 'recibidas', texto: 'Recibidas',
  async montar(cont, ctx) {
    const m = (await import('./m_recepcion.js')).default;
    return m.mount(cont, ctx.app);
  },
};
