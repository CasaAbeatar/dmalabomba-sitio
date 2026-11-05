// Pantalla del cliente (Administración, solo administradores).
// Dos secciones en una sola pantalla: «Pantalla del cliente» (ajustes de la caja y enlace para abrirla) y «Publicidad» (los anuncios que rotan).
// Usa fx_pantalla_config_* y fx_anuncio_* (api_pantalla.js). Las confirmaciones se escriben en la propia pantalla, sin ventanas del navegador.
import { h, esqueleto, bloqueError, textoDeError, toast, conBoton, conPunto, hoyCR } from './util.js';
import { cargarHoja } from './ui_hojas.js';
import { soloDigitos } from './ui_mant.js';
import { config, anuncios, EMPRESAS, FORMATOS, MAX_BYTES, SEG_MIN, SEG_MAX, GRACIAS_MIN, GRACIAS_MAX } from './api_pantalla.js';

const MB = 1024 * 1024;
const TZ = 'America/Costa_Rica';

const fechaLarga = (ymd) => new Intl.DateTimeFormat('es-CR', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(ymd + 'T12:00:00Z')).replace(/\./g, '');
export function vigenciaTexto(a) {
  if (a.desde && a.hasta) return 'Del ' + fechaLarga(a.desde) + ' al ' + fechaLarga(a.hasta);
  if (a.desde) return 'Desde el ' + fechaLarga(a.desde) + ', sin fecha final';
  if (a.hasta) return 'Hasta el ' + fechaLarga(a.hasta);
  return 'Siempre vigente';
}
// Estado de un anuncio hoy: { texto, clase }
export function estadoAnuncio(a, hoy) {
  if (!a.activo) return { texto: 'Apagado', clase: 'gris' };
  if (a.hasta && a.hasta < hoy) return { texto: 'Vencido', clase: 'mal' };
  if (a.desde && a.desde > hoy) return { texto: 'Empieza más adelante', clase: 'espera' };
  return { texto: 'Vigente', clase: 'ok' };
}

export default {
  id: 'pantalla_cliente',
  titulo: 'Pantalla del cliente',
  async mount(root, app) {
    await cargarHoja('pantalla_cliente.css');
    if (!app.admin) {
      root.append(h('div.vacio', h('p', 'Esta pantalla es solo para administradores.'), h('button.btn', { type: 'button', onclick: () => app.ir('inicio') }, 'Volver al inicio')));
      return;
    }
    let vivo = true, nC = 0, nA = 0, listaA = [], urlLocal = null, archivo = null, prev = null;

    const cuerpoP = h('div.pc-sec-cuerpo'), cuerpoA = h('div.pc-sec-cuerpo');

    /* ============ 1. Pantalla del cliente (ajustes de esta caja) ============ */
    const terminal = Number(app.terminal) || 1;
    const nombreCaja = () => { const c = (app.soc?.terminales || []).find((x) => x.terminal === terminal); return c?.nombre && /\d/.test(c.nombre) ? c.nombre : 'Caja ' + terminal; };
    let C = null;
    const activaEl = h('input', { type: 'checkbox', id: 'pc-activa' });
    const publiEl = h('input', { type: 'checkbox', id: 'pc-publi' });
    const graciasEl = soloDigitos(h('input.campo', { type: 'text', inputmode: 'numeric', maxlength: 2, 'aria-label': 'Segundos que dura el gracias' }), 2);
    const estadoCfg = h('p.pc-nota.pc-guardado', { role: 'status' });
    const errC = h('div.pc-err', { hidden: true, role: 'alert' });
    const msgC = (m) => { errC.textContent = m; errC.hidden = !m; };
    function ponerC() { activaEl.checked = C.activa; publiEl.checked = C.publicidadEnCuenta; graciasEl.value = String(C.segundosPagado); }
    async function guardarC() {
      msgC('');
      const n = Number(graciasEl.value);
      if (!/^\d{1,2}$/.test(graciasEl.value) || n < GRACIAS_MIN || n > GRACIAS_MAX) { msgC('Los segundos del «gracias» van de ' + GRACIAS_MIN + ' a ' + GRACIAS_MAX + '.'); graciasEl.focus(); return; }
      const nuevo = { activa: activaEl.checked, publicidadEnCuenta: publiEl.checked, segundosPagado: n };
      estadoCfg.textContent = 'Guardando…';
      try { await config.guardar(app.socId, terminal, nuevo); } catch (e) { msgC(conPunto(textoDeError(e))); estadoCfg.textContent = ''; ponerC(); return; }
      C = nuevo; estadoCfg.textContent = 'Cambios guardados.';
    }
    [activaEl, publiEl, graciasEl].forEach((el) => el.addEventListener('change', guardarC));
    async function cargarC() {
      const mi = ++nC;
      try { C = await config.leer(app.socId, terminal); } catch (e) {
        if (!vivo || mi !== nC) return;
        cuerpoP.replaceChildren(bloqueError({ titulo: 'No se pudieron ver los ajustes de la pantalla del cliente', mensaje: textoDeError(e), alReintentar: () => cargarC() }));
        return;
      }
      if (!vivo || mi !== nC) return;
      ponerC();
      cuerpoP.replaceChildren(h('div.tarjeta.pc-cfg',
        h('h3', nombreCaja()),
        h('label.pc-usar', { for: 'pc-activa' }, activaEl, h('span', 'Usar la pantalla del cliente en esta caja', h('small', 'Si la apaga, la caja dejará de enviarle la cuenta a la pantalla del cliente.'))),
        h('label.pc-usar', { for: 'pc-publi' }, publiEl, h('span', 'Mostrar publicidad junto a la cuenta', h('small', 'Marcada, la cuenta ocupará dos tercios de la pantalla y la publicidad el tercio restante. Desmarcada, la cuenta podría ocupar toda la pantalla.'))),
        h('label.etq.pc-gracias', 'Segundos que dura el «gracias» después de cobrar', graciasEl, h('small', 'De ' + GRACIAS_MIN + ' a ' + GRACIAS_MAX + ' segundos.')),
        errC, estadoCfg,
        h('div.pc-abrir',
          h('a.btn.primario.grande', { href: new URL('cliente/', location.href).href, target: '_blank', rel: 'noopener' }, 'Abrir pantalla del cliente'),
          h('p.pc-nota', 'Se abrirá en una ventana nueva. Arrástrela a la otra pantalla y pulse F11 para que ocupe toda la pantalla.'))));
    }

    /* ============ 2. Publicidad ============ */
    async function cargarA() {
      const mi = ++nA, soc = app.socId;
      if (!listaA.length && !cuerpoA.querySelector('.pc-nuevo')) cuerpoA.replaceChildren(esqueleto(2, 'Buscando los anuncios…'));
      let l;
      try { l = await anuncios.lista(soc); } catch (e) {
        if (!vivo || mi !== nA) return;
        cuerpoA.replaceChildren(bloqueError({ titulo: 'No se pudo ver la lista de anuncios', mensaje: textoDeError(e), alReintentar: () => cargarA() }));
        return;
      }
      if (!vivo || mi !== nA) return;
      listaA = l; if (!prev && !urlLocal && l[0]) prev = vistaDe(l[0]);
      pintarA();
    }
    const vistaDe = (a) => ({ tipo: a.tipo, url: a.url, titulo: a.titulo, empresa: a.empresa, segundos: a.segundos });

    // Vista previa 16:9 («Así se verá»)
    const marco = h('div.pc-marco'), pieP = h('p.pc-pie-prev');
    function pintarPrev() {
      const v = prev;
      if (!v || !v.url) {
        marco.replaceChildren(h('div.pc-marco-vacio', v ? 'Esta vista previa no está disponible, pero el anuncio sí se mostrará.' : 'Elija un archivo o toque un anuncio de la lista para ver cómo se verá.'));
        pieP.textContent = v ? v.titulo + ' · ' + (EMPRESAS[v.empresa] || '') : '';
        return;
      }
      marco.replaceChildren(v.tipo === 'video'
        ? h('video', { src: v.url, muted: true, autoplay: true, loop: true, playsinline: true, 'aria-label': 'Vista previa del video ' + v.titulo })
        : h('img', { src: v.url, alt: 'Vista previa de ' + v.titulo }));
      const vid = marco.querySelector('video'); if (vid) { vid.muted = true; vid.play?.().catch(() => {}); }
      pieP.textContent = (v.titulo ? v.titulo + ' · ' : '') + (EMPRESAS[v.empresa] || '') + (v.segundos ? ' · ' + v.segundos + ' segundos en pantalla' : '');
    }

    // Formulario de un anuncio nuevo
    const archivoEl = h('input.campo', { type: 'file', accept: [...Object.keys(FORMATOS.imagen), ...Object.keys(FORMATOS.video)].join(','), 'aria-label': 'Archivo del anuncio, imagen o video' });
    const empSel = h('select.campo', { 'aria-label': 'Empresa del anuncio' }, Object.entries(EMPRESAS).map(([k, n]) => h('option', { value: k }, n)));
    const tituloEl = h('input.campo', { type: 'text', maxlength: 60, autocomplete: 'off', placeholder: 'Por ejemplo: Combo de pollo y papas', 'aria-label': 'Título del anuncio' });
    const segEl = soloDigitos(h('input.campo', { type: 'text', inputmode: 'numeric', maxlength: 2, value: '8', 'aria-label': 'Segundos en pantalla' }), 2);
    const desdeEl = h('input.campo', { type: 'date', 'aria-label': 'Desde' });
    const hastaEl = h('input.campo', { type: 'date', 'aria-label': 'Hasta' });
    const avisoFormato = h('small.pc-aviso-formato', { role: 'status' });
    const errA = h('div.pc-err', { hidden: true, role: 'alert' });
    const msgA = (m, el) => { errA.textContent = m; errA.hidden = !m; el?.focus(); };
    const tipoDe = (f) => (FORMATOS.imagen[f.type] ? 'imagen' : FORMATOS.video[f.type] ? 'video' : null);

    function soltarLocal() { if (urlLocal) { try { URL.revokeObjectURL(urlLocal); } catch { /* nada */ } urlLocal = null; } }
    archivoEl.addEventListener('change', () => {
      msgA(''); soltarLocal(); archivo = archivoEl.files?.[0] || null;
      if (!archivo) { avisoFormato.textContent = ''; prev = listaA[0] ? vistaDe(listaA[0]) : null; pintarPrev(); return; }
      const tipo = tipoDe(archivo);
      if (!tipo) { msgA(/quicktime|\.mov$/i.test(archivo.type + archivo.name) ? 'Los videos que graba el iPhone salen en formato MOV y no se pueden usar tal cual. Conviene convertirlo a MP4 antes de subirlo.' : 'Ese formato no se puede usar. Elija una imagen JPG o PNG, o un video MP4.'); archivoEl.value = ''; archivo = null; avisoFormato.textContent = ''; return; }
      avisoFormato.textContent = archivo.type === 'video/webm' ? 'Atención: los videos WebM podrían no verse en aparatos de Apple antiguos. Conviene usar MP4.' : '';
      if (archivo.size > MAX_BYTES) { msgA('El archivo pesa ' + (archivo.size / MB).toFixed(1).replace('.', ',') + ' MB y el máximo es 25 MB. Elija uno más liviano.'); archivoEl.value = ''; archivo = null; return; }
      urlLocal = URL.createObjectURL(archivo);
      if (tipo === 'video') { // los segundos se proponen con lo que dura el video (entre 3 y 60)
        const v = document.createElement('video'); v.preload = 'metadata'; v.src = urlLocal;
        v.onloadedmetadata = () => { if (Number.isFinite(v.duration)) segEl.value = String(Math.min(SEG_MAX, Math.max(SEG_MIN, Math.ceil(v.duration)))); refrescarPrev(); };
      }
      if (!tituloEl.value.trim()) tituloEl.value = archivo.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').slice(0, 60);
      refrescarPrev();
    });
    function refrescarPrev() {
      if (archivo && urlLocal) prev = { tipo: tipoDe(archivo), url: urlLocal, titulo: tituloEl.value.trim(), empresa: empSel.value, segundos: Number(segEl.value) || null };
      pintarPrev();
    }
    [tituloEl, empSel, segEl].forEach((el) => el.addEventListener('input', refrescarPrev));

    async function agregar(btn) {
      msgA('');
      if (!archivo) return msgA('Elija primero el archivo del anuncio: una imagen o un video.', archivoEl);
      const tipo = tipoDe(archivo);
      if (!tipo) return msgA('Ese formato no se puede usar. Elija una imagen JPG o PNG, o un video MP4.', archivoEl);
      if (archivo.size > MAX_BYTES) return msgA('El archivo pesa más de 25 MB. Elija uno más liviano.', archivoEl);
      const titulo = tituloEl.value.trim();
      if (titulo.length < 2) return msgA('Escriba un título corto para reconocer el anuncio en la lista.', tituloEl);
      if (!/^\d{1,2}$/.test(segEl.value) || Number(segEl.value) < SEG_MIN || Number(segEl.value) > SEG_MAX) return msgA('Los segundos en pantalla van de ' + SEG_MIN + ' a ' + SEG_MAX + '.', segEl);
      const desde = desdeEl.value || null, hasta = hastaEl.value || null;
      if (desde && hasta && hasta < desde) return msgA('La fecha final no puede ser antes de la inicial.', hastaEl);
      if (hasta && hasta < hoyCR()) return msgA('La fecha final ya pasó, así que el anuncio nunca se mostraría. Elija una fecha de hoy en adelante.', hastaEl);
      await conBoton(btn, async () => {
        btn.textContent = 'Subiendo el archivo…';
        let ruta;
        try { ruta = await anuncios.subir(archivo, tipo); } catch (e) { msgA(conPunto(textoDeError(e))); return; }
        btn.textContent = 'Guardando…';
        const orden = listaA.reduce((m, a) => Math.max(m, a.orden), 0) + 1;
        try { await anuncios.guardar({ empresa: empSel.value, titulo, tipo, archivo: ruta, segundos: Number(segEl.value), orden, desde, hasta, activo: true }); } catch (e) { msgA(conPunto(textoDeError(e))); return; }
        toast('Anuncio agregado. Se mostrará según sus fechas.');
        archivoEl.value = ''; archivo = null; tituloEl.value = ''; segEl.value = '8'; desdeEl.value = ''; hastaEl.value = ''; soltarLocal(); prev = null;
        await cargarA();
        if (listaA.length) { prev = vistaDe(listaA[listaA.length - 1]); pintarPrev(); }
      });
    }

    async function guardarVarios(cambios, okMsg) {
      try { for (const a of cambios) await anuncios.guardar(a); } catch (e) { toast(conPunto(textoDeError(e)), 'error', 7000); await cargarA(); return; }
      if (okMsg) toast(okMsg);
      await cargarA();
    }
    function mover(i, d) {
      const j = i + d; if (j < 0 || j >= listaA.length) return;
      const arr = listaA.slice(); [arr[i], arr[j]] = [arr[j], arr[i]];
      return guardarVarios(arr.map((a, k) => ({ ...a, orden: k + 1 })).filter((a, k) => listaA.find((x) => x.id === a.id).orden !== k + 1));
    }

    function filaA(a, i) {
      const hoy = hoyCR(), est = estadoAnuncio(a, hoy);
      const mini = h('button.pc-mini', { type: 'button', 'aria-pressed': prev && prev.url && prev.url === a.url ? 'true' : 'false', 'aria-label': 'Ver cómo se verá el anuncio ' + a.titulo, onclick: () => { prev = vistaDe(a); pintarPrev(); marco.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }); } },
        a.url ? (a.tipo === 'video' ? h('video', { src: a.url, muted: true, preload: 'metadata', playsinline: true }) : h('img', { src: a.url, alt: '', loading: 'lazy' })) : 'Sin vista previa');
      const conf = h('div.pc-conf', { hidden: true },
        h('p', '¿Borrar el anuncio «' + a.titulo + '»? Dejará de mostrarse y no se podrá recuperar.'),
        h('div.pc-acciones',
          h('button.btn', { type: 'button', onclick: () => { conf.hidden = true; acc.hidden = false; } }, 'No, volver'),
          h('button.btn.peligro', { type: 'button', onclick: (e) => conBoton(e.currentTarget, async () => {
            try { await anuncios.borrar(a.id); } catch (er) { toast(conPunto(textoDeError(er)), 'error', 7000); return; }
            if (prev && prev.url === a.url) prev = null;
            toast('Anuncio borrado.'); await cargarA();
          }) }, 'Sí, borrar')));
      const acc = h('div.pc-acciones',
        h('div.pc-orden',
          h('button.btn.chico', { type: 'button', disabled: i === 0, 'aria-label': 'Subir ' + a.titulo + ' un lugar', onclick: (e) => conBoton(e.currentTarget, () => mover(i, -1)) }, 'Subir ▲'),
          h('button.btn.chico', { type: 'button', disabled: i === listaA.length - 1, 'aria-label': 'Bajar ' + a.titulo + ' un lugar', onclick: (e) => conBoton(e.currentTarget, () => mover(i, 1)) }, 'Bajar ▼')),
        h('button.btn.chico', { type: 'button', onclick: (e) => conBoton(e.currentTarget, () => guardarVarios([{ ...a, activo: !a.activo }], a.activo ? 'Anuncio apagado. Dejará de mostrarse.' : 'Anuncio activado.')) }, a.activo ? 'Apagar' : 'Activar'),
        h('button.btn.chico.peligro', { type: 'button', onclick: () => { conf.hidden = false; acc.hidden = true; conf.querySelector('button').focus(); } }, 'Borrar'));
      return h('li.pc-fila' + (a.activo ? '' : '.apagado'),
        mini,
        h('div.pc-fila-t',
          h('strong', a.titulo || 'Sin título'),
          h('span', (EMPRESAS[a.empresa] || '') + ' · ' + (a.tipo === 'video' ? 'Video' : 'Imagen') + ' · ' + a.segundos + ' segundos'),
          h('span', vigenciaTexto(a)),
          h('span', h('span.chip.' + est.clase, est.texto))),
        acc, conf);
    }

    function pintarA() {
      const nuevo = h('div.tarjeta.pc-nuevo',
        h('div.pc-campos',
          h('h3', 'Agregar un anuncio'),
          h('label.etq', 'Archivo (imagen o video)', archivoEl, h('small', 'Conviene: imagen JPG o PNG, o video MP4 (H.264), que se ven en cualquier aparato, también en Mac y iPhone. Máximo 25 MB.'), avisoFormato),
          h('div.pc-seg', h('label.etq', 'Segundos', segEl), h('label.etq', 'Empresa', empSel)),
          h('label.etq', 'Título', tituloEl, h('small', 'Solo para reconocerlo en la lista; el cliente no lo ve.')),
          h('div.pc-fechas', h('label.etq', 'Desde', desdeEl, h('small', 'Vacío: desde hoy.')), h('label.etq', 'Hasta', hastaEl, h('small', 'Vacío: sin fecha final.'))),
          errA,
          h('button.btn.primario.grande', { type: 'button', onclick: (e) => agregar(e.currentTarget) }, 'Agregar anuncio')),
        h('div.pc-prev', h('h3', 'Así se verá'), marco, pieP));
      cuerpoA.replaceChildren(nuevo,
        listaA.length
          ? h('ul.pc-filas', listaA.map(filaA))
          : h('div.vacio', h('p', 'Todavía no hay anuncios.'), h('p.pc-nota', 'Mientras no haya ninguno, la pantalla del cliente podría mostrar solo el nombre de la empresa. Agregue el primero con el formulario de arriba.')));
      pintarPrev();
    }

    /* ============ Armado ============ */
    root.append(h('div.pc',
      h('section.pc-sec', h('h2', 'Pantalla del cliente'),
        h('p.pc-nota', 'Es la segunda pantalla de la caja: le mostrará la cuenta al cliente y, mientras tanto, la publicidad.'), cuerpoP),
      h('section.pc-sec', h('h2', 'Publicidad'),
        h('p.pc-recordatorio', 'Solo productos del menú impreso, con el mismo precio en Soda y Pollos.'), cuerpoA)));
    await Promise.all([cargarC(), cargarA()]);
    return () => { vivo = false; nC++; nA++; soltarLocal(); };
  },
};
