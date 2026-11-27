# Contrato app Sinpe 2.12.0 <-> servidor (26 nov 2026)

## FE DE ERRATAS 2 DEL SERVIDOR (fork L, 26 nov 2026 19:10 CR, auditoria independiente de 2.12.0): MANDA SOBRE LA FE DE ERRATAS ANTERIOR
1. RESPUESTAS DEL LATIDO FIRMADAS (sinpe-recibir v8, en produccion). TODA respuesta 200 a un latido (con o sin ordenes, con o sin "actualizacion") lleva la cabecera `X-Signature` = HMAC-SHA256 hex en minusculas de los bytes EXACTOS del cuerpo de la respuesta (UTF-8, tal como se envian), con la clave de la regla de la app (la de su empresa: Soda la maestra, Pollos la suya; la misma que valida el latido). El cuerpo no cambia de formato. Las apps que ignoran la cabecera siguen funcionando. La app 2.12.0 DEBE exigirla para ejecutar `abrir_adb`/`cerrar_adb`/`reiniciar_telefono` y para ofrecer una actualizacion (con respuesta sin firma o con firma distinta: no ejecuta). Las respuestas de error (401, 409, 500) NO se firman y la app no debe obrar con ellas. Verificado con firma recalculada (Pollos y Soda de prueba): ver servidor-l/prueba-firma.mjs.
2. `ts` de ACT1 = instante de emision (ms, ahora) de ESA respuesta, no se guarda ni se reutiliza: otra respuesta, otro ts y otra firma. La vigencia de 24 h que valida la app queda como defensa en profundidad.
3. El servidor solo ofrece una actualizacion si la fila esta activa Y verificada (`verificada_sha = sha256`, que solo pone la funcion de activacion tras descargar la URL y comparar). Una fila a la que se le cambia url, sha256, v o vc deja de estar activa y pierde la verificacion (trigger `sinpe_actualizaciones_guardia`): hay que verificarla y activarla de nuevo. Una fila nueva nace inactiva y sin verificar.
4. Limites de la tabla: `vc` entre 1 y 10 000 000 (igual que la app; antes 2 000 000 000). Coherencia v<->vc dentro de la empresa, validada por el trigger (no se puede con un CHECK porque compara filas): mayor version implica mayor vc, y la misma version implica el mismo vc.
5. `abrir_ajuste` acepta ademas `que = "instalar_apps"` (abre la pantalla de instalar apps desconocidas de la app: ACTION_MANAGE_UNKNOWN_APP_SOURCES con el paquete). Visor: boton «Abrir instalar apps desconocidas» (vista previa).

## FE DE ERRATAS DEL SERVIDOR (fork H, 26 nov 2026 13:45 CR): LEER PRIMERO, MANDA SOBRE LAS SECCIONES 1, 3 Y 4
La app ya envia en el detalle del latido (desde 2.9/2.11) llaves PLANAS que el servidor ya sanea y usa (fact.sinpe_detalle_limpiar): cargando, ahorro_bateria, sin_restriccion_bateria, red_validada, tipo_red ("wifi"|"datos"|"ninguna"), senal_nivel (0..4), operador, bucket_standby, ultimo_sms_ts, ultimo_reenvio_ok_ts, fallidos_pendientes, permiso_sms, notificaciones, wifi_*, permisos_extra, despertar_id, fcm_token, app, marca_modelo, android. NO inventes objetos anidados para eso: usa esas llaves planas tal cual. (El servidor igualmente acepta la forma anidada de la seccion 1 y la convierte a plana, pero la app debe mandar PLANAS.)
Llaves planas NUEVAS en 2.12 (todas opcionales; el servidor las valida):
- sms_inbox_ultimo_ms: entero >= 0 (fecha del SMS mas nuevo en la bandeja del telefono, 0 si no hay o no hay permiso)
- sms_sin_reenviar: entero 0..999 (autochequeo de la seccion 1; -1 si falta READ_SMS)
- adb_activo: booleano; adb_puerto: entero 0..65535
- actualizacion_estado: "ninguna"|"descargando"|"instalando"|"fallo"; actualizacion_detalle: [a-z0-9_]{1,30}; actualizacion_objetivo: "x.y.z"
Ordenes nuevas "abrir_adb" y "cerrar_adb": el servidor SOLO las crea para telefonos cuyo detalle.app sea >= 2.12.0 (las apps anteriores no conocen la orden). Si la app las recibe pero no tiene WRITE_SECURE_SETTINGS, las confirma igual en comandos_hechos y reporta adb_activo=false.
ACTUALIZACION (seccion 4): el latido NO viene firmado hoy; la respuesta de sinpe-recibir se enviara firmada para este campo asi: dentro de "actualizacion" el servidor agrega "firma" = HMAC-SHA256 hex minusculas, con la clave de la regla de la app (la misma con la que firma el latido), sobre el texto exacto
  "ACT1|<v>|<vc>|<url>|<sha256>|<ts>|<eco>"
donde eco es el ts (ms, como entero) que la app mando en ese latido. La app DEBE verificar esa firma en tiempo constante y que eco sea el ts que ella envio; sin firma valida no instala. La respuesta lleva ademas "eco": <ts del latido>.
abrir_ajuste: parametro "que" EXACTO en {"bateria","app","acceso_notificaciones","accesibilidad","inicio_apps","ahorro_energia","instalar_apps"}; el resultado que la app confirma es "ok:<texto corto [a-z0-9_.]>" o "no_disponible".

Objetivo: mas control sin pagar nada y sin depender de Emil. Todo opcional y retrocompatible con 2.9/2.10/2.11.
Seguridad: cada dato nuevo se valida y sanea en el servidor (lista blanca, tipos, largos); nada nuevo acepta texto libre largo.

## 1. Parte de salud en el latido (detalle, todos opcionales)
- carga: objeto {cargando: bool, enchufe: "ac"|"usb"|"inalambrico"|"ninguno"}
- red: objeto {tipo: "wifi"|"movil"|"ninguna", validada: bool, senal: 0..4 (entero, -1 si no se sabe)}
- ahorro: objeto {ahorro_energia: bool, sin_optimizar: bool (exenta de optimizacion de bateria), bucket: "activo"|"trabajando"|"frecuente"|"raro"|"restringido"|"desconocido"}
- sms: objeto {inbox_ultimo_ms: entero|0, reenviado_ultimo_ms: entero|0, sin_reenviar: entero 0..999}
  - sin_reenviar = cuantos SMS de remitentes que cubren las reglas de reenvio estan en la bandeja del telefono con fecha posterior al ultimo SMS reenviado con exito y de las ultimas 48 h (autochequeo "recibe pero no reenvia", sin mandar ningun SMS y sin costo). Requiere READ_SMS (la app ya lo usa en reenviar_historial; si falta el permiso: sin_reenviar = -1).
- adb: objeto {activo: bool, puerto: entero 0..65535}
- actualizacion: objeto {estado: "ninguna"|"descargando"|"instalando"|"fallo", detalle: codigo corto [a-z0-9_]{1,30}, objetivo: "x.y.z"}
Server: sanear en fact.sinpe_detalle_limpiar (cambios aditivos; respaldar antes con fact.sinpe_respaldo_funciones).

## 2. Alertas del servidor (sistema de alertas existente, siempre llegan por correo segun politica de Emil)
- sms_sin_reenviar: sms.sin_reenviar >= 1 durante 2 latidos seguidos (>= 10 min) -> alerta "el telefono recibe SMS pero la app no los reenvia" (mandar orden reiniciar_servicio y reenviar_historial automaticas una vez por hora como maximo)
- sin_cargador: carga.cargando = false y bateria < 40 durante >= 60 min seguidos
- sin_red: red.tipo = "ninguna" o validada=false en >= 3 latidos seguidos (si llegaron latidos la red existe; esto cubre la intermitencia)
- actualizacion_fallida: actualizacion.estado = "fallo"
Cada alerta con dedupe por dia y cierre automatico cuando se resuelve.

## 3. Ordenes (lista cerrada en la respuesta del latido)
Nuevas: "abrir_adb" y "cerrar_adb" (activar/desactivar depuracion inalambrica con WRITE_SECURE_SETTINGS: Settings.Global.adb_wifi_enabled; solo si hay permiso; se cierra sola a los 30 min; reporta puerto en detalle.adb).
Las existentes siguen: latido_ya, reiniciar_servicio, reenviar_historial, reiniciar_telefono (solo propietario del dispositivo).

## 4. Actualizacion automatica
La respuesta del latido (ya autenticada con HMAC de la regla, igual que las ordenes) puede traer:
  "actualizacion": {"v": "2.12.0", "vc": 22, "url": "https://pagos.dmalabomba.com/instalar/<archivo>.apk", "sha256": "<64 hex>", "ts": <ms>}
Reglas obligatorias en la app (todas, o no instala): respuesta autenticada; host exacto pagos.dmalabomba.com y https; vc mayor que el instalado; sha256 del archivo descargado coincide; el certificado de firma del APK es IDENTICO al de la app instalada (PackageManager signing info + apksig/PackageInfo del archivo); ts reciente (<= 24 h); no mas de 3 intentos por version con espera creciente (1 h, 6 h, 24 h); no instalar si hay cola de reenvio pendiente en curso o un SMS recibido hace < 60 s (esperar); instalar con PackageInstaller (USER_ACTION_NOT_REQUIRED en API 31+ cuando se pueda; si Android pide confirmacion, y el servicio de accesibilidad esta activo, pulsar el boton de instalar/actualizar del dialogo del instalador del sistema, limitado a ese paquete de instalador y a esos textos); tras instalar, la app nueva arranca sola (receptor de MY_PACKAGE_REPLACED) y reporta actualizacion.estado = "ninguna" con la version.
Server: tabla fact.sinpe_actualizaciones (empresa, telefono opcional, v, vc, url, sha256, activa, creado_en) con RLS y solo service_role; la respuesta del latido incluye la actualizacion SOLO si la version del latido (detalle.app o campo existente) es menor que vc y la fila esta activa; el servidor NO publica nada solo: Emil/Claude activan la fila a mano. Verificar sha256 de la URL al activar.

## 5. Acciones de pantalla remota nuevas (lista cerrada, app + RPC + visor + PROTOCOLO.md)
- "abrir_ajuste" con parametro "que" en {"bateria", "app", "acceso_notificaciones", "accesibilidad", "inicio_apps", "ahorro_energia", "instalar_apps"}: abre esa pantalla de ajustes del sistema por intent (ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS, ACTION_APPLICATION_DETAILS_SETTINGS, ACTION_NOTIFICATION_LISTENER_SETTINGS, ACTION_ACCESSIBILITY_SETTINGS, y para "inicio_apps" una lista de actividades candidatas de HONOR/Huawei (com.hihonor.systemmanager, com.huawei.systemmanager StartupNormalAppListActivity y similares) con fallback a ACTION_APPLICATION_DETAILS_SETTINGS), y confirma con resultado "ok:<intent usado>" o "no_disponible".
- Misma regla de siempre: acciones atadas al cuadro (cuadro_seq), firmadas, lista cerrada, expiran a los 15 s.
- El visor /remoto agrega botones con texto claro: "Abrir bateria", "Abrir inicio de aplicaciones", "Abrir acceso a notificaciones", "Abrir accesibilidad", "Abrir ajustes de la app", "Abrir ahorro de energia", "Abrir instalar apps desconocidas".

## 6. Version
versionName 2.12.0, versionCode 22, rama prueba-guardian-27 (siguen commits encima de 2.11.0 = eb404a2).
