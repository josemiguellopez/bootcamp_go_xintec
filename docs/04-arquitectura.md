# 4. Arquitectura

> Los diagramas están en [Mermaid](https://mermaid.js.org/). GitHub los dibuja solo. En VS Code se ven con la
> extensión *Markdown Preview Mermaid Support*.

## Componentes

```mermaid
flowchart LR
    C([Cliente HTTP]) -->|"POST /orders<br/>GET /orders/{id}"| API

    subgraph docker["docker compose"]
      API["api :3200<br/>(cmd/api)"]
      W["worker :3201<br/>(cmd/worker)"]
      PG[("PostgreSQL")]
      MQ{{"RabbitMQ"}}
    end

    API -->|"1. guarda el pedido"| PG
    API -->|"2. publica order.created"| MQ
    MQ -->|entrega| W
    W -->|"confirma pedido<br/>registra notificación"| PG
```

| Componente | Qué hace |
|---|---|
| **API** | Recibe pedidos, los valida, los guarda y publica el evento. Responde sin esperar al worker |
| **Worker** | Dos consumidores: `order-processor` (pasa el pedido a `CONFIRMED`) y `notifier` (email simulado) |
| **PostgreSQL** | Guarda pedidos, artículos y notificaciones enviadas |
| **RabbitMQ** | Transporta los eventos; guarda en una `.dlq` los que no se pudieron procesar |

La API y el worker salen del **mismo código y la misma imagen Docker**, pero corren como dos procesos.

## Capas (como en la semilla)

```mermaid
flowchart TB
    P["presentation<br/>handler HTTP · consumer de mensajes"] --> A["application<br/>casos de uso: CreateOrder, GetOrder, ConfirmOrder"]
    A --> D["domain<br/>Order, reglas, interfaces OrderRepository y EventPublisher"]
    I["infrastructure<br/>PostgreSQL, RabbitMQ"] -. implementa .-> D
```

- **domain** no importa nada externo. Define las reglas y las interfaces que necesita.
- **application** coordina: valida con el dominio, guarda con el repositorio y publica con el publicador.
- **infrastructure** implementa esas interfaces con PostgreSQL y RabbitMQ.
- **presentation** traduce HTTP o mensajes de RabbitMQ en llamadas a los casos de uso.
- `cmd/container` (API) y `cmd/worker/main.go` crean las piezas concretas y las conectan.

## Crear un pedido

```mermaid
sequenceDiagram
    actor C as Cliente
    participant H as Handler HTTP
    participant UC as CreateOrder
    participant D as Order (dominio)
    participant DB as PostgreSQL
    participant MQ as RabbitMQ

    C->>H: POST /orders + Idempotency-Key
    H->>UC: Execute(pedido, clave)
    UC->>D: NewOrder() valida las reglas
    alt datos inválidos
        UC-->>C: 400 con código de error
    end
    UC->>DB: INSERT ... ON CONFLICT (idempotency_key) DO NOTHING
    alt la clave ya existía
        DB-->>UC: 0 filas, devuelve el pedido original
        UC-->>C: 200 con el mismo pedido
    else pedido nuevo
        DB-->>UC: guardado
        UC->>MQ: publica order.created y espera confirmación
        UC-->>C: 201 PENDING
    end
```

## Procesar el evento (worker)

```mermaid
sequenceDiagram
    participant MQ as RabbitMQ
    participant OP as order-processor
    participant NT as notifier
    participant DB as PostgreSQL

    par cola orders.processing
        MQ->>OP: order.created
        OP->>DB: SELECT ... FOR UPDATE
        alt ya estaba CONFIRMED (duplicado)
            OP->>MQ: ACK sin cambios
        else PENDING
            OP->>DB: UPDATE status = CONFIRMED
            OP->>MQ: ACK
        end
    and cola notifications.send
        MQ->>NT: order.created
        NT->>DB: ¿ya se notificó este event_id?
        alt sí (duplicado)
            NT->>MQ: ACK sin enviar
        else no
            NT->>NT: envía email simulado
            NT->>DB: INSERT notifications
            NT->>MQ: ACK
        end
    end
```

## Reintentos y cola de mensajes muertos

```mermaid
flowchart LR
    M[Mensaje] --> T{¿Funcionó?}
    T -->|sí| ACK[ACK: listo]
    T -->|"error transitorio<br/>(BD, email)"| R{¿Quedan intentos?}
    R -->|"sí: espera 0,5s → 1s → 2s"| T
    R -->|no| DLQ[".dlq<br/>para investigar"]
    T -->|"error permanente<br/>(JSON inválido)"| DLQ
    T -->|"apagado durante la espera"| Q[Vuelve a la cola]
```

## Estados del pedido

```mermaid
stateDiagram-v2
    [*] --> PENDING: POST /orders
    PENDING --> CONFIRMED: el worker procesa order.created
```

## Base de datos

```mermaid
erDiagram
    orders ||--|{ order_items : contiene
    orders {
        uuid id PK
        text customer_id
        text status "PENDING o CONFIRMED"
        bigint total_cents
        text idempotency_key UK "puede ser NULL"
        timestamptz created_at
        timestamptz updated_at
    }
    order_items {
        uuid order_id PK
        int position PK
        text sku
        int quantity
        bigint unit_price_cents
    }
    notifications {
        uuid id PK
        uuid event_id UK "evita notificar dos veces"
        uuid order_id
        timestamptz sent_at
    }
```

Las tablas se crean con los archivos de `migrations/`, que se aplican al arrancar y quedan registrados en
`schema_migrations`.

## Colas de RabbitMQ

```mermaid
flowchart LR
    API -->|order.created| EX{{"eventflow.events"}}
    EX --> Q1[["orders.processing"]] --> W1[order-processor]
    EX --> Q2[["notifications.send"]] --> W2[notifier]
    Q1 -. rechazado .-> D1[["orders.processing.dlq"]]
    Q2 -. rechazado .-> D2[["notifications.send.dlq"]]
```

Formato del evento (`pkg/events/events.go`):

```json
{
  "event_id": "b7a2…",
  "event_type": "order.created",
  "occurred_at": "2026-11-16T12:00:00.123456Z",
  "correlation_id": "9e15… (request_id del POST)",
  "order_id": "4f1c…",
  "customer_id": "customer-42",
  "total_cents": 3999
}
```
