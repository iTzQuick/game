// Gli edifici della base sul bordo del Crocevia: fondamenta finché il gruppo
// non versa abbastanza frammenti, poi la costruzione vera.

import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { CylinderCollider, RigidBody } from '@react-three/rapier';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { BUILDINGS, BUILDING_RADIUS, type BuildingDef } from '../progress/defs';
import { useGame } from '../game/store';
import { stone } from '../player/materials';
import { PropOr } from '../player/models';
import { fadeByDistance } from './nearLabel';

export function Buildings() {
  return (
    <group>
      {BUILDINGS.map((b) => (
        <Building key={b.id} def={b} />
      ))}
    </group>
  );
}

function Building({ def }: { def: BuildingDef }) {
  const state = useGame((s) => s.room.base[def.id]);
  const built = !!state?.u;
  const x = Math.sin(def.angle) * BUILDING_RADIUS;
  const z = Math.cos(def.angle) * BUILDING_RADIUS;
  const glow = useMemo(
    () => new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide }),
    [def.color],
  );
  const spin = useRef<THREE.Group>(null);
  const label = useRef<HTMLDivElement>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    fadeByDistance(label.current, x, z, 10);
    glow.opacity = built ? 0.85 : 0.25 + Math.sin(t * 1.5 + def.angle) * 0.12;
    if (spin.current) spin.current.rotation.y = t * 0.6;
  });
  const progress = state?.p ?? 0;

  return (
    <group position={[x, 0, z]} rotation={[0, def.angle + Math.PI, 0]}>
      <RigidBody type="fixed" colliders={false}>
        <CylinderCollider args={[0.2, 2.2]} position={[0, 0.2, 0]} />
        {(built || def.later) && <CylinderCollider args={[1.2, 1.2]} position={[0, 1.4, 0.4]} />}
      </RigidBody>
      {/* fondamenta */}
      <mesh material={stone('#3d3747')} position={[0, 0.2, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[2.2, 2.4, 0.4, 8]} />
      </mesh>
      <mesh material={glow} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.42, 0]}>
        <ringGeometry args={[1.9, 2.05, 8]} />
      </mesh>
      {built || def.later ? (
        // modello 3D (Higgsfield) sulle fondamenta; l'Osservatorio c'è già, ma si apre più avanti
        <group position={[0, 0.4, 0]}>
          <PropOr name={def.id} fallback={built ? <BuiltShape def={def} glow={glow} spin={spin} /> : null} />
          {built && def.id === 'forgia' && <pointLight position={[0, 1.2, 1.8]} color={def.color} intensity={5} distance={6} />}
        </group>
      ) : (
        // pietre accatastate, in attesa
        <group>
          {[
            [-0.8, 0.6, 0.3, 0.45],
            [0.6, 0.55, -0.4, 0.35],
            [0.2, 0.75, 0.7, 0.3],
          ].map(([px, py, pz, s], i) => (
            <mesh key={i} material={stone('#4a4355')} position={[px, py, pz]} scale={s} castShadow>
              <dodecahedronGeometry args={[1, 0]} />
            </mesh>
          ))}
        </group>
      )}
      <Html position={[0, built ? 3.6 : def.later ? 4.4 : 2, 0]} center distanceFactor={10} zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
        <div ref={label} className={`altar-label near-label${built ? ' mine' : ''}`} style={{ borderColor: def.color, color: built ? def.color : undefined }}>
          {def.name}
          {!built && <small> · {def.later ? 'presto' : `${progress}/${def.cost}`}</small>}
        </div>
      </Html>
    </group>
  );
}

function BuiltShape({ def, glow, spin }: { def: BuildingDef; glow: THREE.Material; spin: React.RefObject<THREE.Group | null> }) {
  switch (def.id) {
    case 'forgia':
      return (
        <group>
          <mesh material={stone('#2c2733')} position={[0, 1.2, 0.5]} castShadow>
            <boxGeometry args={[1.8, 1.6, 1.4]} />
          </mesh>
          <mesh material={glow} position={[0, 1, 1.21]}>
            <planeGeometry args={[0.9, 0.7]} />
          </mesh>
          <mesh material={stone('#5d5866', 0.4)} position={[0, 0.85, -1.1]} castShadow>
            <boxGeometry args={[0.9, 0.35, 0.5]} />
          </mesh>
          <pointLight position={[0, 1.2, 1.6]} color={def.color} intensity={5} distance={6} />
        </group>
      );
    case 'giardino':
      return (
        <group>
          {[-0.9, 0, 0.9].map((px, i) => (
            <group key={i} position={[px, 0.4, 0.2 * (i - 1)]}>
              <mesh material={stone('#3a3443')} position={[0, 0.25, 0]}>
                <boxGeometry args={[0.7, 0.5, 0.7]} />
              </mesh>
              <mesh material={glow} position={[0, 0.85, 0]}>
                <coneGeometry args={[0.25, 0.8, 5]} />
              </mesh>
            </group>
          ))}
        </group>
      );
    case 'biblioteca':
      return (
        <group>
          {[-1, 1].map((px) => (
            <mesh key={px} material={stone('#4f4760')} position={[px, 1.4, 0]} castShadow>
              <boxGeometry args={[0.4, 2.4, 1.2]} />
            </mesh>
          ))}
          <mesh material={stone('#4f4760')} position={[0, 2.75, 0]} castShadow>
            <boxGeometry args={[2.6, 0.35, 1.3]} />
          </mesh>
          <group ref={spin} position={[0, 1.5, 0]}>
            {[0, 1, 2].map((i) => (
              <mesh key={i} material={glow} position={[Math.cos((i / 3) * Math.PI * 2) * 0.5, i * 0.15, Math.sin((i / 3) * Math.PI * 2) * 0.5]}>
                <boxGeometry args={[0.3, 0.06, 0.22]} />
              </mesh>
            ))}
          </group>
        </group>
      );
    case 'trofei':
      return (
        <group>
          <mesh material={stone('#3d3747')} position={[0, 0.9, 0]} castShadow>
            <cylinderGeometry args={[0.6, 0.7, 1, 6]} />
          </mesh>
          <group ref={spin} position={[0, 1.9, 0]}>
            <mesh material={glow}>
              <octahedronGeometry args={[0.45, 0]} />
            </mesh>
          </group>
        </group>
      );
    default:
      return null;
  }
}
