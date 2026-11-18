import { describe, expect, it } from 'vitest';
import { combat, PERFECT_WINDOW_MS } from '../src/combat/runtime';
import { resetFeel, slowMo, tickWarp, worldSpeed } from '../src/combat/feel';
import { bodyOffset, holdOffset } from '../src/player/moves';

describe('Schivata perfetta', () => {
  const tele = (t1: number, x = 0, z = 0) => ({ id: 1, k: 'circle' as const, x, z, r: 0, rad: 2, arc: 0, t0: t1 - 1000, t1, dmg: 10, done: false });

  it('vale solo se il colpo sta per arrivare e si è dentro', () => {
    combat.resetVitals(100);
    const now = 10_000;
    combat.telegraphs = [tele(now + 200)];
    expect(combat.perfectDodge(0.5, 0, now)).toBe(true);
    // troppo presto
    combat.telegraphs = [tele(now + PERFECT_WINDOW_MS + 300)];
    expect(combat.perfectDodge(0.5, 0, now)).toBe(false);
    // fuori dal cerchio
    combat.telegraphs = [tele(now + 100, 10, 10)];
    expect(combat.perfectDodge(0, 0, now)).toBe(false);
    combat.telegraphs = [];
  });

  it('il rallentatore rallenta il mondo e poi torna normale; i nemici recuperano il ritardo', () => {
    resetFeel();
    const t0 = performance.now();
    slowMo(900, 0.3);
    expect(worldSpeed(t0 + 100)).toBeCloseTo(0.3);
    expect(worldSpeed(t0 + 2000)).toBe(1);
    let w = 0;
    for (let i = 0; i < 10; i++) w = tickWarp(0.05, t0 + 100);
    expect(w).toBeGreaterThan(300);
    for (let i = 0; i < 40; i++) w = tickWarp(0.05, t0 + 5000);
    expect(w).toBe(0);
  });
});

describe('Colpo caricato', () => {
  it('il colpo pesante parte e finisce a riposo; la carica tende il corpo', () => {
    expect(bodyOffset('heavy', 3, 0)).toEqual({ rx: 0, ry: 0, y: 0, z: 0, s: 1 });
    expect(bodyOffset('heavy', 3, 1)).toEqual({ rx: 0, ry: 0, y: 0, z: 0, s: 1 });
    // a metà del colpo l'arma è in avanti e in basso
    expect(bodyOffset('heavy', 3, 0.6).z).toBeGreaterThan(0.3);
    expect(holdOffset(-1, 0).rx).toBe(0);
    expect(holdOffset(1, 0).rx).toBeLessThan(-0.15);
  });
});
