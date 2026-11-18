// Simulazione dei nemici. Gira SOLO sul dispositivo dell'host (come da
// documento di design: "il suo dispositivo calcola i nemici e il bottino").
// Gli altri ricevono istantanee ~12 volte al secondo e gli attacchi come
// eventi con un preavviso: ognuno controlla da sé se il colpo lo prende
// (così una schivata fatta in tempo vale sempre, anche con un po' di ritardo).

import { ENEMIES, EF, VEILED_DMG_TAKEN, AB, WAVE_POOLS, isBoss, type EnemyType, type ModId, type Scaling } from './defs';
import { spawnPoints, type Dungeon } from './dungeon';

export interface PlayerView {
  id: string;
  x: number;
  z: number;
  /** In piedi (non a terra né fuori gioco). */
  alive: boolean;
  /** Invisibile (Velo) o intoccabile: i nemici lo ignorano. */
  hidden: boolean;
}

export interface SimZone {
  id: string;
  kind: 'trappola' | 'collasso';
  x: number;
  z: number;
  r: number;
  pull: number;
  dps: number;
  until: number;
  final?: { dmg: number; r: number };
  nextTick: number;
}

export interface Enemy {
  id: number;
  type: EnemyType;
  room: number;
  x: number;
  z: number;
  yaw: number;
  vx: number;
  vz: number;
  hp: number;
  maxHp: number;
  ai: 'chase' | 'windup' | 'recover';
  t: number;
  nextAttack: number;
  /** Attacco in preparazione: si ricorda la forma decisa all'inizio del preavviso. */
  atk: { k: AttackKind; x: number; z: number; r: number; leap?: { fx: number; fz: number } } | null;
  target: string | null;
  stunUntil: number;
  /** barcolla dopo un colpo: per un attimo quasi non avanza */
  staggerUntil: number;
  tauntBy: string | null;
  tauntUntil: number;
  markUntil: number;
  revealedUntil: number;
  veiled: boolean;
  pulled: boolean;
  /** Campione: più grosso, più forte, lascia un oggetto migliore */
  elite?: boolean;
  boss?: { nextNova: number; summoned: number; enraged: boolean; nextLeap: number };
  /** non prende danni fino a questo momento (il boss mentre cambia fase) */
  invulnUntil?: number;
}

export type AttackKind = 'cone' | 'circle' | 'shot' | 'nova';

export type SimEvent =
  /** Inizio di un attacco: i client mostrano il preavviso e, per cone/circle, applicano il danno dopo `d` ms. */
  | { t: 'ea'; id: number; k: AttackKind; x: number; z: number; r: number; rad: number; arc: number; d: number; dmg: number }
  /** Proiettili sparati: un angolo per proiettile. */
  | { t: 'epj'; id: number; x: number; z: number; dirs: number[]; spd: number; dmg: number }
  | { t: 'ecancel'; id: number }
  | { t: 'edie'; id: number; x: number; z: number; type: EnemyType };

export interface Hit {
  /** id del nemico */
  e: number;
  /** danno */
  d: number;
  /** stordimento (ms) */
  st?: number;
  /** provocazione (ms): il nemico punta chi l'ha colpito */
  tn?: number;
  /** marchio della Rivelazione (ms): rivela i velati e aumenta i danni subiti */
  mk?: number;
  /** esecuzione: uccide se il nemico è debole */
  x?: boolean;
  /** spinta [dx, dz] */
  kb?: [number, number];
  /** barcollamento più lungo (ms), dal potere Tocco gelido */
  sg?: number;
}

export const EXECUTE_THRESHOLD = 0.35;

/** Boss: il balzo con onda d'urto e la seconda fase (a metà vita). */
export const BOSS = {
  firstLeap: 7000,
  leapEvery: 9000,
  /** durata del volo (ms): è anche il preavviso a terra */
  leapMs: 1150,
  leapRadius: 3.6,
  shockRadius: 6.5,
  /** l'onda d'urto arriva poco dopo l'atterraggio */
  shockDelay: 480,
  phaseInvuln: 1500,
  phaseWindup: 1300,
  phaseRadius: 7.5,
};

/** Il Campione: quanta vita, danni e velocità in più, e quanti nemici normali sostituisce. */
export const ELITE = { hp: 3.5, dmg: 1.35, speed: 1.1, budget: 3 };
const eliteDmg = (e: Enemy) => (e.elite ? ELITE.dmg : 1);

/** Il Campione è uno dei nemici "grossi" del mondo (mai lo Sciame). */
function championType(pool: EnemyType[]): EnemyType {
  for (const t of ['bruto', 'annegato', 'riflesso', 'ombra'] as EnemyType[]) if (pool.includes(t)) return t;
  return pool.find((t) => t !== 'sciame') ?? 'ombra';
}
const BOSS_NOVA_EVERY = 6500;
const NOVA_COUNT = 12;

export class EnemySim {
  enemies = new Map<number, Enemy>();
  zones: SimZone[] = [];
  private nextId = 1;

  /** Boss in fondo e nemici delle ondate (la Città Sommersa ha i suoi). */
  boss: EnemyType = 'eco';
  pool: EnemyType[] = WAVE_POOLS.frattura;

  constructor(
    public dungeon: Dungeon,
    public scale: Scaling,
    public mods: ModId[],
    opts: { boss?: EnemyType; pool?: EnemyType[] } = {},
  ) {
    if (opts.boss) this.boss = opts.boss;
    if (opts.pool) this.pool = opts.pool;
  }

  spawn(type: EnemyType, room: number, x: number, z: number, now: number): Enemy {
    const def = ENEMIES[type];
    const veiled = type === 'velato';
    const maxHp = Math.round(def.hp * this.scale.hp);
    const e: Enemy = {
      id: this.nextId++,
      type,
      room,
      x,
      z,
      yaw: 0,
      vx: 0,
      vz: 0,
      hp: maxHp,
      maxHp,
      ai: 'chase',
      t: 0,
      // un attimo di respiro prima del primo colpo
      nextAttack: now + 900 + Math.random() * 700,
      atk: null,
      target: null,
      stunUntil: 0,
      staggerUntil: 0,
      tauntBy: null,
      tauntUntil: 0,
      markUntil: 0,
      revealedUntil: 0,
      veiled,
      pulled: false,
    };
    if (isBoss(type)) e.boss = { nextNova: now + 4000, summoned: 0, enraged: false, nextLeap: now + BOSS.firstLeap };
    this.enemies.set(e.id, e);
    return e;
  }

  /** Riprende un nemico già esistente (nuovo host a metà partita), mantenendo il suo id. */
  adopt(id: number, type: EnemyType, room: number, x: number, z: number, hp: number, maxHp: number, now: number): Enemy {
    const e = this.spawn(type, room, x, z, now);
    this.enemies.delete(e.id);
    e.id = id;
    e.hp = hp;
    e.maxHp = maxHp;
    this.enemies.set(id, e);
    this.nextId = Math.max(this.nextId, id + 1);
    return e;
  }

  /** Crea un'ondata: il "budget" sale con giocatori, Grado e profondità della stanza. */
  spawnWave(room: number, wave: number, players: number, grado: number, rand: () => number, now: number, focus?: Focus): Enemy[] {
    const r = this.dungeon.rooms[room];
    if (r.kind === 'boss') {
      const boss = this.spawn(this.boss, room, r.cx, r.rect.z0 + 7, now);
      return [boss];
    }
    if (r.variant === 'tesoro') return [];
    // nella stanza del Campione: meno nemici, più lui (solo nella prima ondata)
    const champion = r.variant === 'campione' && wave === 0;
    const budget = 6 + 2 * (players - 1) + (grado - 1) + room + wave - (champion ? ELITE.budget : 0);
    const types = composeWave(Math.max(2, budget), rand, this.mods, focus, this.pool);
    const pts = spawnPoints(this.dungeon, room, types.length + (champion ? 1 : 0), rand);
    const out = types.map((t, i) => this.spawn(t, room, pts[i][0], pts[i][1], now));
    if (champion) {
      const p = pts[types.length];
      const e = this.spawn(championType(this.pool), room, p[0], p[1], now);
      e.elite = true;
      e.maxHp = e.hp = Math.round(e.hp * ELITE.hp * (1 + 0.25 * (players - 1)));
      out.push(e);
    }
    return out;
  }

  aliveIn(room: number): number {
    let n = 0;
    for (const e of this.enemies.values()) if (e.room === room) n++;
    return n;
  }

  clear() {
    this.enemies.clear();
    this.zones = [];
  }

  addZone(z: SimZone) {
    this.zones = this.zones.filter((o) => o.id !== z.id);
    this.zones.push(z);
  }

  flags(e: Enemy, now: number): number {
    let f = 0;
    if (now < e.stunUntil) f |= EF.stun;
    if (e.tauntBy && now < e.tauntUntil) f |= EF.taunt;
    if (now < e.markUntil) f |= EF.mark;
    if (e.veiled && now >= e.revealedUntil) f |= EF.veiled;
    if (e.boss?.enraged) f |= EF.enraged;
    if (e.pulled) f |= EF.pulled;
    if (e.ai === 'windup' && e.atk?.leap) f |= EF.leap;
    if (e.elite) f |= EF.elite;
    return f;
  }

  applyHit(from: string, h: Hit, now: number): SimEvent[] {
    const e = this.enemies.get(h.e);
    if (!e) return [];
    const ev: SimEvent[] = [];
    if (h.mk) {
      e.markUntil = Math.max(e.markUntil, now + h.mk);
      e.revealedUntil = Math.max(e.revealedUntil, now + h.mk);
    }
    let dmg = Math.max(0, h.d);
    // il boss che cambia fase non prende danni (il ruggito)
    if (e.invulnUntil && now < e.invulnUntil) dmg = 0;
    if (e.veiled && now >= e.revealedUntil) dmg *= VEILED_DMG_TAKEN;
    if (now < e.markUntil) dmg *= AB.rivelazione.dmgTaken;
    if (h.x && e.hp / e.maxHp <= EXECUTE_THRESHOLD) dmg = e.hp;
    e.hp -= dmg;
    if (h.tn) {
      e.tauntBy = from;
      e.tauntUntil = now + h.tn;
    }
    const boss = isBoss(e.type);
    if (h.kb) {
      // i boss e il Bruto quasi non si spostano
      const k = boss ? 0.12 : e.elite ? 0.3 : e.type === 'bruto' ? 0.45 : 1;
      e.vx += h.kb[0] * k;
      e.vz += h.kb[1] * k;
    }
    // ogni colpo fa barcollare un attimo (meno i grossi, quasi niente i boss)
    if (dmg > 0) {
      const base = boss ? 40 : e.elite || e.type === 'bruto' ? 90 : 170;
      const extra = h.sg ? Math.min(1500, h.sg) * (boss ? 0.2 : e.elite ? 0.5 : 1) : 0;
      e.staggerUntil = Math.max(e.staggerUntil, now + Math.max(base, extra));
    }
    if (h.st && !isBoss(e.type)) {
      e.stunUntil = Math.max(e.stunUntil, now + h.st);
    } else if (h.st) {
      // il boss resiste: stordimento ridotto
      e.stunUntil = Math.max(e.stunUntil, now + h.st * 0.35);
    }
    if (h.st && e.ai === 'windup') {
      e.ai = 'chase';
      e.atk = null;
      e.nextAttack = now + 600;
      ev.push({ t: 'ecancel', id: e.id });
    }
    if (e.hp <= 0) {
      this.enemies.delete(e.id);
      ev.push({ t: 'edie', id: e.id, x: e.x, z: e.z, type: e.type });
    }
    return ev;
  }

  step(dtMs: number, now: number, players: PlayerView[]): SimEvent[] {
    const dt = Math.min(dtMs, 100) / 1000;
    const ev: SimEvent[] = [];
    const targets = players.filter((p) => p.alive && !p.hidden);

    // zone del Tessitore: risucchio e danni periodici
    for (const z of this.zones) {
      if (now >= z.nextTick) {
        z.nextTick = now + 500;
        for (const e of [...this.enemies.values()]) {
          if (Math.hypot(e.x - z.x, e.z - z.z) <= z.r) ev.push(...this.applyHit('', { e: e.id, d: z.dps * 0.5 }, now));
        }
      }
    }
    const ending = this.zones.filter((z) => now >= z.until);
    for (const z of ending) {
      if (z.final) {
        for (const e of [...this.enemies.values()]) {
          if (Math.hypot(e.x - z.x, e.z - z.z) <= z.final.r) ev.push(...this.applyHit('', { e: e.id, d: z.final.dmg }, now));
        }
      }
    }
    this.zones = this.zones.filter((z) => now < z.until);

    for (const e of [...this.enemies.values()]) {
      const def = ENEMIES[e.type];
      const stunned = now < e.stunUntil;
      const speedMul = this.scale.speed * (e.boss?.enraged ? 1.35 : 1) * (e.elite ? ELITE.speed : 1);
      let wantX = 0;
      let wantZ = 0;

      // bersaglio: chi provoca, altrimenti il più vicino
      const taunter = e.tauntBy && now < e.tauntUntil ? targets.find((p) => p.id === e.tauntBy) : undefined;
      let target = taunter;
      if (!target) {
        let best = Infinity;
        for (const p of targets) {
          const d = Math.hypot(p.x - e.x, p.z - e.z);
          if (d < best) {
            best = d;
            target = p;
          }
        }
      }
      e.target = target?.id ?? null;

      if (stunned && !e.atk?.leap) {
        if (e.ai === 'windup') {
          e.ai = 'chase';
          e.atk = null;
          ev.push({ t: 'ecancel', id: e.id });
        }
      } else if (e.ai === 'windup') {
        if (now >= e.t) {
          const atk = e.atk;
          if (atk && (atk.k === 'shot' || atk.k === 'nova')) {
            const dirs =
              atk.k === 'nova'
                ? Array.from({ length: NOVA_COUNT }, (_, i) => (i / NOVA_COUNT) * Math.PI * 2 + (now % 1000) / 1000)
                : [this.aimAt(e, target)];
            ev.push({ t: 'epj', id: e.id, x: e.x, z: e.z, dirs, spd: def.projSpeed ?? 10, dmg: Math.round(def.dmg * this.scale.dmg * eliteDmg(e) * (atk.k === 'nova' ? 0.55 : 1)) });
          }
          // l'Anguilla scatta in avanti lungo la linea del preavviso
          if (def.lunge && atk?.k === 'cone') {
            e.x += Math.sin(atk.r) * def.lunge;
            e.z += Math.cos(atk.r) * def.lunge;
            e.vx = e.vz = 0;
          }
          // atterraggio del balzo: è arrivato, e dall'impatto parte l'onda d'urto
          if (atk?.leap) {
            e.x = atk.x;
            e.z = atk.z;
            e.vx = e.vz = 0;
            this.confine(e);
            ev.push({ t: 'ea', id: e.id, k: 'circle', x: round(e.x), z: round(e.z), r: 0, rad: BOSS.shockRadius, arc: 0, d: BOSS.shockDelay, dmg: Math.round(def.dmg * this.scale.dmg * 0.55) });
          }
          e.ai = 'recover';
          e.atk = null;
          e.t = now + def.recover * 1000 * this.scale.recover;
        }
      } else if (e.ai === 'recover') {
        if (now >= e.t) e.ai = 'chase';
      } else if (target) {
        const dx = target.x - e.x;
        const dz = target.z - e.z;
        const dist = Math.hypot(dx, dz) || 0.001;
        const ux = dx / dist;
        const uz = dz / dist;
        if (def.attack === 'shot') {
          const keep = def.keepAway ?? 9;
          if (dist > keep + 1.5) [wantX, wantZ] = [ux, uz];
          else if (dist < keep - 2) [wantX, wantZ] = [-ux, -uz];
          else [wantX, wantZ] = [-uz * 0.4, ux * 0.4];
        } else if (dist > def.range * 0.8) {
          [wantX, wantZ] = [ux, uz];
        }
        e.yaw = Math.atan2(ux, uz);

        if (now >= e.nextAttack) {
          let windupMs = def.windup * 1000 * (e.boss?.enraged ? 0.8 : 1);
          let atk: Enemy['atk'] = null;
          let rad = def.hitRadius;
          let arc = def.hitArc;
          let dmgMul = 1;
          if (e.boss) {
            if (target && now >= e.boss.nextLeap && dist > 3.5) {
              // balzo: vola sul bersaglio e atterra con un'onda d'urto
              e.boss.nextLeap = now + BOSS.leapEvery * (e.boss.enraged ? 0.65 : 1);
              atk = { k: 'circle', x: target.x, z: target.z, r: e.yaw, leap: { fx: e.x, fz: e.z } };
              rad = BOSS.leapRadius;
              arc = 0;
              windupMs = BOSS.leapMs;
              dmgMul = 1.3;
            } else if (now >= e.boss.nextNova) {
              e.boss.nextNova = now + BOSS_NOVA_EVERY * (e.boss.enraged ? 0.75 : 1);
              atk = { k: 'nova', x: e.x, z: e.z, r: e.yaw };
              rad = 1.5;
              arc = 0;
            } else if (dist <= def.range) {
              atk = { k: 'cone', x: e.x, z: e.z, r: e.yaw };
            }
          } else if (dist <= def.range) {
            if (def.attack === 'melee') atk = { k: 'cone', x: e.x, z: e.z, r: e.yaw };
            else if (def.attack === 'slam') atk = { k: 'circle', x: e.x + ux * 1.4, z: e.z + uz * 1.4, r: e.yaw };
            else if (def.attack === 'shot') {
              atk = { k: 'shot', x: e.x, z: e.z, r: e.yaw };
              rad = 0.6;
            }
          }
          if (atk) {
            e.ai = 'windup';
            e.atk = atk;
            e.t = now + windupMs;
            e.nextAttack = now + windupMs + def.recover * 1000 * this.scale.recover + (def.attack === 'shot' ? 600 : 0) + (atk.leap ? BOSS.shockDelay : 0);
            wantX = wantZ = 0;
            ev.push({
              t: 'ea',
              id: e.id,
              k: atk.k,
              x: round(atk.x),
              z: round(atk.z),
              r: round(atk.r),
              rad,
              arc,
              d: Math.round(windupMs),
              dmg: Math.round(def.dmg * this.scale.dmg * eliteDmg(e) * dmgMul),
            });
          }
        }
      }

      // risucchio delle zone
      e.pulled = false;
      for (const z of this.zones) {
        const dx = z.x - e.x;
        const dz = z.z - e.z;
        const d = Math.hypot(dx, dz);
        if (d < z.r && d > 0.3) {
          const k = (z.pull * (isBoss(e.type) ? 0.25 : 1)) / d;
          e.vx += dx * k * dt;
          e.vz += dz * k * dt;
          e.pulled = true;
        }
      }

      // movimento
      const sp = stunned || e.ai !== 'chase' ? 0 : def.speed * speedMul * (now < e.staggerUntil ? 0.15 : 1);
      const a = 1 - Math.exp(-8 * dt);
      e.vx += (wantX * sp - e.vx) * a;
      e.vz += (wantZ * sp - e.vz) * a;
      // separazione
      for (const o of this.enemies.values()) {
        if (o === e) continue;
        const dx = e.x - o.x;
        const dz = e.z - o.z;
        const d = Math.hypot(dx, dz);
        const min = def.radius + ENEMIES[o.type].radius + 0.2;
        if (d < min && d > 0.001) {
          const push = ((min - d) / d) * 4;
          e.vx += dx * push * dt;
          e.vz += dz * push * dt;
        }
      }
      e.x += e.vx * dt;
      e.z += e.vz * dt;
      this.confine(e);
      // in volo verso il punto del balzo
      if (e.ai === 'windup' && e.atk?.leap) {
        const k = Math.min(1, Math.max(0, 1 - (e.t - now) / BOSS.leapMs));
        const s = k * k * (3 - 2 * k);
        e.x = e.atk.leap.fx + (e.atk.x - e.atk.leap.fx) * s;
        e.z = e.atk.leap.fz + (e.atk.z - e.atk.leap.fz) * s;
        e.vx = e.vz = 0;
      }

      // il boss chiama rinforzi e si infuria
      if (e.boss) {
        const frac = e.hp / e.maxHp;
        if (!e.boss.enraged && frac <= 0.5) {
          // seconda fase: ruggisce (per un attimo non prende danni) e un'onda d'urto attorno
          e.boss.enraged = true;
          e.invulnUntil = now + BOSS.phaseInvuln;
          e.ai = 'windup';
          e.atk = { k: 'circle', x: e.x, z: e.z, r: e.yaw };
          e.t = now + BOSS.phaseWindup;
          e.nextAttack = e.t + 900;
          e.boss.nextLeap = now + BOSS.phaseWindup + 2500;
          ev.push({ t: 'ea', id: e.id, k: 'circle', x: round(e.x), z: round(e.z), r: 0, rad: BOSS.phaseRadius, arc: 0, d: BOSS.phaseWindup, dmg: Math.round(ENEMIES[e.type].dmg * this.scale.dmg * 1.2) });
        }
        const thresholds = [0.7, 0.35];
        if (e.boss.summoned < thresholds.length && frac <= thresholds[e.boss.summoned]) {
          e.boss.summoned++;
          const room = this.dungeon.rooms[e.room];
          const helpers: [EnemyType, number][] =
            e.type === 'campana'
              ? [
                  ['annegato', -3],
                  ['annegato', 3],
                  ['anguilla', 0],
                ]
              : [
                  ['ombra', -3],
                  ['ombra', 3],
                  ['sciame', 0],
                ];
          for (const [t, ox] of helpers) {
            this.spawn(t, e.room, clamp(e.x + ox, room.rect.x0 + 2, room.rect.x1 - 2), clamp(e.z - 2, room.rect.z0 + 2, room.rect.z1 - 2), now);
          }
        }
      }
    }
    return ev;
  }

  private aimAt(e: Enemy, target: PlayerView | undefined): number {
    if (!target) return e.yaw;
    return Math.atan2(target.x - e.x, target.z - e.z);
  }

  /** Tiene il nemico nella sua stanza e fuori dalle colonne. */
  private confine(e: Enemy) {
    const room = this.dungeon.rooms[e.room];
    const r = ENEMIES[e.type].radius;
    for (const p of room.pillars) {
      const dx = e.x - p.x;
      const dz = e.z - p.z;
      const d = Math.hypot(dx, dz);
      const min = p.r + r;
      if (d < min) {
        const k = d > 0.001 ? min / d : 1;
        e.x = p.x + dx * k + (d > 0.001 ? 0 : min);
        e.z = p.z + dz * k;
      }
    }
    e.x = clamp(e.x, room.rect.x0 + r + 0.3, room.rect.x1 - r - 0.3);
    e.z = clamp(e.z, room.rect.z0 + r + 0.3, room.rect.z1 - r - 0.3);
  }
}

/**
 * Nemico preferito da una missione: `min` compaiono di sicuro nell'ondata,
 * poi ogni scelta diventa quel nemico con probabilità `share`.
 */
export interface Focus {
  type: EnemyType;
  min: number;
  share: number;
}

/** Sceglie i tipi di nemici di un'ondata spendendo un "budget". */
export function composeWave(budget: number, rand: () => number, mods: ModId[], focus?: Focus, pool: EnemyType[] = WAVE_POOLS.frattura): EnemyType[] {
  const out: EnemyType[] = [];
  let left = budget;
  let guard = 0;
  if (focus) {
    for (let i = 0; i < Math.min(focus.min, 8); i++) {
      out.push(focus.type);
      left -= ENEMIES[focus.type].cost;
    }
  }
  while (left > 0 && out.length < 12 && guard++ < 100) {
    let t = pool[Math.floor(rand() * pool.length)];
    if (focus && rand() < focus.share) t = focus.type;
    if (t === 'ombra' && mods.includes('velati') && rand() < 0.5) t = 'velato';
    const cost = ENEMIES[t].cost;
    if (cost > left) {
      if (left >= 1) {
        out.push('sciame');
        left -= 1;
      }
      continue;
    }
    out.push(t);
    left -= cost;
  }
  return out;
}

const round = (n: number) => Math.round(n * 100) / 100;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
