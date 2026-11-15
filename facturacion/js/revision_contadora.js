// Pantalla de bienvenida de la contadora: responde lo pendiente y confirma lo que ya contestó la administración.
// Una respuesta vale para Soda La Bomba y Pollos La Bomba a la vez (las dos son una sola empresa en lo administrativo).
import { h, toast, textoDeError, conBoton } from './util.js';
import { cargarHoja } from './ui_hojas.js';
import { revisionLista, revisionResponder } from './api_contable.js';

const NOMBRES = { metodo: 'Método', umbral_colones: 'Monto mínimo en colones', vida_util_anios: 'Vida útil en años', computo: 'Cómputo', regla: 'Regla', estado_regla: 'Estado de la regla',
  tension_codigo_c: 'Punto por aclarar (código C)', d270: 'D-270', cargas_patronales_ccss: 'Cargas patronales (CCSS)', aguinaldo_y_vacaciones: 'Aguinaldo y vacaciones', cuotas_obreras_y_retenciones: 'Cuotas obreras y retenciones',
  usados_por_defecto: 'Usados por defecto', lista_oficial_disponible: 'Lista oficial disponible', entes_publicos: 'Entes públicos', compras_sin_factura: 'Compras sin factura', servicios_profesionales: 'Servicios profesionales',
  pagos_sin_factura_aceptada: 'Pagos sin factura de compra aceptada' };
const etiqueta = (k) => { if (NOMBRES[k]) return NOMBRES[k]; const t = String(k).replace(/_/g, ' ').trim(); return t.charAt(0).toUpperCase() + t.slice(1); };
const limpiaTexto = (t) => String(t).replace(/^PROVISIONAL:\s*/i, '');
const esObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

// Hojas del valor: [{ruta:[...], valor}] para poder mostrar y volver a armar el objeto
function hojas(v, ruta = []) {
  if (esObj(v)) return Object.entries(v).flatMap(([k, x]) => (k === 'provisional' ? [] : hojas(x, [...ruta, k])));
  return [{ ruta, valor: v }];
}
function poner(obj, ruta, valor) { let o = obj; ruta.slice(0, -1).forEach((k) => { o = o[k]; }); o[ruta[ruta.length - 1]] = valor; }
const copia = (v) => JSON.parse(JSON.stringify(v ?? null));

function textoLegible(v) {
  if (v == null || v === '') return h('p.rev-vacio', 'Todavía no hay una respuesta escrita.');
  if (typeof v === 'boolean') return h('p', v ? 'Sí' : 'No');
  if (!esObj(v)) return h('p', typeof v === 'string' ? limpiaTexto(v) : String(v));
  return h('ul.rev-lista', hojas(v).map((x) => h('li', h('strong', x.ruta.map(etiqueta).join(' › ') + ': '), x.valor == null ? 'sin definir' : typeof x.valor === 'boolean' ? (x.valor ? 'Sí' : 'No') : limpiaTexto(x.valor))));
}
// Lo que se guarda cuando ella está de acuerdo: igual al valor, sin la marca de «provisional»
function sinProvisional(v) {
  if (typeof v === 'string') return limpiaTexto(v);
  if (esObj(v)) { const c = copia(v); if ('provisional' in c) c.provisional = false; if (typeof c.nota === 'string' && /^PROVISIONAL/i.test(c.nota)) delete c.nota; return c; }
  return v;
}

function editor(item) {
  const v = item.valor;
  if (typeof v === 'number') { const i = h('input.campo', { type: 'number', value: String(v), step: 'any', 'aria-label': item.descripcion }); return { el: i, leer: () => (i.value.trim() === '' ? null : Number(i.value)) }; }
  if (typeof v === 'boolean') { const s = h('select.campo', { 'aria-label': item.descripcion }, h('option', { value: 'true' }, 'Sí'), h('option', { value: 'false' }, 'No')); s.value = String(v); return { el: s, leer: () => s.value === 'true' }; }
  if (esObj(v)) {
    const filas = hojas(v).filter((x) => !(x.ruta.length === 1 && x.ruta[0] === 'nota' && /^PROVISIONAL/i.test(String(x.valor)))).map((x) => { const ta = h('textarea.campo', { rows: 2, 'aria-label': x.ruta.map(etiqueta).join(' ') }); ta.value = x.valor == null ? '' : typeof x.valor === 'string' ? limpiaTexto(x.valor) : String(x.valor); return { x, ta }; });
    return { el: h('div.rev-campos', filas.map(({ x, ta }) => h('label.rev-campo', h('span', x.ruta.map(etiqueta).join(' › ')), ta))),
      leer: () => { const c = sinProvisional(v); filas.forEach(({ x, ta }) => { const t = ta.value.trim(); poner(c, x.ruta, typeof x.valor === 'number' && t !== '' && !isNaN(Number(t)) ? Number(t) : t); }); return c; } };
  }
  const ta = h('textarea.campo', { rows: 4, placeholder: 'Escriba aquí su respuesta', 'aria-label': item.descripcion }); ta.value = v == null ? '' : limpiaTexto(v);
  return { el: ta, leer: () => ta.value.trim() };
}

export async function abrirRevisionContadora(app) {
  let lista;
  try { await cargarHoja('revision_contadora.css'); lista = await revisionLista(); } catch (e) { console.error(e); return; }
  const faltan = () => lista.filter((i) => i.estado !== 'confirmada').length;
  if (!faltan()) return;
  const capa = h('div.rev-capa', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'rev-tit' });
  const cuerpo = h('div.rev-caja');
  capa.append(cuerpo);
  document.body.append(capa);
  const cerrar = () => { capa.remove(); document.body.style.overflow = ''; };
  document.body.style.overflow = 'hidden';

  function pintar() {
    const total = lista.length, hechas = total - faltan();
    const pend = lista.filter((i) => i.estado === 'pendiente'), conf = lista.filter((i) => i.estado === 'por_confirmar'), ya = lista.filter((i) => i.estado === 'confirmada');
    const nombre = String(app.ctx.nombre || '').split(' ')[0] || '';
    cuerpo.replaceChildren(...[
      h('header.rev-cab',
        h('h1#rev-tit', 'Hola' + (nombre ? ', ' + nombre : '') + '. Necesitamos su criterio contable'),
        h('p', 'Estas decisiones son suyas. Hasta que las responda, el sistema usa un valor provisional y no inventa nada. Cada respuesta vale para Soda La Bomba y para Pollos La Bomba a la vez.'),
        h('div.rev-avance', { role: 'status' }, h('div.rev-barra', h('i', { style: 'width:' + Math.round((hechas / total) * 100) + '%' })), h('span', 'Lleva ' + hechas + ' de ' + total))),
      pend.length ? h('section', h('h2', 'Falta su respuesta (' + pend.length + ')'), pend.map(tarjeta)) : null,
      conf.length ? h('section', h('h2', 'Ya tienen una respuesta de la administración: confírmelas o cámbielas (' + conf.length + ')'), conf.map(tarjeta)) : null,
      ya.length ? h('section', h('h2', 'Ya revisadas por usted (' + ya.length + ')'), ya.map(tarjeta)) : null,
      h('footer.rev-pie',
        faltan() ? h('button.btn.suave', { type: 'button', onclick: cerrar }, 'Ahora no, entrar al sistema') : h('button.btn.primario.grande', { type: 'button', onclick: cerrar }, 'Listo, entrar al sistema'),
        faltan() ? h('small.tenue', 'Cuando vuelva a entrar le mostraremos lo que falte.') : null)].filter(Boolean));
  }

  function tarjeta(item) {
    const tarj = h('article.rev-tarjeta.' + item.estado);
    let editando = false;
    function dibujar() {
      const hecho = item.estado === 'confirmada';
      const quien = hecho && item.revisado_por ? ' por ' + item.revisado_por : '';
      const partes = [h('h3', item.descripcion),
        h('div.rev-valor', h('div.rev-rotulo', item.estado === 'pendiente' ? 'Lo que usa el sistema mientras tanto' : 'Respuesta actual'), textoLegible(item.valor))];
      if (editando) {
        const ed = editor(item);
        partes.push(h('div.rev-edita', h('div.rev-rotulo', 'Su respuesta'), ed.el,
          h('div.rev-botones',
            h('button.btn.primario', { type: 'button', onclick: (e) => conBoton(e.currentTarget, () => guardar(ed.leer(), true)) }, 'Guardar mi respuesta'),
            h('button.btn', { type: 'button', onclick: () => { editando = false; dibujar(); } }, 'Cancelar'))));
      } else if (hecho) {
        partes.push(h('p.rev-ok', '✓ Confirmada' + quien), h('button.btn.chico', { type: 'button', onclick: () => { editando = true; dibujar(); } }, 'Cambiar de nuevo'));
      } else {
        partes.push(h('div.rev-botones',
          h('button.btn.primario', { type: 'button', onclick: (e) => conBoton(e.currentTarget, () => guardar(sinProvisional(item.valor), false)) }, item.estado === 'pendiente' ? 'Está bien así, usar este valor' : 'Estoy de acuerdo'),
          h('button.btn', { type: 'button', onclick: () => { editando = true; dibujar(); } }, item.estado === 'pendiente' ? 'Escribir mi respuesta' : 'Quiero cambiarla')));
      }
      tarj.replaceChildren(...partes.filter(Boolean));
    }
    async function guardar(valor, cambio) {
      try {
        const cambia = cambio || JSON.stringify(valor) !== JSON.stringify(item.valor);
        await revisionResponder(item.clave, valor, cambia);
        lista = await revisionLista();
        toast('Guardado para Soda y Pollos');
        pintar();
      } catch (e) { toast(textoDeError(e), 'error'); }
    }
    dibujar();
    return tarj;
  }
  pintar();
  capa.querySelector('button')?.focus();
}
