# 7. Contratos de la API

Qué recibe y qué devuelve cada endpoint, con ejemplos listos para copiar y pegar. Las respuestas que aparecen aquí
son **respuestas reales** de la API (cambian el `id`, el `request_id` y las fechas).

El sistema tiene que estar levantado: `docker compose up -d --build` (ver [Instalación](01-instalacion.md)).

## Validar todos los contratos de una vez

Dos scripts prueban los 32 contratos de esta guía y marcan cada uno como cumplido o no:

```powershell
# PowerShell (Windows)
powershell -ExecutionPolicy Bypass -File .\scripts\contratos.ps1
```

```bash
# Git Bash, Linux o macOS
./scripts/contratos.sh
```

Resultado esperado (resumido):

```text
== POST /orders: crear
  OK     201 pedido válido (RUT con puntos, 2 productos)                201
  OK     200 misma Idempotency-Key devuelve el mismo pedido             200
== POST /orders: datos inválidos (no se crea nada)
  OK     400 RUT con dígito verificador incorrecto                      400
  ...
== PATCH /orders/{id}/status: el recorrido completo
  OK     409 salto no permitido: listo_para_despacho -> entregado       409
  OK     200 listo_para_despacho -> en_transito                         200
  ...
Resultado: 32 cumplen, 0 no cumplen. Pedido de prueba: 9a8e0d85-...
```

Si algo no se cumple, el script muestra qué esperaba, qué llegó y el cuerpo de la respuesta, y termina con código
`1`. También existe la [colección de Postman](05-postman.md) con pruebas para cada endpoint.

## Índice

| Método | Ruta | Para qué | Respuestas |
|---|---|---|---|
| `POST` | [`/orders`](#post-orders--crear-un-pedido) | Crear un pedido | `201`, `200` (clave repetida), `400`, `413` |
| `GET` | [`/orders/{id}`](#get-ordersid--consultar-un-pedido) | Consultar un pedido y su estado | `200`, `400`, `404` |
| `PATCH` | [`/orders/{id}/status`](#patch-ordersidstatus--cambiar-el-estado) | Cambiar el estado (reparto) | `200`, `400`, `404`, `409` |
| `GET` | [`/health`, `/ready`, `/metrics`](#operación-health-ready-y-metrics) | Salud de la API y del worker | `200`, `503` |
| — | [Evento `order.created`](#evento-ordercreated-rabbitmq) | Mensaje que la API publica en RabbitMQ | — |

API: `http://localhost:3200` · Worker: `http://localhost:3201` (solo salud y métricas).

---

## Reglas comunes

| Tema | Regla |
|---|---|
| Formato | JSON. Las peticiones con cuerpo llevan `Content-Type: application/json` |
| Montos | Pesos chilenos **enteros** (CLP no usa decimales): `8990` = $8.990. Las respuestas traen `"currency": "CLP"` |
| Cliente | `customer_id` es el **RUT**. Se acepta `12.345.678-5` o `12345678-5` y se devuelve sin puntos |
| Ids | UUID, por ejemplo `a41f2dd2-b643-442b-89c0-d399ebf53c29` |
| Fechas | RFC 3339 en UTC: `2026-11-17T14:30:50.61318Z` |
| Seguimiento | Cada respuesta trae la cabecera `X-Request-Id`. Si la petición envía su propio `X-Request-ID` (hasta 64 caracteres: letras, números, `.`, `_`, `-`), se devuelve el mismo. Con ese valor se encuentra la petición en los logs |

### Formato de los errores

Todos los errores tienen la misma forma y nunca muestran SQL, contraseñas ni detalles internos:

```json
{
  "error": {
    "type": "VALIDATION_ERROR",
    "code": "ORDER_INVALID_CUSTOMER",
    "message": "customer_id must be a valid Chilean RUT, for example 12345678-5"
  },
  "request_id": "6bc05c42-3ba6-4e24-8a4d-ed60e2cd1705",
  "timestamp": "2026-11-17T14:30:50Z"
}
```

| HTTP | `error.type` | `error.code` | Cuándo |
|---|---|---|---|
| `400` | `VALIDATION_ERROR` | `ORDER_INVALID_CUSTOMER` | RUT inválido (dígito verificador incorrecto o mal escrito) |
| `400` | `VALIDATION_ERROR` | `ORDER_EMPTY_ITEMS` | `items` vacío |
| `400` | `VALIDATION_ERROR` | `ORDER_TOO_MANY_ITEMS` | Más de 100 artículos |
| `400` | `VALIDATION_ERROR` | `ORDER_INVALID_SKU` | Un artículo sin `sku` |
| `400` | `VALIDATION_ERROR` | `ORDER_INVALID_QUANTITY` | `quantity` fuera de 1 a 10.000 |
| `400` | `VALIDATION_ERROR` | `ORDER_INVALID_PRICE` | `unit_price` fuera de 1 a 100.000.000 |
| `400` | `VALIDATION_ERROR` | `INVALID_JSON` | JSON mal formado o con campos que no existen |
| `400` | `VALIDATION_ERROR` | `IDEMPOTENCY_KEY_INVALID` | `Idempotency-Key` de más de 128 caracteres |
| `400` | `VALIDATION_ERROR` | `ORDER_INVALID_ID` | El id de la ruta no es un UUID |
| `400` | `VALIDATION_ERROR` | `ORDER_INVALID_STATUS` | El estado pedido no existe |
| `404` | `NOT_FOUND` | `ORDER_NOT_FOUND` | No hay pedido con ese id |
| `404` | `NOT_FOUND` | `ROUTE_NOT_FOUND` | La ruta no existe |
| `409` | `CONFLICT` | `ORDER_INVALID_TRANSITION` | El cambio de estado no está permitido |
| `413` | `PAYLOAD_TOO_LARGE` | `PAYLOAD_TOO_LARGE` | Cuerpo de más de 64 KB |
| `503` | `SERVICE_UNAVAILABLE` | `TIMEOUT` | La petición tardó más de `REQUEST_TIMEOUT` (5 s) |
| `500` | `INTERNAL_ERROR` | `INTERNAL_ERROR` | Error inesperado (por ejemplo, la base de datos no responde). El detalle queda solo en el log |

**Ver el cuerpo de un error en PowerShell:** `Invoke-RestMethod` lanza una excepción con las respuestas 4xx y 5xx.
El cuerpo se lee así:

```powershell
try { Invoke-RestMethod http://localhost:3200/orders/abc }
catch { [int]$_.Exception.Response.StatusCode; $_.ErrorDetails.Message }
# 400
# {"error":{"type":"VALIDATION_ERROR","code":"ORDER_INVALID_ID","message":"order id must be a valid UUID"},...}
```

### El pedido (respuesta de `POST`, `GET` y `PATCH`)

| Campo | Tipo | Descripción |
|---|---|---|
| `id` | UUID | Número del pedido |
| `customer_id` | texto | RUT del cliente, sin puntos (`12345678-5`) |
| `status` | texto | Uno de los 6 estados: `en_preparacion`, `listo_para_despacho`, `en_transito`, `entregado`, `no_entregado`, `devuelto` |
| `next_statuses` | lista | Estados a los que se puede pasar desde el actual (vacía si es final) |
| `total` | entero | Suma de los subtotales, en CLP |
| `currency` | texto | Siempre `"CLP"` |
| `items[].sku` | texto | Código del producto |
| `items[].quantity` | entero | Cantidad (1 a 10.000) |
| `items[].unit_price` | entero | Precio unitario en CLP (1 a 100.000.000) |
| `items[].subtotal` | entero | `quantity × unit_price` |
| `created_at`, `updated_at` | fecha | Creación y último cambio |

---

## `POST /orders` — crear un pedido

**Cabeceras:** `Content-Type: application/json` (obligatoria) · `Idempotency-Key` (opcional, máximo 128 caracteres;
con la misma clave, repetir el POST no crea otro pedido).

**Cuerpo:**

| Campo | Tipo | Obligatorio | Regla |
|---|---|---|---|
| `customer_id` | texto | sí | RUT chileno válido, con o sin puntos |
| `items` | lista | sí | Entre 1 y 100 artículos |
| `items[].sku` | texto | sí | No vacío |
| `items[].quantity` | entero | sí | 1 a 10.000 |
| `items[].unit_price` | entero | sí | 1 a 100.000.000 (CLP) |

No se aceptan otros campos: un campo desconocido responde `400 INVALID_JSON`.

**Ejemplo (Git Bash):**

```bash
curl -s -i -X POST localhost:3200/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: pedido-001' \
  -d '{"customer_id":"12.345.678-5","items":[{"sku":"GO-TAZA","quantity":2,"unit_price":8990},{"sku":"GO-STICKERS","quantity":1,"unit_price":2990}]}'
```

**Ejemplo (PowerShell):**

```powershell
$body = '{"customer_id":"12.345.678-5","items":[{"sku":"GO-TAZA","quantity":2,"unit_price":8990},{"sku":"GO-STICKERS","quantity":1,"unit_price":2990}]}'
$pedido = Invoke-RestMethod -Method Post -Uri http://localhost:3200/orders -ContentType "application/json" `
  -Headers @{ "Idempotency-Key" = "pedido-001" } -Body $body
$pedido            # el pedido creado
$pedido.id         # guárdelo para los siguientes ejemplos
```

**Respuesta `201 Created`:**

```http
HTTP/1.1 201 Created
Content-Type: application/json; charset=utf-8
X-Request-Id: df40758b-4c96-4fd7-acbd-625c7f016ba1
```

```json
{
  "id": "a41f2dd2-b643-442b-89c0-d399ebf53c29",
  "customer_id": "12345678-5",
  "status": "en_preparacion",
  "next_statuses": ["listo_para_despacho"],
  "total": 20970,
  "currency": "CLP",
  "items": [
    { "sku": "GO-TAZA", "quantity": 2, "unit_price": 8990, "subtotal": 17980 },
    { "sku": "GO-STICKERS", "quantity": 1, "unit_price": 2990, "subtotal": 2990 }
  ],
  "created_at": "2026-11-17T14:30:50.61318Z",
  "updated_at": "2026-11-17T14:30:50.61318Z"
}
```

Qué comprobar: el RUT vuelve **sin puntos**, el total es `2 × 8990 + 2990 = 20970` y el estado inicial es
`en_preparacion`. Menos de un segundo después, el worker lo deja en `listo_para_despacho` (ver `GET`).

**Repetir con la misma `Idempotency-Key` → `200 OK`** con **el mismo `id`** (no se crea otro pedido). El estado puede
venir ya avanzado, porque es el pedido guardado:

```http
HTTP/1.1 200 OK
```

```json
{ "id": "a41f2dd2-b643-442b-89c0-d399ebf53c29", "status": "listo_para_despacho", "next_statuses": ["en_transito"], "...": "..." }
```

**Errores** (no se crea ningún pedido). Cada fila se puede copiar tal cual:

| Caso | Cuerpo enviado | Respuesta |
|---|---|---|
| RUT inválido | `{"customer_id":"12345678-9","items":[{"sku":"GO-TAZA","quantity":1,"unit_price":8990}]}` | `400 ORDER_INVALID_CUSTOMER` |
| Sin productos | `{"customer_id":"12345678-5","items":[]}` | `400 ORDER_EMPTY_ITEMS` |
| Cantidad 0 | `{"customer_id":"12345678-5","items":[{"sku":"GO-TAZA","quantity":0,"unit_price":8990}]}` | `400 ORDER_INVALID_QUANTITY` |
| Precio negativo | `{"customer_id":"12345678-5","items":[{"sku":"GO-TAZA","quantity":1,"unit_price":-5}]}` | `400 ORDER_INVALID_PRICE` |
| SKU vacío | `{"customer_id":"12345678-5","items":[{"sku":"","quantity":1,"unit_price":8990}]}` | `400 ORDER_INVALID_SKU` |
| JSON roto | `{"customer_id": ` | `400 INVALID_JSON` |
| Campo extra | `{"customer_id":"12345678-5","items":[{"sku":"A","quantity":1,"unit_price":1}],"descuento":10}` | `400 INVALID_JSON` |
| Clave larga | cuerpo válido + `Idempotency-Key` de 129 caracteres | `400 IDEMPOTENCY_KEY_INVALID` |
| Cuerpo enorme | más de 64 KB | `413 PAYLOAD_TOO_LARGE` |

Mensajes exactos de `error.message`:

```text
ORDER_INVALID_CUSTOMER   customer_id must be a valid Chilean RUT, for example 12345678-5
ORDER_EMPTY_ITEMS        items must contain at least one item
ORDER_INVALID_QUANTITY   items[0].quantity must be between 1 and 10000
ORDER_INVALID_PRICE      items[0].unit_price must be between 1 and 100000000
ORDER_INVALID_SKU        items[0].sku is required
INVALID_JSON             request body must be a valid JSON order
IDEMPOTENCY_KEY_INVALID  Idempotency-Key must be at most 128 characters
PAYLOAD_TOO_LARGE        request body must not exceed 65536 bytes
```

Ejemplo de error en Git Bash:

```bash
curl -s -X POST localhost:3200/orders -H 'Content-Type: application/json' \
  -d '{"customer_id":"12345678-9","items":[{"sku":"GO-TAZA","quantity":1,"unit_price":8990}]}'
```

En PowerShell:

```powershell
try {
  Invoke-RestMethod -Method Post -Uri http://localhost:3200/orders -ContentType "application/json" `
    -Body '{"customer_id":"12345678-9","items":[{"sku":"GO-TAZA","quantity":1,"unit_price":8990}]}'
} catch { [int]$_.Exception.Response.StatusCode; $_.ErrorDetails.Message }
```

---

## `GET /orders/{id}` — consultar un pedido

**Ejemplo:**

```bash
curl -s localhost:3200/orders/a41f2dd2-b643-442b-89c0-d399ebf53c29
```

```powershell
Invoke-RestMethod http://localhost:3200/orders/$($pedido.id)
```

**Respuesta `200 OK`** (un segundo después de crearlo, el worker ya lo procesó):

```json
{
  "id": "a41f2dd2-b643-442b-89c0-d399ebf53c29",
  "customer_id": "12345678-5",
  "status": "listo_para_despacho",
  "next_statuses": ["en_transito"],
  "total": 20970,
  "currency": "CLP",
  "items": [
    { "sku": "GO-TAZA", "quantity": 2, "unit_price": 8990, "subtotal": 17980 },
    { "sku": "GO-STICKERS", "quantity": 1, "unit_price": 2990, "subtotal": 2990 }
  ],
  "created_at": "2026-11-17T14:30:50.61318Z",
  "updated_at": "2026-11-17T14:30:50.621575Z"
}
```

**Errores:**

| Caso | Petición | Respuesta |
|---|---|---|
| No existe | `GET /orders/00000000-0000-4000-8000-000000000000` | `404 ORDER_NOT_FOUND` · `order not found` |
| Id inválido | `GET /orders/abc` | `400 ORDER_INVALID_ID` · `order id must be a valid UUID` |

---

## `PATCH /orders/{id}/status` — cambiar el estado

**Cuerpo:** `{"status": "<nuevo estado>"}`. Solo se permiten estos cambios:

| Estado actual | Puede pasar a |
|---|---|
| `en_preparacion` | `listo_para_despacho` (lo hace el worker solo) |
| `listo_para_despacho` | `en_transito` |
| `en_transito` | `entregado`, `no_entregado` |
| `no_entregado` | `en_transito` (reintento de entrega), `devuelto` |
| `entregado` | `devuelto` |
| `devuelto` | — (estado final) |

**Ejemplo:**

```bash
curl -s -X PATCH localhost:3200/orders/a41f2dd2-b643-442b-89c0-d399ebf53c29/status \
  -H 'Content-Type: application/json' -d '{"status":"en_transito"}'
```

```powershell
Invoke-RestMethod -Method Patch -Uri http://localhost:3200/orders/$($pedido.id)/status `
  -ContentType "application/json" -Body '{"status":"en_transito"}'
```

**Respuesta `200 OK`:** el pedido completo con el estado nuevo y los siguientes posibles:

```json
{
  "id": "a41f2dd2-b643-442b-89c0-d399ebf53c29",
  "status": "en_transito",
  "next_statuses": ["entregado", "no_entregado"],
  "updated_at": "2026-11-17T14:30:53.751898Z",
  "...": "(los demás campos, igual que en GET)"
}
```

**Recorrido completo para probar** (en este orden, sobre un pedido `listo_para_despacho`):

| # | `{"status": ...}` | Respuesta | `next_statuses` en la respuesta |
|---|---|---|---|
| 1 | `"entregado"` | `409 ORDER_INVALID_TRANSITION` (no se puede saltar el reparto) | — |
| 2 | `"en_transito"` | `200` | `["entregado","no_entregado"]` |
| 3 | `"no_entregado"` | `200` | `["en_transito","devuelto"]` |
| 4 | `"en_transito"` | `200` (reintento de entrega) | `["entregado","no_entregado"]` |
| 5 | `"entregado"` | `200` | `["devuelto"]` |
| 6 | `"devuelto"` | `200` | `[]` (estado final) |
| 7 | `"en_transito"` | `409 ORDER_INVALID_TRANSITION` | — |
| 8 | `"perdido"` | `400 ORDER_INVALID_STATUS` | — |

**Errores:**

| Caso | Respuesta | `error.message` |
|---|---|---|
| Cambio no permitido | `409 ORDER_INVALID_TRANSITION` | `order cannot change from en_transito to listo_para_despacho` |
| Estado que no existe, o cuerpo sin `status` | `400 ORDER_INVALID_STATUS` | `status must be one of: en_preparacion, listo_para_despacho, en_transito, entregado, no_entregado, devuelto` |
| Pedido que no existe | `404 ORDER_NOT_FOUND` | `order not found` |
| Id inválido | `400 ORDER_INVALID_ID` | `order id must be a valid UUID` |

Un cambio rechazado (`409` o `400`) no modifica el pedido.

---

## Operación: health, ready y metrics

| Petición | Respuesta |
|---|---|
| `GET localhost:3200/health` | `200` `{"status":"up"}` — el proceso está vivo |
| `GET localhost:3200/ready` | `200` `{"database":"up","status":"up"}` — puede atender pedidos. Si la base de datos no responde: `503` `{"database":"down","status":"down"}` |
| `GET localhost:3200/metrics` | `200` con contadores (ver abajo) |
| `GET localhost:3201/health` | `200` `{"status":"up"}` — el worker está vivo |
| `GET localhost:3201/ready` | `200` `{"database":"up","status":"up"}` (o `503`, igual que la API) |
| `GET localhost:3201/metrics` | `200` con contadores del worker |
| `GET localhost:3200/esta-ruta-no-existe` | `404 ROUTE_NOT_FOUND` |

Ejemplo real de `/metrics`. Cada contador aparece la primera vez que sube, así que en un sistema recién levantado
puede faltar alguno:

```jsonc
// API (localhost:3200/metrics)
{ "events_published_total": 2, "http_requests_total": 32, "orders_created_total": 2, "orders_idempotent_replays_total": 2 }
// Worker (localhost:3201/metrics)
{ "messages_processed_total": 4, "messages_retried_total": 1 }
```

| Contador | Sube cuando |
|---|---|
| `orders_created_total` | Se crea un pedido nuevo |
| `orders_idempotent_replays_total` | Se repite un POST con una clave ya usada |
| `events_published_total` / `events_publish_failed_total` | RabbitMQ confirma (o no) el evento `order.created` |
| `http_requests_total` | Llega cualquier petición HTTP a la API |
| `messages_processed_total` | El worker termina un mensaje y hace ACK (cada pedido suma 2: pedidos y notificaciones) |
| `messages_retried_total` | Un mensaje falla y se reintenta |
| `messages_dead_lettered_total` | Un mensaje agota los reintentos y va a la cola `.dlq` |
| `messages_duplicated_total` | Llega un mensaje repetido y se ignora sin repetir el efecto |

Seguimiento con `X-Request-ID`:

```bash
curl -s -i localhost:3200/health -H 'X-Request-ID: mi-prueba-001' | grep -i x-request-id
# X-Request-Id: mi-prueba-001
docker compose logs api worker | grep mi-prueba-001
```

---

## Evento `order.created` (RabbitMQ)

No es un endpoint HTTP: es el mensaje que la API publica al crear un pedido (RF-09) y que consume el worker. Se puede
ver en la consola de RabbitMQ (<http://localhost:15672>, `guest` / `guest`).

| Propiedad | Valor |
|---|---|
| Exchange | `eventflow.events` (tipo `topic`) |
| Clave de enrutamiento | `order.created` |
| Colas que lo reciben | `orders.processing` (worker de pedidos) y `notifications.send` (worker de notificaciones) |
| Colas de mensajes muertos | `orders.processing.dlq` y `notifications.send.dlq` (vía el exchange `eventflow.dlx`) |
| Propiedades AMQP | `content_type: application/json`, `delivery_mode: 2` (persistente), `message_id` = `event_id`, `type` = `order.created`, `correlation_id` = `X-Request-Id` de la petición |

Cuerpo (ejemplo con los datos del pedido de arriba):

```json
{
  "event_id": "5b0c8e1e-2f4a-4c55-9d0b-7a1f3c9e2d10",
  "event_type": "order.created",
  "occurred_at": "2026-11-17T14:30:50.61318Z",
  "correlation_id": "df40758b-4c96-4fd7-acbd-625c7f016ba1",
  "order_id": "a41f2dd2-b643-442b-89c0-d399ebf53c29",
  "customer_id": "12345678-5",
  "total": 20970,
  "currency": "CLP"
}
```

| Campo | Descripción |
|---|---|
| `event_id` | UUID del evento. El worker de notificaciones lo usa para no notificar dos veces |
| `event_type` | Siempre `order.created` |
| `occurred_at` | Cuándo se creó el pedido |
| `correlation_id` | El `X-Request-Id` de la petición original: une los logs de la API y del worker |
| `order_id`, `customer_id`, `total`, `currency` | Referencia al pedido |

Un mensaje que no se puede leer (JSON inválido, otro `event_type` o ids que no son UUID) va directo a la `.dlq`,
sin reintentos, porque reintentarlo no lo arreglaría.
