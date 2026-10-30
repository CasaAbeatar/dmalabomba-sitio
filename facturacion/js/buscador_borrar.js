// Botón «Borrar» dentro de todo buscador (input type=search) del facturador: aparece solo cuando hay algo escrito, vacía el cuadro, avisa a la pantalla (evento input) y deja el cursor listo para escribir.
// Los buscadores que ya traen su propio botón «Borrar búsqueda» (fila .buscar-fila) se dejan igual.
const marcar = (inp) => {
  if (inp.dataset.bxListo || !inp.parentNode) return;
  inp.dataset.bxListo = '1';
  if (inp.closest('.buscar-fila')) return;
  const envuelve = document.createElement('span');
  envuelve.className = 'bx-envuelve';
  inp.parentNode.insertBefore(envuelve, inp);
  envuelve.appendChild(inp);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'bx-borrar';
  btn.hidden = true;
  btn.setAttribute('aria-label', 'Borrar lo escrito en el buscador');
  btn.innerHTML = '<span aria-hidden="true">✕</span> Borrar';
  envuelve.appendChild(btn);
  const ver = () => { btn.hidden = !inp.value || inp.disabled; };
  inp.addEventListener('input', ver);
  inp.addEventListener('focus', ver);
  inp.addEventListener('change', ver);
  btn.addEventListener('mousedown', (e) => e.preventDefault());
  btn.addEventListener('click', () => { inp.value = ''; btn.hidden = true; inp.dispatchEvent(new Event('input', { bubbles: true })); inp.focus(); });
  ver();
  // Un valor puesto por el programa (sin evento) también se refleja.
  const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  if (desc && desc.set && desc.get) Object.defineProperty(inp, 'value', { configurable: true, get() { return desc.get.call(this); }, set(v) { desc.set.call(this, v); ver(); } });
};
const barrer = (nodo) => {
  if (!nodo || nodo.nodeType !== 1) return;
  if (nodo.matches && nodo.matches('input[type=search]')) marcar(nodo);
  if (nodo.querySelectorAll) nodo.querySelectorAll('input[type=search]').forEach(marcar);
};
export const iniciarBuscadoresBorrar = () => {
  barrer(document.body);
  new MutationObserver((ms) => { for (const m of ms) m.addedNodes.forEach(barrer); }).observe(document.body, { childList: true, subtree: true });
};
