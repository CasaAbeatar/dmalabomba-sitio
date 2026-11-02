// Contabilidad (Administración, solo administradores): catálogo de cuentas, asientos, compras por clasificar, IVA y formularios, estados NIIF PYMES, análisis y planilla.
// Un solo módulo con pestañas; cada pestaña vive en su archivo c_*.js y recibe {app, soc, memoria}. `memoria` guarda lo que la persona dejó puesto (filtro, mes, pestaña)
// para que al volver atrás o recargar no se pierda. Cada pestaña abre con la información del día y después los totales (mes, tendencias).
import { h } from './util.js';
import { cargarHoja } from './ui_hojas.js';

// Orden de las pestañas. Cada fase agrega la suya aquí.
const PESTANAS = [
  () => import('./c_libro.js'),
  () => import('./c_compras.js'),
  () => import('./c_formularios.js'),
  () => import('./c_estados.js'),
  () => import('./c_analisis.js'),
  () => import('./c_catalogo.js'),
];

const memoria = {}; // vive mientras la página esté abierta; la pestaña elegida además se recuerda en sessionStorage
const leer = (k) => { try { return sessionStorage.getItem(k); } catch { return null; } };
const poner = (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* sin almacenamiento: se sigue igual */ } };

export default {
  id: 'contabilidad',
  titulo: 'Contabilidad',
  async mount(root, app) {
    await cargarHoja('contable.css');
    if (!app.admin) { root.append(h('div.vacio', h('p', 'Esta pantalla es solo para administradores.'), h('button.btn', { type: 'button', onclick: () => app.ir('inicio') }, 'Volver al inicio'))); return; }
    const soc = app.soc;
    const mods = (await Promise.all(PESTANAS.map((f) => f()))).map((m) => m.default);
    const barra = h('div.con-tabs', { role: 'tablist', 'aria-label': 'Secciones de la contabilidad' });
    const panel = h('div', { role: 'tabpanel' });
    const botones = new Map();
    let actual = null, vivo = true, limpiar = null;
    const ctx = { app, soc, memoria, avisar: (id, n) => { const b = botones.get(id); if (!b) return; b.querySelector('.chip')?.remove(); if (n > 0) b.append(h('span.chip.mal', String(n))); } };
    async function ir(id) {
      if (!vivo) return;
      actual = id; poner('con-pestana', id);
      botones.forEach((b, k) => b.setAttribute('aria-selected', String(k === id)));
      if (typeof limpiar === 'function') { try { limpiar(); } catch { /* nada que limpiar */ } }
      limpiar = null;
      // cada pestaña trabaja en su propia caja: si se cambia de pestaña antes de que una termine de cargar, lo que llegue tarde cae en una caja que ya no se ve
      const caja = h('div'); panel.replaceChildren(caja);
      const m = mods.find((x) => x.id === id) || mods[0];
      const l = await m.montar(caja, ctx);
      if (panel.firstChild === caja) limpiar = l; else if (typeof l === 'function') { try { l(); } catch { /* ya no está */ } }
    }
    for (const m of mods) {
      const b = h('button.con-tab', { type: 'button', role: 'tab', 'aria-selected': 'false', onclick: () => ir(m.id) }, m.texto);
      botones.set(m.id, b); barra.append(b);
    }
    root.append(h('div.con-raiz', h('p.tenue', 'Libros contables de ', h('strong', soc?.nombre_comercial || soc?.nombre || 'la empresa'), '. Las cifras salen de las facturas, los cierres de caja y los comprobantes de la CCSS que usted cargue; nada se digita dos veces.'), barra, panel));
    const guardada = leer('con-pestana');
    await ir(mods.some((m) => m.id === guardada) ? guardada : mods[0].id);
    return () => { vivo = false; if (typeof limpiar === 'function') { try { limpiar(); } catch { /* ya no está */ } } };
  },
};
