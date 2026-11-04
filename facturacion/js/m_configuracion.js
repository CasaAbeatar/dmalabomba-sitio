// Configuración (Administración, solo administradores).
// Hoy reúne los ajustes de la impresora de ESTE aparato (papel, copias, impresión automática, tiquete de prueba y cómo imprimir sin ventanitas).
// Estos ajustes se guardan en el propio aparato (imprimir.js: leerAjustes / guardarAjustes), no en la base de datos: cada caja o tableta tiene los suyos.
import { h, toast, textoDeError } from './util.js';

export default {
  id: 'configuracion',
  titulo: 'Configuración',
  async mount(root, app) {
    if (!app.admin) {
      root.append(h('div.vacio', h('p', 'Esta pantalla es solo para administradores.'), h('button.btn', { type: 'button', onclick: () => app.ir('inicio') }, 'Volver al inicio')));
      return;
    }
    let contenido;
    try { contenido = (await import('./imprimir.js')).armarAjustesImpresion(); }
    catch (e) { toast(textoDeError(e), 'error', 6000); return; }
    root.append(h('div.cfg', { style: 'max-width:760px;margin:0 auto;display:flex;flex-direction:column;gap:1rem' },
      h('section.panel',
        h('h2', 'Impresora de este aparato'),
        h('p.tenue-linea', 'Estos ajustes valen solo para el aparato (computadora o tableta) en el que está ahora. Si usa otra caja, ábrala también y ajuste aquí.'),
        contenido)));
  },
};
