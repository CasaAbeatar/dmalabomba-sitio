// Pone una hoja de estilos de css/ una sola vez. Cada pantalla pide la suya: cargarHoja('respaldos.css').
import { h } from './util.js';

// Pone una hoja de estilos de css/ una sola vez (devuelve una promesa que se cumple cuando ya está puesta)
const hojas = new Map();
export function cargarHoja(archivo) {
  if (hojas.has(archivo)) return hojas.get(archivo);
  const href = new URL('../css/' + archivo, import.meta.url).href;
  const p = new Promise((ok) => {
    if ([...document.querySelectorAll('link[rel=stylesheet]')].some((l) => l.href === href)) return ok();
    const l = h('link', { rel: 'stylesheet', href });
    l.addEventListener('load', () => ok());
    l.addEventListener('error', () => ok());
    document.head.append(l);
    setTimeout(ok, 2500);
  });
  hojas.set(archivo, p);
  return p;
}
