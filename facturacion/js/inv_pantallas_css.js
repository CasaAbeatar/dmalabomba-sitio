// Estilos de las pantallas de inventario agregadas el 7 nov 2026 (deshacer traslados, destino sugerido y pendiente por proveedor). Archivo propio: no toca los demás estilos.
let listo = null;
export function cargarCssPantallas() {
  if (listo) return listo;
  const href = new URL('../css/inv_pantallas.css', import.meta.url).href;
  listo = new Promise((ok) => {
    if ([...document.querySelectorAll('link[rel=stylesheet]')].some((l) => l.href === href)) return ok();
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = href;
    l.addEventListener('load', () => ok()); l.addEventListener('error', () => ok());
    document.head.append(l);
    setTimeout(ok, 2500);
  });
  return listo;
}
