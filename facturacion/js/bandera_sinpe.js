// Estado de la bandera «sinpe_tarjeta» (fact.config), sin dependencias: lo leen modulos.js, el menú y la caja.
// Apagada por defecto: mientras no se encienda, ni la tarjeta de la caja ni la pantalla del administrador existen para nadie.
let activa = false;
export const sinpeActivo = () => activa === true;
export function fijarSinpe(v) { const n = v === true; const cambio = n !== activa; activa = n; if (cambio && typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('app:sinpe-bandera', { detail: { activa: n } })); }
