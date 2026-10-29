// Caja de efectivo dentro de Facturación: dos cajitas (entrada y salida de dinero que no es venta), una tarjeta pequeña para anotar y la lista de movimientos del turno.
// Todo vive en su propia zona: al guardar solo se actualizan los textos de esta zona. La cuenta que se está armando no se toca.
// Regla de caja: debe haber en caja = fondo + ventas en efectivo + ENTRADAS - salidas - devoluciones en efectivo (lo calcula el servidor).
import { h, money, money0, leerNumero, toast, modal, horaCorta, fechaCorta, esqueleto, conPunto } from './util.js';
import { apiEfectivo, MOTIVOS_ENTRADA, MOTIVOS_SALIDA, motivosValidos, textoError } from './api_efectivo.js';
import { esTransitorio } from './api.js';

const TOPE = 99999999.99;
const TZ = 'America/Costa_Rica';
const fechaCR = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(d));
const cents = (n) => Math.round((Number(n) || 0) * 100);
// ₡5 000 si es redondo, ₡5 000,50 si trae céntimos
const colones = (n) => (cents(n) % 100 === 0 ? money0(n) : money(n));

const TIPOS_BASE = {
  entrada: {
    titulo: 'Entrada de efectivo', agregar: 'Agregar entrada', guardar: 'Guardar entrada', palabra: 'Entrada', signo: '+',
    ayuda: 'Entra dinero a la caja', ejemplo: 'Ej. Sencillo para dar vuelto',
    motivos: MOTIVOS_ENTRADA,
    pideMonto: 'Escriba cuánto dinero entra a la caja, por ejemplo 5 000.',
    pideMotivo: 'Escriba de dónde viene el dinero (mínimo 3 letras).',
    nada: 'ninguna entrada',
  },
  salida: {
    titulo: 'Salida de efectivo', agregar: 'Agregar salida', guardar: 'Guardar salida', palabra: 'Salida', signo: '−',
    ayuda: 'Sale dinero de la caja', ejemplo: 'Ej. Pago a proveedor de hielo',
    motivos: MOTIVOS_SALIDA,
    pideMonto: 'Escriba cuánto dinero sale de la caja, por ejemplo 5 000.',
    pideMotivo: 'Escriba para qué sale el dinero (mínimo 3 letras).',
    nada: 'ninguna salida',
  },
};
const OTRO = 'Otro';
let contador = 0;

// Resume lo que devuelve fx_turno_estado: lo único que la zona necesita mostrar
function resumir(e) {
  const ent = e.entradas || [], sal = e.salidas || [];
  const suma = (l) => l.reduce((s, x) => s + Number(x.monto || 0), 0);
  const abiertoEn = e.turno?.abierto_en;
  return {
    entrada: { n: ent.length, total: e.total_entradas != null ? Number(e.total_entradas) : suma(ent) },
    salida: { n: sal.length, total: e.total_salidas != null ? Number(e.total_salidas) : suma(sal) },
    esperado: Number(e.esperado_efectivo),
    deHoy: !abiertoEn || fechaCR(abiertoEn) === fechaCR(new Date()), // el turno empezó hoy: «Hoy»; si viene de ayer: «En este turno»
    ids: new Set([...ent, ...sal].map((x) => x.id)),
    leidoEn: new Date(),
  };
}

/* ---------- Anular un movimiento, con motivo ---------- */
// Es la ÚNICA ventana para anular una entrada o una salida (Facturación y Apertura y cierre de caja). mov = { tipo: 'entrada'|'salida', id, monto, motivo }.
// Devuelve true si se anuló
export function anularMovimiento(mov) {
  return new Promise((fin) => {
    const entrada = mov.tipo === 'entrada';
    let hecho = false, enviando = false;
    const motivo = h('textarea.campo', { rows: 3, maxlength: 200, placeholder: 'Ej. se anotó dos veces por error', 'aria-label': 'Motivo de la anulación' });
    const err = h('div.error-caja', { hidden: true, role: 'alert' });
    const m = modal({
      titulo: entrada ? 'Anular entrada de efectivo' : 'Anular salida de efectivo', ancho: 480,
      alCerrar: () => { if (!hecho) fin(false); },
      contenido: h('div.col',
        h('p.conf', (entrada ? 'La entrada de ' : 'La salida de ') + colones(mov.monto) + ' (' + mov.motivo + ') ' + (entrada ? 'dejará de contarse en la caja.' : 'dejará de restarse: el dinero vuelve a contarse como si estuviera en la caja.')),
        h('label.etq', 'Motivo de la anulación (obligatorio)', motivo),
        err),
      botones: [
        { texto: 'No, dejarla', onclick: (c) => { if (!enviando) c(); } },
        { texto: entrada ? 'Sí, anular la entrada' : 'Sí, anular la salida', clase: 'peligro', onclick: async () => {
          if (enviando) return;
          err.hidden = true;
          const t = motivo.value.trim();
          if (t.length < 3) { err.textContent = 'Escriba por qué se anula (mínimo 3 letras).'; err.hidden = false; motivo.focus(); return; }
          enviando = true;
          const boton = m.el.querySelector('.modal-pie .peligro');
          if (boton) { boton.disabled = true; boton.dataset.ocupado = '1'; }
          try {
            await apiEfectivo.anular(mov.tipo, mov.id, t);
            hecho = true; m.cerrar(); toast(entrada ? 'Entrada anulada.' : 'Salida anulada.'); fin(true);
          } catch (e) {
            if (/ya estaba anulada/i.test(e.message || '')) { hecho = true; m.cerrar(); toast('Ese movimiento ya estaba anulado.'); fin(true); return; }
            err.textContent = esTransitorio(e) ? 'No se pudo anular por la conexión. Revise la lista de movimientos antes de intentarlo otra vez.' : conPunto(textoError(e, 'No se pudo anular. Intente de nuevo; si sigue igual, avise a la persona encargada.'));
            err.hidden = false;
            enviando = false;
            if (boton) { boton.disabled = false; delete boton.dataset.ocupado; }
          }
        } },
      ],
    });
    motivo.focus();
  });
}

/* ---------- Zona de efectivo ---------- */
// turnoId: turno abierto, o null cuando la caja está cerrada (las cajitas se ven apagadas).
// alAbrirCaja(): lo que hace el botón «Abrir la caja» cuando no hay turno.
// Opciones para usarla fuera de Facturación (Apertura y cierre de caja): conPie=false quita «Debe haber en caja» y el enlace a los movimientos (esa pantalla ya los muestra),
// enFlujo=true abre la tarjeta en su lugar y no encima, alCambiar() avisa cada vez que se guardó o se anuló algo, motivos={ entrada, salida } son las listas del servidor.
export function crearZonaEfectivo({ turnoId = null, alAbrirCaja, conPie = true, enFlujo = false, alCambiar, motivos } = {}) {
  const TIPOS = {
    entrada: { ...TIPOS_BASE.entrada, motivos: motivosValidos(motivos?.entrada, MOTIVOS_ENTRADA) },
    salida: { ...TIPOS_BASE.salida, motivos: motivosValidos(motivos?.salida, MOTIVOS_SALIDA) },
  };
  let vivo = true;
  let datos = null; // resumen de la última lectura buena
  let fallo = false; // la última lectura falló
  let seq = 0; // ignora respuestas que llegan fuera de orden
  let abierta = null; // 'entrada' | 'salida' | null: tarjeta abierta
  let tarjeta = null; // { el, monto, motivo, ... } de la tarjeta abierta
  let enviando = false;
  let duda = null; // un guardado que no se pudo confirmar por la red: { tipo, c, motivo, antes }
  let abiertaEn = 0;
  const borradores = { entrada: { monto: '', motivo: '' }, salida: { monto: '', motivo: '' } };
  const timersOk = {};
  const timers = [];
  const cajas = {};
  const sinTurno = !turnoId;

  /* --- Cajitas --- */
  for (const tipo of ['entrada', 'salida']) {
    const T = TIPOS[tipo];
    const resumen = h('p.efz-resumen', sinTurno ? 'Sin turno abierto' : 'Cargando…');
    const ok = h('p.efz-ok', { role: 'status', 'aria-live': 'polite' });
    const boton = h('button.btn.efz-agregar.' + tipo, { type: 'button', 'aria-expanded': 'false', disabled: sinTurno, onclick: () => abrirTarjeta(tipo) },
      h('span.efz-signo', { 'aria-hidden': 'true' }, T.signo), T.agregar);
    const el = h('div.efz-caja.' + tipo,
      h('h3.efz-titulo', h('span.efz-marca', { 'aria-hidden': 'true' }, T.signo), T.titulo),
      ok, resumen, boton);
    cajas[tipo] = { el, resumen, ok, boton };
  }

  /* --- Pie: efectivo esperado y movimientos --- */
  const cifra = h('strong.efz-cifra', '');
  const hora = h('span.efz-hora', '');
  const actualizar = h('button.btn.efz-reintentar', { type: 'button', hidden: true, onclick: () => refrescar() }, 'Actualizar');
  const botonVer = h('button.btn.efz-ver', { type: 'button', onclick: () => abrirMovimientos() }, 'Ver movimientos de este turno');
  const pie = h('div.efz-pie',
    h('div.efz-esperado', h('span.efz-et', 'Debe haber en caja'), h('span.efz-valor', cifra, hora)),
    actualizar, botonVer);

  /* --- Sin turno --- */
  const avisoSinTurno = h('div.efz-sin',
    h('p.efz-sin-txt', 'Abra la caja para registrar efectivo'),
    h('button.btn.primario.grande.efz-abrir', { type: 'button', onclick: () => alAbrirCaja?.() }, 'Abrir la caja'));

  const sitioTarjeta = h('div.efz-sitio');
  const el = h('section.efz' + (sinTurno ? '.sin-turno' : '') + (enFlujo ? '.efz-flujo' : ''), { 'aria-label': 'Efectivo de la caja: entradas y salidas de dinero' },
    h('div.efz-cajitas', cajas.entrada.el, cajas.salida.el),
    sitioTarjeta,
    sinTurno ? avisoSinTurno : (conPie ? pie : null));

  /* --- Textos --- */
  function textoResumen(tipo) {
    const T = TIPOS[tipo];
    if (fallo && !datos) return 'No se pudo leer el resumen';
    if (!datos) return 'Cargando…';
    const r = datos[tipo];
    const cuando = datos.deHoy ? 'Hoy' : 'En este turno';
    if (!r.n) return cuando + ': ' + T.nada;
    return cuando + ': ' + colones(r.total) + ' en ' + r.n + (r.n === 1 ? ' movimiento' : ' movimientos');
  }
  function pintar() {
    if (sinTurno) return;
    // Solo cambian textos: los botones y la tarjeta abierta se quedan como están
    for (const tipo of ['entrada', 'salida']) {
      const t = textoResumen(tipo);
      if (cajas[tipo].resumen.textContent !== t) cajas[tipo].resumen.textContent = t;
    }
    const c = datos ? colones(datos.esperado) : '';
    if (cifra.textContent !== c) cifra.textContent = c;
    const hr = datos ? 'a las ' + horaCorta(datos.leidoEn) : (fallo ? 'No se pudo leer' : 'Cargando…');
    if (hora.textContent !== hr) hora.textContent = hr;
    actualizar.hidden = !fallo;
  }

  /* --- Lectura del resumen (solo lectura; se repite sola una vez si falla la red) --- */
  async function refrescar() {
    if (sinTurno || !vivo) return;
    const mi = ++seq;
    try {
      const e = await apiEfectivo.estado(turnoId);
      if (!vivo || mi !== seq) return;
      datos = resumir(e); fallo = false;
    } catch {
      if (!vivo || mi !== seq) return;
      fallo = true; // se conserva lo último que se leyó
    }
    pintar();
  }

  /* --- «Guardado ₡X» unos segundos --- */
  function mostrarGuardado(tipo, monto) {
    const c = cajas[tipo];
    c.ok.replaceChildren(h('span', { 'aria-hidden': 'true' }, '✓ '), 'Guardado ' + colones(monto));
    c.el.classList.add('recien');
    clearTimeout(timersOk[tipo]);
    timersOk[tipo] = setTimeout(() => { c.ok.replaceChildren(); c.el.classList.remove('recien'); }, 5000);
  }

  /* --- Tarjeta para anotar --- */
  function cerrarTarjeta({ devolverFoco = true } = {}) {
    if (!tarjeta) return;
    const tipo = abierta;
    tarjeta.el.remove();
    tarjeta = null; abierta = null;
    el.classList.remove('con-tarjeta'); delete el.dataset.abierta;
    for (const k of ['entrada', 'salida']) cajas[k].boton.setAttribute('aria-expanded', 'false');
    if (devolverFoco && tipo) { try { cajas[tipo].boton.focus({ preventScroll: true }); } catch { /* nada */ } }
  }

  function abrirTarjeta(tipo) {
    if (sinTurno || !vivo) return;
    if (abierta === tipo) { tarjeta?.monto.focus(); return; }
    if (enviando) return;
    cerrarTarjeta({ devolverFoco: false });
    abierta = tipo;
    const T = TIPOS[tipo];
    const n = ++contador;
    const idMsgMonto = 'efz-m-' + n, idMsgMotivo = 'efz-t-' + n;
    const monto = h('input.campo.efz-monto', { type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0', enterkeyhint: 'next', 'aria-label': 'Monto en colones', 'aria-describedby': idMsgMonto, value: borradores[tipo].monto });
    const motivo = h('input.campo.efz-motivo', { type: 'text', maxlength: 200, autocomplete: 'off', placeholder: T.ejemplo, enterkeyhint: 'done', 'aria-label': 'Motivo', 'aria-describedby': idMsgMotivo, value: borradores[tipo].motivo });
    const msgMonto = h('p.efz-msg', { id: idMsgMonto, hidden: true, role: 'alert' });
    const msgMotivo = h('p.efz-msg', { id: idMsgMotivo, hidden: true, role: 'alert' });
    const msgGeneral = h('div.efz-aviso', { hidden: true, role: 'alert' });
    const chips = h('div.efz-chips', { role: 'group', 'aria-label': 'Motivos frecuentes' });
    const guardarBtn = h('button.btn.grande.efz-guardar.' + tipo, { type: 'button', onclick: () => guardar() }, T.guardar);
    const cancelarBtn = h('button.btn.efz-cancelar', { type: 'button', onclick: () => cancelar() }, 'Cancelar');

    const marcarError = (campo, msg, texto) => {
      msg.textContent = texto || ''; msg.hidden = !texto;
      if (texto) campo.setAttribute('aria-invalid', 'true'); else campo.removeAttribute('aria-invalid');
    };
    const limpiarErrores = () => { marcarError(monto, msgMonto, ''); marcarError(motivo, msgMotivo, ''); msgGeneral.hidden = true; msgGeneral.textContent = ''; };
    // Los botones de motivo se crean una sola vez; después solo cambia aria-pressed (así el teclado no pierde el foco)
    const botonesChip = T.motivos.map((t) => h('button.efz-chip', { type: 'button', 'aria-pressed': 'false', onclick: () => {
      if (t === OTRO) { motivo.value = ''; borradores[tipo].motivo = ''; motivo.focus(); } else { motivo.value = t; borradores[tipo].motivo = t; marcarError(motivo, msgMotivo, ''); }
      pintarChips();
    } }, t));
    chips.replaceChildren(...botonesChip);
    const pintarChips = () => {
      const v = motivo.value.trim();
      T.motivos.forEach((t, i) => {
        const activo = t === OTRO ? (v !== '' && !T.motivos.some((x) => x !== OTRO && x === v)) : v === t;
        botonesChip[i].setAttribute('aria-pressed', String(activo));
      });
    };
    pintarChips();

    monto.addEventListener('input', () => { borradores[tipo].monto = monto.value; marcarError(monto, msgMonto, ''); msgGeneral.hidden = true; });
    motivo.addEventListener('input', () => { borradores[tipo].motivo = motivo.value; marcarError(motivo, msgMotivo, ''); msgGeneral.hidden = true; pintarChips(); });
    // Enter en el monto solo pasa al motivo; en el motivo guarda, pero nunca con una tecla sostenida ni recién abierta la tarjeta
    monto.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (!e.repeat) motivo.focus(); } });
    motivo.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (e.repeat || enviando || performance.now() - abiertaEn < 500) return;
      guardar();
    });

    const el2 = h('div.efz-tarjeta.' + tipo, { role: 'group', 'aria-label': 'Anotar ' + (tipo === 'entrada' ? 'una entrada' : 'una salida') + ' de efectivo' },
      h('div.efz-tarjeta-cab', h('span.efz-marca', { 'aria-hidden': 'true' }, T.signo), h('div', h('h3.efz-titulo', T.titulo), h('p.efz-ayuda', T.ayuda))),
      h('label.etq', 'Monto (₡)', monto), msgMonto,
      h('div.etq.efz-motivo-grupo', h('span', 'Motivo (obligatorio)'), chips, motivo), msgMotivo,
      msgGeneral,
      h('div.efz-botones', guardarBtn, cancelarBtn));
    el2.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !enviando) { e.preventDefault(); e.stopPropagation(); cancelar(); } });
    sitioTarjeta.replaceChildren(el2);
    tarjeta = { el: el2, monto, motivo, guardarBtn, cancelarBtn, msgMonto, msgMotivo, msgGeneral, marcarError, limpiarErrores };
    el.classList.add('con-tarjeta'); el.dataset.abierta = tipo;
    cajas[tipo].boton.setAttribute('aria-expanded', 'true');
    abiertaEn = performance.now();
    pintarBotonGuardar();
    monto.focus();
    try { el2.scrollIntoView({ block: 'nearest' }); } catch { /* nada */ }
  }

  function cancelar() {
    if (enviando) return;
    if (abierta) borradores[abierta] = { monto: '', motivo: '' };
    cerrarTarjeta();
  }

  // Valida lo escrito y pinta los errores en palabras claras. Devuelve { monto, motivo } o null.
  function validar() {
    const t = tarjeta, T = TIPOS[abierta];
    t.limpiarErrores();
    let primero = null;
    const textoMonto = t.monto.value.trim();
    const v = leerNumero(textoMonto);
    let errMonto = '';
    if (!textoMonto) errMonto = T.pideMonto;
    else if (!Number.isFinite(v)) errMonto = 'El monto no es válido. Escriba solo números, por ejemplo 5000 o 5 000,50.';
    else if (v <= 0) errMonto = 'El monto tiene que ser mayor que cero.';
    else if (v > TOPE) errMonto = 'El monto es demasiado grande. El máximo es ' + money(TOPE) + '.';
    if (errMonto) { t.marcarError(t.monto, t.msgMonto, errMonto); primero = t.monto; }
    const m = t.motivo.value.trim();
    if (m.length < 3) { t.marcarError(t.motivo, t.msgMotivo, T.pideMotivo); primero = primero || t.motivo; }
    if (primero) { primero.focus(); return null; }
    return { monto: Math.round(v * 100) / 100, motivo: m };
  }

  function pintarBotonGuardar() {
    if (!tarjeta) return;
    const T = TIPOS[abierta];
    const b = tarjeta.guardarBtn;
    const eraOcupado = b.disabled;
    b.disabled = enviando; tarjeta.cancelarBtn.disabled = enviando;
    b.setAttribute('aria-busy', String(enviando));
    b.textContent = enviando ? 'Guardando…' : duda && duda.tipo === abierta ? 'Revisar si quedó guardada' : T.guardar;
    // Al apagarse, el botón pierde el foco: se le devuelve para que el teclado (y Escape) sigan funcionando en la tarjeta
    if (!enviando && eraOcupado && (!document.activeElement || document.activeElement === document.body)) b.focus({ preventScroll: true });
  }

  const baseline = () => (datos ? new Set(datos.ids) : null);

  // Después de un fallo de red no se sabe si el servidor alcanzó a guardar: se lee la lista antes de permitir otro intento, para no duplicar
  async function comprobarGuardado(tipo, monto, motivo, antes) {
    const t0 = Date.now();
    let lista = null;
    try { lista = await apiEfectivo.movimientos(turnoId, false); } catch { lista = null; }
    if (!vivo) return 'sin-zona';
    if (!lista) return 'duda';
    const ya = lista.some((m) => m.tipo === tipo && cents(m.monto) === cents(monto) && String(m.motivo || '').trim() === motivo && !m.anulada
      && (antes ? !antes.has(m.id) : t0 - new Date(m.creado_en).getTime() < 3 * 60 * 1000));
    return ya ? 'si' : 'no';
  }

  async function guardar() {
    if (enviando || !tarjeta || !vivo) return;
    const tipo = abierta, T = TIPOS[tipo];
    const v = validar();
    if (!v) return;
    const { monto, motivo } = v;
    const t = tarjeta;
    enviando = true; pintarBotonGuardar();
    const mismaDuda = duda && duda.tipo === tipo && duda.c === cents(monto) && duda.motivo === motivo;
    const antes = mismaDuda ? duda.antes : baseline();
    try {
      if (mismaDuda) {
        // Antes se intentó guardar y no se supo el resultado: primero se mira si quedó, y solo si no quedó se vuelve a enviar
        const r = await comprobarGuardado(tipo, monto, motivo, antes);
        if (r === 'sin-zona') return;
        if (r === 'duda') { avisarGeneral(t, 'Todavía no hay conexión. No la guarde otra vez: toque «Revisar si quedó guardada» cuando vuelva.'); return; }
        duda = null;
        if (r === 'si') { exito(tipo, monto); return; }
        avisarGeneral(t, 'No se había guardado. Ya puede tocar «' + T.guardar + '» para intentarlo de nuevo.');
        return;
      }
      await apiEfectivo.registrar(tipo, turnoId, monto, motivo);
      duda = null;
      exito(tipo, monto);
    } catch (e) {
      if (!vivo) { return; }
      if (esTransitorio(e)) {
        const r = await comprobarGuardado(tipo, monto, motivo, antes);
        if (r === 'si') { exito(tipo, monto); return; }
        if (!vivo) return;
        if (r === 'no') { duda = null; avisarGeneral(t, 'No se guardó: hubo un problema de conexión y no quedó anotado nada. Toque «' + T.guardar + '» para intentarlo de nuevo.'); return; }
        duda = { tipo, c: cents(monto), motivo, antes };
        avisarGeneral(t, 'No hay conexión y no se pudo comprobar si quedó guardada. No la guarde otra vez todavía: toque «Revisar si quedó guardada».');
        return;
      }
      avisarGeneral(t, conPunto(textoError(e, 'No se pudo guardar. Intente de nuevo; si sigue igual, avise a la persona encargada.')));
    } finally {
      enviando = false;
      if (tarjeta === t) pintarBotonGuardar();
    }
  }
  function avisarGeneral(t, texto) {
    if (tarjeta !== t) return;
    t.msgGeneral.textContent = texto; t.msgGeneral.hidden = false;
  }

  function exito(tipo, monto) {
    borradores[tipo] = { monto: '', motivo: '' };
    duda = null;
    enviando = false;
    // La persona cambió de pantalla con el guardado en camino: el resultado se avisa igual
    if (!vivo) { toast(TIPOS[tipo].titulo + ' guardada: ' + colones(monto) + '.'); return; }
    cerrarTarjeta();
    mostrarGuardado(tipo, monto);
    refrescar();
    try { alCambiar?.(tipo); } catch { /* quien escucha no debe romper el guardado */ }
  }

  /* --- Lista de movimientos del turno --- */
  function abrirMovimientos() {
    if (sinTurno) return;
    const cuerpo = h('div.col.efz-movs', esqueleto(2, 'Cargando los movimientos…'));
    let abierto = true;
    modal({ titulo: 'Movimientos de efectivo de este turno', ancho: 640, contenido: cuerpo,
      botones: [{ texto: 'Listo, cerrar', clase: 'primario', onclick: (c) => c() }], alCerrar: () => { abierto = false; } });
    async function cargar() {
      try {
        const l = await apiEfectivo.movimientos(turnoId, true);
        if (!abierto) return;
        cuerpo.replaceChildren(...pintarLista(l));
      } catch (e) {
        if (!abierto) return;
        cuerpo.replaceChildren(h('div.error-caja', { role: 'alert' }, conPunto(textoError(e, 'No se pudieron leer los movimientos. Revise la conexión e intente de nuevo.'))),
          h('button.btn.primario', { type: 'button', onclick: () => { cuerpo.replaceChildren(esqueleto(2, 'Cargando los movimientos…')); cargar(); } }, 'Intentar de nuevo'));
      }
    }
    function pintarLista(l) {
      const vivos = l.filter((m) => !m.anulada);
      const tot = (tipo) => vivos.filter((m) => m.tipo === tipo).reduce((s, m) => s + Number(m.monto || 0), 0);
      if (!l.length) return [h('p.tenue', 'Todavía no hay entradas ni salidas de efectivo en este turno.')];
      const hoy = fechaCR(new Date());
      const items = [...l].reverse().map((m) => {
        const entrada = m.tipo === 'entrada';
        const T = TIPOS[m.tipo];
        const quien = m.creado_por_nombre || m.creado_por || '';
        const cuando = (fechaCR(m.creado_en) === hoy ? '' : fechaCorta(m.creado_en) + ' ') + horaCorta(m.creado_en);
        return h('li.efz-mov.' + m.tipo + (m.anulada ? '.anulada' : ''),
          h('div.efz-mov-txt',
            h('div.efz-mov-linea', h('span.efz-etiqueta.' + m.tipo, h('span', { 'aria-hidden': 'true' }, T.signo + ' '), T.palabra), h('span.efz-cuando', cuando + (quien ? ' · ' + quien : ''))),
            h('div.efz-mov-motivo', m.motivo),
            m.anulada ? h('div.efz-mov-anulada', h('span.chip.espera', 'Anulada'), ' ', (m.anulada_por ? 'por ' + m.anulada_por : '') + (m.anulada_motivo ? ': ' + m.anulada_motivo : '')) : null),
          h('div.efz-mov-der',
            h('div.efz-mov-cifra', { 'aria-label': T.palabra + ' de ' + colones(m.monto) + (m.anulada ? ', anulada' : '') }, T.signo + ' ' + colones(m.monto)),
            !m.anulada ? h('button.btn.peligro.efz-anular', { type: 'button', 'aria-label': 'Anular ' + (entrada ? 'la entrada' : 'la salida') + ' de ' + colones(m.monto) + ' por ' + m.motivo,
              onclick: async () => { if (await anularMovimiento(m)) { if (abierto) cargar(); refrescar(); try { alCambiar?.(m.tipo); } catch { /* nada */ } } } }, 'Anular') : null));
      });
      return [
        h('p.efz-movs-tot', h('span', 'Entradas vigentes: ', h('strong', '+ ' + colones(tot('entrada')))), h('span', 'Salidas vigentes: ', h('strong', '− ' + colones(tot('salida'))))),
        h('ul.efz-lista', { 'aria-label': 'Entradas y salidas de efectivo de este turno, la más reciente primero' }, items)];
    }
    cargar();
  }

  /* --- Vida de la zona --- */
  const alVolver = () => { if (!document.hidden && datos && Date.now() - datos.leidoEn.getTime() > 30000) refrescar(); };
  document.addEventListener('visibilitychange', alVolver);
  timers.push(setInterval(() => { if (!document.hidden) refrescar(); }, 60000));
  pintar();
  refrescar();

  return {
    el,
    refrescar,
    destruir() {
      vivo = false;
      timers.forEach(clearInterval);
      Object.values(timersOk).forEach(clearTimeout);
      document.removeEventListener('visibilitychange', alVolver);
      el.remove();
    },
  };
}
