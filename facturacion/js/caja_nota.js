// La caja y las notas: lo que la pantalla dice y hace ANTES de enviar una nota que mueve efectivo. Lo usan las notas parciales (m_nota_parcial.js) y Anular (m_anular.js),
// para que las dos hablen igual y hagan lo mismo.
// Regla de la base (28c): una nota que mueve EFECTIVO (devuelve o cobra) exige un turno abierto en esa terminal, porque ese dinero tiene que quedar en un cierre de caja
// («Abra la caja para devolver efectivo…»). Una nota que no mueve efectivo (todo por tarjeta, SINPE Móvil o transferencia) se puede hacer con la caja cerrada:
// no entra en ningún cierre y en Informes sale como «sin turno».
// El turno se pregunta al servidor al revisar (no se confía en lo que quedó en pantalla): puede haberse abierto o cerrado desde otro aparato.
import { h, money, modal, toast, nombreLocal } from './util.js';
import { crearFormularioApertura } from './ui_apertura.js';

if (!document.querySelector('link[data-fx-nota-parcial]')) document.head.append(h('link', { rel: 'stylesheet', href: new URL('../css/nota_parcial.css', import.meta.url).href, 'data-fx-nota-parcial': '1' })); // el estilo de .np-caja vive allí

const TOPE_LECTURA = 8000; // una lectura de comprobación no espera más que esto
class TopeDeEspera extends Error { constructor(m) { super(m); this.tipo = 'tiempo'; this.transitorio = true; } }
const conTope = (promesa, ms = TOPE_LECTURA) => new Promise((ok, mal) => {
  const t = setTimeout(() => mal(new TopeDeEspera('La respuesta tardó demasiado. Intente de nuevo.')), ms);
  Promise.resolve(promesa).then((v) => { clearTimeout(t); ok(v); }, (e) => { clearTimeout(t); mal(e); });
});

// Céntimos enteros: todo el dinero se compara en enteros para no arrastrar decimales
export const aCent = (n) => Math.round((Number(n) + Number.EPSILON) * 100) || 0;
// Efectivo (en céntimos) de un reparto de pagos [{ medio, monto }]. La base cuenta igual: medio «efectivo» sin importar mayúsculas ni espacios.
export const efectivoDe = (pagos) => (Array.isArray(pagos) ? pagos : []).filter((p) => String(p?.medio || '').toLowerCase().trim() === 'efectivo').reduce((a, p) => a + aCent(p.monto), 0);

// 'abierto' | 'cerrado' | 'desconocido' (si la lectura falla no se afirma nada en ningún sentido)
export async function leerTurno(app) {
  try {
    const c = await conTope(app.api.contexto());
    const soc = (c?.sociedades || []).find((x) => x.id === app.socId);
    return soc ? (soc.turno ? 'abierto' : 'cerrado') : 'desconocido';
  } catch { return 'desconocido'; }
}

// «esta nota» o «esta anulación»: el resto de la frase es igual en las dos pantallas
const esta = (anulacion) => (anulacion ? 'Esta anulación' : 'Esta nota');
export const avisoSinTurno = ({ anulacion = false } = {}) => `La caja está cerrada. ${esta(anulacion)} no mueve efectivo, así que se puede hacer igual: no entra en ningún cierre de caja y en Informes aparece como «sin turno».`;
export const avisoSinTurnoHecha = ({ anulacion = false } = {}) => `La caja estaba cerrada. ${esta(anulacion)} no movió efectivo, así que no entra en ningún cierre de caja y en Informes aparece como «sin turno».`;
export const AVISO_TURNO_DESCONOCIDO = 'No se pudo comprobar si hay un turno abierto.';
// Anular no puede cambiar «por dónde» se devuelve el dinero (se devuelve por el mismo medio con que se pagó): la frase del reparto solo va en las notas parciales
export const textoSinCaja = (efeCent, { credito = true, anulacion = false } = {}) => `La caja está cerrada y ${anulacion ? 'esta anulación' : 'esta nota'} ${credito ? 'devuelve' : 'cobra'} ${moneyC(efeCent)} en efectivo. Ese dinero tiene que quedar en el cierre de caja, por eso primero hay que abrir la caja.`
  + (anulacion ? '' : ' Si una parte se puede mover por tarjeta, SINPE Móvil o transferencia, también puede cambiar el reparto.');
export const TEXTO_CAJA_PIE = 'Mientras la caja esté cerrada no se puede devolver ni cobrar efectivo. Abra la caja o cambie el reparto.';
export const TEXTO_CAJA_PIE_ANULAR = 'Mientras la caja esté cerrada no se puede anular un documento que se pagó en efectivo. Abra la caja primero.';
const moneyC = (c) => money(c / 100);

// Llena el recuadro de la caja (un <div class="np-caja">). Devuelve true si la caja bloquea la nota (cerrada y con efectivo).
//   turno: 'abierto' | 'cerrado' | 'desconocido'. efeCent: efectivo que mueve la nota (céntimos) o null si no se sabe cómo se pagó.
//   abrir: lo que hace el botón «Abrir la caja ahora».
export function pintarAvisoCaja(cajaEl, { turno, efeCent, credito = true, anulacion = false, abrir }) {
  cajaEl.replaceChildren(); cajaEl.hidden = true; cajaEl.className = 'np-caja';
  const bloquea = turno === 'cerrado' && efeCent > 0;
  if (bloquea) {
    cajaEl.className = 'np-caja alto'; cajaEl.hidden = false;
    cajaEl.append(h('p', h('b', 'Primero hay que abrir la caja. '), textoSinCaja(efeCent, { credito, anulacion })),
      h('button.btn.primario', { type: 'button', 'data-abrir-caja': '1', onclick: () => abrir?.() }, 'Abrir la caja ahora'));
  } else if (turno === 'cerrado' && efeCent == null) {
    // Cerrada y no se sabe cómo se pagó: no se bloquea (la base decide), pero se dice la regla para que nadie se sorprenda
    cajaEl.className = 'np-caja info'; cajaEl.hidden = false;
    cajaEl.append(h('p', 'La caja está cerrada y no se pudo ver cómo se pagó. Si se pagó en efectivo, el sistema no deja seguir hasta abrir la caja.'),
      h('button.btn', { type: 'button', 'data-abrir-caja': '1', onclick: () => abrir?.() }, 'Abrir la caja ahora'));
  } else if (turno === 'cerrado') { cajaEl.className = 'np-caja info'; cajaEl.hidden = false; cajaEl.append(h('p', avisoSinTurno({ anulacion }))); }
  else if (turno === 'desconocido') { cajaEl.className = 'np-caja info'; cajaEl.hidden = false; cajaEl.append(h('p', AVISO_TURNO_DESCONOCIDO)); }
  return bloquea;
}

// Abre la caja desde aquí mismo con el formulario de «Apertura y cierre de caja» (ui_apertura.js), sin perder lo que se está revisando.
//   alAbrir(turno): se llama cuando el servidor confirmó y ya se volvió a leer el turno ('abierto' | 'cerrado' | 'desconocido').
//   sigue(): false si la ventana de abajo ya se cerró (entonces no se abre nada). textoOk: lo que dice el aviso breve cuando la caja quedó abierta.
let abriendoCaja = false;
export async function abrirCajaAhora(app, { alAbrir, sigue = () => true, textoOk = 'Caja abierta. Ya puede confirmar la nota.' } = {}) {
  if (abriendoCaja) return;
  abriendoCaja = true;
  try {
    const terminal = Number.isInteger(app?.terminal) ? app.terminal : 1;
    let sugerido = null;
    try { const sg = await conTope(app.api.turnoSugerencia(app.socId, terminal)); const uc = sg?.ultimo_cierre; if (sg && sg.origen === 'contado' && uc?.cerrado_en && sg.sugerido != null) sugerido = { monto: Number(sg.sugerido), cuando: uc.cerrado_en }; } catch { /* sin sugerencia: la persona escribe el monto */ }
    if (!sigue()) return;
    const form = crearFormularioApertura({ api: app.api, socId: app.socId, terminal, local: nombreLocal(app.soc), sugerido,
      alAbrir: async () => {
        v.cerrar();
        try { await app.refrescar(); } catch { /* la cabecera se pone al día sola */ }
        const turno = await leerTurno(app);
        if (sigue()) {
          toast(turno === 'abierto' ? textoOk : 'No se pudo comprobar que la caja quedó abierta. Revise «Apertura y cierre de caja».', turno === 'abierto' ? 'ok' : 'error', 5000);
          await alAbrir?.(turno);
        }
      } });
    const v = modal({ titulo: 'Abrir la caja', ancho: 460, contenido: form.el });
    form.enfocar();
  } finally { abriendoCaja = false; }
}
