// Datos del módulo Listados (no se edita api.js). Función SQL: public.fx_listados2 (ver /home/claude/facturador/sql/05_listados2.sql).
import { rpc } from './api.js';

// Llaves de nota de débito y devoluciones parciales (ronda 4): resumen.notas_debito_n / notas_debito / iva_notas_debito (ventas_netas e iva_neto ya las incluyen), por_dia[].notas_debito, rechazados.notas_debito_n.
// Desde la migración fx_23a, por_hora, por_medio, por_servicio, productos, por_cajero y por_turno RESTAN las devoluciones parciales y SUMAN las notas de débito por monto (cada fila trae además bruto, devoluciones y notas_debito; total = bruto - devoluciones + notas_debito).
// Devuelve {resumen, por_dia, por_hora, por_medio, por_servicio, por_cajero, por_turno, productos, por_tarifa, rechazados?}.
// por_tarifa: [{codigo, nombre, base, iva, total, documentos}] (contrato 4; la versión anterior traía {tarifa, total_con_iva, iva}, y m_listados acepta las dos).
// turno (opcional): id de un turno para ver solo sus ventas.
export const listados2 = (soc, desde, hasta, turno = null) => rpc('fx_listados2', { p_soc: soc, p_desde: desde, p_hasta: hasta, p_turno: turno });
