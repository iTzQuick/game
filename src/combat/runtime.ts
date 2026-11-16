// Stato del combattimento su questo dispositivo: i nemici come li vediamo
// (interpolati), i preavvisi dei loro attacchi, i proiettili, le zone delle
// abilità e la NOSTRA vita. Ognuno è padrone della propria vita: i danni che
// ci arrivano li calcoliamo qui, contro la nostra posizione vera.

import { NET } from '../game/constants';
import { getGame, setGame, toast } from '../game/store';
import { SnapshotBuffer } from '../net/interpolation';
import { getRoom } from '../net/room';
import {
  AB,
  DOWN_SECONDS,
  EF,
  ENEMIES,
  ENEMY_TYPES,
  REVIVE_HP,
  REVIVE_RADIUS,
  REVIVE_SECONDS,
  ULTRA_GAIN,
  ULTRA_MAX,
  type EnemyType,
} from './defs';
import { walkable, type Dungeon } from './dungeon';
import { VF, type CombatMsg, type ZoneSpec } from './protocol';
import type { Hit } from './sim';
import { emptyMods, type Mods } from '../progress/model';
import { POTION_HEAL } from '../progress/defs';

export interface EnemyView {
  id: number;
  type: EnemyType;
  hp: number;
  maxHp: number;
  flags: number;
  buf: SnapshotBuffer;
  lastSeen: number;
  x: number;
  z: number;
  yaw: number;
  ready: boolean;
  /** momento dell'ultimo colpo subito (per il lampo bianco) */
  flash: number;
  /** fine del preavviso in corso (il nemico "carica") */
  charging: number;
}

export interface Telegraph {
  id: number;
  k: 'cone' | 'circle' | 'shot' | 'nova';
  x: number;
  z: number;
  r: number;
  rad: number;
  arc: number;
  t0: number;
  t1: number;
  dmg: number;
  done: boolean;
}

export interface EProj {
  x: number;
  z: number;
  dx: number;
  dz: number;
  spd: number;
  dmg: number;
  born: number;
  src: number;
  reflectedBy: string | null;
  alive: boolean;
  inBarrier: boolean;
}

export interface PBolt {
  x: number;
  z: number;
  y: number;
  dx: number;
  dz: number;
  spd: number;
  dmg: number;
  born: number;
  life: number;
  mine: boolean;
  color: string;
  kind: 'basic' | 'dardo';
  bounces: number;
  hit: Set<number>;
  alive: boolean;
  portalCd: number;
  /** moltiplicatore di danno legato al colpo (Velo, Scatto, combo) */
  mul: number;
  crit: boolean;
}

export interface CZone extends ZoneSpec {
  born: number;
  until: number;
}

export interface DmgNum {
  id: number;
  x: number;
  y: number;
  z: number;
  v: number;
  kind: 'dmg' | 'crit' | 'heal' | 'me' | 'info';
  text?: string;
  t0: number;
}

export interface MyVitals {
  hp: number;
  maxHp: number;
  shield: number;
  shieldUntil: number;
  downAt: number;
  dead: boolean;
  revive: number;
  invulnUntil: number;
  bastionUntil: number;
  bastionAbsorbed: number;
  veilUntil: number;
  speedMul: number;
  speedUntil: number;
  guardUntil: number;
  ultra: number;
  cd: { Q: number; E: number; R: number };
  varcoCd: number;
  lastHurt: number;
  /** pozioni del Giardino per questa Frattura */
  potions: number;
}

const freshVitals = (maxHp: number): MyVitals => ({
  hp: maxHp,
  maxHp,
  shield: 0,
  shieldUntil: 0,
  downAt: 0,
  dead: false,
  revive: 0,
  invulnUntil: 0,
  bastionUntil: 0,
  bastionAbsorbed: 0,
  veilUntil: 0,
  speedMul: 1,
  speedUntil: 0,
  guardUntil: 0,
  ultra: 0,
  cd: { Q: 0, E: 0, R: 0 },
  varcoCd: 0,
  lastHurt: 0,
  potions: 0,
});

export interface TickCtx {
  x: number;
  y: number;
  z: number;
  inRun: boolean;
  teleport: (x: number, z: number) => void;
}

let numSeq = 0;

class CombatRuntime {
  enemies = new Map<number, EnemyView>();
  telegraphs: Telegraph[] = [];
  eprojs: EProj[] = [];
  bolts: PBolt[] = [];
  zones = new Map<string, CZone>();
  nums: DmgNum[] = [];
  me: MyVitals = freshVitals(100);
  dungeon: Dungeon | null = null;
  selfPos = { x: 0, y: 0, z: 0 };
  /** Dove si vedono i giocatori adesso (per raggi e bersagli delle abilità). */
  renderPos = new Map<string, { x: number; y: number; z: number }>();
  /** Dove vanno i colpi: l'host li applica direttamente, gli altri li spediscono. */
  hitSink: ((from: string, hits: Hit[]) => void) | null = null;
  private pendingHits: Hit[] = [];
  /** Richiamato quando passiamo da un Varco (per la combo della Lama). */
  onVarcoPass: ((z: CZone, fromA: boolean) => void) | null = null;
  /** Richiamato per gli effetti delle abilità degli altri. */
  onRemoteAbility: ((from: string, msg: Extract<CombatMsg, { t: 'ab' }>) => void) | null = null;

  get selfId() {
    return getGame().selfId;
  }

  get alive() {
    return !this.me.downAt && !this.me.dead;
  }

  noHeals() {
    return getGame().room.run?.mods.includes('senza-cure') ?? false;
  }

  /** Nuova vita piena (inizio Frattura, checkpoint, ritorno al Crocevia, cambio classe). */
  /** Bonus di talenti e oggetti del giocatore (li aggiorna LocalPlayer). */
  mods: Mods = emptyMods();

  resetVitals(maxHp: number, keepUltra = false) {
    const ultra = keepUltra ? this.me.ultra : 0;
    const cd = this.me.cd;
    this.me = freshVitals(maxHp);
    this.me.ultra = ultra;
    if (keepUltra) this.me.cd = cd;
  }

  clearWorld() {
    this.enemies.clear();
    this.telegraphs = [];
    this.eprojs = [];
    this.bolts = this.bolts.filter((b) => !b.alive);
    this.zones.clear();
  }

  flags(now: number): number {
    const m = this.me;
    let f = 0;
    if (m.downAt) f |= VF.down;
    if (m.dead) f |= VF.dead;
    if (now < m.veilUntil) f |= VF.veil;
    if (now < m.bastionUntil) f |= VF.bastion;
    if (m.shield > 0 && now < m.shieldUntil) f |= VF.shield;
    if (now < m.invulnUntil) f |= VF.invuln;
    return f;
  }

  addUltra(n: number) {
    this.me.ultra = Math.min(ULTRA_MAX, this.me.ultra + n * (1 + this.mods.ultraPct));
  }

  number(x: number, y: number, z: number, v: number, kind: DmgNum['kind'], text?: string) {
    this.nums.push({ id: ++numSeq, x, y, z, v: Math.round(v), kind, text, t0: performance.now() });
    if (this.nums.length > 40) this.nums.splice(0, this.nums.length - 40);
  }

  // --- danni e cure su di noi ------------------------------------------------

  damageMe(raw: number, now: number) {
    const m = this.me;
    if (!this.alive || raw <= 0) return;
    if (now < m.invulnUntil) return;
    if (now < m.bastionUntil) {
      m.bastionAbsorbed += raw;
      return;
    }
    let dmg = raw;
    if (this.insideBarrier(this.selfPos.x, this.selfPos.z)) dmg *= 1 - AB.barriera.reduction;
    if (now < m.guardUntil) dmg *= 1 - AB.provocazione.reduction;
    dmg *= 1 - this.mods.dmgReduction;
    if (m.shield > 0 && now < m.shieldUntil) {
      const absorbed = Math.min(m.shield, dmg);
      m.shield -= absorbed;
      dmg -= absorbed;
    }
    m.hp -= dmg;
    m.lastHurt = now;
    this.addUltra(raw * ULTRA_GAIN.taken);
    this.number(this.selfPos.x, this.selfPos.y + 2.2, this.selfPos.z, raw, 'me');
    if (m.hp <= 0) {
      m.hp = 0;
      m.downAt = now;
      m.revive = 0;
      m.veilUntil = 0;
      toast('Sei a terra! Un compagno può rialzarti stando vicino a te');
    }
  }

  healMe(amt: number) {
    const m = this.me;
    if (!this.alive || this.noHeals() || amt <= 0) return;
    const before = m.hp;
    m.hp = Math.min(m.maxHp, m.hp + amt);
    if (m.hp > before) this.number(this.selfPos.x, this.selfPos.y + 2.2, this.selfPos.z, m.hp - before, 'heal');
  }

  /** Pozione del Giardino: cura metà della vita. */
  drinkPotion(): boolean {
    const m = this.me;
    if (m.potions <= 0 || !this.alive || m.hp >= m.maxHp) return false;
    if (this.noHeals()) {
      toast('In questa Frattura le cure non funzionano');
      return false;
    }
    m.potions--;
    this.healMe(m.maxHp * POTION_HEAL);
    return true;
  }

  reviveMe(frac: number) {
    const m = this.me;
    if (this.alive) return;
    m.downAt = 0;
    m.dead = false;
    m.revive = 0;
    m.hp = Math.max(1, Math.round(m.maxHp * frac));
    m.invulnUntil = performance.now() + 1500;
  }

  insideBarrier(x: number, z: number): CZone | null {
    for (const zn of this.zones.values()) {
      if (zn.kind === 'barriera' && Math.hypot(x - zn.x, z - zn.z) <= zn.r) return zn;
    }
    return null;
  }

  // --- colpi ai nemici ---------------------------------------------------------

  /** `charge = false` per i colpi della Ultra stessa: non devono ricaricarla. */
  queueHit(h: Hit, charge = true) {
    this.pendingHits.push(h);
    const e = this.enemies.get(h.e);
    if (e && h.d > 0) {
      e.flash = performance.now();
      if (charge) this.addUltra(h.d * ULTRA_GAIN.dealt);
    }
  }

  flushHits() {
    if (!this.pendingHits.length) return;
    const hits = this.pendingHits;
    this.pendingHits = [];
    if (this.hitSink) {
      this.hitSink(this.selfId, hits);
      return;
    }
    const room = getRoom();
    if (room?.hostId) room.sendEvent({ t: 'hit', h: hits }, room.hostId);
  }

  /** Nemici visibili per la mira (i velati non rivelati non si vedono). */
  targetable(e: EnemyView): boolean {
    return e.ready && !(e.flags & EF.veiled);
  }

  // --- rete ------------------------------------------------------------------------

  onNet(from: string, msg: CombatMsg) {
    const now = performance.now();
    switch (msg.t) {
      case 'en': {
        const seen = new Set<number>();
        for (const row of msg.e) {
          const [id, ti, x, z, yaw, hp, maxHp, flags] = row;
          seen.add(id);
          let v = this.enemies.get(id);
          if (!v) {
            v = {
              id,
              type: ENEMY_TYPES[ti] ?? 'ombra',
              hp,
              maxHp,
              flags,
              buf: new SnapshotBuffer(NET.maxExtrapolateMs),
              lastSeen: now,
              x,
              z,
              yaw,
              ready: false,
              flash: 0,
              charging: 0,
            };
            this.enemies.set(id, v);
          }
          if (hp < v.hp) v.flash = now;
          v.hp = hp;
          v.maxHp = maxHp;
          v.flags = flags;
          v.lastSeen = now;
          v.buf.push(msg.ts, now, { p: [x, 0, z], r: yaw, a: 'idle', s: 0 });
        }
        break;
      }
      case 'ea':
        this.telegraphs.push({ id: msg.id, k: msg.k, x: msg.x, z: msg.z, r: msg.r, rad: msg.rad, arc: msg.arc, t0: now, t1: now + msg.d, dmg: msg.dmg, done: false });
        {
          const e = this.enemies.get(msg.id);
          if (e) e.charging = now + msg.d;
        }
        break;
      case 'ecancel':
        this.telegraphs = this.telegraphs.filter((t) => t.id !== msg.id || t.done);
        {
          const e = this.enemies.get(msg.id);
          if (e) e.charging = 0;
        }
        break;
      case 'epj':
        for (const a of msg.dirs) {
          this.eprojs.push({
            x: msg.x + Math.sin(a) * 0.8,
            z: msg.z + Math.cos(a) * 0.8,
            dx: Math.sin(a),
            dz: Math.cos(a),
            spd: msg.spd,
            dmg: msg.dmg,
            born: now,
            src: msg.id,
            reflectedBy: null,
            alive: true,
            inBarrier: false,
          });
        }
        break;
      case 'edie':
        this.enemies.delete(msg.id);
        this.telegraphs = this.telegraphs.filter((t) => t.id !== msg.id || t.done);
        deathFx?.(msg.x, msg.z, msg.type);
        break;
      case 'zone':
        this.zones.set(msg.z.id, { ...msg.z, born: now, until: now + msg.z.dur });
        break;
      case 'zlit': {
        const z = this.zones.get(msg.id);
        if (z) z.lit = true;
        break;
      }
      case 'heal':
        if (msg.to === this.selfId) this.healMe(msg.amt);
        break;
      case 'bless':
        if (this.alive && Math.hypot(this.selfPos.x - msg.p[0], this.selfPos.z - msg.p[1]) <= msg.r) {
          this.me.shield = msg.shield;
          this.me.shieldUntil = now + msg.dur * 1000;
          this.me.speedMul = msg.speed;
          this.me.speedUntil = now + msg.dur * 1000;
        }
        break;
      case 'alba':
        if (Math.hypot(this.selfPos.x - msg.p[0], this.selfPos.z - msg.p[1]) <= msg.r) {
          if (!this.alive) {
            this.reviveMe(AB.alba.reviveHp);
            toast('L’Alba ti rialza');
          } else this.healMe(this.me.maxHp * (msg.heal ?? AB.alba.heal));
        }
        break;
      case 'combo':
        showCombo(msg.name);
        break;
      case 'ab':
        this.onRemoteAbility?.(from, msg);
        break;
      default:
        break;
    }
  }

  // --- ciclo per frame ---------------------------------------------------------

  tick(dt: number, now: number, ctx: TickCtx) {
    this.selfPos.x = ctx.x;
    this.selfPos.y = ctx.y;
    this.selfPos.z = ctx.z;
    const m = this.me;
    const renderTime = now - NET.interpDelayMs;

    // posizioni dei nemici come le vediamo
    for (const [id, e] of this.enemies) {
      if (now - e.lastSeen > 1500) {
        this.enemies.delete(id);
        continue;
      }
      const s = e.buf.sample(renderTime);
      if (s) {
        e.x = s.p[0];
        e.z = s.p[2];
        e.yaw = s.r;
        e.ready = true;
      }
    }

    // preavvisi: quando scadono, controlliamo se ci prendono
    for (const t of this.telegraphs) {
      if (t.done || now < t.t1) continue;
      t.done = true;
      if (!ctx.inRun || !this.alive || (t.k !== 'cone' && t.k !== 'circle')) continue;
      const dx = ctx.x - t.x;
      const dz = ctx.z - t.z;
      const d = Math.hypot(dx, dz);
      let hit = d <= t.rad + 0.35;
      if (hit && t.k === 'cone' && d > 0.6) {
        let diff = Math.atan2(dx, dz) - t.r;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        hit = Math.abs(diff) <= t.arc / 2 + 0.15;
      }
      if (hit) this.damageMe(t.dmg, now);
    }
    this.telegraphs = this.telegraphs.filter((t) => !t.done || now - t.t1 < 250);

    // proiettili nemici
    for (const p of this.eprojs) {
      if (!p.alive) continue;
      if (now - p.born > 4500) {
        p.alive = false;
        continue;
      }
      if (p.reflectedBy) {
        const src = this.enemies.get(p.src);
        if (!src) {
          p.alive = false;
          continue;
        }
        const dx = src.x - p.x;
        const dz = src.z - p.z;
        const d = Math.hypot(dx, dz);
        if (d < 1.1) {
          p.alive = false;
          if (p.reflectedBy === this.selfId) this.queueHit({ e: p.src, d: p.dmg * 2 });
          continue;
        }
        p.dx = dx / d;
        p.dz = dz / d;
      }
      p.x += p.dx * p.spd * dt;
      p.z += p.dz * p.spd * dt;
      if (this.dungeon && !walkable(this.dungeon, p.x, p.z)) {
        p.alive = false;
        continue;
      }
      if (p.reflectedBy) continue;
      const barrier = this.insideBarrier(p.x, p.z);
      if (barrier && !p.inBarrier) {
        if (barrier.lit) {
          // combo Custode + Guardiano: la Barriera illuminata rimanda i colpi
          p.reflectedBy = barrier.owner;
          p.spd *= 1.4;
        } else p.alive = false;
        continue;
      }
      p.inBarrier = !!barrier;
      if (ctx.inRun && this.alive && Math.hypot(p.x - ctx.x, p.z - ctx.z) < 0.7) {
        p.alive = false;
        this.damageMe(p.dmg, now);
      }
    }
    this.eprojs = this.eprojs.filter((p) => p.alive);

    // i nostri dardi (e quelli degli altri, solo come grafica)
    for (const b of this.bolts) {
      if (!b.alive) continue;
      b.x += b.dx * b.spd * dt;
      b.z += b.dz * b.spd * dt;
      if (now - b.born > b.life * 1000 || (this.dungeon && ctx.inRun && !walkable(this.dungeon, b.x, b.z))) {
        b.alive = false;
        continue;
      }
      // attraverso un Varco
      if (now > b.portalCd) {
        for (const zn of this.zones.values()) {
          if (zn.kind !== 'varco' || zn.x2 === undefined || zn.z2 === undefined) continue;
          if (Math.hypot(b.x - zn.x, b.z - zn.z) < zn.r) {
            b.x = zn.x2 + b.dx * (zn.r + 0.2);
            b.z = zn.z2 + b.dz * (zn.r + 0.2);
            b.portalCd = now + 300;
          } else if (Math.hypot(b.x - zn.x2, b.z - zn.z2) < zn.r) {
            b.x = zn.x + b.dx * (zn.r + 0.2);
            b.z = zn.z + b.dz * (zn.r + 0.2);
            b.portalCd = now + 300;
          }
        }
      }
      for (const e of this.enemies.values()) {
        if (!e.ready || b.hit.has(e.id)) continue;
        if (Math.hypot(e.x - b.x, e.z - b.z) > ENEMIES[e.type].radius + 0.35) continue;
        b.hit.add(e.id);
        if (b.mine) {
          const dmg = b.dmg * b.mul;
          this.queueHit({ e: e.id, d: dmg });
          this.number(e.x, 2, e.z, dmg, b.crit ? 'crit' : 'dmg');
          b.mul = 1;
          b.crit = false;
        }
        if (b.kind === 'dardo' && b.bounces > 0) {
          b.bounces--;
          b.dmg *= AB.dardo.falloff;
          let next: EnemyView | null = null;
          let best = AB.dardo.bounceRange;
          for (const o of this.enemies.values()) {
            if (!this.targetable(o) || b.hit.has(o.id)) continue;
            const d = Math.hypot(o.x - e.x, o.z - e.z);
            if (d < best) {
              best = d;
              next = o;
            }
          }
          if (next) {
            const d = Math.hypot(next.x - b.x, next.z - b.z) || 1;
            b.dx = (next.x - b.x) / d;
            b.dz = (next.z - b.z) / d;
            b.born = now;
            continue;
          }
        }
        b.alive = false;
        break;
      }
    }
    this.bolts = this.bolts.filter((b) => b.alive);

    // zone: scadenza e Varco per noi
    for (const [id, zn] of this.zones) {
      if (now >= zn.until) {
        this.zones.delete(id);
        continue;
      }
      if (zn.kind === 'varco' && zn.x2 !== undefined && zn.z2 !== undefined && this.alive && now > m.varcoCd) {
        const inA = Math.hypot(ctx.x - zn.x, ctx.z - zn.z) < zn.r;
        const inB = Math.hypot(ctx.x - zn.x2, ctx.z - zn.z2) < zn.r;
        if (inA || inB) {
          m.varcoCd = now + 1200;
          const [tx, tz] = inA ? [zn.x2, zn.z2] : [zn.x, zn.z];
          ctx.teleport(tx, tz);
          if (zn.lit) this.healMe(m.maxHp * 0.25);
          this.onVarcoPass?.(zn, inA);
        }
      }
    }

    // a terra: 20 secondi per essere rialzati da un compagno vicino
    if (m.downAt) {
      if (now - m.downAt > DOWN_SECONDS * 1000) {
        m.downAt = 0;
        m.dead = true;
        toast('Sei fuori combattimento: tornerai quando la stanza sarà ripulita');
      } else {
        const room = getRoom();
        let helper = false;
        if (room) {
          for (const [, v] of room.vitals) {
            if (v.f & (VF.down | VF.dead)) continue;
            if (Math.hypot(v.p[0] - ctx.x, v.p[2] - ctx.z) <= REVIVE_RADIUS) helper = true;
          }
        }
        if (helper) {
          m.revive += dt;
          if (m.revive >= REVIVE_SECONDS) {
            this.reviveMe(REVIVE_HP);
            toast('Ti hanno rialzato!');
          }
        }
      }
    }
    if (m.shield > 0 && now >= m.shieldUntil) m.shield = 0;
    if (now >= m.speedUntil) m.speedMul = 1;

    this.nums = this.nums.filter((n) => now - n.t0 < 1100);
    this.flushHits();
  }
}

export const combat = new CombatRuntime();

let deathFx: ((x: number, z: number, type: EnemyType) => void) | null = null;
export function setDeathFx(fn: typeof deathFx) {
  deathFx = fn;
}

let comboTimer: ReturnType<typeof setTimeout> | null = null;
export function showCombo(name: string) {
  setGame({ combo: { name, t0: performance.now() } });
  if (comboTimer) clearTimeout(comboTimer);
  comboTimer = setTimeout(() => setGame({ combo: null }), 2200);
}
