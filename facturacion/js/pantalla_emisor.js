// Pantalla del cliente, lado de la caja: publica lo que el cliente debe ver (líneas, descuento, IVA, total, cobro y vuelto).
// Es un módulo aparte y opcional: si algo falla la caja ni se entera. Transporte: BroadcastChannel('lb-pantalla-cliente') entre dos ventanas del mismo navegador.
// Cada mensaje es { evento: 'estado' | 'latido' | 'ack' | 'hola', payload }. La caja manda «estado» y «latido»; la ventana del cliente contesta «ack» a cada latido y «hola» al abrirse.
// Los montos son los mismos que muestra la caja (misma fórmula de IVA y de descuentos que el pie de la cuenta en m_caja.js).
import { tarifaDeLinea } from './iva.js';

export const NOMBRE_CANAL = 'lb-pantalla-cliente'; // BroadcastChannel entre la ventana de la caja y la ventana del cliente (mismo navegador y mismo origen)
export const RUTA_CLIENTE = new URL('../cliente/', import.meta.url).href;
const CADA_LATIDO = 5000;
const CADA_REPASO = 15000; // se vuelve a publicar el estado vigente por si la pantalla del cliente se recargó a mitad de una cuenta
const RETENCION_PAGADO = 6500; // la pantalla del cliente muestra «pagado» 6 s; mientras tanto la caja vacía no lo pisa
const VIDA_ACK = 15000; // la ventana del cliente cuenta como abierta si respondió hace menos de esto
const r2 = (x) => Math.round(x * 100) / 100;
const cents = (n) => Math.round((Number(n) || 0) * 100);

const descDe = (l) => (l && l.descuento && typeof l.descuento === 'object' && Number(l.descuento.porcentaje) > 0 ? l.descuento : null);
const brutoLinea = (l) => Math.round(Number(l.cantidad) * cents(l.precio_final)) / 100;

// Cuenta (respuesta de fx_venta) -> montos para la pantalla. Misma cuenta que el pie de la caja: neto, IVA y «descuentos ya restados».
export function montosDe(cur) {
  const lineas = (cur?.lineas || []);
  let iva = 0, rebajado = 0;
  const out = lineas.map((l) => {
    const pct = Number(tarifaDeLinea(l).pct) || 0;
    const tl = Number(l.total_linea) || 0;
    iva += r2(tl - r2(tl / (1 + pct / 100)));
    const d = descDe(l);
    if (d) rebajado += Math.max(0, brutoLinea(l) - tl);
    // La línea sale con su valor antes del descuento y el porcentaje aparte (así lo pide el contrato: subtotal = suma de líneas, total = subtotal - descuento)
    return { nombre: String(l.descripcion || '').trim(), cant: Number(l.cantidad), total: d ? brutoLinea(l) : r2(tl), desc_pct: d ? Number(d.porcentaje) : 0 };
  });
  const total = Number(cur?.venta?.total) || 0;
  const descuento = r2(rebajado);
  return { lineas: out, subtotal: r2(total + descuento), descuento, iva: r2(iva), total };
}

export function iniciar(app, opciones = {}) {
  const BC = opciones.BroadcastChannel || (typeof BroadcastChannel !== 'undefined' ? BroadcastChannel : null);
  let activo = true;       // el emisor sigue vivo (la caja está en pantalla)
  let encendida = true;    // el administrador no apagó la pantalla del cliente (fx_pantalla_config_leer)
  let configLista = false; // ya se leyó el ajuste (o se agotó la espera): hasta entonces no sale nada
  let bc = null;
  let fallos = 0;
  let ackEn = 0;           // cuándo contestó por última vez la ventana del cliente
  let modo = 'cuenta';     // cuenta | pago (hay una ventana de cobro abierta)
  let ultimo = null;       // último cuerpo de «estado» publicado (sin ts)
  let ultimoJson = '';
  let retieneHasta = 0, timerRetencion = null;
  let punto = null, etiqueta = null, enlace = null, txt = null, timerEtiqueta = null;
  const timers = [];

  const empresa = () => (/soda/i.test(String(app?.empresa?.codigo || app?.soc?.codigo_acceso || app?.soc?.codigo || '')) ? 'soda' : 'pollos');
  const abierta = () => Date.now() - ackEn < VIDA_ACK;
  const textoEstado = () => (abierta() ? 'abierta' : 'cerrada');

  /* ---------- Puntito para el cajero: una esquina; al tocarlo dice el estado con palabras ---------- */
  function pintarPunto() {
    try {
      if (!activo || !encendida || typeof document === 'undefined') return;
      const texto = 'Pantalla del cliente: ' + textoEstado();
      if (!punto) {
        punto = document.createElement('div');
        punto.className = 'pc-punto';
        punto.setAttribute('role', 'status');
        punto.style.cssText = 'position:fixed;left:2px;bottom:2px;z-index:30;display:flex;align-items:center;gap:6px;padding:7px;cursor:default;font-family:inherit;font-size:12px;line-height:1.2;color:inherit;-webkit-tap-highlight-color:transparent';
        const dot = document.createElement('span');
        dot.className = 'pc-punto-dot';
        dot.style.cssText = 'width:9px;height:9px;border-radius:50%;display:block;flex:none;opacity:.85';
        etiqueta = document.createElement('span');
        etiqueta.style.cssText = 'display:none;background:rgba(20,20,20,.88);color:#fff;border-radius:6px;padding:4px 8px;white-space:nowrap';
        // Enlace manual (sin API de ventanas, p. ej. Safari): solo se ofrece cuando la pantalla del cliente está cerrada
        enlace = document.createElement('a');
        enlace.href = RUTA_CLIENTE; enlace.target = 'lb-cliente'; enlace.rel = 'noopener'; enlace.className = 'pc-punto-enlace';
        enlace.textContent = 'Abrir pantalla del cliente';
        enlace.style.cssText = 'color:#fff;text-decoration:underline;margin-left:10px';
        txt = document.createElement('span');
        etiqueta.append(txt, enlace);
        punto.append(dot, etiqueta);
        punto.addEventListener('click', () => {
          etiqueta.style.display = 'block';
          clearTimeout(timerEtiqueta);
          timerEtiqueta = setTimeout(() => { if (etiqueta) etiqueta.style.display = 'none'; }, 4000);
        });
        document.body.append(punto);
      }
      punto.title = texto;
      punto.setAttribute('aria-label', texto);
      punto.dataset.estado = textoEstado();
      txt.textContent = texto;
      enlace.style.display = abierta() ? 'none' : 'inline';
      punto.firstChild.style.background = abierta() ? '#2e9e5b' : '#9aa0a6';
    } catch { /* el puntito nunca estorba */ }
  }

  /* ---------- Mensajes ---------- */
  function enviar(evento, payload) {
    try {
      if (!activo || !encendida || !configLista || !bc) return;
      // soc y terminal viajan para que la pagina del cliente pida sus anuncios; no son datos personales
      bc.postMessage({ evento, payload: { ...payload, soc: app?.socId ?? null, terminal: app?.terminal ?? 1 } });
    } catch { fallos++; }
  }
  function alMensaje(ev) {
    try {
      const m = ev?.data;
      if (!m || typeof m !== 'object') return;
      if (m.evento === 'ack' || m.evento === 'hola') {
        const estabaCerrada = !abierta();
        ackEn = Date.now();
        // La ventana del cliente acaba de abrirse (o se recargó): se le pone al día con lo que hay en la caja
        if (m.evento === 'hola' || estabaCerrada) { if (ultimo && ultimo.estado !== 'pagado') enviar('estado', { ...ultimo, ts: Date.now() }); enviar('latido', { ts: Date.now() }); }
        pintarPunto();
      }
    } catch { fallos++; }
  }
  function publicar(cuerpo) {
    try {
      if (!activo || !encendida) return;
      const completo = { v: 1, ...cuerpo };
      const json = JSON.stringify(completo);
      if (json === ultimoJson) return; // nada cambió
      ultimoJson = json; ultimo = completo;
      enviar('estado', { ...completo, ts: Date.now() });
    } catch { fallos++; }
  }
  const cuerpo = (estado, cur, extra = {}) => {
    const m = montosDe(cur);
    return { estado, empresa: empresa(), lineas: m.lineas, subtotal: m.subtotal, descuento: m.descuento, iva: m.iva, total: m.total, medio: null, recibido: null, vuelto: null, ...extra };
  };
  const cuerpoEspera = () => ({ estado: 'espera', empresa: empresa(), lineas: [], subtotal: 0, descuento: 0, iva: 0, total: 0, medio: null, recibido: null, vuelto: null });

  /* ---------- Segunda ventana: se abre sola en la otra pantalla (Window Management API); si no se puede, no pasa nada ---------- */
  async function abrirVentanaCliente() {
    try {
      if (!activo || !encendida || !configLista || abierta() || typeof window === 'undefined' || typeof window.getScreenDetails !== 'function') return;
      if (!window.screen?.isExtended) return; // una sola pantalla: no hay a dónde abrirla
      const d = await window.getScreenDetails();
      const otras = d.screens.filter((p) => p !== d.currentScreen);
      if (!otras.length || !activo || abierta()) return;
      const pref = String(opciones.monitor || '').toLowerCase();
      const otra = (pref && otras.find((p) => String(p.label || '').toLowerCase().includes(pref))) || otras.find((p) => p.isInternal) || otras[0];
      const w = window.open(RUTA_CLIENTE, 'lb-cliente', 'popup=yes,left=' + otra.availLeft + ',top=' + otra.availTop + ',width=' + otra.availWidth + ',height=' + otra.availHeight);
      if (w) { try { w.document.documentElement.requestFullscreen?.({ screen: otra }).catch(() => {}); } catch { /* sin pantalla completa: queda en ventana */ } }
    } catch { /* sin permiso o sin la API: no se molesta a nadie */ }
  }

  const api = {
    // Cambió la cuenta que se ve en la caja (o no hay ninguna): se llama cada vez que la caja repinta la cuenta
    cuenta(cur) {
      try {
        if (!activo) return;
        const hayLineas = !!cur && (cur.lineas || []).length > 0;
        if (Date.now() < retieneHasta) { if (!hayLineas) return; retieneHasta = 0; clearTimeout(timerRetencion); } // acaba de pagarse: la caja vacía espera a que termine el «pagado»
        if (!hayLineas) { modo = 'cuenta'; publicar(cuerpoEspera()); return; }
        publicar(cuerpo(modo === 'pago' ? 'pago' : 'cuenta', cur));
      } catch { fallos++; }
    },
    // Se abrió la ventana de cobro
    pago(cur) {
      try { if (!activo || !cur || !(cur.lineas || []).length) return; modo = 'pago'; publicar(cuerpo('pago', cur)); } catch { fallos++; }
    },
    // La ventana de cobro se cerró sin cobrar
    cerrarPago(cur) { modo = 'cuenta'; api.cuenta(cur); },
    // El cobro salió bien. comp = comprobante del servidor; vueltoLocal = vuelto calculado en la caja (solo si el servidor no lo trajo)
    pagado(comp, vueltoLocal) {
      try {
        if (!activo || !encendida || !ultimo) return;
        const pagos = Array.isArray(comp?.pagos_snapshot) ? comp.pagos_snapshot : [];
        const medios = [...new Set(pagos.map((p) => String(p.medio)))];
        const medio = medios.length === 0 ? null : medios.length > 1 ? 'mixto' : (['efectivo', 'tarjeta', 'sinpe'].includes(medios[0]) ? medios[0] : null);
        const conEfectivo = medios.includes('efectivo');
        const recibido = conEfectivo ? pagos.filter((p) => p.medio === 'efectivo' && p.recibido != null).reduce((t, p) => t + Number(p.recibido), 0) : 0;
        const vueltoSrv = comp && comp.vuelto != null && Number.isFinite(Number(comp.vuelto)) ? Number(comp.vuelto) : vueltoLocal;
        const vuelto = conEfectivo && Number.isFinite(Number(vueltoSrv)) ? r2(Number(vueltoSrv)) : null;
        modo = 'cuenta';
        retieneHasta = Date.now() + RETENCION_PAGADO;
        clearTimeout(timerRetencion);
        const base = { ...ultimo, estado: 'pagado', medio, recibido: conEfectivo && recibido > 0 ? r2(recibido) : null, vuelto };
        ultimoJson = JSON.stringify(base); ultimo = base;
        enviar('estado', { ...base, ts: Date.now() });
        timerRetencion = setTimeout(() => { if (activo && ultimo && ultimo.estado === 'pagado') publicar(cuerpoEspera()); }, RETENCION_PAGADO);
      } catch { fallos++; }
    },
    // La caja se cerró o se salió de la pantalla de Caja
    detener() {
      if (!activo) return;
      try { publicar(cuerpoEspera()); } catch { /* sin aviso */ }
      activo = false;
      timers.forEach(clearInterval); clearTimeout(timerRetencion); clearTimeout(timerEtiqueta);
      try { window.removeEventListener('pointerdown', alPrimerToque, true); } catch { /* ya quitado */ }
      const b = bc; bc = null;
      setTimeout(() => { try { b?.close(); } catch { /* ya cerrado */ } }, 100);
      try { punto?.remove(); } catch { /* ya no está */ }
      punto = null; etiqueta = null;
      if (typeof window !== 'undefined' && window.pantallaEmisor === api) delete window.pantallaEmisor;
    },
    get fallos() { return fallos; },
    get estado() { return textoEstado(); },
  };

  // Si el navegador exigía un toque para abrir la ventana, se reintenta una sola vez con el primer toque del cajero (sin avisarle)
  function alPrimerToque() {
    window.removeEventListener('pointerdown', alPrimerToque, true);
    abrirVentanaCliente();
  }

  /* ---------- Arranque ---------- */
  try {
    if (BC) { bc = new BC(NOMBRE_CANAL); bc.onmessage = alMensaje; }
    // ¿Está encendida la pantalla del cliente? (ajuste del administrador; mientras no exista o no conteste, queda encendida)
    const leer = opciones.leerConfig || (async () => {
      const { sb } = await import('./api.js');
      const r = await sb.rpc('fx_pantalla_config_leer', { p_soc: app?.socId, p_terminal: app?.terminal ?? 1 });
      return r?.data;
    });
    const espera = new Promise((ok) => setTimeout(ok, 3000, undefined));
    Promise.race([Promise.resolve().then(leer), espera]).then((c) => {
      const cfg = Array.isArray(c) ? c[0] : c;
      if (cfg && (cfg.activa === false || cfg.activo === false || cfg.encendida === false)) { encendida = false; try { punto?.remove(); } catch { /* sin punto */ } punto = null; }
      if (cfg && cfg.monitor_cliente) opciones.monitor = cfg.monitor_cliente;
    }).catch(() => { /* sin ajuste: queda encendida */ }).then(() => {
      configLista = true;
      if (encendida && activo) { pintarPunto(); enviar('latido', { ts: Date.now() }); if (ultimo && ultimo.estado !== 'pagado') enviar('estado', { ...ultimo, ts: Date.now() }); }
    });
    pintarPunto();
    enviar('latido', { ts: Date.now() });
    timers.push(setInterval(() => {
      try {
        if (!app?.turno) { pintarPunto(); return; } // con la caja cerrada no se manda nada
        enviar('latido', { ts: Date.now() });
        pintarPunto();
      } catch { fallos++; }
    }, CADA_LATIDO));
    timers.push(setInterval(() => {
      try { if (app?.turno && ultimo && ultimo.estado !== 'pagado') enviar('estado', { ...ultimo, ts: Date.now() }); } catch { fallos++; }
    }, CADA_REPASO));
    if (!opciones.sinVentana) {
      setTimeout(abrirVentanaCliente, 1500); // da tiempo a que una ventana ya abierta conteste «ack»
      window.addEventListener('pointerdown', alPrimerToque, true);
    }
    if (typeof window !== 'undefined') window.pantallaEmisor = api; // consola: pantallaEmisor.fallos, pantallaEmisor.estado
  } catch { fallos++; }
  return api;
}
