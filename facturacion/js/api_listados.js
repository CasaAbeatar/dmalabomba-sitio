// Datos del módulo Listados (no se edita api.js). Función SQL: public.fx_listados2 (ver /home/claude/facturador/sql/05_listados2.sql).
import { rpc } from './api.js';

// Devuelve {resumen, por_dia, por_hora, por_medio, por_servicio, por_cajero, por_turno, productos, por_tarifa, rechazados?}.
// por_tarifa: [{codigo, nombre, base, iva, total, documentos}] (contrato 4; la versión anterior traía {tarifa, total_con_iva, iva}, y m_listados acepta las dos).
// turno (opcional): id de un turno para ver solo sus ventas.
export const listados2 = (soc, desde, hasta, turno = null) => rpc('fx_listados2', { p_soc: soc, p_desde: desde, p_hasta: hasta, p_turno: turno });
