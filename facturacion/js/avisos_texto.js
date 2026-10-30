// Textos de los avisos de efectivo por WhatsApp, según lo que de verdad dice la base (fx_avisos_resumen): modo 'simulado' | 'real', personas activas, pendientes y con error.
// Una sola fuente para la pantalla Avisos y para las líneas de «Guardado» de las entradas y salidas: ningún texto promete un aviso que el sistema todavía no envía.
// Funciones puras (sin pantalla) para poder probarlas con respuestas simuladas.

export const NOTA_SIMULADO = 'Los avisos por WhatsApp todavía no se envían de verdad; el sistema los registra y los enviará cuando se active el envío.';

// Los eventos que la base sabe avisar (fact.avisos_eventos(); fx_avisos_destinatario_guardar solo acepta estos cinco). `nuevo`: viene marcado al agregar una persona (fact.avisos_eventos_por_defecto()).
// devolucion_efectivo: la base lo genera cuando se emite una nota de crédito que devuelve efectivo (anulación, devolución o corrección; trigger sobre fact.comprobantes).
export const EVENTOS = [
  { clave: 'salida', titulo: 'Salidas de efectivo', ayuda: 'Cada vez que sale dinero de la caja.', nuevo: true },
  { clave: 'entrada', titulo: 'Entradas de efectivo', ayuda: 'Cada vez que entra dinero a la caja y no es una venta.', nuevo: true },
  { clave: 'anulacion_movimiento', titulo: 'Anulaciones de salidas y entradas', ayuda: 'Cuando se anula una salida o una entrada ya anotada.', nuevo: true },
  { clave: 'devolucion_efectivo', titulo: 'Devolución de efectivo por una nota de crédito', ayuda: 'Cuando se devuelve efectivo al cliente con una nota de crédito: una anulación, una devolución o una corrección de monto.', nuevo: true },
  { clave: 'cierre_con_diferencia', titulo: 'Cierre de caja con diferencia', ayuda: 'Cuando el efectivo contado no coincide con el que debía haber.', nuevo: false },
];
export const TITULO_EVENTO = Object.fromEntries(EVENTOS.map((e) => [e.clave, e.titulo]));
// Para no avisar dos veces lo mismo: la devolución de efectivo con nota de crédito ya avisa sola, no hay que anotarla además como salida de efectivo.
export const NOTA_DEVOLUCIONES = 'Una devolución de efectivo hecha con una nota de crédito avisa por sí sola: no hace falta anotarla además como salida de efectivo.';
const CUENTA = ['', 'una', 'dos', 'tres', 'cuatro', 'cinco', 'seis'];
export const cuantasCosas = () => (CUENTA[EVENTOS.length] || String(EVENTOS.length)) + (EVENTOS.length === 1 ? ' cosa' : ' cosas');

const entero = (x) => { const n = Math.floor(Number(x)); return Number.isFinite(n) && n > 0 ? n : 0; };
const personas = (n) => n + (n === 1 ? ' persona' : ' personas');

// Deja fx_avisos_resumen en una forma segura. null si no es un objeto.
export function estadoAvisos(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  return {
    modo: r.modo === 'real' ? 'real' : 'simulado',
    personas: entero(r.destinatarios_activos), pendientes: entero(r.pendientes), conError: entero(r.con_error), hoy: entero(r.hoy),
    emisor: typeof r.numero_emisor === 'string' ? r.numero_emisor.trim() : '', emisorListo: r.emisor_configurado === true,
    plantilla: typeof r.texto_plantilla === 'string' ? r.texto_plantilla : '', negocio: typeof r.negocio === 'string' ? r.negocio : '',
    admin: r.puede_administrar === true,
  };
}

// La frase de arriba de la pantalla: { nivel: 'ambar' | 'verde' | 'rojo', titulo, texto }
export function resumenDeEstado(e) {
  if (!e) return null;
  if (e.conError > 0) {
    return { nivel: 'rojo', titulo: e.conError === 1 ? 'Hay 1 aviso que no se pudo enviar' : 'Hay ' + e.conError + ' avisos que no se pudieron enviar',
      texto: e.modo === 'simulado' ? NOTA_SIMULADO : 'Toque «Reintentar» para que el sistema los envíe otra vez.' };
  }
  if (e.modo === 'simulado') {
    return { nivel: 'ambar', titulo: 'Los avisos están en modo de prueba', texto: NOTA_SIMULADO + (e.personas === 0 ? ' Además, todavía no hay nadie que reciba avisos.' : '') };
  }
  return e.personas === 0
    ? { nivel: 'ambar', titulo: 'El envío por WhatsApp está activo', texto: 'Pero todavía no hay nadie que reciba avisos. Toque «Agregar persona».' }
    : { nivel: 'verde', titulo: 'Los avisos se envían por WhatsApp', texto: 'Le llegan a ' + personas(e.personas) + (e.emisor ? ', desde el número ' + e.emisor : '') + '.' };
}

// La línea que sale después de guardar o anular un movimiento de efectivo. Sin saber el estado (no se pudo leer), solo «Guardado.».
export function textoGuardado(e) {
  if (!e) return 'Guardado.';
  if (e.personas === 0) return 'Guardado. Todavía no hay nadie configurado para recibir avisos de efectivo.';
  if (e.modo === 'simulado') return 'Guardado. Los avisos por WhatsApp todavía no se envían de verdad: el sistema lo registra.';
  return 'Guardado. El sistema envía el aviso por WhatsApp a ' + personas(e.personas) + '.';
}
// La línea de la ventana de anular
export function textoAnular(e) {
  if (!e) return '';
  if (e.personas === 0) return 'Todavía no hay nadie configurado para recibir avisos de efectivo.';
  if (e.modo === 'simulado') return 'Los avisos por WhatsApp todavía no se envían de verdad: el sistema registra la anulación.';
  return 'El sistema avisa por WhatsApp a ' + personas(e.personas) + ' de esta anulación.';
}

// «+50688887777» -> «+506 8888 7777». Un teléfono oculto («+506 ****7777», para quien no es administrador) se deja como viene.
export function telefonoBonito(t) {
  const s = String(t ?? '');
  const m = s.match(/^\+506(\d{4})(\d{4})$/);
  return m ? '+506 ' + m[1] + ' ' + m[2] : s;
}

// Qué dice el estado de un aviso de la lista: [color de la etiqueta, palabras]. `error` lo escribe el sistema; solo se muestra si es corto y no suena técnico.
const TECNICO = /permission denied|invalid input|duplicate key|could not|violates|syntax error|does not exist|undefined|null value|TypeError|Failed to fetch|JWT|PGRST|\bHTTP\b|\b[45]\d\d\b|api access|graph\.facebook|token/i;
export function estadoDeAviso(a) {
  const est = a?.estado, ent = a?.estado_entrega;
  if (est === 'simulado') return ['espera', 'En prueba, no se envió'];
  if (est === 'pendiente') return ['espera', 'En cola, todavía no se envía'];
  if (est === 'enviando') return ['espera', 'Enviándose'];
  if (est === 'enviado') return ent === 'read' ? ['ok', 'Leído'] : ent === 'delivered' ? ['ok', 'Entregado'] : ent === 'failed' ? ['mal', 'No llegó al teléfono'] : ['ok', 'Enviado'];
  if (est === 'error') {
    const m = typeof a.error === 'string' ? a.error.trim() : '';
    return ['mal', 'No se pudo enviar' + (m && m.length <= 140 && !TECNICO.test(m) ? ': ' + m.replace(/[.\s]+$/, '') : '')];
  }
  return ['gris', 'Estado desconocido'];
}

// El mensaje tal como se manda: la plantilla con las 7 variables ({{1}} a {{7}}) puestas
export function vistaPrevia(plantilla, parametros) {
  const p = Array.isArray(parametros) ? parametros : [];
  return String(plantilla || '').replace(/\{\{(\d)\}\}/g, (_, n) => (p[Number(n) - 1] != null ? String(p[Number(n) - 1]) : ''));
}
