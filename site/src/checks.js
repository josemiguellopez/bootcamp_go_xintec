// El resultado del desafío. Cada requisito del PDF (RF-01…RF-14) tiene una
// prueba que hace peticiones reales a la API. El mismo resultado se muestra de dos formas:
//   Resumen simple   -> una frase por requisito, para cualquier persona
//   Resumen técnico  -> criterio literal del PDF, evidencia HTTP, código y pruebas en Go
//
// Tipos de requisito:
//   auto     -> se prueba solo (entra en "Probar todo")
//   manual   -> necesita un paso con Docker; trae los pasos y un botón para comprobar
//   inspect  -> se revisa en el repositorio

import { copy, el, newKey, shortId } from "./ui.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const delta = (before, after, name) => (after?.[name] ?? 0) - (before?.[name] ?? 0);
const SAMPLE = { customer_id: "12.345.678-5", items: [{ sku: "GO-TAZA", quantity: 2, unit_price: 8990 }] };

const pass = (message, detail, command) => ({ result: "pass", message, detail, command });
const fail = (message, detail, command) => ({ result: "fail", message, detail, command });
const info = (message, detail, command) => ({ result: "info", message, detail, command });

/** Espera hasta que check() devuelva algo "verdadero" o se acabe el tiempo. */
async function waitFor(check, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await check();
    if (value) return value;
    await sleep(400);
  }
  return null;
}

const LEVELS = [
  { n: 1, title: "Nivel 1 · API modular", sub: "Crear, revisar, consultar y guardar pedidos." },
  { n: 2, title: "Nivel 2 · Confiabilidad", sub: "Reintentar sin duplicar, poner límites y apagar con orden." },
  { n: 3, title: "Nivel 3 · Orientado a eventos", sub: "Avisos por RabbitMQ y trabajadores en segundo plano." },
  { n: 4, title: "Nivel 4 · Operación", sub: "Seguimiento de cada petición, salud del sistema y contadores." },
];

// ---------------------------------------------------------------------------
// Los requisitos. Campos:
//   plain  -> la frase del resumen simple
//   pdf    -> el criterio tal como lo escribe el PDF
//   what   -> cómo lo comprueba esta página
//   code   -> dónde está en el repositorio
//   tests  -> pruebas automáticas en Go que lo cubren

function buildChecks(ctx) {
  const { call } = ctx;

  return [
    // ------------------------------------------------------------- Nivel 1
    {
      level: 1, id: "RF-01", agent: "cliente", type: "auto",
      plain: "Se pueden crear pedidos",
      title: "Crear pedido",
      pdf: "POST /orders acepta una solicitud válida, valida cliente y artículos, persiste el pedido y devuelve 201 con su ID y estado inicial.",
      what: "Envía un pedido válido (RUT 12.345.678-5) y comprueba 201, un UUID como id, el estado inicial en_preparacion, el RUT guardado sin puntos y la moneda CLP (total 2 × 8990 = 17980).",
      code: ["internal/orders/presentation/handler/order_handler.go", "internal/orders/application/usecase/create_order.go"],
      tests: ["TestCreateOrder_Returns201", "TestCreateOrder_SavesAndPublishesEvent"],
      async run(api) {
        const r = await call("POST /orders", () => api.createOrder(SAMPLE, newKey()), SAMPLE);
        ctx.remember(r);
        return r.status === 201 && UUID.test(r.data?.id ?? "") && r.data.status === "en_preparacion" && r.data.customer_id === "12345678-5" && r.data.currency === "CLP"
          ? pass(`Se creó el pedido ${r.data.id}, en preparación.`, `201 · id ${r.data.id} · status en_preparacion · customer_id 12345678-5 · total ${r.data.total} ${r.data.currency}`)
          : fail(`Se esperaba «201 Creado» con un número de pedido, pero respondió ${r.status}.`);
      },
    },
    {
      level: 1, id: "RF-02", agent: "api", type: "auto",
      plain: "Rechaza pedidos con errores",
      title: "Validación",
      pdf: "Solicitudes mal formadas, cantidades no positivas, listas vacías o precios inválidos reciben un 4xx consistente. No se crea ningún pedido.",
      what: "Envía 5 pedidos inválidos (incluido un RUT con dígito verificador incorrecto) y compara el contador orders_created_total de /metrics antes y después.",
      code: ["internal/orders/domain/order.go (NewOrder)", "internal/orders/domain/rut.go (NormalizeRUT)", "internal/orders/presentation/handler/order_handler.go (decodeJSON)"],
      tests: ["TestNewOrder_Validation", "TestNormalizeRUT", "TestCreateOrder_InvalidRequestsReturn4xx", "TestCreateOrder_InvalidDataCreatesNothing"],
      async run(api) {
        const cases = [
          ["RUT inválido", { customer_id: "12345678-9", items: [{ sku: "A", quantity: 1, unit_price: 100 }] }],
          ["lista vacía", { customer_id: "12345678-5", items: [] }],
          ["cantidad 0", { customer_id: "12345678-5", items: [{ sku: "A", quantity: 0, unit_price: 100 }] }],
          ["precio negativo", { customer_id: "12345678-5", items: [{ sku: "A", quantity: 1, unit_price: -5 }] }],
          ["JSON mal formado", '{"customer_id": '],
        ];
        const before = await api.apiMetrics();
        const results = [];
        for (const [label, body] of cases) results.push(await call(`POST /orders (${label})`, () => api.createOrder(body), body));
        const after = await api.apiMetrics();
        const rejected = results.every((r) => r.status >= 400 && r.status < 500 && r.data?.error?.code);
        const created = after ? delta(before, after, "orders_created_total") : 0;
        const detail = `orders_created_total +${created}`;
        if (!rejected) return fail("Alguno de los pedidos incorrectos no fue rechazado.", detail);
        if (created > 0) return fail(`Se rechazaron, pero se guardaron ${created} pedido(s).`, detail);
        return pass("Los 5 pedidos incorrectos (incluido un RUT inválido) se rechazaron con un mensaje claro, y no se guardó ninguno.", detail);
      },
    },
    {
      level: 1, id: "RF-03", agent: "api", type: "auto",
      plain: "Se puede buscar un pedido",
      title: "Consultar pedido",
      pdf: "GET /orders/{id} devuelve el pedido y estado correctos; un ID inexistente devuelve 404.",
      what: "Crea un pedido, lo busca por su id y busca un UUID inventado.",
      code: ["internal/orders/application/usecase/get_order.go", "internal/orders/infrastructure/postgres_repo.go (FindByID)"],
      tests: ["TestGetOrder (HTTP)", "TestGetOrder (caso de uso)", "TestFindByID_NotFound (integración)"],
      async run(api) {
        const created = await call("POST /orders", () => api.createOrder(SAMPLE, newKey()), SAMPLE);
        ctx.remember(created);
        if (!created.ok) return fail(`No se pudo crear el pedido de prueba (${created.status}).`);
        const found = await call(`GET /orders/${created.data.id}`, () => api.getOrder(created.data.id));
        const missingId = crypto.randomUUID();
        const missing = await call(`GET /orders/${missingId}`, () => api.getOrder(missingId));
        if (!(found.status === 200 && found.data.id === created.data.id)) return fail("No se encontró el pedido recién creado.");
        if (missing.status !== 404) return fail(`El número inventado debía dar 404 y dio ${missing.status}.`);
        return pass("El pedido se encontró con su estado, y el número inventado respondió «No encontrado».", "existente → 200 · inexistente → 404");
      },
    },
    {
      level: 1, id: "Estados", agent: "worker", type: "auto",
      plain: "El pedido avanza por sus 6 estados, con reglas",
      title: "Estados del pedido",
      pdf: "Aclaración del profesor: los estados son en_preparacion, listo_para_despacho, en_transito, entregado, no_entregado y devuelto.",
      what: "Crea un pedido, espera listo_para_despacho y lo lleva por en_transito → no_entregado → en_transito → entregado → devuelto con PATCH /orders/{id}/status. También intenta saltos no permitidos (409) y un estado que no existe (400).",
      code: ["internal/orders/domain/status.go (transitions, TransitionTo)", "internal/orders/application/usecase/change_status.go", "migrations/003_order_statuses.up.sql"],
      tests: ["TestTransitionTo_HappyPath", "TestTransitionTo_InvalidJumps", "TestChangeStatus_FollowsTheRules", "TestChangeStatus (HTTP)"],
      async run(api) {
        const r = await call("POST /orders", () => api.createOrder(SAMPLE, newKey()), SAMPLE);
        ctx.remember(r);
        if (!r.ok) return fail(`No se pudo crear el pedido de prueba (${r.status}).`);
        const id = r.data.id;
        const ready = await waitFor(async () => {
          const g = await api.getOrder(id);
          return g.ok && g.data.status === "listo_para_despacho" ? g : null;
        }, 15000);
        if (!ready) return fail("El pedido no llegó a listo_para_despacho: ¿está encendido el trabajador (worker)?", "", "docker compose start worker");
        ctx.record(`GET /orders/${id}`, ready);

        const patch = (status, why) => call(`PATCH /orders/${shortId(id)}/status → ${status}${why ? ` (${why})` : ""}`, () => api.changeStatus(id, status), { status });
        const steps = [
          ["entregado", 409, "salto no permitido"],
          ["en_transito", 200],
          ["no_entregado", 200],
          ["en_transito", 200, "reintento de entrega"],
          ["entregado", 200],
          ["devuelto", 200],
          ["en_transito", 409, "devuelto es final"],
          ["perdido", 400, "estado que no existe"],
        ];
        const seen = [];
        for (const [status, want, why] of steps) {
          const res = await patch(status, why);
          seen.push(`${status} → ${res.status}`);
          if (res.status !== want) return fail(`Al pedir «${status}» se esperaba ${want} y respondió ${res.status}.`, seen.join(" · "));
        }
        return pass("El pedido recorrió los 6 estados; los saltos no permitidos se rechazaron (409) y el estado inventado también (400).", seen.join(" · "));
      },
    },
    {
      level: 1, id: "RF-04", agent: "postgres", type: "manual",
      plain: "Los pedidos no se pierden al reiniciar",
      title: "Persistencia",
      pdf: "Al reiniciar la API, los pedidos confirmados siguen disponibles. El esquema y las migraciones están versionados.",
      what: "Después de reiniciar el contenedor de la API, busca el último pedido creado.",
      code: ["internal/orders/infrastructure/postgres_repo.go", "migrations/001_create_orders.up.sql", "pkg/database/migrate.go"],
      tests: ["TestOrderSurvivesRestart (integración)", "TestMigrationsCanRunTwice (integración)"],
      steps: [
        ["Haga un pedido (en «Hacer un pedido») o ejecute RF-01."],
        ["Reinicie la API:", "docker compose restart api"],
        ["Espere unos 5 segundos y pulse «Comprobar»."],
      ],
      button: "Comprobar",
      async run(api) {
        if (api.mode === "demo") return info("En modo de prueba no hay base de datos real. Levante el sistema con Docker para hacer esta prueba.");
        const id = ctx.lastId();
        if (!id) return info("Primero haga un pedido (en «Hacer un pedido») o ejecute RF-01.");
        const r = await call(`GET /orders/${id}`, () => api.getOrder(id));
        return r.ok
          ? pass(`El pedido ${id} sigue guardado. Si reinició la API antes de comprobar, esto demuestra que no se pierde.`)
          : fail(`No se encontró el pedido ${id} (${r.status}).`);
      },
    },
    {
      level: 1, id: "RF-05", agent: "api", type: "auto",
      plain: "Los errores se explican sin mostrar secretos",
      title: "Errores",
      pdf: "Los errores se traducen a respuestas HTTP consistentes; las respuestas no exponen credenciales, SQL ni detalles internos.",
      what: "Provoca 3 errores (id inválido, id inexistente, ruta inexistente). Comprueba el formato común {error:{type,code,message}, timestamp} y busca SQL, contraseñas o trazas.",
      code: ["pkg/httputil/error_mapper.go", "pkg/apperrors/apperrors.go", "pkg/middleware/error_handler.go"],
      tests: ["TestDatabaseErrorDoesNotLeakDetails", "TestTimeoutReturns503"],
      async run(api) {
        const missingId = crypto.randomUUID();
        const responses = [
          await call("GET /orders/abc", () => api.getOrder("abc")),
          await call(`GET /orders/${missingId}`, () => api.getOrder(missingId)),
          await call("GET /esta-ruta-no-existe", () => api.notFoundRoute()),
        ];
        const sameShape = responses.every((r) => r.data?.error?.type && r.data.error.code && r.data.error.message && r.data.timestamp);
        const leaks = responses.filter((r) =>
          /select |insert |password|postgres:\/\/|amqp:\/\/|goroutine|panic|\.go:\d/i.test(JSON.stringify(r.data)),
        );
        if (!sameShape) return fail("Algún error no tiene el formato común (tipo, código, mensaje y fecha).");
        if (leaks.length) return fail("Algún error muestra detalles internos.");
        return pass("Los 3 errores tienen el mismo formato y no muestran nada interno.", "formato común: sí · datos internos: ninguno");
      },
    },
    {
      level: 1, id: "RF-06 · 07 · 08", agent: "worker", type: "inspect",
      plain: "Está documentado y tiene pruebas automáticas",
      title: "Configuración, pruebas y README",
      pdf: "RF-06: la configuración se obtiene del entorno; no se incluyen secretos reales. RF-07: existen pruebas unitarias y HTTP. RF-08: un desarrollador puede levantar el sistema siguiendo el README.",
      what: "Se revisa en el repositorio, no desde el navegador.",
      code: ["cmd/config/config.go", ".env.example", "README.md", "docs/01-instalacion.md", "docs/03-pruebas.md"],
      tests: ["TestLoadVars_Defaults", "TestLoadVars_RejectsInvalidValues", "go test ./... (43 pruebas)"],
      steps: [
        ["Pruebas unitarias y HTTP:", "go test ./..."],
        ["Levantar todo el sistema:", "docker compose up -d --build"],
      ],
    },

    // ------------------------------------------------------------- Nivel 2
    {
      level: 2, id: "RF-10", agent: "cliente", type: "auto",
      plain: "Reintentar no duplica el pedido",
      title: "Idempotencia",
      pdf: "Repetir una solicitud con la misma clave de idempotencia no crea pedidos duplicados y devuelve un resultado definido/documentado.",
      what: "Envía el mismo pedido 2 veces seguidas con la misma Idempotency-Key, y luego 5 veces en paralelo con otra clave.",
      code: ["internal/orders/infrastructure/postgres_repo.go (Create: UNIQUE + ON CONFLICT DO NOTHING)", "migrations/001_create_orders.up.sql"],
      tests: ["TestCreateOrder_RetryWithSameKey", "TestCreateOrder_ConcurrentRetriesWithSameKey", "TestConcurrentRequestsWithSameKeyCreateOneOrder (integración)"],
      async run(api) {
        const key = newKey();
        const first = await call(`POST /orders · Idempotency-Key ${key}`, () => api.createOrder(SAMPLE, key), SAMPLE);
        const second = await call(`POST /orders · Idempotency-Key ${key} (repetido)`, () => api.createOrder(SAMPLE, key), SAMPLE);
        ctx.remember(first);
        const key2 = newKey();
        const burst = await Promise.all(
          Array.from({ length: 5 }, (_, i) => call(`POST /orders · Idempotency-Key ${key2} (paralelo ${i + 1}/5)`, () => api.createOrder(SAMPLE, key2), SAMPLE)),
        );
        const ids = new Set(burst.map((r) => r.data?.id));
        const created = burst.filter((r) => r.status === 201).length;
        if (!(first.status === 201 && second.status === 200 && first.data.id === second.data.id)) {
          return fail("Al repetir con la misma clave no se devolvió el mismo pedido.");
        }
        if (ids.size !== 1 || created !== 1) return fail(`Con 5 envíos a la vez se crearon ${ids.size} pedidos distintos.`);
        return pass(
          `Repetido: respondió 201 y luego 200 con el mismo número (${shortId(first.data.id)}). Cinco envíos a la vez: un solo pedido.`,
          `secuencial: 201 → 200, mismo id · paralelo: 1×201 + 4×200, 1 id distinto`,
        );
      },
    },
    {
      level: 2, id: "Límites", agent: "api", type: "auto",
      plain: "Rechaza pedidos exagerados",
      title: "Límites razonables",
      pdf: "Nivel 2: agregar clave de idempotencia, timeouts, límites razonables, manejo explícito de errores y apagado ordenado.",
      what: "Envía un cuerpo de 70 KB (límite 64 KB) y una Idempotency-Key de 129 caracteres (límite 128).",
      code: ["pkg/middleware/request.go (BodyLimit, Timeout)", "internal/orders/application/usecase/create_order.go (MaxIdempotencyKeyLen)"],
      tests: ["TestCreateOrder_InvalidRequestsReturn4xx (body too large)", "TestCreateOrder_KeyTooLong", "TestTimeoutReturns503"],
      async run(api) {
        const huge = JSON.stringify({ customer_id: "x".repeat(70000), items: [] });
        const big = await call("POST /orders (70 KB)", () => api.createOrder(huge), "(cuerpo de 70 KB)");
        const longKey = await call("POST /orders (Idempotency-Key de 129 caracteres)", () => api.createOrder(SAMPLE, "k".repeat(129)), SAMPLE);
        return big.status === 413 && longKey.status === 400
          ? pass("El pedido gigante se rechazó (413) y la clave larga también (400).", "70 KB → 413 · clave 129 → 400")
          : fail("Algún límite no se respetó.");
      },
    },
    {
      level: 2, id: "RF-14", agent: "worker", type: "manual",
      plain: "Se apaga con orden, sin perder trabajo",
      title: "Apagado ordenado",
      pdf: "Ante SIGTERM/SIGINT, la aplicación deja de aceptar trabajo nuevo, intenta completar el trabajo en curso dentro de un límite y cierra recursos.",
      what: "Se demuestra con un script que apaga el worker mientras procesa mensajes.",
      code: ["cmd/api/main.go (signal.NotifyContext)", "cmd/app/run.go (Shutdown)", "pkg/rabbitmq/consumer.go (Run, handle)"],
      tests: ["TestHandle_ShutdownDuringRetriesRequeues", "TestHandle_InFlightWorkFinishesDuringShutdown", "TestHandle_MessageReceivedAfterShutdownIsReturned"],
      steps: [
        ["En Git Bash, en la carpeta del proyecto:", "./scripts/demo.sh shutdown"],
        ["En los logs debe aparecer «shutdown requested, finishing in-flight messages», y los mensajes pendientes siguen en la cola."],
      ],
    },

    // ------------------------------------------------------------- Nivel 3
    {
      level: 3, id: "RF-09", agent: "rabbit", type: "auto",
      plain: "Cada pedido nuevo genera un aviso",
      title: "Evento de pedido",
      pdf: "En el nivel asíncrono, la creación de un pedido produce un evento con ID, tipo, fecha y referencia al pedido.",
      what: "Crea un pedido y compara events_published_total de /metrics antes y después. El evento lleva event_id, event_type, occurred_at y order_id (pkg/events).",
      code: ["pkg/events/events.go (OrderCreated)", "internal/orders/infrastructure/event_publisher.go", "pkg/rabbitmq/publisher.go (publisher confirms)"],
      tests: ["TestCreateOrder_SavesAndPublishesEvent", "TestDecodeOrderCreated", "TestOrderFlow_EndToEnd (integración)"],
      async run(api) {
        const before = await api.apiMetrics();
        if (!before) return fail("No se pudieron leer los contadores de la API (/metrics).");
        const r = await call("POST /orders", () => api.createOrder(SAMPLE, newKey()), SAMPLE);
        ctx.remember(r);
        await sleep(300);
        const after = await api.apiMetrics();
        const published = delta(before, after, "events_published_total");
        const failed = delta(before, after, "events_publish_failed_total");
        const detail = `events_published_total +${published} · events_publish_failed_total +${failed}`;
        if (published >= 1) return pass("Al crear el pedido se publicó el aviso «order.created» en RabbitMQ.", detail);
        if (failed >= 1) return fail("El pedido se guardó, pero el aviso no se pudo publicar (¿RabbitMQ apagado?).", detail);
        return fail("No se registró ninguna publicación.", detail);
      },
    },
    {
      level: 3, id: "RF-12", agent: "worker", type: "auto",
      plain: "El aviso se procesa y el pedido queda listo para despacho",
      title: "Confirmación (ACK)",
      pdf: "Un mensaje solo se confirma cuando el procesamiento requerido terminó correctamente; la política de ACK/NACK y duplicados está documentada.",
      what: "Crea un pedido, espera a que el worker lo pase a listo_para_despacho y comprueba que messages_processed_total del worker sube en 2 (los dos consumidores hicieron ACK).",
      code: ["pkg/rabbitmq/consumer.go (handle: Ack / Nack)", "internal/orders/application/usecase/mark_ready.go", "README.md (política de mensajes)"],
      tests: ["TestHandle_SuccessIsAcked", "TestMarkReady", "TestSend_DuplicateMessageDoesNotSendTwice", "TestMarkReadyTwiceIsSafe (integración)"],
      async run(api) {
        const workerBefore = await api.workerMetrics();
        const r = await call("POST /orders", () => api.createOrder(SAMPLE, newKey()), SAMPLE);
        ctx.remember(r);
        if (!r.ok) return fail(`No se pudo crear el pedido de prueba (${r.status}).`);
        const started = Date.now();
        const confirmed = await waitFor(async () => {
          const g = await api.getOrder(r.data.id);
          return g.ok && g.data.status === "listo_para_despacho" ? g : null;
        }, 15000);
        if (!confirmed) return fail("El pedido siguió en preparación: ¿está encendido el trabajador (worker)?", "", "docker compose start worker");
        ctx.record(`GET /orders/${r.data.id}`, confirmed);
        const secs = ((Date.now() - started) / 1000).toFixed(1);
        if (!workerBefore) return pass(`El trabajador dejó el pedido listo para despacho en ${secs} s.`, "No se pudieron leer los contadores del worker.");
        const acked = await waitFor(async () => delta(workerBefore, await api.workerMetrics(), "messages_processed_total") >= 2, 10000);
        return acked
          ? pass(`El trabajador dejó el pedido listo para despacho en ${secs} s y los dos consumidores dieron el mensaje por terminado.`, `en_preparacion → listo_para_despacho en ${secs} s · messages_processed_total +2`)
          : fail(`El pedido quedó listo para despacho en ${secs} s, pero el consumidor de correo no terminó.`);
      },
    },
    {
      level: 3, id: "RF-11", agent: "email", type: "manual",
      plain: "Si el correo falla, lo reintenta",
      title: "Reintentos",
      pdf: "Los fallos transitorios del consumidor se reintentan con límite y espera creciente; tras agotar los intentos, el mensaje queda registrado para investigación.",
      what: "Con NOTIFIER_FAILURE_RATE=1 el correo simulado falla siempre. Se leen messages_retried_total y messages_dead_lettered_total del worker.",
      code: ["pkg/retry/retry.go (Policy, Backoff, Do)", "pkg/rabbitmq/consumer.go (Nack → DLQ)", "pkg/rabbitmq/rabbitmq.go (DeclareTopology: .dlq)"],
      tests: ["TestBackoff_DoublesUpToMax", "TestHandle_ExhaustedRetriesGoToDLQ", "TestFailingMessageEndsInDLQ (integración)"],
      steps: [
        ["Haga que el correo falle siempre (PowerShell):", "$env:NOTIFIER_FAILURE_RATE=1; docker compose up -d worker"],
        ["Haga un pedido (en «Hacer un pedido»), espere unos 5 segundos y pulse «Comprobar»."],
        ["Para volver a la normalidad:", "Remove-Item Env:NOTIFIER_FAILURE_RATE; docker compose up -d worker"],
      ],
      button: "Comprobar",
      async run(api) {
        const m = await api.workerMetrics();
        if (!m) return fail("No se pudo consultar al trabajador (¿está encendido?).", "", "docker compose start worker");
        const retried = m.messages_retried_total ?? 0;
        const dead = m.messages_dead_lettered_total ?? 0;
        const detail = `messages_retried_total = ${retried} · messages_dead_lettered_total = ${dead}`;
        ctx.note(`GET /worker/metrics → ${detail}`);
        if (retried > 0) {
          return pass(`El trabajador reintentó ${retried} vez/veces${dead ? ` y ${dead} mensaje(s) quedaron guardados para revisión (DLQ)` : ""}.`, detail);
        }
        return info("Todavía no hubo fallos, así que no hizo falta reintentar. Siga los pasos para provocarlos.", detail);
      },
    },

    // ------------------------------------------------------------- Nivel 4
    {
      level: 4, id: "RF-13", agent: "api", type: "auto",
      plain: "Cada petición se puede seguir",
      title: "Observabilidad",
      pdf: "Los logs son estructurados y contienen correlación suficiente para seguir una solicitud o evento sin registrar datos sensibles.",
      what: "Envía un X-Request-ID propio y comprueba que la API lo devuelve. Ese id aparece en los logs JSON de la API y, como correlation_id, en los del worker.",
      code: ["pkg/middleware/request.go (RequestID, AccessLog)", "pkg/correlation/correlation.go", "pkg/logger/logger.go (zap JSON)"],
      tests: ["TestCreateOrder_Returns201 (cabecera X-Request-ID)"],
      async run(api) {
        const id = "prueba-" + crypto.randomUUID().slice(0, 6);
        const r = await call(`GET /health · X-Request-ID: ${id}`, () => api.ping(id));
        return r.requestId === id
          ? pass(`La API devolvió el mismo código de seguimiento (${id}). Con él se encuentran sus pasos en los registros:`, `enviado ${id} → devuelto ${r.requestId}`, `docker compose logs api worker | Select-String "${id}"`)
          : fail(`Se envió ${id} y la API devolvió ${r.requestId ?? "nada"}.`);
      },
    },
    {
      level: 4, id: "Salud", agent: "postgres", type: "auto",
      plain: "El sistema informa si está sano",
      title: "Health y readiness",
      pdf: "Nivel 4: agregar logs estructurados, correlación, métricas básicas, health/readiness checks y documentación de ejecución local.",
      what: "Consulta /health y /ready de la API, y /health del worker.",
      code: ["internal/health/presentation/handler/health.go", "internal/health/presentation/router/health.go"],
      tests: ["TestReady", "TestLive"],
      async run(api) {
        const health = await call("GET /health", () => api.health());
        const ready = await call("GET /ready", () => api.ready());
        const worker = await call("GET /worker/health", () => api.workerHealth()).catch(() => ({ ok: false, status: "sin respuesta" }));
        if (!health.ok) return fail("La API no responde.");
        if (!ready.ok) return fail("La API está viva, pero la base de datos no responde.", "", "docker compose start postgres");
        if (!worker.ok) return fail("La API está bien, pero el trabajador no responde.", "", "docker compose start worker");
        return pass("La API, la base de datos y el trabajador responden.", "API /health 200 · API /ready 200 · worker /health 200");
      },
    },
    {
      level: 4, id: "Métricas", agent: "rabbit", type: "auto",
      plain: "Lleva la cuenta de lo que hace",
      title: "Métricas básicas",
      pdf: "Nivel 4: métricas básicas.",
      what: "Lee /metrics de la API y del worker (expvar, JSON).",
      code: ["pkg/metrics/metrics.go"],
      tests: [],
      async run(api) {
        const a = await api.apiMetrics();
        const w = await api.workerMetrics();
        if (!a) return fail("No se pudieron leer los contadores de la API.");
        const detail = Object.entries({ ...a, ...(w ?? {}) }).map(([k, v]) => `${k}=${v}`).join(" · ");
        ctx.note(`GET /metrics + /worker/metrics → ${detail}`);
        return pass(
          `Pedidos creados: ${a.orders_created_total ?? 0}. Mensajes procesados por el trabajador: ${w?.messages_processed_total ?? "sin datos"}.`,
          detail,
        );
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Dibujo

const ICON = { pass: "✓", fail: "✗", info: "i", idle: "", running: "" };
const LABEL = { pass: "Cumple", fail: "No cumple", info: "Falta un paso", idle: "Sin probar", running: "Probando…" };

function commandBox(command) {
  const box = el("div", "cmd");
  const btn = el("button", "btn copy-btn", "Copiar");
  btn.type = "button";
  btn.addEventListener("click", () => copy(command, "Comando copiado"));
  box.append(el("code", "", command), btn);
  return box;
}

function badge(state) {
  const b = el("span", "badge");
  b.dataset.state = state;
  b.append(el("span", "badge-icon", ICON[state]), el("span", "", LABEL[state]));
  return b;
}

/** Fila del resumen simple. */
function simpleRow(check, onRun) {
  const row = el("li", "srow");
  row.dataset.state = check.type === "auto" ? "idle" : "info";
  const icon = el("span", "srow-icon");
  icon.setAttribute("aria-hidden", "true");
  const body = el("div", "srow-body");
  const msg = el(
    "p",
    "srow-msg",
    check.type === "inspect"
      ? "Lo revisa el equipo técnico en el código. Detalle en el resumen técnico."
      : check.type === "manual"
        ? "Se comprueba con un paso extra. Detalle en el resumen técnico."
        : "Pulse «Probar» o «Probar todo».",
  );
  body.append(el("h4", "", check.plain), msg);
  row.append(icon, body);
  if (check.run) {
    const btn = el("button", "btn srow-btn", check.button ?? "Probar");
    btn.type = "button";
    btn.addEventListener("click", () => onRun(check));
    row.append(btn);
  }
  return row;
}

/** Ficha del resumen técnico. */
function techCard(check, onRun) {
  const card = el("article", "tcard");
  const head = el("header", "tcard-head");
  const title = el("div", "tcard-title");
  title.append(el("span", "rf", check.id), el("h4", "", check.title));
  head.append(title, badge(check.type === "auto" ? "idle" : "info"));
  if (check.run) {
    const btn = el("button", "btn tcard-btn", check.button ?? "Ejecutar");
    btn.type = "button";
    btn.addEventListener("click", () => onRun(check));
    head.append(btn);
  }

  const dl = el("dl", "tcard-grid");
  const row = (label, ...content) => {
    dl.append(el("dt", "", label));
    const dd = el("dd");
    dd.append(...content);
    dl.append(dd);
    return dd;
  };
  row("Criterio del PDF", el("blockquote", "pdf-quote", check.pdf));
  row("Cómo se comprueba", el("p", "", check.what));
  const result = row("Resultado", el("p", "muted", check.run ? "Sin ejecutar." : "Revisión manual."));
  result.classList.add("tcard-result");
  const evidence = row("Evidencia", el("p", "muted", check.run ? "Se completa al ejecutar." : "—"));
  evidence.classList.add("tcard-evidence");
  if (check.steps) {
    const ol = el("ol", "tsteps");
    for (const [text, command] of check.steps) {
      const li = el("li", "", text);
      if (command) li.append(commandBox(command));
      ol.append(li);
    }
    row("Pasos", ol);
  }
  const files = el("ul", "mono-list");
  check.code.forEach((f) => files.append(el("li", "", f)));
  row("Código", files);
  if (check.tests.length) {
    const tests = el("ul", "mono-list chips");
    check.tests.forEach((t) => tests.append(el("li", "", t)));
    row("Pruebas en Go", tests);
  }
  card.append(head, dl);
  return card;
}

/** Tabla de evidencia: cada petición con su respuesta. */
function evidenceTable(entries) {
  if (!entries.length) return el("p", "muted", "Sin peticiones registradas.");
  const wrap = el("div", "evidence");
  for (const e of entries) {
    if (e.note) {
      wrap.append(el("p", "ev-note", e.note));
      continue;
    }
    const item = el("details", "ev");
    const sum = el("summary");
    const status = el("span", "ev-status", String(e.status));
    status.dataset.ok = String(e.status < 400);
    sum.append(status, el("span", "ev-req", e.label), el("span", "ev-meta", `${e.ms} ms${e.requestId ? ` · X-Request-ID ${e.requestId}` : ""}`));
    item.append(sum);
    if (e.body !== undefined) {
      item.append(el("p", "ev-title", "Petición"), el("pre", "", typeof e.body === "string" ? e.body.slice(0, 600) : JSON.stringify(e.body, null, 2)));
    }
    item.append(el("p", "ev-title", "Respuesta"), el("pre", "", typeof e.data === "string" ? e.data.slice(0, 1200) : JSON.stringify(e.data, null, 2)));
    wrap.append(item);
  }
  return wrap;
}

// ---------------------------------------------------------------------------

export function setupChecks({ swarm, conn, workshop }) {
  const $ = (id) => document.getElementById(id);
  const simpleRoot = $("checks-simple");
  const techRoot = $("checks-tech");
  const summary = $("checks-summary");
  const runAll = $("run-all");
  let lastId = null;
  let running = false;
  let evidence = null; // peticiones de la prueba en curso
  const outcomes = new Map(); // check.id -> { outcome, evidence, at }
  const views = new Map(); // check.id -> { row, card }

  workshop.onOrder((order) => (lastId = order.id));

  const ctx = {
    lastId: () => lastId,
    remember(res) {
      if (res?.status === 201 && res.data?.id) lastId = res.data.id;
    },
    /** Hace una petición, la guarda como evidencia y la deja en la consola técnica. */
    async call(label, fn, body) {
      workshop.logLine("req", `${label} (prueba del PDF)`, body);
      const res = await fn();
      workshop.logResponse(label, res);
      ctx.record(label, res, body);
      return res;
    },
    record(label, res, body) {
      evidence?.push({ label, body, status: res.status, ms: res.ms, requestId: res.requestId, data: res.data });
    },
    note(text) {
      evidence?.push({ note: text });
    },
  };
  const checks = buildChecks(ctx);

  // ------------------------------------------------------------ pestañas
  const tabs = [$("tab-simple"), $("tab-tech")];
  function selectTab(tab) {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      $(t.getAttribute("aria-controls")).hidden = !on;
    }
  }
  tabs.forEach((t, i) => {
    t.addEventListener("click", () => selectTab(t));
    t.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
      next.focus();
      selectTab(next);
    });
  });

  // --------------------------------------------------------- resultados
  function show(check, state, outcome) {
    const { row, card } = views.get(check.id);
    row.dataset.state = state;
    card.dataset.state = state;
    card.querySelector(".badge").replaceWith(badge(state));
    const rowBtn = row.querySelector(".srow-btn");
    const cardBtn = card.querySelector(".tcard-btn");
    for (const b of [rowBtn, cardBtn]) {
      if (!b) continue;
      b.disabled = state === "running";
      b.textContent = state === "running" ? "Probando…" : outcome ? "Repetir" : b === rowBtn ? check.button ?? "Probar" : check.button ?? "Ejecutar";
    }
    if (state === "running") {
      row.querySelector(".srow-msg").textContent = "Probando, espere unos segundos…";
      return;
    }
    if (!outcome) return;

    // En el resumen simple no se muestran comandos: se avisa dónde están.
    row.querySelector(".srow-msg").textContent = outcome.command
      ? outcome.message.replace(/:\s*$/, ".") + " El comando está en el resumen técnico."
      : outcome.message;
    const res = card.querySelector(".tcard-result");
    res.replaceChildren(el("p", "", outcome.message));
    if (outcome.detail) res.append(el("p", "mono-detail", outcome.detail));
    if (outcome.command) res.append(commandBox(outcome.command));
    const ev = card.querySelector(".tcard-evidence");
    const stored = outcomes.get(check.id);
    ev.replaceChildren(
      el("p", "ev-when", `${stored.mode === "real" ? "API real" : "Modo de prueba (simulado)"} · ${stored.at.toLocaleString("es-CL")}`),
      evidenceTable(stored.evidence),
    );
  }

  function updateSummary() {
    const autos = checks.filter((c) => c.type === "auto");
    const done = autos.filter((c) => outcomes.has(c.id));
    const ok = done.filter((c) => outcomes.get(c.id).outcome.result === "pass").length;
    const others = checks.length - autos.length;
    if (!done.length) {
      summary.dataset.state = "";
      summary.textContent = "Todavía no se ha probado nada. Pulse «Probar todo».";
      return;
    }
    summary.dataset.state = ok === done.length ? "pass" : "fail";
    summary.textContent =
      `${ok} de ${done.length} pruebas automáticas cumplen` +
      (done.length < autos.length ? ` (faltan ${autos.length - done.length})` : "") +
      `. Otras ${others} se revisan con un paso extra o en el código.`;
  }

  // Quien llama (runOne o "Probar todo") se asegura de que no corran dos a la vez.
  async function runCheck(check) {
    const { row } = views.get(check.id);
    const anchor = row.offsetParent ? row : views.get(check.id).card;
    show(check, "running");
    swarm.busy(check.agent, true);
    evidence = [];
    let outcome;
    try {
      await swarm.moveToEl(check.agent, anchor, { dx: 0.85, dy: 0.5 });
      await swarm.click(check.agent);
      swarm.say(check.agent, "probando…");
      outcome = await check.run(conn.api);
    } catch (err) {
      outcome = fail("No se pudo hablar con la API. Revise que el sistema esté encendido.", err.message);
      conn.check();
    } finally {
      outcomes.set(check.id, { outcome, evidence, at: new Date(), mode: conn.api.mode });
      evidence = null;
      show(check, outcome.result, outcome);
      swarm.say(check.agent, null);
      swarm.busy(check.agent, false);
      updateSummary();
    }
  }

  async function runOne(check) {
    if (running) return;
    running = true;
    await runCheck(check);
    running = false;
  }

  // --------------------------------------------------------- dibujar todo
  for (const level of LEVELS) {
    const levelChecks = checks.filter((c) => c.level === level.n);

    const sGroup = el("section", "slevel card");
    const sTitle = el("h3", "level-title", level.title);
    const sList = el("ul", "srows");
    sGroup.append(sTitle, el("p", "level-sub", level.sub), sList);

    const tGroup = el("section", "tlevel");
    const tTitle = el("h3", "level-title", level.title);
    tGroup.append(tTitle);

    for (const check of levelChecks) {
      const row = simpleRow(check, runOne);
      const card = techCard(check, runOne);
      card.dataset.state = row.dataset.state;
      views.set(check.id, { row, card });
      sList.append(row);
      tGroup.append(card);
    }
    simpleRoot.append(sGroup);
    techRoot.append(tGroup);
  }

  runAll.addEventListener("click", async () => {
    if (running) return;
    running = true;
    runAll.disabled = true;
    runAll.textContent = "Probando…";
    for (const check of checks.filter((c) => c.type === "auto")) {
      const { row, card } = views.get(check.id);
      (row.offsetParent ? row : card).scrollIntoView({ behavior: "smooth", block: "center" });
      await runCheck(check);
    }
    runAll.disabled = false;
    runAll.textContent = "Probar todo otra vez";
    running = false;
    summary.scrollIntoView({ behavior: "smooth", block: "center" });
  });

  // ------------------------------------------------- informe en Markdown
  $("copy-report").addEventListener("click", () => {
    const icon = { pass: "✅ Cumple", fail: "❌ No cumple", info: "ℹ️ Falta un paso" };
    const lines = [
      "# Informe de verificación · EventFlow",
      "",
      `Fecha: ${new Date().toLocaleString("es-CL")} · Conexión: ${conn.api.mode === "real" ? "API real (localhost:3200)" : "modo de prueba (simulado)"}`,
      "",
      `Resumen: ${summary.textContent}`,
      "",
      "| Requisito | Resultado | Detalle |",
      "|---|---|---|",
    ];
    for (const c of checks) {
      const o = outcomes.get(c.id)?.outcome;
      const result = o ? icon[o.result] : c.type === "auto" ? "Sin probar" : "Revisión manual";
      lines.push(`| ${c.id} · ${c.title} | ${result} | ${(o?.message ?? c.what).replace(/\|/g, "\\|")} |`);
    }
    lines.push("", "## Evidencia");
    for (const c of checks) {
      const stored = outcomes.get(c.id);
      lines.push("", `### ${c.id} · ${c.title}`, "", `> ${c.pdf}`, "");
      if (stored) {
        for (const e of stored.evidence) {
          lines.push(e.note ? `- ${e.note}` : `- \`${e.label}\` → **${e.status}** (${e.ms} ms${e.requestId ? `, X-Request-ID \`${e.requestId}\`` : ""})`);
        }
        if (stored.outcome.detail) lines.push(`- ${stored.outcome.detail}`);
      } else {
        lines.push("- Sin ejecutar.");
      }
      lines.push(`- Código: ${c.code.map((f) => `\`${f}\``).join(", ")}`);
      if (c.tests.length) lines.push(`- Pruebas en Go: ${c.tests.map((t) => `\`${t}\``).join(", ")}`);
    }
    copy(lines.join("\n"), "Informe copiado");
  });

  updateSummary();
}
