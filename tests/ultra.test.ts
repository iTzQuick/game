import { describe, expect, it } from 'vitest';
import { combat } from '../src/combat/runtime';
import { AB, ULTRA_GAIN } from '../src/combat/defs';

describe('Ultra e Bastione', () => {
  it('mentre la Ultra è attiva (e poco dopo) la carica non sale', () => {
    combat.resetVitals(100);
    combat.me.ultraLockUntil = performance.now() + 10_000;
    combat.addUltra(50);
    expect(combat.me.ultra).toBe(0);
    combat.me.ultraLockUntil = 0;
    combat.addUltra(50);
    expect(combat.me.ultra).toBeGreaterThan(0);
  });

  it('il Bastione blocca gran parte dei danni, non tutti', () => {
    combat.resetVitals(100);
    const now = performance.now();
    combat.me.bastionUntil = now + 8000;
    combat.me.bastionAbsorbed = 0;
    combat.damageMe(40, now);
    expect(combat.me.bastionAbsorbed).toBeCloseTo(40 * AB.bastione.block);
    expect(combat.me.hp).toBeLessThan(100);
    expect(combat.me.hp).toBeGreaterThan(100 - 40);
  });

  it('una Ultra non si ricarica da sola in pochi colpi', () => {
    // per riempirla servono parecchi danni: 100 / 0.4 = 250 punti inflitti
    expect(100 / ULTRA_GAIN.dealt).toBeGreaterThanOrEqual(240);
  });
});
