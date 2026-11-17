// Íconos de la tecnología que usa el sistema y la carita de los agentes bot.
// Son dibujos propios y genéricos (no los logos oficiales de Go, PostgreSQL o RabbitMQ).
//
// Cada ícono es una lista de formas en un lienzo de 100 × 100. Con la misma
// lista se dibujan dos versiones:
//   sketch -> solo líneas, como un plano de AutoCAD (se "dibujan" con CSS)
//   solid  -> con color; apilando varias capas se ve en 3D (extruded)
//
// role: "body"   -> forma principal, se rellena con el color del agente
//       "detail" -> detalles claros sobre el cuerpo
//       "line"   -> trazos gruesos (asas, flechas)

/** Engranaje de 8 dientes, calculado con trigonometría. */
function gearPath(cx, cy, outer, inner, teeth) {
  const points = [];
  for (let i = 0; i < teeth * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a1 = (Math.PI * i) / teeth - Math.PI / teeth / 2.4;
    const a2 = (Math.PI * i) / teeth + Math.PI / teeth / 2.4;
    points.push(`${(cx + r * Math.cos(a1)).toFixed(1)} ${(cy + r * Math.sin(a1)).toFixed(1)}`);
    points.push(`${(cx + r * Math.cos(a2)).toFixed(1)} ${(cy + r * Math.sin(a2)).toFixed(1)}`);
  }
  return `M${points.join(" L")} Z`;
}

export const TECH = [
  {
    agent: "cliente",
    name: "Cliente",
    caption: "Hace el pedido",
    dim: "120 × 96",
    shapes: [
      { role: "line", tag: "path", d: "M10 22 H24 L36 64" },
      { role: "body", tag: "path", d: "M28 32 H90 L80 64 H36 Z" },
      { role: "detail", tag: "path", d: "M40 42 H82 M43 52 H78" },
      { role: "body", tag: "circle", cx: 42, cy: 78, r: 7 },
      { role: "body", tag: "circle", cx: 74, cy: 78, r: 7 },
    ],
  },
  {
    agent: "api",
    name: "API en Go",
    caption: "Revisa y responde",
    dim: "Ø 80",
    shapes: [
      { role: "body", tag: "path", d: "M50 8 L88 29 L88 71 L50 92 L12 71 L12 29 Z" },
      { role: "detail", tag: "path", d: "M40 33 Q31 33 31 41 V46 Q31 50 26 50 Q31 50 31 54 V59 Q31 67 40 67" },
      { role: "detail", tag: "path", d: "M60 33 Q69 33 69 41 V46 Q69 50 74 50 Q69 50 69 54 V59 Q69 67 60 67" },
      { role: "detail", tag: "path", d: "M55 35 L45 65" },
    ],
  },
  {
    agent: "postgres",
    name: "PostgreSQL",
    caption: "Guarda los pedidos",
    dim: "Ø 60 × 64",
    shapes: [
      { role: "body", tag: "path", d: "M20 22 V78 A30 10 0 0 0 80 78 V22 Z" },
      { role: "detail", tag: "ellipse", cx: 50, cy: 22, rx: 30, ry: 10 },
      { role: "detail", tag: "path", d: "M20 41 A30 10 0 0 0 80 41 M20 60 A30 10 0 0 0 80 60" },
    ],
  },
  {
    agent: "rabbit",
    name: "RabbitMQ",
    caption: "Reparte los avisos",
    dim: "3 × 22",
    shapes: [
      { role: "body", tag: "rect", x: 6, y: 34, width: 22, height: 32, rx: 4 },
      { role: "body", tag: "rect", x: 34, y: 34, width: 22, height: 32, rx: 4 },
      { role: "body", tag: "rect", x: 62, y: 34, width: 22, height: 32, rx: 4 },
      { role: "detail", tag: "path", d: "M10 42 L17 48 L24 42 M38 42 L45 48 L52 42 M66 42 L73 48 L80 42" },
      { role: "line", tag: "path", d: "M86 50 H96 M90 44 L96 50 L90 56" },
    ],
  },
  {
    agent: "worker",
    name: "Worker",
    caption: "Prepara el pedido",
    dim: "Ø 76 · Z 8",
    shapes: [
      { role: "body", tag: "path", d: gearPath(50, 50, 40, 30, 8) },
      { role: "detail", tag: "circle", cx: 50, cy: 50, r: 12 },
    ],
  },
  {
    agent: "email",
    name: "Email",
    caption: "Avisa al cliente",
    dim: "80 × 54",
    shapes: [
      { role: "body", tag: "rect", x: 10, y: 23, width: 80, height: 54, rx: 7 },
      { role: "detail", tag: "path", d: "M12 27 L50 55 L88 27" },
    ],
  },
];

const attrs = (shape) =>
  Object.entries(shape)
    .filter(([k]) => k !== "role" && k !== "tag")
    .map(([k, v]) => `${k}="${v}"`)
    .join(" ");

/** Versión plano: solo líneas, con pathLength=1 para animar el trazo con CSS. */
export function sketchSvg(icon) {
  const shapes = icon.shapes.map((s) => `<${s.tag} ${attrs(s)} pathLength="1" />`).join("");
  return `<svg class="sketch" viewBox="0 0 100 100" aria-hidden="true">${shapes}</svg>`;
}

/** Una capa con color. front=false es una capa de atrás (más oscura) para el volumen. */
function solidSvg(icon, front) {
  const shapes = icon.shapes
    .map((s) => {
      if (s.role === "line") return `<${s.tag} ${attrs(s)} fill="none" stroke="var(--c)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" />`;
      if (s.role === "body") return `<${s.tag} ${attrs(s)} fill="var(--c)" />`;
      if (!front) return "";
      const isOpen = s.tag === "path" && !/Z\s*$/.test(s.d);
      return isOpen
        ? `<${s.tag} ${attrs(s)} fill="none" stroke="rgba(255,255,255,.9)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" />`
        : `<${s.tag} ${attrs(s)} fill="rgba(255,255,255,.28)" stroke="rgba(255,255,255,.85)" stroke-width="3" />`;
    })
    .join("");
  return `<svg class="${front ? "front" : "back"}" viewBox="0 0 100 100" aria-hidden="true">${shapes}</svg>`;
}

/**
 * Ícono en 3D: varias capas apiladas en el eje Z (la de adelante con detalles,
 * las de atrás más oscuras). Con CSS (transform-style: preserve-3d) se ve sólido.
 */
export function extrudedHtml(icon, depth = 9) {
  let layers = "";
  for (let i = depth; i >= 1; i--) {
    layers += `<div class="x-layer" style="transform: translateZ(${-i * 1.6}px)">${solidSvg(icon, false)}</div>`;
  }
  layers += `<div class="x-layer x-front">${solidSvg(icon, true)}</div>`;
  return `<div class="x3d"><div class="x3d-body">${layers}</div></div>`;
}

/** La carita de un agente bot: cabeza, antena, ojos y boca. */
export function botSvg(size = 16) {
  return `<svg class="bot" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">
    <line x1="12" y1="2.5" x2="12" y2="6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    <circle cx="12" cy="2.5" r="1.6" fill="currentColor"/>
    <rect x="3.5" y="6" width="17" height="14" rx="4.5" fill="currentColor"/>
    <circle cx="9" cy="12.5" r="2" fill="var(--bot-eye, #fff)"/>
    <circle cx="15" cy="12.5" r="2" fill="var(--bot-eye, #fff)"/>
    <path d="M9 16.6 H15" stroke="var(--bot-eye, #fff)" stroke-width="1.5" stroke-linecap="round"/>
  </svg>`;
}
