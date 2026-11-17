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
    if (!on) stopAll();
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
