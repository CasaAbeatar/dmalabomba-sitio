// Facturación La Bomba: hace que se instale como app. Siempre prefiere la red (así nunca queda una version vieja del facturador);
// la copia guardada solo sirve para abrir la cascara si no hay internet. Los datos (Supabase) nunca se guardan: son de otro origen y pasan directo.
// Las cachés de este service worker empiezan siempre con «facturacion-»; la pantalla del cliente usa «cliente-» y cada una borra solo las suyas.
const PREFIJO = 'facturacion-';
const V = PREFIJO + 'v2';
self.addEventListener('install', (e) => { e.waitUntil(self.skipWaiting()); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x.startsWith(PREFIJO) && x !== V).map((x) => caches.delete(x)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(
    fetch(r).then((x) => {
      if (x.ok && x.type === 'basic') { const cp = x.clone(); caches.open(V).then((c) => c.put(r, cp)); }
      return x;
    }).catch(() => caches.open(V).then((c) => c.match(r, { ignoreSearch: true }).then((h) => h || (r.mode === 'navigate' ? c.match('./') : Response.error()))))
  );
});
