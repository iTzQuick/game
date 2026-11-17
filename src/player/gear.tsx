// Armi e oggetti tenuti in mano dagli eroi 3D. I modelli generati arrivano
// senza oggetti (lo scheletro li toglie), quindi li aggiungiamo qui e li
// agganciamo alle ossa: seguono le animazioni da soli.
//
// Misure in metri. Ogni oggetto è costruito lungo +Y (manico in basso).

import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';

const std = (color: string, metalness = 0, roughness = 0.6) => new THREE.MeshStandardMaterial({ color, metalness, roughness });
const glow = (color: string, opacity = 1) =>
  new THREE.MeshBasicMaterial({ color, toneMapped: false, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });

const M = {
  steel: std('#c3cbe0', 0.55, 0.32),
  gold: std('#e6b54f', 0.6, 0.35),
  leather: std('#6b3b2a', 0, 0.8),
  wood: std('#7b4a2b', 0, 0.75),
  shield: std('#3f52b8', 0.1, 0.5),
  violet: std('#6d3fa0', 0.2, 0.5),
  teal: glow('#63f5df'),
  tealHalo: glow('#63f5df', 0.28),
  light: glow('#fff1a6'),
  lightHalo: glow('#ffe58a', 0.3),
  halo: glow('#ffd76a'),
};

export function Sword() {
  return (
    <group>
      <mesh material={M.leather} position={[0, 0, 0]}>
        <cylinderGeometry args={[0.022, 0.022, 0.13, 8]} />
      </mesh>
      <mesh material={M.gold} position={[0, -0.08, 0]}>
        <sphereGeometry args={[0.035, 10, 8]} />
      </mesh>
      <mesh material={M.gold} position={[0, 0.075, 0]}>
        <boxGeometry args={[0.22, 0.04, 0.06]} />
      </mesh>
      <mesh material={M.steel} position={[0, 0.42, 0]} castShadow>
        <boxGeometry args={[0.075, 0.62, 0.022]} />
      </mesh>
      <mesh material={M.steel} position={[0, 0.76, 0]} scale={[1, 1, 0.3]}>
        <coneGeometry args={[0.053, 0.1, 4]} />
      </mesh>
    </group>
  );
}

export function Shield() {
  // disco tondo blu con bordo e borchia d'oro; la faccia guarda verso +Z
  return (
    <group rotation={[Math.PI / 2, 0, 0]}>
      <mesh material={M.shield} castShadow>
        <cylinderGeometry args={[0.3, 0.3, 0.05, 20]} />
      </mesh>
      <mesh material={M.gold} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.3, 0.025, 6, 24]} />
      </mesh>
      <mesh material={M.gold} position={[0, 0.03, 0]}>
        <sphereGeometry args={[0.07, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
      </mesh>
      {[0, Math.PI / 2].map((r) => (
        <mesh key={r} material={M.gold} position={[0, 0.03, 0]} rotation={[0, r, 0]}>
          <boxGeometry args={[0.46, 0.012, 0.04]} />
        </mesh>
      ))}
    </group>
  );
}

export function Dagger() {
  return (
    <group>
      <mesh material={M.leather}>
        <cylinderGeometry args={[0.018, 0.018, 0.1, 8]} />
      </mesh>
      <mesh material={M.gold} position={[0, 0.06, 0]}>
        <boxGeometry args={[0.13, 0.03, 0.045]} />
      </mesh>
      <mesh material={M.steel} position={[0, 0.2, 0]} scale={[1, 1, 0.28]} castShadow>
        <octahedronGeometry args={[0.13, 0]} />
      </mesh>
    </group>
  );
}

/** Sfera di luce del Tessitore: galleggia e ruota davanti alla mano. */
export function Orb() {
  const g = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (!g.current) return;
    g.current.position.y = Math.sin(t * 2.4) * 0.03;
    g.current.rotation.set(t * 1.3, t * 1.9, 0);
  });
  return (
    <group ref={g}>
      <mesh material={M.teal}>
        <icosahedronGeometry args={[0.075, 1]} />
      </mesh>
      <mesh material={M.tealHalo}>
        <icosahedronGeometry args={[0.13, 1]} />
      </mesh>
    </group>
  );
}

/** Bastone della Custode, con il cristallo in cima (il manico è a y = 0). */
export function Staff() {
  return (
    <group>
      <mesh material={M.wood} position={[0, -0.12, 0]} castShadow>
        <cylinderGeometry args={[0.024, 0.03, 1.72, 7]} />
      </mesh>
      {[0, 1, 2].map((i) => (
        <mesh key={i} material={M.wood} position={[Math.cos((i * Math.PI * 2) / 3) * 0.06, 0.8, Math.sin((i * Math.PI * 2) / 3) * 0.06]} rotation={[Math.sin((i * Math.PI * 2) / 3) * 0.5, 0, -Math.cos((i * Math.PI * 2) / 3) * 0.5]}>
          <coneGeometry args={[0.018, 0.2, 5]} />
        </mesh>
      ))}
      <mesh material={M.light} position={[0, 0.86, 0]} scale={[0.7, 1.3, 0.7]}>
        <octahedronGeometry args={[0.08, 0]} />
      </mesh>
      <mesh material={M.lightHalo} position={[0, 0.86, 0]}>
        <sphereGeometry args={[0.14, 12, 8]} />
      </mesh>
    </group>
  );
}

const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const LEVEL = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));

/**
 * Aureola della Custode: va agganciata alla testa ma resta sempre orizzontale,
 * `height` metri sopra l'osso, anche quando lei si piega correndo o cade.
 */
export function Halo({ height = 0.36 }: { height?: number }) {
  const g = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const m = g.current;
    const parent = m?.parent;
    if (!m || !parent) return;
    parent.updateWorldMatrix(true, false);
    parent.getWorldPosition(tmpV);
    tmpV.y += height + Math.sin(clock.elapsedTime * 1.8) * 0.015;
    m.position.copy(parent.worldToLocal(tmpV));
    parent.getWorldQuaternion(tmpQ);
    m.quaternion.copy(tmpQ.invert().multiply(LEVEL));
  });
  return (
    <mesh ref={g} material={M.halo}>
      <torusGeometry args={[0.16, 0.016, 6, 28]} />
    </mesh>
  );
}
