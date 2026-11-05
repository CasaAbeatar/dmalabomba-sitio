// Pantalla del cliente, lado de la caja: publica lo que el cliente debe ver (líneas, descuento, IVA, total, cobro y vuelto).
// Es un módulo aparte y opcional: si algo falla la caja ni se entera. Transporte: BroadcastChannel('lb-pantalla-cliente') entre dos ventanas del mismo navegador.
// Cada mensaje es { evento: 'estado' | 'latido' | 'ack' | 'hola', payload }. La caja manda «estado» y «latido»; la ventana del cliente contesta «ack» a cada latido y «hola» al abrirse.
// Los montos son los mismos que muestra la caja (misma fórmula de IVA y de descuentos que el pie de la cuenta en m_caja.js).
import { tarifaDeLinea } from './iva.js';
import { abrirClienteEnOtraPantalla, abrirManual, detenerVentana } from './pantalla_ventana.js';

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

// Cliente elegido en la cuenta (cur.cliente, ya guardado en la base) -> lo que ve el cliente para confirmar sus datos de factura.
// Solo viajan estos seis campos. Nunca notas, teléfono, dirección, ids internos ni nada de la caja. Sin cliente elegido: null (tiquete).
// nombre = el que está en la ficha (verificado con Hacienda en casi todos); nombre_personal queda null porque la ficha no guarda un segundo nombre.
const TIPOS_ID = ['01', '02', '03', '04', '05', '06'];
const textoONulo = (x) => { const t = String(x ?? '').replace(/\s+/g, ' ').trim(); return t || null; };
export function clienteDe(cur) {
  try {
    const c = cur?.cliente;
    if (!c || typeof c !== 'object') return null;
    const tipo = String(c.tipo_id ?? '').trim();
    const nombre = textoONulo(c.nombre);
    if (!TIPOS_ID.includes(tipo) || !nombre) return null;
    const comercial = textoONulo(c.nombre_comercial);
    return {
      tipo_id: tipo,
      identificacion: String(c.identificacion ?? '').replace(/\D/g, ''),
      nombre,
      nombre_comercial: comercial && comercial.toLowerCase() !== nombre.toLowerCase() ? comercial : null,
      nombre_personal: null,
      correo: textoONulo(c.correo),
    };
  } catch { return null; }
}
// En «pagado» el cliente ya no corrige nada: solo se muestra adónde se enviará la factura
const soloCorreo = (c) => (c && c.correo ? { tipo_id: null, identificacion: null, nombre: null, nombre_comercial: null, nombre_personal: null, correo: c.correo } : null);

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
  let punto = null, txt = null;
  const timers = [];

  const empresa = () => (/soda/i.test(String(app?.empresa?.codigo || app?.soc?.codigo_acceso || app?.soc?.codigo || '')) ? 'soda' : 'pollos');
  const abierta = () => Date.now() - ackEn < VIDA_ACK;
  const textoEstado = () => (abierta() ? 'abierta' : 'cerrada');

  /* ---------- Botón para el cajero en el encabezado de la caja: dice el estado con palabras y, al tocarlo, abre la pantalla del cliente ---------- */
  function pintarPunto() {
    try {
      if (!activo || !encendida || typeof document === 'undefined') return;
      const texto = 'Pantalla del cliente: ' + (abierta() ? 'abierta' : 'cerrada');
      if (!punto) {
        // Botón visible en el encabezado de la caja (junto a «Caja abierta desde...»); si no hay encabezado, queda fijo abajo a la izquierda
        const cabEstado = document.querySelector('.cab-estado');
        punto = document.createElement('button');
        punto.type = 'button';
        punto.className = 'pc-punto';
        punto.style.cssText = (cabEstado ? '' : 'position:fixed;left:6px;bottom:6px;z-index:30;') + 'display:inline-flex;align-items:center;gap:.45rem;padding:.3rem .8rem;border-radius:99px;border:1px solid var(--borde-control,#8f8672);background:#fff;color:#1d1a16;font:inherit;font-size:.88rem;line-height:1.2;white-space:nowrap;flex:0 1 auto;min-width:0;max-width:100%;cursor:pointer;-webkit-tap-highlight-color:transparent;min-height:2.3rem';
        const dot = document.createElement('span');
        dot.className = 'pc-punto-dot';
        dot.style.cssText = 'width:.7rem;height:.7rem;border-radius:50%;display:block;flex:none';
        txt = document.createElement('span');
        txt.style.cssText = 'min-width:0;overflow:hidden;text-overflow:ellipsis'; // en pantallas angostas el texto se acorta con «…» en lugar de empujar a los demás
        punto.append(dot, txt);
        // Un toque abre la pantalla del cliente en el otro monitor (o la trae al frente si ya está abierta)
        punto.addEventListener('click', () => {
          try {
            if (abierta()) { abrirManual(RUTA_CLIENTE); return; }
            abrirClienteEnOtraPantalla({ rutaCliente: RUTA_CLIENTE, monitorCliente: opciones.monitor });
            setTimeout(() => { try { if (activo && encendida && !abierta()) abrirManual(RUTA_CLIENTE); } catch { /* sin ventana */ } }, 1800);
          } catch { /* el botón nunca estorba */ }
        });
        if (cabEstado) cabEstado.append(punto); else document.body.append(punto);
      }
      punto.title = texto;
      punto.setAttribute('aria-label', abierta() ? texto : 'Abrir pantalla del cliente');
      punto.dataset.estado = textoEstado();
      txt.textContent = abierta() ? 'Pantalla del cliente: abierta' : 'Abrir pantalla del cliente';
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
    return { estado, empresa: empresa(), lineas: m.lineas, subtotal: m.subtotal, descuento: m.descuento, iva: m.iva, total: m.total, medio: null, recibido: null, vuelto: null, cliente: clienteDe(cur), ...extra };
  };
  const cuerpoEspera = () => ({ estado: 'espera', empresa: empresa(), lineas: [], subtotal: 0, descuento: 0, iva: 0, total: 0, medio: null, recibido: null, vuelto: null, cliente: null });

  /* ---------- Segunda ventana: se abre sola en la otra pantalla (Window Management API); si no se puede, no pasa nada ---------- */
  function abrirVentanaCliente() {
    if (activo && encendida && configLista) abrirClienteEnOtraPantalla({ rutaCliente: RUTA_CLIENTE, monitorCliente: opciones.monitor });
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
        const base = { ...ultimo, estado: 'pagado', medio, recibido: conEfectivo && recibido > 0 ? r2(recibido) : null, vuelto, cliente: soloCorreo(ultimo.cliente) };
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
      detenerVentana();
      timers.forEach(clearInterval); clearTimeout(timerRetencion);
      try { window.removeEventListener('pointerdown', alPrimerToque, true); } catch { /* ya quitado */ }
      const b = bc; bc = null;
      setTimeout(() => { try { b?.close(); } catch { /* ya cerrado */ } }, 100);
      try { punto?.remove(); } catch { /* ya no está */ }
      punto = null; txt = null;
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
