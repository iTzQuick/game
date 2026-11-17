// Salvataggi e regole della progressione. Tutto puro: si testa senza browser.

import type { ClassId } from '../game/constants';
import {
  BUILDINGS,
  INVENTORY_SIZE,
  LORE,
  MAX_LEVEL,
  MAX_UPGRADE,
  STAT_CAPS,
  TREES,
  findNode,
  itemStats,
  salvageValue,
  upgradeCost,
  xpToNext,
  type BuildingId,
  type Item,
  type LoreEntry,
  type PerkKey,
  type Slot,
  type StatKey,
} from './defs';
import { validaIndizio, type Indizio } from '../narrator/core';

// --- Salvataggio del giocatore -----------------------------------------------------

export interface ClassProgress {
  level: number;
  /** esperienza verso il prossimo livello */
  xp: number;
  talents: Record<string, number>;
}

export interface PlayerSave {
  v: 1;
  classes: Partial<Record<ClassId, ClassProgress>>;
  inventory: Item[];
  equipped: Partial<Record<Slot, string>>;
  fragments: number;
  /** codice della compagnia (gruppo) a cui appartiene */
  group: string | null;
  stats: { kills: number; fratture: number; bosses: number };
}

export const emptySave = (): PlayerSave => ({
  v: 1,
  classes: {},
  inventory: [],
  equipped: {},
  fragments: 0,
  group: null,
  stats: { kills: 0, fratture: 0, bosses: 0 },
});

/** Ripara un salvataggio letto da fuori (campi mancanti, versioni vecchie). */
export function normalizeSave(raw: unknown): PlayerSave {
  const base = emptySave();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<PlayerSave>;
  return {
    ...base,
    ...r,
    v: 1,
    classes: { ...(r.classes ?? {}) },
    inventory: Array.isArray(r.inventory) ? r.inventory.slice(0, INVENTORY_SIZE) : [],
    equipped: { ...(r.equipped ?? {}) },
    fragments: Math.max(0, Math.floor(r.fragments ?? 0)),
    group: r.group ?? null,
    stats: { ...base.stats, ...(r.stats ?? {}) },
  };
}

export function classProgress(save: PlayerSave, cls: ClassId): ClassProgress {
  return save.classes[cls] ?? { level: 1, xp: 0, talents: {} };
}

/** Aggiunge esperienza alla classe. Restituisce i livelli guadagnati. */
export function addXp(save: PlayerSave, cls: ClassId, amount: number): number {
  const p = { ...classProgress(save, cls) };
  let gained = 0;
  p.xp += Math.max(0, Math.round(amount));
  while (p.level < MAX_LEVEL && p.xp >= xpToNext(p.level)) {
    p.xp -= xpToNext(p.level);
    p.level++;
    gained++;
  }
  if (p.level >= MAX_LEVEL) p.xp = 0;
  save.classes = { ...save.classes, [cls]: p };
  return gained;
}

export function pointsSpent(p: ClassProgress): number {
  return Object.values(p.talents).reduce((a, b) => a + b, 0);
}

export function pointsAvailable(p: ClassProgress): number {
  return p.level - 1 - pointsSpent(p);
}

/** Si può spendere un punto su questo talento? (serve il talento precedente del ramo) */
export function canLearn(save: PlayerSave, cls: ClassId, nodeId: string): boolean {
  const p = classProgress(save, cls);
  const f = findNode(cls, nodeId);
  if (!f || pointsAvailable(p) <= 0) return false;
  if ((p.talents[nodeId] ?? 0) >= f.node.max) return false;
  if (f.index > 0 && !(p.talents[f.branch.nodes[f.index - 1].id] > 0)) return false;
  return true;
}

export function learn(save: PlayerSave, cls: ClassId, nodeId: string): boolean {
  if (!canLearn(save, cls, nodeId)) return false;
  const p = classProgress(save, cls);
  save.classes = { ...save.classes, [cls]: { ...p, talents: { ...p.talents, [nodeId]: (p.talents[nodeId] ?? 0) + 1 } } };
  return true;
}

/** Restituisce tutti i punti della classe (gratis, per ora: si sperimenta). */
export function resetTalents(save: PlayerSave, cls: ClassId) {
  const p = classProgress(save, cls);
  save.classes = { ...save.classes, [cls]: { ...p, talents: {} } };
}

// --- Modificatori (talenti + equipaggiamento) --------------------------------------------

export type Mods = Record<StatKey, number> & { perks: Partial<Record<PerkKey, number>> };

export const emptyMods = (): Mods => ({
  hpPct: 0,
  hpFlat: 0,
  dmgPct: 0,
  basicPct: 0,
  abilityPct: 0,
  critChance: 0,
  critDmg: 0,
  cdr: 0,
  speedPct: 0,
  dmgReduction: 0,
  healPct: 0,
  ultraPct: 0,
  perks: {},
});

export function computeMods(save: PlayerSave, cls: ClassId | null): Mods {
  const m = emptyMods();
  if (cls) {
    const p = classProgress(save, cls);
    for (const branch of TREES[cls]) {
      for (const node of branch.nodes) {
        const rank = p.talents[node.id] ?? 0;
        if (!rank) continue;
        if (node.stat) for (const [k, v] of Object.entries(node.stat)) m[k as StatKey] += (v ?? 0) * rank;
        if (node.perk) m.perks[node.perk[0]] = (m.perks[node.perk[0]] ?? 0) + node.perk[1] * rank;
      }
    }
  }
  for (const slot of Object.keys(save.equipped) as Slot[]) {
    const item = save.inventory.find((i) => i.id === save.equipped[slot]);
    if (!item) continue;
    for (const a of itemStats(item)) m[a.k] += a.v;
  }
  for (const [k, cap] of Object.entries(STAT_CAPS)) m[k as StatKey] = Math.min(m[k as StatKey], cap ?? Infinity);
  return m;
}

// --- Zaino -----------------------------------------------------------------------------------

/** Aggiunge oggetti allo zaino. Se è pieno, i più scarsi diventano frammenti. */
export function addItems(save: PlayerSave, items: Item[]): { kept: Item[]; salvaged: number } {
  let salvaged = 0;
  const kept: Item[] = [];
  const inv = [...save.inventory];
  for (const it of items) {
    if (inv.some((x) => x.id === it.id)) continue;
    if (inv.length < INVENTORY_SIZE) {
      inv.push(it);
      kept.push(it);
    } else {
      salvaged += salvageValue(it);
    }
  }
  save.inventory = inv;
  save.fragments += salvaged;
  return { kept, salvaged };
}

export function equip(save: PlayerSave, itemId: string): boolean {
  const item = save.inventory.find((i) => i.id === itemId);
  if (!item) return false;
  save.equipped = { ...save.equipped, [item.slot]: item.id };
  return true;
}

export function unequip(save: PlayerSave, slot: Slot) {
  const eq = { ...save.equipped };
  delete eq[slot];
  save.equipped = eq;
}

export function isEquipped(save: PlayerSave, itemId: string): boolean {
  return Object.values(save.equipped).includes(itemId);
}

/** Smonta un oggetto in frammenti (non quelli indossati). */
export function salvage(save: PlayerSave, itemId: string): number {
  const item = save.inventory.find((i) => i.id === itemId);
  if (!item || isEquipped(save, itemId)) return 0;
  const v = salvageValue(item);
  save.inventory = save.inventory.filter((i) => i.id !== itemId);
  save.fragments += v;
  return v;
}

/** Potenzia un oggetto alla Forgia. */
export function upgrade(save: PlayerSave, itemId: string): boolean {
  const item = save.inventory.find((i) => i.id === itemId);
  if (!item || item.up >= MAX_UPGRADE) return false;
  const cost = upgradeCost(item);
  if (save.fragments < cost) return false;
  save.fragments -= cost;
  save.inventory = save.inventory.map((i) => (i.id === itemId ? { ...i, up: i.up + 1 } : i));
  return true;
}

// --- Compagnia (gruppo) e base ---------------------------------------------------------------

export interface BuildingState {
  /** frammenti versati */
  p: number;
  /** costruito */
  u: boolean;
}

export interface GroupData {
  v: 1;
  grado: number;
  best: number;
  base: Partial<Record<BuildingId, BuildingState>>;
  stats: { fratture: number; bosses: number; kills: number };
  /** diario del gruppo: lo legge il narratore (tappa 6) */
  diario: { at: number; text: string }[];
  /** missioni del giorno già compiute */
  missioni: { giorno: string; fatte: string[] };
  /** indizi della Biblioteca scritti dal narratore, uno per record */
  indizi: Indizio[];
}

export const emptyGroup = (): GroupData => ({
  v: 1,
  grado: 1,
  best: 0,
  base: {},
  stats: { fratture: 0, bosses: 0, kills: 0 },
  diario: [],
  missioni: { giorno: '', fatte: [] },
  indizi: [],
});

export function normalizeGroup(raw: unknown): GroupData {
  const base = emptyGroup();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<GroupData>;
  return {
    ...base,
    ...r,
    v: 1,
    grado: Math.max(1, r.grado ?? 1),
    best: Math.max(0, r.best ?? 0),
    base: { ...(r.base ?? {}) },
    stats: { ...base.stats, ...(r.stats ?? {}) },
    diario: Array.isArray(r.diario) ? r.diario.slice(-100) : [],
    missioni:
      r.missioni && typeof r.missioni.giorno === 'string' && Array.isArray(r.missioni.fatte)
        ? { giorno: r.missioni.giorno, fatte: r.missioni.fatte.filter((x): x is string => typeof x === 'string').slice(0, 10) }
        : { giorno: '', fatte: [] },
    indizi: Array.isArray(r.indizi)
      ? r.indizi
          .map((i) => validaIndizio(i))
          .filter((i): i is Indizio => !!i)
          .slice(-40)
      : [],
  };
}

export function isBuilt(g: Pick<GroupData, 'base'>, id: BuildingId): boolean {
  return !!g.base[id]?.u;
}

/** Versa frammenti in un edificio. Restituisce quanti ne sono stati usati. */
export function contribute(g: GroupData, id: BuildingId, amount: number): number {
  const def = BUILDINGS.find((b) => b.id === id);
  if (!def || def.later) return 0;
  const cur = g.base[id] ?? { p: 0, u: false };
  if (cur.u) return 0;
  const used = Math.max(0, Math.min(Math.floor(amount), def.cost - cur.p));
  const p = cur.p + used;
  g.base = { ...g.base, [id]: { p, u: p >= def.cost } };
  return used;
}

export function unlockedLore(stats: GroupData['stats'], best: number): LoreEntry[] {
  return LORE.filter(
    (l) => (l.need.best ?? 0) <= best && (l.need.bosses ?? 0) <= stats.bosses && (l.need.fratture ?? 0) <= stats.fratture,
  );
}

export function addDiary(g: GroupData, text: string, at = Date.now()) {
  g.diario = [...g.diario, { at, text }].slice(-100);
}
