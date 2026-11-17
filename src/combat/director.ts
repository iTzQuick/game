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
import { EnemySim, type Focus, type Hit, type PlayerView } from './sim';
import { FRAGMENTS, RARITIES, generateItem, missionReward, type Item } from '../progress/defs';
import { groupKeeper } from '../progress/group';
import { displayName } from '../game/store';
import { difficolta, missioneCompiuta } from '../narrator/core';

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
    } else if (msg.t === 'runreq') this.onRunRequest(from, msg.a, msg.m);
    else if (msg.t === 'edie' || msg.t === 'mfail') this.missionEvent(msg);
  }

  /** Avanzamento della missione: nemici giusti sconfitti, regole infrante. */
  private missionEvent(msg: CombatMsg) {
    const run = getRoom()?.roomState.run;
    const m = run?.missione;
    if (!run || !m || m.esito || run.phase !== 'active') return;
    if (msg.t === 'edie' && m.obiettivo.tipo === 'sconfiggi' && msg.type === m.obiettivo.nemico) {
      this.updateRun({ missione: { ...m, conta: m.conta + 1 } });
    } else if (msg.t === 'mfail' && msg.k === 'pozione' && m.obiettivo.tipo === 'senza_pozioni' && !m.fallita) {
      this.updateRun({ missione: { ...m, fallita: true } });
    }
  }

  private applyHits(from: string, hits: Hit[]) {
    if (!this.sim) return;
    const now = performance.now();
    for (const h of hits) for (const ev of this.sim.applyHit(from, h, now)) emitCombat(ev);
  }

  private onRunRequest(from: string, a: 'start' | 'leave' | 'abandon', missionId?: string) {
    const room = getRoom();
    if (!room) return;
    const run = room.roomState.run;
    if (a === 'start' && !run) {
      const seed = Math.floor(Math.random() * 2 ** 31);
      room.updateRoom((s) => {
        const grado = s.grado ?? 1;
        // una missione del giorno non ancora compiuta, oppure una Frattura normale
        const m = missionId && !s.fatte?.includes(missionId) ? s.narrazione?.missioni.find((x) => x.id === missionId) : undefined;
        if (missionId && !m) return s;
        const next: RunState = {
          id: s.v + 1,
          seed,
          grado,
          mods: m ? [...m.modificatori] : pickMods(grado, rng(seed ^ 0x5bd1e995)),
          phase: 'countdown',
          cleared: 1,
          fight: -1,
          wave: 0,
          wipes: 0,
          missione: m ? { id: m.id, titolo: m.titolo, obiettivo: m.obiettivo, nemico: m.nemico, conta: 0, fallita: false, inizio: 0 } : null,
        };
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
      if (now >= this.countdownEnd) {
        this.updateRun(run.missione ? { phase: 'active', missione: { ...run.missione, inizio: Date.now() } } : { phase: 'active' });
      }
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
    this.sim!.spawnWave(roomIndex, wave, playerCount, run.grado, rand, now, this.focus(run, roomIndex, wave));
  }

  /** Il nemico della missione: abbastanza da poter compiere l'obiettivo "sconfiggi". */
  private focus(run: RunState, roomIndex: number, wave: number): Focus | undefined {
    const m = run.missione;
    if (!m || !this.dungeon) return undefined;
    if (m.obiettivo.tipo === 'sconfiggi') {
      const need = m.obiettivo.quanti - m.conta;
      let wavesLeft = -wave;
      for (let r = roomIndex; r < this.dungeon.rooms.length; r++) {
        if (this.dungeon.rooms[r].kind === 'combat') wavesLeft += this.wavesFor(r, run.grado);
      }
      return { type: m.obiettivo.nemico, min: need > 0 ? Math.ceil(need / Math.max(1, wavesLeft)) : 0, share: 0.25 };
    }
    return m.nemico ? { type: m.nemico, min: 1, share: 0.3 } : undefined;
  }

  private progress(run: RunState, players: PlayerView[], now: number) {
    const sim = this.sim!;
    const d = this.dungeon!;
    const room = getRoom()!;

    // missione "nessuno cade": basta un giocatore a terra
    const mis = run.missione;
    if (mis && !mis.fallita && mis.obiettivo.tipo === 'nessuno_cade' && players.some((p) => !p.alive)) {
      this.updateRun({ missione: { ...mis, fallita: true } });
    }

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
      noteRareLoot(id, items);
    }
    // missione del giorno: si decide quando l'Eco cade
    const cur = room.roomState.run?.missione;
    const esito: 'compiuta' | 'fallita' | undefined = last && cur ? (missioneCompiuta(cur, Date.now()) ? 'compiuta' : 'fallita') : undefined;
    if (esito === 'compiuta' && cur) {
      const reward = missionReward(difficolta({ obiettivo: cur.obiettivo, modificatori: run.mods }), run.grado);
      for (const id of room.admittedIds) {
        const items = reward.minRarity === null ? [] : [generateItem(Math.random, run.grado, reward.minRarity)];
        emitCombat({ t: 'loot', items, frags: reward.frags, why: cur.titolo }, { to: id });
        noteRareLoot(id, items);
      }
    }
    room.updateRoom((s) => {
      if (!s.run) return s;
      const missione = s.run.missione && esito ? { ...s.run.missione, esito } : s.run.missione;
      return {
        ...s,
        run: { ...s.run, cleared: run.fight + 1, fight: -1, wave: 0, phase: last ? 'complete' : 'active', missione },
        grado: last ? run.grado + 1 : s.grado,
        best: last ? Math.max(s.best ?? 0, run.grado) : s.best,
      };
    });
  }
}

/** I bottini leggendari (e oltre) finiscono nel diario della compagnia. */
function noteRareLoot(playerId: string, items: Item[]) {
  for (const it of items) {
    if (it.rarity >= 3) groupKeeper.note(`${displayName(playerId)} ha trovato un oggetto ${RARITIES[it.rarity].name.toLowerCase()}: ${it.name}.`);
  }
}

export const director = new HostDirector();
