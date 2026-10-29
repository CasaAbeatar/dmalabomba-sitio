// Ayudas visuales comunes de Clientes, Productos y Usuarios.
import { h, conBoton } from './util.js';

// Carga css/mantenimiento.css una sola vez (devuelve una promesa que se cumple cuando ya está puesto)
let cssListo = null;
export function cargarCss() {
  if (cssListo) return cssListo;
  const href = new URL('../css/mantenimiento.css', import.meta.url).href;
  cssListo = new Promise((ok) => {
    if ([...document.querySelectorAll('link[rel=stylesheet]')].some((l) => l.href === href)) return ok();
    const l = h('link', { rel: 'stylesheet', href });
    l.addEventListener('load', () => ok());
    l.addEventListener('error', () => ok());
    document.head.append(l);
    setTimeout(ok, 2500);
  });
  return cssListo;
}

// Texto en minúsculas y sin tildes, para buscar
export const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
// Día (YYYY-MM-DD) en hora de Costa Rica de una fecha
export const diaCR = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Costa_Rica' }).format(new Date(d));
// Caja de aviso: tipo = 'ambar' | 'rojo' | 'verde' | 'info'
export const aviso = (tipo, ...hijos) => h('div.mt-aviso.' + tipo, hijos);
// Campo con etiqueta y ayuda
export const campo = (etiqueta, control, ayuda) => h('label.etq', etiqueta, control, ayuda ? h('small', ayuda) : null);
// Hace que un campo de texto solo acepte números
export function soloDigitos(inp, max) {
  inp.addEventListener('input', () => {
    const v = inp.value.replace(/\D/g, '').slice(0, max || 99);
    if (v !== inp.value) inp.value = v;
  });
  return inp;
}
// Casilla grande (48 px) para marcar filas
export function casilla(alCambiar, etiquetaAria) {
  const i = h('input', { type: 'checkbox', 'aria-label': etiquetaAria || 'Seleccionar', onchange: () => alCambiar(i.checked) });
  return { el: h('label.mt-chk', i), input: i };
}

// Mensajes de error para la pantalla: se muestra el texto cuando lo escribió el sistema en español («Ya existe un cliente con esa identificación»);
// si es un texto técnico (inglés de la base, «Failed to fetch», un código) se muestra una frase que dice qué hacer.
export const MENSAJE_GENERAL = 'Algo no salió bien. Intente de nuevo; si sigue igual, avise a la persona encargada.';
const TEXTO_TECNICO = /permission denied|invalid input|duplicate key|violates|syntax error|could not|does not exist|null value|relation "|column "|function public|TypeError|ReferenceError|Failed to fetch|NetworkError|Load failed|\bundefined\b|\bJWT\b|PGRST|\[object|Unexpected token|is not a function|Cannot read|Error desconocido/i;
export function mensajeSeguro(e, porDefecto = MENSAJE_GENERAL) {
  const m = String((e && e.message) ?? e ?? '').trim();
  return !m || TEXTO_TECNICO.test(m) ? porDefecto : m;
}
// Igual que conBoton (botón ocupado mientras trabaja, así un segundo toque no repite la acción), pero el aviso de error pasa por mensajeSeguro
export function conBotonM(btn, fn, porDefecto) {
  return conBoton(btn, async () => { try { return await fn(); } catch (e) { throw new Error(mensajeSeguro(e, porDefecto)); } });
}
