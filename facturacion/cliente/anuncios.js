// Publicidad de la pantalla del cliente: guarda los archivos en Cache Storage y los rota (imagen y video en silencio).
// Con internet baja los archivos nuevos y borra los que ya no están en la lista; sin internet sigue con lo guardado.
// El service worker (sw.js) entrega los archivos guardados en la dirección local «anuncio/<clave>», con soporte de Range para el video.

const CACHE = 'cliente-anuncios-v1';
const LLAVE_LISTA = 'pc-anuncios';
const SEG_MIN = 3, SEG_MAX = 60, SEG_DEF = 10;
const ESPERA_CARGA_MS = 8000;
const hay = (n) => { try { return typeof n !== 'undefined'; } catch { return false; } };

const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36); };
const rutaLocal = (clave) => new URL('anuncio/' + clave, location.href).href;

// La URL firmada cambia en cada consulta (token y vencimiento); lo estable es la ruta del archivo.
function claveDe(a) {
  let ruta = a.url;
  try { ruta = new URL(a.url).pathname; } catch { /* url relativa: se usa tal cual */ }
  return String(a.id).replace(/[^a-zA-Z0-9_-]/g, '') + '-' + hash(ruta);
}

export function normalizar(lista) {
  if (!Array.isArray(lista)) return [];
  const out = [];
  for (const a of lista) {
    if (!a || typeof a !== 'object' || !a.id || typeof a.url !== 'string' || !/^https?:\/\//i.test(a.url)) continue;
    const tipo = a.tipo === 'video' ? 'video' : 'imagen';
    let seg = Math.round(Number(a.segundos));
    if (!Number.isFinite(seg)) seg = SEG_DEF;
    seg = Math.min(SEG_MAX, Math.max(SEG_MIN, seg));
    const orden = Number.isFinite(Number(a.orden)) ? Number(a.orden) : 0;
    out.push({ id: String(a.id), titulo: String(a.titulo || ''), tipo, url: a.url, segundos: seg, orden, clave: claveDe(a) });
  }
  return out.sort((x, y) => x.orden - y.orden);
}

function leerGuardada() {
  try { const t = JSON.parse(localStorage.getItem(LLAVE_LISTA) || '[]'); return Array.isArray(t) ? t.filter((a) => a && a.clave && a.tipo) : []; } catch { return []; }
}
function guardarLista(l) {
  try { localStorage.setItem(LLAVE_LISTA, JSON.stringify(l.map(({ id, titulo, tipo, segundos, orden, clave }) => ({ id, titulo, tipo, segundos, orden, clave })))); } catch { /* sin almacenamiento: sigue igual */ }
}

export function crearRotador({ escena, capaA, capaB }) {
  const capas = [capaA, capaB];
  let lista = [];                 // anuncios listos para mostrar (en caché o con URL remota)
  const remotas = new Map();      // clave -> url firmada vigente (solo para lo que aún no está en caché)
  const enCache = new Set();      // claves que sí están en Cache Storage
  const blobs = new Map();        // clave -> blob: (solo si no hay service worker que controle la página)
  let activo = false, indice = -1, capaActual = 0, temporizador = 0, vivo = true, fallas = 0, pasada = 0;
  let sincronizando = false;

  const controla = () => hay(navigator) && !!(navigator.serviceWorker && navigator.serviceWorker.controller);

  async function fuente(a) {
    if (enCache.has(a.clave)) {
      if (controla()) return rutaLocal(a.clave);
      if (!blobs.has(a.clave)) {
        try { const c = await caches.open(CACHE); const r = await c.match(rutaLocal(a.clave)); if (r) blobs.set(a.clave, URL.createObjectURL(await r.blob())); } catch { /* cae a la URL remota */ }
      }
      if (blobs.has(a.clave)) return blobs.get(a.clave);
    }
    return remotas.get(a.clave) || '';
  }

  function listaVisible() {
    escena.classList.toggle('sin-anuncios', lista.length === 0);
  }

  function limpiarCapa(capa) {
    capa.classList.remove('on');
    const viejos = [...capa.children];
    setTimeout(() => { for (const e of viejos) { try { if (e.pause) e.pause(); e.removeAttribute('src'); if (e.load) e.load(); } catch { /* nada */ } e.remove(); } }, 1100);
  }

  async function mostrar(i) {
    if (!vivo || !activo || !lista.length) return;
    const a = lista[i % lista.length];
    const src = await fuente(a);
    if (!src) return programar(500, true);
    const capa = capas[1 - capaActual];
    for (const e of [...capa.children]) e.remove();
    const el = a.tipo === 'video' ? document.createElement('video') : document.createElement('img');
    let listo = false;
    const fallo = () => { if (listo) return; listo = true; fallas++; programar(fallas >= lista.length ? 5000 : 300, true); };
    if (a.tipo === 'video') {
      el.muted = true; el.defaultMuted = true; el.autoplay = true; el.loop = lista.length <= 1; el.controls = false;
      el.playsInline = true; el.setAttribute('playsinline', ''); el.setAttribute('webkit-playsinline', ''); el.disablePictureInPicture = true; el.preload = 'auto'; el.setAttribute('muted', '');
      el.addEventListener('loadeddata', () => ok(), { once: true });
    } else {
      el.alt = ''; el.decoding = 'async'; el.draggable = false;
      el.addEventListener('load', () => ok(), { once: true });
    }
    el.addEventListener('error', fallo, { once: true });
    const tope = setTimeout(fallo, ESPERA_CARGA_MS);
    function ok() {
      if (listo) return; listo = true; clearTimeout(tope); fallas = 0;
      if (!vivo || !activo) { el.remove(); return; }
      capa.classList.add('on');
      limpiarCapa(capas[capaActual]);
      capaActual = 1 - capaActual;
      if (el.play) el.play().catch(() => { /* sin autoplay permitido: queda el primer cuadro */ });
      listaVisible();
      escena.dataset.actual = a.id;
      // El video dura lo que dura (entre 3 y 120 s); la foto, sus segundos
      const dur = a.tipo === 'video' && Number.isFinite(el.duration) && el.duration > 0 ? Math.min(120, Math.max(3, el.duration)) : a.segundos;
      if (lista.length > 1 || a.tipo === 'video') programar(dur * 1000, false);
    }
    capa.appendChild(el);
    el.src = src;
  }

  function programar(ms, reintento) {
    clearTimeout(temporizador);
    if (!activo || !vivo) return;
    temporizador = setTimeout(() => {
      if (!lista.length) return;
      indice = (indice + 1) % lista.length; if (indice === 0) pasada++;
      mostrar(indice);
    }, ms);
    if (reintento) return;
  }

  function arrancar() {
    clearTimeout(temporizador);
    if (!activo || !lista.length) { listaVisible(); return; }
    const vid = capas[capaActual].querySelector('video'); // si ya hay uno visible, solo se sigue
    if (vid && escena.dataset.actual) { vid.play && vid.play().catch(() => {}); const a = lista.find((x) => x.id === escena.dataset.actual); programar(((a && a.segundos) || SEG_DEF) * 1000, false); return; }
    if (escena.dataset.actual && capas[capaActual].firstElementChild) { const a = lista.find((x) => x.id === escena.dataset.actual); if (lista.length > 1) programar(((a && a.segundos) || SEG_DEF) * 1000, false); return; }
    indice = indice < 0 ? 0 : indice;
    mostrar(indice);
  }

  function reemplazarLista(nueva) {
    const actual = escena.dataset.actual;
    const eran = lista.length;
    lista = nueva;
    const pos = lista.findIndex((x) => x.id === actual);
    if (pos >= 0) indice = pos; else if (indice >= lista.length) indice = -1;
    listaVisible();
    if (!lista.length) { for (const c of capas) limpiarCapa(c); delete escena.dataset.actual; clearTimeout(temporizador); }
    else if (activo && (pos < 0) && !capas.some((c) => c.firstElementChild)) arrancar();
    // Había una sola foto (sin cambio programado) y ahora hay más: se programa el siguiente cambio
    else if (activo && eran <= 1 && lista.length > 1 && actual) { const a = lista.find((x) => x.id === actual); programar(((a && a.segundos) || SEG_DEF) * 1000, false); }
  }

  return {
    // Muestra de inmediato lo que quedó guardado en la última sesión (útil sin internet).
    async cargarGuardados() {
      const g = leerGuardada();
      if (!g.length || !hay(caches)) return;
      try {
        const c = await caches.open(CACHE);
        const listos = [];
        for (const a of g) { if (await c.match(rutaLocal(a.clave))) { enCache.add(a.clave); listos.push(a); } }
        reemplazarLista(listos);
      } catch { /* sin caché: se espera a la lista del servidor */ }
    },
    // lista cruda del servidor (fx_pantalla_anuncios / fx_pantalla_estado)
    async sincronizar(cruda, { soloMostrar = false } = {}) {
      if (sincronizando) return;
      sincronizando = true;
      try {
        const nueva = normalizar(cruda);
        if (!Array.isArray(cruda)) return;
        let c = null;
        if (soloMostrar) { for (const a of nueva) remotas.set(a.clave, a.url); reemplazarLista(nueva); return; }
        try { c = await caches.open(CACHE); } catch { /* sin caché */ }
        const claves = new Set(nueva.map((a) => a.clave));
        // 1) lo que ya está guardado se usa de una vez
        if (c) for (const a of nueva) if (!enCache.has(a.clave) && await c.match(rutaLocal(a.clave))) enCache.add(a.clave);
        for (const a of nueva) if (!enCache.has(a.clave)) remotas.set(a.clave, a.url);
        const ready = () => nueva.filter((a) => enCache.has(a.clave) || remotas.has(a.clave));
        reemplazarLista(ready());
        guardarLista(ready());
        // 2) baja lo que falta, de a uno
        if (c) for (const a of nueva) {
          if (enCache.has(a.clave)) continue;
          try {
            const r = await fetch(a.url, { cache: 'no-store', credentials: 'omit' });
            if (!r.ok) throw new Error('http ' + r.status);
            await c.put(rutaLocal(a.clave), r);
            enCache.add(a.clave); remotas.delete(a.clave);
          } catch { /* se queda con la URL remota mientras tenga internet */ }
        }
        // 3) borra lo que ya no está en la lista
        if (c) for (const k of await c.keys()) {
          const clave = decodeURIComponent(new URL(k.url).pathname.split('/anuncio/')[1] || '');
          if (clave && !claves.has(clave)) { await c.delete(k); enCache.delete(clave); if (blobs.has(clave)) { URL.revokeObjectURL(blobs.get(clave)); blobs.delete(clave); } }
        }
        guardarLista(ready());
        reemplazarLista(ready());
      } finally { sincronizando = false; }
    },
    activar(si) {
      if (si === activo) return;
      activo = si;
      if (si) arrancar();
      else { clearTimeout(temporizador); const v = escena.querySelectorAll('video'); v.forEach((x) => x.pause()); }
    },
    // Con la ventana oculta o minimizada el video se pausa (no se decodifica fuera de pantalla)
    pausar(si) { const v = escena.querySelectorAll('video'); v.forEach((x) => { try { if (si) x.pause(); else if (activo) x.play().catch(() => {}); } catch { /* nada */ } }); },
    detener() { vivo = false; clearTimeout(temporizador); },
    estado() { return { cantidad: lista.length, actual: escena.dataset.actual || null, enCache: [...enCache], pasada }; },
  };
}
