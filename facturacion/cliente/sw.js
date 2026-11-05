// Service worker de la pantalla del cliente: guarda la página para abrir sin internet y entrega la publicidad guardada.
// La publicidad vive en Cache Storage («cliente-anuncios-v1», la llena anuncios.js) y se sirve en «anuncio/<clave>» con soporte de Range para el video.
const V = 'cliente-v1';
const ANUNCIOS = 'cliente-anuncios-v1';
const BASE = new URL('./', self.location.href);
const CASCARA = ['./', 'index.html', 'cliente.js', 'cliente.css', 'anuncios.js', '../img/logo-soda.svg', '../img/logo-pollos.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(V).then((c) => Promise.all(CASCARA.map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x !== V && x !== ANUNCIOS).map((x) => caches.delete(x)))).then(() => self.clients.claim()));
});

async function anuncio(req) {
  const c = await caches.open(ANUNCIOS);
  const url = new URL(req.url); url.search = '';
  const r = await c.match(url.href);
  if (!r) return new Response('', { status: 404 });
  const rango = req.headers.get('range');
  const tipo = r.headers.get('content-type') || 'application/octet-stream';
  const blob = await r.blob();
  if (!rango) return new Response(blob, { status: 200, headers: { 'content-type': tipo, 'content-length': String(blob.size), 'accept-ranges': 'bytes' } });
  const m = /bytes=(\d*)-(\d*)/.exec(rango);
  let ini = m && m[1] !== '' ? parseInt(m[1], 10) : 0;
  let fin = m && m[2] !== '' ? parseInt(m[2], 10) : blob.size - 1;
  if (m && m[1] === '' && m[2] !== '') { ini = Math.max(0, blob.size - parseInt(m[2], 10)); fin = blob.size - 1; }
  if (ini >= blob.size || fin < ini) return new Response('', { status: 416, headers: { 'content-range': 'bytes */' + blob.size } });
  fin = Math.min(fin, blob.size - 1);
  return new Response(blob.slice(ini, fin + 1), { status: 206, headers: { 'content-type': tipo, 'content-length': String(fin - ini + 1), 'content-range': `bytes ${ini}-${fin}/${blob.size}`, 'accept-ranges': 'bytes' } });
}

// La página siempre prefiere la red (así nunca queda una versión vieja), pero si no responde en 4 s usa la copia guardada.
function redOCopia(req) {
  const copia = () => caches.open(V).then((c) => c.match(req, { ignoreSearch: true })).then((h) => h || (req.mode === 'navigate' ? caches.open(V).then((c) => c.match('index.html')) : Response.error()));
  return new Promise((resolve) => {
    let listo = false;
    const t = setTimeout(() => { if (!listo) copia().then((r) => { if (!listo) { listo = true; resolve(r); } }); }, 4000);
    fetch(req).then((x) => {
      if (listo) return;
      clearTimeout(t); listo = true;
      if (x.ok && x.type === 'basic') { const cp = x.clone(); caches.open(V).then((c) => c.put(req, cp)); }
      resolve(x);
    }, () => { clearTimeout(t); if (!listo) copia().then((r) => { listo = true; resolve(r); }); });
  });
}

self.addEventListener('fetch', (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== self.location.origin) return;
  if (u.pathname.startsWith(BASE.pathname + 'anuncio/')) { e.respondWith(anuncio(r)); return; }
  e.respondWith(redOCopia(r));
});
