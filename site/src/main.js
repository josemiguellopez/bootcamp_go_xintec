// Arranque del sitio. La página tiene cuatro secciones que se muestran de a una
// (pestañas del menú): hacer un pedido, buscarlo, el resultado del desafío y
// cómo funciona. De fondo está la tienda (scene.js). La primera vez que se abre
// cada sección en la visita, los agentes bot la construyen: cada pieza parte como
// un plano punteado y aparece cuando su agente termina de dibujarla (la impresora,
// pieza por pieza). Tarda un par de segundos y solo pasa una vez por sección.
//
// El CSS se enlaza en index.html (no se importa aquí) para que no haya un
// instante con la página sin estilos.

import { AGENTS } from "./agents.js";
import { createSwarm } from "./swarm.js";
import { createConnection } from "./api.js";
import { setupWorkshop } from "./workshop.js";
import { setupSearch } from "./search.js";
import { setupChecks } from "./checks.js";
import { botSvg } from "./icons.js";
import { sound } from "./sound.js";
import { setupScene } from "./scene.js";
import { setupMarket } from "./market.js";
import { playIntro } from "./intro.js";

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const $ = (id) => document.getElementById(id);

const swarm = createSwarm({ agents: AGENTS, layer: $("cursors"), instant: reducedMotion });
const conn = createConnection();

for (const slot of document.querySelectorAll("[data-bot]")) slot.innerHTML = botSvg(48);
setupScene();
setupMarket();

// --------------------------------------------------------------- secciones

const VIEWS = ["pedido", "buscar", "pruebas", "como"];
const tabs = [...document.querySelectorAll(".nav-tab")];
const BUILT_KEY = "eventflow-construido";
const ready = new Map(); // sección -> promesa que se cumple cuando ya está construida
let introDone = false;

function builtViews() {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(BUILT_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function markBuilt(view) {
  const set = builtViews().add(view);
  try {
    sessionStorage.setItem(BUILT_KEY, JSON.stringify([...set]));
  } catch {
    /* sin almacenamiento: se vuelve a construir en la próxima carga */
  }
}

/**
 * La primera vez que se abre una sección en la visita, los agentes la construyen:
 * cada pieza parte como un plano punteado y aparece cuando su agente termina de
 * dibujarla. Devuelve una promesa que se cumple cuando la sección está lista.
 */
function traceView(view) {
  if (!introDone) return Promise.resolve();
  if (ready.has(view)) return ready.get(view);
  const root = document.getElementById(view);
  let done;
  if (reducedMotion || builtViews().has(view)) {
    done = Promise.resolve();
  } else {
    swarm.prepare(root);
    done = swarm.build(root).then(() => markBuilt(view));
    // Por si algo se traba: a los 8 s se termina de golpe.
    setTimeout(() => swarm.finishNow(root), 8000);
  }
  document.documentElement.classList.remove("fresh"); // desde ahora manda la clase .unbuilt
  ready.set(view, done);
  return done;
}

function showView(view, { scroll = true } = {}) {
  if (!VIEWS.includes(view)) view = "pedido";
  document.documentElement.dataset.view = view;
  for (const tab of tabs) {
    if (tab.dataset.view === view) {
      tab.setAttribute("aria-current", "page");
      // En el celular la fila de pestañas se desliza: la elegida queda a la vista.
      const row = tab.parentElement;
      row.scrollLeft = tab.offsetLeft - (row.clientWidth - tab.offsetWidth) / 2;
    } else {
      tab.removeAttribute("aria-current");
    }
  }
  if (scroll) window.scrollTo({ top: 0 });
  traceView(view);
}

window.addEventListener("hashchange", () => showView(location.hash.slice(1)));
showView(location.hash.slice(1), { scroll: false });

/** Lleva a una sección (y la deja en el historial, para que "atrás" funcione). */
function goTo(view) {
  if (location.hash !== `#${view}`) history.pushState(null, "", `#${view}`);
  showView(view);
  return traceView(view);
}

let search;
const workshop = setupWorkshop({
  swarm,
  conn,
  // "Buscar más tarde" en la boleta: va a Buscar y, cuando está armada, busca.
  onSearch: async (id) => {
    await goTo("buscar");
    search.find(id);
  },
});
search = setupSearch({ swarm, conn, workshop });
setupChecks({ swarm, conn, workshop });

// ------------------------------------------------------------- conexión

const pill = $("conn");
conn.onChange(({ api, workerUp }) => {
  pill.dataset.mode = api.mode;
  pill.querySelector(".conn-text").textContent =
    api.mode === "real" ? (workerUp ? "Conectado" : "Conectado · worker apagado") : "Modo de prueba";
  pill.title =
    api.mode === "real"
      ? "Las peticiones van a su API en localhost:3200. Pulse para comprobar de nuevo."
      : "No se encontró la API en localhost:3200, así que todo se simula en el navegador. Levante docker compose y pulse aquí.";
  $("console-title").textContent =
    api.mode === "real" ? "Detalles técnicos: peticiones reales a la API" : "Detalles técnicos (modo de prueba, simulado)";
});
pill.addEventListener("click", () => {
  pill.querySelector(".conn-text").textContent = "Comprobando…";
  conn.check();
});
conn.check();

// ------------------------------------------------------------------ sonido

const soundBtn = $("sound");
function paintSound() {
  soundBtn.setAttribute("aria-pressed", String(sound.enabled));
  soundBtn.querySelector("[aria-hidden]").textContent = sound.enabled ? "🔊" : "🔇";
  soundBtn.querySelector(".tool-label").textContent = sound.enabled ? "Sonido" : "Silencio";
}
soundBtn.addEventListener("click", () => {
  sound.setEnabled(!sound.enabled);
  sound.unlock();
  paintSound();
});
paintSound();
// El navegador solo deja sonar audio después de una interacción: se prepara en el primer clic o tecla.
for (const type of ["pointerdown", "keydown"]) window.addEventListener(type, () => sound.unlock(), { once: true });

// ---------------------------------------------------- tamaño de la letra

const sizeBtn = $("text-size");
function setBig(on) {
  document.documentElement.classList.toggle("big", on);
  sizeBtn.setAttribute("aria-pressed", String(on));
  sizeBtn.textContent = on ? "A−" : "A+";
  try {
    localStorage.setItem("eventflow-big", on ? "1" : "0");
  } catch {
    /* sin almacenamiento: solo dura esta visita */
  }
}
setBig(document.documentElement.classList.contains("big"));
sizeBtn.addEventListener("click", () => setBig(!document.documentElement.classList.contains("big")));

// ------------------------------------------------------------------- inicio

playIntro().then(() => {
  introDone = true;
  traceView(document.documentElement.dataset.view);
});
