// Usuarios del facturador (solo administradores): crear, cambiar nombre, reiniciar PIN, activar o desactivar. Nunca se elimina.
// Cada empresa tiene sus usuarios: el servidor (fx_usuarios) entrega solo los de la empresa de la sesión y un usuario nuevo queda en esa empresa.
// fx_usuarios trae por usuario `empresas: [{ id, codigo, nombre_comercial }]`; de la fila del propio administrador salen las OTRAS empresas a las que él tiene acceso (casilla «También puede entrar a …»).
import { h, modal, confirmar, pedir, conBoton, toast, fechaHora, fechaCorta, pinDebil, conPunto, nombrePropio, nombreLocal, bloqueError, textoDeError } from './util.js';
import { api } from './api.js';
import { seguridad, normalizarSeguridad, normalizarAparatos } from './api_seguridad.js';
import { haceCuanto } from './api_respaldos.js';
import { cargarCss, aviso, campo, soloDigitos, diaCR } from './ui_mant.js';

// PIN temporal al azar de 4 números, con la misma regla que se exige al elegir uno (util.js pinDebil): sin repeticiones ni secuencias (1111, 1212, 1234, 4321)
function pinAzar() {
  let p;
  do { const a = new Uint32Array(1); crypto.getRandomValues(a); p = String(a[0] % 10000).padStart(4, '0'); } while (pinDebil(p));
  return p;
}
const usuarioLimpio = (s) => s.toLowerCase().replace(/\s+/g, '');

export default {
  id: 'usuarios',
  titulo: 'Usuarios',
  async mount(root, app) {
    await cargarCss();
    if (!app.admin) {
      root.append(h('div.vacio', h('p', 'Esta pantalla es solo para administradores.'), h('button.btn', { type: 'button', onclick: () => app.ir('inicio') }, 'Volver al inicio')));
      return;
    }
    const lista = h('div');
    const resumen = h('p.mt-nota');
    const segEl = h('section.tarjeta.mt-seg', { 'aria-label': 'Seguridad del ingreso' });
    const aparEl = h('section.tarjeta.mt-apa', { 'aria-label': 'Aparatos de confianza' });
    let usuarios = [];
    const esYo = (u) => String(u.usuario).toLowerCase() === String(app.usuario || '').toLowerCase();
    const miEmpresa = app.empresa?.nombre || 'esta empresa';
    const otrasEmpresas = (u) => (u?.empresas || []).filter((e) => e.id !== app.socId);
    const otrasMias = () => otrasEmpresas(usuarios.find(esYo)); // empresas a las que el administrador también puede dar acceso
    const adminsActivos = () => usuarios.filter((u) => u.admin && u.activo).length;

    let nCarga = 0; // cada carga lleva su número: si llega tarde la respuesta de una anterior (dos cambios seguidos), se descarta
    async function cargar() {
      const mi = ++nCarga;
      let nuevos;
      try { nuevos = await api.usuarios(); } catch (e) {
        if (mi !== nCarga) return;
        resumen.textContent = '';
        lista.replaceChildren(bloqueError({ titulo: 'No se pudo cargar la lista de usuarios', mensaje: textoDeError(e), alReintentar: () => cargar() }));
        return;
      }
      if (mi !== nCarga) return;
      usuarios = nuevos;
      if (ultimaSeg) pintarSeguridad(); // con los usuarios a mano, cada aviso puede ofrecer «Reiniciar PIN»
      const hoy = diaCR(new Date());
      // Solo cuentan los usuarios activos, en los dos números de la frase y en la lista de arriba
      const hoyIng = (u) => u.activo && u.ultimo_ingreso && diaCR(u.ultimo_ingreso) === hoy;
      const deHoy = usuarios.filter(hoyIng).sort((a, b) => new Date(b.ultimo_ingreso) - new Date(a.ultimo_ingreso));
      const resto = usuarios.filter((u) => !hoyIng(u)).sort((a, b) => a.usuario.localeCompare(b.usuario));
      const nActivos = usuarios.filter((u) => u.activo).length;
      resumen.textContent = 'Hoy han ingresado ' + deHoy.length + ' de ' + nActivos + (nActivos === 1 ? ' usuario activo.' : ' usuarios activos.');
      const partes = [];
      if (deHoy.length) partes.push(h('div.mt-seccion', 'Ingresaron hoy'), h('div.mt-lista', deHoy.map(tarjeta)));
      if (resto.length) partes.push(h('div.mt-seccion', deHoy.length ? 'Los demás usuarios' : 'Usuarios'), h('div.mt-lista', resto.map(tarjeta)));
      lista.replaceChildren(...partes);
    }

    // Guarda un cambio y vuelve a pintar; devuelve true si salió bien
    const guardar = (btn, datos, mensaje) => conBoton(btn, async () => { await api.usuarioGuardar(datos); if (mensaje) toast(mensaje); await cargar(); return true; });

    function tarjeta(u) {
      const yo = esYo(u);
      const ultimo = u.ultimo_ingreso ? 'Último ingreso: ' + fechaHora(u.ultimo_ingreso) : 'Todavía no ha ingresado';
      const btnNombre = h('button.btn', { type: 'button', onclick: () => cambiarNombre(u) }, 'Cambiar nombre');
      const btnPin = yo ? null : h('button.btn', { type: 'button', onclick: (e) => reiniciarPin(u, e.currentTarget) }, 'Reiniciar PIN');
      const btnAdmin = yo ? null : h('button.btn', { type: 'button', onclick: (e) => cambiarAdmin(u, e.currentTarget) }, u.admin ? 'Quitar administrador' : 'Hacer administrador');
      const btnActivo = yo ? null : h('button.btn' + (u.activo ? '.peligro' : ''), { type: 'button', onclick: (e) => cambiarActivo(u, e.currentTarget) }, u.activo ? 'Desactivar' : 'Activar de nuevo');
      return h('div.mt-item' + (u.activo ? '' : '.apagado'),
        h('div.mt-datos',
          h('span.mt-nombre', nombrePropio(u.nombre || u.usuario)),
          h('span.mt-sub', 'Usuario: ', h('span.mt-codigo', u.usuario)),
          h('span.mt-sub', ultimo),
          h('div.fila', { style: 'gap:.4rem;margin-top:.2rem' },
            yo ? h('span.chip.ok', 'Es usted') : null,
            h('span.chip' + (u.admin ? '.ok' : '.gris'), u.admin ? 'Administrador' : 'Usuario normal'),
            u.activo ? null : h('span.chip.mal', 'Desactivado: no puede entrar'),
            otrasEmpresas(u).map((e) => h('span.chip.gris', 'También entra a ' + nombreLocal(e))),
            u.debe_cambiar_pin ? h('span.chip.espera', 'Debe cambiar su PIN al entrar') : null)),
        h('div.mt-btns', btnNombre, btnPin, btnAdmin, btnActivo));
    }

    /* ---------- Seguridad del ingreso: avisos por muchos intentos fallidos de PIN (fx_login_alertas) ---------- */
    // Qué conviene hacer según el tipo de aviso. El texto del aviso lo escribe la base; esto solo orienta.
    const QUE_HACER = {
      usuario_fallos: 'Si fue esa persona equivocándose, no pasa nada. Si no, reinicie su PIN.',
      total_fallos: 'Pueden ser varias personas equivocándose, o alguien probando PIN. Si no hubo cambio de personal, vale la pena reiniciar el PIN de quien usted note raro.',
      acierto_tras_fallos: 'Pregúntele a esa persona si fue ella. Si no fue, reinicie su PIN ahora.',
    };
    let nSeg = 0, ultimaSeg = null; // ultimaSeg = lo último que contestó fx_login_alertas (ya limpio); se vuelve a pintar cuando llega la lista de usuarios
    async function cargarSeguridad() {
      const mi = ++nSeg;
      let r;
      try { r = normalizarSeguridad(await seguridad.alertas()); } catch (e) {
        if (mi !== nSeg) return;
        ultimaSeg = null;
        segEl.className = 'tarjeta mt-seg';
        segEl.replaceChildren(h('h2', 'Seguridad del ingreso'), bloqueError({ titulo: 'No se pudieron cargar los avisos de ingreso', mensaje: textoDeError(e), alReintentar: () => cargarSeguridad() }));
        return;
      }
      if (mi !== nSeg) return;
      ultimaSeg = r;
      pintarSeguridad();
    }
    function pintarSeguridad() {
      const r = ultimaSeg;
      if (!r) { if (!segEl.children.length) segEl.replaceChildren(h('h2', 'Seguridad del ingreso'), h('p.mt-nota', 'Revisando los avisos de ingreso…')); return; }
      const pend = r.ultimas.filter((a) => !a.atendida), antes = r.ultimas.filter((a) => a.atendida);
      // El número de pendientes lo cuenta la base sobre todos los avisos; la lista trae los 20 más nuevos
      const masSinVer = Math.max(0, r.pendientes - pend.length);
      segEl.className = 'tarjeta mt-seg' + (r.pendientes > 0 ? ' con-avisos' : '');
      // replaceChildren escribe «null» si recibe un null: se quitan los huecos antes
      segEl.replaceChildren(...[
        h('div.mt-seg-cab', h('h2', 'Seguridad del ingreso'),
          r.pendientes > 0 ? h('span.chip.mal', r.pendientes === 1 ? '1 aviso sin atender' : r.pendientes + ' avisos sin atender') : h('span.chip.ok', 'Sin avisos pendientes')),
        h('p.mt-nota', 'Aquí aparece un aviso cuando alguien se equivoca muchas veces con el PIN. El ingreso nunca se bloquea: esto es solo para que usted se entere.'),
        pend.length ? h('ul.mt-seg-lista', pend.map(avisoIngreso)) : (r.pendientes > 0 ? null : h('p.mt-seg-ok', 'No hay avisos de ingreso por atender.')),
        masSinVer > 0 ? h('p.mt-nota', 'Hay ' + masSinVer + (masSinVer === 1 ? ' aviso más' : ' avisos más') + ' sin atender, más antiguos que los de arriba. Atienda estos y aparecerán.') : null,
        pend.length ? h('p.mt-seg-pie', 'La red se muestra resumida, sin la dirección completa.') : null,
        antes.length ? h('details.mt-seg-antes', h('summary', 'Avisos ya atendidos (' + antes.length + ')'),
          h('ul', antes.map((a) => h('li', h('span', fechaHora(a.creada_en) + ' · ' + a.mensaje), h('span.chip.gris', 'Atendido'))))) : null].filter(Boolean));
    }

    // De dónde vino el intento, en palabras simples. El texto del aviso (lo escribe la base) ya nombra la primera red y, cuando lo sabe, el aparato:
    // aquí solo se suma lo que ese texto no dice (las otras redes con su cuenta de intentos, y si la red o el aparato son conocidos).
    function origenDe(a) {
      const m = a.mensaje || '';
      const red = (x) => (x.ip === 'sin dato' ? 'una red que no se pudo identificar' : 'la red ' + x.ip) + (x.fallos ? ' (' + (x.fallos === 1 ? '1 intento' : x.fallos + ' intentos') + ')' : '');
      const partes = [];
      if (a.ips.length > 1) partes.push('Los intentos vinieron de ' + a.ips.map(red).join(', ') + '.');
      else if (a.ips.length === 1 && a.ips[0].ip !== 'sin dato' && !m.includes(a.ips[0].ip)) partes.push('Los intentos vinieron de ' + red(a.ips[0]) + '.');
      else if (!a.ips.length && a.ip && a.ip !== 'sin dato' && !m.includes(a.ip)) partes.push('Red: ' + a.ip + '.');
      if (a.ip_conocida != null && !/red (nueva|que esa persona ya usa)/i.test(m)) partes.push(a.ip_conocida ? 'Es una red que esa persona ya usa.' : 'Es una red nueva para esa persona.');
      if (a.aparato && !/aparato/i.test(m)) {
        const quien = a.aparato.etiqueta ? ' (' + a.aparato.etiqueta + ')' : '';
        partes.push((a.tipo === 'acierto_tras_fallos' ? 'Entró' : 'Los intentos vinieron') + ' desde un aparato ' + (a.aparato.estado === 'nuevo' ? 'nuevo' : 'que ya se conocía') + quien + '.');
      }
      return partes.join(' ');
    }

    function avisoIngreso(a) {
      const origen = origenDe(a);
      const quien = a.usuario ? usuarios.find((u) => u.usuario === a.usuario) : null;
      const btnAtender = h('button.btn.primario', { type: 'button', onclick: (e) => atenderAviso(a, e.currentTarget) }, 'Marcar como atendida');
      const btnPin = quien && !esYo(quien) && quien.activo ? h('button.btn', { type: 'button', onclick: (e) => reiniciarPin(quien, e.currentTarget) }, 'Reiniciar PIN de ' + nombrePropio(quien.nombre || quien.usuario)) : null;
      return h('li.mt-seg-aviso',
        h('p.mt-seg-que', a.mensaje || 'Aviso de ingreso.'),
        origen ? h('p.mt-seg-origen', origen) : null,
        h('p.mt-seg-cuando', a.creada_en ? fechaHora(a.creada_en) + ' (' + haceCuanto(a.creada_en) + ')' : ''),
        QUE_HACER[a.tipo] ? h('p.mt-seg-guia', QUE_HACER[a.tipo]) : null,
        h('div.mt-seg-btns', btnAtender, btnPin));
    }

    async function atenderAviso(a, btn) {
      const nota = await pedir({ titulo: 'Marcar como atendida', etiqueta: 'Nota (opcional)', multilinea: true, boton: 'Marcar como atendida', nota: 'Por ejemplo: «Era María, se equivocó» o «Se reinició el PIN». Hasta 300 letras.' });
      if (nota == null) return;
      if (nota.trim().length > 300) return toast('La nota puede tener hasta 300 letras.', 'error');
      await conBoton(btn, async () => {
        await seguridad.atender(a.id, nota.trim() || null);
        toast('Aviso marcado como atendido.');
        app.alertas?.refrescar?.(); // la insignia de Usuarios se pone al día
        await cargarSeguridad();
      });
    }

    /* ---------- Aparatos de confianza (fx_login_aparatos): los aparatos desde los que cada persona ya entró; se les puede quitar la confianza ---------- */
    let nApa = 0, ultimaApa = null, verTodos = false;
    const cbTodos = h('input', { type: 'checkbox', onchange: () => { verTodos = cbTodos.checked; cargarAparatos(); } });
    async function cargarAparatos() {
      const mi = ++nApa;
      let r = null, falla = null;
      try { r = normalizarAparatos(await seguridad.aparatos(null, verTodos)); if (!r) falla = new Error('El sistema contestó algo que no se pudo leer.'); } catch (e) { falla = e; }
      if (mi !== nApa) return;
      if (falla) {
        ultimaApa = null;
        aparEl.replaceChildren(h('h2', 'Aparatos de confianza'), bloqueError({ titulo: 'No se pudo cargar la lista de aparatos', mensaje: textoDeError(falla), alReintentar: () => cargarAparatos() }));
        return;
      }
      ultimaApa = r; pintarAparatos();
    }
    function filaAparato(a) {
      const estado = a.activo ? '' : (a.revocado_en ? 'Se le quitó la confianza el ' + fechaCorta(a.revocado_en) + '.' : 'Venció el ' + fechaCorta(a.vence_en) + '.');
      const datos = [a.desde ? 'Desde el ' + fechaCorta(a.desde) : '', a.ultimo_uso ? 'último uso ' + haceCuanto(a.ultimo_uso) : 'sin uso registrado', a.activo && a.vence_en ? 'vence el ' + fechaCorta(a.vence_en) : '', a.ip_resumen ? 'red ' + a.ip_resumen : ''].filter(Boolean).join(' · ');
      return h('li.mt-apa-item' + (a.activo ? '' : '.inactivo'),
        h('div.mt-apa-datos', h('strong', a.etiqueta || 'Aparato sin nombre'), h('p.mt-apa-linea', datos + (estado ? ' · ' + estado : ''))),
        a.activo ? h('button.btn', { type: 'button', onclick: (e) => quitarConfianza(a, e.currentTarget) }, 'Quitar confianza') : h('span.chip.gris', 'Sin confianza'));
    }
    function pintarAparatos() {
      const r = ultimaApa;
      if (!r) { if (!aparEl.children.length) aparEl.replaceChildren(h('h2', 'Aparatos de confianza'), h('p.mt-nota', 'Revisando los aparatos…')); return; }
      // Agrupados por persona, en el orden que manda la base (por usuario, el de uso más reciente primero)
      const grupos = new Map();
      for (const a of r.aparatos) { const k = a.usuario || '—'; if (!grupos.has(k)) grupos.set(k, { nombre: a.nombre || a.usuario, usuario: a.usuario, lista: [] }); grupos.get(k).lista.push(a); }
      aparEl.replaceChildren(...[
        h('div.mt-seg-cab', h('h2', 'Aparatos de confianza'), h('span.chip' + (r.activos ? '.ok' : '.gris'), r.activos === 1 ? '1 aparato activo' : r.activos + ' aparatos activos')),
        h('p.mt-nota', 'Un aparato de confianza es uno que el sistema reconoce porque esa persona ya entró desde él. Se olvida solo si pasan 90 días sin usarlo. Con esto los avisos de ingreso pueden decir si un intento vino de un aparato conocido.'),
        h('p.mt-nota', 'Quitar la confianza no cierra la sesión que esa persona tenga abierta ni le impide entrar con su PIN. Para cortar el acceso, reinicie su PIN o desactívela en la lista de usuarios, más arriba.'),
        r.aparatos.length ? [...grupos.values()].map((g) => h('div.mt-apa-grupo', h('h3', nombrePropio(g.nombre || '') + (g.usuario && nombrePropio(g.nombre || '').toLowerCase() !== g.usuario ? ' (' + g.usuario + ')' : '')), h('ul.mt-apa-lista', g.lista.map(filaAparato))))
          : h('p.mt-seg-ok', verTodos ? 'No hay aparatos registrados.' : 'No hay aparatos de confianza activos.'),
        h('label.mt-apa-ver', cbTodos, h('span', 'Mostrar también los que ya no valen (quitados o vencidos)'))].flat());
    }
    async function quitarConfianza(a, btn) {
      const quien = nombrePropio(a.nombre || a.usuario || 'esa persona');
      let motivo = '';
      for (;;) {
        const v = await pedir({ titulo: 'Quitar la confianza a este aparato', etiqueta: 'Motivo (de 3 a 200 letras)', valor: motivo, multilinea: true, boton: 'Quitar la confianza',
          nota: (a.etiqueta ? '«' + a.etiqueta + '», de ' + quien + '. ' : 'Aparato de ' + quien + '. ') + 'En los avisos de ingreso dejará de aparecer como aparato conocido. No se cierra su sesión abierta: para cortarle el acceso, reinicie su PIN o desactívela. El motivo queda anotado.' });
        if (v == null) return;
        motivo = v.trim();
        if (motivo.length < 3) { toast('Escriba el motivo, al menos 3 letras.', 'error'); continue; }
        if (motivo.length > 200) { toast('El motivo puede tener hasta 200 letras.', 'error'); continue; }
        break;
      }
      await conBoton(btn, async () => {
        const r = await seguridad.quitarAparato(a.id, motivo);
        toast(r && r.ya_estaba_revocado ? 'Ese aparato ya estaba sin confianza.' : 'Listo. Se quitó la confianza a ese aparato de ' + quien + '. Su sesión abierta sigue igual.', 'ok', 6000);
        await cargarAparatos();
      });
    }

    async function cambiarNombre(u) {
      const v = await pedir({ titulo: 'Cambiar nombre', etiqueta: 'Nombre de la persona', valor: u.nombre || '', boton: 'Guardar nombre', nota: 'El usuario para entrar (' + u.usuario + ') no cambia.' });
      if (v == null) return;
      if (!v.trim()) return toast('Escriba un nombre.', 'error');
      await guardar(null, { id: u.id, nombre: v.trim() }, 'Nombre guardado.');
    }

    async function reiniciarPin(u, btn) {
      const ok = await confirmar('¿Reiniciar el PIN de ' + (u.nombre || u.usuario) + '? Se le dará un PIN temporal y tendrá que cambiarlo al entrar.', { si: 'Sí, reiniciar el PIN', no: 'No, volver' });
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
      if (u.admin && u.activo && adminsActivos() <= 1) return toast('Tiene que quedar al menos un administrador activo. Primero haga administrador a otra persona.', 'error', 7000);
      const ok = await confirmar(u.admin ? '¿Quitarle a ' + (u.nombre || u.usuario) + ' el permiso de administrador? Ya no podrá ver esta pantalla de Usuarios.' : '¿Hacer administrador a ' + (u.nombre || u.usuario) + '? Podrá crear usuarios, reiniciar PIN y desactivar personas.');
      if (!ok) return;
      await guardar(btn, { id: u.id, admin: !u.admin }, u.admin ? 'Ya no es administrador.' : 'Ahora es administrador.');
    }

    async function cambiarActivo(u, btn) {
      if (u.activo && u.admin && adminsActivos() <= 1) return toast('No se puede desactivar al único administrador activo. Primero haga administrador a otra persona.', 'error', 7000);
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
      // Otras empresas a las que este administrador también tiene acceso: una casilla por cada una
      const extras = otrasMias().map((e) => ({ id: e.id, nombre: nombreLocal(e), cb: h('input', { type: 'checkbox' }) }));
      const m = modal({
        titulo: 'Agregar usuario', ancho: 560,
        contenido: h('div.mt-form', err,
          h('div.col', { style: 'gap:.3rem' }, h('span.etq', 'Empresa'),
            h('div.fila', h('span.chip.ok', miEmpresa)),
            extras.length ? h('div.mt-radios.una', extras.map((x) => h('label', x.cb, 'También puede entrar a ' + x.nombre))) : null,
            h('small.tenue', extras.length ? 'La persona queda en ' + miEmpresa + '. Marque la otra empresa solo si también trabaja allá.' : 'La persona queda en ' + miEmpresa + ' y solo entra a esta empresa.')),
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
          if (usuarios.some((x) => x.usuario === u)) return mostrar('Ya existe un usuario «' + u + '». Elija otro.', usr);
          if (!nom.value.trim()) return mostrar('Escriba el nombre de la persona.', nom);
          if (!/^\d{4}$/.test(pin.value)) return mostrar('El PIN debe tener exactamente 4 números.', pin);
          if (pinDebil(pin.value)) return mostrar(conPunto(pinDebil(pin.value)) + ' Use el botón «Generar un PIN al azar» o escriba otro.', pin);
          const btn = m.el.querySelector('.modal-pie .primario');
          await conBoton(btn, async () => {
            const ids = extras.filter((x) => x.cb.checked).map((x) => x.id);
            await api.usuarioGuardar({ usuario: u, nombre: nom.value.trim(), admin, pin: pin.value, sociedad_id: app.socId, ...(ids.length ? { empresas: ids } : {}) });
            toast('Usuario creado. Al entrar por primera vez tendrá que cambiar su PIN.');
            c(); await cargar();
          });
        } }],
      });
      usr.focus();
    }

    root.append(
      h('div.mt-cab',
        h('div', h('p', 'Las personas que pueden entrar al facturador de ', h('strong', miEmpresa), '. Nunca se elimina a nadie: se desactiva.')),
        h('div.mt-acciones', h('button.btn.primario.grande', { type: 'button', onclick: agregar }, 'Agregar usuario'))),
      segEl, resumen, lista, aparEl,
      // Lo de hoy primero (quién ingresó hoy); la explicación del PIN va al final y se abre con un botón grande
      h('details.tarjeta', { style: 'margin-top:1.2rem' },
        h('summary', 'Cómo funciona el PIN'),
        h('ul', { style: 'margin:.4rem 0 0;padding-left:1.2rem;display:grid;gap:.3rem' },
          h('li', 'El PIN son 4 números que solo conoce cada persona. Se usa junto con el código de la empresa y el usuario para entrar.'),
          h('li', 'Si alguien se equivoca de PIN, puede intentar de nuevo de inmediato. El ingreso no se bloquea.'),
          h('li', 'Si alguien olvida su PIN, use «Reiniciar PIN»: se le da uno temporal que tendrá que cambiar apenas entre.'),
          h('li', 'Nadie puede ver el PIN de otra persona, ni siquiera un administrador.'),
          h('li', 'Cada persona entra solo a la empresa que se le dio. Aquí se ven y se crean los usuarios de ' + miEmpresa + '.'),
          h('li', 'Dentro de la empresa todos los usuarios tienen acceso a todo. Solo esta pantalla de Usuarios es exclusiva de los administradores.'))));
    pintarSeguridad(); // «Revisando…» mientras llega
    pintarAparatos();
    cargarSeguridad(); // en paralelo con la lista de usuarios: si falla, la lista igual se ve
    cargarAparatos();
    await cargar();
  },
};
