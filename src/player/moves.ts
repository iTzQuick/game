// Movimenti del corpo per attacchi e abilità: oltre al clip d'attacco, tutto il
// personaggio ruota, affonda, salta o si solleva. Così i tre colpi della combo e
// ogni abilità si riconoscono a colpo d'occhio. Funzioni pure: si testano da sole.

import type { ClassId } from '../game/constants';

export type MoveStyle =
  | 'swing' // colpo della combo (cambia con il numero del colpo)
  | 'bash' // affondo con lo scudo
  | 'roar' // provocazione: petto in fuori
  | 'slam' // salto breve e colpo a terra
  | 'leap' // gran salto e schianto
  | 'dash' // scatto in avanti, chinato
  | 'spin' // giravolta (due giri)
  | 'veil' // mezzo giro rannicchiato
  | 'cast' // incantesimo: piccolo balzo
  | 'push' // spinta in avanti
  | 'shoot' // colpo a distanza: rinculo
  | 'raise' // si solleva un poco, braccia al cielo
  | 'rise'; // si alza in volo girando (Ultra)

type Slot = 'Q' | 'E' | 'R' | 'F';

/** Il movimento di ogni abilità. */
export const ABILITY_MOVES: Record<ClassId, Record<Slot, MoveStyle>> = {
  guardiano: { Q: 'bash', E: 'roar', R: 'slam', F: 'leap' },
  lama: { Q: 'dash', E: 'spin', R: 'veil', F: 'spin' },
  tessitore: { Q: 'cast', E: 'push', R: 'shoot', F: 'rise' },
  custode: { Q: 'cast', E: 'raise', R: 'raise', F: 'rise' },
};

export const abilityMove = (cls: ClassId | null, slot: Slot): MoveStyle => (cls ? ABILITY_MOVES[cls][slot] : 'swing');

/** Durata del movimento (secondi). */
export const MOVE_DURATION: Record<MoveStyle, number> = {
  swing: 0.36,
  bash: 0.42,
  roar: 0.6,
  slam: 0.55,
  leap: 0.75,
  dash: 0.32,
  spin: 0.6,
  veil: 0.42,
  cast: 0.45,
  push: 0.42,
  shoot: 0.3,
  raise: 0.75,
  rise: 0.95,
};

/** Spostamenti del corpo: rotazioni (radianti) attorno a x (in avanti) e y, altezza e passo in avanti (metri), scala. */
export interface BodyOffset {
  rx: number;
  ry: number;
  y: number;
  z: number;
  s: number;
}

const ZERO: BodyOffset = { rx: 0, ry: 0, y: 0, z: 0, s: 1 };
const bump = (k: number) => Math.sin(Math.PI * Math.min(1, Math.max(0, k)));
const easeOut = (k: number) => 1 - (1 - k) * (1 - k);

/**
 * Il movimento al punto `k` (0 = inizio, 1 = fine) dello stile, per il colpo
 * numero `n` della combo. A k = 0 e k = 1 il corpo è sempre a riposo.
 */
export function bodyOffset(style: MoveStyle, n: number, k: number): BodyOffset {
  if (k <= 0 || k >= 1) return ZERO;
  const b = bump(k);
  switch (style) {
    case 'swing':
      // 1: da destra a sinistra; 2: al contrario; 3: affondo pesante in avanti
      if (n === 3) return { rx: 0.3 * b, ry: 0, y: -0.06 * b, z: 0.45 * b, s: 1 };
      return { rx: 0.08 * b, ry: (n === 2 ? -1 : 1) * (0.5 - 0.85 * easeOut(k)) * b * 1.4, y: 0, z: 0.12 * b, s: 1 };
    case 'bash':
      return { rx: 0.35 * b, ry: 0, y: 0, z: 0.75 * b, s: 1 };
    case 'roar':
      return { rx: -0.22 * b, ry: 0, y: 0.12 * b, z: 0, s: 1 + 0.07 * b };
    case 'slam': {
      const up = k < 0.6 ? bump(k / 0.6) : 0;
      return { rx: k < 0.6 ? -0.1 * up : 0.35 * bump((k - 0.6) / 0.4), ry: 0, y: 0.55 * up, z: 0.2 * b, s: 1 };
    }
    case 'leap': {
      // in salita si inarca, in discesa si getta in avanti sul colpo
      const t = Math.min(1, Math.max(0, (k - 0.35) / 0.35));
      const fwd = t * t * (3 - 2 * t);
      return { rx: (-0.15 * (1 - fwd) + 0.4 * fwd) * b, ry: 0, y: 1.2 * bump(Math.min(1, k * 1.15)), z: 0.5 * b, s: 1 };
    }
    case 'dash':
      return { rx: 0.45 * b, ry: 0, y: -0.08 * b, z: 0.3 * b, s: 1 };
    case 'spin':
      return { rx: 0.05 * b, ry: Math.PI * 4 * easeOut(k), y: 0.15 * b, z: 0, s: 1 };
    case 'veil':
      return { rx: 0.2 * b, ry: Math.PI * 2 * easeOut(k), y: -0.3 * b, z: 0, s: 1 - 0.08 * b };
    case 'cast':
      return { rx: -0.12 * b, ry: 0, y: 0.14 * b, z: 0, s: 1 };
    case 'push':
      return { rx: 0.25 * b, ry: 0, y: 0, z: 0.28 * b, s: 1 };
    case 'shoot': {
      const r = (1 - k) * (1 - k);
      return { rx: -0.18 * r * Math.min(1, k * 8), ry: 0, y: 0, z: -0.12 * r * Math.min(1, k * 8), s: 1 };
    }
    case 'raise':
      return { rx: -0.16 * b, ry: 0, y: 0.38 * b, z: 0, s: 1 };
    case 'rise':
      return { rx: -0.1 * b, ry: Math.PI * 2 * easeOut(k), y: 0.95 * b, z: 0, s: 1 };
  }
}

/** Schivata: uno scatto basso in avanti (non più la capriola). `k` va da 0 a 1. */
export function dodgeOffset(k: number): BodyOffset {
  if (k <= 0 || k >= 1) return ZERO;
  const b = bump(k);
  return { rx: 0.5 * b, ry: 0, y: -0.14 * b, z: 0, s: 1 - 0.06 * b };
}
