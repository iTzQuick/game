// Messaggi del combattimento.

import type { ClassId } from '../game/constants';
import type { Hit, SimEvent } from './sim';
import type { BuildingId, Item } from '../progress/defs';

type V2 = [number, number];

/** Istantanea dei nemici (host → tutti, canale veloce). Riga: id, tipo, x, z, yaw, vita, vitaMax, stati. */
export interface EnemySnapshot {
  t: 'en';
  ts: number;
  e: number[][];
}

export type ZoneKind = 'barriera' | 'varco' | 'trappola' | 'collasso';

export interface ZoneSpec {
  id: string;
  kind: ZoneKind;
  owner: string;
  x: number;
  z: number;
  /** Secondo punto (l'uscita del Varco). */
  x2?: number;
  z2?: number;
  r: number;
  /** durata in ms */
  dur: number;
  lit?: boolean;
  /** danni al secondo e forza di risucchio (Trappola, Collasso), con i talenti */
  dps?: number;
  pull?: number;
  /** colpo finale del Collasso */
  finalDmg?: number;
}

export type AbilitySlot = 'Q' | 'E' | 'R' | 'F';

export type CombatMsg =
  | EnemySnapshot
  | SimEvent
  | { t: 'hit'; h: Hit[] }
  | { t: 'zone'; z: ZoneSpec }
  | { t: 'zlit'; id: string }
  /** Effetto visivo di un'abilità usata da un giocatore (gli altri lo vedono). */
  | { t: 'ab'; cls: ClassId; a: AbilitySlot; p: [number, number, number]; r: number; to?: V2; path?: V2[]; tid?: string }
  | { t: 'heal'; to: string; amt: number }
  | { t: 'bless'; p: V2; r: number; shield: number; speed: number; dur: number }
  | { t: 'alba'; p: V2; r: number; heal?: number }
  | { t: 'combo'; name: string; ids: string[] }
  /** `m`: id della missione del giorno da giocare (solo con 'start') */
  | { t: 'runreq'; a: 'start' | 'leave' | 'abandon'; m?: string }
  /** bottino deciso dall'host per un giocatore (`why`: missione compiuta) */
  | { t: 'loot'; items: Item[]; frags: number; why?: string }
  /** un giocatore ha fatto qualcosa che la missione vieta (al host) */
  | { t: 'mfail'; k: 'pozione' }
  /** voto della compagnia (al host): indice dell'opzione */
  | { t: 'voto'; v: 0 | 1 }
  /** frammenti versati in un edificio della base (al host) e conferma */
  | { t: 'contrib'; b: BuildingId; n: number }
  | { t: 'contribok'; b: BuildingId; used: number };

/** Stati del giocatore inviati con la posizione. */
export const VF = {
  down: 1,
  dead: 2,
  veil: 4,
  bastion: 8,
  shield: 16,
  invuln: 32,
} as const;

export const COMBO_NAMES = {
  spalle: 'Alle spalle',
  varcoOmbra: 'Varco d’ombra',
  implosione: 'Implosione',
  barrieraLuce: 'Barriera di luce',
  varcoLuce: 'Varco luminoso',
  esecuzione: 'Esecuzione',
} as const;
