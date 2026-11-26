// Pagina de instalacion + reenvio de SMS y latidos del reenviador de SINPE Movil (pagos.dmalabomba.com).
// POST /sms -> sinpe-recibir ; POST /latido -> sinpe-recibir/latido. Conserva el cuerpo y X-Signature, tope 16 KB, no guarda nada.
// 25 nov 2026 (app 2.10.0, pantalla remota): POST /pantalla -> sinpe-pantalla (tope 256 KB; la respuesta trae X-Signature y se devuelve tal cual)
//   y POST /remoto/api -> sinpe-pantalla-visor (tope 8 KB; pasa la IP real del navegador en x-ip-cliente). /sms y /latido NO cambian.
// Cualquier otra ruta sirve los archivos estaticos (pagina /instalar, el visor /remoto y los APK).
const BASE = 'https://dwlbcbtwdungyrykgahm.supabase.co/functions/v1/sinpe-recibir';
const FN = 'https://dwlbcbtwdungyrykgahm.supabase.co/functions/v1';
const MAX = 16 * 1024;
const RUTAS = { '/sms': BASE, '/latido': BASE + '/latido' };
const PANTALLA = { destino: FN + '/sinpe-pantalla', max: 256 * 1024, firmaRespuesta: true, ip: false };
const VISOR = { destino: FN + '/sinpe-pantalla-visor', max: 8 * 1024, firmaRespuesta: false, ip: true };
const RUTAS_PANTALLA = { '/pantalla': PANTALLA, '/remoto/api': VISOR };

async function reenviar(request, ruta) {
  if (request.method !== 'POST') {
    return new Response('Metodo no permitido', { status: 405, headers: { Allow: 'POST' } });
  }
  const cuerpo = await request.arrayBuffer();
  if (cuerpo.byteLength > ruta.max) {
    return new Response(JSON.stringify({ ok: false, error: 'cuerpo muy grande' }), { status: 413, headers: { 'Content-Type': 'application/json' } });
  }
  const h = new Headers({ 'Content-Type': request.headers.get('content-type') || 'application/json' });
  const firma = request.headers.get('x-signature');
  if (firma) h.set('X-Signature', firma);
  if (ruta.ip) h.set('x-ip-cliente', (request.headers.get('cf-connecting-ip') || '').slice(0, 64));
  const r = await fetch(ruta.destino, { method: 'POST', headers: h, body: cuerpo });
  const salida = { 'Content-Type': r.headers.get('content-type') || 'application/json', 'Cache-Control': 'no-store' };
  if (ruta.firmaRespuesta && r.headers.get('x-signature')) salida['X-Signature'] = r.headers.get('x-signature');
  if (ruta.ip && r.headers.get('retry-after')) salida['Retry-After'] = r.headers.get('retry-after');
  return new Response(r.body, { status: r.status, headers: salida });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const camino = url.pathname.replace(/\/+$/, '');
    const pantalla = RUTAS_PANTALLA[camino];
    if (pantalla) return reenviar(request, pantalla);
    const destino = RUTAS[camino];
    if (!destino) return env.ASSETS.fetch(request);
    if (request.method !== 'POST') {
      return new Response('Metodo no permitido', { status: 405, headers: { Allow: 'POST' } });
    }
    const cuerpo = await request.arrayBuffer();
    if (cuerpo.byteLength > MAX) {
      return new Response(JSON.stringify({ ok: false, error: 'cuerpo muy grande' }), { status: 413, headers: { 'Content-Type': 'application/json' } });
    }
    const h = new Headers({ 'Content-Type': request.headers.get('content-type') || 'application/json' });
    const firma = request.headers.get('x-signature');
    if (firma) h.set('X-Signature', firma);
    const r = await fetch(destino, { method: 'POST', headers: h, body: cuerpo });
    return new Response(r.body, { status: r.status, headers: { 'Content-Type': r.headers.get('content-type') || 'application/json' } });
  },
};
