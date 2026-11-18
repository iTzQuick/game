import { describe, expect, it } from 'vitest';
import { generateDungeon } from '../src/combat/dungeon';
import { BOSS, EnemySim, type PlayerView, type SimEvent } from '../src/combat/sim';
import { EF, scaling } from '../src/combat/defs';

function setup() {
  const d = generateDungeon(4242, 1);
  const sim = new EnemySim(d, scaling(1, 1, []), []);
  const room = d.rooms[d.rooms.length - 1];
  const [boss] = sim.spawnWave(room.i, 0, 1, 1, Math.random, 0);
  return { d, sim, room, boss };
}

describe('Boss', () => {
  it('balza sul bersaglio lontano, vola fino a lì e atterra con un’onda d’urto', () => {
    const { sim, room, boss } = setup();
    const player: PlayerView = { id: 'p', x: room.cx, z: room.rect.z1 - 3, alive: true, hidden: false };
    let now = 0;
    let leap: SimEvent | undefined;
    const events: SimEvent[] = [];
    // passano i primi secondi: prima o poi il boss sceglie il balzo
    for (let i = 0; i < 400 && !leap; i++) {
      now += 33;
      for (const ev of sim.step(33, now, [player])) {
        events.push(ev);
        if (ev.t === 'ea' && ev.k === 'circle' && ev.rad === BOSS.leapRadius) leap = ev;
      }
    }
    expect(leap).toBeTruthy();
    // in volo: il flag del balzo è acceso
    now += 300;
    sim.step(33, now, [player]);
    expect(sim.flags(boss, now) & EF.leap).toBeTruthy();
    // atterra sul punto segnato e parte l'onda d'urto
    let shock: SimEvent | undefined;
    for (let i = 0; i < 60 && !shock; i++) {
      now += 33;
      for (const ev of sim.step(33, now, [player])) if (ev.t === 'ea' && ev.rad === BOSS.shockRadius) shock = ev;
    }
    expect(shock).toBeTruthy();
    if (leap && leap.t === 'ea') {
      expect(Math.hypot(boss.x - leap.x, boss.z - leap.z)).toBeLessThan(1.5);
    }
  });

  it('a metà vita entra nella seconda fase: ruggito, onda d’urto e un attimo senza danni', () => {
    const { sim, room, boss } = setup();
    const player: PlayerView = { id: 'p', x: room.cx, z: room.cz, alive: true, hidden: false };
    boss.hp = boss.maxHp * 0.49;
    const ev = sim.step(33, 1000, [player]);
    expect(ev.some((e) => e.t === 'ea' && e.rad === BOSS.phaseRadius)).toBe(true);
    expect(sim.flags(boss, 1000) & EF.enraged).toBeTruthy();
    const hp = boss.hp;
    sim.applyHit('p', { e: boss.id, d: 100 }, 1100);
    expect(boss.hp).toBe(hp);
    sim.applyHit('p', { e: boss.id, d: 100 }, 1000 + BOSS.phaseInvuln + 50);
    expect(boss.hp).toBeLessThan(hp);
  });
});
