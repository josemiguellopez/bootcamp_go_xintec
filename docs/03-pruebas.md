# 3. Pruebas

| Tipo | Cantidad | Necesita | Comando |
|---|---|---|---|
| Unitarias y HTTP | 42 | Solo Go | `go test ./...` |
| Integración y punta a punta | 7 | Docker (PostgreSQL y RabbitMQ reales) | ver abajo |
| Demostraciones de fallos | 4 escenarios | Sistema levantado y Git Bash | `./scripts/demo.sh <escenario>` |

## Pruebas unitarias y HTTP

```bash
go test ./...
go test -v ./internal/orders/...      # con detalle
go test -cover ./...                  # con porcentaje de cobertura
```

| Paquete | Qué prueba |
|---|---|
| `internal/orders/domain` | Las 11 reglas de validación, el total, que el pedido no se modifique desde afuera y la transición `PENDING → CONFIRMED` |
| `internal/orders/application/usecase` | Crear (guarda y publica), idempotencia, datos inválidos, broker caído, error de base de datos, confirmar (también duplicado), consultar |
| `internal/orders/presentation/handler` | La API HTTP real con `httptest`: 201, 9 peticiones inválidas, 200/404/400 al consultar, reintento con la misma clave, **20 reintentos simultáneos → 1 pedido**, que un error de BD no muestre detalles, timeout → 503 |
| `internal/notifications/application/usecase` | Envía y registra; no repite si el mensaje está duplicado; si el proveedor falla, no registra |
| `pkg/rabbitmq` | La política de mensajes: Ack, reintento, DLQ, error permanente, apagado durante los reintentos |
| `pkg/retry` | La espera que se duplica, el límite de intentos, el error permanente, la cancelación |
| `pkg/events`, `cmd/config`, `internal/health` | Validación del evento, configuración, `/health` y `/ready` |

Las pruebas no usan librerías de *mocks*: `internal/orders/ordertest/fakes.go` tiene un repositorio en memoria y un
publicador falso.

**Detector de carreras** (`go test -race ./...`): necesita un compilador C. Si no lo tienes, puedes correrlo con
Docker:

```bash
docker run --rm -v "$PWD":/src -w /src golang:1.25 go test -race ./...
```

## Pruebas de integración

Usan PostgreSQL y RabbitMQ reales. Están marcadas con la etiqueta `integration`, por eso `go test ./...` no las
incluye.

**Git Bash / Linux / macOS:**

```bash
docker compose up -d postgres rabbitmq
docker compose exec postgres createdb -U postgres eventflow_test     # si ya existe, ignora el error
export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:5432/eventflow_test?sslmode=disable"
export TEST_RABBITMQ_URL="amqp://guest:guest@localhost:5672/"
go test -tags integration -p 1 -count=1 -v ./...
```

**PowerShell:**

```powershell
docker compose up -d postgres rabbitmq
docker compose exec postgres createdb -U postgres eventflow_test
$env:TEST_DATABASE_URL = "postgres://postgres:postgres@localhost:5432/eventflow_test?sslmode=disable"
$env:TEST_RABBITMQ_URL = "amqp://guest:guest@localhost:5672/"
go test -tags integration -p 1 -count=1 -v ./...
```

Con `make`: `make test-integration`.

- Se usa la base `eventflow_test` porque las pruebas borran las tablas.
- `-p 1` hace que los paquetes corran de a uno, porque comparten la base y las colas.

| Prueba | Qué demuestra |
|---|---|
| `TestMigrationsCanRunTwice` | Las migraciones se aplican y repetirlas no hace nada |
| `TestOrderSurvivesRestart` | RF-04: el pedido se lee con una conexión nueva, como tras reiniciar la API |
| `TestConcurrentRequestsWithSameKeyCreateOneOrder` | RF-10: 20 peticiones simultáneas con la misma clave dan 1 pedido y 1 evento |
| `TestConfirmTwiceIsSafe` | RF-12: procesar el mismo evento dos veces no cambia nada |
| `TestFindByID_NotFound` | 404 con la base real |
| `TestOrderFlow_EndToEnd` | Flujo completo: crear → RabbitMQ → workers → pedido `CONFIRMED` y notificación registrada |
| `TestFailingMessageEndsInDLQ` | RF-11: un mensaje que siempre falla se intenta 3 veces y termina en la DLQ |

## Demostraciones de escenarios de fallo

Con el sistema levantado, desde Git Bash, Linux o macOS:

| Comando | Escenario | Qué deberías ver |
|---|---|---|
| `./scripts/demo.sh idempotency` | El cliente repite el POST | `201` y luego `200` con el **mismo id**; en la base hay **1** pedido con esa clave |
| `./scripts/demo.sh retries` | El proveedor de email falla siempre | Logs `will retry` con espera creciente y luego `dead-letter`; el mensaje en `notifications.send.dlq`; el pedido igual queda `CONFIRMED`, porque el otro consumidor es independiente |
| `./scripts/demo.sh worker-down` | El worker está caído cuando llega un pedido | La API responde igual; el pedido queda `PENDING` y el mensaje espera en la cola; al levantar el worker pasa a `CONFIRMED` |
| `./scripts/demo.sh shutdown` | Se apaga el worker con mensajes en curso | Logs `shutdown requested, finishing in-flight messages`; los mensajes no procesados siguen en la cola |

## Criterios de aceptación → evidencia

| Criterio | Evidencia |
|---|---|
| RF-01 Crear | `TestCreateOrder_Returns201`, `TestCreateOrder_SavesAndPublishesEvent` |
| RF-02 Validación | `TestNewOrder_Validation`, `TestCreateOrder_InvalidRequestsReturn4xx` (también comprueba que no se crea nada) |
| RF-03 Consultar | `TestGetOrder` |
| RF-04 Persistencia | `TestOrderSurvivesRestart`, carpeta `migrations/` |
| RF-05 Errores | `TestDatabaseErrorDoesNotLeakDetails`, `TestTimeoutReturns503` |
| RF-06 Configuración | `cmd/config/config_test.go`, `.env.example` |
| RF-07 Pruebas | Esta página |
| RF-08 Ejecución local | [Instalación](01-instalacion.md) |
| RF-09 Evento | `TestCreateOrder_SavesAndPublishesEvent`, `TestDecodeOrderCreated`, `TestOrderFlow_EndToEnd` |
| RF-10 Idempotencia | `TestCreateOrder_ConcurrentRetriesWithSameKey`, `TestConcurrentRequestsWithSameKeyCreateOneOrder`, demo `idempotency` |
| RF-11 Reintentos | `pkg/retry`, `TestHandle_ExhaustedRetriesGoToDLQ`, `TestFailingMessageEndsInDLQ`, demo `retries` |
| RF-12 Confirmación | `TestHandle_*`, `TestConfirmOrder`, `TestSend_DuplicateMessageDoesNotSendTwice` |
| RF-13 Observabilidad | `request_id` y `correlation_id` en los logs ([Uso](02-uso.md#ver-qué-está-pasando)) |
| RF-14 Apagado | `TestHandle_ShutdownDuringRetriesRequeues`, `TestHandle_InFlightWorkFinishesDuringShutdown`, demo `shutdown` |
