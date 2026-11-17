// El ambiente de la tienda, de fondo: techo con lámparas colgantes, estanterías
// llenas de productos en la pared (se mueven más lento que el contenido al hacer
// scroll, para dar profundidad) y piso de baldosas. Todo es decorativo
// (aria-hidden). Los clientes y los accidentes están en el minimarket (market.js).

import { agentColor } from "./agents.js";

/** Una estantería de dos niveles con productos: cajas, botellas, latas y frascos. */
function shelfSvg() {
  const W = 260;
  const H = 210;
  const box = (x, base, w, h, color, label = "#fff") =>
    `<rect x="${x}" y="${base - h}" width="${w}" height="${h}" rx="2" fill="${color}"/>` +
    `<rect x="${x + 3}" y="${base - h + 3}" width="5" height="${h - 6}" fill="#fff" opacity=".18"/>` +
    `<rect x="${x + 4}" y="${base - h * 0.6}" width="${w - 8}" height="${h * 0.22}" fill="${label}" opacity=".55"/>`;
  const bottle = (x, base, h, color) =>
    `<path d="M${x + 4} ${base} V${base - h + 14} Q${x + 4} ${base - h + 8} ${x + 7} ${base - h + 6} V${base - h} H${x + 11} V${base - h + 6} Q${x + 14} ${base - h + 8} ${x + 14} ${base - h + 14} V${base} Z" fill="${color}"/>` +
    `<rect x="${x + 6}" y="${base - h + 18}" width="2" height="${h - 24}" fill="#fff" opacity=".3"/>`;
  const can = (x, base, color) =>
    `<rect x="${x}" y="${base - 30}" width="20" height="30" rx="3" fill="${color}"/>` +
    `<ellipse cx="${x + 10}" cy="${base - 30}" rx="10" ry="3" fill="#dfe3ea"/>` +
    `<rect x="${x + 3}" y="${base - 22}" width="14" height="8" fill="#fff" opacity=".45"/>`;
  const jar = (x, base, color) =>
    `<rect x="${x}" y="${base - 26}" width="22" height="26" rx="5" fill="${color}" opacity=".9"/>` +
    `<rect x="${x + 2}" y="${base - 32}" width="18" height="7" rx="2" fill="#c9ced8"/>`;
  // El estante: tabla, canto oscuro y las etiquetas de precio amarillas.
  const plank = (y) =>
    `<rect x="0" y="${y}" width="${W}" height="7" fill="#5a6396"/>` +
    `<rect x="0" y="${y + 7}" width="${W}" height="9" fill="#2a3058"/>` +
    [18, 82, 146, 210].map((x) => `<rect x="${x}" y="${y + 9}" width="22" height="6" fill="#ffd60a" opacity=".85"/>`).join("");
  const row1 =
    box(6, 96, 38, 50, "#c8323d") +
    box(48, 96, 30, 38, "#2f7fc1") +
    bottle(84, 96, 58, "#3aa86b") +
    bottle(102, 96, 52, "#e2a23b") +
    can(124, 96, "#d9534f") +
    can(148, 96, "#5b6ee1") +
    box(174, 96, 42, 60, "#f2efe6", "#c8323d") +
    jar(222, 96, "#b0563a");
  const row2 =
    jar(8, 196, "#7a5bd6") +
    can(36, 196, "#e2a23b") +
    can(60, 196, "#3aa86b") +
    box(86, 196, 46, 56, "#2f7fc1", "#ffd60a") +
    bottle(138, 196, 60, "#c8323d") +
    bottle(156, 196, 54, "#f2efe6") +
    box(178, 196, 34, 44, "#b84f00") +
    box(216, 196, 38, 30, "#5b6ee1");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${row1}${plank(96)}${row2}${plank(196)}</svg>`;
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
}

export function setupScene() {
  const scene = document.querySelector(".scene");
  if (!scene) return;

  scene.querySelector(".scene-shelves").style.backgroundImage = shelfSvg();

  // Lámparas colgantes repartidas por el techo.
  const ceiling = scene.querySelector(".scene-ceiling");
  ceiling.innerHTML = [8, 27, 50, 73, 92]
    .map((x, i) => `<span class="lamp" style="left:${x}%; --sway:${i % 2 ? -1 : 1}"><span class="lamp-cord"></span><span class="lamp-shade"></span><span class="lamp-light"></span></span>`)
    .join("");

  // Profundidad: las estanterías se mueven más lento que la página.
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const shelves = scene.querySelector(".scene-shelves");
  let frame = 0;
  window.addEventListener(
    "scroll",
    () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        shelves.style.backgroundPositionY = `${Math.round(-window.scrollY * 0.18)}px`;
      });
    },
    { passive: true },
  );
}
