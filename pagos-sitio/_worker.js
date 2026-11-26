// Pagina de instalacion + reenvio de SMS y latidos del reenviador de SINPE Movil (pagos.dmalabomba.com).
// POST /sms -> sinpe-recibir ; POST /latido -> sinpe-recibir/latido. Conserva el cuerpo y X-Signature, tope 16 KB, no guarda nada.
// Cualquier otra ruta sirve los archivos estaticos (pagina /instalar y los APK).
const BASE = 'https://dwlbcbtwdungyrykgahm.supabase.co/functions/v1/sinpe-recibir';
const MAX = 16 * 1024;
const RUTAS = { '/sms': BASE, '/latido': BASE + '/latido' };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const destino = RUTAS[url.pathname.replace(/\/+$/, '')];
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
