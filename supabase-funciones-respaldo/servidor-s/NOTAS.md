# Alertas SINPE de monto y pago sin venta (27 nov 2026, hora de Costa Rica)

Migración aplicada: `sinpe_alertas_montos_sin_venta_27nov` (proyecto Supabase dwlbcbtwdungyrykgahm). Reversa: `REVERTIR.sql.txt`.
Entrada del Libro: `pagos.sinpe_movil.alertas_montos_sin_venta_27nov`.

- `fact.sinpe_monto_evaluar(monto, mu, sd, k_fuera, k_extremo)`: pura; z en escala logarítmica.
- `fact.sinpe_montos_vigilar(p_prueba, p_ahora, p_base)`: cron `sinpe-montos-5min` (1-56/5). Base = pagos reales de la empresa (CRC, no prueba) anteriores a las últimas 24 h; mínimo 100. `p_base` ({"n","mu","sd"}) solo sirve para pruebas.
- `fact.sinpe_sin_venta_vigilar(p_prueba, p_ahora, p_hay_ventas)`: cron `sinpe-sin-venta-5min` (2-57/5). Apagada para Soda y Pollos.
- Referencias: `extremo:<empresa>|<pago>` (familia `extremo:<empresa>` para el cooldown de 6 h), `banda:<empresa>|<pago>`, `sinventa:<empresa>:<AAAAMMDD CR>`; con prefijo `prueba:` en pruebas.
- El monto exacto va solo en `detalle` de la alerta, nunca en el texto del correo ni del push.
- Datos de Soda usados para calibrar: n=728, mu 8,3724, sd 0,7943 → banda ₡399–₡46.878, extremo desde ₡103.736.
