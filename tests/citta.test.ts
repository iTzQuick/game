import { describe, expect, it } from 'vitest';
import { ENEMIES, WAVE_POOLS, isBoss, rng, scaling } from '../src/combat/defs';
import { generateDungeon, inRect, walkable } from '../src/combat/dungeon';
import { EnemySim, composeWave, type PlayerView } from '../src/combat/sim';
import { validaMissione } from '../src/narrator/core';
import {
  ATTO1,
  CITTA,
  OSSIGENO,
  avanzaAtto,
  cittaAperta,
  colonneBolle,
  esitoVoto,
  inColonna,
  normalizzaAtto,
  passoOssigeno,
  progressoVuoto,
  puoPartire,
} from '../src/citta/core';
import { normalizeGroup } from '../src/progress/model';

describe('ossigeno', () => {
  it('cala, si riprende nelle bolle, a zero fa perdere vita', () => {
    const a = passoOssigeno(100, 10, false, 120);
    expect(a.o).toBeCloseTo(100 - OSSIGENO.calo * 10);
    expect(a.danno).toBe(0);
    expect(passoOssigeno(20, 1, true, 120).o).toBeCloseTo(20 + OSSIGENO.ricarica);
    expect(passoOssigeno(95, 1, true, 120).o).toBe(OSSIGENO.max);
    const vuoto = passoOssigeno(0.5, 1, false, 120);
    expect(vuoto.o).toBe(0);
    expect(vuoto.danno).toBeCloseTo(120 * OSSIGENO.danno);
    // da pieno a vuoto in poco più di un minuto
    expect(OSSIGENO.max / OSSIGENO.calo).toBeGreaterThan(60);
  });

  it('le colonne di bolle: dal seme, nelle stanze giuste, sul pavimento libero', () => {
    for (const seed of [1, 42, 2024, 77777]) {
      const d = generateDungeon(seed, 2);
      const c = colonneBolle(d);
      expect(colonneBolle(generateDungeon(seed, 2))).toEqual(c);
      for (const r of d.rooms) {
        const n = c.filter((x) => x.room === r.i).length;
        expect(n).toBeGreaterThanOrEqual(1);
        if (r.kind === 'boss') expect(n).toBeGreaterThanOrEqual(2);
      }
      for (const x of c) {
        expect(inRect(d.rooms[x.room].rect, x.x, x.z)).toBe(true);
        expect(walkable(d, x.x, x.z)).toBe(true);
        expect(inColonna(c, x.x + 1, x.z)).toBe(true);
      }
    }
  });
});

describe('Atto I', () => {
  it('si apre dopo la prima Frattura, una missione alla volta', () => {
    expect(cittaAperta({ fratture: 0 })).toBe(false);
    expect(cittaAperta({ fratture: 1 })).toBe(true);
    let p = progressoVuoto();
    expect(puoPartire('atto1-1', p)).toBe(true);
    expect(puoPartire('atto1-2', p)).toBe(false);
    p = avanzaAtto(p, 'atto1-1');
    expect(p.fatte).toBe(1);
    // rigiocare una missione fatta non fa avanzare
    expect(avanzaAtto(p, 'atto1-1')).toEqual(p);
    expect(puoPartire('atto1-1', p)).toBe(true);
    expect(puoPartire('atto1-2', p)).toBe(true);
    expect(puoPartire('atto1-9', p)).toBe(false);
  });

  it('le missioni della storia sono valide e finiscono con La Campana', () => {
    expect(ATTO1).toHaveLength(5);
    for (const m of ATTO1) {
      const { fine, boss, ...missione } = m;
      expect(validaMissione(missione, m.id)).toEqual(missione);
      expect(fine.length).toBeGreaterThan(0);
      expect(boss === 'eco' || boss === 'campana').toBe(true);
    }
    expect(ATTO1[ATTO1.length - 1].boss).toBe('campana');
  });

  it('progresso salvato riparato', () => {
    expect(normalizzaAtto({ fatte: 99, scelta: 1 })).toEqual({ fatte: 5, scelta: 1 });
    expect(normalizzaAtto({ fatte: -3, scelta: 'x' })).toEqual({ fatte: 0, scelta: null });
    expect(normalizeGroup({}).atto1).toEqual({ fatte: 0, scelta: null });
    expect(normalizeGroup({ atto1: { fatte: 2 } }).atto1).toEqual({ fatte: 2, scelta: null });
  });

  it('il voto: vince la maggioranza, in parità chi è entrato per primo', () => {
    expect(esitoVoto({ a: 1, b: 1, c: 0 }, ['c', 'a', 'b'])).toBe(1);
    expect(esitoVoto({ a: 0, b: 1 }, ['b', 'a'])).toBe(1);
    expect(esitoVoto({ a: 0, b: 1 }, ['a', 'b'])).toBe(0);
    expect(esitoVoto({ x: 1 }, ['a', 'x'])).toBe(1);
  });
});

describe('nemici della Città', () => {
  const d = generateDungeon(2024, 1);
  const room = d.rooms[1];
  const player = (x: number, z: number): PlayerView => ({ id: 'p1', x, z, alive: true, hidden: false });

  it('ondate con i nemici della Città, e La Campana in fondo', () => {
    const wave = composeWave(14, rng(3), [], undefined, WAVE_POOLS[CITTA]);
    expect(wave.length).toBeGreaterThan(0);
    for (const t of wave) expect(WAVE_POOLS[CITTA]).toContain(t);
    const sim = new EnemySim(d, scaling(1, 1, []), [], { boss: 'campana', pool: WAVE_POOLS[CITTA] });
    const [boss] = sim.spawnWave(d.rooms.length - 1, 0, 1, 1, rng(1), 0);
    expect(boss.type).toBe('campana');
    expect(boss.boss).toBeTruthy();
    expect(isBoss('campana') && isBoss('eco') && !isBoss('annegato')).toBe(true);
  });

  it('l’Anguilla scatta in avanti a fine preavviso', () => {
    const sim = new EnemySim(d, scaling(1, 1, []), []);
    const e = sim.spawn('anguilla', 1, room.cx, room.cz - 3, 0);
    e.nextAttack = 0;
    const p = player(room.cx, room.cz + 1);
    const ev = sim.step(50, 100, [p]);
    expect(ev.some((x) => x.t === 'ea')).toBe(true);
    const before = e.z;
    sim.step(50, 100 + ENEMIES.anguilla.windup * 1000 + 10, [p]);
    expect(e.z - before).toBeGreaterThan(ENEMIES.anguilla.lunge! * 0.8);
  });

  it('La Campana chiama Annegati, non Ombre', () => {
    const boss = d.rooms[d.rooms.length - 1];
    const sim = new EnemySim(d, scaling(1, 1, []), [], { boss: 'campana' });
    const b = sim.spawn('campana', boss.i, boss.cx, boss.cz, 0);
    b.hp = b.maxHp * 0.6;
    sim.step(50, 50, [player(boss.cx, boss.cz + 8)]);
    const helpers = [...sim.enemies.values()].filter((e) => e !== b).map((e) => e.type);
    expect(helpers).toContain('annegato');
    expect(helpers).not.toContain('ombra');
  });

  it('gli Annegati tolgono fiato, le Anguille no', () => {
    expect(ENEMIES.annegato.oxygen).toBeGreaterThan(0);
    expect(ENEMIES.campana.oxygen).toBeGreaterThan(0);
    expect(ENEMIES.anguilla.oxygen).toBeUndefined();
  });
});
