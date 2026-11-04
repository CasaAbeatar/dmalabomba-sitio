// Pago sin factura (Administración, solo administradores): registrar lo pagado a quien no factura (feria del agricultor, agricultor de finca, tamales, maquinaria de un pensionado,
// limpieza ocasional) y emitir la factura electrónica de compra (tipo 08) a Hacienda. La cajera no ve ni usa esta pantalla (soloAdmin en modulos.js y administrador exigido en cada función de la base).
// El pago registrado no se edita: si Hacienda lo rechaza se corrige el proveedor y se emite de nuevo.
import { h, esqueleto, bloqueError, textoDeError, confirmar, conBoton, toast, modal, money, fechaCorta, fechaHora, hoyCR, debounce } from './util.js';
import { compra, CASOS_IVA, CLASES, MEDIOS_PAGO, AVISO_HABITUAL, estadoPago, reducirFoto } from './api_compra.js';
import { cargarCss, aviso, campo, soloDigitos } from './ui_mant.js';
import { cargarHoja } from './ui_hojas.js';

const num = (s) => { const n = Number(String(s ?? '').replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const lineaNueva = () => ({ cabys: '', descripcion: '', cantidad: '1', total: '', iva_caso: 'sin_iva', catalogo: null });

export default {
  id: 'pago_sin_factura',
  titulo: 'Pago sin factura',
  async mount(root, app) {
    await Promise.all([cargarCss(), cargarHoja('pago_sin_factura.css')]);
    if (!app.admin) {
      root.append(h('div.vacio', h('p', 'Esta pantalla es solo para administradores.'), h('button.btn', { type: 'button', onclick: () => app.ir('inicio') }, 'Volver al inicio')));
      return;
    }
    const soc = app.soc.id;
    let vivo = true, cfg = null, timer = null;
    const estado = { prov: null, lineas: [lineaNueva()], foto: null };
    const cuerpo = h('div.psf-cuerpo');
    root.append(h('div.psf', h('p.psf-intro', 'Use esta pantalla cuando se le paga a alguien que no entrega factura. Se anota el pago y se emite la ', h('strong', 'factura electrónica de compra'), ' a Hacienda el mismo día, para que la compra quede respaldada.'), cuerpo));

    // ---------- Proveedor ----------
    const cajaProv = h('div.psf-prov');
    function pintarProv() {
      const p = estado.prov;
      if (p) {
        cajaProv.replaceChildren(h('div.tarjeta.psf-prov-sel', h('div', h('strong', p.nombre), h('div.tenue', `${tipoId(p.tipo_id)} ${p.identificacion} · ${CLASES[p.clase] || p.clase}`)),
          h('button.btn.chico', { type: 'button', onclick: () => { estado.prov = null; pintarProv(); } }, 'Cambiar')),
          p.clase === 'habitual' ? aviso('ambar', AVISO_HABITUAL) : null);
        return;
      }
      const q = h('input.campo', { type: 'search', placeholder: 'Nombre o cédula del proveedor', autocomplete: 'off', 'aria-label': 'Buscar proveedor' });
      const lista = h('div.psf-resultados');
      const buscar = debounce(async () => {
        try {
          const r = await compra.proveedores(soc, q.value.trim() || null);
          lista.replaceChildren(...(r.length ? r.map((p) => h('button.psf-res', { type: 'button', onclick: () => { estado.prov = p; pintarProv(); } },
            h('strong', p.nombre), h('span.tenue', ` ${tipoId(p.tipo_id)} ${p.identificacion} · ${CLASES[p.clase] || p.clase}`))) : [h('p.tenue', 'No hay proveedores con ese dato. Use «Proveedor nuevo».')]));
        } catch (e) { lista.replaceChildren(h('p.psf-err', textoDeError(e))); }
      }, 250);
      q.addEventListener('input', buscar);
      cajaProv.replaceChildren(campo('Proveedor (a quién se le pagó)', q), lista, h('button.btn', { type: 'button', onclick: () => formProveedor(null, (p) => { estado.prov = p; pintarProv(); }) }, 'Proveedor nuevo'));
      buscar();
    }
    const tipoId = (t) => ({ '01': 'Cédula', '02': 'Cédula jurídica', '03': 'DIMEX', '04': 'NITE' }[t] || 'Cédula');

    function formProveedor(existente, alGuardar) {
      const e = existente || {};
      const nom = h('input.campo', { type: 'text', value: e.nombre || '', autocomplete: 'off', 'aria-label': 'Nombre completo' });
      const tipo = h('select.campo', { 'aria-label': 'Tipo de identificación' }, ['01', '02', '03', '04'].map((t) => h('option', { value: t, selected: (e.tipo_id || '01') === t }, tipoId(t))));
      const ced = soloDigitos(h('input.campo', { type: 'text', inputmode: 'numeric', value: e.identificacion || '', autocomplete: 'off', maxlength: 12, 'aria-label': 'Número de cédula' }), 12);
      const clase = h('select.campo', { 'aria-label': 'Clase de proveedor' }, Object.entries(CLASES).map(([k, v]) => h('option', { value: k, selected: (e.clase || 'ocasional') === k }, v)));
      const correo = h('input.campo', { type: 'email', value: e.correo || '', autocomplete: 'off', 'aria-label': 'Correo' });
      const tel = soloDigitos(h('input.campo', { type: 'tel', inputmode: 'numeric', value: e.telefono || '', autocomplete: 'off', maxlength: 8, 'aria-label': 'Teléfono' }), 8);
      const notaHab = h('div', { hidden: true }, aviso('ambar', AVISO_HABITUAL));
      const ver = () => { notaHab.hidden = clase.value !== 'habitual'; };
      clase.addEventListener('change', ver); ver();
      const m = modal({ titulo: existente ? 'Corregir proveedor' : 'Proveedor nuevo', ancho: 520,
        contenido: h('div.mt-form', campo('Nombre completo de quien vende', nom, 'Como aparece en su cédula. Hacienda lo pide así en la factura de compra.'),
          h('div.psf-dos', campo('Tipo de identificación', tipo), campo('Número de cédula', ced, 'Solo números, sin guiones.')),
          campo('¿Cómo vende?', clase, 'Ocasional: una vez o de vez en cuando. Habitual: vende seguido. Agricultor inscrito en el REA: productor agropecuario inscrito.'), notaHab,
          h('div.psf-dos', campo('Correo (opcional)', correo), campo('Teléfono (opcional)', tel))),
        botones: [{ texto: 'Cancelar', onclick: (c) => c() }, { texto: 'Guardar proveedor', clase: 'primario', onclick: async (c, btn) => {
          await conBoton(btn, async () => {
            const r = await compra.proveedorGuardar({ id: existente?.id, sociedad_id: soc, nombre: nom.value, tipo_id: tipo.value, identificacion: ced.value, clase: clase.value, correo: correo.value, telefono: tel.value });
            c(); toast('Proveedor guardado.'); alGuardar?.(r.proveedor);
          });
        } }] });
      return m;
    }

    // ---------- Líneas ----------
    const cajaLineas = h('div.psf-lineas'), totalEl = h('strong.psf-total', money(0));
    function recalcular() { totalEl.textContent = money(estado.lineas.reduce((a, l) => a + num(l.total), 0)); }
    function pintarLineas() {
      cajaLineas.replaceChildren(...estado.lineas.map((l, i) => {
        const res = h('div.psf-resultados');
        const q = h('input.campo', { type: 'text', value: l.cabys ? `${l.cabys} · ${l.descripcion}` : '', placeholder: 'Qué se compró: escriba el nombre (tomate, tamales, limpieza…) o el CABYS', autocomplete: 'off', 'aria-label': `Línea ${i + 1}: buscar el producto o servicio` });
        const buscar = debounce(async () => {
          const t = q.value.trim(); if (t.length < 2) { res.replaceChildren(); return; }
          try {
            const r = await compra.cabys(t);
            res.replaceChildren(...(r.length ? r.slice(0, 12).map((c) => h('button.psf-res', { type: 'button', onclick: () => {
              l.cabys = c.codigo; l.descripcion = c.descripcion; l.catalogo = Number(c.tarifa); pintarLineas();
            } }, h('strong', c.descripcion), h('span.tenue', ` ${c.codigo} · IVA del catálogo ${String(c.tarifa).replace('.', ',')} %`))) : [h('p.tenue', 'No hay resultados. Pruebe con otra palabra.')]));
          } catch (e) { res.replaceChildren(h('p.psf-err', textoDeError(e))); }
        }, 300);
        q.addEventListener('input', () => { if (l.cabys && q.value !== `${l.cabys} · ${l.descripcion}`) { l.cabys = ''; l.catalogo = null; } buscar(); });
        const desc = h('input.campo', { type: 'text', value: l.descripcion, maxlength: 200, 'aria-label': `Línea ${i + 1}: descripción`, oninput: (ev) => { l.descripcion = ev.target.value; } });
        const cant = h('input.campo', { type: 'text', inputmode: 'decimal', value: l.cantidad, 'aria-label': `Línea ${i + 1}: cantidad`, oninput: (ev) => { l.cantidad = ev.target.value; } });
        const tot = h('input.campo', { type: 'text', inputmode: 'decimal', value: l.total, placeholder: '0', 'aria-label': `Línea ${i + 1}: monto pagado`, oninput: (ev) => { l.total = ev.target.value; recalcular(); } });
        const iva = h('select.campo', { 'aria-label': `Línea ${i + 1}: IVA`, onchange: (ev) => { l.iva_caso = ev.target.value; pintarHint(); } }, CASOS_IVA.map(([k, t]) => h('option', { value: k, selected: l.iva_caso === k }, t)));
        const hint = h('small.psf-hint');
        const pintarHint = () => {
          const t = CASOS_IVA.find((c) => c[0] === l.iva_caso)?.[2]; hint.textContent = '';
          if (l.catalogo != null && t !== l.catalogo && l.iva_caso !== 'exento') hint.textContent = `El catálogo de Hacienda pone ${String(l.catalogo).replace('.', ',')} % a este producto y usted escogió ${String(t).replace('.', ',')} %. Si no es por una exención o un régimen especial, revíselo.`;
        };
        pintarHint();
        return h('fieldset.psf-linea', h('legend', `Línea ${i + 1}`), campo('Producto o servicio (CABYS)', q), res,
          campo('Descripción en la factura', desc), h('div.psf-tres', campo('Cantidad', cant), campo('Monto pagado (₡)', tot, 'Lo que se pagó por esta línea.'), campo('IVA', iva)), hint,
          estado.lineas.length > 1 ? h('button.btn.chico.suave', { type: 'button', onclick: () => { estado.lineas.splice(i, 1); pintarLineas(); recalcular(); } }, 'Quitar esta línea') : null);
      }));
      recalcular();
    }

    // ---------- Formulario ----------
    const concepto = h('input.campo', { type: 'text', maxlength: 200, placeholder: 'Ejemplo: Tomate y plátano de la feria', 'aria-label': 'Concepto de la compra' });
    const medio = h('select.campo', { 'aria-label': 'Cómo se pagó' }, MEDIOS_PAGO.map(([k, t]) => h('option', { value: k }, t)));
    const refPago = h('input.campo', { type: 'text', maxlength: 120, placeholder: 'Número de SINPE, de transferencia o de cheque', 'aria-label': 'Referencia del pago' });
    const fotoIn = h('input', { type: 'file', accept: 'image/*', capture: 'environment', 'aria-label': 'Foto del comprobante de pago' });
    const fotoVista = h('div.psf-foto');
    fotoIn.addEventListener('change', async () => {
      const f = fotoIn.files?.[0]; estado.foto = null; fotoVista.replaceChildren();
      if (!f) return;
      try { estado.foto = await reducirFoto(f); fotoVista.replaceChildren(h('img', { src: 'data:image/jpeg;base64,' + estado.foto.datos, alt: 'Foto del comprobante de pago' }), h('button.btn.chico.suave', { type: 'button', onclick: () => { estado.foto = null; fotoIn.value = ''; fotoVista.replaceChildren(); } }, 'Quitar foto')); }
      catch (e) { fotoIn.value = ''; toast(textoDeError(e), 'error', 6000); }
    });
    const cuentaSel = h('select.campo', { 'aria-label': 'Cuenta de gasto' });
    const acred = h('input', { type: 'checkbox', 'aria-label': 'El IVA se acredita' });
    const resultado = h('div.psf-resultado');
    const btnRegistrar = h('button.btn.primario.grande', { type: 'button' }, 'Registrar pago y emitir factura de compra');

    function validar() {
      if (!estado.prov) return 'Escoja el proveedor al que se le pagó.';
      if (concepto.value.trim().length < 3) return 'Escriba el concepto de la compra.';
      for (const [i, l] of estado.lineas.entries()) {
        if (!l.cabys) return `Línea ${i + 1}: busque y escoja el producto o servicio.`;
        if (!(num(l.total) > 0)) return `Línea ${i + 1}: escriba el monto pagado.`;
        if (!(num(l.cantidad) > 0)) return `Línea ${i + 1}: la cantidad debe ser mayor que cero.`;
      }
      if (medio.value !== 'efectivo' && !refPago.value.trim() && !estado.foto) return 'Anote la referencia del pago o adjunte la foto del comprobante: así queda probado cómo se pagó.';
      return '';
    }
    btnRegistrar.addEventListener('click', async () => {
      const falta = validar(); if (falta) { toast(falta, 'error', 6000); return; }
      const total = estado.lineas.reduce((a, l) => a + num(l.total), 0);
      const ok = await confirmar(`Se anota el pago de ${money(total)} a ${estado.prov.nombre} y se emite la factura electrónica de compra a Hacienda con fecha de hoy. El pago registrado no se puede editar después.`, { si: 'Sí, registrar y emitir', no: 'No, volver' });
      if (!ok || !vivo) return;
      await conBoton(btnRegistrar, async () => {
        const r = await compra.registrar({ sociedad_id: soc, proveedor_id: estado.prov.id, concepto: concepto.value.trim(), fecha_compra: hoyCR(), medio: medio.value, referencia_pago: refPago.value.trim() || null,
          foto: estado.foto, cuenta_gasto_id: cuentaSel.value || null, iva_acreditable: acred.checked,
          lineas: estado.lineas.map((l) => ({ cabys: l.cabys, descripcion: l.descripcion, cantidad: num(l.cantidad), total: num(l.total), iva_caso: l.iva_caso })) });
        resultado.replaceChildren(aviso('verde', h('strong', `Pago ${r.numero} registrado por ${money(r.total)}. `), r.salida_hacienda === 'en_espera'
          ? 'La factura de compra quedó lista, pero la salida a Hacienda está en espera hasta que se active. Nada se pierde: sale sola cuando se active.' : 'La factura de compra va camino a Hacienda; en un momento se ve si la aceptó.'),
          ...(r.avisos || []).map((a) => aviso('ambar', a.texto)), r.asiento_error ? aviso('ambar', 'El asiento contable auxiliar no se pudo crear: ' + r.asiento_error) : null);
        estado.prov = null; estado.lineas = [lineaNueva()]; estado.foto = null; concepto.value = ''; refPago.value = ''; fotoIn.value = ''; fotoVista.replaceChildren(); acred.checked = false; medio.value = 'efectivo';
        pintarProv(); pintarLineas(); await cargarLista();
        resultado.scrollIntoView?.({ block: 'nearest' });
      });
    });

    // ---------- Lista ----------
    const lista = h('div.psf-lista');
    async function cargarLista() {
      try {
        const r = await compra.pagos(soc, 40); if (!vivo) return;
        lista.replaceChildren(...(r.length ? r.map(tarjetaPago) : [h('p.psf-vacio', 'Todavía no hay pagos sin factura registrados.')]));
        if (r.some((p) => p.estado === 'pendiente' || p.estado === 'enviado') && !timer) timer = setInterval(() => { if (vivo) cargarLista(); }, 20000);
        if (!r.some((p) => p.estado === 'pendiente' || p.estado === 'enviado') && timer) { clearInterval(timer); timer = null; }
      } catch (e) { lista.replaceChildren(bloqueError({ titulo: 'No se pudo cargar la lista', mensaje: textoDeError(e), alReintentar: () => cargarLista() })); }
    }
    function tarjetaPago(p) {
      const e = estadoPago(p), rech = p.estado === 'rechazado' || p.estado === 'error';
      return h('article.tarjeta.psf-pago', h('div.psf-pago-cab', h('strong', `${p.numero_texto} · ${p.proveedor}`), h('span.chip.' + e.tipo, e.texto)),
        h('div.psf-pago-datos', `${fechaCorta(p.fecha_compra + 'T12:00:00')} · ${money(p.total)} · ${(MEDIOS_PAGO.find((m) => m[0] === p.medio) || [])[1] || p.medio} · ${p.concepto}`),
        rech && p.mensaje ? aviso('rojo', p.mensaje) : null,
        p.provisional ? h('small.tenue', `Asiento auxiliar n.º ${p.asiento_numero}: provisional hasta que Hacienda acepte la factura de compra.`) : null,
        h('div.psf-pago-btns', h('button.btn.chico', { type: 'button', onclick: () => detalle(p) }, 'Ver detalle'),
          rech ? h('button.btn.chico', { type: 'button', onclick: () => formProveedor({ id: p.proveedor_id, nombre: p.proveedor, identificacion: p.identificacion, clase: p.clase, tipo_id: p.tipo_id }, () => cargarLista()) }, 'Corregir proveedor') : null,
          rech ? h('button.btn.chico.primario', { type: 'button', onclick: async (ev) => {
            if (!await confirmar('Se emite una factura de compra nueva (con otro consecutivo) para este mismo pago, que hace referencia a la rechazada.', { si: 'Sí, emitir de nuevo' })) return;
            await conBoton(ev.currentTarget, async () => { await compra.reemitir(p.id); toast('Factura de compra nueva emitida.'); await cargarLista(); });
          } }, 'Emitir de nuevo') : null));
    }
    async function detalle(p) {
      const cont = h('div.psf-detalle', h('p', h('strong', 'Concepto: '), p.concepto), h('p', h('strong', 'Pagado: '), `${money(p.total)} (IVA incluido: ${money(p.iva_total)})`),
        p.referencia_pago ? h('p', h('strong', 'Referencia del pago: '), p.referencia_pago) : null,
        p.consecutivo ? h('p', h('strong', 'Factura de compra: '), p.consecutivo, p.intentos_fec > 1 ? ` (intento ${p.intentos_fec})` : '') : null,
        p.clave ? h('p.psf-clave', h('strong', 'Clave: '), p.clave) : null, p.mensaje ? h('p', h('strong', 'Mensaje: '), p.mensaje) : null,
        h('p.tenue', 'Registrado el ' + fechaHora(p.creado_en)), h('div.psf-fotos'));
      modal({ titulo: p.numero_texto, contenido: cont, ancho: 560, botones: [{ texto: 'Cerrar', clase: 'primario', onclick: (c) => c() }] });
      if (Number(p.fotos) > 0) {
        try { const f = await compra.fotos(p.id); cont.querySelector('.psf-fotos').replaceChildren(...f.map((x) => h('img', { src: `data:${x.tipo};base64,${x.datos}`, alt: 'Comprobante de pago' }))); } catch (e) { toast(textoDeError(e), 'error'); }
      }
    }

    // ---------- Armado ----------
    async function iniciar() {
      cuerpo.replaceChildren(esqueleto(3, 'Preparando la pantalla…'));
      try { cfg = await compra.config(soc); } catch (e) { cuerpo.replaceChildren(bloqueError({ titulo: 'No se pudo preparar la pantalla', mensaje: textoDeError(e), alReintentar: () => iniciar() })); return; }
      if (!vivo) return;
      cuentaSel.replaceChildren(h('option', { value: '' }, 'Por clasificar (la contadora la ubica)'), ...(cfg.cuentas || []).map((c) => h('option', { value: c.id }, `${c.codigo} · ${c.nombre}`)));
      pintarProv(); pintarLineas();
      cuerpo.replaceChildren(...[
        cfg.emisora ? null : aviso('rojo', 'Esta empresa todavía no está habilitada para emitir comprobantes desde este sistema: el pago no se podrá registrar.'),
        cfg.envio === 'activo' ? null : aviso('ambar', h('strong', 'Salida a Hacienda en espera. '), `Los pagos se registran y la factura de compra queda lista, pero no sale hacia Hacienda hasta que se active. Empresa en modo ${cfg.ambiente === 'sandbox' ? 'pruebas (sin validez tributaria)' : 'producción'}.`),
        h('section.tarjeta.psf-seccion', h('h2', '1. ¿A quién se le pagó?'), cajaProv),
        h('section.tarjeta.psf-seccion', h('h2', '2. ¿Qué se compró?'), campo('Concepto', concepto), cajaLineas,
          h('button.btn.chico', { type: 'button', onclick: () => { if (estado.lineas.length >= 20) { toast('Máximo 20 líneas.', 'error'); return; } estado.lineas.push(lineaNueva()); pintarLineas(); } }, 'Agregar otra línea'),
          h('p.psf-suma', 'Total pagado: ', totalEl)),
        h('section.tarjeta.psf-seccion', h('h2', '3. ¿Cómo se pagó?'), h('div.psf-dos', campo('Medio de pago', medio), campo('Fecha de la compra', h('input.campo', { type: 'text', value: fechaCorta(hoyCR() + 'T12:00:00'), disabled: true }), 'La factura de compra se emite el mismo día de la compra.')),
          campo('Referencia del pago', refPago, 'Obligatoria si no es efectivo y no hay foto.'), campo('Foto o captura del comprobante de pago', fotoIn, 'Opcional en efectivo.'), fotoVista),
        h('details.psf-conta', h('summary', 'Para la contadora (opcional)'), campo('Cuenta de gasto', cuentaSel, 'Si no sabe, déjela en «Por clasificar».'),
          h('label.psf-check', acred, h('span', 'El IVA de esta compra se acredita como crédito fiscal'), h('small', 'Normalmente no: la contadora lo decide.'))),
        h('div.psf-enviar', btnRegistrar), resultado,
        h('section.psf-seccion', h('h2', 'Pagos registrados'), lista)].filter(Boolean));
      await cargarLista();
    }
    await iniciar();
    return () => { vivo = false; if (timer) clearInterval(timer); };
  },
};
