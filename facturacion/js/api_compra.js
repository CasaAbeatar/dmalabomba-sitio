// Acceso a datos de "Pago sin factura" y la factura electrónica de compra (solo administradores). Todo pasa por funciones fx_* con el rpc() de api.js, que no se toca.
// Ninguna se repite sola si falla la red: fx_compra_registrar y fx_compra_reemitir cambian datos y api.js nunca repite una escritura.
import { rpc } from './api.js';

export const compra = {
  // { envio:'espera'|'activo', ambiente, emisora, salario_base, cuentas:[{id,codigo,nombre}] }
  config: (soc) => rpc('fx_compra_config', { p_soc: soc }),
  // [{ id, nombre, tipo_id, identificacion, clase, correo, telefono, ... }]
  proveedores: (soc, q = null) => rpc('fx_compra_proveedores', { p_soc: soc, p_q: q || null }),
  // { proveedor, aviso }
  proveedorGuardar: (p) => rpc('fx_compra_proveedor_guardar', { p }),
  // { pago_id, numero, comprobante_id, consecutivo, total, avisos:[{codigo,texto}], asiento_id, asiento_error, salida_hacienda:'en_espera'|'en_cola' }
  registrar: (p) => rpc('fx_compra_registrar', { p }),
  // [{ id, numero_texto, fecha_compra, concepto, total, medio, proveedor, estado, mensaje, en_espera, consecutivo, comprobante_id, intentos_fec, provisional, ... }]
  pagos: (soc, limite = 60) => rpc('fx_compra_pagos', { p_soc: soc, p_limite: limite }),
  // [{ id, nombre, tipo, datos }]  (datos = imagen en base64)
  fotos: (pago) => rpc('fx_compra_foto', { p_pago: pago }),
  // { comprobante_id, consecutivo, salida_hacienda }
  reemitir: (pago) => rpc('fx_compra_reemitir', { p_pago: pago }),
  cabys: (q) => rpc('fx_cabys_buscar', { p_q: q }),
};

// IVA según el caso que escoge la persona (los mismos nombres que fact.compra_iva_caso en la base)
export const CASOS_IVA = [
  ['sin_iva', 'Sin IVA (quien vende no cobra impuesto)', 0],
  ['exento', 'Exento por ley', 0],
  ['canasta_1', 'Canasta básica, 1 %', 1],
  ['reducida_2', 'Tarifa reducida, 2 %', 2],
  ['reducida_4', 'Tarifa reducida, 4 %', 4],
  ['reducida_05', 'Tarifa reducida, 0,5 %', 0.5],
  ['general', 'Tarifa general, 13 %', 13],
];
export const CLASES = { ocasional: 'Ocasional', habitual: 'Habitual', agropecuario_rea: 'Agricultor inscrito en el REA' };
export const MEDIOS_PAGO = [['efectivo', 'Efectivo'], ['sinpe', 'SINPE Móvil'], ['transferencia', 'Transferencia'], ['tarjeta', 'Tarjeta'], ['cheque', 'Cheque'], ['otros', 'Otro']];
export const AVISO_HABITUAL = 'Proveedor habitual: la contadora decide si se le exige inscribirse como contribuyente y facturar. Mientras tanto, la compra queda respaldada con la factura de compra.';

// Cómo se lee el estado de la factura de compra de un pago
export function estadoPago(p) {
  if (!p?.estado) return { texto: 'Sin factura de compra', tipo: 'mal' };
  if (p.estado === 'aceptado') return { texto: 'Aceptada por Hacienda', tipo: 'ok' };
  if (p.estado === 'rechazado') return { texto: 'Rechazada por Hacienda', tipo: 'mal' };
  if (p.estado === 'error') return { texto: 'No se pudo enviar', tipo: 'mal' };
  if (p.en_espera) return { texto: 'Lista, en espera de salir a Hacienda', tipo: 'espera' };
  return { texto: 'Enviada, esperando a Hacienda', tipo: 'espera' };
}

// Reduce la foto antes de guardarla: lado mayor 1280 px, JPEG 0.72. Devuelve { nombre, tipo, datos } con datos en base64 (sin el prefijo).
export function reducirFoto(archivo) {
  return new Promise((ok, mal) => {
    if (!archivo || !/^image\//.test(archivo.type)) return mal(new Error('Escoja una foto o una captura de pantalla (imagen).'));
    const url = URL.createObjectURL(archivo), img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1280 / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      const datos = c.toDataURL('image/jpeg', 0.72).split(',')[1] || '';
      if (datos.length > 2700000) return mal(new Error('La foto es demasiado grande. Tome otra más cerca o con menos detalle.'));
      ok({ nombre: String(archivo.name || 'foto').slice(0, 100), tipo: 'image/jpeg', datos });
    };
    img.onerror = () => { URL.revokeObjectURL(url); mal(new Error('No se pudo leer la foto. Pruebe con otra.')); };
    img.src = url;
  });
}
