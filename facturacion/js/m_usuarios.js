// Usuarios del facturador (solo administradores): crear, cambiar nombre, reiniciar PIN, activar o desactivar. Nunca se elimina.
import { h, modal, confirmar, pedir, conBoton, toast, fechaHora, horaCorta } from './util.js';
import { api } from './api.js';
import { cargarCss, aviso, campo, soloDigitos, diaCR } from './ui_mant.js';

// PIN temporal al azar de 4 números, sin repeticiones ni secuencias obvias (1111, 1234, 4321)
function pinAzar() {
  const debil = (p) => /^(\d)\1{3}$/.test(p) || '01234567890'.includes(p) || '09876543210'.includes(p) || /^(\d\d)\1$/.test(p);
  let p;
  do { const a = new Uint32Array(1); crypto.getRandomValues(a); p = String(a[0] % 10000).padStart(4, '0'); } while (debil(p));
  return p;
}
const usuarioLimpio = (s) => s.toLowerCase().replace(/\s+/g, '');

export default {
  id: 'usuarios',
  titulo: 'Usuarios',
  async mount(root, app) {
    await cargarCss();
    if (!app.admin) {
      root.append(h('div.vacio', h('p', 'Esta pantalla es solo para administradores.'), h('button.btn', { type: 'button', onclick: () => app.ir('caja') }, 'Volver a Caja')));
      return;
    }
    const lista = h('div');
    const resumen = h('p.mt-nota');
    let usuarios = [];
    const esYo = (u) => String(u.usuario).toLowerCase() === String(app.usuario || '').toLowerCase();
    const adminsActivos = () => usuarios.filter((u) => u.admin && u.activo).length;

    async function cargar() {
      try { usuarios = await api.usuarios(); } catch (e) { lista.replaceChildren(h('div.error-caja', e.message || 'No se pudo cargar la lista de usuarios.')); return; }
      const hoy = diaCR(new Date());
      const hoyIng = (u) => u.ultimo_ingreso && diaCR(u.ultimo_ingreso) === hoy;
      const deHoy = usuarios.filter(hoyIng).sort((a, b) => new Date(b.ultimo_ingreso) - new Date(a.ultimo_ingreso));
      const resto = usuarios.filter((u) => !hoyIng(u)).sort((a, b) => a.usuario.localeCompare(b.usuario));
      resumen.textContent = 'Hoy han ingresado ' + deHoy.length + ' de ' + usuarios.filter((u) => u.activo).length + ' usuarios activos.';
      const partes = [];
      if (deHoy.length) partes.push(h('div.mt-seccion', 'Ingresaron hoy'), h('div.mt-lista', deHoy.map(tarjeta)));
      if (resto.length) partes.push(h('div.mt-seccion', deHoy.length ? 'Los demás usuarios' : 'Usuarios'), h('div.mt-lista', resto.map(tarjeta)));
      lista.replaceChildren(...partes);
    }

    // Guarda un cambio y vuelve a pintar; devuelve true si salió bien
    const guardar = (btn, datos, mensaje) => conBoton(btn, async () => { await api.usuarioGuardar(datos); if (mensaje) toast(mensaje); await cargar(); return true; });

    function tarjeta(u) {
      const bloqueado = u.bloqueado_hasta && new Date(u.bloqueado_hasta) > new Date();
      const yo = esYo(u);
      const ultimo = u.ultimo_ingreso ? 'Último ingreso: ' + fechaHora(u.ultimo_ingreso) : 'Todavía no ha ingresado';
      const btnNombre = h('button.btn', { type: 'button', onclick: () => cambiarNombre(u) }, 'Cambiar nombre');
      const btnPin = yo ? null : h('button.btn', { type: 'button', onclick: (e) => reiniciarPin(u, e.currentTarget) }, 'Reiniciar PIN');
      const btnAdmin = yo ? null : h('button.btn', { type: 'button', onclick: (e) => cambiarAdmin(u, e.currentTarget) }, u.admin ? 'Quitar administrador' : 'Hacer administrador');
      const btnActivo = yo ? null : h('button.btn' + (u.activo ? '.peligro' : ''), { type: 'button', onclick: (e) => cambiarActivo(u, e.currentTarget) }, u.activo ? 'Desactivar' : 'Activar de nuevo');
      return h('div.mt-item' + (u.activo ? '' : '.apagado'),
        h('div.mt-datos',
          h('span.mt-nombre', u.nombre || u.usuario),
          h('span.mt-sub', 'Usuario: ', h('span.mt-codigo', u.usuario)),
          h('span.mt-sub', ultimo),
          h('div.fila', { style: 'gap:.4rem;margin-top:.2rem' },
            yo ? h('span.chip.ok', 'Es usted') : null,
            h('span.chip' + (u.admin ? '.ok' : '.gris'), u.admin ? 'Administrador' : 'Usuario normal'),
            u.activo ? null : h('span.chip.mal', 'Desactivado: no puede entrar'),
            bloqueado ? h('span.chip.mal', 'Bloqueado hasta las ' + horaCorta(u.bloqueado_hasta)) : null,
            u.debe_cambiar_pin ? h('span.chip.espera', 'Debe cambiar su PIN al entrar') : null)),
        h('div.mt-btns', btnNombre, btnPin, btnAdmin, btnActivo));
    }

    async function cambiarNombre(u) {
      const v = await pedir({ titulo: 'Cambiar nombre', etiqueta: 'Nombre de la persona', valor: u.nombre || '', boton: 'Guardar nombre', nota: 'El usuario para entrar (' + u.usuario + ') no cambia.' });
      if (v == null) return;
      if (!v.trim()) return toast('Escriba un nombre.', 'error');
      await guardar(null, { id: u.id, nombre: v.trim() }, 'Nombre guardado.');
    }

    async function reiniciarPin(u, btn) {
      const ok = await confirmar('¿Reiniciar el PIN de ' + (u.nombre || u.usuario) + '? Se le dará un PIN temporal y tendrá que cambiarlo al entrar. Si estaba bloqueado, queda libre.', { si: 'Sí, reiniciar el PIN', no: 'No, volver' });
      if (!ok) return;
      const pin = pinAzar();
      const hecho = await guardar(btn, { id: u.id, pin });
      if (!hecho) return;
      modal({
        titulo: 'PIN temporal listo', ancho: 440,
        contenido: h('div', h('p', 'Dígale este PIN a ', h('strong', u.nombre || u.usuario), ':'), h('div.mt-pin-grande', pin),
          aviso('ambar', 'Anótelo ahora: no se vuelve a mostrar. Al entrar con este PIN, el sistema le pedirá elegir uno nuevo que solo esa persona conozca.')),
        botones: [{ texto: 'Ya lo anoté', clase: 'primario', onclick: (c) => c() }],
      });
    }

    async function cambiarAdmin(u, btn) {
      if (u.admin && u.activo && adminsActivos() <= 1) return toast('Tiene que quedar al menos un administrador activo.', 'error');
      const ok = await confirmar(u.admin ? '¿Quitarle a ' + (u.nombre || u.usuario) + ' el permiso de administrador? Ya no podrá ver esta pantalla de Usuarios.' : '¿Hacer administrador a ' + (u.nombre || u.usuario) + '? Podrá crear usuarios, reiniciar PIN y desactivar personas.');
      if (!ok) return;
      await guardar(btn, { id: u.id, admin: !u.admin }, u.admin ? 'Ya no es administrador.' : 'Ahora es administrador.');
    }

    async function cambiarActivo(u, btn) {
      if (u.activo && u.admin && adminsActivos() <= 1) return toast('No se puede desactivar al único administrador.', 'error');
      const ok = await confirmar(u.activo ? '¿Desactivar a ' + (u.nombre || u.usuario) + '? No podrá entrar al facturador. No se borra nada y se puede activar de nuevo.' : '¿Activar de nuevo a ' + (u.nombre || u.usuario) + '? Podrá entrar con su PIN.', { si: u.activo ? 'Sí, desactivar' : 'Sí, activar', peligro: u.activo });
      if (!ok) return;
      await guardar(btn, { id: u.id, activo: !u.activo }, u.activo ? 'Usuario desactivado.' : 'Usuario activado.');
    }

    function agregar() {
      const err = h('div.error-caja', { hidden: true, role: 'alert' });
      const mostrar = (m, el) => { err.textContent = m; err.hidden = !m; el?.focus(); };
      const usr = h('input.campo', { type: 'text', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Usuario' });
      usr.addEventListener('input', () => { const v = usuarioLimpio(usr.value); if (v !== usr.value) usr.value = v; });
      const nom = h('input.campo', { type: 'text', autocomplete: 'off', 'aria-label': 'Nombre' });
      const pin = soloDigitos(h('input.campo', { type: 'text', inputmode: 'numeric', autocomplete: 'off', maxlength: 4, 'aria-label': 'PIN de 4 números' }), 4);
      let admin = false;
      const rNo = h('input', { type: 'radio', name: 'adm', checked: true, onchange: () => { admin = false; } });
      const rSi = h('input', { type: 'radio', name: 'adm', onchange: () => { admin = true; } });
      const m = modal({
        titulo: 'Agregar usuario', ancho: 560,
        contenido: h('div.mt-form', err,
          campo('Usuario para entrar', usr, 'Letras minúsculas sin tilde ni espacios; puede llevar números, punto o guion. Entre 2 y 30 caracteres. Ejemplo: maria'),
          campo('Nombre de la persona', nom, 'Ejemplo: María Rodríguez'),
          h('div.col', { style: 'gap:.3rem' }, campo('PIN temporal (4 números)', pin, 'La persona tendrá que cambiarlo la primera vez que entre.'),
            h('div.fila', h('button.btn', { type: 'button', onclick: () => { pin.value = pinAzar(); } }, 'Generar un PIN al azar'))),
          h('div.col', { style: 'gap:.3rem' }, h('span.etq', '¿Es administrador?'),
            h('div.mt-radios', h('label', rNo, 'No, usuario normal'), h('label', rSi, 'Sí, administrador')),
            h('small.tenue', 'Un administrador puede crear usuarios y reiniciar PIN. Todos los usuarios ven todo lo demás.'))),
        botones: [{ texto: 'Cancelar', clase: 'suave', onclick: (c) => c() }, { texto: 'Crear usuario', clase: 'primario', onclick: async (c) => {
          mostrar('');
          const u = usuarioLimpio(usr.value);
          if (!/^[a-z0-9._-]{2,30}$/.test(u)) return mostrar('El usuario debe tener entre 2 y 30 caracteres: letras minúsculas sin tilde, números, punto o guion.', usr);
          if (usuarios.some((x) => x.usuario === u)) return mostrar('Ya existe un usuario "' + u + '". Elija otro.', usr);
          if (!nom.value.trim()) return mostrar('Escriba el nombre de la persona.', nom);
          if (!/^\d{4}$/.test(pin.value)) return mostrar('El PIN debe tener exactamente 4 números.', pin);
          const btn = m.el.querySelector('.modal-pie .primario');
          await conBoton(btn, async () => {
            await api.usuarioGuardar({ usuario: u, nombre: nom.value.trim(), admin, pin: pin.value });
            toast('Usuario creado. Al entrar por primera vez tendrá que cambiar su PIN.');
            c(); await cargar();
          });
        } }],
      });
      usr.focus();
    }

    root.append(
      h('div.mt-cab',
        h('div', h('h1', 'Usuarios'), h('p', 'Las personas que pueden entrar al facturador. Nunca se elimina a nadie: se desactiva.')),
        h('div.mt-acciones', h('button.btn.primario.grande', { type: 'button', onclick: agregar }, 'Agregar usuario'))),
      h('div.tarjeta', { style: 'margin-bottom:1rem' },
        h('h3', 'Cómo funciona el PIN'),
        h('ul', { style: 'margin:.4rem 0 0;padding-left:1.2rem;display:grid;gap:.3rem' },
          h('li', 'El PIN son 4 números que solo conoce cada persona. Se usa junto con el usuario para entrar.'),
          h('li', 'Si alguien se equivoca 5 veces seguidas, el usuario se bloquea durante 15 minutos. Después puede intentar de nuevo.'),
          h('li', 'Si alguien olvida su PIN, use "Reiniciar PIN": se le da uno temporal que tendrá que cambiar apenas entre. Eso también quita el bloqueo.'),
          h('li', 'Nadie puede ver el PIN de otra persona, ni siquiera un administrador.'),
          h('li', 'Por ahora todos los usuarios tienen acceso a todo el facturador. Solo esta pantalla de Usuarios es exclusiva de los administradores.'))),
      resumen, lista);
    await cargar();
  },
};
