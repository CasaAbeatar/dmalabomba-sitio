# Pantalla remota La Bomba (app 2.10.0) - protocolo teléfono <-> servidor

Objetivo: Emil ve y controla el teléfono de la Soda desde una página web propia. Sin software de terceros.
La app usa un AccessibilityService (captura con takeScreenshot API 30+, gestos con dispatchGesture API 24+).

## Seguridad (obligatorio)
- Toda petición del teléfono va firmada: X-Signature = HMAC-SHA256 hex del cuerpo exacto, clave = la de la regla (vault sinpe_hmac_secreto, rpc sinpe_secreto), igual que /latido.
- ts dentro del cuerpo, |ahora-ts| <= 300 s, si no 409.
- LA RESPUESTA TAMBIEN VA FIRMADA (cabecera X-Signature = HMAC del cuerpo de la respuesta). El teléfono NO ejecuta ninguna acción si la firma de la respuesta no coincide (aquí no basta con https).
- Sesión con vencimiento: máx 10 min, prorrogable desde el visor. Máx 1 sesión activa por empresa. Sin sesión el teléfono no manda nada de pantalla.
- Solo administrador general (es_admin_general) puede abrir sesión y mandar acciones desde el visor.
- Se guarda un solo cuadro por empresa (se sobrescribe) y se borra al cerrar la sesión o a los 2 min sin uso. Nunca historial de imágenes.
- Bitácora: cada sesión (quién, cuándo abrió/cerró, cuántas acciones) y cada acción (tipo, hora, sin el texto tecleado: solo longitud) en tablas fact.sinpe_pantalla_*.
- Lista CERRADA de acciones. Cualquier otra se ignora.

## Endpoint
POST {base}/pantalla donde base = URL de la regla de reenvío sin su ruta (pagos.dmalabomba.com). El worker de Cloudflare Pages enruta /pantalla a la edge function nueva `sinpe-pantalla` (NO se toca sinpe-recibir). Cuerpo máx 256 KB.

## Fases (campo "fase" en el cuerpo JSON firmado)
1. escucha (cada 60 s, sin sesión): {"tipo":"pantalla","fase":"escucha","ts":ms,"empresa":"soda","app":"2.10.0","pantalla_encendida":true,"bloqueada":false}
   respuesta: {"ok":true,"sesion":false}  o  {"ok":true,"sesion":true,"sid":"uuid","resta_s":540,"acciones":[]}
2. cuadro (en sesión, ~1 por segundo): {"tipo":"pantalla","fase":"cuadro","ts":ms,"empresa":"soda","sid":"uuid","seq":n,"w":540,"h":1170,"jpg":"<base64 JPEG>","sin_cambio":false,"pantalla_encendida":true,"bloqueada":false,"confirmadas":[ids de acciones ejecutadas],"resultados":{"id":"ok|fallo|no_soportado"}}
   - Si la imagen es igual a la anterior: sin_cambio:true y sin jpg (solo sirve para recoger acciones).
   - respuesta: {"ok":true,"sesion":true,"resta_s":n,"acciones":[{"id":n,"a":"toque","x":0.5,"y":0.3}, ...]}  (máx 5 por respuesta) o {"ok":true,"sesion":false} => el teléfono sale del modo rápido.
3. fin (opcional, el teléfono avisa que cierra): fase "fin" con sid.

## Acciones (coordenadas normalizadas 0..1 sobre el cuadro enviado)
- toque {x,y}; largo {x,y,ms<=1500}; deslizar {x1,y1,x2,y2,ms 100..1500}
- atras, inicio, recientes, notificaciones (acciones globales)
- texto {t} (<=200 caracteres): escribe en el campo con foco (ACTION_SET_TEXT) ; borrar {n}
- encender: despierta la pantalla (wake lock con ACQUIRE_CAUSES_WAKEUP)
- cada id se ejecuta una sola vez; el teléfono confirma en el cuadro siguiente

## Visor web
Página en pagos.dmalabomba.com/remoto (o donde Fork B decida si hay mejor sitio con autenticación de administrador). Abre sesión, muestra el último cuadro (~1 s), clic = toque, arrastre = deslizar, botones Atrás / Inicio / Recientes / Notificaciones / Encender, campo de texto, cuenta regresiva, botón Terminar. Mostrar si el teléfono no ha respondido (esperando hasta 60 s al arrancar porque escucha cada 60 s).
Diseño: estilo de Emil (fino, crema, sin negro, Helvetica Neue, controles que dicen en palabras lo que hacen).

## Adiciones fork B (servidor, 25 nov 2026)
- Toda respuesta con firma valida lleva `X-Signature` (HMAC-SHA256 hex del cuerpo de la respuesta, mismo secreto) y los campos `eco` (= ts de la peticion) y `ts` (ms del servidor). El telefono DEBE verificar la firma Y que eco == su ts antes de ejecutar cualquier accion.
- Una accion entregada y no confirmada se reentrega a los 6 s (maximo 3 entregas; luego resultado `sin_respuesta`). El telefono ejecuta cada `id` UNA sola vez (dedupe por id) y lo confirma en `confirmadas`/`resultados` de la siguiente peticion.
- `sin_cambio:true` en fase cuadro: el servidor solo refresca la hora del cuadro y devuelve acciones pendientes (no se manda jpg).
- Rutas del worker: `/pantalla` (telefono, firmado), `/remoto/api` (visor, mismo origen), `/remoto/` (pagina). El visor acepta `?empresa=pollos` (por defecto soda).
- Cuadro sin actividad 2 min se borra (sesion sigue abierta hasta vencer); al cerrar o vencer se borra el cuadro, se cancelan pendientes y el texto escrito queda en bitacora solo como {"largo":n}.

## Correcciones de la auditoría (fork E, servidor, 25 nov 2026) - versión de protocolo con cuadro_seq
Valen para la app 2.11.0 en adelante; la 2.10.0 sigue funcionando (ver «Compatibilidad»).

### Clave por empresa
- Cada teléfono firma con la clave de SU empresa: Soda con la maestra (vault `sinpe_hmac_secreto`), Pollos con `sinpe_hmac_secreto_pollos`. Servidor: `public.sinpe_secreto_empresa(empresa)` devuelve la de la empresa si existe y, si no, la maestra.
- `sinpe-pantalla` y `sinpe-recibir` verifican la firma con la clave de la empresa declarada en el cuerpo (en recibir, sin empresa = Soda, como sinpe-correo). Si la firma es válida pero es la clave de otra empresa: 401, nunca se procesa. La respuesta se firma con la clave de la empresa del cuerpo.
- `sinpe-despertar` no recibe nada del teléfono (lo llama la base con x-cron-secreto): no usa esta clave.
- Aún no hay teléfono de Pollos: su clave está en la bóveda (`boveda_leer('sinpe_hmac_secreto_pollos', motivo)`) para ponerla en su app el día que se instale.

### Anti repetición (el teléfono NO debe reenviar nunca un cuerpo ya enviado)
- `ts` (ms) estrictamente mayor que el último aceptado de esa empresa (tabla `fact.sinpe_pantalla_reloj`, rpc `sinpe_pantalla_reloj`). Si no: **409 `{"ok":false,"error":"repetida"}`** (firmado). Regla para el teléfono: tomar `ts = max(reloj, último_ts_enviado + 1)` y no enviar peticiones de pantalla en paralelo (el servidor las atiende en orden de llegada: una con ts menor que otra ya aceptada se rechaza).
- `seq` del cuadro: si `seq <= último seq guardado` y `seq > 3` → **409 `{"ok":false,"error":"seq repetido"}`** y no se entrega ninguna acción (no se gastan entregas). El `seq` de 0 a 3 se admite siempre (reinicio de la app). `seq` crece en CADA cuadro enviado, también con `sin_cambio`.

### cuadro_seq en las acciones (descartar órdenes dadas sobre una imagen vieja)
- El visor manda en `accion` el campo `cuadro_seq` = `seq` de la última IMAGEN (con jpg) que mostró. El servidor lo guarda (`fact.sinpe_pantalla_entrada.cuadro_seq`) y lo entrega en cada acción: `{"id":n,"a":"toque","x":0.5,"y":0.3,"cuadro_seq":42}`.
- Qué es el `seq` guardado: solo cambia con cuadros que traen jpg (los `sin_cambio` no lo cambian). Por eso `cuadro_seq` = seq de la última imagen, no del último cuadro.
- El servidor rechaza la orden (`"cuadro invalido"` o `"sin imagen todavia"`) si falta imagen o `cuadro_seq` es mayor que el guardado. NO decide si está vieja: eso lo decide el teléfono.
- **El teléfono**: antes de ejecutar compara `cuadro_seq` con el seq de la última IMAGEN (con jpg) que él envió. Si es distinto, no ejecuta y confirma `resultados[id]="obsoleta"`. Gracia de la imagen anterior: si la imagen actual se envió hace menos de 2 s y `cuadro_seq` es el de la imagen inmediatamente anterior, se ejecuta (el administrador aún estaba viendo esa).
- Acciones sin `cuadro_seq` (visor viejo/2.10.0) y `encender` (no depende de la imagen) se aceptan sin comparar.
- Una acción que no llegó al teléfono en 15 s deja de entregarse y queda `resultado:"vencida"` en el visor; no se ejecuta tarde.

### Sesión de 15 minutos
- Abre con 10 min; `prorrogar` suma hasta 10 min más pero nunca pasa de **15 minutos desde que se abrió** (respuesta `tope_15min:true`). La ficha del visor dura 15 min. El visor avisa al llegar al tope y al vencer su ingreso.
- Cada sesión se cierra sola al vencer (el cuadro se borra; el texto escrito queda solo como `{"largo":n}`).

### Texto
- `texto {t}`: **hasta 200 unidades UTF-16** (lo que cuenta `String.length` de Java/Kotlin y `maxlength` de HTML; un emoji suelto vale 2). Se permite el salto de línea `\n` (y se guarda y entrega tal cual). Se eliminan los demás caracteres de control (`\u0000-\u0008`, `\u000b-\u001f`, `\u007f`). 1 a 200 o `"texto de 1 a 200 caracteres"`. Al confirmarse, la bitácora guarda solo `{"largo":n}`.

### Visor
- `/remoto/api` solo acepta llamadas del worker: el worker manda la cabecera secreta `x-visor-worker`; la función `sinpe-pantalla-visor` responde 403 sin ella. El worker además rechaza `Origin` distinto de pagos.dmalabomba.com y de la vista previa de la rama.
- Bloqueo de ingreso: 8 fallos por usuario (o 20 por IP) en 15 min → bloqueo de 30 min con respuesta genérica 429 y alerta `sinpe_visor_bloqueo`. El botón **Terminar sesión** (siempre visible arriba) cierra la sesión en el servidor y borra la ficha del navegador: para volver hay que escribir usuario y PIN.

### Compatibilidad con la 2.10.0
- Sigue valiendo todo lo anterior. Diferencias que sí notará: ts repetido/anterior → 409 `repetida`; `seq` repetido (>3) → 409 `seq repetido`; Pollos con la clave maestra → 401.
- Hasta que la app implemente `cuadro_seq`, las acciones con `cuadro_seq` las ejecuta como antes (ignora el campo).

### Lo que le toca a la app (no es del servidor)
- Solo https (rechazar http://). Respetar el apagado manual. Notificación persistente mientras la accesibilidad esté activa. Sin acciones «a ciegas» al arrancar la sesión (esperar la primera imagen).
