// Sonidos de la impresora: una grabación real de impresora antigua
// (public/sounds/impresora.mp3, "Impresora antigua: efecto de sonido" de
// Efectos de sonido para todos), recortada a mono y sin el silencio inicial.
//
// La grabación tiene dos partes que se usan por separado:
//   print(ms) -> el cabezal imprimiendo línea por línea (desde PRINT_FROM)
//   cut()     -> el final de la grabación, el golpe seco del corte (desde CUT_FROM)
//   beep()    -> dos pitidos cortos (sintetizados): boleta lista
//
// Los navegadores solo dejan sonar audio después de un clic o una tecla; unlock()
// se llama en el primer clic para tener el audio listo cuando llegue la boleta.

const URL_SOUND = "/sounds/impresora.mp3";
const PRINT_FROM = 0.05; // s: empieza a imprimir (ráfagas de las agujas)
const PRINT_UNTIL = 13.9; // s: después de esto viene el corte
const CUT_FROM = 14.35; // s: el corte del papel, hasta el final
const KEY = "eventflow-sound";

let enabled = readSetting();
let ctx = null;
let master = null;
let buffer = null; // la grabación ya decodificada
let loading = null;
const playing = new Set(); // lo que suena ahora (para poder cortarlo)
let pad = null; // el acorde de fondo de la búsqueda, mientras suena

function readSetting() {
  try {
    return localStorage.getItem(KEY) !== "0";
  } catch {
    return true;
  }
}

/** Crea (o despierta) el contexto de audio y empieza a cargar la grabación. */
function audio() {
  if (!ctx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.8;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") ctx.resume();
  if (!loading) {
    loading = fetch(URL_SOUND)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))))
      .then((data) => ctx.decodeAudioData(data))
      .then((decoded) => (buffer = decoded))
      .catch(() => null); // sin sonido: el resto del sitio funciona igual
  }
  return ctx;
}

function stopAll() {
  for (const src of playing) {
    try {
      src.stop();
    } catch {
      /* ya terminó */
    }
  }
  playing.clear();
}

/** Toca un trozo de la grabación, con entrada y salida suaves (sin "clics"). */
let noiseBuffer = null;

/** Ruido blanco (base del roce del cajón, el papel y el soplido). */
function noise() {
  if (!noiseBuffer) {
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;
  return src;
}

/** Un golpecito grave y corto (el cajón que llega al tope). */
function thunk(t, freq = 95, gain = 0.5) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(45, t + 0.06);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + 0.08);
}

function playSlice(from, seconds, { fadeIn = 0.02, fadeOut = 0.12, volume = 1 } = {}) {
  if (!buffer) return;
  const t = ctx.currentTime + 0.01;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(volume, t + fadeIn);
  g.gain.setValueAtTime(volume, t + Math.max(fadeIn, seconds - fadeOut));
  g.gain.linearRampToValueAtTime(0, t + seconds);
  src.connect(g).connect(master);
  src.start(t, from, seconds + 0.02);
  playing.add(src);
  src.onended = () => playing.delete(src);
}

export const sound = {
  get enabled() {
    return enabled;
  },

  setEnabled(on) {
    enabled = on;
    try {
      localStorage.setItem(KEY, on ? "1" : "0");
    } catch {
      /* sin almacenamiento: solo dura esta visita */
    }
    if (!on) {
      stopAll();
      this.searchStop(0.2);
    }
  },

  /** Llamar dentro de un clic: deja el audio listo (y la grabación cargada) para más tarde. */
  unlock() {
    if (enabled) audio();
  },

  /** La impresión: el tramo de la grabación que dura lo mismo que sale el papel. */
  print(ms) {
    if (!enabled || ms <= 0 || !audio()) return;
    stopAll();
    const seconds = Math.min(ms / 1000, PRINT_UNTIL - PRINT_FROM);
    playSlice(PRINT_FROM, seconds, { fadeOut: 0.15 });
  },

  /** El corte del papel: el final de la grabación. */
  cut() {
    if (!enabled || !audio() || !buffer) return;
    playSlice(CUT_FROM, buffer.duration - CUT_FROM, { fadeIn: 0.005, fadeOut: 0.05 });
  },

  /** Aviso de reparto: un "ding-dong" corto y suave cuando cambia el estado del pedido. */
  notify(status) {
    if (!enabled || !audio()) return;
    const t = ctx.currentTime + 0.02;
    // Entregado: una pequeña fanfarria (do-mi-sol-do). Los demás: "ding-dong".
    const notes =
      status === "entregado"
        ? [
            [523.3, 0],
            [659.3, 0.11],
            [784, 0.22],
            [1046.5, 0.36],
          ]
        : [
            [1318.5, 0],
            [987.8, 0.16],
          ];
    notes.forEach(([freq, delay]) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t + delay);
      g.gain.exponentialRampToValueAtTime(0.18, t + delay + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + delay + 0.5);
      osc.connect(g).connect(master);
      osc.start(t + delay);
      osc.stop(t + delay + 0.55);
    });
  },

  // -------------------------------------------------------------------------
  // La búsqueda en el archivo (src/search.js): un acorde de fondo muy suave que
  // queda "en suspenso" mientras se busca y se resuelve al final (mayor si el
  // pedido aparece, menor si no), más el roce del cajón y el papel de las fichas.

  /** Empieza el acorde de fondo (Asus2, grave y filtrado). Se detiene con resolve(). */
  searchStart() {
    if (!enabled || !audio()) return;
    this.searchStop(0.1);
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(0.045, t + 1.2); // entra despacio
    const low = ctx.createBiquadFilter();
    low.type = "lowpass";
    low.frequency.value = 900;
    // un leve vaivén de volumen, como si respirara
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.value = 0.35;
    depth.gain.value = 0.012;
    lfo.connect(depth).connect(out.gain);
    lfo.start(t);
    const voices = [220, 246.9, 329.6, 493.9].map((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = i % 2 ? "sine" : "triangle";
      osc.frequency.value = freq;
      osc.detune.value = (i - 1.5) * 4; // un poco desafinado: más cálido
      osc.connect(low);
      osc.start(t);
      return osc;
    });
    low.connect(out).connect(master);
    pad = { out, nodes: [...voices, lfo] };
  },

  /** Apaga el acorde de fondo en `fade` segundos. */
  searchStop(fade = 0.6) {
    if (!pad || !ctx) return;
    const { out, nodes } = pad;
    pad = null;
    const t = ctx.currentTime;
    out.gain.cancelScheduledValues(t);
    out.gain.setValueAtTime(Math.max(out.gain.value, 0.0001), t);
    out.gain.exponentialRampToValueAtTime(0.0001, t + fade);
    for (const n of nodes) n.stop(t + fade + 0.05);
  },

  /** Resuelve la búsqueda: acorde mayor arpegiado (encontrado) o menor y descendente (no está). */
  searchResolve(found) {
    this.searchStop(0.8);
    if (!enabled || !audio()) return;
    const t = ctx.currentTime + 0.05;
    const notes = found ? [220, 277.2, 329.6, 440, 554.4] : [329.6, 261.6, 220];
    notes.forEach((freq, i) => {
      const at = t + i * (found ? 0.09 : 0.14);
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(found ? 0.07 : 0.05, at + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, at + (found ? 2 : 1.4));
      osc.connect(g).connect(master);
      osc.start(at);
      osc.stop(at + 2.1);
    });
  },

  /** El roce del cajón al abrirse (o cerrarse): ruido grave que se desliza y un golpecito. */
  drawer(closing = false) {
    if (!enabled || !audio()) return;
    const t = ctx.currentTime + 0.01;
    const src = noise();
    const low = ctx.createBiquadFilter();
    low.type = "lowpass";
    low.frequency.setValueAtTime(closing ? 900 : 350, t);
    low.frequency.linearRampToValueAtTime(closing ? 350 : 900, t + 0.28);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    src.connect(low).connect(g).connect(master);
    src.start(t);
    src.stop(t + 0.35);
    thunk(t + 0.3, closing ? 120 : 80, 0.18);
  },

  /** El "tic" de papel de una ficha al pasarla. */
  flick() {
    if (!enabled || !audio()) return;
    const t = ctx.currentTime + 0.005;
    const src = noise();
    const high = ctx.createBiquadFilter();
    high.type = "bandpass";
    high.frequency.value = 3200 + Math.random() * 1200;
    high.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    src.connect(high).connect(g).connect(master);
    src.start(t);
    src.stop(t + 0.06);
  },

  /** Un soplido suave: la ficha vuela hasta la impresora. */
  whoosh() {
    if (!enabled || !audio()) return;
    const t = ctx.currentTime + 0.01;
    const src = noise();
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.Q.value = 0.9;
    band.frequency.setValueAtTime(500, t);
    band.frequency.exponentialRampToValueAtTime(2400, t + 0.7);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.07, t + 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.85);
    src.connect(band).connect(g).connect(master);
    src.start(t);
    src.stop(t + 0.9);
  },

  /** Boleta lista: dos pitidos cortos y suaves, como una caja registradora. */
  beep() {
    if (!enabled || !audio()) return;
    const t = ctx.currentTime + 0.05;
    for (const start of [t, t + 0.13]) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = 1960;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.06, start + 0.005);
      g.gain.setValueAtTime(0.06, start + 0.07);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.085);
      osc.connect(g).connect(master);
      osc.start(start);
      osc.stop(start + 0.09);
    }
  },
};
