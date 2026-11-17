// El "enjambre": cursores de agentes que construyen la página en vivo.
// Idea visual inspirada en swarm-site (github.com/califa/swarm-site); implementación propia.
//
// Cómo se usa desde el HTML:
//   data-build="rect"  -> el agente dibuja un rectángulo y el elemento aparece
//   data-build="text"  -> el agente escribe el texto letra por letra (solo en elementos sin hijos)
//
// Un elemento espera a que su contenedor (el data-build más cercano hacia arriba) esté construido.

import { agentColor } from "./agents.js";
import { botSvg } from "./icons.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// La flecha del cursor (punta en 0,0).
const ARROW = '<svg width="18" height="20" viewBox="0 0 18 20" aria-hidden="true"><path d="M1 1 L1 16 L5.2 12.2 L8 18.6 L10.8 17.4 L8.1 11.1 L13.8 11.1 Z" fill="var(--c)" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>';

export function createSwarm({ agents, layer, onFrame = () => {}, instant = false }) {
  const alwaysInstant = instant; // "reducir movimiento": nunca se anima
  const cursors = new Map(); // id del agente -> { agent, el, x, y, busy }
  let built = new WeakMap(); // elemento -> promesa que se cumple cuando ya está construido
  const queue = []; // elementos esperando a un agente
  let restTimer = 0;

  // Con instant=true todas las esperas terminan enseguida ("Construir todo ya").
  const wait = (ms) => (instant ? Promise.resolve() : sleep(ms));

  /** Posición y tamaño del elemento en coordenadas de la página (no de la pantalla). */
  function pageRect(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height };
  }

  // ---------------------------------------------------------------- cursores

  function cursorOf(id) {
    if (cursors.has(id)) return cursors.get(id);
    const agent = agents.find((a) => a.id === id);
    const el = document.createElement("div");
    el.className = "cursor";
    el.style.setProperty("--c", agentColor(id));
    el.innerHTML = `${ARROW}<span class="cursor-label">${botSvg(13)}<span></span></span><span class="cursor-say" hidden></span>`;
    el.querySelector(".cursor-label span").textContent = agent.name;
    layer.appendChild(el);
    // Cada agente entra desde un lugar distinto del borde superior de la pantalla.
    // labelW: ancho de la etiqueta con el nombre, para saber si cabe a la derecha.
    const c = { agent, el, x: 0, y: 0, busy: false, labelW: el.querySelector(".cursor-label").offsetWidth || 110 };
    const spread = Math.max(1, window.innerWidth - 120);
    place(c, window.scrollX + 60 + ((agents.indexOf(agent) * 140) % spread), window.scrollY - 30);
    cursors.set(id, c);
    return c;
  }

  function place(c, x, y) {
    c.x = x;
    c.y = y;
    c.el.style.transform = `translate(${x}px, ${y}px)`;
    // Si el nombre no cabe a la derecha del cursor, se muestra a la izquierda
    // (así nunca queda cortado por el borde de la pantalla).
    const room = document.documentElement.clientWidth - (x - window.scrollX);
    c.el.classList.toggle("flip", room < c.labelW + 40);
  }

  let front = 3; // z-index del último agente que se movió
  function wake(c) {
    clearTimeout(restTimer);
    c.el.classList.add("visible");
    c.el.classList.remove("resting");
    // El agente que está trabajando ahora va al frente: si dos se cruzan, se lee su nombre.
    front = front > 900 ? 4 : front + 1;
    c.el.style.zIndex = String(front);
  }

  /** Mueve el cursor del agente hasta (x, y) de la página. */
  async function moveTo(id, x, y, { ms } = {}) {
    const c = cursorOf(id);
    wake(c);
    if (instant) return place(c, x, y);
    const distance = Math.hypot(x - c.x, y - c.y);
    const duration = ms ?? clamp(distance * 0.8, 160, 720) / c.agent.speed;
    const from = `translate(${c.x}px, ${c.y}px)`;
    place(c, x, y);
    await c.el
      .animate([{ transform: from }, { transform: `translate(${x}px, ${y}px)` }], {
        duration,
        easing: "cubic-bezier(.3,.7,.2,1)",
      })
      .finished.catch(() => {});
  }

  /** Mueve el cursor al centro de un elemento. */
  function moveToEl(id, el, { dx = 0.5, dy = 0.5 } = {}) {
    const r = pageRect(el);
    return moveTo(id, r.x + r.w * dx, r.y + r.h * dy);
  }

  /** Hace clic donde está el cursor (solo el efecto visual). */
  async function click(id) {
    const c = cursorOf(id);
    wake(c);
    const ring = document.createElement("span");
    ring.className = "click-ring";
    ring.style.setProperty("--c", agentColor(id));
    ring.style.transform = `translate(${c.x}px, ${c.y}px)`;
    layer.appendChild(ring);
    setTimeout(() => ring.remove(), 600);
    c.el.classList.add("pressing");
    await wait(140);
    c.el.classList.remove("pressing");
  }

  /** Muestra un globo con texto junto al cursor (por ejemplo "pensando…"). */
  function say(id, text) {
    const c = cursorOf(id);
    const bubble = c.el.querySelector(".cursor-say");
    bubble.textContent = text ?? "";
    bubble.hidden = !text;
  }

  /** Escribe text en un <input>, letra por letra, como lo haría una persona. */
  async function typeInto(id, input, text) {
    await moveToEl(id, input, { dx: 0.1 });
    await click(id);
    input.focus({ preventScroll: true });
    input.value = "";
    for (const ch of text) {
      input.value += ch;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await wait(55 / cursorOf(id).agent.speed);
    }
  }

  /** Después de un rato sin trabajo, los cursores se desvanecen. */
  function scheduleRest() {
    clearTimeout(restTimer);
    restTimer = setTimeout(() => {
      for (const c of cursors.values()) {
        if (!c.busy) {
          say(c.agent.id, null);
          c.el.classList.add("resting");
        }
      }
    }, 2200);
  }

  // ------------------------------------------------------- construir la página

  /** El marco con el color del agente y la medida (como en un editor de diseño). */
  function makeFrame(c, r, el) {
    const frame = document.createElement("div");
    frame.className = "frame";
    frame.style.setProperty("--c", agentColor(c.agent.id));
    frame.style.transform = `translate(${r.x}px, ${r.y}px)`;
    frame.innerHTML = '<span class="frame-badge"></span>';
    // data-name: qué pieza está creando ("Pantalla LCD · 280 × 34").
    const name = el?.dataset.name ? `${el.dataset.name} · ` : "";
    frame.firstChild.textContent = `${name}${Math.round(r.w)} × ${Math.round(r.h)}`;
    layer.appendChild(frame);
    return frame;
  }

  function removeFrame(frame) {
    frame.classList.add("gone");
    setTimeout(() => frame.remove(), 350);
  }

  async function buildRect(c, el, r) {
    const frame = makeFrame(c, r, el);
    onFrame(r, agentColor(c.agent.id));
    if (!instant) {
      // Arrastra desde la esquina superior izquierda hasta la inferior derecha.
      const drag = Math.round(clamp((r.w + r.h) * 0.35, 220, 520) / c.agent.speed);
      frame.animate([{ width: "0px", height: "0px" }, { width: `${r.w}px`, height: `${r.h}px` }], {
        duration: drag,
        easing: "cubic-bezier(.3,.7,.2,1)",
      });
      frame.style.width = `${r.w}px`;
      frame.style.height = `${r.h}px`;
      await moveTo(c.agent.id, r.x + r.w, r.y + r.h, { ms: drag });
    }
    el.classList.remove("unbuilt");
    el.classList.add("just-built");
    setTimeout(() => el.classList.remove("just-built"), 700);
    await wait(90);
    removeFrame(frame);
  }

  async function buildText(c, el, r) {
    const text = el.textContent;
    const frame = makeFrame(c, r, el);
    frame.style.width = `${r.w}px`;
    frame.style.height = `${r.h}px`;
    onFrame(r, agentColor(c.agent.id));

    // Lo escrito se ve; lo que falta sigue ocupando su lugar pero transparente,
    // así la página no "salta" mientras el agente escribe.
    const typed = document.createElement("span");
    const caret = document.createElement("span");
    const rest = document.createElement("span");
    caret.className = "caret";
    rest.className = "rest";
    rest.textContent = text;
    el.replaceChildren(typed, caret, rest);
    el.classList.remove("unbuilt");

    const step = text.length > 90 ? 3 : text.length > 30 ? 2 : 1;
    for (let i = 0; i < text.length && !instant; i += step) {
      typed.textContent = text.slice(0, i + step);
      rest.textContent = text.slice(i + step);
      if (i % (step * 5) === 0) {
        // el cursor sigue a la línea que se está escribiendo
        const cr = caret.getBoundingClientRect();
        place(c, cr.left + window.scrollX + 2, cr.bottom + window.scrollY - 4);
      }
      await sleep(c.agent.typeMs);
    }
    el.textContent = text;
    removeFrame(frame);
  }

  async function buildEl(c, el) {
    // Primero tiene que existir el contenedor.
    const parent = el.parentElement?.closest("[data-build]");
    if (parent && built.has(parent)) await built.get(parent);

    const r = pageRect(el);
    if (r.w === 0 || r.h === 0) {
      el.classList.remove("unbuilt"); // oculto en esta pantalla (p. ej. en el celular)
      return;
    }
    if (!instant) await moveTo(c.agent.id, r.x, r.y);
    // data-say: lo que el agente "comenta" mientras arma esa pieza.
    if (el.dataset.say && !instant) say(c.agent.id, el.dataset.say);
    if (el.dataset.build === "text" && el.children.length === 0) await buildText(c, el, r);
    else await buildRect(c, el, r);
    if (el.dataset.say) say(c.agent.id, null);
    onFrame(null);
  }

  /** Un agente toma elementos de la cola hasta que se vacía. */
  async function work(c) {
    c.busy = true;
    while (queue.length) {
      const task = queue.shift();
      await buildEl(c, task.el);
      task.done();
    }
    c.busy = false;
    if ([...cursors.values()].every((x) => !x.busy)) {
      if (!alwaysInstant) instant = false;
      scheduleRest();
    }
  }

  function pump() {
    for (const agent of agents) {
      if (!queue.length) return;
      const c = cursorOf(agent.id);
      if (!c.busy) work(c);
    }
  }

  /** Pone en la cola todo lo que falta construir dentro de root. Devuelve cuándo termina. */
  function build(root) {
    const els = [...(root.matches("[data-build]") ? [root] : []), ...root.querySelectorAll("[data-build]")];
    const pending = [];
    for (const el of els) {
      if (built.has(el)) {
        pending.push(built.get(el));
        continue;
      }
      let done;
      const promise = new Promise((resolve) => (done = resolve));
      built.set(el, promise);
      queue.push({ el, done });
      pending.push(promise);
    }
    pump();
    return Promise.all(pending);
  }

  /** Termina de construir todo al instante. */
  async function finishNow(root = document.body) {
    instant = true;
    await build(root);
    if (!alwaysInstant) instant = false; // lo que venga después (el pedido) vuelve a animarse
  }

  /** Esconde todo para volver a construir desde cero. */
  function reset(root = document.body) {
    queue.length = 0;
    built = new WeakMap();
    for (const el of root.querySelectorAll("[data-build]")) el.classList.add("unbuilt");
    if (!alwaysInstant) instant = false;
  }

  /** Deja los elementos de root como planos sin construir (sin tocar lo que ya está en la cola). */
  function prepare(root) {
    for (const el of root.querySelectorAll("[data-build]")) el.classList.add("unbuilt");
  }

  /** Marca el agente como ocupado (fuera de la construcción) y lo despierta. */
  function busy(id, on) {
    const c = cursorOf(id);
    c.busy = on;
    if (on) wake(c);
    else scheduleRest();
  }

  return { build, finishNow, reset, prepare, moveTo, moveToEl, click, say, typeInto, busy };
}
