import { describe, expect, it } from 'vitest';
import { generateDungeon, nextWaypoint, walkable } from '../src/combat/dungeon';
import { BOT_CLEARANCE, stepToward } from '../src/combat/bots';

/** Un compagno che cammina dall'ingresso fino al boss, come fa nel gioco (passi da 0,2 m). */
function walkThrough(seed: number, grado: number) {
  const d = generateDungeon(seed, grado);
  const can = (x: number, z: number) => walkable(d, x, z, BOT_CLEARANCE);
  let x = d.rooms[0].cx;
  let z = d.rooms[0].cz;
  const goal = d.rooms[d.rooms.length - 1];
  for (let i = 0; i < 3000; i++) {
    if (Math.hypot(goal.cx - x, goal.cz - z) < 1.5) return true;
    const [wx, wz] = nextWaypoint(d, x, z, goal.cx, goal.cz);
    const s = stepToward(x, z, wx, wz, 0.2, can);
    if (!s) return false;
    x = s.x;
    z = s.z;
  }
  return false;
}

describe('I compagni attraversano porte e corridoi', () => {
  it('dalla stanza al corridoio non c’è più una striscia "invisibile"', () => {
    for (let seed = 1; seed < 40; seed++) {
      const d = generateDungeon(seed * 101, 3);
      for (const c of d.corridors) {
        const a = d.rooms[c.i];
        // dalla stanza, attraverso la soglia, dentro il corridoio: tutto percorribile (a 0,35 m dai muri)
        for (let z = a.rect.z0 + 1; z >= a.rect.z0 - 1; z -= 0.1) expect(walkable(d, c.x, z, BOT_CLEARANCE)).toBe(true);
      }
    }
  });

  it('non entrano nei muri: il centro del corpo resta lontano dal bordo almeno metà muro più il corpo', () => {
    expect(BOT_CLEARANCE).toBeGreaterThanOrEqual(0.3 + 0.4);
  });

  it('dall’ingresso arrivano fino al boss, in tante Fratture diverse', () => {
    for (let seed = 1; seed < 60; seed++) expect(walkThrough(seed * 7919, 1 + (seed % 9))).toBe(true);
  });
});
