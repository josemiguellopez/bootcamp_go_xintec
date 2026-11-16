# 2. Uso

El sistema tiene que estar levantado (`docker compose up -d --build`). Los ejemplos usan `curl` desde Git Bash,
Linux o macOS. Al final de cada caso hay una versión para PowerShell.

## Crear un pedido

```bash
curl -s -i -X POST localhost:3200/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: pedido-001' \
  -d '{"customer_id":"customer-42","items":[
        {"sku":"SKU-1","quantity":2,"unit_price_cents":1500},
        {"sku":"SKU-2","quantity":1,"unit_price_cents":999}]}'
```

```http
HTTP/1.1 201 Created
X-Request-Id: 9e1519b3-...

{"id":"4f1c2a8e-...","customer_id":"customer-42","status":"PENDING","total_cents":3999,
 "items":[{"sku":"SKU-1","quantity":2,"unit_price_cents":1500,"subtotal_cents":3000}, ...],
 "created_at":"...","updated_at":"..."}
```

- Los precios van en **centavos**: `1500` = 15,00.
- El pedido nace `PENDING`. El worker lo pasa a `CONFIRMED` en segundo plano, normalmente en menos de un segundo.
- `X-Request-Id` identifica la petición en los logs.

PowerShell:

```powershell
$body = '{"customer_id":"customer-42","items":[{"sku":"SKU-1","quantity":2,"unit_price_cents":1500}]}'
Invoke-RestMethod -Method Post -Uri http://localhost:3200/orders -ContentType "application/json" `
  -Headers @{ "Idempotency-Key" = "pedido-001" } -Body $body
```

### Reglas de validación (error `400`)

| Campo | Regla | Código |
|---|---|---|
| `customer_id` | Obligatorio, máximo 64 caracteres | `ORDER_INVALID_CUSTOMER` |
| `items` | Entre 1 y 100 artículos | `ORDER_EMPTY_ITEMS`, `ORDER_TOO_MANY_ITEMS` |
| `items[].sku` | Obligatorio | `ORDER_INVALID_SKU` |
| `items[].quantity` | Entero entre 1 y 10.000 | `ORDER_INVALID_QUANTITY` |
| `items[].unit_price_cents` | Entero entre 1 y 100.000.000 | `ORDER_INVALID_PRICE` |
| Cuerpo | JSON válido y sin campos desconocidos | `INVALID_JSON` |
| Cuerpo | Máximo 64 KB | `PAYLOAD_TOO_LARGE` (`413`) |
| `Idempotency-Key` | Máximo 128 caracteres | `IDEMPOTENCY_KEY_INVALID` |

## Consultar un pedido

```bash
curl -s localhost:3200/orders/<id>
```

La respuesta es `200` con el pedido, `404` si no existe y `400` si el id no es un UUID.

PowerShell: `Invoke-RestMethod http://localhost:3200/orders/<id>`

## Reintentar sin duplicar (idempotencia)

Si el cliente no recibe respuesta (por ejemplo, por un corte de red), puede repetir la petición con **la misma
`Idempotency-Key`**:

- La primera vez responde `201 Created`.
- Las siguientes veces responden `200 OK` con **el mismo pedido**, sin crear otro.

Recomendación: generar un UUID por pedido y reutilizarlo en todos sus reintentos. Si no se envía la cabecera, cada
POST crea un pedido nuevo.

## Ver qué está pasando

**Logs** (una línea JSON por evento):

```bash
docker compose logs -f api worker
docker compose logs api worker | grep <request_id>     # seguir un pedido concreto
```

El `request_id` del POST viaja dentro del evento como `correlation_id`, así que con un solo `grep` ves el pedido en
la API y en el worker:

```
api     "msg":"order created"          "request_id":"9e15…" "order_id":"4f1c…"
worker  "msg":"order confirmed"        "consumer":"order-processor" "correlation_id":"9e15…"
worker  "msg":"simulated email sent"   "consumer":"notifier" "correlation_id":"9e15…"
```

**Consola de RabbitMQ:** <http://localhost:15672>, usuario `guest` y contraseña `guest`. En *Queues* verás
`orders.processing`, `notifications.send` y sus colas `.dlq`, donde quedan los mensajes que fallaron.

**Base de datos:**

```bash
docker compose exec postgres psql -U postgres -d eventflow -c "SELECT id, status, total_cents FROM orders ORDER BY created_at DESC LIMIT 5;"
```

**Salud y métricas:**

```bash
curl -s localhost:3200/health     # el proceso está vivo
curl -s localhost:3200/ready      # la base de datos responde (200) o no (503)
curl -s localhost:3200/metrics    # orders_created_total, events_publish_failed_total, ...
curl -s localhost:3201/metrics    # worker: messages_processed_total, messages_retried_total, messages_dead_lettered_total, ...
```

## Configuración

Todo se configura con variables de entorno. Con Docker se cambian en `docker-compose.yml`; con `go run`, en
`.env.dev`.

| Variable | Defecto | Para qué |
|---|---|---|
| `NOTIFIER_FAILURE_RATE` | `0.3` en compose | Probabilidad (de 0 a 1) de que falle el email simulado. Con `1` siempre falla y el mensaje termina en la DLQ |
| `RETRY_MAX_ATTEMPTS` | `4` | Intentos antes de mandar el mensaje a la DLQ |
| `RETRY_INITIAL_BACKOFF` | `500ms` | Primera espera entre reintentos; se duplica en cada intento (tope 5 s) |
| `WORKER_CONCURRENCY` | `4` | Mensajes procesados en paralelo por cola |
| `REQUEST_TIMEOUT` | `5s` | Tiempo máximo de una petición HTTP |
| `MAX_BODY_BYTES` | `65536` | Tamaño máximo del cuerpo |
| `SHUTDOWN_TIMEOUT` | `20s` | Tiempo máximo del apagado ordenado |
| `LOG_LEVEL` | `info` | `debug` muestra más detalle |
| `DB_*`, `RABBITMQ_URL` | ver `.env.example` | Conexiones |

Ejemplo, para que todos los emails fallen:

```bash
NOTIFIER_FAILURE_RATE=1 docker compose up -d worker
```

Más peticiones de ejemplo en [requests.http](requests.http) (extensión *REST Client* de VS Code).
