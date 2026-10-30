// Avisos de efectivo por WhatsApp (Administración, solo administradores): el estado real del envío, quién recibe los avisos y los avisos de hoy.
// Lee fx_avisos_resumen, fx_avisos_destinatarios y fx_avisos_lista; escribe con fx_avisos_destinatario_guardar, fx_avisos_probar y fx_avisos_reintentar.
// Lo que dice la pantalla sale de lo que contesta la base: en modo de prueba NO promete que el aviso llegue por WhatsApp (avisos_texto.js).
// El interruptor de modo prueba/real NO está aquí: se cambia en la base (fxs_avisos_modo_real) para que nadie lo active sin querer.
import { h, esqueleto, bloqueError, textoDeError, confirmar, conBoton, toast, modal, money, leerNumero, horaCorta, fechaCorta, hoyCR, nombrePropio, conPunto } from './util.js';
import { cargarHoja } from './ui_hojas.js';
import { soloDigitos } from './ui_mant.js';
import { avisos } from './api_avisos.js';
import { EVENTOS, TITULO_EVENTO, NOTA_DEVOLUCIONES, cuantasCosas, estadoAvisos, resumenDeEstado, telefonoBonito, estadoDeAviso, vistaPrevia } from './avisos_texto.js';

const lista = (x) => (Array.isArray(x) ? x.filter((i) => i && typeof i === 'object') : []);

export default {
  id: 'avisos',
  titulo: 'Avisos',
  async mount(root, app) {
    await cargarHoja('avisos.css');
    if (!app.admin) {
      root.append(h('div.vacio', h('p', 'Esta pantalla es solo para administradores.'), h('button.btn', { type: 'button', onclick: () => app.ir('inicio') }, 'Volver al inicio')));
      return;
    }
    const cuerpo = h('div.av-cuerpo');
    let nCarga = 0, vivo = true;
    let E = null, personas = [], deHoy = null; // estado, destinatarios, avisos de hoy (null = no se pudo leer)

    async function cargar() {
      const mi = ++nCarga, soc = app.socId, hoy = hoyCR();
      if (!cuerpo.children.length || cuerpo.querySelector('.bloque-error')) cuerpo.replaceChildren(esqueleto(4, 'Revisando los avisos…'));
      const [r, d, l] = await Promise.allSettled([avisos.resumen(soc), avisos.destinatarios(soc), avisos.lista(soc, hoy, hoy)]);
      if (!vivo || mi !== nCarga) return;
      if (r.status === 'rejected' || !(E = estadoAvisos(r.value))) {
        cuerpo.replaceChildren(bloqueError({ titulo: 'No se pudo revisar el estado de los avisos', mensaje: r.status === 'rejected' ? textoDeError(r.reason) : 'El sistema no devolvió los datos. Intente de nuevo en un momento.', alReintentar: () => cargar() }));
        return;
      }
      personas = d.status === 'fulfilled' ? lista(d.value) : null;
      deHoy = l.status === 'fulfilled' ? lista(l.value) : null;
      pintar(d.status === 'rejected' ? d.reason : null, l.status === 'rejected' ? l.reason : null);
    }

    /* ---------- 1. El estado, en una frase ---------- */
    function estado() {
      const s = resumenDeEstado(E);
      return h('section.av-estado.' + s.nivel, { role: 'status' },
        h('div.av-estado-fila',
          h('div', h('h2', s.titulo), h('p', s.texto)),
          E.conError > 0 ? h('button.btn.primario', { type: 'button', onclick: (e) => reintentar(e.currentTarget) }, 'Reintentar') : null),
        h('p.av-cifras', 'Personas que reciben avisos: ', h('strong', String(E.personas)), ' · Avisos de hoy: ', h('strong', String(E.hoy)), ' · En cola: ', h('strong', String(E.pendientes))));
    }
    async function reintentar(btn) {
      await conBoton(btn, async () => {
        const r = await avisos.reintentar(app.socId);
        toast(r && r.avisos > 0 ? 'Se mandaron a la cola ' + r.avisos + (r.avisos === 1 ? ' aviso para reintentar.' : ' avisos para reintentar.') : 'No había avisos para reintentar.');
        await cargar();
      });
    }

    /* ---------- 2. Quién recibe los avisos ---------- */
    function tarjetaPersona(p) {
      const activa = p.activo === true;
      const evs = (Array.isArray(p.eventos) ? p.eventos : []).map((k) => TITULO_EVENTO[k]).filter(Boolean);
      const min = Number(p.monto_minimo) || 0;
      return h('li.av-persona' + (activa ? '' : '.apagada'),
        h('div.av-persona-datos',
          h('div.av-persona-nombre', nombrePropio(p.nombre || ''), ' ', h('span.chip.' + (activa ? 'ok' : 'gris'), activa ? 'Recibe avisos' : 'No recibe avisos')),
          h('div.av-tel', telefonoBonito(p.telefono)),
          h('div.av-evs', evs.length ? evs.map((t) => h('span.chip.gris', t)) : h('span.tenue', 'Sin ningún aviso escogido')),
          // Una persona agregada antes de que existiera este aviso no lo recibe hasta que se lo active (la base avisa solo a quien lo tiene escogido)
          activa && evs.length && !(Array.isArray(p.eventos) && p.eventos.includes('devolucion_efectivo')) ? h('div.av-min', 'No recibe el aviso de devolución de efectivo con nota de crédito. Toque «Cambiar datos» si quiere que lo reciba.') : null,
          h('div.av-min', min > 0 ? 'Solo avisos de ' + money(min) + ' o más.' : 'Todos los montos.'),
          h('div.av-cons', p.consentimiento_en ? 'Aceptó recibir avisos el ' + fechaCorta(p.consentimiento_en) + (p.consentimiento_por ? ' (lo confirmó ' + p.consentimiento_por + ').' : '.') : 'Falta confirmar que aceptó recibir avisos.')),
        h('div.av-persona-btns',
          h('button.btn', { type: 'button', onclick: () => formulario(p) }, 'Cambiar datos'),
          h('button.btn' + (activa ? '' : '.primario'), { type: 'button', onclick: (e) => alternar(p, e.currentTarget) }, activa ? 'Dejar de avisarle' : 'Volver a avisarle'),
          activa ? h('button.btn', { type: 'button', onclick: (e) => probar(p, e.currentTarget) }, 'Enviar aviso de prueba') : null));
    }
    function quienRecibe(errLista) {
      return h('section.tarjeta.av-seccion',
        h('div.av-seccion-cab', h('h2', 'Quién recibe los avisos'), h('button.btn.primario', { type: 'button', onclick: () => formulario(null) }, 'Agregar persona')),
        personas == null
          ? bloqueError({ titulo: 'No se pudo cargar la lista de personas', mensaje: textoDeError(errLista), alReintentar: () => cargar() })
          : personas.length ? h('ul.av-personas', personas.map(tarjetaPersona))
            : h('p.av-vacio', 'Todavía no hay nadie que reciba avisos. Toque «Agregar persona» para escribir el nombre y el teléfono de quien debe enterarse.'),
        h('p.av-nota', 'El sistema avisa de ' + cuantasCosas() + ': ' + EVENTOS.map((e) => e.titulo.toLowerCase()).join(', ') + '. ' + NOTA_DEVOLUCIONES));
    }

    async function alternar(p, btn) {
      const activa = p.activo === true;
      if (activa && !(await confirmar('¿Dejar de avisarle a ' + (nombrePropio(p.nombre || '') || 'esta persona') + '? No se borra: puede volver a activarla cuando quiera.', { si: 'Sí, dejar de avisarle', no: 'No, volver' }))) return;
      await conBoton(btn, async () => {
        await avisos.guardar(app.socId, { id: p.id, nombre: p.nombre, telefono: p.telefono, eventos: p.eventos, monto_minimo: p.monto_minimo, activo: !activa });
        toast(activa ? 'Listo. Ya no se le avisa a ' + (nombrePropio(p.nombre || '') || 'esa persona') + '.' : 'Listo. Se le avisará a ' + (nombrePropio(p.nombre || '') || 'esa persona') + '.');
        await cargar();
      });
    }
    async function probar(p, btn) {
      if (!(await confirmar('Se prepara un aviso de prueba para ' + (nombrePropio(p.nombre || '') || 'esta persona') + '. Dirá que es una prueba y no es un movimiento de caja real.', { si: 'Sí, preparar la prueba', no: 'No, volver' }))) return;
      await conBoton(btn, async () => {
        const r = await avisos.probar(app.socId, p.id);
        toast(r && r.modo === 'real' ? 'Aviso de prueba en camino por WhatsApp.' : 'Aviso de prueba registrado. En modo de prueba no se envía por WhatsApp.', 'ok', 6000);
        await cargar();
      });
    }

    // Ventana para agregar o cambiar a una persona. Si el teléfono cambia, hay que volver a confirmar que aceptó recibir avisos (así lo exige la base).
    function formulario(p) {
      const nueva = !p;
      const err = h('div.error-caja', { hidden: true, role: 'alert' });
      const mostrar = (m, el) => { err.textContent = m; err.hidden = !m; el?.focus(); };
      const digitos0 = String(p?.telefono || '').replace(/\D/g, '').replace(/^506/, '');
      const nombre = h('input.campo', { type: 'text', maxlength: 60, autocomplete: 'off', value: p?.nombre || '', 'aria-label': 'Nombre de la persona' });
      const tel = soloDigitos(h('input.campo.av-tel-campo', { type: 'text', inputmode: 'numeric', autocomplete: 'off', maxlength: 8, value: /^\d{8}$/.test(digitos0) ? digitos0 : '', placeholder: '88887777', 'aria-label': 'Teléfono de 8 números' }), 8);
      const evsActuales = new Set(Array.isArray(p?.eventos) ? p.eventos : EVENTOS.filter((e) => e.nuevo).map((e) => e.clave));
      const cajas = EVENTOS.map((e) => ({ clave: e.clave, cb: h('input', { type: 'checkbox', checked: evsActuales.has(e.clave) }), e }));
      const min = h('input.campo', { type: 'text', inputmode: 'decimal', autocomplete: 'off', value: Number(p?.monto_minimo) > 0 ? String(Number(p.monto_minimo)) : '0', 'aria-label': 'Monto mínimo en colones' });
      const cons = h('input', { type: 'checkbox' });
      const filaCons = h('div.av-cons-fila');
      const telCambio = () => !nueva && tel.value !== digitos0;
      const pintarCons = () => {
        const hace = nueva || telCambio() || !p?.consentimiento_en;
        filaCons.replaceChildren(hace
          ? h('label.av-check', cons, h('span', 'Confirmo que esta persona aceptó recibir estos avisos por WhatsApp.'))
          : h('p.av-nota', 'Aceptó recibir avisos el ' + fechaCorta(p.consentimiento_en) + '.'));
      };
      tel.addEventListener('input', pintarCons); pintarCons();
      const m = modal({
        titulo: nueva ? 'Agregar persona' : 'Cambiar datos', ancho: 540,
        contenido: h('div.av-form', err,
          h('label.etq', 'Nombre', nombre),
          h('label.etq', 'Teléfono de WhatsApp', h('div.av-tel-fila', h('span.av-prefijo', '+506'), tel), h('small', '8 números, sin espacios. Por ejemplo 88887777.')),
          h('fieldset.av-eventos', h('legend', 'Qué avisos recibe'),
            cajas.map((c) => h('label.av-check', c.cb, h('span', h('strong', c.e.titulo), h('small', c.e.ayuda)))),
            h('p.av-nota', NOTA_DEVOLUCIONES)),
          h('label.etq', 'Monto mínimo (₡)', min, h('small', 'Solo avisa si el movimiento es de esta cantidad o más. Deje 0 para recibir todos.')),
          filaCons),
        botones: [{ texto: 'Cancelar', clase: 'suave', onclick: (c) => c() }, { texto: nueva ? 'Agregar persona' : 'Guardar cambios', clase: 'primario', onclick: async (c) => {
          mostrar('');
          const nom = nombre.value.trim();
          if (nom.length < 2) return mostrar('Escriba el nombre de la persona.', nombre);
          if (!/^\d{8}$/.test(tel.value)) return mostrar('El teléfono debe tener 8 números, por ejemplo 88887777.', tel);
          const v = min.value.trim() === '' ? 0 : leerNumero(min.value);
          if (!Number.isFinite(v) || v < 0) return mostrar('El monto mínimo debe ser un número, por ejemplo 5000, o 0 para recibir todos.', min);
          const eventos = cajas.filter((x) => x.cb.checked).map((x) => x.clave);
          const pide = nueva || telCambio() || !p?.consentimiento_en;
          if (pide && !cons.checked) return mostrar('Marque la casilla: hace falta confirmar que la persona aceptó recibir los avisos por WhatsApp.', cons);
          const btn = m.el.querySelector('.modal-pie .primario');
          await conBoton(btn, async () => {
            const datos = { nombre: nom, telefono: '+506' + tel.value, eventos, monto_minimo: v, activo: nueva ? true : p.activo === true, ...(pide ? { consentimiento: true } : {}), ...(nueva ? {} : { id: p.id }) };
            try { await avisos.guardar(app.socId, datos); } catch (e) { mostrar(conPunto(textoDeError(e)), nombre); return; }
            toast(nueva ? 'Listo. Se le avisará a ' + nom + '.' : 'Cambios guardados.');
            c(); await cargar();
          });
        } }],
      });
      nombre.focus();
    }

    /* ---------- 3. Los avisos de hoy ---------- */
    function filaAviso(a) {
      const [color, texto] = estadoDeAviso(a);
      const par = Array.isArray(a.parametros) ? a.parametros : [];
      const que = (par[1] && String(par[1])) || TITULO_EVENTO[a.tipo] || 'Aviso';
      return h('li.av-aviso',
        h('div.av-aviso-fila',
          h('span.av-hora', horaCorta(a.creado_en)),
          h('span.av-aviso-que', h('strong', que), par[2] ? ' · ₡' + par[2] : ''),
          h('span.av-aviso-quien', 'Para ' + nombrePropio(a.destinatario || '')),
          a.es_prueba ? h('span.chip.espera', 'Prueba') : null,
          h('span.chip.' + color, texto)),
        E?.plantilla ? h('details.av-previa', h('summary', 'Ver el mensaje'), h('p', vistaPrevia(E.plantilla, par))) : null);
    }
    function avisosDeHoy(errLista) {
      const orden = deHoy ? [...deHoy].sort((x, y) => new Date(y.creado_en) - new Date(x.creado_en)) : [];
      return h('section.tarjeta.av-seccion',
        h('h2', 'Avisos de hoy'),
        deHoy == null
          ? bloqueError({ titulo: 'No se pudieron cargar los avisos de hoy', mensaje: textoDeError(errLista), alReintentar: () => cargar() })
          : orden.length ? h('ul.av-avisos', orden.map(filaAviso)) : h('p.av-vacio', 'Hoy todavía no se ha registrado ningún aviso.'));
    }

    function pintar(errPersonas, errHoy) {
      cuerpo.replaceChildren(estado(), quienRecibe(errPersonas), avisosDeHoy(errHoy));
    }

    root.append(h('div.av',
      h('div.av-cab',
        h('p', 'Aquí se ve si los avisos de entradas y salidas de efectivo se están enviando por WhatsApp, y quién los recibe.'),
        h('button.btn', { type: 'button', onclick: (e) => conBoton(e.currentTarget, () => cargar()) }, 'Revisar de nuevo')),
      cuerpo));
    await cargar();
    return () => { vivo = false; nCarga++; };
  },
};
