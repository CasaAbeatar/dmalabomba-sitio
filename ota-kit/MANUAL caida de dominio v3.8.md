# Manual: que pasa y que hacer si se cae el dominio (kit v3.8, 27 nov 2026)

## 1. Actualizaciones en el aire (20 actualizador.ps1, version 2)
- Orden de busqueda: `https://www.dmalabomba.com`, luego `https://dma-sitio.pages.dev` (mismo sitio en Cloudflare Pages). Ambos deben servir los MISMOS archivos en `/kit-caja/ota/` (manifiesto.json, manifiesto.json.firma, paquetes/kit-N.zip): **al publicar un lanzamiento hay que desplegarlo en los dos**.
- Verificacion identica en cualquier origen: firma RSA-3072 con la llave de produccion (la que ya trae el kit), caducidad, serie mayor, anillo por estacion, SHA-256 y tamano del paquete, nombres/extensiones, sintaxis.
- Se usa el manifiesto valido MAS RECIENTE. Si un origen no responde, devuelve una pagina web, tiene firma invalida o esta vencido, se descarta y se sigue con el otro **en la misma corrida** (ventana 03:00-05:00 hora de Costa Rica, cada 30 min; reversion automatica intacta).
- Caida total de los dos: no cuenta como fallo, no avisa, se reintenta a la media hora. Algo manipulado (firma invalida o paquete que no coincide): evento "otro" para Emil aunque se instale desde el otro origen.
- Para agregar un tercer origen (espejo GitLab Pages, aun NO confirmado) se edita `$Origenes` en una version nueva del kit.
- **Limite:** las cajas con la v3.7 instalada tienen el actualizador viejo (solo www): la primera actualizacion a v3.8 depende del dominio. Desde la v3.8 ya hay dos origenes. Las cajas con v3.6 o anterior se instalan a mano (INSTALAR TODO.bat).

## 2. Facturador no alcanzable (funciones contingencia.ps1)
El kit sondea `https://facturacion.dmalabomba.com` (DNS + GET + que el `<title>` diga "Facturaci...") al abrir la caja, cuando falta su ventana y cada 5 min. Resultados:
| Situacion | Que abre el kit |
|---|---|
| Responde | El facturador de siempre |
| No responde, el perfil ya guarda la copia (service worker) | El mismo facturador: el navegador sirve la copia y Supabase sigue funcionando (verificado con Chrome real) |
| No responde y no hay copia | `http://127.0.0.1:8766/contingencia/` (pantalla local: letra grande, reintenta cada 8 s, vuelve sola al facturador) |
- Nunca toca una ventana de caja ya abierta; sin facturador no abre la pantalla del cliente.
- Aviso al panel: uno por caida (tras 2 sondeos fallidos) indicando si Supabase si resuelve (falla del dominio) o no (internet de la tienda), y uno al restablecerse.
- Apagar: `$ContingenciaFacturador = $false` en config.ps1.

## 3. Por que NO se cambia de dominio para abrir el facturador
`dma-facturador.pages.dev` es otro origen para el navegador: se pierden la sesion de la cajera, el aparato (`fx_ap`) y los datos locales, y las funciones de Supabase (`facturador-acceso`) solo aceptan peticiones desde el origen exacto `facturacion.dmalabomba.com` (CORS). Por eso la contingencia es la copia guardada o la pantalla local.

## 4. Procedimiento sugerido mientras no haya facturador (Emil debe confirmarlo)
Anotar cada venta en papel (hora, producto, monto, forma de pago); no se pueden emitir facturas electronicas; digitar cuando vuelva; avisar a Emil pasados 30 min.

## 5. Si el dominio cae: lista rapida
1. Mirar el panel: evento "Facturador no alcanzable ... Otras direcciones (supabase): si resuelven" = falla del dominio/DNS.
2. Comprobar `www.dmalabomba.com` y `dma-sitio.pages.dev`; no se publica nada nuevo sin revisar que el manifiesto este en los dos.
3. El dominio/DNS lo restaura el responsable del dominio (Microsoft 365 / registrador); el kit no lo toca.
