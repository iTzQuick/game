import { describe, expect, it } from 'vitest';
import { BOONS, BOON_IDS, addBoon, boonLevel, boonsForRun, offerBoons, withBoons, type BoonSet } from '../src/combat/boons';
import { rng } from '../src/combat/defs';
import { emptyMods } from '../src/progress/model';

describe('Poteri della Frattura', () => {
  it('ogni potere ha nome, descrizione e un’icona o un simbolo', () => {
    for (const id of BOON_IDS) {
      const b = BOONS[id];
      expect(b.name.length).toBeGreaterThan(2);
      expect(b.desc(1).length).toBeGreaterThan(5);
      expect(!!b.icon || !!b.glyph).toBe(true);
    }
  });

  it('se ne offrono 3 diversi, mai di un’altra classe, quasi sempre uno della propria', () => {
    for (let seed = 1; seed < 200; seed++) {
      const offer = offerBoons(rng(seed), 'lama', {});
      expect(offer).toHaveLength(3);
      expect(new Set(offer).size).toBe(3);
      for (const id of offer) expect(!BOONS[id].cls || BOONS[id].cls === 'lama').toBe(true);
      expect(offer.some((id) => BOONS[id].cls === 'lama')).toBe(true);
    }
  });

  it('non si offre un potere già al massimo', () => {
    const have: BoonSet = {};
    for (const id of BOON_IDS) if (BOONS[id].kind !== 'subito') have[id] = BOONS[id].max;
    for (let seed = 1; seed < 50; seed++) {
      const offer = offerBoons(rng(seed), 'guardiano', have);
      // resta solo il Sorso di luce, che si può prendere sempre
      expect(offer).toEqual(['sorso']);
    }
  });

  it('i bonus si sommano a talenti e oggetti, con dei limiti', () => {
    const base = emptyMods();
    base.dmgPct = 0.1;
    const m = withBoons(base, { furia: 2, eco: 3, 'g-bastione': 1 });
    expect(m.dmgPct).toBeCloseTo(0.1 + 0.24);
    expect(m.cdr).toBeCloseTo(0.36);
    expect(m.perks.bastioneEsplosione).toBeCloseTo(0.6);
    // la base non viene toccata
    expect(base.dmgPct).toBe(0.1);
    const capped = withBoons({ ...emptyMods(), cdr: 0.5 }, { eco: 3 });
    expect(capped.cdr).toBeLessThanOrEqual(0.6);
  });

  it('riprenderlo lo fa salire di livello; una nuova Frattura riparte da zero', () => {
    boonsForRun(1);
    addBoon('lune');
    addBoon('lune');
    expect(boonLevel('lune')).toBe(2);
    for (let i = 0; i < 5; i++) addBoon('lune');
    expect(boonLevel('lune')).toBe(BOONS.lune.max);
    addBoon('sorso');
    expect(boonLevel('sorso')).toBe(0);
    boonsForRun(2);
    expect(boonLevel('lune')).toBe(0);
  });
});
