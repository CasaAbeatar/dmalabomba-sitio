// Contabilidad, pestaña «Catálogo»: plan de cuentas y las decisiones que le tocan a la contadora (fase 1).
// El catálogo se lee de fx_contable_catalogo; los parámetros, de fx_contable_parametros. Nada se calcula aquí.
import { h, esqueleto, bloqueError, textoDeError, toast, conBoton } from './util.js';
import { catalogo, catalogoIniciar, cuentaGuardar, parametros, parametroGuardar } from './api_contable.js';

export const TIPOS = { activo: 'Activo', pasivo: 'Pasivo', patrimonio: 'Patrimonio', ingreso: 'Ingreso', costo: 'Costo', gasto: 'Gasto' };
// Para qué sirve cada cuenta con función, dicho en palabras (el código técnico no se muestra)
export const ROLES = {
  caja: 'Efectivo de la caja', fondo_cajas: 'Fondo de cambio', bancos: 'Dinero en bancos (SINPE y transferencias)', tarjetas_por_cobrar: 'Ventas con tarjeta por recibir', clientes: 'Clientes que deben',
  retenciones_tarjeta: 'Retenciones de tarjeta a favor', inventarios: 'Inventario', iva_credito: 'IVA de las compras (crédito)', iva_saldo_favor: 'Saldo a favor de IVA', renta_anticipos: 'Anticipos de renta',
  proveedores: 'Proveedores', cxp_otras: 'Otras cuentas por pagar', iva_debito: 'IVA de las ventas (débito)', iva_por_pagar: 'IVA por pagar', renta_por_pagar: 'Renta por pagar',
  salarios_por_pagar: 'Salarios por pagar', cargas_por_pagar: 'Cargas de la CCSS por pagar', provision_laboral: 'Aguinaldo y vacaciones por pagar', servicio_por_pagar: 'Servicio (10 %) por pagar al personal',
  ventas: 'Ventas gravadas', ventas_exentas: 'Ventas exentas', devoluciones_ventas: 'Devoluciones y notas de crédito de ventas', otros_ingresos: 'Otros ingresos', sobrante_caja: 'Sobrante de caja',
  costo_ventas: 'Costo de lo vendido', salarios: 'Salarios', cargas_patronales: 'Cargas patronales', gasto_provision_laboral: 'Aguinaldo y vacaciones (gasto)', suministros: 'Suministros y empaques',
  por_clasificar: 'Compras por clasificar', faltante_caja: 'Faltante de caja', iva_no_acreditable: 'IVA que no se acredita', gasto_depreciacion: 'Depreciación', comisiones_bancarias: 'Comisiones bancarias y de tarjeta',
  intereses_bancarios: 'Intereses', gasto_renta: 'Gasto de renta', ppe_equipo: 'Mobiliario y equipo', ppe_depreciacion: 'Depreciación acumulada', prestamos: 'Préstamos', capital: 'Capital social',
  reserva_legal: 'Reserva legal', resultados_acumulados: 'Resultados acumulados',
};

export default {
  id: 'catalogo', texto: 'Catálogo',
  async montar(cont, ctx) {
    const { soc } = ctx;
    const cuerpo = h('div.con-raiz');
    cont.append(cuerpo);
    let abierta = ctx.memoria.catalogoAbierta || null; // cuenta que se está editando ('nueva' o id)
    let filtro = ctx.memoria.catalogoFiltro || '';
    let datos = null, params = null;

    async function cargar() {
      if (!datos) cuerpo.replaceChildren(esqueleto(4, 'Cargando el catálogo…'));
      try { [datos, params] = await Promise.all([catalogo(soc.id), parametros(soc.id)]); }
      catch (e) { cuerpo.replaceChildren(bloqueError({ titulo: 'No se pudo cargar el catálogo', mensaje: textoDeError(e), alReintentar: cargar })); return; }
      pintar();
    }

    function pintar() {
      const cuentas = datos.cuentas || [];
      const pendientes = (params || []).filter((p) => p.decide_contadora && !p.resuelto);
      ctx.avisar?.('catalogo', pendientes.length);
      cuerpo.replaceChildren(bloqueDecisiones(pendientes), cuentas.length ? bloqueCuentas(cuentas) : bloqueVacio());
    }

    function bloqueVacio() {
      return h('div.con-bloque', h('h2', 'Todavía no hay catálogo de cuentas'),
        h('p.con-ayuda', 'Se crea un catálogo base para un restaurante (caja, bancos, inventario, IVA, ventas, gastos y planilla). Después se puede cambiar el nombre o agregar cuentas.'),
        h('button.btn.primario', { type: 'button', onclick: (e) => conBoton(e.currentTarget, async () => { try { const r = await catalogoIniciar(soc.id); toast('Catálogo creado: ' + r.cuentas_nuevas + ' cuentas'); datos = null; await cargar(); } catch (er) { toast(textoDeError(er), 'error'); } }) }, 'Crear el catálogo base'));
    }

    function bloqueDecisiones(pend) {
      const todas = (params || []).filter((p) => p.decide_contadora);
      return h('details.con-bloque', { open: pend.length > 0 },
        h('summary', 'Decisiones de la contadora ', pend.length ? h('span.chip.mal', pend.length + (pend.length === 1 ? ' pendiente' : ' pendientes')) : h('span.chip.ok', 'Todas resueltas')),
        h('p.con-ayuda', 'Hasta que ella decida, el sistema usa el valor provisional que se ve aquí. Cuando responda, escriba la respuesta y toque «Guardar».'),
        todas.map(filaDecision));
    }
    function filaDecision(p) {
      const v = p.valor;
      const inp = h('input.campo', { type: 'text', value: v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v), placeholder: 'Escriba la respuesta de la contadora', 'aria-label': p.descripcion });
      return h('div.con-decision',
        h('div.con-q', p.descripcion, ' ', h('span.chip.' + (p.resuelto ? 'ok' : 'mal'), p.resuelto ? 'Resuelta' : 'Pendiente')),
        h('div.con-fila', inp, h('button.btn', { type: 'button', onclick: (e) => conBoton(e.currentTarget, async () => {
          const t = inp.value.trim(); let val = t === '' ? null : t; try { if (t !== '' && /^[\[{0-9]/.test(t)) val = JSON.parse(t); } catch { val = t; }
          try { await parametroGuardar(soc.id, p.clave, val, t !== ''); toast('Guardado'); await cargar(); } catch (er) { toast(textoDeError(er), 'error'); }
        }) }, 'Guardar')));
    }

    function bloqueCuentas(cuentas) {
      const buscar = h('input.campo', { type: 'search', placeholder: 'Buscar por nombre o código', value: filtro, 'aria-label': 'Buscar una cuenta',
        oninput: (e) => { filtro = e.target.value; ctx.memoria.catalogoFiltro = filtro; pintarFilas(); } });
      const tbody = h('tbody');
      const norm = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      function pintarFilas() {
        const f = norm(filtro);
        const vis = cuentas.filter((c) => !f || norm(c.codigo + ' ' + c.nombre).includes(f));
        tbody.replaceChildren(...vis.flatMap((c) => {
          const fila = h('tr.con-toque' + (c.imputable ? '' : '.con-grupo') + (c.activa ? '' : '.con-neutro'), { tabindex: 0, role: 'button', 'aria-label': 'Editar la cuenta ' + c.nombre,
            onclick: () => abrir(c.id), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(c.id); } } },
            h('td.con-codigo', c.codigo), h('td', h('span.con-sangria', { style: 'padding-left:' + (Math.max(0, c.nivel - 1) * 14) + 'px' }, c.nombre, c.activa ? '' : ' (inactiva)')),
            h('td', TIPOS[c.tipo]), h('td.con-nota', c.rol ? ROLES[c.rol] || '' : ''));
          const res = [fila];
          if (abierta === c.id) res.push(h('tr', h('td', { colspan: 4 }, formulario(c, cuentas))));
          return res;
        }));
        if (abierta === 'nueva') tbody.prepend(h('tr', h('td', { colspan: 4 }, formulario(null, cuentas))));
      }
      function abrir(id) { abierta = abierta === id ? null : id; ctx.memoria.catalogoAbierta = abierta; pintarFilas(); }
      pintarFilas();
      return h('div.con-bloque', h('div.con-fila', h('h2', { style: 'flex:1' }, 'Catálogo de cuentas'), h('button.btn', { type: 'button', onclick: () => { abierta = 'nueva'; ctx.memoria.catalogoAbierta = abierta; pintarFilas(); } }, 'Agregar una cuenta')),
        h('p.con-ayuda', 'Toque una cuenta para cambiarla. Las filas en negrita son grupos: no reciben asientos, solo suman a sus subcuentas.'), buscar,
        h('div.tabla-caja', { style: 'margin-top:.6rem' }, h('table.con-tabla', h('thead', h('tr', h('th', 'Código'), h('th', 'Cuenta'), h('th', 'Tipo'), h('th', 'Para qué sirve'))), tbody)));
    }

    function formulario(c, cuentas) {
      const f = {
        codigo: h('input.campo', { type: 'text', value: c?.codigo || '', inputmode: 'decimal', placeholder: 'Ej.: 6.2.14' }),
        nombre: h('input.campo', { type: 'text', value: c?.nombre || '', maxlength: 120 }),
        tipo: h('select.campo', Object.entries(TIPOS).map(([k, t]) => h('option', { value: k, selected: c?.tipo === k }, t))),
        imputable: h('input', { type: 'checkbox', checked: c ? c.imputable : true }),
        activa: h('input', { type: 'checkbox', checked: c ? c.activa : true }),
        rol: h('select.campo', h('option', { value: '' }, 'Ninguna función especial'), Object.entries(ROLES).map(([k, t]) => h('option', { value: k, selected: c?.rol === k }, t))),
      };
      if (c?.con_movimientos) { f.codigo.disabled = true; f.tipo.disabled = true; }
      return h('div.con-form',
        h('label.etq', 'Código', f.codigo, h('span.con-nota', 'Números separados por punto; la cuenta superior debe existir.')),
        h('label.etq', 'Nombre', f.nombre),
        h('label.etq', 'Tipo', f.tipo),
        h('label.etq', 'Función en los asientos automáticos', f.rol, h('span.con-nota', 'Solo una cuenta por función. Déjela vacía si no aplica.')),
        h('label.etq', f.imputable, 'Se puede usar en asientos'), h('label.etq', f.activa, 'Cuenta activa'),
        h('div.con-acciones.ancho', { style: 'grid-column:1/-1' },
          h('button.btn.primario', { type: 'button', onclick: (e) => conBoton(e.currentTarget, async () => {
            try {
              await cuentaGuardar(soc.id, { id: c?.id || null, codigo: f.codigo.value.trim(), nombre: f.nombre.value.trim(), tipo: f.tipo.value, imputable: f.imputable.checked, activa: f.activa.checked, rol: f.rol.value || null, rubro: c?.rubro || null });
              abierta = null; ctx.memoria.catalogoAbierta = null; toast('Cuenta guardada'); await cargar();
            } catch (er) { toast(textoDeError(er), 'error'); }
          }) }, 'Guardar la cuenta'),
          h('button.btn', { type: 'button', onclick: () => { abierta = null; ctx.memoria.catalogoAbierta = null; pintar(); } }, 'Cerrar sin guardar')));
    }

    await cargar();
  },
};
