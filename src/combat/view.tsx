// Grafica del combattimento: nemici, preavvisi a terra, proiettili, zone
// delle abilità, numeri dei danni.

import { Billboard } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { spawnPuff, spawnRing } from '../fx/effects';
import { EF, ENEMIES, type EnemyType } from './defs';
import { combat, setDeathFx, type CZone } from './runtime';
import { ENEMY_MODELS, newCtrl } from '../player/RiggedModel';
import { ModelOr } from '../player/models';

const ENEMY_COLORS: Record<EnemyType, { body: string; eye: string }> = {
  ombra: { body: '#1d1630', eye: '#c9a6ff' },
  sciame: { body: '#0e2d33', eye: '#4fffe0' },
  riflesso: { body: '#d9d4ff', eye: '#ff6bd5' },
  bruto: { body: '#3b2a1e', eye: '#b6ff5c' },
  velato: { body: '#e9e4f5', eye: '#9fe8ff' },
  eco: { body: '#120d1c', eye: '#ffffff' },
};

setDeathFx((x, z, type) => {
  spawnPuff(x, 1, z, ENEMY_COLORS[type].eye);
  spawnRing(x, z, ENEMY_COLORS[type].eye, type === 'eco' ? 8 : 2.2, 0.5);
});

/** Ridisegna la lista quando cambiano gli id (non a ogni frame). */
function useIds<T>(read: () => T[], every = 150): T[] {
  const [ids, setIds] = useState<T[]>(read);
  useEffect(() => {
    const t = setInterval(() => {
      const next = read();
      setIds((cur) => (cur.length === next.length && cur.every((v, i) => v === next[i]) ? cur : next));
    }, every);
    return () => clearInterval(t);
  }, [read, every]);
  return ids;
}

const readEnemyIds = () => [...combat.enemies.keys()].sort((a, b) => a - b);
const readZoneIds = () => [...combat.zones.keys()].sort();

export function CombatView() {
  const enemyIds = useIds(readEnemyIds);
  const zoneIds = useIds(readZoneIds);
  return (
    <group>
      {enemyIds.map((id) => (
        <EnemyMesh key={id} id={id} />
      ))}
      {zoneIds.map((id) => (
        <ZoneMesh key={id} id={id} />
      ))}
      <Telegraphs />
      <Projectiles />
      <DamageNumbers />
    </group>
  );
}

// --- nemici -------------------------------------------------------------------

function EnemyMesh({ id }: { id: number }) {
  const type = combat.enemies.get(id)?.type ?? 'ombra';
  const def = ENEMIES[type];
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const stunRing = useRef<THREE.Group>(null);
  const hpFill = useRef<THREE.Mesh>(null);
  const hpGroup = useRef<THREE.Group>(null);
  const markRef = useRef<THREE.Mesh>(null);
  const tauntRef = useRef<THREE.Mesh>(null);
  const last = useRef({ x: 0, z: 0, speed: 0 });
  // modello 3D animato (Higgsfield) per i tipi che ce l'hanno
  const modelDef = ENEMY_MODELS[type];
  const [modelReady, setModelReady] = useState(false);
  const ctrl = useMemo(newCtrl, []);
  const wasCharging = useRef(false);

  const mats = useMemo(() => {
    const c = ENEMY_COLORS[type];
    const bodyMat = new THREE.MeshStandardMaterial({
      color: c.body,
      roughness: type === 'riflesso' ? 0.15 : 0.8,
      metalness: type === 'riflesso' ? 0.6 : 0.05,
      flatShading: true,
      transparent: type === 'velato',
      emissive: new THREE.Color('#000000'),
    });
    const eyeMat = new THREE.MeshBasicMaterial({ color: c.eye });
    const glowMat = new THREE.MeshBasicMaterial({ color: c.eye, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
    return { body: bodyMat, eye: eyeMat, glow: glowMat };
  }, [type]);

  useFrame((state, dt) => {
    const e = combat.enemies.get(id);
    const g = root.current;
    if (!g || !e) return;
    g.visible = e.ready;
    if (!e.ready) return;
    const now = performance.now();
    const t = state.clock.elapsedTime;
    const moved = Math.hypot(e.x - last.current.x, e.z - last.current.z) / Math.max(dt, 0.001);
    last.current.speed += (Math.min(moved, 10) - last.current.speed) * 0.2;
    last.current.x = e.x;
    last.current.z = e.z;
    g.position.set(e.x, 0, e.z);
    g.rotation.y = e.yaw;

    const b = body.current!;
    const stunned = (e.flags & EF.stun) !== 0;
    const charging = now < e.charging;
    const speed = last.current.speed;
    b.position.y = type === 'sciame' ? 0.35 + Math.sin(t * 6 + id) * 0.12 : Math.abs(Math.sin(t * 8 + id)) * 0.05 * Math.min(speed / 3, 1);
    b.rotation.x = stunned ? 0.35 : charging ? -0.25 : Math.min(speed / 6, 1) * 0.2;
    const pulse = charging ? 1 + Math.sin(now / 40) * 0.05 : 1;
    b.scale.setScalar(pulse);

    // lampo quando viene colpito, rosso mentre carica un attacco
    const flash = now - e.flash < 110;
    if (modelDef) {
      b.visible = !modelReady;
      ctrl.move = speed > 0.4 ? 'run' : 'idle';
      ctrl.speed = speed;
      ctrl.flash = flash ? 1 : 0;
      ctrl.charge = charging ? 0.6 + Math.sin(now / 50) * 0.3 : 0;
      if (charging && !wasCharging.current) ctrl.attack++;
      wasCharging.current = charging;
    }
    const enraged = (e.flags & EF.enraged) !== 0;
    mats.body.emissive.set(flash ? '#ffffff' : charging ? '#ff2a3d' : enraged ? '#5a0010' : '#000000');
    mats.body.emissiveIntensity = flash ? 0.9 : charging ? 0.6 + Math.sin(now / 50) * 0.3 : 0.6;
    if (type === 'velato') mats.body.opacity = e.flags & EF.veiled ? 0.13 + Math.sin(t * 3 + id) * 0.04 : 0.9;
    mats.eye.color.set(charging ? '#ff3344' : ENEMY_COLORS[type].eye);

    if (stunRing.current) {
      stunRing.current.visible = stunned;
      stunRing.current.rotation.y = t * 4;
    }
    if (markRef.current) markRef.current.visible = (e.flags & EF.mark) !== 0;
    if (tauntRef.current) tauntRef.current.visible = (e.flags & EF.taunt) !== 0;
    if (hpGroup.current && hpFill.current) {
      const frac = Math.max(0, e.hp / e.maxHp);
      hpGroup.current.visible = type !== 'eco' && frac < 0.999 && !(e.flags & EF.veiled);
      hpFill.current.scale.x = Math.max(0.001, frac);
      hpFill.current.position.x = -(1 - frac) * 0.6;
    }
  });

  const s = type === 'eco' ? 1.8 : type === 'bruto' ? 1.35 : type === 'sciame' ? 0.7 : 1;
  const headY = type === 'sciame' ? 0.9 : 1.6 * s;
  return (
    <group ref={root} visible={false}>
      {modelDef && <ModelOr def={modelDef} ctrl={ctrl} onReady={setModelReady} />}
      <group ref={body}>
        <EnemyBody type={type} mats={mats} s={s} />
      </group>
      <group ref={stunRing} position={[0, headY + 0.45, 0]} visible={false}>
        {[0, 1, 2].map((i) => (
          <mesh key={i} position={[Math.cos((i / 3) * Math.PI * 2) * 0.45, 0, Math.sin((i / 3) * Math.PI * 2) * 0.45]} material={mats.glow}>
            <octahedronGeometry args={[0.09, 0]} />
          </mesh>
        ))}
      </group>
      <Billboard position={[0, headY + 0.8, 0]}>
        <mesh ref={markRef} position={[-0.5, 0.3, 0]} visible={false}>
          <circleGeometry args={[0.16, 12]} />
          <meshBasicMaterial color="#ffd86b" />
        </mesh>
        <mesh ref={tauntRef} position={[0.5, 0.3, 0]} visible={false}>
          <circleGeometry args={[0.16, 3]} />
          <meshBasicMaterial color="#ff4d4d" />
        </mesh>
        <group ref={hpGroup} visible={false}>
          <mesh>
            <planeGeometry args={[1.28, 0.16]} />
            <meshBasicMaterial color="#120a1c" transparent opacity={0.85} depthWrite={false} />
          </mesh>
          <mesh ref={hpFill} position={[0, 0, 0.001]}>
            <planeGeometry args={[1.2, 0.1]} />
            <meshBasicMaterial color="#ff4f6d" depthWrite={false} />
          </mesh>
        </group>
      </Billboard>
      {def.radius > 0.9 && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
          <ringGeometry args={[def.radius * 0.95, def.radius * 1.05, 32]} />
          <meshBasicMaterial color={ENEMY_COLORS[type].eye} transparent opacity={0.3} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}

type EMats = { body: THREE.Material; eye: THREE.Material; glow: THREE.Material };

function Eyes({ y, z, gap, r, mat }: { y: number; z: number; gap: number; r: number; mat: THREE.Material }) {
  return (
    <>
      <mesh material={mat} position={[-gap, y, z]}>
        <sphereGeometry args={[r, 8, 6]} />
      </mesh>
      <mesh material={mat} position={[gap, y, z]}>
        <sphereGeometry args={[r, 8, 6]} />
      </mesh>
    </>
  );
}

function EnemyBody({ type, mats, s }: { type: EnemyType; mats: EMats; s: number }) {
  switch (type) {
    case 'sciame':
      return (
        <group position={[0, 0.9, 0]}>
          <mesh material={mats.body} scale={[0.32, 0.26, 0.7]} castShadow>
            <sphereGeometry args={[1, 10, 8]} />
          </mesh>
          <mesh material={mats.body} position={[0, 0, -0.75]} rotation={[-Math.PI / 2, 0, 0]}>
            <coneGeometry args={[0.16, 0.6, 6]} />
          </mesh>
          <Eyes y={0.08} z={0.5} gap={0.12} r={0.06} mat={mats.eye} />
        </group>
      );
    case 'riflesso':
      return (
        <group position={[0, 1.25, 0]}>
          <mesh material={mats.body} scale={[0.55, 1.1, 0.4]} castShadow>
            <octahedronGeometry args={[1, 0]} />
          </mesh>
          <Eyes y={0.45} z={0.22} gap={0.12} r={0.06} mat={mats.eye} />
          {[-1, 1].map((k) => (
            <mesh key={k} material={mats.body} position={[k * 0.75, 0.2, 0]} rotation={[0, 0, k * 0.5]} scale={[0.15, 0.45, 0.15]}>
              <octahedronGeometry args={[1, 0]} />
            </mesh>
          ))}
        </group>
      );
    case 'bruto':
      return (
        <group scale={s}>
          <mesh material={mats.body} position={[0, 0.95, 0]} scale={[1, 0.85, 0.9]} castShadow>
            <dodecahedronGeometry args={[0.75, 0]} />
          </mesh>
          <mesh material={mats.body} position={[0, 1.55, 0.35]} castShadow>
            <boxGeometry args={[0.55, 0.42, 0.5]} />
          </mesh>
          {[-1, 1].map((k) => (
            <group key={k}>
              <mesh material={mats.body} position={[k * 0.28, 1.9, 0.3]} rotation={[0.3, 0, -k * 0.5]}>
                <coneGeometry args={[0.09, 0.5, 5]} />
              </mesh>
              <mesh material={mats.body} position={[k * 0.82, 0.7, 0.15]} rotation={[0.2, 0, k * 0.15]} castShadow>
                <capsuleGeometry args={[0.2, 0.75, 3, 6]} />
              </mesh>
            </group>
          ))}
          <Eyes y={1.58} z={0.61} gap={0.13} r={0.06} mat={mats.eye} />
        </group>
      );
    case 'eco':
      return (
        <group scale={s}>
          <mesh material={mats.body} position={[0, 0.6, 0]} castShadow>
            <coneGeometry args={[0.6, 1.3, 9]} />
          </mesh>
          <mesh material={mats.body} position={[0, 1.15, 0]} castShadow>
            <capsuleGeometry args={[0.3, 0.3, 4, 10]} />
          </mesh>
          <mesh material={mats.body} position={[0, 1.7, 0]} castShadow>
            <sphereGeometry args={[0.34, 14, 10]} />
          </mesh>
          <Eyes y={1.72} z={0.29} gap={0.12} r={0.065} mat={mats.eye} />
          <mesh material={mats.glow} position={[0, 2.2, 0]} rotation={[Math.PI / 2 - 0.25, 0, 0]}>
            <torusGeometry args={[0.28, 0.035, 6, 20, Math.PI * 1.5]} />
          </mesh>
          {[-1, 1].map((k) => (
            <mesh key={k} material={mats.body} position={[k * 0.42, 1.05, 0.1]} rotation={[0.3, 0, k * 0.25]}>
              <capsuleGeometry args={[0.08, 0.5, 3, 6]} />
            </mesh>
          ))}
        </group>
      );
    case 'velato':
      return (
        <group>
          <mesh material={mats.body} position={[0, 0.75, 0]} castShadow>
            <coneGeometry args={[0.45, 1.5, 8]} />
          </mesh>
          <mesh material={mats.body} position={[0, 1.6, 0.05]} scale={[0.3, 0.38, 0.18]}>
            <sphereGeometry args={[1, 10, 8]} />
          </mesh>
          <Eyes y={1.65} z={0.2} gap={0.1} r={0.05} mat={mats.eye} />
        </group>
      );
    default:
      // Ombra
      return (
        <group>
          <mesh material={mats.body} position={[0, 0.72, 0]} castShadow>
            <coneGeometry args={[0.48, 1.45, 7]} />
          </mesh>
          <mesh material={mats.body} position={[0, 1.55, 0.08]} castShadow>
            <sphereGeometry args={[0.3, 9, 7]} />
          </mesh>
          <Eyes y={1.58} z={0.33} gap={0.11} r={0.055} mat={mats.eye} />
          {[-1, 1].map((k) => (
            <mesh key={k} material={mats.body} position={[k * 0.45, 0.95, 0.25]} rotation={[1.1, 0, k * 0.3]}>
              <coneGeometry args={[0.07, 0.7, 4]} />
            </mesh>
          ))}
        </group>
      );
  }
}

// --- preavvisi a terra ------------------------------------------------------------

const sectorCache = new Map<number, THREE.BufferGeometry>();
function sectorGeo(arc: number): THREE.BufferGeometry {
  const key = Math.round(arc * 100);
  let g = sectorCache.get(key);
  if (!g) {
    g = arc >= Math.PI * 1.99 ? new THREE.CircleGeometry(1, 40) : new THREE.CircleGeometry(1, 24, Math.PI / 2 - arc / 2, arc);
    g.rotateX(-Math.PI / 2);
    sectorCache.set(key, g);
  }
  return g;
}

const TELE_POOL = 20;

function Telegraphs() {
  const outer = useRef<(THREE.Mesh | null)[]>([]);
  const inner = useRef<(THREE.Mesh | null)[]>([]);
  const mats = useMemo(
    () =>
      Array.from({ length: TELE_POOL }, () => ({
        o: new THREE.MeshBasicMaterial({ color: '#ff2a3d', transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }),
        i: new THREE.MeshBasicMaterial({ color: '#ff2a3d', transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide }),
      })),
    [],
  );
  useFrame(() => {
    const now = performance.now();
    const list = combat.telegraphs.filter((t) => !t.done && (t.k === 'cone' || t.k === 'circle' || t.k === 'nova'));
    for (let i = 0; i < TELE_POOL; i++) {
      const o = outer.current[i];
      const n = inner.current[i];
      if (!o || !n) continue;
      const t = list[i];
      o.visible = n.visible = !!t;
      if (!t) continue;
      const arc = t.k === 'cone' ? t.arc : Math.PI * 2;
      const geo = sectorGeo(arc);
      if (o.geometry !== geo) o.geometry = geo;
      if (n.geometry !== geo) n.geometry = geo;
      const k = Math.min(1, (now - t.t0) / Math.max(1, t.t1 - t.t0));
      o.position.set(t.x, 0.05, t.z);
      n.position.set(t.x, 0.06, t.z);
      // il settore è disegnato attorno a -Z locale: lo giriamo verso la direzione del nemico
      o.rotation.y = n.rotation.y = t.r + Math.PI;
      o.scale.setScalar(t.rad);
      n.scale.setScalar(Math.max(0.01, t.rad * k));
      mats[i].i.opacity = 0.35 + k * 0.3;
    }
  });
  return (
    <group>
      {mats.map((m, i) => (
        <group key={i}>
          <mesh ref={(el) => void (outer.current[i] = el)} material={m.o} visible={false} />
          <mesh ref={(el) => void (inner.current[i] = el)} material={m.i} visible={false} />
        </group>
      ))}
    </group>
  );
}

// --- proiettili --------------------------------------------------------------------

const EP_POOL = 48;
const PB_POOL = 32;

function Projectiles() {
  const ep = useRef<THREE.InstancedMesh>(null);
  const pb = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);
  const epGeo = useMemo(() => new THREE.IcosahedronGeometry(0.22, 1), []);
  const pbGeo = useMemo(() => new THREE.IcosahedronGeometry(0.17, 1), []);
  const epMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ff3d8b' }), []);
  const pbMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ffffff' }), []);

  useFrame(() => {
    const now = performance.now();
    const a = ep.current;
    const b = pb.current;
    if (a) {
      let n = 0;
      for (const p of combat.eprojs) {
        if (n >= EP_POOL) break;
        dummy.position.set(p.x, 1.2, p.z);
        dummy.scale.setScalar(1 + Math.sin(now / 50 + n) * 0.15);
        dummy.updateMatrix();
        a.setMatrixAt(n, dummy.matrix);
        a.setColorAt(n, color.set(p.reflectedBy ? '#ffd86b' : '#ff3d8b'));
        n++;
      }
      a.count = n;
      a.instanceMatrix.needsUpdate = true;
      if (a.instanceColor) a.instanceColor.needsUpdate = true;
    }
    if (b) {
      let n = 0;
      for (const p of combat.bolts) {
        if (n >= PB_POOL) break;
        dummy.position.set(p.x, p.y, p.z);
        dummy.scale.setScalar(p.kind === 'dardo' ? 1.4 : 1);
        dummy.updateMatrix();
        b.setMatrixAt(n, dummy.matrix);
        b.setColorAt(n, color.set(p.color));
        n++;
      }
      b.count = n;
      b.instanceMatrix.needsUpdate = true;
      if (b.instanceColor) b.instanceColor.needsUpdate = true;
    }
  });
  return (
    <group>
      <instancedMesh ref={ep} args={[epGeo, epMat, EP_POOL]} frustumCulled={false} />
      <instancedMesh ref={pb} args={[pbGeo, pbMat, PB_POOL]} frustumCulled={false} />
    </group>
  );
}

// --- zone delle abilità ------------------------------------------------------------

function ZoneMesh({ id }: { id: string }) {
  const zone = combat.zones.get(id);
  const g = useRef<THREE.Group>(null);
  const spin = useRef<THREE.Group>(null);
  const mat = useMemo(() => {
    const color = zone?.kind === 'barriera' ? '#6fb3ff' : zone?.kind === 'varco' ? '#19d3c5' : '#7a5cff';
    return new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.25,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  }, [zone?.kind]);
  const dark = useMemo(() => new THREE.MeshBasicMaterial({ color: '#05020c', transparent: true, opacity: 0.85 }), []);

  useFrame((state) => {
    const z = combat.zones.get(id) as CZone | undefined;
    if (!z || !g.current) return;
    const t = state.clock.elapsedTime;
    const now = performance.now();
    const life = (now - z.born) / Math.max(1, z.until - z.born);
    const fadeIn = Math.min(1, (now - z.born) / 200);
    const fadeOut = Math.min(1, (z.until - now) / 300);
    const vis = fadeIn * fadeOut;
    if (z.lit) mat.color.set('#ffd86b');
    if (z.kind === 'barriera') mat.opacity = (0.16 + Math.sin(t * 3) * 0.04) * vis;
    else if (z.kind === 'varco') mat.opacity = 0.6 * vis;
    else mat.opacity = 0.35 * vis;
    if (spin.current) spin.current.rotation.y = t * (z.kind === 'collasso' ? 3 : 1.6);
    if (z.kind === 'collasso') {
      const core = spin.current?.children[0];
      if (core) core.scale.setScalar(0.4 + Math.min(1, life * 2) * 1.2);
    }
  });

  if (!zone) return null;
  if (zone.kind === 'barriera') {
    return (
      <group ref={g} position={[zone.x, 0, zone.z]}>
        <mesh material={mat}>
          <sphereGeometry args={[zone.r, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2]} />
        </mesh>
        <mesh material={mat} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
          <ringGeometry args={[zone.r - 0.15, zone.r, 48]} />
        </mesh>
      </group>
    );
  }
  if (zone.kind === 'varco') {
    const portal = (x: number, z: number, key: string) => (
      <group key={key} position={[x, 0, z]}>
        <group ref={key === 'a' ? spin : undefined}>
          <mesh material={mat} position={[0, 1.3, 0]}>
            <torusGeometry args={[1.0, 0.09, 8, 28]} />
          </mesh>
        </group>
        <mesh material={dark} position={[0, 1.3, 0]}>
          <circleGeometry args={[0.92, 24]} />
        </mesh>
        <mesh material={mat} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
          <ringGeometry args={[zone.r - 0.12, zone.r, 32]} />
        </mesh>
      </group>
    );
    return (
      <group ref={g}>
        {portal(zone.x, zone.z, 'a')}
        {zone.x2 !== undefined && zone.z2 !== undefined && portal(zone.x2, zone.z2, 'b')}
      </group>
    );
  }
  // trappola del vuoto / collasso
  return (
    <group ref={g} position={[zone.x, 0, zone.z]}>
      <mesh material={dark} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
        <circleGeometry args={[zone.r * (zone.kind === 'collasso' ? 0.35 : 0.55), 32]} />
      </mesh>
      <mesh material={mat} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
        <ringGeometry args={[zone.r - 0.2, zone.r, 48]} />
      </mesh>
      <group ref={spin}>
        {zone.kind === 'collasso' ? (
          <mesh material={dark} position={[0, 1.4, 0]}>
            <sphereGeometry args={[1, 20, 14]} />
          </mesh>
        ) : (
          <group />
        )}
        {[0, 1, 2, 3].map((i) => (
          <mesh key={i} material={mat} rotation={[-Math.PI / 2, 0, (i * Math.PI) / 2]} position={[0, 0.07 + (zone.kind === 'collasso' ? 1.4 : 0), 0]}>
            <ringGeometry args={[zone.r * 0.3, zone.r * 0.75, 24, 1, 0, Math.PI / 3]} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

// --- numeri dei danni (DOM sopra il canvas) ----------------------------------------

const NUM_POOL = 30;

function DamageNumbers() {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const nodes = useRef<HTMLDivElement[]>([]);
  const v = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    const parent = gl.domElement.parentElement;
    if (!parent) return;
    const layer = document.createElement('div');
    layer.className = 'dmg-layer';
    parent.appendChild(layer);
    nodes.current = Array.from({ length: NUM_POOL }, () => {
      const d = document.createElement('div');
      d.className = 'dmg-num';
      d.style.display = 'none';
      layer.appendChild(d);
      return d;
    });
    return () => layer.remove();
  }, [gl]);

  useFrame(() => {
    const now = performance.now();
    const list = combat.nums;
    const w = gl.domElement.clientWidth;
    const h = gl.domElement.clientHeight;
    for (let i = 0; i < NUM_POOL; i++) {
      const d = nodes.current[i];
      if (!d) continue;
      const n = list[list.length - 1 - i];
      if (!n) {
        d.style.display = 'none';
        continue;
      }
      const age = (now - n.t0) / 1000;
      v.set(n.x, n.y + age * 1.2, n.z).project(camera);
      if (v.z > 1) {
        d.style.display = 'none';
        continue;
      }
      d.style.display = 'block';
      d.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -50%) scale(${n.kind === 'crit' ? 1.35 : 1})`;
      d.style.opacity = String(Math.max(0, 1 - age));
      const text = n.text ?? (n.kind === 'heal' ? `+${n.v}` : n.kind === 'me' ? `-${n.v}` : String(n.v));
      if (d.textContent !== text) d.textContent = text;
      const cls = `dmg-num ${n.kind}`;
      if (d.className !== cls) d.className = cls;
    }
  });
  return null;
}
