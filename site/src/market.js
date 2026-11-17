// El minimarket de abajo: un mini videojuego isométrico (estilo pixel) de un
// almacén de barrio chileno. Todo es decorativo y se dibuja en un <canvas>.
//
//   · Los clientes entran por la puerta, recorren el pasillo, eligen productos
//     (con sus frases), conversan si se encuentran, hacen fila y pagan en la caja.
//   · En el pasillo a veces chocan: estrellitas, "¡Chuta!", "¡Perdón, vecino!" y se
//     les cae un producto (si es una bebida, se derrama).
//   · El Agente API atiende la caja (su mini impresora entrega la boleta) y el
//     Agente Worker repone, recoge lo que se cae y trapea el piso mojado.
//
// Coordenadas del "mundo": x en píxeles lógicos (a lo ancho) y d = profundidad
// del piso (0 = junto a la pared, 1 = adelante). El mundo mide WORLD_H de alto y se
// escala al alto del canvas; el ancho visible depende de la pantalla.
// Solo se anima cuando está a la vista y con la pestaña activa; con "reducir
// movimiento" se dibuja una escena quieta.

import { agentColor } from "./agents.js";

const WORLD_H = 260;
const WALL_BOTTOM = 112; // donde la pared toca el piso
const floorY = (d) => 118 + d * 128; // pies de alguien a la profundidad d
const LANE = 0.6; // el pasillo principal
const S = 1.3; // tamaño de las personas y los bots (como los muñequitos de un juego)
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ------------------------------------------------------------ los textos
const TALK = [
  ["¡Hola vecina! ¿Cómo está?", "Bien, ¿y usted?"],
  ["¿Vio el partido anoche?", "¡Qué partidazo!"],
  ["Está helado hoy…", "Puro frío, oiga"],
  ["¿Sabe si hay pan?", "Recién salió, calentito"],
  ["Cachai que subió todo", "Pucha, sí…"],
  ["¿Va a la feria el domingo?", "Ya po, vamos"],
];
const BUMP = [
  ["¡Ay! ¡Fíjate!", "¡Perdón, perdón!"],
  ["¡Chuta!", "¡Uy, disculpe!"],
  ["¡Oiga!", "¡Sorry, vecino!"],
  ["¡Mi palta!", "¡Ups! Perdón…"],
];
const DODGE = [
  ["Permiso…", "Pase, pase"],
  ["Con permiso", "Adelante"],
];
const PAY = ["¿Tiene sencillo?", "Con débito, porfa", "¿Me da una bolsita?", "Y la boleta, porfa"];
const THANKS = ["¡Gracias, vecino!", "¡Que le vaya bien!", "Su boleta 🧾", "¡Vuelva pronto!"];
const OFFERS = ["¡Palta en oferta!", "¡Pan calentito!", "¡Bebidas heladas!"];

// Lo que se puede llevar cada cliente.
const ITEMS = {
  pan: { color: "#d9a35b", shape: "bread" },
  palta: { color: "#3f6b2a", shape: "round" },
  tomate: { color: "#d63a2f", shape: "round" },
  bebida: { color: "#c8323d", shape: "bottle" },
  leche: { color: "#f2efe6", shape: "box" },
  te: { color: "#2f7fc1", shape: "box" },
  galletas: { color: "#e2a23b", shape: "box" },
  fideos: { color: "#f0c541", shape: "box" },
};

// Cómo se ven los clientes (al azar).
const LOOKS = {
  skin: ["#f3cfb1", "#e4b08c", "#c98d64", "#9a6340", "#f6dcc6", "#b9794f"],
  hair: ["#2b1d14", "#5a3a22", "#b8862f", "#1c1c1c", "#a33b1e", "#9b9b9b"],
  shirt: ["#d42a36", "#2f7fc1", "#3aa86b", "#e2a23b", "#7a5bd6", "#f2efe6", "#1d2138", "#0f7a40"],
  pants: ["#2a2f4f", "#3b4a6b", "#5a4632", "#1f2a44", "#6b6f7a"],
  style: ["short", "short", "long", "bun", "cap", "bald"],
};

export function setupMarket() {
  const canvas = document.getElementById("market");
  if (!canvas) return;
  let ctx = canvas.getContext("2d"); // paintBackground() lo apunta un momento a otro canvas
  const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let W = 1000; // ancho del mundo visible
  let scale = 1;
  let dpr = 1;
  let L = null; // posiciones del mobiliario
  let bg = null; // la pared y el piso, dibujados una vez (canvas aparte)
  const people = [];
  const items = []; // productos en el piso
  const puddles = [];
  const queue = []; // la fila de la caja
  let cashier, worker;
  let spawnIn = 0.5;
  let offerIn = 12;
  let talkCheckIn = 1;
  let bumpCooldown = 2;
  let paperT = 0; // la boleta que sale de la caja (0 = nada)

  // ---------------------------------------------------------- el mobiliario
  function layout() {
    const wide = W >= 700;
    const counterW = wide ? 140 : 120;
    const lay = {
      wide,
      door: { x: 16, w: 58 },
      fridge: { x: 90, w: wide ? 76 : 62 },
      counter: { x: W - counterW - (wide ? 40 : 14), w: counterW, d: 0.34 },
      fruit: { x: wide ? W * 0.14 : 96, w: wide ? 100 : 82, d: 0.84 },
      gondolas: [],
    };
    if (wide) {
      const gw = clamp(W * 0.13, 120, 180);
      lay.gondolas = [
        { x: W * 0.3, w: gw, d: 0.32, color: "#3d6fb3", goods: ["te", "fideos"] },
        { x: W * 0.56, w: gw, d: 0.32, color: "#b8442f", goods: ["galletas", "leche"] },
      ];
      lay.bread = { x: (W * 0.3 + gw + W * 0.56) / 2 };
    } else {
      lay.gondolas = [{ x: 180, w: 86, d: 0.32, color: "#3d6fb3", goods: ["te", "galletas"] }];
      lay.bread = { x: Math.min(lay.counter.x - 30, 300) };
    }
    // Dónde se para la gente.
    lay.spots = [
      { x: lay.fridge.x + lay.fridge.w / 2, d: 0.06, goods: ["bebida", "leche"], lines: ["Una bebida heladita", "¿Hay de litro y medio?"] },
      { x: lay.bread.x, d: 0.06, goods: ["pan"], lines: ["¿Hay marraqueta?", "Dos hallullas, porfa", "¡Está calentito!"] },
      { x: lay.fruit.x + lay.fruit.w / 2, d: 0.7, goods: ["palta", "tomate"], lines: ["¿A cuánto la palta?", "Pucha, subió la palta", "Buenos los tomates"] },
      ...lay.gondolas.map((g) => ({ x: g.x + g.w / 2, d: 0.46, goods: g.goods, lines: ["Pa' la once…", "¿Dónde está el té?", "Esta marca es buena"] })),
    ];
    lay.doorSpot = { x: lay.door.x + lay.door.w / 2, d: 0.03 };
    lay.queueSpot = (i) => ({ x: lay.counter.x - 20 - i * 32, d: 0.5 });
    return lay;
  }

  /** Una caja isométrica: frente, tapa y costado (el costado hacia la derecha-atrás). */
  function box(x, yBottom, w, h, front, top, side, depth = 14) {
    const ox = depth;
    const oy = -depth * 0.6;
    const yTop = yBottom - h;
    ctx.fillStyle = side;
    ctx.beginPath();
    ctx.moveTo(x + w, yTop);
    ctx.lineTo(x + w + ox, yTop + oy);
    ctx.lineTo(x + w + ox, yBottom + oy);
    ctx.lineTo(x + w, yBottom);
    ctx.fill();
    ctx.fillStyle = top;
    ctx.beginPath();
    ctx.moveTo(x, yTop);
    ctx.lineTo(x + w, yTop);
    ctx.lineTo(x + w + ox, yTop + oy);
    ctx.lineTo(x + ox, yTop + oy);
    ctx.fill();
    ctx.fillStyle = front;
    ctx.fillRect(x, yTop, w, h);
  }

  /** Un producto chico (en estantes, canastos y en el piso). */
  function drawItem(kind, x, y, s = 1) {
    const it = ITEMS[kind];
    ctx.fillStyle = it.color;
    if (it.shape === "round") {
      ctx.beginPath();
      ctx.arc(x, y - 3 * s, 3.2 * s, 0, Math.PI * 2);
      ctx.fill();
    } else if (it.shape === "bottle") {
      ctx.fillRect(x - 2 * s, y - 9 * s, 4 * s, 9 * s);
      ctx.fillRect(x - 1 * s, y - 12 * s, 2 * s, 3 * s);
    } else if (it.shape === "bread") {
      ctx.beginPath();
      ctx.ellipse(x, y - 3 * s, 4.5 * s, 3 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,.35)";
      ctx.fillRect(x - 2 * s, y - 5 * s, 4 * s, 1);
    } else {
      ctx.fillRect(x - 3 * s, y - 8 * s, 6 * s, 8 * s);
      ctx.fillStyle = "rgba(255,255,255,.45)";
      ctx.fillRect(x - 2 * s, y - 5 * s, 4 * s, 2 * s);
    }
  }

  // ---------------------------------------------------------- el fondo fijo
  function paintBackground() {
    bg = document.createElement("canvas");
    bg.width = Math.round(W * scale * dpr);
    bg.height = Math.round(WORLD_H * scale * dpr);
    const real = ctx;
    const g = bg.getContext("2d");
    g.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    // dibujamos con las mismas funciones, apuntando al canvas del fondo
    withCtx(g, () => {
      // pared
      const wall = g.createLinearGradient(0, 0, 0, WALL_BOTTOM);
      wall.addColorStop(0, "#f3e7cd");
      wall.addColorStop(1, "#e8d7b3");
      g.fillStyle = wall;
      g.fillRect(0, 0, W, WALL_BOTTOM);
      g.fillStyle = "#c9a26b"; // cornisa
      g.fillRect(0, 0, W, 5);
      g.fillStyle = "#a8784e"; // zócalo de madera
      g.fillRect(0, WALL_BOTTOM - 16, W, 16);
      g.fillStyle = "rgba(0,0,0,.12)";
      for (let x = 0; x < W; x += 22) g.fillRect(x, WALL_BOTTOM - 16, 1, 16);

      // piso de baldosas en rombo (como en los juegos isométricos)
      const TW = 44;
      const TH = 22;
      g.save();
      g.beginPath();
      g.rect(0, WALL_BOTTOM, W, WORLD_H - WALL_BOTTOM);
      g.clip();
      g.fillStyle = "#d9cfbd";
      g.fillRect(0, WALL_BOTTOM, W, WORLD_H - WALL_BOTTOM);
      let row = 0;
      for (let y = WALL_BOTTOM - TH; y < WORLD_H + TH; y += TH / 2, row++) {
        for (let x = (row % 2) * (TW / 2) - TW; x < W + TW; x += TW) {
          g.fillStyle = row % 2 ? "#cfc2aa" : "#e6dcc8"; // filas alternadas = damero en rombo
          g.beginPath();
          g.moveTo(x, y + TH / 2);
          g.lineTo(x + TW / 2, y);
          g.lineTo(x + TW, y + TH / 2);
          g.lineTo(x + TW / 2, y + TH);
          g.fill();
        }
      }
      g.restore();
      // sombra donde la pared toca el piso
      const shade = g.createLinearGradient(0, WALL_BOTTOM, 0, WALL_BOTTOM + 18);
      shade.addColorStop(0, "rgba(60,40,20,.28)");
      shade.addColorStop(1, "rgba(60,40,20,0)");
      g.fillStyle = shade;
      g.fillRect(0, WALL_BOTTOM, W, 18);

      // la puerta
      const { door, fridge } = L;
      g.fillStyle = "#6b4a2e";
      g.fillRect(door.x - 4, 22, door.w + 8, WALL_BOTTOM - 22);
      g.fillStyle = "#2c3350";
      g.fillRect(door.x, 26, door.w, WALL_BOTTOM - 26);
      g.fillStyle = "rgba(160,200,255,.25)";
      g.fillRect(door.x + 6, 32, door.w - 12, 36);
      g.fillStyle = "#e2a23b";
      g.fillRect(door.x + door.w - 10, 70, 4, 10);

      // el refrigerador de bebidas
      g.fillStyle = "#dfe5ee";
      g.fillRect(fridge.x, 26, fridge.w, WALL_BOTTOM - 22);
      g.fillStyle = "#9fd3ff";
      g.fillRect(fridge.x + 5, 34, fridge.w - 10, WALL_BOTTOM - 46);
      for (let r = 0; r < 3; r++) {
        g.fillStyle = "#c3ccd8";
        g.fillRect(fridge.x + 5, 54 + r * 18, fridge.w - 10, 2);
        for (let i = 0; i < Math.floor((fridge.w - 14) / 9); i++) {
          withCtx(g, () => drawItem(pick(["bebida", "bebida", "leche"]), fridge.x + 10 + i * 9, 53 + r * 18, 0.9));
        }
      }
      g.fillStyle = "#2a2f4f";
      g.font = "700 8px 'Open Sans', sans-serif";
      g.fillText("BEBIDAS", fridge.x + 8, 32);

      // estantes de la pared con productos
      const shelfFrom = fridge.x + fridge.w + 16;
      const shelfTo = L.counter.x - 10;
      for (const y of [52, 80]) {
        g.fillStyle = "#8a5f3a";
        g.fillRect(shelfFrom, y, shelfTo - shelfFrom, 4);
        for (let x = shelfFrom + 6; x < shelfTo - 6; x += 11) {
          if (Math.abs(x - L.bread.x) < 30 && y === 80) continue; // ahí va el canasto del pan
          withCtx(g, () => drawItem(pick(["te", "fideos", "galletas", "leche", "bebida"]), x, y, 0.85));
        }
      }
      // el canasto del pan amasado
      g.fillStyle = "#9b6b3c";
      g.fillRect(L.bread.x - 24, 74, 48, 10);
      for (let i = 0; i < 5; i++) withCtx(g, () => drawItem("pan", L.bread.x - 18 + i * 9, 76, 1));

      // el letrero de la tienda
      const signW = Math.min(260, W * 0.36);
      const signX = L.wide ? W * 0.5 - signW / 2 : shelfFrom;
      g.fillStyle = "#d42a36";
      roundRect(g, signX, 9, signW, 26, 5);
      g.fill();
      g.fillStyle = "#fff";
      g.font = `700 ${L.wide ? 14 : 11}px Poppins, 'Open Sans', sans-serif`;
      g.textAlign = "center";
      g.fillText("MINIMARKET EVENTFLOW", signX + signW / 2, 27);
      g.textAlign = "left";

      // la pizarra
      if (L.wide) {
        const bx = signX - 120;
        g.fillStyle = "#6b4a2e";
        g.fillRect(bx - 3, 9, 96, 34);
        g.fillStyle = "#2d3b2f";
        g.fillRect(bx, 12, 90, 28);
        g.fillStyle = "#f2efe6";
        g.font = "700 8.5px 'Courier Prime', monospace";
        g.fillText("HAY PAN AMASADO", bx + 6, 24);
        g.fillText("Palta $2.990 kg", bx + 6, 35);
        g.fillStyle = "#2a2f4f";
        g.font = "700 9px 'Open Sans', sans-serif";
        g.fillText("Se acepta débito", signX + signW + 22, 26);
      }
    });
    function withCtx(c, fn) {
      ctx = c;
      try {
        fn();
      } finally {
        ctx = real;
      }
    }
  }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  // ------------------------------------------------- la gente y los agentes
  function newPerson(kind = "customer") {
    return {
      kind,
      x: L.doorSpot.x,
      d: L.doorSpot.d,
      side: 0, // pequeño desvío al esquivar
      sideT: 0,
      dir: 1,
      vx: 0,
      speed: rand(68, 90),
      walk: 0,
      path: [],
      onArrive: null,
      state: "idle",
      timer: 0,
      plan: [],
      basket: [],
      bubble: null,
      stars: 0,
      kb: 0, // retroceso del choque
      cool: rand(2, 5), // para no chocar a cada rato
      laneJ: rand(-0.025, 0.025),
      look: {
        skin: pick(LOOKS.skin),
        hair: pick(LOOKS.hair),
        shirt: pick(LOOKS.shirt),
        pants: pick(LOOKS.pants),
        style: pick(LOOKS.style),
        cap: pick(["#d42a36", "#2f7fc1", "#3aa86b", "#1d2138"]),
      },
    };
  }

  function say(p, text, secs = 2.2) {
    p.bubble = { text, t: 0, dur: secs };
  }

  /** Camina por el pasillo: baja al pasillo, avanza a lo ancho y sube al destino. */
  function goTo(p, x, d, onArrive) {
    const lane = LANE + p.laneJ;
    p.path = [{ x: p.x, d: lane }, { x, d: lane }, { x, d }];
    p.onArrive = onArrive;
    p.state = "walk";
  }

  function spawnCustomer() {
    const p = newPerson();
    const spots = [...L.spots].sort(() => Math.random() - 0.5).slice(0, 1 + Math.floor(Math.random() * 2));
    p.plan = [...spots.map((spot) => ({ type: "browse", spot })), { type: "queue" }, { type: "exit" }];
    people.push(p);
    if (!cashier.bubble && Math.random() < 0.5) say(cashier, pick(["¡Buenas!", "¡Hola, vecino!", "Pase no más"]), 1.6);
    next(p);
  }

  function next(p) {
    const step = p.plan.shift();
    if (!step) return;
    if (step.type === "browse") {
      goTo(p, step.spot.x + rand(-12, 12), step.spot.d + rand(-0.02, 0.02), () => {
        p.state = "browse";
        p.timer = rand(1.8, 3);
        p.spot = step.spot;
        p.said = false;
        p.dir = 1;
      });
    } else if (step.type === "queue") {
      queue.push(p);
      walkToQueue(p);
    } else if (step.type === "exit") {
      goTo(p, L.doorSpot.x, L.doorSpot.d, () => (p.gone = true));
    }
  }

  function walkToQueue(p) {
    const spot = L.queueSpot(queue.indexOf(p));
    goTo(p, spot.x, spot.d, () => {
      p.state = "queue";
      p.dir = 1;
    });
  }

  // ------------------------------------------------------------ accidentes
  /** Dos clientes chocan en el pasillo: estrellitas, frases y quizás se cae algo. */
  function bump(a, b) {
    const [la, lb] = pick(BUMP);
    for (const [p, line, delay] of [
      [a, la, 0],
      [b, lb, 0.5],
    ]) {
      p.prev = p.state;
      p.state = "bumped";
      p.timer = 1.6;
      p.stars = 1.6;
      p.kb = -Math.sign(p.vx || p.dir) * 46;
      p.cool = rand(8, 14);
      setTimeout(() => say(p, line, 1.8), delay * 1000);
    }
    const dropper = [a, b].find((p) => p.basket.length) ?? (Math.random() < 0.5 ? a : null);
    if (dropper) {
      const kind = dropper.basket.pop() ?? pick(["palta", "tomate", "bebida", "pan"]);
      const item = { kind, x: dropper.x, d: clamp(dropper.d + 0.06, 0, 0.95), vx: Math.sign(dropper.vx || dropper.dir) * rand(40, 70), spin: 0 };
      items.push(item);
      if (kind === "bebida" && Math.random() < 0.7) {
        item.spill = { x: item.x + item.vx * 0.5, d: item.d, r: 0 };
        puddles.push(item.spill);
      }
      worker.tasks.push({ type: "pickup", item });
    }
    bumpCooldown = rand(6, 11);
  }

  /** Casi chocan, pero uno esquiva: "Permiso…" / "Pase, pase". */
  function dodge(a, b) {
    const [la, lb] = pick(DODGE);
    say(a, la, 1.4);
    setTimeout(() => say(b, lb, 1.4), 400);
    b.side = 0;
    b.sideT = 1.6;
    a.cool = b.cool = rand(5, 9);
  }

  // ------------------------------------------------------------ actualizar
  function move(p, dt) {
    const wp = p.path[0];
    if (!wp) return true;
    const dx = wp.x - p.x;
    const dd = (wp.d - p.d) * 128; // la profundidad en píxeles, para medir la distancia
    const dist = Math.hypot(dx, dd);
    const step = p.speed * dt;
    if (dist <= step) {
      p.x = wp.x;
      p.d = wp.d;
      p.path.shift();
      p.walk += dist;
    } else {
      p.x += (dx / dist) * step;
      p.d += (dd / dist / 128) * step;
      p.walk += step;
    }
    p.vx = Math.abs(dx) > 0.5 ? Math.sign(dx) * p.speed : 0;
    if (p.vx) p.dir = Math.sign(p.vx);
    return p.path.length === 0;
  }

  function updatePerson(p, dt) {
    if (p.bubble && (p.bubble.t += dt) > p.bubble.dur) p.bubble = null;
    p.stars = Math.max(0, p.stars - dt);
    p.cool = Math.max(0, p.cool - dt);
    if (p.sideT > 0) {
      p.sideT -= dt;
      p.side += ((p.sideT > 0.5 ? 0.08 : 0) - p.side) * Math.min(1, dt * 8);
    } else p.side *= 0.9;

    switch (p.state) {
      case "walk":
        if (move(p, dt)) {
          p.state = "idle";
          const done = p.onArrive;
          p.onArrive = null;
          done?.();
        }
        break;
      case "bumped":
        p.x += p.kb * dt;
        p.kb *= Math.pow(0.02, dt);
        if ((p.timer -= dt) <= 0) {
          p.state = p.path.length ? "walk" : p.prev === "walk" ? "idle" : p.prev;
          if (p.state === "idle" && p.onArrive) {
            const done = p.onArrive;
            p.onArrive = null;
            done();
          }
        }
        break;
      case "browse":
        p.timer -= dt;
        if (!p.said && p.timer < 2 && Math.random() < 0.6) say(p, pick(p.spot.lines), 1.8);
        p.said = true;
        if (p.timer <= 0) {
          const kind = pick(p.spot.goods);
          p.basket.push(kind);
          p.picked = { kind, t: 0 };
          next(p);
        }
        break;
      case "queue":
        if (queue[0] === p && !p.paying) {
          p.paying = true;
          p.state = "pay";
          p.timer = 2.6;
          say(p, pick(PAY), 1.4);
        }
        break;
      case "pay":
        p.timer -= dt;
        if (p.timer < 1.3 && !p.thanked) {
          p.thanked = true;
          say(cashier, pick(THANKS), 1.5);
          paperT = 0.001; // la mini impresora entrega la boleta
        }
        if (p.timer <= 0) {
          queue.shift();
          for (const q of queue) if (q.state === "queue" || q.state === "walk") walkToQueue(q);
          p.basket = [];
          next(p);
        }
        break;
    }
    if (p.picked && (p.picked.t += dt) > 0.8) p.picked = null;
  }

  function updateWorker(dt) {
    const w = worker;
    if (w.bubble && (w.bubble.t += dt) > w.bubble.dur) w.bubble = null;
    if (w.state === "walk") {
      if (move(w, dt)) {
        w.state = "idle";
        const done = w.onArrive;
        w.onArrive = null;
        done?.();
      }
      return;
    }
    if (w.state === "work") {
      if ((w.timer -= dt) <= 0) {
        w.done?.();
        w.state = "idle";
      }
      return;
    }
    // libre: lo primero son los accidentes; si no hay, repone o vuelve a su lugar
    const task = w.tasks.shift();
    if (task?.type === "pickup") {
      const it = task.item;
      goTo(w, it.x, it.d, () => {
        w.state = "work";
        w.mop = Boolean(it.spill);
        w.timer = it.spill ? 2.2 : 1;
        say(w, it.spill ? "¡Cuidado, piso mojado! 🧽" : "Yo lo ordeno 🤖", 1.8);
        w.done = () => {
          items.splice(items.indexOf(it), 1);
          if (it.spill) puddles.splice(puddles.indexOf(it.spill), 1);
        };
      });
      return;
    }
    if ((w.timer -= dt) <= 0) {
      const spot = pick(L.spots.filter((s) => s.d < 0.2)) ?? L.spots[0];
      goTo(w, spot.x + rand(-10, 10), spot.d + 0.03, () => {
        w.state = "work";
        w.mop = false;
        w.timer = 1.6;
        if (Math.random() < 0.5) say(w, "Reponiendo…", 1.4);
        w.done = () => (w.timer = rand(7, 12));
      });
    }
  }

  function update(dt) {
    spawnIn -= dt;
    const max = L.wide ? 7 : 3;
    if (spawnIn <= 0 && people.length < max) {
      spawnCustomer();
      spawnIn = rand(1.5, 4);
    }
    for (const p of people) updatePerson(p, dt);
    for (let i = people.length - 1; i >= 0; i--) if (people[i].gone) people.splice(i, 1);
    updateWorker(dt);
    if (cashier.bubble && (cashier.bubble.t += dt) > cashier.bubble.dur) cashier.bubble = null;
    if (paperT > 0) paperT = paperT + dt > 2 ? 0 : paperT + dt;

    // productos que ruedan por el piso y charcos que se agrandan
    for (const it of items) {
      it.x += it.vx * dt;
      it.vx *= Math.pow(0.05, dt);
      it.spin += it.vx * dt * 0.2;
    }
    for (const pd of puddles) pd.r = Math.min(18, pd.r + dt * 22);

    // choques y esquives en el pasillo
    bumpCooldown -= dt;
    const walkers = people.filter((p) => p.state === "walk" && Math.abs(p.d - LANE) < 0.08);
    for (let i = 0; i < walkers.length; i++) {
      for (let j = i + 1; j < walkers.length; j++) {
        const a = walkers[i];
        const b = walkers[j];
        if (a.cool || b.cool) continue;
        const dx = b.x - a.x;
        if (Math.abs(dx) > 20 || Math.abs(a.d - b.d) > 0.06) continue;
        if (dx * (a.vx - b.vx) <= 0) continue; // no se están acercando
        if (bumpCooldown <= 0 && Math.random() < 0.65) bump(a, b);
        else dodge(a, b);
      }
    }

    // conversaciones entre quienes están eligiendo productos cerca
    if ((talkCheckIn -= dt) <= 0) {
      talkCheckIn = 1;
      const near = people.filter((p) => p.state === "browse" && !p.bubble);
      for (let i = 0; i < near.length; i++) {
        for (let j = i + 1; j < near.length; j++) {
          const a = near[i];
          const b = near[j];
          if (Math.abs(a.x - b.x) < 110 && Math.abs(a.d - b.d) < 0.3 && Math.random() < 0.5) {
            const [la, lb] = pick(TALK);
            say(a, la, 2);
            setTimeout(() => say(b, lb, 2), 1300);
            a.timer += 2;
            b.timer += 2;
            a.dir = Math.sign(b.x - a.x) || 1;
            b.dir = -a.dir;
            return;
          }
        }
      }
    }
    if ((offerIn -= dt) <= 0) {
      offerIn = rand(14, 22);
      if (!cashier.bubble) say(cashier, pick(OFFERS), 1.8);
    }
  }

  // ------------------------------------------------------------ dibujar
  function drawShadow(x, y, w = 10) {
    ctx.fillStyle = "rgba(40,30,20,.25)";
    ctx.beginPath();
    ctx.ellipse(x, y, w, 3.2, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  /** Dibuja a escala S alrededor de los pies (x, y). */
  function scaled(x, y, fn) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(S, S);
    ctx.translate(-x, -y);
    fn();
    ctx.restore();
  }

  function drawPerson(p) {
    const x = Math.round(p.x);
    const y = Math.round(floorY(p.d + p.side));
    scaled(x, y, () => drawPersonAt(p, x, y));
  }

  function drawPersonAt(p, x, y) {
    const L2 = p.look;
    const moving = p.state === "walk";
    const swing = moving ? Math.sin(p.walk / 4) * 3 : 0;
    const bob = moving ? Math.abs(Math.sin(p.walk / 4)) * 1.2 : 0;
    const top = y - bob;
    drawShadow(x, y);
    // piernas
    ctx.fillStyle = L2.pants;
    ctx.fillRect(x - 5 + swing * 0.6, top - 14, 4, 14);
    ctx.fillRect(x + 1 - swing * 0.6, top - 14, 4, 14);
    ctx.fillStyle = "#2a2a2a";
    ctx.fillRect(x - 6 + swing * 0.6, top - 2, 5, 2);
    ctx.fillRect(x + 1 - swing * 0.6, top - 2, 5, 2);
    // cuerpo
    ctx.fillStyle = L2.shirt;
    roundRect(ctx, x - 7, top - 31, 14, 18, 3);
    ctx.fill();
    // brazos (el de adelante se levanta al tomar un producto)
    const reaching = p.state === "browse" && p.timer < 0.7;
    ctx.fillStyle = L2.shirt;
    ctx.fillRect(x - 9, top - 29 - swing * 0.5, 3, 11);
    if (reaching) ctx.fillRect(x + 6 * p.dir, top - 38, 3, 11);
    else ctx.fillRect(x + 6, top - 29 + swing * 0.5, 3, 11);
    ctx.fillStyle = L2.skin;
    if (reaching) ctx.fillRect(x + 6 * p.dir, top - 40, 3, 3);
    // canasto con lo que lleva
    if (p.basket.length) {
      const bx = x + p.dir * 10 - 5;
      ctx.fillStyle = "#c8323d";
      ctx.fillRect(bx, top - 20, 11, 7);
      ctx.fillStyle = "#8f1f28";
      ctx.fillRect(bx + 1, top - 25, 1, 5);
      ctx.fillRect(bx + 9, top - 25, 1, 5);
      p.basket.slice(-3).forEach((k, i) => drawItem(k, bx + 2.5 + i * 3, top - 19, 0.55));
    }
    // cabeza
    ctx.fillStyle = L2.skin;
    roundRect(ctx, x - 6, top - 44, 12, 13, 4);
    ctx.fill();
    // pelo
    const hair = L2.hair;
    if (L2.style === "cap") {
      ctx.fillStyle = L2.cap;
      ctx.fillRect(x - 6, top - 46, 12, 5);
      ctx.fillRect(x + (p.dir > 0 ? 3 : -9), top - 42, 6, 2);
    } else if (L2.style !== "bald") {
      ctx.fillStyle = hair;
      ctx.fillRect(x - 6, top - 46, 12, 5);
      ctx.fillRect(x - p.dir * 6 - (p.dir > 0 ? 0 : 2), top - 44, 2, 6);
      if (L2.style === "long") ctx.fillRect(x - p.dir * 7 - 1, top - 42, 4, 12);
      if (L2.style === "bun") {
        ctx.beginPath();
        ctx.arc(x - p.dir * 2, top - 47, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // ojos (con un choque, se ven mareados: "x x")
    ctx.fillStyle = "#1f1f22";
    const ex = x + p.dir * 2;
    if (p.stars > 0) {
      ctx.font = "700 6px sans-serif";
      ctx.fillText("x", ex - 4, top - 34);
      ctx.fillText("x", ex + 1, top - 34);
    } else {
      ctx.fillRect(ex - 3, top - 39, 2, 2);
      ctx.fillRect(ex + 1, top - 39, 2, 2);
    }
    // estrellitas del choque, girando sobre la cabeza
    if (p.stars > 0) {
      ctx.fillStyle = "#ffd60a";
      const t = performance.now() / 160;
      for (let i = 0; i < 3; i++) {
        const a = t + (i * Math.PI * 2) / 3;
        ctx.font = "700 9px sans-serif";
        ctx.fillText("✦", x + Math.cos(a) * 10 - 3, top - 52 + Math.sin(a) * 3);
      }
    }
    // el producto recién elegido sube un poquito antes de ir al canasto
    if (p.picked) {
      const k = p.picked.t / 0.8;
      drawItem(p.picked.kind, x + p.dir * 8, top - 44 - k * 10, 1);
    }
  }

  /** Un agente bot (cajero o reponedor). */
  function drawBot(b) {
    const x = Math.round(b.x);
    const y = Math.round(floorY(b.d));
    scaled(x, y, () => drawBotAt(b, x, y));
  }

  function drawBotAt(b, x, y) {
    const moving = b.state === "walk";
    const bob = Math.sin(performance.now() / (moving ? 90 : 400)) * (moving ? 1.2 : 0.8);
    const top = y + bob;
    drawShadow(x, y, 9);
    ctx.fillStyle = "#3b4060";
    ctx.fillRect(x - 6, top - 6, 4, 6);
    ctx.fillRect(x + 2, top - 6, 4, 6);
    ctx.fillStyle = b.color;
    roundRect(ctx, x - 8, top - 26, 16, 20, 4);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,.85)";
    ctx.fillRect(x - 4, top - 18, 8, 2);
    // cabeza con antena y ojos
    ctx.fillStyle = b.color;
    roundRect(ctx, x - 9, top - 41, 18, 14, 5);
    ctx.fill();
    ctx.fillRect(x - 1, top - 46, 2, 5);
    ctx.beginPath();
    ctx.arc(x, top - 47, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.fillRect(x - 5 + (b.dir || 0), top - 36, 3, 3);
    ctx.fillRect(x + 2 + (b.dir || 0), top - 36, 3, 3);
    // el trapero, si está limpiando un charco
    if (b.state === "work" && b.mop) {
      const t = Math.sin(performance.now() / 120) * 4;
      ctx.fillStyle = "#8a5f3a";
      ctx.fillRect(x + 9, top - 30, 2, 28);
      ctx.fillStyle = "#cfd6e4";
      ctx.fillRect(x + 4 + t, top - 3, 12, 3);
    }
  }

  function drawGondola(g) {
    const y = floorY(g.d);
    box(g.x, y, g.w, 54, g.color, "#e9edf5", "#2a3058", 16);
    // dos repisas de productos en el frente
    for (let r = 0; r < 2; r++) {
      ctx.fillStyle = "rgba(255,255,255,.9)";
      ctx.fillRect(g.x + 4, y - 54 + 24 + r * 24, g.w - 8, 2);
      for (let x = g.x + 9; x < g.x + g.w - 6; x += 10) drawItem(g.goods[(Math.floor(x / 10) + r) % g.goods.length], x, y - 54 + 23 + r * 24, 0.9);
    }
  }

  function drawFruit(f) {
    const y = floorY(f.d);
    box(f.x, y, f.w, 22, "#9b6b3c", "#7a4f2a", "#6b4426", 12);
    // las frutas sobre la tapa
    const kinds = ["palta", "tomate", "palta"];
    for (let c = 0; c < 3; c++) {
      for (let i = 0; i < Math.floor(f.w / 3 / 8); i++) {
        drawItem(kinds[c], f.x + 6 + c * (f.w / 3) + i * 8, y - 22 - 1 + ((i + c) % 2) * -2, 1);
      }
    }
    // el precio, en un palito
    ctx.fillStyle = "#6b4426";
    ctx.fillRect(f.x + f.w - 12, y - 46, 2, 24);
    ctx.fillStyle = "#fff";
    ctx.fillRect(f.x + f.w - 34, y - 54, 46, 12);
    ctx.fillStyle = "#c8323d";
    ctx.font = "700 8px 'Open Sans', sans-serif";
    ctx.fillText("Palta $2.990", f.x + f.w - 32, y - 45);
  }

  function drawCounter(c) {
    const y = floorY(c.d);
    box(c.x, y, c.w, 36, "#c8323d", "#f2efe6", "#8f1f28", 18);
    ctx.fillStyle = "#fff";
    ctx.font = "700 9px Poppins, 'Open Sans', sans-serif";
    ctx.fillText("CAJA", c.x + 10, y - 14);
    // la caja registradora con su mini impresora y la pantallita verde
    const rx = c.x + c.w - 52;
    box(rx, y - 36 - 2, 34, 14, "#3b4060", "#55608a", "#262b45", 8);
    ctx.fillStyle = "#93b263";
    ctx.fillRect(rx + 4, y - 36 - 13, 18, 6);
    box(rx - 22, y - 36 - 2, 18, 9, "#e8dcc0", "#f3ecda", "#c9bd9e", 6);
    // la boleta saliendo (cuando alguien paga)
    if (paperT > 0) {
      const len = Math.min(1, paperT / 0.9) * 16;
      ctx.fillStyle = "#fdfcf8";
      ctx.fillRect(rx - 18, y - 36 - 11 - len, 10, len);
      ctx.fillStyle = "#9aa0ad";
      for (let i = 3; i < len; i += 3) ctx.fillRect(rx - 16, y - 36 - 11 - i, 6, 1);
    }
  }

  function drawPuddle(pd) {
    ctx.fillStyle = "rgba(200,50,61,.35)";
    ctx.beginPath();
    ctx.ellipse(pd.x, floorY(pd.d), pd.r, pd.r * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
    // el cono amarillo de "piso mojado"
    if (pd.r > 10) {
      const x = pd.x + pd.r + 6;
      const y = floorY(pd.d);
      ctx.fillStyle = "#ffd60a";
      ctx.beginPath();
      ctx.moveTo(x - 6, y);
      ctx.lineTo(x, y - 18);
      ctx.lineTo(x + 6, y);
      ctx.fill();
      ctx.fillStyle = "#1f1f22";
      ctx.fillRect(x - 2, y - 10, 4, 2);
    }
  }

  const placed = []; // los globos ya dibujados en este cuadro

  function drawBubble(who) {
    const b = who.bubble;
    if (!b) return;
    const isBot = who.kind !== "customer";
    const x = who.x;
    const headY = floorY(who.d + (who.side || 0)) - (isBot ? 52 : 50) * S;
    const alpha = Math.min(1, b.t * 6, (b.dur - b.t) * 4);
    ctx.save();
    ctx.globalAlpha = clamp(alpha, 0, 1);
    ctx.font = "600 10.5px 'Open Sans', sans-serif";
    const w = ctx.measureText(b.text).width + 14;
    const bx = clamp(x - w / 2, 4, W - w - 4);
    let by = headY - 22 - (1 - Math.min(1, b.t * 5)) * 4;
    // si tapa a otro globo, sube un piso (así se leen los dos en una conversación o un choque)
    while (placed.some((r) => bx < r.x + r.w && bx + w > r.x && by < r.y + 20 && by + 20 > r.y)) by -= 21;
    placed.push({ x: bx, y: by, w });
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = isBot ? who.color : "#2a2f4f";
    ctx.lineWidth = 1.5;
    roundRect(ctx, bx, by, w, 18, 8);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(clamp(x, bx + 8, bx + w - 8) - 4, by + 17.5);
    ctx.lineTo(clamp(x, bx + 8, bx + w - 8), by + 23);
    ctx.lineTo(clamp(x, bx + 8, bx + w - 8) + 4, by + 17.5);
    ctx.fill();
    ctx.fillStyle = "#1f1f22";
    ctx.fillText(b.text, bx + 7, by + 12.5);
    ctx.restore();
  }

  function drawDynamicWall(t) {
    // el letrero "ABIERTO" de la puerta, en neón que parpadea a veces
    const on = Math.sin(t / 900) > -0.92;
    const { door } = L;
    ctx.fillStyle = on ? "#ff4d6d" : "#7a3340";
    ctx.font = "700 9px 'Open Sans', sans-serif";
    ctx.save();
    if (on) {
      ctx.shadowColor = "#ff4d6d";
      ctx.shadowBlur = 8;
    }
    ctx.fillText("ABIERTO", door.x + 8, 20);
    ctx.restore();
    // el reloj
    const cx = L.counter.x + L.counter.w / 2;
    const cy = 30;
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "#6b4a2e";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    const now = new Date();
    const hand = (a, len) => {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.sin(a) * len, cy - Math.cos(a) * len);
      ctx.stroke();
    };
    ctx.strokeStyle = "#1f1f22";
    ctx.lineWidth = 1.5;
    hand(((now.getHours() % 12) + now.getMinutes() / 60) * (Math.PI / 6), 6);
    hand(now.getMinutes() * (Math.PI / 30), 8.5);
  }

  function draw() {
    const t = performance.now();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (bg) ctx.drawImage(bg, 0, 0);
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    drawDynamicWall(t);
    for (const pd of puddles) drawPuddle(pd);

    // Todo lo que está en el piso, de atrás hacia adelante.
    const things = [
      ...L.gondolas.map((g) => ({ y: floorY(g.d), draw: () => drawGondola(g) })),
      { y: floorY(L.fruit.d), draw: () => drawFruit(L.fruit) },
      { y: floorY(cashier.d), draw: () => drawBot(cashier) },
      { y: floorY(L.counter.d), draw: () => drawCounter(L.counter) },
      { y: floorY(worker.d), draw: () => drawBot(worker) },
      ...people.map((p) => ({ y: floorY(p.d + p.side), draw: () => drawPerson(p) })),
      ...items.map((it) => ({
        y: floorY(it.d),
        draw: () => {
          ctx.save();
          ctx.translate(it.x, floorY(it.d));
          ctx.rotate(it.spin);
          drawItem(it.kind, 0, 4, 1.1);
          ctx.restore();
        },
      })),
    ].sort((a, b) => a.y - b.y);
    for (const th of things) th.draw();

    // Los globos de diálogo, encima de todo (sin taparse entre ellos).
    placed.length = 0;
    for (const p of people) drawBubble(p);
    drawBubble(cashier);
    drawBubble(worker);
  }

  // ------------------------------------------------------------ el ciclo
  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    scale = rect.height / WORLD_H;
    W = rect.width / scale;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const first = !L;
    L = layout();
    paintBackground();
    if (first) {
      cashier = { ...newPerson("bot"), kind: "cashier", color: agentColor("api"), x: L.counter.x + L.counter.w / 2 - 14, d: 0.07, state: "idle" };
      worker = { ...newPerson("bot"), kind: "worker", color: agentColor("worker"), x: L.bread.x + 30, d: 0.12, state: "idle", tasks: [], timer: 3, speed: 58 };
      if (calm) {
        // escena quieta: un par de clientes eligiendo, sin animación
        for (const spot of L.spots.slice(0, 3)) {
          const p = newPerson();
          Object.assign(p, { x: spot.x, d: spot.d, state: "browse", timer: 99, spot });
          people.push(p);
        }
      }
    } else {
      // al cambiar el ancho, la caja y los bots se reubican
      cashier.x = L.counter.x + L.counter.w / 2 - 14;
      worker.x = clamp(worker.x, 20, W - 20);
      for (const p of people) p.x = clamp(p.x, 10, W - 10);
    }
    draw();
  }

  let visible = false;
  let last = 0;
  let raf = 0;
  function frame(now) {
    raf = 0;
    if (!visible || document.hidden || calm) return;
    const dt = Math.min(0.05, (now - (last || now)) / 1000);
    last = now;
    update(dt);
    draw();
    raf = requestAnimationFrame(frame);
  }
  function play() {
    if (!raf && visible && !document.hidden && !calm) {
      last = 0;
      raf = requestAnimationFrame(frame);
    }
  }

  new IntersectionObserver((entries) => {
    visible = entries[0].isIntersecting;
    play();
  }).observe(canvas);
  document.addEventListener("visibilitychange", play);
  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 150);
  });
  // Las fuentes del letrero llegan un poco después: se repinta el fondo cuando están.
  document.fonts?.ready.then(() => L && paintBackground());
  resize();
}
