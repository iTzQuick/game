import { describe, expect, it } from 'vitest';
import { generateDungeon, roomAt, walkable, checkpoint, wallBoxes, spawnPoints, combatRoomCount, inRect } from '../src/combat/dungeon';
import { EnemySim, composeWave, type PlayerView } from '../src/combat/sim';
import { scaling, pickMods, rng, ENEMIES, EF } from '../src/combat/defs';
import { applyClassRequest, emptyRoomState } from '../src/net/roomLogic';

describe('Frattura generata', () => {
  it('stesso seme = stessa Frattura', () => {
    expect(generateDungeon(1234, 1)).toEqual(generateDungeon(1234, 1));
    expect(generateDungeon(1234, 1)).not.toEqual(generateDungeon(999, 1));
  });

  it('ingresso, stanze di combattimento e boss in fila, collegate da corridoi', () => {
    for (let seed = 1; seed < 60; seed++) {
      const d = generateDungeon(seed * 7919, 1 + (seed % 9));
      expect(d.rooms[0].kind).toBe('start');
      expect(d.rooms[d.rooms.length - 1].kind).toBe('boss');
      expect(d.rooms.length).toBe(2 + combatRoomCount(1 + (seed % 9)));
      expect(d.corridors.length).toBe(d.rooms.length - 1);
      for (const c of d.corridors) {
        const a = d.rooms[c.i];
        const b = d.rooms[c.i + 1];
        // il corridoio parte dal muro nord di una stanza e arriva al muro sud della successiva
        expect(c.rect.z1).toBeCloseTo(a.rect.z0);
        expect(c.rect.z0).toBeCloseTo(b.rect.z1);
        // e la porta sta dentro il muro di entrambe
        expect(c.x).toBeGreaterThan(Math.max(a.rect.x0, b.rect.x0) + 1.9);
        expect(c.x).toBeLessThan(Math.min(a.rect.x1, b.rect.x1) - 1.9);
        // si può camminare dalla stanza al corridoio e oltre
        expect(walkable(d, c.x, a.rect.z0 + 0.5)).toBe(true);
        expect(walkable(d, c.x, (c.rect.z0 + c.rect.z1) / 2)).toBe(true);
        expect(walkable(d, c.x, b.rect.z1 - 0.5)).toBe(true);
      }
      // le stanze non si sovrappongono
      for (let i = 0; i < d.rooms.length - 1; i++) expect(d.rooms[i + 1].rect.z1).toBeLessThan(d.rooms[i].rect.z0);
    }
  });

  it('i checkpoint sono sul pavimento, nella stanza sicura prima della porta', () => {
    for (let seed = 1; seed < 40; seed++) {
      const d = generateDungeon(seed, 3);
      for (const r of d.rooms) {
        const [x, , z] = checkpoint(d, r.i);
        expect(walkable(d, x, z, 0.5)).toBe(true);
        // si riparte nella stanza precedente (già ripulita), non in quella da affrontare
        expect(roomAt(d, x, z)).toBe(Math.max(0, r.i - 1));
        if (r.i > 0) expect(Math.abs(x - (r.doorSouthX ?? 0))).toBeLessThan(0.01);
      }
    }
  });

  it('i nemici compaiono dentro la stanza, lontano dall’ingresso', () => {
    const d = generateDungeon(42, 2);
    const pts = spawnPoints(d, 1, 8, rng(5));
    expect(pts).toHaveLength(8);
    for (const [x, z] of pts) {
      expect(inRect(d.rooms[1].rect, x, z)).toBe(true);
      expect(d.rooms[1].rect.z1 - z).toBeGreaterThanOrEqual(6.9);
    }
  });

  it('i muri lasciano aperte le porte', () => {
    const d = generateDungeon(77, 1);
    const walls = wallBoxes(d);
    const blocked = (x: number, z: number) => walls.some((w) => Math.abs(x - w.x) <= w.hx && Math.abs(z - w.z) <= w.hz);
    for (const c of d.corridors) {
      expect(blocked(c.x, c.rect.z1)).toBe(false);
      expect(blocked(c.x, c.rect.z0)).toBe(false);
      expect(blocked(c.rect.x0, (c.rect.z0 + c.rect.z1) / 2)).toBe(true);
    }
  });
});

describe('nemici (simulazione dell’host)', () => {
  const d = generateDungeon(2024, 1);
  const room = d.rooms[1];
  const player = (x: number, z: number, extra: Partial<PlayerView> = {}): PlayerView => ({ id: 'p1', x, z, alive: true, hidden: false, ...extra });

  it('inseguono il giocatore e attaccano con preavviso', () => {
    const sim = new EnemySim(d, scaling(1, 1, []), []);
    const e = sim.spawn('ombra', 1, room.cx, room.cz - 4, 0);
    const p = player(room.cx, room.cz + 4);
    let attack = null;
    for (let t = 0; t < 6000 && !attack; t += 50) {
      const ev = sim.step(50, t, [p]);
      attack = ev.find((x) => x.t === 'ea') ?? null;
    }
    expect(attack).not.toBeNull();
    expect(Math.hypot(e.x - p.x, e.z - p.z)).toBeLessThan(ENEMIES.ombra.range + 0.1);
    expect(attack && attack.t === 'ea' && attack.d).toBeGreaterThan(300);
  });

  it('ignorano chi è a terra o invisibile', () => {
    const sim = new EnemySim(d, scaling(1, 1, []), []);
    const e = sim.spawn('ombra', 1, room.cx, room.cz, 0);
    const start = { x: e.x, z: e.z };
    for (let t = 0; t < 2000; t += 50) sim.step(50, t, [player(room.cx + 6, room.cz, { hidden: true })]);
    expect(Math.hypot(e.x - start.x, e.z - start.z)).toBeLessThan(0.5);
  });

  it('la provocazione attira i nemici su chi l’ha usata', () => {
    const sim = new EnemySim(d, scaling(1, 2, []), []);
    const e = sim.spawn('ombra', 1, room.cx, room.cz, 0);
    const near = player(room.cx + 2, room.cz);
    const guard = { ...player(room.cx - 7, room.cz), id: 'g' };
    sim.applyHit('g', { e: e.id, d: 0, tn: 5000 }, 0);
    sim.step(50, 50, [near, guard]);
    expect(e.target).toBe('g');
    expect(sim.flags(e, 60) & EF.taunt).toBeTruthy();
  });

  it('lo stordimento interrompe un attacco in preparazione', () => {
    const sim = new EnemySim(d, scaling(1, 1, []), []);
    const e = sim.spawn('ombra', 1, room.cx, room.cz, 0);
    e.nextAttack = 0;
    const ev1 = sim.step(50, 100, [player(room.cx + 1, room.cz)]);
    expect(ev1.some((x) => x.t === 'ea')).toBe(true);
    const ev2 = sim.applyHit('p1', { e: e.id, d: 5, st: 1500 }, 120);
    expect(ev2).toContainEqual({ t: 'ecancel', id: e.id });
    expect(e.ai).toBe('chase');
  });

  it('muoiono a zero vita; i velati prendono metà danni finché non sono rivelati', () => {
    const sim = new EnemySim(d, scaling(1, 1, []), []);
    const v = sim.spawn('velato', 1, room.cx, room.cz, 0);
    sim.applyHit('p', { e: v.id, d: 20 }, 0);
    expect(v.hp).toBe(v.maxHp - 10);
    sim.applyHit('p', { e: v.id, d: 0, mk: 8000 }, 0);
    sim.applyHit('p', { e: v.id, d: 8 }, 10);
    expect(v.hp).toBe(v.maxHp - 20); // 8 × 1,25 per il marchio
    const ev = sim.applyHit('p', { e: v.id, d: 999 }, 20);
    expect(ev[0]).toMatchObject({ t: 'edie', id: v.id });
    expect(sim.aliveIn(1)).toBe(0);
  });

  it('l’esecuzione uccide solo i nemici deboli', () => {
    const sim = new EnemySim(d, scaling(1, 1, []), []);
    const e = sim.spawn('ombra', 1, room.cx, room.cz, 0);
    sim.applyHit('p', { e: e.id, d: 1, x: true }, 0);
    expect(sim.enemies.has(e.id)).toBe(true);
    e.hp = e.maxHp * 0.3;
    sim.applyHit('p', { e: e.id, d: 1, x: true }, 0);
    expect(sim.enemies.has(e.id)).toBe(false);
  });

  it('restano nella loro stanza', () => {
    const sim = new EnemySim(d, scaling(1, 1, ['veloci']), ['veloci']);
    const e = sim.spawn('sciame', 1, room.cx, room.cz, 0);
    const far = player(room.cx, room.rect.z1 + 30);
    for (let t = 0; t < 5000; t += 50) sim.step(50, t, [far]);
    expect(inRect(room.rect, e.x, e.z)).toBe(true);
  });

  it('il boss chiama rinforzi quando è ferito', () => {
    const last = d.rooms.length - 1;
    const sim = new EnemySim(d, scaling(1, 1, []), []);
    const [boss] = sim.spawnWave(last, 0, 1, 1, rng(1), 0);
    expect(boss.type).toBe('eco');
    sim.applyHit('p', { e: boss.id, d: boss.maxHp * 0.4 }, 0);
    sim.step(50, 50, [player(boss.x, boss.z + 10)]);
    expect(sim.aliveIn(last)).toBe(4); // a 60%: prima chiamata
    expect(boss.boss?.enraged).toBe(false);
    sim.applyHit('p', { e: boss.id, d: boss.maxHp * 0.15 }, 60);
    sim.step(50, 100, [player(boss.x, boss.z + 10)]);
    expect(boss.boss?.enraged).toBe(true); // sotto il 50% si infuria
  });

  it('le ondate crescono con giocatori e Grado', () => {
    const cost = (n: number, g: number) =>
      composeWave(6 + 2 * (n - 1) + (g - 1), rng(3), []).reduce((s, t) => s + ENEMIES[t].cost, 0);
    expect(cost(4, 5)).toBeGreaterThan(cost(1, 1));
    expect(scaling(5, 4, []).hp).toBeGreaterThan(scaling(1, 1, []).hp);
    expect(pickMods(1, rng(1))).toHaveLength(0);
    expect(pickMods(3, rng(1))).toHaveLength(1);
    expect(new Set(pickMods(7, rng(1))).size).toBe(2);
  });
});

describe('stato della stanza durante una Frattura', () => {
  it('la classe non si cambia dentro una Frattura', () => {
    const s = { ...emptyRoomState(), run: { id: 1, seed: 1, grado: 1, mods: [], phase: 'active' as const, cleared: 1, fight: -1, wave: 0, wipes: 0 } };
    expect(applyClassRequest(s, 'a', 'lama', ['a'])).toEqual({ ok: false, reason: 'in-run' });
  });

  it('cambiare classe conserva la run e il Grado', () => {
    const s = { ...emptyRoomState(), grado: 4, best: 3 };
    const r = applyClassRequest(s, 'a', 'lama', ['a']);
    expect(r.ok && r.state.grado).toBe(4);
    expect(r.ok && r.state.best).toBe(3);
  });
});
