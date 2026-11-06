// «Datos del cliente nuevo» en la pantalla del cliente (modo de doble pantalla). Lo usa SOLO el formulario «Agregar cliente» (ui_cliente.js).
// Mientras la persona llena el formulario, la pantalla del cliente muestra a pantalla completa lo que se va escribiendo, para que el cliente
// compruebe que cédula, nombre, correos, teléfono y dirección son los suyos. Solo viajan los datos que ya tienen valor (nada de «falta tal cosa»).
// Solo funciona si la ventana del cliente ya está abierta (el botón «Pantalla del cliente» de la caja): se comprueba con un latido y su «ack».
// Con una sola pantalla no pasa nada y el formulario ni se entera. Al cerrar el formulario se manda «cliente_nuevo_fin» y la pantalla vuelve a lo que mostraba.
import { NOMBRE_CANAL } from './pantalla_emisor.js';

const CADA = 4000;     // latido y repaso: la pantalla del cliente suelta estos datos si pasan 15 s sin oír nada
const REVISAR = 450;   // cada cuánto se compara lo escrito con lo último enviado (cubre lo que se llena solo desde Hacienda)

export function crearEspejoClienteNuevo({ leer, empresa, BroadcastChannel: BCx } = {}) {
  const BC = BCx || (typeof BroadcastChannel !== 'undefined' ? BroadcastChannel : null);
  if (!BC || typeof leer !== 'function') return { cerrar() {}, get activo() { return false; } };
  let bc = null, activo = false, cerrado = false, ultimoJson = '';
  const timers = [];
  const datos = () => { try { return leer() || null; } catch { return null; } };
  const mandar = (forzar) => {
    try {
      if (cerrado || !activo || !bc) return;
      const d = datos();
      if (!d) return;
      const j = JSON.stringify(d);
      if (j === ultimoJson && !forzar) return;
      ultimoJson = j;
      bc.postMessage({ evento: 'cliente_nuevo', payload: { ...d, empresa: empresa || '', ts: Date.now() } });
    } catch { /* la pantalla del cliente nunca estorba al formulario */ }
  };
  const latido = () => { try { if (!cerrado && bc) bc.postMessage({ evento: 'latido', payload: { ts: Date.now() } }); } catch { /* nada */ } };
  try {
    bc = new BC(NOMBRE_CANAL);
    bc.onmessage = (ev) => {
      try {
        const m = ev?.data;
        if (!m || m.evento !== 'ack' && m.evento !== 'hola') return;
        const antes = activo; activo = true;
        if (!antes || m.evento === 'hola') mandar(true);
      } catch { /* nada */ }
    };
    latido();
    timers.push(setInterval(() => { latido(); mandar(true); }, CADA));
    timers.push(setInterval(() => mandar(false), REVISAR));
  } catch { /* sin canal */ }
  return {
    get activo() { return activo; },
    cerrar() {
      if (cerrado) return;
      try { if (activo && bc) bc.postMessage({ evento: 'cliente_nuevo_fin', payload: { ts: Date.now() } }); } catch { /* nada */ }
      cerrado = true; timers.forEach(clearInterval);
      const b = bc; bc = null; setTimeout(() => { try { b?.close(); } catch { /* ya cerrado */ } }, 100);
    },
  };
}
