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
import { CITTA, OSSIGENO, colonneBolle, type Colonna } from '../citta/core';
import { PropOr } from '../player/models';

const ROOM_TINTS = ['#2fd6a0', '#8fd14f', '#ff4f9a', '#b48cff', '#e9e4ff', '#19d3c5'];
const CITTA_TINTS = ['#5dffd0', '#2fd6a0', '#7fe8ff', '#19d3c5'];

export function useDungeon(run: RunState | null): Dungeon | null {
  const seed = run?.seed;
  const grado = run?.grado;
  return useMemo(() => (seed !== undefined && grado !== undefined ? generateDungeon(seed, grado) : null), [seed, grado]);
}

export function Frattura({ quality }: { quality: Quality }) {
  const run = useGame((s) => s.room.run);
  const d = useDungeon(run);
  if (!d || !run) return null;
  const citta = run.mondo === CITTA;
  const tints = citta ? CITTA_TINTS : ROOM_TINTS;
  return (
    <group>
      {citta ? (
        <>
          {/* sul fondo della Città: acqua verde-azzurra, luce che scende dalla superficie */}
          <color attach="background" args={['#03161d']} />
          <fog attach="fog" args={['#07303a', 10, 52]} />
          <SkyBand dim={0.7} file="citta-fondale.webp" />
          <hemisphereLight args={['#6fd8d0', '#03161d', 0.9]} />
          <ambientLight intensity={0.25} color="#7fe8ff" />
        </>
      ) : (
        <>
          <color attach="background" args={['#05040a']} />
          <fog attach="fog" args={['#0d0818', 18, 70]} />
          <Stars radius={120} depth={40} count={quality === 'bassa' ? 800 : 2000} factor={4} fade speed={0.3} />
          <SkyBand dim={0.45} />
          <hemisphereLight args={['#5a4a90', '#08040e', 0.8]} />
          <ambientLight intensity={0.2} color="#8d7fc4" />
        </>
      )}
      <directionalLight
        position={[-14, 26, 10]}
        intensity={citta ? 1.0 : 1.2}
        color={citta ? '#bff6ff' : '#c4ccff'}
        castShadow={quality !== 'bassa'}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-40}
        shadow-camera-right={40}
        shadow-camera-top={40}
        shadow-camera-bottom={-40}
      />
      <Geometry d={d} citta={citta} />
      {d.corridors.map((c) => (
        <Gate key={c.i} x={c.x} z={c.rect.z1} open={run.cleared > c.i} tint={tints[(c.i + 1) % tints.length]} />
      ))}
      {d.rooms.map((r) => (
        <RoomDecor key={r.i} d={d} i={r.i} quality={quality} active={run.fight === r.i} tints={tints} />
      ))}
      {citta && <CittaDecor d={d} quality={quality} />}
      {run.phase === 'complete' && <ExitPortal x={d.rooms[d.rooms.length - 1].cx} z={d.rooms[d.rooms.length - 1].rect.z0 + 4} />}
    </group>
  );
}

function Geometry({ d, citta }: { d: Dungeon; citta: boolean }) {
  const floor = citta ? SURFACES.cittaFloor : SURFACES.dungeonFloor;
  const wall = citta ? SURFACES.cittaWall : SURFACES.dungeonWall;
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
        <mesh key={`fm${i}`} position={[(f.x0 + f.x1) / 2, -0.5, (f.z0 + f.z1) / 2]} material={f.tint < 0 ? floor(citta ? '#264a4e' : '#2a2433', '#b9b0c8') : f.tint % 2 ? floor(citta ? '#2f5a5e' : '#3a3346', '#f2ecfa') : floor(citta ? '#2f5a5e' : '#352f42')} receiveShadow>
          <boxGeometry args={[f.x1 - f.x0, 1, f.z1 - f.z0]} />
        </mesh>
      ))}
      {walls.map((w, i) => (
        <mesh key={`wm${i}`} position={[w.x, WALL_HEIGHT / 2, w.z]} material={wall(citta ? '#3d6468' : '#4a4355')} castShadow receiveShadow>
          <boxGeometry args={[w.hx * 2, WALL_HEIGHT, w.hz * 2]} />
        </mesh>
      ))}
      {d.rooms.flatMap((r) =>
        r.pillars.map((p, i) => (
          <mesh key={`pm${r.i}-${i}`} position={[p.x, p.h / 2, p.z]} material={wall(citta ? '#45706f' : '#4f4760')} castShadow receiveShadow>
            <cylinderGeometry args={[p.r * 0.92, p.r, p.h, 7]} />
          </mesh>
        )),
      )}
    </group>
  );
}

function RoomDecor({ d, i, quality, active, tints }: { d: Dungeon; i: number; quality: Quality; active: boolean; tints: string[] }) {
  const r = d.rooms[i];
  const tint = tints[i % tints.length];
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

// --- Città Sommersa ------------------------------------------------------------------

/** Velo d'acqua sui pavimenti, colonne di bolle, il campanile nella stanza della Campana. */
function CittaDecor({ d, quality }: { d: Dungeon; quality: Quality }) {
  const colonne = useMemo(() => colonneBolle(d), [d]);
  const veil = useMemo(
    () => new THREE.MeshBasicMaterial({ color: '#5fe3d6', transparent: true, opacity: 0.1, depthWrite: false, blending: THREE.AdditiveBlending }),
    [],
  );
  useFrame(({ clock }) => {
    veil.opacity = 0.08 + Math.sin(clock.elapsedTime * 0.7) * 0.03;
  });
  const boss = d.rooms[d.rooms.length - 1];
  return (
    <group>
      {d.rooms.map((r) => (
        <mesh key={r.i} material={veil} rotation={[-Math.PI / 2, 0, 0]} position={[r.cx, 0.05, r.cz]}>
          <planeGeometry args={[r.w, r.d]} />
        </mesh>
      ))}
      {colonne.map((c, i) => (
        <BubbleColumn key={i} c={c} quality={quality} />
      ))}
      {/* il campanile senza campana, in fondo alla stanza del boss */}
      <group position={[boss.cx + boss.w * 0.3, 0, boss.rect.z0 + 3.2]}>
        <RigidBody type="fixed" colliders={false}>
          <CylinderCollider args={[3, 1.3]} position={[0, 3, 0]} />
        </RigidBody>
        <PropOr name="campanile" height={7} fallback={<CampanileShape />} />
      </group>
      {quality !== 'bassa' && (
        <Sparkles count={quality === 'alta' ? 120 : 60} scale={[40, 8, 140]} position={[0, 3, -60]} size={2.5} speed={0.15} opacity={0.35} color="#9ff6ff" />
      )}
    </group>
  );
}

function CampanileShape() {
  return (
    <group>
      <mesh position={[0, 2.5, 0]} material={SURFACES.cittaWall('#3d6468')} castShadow>
        <boxGeometry args={[2.4, 5, 2.4]} />
      </mesh>
      <mesh position={[0, 5.9, 0]} material={SURFACES.cittaWall('#45706f')} castShadow>
        <boxGeometry args={[2.6, 1.8, 2.6]} />
      </mesh>
    </group>
  );
}

const BUBBLE_GEO = new THREE.SphereGeometry(1, 8, 6);
const BUBBLE_MAT = new THREE.MeshBasicMaterial({ color: '#c9fbff', transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
const POOL_MAT = new THREE.MeshBasicMaterial({ color: '#7ff6ff', transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });

/** Una colonna di bolle: dove si riprende fiato. */
function BubbleColumn({ c, quality }: { c: Colonna; quality: Quality }) {
  const n = quality === 'bassa' ? 7 : 16;
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  const seeds = useMemo(() => Array.from({ length: n }, (_, i) => ({ p: (i * 0.618) % 1, a: i * 2.4, s: 0.06 + ((i * 37) % 10) / 100 })), [n]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    seeds.forEach((b, i) => {
      const m = refs.current[i];
      if (!m) return;
      const k = (t * 0.35 + b.p) % 1;
      const r = OSSIGENO.raggio * 0.55 * (0.4 + 0.6 * Math.sin(b.a + t));
      m.position.set(Math.cos(b.a + k * 3) * r, 0.2 + k * 5.5, Math.sin(b.a + k * 3) * r);
      m.scale.setScalar(b.s * (0.6 + k));
    });
  });
  return (
    <group position={[c.x, 0, c.z]}>
      <mesh material={POOL_MAT} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.07, 0]}>
        <ringGeometry args={[OSSIGENO.raggio * 0.75, OSSIGENO.raggio, 32]} />
      </mesh>
      <mesh material={POOL_MAT} position={[0, 2.8, 0]}>
        <cylinderGeometry args={[OSSIGENO.raggio * 0.5, OSSIGENO.raggio * 0.8, 5.6, 16, 1, true]} />
      </mesh>
      {seeds.map((_, i) => (
        <mesh key={i} ref={(m) => {
            refs.current[i] = m;
          }} geometry={BUBBLE_GEO} material={BUBBLE_MAT} />
      ))}
      {quality === 'alta' && <pointLight position={[0, 1.5, 0]} color="#7ff6ff" intensity={6} distance={7} />}
    </group>
  );
}
