// Apertura y cierre de caja para la persona de caja (cierre ciego).
// Regla de Emil (1 nov 2026): la cajera nunca sabe cuánto debe haber en la caja ni si le sobra dinero. Solo se le avisa si FALTA, después de que ella cuenta.
// Aquí no hay totales vendidos, ni «debe haber», ni diferencias, ni historial de cierres: solo la apertura o el cierre de ESTE turno.
// El servidor tampoco manda esas cifras a quien no es administrador (fx_turno_estado, fx_turnos), así que no están ni siquiera escondidas en la pantalla.
import { h, money, leerNumero, toast, modal, fechaCorta, horaCorta, esqueleto, bloqueError, nombreLocal, conPunto, hoyCR } from './util.js';
import { esTransitorio } from './api.js';
import { textoError } from './api_efectivo.js';
import { anularSalida, anularEntrada, listaSalidas } from './ui_salidas.js';
import { crearZonaEfectivo } from './ui_efectivo_rapido.js';
import { crearFormularioApertura } from './ui_apertura.js';
import { imprimirNodo, nodoApertura, nodoVale, nodoCierreCajera, imprimirValeAuto, imprimirCierreAuto } from './imprimir_caja.js';

const MAX_NOTAS = 200;
const TOPE = 99999999.99;
const ymdDe = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Costa_Rica' }).format(new Date(iso));
const fechaPartida = (d) => (d ? [h('span.nw', fechaCorta(d) + ','), ' ', h('span.nw', horaCorta(d))] : '');
// «Faltan ₡5 000,00 en la caja…» -> 5000 (el servidor escribe el monto en el mensaje)
const montoDelMensaje = (m) => { const x = /₡\s*([\d\s\u00a0.]+(?:,\d+)?)/.exec(String(m || '')); return x ? Number(x[1].replace(/[\s\u00a0.]/g, '').replace(',', '.')) || 0 : 0; };
const rechazoPorCuentas = (e) => !!e && !esTransitorio(e) && (e.hint === 'cuentas_abiertas' || /cuentas? abiertas?/i.test(e.message || ''));
const faltaDe = (e) => !!e && !esTransitorio(e) && e.hint === 'faltante';
const conteoBajoDe = (e) => !!e && !esTransitorio(e) && e.hint === 'conteo_bajo';
// Decisión de Emil (3 nov 2026): si lo contado es muy bajo (no pasa de lo que ya había al abrir, más entradas, menos salidas), el servidor solo dice que no coincide. Nunca se muestra un monto aquí.
const TXT_RECONTAR = 'El conteo no coincide. Vuelva a contar el efectivo de la caja y escriba el total otra vez.';

export async function montarCajera(root, app) {
  const api = app.api, socId = app.soc.id, soc = app.soc;
  let vivo = true, final = null, turnoVisto = null, est = null, abiertas = [];
  let zona = null, contadoTxt = '', notas = '', mensaje = '', cerrando = false, nCarga = 0;
  const contenedor = h('div.turno');
  root.append(contenedor);
  const soltar = () => { zona?.destruir(); zona = null; };

  const turnoActual = () => ({ ...(app.turno || {}), ...(est?.turno || {}), terminal: app.terminal || est?.turno?.terminal || 1 });
  const quienSoy = () => app.ctx?.nombre || app.usuario || '';
  const valeDe = (v) => imprimirValeAuto(soc, turnoActual(), { ...v, quien: quienSoy(), cuando: new Date() }).catch(() => false);

  async function cargar() {
    const mi = ++nCarga;
    turnoVisto = app.turno?.id || null;
    soltar();
    contenedor.replaceChildren(esqueleto(3, 'Cargando la caja…'));
    let e = null, ab = [];
    try {
      [e, ab] = await Promise.all([turnoVisto ? api.turnoEstado(turnoVisto) : null, turnoVisto ? api.ventasAbiertas(socId) : []]);
    } catch (er) {
      if (!vivo || mi !== nCarga) return;
      contenedor.replaceChildren(bloqueError({ titulo: 'No se pudo cargar la caja', mensaje: conPunto(textoError(er, 'Revise la conexión e intente de nuevo.')), alReintentar: () => cargar() }));
      return;
    }
    if (!vivo || mi !== nCarga) return;
    if (turnoVisto && e?.turno?.cerrado_en) { try { await app.refrescar(); } catch { /* sin conexión */ } turnoVisto = null; e = null; ab = []; }
    est = e; abiertas = ab || [];
    pintar();
  }

  function pintar() {
    if (!vivo) return;
    soltar();
    contenedor.replaceChildren(
      h('p.tenue.mt-intro', nombreLocal(soc) + '. Un turno empieza cuando se abre la caja y termina cuando se cierra, aunque cruce la medianoche.'),
      final ? seccionFinal() : (turnoVisto && est ? seccionAbierta() : seccionSinTurno()));
  }

  /* ---------- Caja cerrada: abrir ---------- */
  function seccionSinTurno() {
    const form = crearFormularioApertura({
      api, socId, terminal: app.terminal, local: nombreLocal(soc), soc,
      alAbrir: async (res, monto) => {
        try { await app.refrescar(); } catch { toast('La caja se abrió, pero no se pudo actualizar la pantalla. Toque «Abrir caja» otra vez: el sistema no abre otra.', 'error', 9000); }
        if (res && res.ya_abierto) toast('La caja ya estaba abierta (la abrió ' + (res.abierto_por || 'otra persona') + ') con ' + money(res.fondo_inicial ?? 0) + '. No se cambió el efectivo con que abrió.', 'ok', 9000);
        else toast('Caja abierta con ' + money(monto) + '.');
      } });
    return h('section.col',
      h('h2', 'La caja está cerrada'),
      h('p.tenue', 'No hay un turno abierto en ' + nombreLocal(soc) + '. Para vender hay que abrir la caja: escriba el efectivo con que empieza.'),
      form.el);
  }

  /* ---------- Turno abierto ---------- */
  async function recargar() {
    if (!turnoVisto) return;
    const mi = ++nCarga, id = turnoVisto;
    let e;
    try { e = await api.turnoEstado(id); } catch (er) { if (mi === nCarga) toast(conPunto(textoError(er, 'No se pudieron actualizar los movimientos.')), 'error'); return; }
    if (mi !== nCarga || id !== turnoVisto || final) return;
    if (e?.turno?.cerrado_en) { await cargar(); return; }
    est = e; pintarMovimientos();
  }
  let slotMov = null;
  const alAnular = (anular) => async (m) => { if (await anular(m)) { await recargar(); zona?.refrescar(); } };
  function pintarMovimientos() {
    if (!slotMov || !slotMov.isConnected) return;
    const entradas = est.entradas || [], salidas = est.salidas || [];
    slotMov.replaceChildren(...[
      h('div.calc-fila', h('span', 'Efectivo con que abrió la caja'), h('span.v', money(est.fondo ?? est.turno?.fondo_inicial ?? 0))),
      entradas.length ? h('div', h('h4', 'Entradas de efectivo'), listaSalidas(entradas, alAnular(anularEntrada), 'entrada'), reimpresiones(entradas, 'entrada')) : null,
      salidas.length ? h('div', h('h4', 'Salidas de efectivo'), listaSalidas(salidas, alAnular(anularSalida), 'salida'), reimpresiones(salidas, 'salida')) : null].filter(Boolean));
  }

  // Los vales salen solos al registrarlos; esto es solo para volver a imprimir uno (sale marcado como copia)
  const reimpresiones = (lista, tipo) => h('div.col', lista.map((m) => h('button.btn', { type: 'button',
    onclick: () => imprimirNodo(nodoVale(soc, turnoActual(), { tipo, monto: m.monto, motivo: m.motivo, quien: m.creado_por || m.usuario, cuando: m.creado_en || m.fecha, id: m.id }, true), tipo === 'entrada' ? 'Vale de entrada' : 'Vale de salida') },
    'Volver a imprimir el vale de ' + money(m.monto) + (m.motivo ? ' (' + m.motivo + ')' : ''))));

  function seccionAbierta() {
    const t = est.turno;
    const inp = h('input.campo.monto-grande', { type: 'text', inputmode: 'decimal', placeholder: '0', value: contadoTxt, autocomplete: 'off', 'aria-label': 'Efectivo que hay en la caja ahora' });
    inp.addEventListener('input', () => { contadoTxt = inp.value; });
    const txtNotas = h('textarea.campo', { rows: 2, maxlength: MAX_NOTAS, placeholder: 'Ej. se pagó al proveedor de hielo', value: notas.slice(0, MAX_NOTAS), 'aria-label': 'Notas del cierre' });
    txtNotas.addEventListener('input', () => { notas = txtNotas.value.slice(0, MAX_NOTAS); });
    const err = h('div.error-caja', { hidden: !mensaje, role: 'alert' }, mensaje);
    const btn = h('button.btn.primario.grande', { type: 'button' }, 'Cerrar caja');
    const ocupado = (si) => { btn.disabled = si; btn.textContent = si ? 'Revisando…' : 'Cerrar caja'; };
    const fallo = (txt) => { mensaje = txt; err.textContent = txt; err.hidden = false; toast(txt, 'error', 9000); };
    const leer = () => { const x = contadoTxt.trim(); if (!x) return null; const v = leerNumero(x); return Number.isFinite(v) && v >= 0 && v <= TOPE ? v : NaN; };

    btn.addEventListener('click', async () => {
      if (btn.disabled || cerrando) return;
      err.hidden = true; mensaje = '';
      const v = leer();
      if (v == null) { fallo('Escriba cuánto efectivo hay en la caja ahora. Si no hay nada, escriba 0.'); inp.focus(); return; }
      if (Number.isNaN(v)) { fallo('Ese monto no es válido. Escriba solo números, por ejemplo 15000.'); inp.focus(); return; }
      ocupado(true);
      try { await revisar(v); }
      catch (e) {
        fallo(esTransitorio(e)
          ? 'No hay conexión para revisar la caja. No se cerró nada. Revise internet y toque «Cerrar caja» otra vez.'
          : conPunto(textoError(e, 'No se pudo revisar la caja. No se cerró nada. Intente de nuevo; si sigue igual, avise a la persona encargada.')));
      } finally { ocupado(false); }
    });

    const avisoAbiertas = abiertas.length ? h('div.aviso-abiertas',
      h('strong', 'Hay ' + abiertas.length + (abiertas.length === 1 ? ' cuenta abierta sin cobrar' : ' cuentas abiertas sin cobrar')),
      h('span', 'Antes de cerrar hay que cobrarlas o anularlas.'),
      h('div.fila', h('button.btn', { type: 'button', onclick: () => app.ir('caja') }, 'Volver a Facturación a cobrarlas'))) : null;
    const avisoOtroDia = ymdDe(t.abierto_en) < hoyCR() ? h('div.aviso-abiertas', { role: 'note' },
      h('strong', 'Esta caja se abrió el ' + fechaCorta(t.abierto_en) + ' y sigue abierta'),
      h('span', 'Si ya terminó el trabajo de ese día, cuente el efectivo y ciérrela.')) : null;

    zona = crearZonaEfectivo({ turnoId: turnoVisto, conPie: false, enFlujo: true,
      motivos: { entrada: app.ctx?.motivos_entrada_efectivo, salida: app.ctx?.motivos_salida_efectivo },
      alCambiar: () => recargar(), alGuardar: valeDe });
    slotMov = h('div.calc');
    const sec = h('section.col',
      h('div.fila.sep', h('h2', 'Turno abierto'), h('button.btn', { type: 'button', onclick: () => app.ir('caja') }, 'Ir a Facturación a vender')),
      avisoOtroDia,
      h('div.turno-datos',
        h('div.dato', h('div.et', 'Abrió'), h('div.val', fechaPartida(t.abierto_en)), h('div.det', t.abierto_por || '')),
        h('div.dato', h('div.et', 'Efectivo con que abrió'), h('div.val', money(est.fondo ?? t.fondo_inicial ?? 0))),
        h('div.dato', h('div.et', 'Cuentas abiertas'), h('div.val', String(abiertas.length)), h('div.det', abiertas.length ? 'Sin cobrar' : 'Todo cobrado'))),
      avisoAbiertas,
      h('div.tarjeta',
        h('h3', 'Dinero que entra o sale de la caja'),
        h('p.tenue-linea', 'Anote aquí el dinero que entra o sale y no es una venta ni un vuelto: sencillo, pago a un proveedor, compra de hielo. Cada anotación imprime un vale.'),
        zona.el,
        slotMov),
      h('div.tarjeta',
        h('h3', 'Cerrar la caja'),
        h('div.contado-caja',
          h('label.etq', 'Efectivo que hay en la caja ahora (₡)', h('small', 'Cuente los billetes y monedas y escriba el total.'), inp))),
      h('label.etq', 'Notas del cierre (opcional)', txtNotas),
      err,
      h('div.fila', btn,
        h('button.btn', { type: 'button', onclick: () => imprimirNodo(nodoApertura(soc, turnoActual(), true), 'Apertura de caja') }, 'Imprimir tiquete de apertura'),
        h('button.btn', { type: 'button', onclick: () => cargar() }, 'Actualizar')));
    pintarMovimientos();
    return sec;
  }

  /* ---------- Cierre ---------- */
  async function revisar(contado) {
    const [fresco, lista] = await Promise.all([api.turnoEstado(turnoVisto), api.ventasAbiertas(socId)]);
    if (fresco?.turno?.cerrado_en) { await terminar(fresco, true); return; }
    if ((lista || []).length) { abiertas = lista; pintar(); toast('Hay cuentas abiertas. Cóbrelas o anúlelas antes de cerrar la caja.', 'error', 9000); return; }
    // El servidor compara y solo contesta cuánto falta (si falta). Nunca dice cuánto debía haber. Si el conteo es demasiado bajo, solo dice que no coincide (sin monto) y no deja cerrar.
    const r = await api.turnoConteo(turnoVisto, contado);
    if (r?.recontar) { mensaje = TXT_RECONTAR; toast(TXT_RECONTAR, 'error', 9000); pintar(); return; }
    const falta = Number(r?.faltante) > 0 ? Number(r.faltante) : 0;
    if (falta > 0) { preguntarFaltante(falta, contado); return; }
    await cerrar(contado, false);
  }

  function preguntarFaltante(falta, contado) {
    let decidido = false;
    modal({ titulo: 'Revise el conteo', ancho: 520, alCerrar: () => {},
      contenido: h('div.col',
        h('div.alerta-dif.falta', 'Faltan ' + money(falta) + ' en la caja.', h('small', 'Usted contó ' + money(contado) + '.')),
        h('p.tenue-linea', 'Puede contar otra vez o cerrar así. Si cierra, el faltante queda anotado en el cierre y en el tiquete.')),
      botones: [
        { texto: 'Cerrar de todos modos', clase: 'peligro', onclick: async (c) => { if (decidido) return; decidido = true; c(); await cerrar(contado, true); } },
        { texto: 'Volver a contar', clase: 'primario', onclick: (c) => c() }] });
  }

  async function cerrar(contado, acepta) {
    if (cerrando) return;
    cerrando = true;
    try {
      let res;
      try { res = await api.turnoCerrar(turnoVisto, { efectivo: contado, notas: notas.trim() || null, aceptaFaltante: acepta }); }
      catch (e) {
        if (faltaDe(e)) { preguntarFaltante(montoDelMensaje(e.message), contado); return; }
        if (conteoBajoDe(e)) { mensaje = TXT_RECONTAR; toast(TXT_RECONTAR, 'error', 9000); pintar(); return; }
        if (rechazoPorCuentas(e)) { toast('Hay cuentas abiertas. Cóbrelas o anúlelas antes de cerrar la caja.', 'error', 9000); await cargar(); return; }
        let cerrada = null;
        if (/ya est[aá] cerrado/i.test(e.message || '') || esTransitorio(e)) { try { const t = await api.turnoEstado(turnoVisto); if (t?.turno?.cerrado_en) cerrada = t; } catch { /* sin conexión */ } }
        if (cerrada) { await terminar(cerrada, true); return; }
        const m = esTransitorio(e)
          ? 'No se pudo cerrar la caja por la conexión. La caja sigue abierta. Revise internet y toque «Cerrar caja» otra vez.'
          : conPunto('No se pudo cerrar la caja. ' + textoError(e, 'Intente de nuevo; si sigue igual, avise a la persona encargada.')) + ' La caja sigue abierta.';
        mensaje = m; toast(m, 'error', 9000); pintar();
        return;
      }
      await terminar(res, false);
    } finally { cerrando = false; }
  }

  async function terminar(res, yaEstaba) {
    final = res; mensaje = ''; contadoTxt = ''; notas = '';
    try { await app.refrescar(); } catch { /* la cabecera se pone al día sola */ }
    turnoVisto = null; est = null; abiertas = [];
    pintar();
    window.scrollTo({ top: 0 });
    toast(yaEstaba ? 'Esta caja ya estaba cerrada.' : 'Caja cerrada.');
    if (!yaEstaba) imprimirCierreAuto(soc, res).catch((e) => console.warn('No se pudo imprimir el tiquete del cierre:', e)); // sin esperar el cuadro de impresión; queda el botón
  }

  function seccionFinal() {
    const t = final.turno || {};
    const falto = Number(t.faltante_reconocido) > 0;
    return h('section.resumen-final',
      h('h2', '✓ Caja cerrada'),
      h('div.turno-datos',
        h('div.dato', h('div.et', 'Cerró'), h('div.val', fechaPartida(t.cerrado_en)), h('div.det', t.cerrado_por || '')),
        h('div.dato', h('div.et', 'Efectivo contado'), h('div.val', money(final.contado_efectivo ?? t.contado_efectivo ?? 0)))),
      falto ? h('div.alerta-dif.falta', 'Faltante reconocido: ' + money(t.faltante_reconocido) + '.') : null,
      h('div.fila',
        h('button.btn.primario.grande', { type: 'button', onclick: () => imprimirNodo(nodoCierreCajera(soc, final, true), 'Cierre de caja') }, 'Imprimir tiquete del cierre'),
        h('button.btn.grande', { type: 'button', onclick: () => app.ir('caja') }, 'Abrir una caja nueva')));
  }

  const alCambio = () => { if (vivo && !final && (app.turno?.id || null) !== turnoVisto) cargar(); };
  document.addEventListener('app:cambio', alCambio);
  await cargar();
  return () => { vivo = false; soltar(); document.removeEventListener('app:cambio', alCambio); };
}
