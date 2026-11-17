// La boleta: el comprobante del pedido con el aspecto de una boleta térmica real
// (papel, bordes dentados, letra de impresora, IVA incluido, código de barras y un
// timbre con el estado). El toque de la tienda: cada paso lo firma un agente bot.
//
// Es un comprobante de práctica: dice "sin validez tributaria" y no imita el
// timbre electrónico del SII.

import { agentColor } from "./agents.js";
import { botSvg } from "./icons.js";
import { productName } from "./products.js";
import { STATUS, copyButton, el, money, toast } from "./ui.js";
import { sound } from "./sound.js";

const IVA = 0.19; // en Chile los precios a público incluyen IVA

/** El texto del botón para pasar a cada estado. */
const ACTION = {
  en_transito: { from: { no_entregado: "Intentar entregar de nuevo" }, text: "Enviar a reparto" },
  entregado: { text: "Marcar como entregado" },
  no_entregado: { text: "No se pudo entregar" },
  devuelto: { text: "Devolver a la tienda" },
};

/** Qué agente deja el pedido en cada estado (para el timbre y el seguimiento). */
// name: para el timbre · short: para el seguimiento (una línea de 80 mm no da para más).
const SIGNED_BY = {
  en_preparacion: { agent: "api", name: "Agente API", short: "API" },
  listo_para_despacho: { agent: "worker", name: "Agente Worker", short: "Worker" },
};
// Los demás estados los pide la persona desde la página (botones de reparto), vía la API.
const signer = (status) => SIGNED_BY[status] ?? { agent: "api", name: "Agente API · a su pedido", short: "Usted" };

const AGENTS_ROW = [
  ["cliente", "Cliente"],
  ["api", "API"],
  ["postgres", "PostgreSQL"],
  ["rabbit", "RabbitMQ"],
  ["worker", "Worker"],
  ["email", "Email"],
];

// Seguimiento: los cambios de estado que esta página vio, por pedido.
const history = new Map();

function track(order) {
  const list = history.get(order.id) ?? [];
  if (list.at(-1)?.status !== order.status) {
    list.push({ status: order.status, at: new Date(order.updated_at), by: signer(order.status).short });
  }
  history.set(order.id, list);
  return list;
}

const date = (d) => d.toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric" });
const time = (d) => d.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", hour12: false });

/** 12345678-5 -> 12.345.678-5 */
export const formatRUT = (rut) => {
  const [body, dv] = String(rut).split("-");
  return dv ? `${body.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}-${dv}` : rut;
};

/** Código de barras a partir del número de pedido (dibujo propio, no un estándar). */
function barcodeSvg(id) {
  const hex = id.replace(/[^0-9a-f]/gi, "").slice(0, 26);
  const rects = [];
  let x = 0;
  const bar = (w, ink) => {
    if (ink) rects.push(`<rect x="${x}" y="0" width="${w}" height="56"/>`);
    x += w;
  };
  [2, 1, 1, 1, 2, 2].forEach((w, i) => bar(w, i % 2 === 0)); // guarda de inicio
  for (const ch of hex) {
    const v = parseInt(ch, 16);
    bar(1 + (v & 1) + ((v >> 2) & 1), true);
    bar(1 + ((v >> 1) & 1), false);
    bar(1 + ((v >> 3) & 1) * 2, true);
    bar(1 + (v % 3 === 0 ? 1 : 0), false);
  }
  [2, 1, 1, 1, 2].forEach((w, i) => bar(w, i % 2 === 0)); // guarda de término
  return `<svg class="b-barcode" viewBox="0 0 ${x} 56" preserveAspectRatio="none" aria-hidden="true">${rects.join("")}</svg>`;
}

/** Una fila "izquierda ...... derecha". */
function row(left, right, cls = "") {
  const r = el("div", `b-row ${cls}`);
  r.append(el("span", "", left), el("span", "", right));
  return r;
}

const sep = (kind = "") => el("hr", `b-sep ${kind}`);

/** El papel de la boleta. */
function buildBoleta(order, { forPrint = false } = {}) {
  const created = new Date(order.created_at);
  const units = order.items.reduce((sum, it) => sum + it.quantity, 0);
  const net = Math.round(order.total / (1 + IVA));
  const steps = forPrint ? (history.get(order.id) ?? track(order)) : track(order);
  const stampBy = signer(order.status);

  const paper = el("article", "boleta");
  paper.setAttribute("aria-label", "Boleta del pedido");

  // Encabezado de la tienda
  const head = el("header", "b-head");
  const logo = el("span", "b-logo");
  logo.innerHTML = '<span class="brand-mark"></span>';
  head.append(
    logo,
    el("p", "b-store", "TIENDA EVENTFLOW"),
    el("p", "b-small", "Bootcamp Go · XINTEC"),
    el("p", "b-small", "Tienda atendida por agentes de IA"),
  );

  // Datos del comprobante
  const meta = el("div", "b-block");
  const cashier = el("span", "b-agent");
  cashier.style.setProperty("--c", agentColor("api"));
  cashier.innerHTML = botSvg(15);
  cashier.append(" Agente API");
  const cashierRow = el("div", "b-row");
  cashierRow.append(el("span", "", "Cajero:"), cashier);
  meta.append(
    row("Fecha:", date(created)),
    row("Hora:", time(created)),
    row("Cliente (RUT):", formatRUT(order.customer_id)),
    cashierRow,
  );

  // Ítems
  const items = el("div", "b-block b-items");
  items.append(row("CANT x PRECIO", "TOTAL", "b-colhead"));
  for (const it of order.items) {
    const line = el("div", "b-item");
    line.append(el("p", "b-item-name", productName(it.sku).toUpperCase()), row(`${it.quantity} x ${money(it.unit_price)}`, money(it.subtotal)));
    items.append(line);
  }

  // Totales
  const totals = el("div", "b-block");
  totals.append(
    row(`Artículos: ${units}`, ""),
    row("Neto", money(net)),
    row("IVA (19%)", money(order.total - net)),
    row("TOTAL", money(order.total), "b-total"),
    row("Moneda", order.currency ?? "CLP", "b-small-row"),
  );

  // Timbre con el estado: lo "estampa" el agente que dejó el pedido así
  const stampRow = el("div", "b-stamp-row");
  const stamp = el("div", "b-stamp");
  stamp.dataset.status = order.status;
  stamp.append(el("span", "b-stamp-text", (STATUS[order.status]?.text ?? order.status).toUpperCase()));
  const stampSig = el("span", "b-stamp-sig");
  stampSig.innerHTML = botSvg(13);
  stampSig.append(` timbró ${stampBy.name}`);
  stamp.append(stampSig);
  stampRow.append(stamp);

  // Seguimiento
  const follow = el("div", "b-block");
  follow.append(el("p", "b-label", "SEGUIMIENTO"));
  // Una línea por cambio, como una boleta real: hora · estado ······ quién.
  for (const s of steps) {
    const line = el("div", "b-follow");
    line.append(
      el("span", "b-follow-time", time(s.at)),
      el("span", "b-follow-state", STATUS[s.status]?.text ?? s.status),
      el("span", "b-follow-dots"),
      el("span", "b-follow-by", s.by),
    );
    follow.append(line);
  }
  if (steps.some((s) => s.by === "Usted")) {
    follow.append(el("p", "b-follow-note", "Usted: cambio pedido desde esta página (vía Agente API)."));
  }

  // Código de barras con el número de pedido
  const code = el("div", "b-code");
  code.innerHTML = barcodeSvg(order.id);
  code.append(el("p", "b-id", order.id));

  // Los agentes que atendieron
  const crew = el("div", "b-crew");
  crew.append(el("p", "b-label", "ATENDIDO POR"));
  const bots = el("div", "b-bots");
  for (const [id, name] of AGENTS_ROW) {
    const b = el("span", "b-bot");
    b.style.setProperty("--c", agentColor(id));
    b.innerHTML = botSvg(22);
    b.append(el("span", "", name));
    bots.append(b);
  }
  crew.append(bots);

  const foot = el("footer", "b-foot");
  foot.append(
    el("p", "b-thanks", "¡GRACIAS POR SU COMPRA!"),
    el("p", "", "Comprobante emitido por agentes de IA, sin intervención humana."),
    el("p", "b-legal", "Documento de prueba · sin validez tributaria"),
  );

  paper.append(
    head,
    sep("double"),
    el("p", "b-title", "COMPROBANTE DE PEDIDO"),
    el("p", "b-number", `N° ${order.id.slice(0, 8).toUpperCase()}`),
    sep(),
    meta,
    sep(),
    items,
    sep(),
    totals,
    stampRow,
    sep(),
    follow,
    sep(),
    code,
    crew,
    sep("double"),
    foot,
  );
  return paper;
}

// ---------------------------------------------------------------------------
// Seguimiento del reparto, junto a los botones: así quien cambia el estado ve el
// cambio donde está mirando (la boleta y su timbre quedan más arriba).

const TRACK = [
  ["en_preparacion", "Preparación", "📋"],
  ["listo_para_despacho", "Listo", "📦"],
  ["en_transito", "En camino", "🚚"],
  ["entregado", "Entregado", "🏠"],
];
const TRACK_INDEX = { en_preparacion: 0, listo_para_despacho: 1, en_transito: 2, no_entregado: 2, entregado: 3, devuelto: 3 };
const STATUS_ICON = { en_preparacion: "📋", listo_para_despacho: "📦", en_transito: "🚚", entregado: "✅", no_entregado: "⚠️", devuelto: "↩️" };

/** La barra con los 4 pasos del reparto; el camión avanza desde el estado anterior (from). */
function tracker(status, from) {
  const idx = TRACK_INDEX[status] ?? 0;
  const t = el("div", "tracker");
  t.dataset.status = status;
  t.style.setProperty("--to", String(idx / 3));
  t.style.setProperty("--from", String((from ? TRACK_INDEX[from] ?? idx : idx) / 3));
  if (from) t.classList.add("moved");
  if (from && status === "entregado") t.classList.add("arrived"); // el camión llega a la casa
  t.setAttribute("aria-label", `Seguimiento: ${STATUS[status]?.text ?? status}`);

  const rail = el("div", "tracker-rail");
  rail.setAttribute("aria-hidden", "true");
  rail.append(el("span", "tracker-fill"), el("span", "tracker-truck", status === "devuelto" ? "↩️" : "🚚"));

  const steps = el("ol", "tracker-steps");
  TRACK.forEach(([, label, icon], i) => {
    let text = label;
    let state = i < idx ? "done" : i === idx ? "current" : "todo";
    if (i === 2 && status === "no_entregado") [text, state] = ["No entregado", "warn"];
    if (i === 3 && status === "devuelto") [text, state] = ["Devuelto", "returned"];
    const li = el("li", "tracker-step");
    li.dataset.state = state;
    li.append(el("span", "tracker-dot", state === "done" ? "✓" : icon), el("span", "tracker-label", text));
    steps.append(li);
  });
  t.append(rail, steps);
  return t;
}

/** El aviso de que el estado cambió, con un atajo para ver el timbre nuevo en la boleta. */
function statusNotice(order, box) {
  const n = el("div", "status-notice");
  n.dataset.status = order.status;
  n.setAttribute("role", "status");
  const delivered = order.status === "entregado";
  const icon = el("span", "status-notice-icon", delivered ? "🎉" : STATUS_ICON[order.status] ?? "🔔");
  icon.setAttribute("aria-hidden", "true");
  if (delivered) {
    // ¡Llegó! Confeti que sale desde el ícono.
    n.classList.add("celebrate");
    const confetti = el("span", "confetti");
    confetti.setAttribute("aria-hidden", "true");
    const colors = ["#f23d49", "#0f7a40", "#0170b9", "#e2a23b", "#7a5bd6", "#ffd60a"];
    for (let i = 0; i < 28; i++) {
      const bit = el("i");
      const angle = (Math.PI * 2 * i) / 28 + Math.random() * 0.4;
      const dist = 60 + Math.random() * 90;
      bit.style.setProperty("--x", `${Math.cos(angle) * dist}px`);
      bit.style.setProperty("--y", `${Math.sin(angle) * dist * 0.7 - 30}px`);
      bit.style.setProperty("--r", `${Math.round(Math.random() * 720 - 360)}deg`);
      bit.style.setProperty("--c", colors[i % colors.length]);
      bit.style.setProperty("--d", `${Math.round(Math.random() * 120)}ms`);
      confetti.append(bit);
    }
    icon.append(confetti);
  }
  const body = el("div", "status-notice-body");
  body.append(
    el("strong", "", delivered ? "¡Pedido entregado! El cliente ya lo tiene" : `Estado actualizado: ${STATUS[order.status]?.text ?? order.status}`),
    el("span", "", `${STATUS[order.status]?.help ?? ""} (${time(new Date(order.updated_at))})`),
  );
  const see = el("button", "link-btn", "Ver el timbre nuevo en la boleta ↑");
  see.type = "button";
  see.addEventListener("click", () => box.querySelector(".b-stamp")?.scrollIntoView({ behavior: "smooth", block: "center" }));
  body.append(see);
  n.append(icon, body);
  return n;
}

/**
 * Dibuja la boleta de un pedido en box y, debajo, los controles (cambiar estado,
 * copiar, imprimir, buscar).
 * opts.title: aviso de arriba ("Pedido creado", "Pedido encontrado"...)
 * opts.note: mensaje extra (por ejemplo, por qué no se pudo cambiar el estado)
 * opts.onSearch(id): agrega "Buscar este pedido más tarde"
 * opts.onChangeStatus(id, status, box): agrega los botones de estado permitidos
 */
export function renderReceipt(box, order, { title, note, onSearch, onChangeStatus } = {}) {
  // ¿Es el mismo pedido con otro estado? (un botón de reparto, o el worker que lo dejó listo)
  const changedFrom = box.dataset.orderId === order.id && box.dataset.status !== order.status ? box.dataset.status : null;
  box.dataset.state = "order";

  const banner = el("p", "receipt-banner");
  const mark = el("span", "receipt-banner-check", { no_entregado: "!", devuelto: "↩" }[order.status] ?? "✓");
  mark.dataset.status = order.status; // el color acompaña al estado (naranja si no se entregó)
  banner.append(mark, el("span", "", title ?? "Pedido"));

  const wrap = el("div", "boleta-wrap");
  wrap.append(buildBoleta(order));

  const controls = el("div", "receipt-controls");
  controls.append(banner);
  if (changedFrom) controls.append(statusNotice(order, box));
  controls.append(tracker(order.status, changedFrom));
  if (note) controls.append(el("p", "receipt-note", note));

  // Botones de estado: solo los que la API permite (next_statuses). El primero es
  // el paso más probable y va destacado. listo_para_despacho no aparece: lo pone
  // el Agente Worker solo.
  const next = (order.next_statuses ?? []).filter((s) => ACTION[s]);
  if (onChangeStatus && next.length) {
    controls.append(el("p", "receipt-label", "Siguiente paso:"));
    const buttons = el("div", "receipt-buttons");
    next.forEach((s, i) => {
      const btn = el("button", i === 0 ? "btn primary" : "btn", ACTION[s].from?.[order.status] ?? ACTION[s].text);
      btn.type = "button";
      btn.dataset.next = s;
      btn.addEventListener("click", () => onChangeStatus(order.id, s, box));
      buttons.append(btn);
    });
    controls.append(buttons);
  } else if (onChangeStatus && order.status === "en_preparacion") {
    controls.append(el("p", "receipt-note info", "El Agente Worker lo está preparando. En unos segundos aparecerá aquí el botón para enviarlo."));
  } else if (onChangeStatus && order.status === "devuelto") {
    controls.append(el("p", "receipt-note info", "El pedido volvió a la tienda. Es el estado final: ya no hay más pasos."));
  }

  const tools = el("div", "receipt-tools");
  const copy = copyButton(order.id);
  copy.textContent = "Copiar número";
  const print = el("button", "btn", "Imprimir o guardar PDF");
  print.type = "button";
  print.addEventListener("click", () => printBoleta(order));
  tools.append(copy, print);
  if (onSearch) {
    const find = el("button", "btn", "Buscar más tarde");
    find.type = "button";
    find.addEventListener("click", () => onSearch(order.id));
    tools.append(find);
  }
  controls.append(tools);

  box.replaceChildren(wrap, controls);

  // Pedido nuevo: se imprime una boleta nueva. El mismo pedido con otro estado no
  // se reimprime: el papel sigue saliendo desde donde iba y, si ya terminó, solo
  // cae el timbre nuevo.
  const printer = box.previousElementSibling?.classList.contains("printer") ? box.previousElementSibling : null;
  const sameOrder = box.dataset.orderId === order.id;
  const statusChanged = sameOrder && box.dataset.status !== order.status;
  const paper = wrap.querySelector(".boleta");
  if (!sameOrder) {
    box.printStart = performance.now();
    box.feedMs = feedDuration(paper);
    box.classList.add("printed");
    if (printer) printJob(printer, box.feedMs);
  }
  box.dataset.orderId = order.id;
  box.dataset.status = order.status;

  const elapsed = performance.now() - box.printStart;
  const printEnds = box.feedMs + CUT_MS;
  // El timbre cae cuando la boleta ya está cortada.
  box.style.setProperty("--stamp-at", `${Math.round(printEnds + 200)}ms`);
  box.style.setProperty("--elapsed", `${Math.round(elapsed)}ms`);
  feedPaper(wrap, paper, box.feedMs, elapsed);
  box.classList.remove("restamp");
  if (statusChanged && elapsed > printEnds + 300) {
    void box.offsetWidth;
    box.classList.add("restamp");
  }
}

// ---------------------------------------------------------------------------
// Impresión térmica: el papel sale poco a poco, una línea a la vez.

const LINE_PX = 21; // alto de una línea impresa: el papel avanza de a una
const SPEED_PX_S = 300; // velocidad de salida del papel
const CUT_MS = 420; // la cuchilla corta
const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Cuánto tarda en salir este papel (más largo, más tiempo), entre 2,8 y 5,5 s. */
function feedDuration(paper) {
  if (reduceMotion()) return 0;
  return Math.min(5500, Math.max(2800, (paper.offsetHeight / SPEED_PX_S) * 1000));
}

/**
 * El papel crece desde la boca de la impresora, línea por línea (steps), con el
 * borde dentado como punta. Si la boleta se vuelve a dibujar a mitad de camino,
 * la animación sigue desde "elapsed". Al terminar, el papel queda colgando.
 */
function feedPaper(wrap, paper, feedMs, elapsed) {
  if (feedMs === 0 || elapsed >= feedMs + CUT_MS) {
    paper.classList.add("torn");
    return;
  }
  const height = paper.offsetHeight;
  const lines = Math.max(12, Math.round(height / LINE_PX));
  wrap.classList.add("feeding");
  const feed = wrap.animate([{ height: "0px" }, { height: `${height}px` }], {
    duration: feedMs,
    easing: `steps(${lines}, end)`,
    fill: "both",
  });
  feed.currentTime = Math.min(elapsed, feedMs);
  feed.finished
    .then(() => {
      wrap.classList.remove("feeding");
      feed.cancel(); // vuelve a su alto natural
      // la cuchilla corta y el papel cae un poquito: queda colgando, levemente torcido
      return paper.animate(
        [
          { transform: "translateY(0) rotate(0)" },
          { transform: "translateY(10px) rotate(-1.1deg)", offset: 0.35 },
          { transform: "translateY(2px) rotate(-0.3deg)", offset: 0.7 },
          { transform: "translateY(4px) rotate(-0.6deg)" },
        ],
        { duration: 550, delay: CUT_MS - 200, easing: "ease-out" },
      ).finished;
    })
    .then(() => paper.classList.add("torn"))
    .catch(() => {}); // si la boleta se reemplazó a mitad de camino, no pasa nada
}

/**
 * La impresora térmica trabaja: la pantalla muestra el avance, el rollo gira y
 * la máquina vibra; al final la cuchilla corta y pide retirar la boleta.
 */
function printJob(printer, feedMs) {
  const lcd = printer.querySelector(".printer-lcd-text");
  (printer.timers ?? []).forEach(clearTimeout); // una impresión nueva reemplaza a la anterior
  printer.timers = [];
  const at = (ms, fn) => printer.timers.push(setTimeout(fn, ms));
  const show = (text) => (lcd.textContent = text);

  printer.classList.remove("cut", "done");
  printer.classList.add("busy");
  show("IMPRIMIENDO…");
  sound.print(feedMs);
  for (let p = 10; p <= 100; p += 10) at((feedMs * p) / 100, () => show(`IMPRIMIENDO ${p}%`));
  at(feedMs, () => {
    printer.classList.remove("busy");
    printer.classList.add("cut");
    show("CORTANDO ✂");
    sound.cut();
  });
  at(feedMs + CUT_MS, () => {
    printer.classList.remove("cut");
    printer.classList.add("done");
    show("LISTO · RETIRE SU BOLETA");
  });
  at(feedMs + CUT_MS + 450, () => sound.beep()); // después del corte grabado
  at(feedMs + CUT_MS + 6000, () => {
    printer.classList.remove("done");
    show("EN ESPERA");
  });
}

// ---------------------------------------------------------------------------
// Imprimir o guardar en PDF: una copia limpia de la boleta en un área propia,
// sin el resto de la página, del ancho de un ticket real (80 mm) y con sus colores.

function printBoleta(order) {
  let area = document.getElementById("print-area");
  if (!area) {
    area = el("div");
    area.id = "print-area";
    document.body.append(area);
  }
  area.replaceChildren(buildBoleta(order, { forPrint: true }));
  const previousTitle = document.title;
  document.title = `Boleta EventFlow N° ${order.id.slice(0, 8).toUpperCase()}`; // nombre sugerido del PDF
  document.body.classList.add("printing");
  const cleanup = () => {
    document.body.classList.remove("printing");
    document.title = previousTitle;
    area.replaceChildren();
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  toast("En la ventana de impresión puede elegir «Guardar como PDF».");
  setTimeout(() => window.print(), 50);
}
