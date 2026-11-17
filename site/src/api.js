// Cliente de la API de EventFlow, en dos versiones con la misma forma:
//   realApi(): habla con la API en Go (por el proxy de Vite: /api y /worker)
//   demoApi(): la imita en el navegador, para usar el sitio sin backend
//
// Cada llamada devuelve { status, ok, data, requestId, ms }.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function realApi({ api = "/api", worker = "/worker" } = {}) {
  async function call(method, url, { body, headers = {} } = {}) {
    const started = performance.now();
    const res = await fetch(url, {
      method,
      headers: body === undefined ? headers : { "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    const text = await res.text();
    let data = text;
    try {
      data = JSON.parse(text);
    } catch {
      /* no era JSON: se deja como texto */
    }
    return {
      status: res.status,
      ok: res.ok,
      data,
      requestId: res.headers.get("X-Request-ID"),
      ms: Math.round(performance.now() - started),
    };
  }

  // Las métricas son contadores; si no se pueden leer, devolvemos null.
  const metrics = (url) => call("GET", url).then((r) => (r.ok && typeof r.data === "object" ? r.data : null)).catch(() => null);

  return {
    mode: "real",
    health: () => call("GET", `${api}/health`),
    ready: () => call("GET", `${api}/ready`),
    workerHealth: () => call("GET", `${worker}/health`),
    /** GET /health enviando nuestro propio X-Request-ID (la API debe devolver el mismo). */
    ping: (requestId) => call("GET", `${api}/health`, { headers: { "X-Request-ID": requestId } }),
    notFoundRoute: () => call("GET", `${api}/esta-ruta-no-existe`),
    createOrder: (body, key) => call("POST", `${api}/orders`, { body, headers: key ? { "Idempotency-Key": key } : {} }),
    getOrder: (id) => call("GET", `${api}/orders/${encodeURIComponent(id)}`),
    changeStatus: (id, status) => call("PATCH", `${api}/orders/${encodeURIComponent(id)}/status`, { body: { status } }),
    apiMetrics: () => metrics(`${api}/metrics`),
    workerMetrics: () => metrics(`${worker}/metrics`),
  };
}

// ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Igual que internal/orders/domain/status.go: a qué estados se puede pasar desde cada uno. */
export const TRANSITIONS = {
  en_preparacion: ["listo_para_despacho"],
  listo_para_despacho: ["en_transito"],
  en_transito: ["entregado", "no_entregado"],
  no_entregado: ["en_transito", "devuelto"],
  entregado: ["devuelto"],
  devuelto: [],
};

/** Igual que internal/orders/domain/rut.go: valida el RUT y lo devuelve como 12345678-5 (o null). */
export function normalizeRUT(raw) {
  const clean = String(raw ?? "").replace(/[.\s-]/g, "").toUpperCase();
  if (clean.length < 2 || clean.length > 9) return null;
  const body = clean.slice(0, -1);
  const dv = clean.slice(-1);
  if (!/^[1-9][0-9]*$/.test(body)) return null;
  let sum = 0;
  let factor = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const d = 11 - (sum % 11);
  const expected = d === 11 ? "0" : d === 10 ? "K" : String(d);
  return dv === expected ? `${body}-${dv}` : null;
}

/** Las mismas reglas que internal/orders/domain/order.go. */
function validate(body) {
  const allowed = ["customer_id", "items"];
  if (!body || typeof body !== "object" || Object.keys(body).some((k) => !allowed.includes(k))) {
    return ["INVALID_JSON", "request body must be a valid JSON order"];
  }
  if (!normalizeRUT(body.customer_id)) return ["ORDER_INVALID_CUSTOMER", "customer_id must be a valid Chilean RUT, for example 12345678-5"];
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) return ["ORDER_EMPTY_ITEMS", "items must contain at least one item"];
  if (items.length > 100) return ["ORDER_TOO_MANY_ITEMS", "items must contain at most 100 items"];
  for (const [i, it] of items.entries()) {
    if (!String(it.sku ?? "").trim()) return ["ORDER_INVALID_SKU", `items[${i}].sku is required`];
    if (!Number.isInteger(it.quantity) || it.quantity < 1 || it.quantity > 10000) {
      return ["ORDER_INVALID_QUANTITY", `items[${i}].quantity must be between 1 and 10000`];
    }
    if (!Number.isInteger(it.unit_price) || it.unit_price < 1 || it.unit_price > 100000000) {
      return ["ORDER_INVALID_PRICE", `items[${i}].unit_price must be between 1 and 100000000`];
    }
  }
  return null;
}

export function demoApi() {
  const orders = new Map(); // id -> pedido
  const keys = new Map(); // Idempotency-Key -> id
  const api = { orders_created_total: 0, orders_idempotent_replays_total: 0, events_published_total: 0, events_publish_failed_total: 0 };
  const worker = { messages_processed_total: 0, messages_retried_total: 0, messages_dead_lettered_total: 0, messages_duplicated_total: 0 };

  async function reply(status, data, requestId = crypto.randomUUID()) {
    const started = performance.now();
    await sleep(40 + Math.random() * 110); // latencia de red simulada
    return {
      status,
      ok: status < 400,
      data: structuredClone(data),
      requestId,
      ms: Math.round(performance.now() - started),
    };
  }

  const error = (type, code, message) => ({ error: { type, code, message }, timestamp: new Date().toISOString() });

  // Lo que harían los dos consumidores del worker con el evento order.created.
  function processInBackground(order) {
    setTimeout(() => {
      if (order.status !== "en_preparacion") return; // alguien ya lo movió a mano
      order.status = "listo_para_despacho";
      order.next_statuses = [...TRANSITIONS.listo_para_despacho];
      order.updated_at = new Date().toISOString();
      worker.messages_processed_total++;
    }, 900 + Math.random() * 600);
    setTimeout(() => {
      if (Math.random() < 0.3) {
        worker.messages_retried_total++; // el email simulado falló una vez
        setTimeout(() => worker.messages_processed_total++, 700);
      } else {
        worker.messages_processed_total++;
      }
    }, 1100 + Math.random() * 500);
  }

  return {
    mode: "demo",
    health: () => reply(200, { status: "up" }),
    ready: () => reply(200, { status: "up", database: "up" }),
    workerHealth: () => reply(200, { status: "up" }),
    // Igual que pkg/correlation: se acepta si es corto y con caracteres seguros.
    ping: (requestId) => reply(200, { status: "up" }, /^[A-Za-z0-9._-]{1,64}$/.test(requestId) ? requestId : crypto.randomUUID()),
    notFoundRoute: () => reply(404, error("NOT_FOUND", "ROUTE_NOT_FOUND", "Route not found")),

    async createOrder(body, key) {
      const size = typeof body === "string" ? body.length : JSON.stringify(body).length;
      if (size > 65536) {
        return reply(413, error("PAYLOAD_TOO_LARGE", "PAYLOAD_TOO_LARGE", "request body must not exceed 65536 bytes"));
      }
      if (typeof body === "string") {
        try {
          body = JSON.parse(body);
        } catch {
          return reply(400, error("VALIDATION_ERROR", "INVALID_JSON", "request body must be a valid JSON order"));
        }
      }
      if (key && key.length > 128) {
        return reply(400, error("VALIDATION_ERROR", "IDEMPOTENCY_KEY_INVALID", "Idempotency-Key must be at most 128 characters"));
      }
      const problem = validate(body);
      if (problem) return reply(400, error("VALIDATION_ERROR", ...problem));
      if (key && keys.has(key)) {
        api.orders_idempotent_replays_total++;
        return reply(200, orders.get(keys.get(key)));
      }

      const now = new Date().toISOString();
      const items = body.items.map((it) => ({ ...it, subtotal: it.quantity * it.unit_price }));
      const order = {
        currency: "CLP",
        id: crypto.randomUUID(),
        customer_id: normalizeRUT(body.customer_id),
        status: "en_preparacion",
        next_statuses: [...TRANSITIONS.en_preparacion],
        total: items.reduce((sum, it) => sum + it.subtotal, 0),
        items,
        created_at: now,
        updated_at: now,
      };
      orders.set(order.id, order);
      if (key) keys.set(key, order.id);
      api.orders_created_total++;
      api.events_published_total++;
      processInBackground(order);
      return reply(201, order);
    },

    getOrder(id) {
      if (!UUID.test(id)) return reply(400, error("VALIDATION_ERROR", "ORDER_INVALID_ID", "order id must be a valid UUID"));
      if (!orders.has(id)) return reply(404, error("NOT_FOUND", "ORDER_NOT_FOUND", "order not found"));
      return reply(200, orders.get(id));
    },

    async changeStatus(id, status) {
      if (!UUID.test(id)) return reply(400, error("VALIDATION_ERROR", "ORDER_INVALID_ID", "order id must be a valid UUID"));
      if (!(status in TRANSITIONS)) {
        return reply(400, error("VALIDATION_ERROR", "ORDER_INVALID_STATUS", "status must be one of: " + Object.keys(TRANSITIONS).join(", ")));
      }
      const order = orders.get(id);
      if (!order) return reply(404, error("NOT_FOUND", "ORDER_NOT_FOUND", "order not found"));
      if (!TRANSITIONS[order.status].includes(status)) {
        return reply(409, error("CONFLICT", "ORDER_INVALID_TRANSITION", `order cannot change from ${order.status} to ${status}`));
      }
      order.status = status;
      order.next_statuses = [...TRANSITIONS[status]];
      order.updated_at = new Date().toISOString();
      return reply(200, order);
    },

    apiMetrics: async () => ({ ...api }),
    workerMetrics: async () => ({ ...worker }),
  };
}

// ---------------------------------------------------------------------------

/**
 * La conexión que usa el sitio: la API real si responde; si no, el modo demo.
 * check() vuelve a probar (por ejemplo, después de levantar docker compose).
 */
export function createConnection() {
  const real = realApi();
  const demo = demoApi();
  const listeners = [];
  const conn = {
    api: demo,
    workerUp: false,
    onChange: (fn) => listeners.push(fn),
    async check() {
      const up = await real.health().then((r) => r.ok && r.data?.status === "up").catch(() => false);
      conn.api = up ? real : demo;
      conn.workerUp = up ? await real.workerHealth().then((r) => r.ok).catch(() => false) : true;
      listeners.forEach((fn) => fn(conn));
      return conn;
    },
  };
  return conn;
}
