// Effetti visivi leggeri: fendenti, anelli, lampi, raggi e ping "guarda qui".
// Sono solo grafica: i colpi veri li calcola src/combat.

import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { displayName, useGame, type Ping } from '../game/store';
import { combat } from '../combat/runtime';

type Vec3 = [number, number, number];

interface Slash {
  active: boolean;
  t: number;
  p: THREE.Vector3;
  yaw: number;
  n: number;
  color: THREE.Color;
}

const SLASHES = 8;
const slashes: Slash[] = Array.from({ length: SLASHES }, () => ({
  active: false,
  t: 0,
  p: new THREE.Vector3(),
  yaw: 0,
  n: 1,
  color: new THREE.Color(),
}));

const SLASH_LIFE = 0.2;

export function spawnSlash(p: Vec3, yaw: number, color: string, n: number) {
  const s = slashes.find((x) => !x.active) ?? slashes[0];
  s.active = true;
  s.t = 0;
  s.p.set(p[0], p[1] + 1.05, p[2]);
  s.yaw = yaw;
  s.n = n;
  s.color.set(color);
}

// --- anelli, lampi, sbuffi e raggi delle abilità -----------------------------

interface Ring {
  active: boolean;
  t: number;
  dur: number;
  x: number;
  z: number;
  r: number;
  color: THREE.Color;
}
interface Flash extends Ring {
  y: number;
}
interface Beam {
  from: string;
  to: string;
  color: string;
  until: number;
}

const RINGS = 10;
const FLASHES = 10;
const rings: Ring[] = Array.from({ length: RINGS }, () => ({ active: false, t: 0, dur: 1, x: 0, z: 0, r: 1, color: new THREE.Color() }));
const flashes: Flash[] = Array.from({ length: FLASHES }, () => ({ active: false, t: 0, dur: 1, x: 0, y: 0, z: 0, r: 1, color: new THREE.Color() }));
let beams: Beam[] = [];

/** Onda che si allarga a terra. */
export function spawnRing(x: number, z: number, color: string, r: number, dur: number) {
  const o = rings.find((q) => !q.active) ?? rings[0];
  Object.assign(o, { active: true, t: 0, dur, x, z, r });
  o.color.set(color);
}

/** Sfera di luce che si allarga (esplosioni, Alba). */
export function spawnFlash(x: number, z: number, color: string, r: number, dur: number) {
  const o = flashes.find((q) => !q.active) ?? flashes[0];
  Object.assign(o, { active: true, t: 0, dur, x, y: 1, z, r });
  o.color.set(color);
}

/** Piccolo sbuffo (teletrasporti, nemici che svaniscono). */
export function spawnPuff(x: number, y: number, z: number, color: string) {
  const o = flashes.find((q) => !q.active) ?? flashes[0];
  Object.assign(o, { active: true, t: 0, dur: 0.35, x, y, z, r: 1.1 });
  o.color.set(color);
}

/** Raggio tra due giocatori (Raggio curativo). */
export function addBeam(from: string, to: string, color: string, seconds: number) {
  beams = beams.filter((b) => b.from !== from);
  beams.push({ from, to, color, until: performance.now() + seconds * 1000 });
}

export function Effects() {
  const slashRefs = useRef<(THREE.Mesh | null)[]>([]);
  const slashGeo = useMemo(() => new THREE.RingGeometry(0.9, 1.35, 20, 1, -Math.PI / 3, (Math.PI * 2) / 3), []);
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

  const ringRefs = useRef<(THREE.Mesh | null)[]>([]);
  const flashRefs = useRef<(THREE.Mesh | null)[]>([]);
  const beamRef = useRef<THREE.Mesh>(null);
  const ringGeo = useMemo(() => new THREE.RingGeometry(0.92, 1, 48), []);
  const flashGeo = useMemo(() => new THREE.SphereGeometry(1, 16, 12), []);
  const beamGeo = useMemo(() => new THREE.CylinderGeometry(0.09, 0.09, 1, 8, 1, true), []);
  const additive = () =>
    new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
  const ringMats = useMemo(() => rings.map(additive), []);
  const flashMats = useMemo(() => flashes.map(additive), []);
  const beamMat = useMemo(additive, []);
  const tmpA = useMemo(() => new THREE.Vector3(), []);
  const tmpB = useMemo(() => new THREE.Vector3(), []);
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), []);

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.1);
    rings.forEach((o, i) => {
      const m = ringRefs.current[i];
      if (!m) return;
      if (o.active) {
        o.t += dt;
        if (o.t > o.dur) o.active = false;
      }
      m.visible = o.active;
      if (!o.active) return;
      const k = o.t / o.dur;
      m.position.set(o.x, 0.08, o.z);
      m.scale.setScalar(Math.max(0.01, o.r * (0.15 + 0.85 * Math.sqrt(k))));
      ringMats[i].color.copy(o.color);
      ringMats[i].opacity = 0.9 * (1 - k);
    });
    flashes.forEach((o, i) => {
      const m = flashRefs.current[i];
      if (!m) return;
      if (o.active) {
        o.t += dt;
        if (o.t > o.dur) o.active = false;
      }
      m.visible = o.active;
      if (!o.active) return;
      const k = o.t / o.dur;
      m.position.set(o.x, o.y, o.z);
      m.scale.setScalar(Math.max(0.01, o.r * (0.2 + 0.8 * k)));
      flashMats[i].color.copy(o.color);
      // dentro la sfera (la telecamera ci finisce dentro con l'Alba) il colore copre tutto: meglio tenue
      flashMats[i].opacity = (o.r > 6 ? 0.3 : 0.55) * (1 - k) * (1 - k);
    });
    // un solo raggio visibile alla volta basta (la Custode è una sola)
    const now = performance.now();
    beams = beams.filter((b) => b.until > now);
    const b = beams[0];
    const bm = beamRef.current;
    if (bm) {
      const a = b && combat.renderPos.get(b.from);
      const c = b && combat.renderPos.get(b.to);
      bm.visible = !!(a && c && b.from !== b.to);
      if (a && c && bm.visible) {
        tmpA.set(a.x, a.y + 1.3, a.z);
        tmpB.set(c.x, c.y + 1.1, c.z);
        const len = tmpA.distanceTo(tmpB);
        bm.position.copy(tmpA).add(tmpB).multiplyScalar(0.5);
        bm.scale.set(1 + Math.sin(now / 60) * 0.25, len, 1 + Math.sin(now / 60) * 0.25);
        bm.quaternion.setFromUnitVectors(up, tmpB.sub(tmpA).normalize());
        beamMat.color.set(b.color);
        beamMat.opacity = 0.75;
      }
    }

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
      {slashes.map((_, i) => (
        <mesh key={`s${i}`} ref={(el) => void (slashRefs.current[i] = el)} geometry={slashGeo} material={slashMats[i]} visible={false} />
      ))}
      {rings.map((_, i) => (
        <mesh
          key={`r${i}`}
          ref={(el) => void (ringRefs.current[i] = el)}
          geometry={ringGeo}
          material={ringMats[i]}
          rotation={[-Math.PI / 2, 0, 0]}
          visible={false}
        />
      ))}
      {flashes.map((_, i) => (
        <mesh key={`f${i}`} ref={(el) => void (flashRefs.current[i] = el)} geometry={flashGeo} material={flashMats[i]} visible={false} />
      ))}
      <mesh ref={beamRef} geometry={beamGeo} material={beamMat} visible={false} />
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
