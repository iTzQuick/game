// Il giocatore locale: movimento con la fisica (Rapier, character controller
// cinematico), telecamera in terza persona, schivata, attacco base e abilità,
// vita e caduta, passaggio tra Crocevia e Frattura. Invia la propria
// posizione (con vita e stati) agli altri ~20 volte al secondo.

import { useFrame, useThree } from '@react-three/fiber';
import { useRapier } from '@react-three/rapier';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { CLASSES, MOVE, NET, SPAWN } from '../game/constants';
import { consume, consumeLook, input, moveVector } from '../game/input';
import { addPing, advanceDialog, controlsBlocked, getGame, isTouchDevice, setGame, showEmote, toast, useGame } from '../game/store';
import { getRoom } from '../net/room';
import type { AnimState } from '../net/interpolation';
import { fratturaInteractables, nearestInteractable, RIFT } from '../world/layout';
import { CHARGE, basicAttack, castAbility, dodgeBoon, heavyAttack, onVarcoPass, perfectCounter, resetAbilities, tickAbilities, type PlayerCtx } from '../combat/abilities';
import { chargeFx, spawnRing } from '../fx/effects';
import { splashBig, splashStep } from '../fx/water';
import { BOON, boonLevel, boonsForRun, modsWithBoons } from '../combat/boons';
import { CLASS_STATS } from '../combat/defs';
import { checkpoint, generateDungeon } from '../combat/dungeon';
import type { AbilitySlot } from '../combat/protocol';
import { combat } from '../combat/runtime';
import { emitCombat } from '../combat/bus';
import { shakeOffset, slowMo, zoomAmount, zoomKick } from '../combat/feel';
import { sfx } from '../audio/sfx';
import { modsFor } from '../progress/store';
import { isBuilt } from '../progress/model';
import { Avatar, newPose, tickPose } from './Avatar';
import type { MoveStyle } from './moves';

/** Schivata perfetta: quanto dura il rallentatore e quanto rallenta il mondo. */
const PERFECT = { slowMs: 900, factor: 0.3 };

/** Fascio della telecamera: scarti laterali e verticali (metri) dal punto guardato. */
const CAM_RAYS: [number, number][] = [
  [0, 0],
  [0.45, 0],
  [-0.45, 0],
  [0, 0.35],
  [0, -0.3],
];

/** Ultimo avviso "la missione vieta le pozioni". */
let potionWarnAt = 0;

const CAPSULE_HALF = 0.5;
// un po' più larga del corpo: braccia, scudo e mantello non entrano nei muri
const CAPSULE_RADIUS = 0.44;
/** Il centro della capsula sta a questa altezza sopra i piedi. */
const FOOT_OFFSET = CAPSULE_HALF + CAPSULE_RADIUS;
/** Dove si torna al Crocevia dopo una Frattura: davanti alla crepa. */
const RETURN_SPOT: [number, number, number] = [RIFT.x * 0.78, 0.2, RIFT.z * 0.78];

export interface LocalDebug {
  pos: THREE.Vector3;
  yaw: number;
  camYaw: number;
  /** Solo per i test automatici: sposta il giocatore. */
  teleport?: (x: number, z: number) => void;
  /** Solo per i test automatici e le foto: gira la telecamera. */
  setCamYaw?: (yaw: number) => void;
  /** Solo per i test e le foto: telecamera (rotazione, inclinazione, distanza). */
  setCam?: (c: { yaw?: number; pitch?: number; dist?: number; heroYaw?: number }) => void;
}

/** Accesso per i test end-to-end e le statistiche. */
export const localDebug: LocalDebug = { pos: new THREE.Vector3(), yaw: 0, camYaw: 0 };

type Parts = {
  collider: import('@dimforge/rapier3d-compat').Collider;
  controller: import('@dimforge/rapier3d-compat').KinematicCharacterController;
};

export function LocalPlayer() {
  const { world, rapier } = useRapier();
  const camera = useThree((s) => s.camera);
  const selfId = useGame((s) => s.selfId);
  const selfName = useGame((s) => s.selfName);
  const classId = useGame((s) => s.room.classes[s.selfId] ?? null);
  const sensitivity = useGame((s) => s.settings.sensitivity);
  const inRunView = useGame((s) => !!s.room.run);
  const quality = useGame((s) => s.settings.quality);

  const group = useRef<THREE.Group>(null);
  const pose = useMemo(newPose, []);

  const sim = useMemo(
    () => ({
      pos: new THREE.Vector3(SPAWN[0], SPAWN[1], SPAWN[2]),
      vel: new THREE.Vector3(),
      vy: 0,
      yaw: Math.PI, // il personaggio guarda verso il centro (-Z)
      camYaw: 0, // telecamera alle sue spalle (+Z)
      camPitch: 0.32,
      camDist: 7,
      camPos: new THREE.Vector3(),
      grounded: false,
      dodgeLeft: 0,
      dodgeCd: 0,
      dodgeDir: new THREE.Vector3(),
      attackCd: 0,
      /** da quanto si tiene premuto l'attacco (s), -1 se non lo si tiene */
      holdT: -1,
      wasHeld: false,
      comboN: 0,
      comboTimer: 0,
      lastSend: 0,
      lastSent: { x: NaN, y: NaN, z: NaN, r: NaN, a: '' as AnimState | '', hp: NaN, f: NaN },
      prompt: '' as string,
      airTime: 0,
      // Frattura
      runKey: -1,
      wipes: 0,
      cleared: 0,
      cls: undefined as string | null | undefined,
      fwdX: 0,
      fwdZ: -1,
    }),
    [],
  );

  // Collider "libero" (senza corpo rigido): lo spostiamo noi a ogni frame.
  // Creato in un effetto (non in useMemo) perché StrictMode monta due volte.
  const partsRef = useRef<Parts | null>(null);

  useEffect(() => {
    const collider = world.createCollider(
      rapier.ColliderDesc.capsule(CAPSULE_HALF, CAPSULE_RADIUS).setTranslation(sim.pos.x, sim.pos.y + FOOT_OFFSET, sim.pos.z),
    );
    const controller = world.createCharacterController(0.04);
    controller.enableAutostep(0.5, 0.2, false);
    controller.enableSnapToGround(0.35);
    controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    controller.setSlideEnabled(true);
    partsRef.current = { collider, controller };
    return () => {
      partsRef.current = null;
      try {
        world.removeCharacterController(controller);
        world.removeCollider(collider, false);
      } catch {
        /* mondo già distrutto */
      }
    };
  }, [world, rapier, sim]);

  // Copia la posizione per i test e le statistiche (non serve a ogni frame).
  useEffect(() => {
    const id = setInterval(() => {
      localDebug.pos.copy(sim.pos);
      localDebug.yaw = sim.yaw;
      localDebug.camYaw = sim.camYaw;
    }, 100);
    return () => clearInterval(id);
  }, [sim]);

  const tmp = useMemo(
    () => ({
      fwd: new THREE.Vector3(),
      right: new THREE.Vector3(),
      wish: new THREE.Vector3(),
      target: new THREE.Vector3(),
      desiredCam: new THREE.Vector3(),
      ray: new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }),
      ndc: new THREE.Vector3(),
      shake: { x: 0, y: 0, z: 0, roll: 0 },
    }),
    [rapier],
  );

  /** Sposta il personaggio di colpo (Frattura, checkpoint, Varco, Scatto d'ombra). */
  const teleport = (x: number, z: number, y?: number) => {
    const parts = partsRef.current;
    const ny = y ?? sim.pos.y;
    sim.pos.set(x, ny, z);
    sim.vel.set(0, 0, 0);
    sim.vy = 0;
    sim.dodgeLeft = 0;
    parts?.collider.setTranslation({ x, y: ny + FOOT_OFFSET, z });
  };

  /** Spazio libero da muri e colonne in una direzione (raggio a metà altezza). */
  const freeDistance = (dx: number, dz: number, max: number): number => {
    const parts = partsRef.current;
    if (!parts) return max;
    const len = Math.hypot(dx, dz) || 1;
    tmp.ray.origin = { x: sim.pos.x, y: sim.pos.y + 1, z: sim.pos.z };
    tmp.ray.dir = { x: dx / len, y: 0, z: dz / len };
    const hit = world.castRay(tmp.ray, max, true, undefined, undefined, parts.collider);
    return hit ? Math.max(0, hit.timeOfImpact - 0.6) : max;
  };

  const ctx: PlayerCtx = useMemo(
    () => ({
      id: '',
      cls: null,
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
      fx: 0,
      fz: -1,
      autoAim: true,
      setYaw: (y: number) => {
        sim.yaw = y;
        ctx.yaw = y;
      },
      freeDistance,
      teleport: (x: number, z: number) => {
        teleport(x, z);
        ctx.x = x;
        ctx.z = z;
      },
      attackAnim: (n: number, style?: MoveStyle, slot?: AbilitySlot) => {
        pose.attackT = 0;
        pose.attackN = n;
        pose.attackSlot = slot ?? null;
        const cls = getGame().room.classes[getGame().selfId];
        pose.attackStyle = style ?? (cls && CLASSES[cls].ranged ? 'shoot' : 'swing');
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    localDebug.teleport = (x, z) => ctx.teleport(x, z);
    localDebug.setCam = (c) => {
      if (c.yaw !== undefined) sim.camYaw = c.yaw;
      if (c.pitch !== undefined) sim.camPitch = c.pitch;
      if (c.dist !== undefined) sim.camDist = c.dist;
      if (c.heroYaw !== undefined) sim.yaw = c.heroYaw;
    };
    localDebug.setCamYaw = (yaw) => {
      sim.camYaw = yaw;
    };
    combat.onVarcoPass = () => onVarcoPass(ctx);
    return () => {
      combat.onVarcoPass = null;
    };
  }, [ctx]);

  useFrame((_, dtRaw) => {
    const parts = partsRef.current;
    if (!parts) return;
    // fino a 10 fps il gioco resta in tempo reale; sotto, rallenta invece di "saltare"
    const dt = Math.min(dtRaw, 0.1);
    const now = performance.now();
    const blocked = controlsBlocked();
    const room = getRoom();
    const game = getGame();
    const run = game.room.run;
    const stats = CLASS_STATS[classId ?? 'none'];
    // bonus di talenti e oggetti, più i poteri scelti in questa Frattura
    boonsForRun(run && run.phase !== 'countdown' ? run.id : -1);
    const mods = modsWithBoons(modsFor(classId));
    combat.mods = mods;
    const maxHp = Math.round(stats.hp * (1 + mods.hpPct) + mods.hpFlat);

    // --- Crocevia ↔ Frattura, checkpoint, cambio classe ---
    const runKey = run && run.phase !== 'countdown' ? run.id : -1;
    if (sim.cls !== classId) {
      sim.cls = classId;
      combat.resetVitals(maxHp);
    } else if (combat.me.maxHp !== maxHp) {
      // nuovo oggetto o talento: la vita segue in proporzione
      const frac = combat.me.hp / Math.max(1, combat.me.maxHp);
      combat.me.maxHp = maxHp;
      if (combat.alive) combat.me.hp = Math.max(1, Math.round(maxHp * frac));
    }
    if (runKey !== sim.runKey) {
      const wasInRun = sim.runKey !== -1;
      sim.runKey = runKey;
      combat.clearWorld();
      resetAbilities();
      combat.resetVitals(maxHp);
      if (run && runKey !== -1) {
        // il Giardino della base regala una pozione a testa per ogni Frattura
        combat.me.potions = isBuilt(game.room, 'giardino') ? 1 : 0;
        const d = generateDungeon(run.seed, run.grado);
        combat.dungeon = d;
        const startRoom = run.cleared <= 1 && run.fight < 0 && run.wipes === 0 ? 0 : run.cleared;
        const [x, y, z] = checkpoint(d, startRoom);
        teleport(x, z, y);
        sim.yaw = Math.PI;
        sim.camYaw = 0;
        sim.wipes = run.wipes;
        sim.cleared = run.cleared;
      } else {
        combat.dungeon = null;
        if (wasInRun) {
          teleport(RETURN_SPOT[0], RETURN_SPOT[2], RETURN_SPOT[1]);
          sim.yaw = Math.atan2(-RETURN_SPOT[0], -RETURN_SPOT[2]);
          sim.camYaw = sim.yaw + Math.PI;
        }
      }
    } else if (run && runKey !== -1 && combat.dungeon) {
      if (run.wipes !== sim.wipes) {
        sim.wipes = run.wipes;
        const [x, y, z] = checkpoint(combat.dungeon, run.cleared);
        teleport(x, z, y);
        combat.clearWorld();
        const potions = combat.me.potions;
        combat.resetVitals(maxHp, true);
        combat.me.potions = potions;
        toast('Siete caduti tutti: si riparte dal checkpoint');
      }
      if (run.cleared !== sim.cleared) {
        sim.cleared = run.cleared;
        if (!combat.alive) {
          if (combat.me.dead) {
            const [x, y, z] = checkpoint(combat.dungeon, run.cleared);
            teleport(x, z, y);
          }
          combat.reviveMe(0.5);
        }
        toast(run.phase === 'complete' ? 'La Frattura si richiude: avete vinto!' : 'Stanza ripulita: la porta è aperta');
      }
    }
    const inRun = runKey !== -1;
    const alive = combat.alive;

    // --- telecamera: input ---
    const look = consumeLook();
    const sens = 0.0026 * sensitivity;
    sim.camYaw -= look.dx * sens;
    sim.camPitch = THREE.MathUtils.clamp(sim.camPitch + look.dy * sens, -0.35, 1.2);
    if (input.zoom) {
      sim.camDist = THREE.MathUtils.clamp(sim.camDist + input.zoom * 0.6, 3.5, 11);
      input.zoom = 0;
    }

    // --- dialoghi: il tasto di interazione manda avanti il testo ---
    if (game.dialog) {
      if (consume('interact')) advanceDialog();
    }

    // --- movimento ---
    const mv = alive ? moveVector() : { x: 0, y: 0 };
    tmp.fwd.set(-Math.sin(sim.camYaw), 0, -Math.cos(sim.camYaw));
    tmp.right.set(-tmp.fwd.z, 0, tmp.fwd.x);
    tmp.wish.set(0, 0, 0).addScaledVector(tmp.fwd, mv.y).addScaledVector(tmp.right, mv.x);
    const wishLen = Math.min(tmp.wish.length(), 1);
    if (wishLen > 0.001) tmp.wish.normalize();
    // "davanti" per la mira: dove ci si muove, altrimenti dove guarda la telecamera
    if (wishLen > 0.2) {
      sim.fwdX = tmp.wish.x;
      sim.fwdZ = tmp.wish.z;
    } else {
      sim.fwdX = tmp.fwd.x;
      sim.fwdZ = tmp.fwd.z;
    }

    sim.dodgeCd = Math.max(0, sim.dodgeCd - dt);
    sim.attackCd = Math.max(0, sim.attackCd - dt);
    sim.comboTimer = Math.max(0, sim.comboTimer - dt);

    // contesto per abilità e combattimento
    const touch = game.settings.touch === 'on' || (game.settings.touch === 'auto' && isTouchDevice());
    ctx.id = selfId;
    ctx.cls = classId;
    ctx.x = sim.pos.x;
    ctx.y = sim.pos.y;
    ctx.z = sim.pos.z;
    ctx.yaw = sim.yaw;
    ctx.fx = sim.fwdX;
    ctx.fz = sim.fwdZ;
    ctx.autoAim = touch || game.settings.autoAim;

    combat.tick(dt, now, {
      x: sim.pos.x,
      y: sim.pos.y,
      z: sim.pos.z,
      inRun,
      teleport: (x, z) => ctx.teleport(x, z),
    });
    tickAbilities(ctx);

    // schivata: scatto rapido con un attimo di invulnerabilità
    if (alive && !blocked && consume('dodge') && sim.dodgeCd <= 0 && sim.dodgeLeft <= 0) {
      sim.dodgeLeft = MOVE.dodgeTime;
      sim.dodgeCd = MOVE.dodgeCooldown * (1 - BOON.passo.cdr * boonLevel('passo'));
      combat.me.invulnUntil = Math.max(combat.me.invulnUntil, now + MOVE.dodgeIFrames * 1000);
      sfx.dodge();
      dodgeBoon(sim.pos.x, sim.pos.z);
      if (inRun) splashBig(sim.pos.x, sim.pos.z, 0.5);
      // schivata perfetta: proprio mentre un colpo stava per arrivare
      if (inRun && combat.perfectDodge(sim.pos.x, sim.pos.z, now)) {
        slowMo(PERFECT.slowMs, PERFECT.factor);
        combat.me.invulnUntil = Math.max(combat.me.invulnUntil, now + PERFECT.slowMs);
        perfectCounter();
        sfx.perfect();
        zoomKick(0.3);
        spawnRing(sim.pos.x, sim.pos.z, '#ffe9a8', 3, 0.5);
      }
      if (wishLen > 0.1) sim.dodgeDir.copy(tmp.wish);
      else sim.dodgeDir.set(Math.sin(sim.yaw), 0, Math.cos(sim.yaw));
      sim.yaw = Math.atan2(sim.dodgeDir.x, sim.dodgeDir.z);
      pose.dodgeT = 0;
      room?.emit({ t: 'act', a: 'dodge', p: [sim.pos.x, sim.pos.y, sim.pos.z], r: sim.yaw });
    }

    const ranged = classId ? CLASSES[classId].ranged : false;
    let speedTarget = stats.speed * (1 + mods.speedPct) * combat.me.speedMul * wishLen;
    if (sim.dodgeLeft > 0) {
      sim.dodgeLeft -= dt;
      sim.vel.copy(sim.dodgeDir).multiplyScalar(MOVE.dodgeSpeed);
    } else {
      if (pose.attackT >= 0 && !ranged) speedTarget *= 0.35; // rallenta mentre colpisce
      if (pose.charge >= 0) speedTarget *= 0.45; // e mentre carica il colpo
      const tx = tmp.wish.x * speedTarget;
      const tz = tmp.wish.z * speedTarget;
      const a = 1 - Math.exp(-MOVE.accel * dt * 0.25);
      sim.vel.x += (tx - sim.vel.x) * a;
      sim.vel.z += (tz - sim.vel.z) * a;
    }

    // attacco base: combo da 3 colpi (mischia) o colpo singolo (distanza)
    if (alive && !blocked && consume('attack') && sim.attackCd <= 0 && sim.dodgeLeft <= 0) {
      sim.comboN = ranged ? 1 : sim.comboTimer > 0 ? (sim.comboN % 3) + 1 : 1;
      sim.comboTimer = MOVE.attackComboWindow;
      sim.attackCd = ranged ? 0.42 : 0.26;
      ctx.yaw = sim.yaw;
      basicAttack(ctx, sim.comboN);
    }

    // attacco caricato: tenendo premuto l'arma si carica, lasciando parte il colpo
    const held = input.attackHeld && alive && !blocked && !!classId;
    if (held && !sim.wasHeld) sim.holdT = 0;
    sim.wasHeld = held;
    if (held && sim.holdT >= 0 && sim.dodgeLeft <= 0) {
      sim.holdT += dt;
      if (sim.holdT > CHARGE.start) {
        const level = Math.min(1, (sim.holdT - CHARGE.start) / CHARGE.full);
        if (pose.charge < 0) sfx.charge();
        if (level >= 1 && pose.charge < 1) {
          sfx.ready();
          spawnRing(sim.pos.x, sim.pos.z, classId ? CLASSES[classId].accent : '#ffd25a', 1.6, 0.35);
        }
        pose.charge = level;
      }
    } else if (pose.charge >= 0) {
      // lasciato il tasto: colpo; schivata, caduta o un menu: la carica si perde
      const level = pose.charge;
      pose.charge = -1;
      sim.holdT = -1;
      if (alive && !blocked && !input.attackHeld && sim.dodgeLeft <= 0) {
        ctx.x = sim.pos.x;
        ctx.z = sim.pos.z;
        ctx.yaw = sim.yaw;
        heavyAttack(ctx, level);
        sim.attackCd = 0.55;
        sim.comboTimer = 0;
      }
    } else if (!held) sim.holdT = -1;
    chargeFx.level = pose.charge;
    if (pose.charge >= 0) {
      chargeFx.x = sim.pos.x;
      chargeFx.y = sim.pos.y;
      chargeFx.z = sim.pos.z;
      chargeFx.color = classId ? CLASSES[classId].accent : '#ffd25a';
    }

    // abilità Q, E, R e Ultra F
    for (const slot of ['Q', 'E', 'R', 'F'] as AbilitySlot[]) {
      if (!consume(`ab${slot}` as 'abQ')) continue;
      if (!alive || blocked) continue;
      if (!classId) {
        toast('Scegli una classe per usare le abilità');
        continue;
      }
      ctx.x = sim.pos.x;
      ctx.z = sim.pos.z;
      ctx.yaw = sim.yaw;
      if (!castAbility(slot, ctx) && slot === 'F') toast('La Ultra non è ancora carica');
    }

    // pozione del Giardino
    if (consume('potion') && alive && !blocked && inRun) {
      // missione "senza pozioni": la prima pressione avvisa, la seconda beve
      const mis = game.room.run?.missione;
      const forbidden = mis?.obiettivo.tipo === 'senza_pozioni' && !mis.fallita;
      const now = performance.now();
      if (forbidden && now - potionWarnAt > 3000 && combat.me.potions > 0) {
        potionWarnAt = now;
        toast('La missione vieta le pozioni: premi di nuovo per bere lo stesso');
      } else if (combat.drinkPotion()) {
        toast('Pozione: +50% vita');
        const host = getRoom()?.hostId;
        if (forbidden && host) emitCombat({ t: 'mfail', k: 'pozione' }, { to: host });
      } else if (combat.me.potions <= 0) toast(isBuilt(game.room, 'giardino') ? 'Niente più pozioni in questa Frattura' : 'Le pozioni arrivano costruendo il Giardino');
    }

    // gravità
    sim.vy -= MOVE.gravity * dt;
    if (sim.grounded && sim.vy < 0) sim.vy = -2;
    if (!alive) {
      sim.vel.x *= 0.8;
      sim.vel.z *= 0.8;
    }

    const c = parts.collider;
    parts.controller.computeColliderMovement(c, { x: sim.vel.x * dt, y: sim.vy * dt, z: sim.vel.z * dt });
    const moved = parts.controller.computedMovement();
    sim.grounded = parts.controller.computedGrounded();
    const cp = c.translation();
    const nx = cp.x + moved.x;
    const ny = cp.y + moved.y;
    const nz = cp.z + moved.z;
    c.setTranslation({ x: nx, y: ny, z: nz });
    sim.pos.set(nx, ny - FOOT_OFFSET, nz);
    sim.airTime = sim.grounded ? 0 : sim.airTime + dt;

    // caduto nel vuoto: si torna al punto di partenza (o al checkpoint)
    if (sim.pos.y < MOVE.fallRespawnY) {
      if (inRun && combat.dungeon && run) {
        const [x, y, z] = checkpoint(combat.dungeon, run.cleared);
        teleport(x, z, y);
      } else {
        teleport(SPAWN[0], SPAWN[2], SPAWN[1]);
        sim.yaw = Math.PI;
        sim.camYaw = 0;
      }
      toast('Il vuoto ti ha restituito');
    }

    // orientamento del personaggio
    const hSpeed = Math.hypot(sim.vel.x, sim.vel.z);
    if (alive && sim.dodgeLeft <= 0 && pose.attackT < 0 && hSpeed > 0.4) {
      const targetYaw = Math.atan2(sim.vel.x, sim.vel.z);
      let d = targetYaw - sim.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      sim.yaw += d * Math.min(1, MOVE.turnSpeed * dt);
    }

    // animazione
    const anim: AnimState = !alive
      ? 'down'
      : sim.dodgeLeft > 0
        ? 'dodge'
        : sim.airTime > 0.35
          ? 'fall'
          : hSpeed > 0.5
            ? 'run'
            : 'idle';
    pose.anim = anim;
    pose.speed = hSpeed;
    if (inRun) splashStep('me', sim.pos.x, sim.pos.z, hSpeed);
    pose.flags = combat.flags(now);
    tickPose(pose, dt);
    const g = group.current!;
    g.position.copy(sim.pos);
    g.rotation.y = sim.yaw;
    combat.renderPos.set(selfId, { x: sim.pos.x, y: sim.pos.y, z: sim.pos.z });

    // --- telecamera: posizione con anti-collisione ---
    tmp.target.set(sim.pos.x, sim.pos.y + 1.55, sim.pos.z);
    const cosP = Math.cos(sim.camPitch);
    tmp.desiredCam.set(Math.sin(sim.camYaw) * cosP, Math.sin(sim.camPitch), Math.cos(sim.camYaw) * cosP);
    // non un raggio solo ma un fascio (centro e quattro lati): le colonne e i muri non
    // finiscono davanti all'obiettivo, e la telecamera si ferma un po' prima
    // sui colpi forti la telecamera si avvicina di scatto; caricando, piano piano
    let dist = sim.camDist * (1 - 0.22 * zoomAmount(dt)) * (1 - 0.08 * Math.max(0, pose.charge));
    const rx = Math.cos(sim.camYaw);
    const rz = -Math.sin(sim.camYaw);
    for (const [ox, oy] of CAM_RAYS) {
      tmp.ray.origin = { x: tmp.target.x + rx * ox, y: tmp.target.y + oy, z: tmp.target.z + rz * ox };
      tmp.ray.dir = { x: tmp.desiredCam.x, y: tmp.desiredCam.y, z: tmp.desiredCam.z };
      const hit = world.castRay(tmp.ray, dist, true, undefined, undefined, c);
      if (hit) dist = Math.max(1.2, hit.timeOfImpact - 0.45);
    }
    tmp.desiredCam.multiplyScalar(dist).add(tmp.target);
    if (sim.camPos.lengthSq() === 0 || sim.camPos.distanceTo(tmp.desiredCam) > 25) sim.camPos.copy(tmp.desiredCam);
    sim.camPos.lerp(tmp.desiredCam, 1 - Math.exp(-20 * dt));
    camera.position.copy(sim.camPos);
    // scossa dei colpi forti (non tocca la posizione "vera" della telecamera)
    const sh = shakeOffset(dt, tmp.shake);
    camera.position.x += sh.x;
    camera.position.y += sh.y;
    camera.position.z += sh.z;
    camera.lookAt(tmp.target);
    if (sh.roll) camera.rotateZ(sh.roll);

    // --- interazioni ---
    const list = inRun && combat.dungeon && run ? fratturaInteractables(combat.dungeon, run.phase === 'complete') : undefined;
    const near = alive ? nearestInteractable(sim.pos.x, sim.pos.z, list) : null;
    const label = near ? near.label() : '';
    if (label !== sim.prompt) {
      sim.prompt = label;
      setGame({ prompt: near ? { id: near.id, label } : null });
    }
    if (!blocked && consume('interact') && near) {
      near.act();
      if (document.pointerLockElement && near.id !== 'frattura' && near.id !== 'uscita') document.exitPointerLock?.();
    }

    // --- emote ---
    for (let e = 0; e < 4; e++) {
      if (consume(`emote${e}` as 'emote0')) {
        showEmote(selfId, e);
        if (e === 0) pose.waveT = 0;
        room?.emit({ t: 'emote', e });
      }
    }

    // --- ping "guarda qui" ---
    if (input.ping) {
      const { x, y } = input.ping;
      input.ping = null;
      tmp.ndc.set(x, y, 0.5).unproject(camera).sub(camera.position).normalize();
      tmp.ray.origin = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
      tmp.ray.dir = { x: tmp.ndc.x, y: tmp.ndc.y, z: tmp.ndc.z };
      const h = world.castRay(tmp.ray, 120, true, undefined, undefined, c);
      if (h) {
        const p: [number, number, number] = [
          camera.position.x + tmp.ndc.x * h.timeOfImpact,
          camera.position.y + tmp.ndc.y * h.timeOfImpact,
          camera.position.z + tmp.ndc.z * h.timeOfImpact,
        ];
        addPing(selfId, p, classId ? CLASSES[classId].color : '#8a8496');
        room?.emit({ t: 'ping', p });
      }
    }

    // input rimasti "premuti" mentre un menu era aperto: scartati
    if (blocked) {
      consume('attack');
      consume('dodge');
    }

    // --- rete ---
    if (room) {
      const ls = sim.lastSent;
      const f = combat.flags(now);
      const hp = Math.round(combat.me.hp);
      const changed =
        Math.abs(ls.x - sim.pos.x) > 0.01 ||
        Math.abs(ls.y - sim.pos.y) > 0.01 ||
        Math.abs(ls.z - sim.pos.z) > 0.01 ||
        Math.abs(ls.r - sim.yaw) > 0.01 ||
        ls.a !== anim ||
        ls.hp !== hp ||
        ls.f !== f;
      const hz = changed ? NET.stateHz : NET.idleHz;
      if (now - sim.lastSend >= 1000 / hz - 2) {
        sim.lastSend = now;
        Object.assign(ls, { x: sim.pos.x, y: sim.pos.y, z: sim.pos.z, r: sim.yaw, a: anim, hp, f });
        room.sendState({ p: [sim.pos.x, sim.pos.y, sim.pos.z], r: sim.yaw, a: anim, v: hSpeed, hp, mhp: combat.me.maxHp, f });
      }
    }
  });

  return (
    <group ref={group}>
      <Avatar pose={pose} classId={classId} playerId={selfId} name={selfName} isSelf />
      {/* nella Frattura una luce morbida segue l'eroe: non diventa una sagoma scura */}
      {inRunView && quality !== 'bassa' && <pointLight position={[0, 3.2, 1.6]} color="#fff1dc" intensity={5} distance={9} decay={1.5} />}
    </group>
  );
}

