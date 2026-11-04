// Limpieza del HTML del informe semanal (lo arma la función claude-semanal con cifras de la base y gráficos en SVG) antes de mostrarlo.
// Tres capas, aunque cualquiera bastaría:
//   1. Aquí se lee con DOMParser (un documento inerte: no ejecuta nada) y solo pasan las etiquetas y atributos de la lista. Todo lo demás se quita:
//      scripts, marcos, formularios, imágenes externas, enlaces, atributos on* y direcciones javascript:. Los estilos pierden @import, url() y expression().
//   2. El resultado va en un iframe con sandbox SIN scripts, sin envío de formularios y sin cambiar la página de arriba (m_semanal.js).
//   3. El documento lleva su propia política de seguridad (CSP): sin scripts, sin conexiones y sin recursos externos; solo estilos y gráficos en línea.
// El informe se fuerza al tema claro y a la tipografía del facturador para que se vea igual que el resto de las pantallas.

const BLOQUES = new Set(['html', 'body', 'main', 'section', 'article', 'header', 'footer', 'div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'blockquote',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col', 'figure', 'figcaption', 'hr', 'br', 'span', 'strong', 'b', 'em', 'i', 'u', 's', 'small', 'sub', 'sup', 'code', 'abbr', 'time', 'mark']);
const SVG = new Set(['svg', 'g', 'path', 'line', 'polyline', 'polygon', 'rect', 'circle', 'ellipse', 'text', 'tspan', 'title', 'desc', 'defs', 'lineargradient', 'stop', 'clippath']);
const QUITAR_CON_CONTENIDO = new Set(['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'link', 'form', 'input', 'button', 'select', 'textarea', 'base', 'meta', 'noscript', 'template',
  'audio', 'video', 'source', 'track', 'canvas', 'img', 'image', 'picture', 'foreignobject', 'use', 'animate', 'animatetransform', 'set', 'head']);
const ATRIBUTOS = new Set(['class', 'style', 'lang', 'dir', 'role', 'aria-label', 'aria-hidden', 'aria-labelledby', 'colspan', 'rowspan', 'scope', 'headers', 'datetime',
  'viewbox', 'width', 'height', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points', 'fill', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-linecap',
  'stroke-linejoin', 'fill-opacity', 'opacity', 'transform', 'text-anchor', 'dominant-baseline', 'font-size', 'font-weight', 'font-family', 'font-style', 'letter-spacing', 'preserveaspectratio',
  'offset', 'stop-color', 'stop-opacity', 'id', 'clip-path', 'xmlns']);
const MAX_ENTRADA = 600000; // el informe real pesa unos 12 KB; más de esto no es un informe

// Quita lo peligroso de una hoja de estilos (el CSP ya lo bloquearía; esto es la primera barrera)
export function limpiarCss(css) {
  return String(css || '')
    .replace(/@import[^;]*;?/gi, '')
    .replace(/url\s*\([^)]*\)/gi, 'none')
    .replace(/expression\s*\([^)]*\)/gi, 'none')
    .replace(/(-moz-binding|behavior)\s*:[^;}]*/gi, '')
    .replace(/<\/?style/gi, '')
    .replace(/<!--|-->/g, '');
}
const estiloSeguro = (v) => !/url\s*\(|expression\s*\(|@import|javascript:|behavior|-moz-binding/i.test(v);

function limpiarNodo(nodo, destino, doc) {
  for (const hijo of [...nodo.childNodes]) {
    if (hijo.nodeType === 3) { destino.append(doc.createTextNode(hijo.nodeValue)); continue; }
    if (hijo.nodeType !== 1) continue; // comentarios y demás: fuera
    const nombre = hijo.localName.toLowerCase();
    if (QUITAR_CON_CONTENIDO.has(nombre)) continue;
    const esSvg = hijo.namespaceURI === 'http://www.w3.org/2000/svg';
    if (nombre === 'style') continue; // los estilos se juntan aparte
    const permitido = esSvg ? SVG.has(nombre) : BLOQUES.has(nombre);
    if (!permitido) { limpiarNodo(hijo, destino, doc); continue; } // etiqueta desconocida: se queda su texto, no la etiqueta
    const copia = esSvg ? doc.createElementNS('http://www.w3.org/2000/svg', hijo.localName) : doc.createElement(nombre);
    for (const a of [...hijo.attributes]) {
      const n = a.name.toLowerCase();
      if (n.startsWith('on') || !ATRIBUTOS.has(n)) continue;
      if (n === 'style' && !estiloSeguro(a.value)) continue;
      if (/^\s*(javascript|vbscript|data):/i.test(a.value) && n !== 'class') continue;
      if (n === 'id' && !/^[\w-]{1,60}$/.test(a.value)) continue;
      if (n === 'clip-path' && /url\s*\(\s*(?!#)/i.test(a.value)) continue;
      if (n === 'xmlns') continue;
      copia.setAttribute(a.name, a.value);
    }
    limpiarNodo(hijo, copia, doc);
    destino.append(copia);
  }
}

const POLITICA = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'";
// Lo último que se aplica: tema claro, tipografía y colores del facturador. Verde = pagar menos, rojo = pagar más (los trae el informe).
const AJUSTES = ':root{color-scheme:light;--fondo:#fbf8f2;--texto:#1d1a17;--linea:#e2dacb;--verde:#1f7a4d;--rojo:#b81622}'
  + 'html,body{background:#fbf8f2!important;color:#1d1a17!important}body{margin:0;font-family:"Helvetica Neue",Helvetica,Arial,"Liberation Sans",sans-serif!important;line-height:1.5;-webkit-text-size-adjust:100%}'
  + 'main{max-width:none!important;padding:4px 2px 24px!important}svg,svg text{font-family:"Helvetica Neue",Helvetica,Arial,"Liberation Sans",sans-serif!important}'
  + 'h1{font-size:1.25rem!important}h2{font-size:1.1rem!important}table{width:100%}img,video,iframe{display:none!important}';

// Devuelve el documento completo, listo para el srcdoc de un iframe con sandbox. null si no es un informe utilizable.
export function documentoInformeSeguro(html) {
  const bruto = String(html ?? '');
  if (!bruto.trim() || bruto.length > MAX_ENTRADA) return null;
  const origen = new DOMParser().parseFromString(bruto, 'text/html');
  const vacio = new DOMParser().parseFromString('<!doctype html><html><body></body></html>', 'text/html');
  const estilos = [...origen.querySelectorAll('style')].map((s) => limpiarCss(s.textContent)).join('\n');
  limpiarNodo(origen.body, vacio.body, vacio);
  if (!vacio.body.textContent.trim() && !vacio.body.querySelector('svg')) return null;
  const titulo = (origen.title || 'Informe semanal').replace(/[<>&"]/g, ' ');
  return '<!doctype html><html lang="es" data-theme="light"><head><meta charset="utf-8">'
    + `<meta http-equiv="Content-Security-Policy" content="${POLITICA}">`
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + `<title>${titulo}</title><style>${estilos}</style><style>${AJUSTES}</style></head>`
    + `<body>${vacio.body.innerHTML}</body></html>`;
}
