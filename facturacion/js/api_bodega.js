// Datos de la pantalla Bodega. Todo pasa por las funciones fx_bodega_* (sql 70); la base revisa el rol en cada una (administrador, conteo o lectura).
// Lecturas: se repiten UNA vez si falló la red. Escrituras: nunca se repiten solas; llevan su clave de repetición (accionSegura en m_inv_comun.js).
import { rpc, ErrorApi, esTransitorio } from './api.js';
import { faltaFuncion, MSG_SIN_ACTIVAR } from './api_inventarios.js';

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
async function llamar(nombre, args, repetir) {
  for (let intento = 1; ; intento++) {
    try { return await rpc(nombre, args); }
    catch (e) {
      if (faltaFuncion(e)) throw new ErrorApi(MSG_SIN_ACTIVAR, { tipo: 'negocio', estado: 404, codigo: e.codigo });
      if (repetir && intento < 2 && esTransitorio(e)) { await pausa(700); continue; }
      throw e;
    }
  }
}
export const bodega = {
  tablero: () => llamar('fx_bodega_tablero', {}, true),
  personas: () => llamar('fx_bodega_personas', {}, true),
  parametrosGuardar: (p) => llamar('fx_bodega_parametros_guardar', { p }, false),
  conteoGuardar: (ubicacion, items, nota, aplicar, motivo, idem) => llamar('fx_bodega_conteo_guardar', { p_ubicacion: ubicacion, p_items: items, p_nota: nota || null, p_aplicar: !!aplicar, p_motivo: motivo || null, p_idem: idem }, false),
  conteoAplicar: (ids, motivo, idem) => llamar('fx_bodega_conteo_aplicar', { p_ids: ids, p_motivo: motivo, p_idem: idem }, false),
  conteoDescartar: (ids, motivo) => llamar('fx_bodega_conteo_descartar', { p_ids: ids, p_motivo: motivo }, false),
  minimosAprobar: (items, idem) => llamar('fx_bodega_minimos_aprobar', { p_items: items, p_idem: idem }, false),
  rolGuardar: (usuario, rol) => llamar('fx_bodega_roles_guardar', { p_usuario: usuario, p_rol: rol }, false),
};
