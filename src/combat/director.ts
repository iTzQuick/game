// La regia dell'host: apre la Frattura, fa comparire le ondate quando il
// gruppo entra in una stanza, apre le porte quando la stanza è ripulita,
// gestisce la sconfitta di gruppo (tutti al checkpoint) e la vittoria sul boss.
// Se l'host esce, chi prende il suo posto riprende da dove si era (nemici
// compresi, dall'ultima istantanea ricevuta).

import { getRoom } from '../net/room';
import type { RunState } from '../net/roomLogic';
import { emitCombat, onCombat } from './bus';
import { ENEMY_TYPES, pickMods, rng, scaling } from './defs';
import { generateDungeon, inRect, roomAt, type Dungeon } from './dungeon';
import { VF, type CombatMsg } from './protocol';
import { combat } from './runtime';
import { EnemySim, type Hit, type PlayerView } from './sim';
import { FRAGMENTS, generateItem } from '../progress/defs';
import { SOMMERSA, sommersaOpen } from '../story/core';

const TICK_MS = 33;
const SNAP_HZ = 15;
const COUNTDOWN_MS = 5000;

const r2 = (n: number) => Math.round(n * 100) / 100;

export class HostDirector {
  private sim: EnemySim | null = null;
  private dungeon: Dungeon | null = null;
  private runId = -1;
  private timer: ReturnType<typeof setInterval> | null = null;
  private last = 0;
  private lastSnap = 0;
  private countdownFor = -1;
  private countdownEnd = 0;
  private nextWaveAt = 0;
  private wipeAt = 0;
  private unsub: (() => void) | null = null;

  start() {
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.unsub = onCombat((from, msg) => this.onMsg(from, msg));
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.unsub?.();
    combat.hitSink = null;
  }

  /** Accesso per i test automatici. */
  get debug() {
    return { sim: this.sim, dungeon: this.dungeon };
  }

  private onMsg(from: string, msg: CombatMsg) {
    const room = getRoom();
    if (!room?.isHost) return;
    if (msg.t === 'hit') this.applyHits(from, msg.h);
    else if (msg.t === 'zone' && (msg.z.kind === 'trappola' || msg.z.kind === 'collasso')) {
      const now = performance.now();
      const isC = msg.z.kind === 'collasso';
      this.sim?.addZone({
        id: msg.z.id,
        kind: msg.z.kind,
        x: msg.z.x,
        z: msg.z.z,
        r: msg.z.r,
        pull: msg.z.pull ?? (isC ? 12 : 7),
        dps: msg.z.dps ?? (isC ? 18 : 6),
        until: now + msg.z.dur,
        nextTick: now + 250,
        final: isC ? { dmg: msg.z.finalDmg ?? 80, r: 4.5 } : undefined,
      });
    } else if (msg.t === 'runreq') this.onRunRequest(from, msg.a, msg.w);
  }

  private applyHits(from: string, hits: Hit[]) {
    if (!this.sim) return;
    const now = performance.now();
    for (const h of hits) for (const ev of this.sim.applyHit(from, h, now)) emitCombat(ev);
  }

  private onRunRequest(from: string, a: 'start' | 'leave' | 'abandon', w?: string) {
    const room = getRoom();
    if (!room) return;
    const run = room.roomState.run;
    if (a === 'start' && !run) {
      const seed = Math.floor(Math.random() * 2 ** 31);
      room.updateRoom((s) => {
        const grado = s.grado ?? 1;
        const next: RunState = {
          id: s.v + 1,
          seed,
          grado,
          mods: pickMods(grado, rng(seed ^ 0x5bd1e995)),
          phase: 'countdown',
          cleared: 1,
          fight: -1,
          wave: 0,
          wipes: 0,
        };
        // la Città Sommersa si apre dopo la prima Frattura richiusa
        if (w === SOMMERSA && sommersaOpen(s.gstats ?? { fratture: 0 })) next.world = SOMMERSA;
        return { ...s, run: next };
      });
    } else if (run && ((a === 'leave' && run.phase === 'complete') || (a === 'abandon' && from === room.self.id))) {
      room.updateRoom((s) => ({ ...s, run: null }));
    }
  }

  private players(): PlayerView[] {
    const room = getRoom()!;
    const out: PlayerView[] = [
      { id: room.self.id, x: combat.selfPos.x, z: combat.selfPos.z, alive: combat.alive, hidden: (combat.flags(performance.now()) & VF.veil) !== 0 },
    ];
    for (const id of room.others) {
      const v = room.vitals.get(id);
      if (!v) continue;
      out.push({ id, x: v.p[0], z: v.p[2], alive: (v.f & (VF.down | VF.dead)) === 0, hidden: (v.f & VF.veil) !== 0 });
    }
    return out;
  }

  private updateRun(patch: Partial<RunState>) {
    getRoom()?.updateRoom((s) => (s.run ? { ...s, run: { ...s.run, ...patch } } : s));
  }

  private tick() {
    const room = getRoom();
    const now = performance.now();
    const dtMs = this.last ? now - this.last : TICK_MS;
    this.last = now;
    if (!room || !room.isHost) {
      combat.hitSink = null;
      this.sim = null;
      this.runId = -1;
      return;
    }
    combat.hitSink = (from, hits) => this.applyHits(from, hits);
    const run = room.roomState.run;
    if (!run) {
      this.sim = null;
      this.runId = -1;
      return;
    }

    if (run.phase === 'countdown') {
      if (this.countdownFor !== run.id) {
        this.countdownFor = run.id;
        this.countdownEnd = now + COUNTDOWN_MS;
      }
      if (now >= this.countdownEnd) this.updateRun({ phase: 'active' });
      return;
    }

    const players = this.players();
    if (!this.sim || this.runId !== run.id) {
      this.dungeon = generateDungeon(run.seed, run.grado);
      this.sim = new EnemySim(this.dungeon, scaling(run.grado, room.admittedIds.length, run.mods), run.mods);
      this.runId = run.id;
      // nuovo host a metà Frattura: riprende i nemici che vedeva
      for (const v of combat.enemies.values()) {
        const ri = Math.max(1, roomAt(this.dungeon, v.x, v.z));
        this.sim.adopt(v.id, v.type, run.fight >= 0 ? run.fight : ri, v.x, v.z, v.hp, v.maxHp, now);
      }
      this.nextWaveAt = 0;
      this.wipeAt = 0;
    }

    if (run.phase === 'active') this.progress(run, players, now);

    for (const ev of this.sim.step(dtMs, now, players)) emitCombat(ev);

    if (now - this.lastSnap >= 1000 / SNAP_HZ && this.sim.enemies.size) {
      this.lastSnap = now;
      const rows: number[][] = [];
      for (const e of this.sim.enemies.values()) {
        rows.push([e.id, ENEMY_TYPES.indexOf(e.type), r2(e.x), r2(e.z), r2(e.yaw), Math.ceil(e.hp), e.maxHp, this.sim.flags(e, now)]);
      }
      emitCombat({ t: 'en', ts: now, e: rows }, { unreliable: true });
    }
  }

  private wavesFor(roomIndex: number, grado: number): number {
    return this.dungeon!.rooms[roomIndex].kind === 'boss' ? 1 : grado >= 3 ? 2 : 1;
  }

  private spawnWave(run: RunState, roomIndex: number, wave: number, playerCount: number, now: number) {
    const rand = rng(run.seed + roomIndex * 977 + wave * 131 + run.wipes * 7919);
    this.sim!.spawnWave(roomIndex, wave, playerCount, run.grado, rand, now);
  }

  private progress(run: RunState, players: PlayerView[], now: number) {
    const sim = this.sim!;
    const d = this.dungeon!;
    const room = getRoom()!;

    if (run.fight < 0) {
      const idx = run.cleared;
      if (idx >= d.rooms.length) return;
      const target = d.rooms[idx];
      if (players.some((p) => p.alive && inRect(target.rect, p.x, p.z, 1.2))) {
        this.spawnWave(run, idx, 0, room.admittedIds.length, now);
        this.updateRun({ fight: idx, wave: 0 });
      }
      return;
    }

    // sconfitta di gruppo: tutti a terra
    if (players.length && players.every((p) => !p.alive)) {
      if (!this.wipeAt) this.wipeAt = now + 1500;
      else if (now >= this.wipeAt) {
        this.wipeAt = 0;
        sim.clear();
        this.updateRun({ fight: -1, wave: 0, wipes: run.wipes + 1 });
      }
      return;
    }
    this.wipeAt = 0;

    if (sim.aliveIn(run.fight) > 0) return;
    if (run.wave + 1 < this.wavesFor(run.fight, run.grado)) {
      if (!this.nextWaveAt) this.nextWaveAt = now + 1500;
      else if (now >= this.nextWaveAt) {
        this.nextWaveAt = 0;
        this.spawnWave(run, run.fight, run.wave + 1, room.admittedIds.length, now);
        this.updateRun({ wave: run.wave + 1 });
      }
      return;
    }
    // stanza ripulita: bottino per ognuno, deciso dall'host
    const last = run.fight === d.rooms.length - 1;
    for (const id of room.admittedIds) {
      const items = last
        ? [generateItem(Math.random, run.grado, 2), generateItem(Math.random, run.grado)]
        : [generateItem(Math.random, run.grado)];
      emitCombat({ t: 'loot', items, frags: last ? FRAGMENTS.boss(run.grado) : FRAGMENTS.room(run.grado) }, { to: id });
    }
    room.updateRoom((s) => {
      if (!s.run) return s;
      return {
        ...s,
        run: { ...s.run, cleared: run.fight + 1, fight: -1, wave: 0, phase: last ? 'complete' : 'active' },
        grado: last ? run.grado + 1 : s.grado,
        best: last ? Math.max(s.best ?? 0, run.grado) : s.best,
      };
    });
  }
}

export const director = new HostDirector();
