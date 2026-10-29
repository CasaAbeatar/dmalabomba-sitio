// CSV para Excel en español: UTF-8 con BOM, separador punto y coma, coma decimal.
import { descargar } from './util.js';

function celda(v) {
  if (v == null) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(Math.round(v * 1000) / 1000).replace('.', ',') : '';
  let t = String(v);
  if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; // evita que Excel lo tome como fórmula
  return /[;"\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
}
export function aCsv(encabezados, filas) {
  return '﻿' + [encabezados, ...filas].map((f) => f.map(celda).join(';')).join('\r\n') + '\r\n';
}
// nombre sin extensión; usar espacios y no guiones bajos
export function csvBajar(nombre, encabezados, filas) {
  descargar(nombre.replace(/_/g, ' ') + '.csv', aCsv(encabezados, filas), 'text/csv;charset=utf-8');
}
