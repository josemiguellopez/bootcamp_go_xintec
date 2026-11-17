// Pantalla de entrada, en dos actos (versión corta, ~2,5 s):
//   1. Plano: sobre un fondo azul de plano, los agentes bot bocetean en líneas
//      (como en AutoCAD) los íconos de la tecnología del sistema.
//   2. Render: cada boceto toma color y volumen (3D) y aparece "EventFlow".
//
// Se muestra una sola vez por visita (sessionStorage) y se salta con un clic,
// una tecla o "Saltar". Con "reducir movimiento" activado en el sistema, no se muestra.
// Mientras dura, la página ya está pintada debajo: al cerrarse no hay nada que esperar.

import { agentColor } from "./agents.js";
import { TECH, botSvg, extrudedHtml, sketchSvg } from "./icons.js";

const SKETCH_AT = 150; // empieza el boceto
const SKETCH_STAGGER = 110; // separación entre un boceto y el siguiente
const SKETCH_MS = 700; // lo que tarda cada boceto
const RENDER_AT = SKETCH_AT + SKETCH_STAGGER * 5 + SKETCH_MS; // ~1400 ms
const RENDER_STAGGER = 70;
const NAME_AT = RENDER_AT + 500;
const CLOSE_AT = NAME_AT + 800;

export function playIntro() {
  const overlay = document.getElementById("intro");
  if (!overlay) return Promise.resolve();
  // index.html decide antes de pintar si toca la intro (clase "with-intro" en <html>).
  if (!document.documentElement.classList.contains("with-intro")) {
    overlay.remove();
    return Promise.resolve();
  }

  const pieces = overlay.querySelector(".intro-pieces");
  const cursorsLayer = overlay.querySelector(".intro-cursors");
  const coords = overlay.querySelector(".cad-coords");
  const skipBtn = overlay.querySelector(".intro-skip");
  const timers = [];
  const animations = [];
  let finished = false;
  let resolveDone;
  const done = new Promise((resolve) => (resolveDone = resolve));
  const at = (ms, fn) => timers.push(setTimeout(fn, ms));

  // Las seis piezas: boceto + versión 3D + nombre.
  pieces.innerHTML = TECH.map(
    (icon) => `
      <div class="piece" style="--c: ${agentColor(icon.agent)}">
        <div class="piece-art">${sketchSvg(icon)}${extrudedHtml(icon)}</div>
        <span class="piece-name">${icon.name}</span>
      </div>`,
  ).join("");
  const pieceEls = [...pieces.querySelectorAll(".piece")];

  overlay.classList.add("show");

  // Acto 1: los bots bocetean. Cada uno recorre las esquinas de su pieza con un cursor en cruz.
  pieceEls.forEach((piece, i) => {
    at(SKETCH_AT + i * SKETCH_STAGGER, () => {
      piece.classList.add("drawing");
      const art = piece.querySelector(".piece-art").getBoundingClientRect();
      const box = overlay.getBoundingClientRect();
      const x0 = art.left - box.left;
      const y0 = art.top - box.top;
      const cursor = document.createElement("span");
      cursor.className = "cad-cursor";
      cursor.style.setProperty("--c", agentColor(TECH[i].agent));
      cursor.innerHTML = `<span class="cad-cross"></span><span class="cursor-label">${botSvg(13)}<span></span></span>`;
      cursor.querySelector(".cursor-label span").textContent = TECH[i].name;
      cursorsLayer.append(cursor);
      const p = (x, y) => `translate(${x0 + x * art.width}px, ${y0 + y * art.height}px)`;
      const from = `translate(${i % 2 ? box.width + 40 : -80}px, ${i < 3 ? -60 : box.height + 40}px)`;
      animations.push(
        cursor.animate(
          [
            { transform: from, offset: 0 },
            { transform: p(0.1, 0.12), offset: 0.25 },
            { transform: p(0.9, 0.12), offset: 0.45 },
            { transform: p(0.9, 0.88), offset: 0.65 },
            { transform: p(0.1, 0.88), offset: 0.82 },
            { transform: p(0.5, 0.5), offset: 1 },
          ],
          { duration: SKETCH_MS + 200, easing: "ease-in-out", fill: "forwards" },
        ),
      );
      coords.textContent = `X ${(x0 + art.width / 2).toFixed(3)}   Y ${(y0 + art.height / 2).toFixed(3)}   CAPA: ${TECH[i].name.toUpperCase()}`;
    });
  });

  // Acto 2: render en 3D.
  at(RENDER_AT - 80, () => {
    overlay.classList.add("rendered");
    for (const c of cursorsLayer.children) c.classList.add("gone");
    coords.textContent = "RENDER 3D · LUCES · MATERIALES";
  });
  pieceEls.forEach((piece, i) => at(RENDER_AT + i * RENDER_STAGGER, () => piece.classList.add("solid")));
  at(NAME_AT, () => overlay.classList.add("named"));
  at(CLOSE_AT, close);

  function close() {
    if (finished) return;
    finished = true;
    timers.forEach(clearTimeout);
    overlay.classList.add("leaving");
    setTimeout(() => {
      overlay.remove();
      document.documentElement.classList.remove("with-intro");
      resolveDone();
    }, 450);
  }

  function skip() {
    animations.forEach((a) => a.finish?.());
    close();
  }

  skipBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    skip();
  });
  overlay.addEventListener("click", skip);
  window.addEventListener("keydown", skip, { once: true });
  done.then(() => window.removeEventListener("keydown", skip));
  return done;
}
