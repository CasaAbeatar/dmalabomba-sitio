// Página de prueba: monta la pantalla «Caja para mí» con una empresa inventada. Los datos los pone la prueba (prueba sinpe caja.mjs) interceptando las llamadas al servidor.
const q = new URLSearchParams(location.search);
const modulo = (await import('../facturacion/js/m_sinpe_caja.js')).default;
window.__irA = [];
const app = { admin: q.get('admin') !== '0', soc: { id: '00000000-0000-0000-0000-00000000aaaa', codigo: 'pollos', nombre: 'EMPRESA DE PRUEBA SA', nombre_comercial: 'Pollos de prueba' }, empresa: { codigo: 'pollos' }, ir: (x) => window.__irA.push(x) };
try { await modulo.mount(document.getElementById('raiz'), app); window.__listo = true; } catch (e) { window.__errorMontar = String(e && e.stack || e); }
