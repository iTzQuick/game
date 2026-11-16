import { describe, expect, it } from 'vitest';
import { rng } from '../src/combat/defs';
import {
  BUILDINGS,
  INVENTORY_SIZE,
  MAX_LEVEL,
  RARITIES,
  TREES,
  XP,
  generateItem,
  itemStats,
  rarityWeights,
  salvageValue,
  upgradeCost,
  xpToNext,
} from '../src/progress/defs';
import {
  addItems,
  addXp,
  canLearn,
  classProgress,
  computeMods,
  contribute,
  emptyGroup,
  emptySave,
  equip,
  learn,
  normalizeGroup,
  normalizeSave,
  pointsAvailable,
  salvage,
  unlockedLore,
  upgrade,
} from '../src/progress/model';

describe('livelli', () => {
  it('l’esperienza fa salire di livello e dà un punto talento per livello', () => {
    const s = emptySave();
    const gained = addXp(s, 'lama', xpToNext(1) + xpToNext(2) + 5);
    expect(gained).toBe(2);
    const p = classProgress(s, 'lama');
    expect(p.level).toBe(3);
    expect(p.xp).toBe(5);
    expect(pointsAvailable(p)).toBe(2);
    expect(classProgress(s, 'guardiano').level).toBe(1); // ogni classe ha il suo livello
  });

  it('si ferma al livello massimo', () => {
    const s = emptySave();
    addXp(s, 'custode', 10_000_000);
    expect(classProgress(s, 'custode').level).toBe(MAX_LEVEL);
  });

  it('una Frattura di Grado 1 vale circa 2 livelli all’inizio', () => {
    const run = 4 * 5 * XP.kill(2, 1, false) + 4 * XP.room(1) + XP.fractura(1) + XP.kill(0, 1, true);
    expect(run).toBeGreaterThan(xpToNext(1) + xpToNext(2));
    expect(run).toBeLessThan(xpToNext(1) + xpToNext(2) + xpToNext(3) + xpToNext(4));
  });
});

describe('talenti', () => {
  it('ogni classe ha 3 rami da 5 talenti', () => {
    for (const branches of Object.values(TREES)) {
      expect(branches).toHaveLength(3);
      for (const b of branches) expect(b.nodes).toHaveLength(5);
    }
  });

  it('serve il talento precedente del ramo, e i punti disponibili', () => {
    const s = emptySave();
    expect(canLearn(s, 'guardiano', 'g1')).toBe(false); // livello 1: nessun punto
    addXp(s, 'guardiano', xpToNext(1) + xpToNext(2));
    expect(canLearn(s, 'guardiano', 'g2')).toBe(false); // prima g1
    expect(learn(s, 'guardiano', 'g1')).toBe(true);
    expect(learn(s, 'guardiano', 'g2')).toBe(true);
    expect(learn(s, 'guardiano', 'g3')).toBe(false); // punti finiti
  });

  it('i talenti diventano modificatori e poteri', () => {
    const s = emptySave();
    addXp(s, 'guardiano', 100000);
    learn(s, 'guardiano', 'g1');
    learn(s, 'guardiano', 'g1');
    learn(s, 'guardiano', 'g2');
    learn(s, 'guardiano', 'g3');
    const m = computeMods(s, 'guardiano');
    expect(m.hpPct).toBeCloseTo(0.12);
    expect(m.dmgReduction).toBeCloseTo(0.04);
    expect(m.perks.barrieraRaggio).toBeCloseTo(0.3);
    expect(computeMods(s, 'lama').hpPct).toBe(0); // i talenti valgono solo per la loro classe
  });
});

describe('oggetti e frammenti', () => {
  it('le rarità migliori escono più spesso ai Gradi alti', () => {
    const lo = rarityWeights(1);
    const hi = rarityWeights(10);
    const share = (w: number[]) => (w[3] + w[4]) / w.reduce((a, b) => a + b, 0);
    expect(share(hi)).toBeGreaterThan(share(lo) * 2);
  });

  it('gli oggetti hanno tanti affissi quanto dice la rarità, tutti diversi', () => {
    const rand = rng(11);
    for (let i = 0; i < 300; i++) {
      const it = generateItem(rand, 1 + (i % 10));
      expect(it.affixes).toHaveLength(RARITIES[it.rarity].affixes);
      expect(new Set(it.affixes.map((a) => a.k)).size).toBe(it.affixes.length);
    }
    expect(generateItem(rng(3), 1, 2).rarity).toBeGreaterThanOrEqual(2);
  });

  it('indossare un oggetto ne aggiunge le statistiche', () => {
    const s = emptySave();
    const it = generateItem(rng(5), 3, 0, 'arma');
    addItems(s, [it]);
    expect(equip(s, it.id)).toBe(true);
    const base = itemStats(it).find((a) => a.k === 'dmgPct')!.v;
    expect(computeMods(s, null).dmgPct).toBeGreaterThanOrEqual(base);
  });

  it('smontare dà frammenti, ma non gli oggetti indossati', () => {
    const s = emptySave();
    const [a, b] = [generateItem(rng(1), 2), generateItem(rng(2), 2)];
    addItems(s, [a, b]);
    equip(s, a.id);
    expect(salvage(s, a.id)).toBe(0);
    expect(salvage(s, b.id)).toBe(salvageValue(b));
    expect(s.fragments).toBe(salvageValue(b));
  });

  it('la Forgia potenzia con i frammenti', () => {
    const s = emptySave();
    const it = generateItem(rng(9), 4);
    addItems(s, [it]);
    expect(upgrade(s, it.id)).toBe(false); // niente frammenti
    s.fragments = upgradeCost(it);
    expect(upgrade(s, it.id)).toBe(true);
    expect(s.fragments).toBe(0);
    expect(s.inventory[0].up).toBe(1);
  });

  it('a zaino pieno gli oggetti nuovi diventano frammenti', () => {
    const s = emptySave();
    const rand = rng(77);
    addItems(s, Array.from({ length: INVENTORY_SIZE }, () => generateItem(rand, 1)));
    const extra = generateItem(rand, 1);
    const r = addItems(s, [extra]);
    expect(r.kept).toHaveLength(0);
    expect(r.salvaged).toBe(salvageValue(extra));
  });
});

describe('la base del gruppo', () => {
  it('si costruisce versando frammenti, senza sprecarne', () => {
    const g = emptyGroup();
    const cost = BUILDINGS.find((b) => b.id === 'forgia')!.cost;
    expect(contribute(g, 'forgia', 50)).toBe(50);
    expect(g.base.forgia).toEqual({ p: 50, u: false });
    expect(contribute(g, 'forgia', 1000)).toBe(cost - 50);
    expect(g.base.forgia?.u).toBe(true);
    expect(contribute(g, 'forgia', 10)).toBe(0);
    expect(contribute(g, 'osservatorio', 10)).toBe(0); // non ancora costruibile
  });

  it('gli indizi si sbloccano con le imprese', () => {
    const g = emptyGroup();
    const few = unlockedLore(g.stats, g.best).length;
    const many = unlockedLore({ fratture: 10, bosses: 10, kills: 0 }, 9).length;
    expect(few).toBe(1);
    expect(many).toBeGreaterThan(few);
  });

  it('i salvataggi rovinati o vecchi vengono riparati', () => {
    expect(normalizeSave(null)).toEqual(emptySave());
    expect(normalizeSave({ fragments: -5, stats: { kills: 3 } }).stats).toEqual({ kills: 3, fratture: 0, bosses: 0 });
    expect(normalizeGroup({ grado: 0 }).grado).toBe(1);
  });
});
