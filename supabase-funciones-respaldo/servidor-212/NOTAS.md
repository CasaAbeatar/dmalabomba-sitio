# Servidor de la app Sinpe 2.12 (fork H, 26 nov 2026 ~15:00 CR)
Aplicado en producción (aditivo, con respaldo en `fact.sinpe_respaldo_funciones`, motivos «respaldo antes de 2.12 servidor…» y «definicion NUEVA aplicada 2.12 servidor…»; reversa en `REVERTIR.sql`):
- `fact.sinpe_detalle_limpiar` (+ `sinpe_detalle_aplanar`, `sinpe_version_num`): llaves planas nuevas y forma anidada del contrato.
- `fact.sinpe_latido_cmd`: desde cuándo se mantienen sms_sin_reenviar / sin_cargador / sin_red, reacción automática (reiniciar_servicio + reenviar_historial, máx. 1/hora, `creado_por='auto:sms_sin_reenviar'`) y campo `actualizacion`.
- `fact.sinpe_riesgos`: códigos `sms_sin_reenviar` (bandeja), `sin_cargador`, `sin_red`, `actualizacion_fallida` dentro del sistema de alertas `sinpe_telefono_riesgo` (dedupe diario, cierre automático).
- Órdenes `abrir_adb`/`cerrar_adb` (restricción de `fact.sinpe_comandos` y `public.sinpe_comando_crear`: solo administrador general o service_role, un teléfono con app >= 2.12.0).
- Tabla `fact.sinpe_actualizaciones` (RLS, solo service_role) + `public.sinpe_actualizacion_{registrar,activar,desactivar,leer,secreto}`; edge function `sinpe-actualizacion` v1 (descarga la URL y compara el sha256 antes de activar). NADA activado.
- `abrir_ajuste` en `public.sinpe_pantalla_accion_v2` (+ restricción de `pantalla_priv.sinpe_pantalla_entrada.a`), `public.sinpe_pantalla_salud_v1`, `public.sinpe_pantalla_adb_v1`.
- Edge functions: `sinpe-recibir` v7 (firma ACT1 + eco), `sinpe-pantalla-visor` v3 (ops salud/adb).
Visor /remoto (vista previa `vista-pantalla.sinpe-pagos.pages.dev`; NO en producción): botones de ajustes y sección «Salud del teléfono».
Pruebas: `prueba-212.mjs`, `prueba-act.mjs` (19 PASS), `prueba-visor-212.mjs` (22 PASS), regresión `pantalla-pruebas/prueba.mjs` por el worker de la vista previa (32 PASS, 1 FAIL esperado: prueba de CORS con otro origen).
