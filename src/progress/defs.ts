// Progressione: livelli per classe, alberi dei talenti, oggetti, frammenti,
// edifici della base e indizi della biblioteca. Numeri di prima taratura.

import type { ClassId } from '../game/constants';

// --- Statistiche che talenti e oggetti possono alzare -------------------------

export type StatKey =
  | 'hpPct'
  | 'hpFlat'
  | 'dmgPct'
  | 'basicPct'
  | 'abilityPct'
  | 'critChance'
  | 'critDmg'
  | 'cdr'
  | 'speedPct'
  | 'dmgReduction'
  | 'healPct'
  | 'ultraPct';

export const STAT_LABELS: Record<StatKey, { name: string; pct: boolean }> = {
  hpPct: { name: 'vita', pct: true },
  hpFlat: { name: 'vita', pct: false },
  dmgPct: { name: 'danni', pct: true },
  basicPct: { name: 'danni dell’attacco base', pct: true },
  abilityPct: { name: 'danni delle abilità', pct: true },
  critChance: { name: 'probabilità di critico', pct: true },
  critDmg: { name: 'danni critici', pct: true },
  cdr: { name: 'ricariche più brevi', pct: true },
  speedPct: { name: 'velocità', pct: true },
  dmgReduction: { name: 'danni subiti in meno', pct: true },
  healPct: { name: 'cure', pct: true },
  ultraPct: { name: 'carica della Ultra', pct: true },
};

/** Limiti, perché nessuna statistica rompa il gioco. */
export const STAT_CAPS: Partial<Record<StatKey, number>> = { cdr: 0.35, dmgReduction: 0.5, critChance: 0.6, speedPct: 0.35 };

/** Effetti speciali dei talenti sulle abilità. */
export type PerkKey =
  | 'barrieraRaggio'
  | 'bastioneDurata'
  | 'scudoStordimento'
  | 'provocazioneRaggio'
  | 'bastioneEsplosione'
  | 'scattoDistanza'
  | 'vorticeColpi'
  | 'veloDurata'
  | 'veloDanno'
  | 'milleTagliBersagli'
  | 'varcoDurata'
  | 'trappolaRaggio'
  | 'trappolaDurata'
  | 'collassoDanno'
  | 'dardoRimbalzi'
  | 'raggioCura'
  | 'rivelazioneDurata'
  | 'benedizioneScudo'
  | 'albaCura';

// --- Livelli ------------------------------------------------------------------------

export const MAX_LEVEL = 30;

/** Punti esperienza per passare dal livello `l` al successivo. */
export function xpToNext(l: number): number {
  return Math.round(200 + 120 * Math.pow(Math.max(0, l - 1), 1.3));
}

const gradoXp = (grado: number) => 1 + 0.15 * (Math.max(1, grado) - 1);

export const XP = {
  /** per nemico sconfitto: costo del nemico × 12 (il boss vale 400) */
  kill: (cost: number, grado: number, boss: boolean) => Math.round((boss ? 400 : cost * 12) * gradoXp(grado)),
  room: (grado: number) => Math.round(60 * gradoXp(grado)),
  fractura: (grado: number) => Math.round(300 * gradoXp(grado)),
};

// --- Alberi dei talenti ----------------------------------------------------------------

export interface TalentNode {
  id: string;
  name: string;
  desc: string;
  max: number;
  /** valori per ogni punto speso */
  stat?: Partial<Record<StatKey, number>>;
  perk?: [PerkKey, number];
}

export interface Branch {
  id: string;
  name: string;
  nodes: TalentNode[];
}

const n = (id: string, name: string, desc: string, max: number, fx: Partial<Record<StatKey, number>> | [PerkKey, number]): TalentNode =>
  Array.isArray(fx) ? { id, name, desc, max, perk: fx } : { id, name, desc, max, stat: fx };

export const TREES: Record<ClassId, Branch[]> = {
  guardiano: [
    {
      id: 'baluardo',
      name: 'Baluardo',
      nodes: [
        n('g1', 'Pelle di pietra', '+6% vita', 3, { hpPct: 0.06 }),
        n('g2', 'Guardia ferma', '4% danni subiti in meno', 3, { dmgReduction: 0.04 }),
        n('g3', 'Barriera ampia', 'Barriera: raggio +30%', 1, ['barrieraRaggio', 0.3]),
        n('g4', 'Ultimo baluardo', '+10% vita', 2, { hpPct: 0.1 }),
        n('g5', 'Bastione eterno', 'Bastione: dura 2 s in più', 1, ['bastioneDurata', 2]),
      ],
    },
    {
      id: 'scudo',
      name: 'Scudo',
      nodes: [
        n('g6', 'Colpo pesante', '+8% danni delle abilità', 3, { abilityPct: 0.08 }),
        n('g7', 'Stordimento lungo', 'Colpo di scudo: stordisce 0,5 s in più', 2, ['scudoStordimento', 500]),
        n('g8', 'Voce del comando', 'Provocazione: raggio +4 m', 1, ['provocazioneRaggio', 4]),
        n('g9', 'Disciplina', 'Ricariche più brevi del 5%', 3, { cdr: 0.05 }),
        n('g10', 'Rappresaglia', 'Esplosione del Bastione +60%', 1, ['bastioneEsplosione', 0.6]),
      ],
    },
    {
      id: 'vendetta',
      name: 'Vendetta',
      nodes: [
        n('g11', 'Braccio forte', '+5% danni', 3, { dmgPct: 0.05 }),
        n('g12', 'Occhio attento', '+3% probabilità di critico', 3, { critChance: 0.03 }),
        n('g13', 'Furia', '+10% danni dell’attacco base', 2, { basicPct: 0.1 }),
        n('g14', 'Passo deciso', '+5% velocità', 2, { speedPct: 0.05 }),
        n('g15', 'Cuore ardente', '+15% carica della Ultra', 2, { ultraPct: 0.15 }),
      ],
    },
  ],
  lama: [
    {
      id: 'ombra',
      name: 'Ombra',
      nodes: [
        n('l1', 'Passo felpato', '+4% velocità', 3, { speedPct: 0.04 }),
        n('l2', 'Scatto lungo', 'Scatto d’ombra: +2 m', 2, ['scattoDistanza', 2]),
        n('l3', 'Velo profondo', 'Velo: dura 2 s in più', 1, ['veloDurata', 2]),
        n('l4', 'Sparire', 'Ricariche più brevi del 5%', 3, { cdr: 0.05 }),
        n('l5', 'Colpo dal buio', 'Il primo colpo dal Velo fa triplo danno', 1, ['veloDanno', 1]),
      ],
    },
    {
      id: 'lame',
      name: 'Lame',
      nodes: [
        n('l6', 'Filo affilato', '+5% danni', 3, { dmgPct: 0.05 }),
        n('l7', 'Vortice', 'Lame vorticanti: 2 colpi in più', 1, ['vorticeColpi', 2]),
        n('l8', 'Precisione', '+4% probabilità di critico', 3, { critChance: 0.04 }),
        n('l9', 'Taglio profondo', '+20% danni critici', 2, { critDmg: 0.2 }),
        n('l10', 'Mille e uno', 'Mille tagli: 4 nemici in più', 1, ['milleTagliBersagli', 4]),
      ],
    },
    {
      id: 'sopravvivenza',
      name: 'Sopravvivenza',
      nodes: [
        n('l11', 'Tempra', '+6% vita', 3, { hpPct: 0.06 }),
        n('l12', 'Schivare', '4% danni subiti in meno', 3, { dmgReduction: 0.04 }),
        n('l13', 'Sangue freddo', '+15% carica della Ultra', 2, { ultraPct: 0.15 }),
        n('l14', 'Rapidità', '+10% danni dell’attacco base', 2, { basicPct: 0.1 }),
        n('l15', 'Istinto', '+8% danni delle abilità', 2, { abilityPct: 0.08 }),
      ],
    },
  ],
  tessitore: [
    {
      id: 'varchi',
      name: 'Varchi',
      nodes: [
        n('t1', 'Trama larga', 'Varco: dura 4 s in più', 1, ['varcoDurata', 4]),
        n('t2', 'Tessitura rapida', 'Ricariche più brevi del 5%', 3, { cdr: 0.05 }),
        n('t3', 'Fili sottili', '+4% velocità', 3, { speedPct: 0.04 }),
        n('t4', 'Passaggio sicuro', '+8% vita', 2, { hpPct: 0.08 }),
        n('t5', 'Ordito', '+15% carica della Ultra', 2, { ultraPct: 0.15 }),
      ],
    },
    {
      id: 'vuoto',
      name: 'Vuoto',
      nodes: [
        n('t6', 'Risucchio', 'Trappola del vuoto: raggio +30%', 1, ['trappolaRaggio', 0.3]),
        n('t7', 'Peso del vuoto', '+8% danni delle abilità', 3, { abilityPct: 0.08 }),
        n('t8', 'Abisso', 'Collasso: +40% danni', 1, ['collassoDanno', 0.4]),
        n('t9', 'Gravità', '4% danni subiti in meno', 2, { dmgReduction: 0.04 }),
        n('t10', 'Orizzonte', 'Trappola del vuoto: dura 1,5 s in più', 1, ['trappolaDurata', 1.5]),
      ],
    },
    {
      id: 'arcano',
      name: 'Arcano',
      nodes: [
        n('t11', 'Dardo affilato', '+6% danni dell’attacco base', 3, { basicPct: 0.06 }),
        n('t12', 'Rimbalzo', 'Dardo arcano: 1 rimbalzo in più', 2, ['dardoRimbalzi', 1]),
        n('t13', 'Focus', '+4% probabilità di critico', 3, { critChance: 0.04 }),
        n('t14', 'Potere', '+5% danni', 3, { dmgPct: 0.05 }),
        n('t15', 'Risonanza', '+20% danni critici', 2, { critDmg: 0.2 }),
      ],
    },
  ],
  custode: [
    {
      id: 'luce',
      name: 'Luce',
      nodes: [
        n('c1', 'Mani calde', '+8% cure', 3, { healPct: 0.08 }),
        n('c2', 'Raggio intenso', 'Raggio curativo: +25%', 2, ['raggioCura', 0.25]),
        n('c3', 'Benedizione piena', 'Benedizione: scudo +50%', 1, ['benedizioneScudo', 0.5]),
        n('c4', 'Grazia', 'Ricariche più brevi del 5%', 3, { cdr: 0.05 }),
        n('c5', 'Aurora', '+15% carica della Ultra', 2, { ultraPct: 0.15 }),
      ],
    },
    {
      id: 'rivelazione',
      name: 'Rivelazione',
      nodes: [
        n('c6', 'Occhio limpido', 'Rivelazione: dura 4 s in più', 1, ['rivelazioneDurata', 4]),
        n('c7', 'Verità', '+5% danni', 3, { dmgPct: 0.05 }),
        n('c8', 'Luce che brucia', '+8% danni delle abilità', 3, { abilityPct: 0.08 }),
        n('c9', 'Sguardo', '+3% probabilità di critico', 3, { critChance: 0.03 }),
        n('c10', 'Alba piena', 'Alba: cura il 30% in più', 1, ['albaCura', 0.3]),
      ],
    },
    {
      id: 'fede',
      name: 'Fede',
      nodes: [
        n('c11', 'Fermezza', '+6% vita', 3, { hpPct: 0.06 }),
        n('c12', 'Riparo', '4% danni subiti in meno', 3, { dmgReduction: 0.04 }),
        n('c13', 'Passo leggero', '+5% velocità', 2, { speedPct: 0.05 }),
        n('c14', 'Fiamma', '+10% danni dell’attacco base', 2, { basicPct: 0.1 }),
        n('c15', 'Devozione', '+15% cure', 1, { healPct: 0.15 }),
      ],
    },
  ],
};

export function findNode(cls: ClassId, id: string): { branch: Branch; node: TalentNode; index: number } | null {
  for (const branch of TREES[cls]) {
    const index = branch.nodes.findIndex((x) => x.id === id);
    if (index >= 0) return { branch, node: branch.nodes[index], index };
  }
  return null;
}

// --- Oggetti ---------------------------------------------------------------------------

export type Slot = 'arma' | 'armatura' | 'amuleto';
export const SLOTS: Slot[] = ['arma', 'armatura', 'amuleto'];
export const SLOT_NAMES: Record<Slot, string> = { arma: 'Arma', armatura: 'Armatura', amuleto: 'Amuleto' };

export interface Rarity {
  id: 'comune' | 'raro' | 'epico' | 'leggendario' | 'frattura';
  name: string;
  color: string;
  affixes: number;
  mult: number;
}

export const RARITIES: Rarity[] = [
  { id: 'comune', name: 'Comune', color: '#c9c4d6', affixes: 0, mult: 1 },
  { id: 'raro', name: 'Raro', color: '#4f9dff', affixes: 1, mult: 1.1 },
  { id: 'epico', name: 'Epico', color: '#b65cff', affixes: 2, mult: 1.2 },
  { id: 'leggendario', name: 'Leggendario', color: '#ffb02e', affixes: 3, mult: 1.35 },
  { id: 'frattura', name: 'Frattura', color: '#ff4f9a', affixes: 4, mult: 1.5 },
];

export interface Affix {
  k: StatKey;
  v: number;
}

export interface Item {
  id: string;
  slot: Slot;
  /** 0 comune … 4 frattura */
  rarity: number;
  /** livello dell'oggetto (sale con il Grado) */
  ilvl: number;
  name: string;
  /** statistica di base dello slot + affissi casuali */
  base: Affix[];
  affixes: Affix[];
  /** potenziamenti fatti alla Forgia (0–10) */
  up: number;
}

export const MAX_UPGRADE = 10;
export const INVENTORY_SIZE = 40;

const AFFIX_BASE: Partial<Record<StatKey, number>> = {
  dmgPct: 0.04,
  hpPct: 0.05,
  critChance: 0.025,
  critDmg: 0.08,
  cdr: 0.03,
  speedPct: 0.03,
  dmgReduction: 0.025,
  healPct: 0.06,
  ultraPct: 0.06,
  basicPct: 0.06,
  abilityPct: 0.06,
};
const AFFIX_KEYS = Object.keys(AFFIX_BASE) as StatKey[];

const NAMES: Record<Slot, string[]> = {
  arma: ['Lama', 'Bastone', 'Martello', 'Falce', 'Scettro', 'Pugnale'],
  armatura: ['Corazza', 'Mantello', 'Veste', 'Cotta', 'Manto', 'Giubba'],
  amuleto: ['Amuleto', 'Sigillo', 'Talismano', 'Ciondolo', 'Anello', 'Medaglione'],
};
const SUFFIX = ['del Crocevia', 'dell’Eco', 'della Marea', 'dei Sussurri', 'dei Neon', 'degli Specchi', 'del Custode', 'senza Nome'];

const round3 = (x: number) => Math.round(x * 1000) / 1000;

function slotBase(slot: Slot, ilvl: number): Affix[] {
  if (slot === 'arma') return [{ k: 'dmgPct', v: round3(0.04 + 0.012 * ilvl) }];
  if (slot === 'armatura') return [{ k: 'hpFlat', v: Math.round(12 + 5 * ilvl) }, { k: 'dmgReduction', v: 0.02 }];
  return [{ k: 'ultraPct', v: round3(0.05 + 0.01 * ilvl) }, { k: 'critChance', v: round3(0.01 + 0.003 * ilvl) }];
}

/** Probabilità delle rarità: migliorano con il Grado. */
export function rarityWeights(grado: number): number[] {
  const g = Math.max(1, grado) - 1;
  return [60 * Math.max(0.3, 1 - 0.05 * g), 28, 9 * (1 + 0.1 * g), 2.5 * (1 + 0.2 * g), 0.5 * (1 + 0.25 * g)];
}

export function rollRarity(rand: () => number, grado: number, min = 0): number {
  const w = rarityWeights(grado).map((x, i) => (i < min ? 0 : x));
  const total = w.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (let i = 0; i < w.length; i++) {
    r -= w[i];
    if (r <= 0) return i;
  }
  return w.length - 1;
}

export function generateItem(rand: () => number, grado: number, minRarity = 0, slot?: Slot): Item {
  const s: Slot = slot ?? SLOTS[Math.floor(rand() * SLOTS.length)];
  const rarity = rollRarity(rand, grado, minRarity);
  const ilvl = Math.max(1, Math.round(grado + (rand() - 0.3) * 2));
  const r = RARITIES[rarity];
  const pool = [...AFFIX_KEYS];
  const affixes: Affix[] = [];
  for (let i = 0; i < r.affixes && pool.length; i++) {
    const k = pool.splice(Math.floor(rand() * pool.length), 1)[0];
    const v = (AFFIX_BASE[k] ?? 0.03) * (1 + 0.12 * (ilvl - 1)) * r.mult * (0.7 + rand() * 0.3);
    affixes.push({ k, v: round3(v) });
  }
  const id = Array.from({ length: 10 }, () => Math.floor(rand() * 36).toString(36)).join('');
  const names = NAMES[s];
  const name = `${names[Math.floor(rand() * names.length)]} ${rarity === 4 ? 'della Frattura' : SUFFIX[Math.floor(rand() * SUFFIX.length)]}`;
  return { id, slot: s, rarity, ilvl, name, base: slotBase(s, ilvl), affixes, up: 0 };
}

/** Valori di un oggetto con i potenziamenti della Forgia (le stesse statistiche sono sommate). */
export function itemStats(item: Item): Affix[] {
  const mul = 1 + 0.08 * item.up;
  const sum = new Map<StatKey, number>();
  for (const a of [...item.base, ...item.affixes]) sum.set(a.k, (sum.get(a.k) ?? 0) + a.v);
  return [...sum].map(([k, v]) => ({ k, v: k === 'hpFlat' ? Math.round(v * mul) : round3(v * mul) }));
}

export function salvageValue(item: Item): number {
  return Math.round(4 * Math.pow(item.rarity + 1, 1.5) * (1 + item.ilvl * 0.1) + item.up * 3);
}

export function upgradeCost(item: Item): number {
  return Math.round(8 * (item.rarity + 1) * (item.up + 1) * (1 + item.ilvl * 0.05));
}

export const FRAGMENTS = {
  room: (grado: number) => 8 + 2 * grado,
  boss: (grado: number) => 30 + 5 * grado,
};

/**
 * Ricompensa di una missione del giorno compiuta, per difficoltà (0-4, vedi
 * narrator/core.ts): frammenti e, dalla difficoltà 1, un oggetto almeno raro.
 */
export function missionReward(difficulty: number, grado: number): { frags: number; minRarity: number | null } {
  const d = Math.max(0, Math.min(4, Math.round(difficulty)));
  return { frags: Math.round(FRAGMENTS.room(grado) * (1 + d)), minRarity: d >= 3 ? 2 : d >= 1 ? 1 : null };
}

export function formatAffix(a: Affix): string {
  const l = STAT_LABELS[a.k];
  if (!l.pct) return `+${a.v} ${l.name}`;
  const v = Math.round(a.v * 1000) / 10;
  return a.k === 'cdr' || a.k === 'dmgReduction' ? `${v}% ${l.name}` : `+${v}% ${l.name}`;
}

// --- La base nel Crocevia -----------------------------------------------------------

export type BuildingId = 'forgia' | 'giardino' | 'biblioteca' | 'trofei' | 'osservatorio';

export interface BuildingDef {
  id: BuildingId;
  name: string;
  cost: number;
  desc: string;
  /** angolo sull'isola */
  angle: number;
  color: string;
  /** non ancora costruibile (arriva in una tappa successiva) */
  later?: string;
}

const deg = (d: number) => (d * Math.PI) / 180;

export const BUILDINGS: BuildingDef[] = [
  { id: 'forgia', name: 'Forgia', cost: 120, desc: 'Migliora gli oggetti con i frammenti.', angle: deg(135), color: '#ff7a3d' },
  { id: 'giardino', name: 'Giardino', cost: 160, desc: 'Una pozione a testa per ogni Frattura: cura metà della vita (tasto H).', angle: deg(225), color: '#6dffb0' },
  { id: 'biblioteca', name: 'Biblioteca', cost: 100, desc: 'Custodisce gli indizi del mistero trovati nelle Fratture.', angle: deg(315), color: '#9fc4ff' },
  { id: 'trofei', name: 'Sala dei trofei', cost: 80, desc: 'I record e le imprese del gruppo.', angle: deg(112.5), color: '#ffd25a' },
  {
    id: 'osservatorio',
    name: 'Osservatorio',
    cost: 0,
    desc: 'Da qui si vedranno gli eventi della settimana.',
    angle: deg(247.5),
    color: '#d9c8ff',
    later: 'arriva con gli eventi della settimana (tappa 7)',
  },
];

export const BUILDING_RADIUS = 18.6;

// --- Indizi della biblioteca ------------------------------------------------------------

export interface LoreEntry {
  id: string;
  title: string;
  text: string;
  /** quando si sblocca */
  need: { best?: number; bosses?: number; fratture?: number };
}

export const LORE: LoreEntry[] = [
  {
    id: 'segni',
    title: 'I segni sui polsi',
    text: 'Tutti voi portate lo stesso segno. Non è una bruciatura, non è un tatuaggio: si accende quando un portale vi è vicino, come se riconoscesse una porta.',
    need: {},
  },
  {
    id: 'eco-voce',
    title: 'Una voce conosciuta',
    text: 'Nella prima Frattura l’Eco ha parlato con la voce di uno di voi. Diceva una frase che nessuno ricorda di aver detto. Ancora.',
    need: { bosses: 1 },
  },
  {
    id: 'crepe',
    title: 'Le crepe',
    text: 'Le Fratture non sono ferite casuali del mondo. Si aprono sempre dove qualcuno di voi ha appena combattuto, come se il Crocevia vi seguisse.',
    need: { best: 2 },
  },
  {
    id: 'stanze',
    title: 'Stanze che cambiano',
    text: 'Le stanze non sono mai le stesse, ma i muri hanno sempre la stessa pietra del Crocevia. Qualcuno ha costruito tutto questo con un solo materiale.',
    need: { fratture: 3 },
  },
  {
    id: 'scelti',
    title: 'Non rapiti',
    text: 'Una scritta incisa sotto una colonna: «Non vi abbiamo presi. Siete venuti quando vi abbiamo chiamato». Le lettere sono le vostre.',
    need: { best: 4 },
  },
  {
    id: 'eco-ricordi',
    title: 'Ciò che l’Eco prende',
    text: 'Dopo ogni Frattura qualcuno di voi dimentica una piccola cosa. L’Eco la ripete al combattimento successivo, come un trofeo.',
    need: { bosses: 5 },
  },
  {
    id: 'chiave',
    title: 'La serratura',
    text: 'Il Custode Muto guarda i vostri polsi più dei vostri volti. Forse il segno non è un marchio. Forse apre qualcosa.',
    need: { best: 7 },
  },
];

// --- Pozioni del giardino -----------------------------------------------------------

export const POTION_HEAL = 0.5;
