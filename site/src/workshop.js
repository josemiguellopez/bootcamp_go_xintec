// Hacer un pedido: el formulario en 3 pasos, la boleta, los seis pasos del
// recorrido y la consola técnica. Cada paso usa la respuesta REAL de la API
// (o la del modo de prueba):
//   2 API        -> respuesta del POST /orders
//   4 RabbitMQ   -> el contador events_published_total de /metrics subió
//   5 Worker     -> GET /orders/{id} hasta ver listo_para_despacho
//   6 Email      -> el contador messages_processed_total del worker subió

import { EXPLAIN, STATUS, copy, el, money, newKey, renderProblem, shortId, toast } from "./ui.js";
import { formatRUT, renderReceipt } from "./boleta.js";
import { PRODUCTS } from "./products.js";
import { normalizeRUT } from "./api.js";
import { thickCaret } from "./caret.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const delta = (before, after, name) => (after?.[name] ?? 0) - (before?.[name] ?? 0);
const seconds = (ms) => (ms / 1000).toLocaleString("es-CL", { maximumFractionDigits: 1 });
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// RUT válidos (dígito verificador correcto) para cuando un agente arma el pedido.
const RUTS = ["11.111.111-1", "22.222.222-2", "12.345.678-5", "7.654.321-6", "10.000.013-K"];

export function setupWorkshop({ swarm, conn, onSearch }) {
  const $ = (id) => document.getElementById(id);
  const form = $("order-form");
  const done = $("order-done");
  const catalog = $("catalog");
  const customer = $("customer");
  const sendBtn = $("send");
  const modeAgent = $("mode-agent");
  const receipt = $("receipt");
  const progress = $("progress");
  const log = $("log");
  const cart = new Map(PRODUCTS.map((p) => [p.sku, 0]));
  let busy = false; // hay un pedido en camino (el envío y el seguimiento)
  let lastOrder = null; // { id, key, body }
  const orderListeners = [];

  /** Reinicia una animación CSS (quitar y volver a poner la clase). */
  function replay(node, cls) {
    node.classList.remove(cls);
    void node.offsetWidth;
    node.classList.add(cls);
  }

  // ------------------------------------------------------------- catálogo

  function renderCatalog() {
    catalog.replaceChildren(
      ...PRODUCTS.map((p) => {
        const li = el("li", "product");
        li.dataset.sku = p.sku;
        const mark = el("span", "product-mark", p.mark);
        mark.setAttribute("aria-hidden", "true");
        const info = el("span", "product-info");
        info.append(el("strong", "", p.name), el("span", "price", money(p.price)));
        const qty = el("span", "qty");
        const minus = el("button", "qty-btn", "−");
        const plus = el("button", "qty-btn plus", "+");
        minus.type = plus.type = "button";
        minus.dataset.delta = "-1";
        plus.dataset.delta = "1";
        minus.setAttribute("aria-label", `Quitar ${p.name}`);
        plus.setAttribute("aria-label", `Agregar ${p.name}`);
        const out = el("output", "", "0");
        out.setAttribute("aria-label", `Cantidad de ${p.name}`);
        qty.append(minus, out, plus);
        li.append(mark, info, qty);
        return li;
      }),
    );
    refreshCart();
  }

  /** Cuántas unidades hay en el carrito. */
  const cartUnits = () => [...cart.values()].reduce((sum, n) => sum + n, 0);
  const cartTotal = () => PRODUCTS.reduce((sum, p) => sum + cart.get(p.sku) * p.price, 0);

  function refreshCart() {
    const lines = $("cart-lines");
    lines.replaceChildren();
    for (const p of PRODUCTS) {
      const n = cart.get(p.sku);
      const li = catalog.querySelector(`[data-sku="${p.sku}"]`);
      li.querySelector("output").textContent = n;
      li.classList.toggle("in-cart", n > 0);
      li.querySelector('[data-delta="-1"]').disabled = n === 0;
      if (n > 0) {
        const line = el("li");
        line.append(el("span", "", `${p.name} × ${n}`), el("span", "", money(n * p.price)));
        lines.append(line);
      }
    }
    if (!lines.children.length) lines.append(el("li", "summary-empty", "Todavía no ha elegido productos."));
    const units = cartUnits();
    $("total").textContent = money(cartTotal());
    $("cart-count").textContent = units ? `(${units} ${units === 1 ? "producto" : "productos"})` : "(vacío)";
    $("cart-items").dataset.empty = String(units === 0);
    updateSendButton();
  }

  // ------------------------------------------------------------- el carrito
  // Cada producto del carrito es una "ficha" dentro del canasto (☕ ×2). Al agregar,
  // el producto vuela desde su fila y entra por arriba; al quitar, salta fuera del
  // canasto de vuelta a su fila.

  const cartItems = $("cart-items");
  const basket = cartItems.closest(".cart-basket");
  const markOf = (sku) => catalog.querySelector(`[data-sku="${sku}"] .product-mark`);
  const chipOf = (sku) => cartItems.querySelector(`[data-sku="${sku}"]`);

  function ensureChip(sku) {
    let chip = chipOf(sku);
    if (!chip) {
      const p = PRODUCTS.find((x) => x.sku === sku);
      chip = el("span", "cart-chip");
      chip.dataset.sku = sku;
      chip.title = p.name;
      chip.append(el("span", "cart-chip-icon", p.mark), el("b", "", "×0"));
      cartItems.append(chip);
    }
    return chip;
  }

  function setBadge(chip, n) {
    chip.querySelector("b").textContent = `×${n}`;
    replay(chip.querySelector("b"), "pop");
  }

  /** Vacía el canasto (las fichas saltan fuera). */
  function emptyBasket() {
    for (const chip of cartItems.querySelectorAll(".cart-chip")) {
      chip.classList.add("out");
      setTimeout(() => chip.remove(), reduceMotion ? 0 : 380);
    }
  }

  /** Un producto que viaja por el aire de un elemento a otro, pasando por "via". */
  function flight(emoji, fromEl, toEl, via) {
    const from = fromEl.getBoundingClientRect();
    const to = toEl.getBoundingClientRect();
    const start = { x: from.left + from.width / 2 - 20, y: from.top + from.height / 2 - 20 };
    const end = { x: to.left + to.width / 2 - 20, y: to.top + to.height / 2 - 20 };
    const mid = via(start, end);
    const ghost = el("span", "fly", emoji);
    ghost.style.left = `${start.x}px`;
    ghost.style.top = `${start.y}px`;
    document.body.append(ghost);
    const at = (p, scale, rot) => `translate(${p.x - start.x}px, ${p.y - start.y}px) scale(${scale}) rotate(${rot}deg)`;
    return ghost
      .animate(
        [
          { transform: at(start, 1, 0) },
          { transform: at(mid, 1.15, -10), offset: 0.55 },
          { transform: at(end, 0.8, 0) },
        ],
        { duration: 620, easing: "cubic-bezier(.4,0,.3,1)" },
      )
      .finished.catch(() => {})
      .finally(() => ghost.remove());
  }

  /** Agregar: el producto entra al canasto por arriba y su ficha suma uno. */
  async function animateAdd(sku) {
    const chip = ensureChip(sku);
    const isNew = !chip.dataset.shown;
    if (!reduceMotion) {
      if (isNew) chip.style.visibility = "hidden";
      const opening = basket.getBoundingClientRect();
      // sube sobre la boca del canasto y cae dentro
      await flight(markOf(sku).textContent, markOf(sku), chip, (a, b) => ({ x: b.x, y: Math.min(a.y, opening.top) - 70 }));
    }
    if (!chip.isConnected) return; // se vació mientras volaba
    chip.style.visibility = "";
    chip.dataset.shown = "1";
    if (isNew) replay(chip, "in");
    setBadge(chip, cart.get(sku));
    replay(basket, "bounce");
  }

  /** Quitar: el producto salta fuera del canasto y vuelve a su fila. */
  function animateRemove(sku) {
    const chip = chipOf(sku);
    if (!chip) return;
    const n = cart.get(sku);
    replay(basket, "shake");
    if (!reduceMotion) {
      flight(chip.querySelector(".cart-chip-icon").textContent, chip, markOf(sku), (a, b) => ({ x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - 90 }));
    }
    if (n === 0) {
      chip.classList.add("out");
      setTimeout(() => chip.remove(), reduceMotion ? 0 : 380);
    } else {
      setBadge(chip, n);
    }
  }

  function change(sku, d) {
    const before = cart.get(sku);
    cart.set(sku, Math.max(0, Math.min(99, before + d)));
    const after = cart.get(sku);
    if (after === before) return;
    refreshCart();
    if (!reduceMotion) replay(catalog.querySelector(`[data-sku="${sku}"] output`), "pop");
    if (after > before) animateAdd(sku);
    else animateRemove(sku);
  }

  catalog.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-delta]");
    if (btn && !form.inert) change(btn.closest("[data-sku]").dataset.sku, Number(btn.dataset.delta));
  });

  function currentBody() {
    return {
      customer_id: customer.value,
      items: PRODUCTS.filter((p) => cart.get(p.sku) > 0).map((p) => ({
        sku: p.sku,
        quantity: cart.get(p.sku),
        unit_price: p.price,
      })),
    };
  }

  // ---------------------------------------------------- consola técnica

  /** Agrega una línea a la consola. kind: req | ok | err | note. */
  function logLine(kind, text, json) {
    const line = el("div", `line ${kind}`);
    line.append(
      el("time", "", new Date().toLocaleTimeString("es-CL", { hour12: false })),
      el("span", "", (conn.api.mode === "demo" && kind !== "note" ? "[demo] " : "") + text),
    );
    if (json !== undefined) {
      const details = el("details");
      const pre = el("pre", "", typeof json === "string" ? json.slice(0, 2000) : JSON.stringify(json, null, 2));
      details.append(el("summary", "", "ver JSON"), pre);
      line.append(details);
    }
    log.append(line);
    while (log.children.length > 80) log.firstChild.remove();
    log.scrollTop = log.scrollHeight;
  }

  /** Escribe en la consola una respuesta de la API. */
  function logResponse(label, res) {
    const code = res.data?.error?.code;
    const text = `${label} ← ${res.status}${code ? " " + code : ""} · ${res.ms} ms${res.requestId ? " · X-Request-ID " + res.requestId : ""}`;
    logLine(res.ok ? "ok" : "err", text, res.data);
  }

  $("console-clear").addEventListener("click", () => log.replaceChildren());

  // ------------------------------------------------------- los seis pasos

  const STEPS = ["cliente", "api", "postgres", "rabbit", "worker", "email"];
  const WORKING_TEXT = {
    cliente: "Enviando su pedido…",
    api: "Revisando que el pedido esté bien…",
    postgres: "Guardando el pedido…",
    rabbit: "Avisando a los trabajadores…",
    worker: "Un trabajador está dejando su pedido listo para despacho…",
    email: "Preparando el correo…",
  };
  const caption = $("track-caption");
  const station = (step) => progress.querySelector(`.station[data-step="${step}"]`);

  /** state: idle | working | done | error | skipped */
  function setStation(step, state, text) {
    const s = station(step);
    s.dataset.state = state;
    s.querySelector(".st-state").textContent = text;
    updateCaption();
  }

  /** La frase de arriba resume en qué va el pedido. */
  function updateCaption() {
    const states = STEPS.map((step) => station(step).dataset.state);
    const errorAt = states.indexOf("error");
    const working = states.lastIndexOf("working");
    let phase = "moving";
    if (states.every((s) => s === "idle")) {
      phase = "idle";
      caption.textContent = "Esperando su pedido.";
    } else if (errorAt >= 0) {
      phase = "error";
      caption.textContent = `Se detuvo en el paso ${errorAt + 1}: ${station(STEPS[errorAt]).querySelector("strong").textContent.toLowerCase()}.`;
    } else if (working >= 0) {
      caption.textContent = WORKING_TEXT[STEPS[working]];
    } else if (states.every((s) => s === "done" || s === "skipped")) {
      phase = "done";
      caption.textContent = "¡Listo! Su pedido está listo para despacho.";
    }
    progress.dataset.phase = phase;
  }

  function resetStations() {
    for (const step of STEPS) setStation(step, "idle", "esperando");
  }

  const skip = (steps, text) => steps.forEach((s) => setStation(s, "skipped", text));

  const receiptTitle = (order) =>
    order.status === "en_preparacion" ? "Pedido creado" : `Pedido ${(STATUS[order.status]?.text ?? order.status).toLowerCase()}`;

  function showOrder(order, note) {
    renderReceipt(receipt, order, { title: receiptTitle(order), note, onSearch, onChangeStatus: changeStatus });
  }

  /** Cambia el estado con PATCH /orders/{id}/status y vuelve a dibujar el recibo en box. */
  async function changeStatus(id, status, box) {
    box.querySelectorAll(".receipt-buttons .btn").forEach((b) => (b.disabled = true));
    try {
      logLine("req", `PATCH /orders/${id}/status`, { status });
      const res = await conn.api.changeStatus(id, status);
      logResponse(`PATCH /orders/${shortId(id)}/status`, res);
      const opts = { onChangeStatus: changeStatus, onSearch: box === receipt ? onSearch : undefined };
      if (res.ok) {
        renderReceipt(box, res.data, { ...opts, title: receiptTitle(res.data) });
        toast(`Estado cambiado a «${STATUS[res.data.status]?.text ?? res.data.status}»`);
      } else {
        const code = res.data?.error?.code ?? "ERROR";
        const current = await conn.api.getOrder(id);
        if (current.ok) {
          renderReceipt(box, current.data, { ...opts, title: receiptTitle(current.data), note: `${EXPLAIN[code] ?? "No se pudo cambiar el estado."} (código ${res.status} ${code})` });
        } else {
          renderProblem(box, "No se pudo cambiar el estado", EXPLAIN[code] ?? "El sistema no pudo responder.", `Código técnico: ${res.status} ${code}`);
        }
      }
    } catch (err) {
      renderProblem(box, "Sin conexión", "No se pudo hablar con el sistema. Intente de nuevo.", err.message);
      conn.check();
    }
  }

  // ------------------------------------------------------ recorrido del pedido

  async function watchWorker(api, order, createdAt) {
    setStation(
      "worker",
      "working",
      conn.workerUp ? "preparando…" : "El trabajador está apagado: el aviso espera su turno en la cola.",
    );
    while (Date.now() - createdAt < 20000) {
      const res = await api.getOrder(order.id);
      if (res.ok && res.data.status !== "en_preparacion") {
        logResponse(`GET /orders/${shortId(order.id)}`, res);
        setStation("worker", "done", `Listo para despacho en ${seconds(Date.now() - createdAt)} segundos.`);
        showOrder(res.data);
        return;
      }
      await sleep(500);
    }
    setStation("worker", "error", "Sigue en preparación. ¿Está encendido el trabajador (worker)?");
    logLine("note", "El pedido sigue en_preparacion. Si el worker está apagado, el mensaje espera en la cola: docker compose start worker");
  }

  async function watchEmail(api, before) {
    setStation("email", "working", "preparando el correo…");
    const started = Date.now();
    while (Date.now() - started < 20000) {
      const now = await api.workerMetrics();
      if (!now) {
        setStation("email", "skipped", "No se pudo consultar al trabajador.");
        return;
      }
      const retries = delta(before, now, "messages_retried_total");
      if (delta(before, now, "messages_dead_lettered_total") > 0) {
        setStation("email", "error", "No se pudo enviar tras varios intentos. Quedó guardado para revisión (cola DLQ).");
        return;
      }
      // los dos trabajadores (pedidos y correo) suman a messages_processed_total
      if (delta(before, now, "messages_processed_total") >= 2) {
        setStation("email", "done", retries ? `Correo enviado después de ${retries} reintento(s).` : "Correo enviado (de prueba).");
        return;
      }
      if (retries) setStation("email", "working", `El correo falló; se reintenta esperando un poco más (intento ${retries + 1})…`);
      await sleep(500);
    }
    setStation("email", "error", "El trabajador no respondió a tiempo.");
  }

  // ------------------------------------------------------------------ RUT
  // Se valida mientras la persona escribe (igual que la API: dígito verificador
  // módulo 11), para que no descubra el error recién al enviar.

  const rutField = customer.closest(".rut-field");
  const rutHelp = $("customer-help");

  function checkRUT({ format = false } = {}) {
    const value = customer.value.trim();
    const rut = normalizeRUT(value);
    let state;
    let text;
    if (!value) {
      state = "empty";
      text = "Con o sin puntos y con guion, por ejemplo 12.345.678-5.";
    } else if (rut) {
      state = "ok";
      text = `RUT válido: ${formatRUT(rut)}`;
      if (format) customer.value = formatRUT(rut);
    } else if (value.replace(/[^0-9kK]/g, "").length < 8) {
      state = "typing";
      text = "Siga escribiendo… (con guion y dígito verificador, por ejemplo 12.345.678-5)";
    } else {
      state = "bad";
      text = "Este RUT no es válido. Revise los números y el dígito verificador (el que va después del guion).";
    }
    rutField.dataset.state = rutHelp.dataset.state = state;
    customer.setAttribute("aria-invalid", String(state === "bad"));
    rutHelp.textContent = text;
    updateSendButton();
    return Boolean(rut);
  }

  customer.addEventListener("input", () => checkRUT());
  customer.addEventListener("blur", () => checkRUT({ format: true }));

  /**
   * El botón de enviar siempre dice lo que va a pasar: qué se envía, o qué falta
   * para poder enviar. Si falta algo se ve apagado, pero al pulsarlo explica qué hacer.
   */
  function updateSendButton() {
    const hint = $("cart-hint");
    sendBtn.setAttribute("aria-describedby", "cart-hint");
    if (busy) {
      sendBtn.textContent = "Procesando el pedido anterior…";
      sendBtn.classList.add("is-blocked");
      hint.textContent = "Espere unos segundos a que termine.";
      return;
    }
    const units = cartUnits();
    let blocked = true;
    if (!normalizeRUT(customer.value)) {
      sendBtn.textContent = "Enviar pedido";
      hint.textContent = "Falta su RUT (paso 1).";
    } else if (!units) {
      sendBtn.textContent = "Enviar pedido";
      hint.textContent = "Agregue al menos un producto con el botón + (paso 2).";
    } else {
      blocked = false;
      sendBtn.textContent = `Enviar pedido · ${money(cartTotal())}`;
      hint.textContent = "";
    }
    sendBtn.classList.toggle("is-blocked", blocked);
  }

  // --------------------------------------------- formulario ↔ pedido enviado

  /** Esconde el formulario y pregunta si quiere hacer otro pedido. */
  function showDone(order) {
    $("done-id").textContent = order.id.slice(0, 8).toUpperCase();
    $("done-copy").onclick = () => copy(order.id);
    form.hidden = true;
    done.hidden = false;
    done.focus({ preventScroll: true });
    // En pantallas angostas todo va en una columna: la tarjeta queda justo encima
    // de la impresora, así se ven la pregunta y la boleta saliendo.
    const stacked = window.matchMedia("(max-width: 960px)").matches;
    const target = stacked ? done : document.querySelector("#pedido .view-head");
    target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  }

  /** Vuelve al formulario con el carrito vacío (el RUT se mantiene). */
  function newOrder({ focus = true } = {}) {
    for (const sku of cart.keys()) cart.set(sku, 0);
    refreshCart();
    emptyBasket();
    done.hidden = true;
    form.hidden = false;
    form.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    if (focus) customer.focus({ preventScroll: true });
  }

  $("new-order").addEventListener("click", () => newOrder());

  /** Muestra que falta algo, con una pequeña sacudida. */
  function nudge(node) {
    node.classList.remove("nudge");
    void node.offsetWidth;
    node.classList.add("nudge");
  }

  async function sendOrder() {
    if (busy) return;
    // Sin un RUT válido no se envía: se vuelve al campo y se explica qué falta.
    if (!checkRUT({ format: true })) {
      rutField.dataset.state = rutHelp.dataset.state = "bad";
      rutHelp.textContent = "Antes de enviar, escriba un RUT válido (por ejemplo 12.345.678-5).";
      nudge(rutField);
      customer.scrollIntoView({ behavior: "smooth", block: "center" });
      customer.focus({ preventScroll: true });
      toast("Falta un RUT válido");
      return;
    }
    if (!cartUnits()) {
      nudge($("step-products"));
      toast("Agregue al menos un producto con el botón +");
      catalog.querySelector('[data-delta="1"]').focus();
      return;
    }
    busy = true;
    form.inert = true;
    modeAgent.disabled = true;
    sendBtn.textContent = "Enviando…";
    form.setAttribute("aria-busy", "true");
    progress.hidden = false;
    resetStations();
    const api = conn.api;

    try {
      const body = currentBody();
      const key = newKey();
      const units = body.items.reduce((sum, it) => sum + it.quantity, 0);
      const workerBefore = await api.workerMetrics();
      const apiBefore = await api.apiMetrics();

      // 1. Usted envía el pedido
      setStation("cliente", "working", "enviando…");
      logLine("req", `POST /orders · Idempotency-Key: ${key}`, body);
      setStation("cliente", "done", `Enviado: ${units} ${units === 1 ? "unidad" : "unidades"}.`);

      // 2. El sistema revisa
      setStation("api", "working", "revisando…");
      const res = await api.createOrder(body, key);
      logResponse("POST /orders", res);
      if (!res.ok) {
        const code = res.data?.error?.code ?? "ERROR";
        const why = EXPLAIN[code] ?? "El sistema rechazó el pedido.";
        setStation("api", "error", why);
        skip(["postgres", "rabbit", "worker", "email"], "No se guardó nada.");
        renderProblem(receipt, "No se pudo crear el pedido", why, `Código técnico: ${res.status} ${code}`);
        return;
      }
      const order = res.data;
      const createdAt = Date.now();
      setStation("api", "done", `Todo bien. Respondió en ${res.ms} milésimas de segundo.`);
      showOrder(order);
      lastOrder = { id: order.id, key, body };
      orderListeners.forEach((fn) => fn(lastOrder));
      showDone(order);
      // Ya se puede armar el siguiente; el botón de enviar espera a que este termine.
      form.inert = false;
      form.removeAttribute("aria-busy");
      updateSendButton();

      // 3. Se guarda
      setStation("postgres", "working", "guardando…");
      await sleep(250);
      setStation("postgres", "done", `Guardado con el número ${shortId(order.id)}`);

      // 4. Se avisa
      setStation("rabbit", "working", "avisando…");
      const apiAfter = await api.apiMetrics();
      if (
        apiAfter &&
        delta(apiBefore, apiAfter, "events_publish_failed_total") > 0 &&
        delta(apiBefore, apiAfter, "events_published_total") === 0
      ) {
        setStation("rabbit", "error", "No se pudo avisar (RabbitMQ no respondió). El pedido queda en preparación.");
        skip(["worker", "email"], "No llegó el aviso.");
        showOrder(order, "El aviso no se pudo enviar. Es una limitación conocida del sistema (ver README: patrón outbox).");
        return;
      }
      setStation("rabbit", "done", "Aviso enviado: «se creó un pedido».");

      // 5 y 6. Los dos trabajadores actúan a la vez.
      await Promise.all([watchWorker(api, order, createdAt), watchEmail(api, workerBefore)]);
    } catch (err) {
      logLine("err", `No se pudo hablar con la API (${err.message}). Revisando la conexión…`);
      for (const s of progress.querySelectorAll('.station[data-state="working"]')) setStation(s.dataset.step, "error", "Sin conexión con el sistema.");
      renderProblem(receipt, "Sin conexión", "No se pudo hablar con el sistema. Revise que esté encendido e intente de nuevo.", err.message);
      conn.check();
    } finally {
      busy = false;
      form.inert = false;
      modeAgent.disabled = false;
      form.removeAttribute("aria-busy");
      updateSendButton();
    }
  }

  // ------------------------------------------------ ¿quién arma el pedido?
  // Dos opciones arriba del RUT: "Lo hago yo" o "Que lo haga un agente". Con la
  // segunda, un agente bot escribe el RUT, elige productos y envía, a la vista.
  // Pulsar "Lo hago yo" mientras trabaja lo detiene (antes de enviar).

  const modeBox = form.querySelector(".mode");
  const modeMe = $("mode-me");
  const modeHelp = $("mode-help");
  let agentRun = null; // { cancelled } mientras el agente trabaja

  function setMode(mode) {
    modeMe.setAttribute("aria-checked", String(mode === "me"));
    modeAgent.setAttribute("aria-checked", String(mode === "agent"));
    modeBox.dataset.mode = mode;
    modeHelp.textContent =
      mode === "agent"
        ? "El agente escribe el RUT, elige productos y envía el pedido. Para detenerlo, pulse «Lo hago yo»."
        : "Siga los 3 pasos de abajo.";
  }

  modeMe.addEventListener("click", () => {
    if (agentRun) agentRun.cancelled = true;
    setMode("me");
  });
  modeAgent.addEventListener("click", () => agentOrder());

  /** Un agente escribe el RUT, elige productos y envía el pedido (el mismo orden que la pantalla). */
  async function agentOrder() {
    if (busy || agentRun) return;
    const run = (agentRun = { cancelled: false });
    const stopped = () => run.cancelled;
    setMode("agent");
    try {
      if (form.hidden) newOrder({ focus: false });
      else {
        for (const sku of cart.keys()) cart.set(sku, 0);
        refreshCart();
        emptyBasket();
      }
      form.scrollIntoView({ behavior: "smooth", block: "start" });
      await sleep(500);
      if (stopped()) return;
      swarm.busy("cliente", true);
      swarm.say("cliente", "escribiendo el RUT…");
      await swarm.typeInto("cliente", customer, RUTS[Math.floor(Math.random() * RUTS.length)]);
      checkRUT({ format: true });
      swarm.say("cliente", "eligiendo productos…");
      const picks = [...PRODUCTS].sort(() => Math.random() - 0.5).slice(0, 2 + Math.floor(Math.random() * 2));
      for (const p of picks) {
        const plus = catalog.querySelector(`[data-sku="${p.sku}"] [data-delta="1"]`);
        const times = 1 + Math.floor(Math.random() * 3);
        for (let i = 0; i < times; i++) {
          if (stopped()) return;
          await swarm.moveToEl("cliente", plus);
          await swarm.click("cliente");
          change(p.sku, 1);
        }
      }
      if (stopped()) return;
      swarm.say("cliente", "enviando…");
      await swarm.moveToEl("cliente", sendBtn);
      await swarm.click("cliente");
      swarm.say("cliente", null);
      swarm.busy("cliente", false);
      if (stopped()) return;
      await sendOrder();
    } finally {
      swarm.say("cliente", null);
      swarm.busy("cliente", false);
      agentRun = null;
      setMode("me");
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    sendOrder();
  });

  thickCaret(customer);
  renderCatalog();
  checkRUT();
  resetStations();
  logLine("note", "Aquí aparecen las peticiones a la API y sus respuestas.");

  return {
    agentOrder,
    changeStatus,
    logLine,
    logResponse,
    get lastOrder() {
      return lastOrder;
    },
    onOrder: (fn) => orderListeners.push(fn),
  };
}
