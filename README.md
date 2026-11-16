# EventFlow — API de pedidos en Go orientada a eventos

Solución al **EventFlow · Go Architecture Challenge**, construida sobre la semilla Go del bootcamp.

Una API recibe pedidos por HTTP y los guarda en PostgreSQL. Al crear un pedido, publica un evento `order.created` en
RabbitMQ. Un **worker** lo procesa en segundo plano: un consumidor **confirma el pedido** y otro **envía un email
simulado**, con reintentos y cola de mensajes muertos (DLQ).

```mermaid
flowchart LR
    C([Cliente]) -->|POST /orders| API["API Go<br/>handler → caso de uso → dominio"]
    API -->|guarda| PG[(PostgreSQL)]
    API -->|publica order.created| MQ{{RabbitMQ}}
    MQ --> W1["Worker de pedidos<br/>PENDING → CONFIRMED"]
    MQ --> W2["Worker de notificaciones<br/>email simulado + reintentos"]
    W1 --> PG
    W2 --> PG
```

## Documentación

| Guía | Contenido |
|---|---|
| [Instalación](docs/01-instalacion.md) | Requisitos, instalación en Windows, macOS o Linux, primer arranque, problemas frecuentes |
| [Uso](docs/02-uso.md) | Crear y consultar pedidos (curl y PowerShell), idempotencia, logs, consola de RabbitMQ, configuración |
| [Pruebas](docs/03-pruebas.md) | Pruebas unitarias, de integración y de punta a punta; demostraciones de fallos; criterios RF → prueba |
| [Arquitectura](docs/04-arquitectura.md) | Diagramas: componentes, capas, secuencias, estados, base de datos y colas |

## Arranque rápido

Requisitos: Docker Desktop. Go 1.25+ solo hace falta para las pruebas.

```bash
docker compose up -d --build

curl -s -X POST localhost:3200/orders -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: pedido-001' \
  -d '{"customer_id":"customer-42","items":[{"sku":"SKU-1","quantity":2,"unit_price_cents":1500}]}'
# -> 201 {"id":"...","status":"PENDING",...}

curl -s localhost:3200/orders/<id>     # un segundo después: "status":"CONFIRMED"
docker compose logs -f api worker      # ver qué pasó

go test ./...                          # pruebas (no necesitan Docker)
```

## API

| Método | Ruta | Respuestas |
|---|---|---|
| `POST` | `/orders` (cabecera opcional `Idempotency-Key`) | `201` creado · `200` clave ya usada (devuelve el pedido original) · `400` datos inválidos · `413` cuerpo muy grande |
| `GET` | `/orders/{id}` | `200` · `400` id inválido · `404` no existe |
| `GET` | `/health` · `/ready` · `/metrics` | Proceso vivo · base de datos disponible (`200`/`503`) · contadores |

Los errores siempre tienen el mismo formato y nunca muestran SQL ni contraseñas:

```json
{"error":{"type":"VALIDATION_ERROR","code":"ORDER_INVALID_QUANTITY","message":"items[0].quantity must be between 1 and 10000"},
 "request_id":"9e1519b3-…","timestamp":"2026-11-16T12:00:00Z"}
```

## Cómo se cubre cada nivel del desafío

| Nivel | Qué se implementó | Dónde |
|---|---|---|
| **1. API modular** (RF-01 a RF-08) | `POST /orders` y `GET /orders/{id}`; reglas de negocio en el dominio; PostgreSQL con migraciones versionadas; errores consistentes; configuración por variables de entorno; pruebas; docker compose | `internal/orders`, `migrations/`, `pkg/httputil`, `cmd/config` |
| **2. Confiabilidad** (RF-05, RF-10, RF-14) | `Idempotency-Key` con índice único en PostgreSQL; timeout por petición; límite de tamaño del cuerpo; apagado ordenado con SIGTERM | `internal/orders/infrastructure/postgres_repo.go`, `pkg/middleware`, `cmd/app/run.go` |
| **3. Event-driven** (RF-09 a RF-12) | Evento `order.created` en RabbitMQ; worker con dos consumidores; reintentos con espera creciente; DLQ; ACK solo al terminar; consumidores idempotentes | `pkg/rabbitmq`, `pkg/retry`, `pkg/events`, `cmd/worker` |
| **4. Operación** (RF-06, RF-13, RF-14) | Logs JSON con `request_id` que viaja dentro del evento; `/health`, `/ready` y `/metrics`; guía de ejecución local | `pkg/logger`, `pkg/middleware`, `pkg/metrics`, `docs/` |

## Decisiones técnicas

1. **Se conserva la estructura de la semilla** (`domain → application → infrastructure / presentation`). Las reglas
   de negocio (`Order`) no conocen HTTP, SQL ni RabbitMQ, así que se prueban sin nada de eso.
2. **Interfaces solo donde hacen falta.** `OrderRepository` y `EventPublisher` las usan los casos de uso y en las
   pruebas se reemplazan por versiones en memoria. Se quitaron las de la semilla que no tenían un segundo uso
   (`database.Database`, `pubsub.PubSub`).
3. **Dinero en centavos (`int64`)** para evitar errores de redondeo con decimales.
4. **Idempotencia con la base de datos.** `idempotency_key` es `UNIQUE`. Si la clave ya existe, el
   `INSERT … ON CONFLICT DO NOTHING` no inserta nada y se devuelve el pedido original con `200`. Si llegan dos
   peticiones iguales al mismo tiempo, PostgreSQL hace esperar a la segunda, así que nunca se crean dos pedidos.
   Sin clave no hay protección (documentado).
5. **El evento se publica después de guardar el pedido**, con *publisher confirms*: RabbitMQ confirma que lo guardó.
   Si RabbitMQ no está disponible, el pedido queda guardado y se responde `201`, pero el evento se pierde y el pedido
   queda `PENDING`. Es la brecha que menciona el PDF. La solución sería el patrón *transactional outbox*, que el
   desafío marca como extensión opcional y queda como siguiente paso.
6. **Un worker con dos consumidores**, cada uno con su cola y su DLQ. Es un proceso aparte de la API para que un
   email lento no afecte las respuestas HTTP.
7. **Política de mensajes:** ACK solo después de terminar el trabajo. Si hay un error transitorio, se reintenta con
   espera creciente (0,5 s → 1 s → 2 s, 4 intentos). Si se agotan los intentos o el mensaje es inválido, va a la
   `.dlq` para investigar. Si llega un duplicado, se detecta y no se repite el efecto.
8. **Sin lógica de reconexión.** Si el worker pierde la conexión con RabbitMQ, termina con error y Docker lo
   reinicia (`restart: unless-stopped`). Es más simple y más fácil de explicar.
9. **Migraciones SQL embebidas en el binario**, aplicadas al arrancar y registradas en `schema_migrations`.
10. **Se quitaron de la semilla:** Swagger (el build de Docker fallaba porque `.dockerignore` excluía `docs/`), el
    driver de GCP Pub/Sub (el desafío pide un broker local) y el logger de colores (se reemplazó por JSON
    estructurado).

## Respuestas a las preguntas del desafío

**¿Qué ocurre si el cliente repite el POST porque no recibió respuesta?**
Si envía la misma `Idempotency-Key`, recibe `200` con el mismo pedido y no se crea otro, aunque los reintentos
lleguen al mismo tiempo. Sin la clave se crearía un pedido nuevo; por eso los clientes deben enviarla.

**¿Qué ocurre si el worker procesa el evento y falla antes de confirmar el mensaje?**
RabbitMQ no recibió el ACK, así que vuelve a entregar el mensaje. El worker de pedidos ve que el pedido ya está
`CONFIRMED` y no hace nada. El de notificaciones ve en la tabla `notifications` que ese evento ya se notificó. En
ambos casos se hace ACK sin repetir el efecto (consumidores idempotentes).

**¿Cómo se evita perder el evento si la base de datos confirma el pedido pero el broker no está disponible?**
En esta versión **no se evita**: el pedido queda guardado en `PENDING`, el error queda en el log y la métrica
`events_publish_failed_total` sube. La solución es el *transactional outbox*: guardar el evento en una tabla dentro
de la misma transacción que el pedido y que un proceso aparte lo publique cuando RabbitMQ vuelva. Se dejó como
siguiente paso porque el PDF lo plantea como extensión, no como requisito.

**¿Qué debe ocurrir durante un apagado mientras se procesa un mensaje?**
El worker deja de recibir mensajes nuevos, termina el que está procesando y no empieza más reintentos. Lo que no
alcanzó a terminar queda sin ACK y RabbitMQ lo devuelve a la cola, sin perder nada. La API deja de aceptar
conexiones y espera las peticiones en curso. Ambos esperan como máximo `SHUTDOWN_TIMEOUT` (20 s).

**¿Qué componentes pueden seguir siendo módulos del mismo servicio y por qué?**
`orders`, `notifications` y `health` comparten base de datos y despliegue, y ya se comunican por eventos: separarlos
en microservicios agregaría red y despliegues sin beneficio. Lo único que se separó en otro **proceso** es el worker,
porque su carga (emails lentos o que fallan) no debe afectar a la API. `notifications` sería el primer candidato a
servicio propio si algún día tuviera otro equipo o su propia base de datos.

## Limitaciones conocidas y siguientes pasos

- Evento perdido si RabbitMQ cae justo al crear el pedido → *transactional outbox*.
- Las claves de idempotencia no expiran.
- El email podría duplicarse si el worker cae entre enviarlo y registrarlo. Mitigación: se pasa el `event_id` como
  clave de idempotencia al proveedor.
- Métricas en JSON (`expvar`); el siguiente paso sería Prometheus.
- Sin autenticación (fuera del alcance).

## Uso de IA

Se usó un **asistente de IA** como apoyo para: comparar alternativas de arquitectura a partir del enunciado y la
semilla, generar y revisar código y pruebas, y redactar la documentación. El código se compiló, se revisó con
`go vet` y se probó con `go test ./...`. Las decisiones están explicadas en este README.
