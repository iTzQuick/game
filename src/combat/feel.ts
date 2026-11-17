// Sensazione dei colpi: la "pausa all'impatto" (le animazioni si fermano per
// qualche centesimo di secondo quando un colpo va a segno) e la scossa della
// telecamera. Solo grafica: il gioco vero non si ferma mai.

let stopUntil = 0;
let trauma = 0;
let seed = Math.random() * 100;

const reduced = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
let enabled = true;

/** Scossa accesa o spenta (Impostazioni). */
export function setShakeEnabled(on: boolean) {
  enabled = on;
  if (!on) trauma = 0;
}

/** Ferma le animazioni per `ms` millisecondi (si prende la pausa più lunga, non si sommano). */
export function hitStop(ms: number) {
  stopUntil = Math.max(stopUntil, performance.now() + Math.min(ms, 260));
}

/** Scuote la telecamera: 0 niente, 1 fortissimo. Più colpi insieme non si sommano all'infinito. */
export function shake(amount: number) {
  if (!enabled) return;
  const a = reduced() ? amount * 0.3 : amount;
  trauma = Math.min(1, Math.max(trauma, a) + a * 0.25);
}

/** Velocità delle animazioni in questo momento: quasi ferme durante la pausa all'impatto. */
export function animScale(now = performance.now()): number {
  return now < stopUntil ? 0.05 : 1;
}

/**
 * Spostamento della telecamera per la scossa (metri) e piccola rotazione (radianti).
 * Va chiamata una volta per frame: la scossa si spegne da sola in circa mezzo secondo.
 */
export function shakeOffset(dt: number, out: { x: number; y: number; z: number; roll: number }) {
  seed += dt * 38;
  const k = trauma * trauma;
  out.x = k * 0.32 * Math.sin(seed * 1.7);
  out.y = k * 0.26 * Math.sin(seed * 2.3 + 1.3);
  out.z = k * 0.2 * Math.sin(seed * 1.3 + 2.1);
  out.roll = k * 0.05 * Math.sin(seed * 1.1 + 0.7);
  trauma = Math.max(0, trauma - dt * 1.9);
  return out;
}

/** Per i test. */
export function resetFeel() {
  stopUntil = 0;
  trauma = 0;
}
