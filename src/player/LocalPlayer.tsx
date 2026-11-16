// Il giocatore locale: movimento con la fisica (Rapier, character controller
// cinematico), telecamera in terza persona, schivata, attacco base (solo
// animazione per ora), interazioni, ping ed emote. Invia la propria posizione
// agli altri ~20 volte al secondo.

import { useFrame, useThree } from '@react-three/fiber';
import { useRapier } from '@react-three/rapier';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { CLASSES, MOVE, NET, SPAWN } from '../game/constants';
import { consume, consumeLook, input, moveVector } from '../game/input';
import { addPing, controlsBlocked, getGame, advanceDialog, setGame, showEmote, toast, useGame } from '../game/store';
import { spawnBolt, spawnSlash } from '../fx/effects';
import { getRoom } from '../net/room';
import type { AnimState } from '../net/interpolation';
import { nearestInteractable } from '../world/layout';
import { Avatar, newPose, tickPose } from './Avatar';
import { NEUTRAL } from './materials';

const CAPSULE_HALF = 0.5;
const CAPSULE_RADIUS = 0.38;
/** Il centro della capsula sta a questa altezza sopra i piedi. */
const FOOT_OFFSET = CAPSULE_HALF + CAPSULE_RADIUS;

export interface LocalDebug {
  pos: THREE.Vector3;
  yaw: number;
  camYaw: number;
}

/** Accesso in sola lettura per i test end-to-end e le statistiche. */
export const localDebug: LocalDebug = { pos: new THREE.Vector3(), yaw: 0, camYaw: 0 };

export function LocalPlayer() {
  const { world, rapier } = useRapier();
  const camera = useThree((s) => s.camera);
  const selfId = useGame((s) => s.selfId);
  const selfName = useGame((s) => s.selfName);
  const classId = useGame((s) => s.room.classes[s.selfId] ?? null);
  const sensitivity = useGame((s) => s.settings.sensitivity);

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
      comboN: 0,
      comboTimer: 0,
      lastSend: 0,
      lastSent: { x: NaN, y: NaN, z: NaN, r: NaN, a: '' as AnimState | '' },
      prompt: '' as string,
      airTime: 0,
    }),
    [],
  );

  // Collider "libero" (senza corpo rigido): lo spostiamo noi a ogni frame.
  // Creato in un effetto (non in useMemo) perché StrictMode monta due volte.
  const partsRef = useRef<{
    collider: import('@dimforge/rapier3d-compat').Collider;
    controller: import('@dimforge/rapier3d-compat').KinematicCharacterController;
  } | null>(null);

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
    }),
    [rapier],
  );

  useFrame((_, dtRaw) => {
    const parts = partsRef.current;
    if (!parts) return;
    // fino a 10 fps il gioco resta in tempo reale; sotto, rallenta invece di "saltare"
    const dt = Math.min(dtRaw, 0.1);
    const now = performance.now();
    const blocked = controlsBlocked();
    const room = getRoom();
    const color = classId ? CLASSES[classId].color : NEUTRAL;

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
    if (getGame().dialog) {
      if (consume('interact')) advanceDialog();
    }

    // --- movimento ---
    const mv = moveVector();
    tmp.fwd.set(-Math.sin(sim.camYaw), 0, -Math.cos(sim.camYaw));
    tmp.right.set(-tmp.fwd.z, 0, tmp.fwd.x);
    tmp.wish.set(0, 0, 0).addScaledVector(tmp.fwd, mv.y).addScaledVector(tmp.right, mv.x);
    const wishLen = Math.min(tmp.wish.length(), 1);
    if (wishLen > 0.001) tmp.wish.normalize();

    sim.dodgeCd = Math.max(0, sim.dodgeCd - dt);
    sim.attackCd = Math.max(0, sim.attackCd - dt);
    sim.comboTimer = Math.max(0, sim.comboTimer - dt);

    // schivata: scatto rapido con un attimo di invulnerabilità
    if (!blocked && consume('dodge') && sim.dodgeCd <= 0 && sim.dodgeLeft <= 0) {
      sim.dodgeLeft = MOVE.dodgeTime;
      sim.dodgeCd = MOVE.dodgeCooldown;
      if (wishLen > 0.1) sim.dodgeDir.copy(tmp.wish);
      else sim.dodgeDir.set(Math.sin(sim.yaw), 0, Math.cos(sim.yaw));
      sim.yaw = Math.atan2(sim.dodgeDir.x, sim.dodgeDir.z);
      pose.dodgeT = 0;
      room?.emit({ t: 'act', a: 'dodge', p: [sim.pos.x, sim.pos.y, sim.pos.z], r: sim.yaw });
    }

    let speedTarget = MOVE.speed * wishLen;
    if (sim.dodgeLeft > 0) {
      sim.dodgeLeft -= dt;
      sim.vel.copy(sim.dodgeDir).multiplyScalar(MOVE.dodgeSpeed);
    } else {
      if (pose.attackT >= 0 && !(classId && CLASSES[classId].ranged)) speedTarget *= 0.35; // rallenta mentre colpisce
      const tx = tmp.wish.x * speedTarget;
      const tz = tmp.wish.z * speedTarget;
      const a = 1 - Math.exp(-MOVE.accel * dt * 0.25);
      sim.vel.x += (tx - sim.vel.x) * a;
      sim.vel.z += (tz - sim.vel.z) * a;
    }

    // attacco base: combo da 3 colpi (mischia) o colpo singolo (distanza)
    if (!blocked && consume('attack') && sim.attackCd <= 0 && sim.dodgeLeft <= 0) {
      const ranged = classId ? CLASSES[classId].ranged : false;
      sim.comboN = ranged ? 1 : sim.comboTimer > 0 ? (sim.comboN % 3) + 1 : 1;
      sim.comboTimer = MOVE.attackComboWindow;
      sim.attackCd = ranged ? 0.42 : 0.24;
      if (wishLen > 0.1) sim.yaw = Math.atan2(tmp.wish.x, tmp.wish.z);
      else sim.yaw = Math.atan2(tmp.fwd.x, tmp.fwd.z); // colpisce dove guarda la telecamera
      pose.attackT = 0;
      pose.attackN = sim.comboN;
      const p: [number, number, number] = [sim.pos.x, sim.pos.y, sim.pos.z];
      if (ranged) spawnBolt(p, sim.yaw, color);
      else spawnSlash(p, sim.yaw, color, sim.comboN);
      room?.emit({ t: 'act', a: 'attack', n: sim.comboN, p, r: sim.yaw });
    }

    // gravità
    sim.vy -= MOVE.gravity * dt;
    if (sim.grounded && sim.vy < 0) sim.vy = -2;

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

    // caduto nel vuoto: il Crocevia lo riporta al punto di partenza
    if (sim.pos.y < MOVE.fallRespawnY) {
      sim.pos.set(SPAWN[0], SPAWN[1], SPAWN[2]);
      c.setTranslation({ x: SPAWN[0], y: SPAWN[1] + FOOT_OFFSET, z: SPAWN[2] });
      sim.vel.set(0, 0, 0);
      sim.vy = 0;
      sim.yaw = Math.PI;
      sim.camYaw = 0;
      toast('Il vuoto ti ha restituito al Crocevia');
    }

    // orientamento del personaggio
    const hSpeed = Math.hypot(sim.vel.x, sim.vel.z);
    if (sim.dodgeLeft <= 0 && pose.attackT < 0 && hSpeed > 0.4) {
      const targetYaw = Math.atan2(sim.vel.x, sim.vel.z);
      let d = targetYaw - sim.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      sim.yaw += d * Math.min(1, MOVE.turnSpeed * dt);
    }

    // animazione
    const anim: AnimState = sim.dodgeLeft > 0 ? 'dodge' : sim.airTime > 0.35 ? 'fall' : hSpeed > 0.5 ? 'run' : 'idle';
    pose.anim = anim;
    pose.speed = hSpeed;
    tickPose(pose, dt);
    const g = group.current!;
    g.position.copy(sim.pos);
    g.rotation.y = sim.yaw;

    // --- telecamera: posizione con anti-collisione ---
    tmp.target.set(sim.pos.x, sim.pos.y + 1.55, sim.pos.z);
    const cosP = Math.cos(sim.camPitch);
    tmp.desiredCam.set(Math.sin(sim.camYaw) * cosP, Math.sin(sim.camPitch), Math.cos(sim.camYaw) * cosP);
    let dist = sim.camDist;
    tmp.ray.origin = { x: tmp.target.x, y: tmp.target.y, z: tmp.target.z };
    tmp.ray.dir = { x: tmp.desiredCam.x, y: tmp.desiredCam.y, z: tmp.desiredCam.z };
    const hit = world.castRay(tmp.ray, dist, true, undefined, undefined, c);
    if (hit) dist = Math.max(1.2, hit.timeOfImpact - 0.25);
    tmp.desiredCam.multiplyScalar(dist).add(tmp.target);
    if (sim.camPos.lengthSq() === 0) sim.camPos.copy(tmp.desiredCam);
    sim.camPos.lerp(tmp.desiredCam, 1 - Math.exp(-20 * dt));
    camera.position.copy(sim.camPos);
    camera.lookAt(tmp.target);

    // --- interazioni ---
    const near = nearestInteractable(sim.pos.x, sim.pos.z);
    const label = near ? near.label() : '';
    if (label !== sim.prompt) {
      sim.prompt = label;
      setGame({ prompt: near ? { id: near.id, label } : null });
    }
    if (!blocked && consume('interact') && near) {
      near.act();
      if (document.pointerLockElement) document.exitPointerLock?.();
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
        addPing(selfId, p, color);
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
      const changed =
        Math.abs(ls.x - sim.pos.x) > 0.01 ||
        Math.abs(ls.y - sim.pos.y) > 0.01 ||
        Math.abs(ls.z - sim.pos.z) > 0.01 ||
        Math.abs(ls.r - sim.yaw) > 0.01 ||
        ls.a !== anim;
      const hz = changed ? NET.stateHz : NET.idleHz;
      if (now - sim.lastSend >= 1000 / hz - 2) {
        sim.lastSend = now;
        ls.x = sim.pos.x;
        ls.y = sim.pos.y;
        ls.z = sim.pos.z;
        ls.r = sim.yaw;
        ls.a = anim;
        room.sendState({ p: [sim.pos.x, sim.pos.y, sim.pos.z], r: sim.yaw, a: anim, v: hSpeed });
      }
    }
  });

  return (
    <group ref={group}>
      <Avatar pose={pose} classId={classId} playerId={selfId} name={selfName} isSelf />
    </group>
  );
}
