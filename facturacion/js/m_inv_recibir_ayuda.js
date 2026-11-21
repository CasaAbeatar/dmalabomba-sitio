// Ayuda dentro de cada línea de «Por recibir» (21 nov 2026, orden de Emil):
//  - «Ver factura (PDF)»: trae el PDF original del correo (función factura-pdf) y lo muestra al lado de la línea, para que Emil lo lea e interprete él mismo.
//  - «Consultar con Claude»: mini chat sobre ESA línea (función claude-asistente, tarea recibir_linea_chat). Claude lee la línea, el PDF, las compras anteriores y la memoria del proveedor,
//    y si no alcanza busca en internet qué es el artículo, su presentación y su costo de referencia. La conclusión llega como propuesta; solo se carga en los campos con el toque de Emil.
// Solo administración (las dos funciones lo exigen). Nada de lo que se muestra aquí guarda algo en el inventario.
import { h } from './util.js';
import { funcion } from './api.js';
import { toastOk, toastMal } from './m_inv_comun.js';

const CSS = `
.ay { margin: 10px 0 4px; }
.ay-barra { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.ay-barra .btn { white-space: normal; }
.ay-zona { margin-top: 10px; border: 1px solid #d9cdb4; border-radius: 4px; background: #fffaf0; padding: 10px 12px; }
.ay-tenue { color: #6b5f4b; font-size: 0.92em; margin: 4px 0; }
.ay-error { color: #a31522; margin: 4px 0; }
.ay-pdf { width: 100%; height: 72vh; min-height: 420px; border: 1px solid #d9cdb4; background: #fff; }
.ay-abrir { display: inline-block; margin-top: 6px; color: #a31522; text-decoration: underline; }
.ay-reg { display: flex; flex-direction: column; gap: 8px; max-height: 60vh; overflow-y: auto; margin-bottom: 8px; }
.ay-burbuja { border: 1px solid #e3d8c2; border-radius: 4px; padding: 8px 10px; white-space: pre-wrap; overflow-wrap: anywhere; background: #fff; }
.ay-burbuja.emil { background: #f4ecda; align-self: flex-end; max-width: 92%; }
.ay-burbuja.claude { align-self: flex-start; max-width: 100%; }
.ay-quien { display: block; font-size: 0.8em; letter-spacing: 0.04em; text-transform: uppercase; color: #6b5f4b; margin-bottom: 2px; }
.ay-prop { margin-top: 8px; border-top: 1px solid #e3d8c2; padding-top: 8px; display: grid; grid-template-columns: max-content 1fr; gap: 3px 12px; }
.ay-prop dt { color: #6b5f4b; }
.ay-prop dd { margin: 0; overflow-wrap: anywhere; }
.ay-entrada { display: flex; gap: 8px; align-items: flex-end; }
.ay-entrada textarea { flex: 1; min-height: 44px; resize: vertical; }
.ay-mt { margin-top: 6px; }
.ay-fuentes { margin: 6px 0 0; padding-left: 18px; font-size: 0.88em; color: #6b5f4b; }
`;
let cssListo = false;
function cargarCss() {
  if (cssListo) return;
  cssListo = true;
  const s = document.createElement('style'); s.id = 'ay-css'; s.textContent = CSS; document.head.append(s);
}

const CONSUMO = { insumo_cocina: 'Insumo de cocina', reventa: 'Reventa', empaque_desechable: 'Empaque desechable', limpieza: 'Limpieza', otro: 'Otro', no_es_inventario: 'No es de inventario' };
const CERTEZA = { alta: 'Alta', media: 'Media', baja: 'Baja: conviene confirmarlo con el PDF' };

// Del texto en base64 que manda la función al archivo que el navegador puede mostrar
function urlDePdf(base64) {
  const bin = atob(String(base64 || ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
}

// clave y linea: la línea de la factura. aplicar(propuesta) carga la conversión en los campos de la línea y devuelve el texto de lo que hizo.
export function ayudaLinea({ clave, linea, aplicar }) {
  cargarCss();
  const zonaPdf = h('div.ay-zona', { hidden: true });
  const zonaChat = h('div.ay-zona', { hidden: true });
  const btnPdf = h('button.btn', { type: 'button', 'aria-expanded': 'false' }, 'Ver factura (PDF)');
  const btnChat = h('button.btn', { type: 'button', 'aria-expanded': 'false' }, 'Consultar con Claude');

  /* ---------- PDF ---------- */
  let urlPdf = null;
  btnPdf.addEventListener('click', async () => {
    if (!zonaPdf.hidden) { zonaPdf.hidden = true; btnPdf.textContent = 'Ver factura (PDF)'; btnPdf.setAttribute('aria-expanded', 'false'); return; }
    zonaPdf.hidden = false; btnPdf.textContent = 'Ocultar la factura (PDF)'; btnPdf.setAttribute('aria-expanded', 'true');
    if (!urlPdf) {
      zonaPdf.replaceChildren(h('p.ay-tenue', { role: 'status' }, 'Trayendo el PDF del correo…'));
      try { const r = await funcion('factura-pdf', { clave }); urlPdf = urlDePdf(r.base64); }
      catch (e) { zonaPdf.replaceChildren(h('p.ay-error', { role: 'alert' }, (e && e.message) || 'No se pudo traer el PDF ahora.')); return; }
    }
    zonaPdf.replaceChildren(h('iframe.ay-pdf', { src: urlPdf, title: 'Factura en PDF, línea ' + linea }), h('a.ay-abrir', { href: urlPdf, target: '_blank', rel: 'noopener' }, 'Abrir el PDF en otra pestaña'));
  });

  /* ---------- Mini chat ---------- */
  const historial = [];
  const registro = h('div.ay-reg', { 'aria-live': 'polite' });
  const caja = h('textarea.campo', { rows: 2, maxlength: 1500, 'aria-label': 'Su pregunta a Claude sobre la línea ' + linea, placeholder: 'Escriba su duda sobre esta línea…' });
  const enviar = h('button.btn', { type: 'button' }, 'Enviar');
  const investigar = h('button.btn.chico', { type: 'button' }, 'Investigar qué es este artículo');
  let ocupado = false;

  const burbuja = (quien, texto) => {
    const b = h('div.ay-burbuja.' + (quien === 'emil' ? 'emil' : 'claude'), h('span.ay-quien', quien === 'emil' ? 'Usted' : 'Claude'), texto);
    registro.append(b); registro.scrollTop = quien === 'emil' ? registro.scrollHeight : Math.max(0, b.offsetTop - registro.offsetTop - 4); return b;
  };
  const tarjetaPropuesta = (p) => {
    if (!p || typeof p !== 'object' || !(p.que_es || p.presentacion)) return null;
    const u = Number(p.unidades_por_unidad_factura), costo = Number(p.costo_referencia_unidad);
    const filas = [
      ['Qué es', p.que_es], ['Presentación', p.presentacion],
      ['Cada unidad de la factura trae', Number.isFinite(u) && u > 0 ? String(u).replace('.', ',') + ' del artículo' : ''],
      ['Tipo de consumo', CONSUMO[p.tipo_consumo] || ''],
      ['Costo de referencia por unidad', Number.isFinite(costo) && costo > 0 ? '₡' + costo.toLocaleString('es-CR', { maximumFractionDigits: 2 }) : ''],
      ['Qué tan seguro', CERTEZA[p.certeza] || ''],
    ].filter(([, v]) => v);
    const dl = h('dl.ay-prop', filas.map(([k, v]) => [h('dt', k), h('dd', v)]));
    const usar = Number.isFinite(u) && u > 0 ? h('button.btn.chico', { type: 'button', onclick: (ev) => {
      try { const t = aplicar(p); toastOk(t); ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'Cargado en la línea'; } catch (e) { toastMal((e && e.message) || 'No se pudo cargar en la línea.'); }
    } }, 'Usar esta propuesta en la línea') : null;
    const fuentes = Array.isArray(p.fuentes) && p.fuentes.length ? h('ul.ay-fuentes', p.fuentes.slice(0, 5).map((f) => h('li', String(f).slice(0, 200)))) : null;
    return h('div', dl, usar, fuentes, h('p.ay-tenue', 'Es una propuesta: no se guarda nada hasta que usted reciba la línea.'));
  };

  async function preguntar(texto) {
    const q = String(texto || '').trim();
    if (!q || ocupado) return;
    ocupado = true; enviar.disabled = investigar.disabled = true; caja.value = '';
    burbuja('emil', q);
    const espera = burbuja('claude', 'Claude está leyendo la línea y buscando en internet si hace falta. Puede tardar un minuto…');
    try {
      const r = await funcion('claude-asistente', { tarea: 'recibir_linea_chat', datos: { clave, linea, historial, pregunta: q } });
      const res = r.resultado || {};
      espera.replaceChildren(h('span.ay-quien', 'Claude'), String(res.respuesta || 'Claude no devolvió texto.'), tarjetaPropuesta(res.propuesta));
      historial.push({ rol: 'emil', texto: q }, { rol: 'claude', texto: String(res.respuesta || '') + (res.propuesta ? '\nPropuesta: ' + JSON.stringify(res.propuesta) : '') });
    } catch (e) {
      espera.replaceChildren(h('span.ay-quien', 'Claude'), h('span.ay-error', (e && e.message) || 'No se pudo consultar a Claude ahora. Intente de nuevo.'));
    } finally { ocupado = false; enviar.disabled = investigar.disabled = false; }
  }
  enviar.addEventListener('click', () => preguntar(caja.value));
  caja.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); preguntar(caja.value); } });
  investigar.addEventListener('click', () => preguntar('Averigua qué es este artículo: su presentación, cuántas unidades del artículo trae cada unidad que cobra la factura, el tipo de consumo y el costo de referencia. Si hace falta, búscalo en internet.'));
  zonaChat.append(
    h('p.ay-tenue', 'Claude conoce esta línea, el PDF, las compras anteriores y lo que ya se decidió con este proveedor. Si no alcanza, busca en internet. Usted decide qué se carga.'),
    registro, h('div.ay-entrada', caja, enviar), h('div.ay-mt', investigar));

  btnChat.addEventListener('click', () => {
    const abrir = zonaChat.hidden; zonaChat.hidden = !abrir; btnChat.setAttribute('aria-expanded', String(abrir));
    btnChat.textContent = abrir ? 'Cerrar la consulta con Claude' : 'Consultar con Claude';
    if (abrir) caja.focus({ preventScroll: true });
  });

  return h('div.ay', h('div.ay-barra', btnPdf, btnChat), zonaPdf, zonaChat);
}
