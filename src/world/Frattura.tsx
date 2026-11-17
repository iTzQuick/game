// La Frattura: stanze di pietra sospese nel buio, collegate da corridoi.
// Le porte di energia si aprono quando la stanza è ripulita.

import { useFrame } from '@react-three/fiber';
import { Html, Sparkles, Stars } from '@react-three/drei';
import { CuboidCollider, CylinderCollider, RigidBody } from '@react-three/rapier';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { CORRIDOR_WIDTH, WALL_HEIGHT, generateDungeon, wallBoxes, type Dungeon } from '../combat/dungeon';
import { useGame, type Quality } from '../game/store';
import type { RunState } from '../net/roomLogic';
import { SkyBand } from './SkyBand';
import { SURFACES } from './textures';
import { SOMMERSA } from '../story/core';

/** Come appare una Frattura: quella del Crocevia o quella di un mondo. */
interface Theme {
  bg: string;
  fog: [string, number, number];
  hemi: [string, string, number];
  ambient: string;
  sun: string;
  sky: number;
  tints: string[];
  /** pavimento: corridoi, stanze pari, stanze dispari (colore semplice e tinta della texture) */
  floor: [string, string | undefined][];
  wall: [string, string | undefined];
  pillar: [string, string | undefined];
  water: boolean;
}

const THEMES: Record<'crocevia' | 'sommersa', Theme> = {
  crocevia: {
    bg: '#05040a',
    fog: ['#0d0818', 18, 70],
    hemi: ['#5a4a90', '#08040e', 0.8],
    ambient: '#8d7fc4',
    sun: '#c4ccff',
    sky: 0.45,
    tints: ['#2fd6a0', '#8fd14f', '#ff4f9a', '#b48cff', '#e9e4ff', '#19d3c5'],
    floor: [
      ['#2a2433', '#b9b0c8'],
      ['#352f42', undefined],
      ['#3a3346', '#f2ecfa'],
    ],
    wall: ['#4a4355', undefined],
    pillar: ['#4f4760', undefined],
    water: false,
  },
  // la Città Sommersa: pietra verde d'acqua, nebbia marina, un velo d'acqua sul pavimento
  sommersa: {
    bg: '#02121a',
    fog: ['#073440', 12, 58],
    hemi: ['#4fc6d0', '#021014', 0.9],
    ambient: '#6fd6d0',
    sun: '#a8f0ff',
    sky: 0.22,
    tints: ['#2fd6a0', '#19d3c5', '#4fb8ff', '#7cf2d0', '#2fa8d6', '#a0fff0'],
    floor: [
      ['#22343a', '#8fb5b5'],
      ['#2a3e44', '#a6cfc8'],
      ['#2f454b', '#b9e0d6'],
    ],
    wall: ['#3c5258', '#9fc4bd'],
    pillar: ['#41595f', '#a9d2c8'],
    water: true,
  },
};

export const themeOf = (world?: string): Theme => (world === SOMMERSA ? THEMES.sommersa : THEMES.crocevia);

export function useDungeon(run: RunState | null): Dungeon | null {
  const seed = run?.seed;
  const grado = run?.grado;
  return useMemo(() => (seed !== undefined && grado !== undefined ? generateDungeon(seed, grado) : null), [seed, grado]);
}

export function Frattura({ quality }: { quality: Quality }) {
  const run = useGame((s) => s.room.run);
  const d = useDungeon(run);
  const th = themeOf(run?.world);
  if (!d || !run) return null;
  return (
    <group>
      <color attach="background" args={[th.bg]} />
      <fog attach="fog" args={th.fog} />
      <Stars radius={120} depth={40} count={quality === 'bassa' ? 800 : th.water ? 900 : 2000} factor={4} fade speed={0.3} />
      <SkyBand dim={th.sky} />
      <hemisphereLight args={th.hemi} />
      <ambientLight intensity={0.2} color={th.ambient} />
      <directionalLight
        position={[-14, 26, 10]}
        intensity={1.2}
        color={th.sun}
        castShadow={quality !== 'bassa'}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-40}
        shadow-camera-right={40}
        shadow-camera-top={40}
        shadow-camera-bottom={-40}
      />
      <Geometry d={d} th={th} />
      {th.water && <Water d={d} />}
      {d.corridors.map((c) => (
        <Gate key={c.i} x={c.x} z={c.rect.z1} open={run.cleared > c.i} tint={th.tints[(c.i + 1) % th.tints.length]} />
      ))}
      {d.rooms.map((r) => (
        <RoomDecor key={r.i} d={d} i={r.i} quality={quality} active={run.fight === r.i} th={th} />
      ))}
      {run.phase === 'complete' && <ExitPortal x={d.rooms[d.rooms.length - 1].cx} z={d.rooms[d.rooms.length - 1].rect.z0 + 4} />}
    </group>
  );
}

function Geometry({ d, th }: { d: Dungeon; th: Theme }) {
  const walls = useMemo(() => wallBoxes(d), [d]);
  const floors = useMemo(
    () => [
      ...d.rooms.map((r) => ({ ...r.rect, tint: r.i })),
      ...d.corridors.map((c) => ({ ...c.rect, tint: -1 })),
    ],
    [d],
  );
  return (
    <group>
      <RigidBody type="fixed" colliders={false}>
        {floors.map((f, i) => (
          <CuboidCollider key={`f${i}`} args={[(f.x1 - f.x0) / 2 + 0.3, 0.5, (f.z1 - f.z0) / 2 + 0.3]} position={[(f.x0 + f.x1) / 2, -0.5, (f.z0 + f.z1) / 2]} />
        ))}
        {walls.map((w, i) => (
          <CuboidCollider key={`w${i}`} args={[w.hx, WALL_HEIGHT / 2 + 2, w.hz]} position={[w.x, WALL_HEIGHT / 2, w.z]} />
        ))}
        {d.rooms.flatMap((r) =>
          r.pillars.map((p, i) => <CylinderCollider key={`p${r.i}-${i}`} args={[p.h / 2, p.r]} position={[p.x, p.h / 2, p.z]} />),
        )}
      </RigidBody>

      {floors.map((f, i) => (
        <mesh key={`fm${i}`} position={[(f.x0 + f.x1) / 2, -0.5, (f.z0 + f.z1) / 2]} material={SURFACES.dungeonFloor(...th.floor[f.tint < 0 ? 0 : f.tint % 2 ? 2 : 1])} receiveShadow>
          <boxGeometry args={[f.x1 - f.x0, 1, f.z1 - f.z0]} />
        </mesh>
      ))}
      {walls.map((w, i) => (
        <mesh key={`wm${i}`} position={[w.x, WALL_HEIGHT / 2, w.z]} material={SURFACES.dungeonWall(...th.wall)} castShadow receiveShadow>
          <boxGeometry args={[w.hx * 2, WALL_HEIGHT, w.hz * 2]} />
        </mesh>
      ))}
      {d.rooms.flatMap((r) =>
        r.pillars.map((p, i) => (
          <mesh key={`pm${r.i}-${i}`} position={[p.x, p.h / 2, p.z]} material={SURFACES.dungeonWall(...th.pillar)} castShadow receiveShadow>
            <cylinderGeometry args={[p.r * 0.92, p.r, p.h, 7]} />
          </mesh>
        )),
      )}
    </group>
  );
}

function RoomDecor({ d, i, quality, active, th }: { d: Dungeon; i: number; quality: Quality; active: boolean; th: Theme }) {
  const r = d.rooms[i];
  const tint = th.tints[i % th.tints.length];
  const runeMat = useMemo(() => new THREE.MeshBasicMaterial({ color: tint, transparent: true, opacity: 0.3, depthWrite: false }), [tint]);
  useFrame(({ clock }) => {
    runeMat.opacity = active ? 0.45 + Math.sin(clock.elapsedTime * 5) * 0.2 : 0.22 + Math.sin(clock.elapsedTime + i) * 0.06;
    runeMat.color.set(active ? '#ff3d5e' : tint);
  });
  const crystals = useMemo(() => {
    const c = [
      [r.rect.x0 + 0.5, r.rect.z0 + 0.5],
      [r.rect.x1 - 0.5, r.rect.z0 + 0.5],
      [r.rect.x0 + 0.5, r.rect.z1 - 0.5],
      [r.rect.x1 - 0.5, r.rect.z1 - 0.5],
    ];
    return c;
  }, [r]);
  const minSide = Math.min(r.w, r.d);
  return (
    <group>
      <mesh material={runeMat} rotation={[-Math.PI / 2, 0, 0]} position={[r.cx, 0.02, r.cz]}>
        <ringGeometry args={[minSide * 0.3, minSide * 0.3 + 0.12, 64]} />
      </mesh>
      {r.kind === 'boss' && (
        <mesh material={runeMat} rotation={[-Math.PI / 2, 0, 0]} position={[r.cx, 0.02, r.cz]}>
          <ringGeometry args={[minSide * 0.42, minSide * 0.42 + 0.15, 6]} />
        </mesh>
      )}
      {crystals.map(([x, z], k) => (
        <mesh key={k} position={[x, WALL_HEIGHT + 0.5, z]}>
          <octahedronGeometry args={[0.35, 0]} />
          <meshBasicMaterial color={tint} />
        </mesh>
      ))}
      {quality !== 'bassa' && <pointLight position={[r.cx, 4, r.cz]} color={tint} intensity={quality === 'alta' ? 18 : 10} distance={minSide * 1.1} decay={1.6} />}
      {quality !== 'bassa' && (
        <Sparkles count={quality === 'alta' ? 50 : 25} scale={[r.w * 0.8, 4, r.d * 0.8]} position={[r.cx, 2, r.cz]} size={2} speed={0.2} opacity={0.5} color={tint} />
      )}
      {/* nella Città Sommersa: bolle che salgono */}
      {th.water && (
        <Sparkles
          count={quality === 'bassa' ? 18 : 40}
          scale={[r.w * 0.85, 6, r.d * 0.85]}
          position={[r.cx, 3, r.cz]}
          size={quality === 'bassa' ? 4 : 5}
          speed={0.9}
          noise={[0.2, 2.5, 0.2]}
          opacity={0.55}
          color="#d8fbff"
        />
      )}
    </group>
  );
}

/** Un velo d'acqua bassa sui pavimenti della Frattura: si muove piano e riflette le luci. */
function Water({ d }: { d: Dungeon }) {
  const rects = useMemo(() => [...d.rooms.map((r) => r.rect), ...d.corridors.map((c) => c.rect)], [d]);
  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#1f8f9a',
        emissive: '#0d5560',
        emissiveIntensity: 0.4,
        roughness: 0.12,
        metalness: 0.35,
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
      }),
    [],
  );
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    mat.opacity = 0.3 + Math.sin(t * 0.7) * 0.04;
    mat.emissiveIntensity = 0.35 + Math.sin(t * 1.3) * 0.08;
  });
  return (
    <group>
      {rects.map((r, i) => (
        <mesh key={i} material={mat} rotation={[-Math.PI / 2, 0, 0]} position={[(r.x0 + r.x1) / 2, 0.12, (r.z0 + r.z1) / 2]} renderOrder={1}>
          <planeGeometry args={[r.x1 - r.x0, r.z1 - r.z0]} />
        </mesh>
      ))}
    </group>
  );
}

function Gate({ x, z, open, tint }: { x: number; z: number; open: boolean; tint: string }) {
  const mat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: tint, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
    [tint],
  );
  useFrame(({ clock }) => {
    mat.opacity = 0.35 + Math.sin(clock.elapsedTime * 3) * 0.1;
  });
  if (open) return null;
  return (
    <group position={[x, 0, z]}>
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[CORRIDOR_WIDTH / 2, WALL_HEIGHT, 0.3]} position={[0, WALL_HEIGHT / 2, 0]} />
      </RigidBody>
      <mesh material={mat} position={[0, WALL_HEIGHT / 2, 0]}>
        <planeGeometry args={[CORRIDOR_WIDTH, WALL_HEIGHT]} />
      </mesh>
    </group>
  );
}

function ExitPortal({ x, z }: { x: number; z: number }) {
  const ring = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ring.current) ring.current.rotation.z = clock.elapsedTime * 0.8;
  });
  return (
    <group position={[x, 0, z]}>
      <mesh ref={ring} position={[0, 2.2, 0]}>
        <torusGeometry args={[1.8, 0.16, 8, 40]} />
        <meshBasicMaterial color="#ffd86b" />
      </mesh>
      <mesh position={[0, 2.2, 0]}>
        <circleGeometry args={[1.65, 32]} />
        <meshBasicMaterial color="#fff3b0" transparent opacity={0.35} side={THREE.DoubleSide} />
      </mesh>
      <pointLight position={[0, 2.2, 1]} color="#ffd86b" intensity={12} distance={12} />
      <Html position={[0, 4.6, 0]} center distanceFactor={14} style={{ pointerEvents: 'none' }}>
        <div className="portal-label" style={{ color: '#ffd86b', opacity: 0.9 }}>
          Verso il Crocevia
        </div>
      </Html>
    </group>
  );
}
