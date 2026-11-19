// «Ver como otro usuario» (19 nov 2026, orden de Emil): el administrador general escoge «Ir a …» y la pantalla se ve como la de ese usuario;
// «Volver a mi usuario» regresa. SOLO cambia lo que se ve: la sesión, los permisos y la auditoría siguen siendo los del administrador real (el servidor lo exige todo).
// El estado vive en sessionStorage de esta pestaña; al cerrar sesión o la pestaña se pierde y todo vuelve a la normalidad.
import { h } from './util.js';
import { api } from './api.js';

const CLAVE = 'fx_ver_como';
export function leerVerComo() {
  try { const v = JSON.parse(sessionStorage.getItem(CLAVE) || 'null'); return v && typeof v.usuario === 'string' ? { usuario: v.usuario, nombre: String(v.nombre || v.usuario), admin: !!v.admin } : null; } catch { return null; }
}
export function olvidarVerComo() { try { sessionStorage.removeItem(CLAVE); } catch { /* nada */ } }
function recargar() { try { location.hash = ''; } catch { /* nada */ } location.reload(); }
export function irComo(u) { try { sessionStorage.setItem(CLAVE, JSON.stringify({ usuario: u.usuario, nombre: u.nombre, admin: !!u.admin })); } catch { /* nada */ } recargar(); }
export function volverAMiUsuario() { olvidarVerComo(); recargar(); }

// Lista de usuarios a los que se puede ir: solo para quien ve las claves (administrador general). Devuelve [] para los demás.
let cache = null;
export async function usuariosParaVer(app) {
  if (!app.ctx?.admin) return [];
  if (!cache) cache = api.usuarios().then((r) => (Array.isArray(r) ? r : [])).catch(() => []);
  const lista = await cache;
  if (!lista.some((u) => u.ver_claves)) return [];
  const yo = String(app.ctx.usuario || '').toLowerCase();
  return lista.filter((u) => u.activo && String(u.usuario).toLowerCase() !== yo);
}

// Botones «Ir a …» y, abajo, «Volver a mi usuario». Se llena cuando llega la lista; si no es administrador general queda vacío (hidden).
export function listaVerComo(app, { abierta = false } = {}) {
  const raiz = h('details.vc-lista', { hidden: true }, h('summary', 'Ver como otro usuario'));
  if (abierta) raiz.open = true;
  const cuerpo = h('div.vc-botones');
  raiz.append(cuerpo);
  usuariosParaVer(app).then((us) => {
    if (!us.length) return;
    const cual = app.vistaComo?.usuario;
    cuerpo.replaceChildren(
      ...us.map((u) => h('button.nv-item.vc-ir' + (u.usuario === cual ? '.actual' : ''), { type: 'button', 'data-usuario': u.usuario, 'aria-label': 'Ir a ' + u.nombre, onclick: () => irComo(u) }, h('span.nv-tit', 'Ir a ' + u.nombre))),
      h('button.nv-item.vc-volver', { type: 'button', disabled: !app.vistaComo, onclick: volverAMiUsuario }, h('span.nv-tit', 'Volver a mi usuario')));
    raiz.hidden = false;
  });
  return raiz;
}

// Cintilla que acompaña mientras se ve como otro usuario: dice quién y deja volver o saltar a otro con un toque.
export function cintillaVerComo(app) {
  if (!app.vistaComo) return null;
  const c = h('div.vc-cintilla', { role: 'status' },
    h('div.vc-fila', h('span', 'Viendo como ', h('strong', app.vistaComo.nombre)), h('button.btn.chico.primario', { type: 'button', onclick: volverAMiUsuario }, 'Volver a mi usuario')),
    h('small', 'Solo cambia lo que se ve. Lo que haga queda a nombre de ' + (app.ctx?.nombre || 'usted') + '.'),
    listaVerComo(app));
  return c;
}
