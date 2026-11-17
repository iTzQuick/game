// Poteri della Frattura: dopo ogni stanza ripulita ognuno sceglie 1 potere su 3.
// Valgono solo per la Frattura in corso; prenderne uno di nuovo lo fa salire di
// livello. Alcuni aumentano i numeri, altri cambiano il modo di combattere.
//
// Qui ci sono solo dati e regole (si testano da soli); gli effetti veri sono in
// abilities.ts e runtime.ts, che chiedono `boonLevel(id)`.

import type { ClassId } from '../game/constants';
import type { PerkKey } from '../progress/defs';
import type { Mods } from '../progress/model';

type StatKey = Exclude<keyof Mods, 'perks'>;

export type BoonId =
  // cambiano il combattimento
  | 'sete'
  | 'catena'
  | 'scintilla'
  | 'passo'
  | 'lune'
  | 'onda'
  | 'gelo'
  // numeri
  | 'furia'
  | 'occhio'
  | 'eco'
  | 'cuore'
  | 'pietra'
  | 'vento'
  // subito
  | 'sorso'
  // delle classi
  | 'g-scudo'
  | 'g-barriera'
  | 'g-bastione'
  | 'l-vortice'
  | 'l-scatto'
  | 'l-velo'
  | 't-dardo'
  | 't-collasso'
  | 't-trappola'
  | 'c-raggio'
  | 'c-benedizione'
  | 'c-alba';

export type BoonKind = 'gioco' | 'numeri' | 'classe' | 'subito';

export interface BoonDef {
  id: BoonId;
  name: string;
  /** icona dipinta in public/ui/icone (senza estensione)… */
  icon?: string;
  /** …oppure un simbolo, per i poteri che non hanno ancora un'icona */
  glyph?: string;
  kind: BoonKind;
  max: number;
  cls?: ClassId;
  /** cosa fa al livello `l` (1 = appena preso) */
  desc: (l: number) => string;
  /** bonus per livello, sommati a talenti e oggetti */
  stat?: Partial<Record<StatKey, number>>;
  perk?: [PerkKey, number];
}

/** Numeri dei poteri che cambiano il combattimento. */
export const BOON = {
  sete: { heal: 0.03 },
  catena: { base: 20, perLevel: 14, radius: 3.2 },
  scintilla: { every: 4, base: 26, perLevel: 16, range: 11 },
  passo: { cdr: 0.2, base: 18, perLevel: 10, radius: 2.6 },
  lune: { dmg: 8, perLevel: 4, orbit: 1.9, hitRadius: 0.9, every: 600, speed: 3.2 },
  onda: { base: 26, perLevel: 14, speed: 18, range: 9 },
  gelo: { base: 350, perLevel: 220 },
  sorso: { heal: 0.4 },
} as const;

const pct = (v: number) => `${Math.round(v * 100)}%`;

export const BOONS: Record<BoonId, BoonDef> = {
  sete: {
    id: 'sete',
    name: 'Sete d’ombra',
    glyph: '❦',
    kind: 'gioco',
    max: 3,
    desc: (l) => `I tuoi colpi ti curano del ${pct(BOON.sete.heal * l)} dei danni che fanno.`,
  },
  catena: {
    id: 'catena',
    name: 'Frattura a catena',
    glyph: '✸',
    kind: 'gioco',
    max: 3,
    desc: (l) => `I nemici che finisci esplodono: ${BOON.catena.base + BOON.catena.perLevel * l} danni a chi è vicino. Le esplosioni possono concatenarsi.`,
  },
  scintilla: {
    id: 'scintilla',
    name: 'Scintilla del Crocevia',
    glyph: 'ϟ',
    kind: 'gioco',
    max: 3,
    desc: (l) =>
      `Ogni ${BOON.scintilla.every} attacchi parte un fulmine sul nemico più vicino (${BOON.scintilla.base + BOON.scintilla.perLevel * l} danni)` +
      (l >= 3 ? ' e salta su un secondo nemico.' : '.'),
  },
  passo: {
    id: 'passo',
    name: 'Passo fantasma',
    glyph: '≋',
    kind: 'gioco',
    max: 3,
    desc: (l) => `La schivata si ricarica il ${pct(BOON.passo.cdr * l)} più in fretta e dove parti lascia un’esplosione d’ombra (${BOON.passo.base + BOON.passo.perLevel * l} danni).`,
  },
  lune: {
    id: 'lune',
    name: 'Lune d’ombra',
    glyph: '☾',
    kind: 'gioco',
    max: 3,
    desc: (l) => `${l + 1} sfere ti girano attorno e colpiscono i nemici che toccano (${BOON.lune.dmg + BOON.lune.perLevel * l} danni).`,
  },
  onda: {
    id: 'onda',
    name: 'Onda del terzo colpo',
    glyph: '≈',
    kind: 'gioco',
    max: 3,
    desc: (l) => `Il terzo colpo della combo lancia un’onda che attraversa i nemici (${BOON.onda.base + BOON.onda.perLevel * l} danni).`,
  },
  gelo: {
    id: 'gelo',
    name: 'Tocco gelido',
    glyph: '❄',
    kind: 'gioco',
    max: 3,
    desc: (l) => `I nemici che colpisci restano quasi fermi per ${((BOON.gelo.base + BOON.gelo.perLevel * l) / 1000).toFixed(1).replace('.', ',')} s.`,
  },
  furia: {
    id: 'furia',
    name: 'Furia',
    icon: 'attacco',
    kind: 'numeri',
    max: 3,
    stat: { dmgPct: 0.12 },
    desc: (l) => `+${pct(0.12 * l)} danni.`,
  },
  occhio: {
    id: 'occhio',
    name: 'Occhio della Frattura',
    glyph: '◉',
    kind: 'numeri',
    max: 3,
    stat: { critChance: 0.08, critDmg: 0.25 },
    desc: (l) => `+${pct(0.08 * l)} probabilità di critico, critici +${pct(0.25 * l)} più forti.`,
  },
  eco: {
    id: 'eco',
    name: 'Eco veloce',
    glyph: '⟳',
    kind: 'numeri',
    max: 3,
    stat: { cdr: 0.12 },
    desc: (l) => `Abilità pronte il ${pct(0.12 * l)} prima.`,
  },
  cuore: {
    id: 'cuore',
    name: 'Cuore pieno',
    glyph: '♥',
    kind: 'numeri',
    max: 2,
    stat: { ultraPct: 0.3 },
    desc: (l) => `La Ultra si carica il ${pct(0.3 * l)} più in fretta.`,
  },
  pietra: {
    id: 'pietra',
    name: 'Pelle di pietra',
    icon: 'slot-armatura',
    kind: 'numeri',
    max: 3,
    stat: { dmgReduction: 0.08, hpPct: 0.1 },
    desc: (l) => `-${pct(0.08 * l)} danni subiti e +${pct(0.1 * l)} vita.`,
  },
  vento: {
    id: 'vento',
    name: 'Vento di cenere',
    icon: 'schivata',
    kind: 'numeri',
    max: 2,
    stat: { speedPct: 0.1 },
    desc: (l) => `Ti muovi il ${pct(0.1 * l)} più veloce.`,
  },
  sorso: {
    id: 'sorso',
    name: 'Sorso di luce',
    icon: 'pozione',
    kind: 'subito',
    max: 99,
    desc: () => `Recuperi subito il ${pct(BOON.sorso.heal)} della vita e prendi una pozione in più.`,
  },
  'g-scudo': {
    id: 'g-scudo',
    name: 'Scudo tonante',
    icon: 'guardiano-Q',
    kind: 'classe',
    cls: 'guardiano',
    max: 2,
    perk: ['scudoStordimento', 700],
    desc: (l) => `Colpo di scudo: stordisce ${((700 * l) / 1000).toFixed(1).replace('.', ',')} s in più.`,
  },
  'g-barriera': {
    id: 'g-barriera',
    name: 'Muro vivente',
    icon: 'guardiano-R',
    kind: 'classe',
    cls: 'guardiano',
    max: 2,
    perk: ['barrieraRaggio', 0.35],
    desc: (l) => `Barriera: raggio +${pct(0.35 * l)}.`,
  },
  'g-bastione': {
    id: 'g-bastione',
    name: 'Ira del Bastione',
    icon: 'guardiano-F',
    kind: 'classe',
    cls: 'guardiano',
    max: 2,
    perk: ['bastioneEsplosione', 0.6],
    desc: (l) => `Esplosione del Bastione +${pct(0.6 * l)}.`,
  },
  'l-vortice': {
    id: 'l-vortice',
    name: 'Vortice senza fine',
    icon: 'lama-E',
    kind: 'classe',
    cls: 'lama',
    max: 2,
    perk: ['vorticeColpi', 2],
    desc: (l) => `Lame vorticanti: ${2 * l} colpi in più.`,
  },
  'l-scatto': {
    id: 'l-scatto',
    name: 'Ombra lunga',
    icon: 'lama-Q',
    kind: 'classe',
    cls: 'lama',
    max: 2,
    perk: ['scattoDistanza', 2.5],
    desc: (l) => `Scatto d’ombra: +${(2.5 * l).toString().replace('.', ',')} m.`,
  },
  'l-velo': {
    id: 'l-velo',
    name: 'Velo letale',
    icon: 'lama-R',
    kind: 'classe',
    cls: 'lama',
    max: 2,
    perk: ['veloDanno', 0.7],
    desc: (l) => `Il primo colpo dal Velo fa il ${pct(0.7 * l)} di danni in più.`,
  },
  't-dardo': {
    id: 't-dardo',
    name: 'Dardo impazzito',
    icon: 'tessitore-R',
    kind: 'classe',
    cls: 'tessitore',
    max: 2,
    perk: ['dardoRimbalzi', 2],
    desc: (l) => `Dardo arcano: ${2 * l} rimbalzi in più.`,
  },
  't-collasso': {
    id: 't-collasso',
    name: 'Collasso profondo',
    icon: 'tessitore-F',
    kind: 'classe',
    cls: 'tessitore',
    max: 2,
    perk: ['collassoDanno', 0.5],
    desc: (l) => `Collasso: +${pct(0.5 * l)} danni.`,
  },
  't-trappola': {
    id: 't-trappola',
    name: 'Rete larga',
    icon: 'tessitore-E',
    kind: 'classe',
    cls: 'tessitore',
    max: 2,
    perk: ['trappolaRaggio', 0.35],
    desc: (l) => `Trappola del vuoto: raggio +${pct(0.35 * l)}.`,
  },
  'c-raggio': {
    id: 'c-raggio',
    name: 'Raggio caldo',
    icon: 'custode-Q',
    kind: 'classe',
    cls: 'custode',
    max: 2,
    perk: ['raggioCura', 0.35],
    desc: (l) => `Raggio curativo: +${pct(0.35 * l)}.`,
  },
  'c-benedizione': {
    id: 'c-benedizione',
    name: 'Benedizione salda',
    icon: 'custode-R',
    kind: 'classe',
    cls: 'custode',
    max: 2,
    perk: ['benedizioneScudo', 0.5],
    desc: (l) => `Benedizione: scudo +${pct(0.5 * l)}.`,
  },
  'c-alba': {
    id: 'c-alba',
    name: 'Alba piena',
    icon: 'custode-F',
    kind: 'classe',
    cls: 'custode',
    max: 2,
    perk: ['albaCura', 0.4],
    desc: (l) => `Alba: cura il ${pct(0.4 * l)} in più.`,
  },
};

export const BOON_IDS = Object.keys(BOONS) as BoonId[];

export type BoonSet = Partial<Record<BoonId, number>>;

const WEIGHT: Record<BoonKind, number> = { gioco: 1.15, classe: 1, numeri: 0.85, subito: 0.5 };

/**
 * Tre poteri da scegliere: mai due uguali, mai uno già al massimo; se ce n'è uno
 * della propria classe, almeno uno dei tre lo è. Con poca vita il Sorso esce più spesso.
 */
export function offerBoons(rand: () => number, cls: ClassId | null, have: BoonSet, hpFrac = 1, n = 3): BoonId[] {
  const pool = BOON_IDS.filter((id) => {
    const b = BOONS[id];
    if (b.cls && b.cls !== cls) return false;
    return (have[id] ?? 0) < b.max;
  });
  const weight = (id: BoonId) => {
    const b = BOONS[id];
    let w = WEIGHT[b.kind];
    if (id === 'sorso') w += Math.max(0, 1 - hpFrac) * 2;
    // quelli già presi tornano un po' più spesso: così si costruisce qualcosa
    if (have[id]) w *= 1.3;
    return w;
  };
  const out: BoonId[] = [];
  const pickFrom = (list: BoonId[]) => {
    const total = list.reduce((s, id) => s + weight(id), 0);
    let r = rand() * total;
    for (const id of list) {
      r -= weight(id);
      if (r <= 0) return id;
    }
    return list[list.length - 1];
  };
  const classPool = pool.filter((id) => BOONS[id].cls);
  if (classPool.length) out.push(pickFrom(classPool));
  while (out.length < n) {
    const rest = pool.filter((id) => !out.includes(id));
    if (!rest.length) break;
    out.push(pickFrom(rest));
  }
  // la carta della classe non sempre in prima posizione
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Limiti: oltre questi i numeri romperebbero il gioco. */
const CAPS: Partial<Record<StatKey, number>> = { cdr: 0.6, dmgReduction: 0.6, critChance: 0.75, speedPct: 0.6 };

/** Bonus di talenti e oggetti più i poteri della Frattura. */
export function withBoons(base: Mods, have: BoonSet): Mods {
  const ids = Object.keys(have) as BoonId[];
  if (!ids.length) return base;
  const m: Mods = { ...base, perks: { ...base.perks } };
  for (const id of ids) {
    const l = have[id] ?? 0;
    const b = BOONS[id];
    if (!l || !b) continue;
    if (b.stat) for (const [k, v] of Object.entries(b.stat)) m[k as StatKey] += (v ?? 0) * l;
    if (b.perk) m.perks[b.perk[0]] = (m.perks[b.perk[0]] ?? 0) + b.perk[1] * l;
  }
  for (const [k, cap] of Object.entries(CAPS)) m[k as StatKey] = Math.min(cap!, m[k as StatKey]);
  return m;
}

// --- poteri della Frattura in corso (di questo giocatore) ------------------------------

/** Dove sono ora le Lune d'ombra (le aggiorna abilities.ts, le disegna effects.tsx). */
export const orbState = { n: 0, pos: Array.from({ length: 4 }, () => ({ x: 0, y: 0, z: 0 })) };

let runId = -1;
let have: BoonSet = {};
let version = 0;
let cache: { base: Mods; v: number; out: Mods } | null = null;

/** Nuova Frattura: si riparte senza poteri. */
export function boonsForRun(id: number) {
  if (id === runId) return;
  runId = id;
  have = {};
  version++;
}

export function boonLevel(id: BoonId): number {
  return have[id] ?? 0;
}

export function myBoons(): BoonSet {
  return have;
}

export function addBoon(id: BoonId) {
  if (BOONS[id].kind === 'subito') return;
  have = { ...have, [id]: Math.min(BOONS[id].max, (have[id] ?? 0) + 1) };
  version++;
}

/** I bonus del giocatore con i poteri (ricalcolati solo quando cambia qualcosa). */
export function modsWithBoons(base: Mods): Mods {
  if (!cache || cache.base !== base || cache.v !== version) cache = { base, v: version, out: withBoons(base, have) };
  return cache.out;
}
