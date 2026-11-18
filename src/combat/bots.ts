// Compagni guidati dal computer ("Echi"): quando si gioca in pochi, le classi
// libere vengono prese da compagni che combattono con il gruppo.
//
// - Li muove solo l'host (insieme ai nemici) e manda a tutti la loro posizione.
// - Seguono il gruppo, attaccano, usano un paio di abilità della loro classe e
//   corrono a rialzare chi è a terra. Chi gioca può rialzare loro.
// - Sono un po' più deboli di un giocatore: aiutano, non giocano al posto tuo.

import { CLASSES, CLASS_IDS, type ClassId } from '../game/constants';
import { getRoom } from '../net/room';
import { SnapshotBuffer } from '../net/interpolation';
import { NET } from '../game/constants';
import { emitCombat, onCombat } from './bus';
import { AB, CLASS_STATS, ENEMIES, REVIVE_RADIUS, REVIVE_SECONDS, isBoss } from './defs';
import { inRect, walkable, type Dungeon } from './dungeon';
import { VF, type CombatMsg } from './protocol';
import { combat } from './runtime';
import type { EnemySim, PlayerView } from './sim';

export const BOT_PREFIX = 'ia-';
export const isBotId = (id: string) => id.startsWith(BOT_PREFIX);
export const botId = (cls: ClassId) => `${BOT_PREFIX}${cls}`;
export const botName = (cls: ClassId) => `${CLASSES[cls].name} (compagno)`;

/** Quanti compagni con `humans` giocatori: da soli due, in due uno, in tre o più nessuno. */
export function botCount(humans: number): number {
  return Math.max(0, Math.min(2, 3 - humans));
}

/** Prima chi protegge e chi cura (servono di più a chi è da solo), poi gli altri. */
const PRIORITY: ClassId[] = ['guardiano', 'custode', 'lama', 'tessitore'];

export function botClasses(taken: ClassId[], n: number): ClassId[] {
  return PRIORITY.filter((c) => !taken.includes(c)).slice(0, n);
}

interface Brain {
  /** distanza da cui colpisce */
  range: number;
  /** distanza che cerca di tenere dal bersaglio */
  keep: number;
  /** secondi tra un attacco e l'altro */
  every: number;
  /** danno dell'attacco base (Grado 1) */
  dmg: number;
  /** ampiezza del colpo in mischia (radianti); 0 = a distanza */
  arc: number;
  /** parte dei danni che non subisce */
  armor: number;
}

const BRAIN: Record<ClassId, Brain> = {
  guardiano: { range: 2.5, keep: 1.7, every: 0.85, dmg: 15, arc: 2, armor: 0.35 },
  lama: { range: 2.3, keep: 1.5, every: 0.55, dmg: 12, arc: 1.7, armor: 0.1 },
  tessitore: { range: 11, keep: 7, every: 0.8, dmg: 12, arc: 0, armor: 0.05 },
  custode: { range: 10, keep: 6, every: 0.95, dmg: 8, arc: 0, armor: 0.1 },
};

/** Abilità dei compagni (secondi di ricarica). */
const BOT_AB = {
  scudo: { cd: 6, dmg: 22, stun: 1200, push: 9, range: 2.8 },
  provocazione: { cd: 9, radius: 7, taunt: 4000, guard: 0.3 },
  scatto: { cd: 7, dmg: 30 },
  vortice: { cd: 9, dmg: 10, radius: 3, ticks: 3 },
  trappola: { cd: 10 },
  cura: { cd: 3.5, frac: 0.14, below: 0.85 },
  benedizione: { cd: 15 },
};

/** Stili d'animazione (indice nella riga di rete). */
const STYLES = ['swing', 'shoot', 'bash', 'roar', 'dash', 'spin', 'cast', 'raise'] as const;
type Style = (typeof STYLES)[number];
const SLOTS = [null, 'Q', 'E', 'R', 'F'] as const;
type Slot = (typeof SLOTS)[number];

interface Bot {
  id: string;
  cls: ClassId;
  x: number;
  z: number;
  yaw: number;
  speed: number;
  hp: number;
  maxHp: number;
  downAt: number;
  revive: number;
  nextAtk: number;
  combo: number;
  cd: Record<'Q' | 'E' | 'R', number>;
  guardUntil: number;
  stuck: number;
  /** contatori che i client guardano per far partire animazioni ed effetti */
  atk: number;
  style: Style;
  slot: Slot;
  blink: number;
  beam: string;
  beamUntil: number;
}

/** Colpi a distanza in volo: il danno arriva quando il dardo arriva. */
interface Pending {
  at: number;
  fn: () => void;
}

// ================================================================================
// Host: cervello e simulazione dei compagni
// ================================================================================

export class BotManager {
  bots: Bot[] = [];
  private runId = -1;
  private pending: Pending[] = [];
  private seen = new WeakSet<object>();
  private lastSnap = 0;

  /** Una nuova Frattura: sceglie i compagni (classi libere) e li mette accanto al gruppo. */
  setup(runId: number, humans: number, taken: ClassId[], grado: number, at: { x: number; z: number }, enabled: boolean) {
    if (this.runId === runId) return;
    this.runId = runId;
    this.pending = [];
    const n = enabled ? botCount(humans) : 0;
    const hpMul = 0.85 * (1 + 0.12 * (grado - 1));
    this.bots = botClasses(taken, n).map((cls, k) => {
      const maxHp = Math.round(CLASS_STATS[cls].hp * hpMul);
      return {
        id: botId(cls),
        cls,
        x: at.x + (k === 0 ? -1.6 : 1.6),
        z: at.z + 1.2,
        yaw: Math.PI,
        speed: 0,
        hp: maxHp,
        maxHp,
        downAt: 0,
        revive: 0,
        nextAtk: 0,
        combo: 1,
        cd: { Q: 0, E: 0, R: 0 },
        guardUntil: 0,
        stuck: 0,
        atk: 0,
        style: 'swing',
        slot: null,
        blink: 0,
        beam: '',
        beamUntil: 0,
      };
    });
  }

  clear() {
    if (!this.bots.length && this.runId === -1) return;
    this.bots = [];
    this.runId = -1;
    this.pending = [];
    emitCombat({ t: 'bots', ts: performance.now(), b: [] }, { unreliable: true });
  }

  /** Per i nemici (bersagli) e per la regia (sconfitta di gruppo, ingresso nelle stanze). */
  views(): PlayerView[] {
    return this.bots.map((b) => ({ id: b.id, x: b.x, z: b.z, alive: !b.downAt, hidden: false }));
  }

  /** Stanza ripulita: chi era a terra si rialza, e tutti riprendono fiato. */
  onCleared() {
    for (const b of this.bots) {
      b.downAt = 0;
      b.revive = 0;
      b.hp = Math.max(b.hp, b.maxHp);
    }
  }

  /** Dopo una sconfitta di gruppo: si riparte dal checkpoint, in piedi. */
  onWipe(at: { x: number; z: number }) {
    this.bots.forEach((b, k) => {
      b.downAt = 0;
      b.hp = b.maxHp;
      b.x = at.x + (k === 0 ? -1.6 : 1.6);
      b.z = at.z + 1.2;
      b.blink++;
    });
  }

  /** Cure dei giocatori (Raggio curativo) arrivate a un compagno. */
  heal(id: string, amt: number) {
    const b = this.bots.find((x) => x.id === id);
    if (b && !b.downAt) b.hp = Math.min(b.maxHp, b.hp + amt);
  }

  tick(o: TickArgs) {
    const { sim, now } = o;
    const dt = o.dt;
    // colpi a distanza arrivati
    if (this.pending.length) {
      const due = this.pending.filter((p) => p.at <= now);
      this.pending = this.pending.filter((p) => p.at > now);
      for (const p of due) p.fn();
    }
    this.takeHits(now);
    const dmgMul = 1 + 0.15 * (o.grado - 1);

    for (const b of this.bots) {
      if (b.beam && now > b.beamUntil) b.beam = '';
      if (b.downAt) {
        b.speed = 0;
        // un giocatore vicino lo rialza
        if (o.humans.some((h) => h.alive && Math.hypot(h.x - b.x, h.z - b.z) <= REVIVE_RADIUS)) {
          b.revive += dt;
          if (b.revive >= REVIVE_SECONDS) {
            b.downAt = 0;
            b.revive = 0;
            b.hp = Math.round(b.maxHp * 0.4);
          }
        } else b.revive = Math.max(0, b.revive - dt);
        continue;
      }

      const brain = BRAIN[b.cls];
      // 1. qualcuno è a terra? si corre a rialzarlo (il giocatore vede il compagno vicino e si rialza)
      const room = getRoom();
      const downed = o.humans.find((h) => {
        if (h.alive) return false;
        const dead = h.id === room?.self.id ? combat.me.dead : ((room?.vitals.get(h.id)?.f ?? 0) & VF.dead) !== 0;
        return !dead;
      });
      const enemies = [...sim.enemies.values()].filter((e) => o.fight >= 0 && e.room === o.fight);
      if (downed && enemies.length < 6) {
        this.walk(b, downed.x, downed.z, 1, o, CLASS_STATS[b.cls].speed);
        continue;
      }

      // 2. combattimento
      if (enemies.length) {
        const target = this.pickTarget(b, enemies, o.humans);
        const d = Math.hypot(target.x - b.x, target.z - b.z);
        const reach = brain.range + ENEMIES[target.type].radius;
        const yaw = Math.atan2(target.x - b.x, target.z - b.z);
        // a distanza: tiene la distanza, e si allontana se un nemico è troppo vicino
        if (brain.arc === 0) {
          const close = enemies.find((e) => Math.hypot(e.x - b.x, e.z - b.z) < 3.2);
          if (close) {
            const ay = Math.atan2(b.x - close.x, b.z - close.z);
            this.walk(b, b.x + Math.sin(ay) * 3, b.z + Math.cos(ay) * 3, 0.2, o, CLASS_STATS[b.cls].speed);
          } else if (d > reach) this.walk(b, target.x, target.z, brain.keep, o, CLASS_STATS[b.cls].speed);
          else b.speed = 0;
        } else if (d > reach * 0.85) this.walk(b, target.x, target.z, brain.keep, o, CLASS_STATS[b.cls].speed);
        else b.speed = 0;
        if (d <= reach + 0.3) b.yaw = yaw;

        if (this.useAbility(b, target, enemies, o, dmgMul, now)) continue;
        if (d <= reach + 0.3 && now >= b.nextAtk) this.attack(b, target, enemies, dmgMul, now);
        continue;
      }

      // 3. niente nemici: segue il gruppo, ognuno al suo posto attorno al capo
      const leader = nearestHuman(b, o.humans);
      if (!leader) continue;
      const k = this.bots.indexOf(b);
      // dietro al capo (le stanze avanzano verso -Z), uno a destra e uno a sinistra
      const ang = k === 0 ? 0.7 : -0.7;
      const fx = leader.x + Math.sin(ang) * 2.6;
      const fz = leader.z + Math.cos(ang) * 2.6;
      const far = Math.hypot(leader.x - b.x, leader.z - b.z);
      if (far > 18 || b.stuck > 1.4) this.blinkNear(b, leader, o);
      else if (Math.hypot(fx - b.x, fz - b.z) > 0.8) this.walk(b, fx, fz, 0.3, o, CLASS_STATS[b.cls].speed * (far > 6 ? 1.15 : 0.9));
      else b.speed = 0;
    }

    // separazione tra compagni (non si sovrappongono)
    for (let i = 0; i < this.bots.length; i++)
      for (let j = i + 1; j < this.bots.length; j++) {
        const a = this.bots[i];
        const c = this.bots[j];
        const dx = c.x - a.x;
        const dz = c.z - a.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.01 && d < 1.1) {
          const push = (1.1 - d) / 2;
          const nx = (dx / d) * push;
          const nz = (dz / d) * push;
          if (this.canStand(a.x - nx, a.z - nz, o)) {
            a.x -= nx;
            a.z -= nz;
          }
          if (this.canStand(c.x + nx, c.z + nz, o)) {
            c.x += nx;
            c.z += nz;
          }
        }
      }

    if (now - this.lastSnap >= 1000 / 15) {
      this.lastSnap = now;
      emitCombat({ t: 'bots', ts: now, b: this.bots.map(row) }, { unreliable: true });
    }
  }

  // --- danni ai compagni: preavvisi e proiettili dei nemici (li vede anche l'host) ---

  private takeHits(now: number) {
    if (!this.bots.length) return;
    for (const t of combat.telegraphs) {
      if (now < t.t1 || this.seen.has(t)) continue;
      this.seen.add(t);
      if (t.k !== 'cone' && t.k !== 'circle') continue;
      for (const b of this.bots) {
        if (b.downAt) continue;
        const dx = b.x - t.x;
        const dz = b.z - t.z;
        const d = Math.hypot(dx, dz);
        let hit = d <= t.rad + 0.35;
        if (hit && t.k === 'cone' && d > 0.6) {
          let diff = Math.atan2(dx, dz) - t.r;
          diff = Math.atan2(Math.sin(diff), Math.cos(diff));
          hit = Math.abs(diff) <= t.arc / 2 + 0.15;
        }
        if (hit) this.hurt(b, t.dmg, now);
      }
    }
    for (const p of combat.eprojs) {
      if (!p.alive || p.reflectedBy) continue;
      for (const b of this.bots) {
        if (b.downAt || Math.hypot(b.x - p.x, b.z - p.z) > 0.7) continue;
        this.hurt(b, p.dmg, now);
        p.alive = false;
        break;
      }
    }
  }

  private hurt(b: Bot, raw: number, now: number) {
    const armor = BRAIN[b.cls].armor + (now < b.guardUntil ? BOT_AB.provocazione.guard : 0);
    b.hp -= raw * (1 - Math.min(0.7, armor));
    if (b.hp <= 0) {
      b.hp = 0;
      b.downAt = now;
      b.revive = 0;
      b.speed = 0;
    }
  }

  // --- movimento ---------------------------------------------------------------------

  private canStand(x: number, z: number, o: Pick<TickArgs, 'dungeon' | 'cleared'>): boolean {
    if (!walkable(o.dungeon, x, z, 0.35)) return false;
    // oltre una porta ancora chiusa non si passa
    for (const c of o.dungeon.corridors) if (o.cleared <= c.i && inRect(c.rect, x, z)) return false;
    return true;
  }

  /** Cammina verso (tx, tz) fermandosi a `stop` metri; scivola lungo muri e colonne. */
  private walk(b: Bot, tx: number, tz: number, stop: number, o: { dungeon: Dungeon; cleared: number; dt: number }, speed: number) {
    const dx = tx - b.x;
    const dz = tz - b.z;
    const d = Math.hypot(dx, dz);
    if (d <= stop) {
      b.speed = 0;
      return;
    }
    const step = Math.min(d - stop, speed * o.dt);
    const a = Math.atan2(dx, dz);
    for (const off of [0, 0.5, -0.5, 1.1, -1.1, 1.6, -1.6]) {
      const nx = b.x + Math.sin(a + off) * step;
      const nz = b.z + Math.cos(a + off) * step;
      if (this.canStand(nx, nz, o)) {
        b.x = nx;
        b.z = nz;
        b.yaw = a + off;
        b.speed = speed;
        b.stuck = Math.max(0, b.stuck - o.dt);
        return;
      }
    }
    b.speed = 0;
    b.stuck += o.dt;
  }

  /** Riappare accanto al capo (troppo lontano o bloccato): un piccolo sbuffo d'ombra. */
  private blinkNear(b: Bot, leader: PlayerView, o: TickArgs) {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const x = leader.x + Math.sin(a) * 2.2;
      const z = leader.z + Math.cos(a) * 2.2;
      if (this.canStand(x, z, o)) {
        b.x = x;
        b.z = z;
        b.stuck = 0;
        b.blink++;
        return;
      }
    }
  }

  // --- combattimento -----------------------------------------------------------------

  private pickTarget(b: Bot, enemies: EnemyLike[], humans: PlayerView[]): EnemyLike {
    const dist = (e: EnemyLike) => Math.hypot(e.x - b.x, e.z - b.z);
    if (b.cls === 'guardiano') {
      // protegge: il nemico più vicino a un giocatore
      let best = enemies[0];
      let bd = Infinity;
      for (const e of enemies) {
        for (const h of humans) {
          const d = Math.hypot(e.x - h.x, e.z - h.z) + dist(e) * 0.3;
          if (d < bd) {
            bd = d;
            best = e;
          }
        }
      }
      return best;
    }
    if (b.cls === 'lama') {
      // i più deboli vicini
      return [...enemies].sort((p, q) => p.hp / p.maxHp + dist(p) * 0.05 - (q.hp / q.maxHp + dist(q) * 0.05))[0];
    }
    return [...enemies].sort((p, q) => dist(p) - dist(q))[0];
  }

  private hit(b: Bot, e: EnemyLike, d: number, extra: { st?: number; tn?: number; push?: number } = {}) {
    const sim = currentSim;
    if (!sim) return;
    const dx = e.x - b.x;
    const dz = e.z - b.z;
    const len = Math.hypot(dx, dz) || 1;
    const kb: [number, number] | undefined = extra.push ? [(dx / len) * extra.push, (dz / len) * extra.push] : undefined;
    for (const ev of sim.applyHit(b.id, { e: e.id, d: Math.round(d), st: extra.st, tn: extra.tn, kb }, performance.now())) emitCombat(ev);
  }

  private anim(b: Bot, style: Style, slot: Slot = null) {
    b.atk++;
    b.style = style;
    b.slot = slot;
  }

  private attack(b: Bot, target: EnemyLike, enemies: EnemyLike[], dmgMul: number, now: number) {
    const brain = BRAIN[b.cls];
    b.nextAtk = now + brain.every * 1000 * (0.9 + Math.random() * 0.2);
    if (brain.arc > 0) {
      const heavy = b.combo === 3;
      this.anim(b, 'swing');
      b.style = 'swing';
      for (const e of enemies) {
        const dx = e.x - b.x;
        const dz = e.z - b.z;
        const d = Math.hypot(dx, dz);
        if (d > brain.range + ENEMIES[e.type].radius + 0.3) continue;
        let diff = Math.atan2(dx, dz) - b.yaw;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        if (d > ENEMIES[e.type].radius + 0.6 && Math.abs(diff) > brain.arc / 2) continue;
        this.hit(b, e, brain.dmg * dmgMul * (heavy ? 1.5 : 1), { push: heavy ? 8 : 3 });
      }
      b.combo = (b.combo % 3) + 1;
    } else {
      this.anim(b, 'shoot');
      const d = Math.hypot(target.x - b.x, target.z - b.z);
      const id = target.id;
      this.pending.push({
        at: now + (d / 26) * 1000,
        fn: () => {
          const e = currentSim?.enemies.get(id);
          if (e) this.hit(b, e, brain.dmg * dmgMul, { push: 2 });
        },
      });
    }
  }

  /** Abilità semplici, ognuna con la sua regola. Restituisce true se ne ha usata una. */
  private useAbility(b: Bot, target: EnemyLike, enemies: EnemyLike[], o: TickArgs, dmgMul: number, now: number): boolean {
    const near = (r: number) => enemies.filter((e) => Math.hypot(e.x - b.x, e.z - b.z) <= r + ENEMIES[e.type].radius);
    const dt = Math.hypot(target.x - b.x, target.z - b.z);
    switch (b.cls) {
      case 'guardiano': {
        if (now >= b.cd.E && near(BOT_AB.provocazione.radius).length >= 2) {
          b.cd.E = now + BOT_AB.provocazione.cd * 1000;
          b.guardUntil = now + BOT_AB.provocazione.taunt;
          for (const e of near(BOT_AB.provocazione.radius)) this.hit(b, e, 0, { tn: BOT_AB.provocazione.taunt });
          this.anim(b, 'roar', 'E');
          return true;
        }
        if (now >= b.cd.Q && dt <= BOT_AB.scudo.range + ENEMIES[target.type].radius) {
          b.cd.Q = now + BOT_AB.scudo.cd * 1000;
          this.hit(b, target, BOT_AB.scudo.dmg * dmgMul, { st: isBoss(target.type) ? 400 : BOT_AB.scudo.stun, push: BOT_AB.scudo.push });
          this.anim(b, 'bash', 'Q');
          return true;
        }
        return false;
      }
      case 'lama': {
        if (now >= b.cd.Q && dt > 3 && dt < 9) {
          // riappare alle spalle del bersaglio e colpisce forte
          const yaw = Math.atan2(target.x - b.x, target.z - b.z);
          const r = ENEMIES[target.type].radius + 1;
          const nx = target.x + Math.sin(yaw) * r;
          const nz = target.z + Math.cos(yaw) * r;
          if (this.canStand(nx, nz, o)) {
            b.cd.Q = now + BOT_AB.scatto.cd * 1000;
            b.x = nx;
            b.z = nz;
            b.yaw = yaw + Math.PI;
            b.blink++;
            this.hit(b, target, BOT_AB.scatto.dmg * dmgMul, { push: 4 });
            this.anim(b, 'dash', 'Q');
            return true;
          }
        }
        if (now >= b.cd.E && near(BOT_AB.vortice.radius).length >= 2) {
          b.cd.E = now + BOT_AB.vortice.cd * 1000;
          for (let i = 0; i < BOT_AB.vortice.ticks; i++) {
            this.pending.push({
              at: now + i * 400,
              fn: () => {
                for (const e of currentSim?.enemies.values() ?? []) {
                  if (Math.hypot(e.x - b.x, e.z - b.z) <= BOT_AB.vortice.radius + ENEMIES[e.type].radius) this.hit(b, e, BOT_AB.vortice.dmg * dmgMul, { push: 2 });
                }
              },
            });
          }
          this.anim(b, 'spin', 'E');
          return true;
        }
        return false;
      }
      case 'tessitore': {
        if (now >= b.cd.E && enemies.length >= 2) {
          b.cd.E = now + BOT_AB.trappola.cd * 1000;
          // al centro del gruppo di nemici più fitto
          let best = target;
          let bc = 0;
          for (const e of enemies) {
            const c = enemies.filter((q) => Math.hypot(q.x - e.x, q.z - e.z) < 4).length;
            if (c > bc) {
              bc = c;
              best = e;
            }
          }
          emitCombat({
            t: 'zone',
            z: { id: `${b.id}-${now | 0}`, kind: 'trappola', owner: b.id, x: best.x, z: best.z, r: AB.trappola.radius, dur: AB.trappola.dur * 1000, dps: AB.trappola.dps * dmgMul, pull: AB.trappola.pull },
          });
          this.anim(b, 'cast', 'E');
          return true;
        }
        return false;
      }
      case 'custode': {
        // cura chi ne ha più bisogno (giocatori e altri compagni)
        if (now >= b.cd.Q) {
          const hurt = this.mostHurt(b, o.humans);
          if (hurt && hurt.frac < BOT_AB.cura.below) {
            b.cd.Q = now + BOT_AB.cura.cd * 1000;
            const amt = Math.round(hurt.max * BOT_AB.cura.frac);
            if (isBotId(hurt.id)) this.heal(hurt.id, amt);
            else emitCombat({ t: 'heal', to: hurt.id, amt }, { to: hurt.id });
            b.beam = hurt.id;
            b.beamUntil = now + 1200;
            this.anim(b, 'raise', 'Q');
            return true;
          }
        }
        if (now >= b.cd.R && o.humans.some((h) => h.alive && Math.hypot(h.x - b.x, h.z - b.z) < AB.benedizione.radius) && enemies.length >= 3) {
          b.cd.R = now + BOT_AB.benedizione.cd * 1000;
          emitCombat({ t: 'bless', p: [b.x, b.z], r: AB.benedizione.radius, shield: AB.benedizione.shield, speed: AB.benedizione.speed, dur: AB.benedizione.dur });
          this.anim(b, 'raise', 'R');
          return true;
        }
        return false;
      }
    }
  }

  private mostHurt(b: Bot, humans: PlayerView[]): { id: string; frac: number; max: number } | null {
    let best: { id: string; frac: number; max: number } | null = null;
    const room = getRoom();
    for (const h of humans) {
      if (!h.alive || Math.hypot(h.x - b.x, h.z - b.z) > AB.raggio.range) continue;
      const v = h.id === room?.self.id ? { hp: combat.me.hp, mhp: combat.me.maxHp } : room?.vitals.get(h.id);
      if (!v) continue;
      const frac = v.hp / Math.max(1, v.mhp);
      if (!best || frac < best.frac) best = { id: h.id, frac, max: v.mhp };
    }
    for (const o of this.bots) {
      if (o.downAt || Math.hypot(o.x - b.x, o.z - b.z) > AB.raggio.range) continue;
      const frac = o.hp / o.maxHp;
      if (!best || frac < best.frac) best = { id: o.id, frac, max: o.maxHp };
    }
    return best;
  }
}

interface TickArgs {
  sim: EnemySim;
  dungeon: Dungeon;
  cleared: number;
  fight: number;
  grado: number;
  humans: PlayerView[];
  /** secondi */
  dt: number;
  now: number;
}

type EnemyLike = { id: number; type: import('./defs').EnemyType; x: number; z: number; hp: number; maxHp: number };

function nearestHuman(b: Bot, humans: PlayerView[]): PlayerView | null {
  let best: PlayerView | null = null;
  let bd = Infinity;
  for (const h of humans) {
    if (!h.alive) continue;
    const d = Math.hypot(h.x - b.x, h.z - b.z);
    if (d < bd) {
      bd = d;
      best = h;
    }
  }
  return best ?? humans[0] ?? null;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Riga di rete: classe, posizione, vita, stato, animazione, effetti. */
function row(b: Bot): (number | string)[] {
  return [
    CLASS_IDS.indexOf(b.cls),
    r2(b.x),
    r2(b.z),
    r2(b.yaw),
    Math.ceil(b.hp),
    b.maxHp,
    b.downAt ? VF.down : 0,
    b.atk,
    STYLES.indexOf(b.style),
    SLOTS.indexOf(b.slot),
    r2(b.speed),
    b.blink,
    b.beam,
  ];
}

/** Il simulatore dei nemici in uso (lo imposta la regia). */
let currentSim: EnemySim | null = null;
export function setBotSim(sim: EnemySim | null) {
  currentSim = sim;
}

export const botManager = new BotManager();

// ================================================================================
// Tutti: i compagni come li vediamo (posizioni interpolate, animazioni, effetti)
// ================================================================================

export interface BotView {
  id: string;
  cls: ClassId;
  buf: SnapshotBuffer;
  hp: number;
  maxHp: number;
  flags: number;
  atk: number;
  style: Style;
  slot: Slot;
  speed: number;
  blink: number;
  beam: string;
  lastSeen: number;
  /** per far partire le animazioni una volta sola */
  seenAtk: number;
  seenBlink: number;
  seenBeam: string;
}

export const botViews = new Map<string, BotView>();
let botVersion = 0;
export const botListVersion = () => botVersion;

export function onBotsMsg(msg: Extract<CombatMsg, { t: 'bots' }>) {
  const now = performance.now();
  const room = getRoom();
  const seen = new Set<string>();
  for (const r of msg.b) {
    const cls = CLASS_IDS[r[0] as number];
    if (!cls) continue;
    const id = botId(cls);
    seen.add(id);
    let v = botViews.get(id);
    if (!v) {
      v = {
        id,
        cls,
        buf: new SnapshotBuffer(NET.maxExtrapolateMs),
        hp: 0,
        maxHp: 1,
        flags: 0,
        atk: r[7] as number,
        style: 'swing',
        slot: null,
        speed: 0,
        blink: r[11] as number,
        beam: '',
        lastSeen: now,
        seenAtk: r[7] as number,
        seenBlink: r[11] as number,
        seenBeam: '',
      };
      botViews.set(id, v);
      botVersion++;
    }
    const [, x, z, yaw, hp, maxHp, flags, atk, style, slot, speed, blink, beam] = r as [number, number, number, number, number, number, number, number, number, number, number, number, string];
    v.hp = hp;
    v.maxHp = maxHp;
    v.flags = flags;
    v.atk = atk;
    v.style = STYLES[style] ?? 'swing';
    v.slot = SLOTS[slot] ?? null;
    v.speed = speed;
    v.blink = blink;
    v.beam = beam;
    v.lastSeen = now;
    v.buf.push(msg.ts, now, { p: [x, 0, z], r: yaw, a: flags & VF.down ? 'down' : speed > 0.3 ? 'run' : 'idle', s: speed });
    // per le barre della vita, il Raggio curativo e il rialzarsi: come un giocatore
    room?.vitals.set(id, { hp, mhp: maxHp, f: flags, p: [x, 0, z] });
  }
  for (const id of [...botViews.keys()]) {
    if (seen.has(id)) continue;
    botViews.delete(id);
    room?.vitals.delete(id);
    botVersion++;
  }
}

// messaggi: posizioni dei compagni (tutti) e cure dei giocatori ai compagni (solo l'host)
onCombat((_from, msg) => {
  if (msg.t === 'bots') onBotsMsg(msg);
  else if (msg.t === 'heal' && isBotId(msg.to) && getRoom()?.isHost) botManager.heal(msg.to, msg.amt);
});
