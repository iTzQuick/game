// Numeri del combattimento. Sono un primo bilanciamento: il documento di
// design dice che valori, danni e ricariche si tarano nei test.

import type { ClassId } from '../game/constants';

// --- Classi -----------------------------------------------------------------

export interface ClassStats {
  hp: number;
  speed: number;
  /** Danni dei 3 colpi della combo (mischia) o del colpo singolo (distanza). */
  basic: number[];
  /** Portata del colpo base: raggio in mischia, gittata a distanza. */
  reach: number;
  /** Ampiezza del colpo in mischia (radianti). */
  arc: number;
  /** Ricariche di Q, E, R in secondi. */
  cd: [number, number, number];
}

export const CLASS_STATS: Record<ClassId | 'none', ClassStats> = {
  guardiano: { hp: 180, speed: 5.8, basic: [14, 14, 24], reach: 2.7, arc: 2.1, cd: [7, 12, 16] },
  lama: { hp: 115, speed: 6.8, basic: [12, 12, 20], reach: 2.5, arc: 1.8, cd: [5, 9, 14] },
  tessitore: { hp: 100, speed: 6.2, basic: [16], reach: 20, arc: 0, cd: [10, 11, 6] },
  custode: { hp: 120, speed: 6.2, basic: [12], reach: 18, arc: 0, cd: [9, 12, 16] },
  none: { hp: 100, speed: 6.2, basic: [8, 8, 12], reach: 2.4, arc: 1.8, cd: [99, 99, 99] },
};

export const ULTRA_MAX = 100;
/** Carica della Ultra per ogni punto di danno inflitto, subito o curato. */
export const ULTRA_GAIN = { dealt: 0.55, taken: 0.5, healed: 0.5 };

export const DOWN_SECONDS = 20;
export const REVIVE_SECONDS = 2.5;
export const REVIVE_RADIUS = 2.2;
export const REVIVE_HP = 0.35;

/** Numeri delle abilità, per classe. */
export const AB = {
  scudo: { range: 3.6, arc: 2.1, dmg: 20, stun: 1600 },
  provocazione: { radius: 11, taunt: 5000, reduction: 0.3, dur: 5 },
  barriera: { radius: 4.2, dur: 6, reduction: 0.6 },
  bastione: { dur: 8, tauntRadius: 12, blastRadius: 7, blastBase: 30, blastMul: 1.5 },
  scatto: { dist: 7, behindRange: 9, bonus: 1.5 },
  vortice: { radius: 3.8, ticks: 3, dmg: 14, every: 0.2 },
  velo: { dur: 5, mul: 2 },
  milleTagli: { range: 14, max: 8, dmg: 45, every: 0.16 },
  varco: { dist: 12, dur: 10, radius: 1.1 },
  trappola: { dist: 11, radius: 4.5, dur: 3, dps: 6, pull: 7 },
  dardo: { dmg: 26, bounces: 4, bounceRange: 8, falloff: 0.85, speed: 30 },
  collasso: { dist: 12, radius: 8, dur: 3, dps: 18, pull: 12, final: 80, finalRadius: 4.5 },
  raggio: { range: 14, dur: 3, tick: 0.5, heal: 14 },
  rivelazione: { radius: 16, dur: 8, dmgTaken: 1.25 },
  benedizione: { radius: 13, dur: 6, shield: 35, speed: 1.3 },
  alba: { radius: 30, heal: 0.4, reviveHp: 0.5, blindRadius: 16, blind: 3000 },
};

// --- Nemici -------------------------------------------------------------------

export type EnemyType = 'ombra' | 'sciame' | 'riflesso' | 'bruto' | 'velato' | 'eco' | 'annegato' | 'anguilla' | 'campana';
/** L'ordine conta: nelle istantanee viaggia l'indice. I nuovi tipi si aggiungono in fondo. */
export const ENEMY_TYPES: EnemyType[] = ['ombra', 'sciame', 'riflesso', 'bruto', 'velato', 'eco', 'annegato', 'anguilla', 'campana'];

/** I boss: l'Eco della Frattura e, nella Città Sommersa, La Campana. */
export const isBoss = (t: EnemyType) => t === 'eco' || t === 'campana';

export type AttackShape = 'cone' | 'circle';

export interface EnemyDef {
  name: string;
  hp: number;
  speed: number;
  radius: number;
  /** Distanza a cui inizia l'attacco. */
  range: number;
  /** Tempo di preavviso (il segnale rosso a terra), in secondi. */
  windup: number;
  recover: number;
  dmg: number;
  attack: 'melee' | 'slam' | 'shot' | 'boss';
  /** Forma del colpo in mischia. */
  hitRadius: number;
  hitArc: number;
  /** Per chi spara: distanza preferita dal bersaglio. */
  keepAway?: number;
  projSpeed?: number;
  cost: number;
  /** a fine preavviso scatta in avanti di tanti metri (l'Anguilla) */
  lunge?: number;
  /** ossigeno tolto a chi viene colpito (Città Sommersa) */
  oxygen?: number;
}

export const ENEMIES: Record<EnemyType, EnemyDef> = {
  ombra: { name: 'Ombra', hp: 70, speed: 3.6, radius: 0.5, range: 2.0, windup: 0.55, recover: 0.9, dmg: 12, attack: 'melee', hitRadius: 2.5, hitArc: 1.8, cost: 2 },
  sciame: { name: 'Sciame', hp: 28, speed: 6, radius: 0.35, range: 1.5, windup: 0.35, recover: 0.6, dmg: 6, attack: 'melee', hitRadius: 1.9, hitArc: 1.6, cost: 1 },
  riflesso: { name: 'Riflesso', hp: 55, speed: 3, radius: 0.5, range: 12, windup: 0.6, recover: 2.0, dmg: 14, attack: 'shot', hitRadius: 0.5, hitArc: 0, keepAway: 9, projSpeed: 11, cost: 2 },
  bruto: { name: 'Bruto', hp: 200, speed: 2.4, radius: 1.0, range: 3.0, windup: 1.1, recover: 1.4, dmg: 26, attack: 'slam', hitRadius: 3.4, hitArc: 0, cost: 4 },
  velato: { name: 'Velato', hp: 45, speed: 4.2, radius: 0.45, range: 2.0, windup: 0.5, recover: 0.9, dmg: 14, attack: 'melee', hitRadius: 2.4, hitArc: 1.8, cost: 2 },
  eco: { name: 'L’Eco della Frattura', hp: 1400, speed: 3.4, radius: 1.2, range: 4, windup: 0.8, recover: 1.1, dmg: 22, attack: 'boss', hitRadius: 4.4, hitArc: 2.4, projSpeed: 9, cost: 0 },
  // Città Sommersa
  annegato: { name: 'Annegato', hp: 85, speed: 2.7, radius: 0.5, range: 2.0, windup: 0.7, recover: 1.1, dmg: 11, attack: 'melee', hitRadius: 2.4, hitArc: 1.7, cost: 2, oxygen: 20 },
  anguilla: { name: 'Anguilla d’ombra', hp: 38, speed: 6.2, radius: 0.45, range: 4.5, windup: 0.5, recover: 1.3, dmg: 12, attack: 'melee', hitRadius: 5.2, hitArc: 0.55, cost: 2, lunge: 3.6 },
  campana: { name: 'La Campana', hp: 1600, speed: 2.0, radius: 1.7, range: 5, windup: 0.9, recover: 1.25, dmg: 22, attack: 'boss', hitRadius: 5.5, hitArc: 6.3, projSpeed: 8, cost: 0, oxygen: 15 },
};

/** Nemici delle ondate per mondo (si pescano a caso: i doppioni contano di più). */
export const WAVE_POOLS = {
  frattura: ['sciame', 'ombra', 'ombra', 'riflesso', 'velato', 'bruto'] as EnemyType[],
  'citta-sommersa': ['annegato', 'annegato', 'anguilla', 'anguilla', 'ombra', 'riflesso', 'sciame'] as EnemyType[],
};

/** I velati prendono metà danni finché la Rivelazione non li mostra. */
export const VEILED_DMG_TAKEN = 0.5;

// Bit degli stati dei nemici (inviati nelle istantanee).
export const EF = {
  stun: 1,
  taunt: 2,
  mark: 4,
  veiled: 8,
  enraged: 16,
  pulled: 32,
} as const;

// --- Fratture -------------------------------------------------------------------

export type ModId = 'veloci' | 'senza-cure' | 'pesanti' | 'velati' | 'frenesia';

export const MODS: Record<ModId, { name: string; desc: string }> = {
  veloci: { name: 'Nemici veloci', desc: 'I nemici si muovono il 25% più in fretta.' },
  'senza-cure': { name: 'Niente cure', desc: 'Le cure non funzionano (rialzarsi sì).' },
  pesanti: { name: 'Colpi pesanti', desc: 'I nemici fanno il 30% di danni in più.' },
  velati: { name: 'Nebbia di veli', desc: 'Molte Ombre sono velate: serve la Rivelazione.' },
  frenesia: { name: 'Frenesia', desc: 'I nemici attaccano più spesso.' },
};
export const MOD_IDS = Object.keys(MODS) as ModId[];

export interface Scaling {
  hp: number;
  dmg: number;
  speed: number;
  recover: number;
}

/** Quanto sono più forti i nemici per Grado, numero di giocatori e modificatori. */
export function scaling(grado: number, players: number, mods: ModId[]): Scaling {
  const g = Math.max(1, grado);
  return {
    hp: (1 + 0.18 * (g - 1)) * (1 + 0.35 * (Math.max(1, players) - 1)),
    dmg: (1 + 0.1 * (g - 1)) * (mods.includes('pesanti') ? 1.3 : 1),
    speed: mods.includes('veloci') ? 1.25 : 1,
    recover: mods.includes('frenesia') ? 0.65 : 1,
  };
}

/** Modificatori: uno dal Grado 3, due dal Grado 6. */
export function pickMods(grado: number, rand: () => number): ModId[] {
  const n = grado >= 6 ? 2 : grado >= 3 ? 1 : 0;
  const pool = [...MOD_IDS];
  const out: ModId[] = [];
  for (let i = 0; i < n && pool.length; i++) out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  return out;
}

/** Numeri casuali ripetibili (stesso seme = stessa Frattura su tutti i dispositivi). */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
