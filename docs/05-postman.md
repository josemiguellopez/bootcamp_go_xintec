# 5. Probar la API con Postman

Esta guía explica cómo probar cada endpoint con [Postman](https://www.postman.com/downloads/) usando la colección
[postman/EventFlow.postman_collection.json](postman/EventFlow.postman_collection.json). Cada petición trae
**pruebas automáticas**: Postman marca en verde lo que funciona y en rojo lo que no.

## Paso 1: levantar el sistema

```powershell
docker compose up -d --build
```

Comprueba que todo responde abriendo <http://localhost:3200/ready> en el navegador. Tiene que mostrar
`{"database":"up","status":"up"}`.

## Paso 2: importar la colección

1. Abre Postman.
2. Haz clic en **Import** (arriba a la izquierda).
3. Arrastra el archivo `docs/postman/EventFlow.postman_collection.json`, o búscalo con **files**.
4. En el panel izquierdo aparece la colección **EventFlow**, con 5 carpetas.

No hace falta crear un *environment*. Las variables están dentro de la colección (clic en **EventFlow** → pestaña
**Variables**):

| Variable | Valor | Para qué |
|---|---|---|
| `baseUrl` | `http://localhost:3200` | La API |
| `workerUrl` | `http://localhost:3201` | El worker, que solo tiene health y métricas |
| `orderId` | se llena sola | El id del último pedido creado |
| `idempotencyKey` | se llena sola | La clave del último pedido creado |

## Paso 3: probar cada endpoint

Para ejecutar una petición, selecciónala y pulsa **Send**. El resultado de las pruebas está abajo, en la pestaña
**Test Results**.

### Carpeta 1: Flujo principal (ejecutar en orden)

| # | Petición | Qué hace | Resultado esperado |
|---|---|---|---|
| 1 | **Crear pedido** | `POST /orders` con 2 artículos y una `Idempotency-Key` nueva | `201`, `status: en_preparacion`, `total: 21970`, `currency: CLP`. Guarda el `id` en `{{orderId}}` |
| 2 | **Repetir con la misma Idempotency-Key** | Envía exactamente lo mismo otra vez, como un cliente que no recibió respuesta | `200` (no `201`) y **el mismo `id`**: no se creó otro pedido |
| 3 | **Consultar pedido** | `GET /orders/{{orderId}}` | `200`. Si lo envías al instante puede decir `en_preparacion`; espera un segundo, vuelve a enviarlo y verás `listo_para_despacho` (lo cambió el worker) |
| 4 | **Crear sin Idempotency-Key** | `POST /orders` sin la cabecera | `201` con **otro** `id`: sin clave no hay protección contra duplicados |

> Para empezar de cero, vuelve a ejecutar **Crear pedido**: genera una clave nueva.

### Carpeta 2: Validaciones (400 / 413)

Todas responden con el mismo formato de error, y **ninguna crea un pedido**:

```json
{
  "error": { "type": "VALIDATION_ERROR", "code": "ORDER_INVALID_QUANTITY", "message": "items[0].quantity must be between 1 and 10000" },
  "request_id": "9e1519b3-...",
  "timestamp": "2026-11-16T12:00:00Z"
}
```

| Petición | Qué envía | Código esperado |
|---|---|---|
| RUT inválido | `customer_id` con dígito verificador incorrecto | `400 ORDER_INVALID_CUSTOMER` |
| Sin artículos | `items: []` | `400 ORDER_EMPTY_ITEMS` |
| SKU vacío | `sku: ""` | `400 ORDER_INVALID_SKU` |
| Cantidad 0 | `quantity: 0` | `400 ORDER_INVALID_QUANTITY` |
| Precio negativo | `unit_price: -5` | `400 ORDER_INVALID_PRICE` |
| JSON mal formado | `{ "customer_id": ` | `400 INVALID_JSON` |
| Campo desconocido | un campo extra `"admin": true` | `400 INVALID_JSON` |
| Cuerpo demasiado grande | más de 64 KB | `413 PAYLOAD_TOO_LARGE` |
| Idempotency-Key muy larga | 129 caracteres (el máximo es 128) | `400 IDEMPOTENCY_KEY_INVALID` |

Prueba también a cambiar tú mismo los valores del **Body** para ver otros errores. Las reglas están en
[Uso → Reglas de validación](02-uso.md#reglas-de-validación-error-400).

### Carpeta 3: Estados del pedido (ejecutar en orden)

Recorre los seis estados que definió el profesor sobre el último pedido creado. Antes, ejecute **Crear pedido** y
espere un segundo: el worker lo deja en `listo_para_despacho`.

| Petición | Qué envía | Resultado esperado |
|---|---|---|
| Esperar listo_para_despacho | `GET /orders/{{orderId}}` | `status: listo_para_despacho` (si no, espere y repita) |
| Salto no permitido | `PATCH` a `entregado` sin pasar por `en_transito` | `409 ORDER_INVALID_TRANSITION`; el pedido no cambia |
| Despachar | `{"status":"en_transito"}` | `200`, `next_statuses: [entregado, no_entregado]` |
| No se pudo entregar | `{"status":"no_entregado"}` | `200`, `next_statuses: [en_transito, devuelto]` |
| Reintentar entrega | `{"status":"en_transito"}` | `200` |
| Entregar | `{"status":"entregado"}` | `200`, `next_statuses: [devuelto]` |
| Devolver | `{"status":"devuelto"}` | `200`, `next_statuses: []` (estado final) |
| Estado desconocido | `{"status":"perdido"}` | `400 ORDER_INVALID_STATUS` |

### Carpeta 4: Consultas con error

| Petición | Código esperado |
|---|---|
| Pedido inexistente (un UUID válido que no existe) | `404 ORDER_NOT_FOUND` |
| Id que no es UUID (`/orders/abc`) | `400 ORDER_INVALID_ID` |
| Ruta inexistente (`/no-existe`) | `404 ROUTE_NOT_FOUND` |

### Carpeta 5: Operación

| Petición | Qué indica |
|---|---|
| API · health / Worker · health | `200`: el proceso está vivo |
| API · ready / Worker · ready | `200` si PostgreSQL responde; `503` si no |
| API · metrics | Contadores: `orders_created_total`, `orders_idempotent_replays_total`, `events_published_total`... |
| Worker · metrics | Contadores: `messages_processed_total`, `messages_retried_total`, `messages_dead_lettered_total`... |

Ejecuta **Crear pedido** un par de veces y vuelve a mirar las métricas: los contadores suben.

## Paso 4: ejecutar todo de una vez (Collection Runner)

1. Clic derecho sobre **EventFlow** → **Run collection**.
2. Deja todas las peticiones marcadas y pulsa **Run EventFlow**.
3. Postman ejecuta las 30 peticiones en orden y muestra cuántas pruebas pasaron.

Todas deberían salir en verde. En **Consultar pedido** el estado puede ser `en_preparacion` o `listo_para_despacho`, y la prueba
acepta los dos.

## Paso 5: ver lo que pasó por dentro

Cada respuesta trae la cabecera **`X-Request-ID`** (pestaña **Headers** de la respuesta). Con ese id puedes seguir el
pedido en los logs de la API y del worker:

```powershell
docker compose logs api worker | Select-String "<pega aquí el X-Request-ID>"
```

Verás `order created` (API), `order ready for dispatch` y `simulated email sent` (worker).

También puedes enviar tu propio `X-Request-ID` como cabecera en la petición, por ejemplo `mi-prueba-1`, y buscarlo
igual.

## Probar escenarios de fallo desde Postman

| Escenario | Cómo | Qué deberías ver |
|---|---|---|
| **Worker caído** | `docker compose stop worker` → **Crear pedido** → **Consultar pedido** | La API responde `201` igual; el pedido se queda `en_preparacion`. Con `docker compose start worker` pasa a `listo_para_despacho` |
| **Base de datos caída** | `docker compose stop postgres` → **API · ready** y **Crear pedido** | `ready` responde `503`; crear responde `500 INTERNAL_ERROR` (o `503 TIMEOUT` si la conexión tarda), sin mostrar detalles internos. Luego ejecuta `docker compose start postgres` |
| **RabbitMQ caído** | `docker compose stop rabbitmq` → **Crear pedido** | Responde `201` y el pedido queda `en_preparacion` (el evento se pierde: es la limitación conocida, ver README). Luego ejecuta `docker compose start rabbitmq` |
| **Email que siempre falla** | `$env:NOTIFIER_FAILURE_RATE=1; docker compose up -d worker` → **Crear pedido** | En los logs del worker aparecen los reintentos y luego `dead-letter`; el mensaje queda en `notifications.send.dlq` (<http://localhost:15672>, guest/guest). Restaura con `Remove-Item Env:NOTIFIER_FAILURE_RATE; docker compose up -d worker` |

## Problemas frecuentes

| Síntoma | Causa y solución |
|---|---|
| `Error: connect ECONNREFUSED 127.0.0.1:3200` | La API no está levantada: `docker compose up -d --build` y `docker compose ps` |
| **Repetir…** falla con `201` en vez de `200` | Ejecutaste antes otra petición que cambió la clave. Vuelve a correr **Crear pedido** y luego **Repetir** |
| **Consultar pedido** da `400 ORDER_INVALID_ID` | `{{orderId}}` está vacío: ejecuta primero **Crear pedido** |
| Las pruebas de **Worker ·** fallan | El worker no está levantado: `docker compose up -d worker` |
