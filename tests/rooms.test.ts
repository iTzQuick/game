import { describe, expect, it } from 'vitest';
import { generateDungeon, puddleAt, type RoomVariant } from '../src/combat/dungeon';
import { EnemySim, ELITE } from '../src/combat/sim';
import { ENEMIES, WAVE_POOLS, rng, scaling } from '../src/combat/defs';

describe('Stanze speciali', () => {
  it('la prima stanza è normale, al massimo un tesoro, mai due speciali uguali di fila', () => {
    const seen = new Set<RoomVariant>();
    for (let seed = 1; seed < 400; seed++) {
      const d = generateDungeon(seed * 7717, 1 + (seed % 9));
      const combat = d.rooms.filter((r) => r.kind === 'combat');
      expect(combat[0].variant).toBe('normale');
      expect(combat.filter((r) => r.variant === 'tesoro').length).toBeLessThanOrEqual(1);
      for (let i = 1; i < combat.length; i++) {
        const v = combat[i].variant;
        if (v !== 'normale') expect(v).not.toBe(combat[i - 1].variant);
      }
      for (const r of combat) seen.add(r.variant!);
      // il forziere sta al centro: lì niente colonne
      for (const r of combat.filter((x) => x.variant === 'tesoro')) {
        for (const p of r.pillars) expect(Math.hypot(p.x - r.cx, p.z - r.cz)).toBeGreaterThan(3.9);
      }
    }
    expect([...seen].sort()).toEqual(['campione', 'normale', 'prova', 'tesoro', 'trappole']);
  });

  it('stesso seme, stesse stanze per tutti', () => {
    const a = generateDungeon(4242, 5).rooms.map((r) => r.variant);
    const b = generateDungeon(4242, 5).rooms.map((r) => r.variant);
    expect(a).toEqual(b);
  });

  it('nella stanza del Campione c’è un nemico dorato molto più forte; nel tesoro nessuno', () => {
    let foundChampion = false;
    let foundTreasure = false;
    for (let seed = 1; seed < 300 && !(foundChampion && foundTreasure); seed++) {
      const d = generateDungeon(seed * 31, 2);
      const sim = new EnemySim(d, scaling(2, 1, []), []);
      for (const r of d.rooms) {
        if (r.variant === 'campione' && !foundChampion) {
          const wave = sim.spawnWave(r.i, 0, 1, 2, rng(seed), 0);
          const elite = wave.filter((e) => e.elite);
          expect(elite).toHaveLength(1);
          expect(elite[0].type).not.toBe('sciame');
          expect(elite[0].maxHp).toBe(Math.round(Math.round(ENEMIES[elite[0].type].hp * scaling(2, 1, []).hp) * ELITE.hp));
          expect(elite[0].maxHp).toBeGreaterThan(ENEMIES[elite[0].type].hp * scaling(2, 1, []).hp * 3);
          foundChampion = true;
        }
        if (r.variant === 'tesoro' && !foundTreasure) {
          expect(sim.spawnWave(r.i, 0, 1, 2, rng(seed), 0)).toHaveLength(0);
          foundTreasure = true;
        }
      }
    }
    expect(foundChampion && foundTreasure).toBe(true);
    expect(WAVE_POOLS.frattura.length).toBeGreaterThan(0);
  });

  it('pozze d’acqua: uguali per tutti, mai nell’ingresso, lontane da colonne e porte', () => {
    let total = 0;
    for (let seed = 1; seed < 200; seed++) {
      const d = generateDungeon(seed * 911, 1 + (seed % 9));
      expect(generateDungeon(seed * 911, 1 + (seed % 9)).rooms.map((r) => r.puddles)).toEqual(d.rooms.map((r) => r.puddles));
      expect(d.rooms[0].puddles).toHaveLength(0);
      for (const r of d.rooms) {
        for (const p of r.puddles) {
          total++;
          expect(p.x - p.r).toBeGreaterThan(r.rect.x0);
          expect(p.x + p.r).toBeLessThan(r.rect.x1);
          for (const c of r.pillars) expect(Math.hypot(c.x - p.x, c.z - p.z)).toBeGreaterThan(c.r + p.r);
          if (r.doorSouthX !== null) expect(Math.hypot(r.doorSouthX - p.x, r.rect.z1 - p.z)).toBeGreaterThan(p.r + 3);
          expect(puddleAt(d, p.x, p.z)).toBe(p);
        }
      }
    }
    expect(total).toBeGreaterThan(300);
  });
});
