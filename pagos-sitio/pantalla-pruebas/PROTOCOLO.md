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
