// Cálculos y textos de «Caja para mí» (SINPE, administración). Todo aquí es puro: no toca la pantalla ni la base, para poder probarlo solo.
// Cifras de SINPE: siempre BRUTAS (lo que el banco avisó, sin descontar nada), en colones.

export const TARDA_MIN = 30;       // un teléfono que llama cada tanto: pasados 30 minutos sin latido se dice «tarda»
export const SIN_SENAL_MIN = 120;  // pasadas 2 horas sin latido se dice «sin señal»

const TZ = 'America/Costa_Rica';
const nf = (dec) => new Intl.NumberFormat('es-CR', { maximumFractionDigits: dec, minimumFractionDigits: 0 });
export const numTxt = (n, dec = 0) => (n == null || !Number.isFinite(Number(n)) ? '—' : nf(dec).format(Number(n)));
export const pctTxt = (x, dec = 0) => (x == null || !Number.isFinite(Number(x)) ? '—' : nf(dec).format(Number(x) * 100) + ' %');
export const diaCR = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(d));
export const horaCR = (d) => new Intl.DateTimeFormat('es-CR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(d));
export const fechaHoraCR = (d) => (d ? new Intl.DateTimeFormat('es-CR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(d)) : '');
export const dmaDeYmd = (ymd) => (ymd ? String(ymd).slice(0, 10).split('-').reverse().join('/') : '');
const NOMBRES_DIA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const NOMBRES_MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const nombreMes = (ymd) => NOMBRES_MES[+String(ymd).slice(5, 7) - 1] + ' ' + String(ymd).slice(0, 4);
export function diaLargo(ymd) {
  const f = new Date(String(ymd).slice(0, 10) + 'T12:00:00Z');
  return NOMBRES_DIA[f.getUTCDay()] + ' ' + f.getUTCDate() + ' de ' + NOMBRES_MES[f.getUTCMonth()] + ' de ' + f.getUTCFullYear();
}
// día de la semana, de lunes (1) a domingo (7), como lo manda el servidor (isodow)
export const NOMBRE_ISODOW = { 1: 'Lunes', 2: 'Martes', 3: 'Miércoles', 4: 'Jueves', 5: 'Viernes', 6: 'Sábado', 7: 'Domingo' };

// «hace 12 min», «hace 3 h 20 min», «hace 6 días»
export function haceTexto(min) {
  const m = Math.max(0, Math.floor(Number(min) || 0));
  if (m < 1) return 'ahora mismo';
  if (m < 60) return 'hace ' + m + ' min';
  if (m < 60 * 24) { const hh = Math.floor(m / 60), mm = m % 60; return 'hace ' + hh + ' h' + (mm ? ' ' + mm + ' min' : ''); }
  const d = Math.floor(m / 1440);
  return 'hace ' + d + (d === 1 ? ' día' : ' días');
}

/* ---------- versiones ---------- */
// «2.11.0» → [2,11,0]; «3.5 19nov» → [3,5,0]; «3.7 ota 26nov» → [3,7,0]; lo que no empieza con número → null
export function versionPartes(t) {
  const m = /^\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(String(t ?? ''));
  return m ? [+m[1], +(m[2] || 0), +(m[3] || 0)] : null;
}
// -1 si a es más vieja que b, 0 si son iguales, 1 si a es más nueva; null si alguna no se puede leer
export function compararVersion(a, b) {
  const x = versionPartes(a), y = versionPartes(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

/* ---------- el teléfono ---------- */
// nivel: 'ok' (llama al día), 'tarda', 'sin' (sin señal), 'nunca' (todavía no ha llamado)
export function estadoLatido(minutos) {
  if (minutos == null || !Number.isFinite(Number(minutos))) return { nivel: 'nunca', texto: 'Todavía no ha llamado' };
  const m = Number(minutos);
  if (m <= TARDA_MIN) return { nivel: 'ok', texto: 'Llama al día' };
  if (m <= SIN_SENAL_MIN) return { nivel: 'tarda', texto: 'Tarda en llamar' };
  return { nivel: 'sin', texto: 'Sin señal' };
}
const NIVEL_RIESGO = { critico: 0, alto: 1, info: 2 };
export const riesgosOrdenados = (r) => [...(Array.isArray(r) ? r : [])].sort((a, b) => (NIVEL_RIESGO[a.nivel] ?? 3) - (NIVEL_RIESGO[b.nivel] ?? 3));
export const textoRed = (t) => {
  if (!t.tipo_red && t.red_validada == null) return 'No informa';
  const tipo = { wifi: 'Wi‑Fi', mobile: 'Datos móviles', celular: 'Datos móviles', ninguna: 'Sin red' }[String(t.tipo_red || '').toLowerCase()] || (t.tipo_red ? String(t.tipo_red) : '');
  const val = t.red_validada === true ? 'con internet' : t.red_validada === false ? 'sin internet validado' : '';
  return [tipo, val].filter(Boolean).join(' · ') || 'No informa';
};
export const textoBateria = (t) => (t.bateria == null ? 'No informa' : t.bateria + ' %' + (t.cargando === true ? ' · cargando' : t.cargando === false ? ' · sin cargar' : ''));

// Banner de atención de la pestaña «Hoy»: en palabras, qué pasa y qué significa para los SINPE
export function atencionTelefonos(telefonos) {
  const out = [];
  for (const t of telefonos || []) {
    const e = estadoLatido(t.minutos);
    if (e.nivel === 'sin') out.push({ nivel: 'alto', texto: `El teléfono «${t.telefono}» no llama ${haceTexto(t.minutos)} (último latido: ${fechaHoraCR(t.ultimo_latido)}). Mientras no llame, los SINPE de ese rato no llegan a esta pantalla.` });
    else if (e.nivel === 'tarda') out.push({ nivel: 'medio', texto: `El teléfono «${t.telefono}» tarda en llamar: último latido ${haceTexto(t.minutos)}.` });
    else if (e.nivel === 'nunca') out.push({ nivel: 'medio', texto: `El teléfono «${t.telefono}» todavía no ha llamado.` });
    for (const r of riesgosOrdenados(t.riesgos).filter((x) => x.nivel === 'critico')) out.push({ nivel: 'alto', texto: `«${t.telefono}»: ${r.motivo}.` });
  }
  if (!(telefonos || []).length) out.push({ nivel: 'medio', texto: 'No hay ningún teléfono registrado para esta empresa.' });
  return out;
}

/* ---------- órdenes ---------- */
export const NOMBRE_ORDEN = { latido_ya: 'Pedir latido', reenviar_historial: 'Reenviar historial' };
export const AYUDA_ORDEN = {
  latido_ya: 'El teléfono responde con su estado apenas reciba la orden (batería, red, versión).',
  reenviar_historial: 'El teléfono vuelve a mandar los SMS del banco que tiene guardados. Sirve para recuperar avisos de un rato en que no llamó.',
};
export const NOMBRE_ESTADO_ORDEN = { pendiente: 'Esperando al teléfono', entregado: 'El teléfono la recibió', ejecutado: 'Hecha', vencido: 'Venció sin hacerse', cancelado: 'Cancelada' };
export const CLASE_ESTADO_ORDEN = { pendiente: 'espera', entregado: 'espera', ejecutado: 'ok', vencido: 'mal', cancelado: 'mal' };

/* ---------- kit ↔ app ---------- */
// Arma la lista de banderas (solo lectura). Cada una: { nivel: 'alto'|'medio'|'info', titulo, detalle }.
// reglas: filas de fact.sinpe_compat_reglas (hoy vacía: ninguna regla se inventa). manifiesto: el manifiesto OTA del kit o null.
export function banderasKit({ telefonos = [], equipos = [], reglas = [], manifiesto = null } = {}) {
  const b = [];
  const push = (nivel, titulo, detalle) => b.push({ nivel, titulo, detalle });
  for (const t of telefonos) {
    if (t.minutos != null && t.minutos > SIN_SENAL_MIN) push('alto', `El teléfono «${t.telefono}» no llama`, `Su último latido fue ${haceTexto(t.minutos)}. No se puede saber con qué versión está corriendo ahora.`);
    if (!t.app) push('medio', `El teléfono «${t.telefono}» no informa su versión`, 'Su app es de una versión anterior a las que mandan la versión en el latido, o no ha llamado desde que se actualizó. Se resuelve instalando la app nueva.');
  }
  for (const e of equipos) {
    if (e.minutos == null) push('medio', `La computadora «${e.nombre || e.estacion}» nunca ha informado su versión`, 'No hay ningún latido de esa caja. Puede ser que todavía no tenga el kit que informa, o que nunca se haya encendido con él.');
    else if (e.minutos > SIN_SENAL_MIN) push('medio', `La computadora «${e.nombre || e.estacion}» no informa ${haceTexto(e.minutos)}`, 'Puede estar apagada o fuera de horario. Si debería estar abierta, hay que revisarla.');
  }
  const nombreDe = (e) => e.nombre || e.estacion;
  for (const r of reglas) {
    const m = r.motivo ? ' Motivo: ' + r.motivo + '.' : '';
    if (r.tipo === 'app_minima') for (const t of telefonos) {
      const c = compararVersion(t.app, r.app_min);
      if (c === -1) push('alto', `La app de «${t.telefono}» (${t.app}) es más vieja que la mínima (${r.app_min})`, 'Hay que actualizarla.' + m);
    }
    if (r.tipo === 'kit_minimo') for (const e of equipos) {
      const c = compararVersion(e.version_kit, r.kit_min);
      if (c === -1) push('alto', `El kit de «${nombreDe(e)}» (${e.version_kit}) es más viejo que el mínimo (${r.kit_min})`, 'Hay que actualizarlo.' + m);
    }
    if (r.tipo === 'app_exige_kit') for (const t of telefonos) for (const e of equipos) {
      if (compararVersion(t.app, r.app_min) !== null && compararVersion(t.app, r.app_min) >= 0 && compararVersion(e.version_kit, r.kit_min) === -1)
        push('alto', `La app ${t.app} pide el kit ${r.kit_min} o más nuevo y «${nombreDe(e)}» tiene ${e.version_kit}`, 'Los dos lados no son compatibles todavía.' + m);
    }
    if (r.tipo === 'kit_exige_app') for (const t of telefonos) for (const e of equipos) {
      if (compararVersion(e.version_kit, r.kit_min) !== null && compararVersion(e.version_kit, r.kit_min) >= 0 && compararVersion(t.app, r.app_min) === -1)
        push('alto', `El kit ${e.version_kit} de «${nombreDe(e)}» pide la app ${r.app_min} o más nueva y «${t.telefono}» tiene ${t.app}`, 'Los dos lados no son compatibles todavía.' + m);
    }
  }
  // Manifiesto OTA: ¿hay publicada una versión más nueva que la instalada para esa estación?
  const lanz = Array.isArray(manifiesto?.lanzamientos) ? manifiesto.lanzamientos : [];
  for (const e of equipos) {
    const para = lanz.filter((l) => Array.isArray(l.estaciones) && l.estaciones.includes(e.estacion)).sort((x, y) => (y.serie || 0) - (x.serie || 0))[0];
    if (!para || !e.version_kit) continue;
    const c = compararVersion(e.version_kit, para.version);
    if (c === -1 || (c === null && String(e.version_kit).trim() !== String(para.version).trim())) push('info', `Para «${nombreDe(e)}» hay publicada una versión del kit más nueva (${para.version})`, `Tiene instalada la ${e.version_kit}. Se actualiza sola cuando la caja toma el paquete.`);
  }
  const apps = [...new Set(telefonos.map((t) => t.app).filter(Boolean))];
  if (apps.length > 1) push('info', 'Hay teléfonos con versiones de app distintas', 'Versiones: ' + apps.join(', ') + '.');
  if (!reglas.length) push('info', 'Todavía no hay reglas de compatibilidad cargadas', 'Hoy se avisa solo por falta de señal y por versiones que no se informan. Cuando se defina qué versión de la app necesita cada versión del kit (y al revés), se cargan y las banderas las usan.');
  const orden = { alto: 0, medio: 1, info: 2 };
  return b.sort((x, y) => orden[x.nivel] - orden[y.nivel]);
}

/* ---------- estadística ---------- */
// Media, desviación estándar muestral y coeficiente de variación (sd / media) de una lista de números
export function resumenNumeros(xs) {
  const v = (xs || []).map(Number).filter(Number.isFinite);
  const n = v.length;
  if (!n) return { n: 0, media: null, sd: null, cv: null };
  const media = v.reduce((a, x) => a + x, 0) / n;
  const sd = n > 1 ? Math.sqrt(v.reduce((a, x) => a + (x - media) ** 2, 0) / (n - 1)) : null;
  return { n, media, sd, cv: sd != null && media > 0 ? sd / media : null };
}
// Horas con pagos (o con datos) para recortar el gráfico: desde la primera hora con algo hasta la última, sin horas vacías en las puntas
export function recorteHoras(porHora, vacio = (x) => !(x.n > 0)) {
  const con = (porHora || []).filter((x) => !vacio(x)).map((x) => +x.hora);
  if (!con.length) return [];
  const a = Math.min(...con), z = Math.max(...con);
  return (porHora || []).filter((x) => +x.hora >= a && +x.hora <= z);
}
export const etiquetaHora = (h) => String(h).padStart(2, '0') + ':00';
export const etiquetaCajera = (c) => (c ? c.charAt(0).toUpperCase() + c.slice(1) : 'Sin cajera conocida');
// Texto de lectura de una hora del gráfico
export function lecturaHora(x) {
  return `${etiquetaHora(x.hora)} a ${etiquetaHora((+x.hora + 1) % 24)}: ${numTxt(x.n)} pagos en total; por día, ${numTxt(x.dia_media, 2)} en promedio (desviación estándar ${numTxt(x.dia_sd, 2)}, coeficiente de variación ${pctTxt(x.dia_cv)}). Cada pago: ${numTxt(x.ticket_media, 0)} de promedio, desviación ${numTxt(x.ticket_sd, 0)}, variación ${pctTxt(x.ticket_cv)}.`;
}

/* ---------- filtro de texto en las listas ---------- */
const sinTildes = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// Coincide con el nombre, la referencia o el monto (5000, 5.000 o 5 000)
export function coincidePago(p, consulta) {
  const q = sinTildes(consulta).trim();
  if (!q) return true;
  if (/^[\d\s.,]+$/.test(q)) { const dig = q.replace(/[\s.,]/g, ''); return String(Math.round(+p.monto)).includes(dig) || String(p.referencia || '').includes(dig); }
  return sinTildes([p.pagador, p.referencia, p.detalle].join(' ')).includes(q);
}

/* ---------- tablas para descargar ---------- */
const hhmm = (d) => horaCR(d);
const ymd = (d) => diaCR(d);
const NOMBRE_ORIGEN = { historial: 'Historial reenviado', en_vivo: 'En vivo' };
const NOMBRE_ESTADO_PAGO = { sin_asignar: 'Sin asignar', asignado: 'Asignado a una venta', revision: 'En revisión', duplicado: 'Duplicado' };
export const nombreEstadoPago = (e) => NOMBRE_ESTADO_PAGO[e] || e || '';
export const nombreOrigen = (o) => NOMBRE_ORIGEN[o] || o || '';

export function tablaSinFactura(d) {
  const filas = [];
  for (const dia of d.por_dia || []) for (const p of dia.pagos) filas.push({ fecha: ymd(p.hora), hora: hhmm(p.hora), pagador: p.pagador || '', referencia: p.referencia || '', monto: +p.monto, origen: nombreOrigen(p.origen), estado: nombreEstadoPago(p.estado) });
  filas.sort((a, b) => (a.fecha + a.hora < b.fecha + b.hora ? -1 : 1));
  return {
    titulo: 'SINPE sin factura', cifras: 'brutas', cifrasNota: 'Montos que el banco avisó, tal como llegaron, en colones',
    columnas: [{ clave: 'fecha', titulo: 'Fecha', tipo: 'fecha' }, { clave: 'hora', titulo: 'Hora', tipo: 'texto' }, { clave: 'pagador', titulo: 'Quién pagó', tipo: 'texto' }, { clave: 'referencia', titulo: 'Referencia', tipo: 'texto' },
      { clave: 'monto', titulo: 'Monto (₡)', tipo: 'moneda' }, { clave: 'origen', titulo: 'Origen del aviso', tipo: 'texto' }, { clave: 'estado', titulo: 'Estado', tipo: 'texto' }],
    filas, totales: { monto: 'suma' }, etiquetaTotal: 'Total',
    notas: ['Pagos reales que el banco avisó y que no están atados a ninguna venta del facturador. Ordenado del día más antiguo al más reciente.'],
  };
}
export function tablaInformeMes(d) {
  const filas = (d.filas || []).map((p) => ({ fecha: ymd(p.hora), hora: hhmm(p.hora), monto: +p.monto, referencia: p.referencia || '', estado: nombreEstadoPago(p.estado), origen: nombreOrigen(p.origen), venta: p.venta_numero || '', clave: p.clave || '', pagador: p.pagador || '' }));
  filas.sort((a, b) => (a.fecha + a.hora < b.fecha + b.hora ? -1 : 1)); // el archivo va en orden cronológico: día 1 primero
  return {
    titulo: 'SINPE Móvil del mes', cifras: 'brutas', cifrasNota: 'Montos que el banco avisó, en colones, sin descontar notas de crédito',
    columnas: [{ clave: 'fecha', titulo: 'Fecha', tipo: 'fecha' }, { clave: 'hora', titulo: 'Hora', tipo: 'texto' }, { clave: 'monto', titulo: 'Monto (₡)', tipo: 'moneda' }, { clave: 'referencia', titulo: 'Referencia del banco', tipo: 'texto' },
      { clave: 'estado', titulo: 'Estado', tipo: 'texto' }, { clave: 'venta', titulo: 'Venta', tipo: 'texto' }, { clave: 'clave', titulo: 'Clave de la factura', tipo: 'texto' }, { clave: 'pagador', titulo: 'Quién pagó', tipo: 'texto' }, { clave: 'origen', titulo: 'Origen del aviso', tipo: 'texto' }],
    filas, totales: { monto: 'suma' }, etiquetaTotal: 'Total SINPE del mes',
  };
}
export function tablaResumenMes(d) {
  const r = d.resumen || {}, f = d.medio06_facturas || { n: 0, total: 0 }, nc = d.notas_credito_mes || { n: 0, total: 0 };
  const dif = (+r.total || 0) - (+f.total || 0);
  return {
    titulo: 'Resumen del mes', cifras: 'brutas', cifrasNota: 'Colones, sin descontar notas de crédito',
    columnas: [{ clave: 'concepto', titulo: 'Concepto', tipo: 'texto' }, { clave: 'monto', titulo: 'Monto (₡)', tipo: 'moneda' }, { clave: 'cantidad', titulo: 'Cantidad', tipo: 'numero', dec: 0 }],
    filas: [
      { concepto: 'SINPE Móvil que el banco avisó en el mes', monto: +r.total || 0, cantidad: +r.n || 0 },
      { concepto: '… de ese total, atado a una venta del facturador', monto: +r.con_venta_total || 0, cantidad: +r.con_venta_n || 0 },
      { concepto: '… de ese total, con clave de factura', monto: +r.con_clave_total || 0, cantidad: +r.con_clave_n || 0 },
      { concepto: '… de ese total, sin venta en el facturador', monto: +r.sin_venta_total || 0, cantidad: +r.sin_venta_n || 0 },
      { concepto: 'Medio de pago 06 (SINPE Móvil) en las facturas y tiquetes aceptados del mes', monto: +f.total || 0, cantidad: +f.n || 0 },
      { concepto: 'Diferencia: lo que avisó el banco menos el medio 06 facturado', monto: dif, cantidad: null },
      { concepto: 'Notas de crédito aceptadas del mes (informativo, no se descuentan aquí)', monto: +nc.total || 0, cantidad: +nc.n || 0 },
    ],
    notas: ['La diferencia no tiene por qué ser cero: mientras una empresa facture con otro sistema, el banco avisa pagos que las facturas de este facturador no ven.'],
  };
}
export function tablaHoras(d) {
  return {
    titulo: 'SINPE por hora', cifras: 'brutas', cifrasNota: 'Colones. «Por día» cuenta también los días sin ningún pago como cero',
    columnas: [{ clave: 'hora', titulo: 'Hora', tipo: 'texto' }, { clave: 'n', titulo: 'Pagos', tipo: 'numero', dec: 0 }, { clave: 'total', titulo: 'Total (₡)', tipo: 'moneda' }, { clave: 'tm', titulo: 'Pago promedio (₡)', tipo: 'moneda' },
      { clave: 'ts', titulo: 'Desviación estándar del pago (₡)', tipo: 'moneda' }, { clave: 'tcv', titulo: 'Variación del pago', tipo: 'porcentaje', dec: 0 }, { clave: 'dm', titulo: 'Pagos por día, promedio', tipo: 'numero', dec: 2 },
      { clave: 'ds', titulo: 'Pagos por día, desviación estándar', tipo: 'numero', dec: 2 }, { clave: 'dcv', titulo: 'Pagos por día, variación', tipo: 'porcentaje', dec: 0 }],
    filas: (d.por_hora || []).map((x) => ({ hora: etiquetaHora(x.hora), n: +x.n, total: +x.total, tm: x.ticket_media, ts: x.ticket_sd, tcv: x.ticket_cv == null ? null : +x.ticket_cv * 100, dm: x.dia_media, ds: x.dia_sd, dcv: x.dia_cv == null ? null : +x.dia_cv * 100 })),
  };
}
export function tablaSerieHoras(d) {
  return {
    titulo: 'Pagos SINPE por hora', cifras: 'brutas', cifrasNota: 'Solo la parte pagada con SINPE Móvil, en colones',
    columnas: [{ clave: 'dia', titulo: 'Fecha', tipo: 'fecha' }, { clave: 'hora', titulo: 'Hora (0 a 23)', tipo: 'numero', dec: 0 }, { clave: 'n', titulo: 'Pagos', tipo: 'numero', dec: 0 }, { clave: 'total', titulo: 'Total (₡)', tipo: 'moneda' }],
    filas: (d.filas || []).map((x) => ({ dia: String(x.dia).slice(0, 10), hora: +x.hora, n: +x.n, total: +x.total })),
    totales: { n: 'suma', total: 'suma' },
    notas: [d.nota].filter(Boolean),
  };
}
