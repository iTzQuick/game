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

// --- telecamera che si avvicina sui colpi forti ---------------------------------------

let zoom = 0;

/** La telecamera si avvicina di colpo e torna indietro (0 niente, 1 molto). */
export function zoomKick(amount: number) {
  if (!enabled) return;
  zoom = Math.min(1, Math.max(zoom, reduced() ? amount * 0.3 : amount));
}

/** Quanto è avvicinata ora (0..1); si spegne da sola in circa mezzo secondo. */
export function zoomAmount(dt: number): number {
  const z = zoom;
  zoom = Math.max(0, zoom - dt * 2.2);
  return z * z * (3 - 2 * z);
}

// --- rallentatore (schivata perfetta) ------------------------------------------------

let slowUntil = 0;
let slowFactor = 1;

/** Rallenta il mondo intorno al giocatore per `ms` millisecondi. */
export function slowMo(ms: number, factor = 0.3) {
  slowUntil = performance.now() + ms;
  slowFactor = factor;
}

// i nemici, visti da qui, restano un po' indietro durante il rallentatore e poi recuperano
let warp = 0;

/** Da chiamare una volta per fotogramma: quanto (ms) i nemici sono mostrati "nel passato". */
export function tickWarp(dtSec: number, now = performance.now()): number {
  const sp = worldSpeed(now);
  if (sp < 1) warp += dtSec * 1000 * (1 - sp);
  else warp = Math.max(0, warp - dtSec * 1000 * 2.5);
  warp = Math.min(warp, 900);
  return warp;
}

/** Il rallentatore è in corso (per l'avviso sullo schermo). */
export function slowActive(now = performance.now()): boolean {
  return now < slowUntil;
}

/** Velocità del mondo ora (1 = normale). */
export function worldSpeed(now = performance.now()): number {
  if (now >= slowUntil) return 1;
  // gli ultimi 150 ms tornano piano alla velocità normale
  const left = slowUntil - now;
  return left < 150 ? slowFactor + (1 - slowFactor) * (1 - left / 150) : slowFactor;
}

/** Per i test. */
export function resetFeel() {
  stopUntil = 0;
  trauma = 0;
  zoom = 0;
  slowUntil = 0;
  warp = 0;
}
