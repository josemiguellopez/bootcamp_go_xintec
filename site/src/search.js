// Buscar un pedido por su número (GET /orders/{id}), con la búsqueda a la vista:
//
//   1. El Agente API recibe el número y se lo pide a la base de datos.
//   2. El Agente PostgreSQL va al archivo de pedidos y lo revisa cajón por cajón
//      (0–4, 5–9, a–f): abre uno, lee las fichas y, si no está, lo cierra y sigue,
//      hasta llegar al cajón del primer carácter del número.
//   3. Si el pedido existe, su ficha sube, brilla y sale volando hasta la
//      impresora, que imprime la boleta. Si no, el cajón no tiene esa ficha.
//
// Es una ilustración: PostgreSQL de verdad va directo al cajón correcto gracias al
// índice orders_pkey (lo explica el desplegable técnico); aquí el agente busca a
// mano para que se vea. Las fichas vecinas son inventadas; la ficha encontrada,
// su estado y la boleta son la respuesta real de la API.

import { EXPLAIN, STATUS, el, renderProblem, shortId } from "./ui.js";
import { renderReceipt } from "./boleta.js";
import { thickCaret } from "./caret.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX = "0123456789abcdef";
const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const pause = (ms) => sleep(reduceMotion() ? 0 : ms);
const FAKE_STATUS = ["listo_para_despacho", "entregado", "en_transito", "devuelto"];

/** Un número inventado que empieza con prefix (para las fichas vecinas). */
function fakeId(prefix) {
  let s = prefix;
  while (s.length < 8) s += HEX[Math.floor(Math.random() * 16)];
  return s;
}

// ---------------------------------------------------------------------------
// El archivador

function createCabinet() {
  const $ = (id) => document.getElementById(id);
  const box = $("dig");
  const caption = $("dig-caption");
  const sqlValue = $("dig-sql").querySelector(".sql-v");
  const drawers = [...box.querySelectorAll(".drawer")];

  function setCaption(text, state = "") {
    caption.textContent = text;
    caption.dataset.state = state;
  }

  /** Una ficha: la pestaña de color, el número corto y el estado. */
  function card(key, status, cls = "") {
    const c = el("div", `fcard ${cls}`);
    c.dataset.key = key;
    c.dataset.status = status;
    c.append(el("span", "fcard-tab"), el("strong", "", key.toUpperCase()), el("span", "fcard-status", STATUS[status]?.text ?? status));
    return c;
  }

  /** Todo cerrado y en orden. */
  function reset() {
    box.dataset.phase = "idle";
    for (const d of drawers) {
      d.classList.remove("open", "dim", "checked");
      d.querySelector(".fcards").replaceChildren();
    }
    sqlValue.textContent = "…";
    setCaption("Escriba un número de pedido y pulse «Buscar».");
  }

  /** El cajón donde de verdad debería estar el pedido (por el primer carácter del número). */
  const drawerFor = (id) => drawers.find((d) => d.dataset.range.includes(id[0].toLowerCase()));
  const label = (drawer) => drawer.querySelector(".drawer-label").textContent;

  /**
   * Abre un cajón con sus fichas. En un cajón equivocado, las fichas empiezan con
   * otros caracteres; en el correcto, con los mismos dos primeros que el número buscado.
   */
  function open(drawer, id) {
    box.dataset.phase = "digging";
    for (const d of drawers) d.classList.toggle("dim", d !== drawer && !d.classList.contains("checked"));
    const range = drawer.dataset.range;
    const prefix = drawer === drawerFor(id) ? id.slice(0, 2).toLowerCase() : null;
    const keys = Array.from({ length: 4 }, () => fakeId(prefix ?? range[Math.floor(Math.random() * range.length)])).sort();
    drawer.querySelector(".fcards").replaceChildren(...keys.map((k, i) => card(k, FAKE_STATUS[i])));
    drawer.classList.remove("dim");
    drawer.classList.add("open");
  }

  /** Cierra un cajón ya revisado (queda marcado con ✗). */
  function close(drawer) {
    drawer.classList.remove("open");
    drawer.classList.add("checked");
  }

  /** Mete la ficha real en su lugar (ordenada por número), todavía sin destacar. */
  function insert(drawer, order) {
    const key = order.id.slice(0, 8).toLowerCase();
    const list = drawer.querySelector(".fcards");
    const c = card(key, order.status);
    const after = [...list.children].find((x) => x.dataset.key > key);
    list.insertBefore(c, after ?? null);
    return c;
  }

  /**
   * El agente revisa las fichas una por una: cada una se levanta, se lee y, si no
   * es, queda tachada. Si llega a la ficha buscada (target), se detiene ahí.
   */
  async function check(drawer, target = null, ms = 190) {
    for (const c of drawer.querySelectorAll(".fcard")) {
      c.classList.add("flip");
      await pause(ms);
      c.classList.remove("flip");
      if (c === target) return c;
      c.classList.add("nope");
    }
    return null;
  }

  function found(c) {
    c.classList.add("hit");
    box.dataset.phase = "found";
    setCaption(`¡Aquí está! La ficha ${c.dataset.key.toUpperCase()} va a la impresora.`, "ok");
  }

  function notFound(drawer) {
    const miss = el("div", "fcard miss");
    miss.append(el("strong", "", "✗"), el("span", "fcard-status", "No está"));
    drawer.querySelector(".fcards").append(miss);
    box.dataset.phase = "missing";
    setCaption(`Revisó el cajón ${label(drawer)}, que es donde debería estar, y no hay ninguna ficha con ese número.`, "bad");
  }

  /** La API rechazó el número sin preguntarle a la base de datos (400). */
  function rejected() {
    box.dataset.phase = "missing";
    sqlValue.textContent = "—";
    setCaption("Ese número no tiene la forma de un número de pedido, así que ni se buscó en el archivo.", "bad");
  }

  return {
    drawers,
    drawerFor,
    label,
    reset,
    open,
    close,
    insert,
    check,
    found,
    notFound,
    rejected,
    setCaption,
    setSql: (id) => (sqlValue.textContent = `'${id}'`),
  };
}

/** La ficha encontrada vuela hasta la boca de la impresora. */
function flyCard(fromEl, toEl) {
  if (reduceMotion()) return Promise.resolve();
  const from = fromEl.getBoundingClientRect();
  const to = toEl.getBoundingClientRect();
  const ghost = fromEl.cloneNode(true);
  ghost.classList.add("fly-card");
  Object.assign(ghost.style, { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px` });
  document.body.append(ghost);
  fromEl.classList.add("taken"); // en el cajón queda el hueco
  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  return ghost
    .animate(
      [
        { transform: "translate(0, 0) rotate(0) scale(1)" },
        { transform: `translate(${dx * 0.45}px, ${Math.min(dy, 0) - 110}px) rotate(-14deg) scale(1.15)`, offset: 0.5 },
        { transform: `translate(${dx}px, ${dy}px) rotate(0) scale(0.5)`, opacity: 0.3 },
      ],
      { duration: 900, easing: "cubic-bezier(.4,0,.3,1)" },
    )
    .finished.catch(() => {})
    .finally(() => ghost.remove());
}

// ---------------------------------------------------------------------------

export function setupSearch({ swarm, conn, workshop }) {
  const $ = (id) => document.getElementById(id);
  const form = $("search");
  const input = $("search-id");
  const result = $("search-result");
  const printer = $("printer-search");
  const lcd = printer.querySelector(".printer-lcd-text");
  const button = form.querySelector('button[type="submit"]');
  const cabinet = createCabinet();
  const stacked = () => window.matchMedia("(max-width: 960px)").matches;
  const scrollTo = (node, block) => node.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block });
  let busy = false;

  thickCaret(input);
  cabinet.reset();

  async function search(id) {
    if (busy) return;
    id = id.trim();
    if (!id) {
      renderProblem(result, "Falta el número", "Escriba o pegue un número de pedido. Si acaba de crear uno, pulse «Usar mi último pedido».");
      input.focus();
      return;
    }
    busy = true;
    button.disabled = true;
    button.textContent = "Buscando…";
    result.replaceChildren();
    result.removeAttribute("data-state");
    delete result.dataset.orderId; // cada búsqueda imprime una boleta nueva
    lcd.textContent = "BUSCANDO…";
    cabinet.reset();
    swarm.busy("api", true);
    swarm.busy("postgres", true);

    try {
      // 1. El Agente API recibe el número y se lo pide a la base de datos.
      await swarm.moveToEl("api", button);
      await swarm.click("api");
      swarm.say("api", "pidiéndolo al archivo…");
      workshop.logLine("req", `GET /orders/${id}`);
      const request = conn.api.getOrder(id); // la petición real corre mientras se ve la búsqueda
      scrollTo(document.querySelector(".search-layout"), "start"); // archivador e impresora a la vista
      await pause(500);
      cabinet.setSql(id);

      if (!UUID.test(id)) {
        const res = await request;
        workshop.logResponse(`GET /orders/${shortId(id)}`, res);
        cabinet.rejected();
        lcd.textContent = "NÚMERO INVÁLIDO";
        const code = res.data?.error?.code ?? "ERROR";
        renderProblem(result, "Ese no es un número de pedido", EXPLAIN[code] ?? EXPLAIN.ORDER_INVALID_ID, `Código técnico: ${res.status} ${code}`);
        return;
      }

      // 2. El Agente PostgreSQL busca cajón por cajón, desde el primero, hasta dar con
      //    el que corresponde al primer carácter del número.
      swarm.say("api", null);
      const target = cabinet.drawerFor(id);
      cabinet.setCaption("El agente revisa el archivo cajón por cajón…");
      await swarm.moveToEl("postgres", $("cabinet"), { dx: 0.5, dy: 0.1 });
      swarm.say("postgres", "¿dónde estará?…");
      await pause(400);

      let res = null;
      let hit = null;
      for (const drawer of cabinet.drawers) {
        const isTarget = drawer === target;
        await swarm.moveToEl("postgres", drawer.querySelector(".drawer-handle"));
        await swarm.click("postgres");
        swarm.say("postgres", `abriendo el cajón ${cabinet.label(drawer)}…`);
        cabinet.open(drawer, id);
        await pause(500);
        cabinet.setCaption(`Buscando en el cajón ${cabinet.label(drawer)}…`);
        await swarm.moveToEl("postgres", drawer.querySelector(".fcards"), { dx: 0.85, dy: 0.7 });

        if (!isTarget) {
          swarm.say("postgres", "mmm… ¿será esta?");
          await cabinet.check(drawer, null, 130);
          swarm.say("postgres", "aquí no está…");
          cabinet.setCaption(`No está en el cajón ${cabinet.label(drawer)}. Sigue con el siguiente…`);
          await pause(550);
          cabinet.close(drawer);
          await pause(250);
          continue;
        }

        // El cajón correcto: aquí sí hace falta la respuesta de la API.
        res = await request;
        workshop.logResponse(`GET /orders/${shortId(id)}`, res);
        swarm.say("postgres", "revisando las fichas…");
        const real = res.ok ? cabinet.insert(drawer, res.data) : null;
        hit = await cabinet.check(drawer, real);
        if (!hit) cabinet.notFound(drawer);
        break;
      }

      // 3. Encontrado: la ficha vuela a la impresora y sale la boleta.
      if (res.ok && hit) {
        cabinet.found(hit);
        await swarm.moveToEl("postgres", hit, { dx: 0.7, dy: 0.3 });
        swarm.say("postgres", "¡aquí está!");
        await pause(650);
        if (stacked()) {
          // En el celular la impresora está debajo: se centra la vista entre la ficha y la impresora.
          scrollTo($("dig-caption"), "center");
          await pause(450);
        }
        swarm.say("postgres", "a la impresora…");
        await flyCard(hit, printer.querySelector(".printer-mouth"));
        renderReceipt(result, res.data, { title: "Pedido encontrado", onChangeStatus: workshop.changeStatus });
        return;
      }

      const code = res.data?.error?.code ?? "ERROR";
      if (res.status === 404) {
        swarm.say("postgres", "aquí no está…");
        lcd.textContent = "NO ENCONTRADO";
        renderProblem(result, "No encontramos ese pedido", EXPLAIN[code] ?? EXPLAIN.ORDER_NOT_FOUND, `Código técnico: ${res.status} ${code}`);
      } else {
        cabinet.setCaption("El sistema no pudo responder.", "bad");
        lcd.textContent = "ERROR";
        renderProblem(result, "No se pudo buscar", EXPLAIN[code] ?? "El sistema no pudo responder.", `Código técnico: ${res.status} ${code}`);
      }
    } catch (err) {
      cabinet.setCaption("No se pudo hablar con el sistema.", "bad");
      renderProblem(result, "Sin conexión", "No se pudo hablar con el sistema. Intente de nuevo.", err.message);
      conn.check();
    } finally {
      busy = false;
      button.disabled = false;
      button.textContent = "Buscar";
      for (const agent of ["api", "postgres"]) {
        swarm.say(agent, null);
        swarm.busy(agent, false);
      }
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    search(input.value);
  });

  $("search-last").addEventListener("click", () => {
    if (!workshop.lastOrder) {
      renderProblem(result, "Todavía no hay pedidos", "Primero haga un pedido en «Hacer un pedido». Después vuelva aquí.");
      return;
    }
    input.value = workshop.lastOrder.id;
    search(input.value);
  });

  // Cada pedido nuevo deja su número listo para buscar.
  workshop.onOrder((order) => {
    input.value = order.id;
  });

  /** Busca el pedido (lo usa el botón «Buscar más tarde» de la boleta; main.js cambia de sección). */
  return {
    find(id) {
      input.value = id;
      search(id);
    },
  };
}
