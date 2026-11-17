// Attacco base, abilità Q/E/R e Ultra delle 4 classi, con le combo di coppia.
//
// Chi usa un'abilità calcola da sé chi colpisce (sui nemici come li vede) e
// manda i colpi all'host, che aggiorna la vita dei nemici. Gli altri giocatori
// ricevono un messaggio 'ab' e vedono l'effetto.

import { CLASSES, type ClassId } from '../game/constants';
import { abilityMove, type MoveStyle } from '../player/moves';
import { getGame } from '../game/store';
import { getRoom } from '../net/room';
import { spawnFlash, spawnPuff, spawnRing, spawnSlash, addBeam } from '../fx/effects';
import { emitCombat } from './bus';
import { AB, CLASS_STATS, EF, ENEMIES, ULTRA_GAIN, ULTRA_MAX } from './defs';
import { COMBO_NAMES, VF, type AbilitySlot, type CombatMsg } from './protocol';
import { combat, showCombo, type EnemyView } from './runtime';
import type { Hit } from './sim';
import { EXECUTE_THRESHOLD } from './sim';
import type { PerkKey } from '../progress/defs';

// --- bonus di talenti e oggetti --------------------------------------------------------

/** Potere speciale dei talenti (0 se non c'è). */
const P = (k: PerkKey) => combat.mods.perks[k] ?? 0;

function critChance(cls: ClassId | null): number {
  return (cls === 'lama' ? 0.15 : 0.05) + combat.mods.critChance;
}

/** Danno con i bonus del giocatore e tiro del critico. */
function scale(d: number, kind: 'basic' | 'ability', cls: ClassId | null, canCrit = true): { d: number; crit: boolean } {
  const m = combat.mods;
  let v = d * (1 + m.dmgPct) * (1 + (kind === 'basic' ? m.basicPct : m.abilityPct));
  let crit = false;
  if (canCrit && Math.random() < critChance(cls)) {
    v *= 1.5 + m.critDmg;
    crit = true;
  }
  return { d: Math.round(v), crit };
}

/** Ricarica dell'abilità con la riduzione dei talenti e degli oggetti. */
function cooldownMs(cls: ClassId, slot: 'Q' | 'E' | 'R'): number {
  return CLASS_STATS[cls].cd['QER'.indexOf(slot)] * 1000 * (1 - combat.mods.cdr);
}

let currentClass: ClassId | null = null;

export interface PlayerCtx {
  id: string;
  cls: ClassId | null;
  x: number;
  y: number;
  z: number;
  yaw: number;
  setYaw: (y: number) => void;
  /** Direzione "davanti": dove ci si muove, altrimenti dove guarda la telecamera. */
  fx: number;
  fz: number;
  /** Spazio libero (senza muri) in una direzione, fino a `max`. */
  freeDistance: (dx: number, dz: number, max: number) => number;
  teleport: (x: number, z: number) => void;
  autoAim: boolean;
  /** Animazioni del personaggio. */
  /** animazione d'attacco: numero del colpo e movimento del corpo (player/moves.ts) */
  attackAnim: (n: number, style?: MoveStyle) => void;
}

const colorOf = (cls: ClassId | null) => (cls ? CLASSES[cls].color : '#8a8496');
const angDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

// --- azioni programmate (colpi in sequenza, cure nel tempo) ------------------

interface Scheduled {
  at: number;
  fn: () => void;
}
let queue: Scheduled[] = [];
const later = (ms: number, fn: () => void) => queue.push({ at: performance.now() + ms, fn });

let bastionPending = false;
const comboCooldown = new Map<string, number>();

function combo(key: keyof typeof COMBO_NAMES, partnerClass: ClassId) {
  const now = performance.now();
  if ((comboCooldown.get(key) ?? 0) > now) return;
  comboCooldown.set(key, now + 2500);
  const room = getRoom();
  const self = getGame().selfId;
  const partner = Object.entries(getGame().room.classes).find(([id, c]) => c === partnerClass && id !== self)?.[0];
  const msg: CombatMsg = { t: 'combo', name: COMBO_NAMES[key], ids: [self, ...(partner ? [partner] : [])] };
  if (room) room.emit(msg);
  showCombo(COMBO_NAMES[key]);
}

/** Da chiamare a ogni frame. */
export function tickAbilities(ctx: PlayerCtx) {
  const now = performance.now();
  const due = queue.filter((q) => q.at <= now);
  if (due.length) {
    queue = queue.filter((q) => q.at > now);
    for (const q of due) q.fn();
  }
  // fine del Bastione: esplode con i danni assorbiti
  const m = combat.me;
  if (bastionPending && now >= m.bastionUntil) {
    bastionPending = false;
    const raw = (AB.bastione.blastBase + AB.bastione.blastMul * m.bastionAbsorbed) * (1 + P('bastioneEsplosione'));
    const dmg = scale(raw, 'ability', ctx.cls, false).d;
    hitArea(ctx.x, ctx.z, AB.bastione.blastRadius, { d: dmg, noCharge: true, raw: true });
    spawnFlash(ctx.x, ctx.z, '#ffd25a', AB.bastione.blastRadius, 0.5);
    emitAb(ctx, 'F', { to: [ctx.x, ctx.z] }, true);
    m.bastionAbsorbed = 0;
  }
}

export function resetAbilities() {
  queue = [];
  bastionPending = false;
}

// --- mira ---------------------------------------------------------------------

/** Il nemico più vicino davanti a te (mira automatica). */
export function findTarget(ctx: PlayerCtx, range: number, arc = 2.2): EnemyView | null {
  const fwd = Math.atan2(ctx.fx, ctx.fz);
  let best: EnemyView | null = null;
  let bestScore = Infinity;
  for (const e of combat.enemies.values()) {
    if (!combat.targetable(e)) continue;
    const dx = e.x - ctx.x;
    const dz = e.z - ctx.z;
    const d = Math.hypot(dx, dz);
    if (d > range + ENEMIES[e.type].radius) continue;
    const off = Math.abs(angDiff(Math.atan2(dx, dz), fwd));
    if (off > arc / 2 && d > 2.2) continue;
    // più vicino e più centrato vince
    const score = d + off * 2.5;
    if (score < bestScore) {
      bestScore = score;
      best = e;
    }
  }
  return best;
}

function aimYaw(ctx: PlayerCtx, range: number): { yaw: number; target: EnemyView | null } {
  const target = ctx.autoAim ? findTarget(ctx, range) : null;
  const yaw = target ? Math.atan2(target.x - ctx.x, target.z - ctx.z) : Math.atan2(ctx.fx, ctx.fz);
  return { yaw, target };
}

/** Punto a terra dove lanciare (bersaglio o davanti), senza attraversare i muri. */
function aimPoint(ctx: PlayerCtx, maxDist: number, fallback: number): [number, number] {
  const { yaw, target } = aimYaw(ctx, maxDist);
  const dx = Math.sin(yaw);
  const dz = Math.cos(yaw);
  const want = target ? Math.min(maxDist, Math.hypot(target.x - ctx.x, target.z - ctx.z)) : fallback;
  const d = Math.max(0, Math.min(want, ctx.freeDistance(dx, dz, want)));
  ctx.setYaw(yaw);
  return [ctx.x + dx * d, ctx.z + dz * d];
}

// --- colpi ----------------------------------------------------------------------

interface HitOpts {
  d: number;
  /** colpo della Ultra: non ricarica la Ultra */
  noCharge?: boolean;
  /** danno già calcolato (niente bonus né critico) */
  raw?: boolean;
  st?: number;
  tn?: number;
  mk?: number;
  /** mostrato come critico */
  crit?: boolean;
  includeVeiled?: boolean;
}

function hitEnemy(e: EnemyView, o: Omit<Hit, 'e'> & { crit?: boolean; noCharge?: boolean }) {
  combat.queueHit({ e: e.id, d: o.d, st: o.st, tn: o.tn, mk: o.mk, x: o.x, kb: o.kb }, !o.noCharge);
  if (o.d > 0) combat.number(e.x, 2.1, e.z, o.d, o.crit ? 'crit' : 'dmg');
}

function withBonus(o: HitOpts): HitOpts {
  if (o.raw || o.d <= 0) return o;
  const s = scale(o.d, 'ability', currentClass);
  return { ...o, d: s.d, crit: o.crit || s.crit };
}

function hitArea(x: number, z: number, radius: number, o: HitOpts): EnemyView[] {
  const hit: EnemyView[] = [];
  for (const e of combat.enemies.values()) {
    if (!e.ready) continue;
    if (!o.includeVeiled && e.flags & EF.veiled && o.d === 0) continue;
    if (Math.hypot(e.x - x, e.z - z) <= radius + ENEMIES[e.type].radius) {
      hitEnemy(e, withBonus(o));
      hit.push(e);
    }
  }
  return hit;
}

function hitCone(x: number, z: number, yaw: number, range: number, arc: number, o: HitOpts): EnemyView[] {
  const hit = coneTargets(x, z, yaw, range, arc);
  for (const e of hit) hitEnemy(e, withBonus(o));
  return hit;
}

function coneTargets(x: number, z: number, yaw: number, range: number, arc: number): EnemyView[] {
  const out: EnemyView[] = [];
  for (const e of combat.enemies.values()) {
    if (!e.ready) continue;
    const dx = e.x - x;
    const dz = e.z - z;
    const d = Math.hypot(dx, dz);
    const r = ENEMIES[e.type].radius;
    if (d > range + r) continue;
    if (d > r + 0.6 && Math.abs(angDiff(Math.atan2(dx, dz), yaw)) > arc / 2) continue;
    out.push(e);
  }
  return out;
}

// --- moltiplicatori del prossimo colpo --------------------------------------------

let nextMul = 1;
let nextCrit = false;

function consumeVeil(): boolean {
  const m = combat.me;
  if (performance.now() < m.veilUntil) {
    m.veilUntil = 0;
    return true;
  }
  return false;
}

/** Danno di un colpo della Lama (o di chiunque) con le regole delle combo. */
function strike(ctx: PlayerCtx, e: EnemyView, base: number, fromVeil: boolean) {
  const taunted = ctx.cls === 'lama' && (e.flags & EF.taunt) !== 0;
  const s = scale(base, 'basic', ctx.cls, !taunted);
  let d = s.d * nextMul;
  let crit = nextCrit || s.crit;
  let execute = false;
  if (ctx.cls === 'lama') {
    // Guardiano + Lama: la Provocazione gira il nemico, la Lama colpisce alle spalle (critico garantito)
    if (taunted) {
      d *= Math.max(2, 1.5 + combat.mods.critDmg);
      crit = true;
      combo('spalle', 'guardiano');
    }
    // Custode + Lama: il Velo uccide in un colpo i nemici segnati e deboli
    if (fromVeil && e.flags & EF.mark && e.hp / e.maxHp <= EXECUTE_THRESHOLD) {
      execute = true;
      combo('esecuzione', 'custode');
    }
  }
  if (fromVeil) {
    d *= AB.velo.mul + P('veloDanno');
    crit = true;
  }
  hitEnemy(e, { d: Math.round(d), crit, x: execute || undefined });
}

// --- attacco base -----------------------------------------------------------------

export function basicAttack(ctx: PlayerCtx, comboN: number) {
  currentClass = ctx.cls;
  const stats = CLASS_STATS[ctx.cls ?? 'none'];
  const ranged = ctx.cls ? CLASSES[ctx.cls].ranged : false;
  const { yaw } = aimYaw(ctx, ranged ? stats.reach : stats.reach + 3);
  ctx.setYaw(yaw);
  ctx.attackAnim(comboN);
  const color = colorOf(ctx.cls);
  const fromVeil = consumeVeil();

  if (ranged) {
    const mul = nextMul * (fromVeil ? AB.velo.mul + P('veloDanno') : 1);
    const sc = scale(stats.basic[0], 'basic', ctx.cls);
    combat.bolts.push({
      x: ctx.x + Math.sin(yaw) * 0.6,
      z: ctx.z + Math.cos(yaw) * 0.6,
      y: ctx.y + 1.25,
      dx: Math.sin(yaw),
      dz: Math.cos(yaw),
      spd: 26,
      dmg: sc.d,
      born: performance.now(),
      life: stats.reach / 26,
      mine: true,
      color,
      kind: 'basic',
      bounces: 0,
      hit: new Set(),
      alive: true,
      portalCd: 0,
      mul,
      crit: nextCrit || fromVeil || sc.crit,
    });
  } else {
    spawnSlash([ctx.x, ctx.y, ctx.z], yaw, color, comboN);
    const dmg = stats.basic[Math.min(comboN, stats.basic.length) - 1];
    const hits = coneTargets(ctx.x, ctx.z, yaw, stats.reach, stats.arc);
    for (const e of hits) strike(ctx, e, dmg, fromVeil);
  }
  nextMul = 1;
  nextCrit = false;
  getRoom()?.emit({ t: 'act', a: 'attack', n: comboN, p: [ctx.x, ctx.y, ctx.z], r: yaw });
}

// --- abilità ----------------------------------------------------------------------

export interface AbilityState {
  slot: AbilitySlot;
  ready: boolean;
  /** 0..1, quanto manca */
  left: number;
  seconds: number;
}

export function abilityState(cls: ClassId | null, slot: AbilitySlot, now: number): AbilityState {
  const m = combat.me;
  if (slot === 'F') {
    const ready = m.ultra >= ULTRA_MAX && !!cls;
    return { slot, ready, left: 1 - m.ultra / ULTRA_MAX, seconds: 0 };
  }
  const total = cls ? cooldownMs(cls, slot) : 0;
  const until = m.cd[slot];
  const left = Math.max(0, until - now);
  return { slot, ready: !!cls && left <= 0, left: total ? left / total : 0, seconds: Math.ceil(left / 1000) };
}

function emitAb(ctx: PlayerCtx, a: AbilitySlot, extra: Partial<Extract<CombatMsg, { t: 'ab' }>> = {}, remoteOnly = false) {
  if (!ctx.cls) return;
  const msg: CombatMsg = { t: 'ab', cls: ctx.cls, a, p: [ctx.x, ctx.y, ctx.z], r: ctx.yaw, ...extra };
  if (remoteOnly) getRoom()?.emit(msg);
  else emitCombat(msg, { skipSelf: true });
}

function zoneId() {
  return `${getGame().selfId.slice(0, 6)}-${Math.floor(performance.now())}-${Math.floor(Math.random() * 1000)}`;
}

/** Combo della Custode: illumina Barriere e Varchi vicini. */
function lightNearbyZones(ctx: PlayerCtx, targetPos?: [number, number]) {
  for (const z of combat.zones.values()) {
    if (z.lit) continue;
    if (z.kind === 'barriera') {
      const near = Math.hypot(ctx.x - z.x, ctx.z - z.z) <= z.r + 1 || (targetPos && Math.hypot(targetPos[0] - z.x, targetPos[1] - z.z) <= z.r + 1);
      if (near) {
        emitCombat({ t: 'zlit', id: z.id });
        combo('barrieraLuce', 'guardiano');
      }
    } else if (z.kind === 'varco') {
      const near = Math.hypot(ctx.x - z.x, ctx.z - z.z) <= 8 || (z.x2 !== undefined && Math.hypot(ctx.x - z.x2, ctx.z - (z.z2 ?? 0)) <= 8);
      if (near) {
        emitCombat({ t: 'zlit', id: z.id });
        combo('varcoLuce', 'tessitore');
      }
    }
  }
}

/** Usa un'abilità. Restituisce false se non è pronta. */
export function castAbility(slot: AbilitySlot, ctx: PlayerCtx): boolean {
  const now = performance.now();
  const st = abilityState(ctx.cls, slot, now);
  if (!st.ready || !combat.alive || !ctx.cls) return false;
  const m = combat.me;
  currentClass = ctx.cls;
  if (slot === 'F') m.ultra = 0;
  else m.cd[slot] = now + cooldownMs(ctx.cls, slot);
  // ogni abilità ha il suo movimento del corpo
  ctx.attackAnim(1, abilityMove(ctx.cls, slot));
  const color = colorOf(ctx.cls);
  const key = `${ctx.cls}:${slot}` as const;

  switch (key) {
    // ---------------- Guardiano ----------------
    case 'guardiano:Q': {
      const { yaw } = aimYaw(ctx, AB.scudo.range + 2);
      ctx.setYaw(yaw);
      spawnSlash([ctx.x, ctx.y, ctx.z], yaw, '#9fc4ff', 2);
      hitCone(ctx.x, ctx.z, yaw, AB.scudo.range, AB.scudo.arc, { d: AB.scudo.dmg, st: AB.scudo.stun + P('scudoStordimento') });
      // Tessitore + Guardiano: la Trappola ammassa, il Colpo di scudo li stordisce tutti
      for (const z of combat.zones.values()) {
        if (z.kind === 'trappola' && Math.hypot(z.x - ctx.x, z.z - ctx.z) <= z.r + 3) {
          hitArea(z.x, z.z, z.r + 1, { d: 30, st: 3000 });
          spawnRing(z.x, z.z, '#9fc4ff', z.r + 1, 0.5);
          combo('implosione', 'tessitore');
        }
      }
      emitAb(ctx, 'Q', { r: yaw });
      break;
    }
    case 'guardiano:E': {
      const radius = AB.provocazione.radius + P('provocazioneRaggio');
      hitArea(ctx.x, ctx.z, radius, { d: 0, tn: AB.provocazione.taunt, includeVeiled: true });
      m.guardUntil = now + AB.provocazione.dur * 1000;
      spawnRing(ctx.x, ctx.z, '#ff4d4d', radius, 0.6);
      emitAb(ctx, 'E');
      break;
    }
    case 'guardiano:R': {
      const r = AB.barriera.radius * (1 + P('barrieraRaggio'));
      emitCombat({ t: 'zone', z: { id: zoneId(), kind: 'barriera', owner: ctx.id, x: ctx.x, z: ctx.z, r, dur: AB.barriera.dur * 1000 } });
      emitAb(ctx, 'R');
      break;
    }
    case 'guardiano:F': {
      const dur = AB.bastione.dur + P('bastioneDurata');
      m.bastionUntil = now + dur * 1000;
      m.bastionAbsorbed = 0;
      bastionPending = true;
      hitArea(ctx.x, ctx.z, AB.bastione.tauntRadius, { d: 0, tn: dur * 1000, includeVeiled: true });
      spawnRing(ctx.x, ctx.z, '#ffd25a', AB.bastione.tauntRadius, 0.7);
      emitAb(ctx, 'F');
      break;
    }

    // ---------------- Lama d'Ombra ----------------
    case 'lama:Q': {
      const target = ctx.autoAim ? findTarget(ctx, AB.scatto.behindRange + P('scattoDistanza')) : null;
      const from: [number, number] = [ctx.x, ctx.z];
      let to: [number, number];
      if (target) {
        // riappare alle spalle del bersaglio
        const yaw = Math.atan2(target.x - ctx.x, target.z - ctx.z);
        const dist = Math.hypot(target.x - ctx.x, target.z - ctx.z) + ENEMIES[target.type].radius + 1.1;
        const free = ctx.freeDistance(Math.sin(yaw), Math.cos(yaw), dist);
        to = [ctx.x + Math.sin(yaw) * free, ctx.z + Math.cos(yaw) * free];
        ctx.teleport(to[0], to[1]);
        ctx.setYaw(yaw + Math.PI);
      } else {
        const yaw = Math.atan2(ctx.fx, ctx.fz);
        const free = ctx.freeDistance(ctx.fx, ctx.fz, AB.scatto.dist + P('scattoDistanza'));
        to = [ctx.x + ctx.fx * free, ctx.z + ctx.fz * free];
        ctx.teleport(to[0], to[1]);
        ctx.setYaw(yaw);
      }
      nextMul = Math.max(nextMul, AB.scatto.bonus);
      spawnPuff(from[0], ctx.y + 1, from[1], color);
      spawnPuff(to[0], ctx.y + 1, to[1], color);
      emitAb(ctx, 'Q', { path: [from, to] });
      break;
    }
    case 'lama:E': {
      for (let i = 0; i < AB.vortice.ticks + P('vorticeColpi'); i++) {
        later(i * AB.vortice.every * 1000, () => {
          const p = combat.selfPos;
          for (let k = 0; k < 3; k++) spawnSlash([p.x, p.y, p.z], (k / 3) * Math.PI * 2 + i, color, 2);
          hitArea(p.x, p.z, AB.vortice.radius, { d: AB.vortice.dmg });
        });
      }
      emitAb(ctx, 'E');
      break;
    }
    case 'lama:R': {
      m.veilUntil = now + (AB.velo.dur + P('veloDurata')) * 1000;
      spawnPuff(ctx.x, ctx.y + 1, ctx.z, color);
      emitAb(ctx, 'R');
      break;
    }
    case 'lama:F': {
      const targets = [...combat.enemies.values()]
        .filter((e) => combat.targetable(e) && Math.hypot(e.x - ctx.x, e.z - ctx.z) <= AB.milleTagli.range)
        .sort((a, b) => Math.hypot(a.x - ctx.x, a.z - ctx.z) - Math.hypot(b.x - ctx.x, b.z - ctx.z))
        .slice(0, AB.milleTagli.max + P('milleTagliBersagli'));
      m.invulnUntil = now + targets.length * AB.milleTagli.every * 1000 + 400;
      const path: [number, number][] = [];
      targets.forEach((t, i) => {
        path.push([t.x, t.z]);
        later(i * AB.milleTagli.every * 1000, () => {
          const e = combat.enemies.get(t.id);
          if (!e) return;
          const yaw = Math.atan2(e.x - combat.selfPos.x, e.z - combat.selfPos.z);
          const bx = e.x - Math.sin(yaw) * (ENEMIES[e.type].radius + 0.9);
          const bz = e.z - Math.cos(yaw) * (ENEMIES[e.type].radius + 0.9);
          ctx.teleport(bx, bz);
          ctx.setYaw(yaw);
          ctx.attackAnim((i % 3) + 1, i % 3 === 2 ? 'spin' : 'swing');
          spawnSlash([bx, combat.selfPos.y, bz], yaw, color, (i % 3) + 1);
          const sc = scale(AB.milleTagli.dmg, 'ability', 'lama');
          hitEnemy(e, { d: sc.d, crit: true, noCharge: true });
        });
      });
      emitAb(ctx, 'F', { path });
      break;
    }

    // ---------------- Tessitore di Portali ----------------
    case 'tessitore:Q': {
      const yaw = Math.atan2(ctx.fx, ctx.fz);
      const a: [number, number] = [ctx.x + Math.sin(yaw) * 2, ctx.z + Math.cos(yaw) * 2];
      const b = aimPoint(ctx, AB.varco.dist, AB.varco.dist);
      const dur = (AB.varco.dur + P('varcoDurata')) * 1000;
      emitCombat({ t: 'zone', z: { id: zoneId(), kind: 'varco', owner: ctx.id, x: a[0], z: a[1], x2: b[0], z2: b[1], r: AB.varco.radius, dur } });
      emitAb(ctx, 'Q');
      break;
    }
    case 'tessitore:E': {
      const [x, z] = aimPoint(ctx, AB.trappola.dist, 8);
      const dmgMul = (1 + combat.mods.dmgPct) * (1 + combat.mods.abilityPct);
      emitCombat({
        t: 'zone',
        z: {
          id: zoneId(),
          kind: 'trappola',
          owner: ctx.id,
          x,
          z,
          r: AB.trappola.radius * (1 + P('trappolaRaggio')),
          dur: (AB.trappola.dur + P('trappolaDurata')) * 1000,
          dps: AB.trappola.dps * dmgMul,
          pull: AB.trappola.pull,
        },
      });
      emitAb(ctx, 'E');
      break;
    }
    case 'tessitore:R': {
      const { yaw } = aimYaw(ctx, 20);
      const dardo = scale(AB.dardo.dmg, 'ability', ctx.cls);
      ctx.setYaw(yaw);
      combat.bolts.push({
        x: ctx.x + Math.sin(yaw) * 0.6,
        z: ctx.z + Math.cos(yaw) * 0.6,
        y: ctx.y + 1.25,
        dx: Math.sin(yaw),
        dz: Math.cos(yaw),
        spd: AB.dardo.speed,
        dmg: dardo.d,
        born: now,
        life: 0.9,
        mine: true,
        color: '#b48cff',
        kind: 'dardo',
        bounces: AB.dardo.bounces + P('dardoRimbalzi'),
        hit: new Set(),
        alive: true,
        portalCd: 0,
        mul: 1,
        crit: dardo.crit,
      });
      emitAb(ctx, 'R', { r: yaw });
      break;
    }
    case 'tessitore:F': {
      const [x, z] = aimPoint(ctx, AB.collasso.dist, 9);
      const mul = (1 + combat.mods.dmgPct) * (1 + combat.mods.abilityPct) * (1 + P('collassoDanno'));
      emitCombat({
        t: 'zone',
        z: {
          id: zoneId(),
          kind: 'collasso',
          owner: ctx.id,
          x,
          z,
          r: AB.collasso.radius,
          dur: AB.collasso.dur * 1000,
          dps: AB.collasso.dps * mul,
          pull: AB.collasso.pull,
          finalDmg: AB.collasso.final * mul,
        },
      });
      emitAb(ctx, 'F');
      break;
    }

    // ---------------- Custode della Luce ----------------
    case 'custode:Q': {
      const target = nearestAlly(ctx, AB.raggio.range);
      const ticks = Math.round(AB.raggio.dur / AB.raggio.tick);
      const heal = AB.raggio.heal * (1 + combat.mods.healPct) * (1 + P('raggioCura'));
      for (let i = 0; i < ticks; i++) {
        later(i * AB.raggio.tick * 1000, () => {
          if (!combat.alive) return;
          if (target) emitCombat({ t: 'heal', to: target, amt: heal }, { to: target });
          else combat.healMe(heal);
          combat.addUltra(heal * ULTRA_GAIN.healed);
        });
      }
      const tp = target ? allyPos(target) : null;
      addBeam(ctx.id, target ?? ctx.id, '#ffd86b', AB.raggio.dur);
      lightNearbyZones(ctx, tp ?? undefined);
      emitAb(ctx, 'Q', { tid: target ?? ctx.id });
      break;
    }
    case 'custode:E': {
      hitArea(ctx.x, ctx.z, AB.rivelazione.radius, { d: 0, mk: (AB.rivelazione.dur + P('rivelazioneDurata')) * 1000, includeVeiled: true });
      spawnRing(ctx.x, ctx.z, '#ffe38a', AB.rivelazione.radius, 0.8);
      emitAb(ctx, 'E');
      break;
    }
    case 'custode:R': {
      emitCombat({
        t: 'bless',
        p: [ctx.x, ctx.z],
        r: AB.benedizione.radius,
        shield: AB.benedizione.shield * (1 + P('benedizioneScudo')),
        speed: AB.benedizione.speed,
        dur: AB.benedizione.dur,
      });
      spawnRing(ctx.x, ctx.z, '#ffd86b', AB.benedizione.radius, 0.7);
      lightNearbyZones(ctx);
      emitAb(ctx, 'R');
      break;
    }
    case 'custode:F': {
      emitCombat({ t: 'alba', p: [ctx.x, ctx.z], r: AB.alba.radius, heal: AB.alba.heal * (1 + combat.mods.healPct) * (1 + P('albaCura')) });
      hitArea(ctx.x, ctx.z, AB.alba.blindRadius, { d: 0, st: AB.alba.blind, includeVeiled: true });
      spawnFlash(ctx.x, ctx.z, '#fff3b0', 14, 0.55);
      emitAb(ctx, 'F');
      break;
    }
  }
  return true;
}

function nearestAlly(ctx: PlayerCtx, range: number): string | null {
  const room = getRoom();
  if (!room) return null;
  let best: string | null = null;
  let bestD = range;
  for (const [id, v] of room.vitals) {
    if (v.f & (VF.down | VF.dead)) continue;
    const d = Math.hypot(v.p[0] - ctx.x, v.p[2] - ctx.z);
    // preferisce chi è più ferito
    const score = d * (v.hp / Math.max(1, v.mhp) + 0.3);
    if (d <= range && score < bestD) {
      bestD = score;
      best = id;
    }
  }
  return best;
}

function allyPos(id: string): [number, number] | null {
  const v = getRoom()?.vitals.get(id);
  return v ? [v.p[0], v.p[2]] : null;
}

/** Combo Tessitore + Lama: la Lama attraversa un Varco e riappare alle spalle del nemico più vicino. */
export function onVarcoPass(ctx: PlayerCtx) {
  if (ctx.cls !== 'lama') return;
  let best: EnemyView | null = null;
  let bestD = 10;
  for (const e of combat.enemies.values()) {
    if (!combat.targetable(e)) continue;
    const d = Math.hypot(e.x - ctx.x, e.z - ctx.z);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  if (!best) return;
  const yaw = Math.atan2(best.x - ctx.x, best.z - ctx.z);
  const dist = bestD + ENEMIES[best.type].radius + 1;
  const free = ctx.freeDistance(Math.sin(yaw), Math.cos(yaw), dist);
  ctx.teleport(ctx.x + Math.sin(yaw) * free, ctx.z + Math.cos(yaw) * free);
  ctx.setYaw(yaw + Math.PI);
  nextMul = Math.max(nextMul, 2.5);
  nextCrit = true;
  combo('varcoOmbra', 'tessitore');
}

/** Effetti delle abilità degli altri giocatori. */
export function playRemoteAbility(from: string, msg: Extract<CombatMsg, { t: 'ab' }>) {
  const [x, y, z] = msg.p;
  const color = CLASSES[msg.cls].color;
  const key = `${msg.cls}:${msg.a}`;
  switch (key) {
    case 'guardiano:Q':
      spawnSlash([x, y, z], msg.r, '#9fc4ff', 2);
      break;
    case 'guardiano:E':
      spawnRing(x, z, '#ff4d4d', AB.provocazione.radius, 0.6);
      break;
    case 'guardiano:F':
      if (msg.to) spawnFlash(msg.to[0], msg.to[1], '#ffd25a', AB.bastione.blastRadius, 0.5);
      else spawnRing(x, z, '#ffd25a', AB.bastione.tauntRadius, 0.7);
      break;
    case 'lama:Q':
      for (const [px, pz] of msg.path ?? []) spawnPuff(px, y + 1, pz, color);
      break;
    case 'lama:E':
      for (let i = 0; i < 3; i++) setTimeout(() => {
        for (let k = 0; k < 3; k++) spawnSlash([x, y, z], (k / 3) * Math.PI * 2 + i, color, 2);
      }, i * 200);
      break;
    case 'lama:R':
      spawnPuff(x, y + 1, z, color);
      break;
    case 'lama:F':
      (msg.path ?? []).forEach(([px, pz], i) => setTimeout(() => spawnSlash([px, y, pz], i, color, (i % 3) + 1), i * AB.milleTagli.every * 1000));
      break;
    case 'tessitore:R':
      combat.bolts.push({
        x: x + Math.sin(msg.r) * 0.6,
        z: z + Math.cos(msg.r) * 0.6,
        y: y + 1.25,
        dx: Math.sin(msg.r),
        dz: Math.cos(msg.r),
        spd: AB.dardo.speed,
        dmg: 0,
        born: performance.now(),
        life: 0.9,
        mine: false,
        color: '#b48cff',
        kind: 'dardo',
        bounces: AB.dardo.bounces,
        hit: new Set(),
        alive: true,
        portalCd: 0,
        mul: 1,
        crit: false,
      });
      break;
    case 'custode:Q':
      addBeam(from, msg.tid ?? from, '#ffd86b', AB.raggio.dur);
      break;
    case 'custode:E':
      spawnRing(x, z, '#ffe38a', AB.rivelazione.radius, 0.8);
      break;
    case 'custode:R':
      spawnRing(x, z, '#ffd86b', AB.benedizione.radius, 0.7);
      break;
    case 'custode:F':
      spawnFlash(x, z, '#fff3b0', 14, 0.55);
      break;
  }
}

/** Dardo base di un altro giocatore (solo grafica: i colpi li conta lui). */
export function remoteBolt(cls: ClassId | null, p: [number, number, number], yaw: number) {
  const stats = CLASS_STATS[cls ?? 'none'];
  combat.bolts.push({
    x: p[0] + Math.sin(yaw) * 0.6,
    z: p[2] + Math.cos(yaw) * 0.6,
    y: p[1] + 1.25,
    dx: Math.sin(yaw),
    dz: Math.cos(yaw),
    spd: 26,
    dmg: 0,
    born: performance.now(),
    life: stats.reach / 26,
    mine: false,
    color: colorOf(cls),
    kind: 'basic',
    bounces: 0,
    hit: new Set(),
    alive: true,
    portalCd: 0,
    mul: 1,
    crit: false,
  });
}
