// I nomi sopra altari ed edifici si vedono solo da vicino: da lontano
// riempivano lo schermo di scritte.

import { localDebug } from '../player/LocalPlayer';

/** Distanza (m) entro cui il nome compare. */
export const LABEL_RADIUS = 9;

/** Da chiamare in useFrame: mostra o nasconde l'etichetta secondo la distanza. */
export function fadeByDistance(el: HTMLElement | null, x: number, z: number, radius = LABEL_RADIUS) {
  if (!el) return;
  const near = Math.hypot(localDebug.pos.x - x, localDebug.pos.z - z) < radius;
  const want = near ? '1' : '0';
  if (el.style.opacity !== want) el.style.opacity = want;
}
