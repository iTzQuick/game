// Suoni del combattimento, creati al momento con il Web Audio del browser:
// niente file da scaricare. Volume nelle Impostazioni (0 = muto).
//
// Il browser (soprattutto su iPhone) fa partire l'audio solo dopo un tocco o un
// tasto: unlockAudio() si aggancia al primo gesto.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
let volume = 0.7;
const lastPlayed = new Map<string, number>();

function makeNoise(c: AudioContext): AudioBuffer {
  const len = Math.floor(c.sampleRate * 1.2);
  const b = c.createBuffer(1, len, c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

function audio(): AudioContext | null {
  if (volume <= 0 || !ctx || !master) return null;
  if (ctx.state !== 'running') {
    void ctx.resume().catch(() => {});
    return null;
  }
  return ctx;
}

/** Crea l'audio al primo gesto dell'utente (richiesto dai browser). */
export function unlockAudio() {
  if (typeof window === 'undefined') return;
  const start = () => {
    try {
      if (!ctx) {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = volume;
        // un compressore evita che tanti colpi insieme gracchino
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -14;
        comp.ratio.value = 6;
        master.connect(comp).connect(ctx.destination);
        noise = makeNoise(ctx);
      }
      void ctx.resume().catch(() => {});
    } catch {
      /* audio non disponibile */
    }
  };
  for (const ev of ['pointerdown', 'keydown', 'touchend'] as const) window.addEventListener(ev, start, { passive: true });
}

export function setVolume(v: number) {
  volume = Math.max(0, Math.min(1, v));
  if (master && ctx) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.02);
}

/** Non ripetere lo stesso suono più spesso di `ms` (un'area che colpisce 8 nemici = un suono solo). */
function gate(key: string, ms: number): boolean {
  const now = performance.now();
  if (now - (lastPlayed.get(key) ?? -1e9) < ms) return false;
  lastPlayed.set(key, now);
  return true;
}

// --- mattoncini -------------------------------------------------------------------

function env(c: AudioContext, peak: number, attack: number, decay: number, at = c.currentTime): GainNode {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
  g.connect(master!);
  return g;
}

function tone(c: AudioContext, type: OscillatorType, f0: number, f1: number, peak: number, attack: number, decay: number, delay = 0) {
  const at = c.currentTime + delay;
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, at);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), at + attack + decay);
  o.connect(env(c, peak, attack, decay, at));
  o.start(at);
  o.stop(at + attack + decay + 0.05);
}

function hiss(c: AudioContext, filter: BiquadFilterType, f0: number, f1: number, q: number, peak: number, attack: number, decay: number, delay = 0) {
  const at = c.currentTime + delay;
  const s = c.createBufferSource();
  s.buffer = noise;
  s.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = c.createBiquadFilter();
  f.type = filter;
  f.Q.value = q;
  f.frequency.setValueAtTime(f0, at);
  f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), at + attack + decay);
  s.connect(f).connect(env(c, peak, attack, decay, at));
  s.start(at, Math.random() * 0.5);
  s.stop(at + attack + decay + 0.05);
}

const jitter = (f: number, amt = 0.08) => f * (1 + (Math.random() * 2 - 1) * amt);

// --- suoni ------------------------------------------------------------------------

export const sfx = {
  /** colpo a segno: tonfo + schiocco; il critico ha anche un tintinnio */
  hit(weight = 1, crit = false) {
    const c = audio();
    if (!c || !gate('hit', 40)) return;
    const w = Math.min(2.5, weight);
    tone(c, 'sine', jitter(150 + 30 * w), 40, 0.35 + 0.18 * w, 0.004, 0.1 + 0.05 * w);
    hiss(c, 'bandpass', jitter(2200), 700, 0.9, 0.22 + 0.08 * w, 0.002, 0.05 + 0.03 * w);
    if (crit) tone(c, 'triangle', jitter(1500, 0.04), 1100, 0.12, 0.003, 0.22);
  },

  /** fendente a vuoto */
  swing(n = 1) {
    const c = audio();
    if (!c || !gate('swing', 60)) return;
    const heavy = n >= 3;
    hiss(c, 'bandpass', heavy ? 380 : jitter(650), heavy ? 1700 : 2600, 1.4, heavy ? 0.2 : 0.14, 0.05, heavy ? 0.2 : 0.12);
  },

  /** colpo a distanza (Tessitore, Custode) */
  shoot() {
    const c = audio();
    if (!c || !gate('shoot', 50)) return;
    tone(c, 'triangle', jitter(900), 320, 0.09, 0.005, 0.12);
    hiss(c, 'highpass', 3000, 1500, 0.7, 0.05, 0.003, 0.06);
  },

  /** nemico sconfitto */
  death(boss = false) {
    const c = audio();
    if (!c || !gate('death', 50)) return;
    const d = boss ? 1.4 : 0.35;
    hiss(c, 'lowpass', boss ? 2400 : 3200, 160, 0.8, boss ? 0.5 : 0.28, 0.005, d);
    tone(c, 'sine', jitter(boss ? 90 : 130), 32, boss ? 0.6 : 0.3, 0.005, d);
    tone(c, 'triangle', jitter(boss ? 300 : 520), boss ? 70 : 160, 0.07, 0.01, d * 0.8, 0.02);
  },

  /** veniamo colpiti */
  hurt(frac = 0.1) {
    const c = audio();
    if (!c || !gate('hurt', 120)) return;
    const k = Math.min(1, 0.4 + frac * 3);
    tone(c, 'square', jitter(120), 55, 0.12 * k, 0.004, 0.13);
    hiss(c, 'lowpass', 1200, 200, 0.6, 0.25 * k, 0.003, 0.12);
  },

  /** abilità: suono che sale; la Ultra è un accordo che si gonfia */
  cast(ultra = false) {
    const c = audio();
    if (!c || !gate('cast', 80)) return;
    if (ultra) {
      for (const [i, f] of [220, 277, 330, 440].entries()) tone(c, 'sawtooth', f, f * 1.5, 0.05, 0.18 + i * 0.03, 0.7);
      hiss(c, 'bandpass', 300, 3000, 0.6, 0.12, 0.3, 0.5);
      tone(c, 'sine', 60, 40, 0.4, 0.2, 0.6);
    } else {
      tone(c, 'sine', jitter(320), 760, 0.12, 0.02, 0.22);
      tone(c, 'triangle', jitter(480), 1100, 0.05, 0.02, 0.2, 0.03);
    }
  },

  /** schivata */
  dodge() {
    const c = audio();
    if (!c || !gate('dodge', 100)) return;
    hiss(c, 'bandpass', 1800, 500, 1.2, 0.13, 0.02, 0.18);
  },

  /** un nemico vicino prepara un attacco */
  warn() {
    const c = audio();
    if (!c || !gate('warn', 180)) return;
    tone(c, 'sine', 180, 260, 0.06, 0.08, 0.12);
  },

  /** bottino, frammenti */
  pickup() {
    const c = audio();
    if (!c || !gate('pickup', 90)) return;
    tone(c, 'sine', 880, 900, 0.09, 0.005, 0.12);
    tone(c, 'sine', 1320, 1340, 0.08, 0.005, 0.18, 0.07);
  },

  /** inizia la carica del colpo: un suono che sale per circa un secondo */
  charge() {
    const c = audio();
    if (!c || !gate('charge', 200)) return;
    tone(c, 'sawtooth', 110, 330, 0.035, 0.6, 0.45);
    tone(c, 'sine', 220, 660, 0.06, 0.8, 0.3);
    hiss(c, 'bandpass', 400, 2200, 2, 0.05, 0.8, 0.3);
  },

  /** carica piena */
  ready() {
    const c = audio();
    if (!c || !gate('ready', 300)) return;
    tone(c, 'triangle', 1320, 1320, 0.12, 0.004, 0.35);
    tone(c, 'sine', 1980, 1980, 0.06, 0.004, 0.4, 0.04);
  },

  /** colpo caricato: un botto profondo, più forte con la carica */
  heavy(level = 1) {
    const c = audio();
    if (!c || !gate('heavy', 120)) return;
    const k = 0.6 + 0.4 * Math.min(1, level);
    tone(c, 'sine', 120, 28, 0.7 * k, 0.004, 0.45 + 0.25 * k);
    hiss(c, 'lowpass', 2600, 120, 0.7, 0.45 * k, 0.003, 0.4 + 0.3 * k);
    tone(c, 'square', 70, 40, 0.06 * k, 0.004, 0.25);
  },

  /** schivata perfetta: un soffio che si ritira e un rintocco cristallino */
  perfect() {
    const c = audio();
    if (!c || !gate('perfect', 400)) return;
    hiss(c, 'bandpass', 3000, 400, 1.5, 0.18, 0.25, 0.2);
    tone(c, 'sine', 1760, 1700, 0.1, 0.01, 0.9, 0.05);
    tone(c, 'sine', 2640, 2600, 0.05, 0.01, 0.8, 0.08);
    tone(c, 'sine', 70, 50, 0.3, 0.01, 0.5);
  },

  /** ruggito del boss (seconda fase) */
  roar() {
    const c = audio();
    if (!c || !gate('roar', 1000)) return;
    tone(c, 'sawtooth', 90, 55, 0.18, 0.15, 1.1);
    tone(c, 'square', 135, 80, 0.06, 0.15, 1.0);
    hiss(c, 'lowpass', 900, 200, 0.8, 0.3, 0.12, 1.1);
  },

  /** a terra */
  down() {
    const c = audio();
    if (!c || !gate('down', 500)) return;
    tone(c, 'triangle', 440, 110, 0.15, 0.01, 0.8);
  },
};
