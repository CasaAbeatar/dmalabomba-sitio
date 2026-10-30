// Numeración y paso a facturas reales (Administración, solo administradores).
// Muestra el modo en que está el sistema (pruebas o facturas reales), el número que sigue de cada tipo de documento, lo que hoy impide pasar a facturas reales
// (con los mensajes de la base, tal cual) y el paso guiado «Confirmar el primer número de la factura real».
// Esta pantalla NO cambia el modo de la empresa y no puede pasarla a facturas reales: solo informa y deja escribir los números de partida que la base permite.
// Lee fx_ambiente_estado y fx_consecutivos; escribe con fx_consecutivo_fijar, fx_consecutivo_confirmar_inicio y fx_consecutivo_confirmar_inicio_mensajes.
import { h, esqueleto, bloqueError, textoDeError, confirmar, conBoton, toast, modal, num, conPunto } from './util.js';
import { cargarHoja } from './ui_hojas.js';
import { soloDigitos } from './ui_mant.js';
import { numeracion, normalizarNumeracion, nombreTipo, esRespuesta, FRASE_COMPROBANTES, FRASE_RESPUESTAS } from './api_numeracion.js';

const MAX_CONSECUTIVO = 9999999999;
const TEXTO_AMBIENTE = { sandbox: 'Modo de pruebas', produccion: 'Facturas reales' };

// Título sencillo de cada motivo que da la base. El mensaje de la base va debajo, sin cambiarlo.
const TITULO_MOTIVO = {
  turno_abierto: 'Hay una caja abierta',
  cuentas_abiertas: 'Hay cuentas abiertas',
  comprobantes_en_cola: 'Hay comprobantes esperando a Hacienda',
  comprobantes_con_error: 'Hay comprobantes que no se pudieron enviar',
  respuestas_en_cola: 'Hay respuestas a proveedores esperando a Hacienda',
  sin_terminales: 'La empresa no tiene cajas registradas',
  sin_terminal_1: 'Falta la caja 1',
  consecutivos_sin_fijar: 'Faltan los números de partida de las facturas reales',
  indice_viejo: 'Falta un paso de mantenimiento en la base de datos',
  ya_emitio_en_produccion: 'Ya se emitieron facturas reales',
};
// Estos mensajes de la base nombran funciones y archivos: se dejan completos pero dentro de «Ver el mensaje del sistema»
const MENSAJE_TECNICO = new Set(['consecutivos_sin_fijar', 'indice_viejo', 'ya_emitio_en_produccion']);
const AYUDA_MOTIVO = {
  consecutivos_sin_fijar: 'Para facturar de verdad, cada tipo de documento necesita su número de partida. Se hace más abajo, en «Confirmar el primer número de la factura real», o escribiendo el último número emitido en la lista de números.',
  indice_viejo: 'Es un paso de mantenimiento que le corresponde a la persona encargada del sistema.',
  ya_emitio_en_produccion: 'Volver a pruebas haría que las ventas reales salgan como comprobantes de prueba, sin validez ante Hacienda.',
};

const caja = (t) => 'Caja ' + t;

export default {
  id: 'numeracion',
  titulo: 'Numeración',
  async mount(root, app) {
    await cargarHoja('numeracion.css');
    if (!app.admin) {
      root.append(h('div.vacio', h('p', 'Esta pantalla es solo para administradores.'), h('button.btn', { type: 'button', onclick: () => app.ir('inicio') }, 'Volver al inicio')));
      return;
    }
    const cuerpo = h('div.num-cuerpo');
    let nCarga = 0, vivo = true, D = null;

    async function cargar() {
      const mi = ++nCarga, soc = app.socId;
      if (!cuerpo.children.length || cuerpo.querySelector('.bloque-error')) cuerpo.replaceChildren(esqueleto(4, 'Revisando la numeración…'));
      let e, c;
      try { [e, c] = await Promise.all([numeracion.estado(soc), numeracion.consecutivos(soc)]); } catch (err) {
        if (!vivo || mi !== nCarga) return;
        cuerpo.replaceChildren(bloqueError({ titulo: 'No se pudo revisar la numeración', mensaje: textoDeError(err), alReintentar: () => cargar() }));
        return;
      }
      if (!vivo || mi !== nCarga) return;
      D = normalizarNumeracion(e, c);
      if (!D) { cuerpo.replaceChildren(bloqueError({ titulo: 'No hay información de la numeración', mensaje: 'El sistema no devolvió los datos. Intente de nuevo en un momento.', alReintentar: () => cargar() })); return; }
      pintar();
    }

    /* ---------- 1. El modo actual ---------- */
    function bannerAmbiente() {
      const real = D.actual === 'produccion';
      return h('section.num-ambiente.' + (real ? 'real' : 'pruebas'), { role: 'status', 'aria-label': 'Modo actual del sistema' },
        h('div.num-amb-et', 'Ahora el sistema está en'),
        h('div.num-amb-g', D.actualTexto),
        h('p', real ? 'Todo lo que se factura tiene validez ante Hacienda.' : 'Todo lo que se factura ahora es de prueba y no tiene validez ante Hacienda.'),
        h('p.num-amb-cifras', 'Comprobantes de prueba: ', h('strong', num(D.pruebas, 0)), ' · Comprobantes reales: ', h('strong', num(D.reales, 0))),
        D.empresa ? h('p.num-amb-emp', D.empresa) : null);
    }

    /* ---------- 2. El candado del cambio de modo ---------- */
    function motivoDe(m) {
      const titulo = TITULO_MOTIVO[m.causa] || 'Algo impide el cambio';
      const tec = MENSAJE_TECNICO.has(m.causa);
      return h('li.num-motivo',
        h('p.num-motivo-t', titulo),
        AYUDA_MOTIVO[m.causa] ? h('p.num-motivo-a', AYUDA_MOTIVO[m.causa]) : null,
        tec ? h('details.num-mensaje', h('summary', 'Ver el mensaje del sistema'), h('p', m.mensaje)) : h('p.num-motivo-m', m.mensaje));
    }
    function candado() {
      const aReales = D.destino === 'produccion';
      const titulo = aReales ? '¿Qué falta para pasar a facturas reales?' : '¿Se puede volver al modo de pruebas?';
      return h('section.tarjeta.num-candado' + (D.pasoPermitido ? '.libre' : '.cerrado'),
        h('h2', titulo),
        D.pasoPermitido
          ? h('p.num-libre', 'El sistema no encuentra nada que lo impida.')
          : h('p.num-cerrado', D.motivos.length === 1 ? 'Todavía no se puede. Hay 1 cosa que lo impide:' : 'Todavía no se puede. Hay ' + D.motivos.length + ' cosas que lo impiden:'),
        D.motivos.length ? h('ul.num-motivos', D.motivos.map(motivoDe)) : null,
        h('p.num-solo-informa', 'Esta pantalla solo informa: desde aquí no se cambia el modo del sistema.'));
    }

    /* ---------- 3. Los números de cada tipo ---------- */
    // Filas de un modo: lo que la empresa usa (los tipos y cajas que pide fx_ambiente_estado), con el valor de ese modo
    function filasDe(amb) {
      return D.requeridos.map((r) => {
        if (amb === 'produccion') return r;
        const f = D.filas.find((x) => x.ambiente === 'sandbox' && x.terminal === r.terminal && x.tipo === r.tipo);
        return { ...r, ultimo: f ? f.ultimo : null, siguiente: f ? f.siguiente : null, fijado: f ? f.fijado : false };
      });
    }
    function filaNumero(r, amb) {
      const sinNumero = r.ultimo == null;
      const pendienteReal = amb === 'produccion' && !r.fijado;
      return h('li.num-fila' + (pendienteReal ? '.pendiente' : ''),
        h('div.num-fila-t', h('strong', r.nombre), h('span', ' · ' + (esRespuesta(r.tipo) ? 'siempre en la ' + caja(1).toLowerCase() : caja(r.terminal)))),
        h('div.num-fila-n',
          pendienteReal
            ? h('span.chip.espera', 'Falta confirmar el número de partida')
            : [h('span.num-sig', 'Sigue el número ', h('strong', sinNumero ? '1' : num(r.siguiente, 0))), h('span.num-ult', sinNumero ? 'Todavía no se ha emitido ninguno.' : 'Último emitido: ' + num(r.ultimo, 0))]),
        h('button.btn.chico', { type: 'button', 'aria-label': 'Fijar el último número de ' + r.nombre + ', ' + caja(r.terminal) + ', ' + TEXTO_AMBIENTE[amb], onclick: () => fijar(r, amb) }, 'Fijar el último número'));
    }
    function bloqueNumeros(amb) {
      const actual = D.actual === amb;
      const filas = filasDe(amb);
      return h('section.tarjeta.num-bloque',
        h('div.num-bloque-cab', h('h3', amb === 'produccion' ? 'Numeración de las facturas reales' : 'Numeración del modo de pruebas'),
          actual ? h('span.chip.ok', 'En uso ahora') : h('span.chip.gris', 'Todavía no se usa')),
        amb === 'produccion' && D.actual === 'sandbox' ? h('p.num-nota', 'Estos son los números con que empezarán las facturas reales. Mientras el sistema esté en modo de pruebas no se usan.') : null,
        filas.length ? h('ul.num-filas', filas.map((r) => filaNumero(r, amb))) : h('p.num-nota', 'La base no informó los tipos de documento de esta empresa.'));
    }

    // Ventana para escribir el último número emitido de un tipo
    function fijar(r, amb) {
      const err = h('div.error-caja', { hidden: true, role: 'alert' });
      const mostrar = (m, el) => { err.textContent = m; err.hidden = !m; el?.focus(); };
      const actualUlt = r.ultimo ?? 0;
      const inp = soloDigitos(h('input.campo', { type: 'text', inputmode: 'numeric', autocomplete: 'off', maxlength: 10, value: String(actualUlt), 'aria-label': 'Último número emitido' }), 10);
      const vista = h('p.num-vista');
      const pintarVista = () => { const n = Number(inp.value); vista.textContent = inp.value !== '' && Number.isFinite(n) ? 'El siguiente comprobante llevará el número ' + num(n + 1, 0) + '.' : ''; };
      inp.addEventListener('input', pintarVista); pintarVista();
      const real = amb === 'produccion';
      const m = modal({
        titulo: 'Fijar el último número', ancho: 480,
        contenido: h('div.num-form', err,
          h('p', h('strong', r.nombre), ' · ', caja(r.terminal), ' · ', TEXTO_AMBIENTE[amb]),
          h('label.etq', 'Último número emitido', inp,
            h('small', 'Escriba el último número que ya se emitió, no el que sigue. El sistema no deja bajar un número que ya se usó, para que no se repita.')),
          vista,
          real && D.actual === 'sandbox' ? h('p.num-nota', 'Esto prepara la numeración de las facturas reales. No cambia el modo de pruebas.') : null,
          real && D.actual === 'produccion' ? h('div.num-aviso.ambar', 'El sistema ya factura de verdad. Subir este número salta números en las facturas reales; hágalo solo si sabe que corresponde.') : null),
        botones: [{ texto: 'Cancelar', clase: 'suave', onclick: (c) => c() }, { texto: 'Guardar el número', clase: 'primario', onclick: async (c) => {
          mostrar('');
          if (!/^\d{1,10}$/.test(inp.value)) return mostrar('Escriba solo números, hasta 10 cifras.', inp);
          const n = Number(inp.value);
          if (n > MAX_CONSECUTIVO) return mostrar('El número no puede pasar de 9 999 999 999.', inp);
          if (n < actualUlt) return mostrar('No se puede bajar el número: el último de este tipo ya es ' + num(actualUlt, 0) + '. Un número emitido no se puede repetir.', inp);
          if (real && D.actual === 'produccion' && !(await confirmar('¿Fijar el último número emitido en ' + num(n, 0) + '? El sistema ya factura de verdad y esto no se puede deshacer.', { si: 'Sí, fijar el número', no: 'No, volver' }))) return;
          const btn = m.el.querySelector('.modal-pie .primario');
          await conBoton(btn, async () => {
            try { await numeracion.fijar(app.socId, r.terminal, r.tipo, n, amb); } catch (e) { mostrar(conPunto(textoDeError(e)), inp); return; }
            toast('Número guardado. El siguiente será el ' + num(n + 1, 0) + '.');
            c(); await cargar();
          });
        } }],
      });
      inp.focus(); inp.select();
    }

    /* ---------- 4. El paso guiado: confirmar el primer número de la factura real ---------- */
    // Un formulario con la frase que la base exige. envia() llama a la función de la base; devuelve el texto de éxito.
    function formularioConfirmar({ frase, titulo, asegura, boton, envia, exito }) {
      const err = h('div.error-caja', { hidden: true, role: 'alert' });
      const mostrar = (m, el) => { err.textContent = m; err.hidden = !m; el?.focus(); };
      const inp = h('input.campo', { type: 'text', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', 'aria-label': 'Escriba la frase para confirmar: ' + frase });
      const ok = h('button.btn.primario', { type: 'button', onclick: () => {
        mostrar('');
        if (inp.value.trim().toLowerCase() !== frase) return mostrar('Para confirmar, escriba exactamente: ' + frase + '.', inp);
        conBoton(ok, async () => {
          const sigue = await confirmar(asegura + ' Esto no cambia el modo del sistema: sigue en «' + TEXTO_AMBIENTE[D.actual] + '» hasta que la persona encargada lo cambie.', { si: 'Sí, confirmar', no: 'No, volver' });
          if (!sigue || !vivo) return;
          try { await envia(frase); } catch (e) { mostrar(conPunto(textoDeError(e)), inp); return; }
          toast(exito);
          await cargar();
        });
      } }, boton);
      return h('div.num-confirmar',
        h('p.num-paso-t', titulo),
        h('p', asegura),
        h('label.etq', 'Para confirmar, escriba: ', h('strong.num-frase', frase), inp),
        err, ok);
    }

    function pasoGuiado() {
      const req = D.requeridos;
      const cajas = [...new Set(req.filter((r) => !esRespuesta(r.tipo)).map((r) => r.terminal))].sort((a, b) => a - b);
      const deCaja = (t) => req.filter((r) => !esRespuesta(r.tipo) && r.terminal === t);
      const resp = req.filter((r) => esRespuesta(r.tipo));
      const listo = (rs) => rs.length > 0 && rs.every((r) => r.fijado);
      const primeroDe = (rs) => { const f = rs.find((r) => r.tipo === '01') || rs[0]; return f && f.siguiente != null ? f.siguiente : null; };
      const yaEmitio = D.reales > 0;

      const bloqueCaja = (t) => {
        const rs = deCaja(t);
        const titulo = 'Facturas, tiquetes y notas · ' + caja(t);
        if (listo(rs)) return h('div.num-subpaso.hecho', h('span.chip.ok', 'Confirmado'), h('p', h('strong', titulo)), h('p.num-nota', 'La primera factura real de esta caja llevará el número ' + num(primeroDe(rs) ?? 1, 0) + '.'));
        if (yaEmitio) return h('div.num-subpaso', h('p', h('strong', titulo)), h('p.num-nota', 'La empresa ya emitió ' + num(D.reales, 0) + (D.reales === 1 ? ' comprobante real' : ' comprobantes reales') + ': no se puede confirmar que empieza en 1. Escriba el último número emitido de cada tipo en la lista de números.'));
        return h('div.num-subpaso', formularioConfirmar({
          frase: FRASE_COMPROBANTES, titulo,
          asegura: 'Con esto usted asegura que esta empresa nunca ha emitido facturas, tiquetes ni notas en producción, con este ni con otro sistema. La primera factura real será la número 1.',
          boton: 'Confirmar que empieza en 1', envia: (f) => numeracion.confirmarInicio(app.socId, t, f), exito: 'Listo. La primera factura real de la ' + caja(t).toLowerCase() + ' será la número 1.',
        }));
      };
      const bloqueResp = () => {
        const titulo = 'Respuestas a facturas de proveedores (aceptar o rechazar una compra)';
        if (listo(resp)) return h('div.num-subpaso.hecho', h('span.chip.ok', 'Confirmado'), h('p', h('strong', titulo)), h('p.num-nota', 'La primera respuesta real llevará el número ' + num(primeroDe(resp) ?? 1, 0) + '.'));
        return h('div.num-subpaso', formularioConfirmar({
          frase: FRASE_RESPUESTAS, titulo,
          asegura: 'Con esto usted asegura que esta empresa nunca ha enviado a Hacienda, en producción, aceptaciones ni rechazos de facturas de proveedores (mensajes 05, 06 y 07), con este ni con otro sistema.',
          boton: 'Confirmar que empieza en 1', envia: (f) => numeracion.confirmarInicioMensajes(app.socId, f), exito: 'Listo. La primera respuesta real a un proveedor será la número 1.',
        }));
      };

      return h('section.tarjeta.num-paso',
        h('h2', 'Confirmar el primer número de la factura real'),
        h('p', 'Antes de facturar de verdad, el sistema necesita saber con qué número empieza cada tipo de documento. Hacienda rechaza un número repetido, por eso este paso se hace con cuidado.'),
        h('div.num-aviso.info', h('strong', 'Si la empresa ya emitió facturas reales con otro sistema, no confirme aquí. '), 'Escriba el último número emitido de cada tipo en la lista de números de arriba (botón «Fijar el último número»), también el de las respuestas a proveedores.'),
        cajas.length ? cajas.map(bloqueCaja) : h('p.num-nota', 'La base no informó las cajas de esta empresa.'),
        resp.length ? bloqueResp() : null);
    }

    function pintar() {
      cuerpo.replaceChildren(
        bannerAmbiente(),
        candado(),
        h('div.num-numeros', h('h2.num-h2', 'Los números de cada tipo de documento'),
          h('p.num-nota', 'Cada tipo de documento lleva su propio número, y cada caja el suyo. Un número que ya se emitió no se repite ni se baja.'),
          bloqueNumeros('sandbox'), bloqueNumeros('produccion')),
        pasoGuiado());
    }

    root.append(h('div.num',
      h('div.num-cab',
        h('p', 'Aquí se ve en qué modo está el sistema, qué número sigue de cada documento y qué falta para facturar de verdad.'),
        h('button.btn', { type: 'button', onclick: (e) => conBoton(e.currentTarget, () => cargar()) }, 'Revisar de nuevo')),
      cuerpo));
    await cargar();
    return () => { vivo = false; nCarga++; };
  },
};
