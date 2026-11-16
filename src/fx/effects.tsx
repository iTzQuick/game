// Effetti visivi leggeri: dardi a distanza, fendenti, ping "guarda qui".
// Sono solo grafica: nella tappa 4 i colpi avranno anche danni.

import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { displayName, useGame, type Ping } from '../game/store';

type Vec3 = [number, number, number];

interface Bolt {
  active: boolean;
  t: number;
  o: THREE.Vector3;
  d: THREE.Vector3;
  color: THREE.Color;
}

interface Slash {
  active: boolean;
  t: number;
  p: THREE.Vector3;
  yaw: number;
  n: number;
  color: THREE.Color;
}

const BOLTS = 12;
const SLASHES = 8;
const bolts: Bolt[] = Array.from({ length: BOLTS }, () => ({
  active: false,
  t: 0,
  o: new THREE.Vector3(),
  d: new THREE.Vector3(),
  color: new THREE.Color(),
}));
const slashes: Slash[] = Array.from({ length: SLASHES }, () => ({
  active: false,
  t: 0,
  p: new THREE.Vector3(),
  yaw: 0,
  n: 1,
  color: new THREE.Color(),
}));

const BOLT_SPEED = 24;
const BOLT_LIFE = 0.5;
const SLASH_LIFE = 0.2;

export function spawnBolt(p: Vec3, yaw: number, color: string) {
  const b = bolts.find((x) => !x.active) ?? bolts[0];
  b.active = true;
  b.t = 0;
  b.d.set(Math.sin(yaw), 0, Math.cos(yaw));
  b.o.set(p[0], p[1] + 1.25, p[2]).addScaledVector(b.d, 0.6);
  b.color.set(color);
}

export function spawnSlash(p: Vec3, yaw: number, color: string, n: number) {
  const s = slashes.find((x) => !x.active) ?? slashes[0];
  s.active = true;
  s.t = 0;
  s.p.set(p[0], p[1] + 1.05, p[2]);
  s.yaw = yaw;
  s.n = n;
  s.color.set(color);
}

export function Effects() {
  const boltRefs = useRef<(THREE.Mesh | null)[]>([]);
  const slashRefs = useRef<(THREE.Mesh | null)[]>([]);
  const boltGeo = useMemo(() => new THREE.IcosahedronGeometry(0.16, 1), []);
  const slashGeo = useMemo(() => new THREE.RingGeometry(0.9, 1.35, 20, 1, -Math.PI / 3, (Math.PI * 2) / 3), []);
  const boltMats = useMemo(
    () => bolts.map(() => new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })),
    [],
  );
  const slashMats = useMemo(
    () =>
      slashes.map(
        () =>
          new THREE.MeshBasicMaterial({
            transparent: true,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          }),
      ),
    [],
  );

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    bolts.forEach((b, i) => {
      const m = boltRefs.current[i];
      if (!m) return;
      if (b.active) {
        b.t += dt;
        if (b.t > BOLT_LIFE) b.active = false;
      }
      m.visible = b.active;
      if (!b.active) return;
      m.position.copy(b.o).addScaledVector(b.d, b.t * BOLT_SPEED);
      const mat = boltMats[i];
      mat.color.copy(b.color);
      mat.opacity = 1 - b.t / BOLT_LIFE;
      m.scale.setScalar(1 + Math.sin(b.t * 40) * 0.2);
    });
    slashes.forEach((s, i) => {
      const m = slashRefs.current[i];
      if (!m) return;
      if (s.active) {
        s.t += dt;
        if (s.t > SLASH_LIFE) s.active = false;
      }
      m.visible = s.active;
      if (!s.active) return;
      const k = s.t / SLASH_LIFE;
      m.position.copy(s.p);
      // piano orizzontale per i colpi laterali, verticale per il fendente
      // (l'arco dell'anello è centrato sul suo asse +X locale)
      if (s.n === 1) m.rotation.set(0, s.yaw - Math.PI / 2, 0.6 - k * 1.2, 'YXZ');
      else m.rotation.set(-Math.PI / 2, 0, s.yaw - Math.PI / 2 - (k - 0.5) * 1.6, 'XYZ');
      m.scale.setScalar(s.n === 3 ? 0.8 + k * 0.6 : 1 + k * 0.25);
      const mat = slashMats[i];
      mat.color.copy(s.color);
      mat.opacity = 0.85 * (1 - k);
    });
  });

  return (
    <group>
      {bolts.map((_, i) => (
        <mesh key={`b${i}`} ref={(el) => void (boltRefs.current[i] = el)} geometry={boltGeo} material={boltMats[i]} visible={false} />
      ))}
      {slashes.map((_, i) => (
        <mesh key={`s${i}`} ref={(el) => void (slashRefs.current[i] = el)} geometry={slashGeo} material={slashMats[i]} visible={false} />
      ))}
      <Pings />
    </group>
  );
}

function Pings() {
  const pings = useGame((s) => s.pings);
  return (
    <>
      {pings.map((p) => (
        <PingMarker key={p.id} ping={p} />
      ))}
    </>
  );
}

function PingMarker({ ping }: { ping: Ping }) {
  const ring = useRef<THREE.Mesh>(null);
  const beam = useRef<THREE.Mesh>(null);
  const mats = useMemo(
    () => ({
      ring: new THREE.MeshBasicMaterial({
        color: ping.color,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
      beam: new THREE.MeshBasicMaterial({
        color: ping.color,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    }),
    [ping.color],
  );
  useFrame(() => {
    const age = (performance.now() - ping.t0) / 1000;
    const k = (age % 1) / 1;
    if (ring.current) {
      ring.current.scale.setScalar(0.4 + k * 1.6);
      mats.ring.opacity = (1 - k) * Math.max(0, 1 - age / 4);
    }
    if (beam.current) mats.beam.opacity = 0.35 * Math.max(0, 1 - age / 4);
  });
  return (
    <group position={ping.p}>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]} material={mats.ring}>
        <ringGeometry args={[0.7, 0.9, 32]} />
      </mesh>
      <mesh ref={beam} position={[0, 4, 0]} material={mats.beam}>
        <cylinderGeometry args={[0.08, 0.25, 8, 8, 1, true]} />
      </mesh>
      <Html position={[0, 2.2, 0]} center distanceFactor={12} style={{ pointerEvents: 'none' }}>
        <div className="ping-label" style={{ borderColor: ping.color }}>
          📍 {displayName(ping.by)}
        </div>
      </Html>
    </group>
  );
}
