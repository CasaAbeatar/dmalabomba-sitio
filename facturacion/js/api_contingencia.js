// Venta de contingencia con talonario provisional (solo administradores). La cuenta y sus líneas se arman con las funciones de siempre
// (así el IVA y los precios los calcula el mismo código de la caja) y se cobra con fx_cobrar_contingencia, que guarda la fecha y hora del provisional.
import { rpc } from './api.js';
export { fechaProvisionalISO, numeroProvisionalValido } from './contingencia_texto.js';
export const contingencia = {
  lista: (soc, limite = 15) => rpc('fx_contingencias', { p_soc: soc, p_limite: limite }),
  registrar: (venta, pagos, numero, fecha, cliente = null, terminal = 1) =>
    rpc('fx_cobrar_contingencia', { p_venta: venta, p_pagos: pagos, p_numero: numero, p_fecha: fecha, p_cliente: cliente, p_terminal: terminal }),
};
