# Respaldo antes del cambio · SINPE administración · 27 nov 2026, 10:35 hora de Costa Rica

Este cambio es solo ADITIVO: crea funciones nuevas (`public.fx_sinpe_adm_*`, `fact.sinpe_adm_*`) y dos tablas nuevas y vacías (`fact.sinpe_compat_reglas`, `fact.sinpe_banco_movimientos`).
No modifica, reemplaza ni borra ningún objeto existente ni ninguna fila. Por eso el respaldo es la foto de cómo estaba todo:

| Qué | Antes |
|---|---|
| fact.sinpe_pagos | 774 filas |
| fact.sinpe_avisos | 780 |
| fact.sinpe_comandos | 19 |
| fact.sinpe_latidos | 18 |
| fact.sinpe_usados | 0 |
| fact.pagos | 1274 |
| fact.ventas | 1526 |
| fact.comprobantes | 1796 |
| Funciones en public + fact | 1148 |
| Huella md5 del texto de todas esas funciones | 9878682dc06bc5ca4ffddf5e75819b67 |

Después de aplicar: las filas de las tablas de arriba deben ser iguales, las funciones suben solo en las nuevas (13 = 9 públicas + 4 internas) y, quitando las nuevas, la huella debe seguir siendo la misma.
Para deshacer: `02 REVERTIR.sql` (se detiene si alguna tabla nueva ya tiene datos).
