// Registra el service worker para que el facturador se pueda instalar como app (solo en https o localhost).
if ('serviceWorker' in navigator) {
  addEventListener('load', () => { navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {}); });
}
