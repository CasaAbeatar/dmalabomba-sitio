// Claude como ayuda dentro de las pantallas. Las tareas viven en la base (fact.ia_tareas) y la función «claude-asistente» decide quién puede usarlas:
// cuentas de administración, todas; cajeras, solo la revisión de clientes. Aquí solo se pintan las respuestas, siempre en palabras sencillas.
import { h, modal, toast } from './util.js';
import { funcion, rpc } from './api.js';

const GRAVEDAD = { bloquea: ['Hay que corregirlo', 'rojo'], advertencia: ['Conviene revisarlo', 'ambar'], consejo: ['Un consejo', 'verde'] };
const NIVEL = { ok: ['Todo se ve bien', 'verde'], revisar: ['Hay cosas por revisar', 'ambar'], corregir: ['Hay que corregir antes de guardar', 'rojo'] };

let cssClaude = null;
function cargarCssClaude() {
  if (cssClaude) return cssClaude;
  const href = new URL('../css/claude.css', import.meta.url).href;
  cssClaude = new Promise((ok) => { const l = h('link', { rel: 'stylesheet', href }); l.addEventListener('load', () => ok()); l.addEventListener('error', () => ok()); document.head.append(l); });
  return cssClaude;
}
cargarCssClaude();

async function pedir(tarea, datos) {
  const r = await funcion('claude-asistente', { tarea, datos });
  if (!r?.resultado) throw new Error('Claude no devolvió una respuesta. Intente de nuevo.');
  return r.resultado;
}

// Botón «Revisar con Claude» para el formulario de un cliente. leer() devuelve lo escrito; usar(campo, valor) llena el campo si se sabe cómo.
export function revisarClienteConClaude({ leer, usar }) {
  const zona = h('div.claude-zona', { 'aria-live': 'polite' });
  const btn = h('button.btn', { type: 'button' }, 'Revisar con Claude');
  btn.addEventListener('click', async () => {
    btn.disabled = true; btn.textContent = 'Claude está revisando…'; zona.replaceChildren();
    try {
      const r = await pedir('cliente_revisar', { cliente: leer() });
      const [txt, color] = NIVEL[r.nivel] || NIVEL.revisar;
      zona.replaceChildren(
        h('p.inv-semaforo.' + color, h('strong.inv-sem-et', txt + ': '), r.resumen || ''),
        ...(r.hallazgos || []).map((x) => {
          const [g, c] = GRAVEDAD[x.gravedad] || GRAVEDAD.consejo;
          const hoy = leer();
          const igual = String(x.valor_sugerido || '').replace(/\s/g, '').toLowerCase() === (x.campo === 'telefono' ? String(hoy.telefono || '') : String((hoy.correos || [])[0] || '').toLowerCase());
          const puede = x.valor_sugerido && usar && !igual && ['correo', 'telefono'].includes(x.campo);
          return h('div.claude-hallazgo.' + c,
            h('strong', g + ': '), x.que_pasa + ' ',
            x.por_que_importa ? h('span.tenue', x.por_que_importa + ' ') : null,
            h('span', h('em', 'Cómo arreglarlo: '), x.como_arreglarlo),
            puede ? h('button.btn.chico', { type: 'button', onclick: () => { usar(x.campo, x.valor_sugerido); toast('Se escribió «' + x.valor_sugerido + '». Revíselo antes de guardar.'); } }, 'Usar «' + x.valor_sugerido + '»') : null);
        }),
        h('small.tenue', 'Claude solo da una opinión sobre los datos: usted decide qué guardar.'));
    } catch (e) { zona.replaceChildren(h('p.error-caja', e?.message || 'No se pudo consultar a Claude ahora.')); }
    finally { btn.disabled = false; btn.textContent = 'Revisar con Claude otra vez'; }
  });
  return h('div.claude-bloque', h('small.tenue', 'Claude puede revisar lo que escribió, buscar clientes repetidos y explicarle por qué Hacienda podría rechazar la factura.'), btn, zona);
}

// Solo administración: preguntarle a Claude sobre lo que se ve en la pantalla
export function abrirPreguntaClaude(app) {
  const pregunta = h('textarea.campo', { rows: 3, placeholder: 'Por ejemplo: ¿qué proveedor subió más de precio? ¿Por qué hay tantos ámbar?', 'aria-label': 'Su pregunta para Claude' });
  const zona = h('div.claude-zona', { 'aria-live': 'polite' });
  const enviar = h('button.btn.primario', { type: 'button' }, 'Preguntar');
  const lee = () => (document.getElementById('app')?.innerText || '').replace(/\n{3,}/g, '\n\n');
  const modulo = (app.moduloActual && (app.moduloActual.titulo || app.moduloActual.id || app.moduloActual.pantalla)) || 'Inicio';
  enviar.addEventListener('click', async () => {
    if (!pregunta.value.trim()) { pregunta.focus(); return; }
    enviar.disabled = true; enviar.textContent = 'Claude está pensando…'; zona.replaceChildren();
    try {
      const r = await pedir('explicar_pantalla', { modulo: String(modulo), pantalla: lee(), pregunta: pregunta.value.trim() });
      zona.replaceChildren(h('p', r.respuesta), (r.puntos || []).length ? h('ul', r.puntos.map((p) => h('li', p))) : null, r.falta ? h('p.tenue', 'Para responder mejor haría falta: ' + r.falta) : null);
    } catch (e) { zona.replaceChildren(h('p.error-caja', e?.message || 'No se pudo consultar a Claude ahora.')); }
    finally { enviar.disabled = false; enviar.textContent = 'Preguntar otra vez'; }
  });
  const uso = h('small.tenue');
  rpc('fx_ia_uso').then((u) => { if (u?.permitido) uso.textContent = 'Gasto de Claude este mes: US$ ' + Number(u.gasto_mes_usd).toFixed(2) + ' de US$ ' + Number(u.tope_mensual_usd).toFixed(0) + ' de tope.' + ((u.por_modulo || []).length ? ' Por módulo: ' + u.por_modulo.map((m) => m.modulo + ' US$ ' + Number(m.usd).toFixed(2)).join(', ') + '.' : '') + (u.proyeccion_mes_usd != null ? ' Al ritmo de este mes terminaría en unos US$ ' + Number(u.proyeccion_mes_usd).toFixed(2) + '.' : '') + ((u.alertas || []).length ? ' ATENCIÓN: ' + u.alertas.join(' ') : ''); }).catch(() => {});
  const semanal = h('details.claude-semanal', { hidden: true }, h('summary', 'Resumen semanal de Claude'), h('div.claude-zona'));
  rpc('fx_ia_informe_ultimo').then((x) => {
    if (!x?.hay) return;
    const cuando = new Intl.DateTimeFormat('es-CR', { timeZone: 'America/Costa_Rica', dateStyle: 'long' }).format(new Date(x.creado_en));
    semanal.querySelector('summary').textContent = 'Resumen semanal de Claude (' + cuando + ')';
    semanal.querySelector('.claude-zona').replaceChildren(h('strong', x.titulo), ...String(x.texto).split(/\n\n+/).map((p) => h('p', p)));
    semanal.hidden = false;
  }).catch(() => {});
  const negocio = h('div');
  rpc('fx_ia_informes_negocio').then((x) => {
    if (!x?.permitido) return;
    const fmt = new Intl.DateTimeFormat('es-CR', { timeZone: 'America/Costa_Rica', dateStyle: 'long' });
    const nombres = { costos: 'Costos y compras', conciliacion: 'Tarjetas y SINPE del BCR', cierre_caja: 'Cierre de caja' };
    negocio.replaceChildren(...(x.informes || []).map((i) => h('details.claude-semanal', h('summary', (nombres[i.tipo] || i.tipo) + ' (' + fmt.format(new Date(i.creado_en)) + ')'), h('div.claude-zona', h('strong', i.titulo), ...String(i.texto).split(/\n\n+/).map((p) => h('p', p))))));
  }).catch(() => {});
  return modal({ titulo: 'Preguntarle a Claude', ancho: 640, contenido: h('div.claude-bloque', h('p.tenue', 'Claude lee lo que está viendo en esta pantalla (' + modulo + ') y le responde con esas cifras. No cambia nada.'), semanal, negocio, pregunta, h('div', enviar), zona, uso), botones: [{ texto: 'Cerrar', clase: 'suave', onclick: (c) => c() }] });
}
