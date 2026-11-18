// Effetti visivi leggeri: fendenti, anelli, lampi, raggi e ping "guarda qui".
// Sono solo grafica: i colpi veri li calcola src/combat.

import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { displayName, getGame, useGame, type Ping } from '../game/store';
import { combat } from '../combat/runtime';
import { orbState } from '../combat/boons';
import { CITTA } from '../citta/core';

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

// --- scintille e schegge (colpi a segno, nemici che muoiono) ---------------------

interface Spark {
  life: number;
  max: number;
  p: THREE.Vector3;
  v: THREE.Vector3;
  s: number;
  color: THREE.Color;
}
const SPARKS = 180;
const sparks: Spark[] = Array.from({ length: SPARKS }, () => ({
  life: 0,
  max: 1,
  p: new THREE.Vector3(),
  v: new THREE.Vector3(),
  s: 1,
  color: new THREE.Color(),
}));
let sparkNext = 0;

/**
 * Schizzi di luce che volano via e ricadono. `dir` (opzionale) è la direzione del
 * colpo sul piano: le scintille partono soprattutto da quella parte.
 */
export function spawnSparks(x: number, y: number, z: number, color: string, n: number, power = 1, dir?: [number, number]) {
  for (let i = 0; i < n; i++) {
    const o = sparks[sparkNext];
    sparkNext = (sparkNext + 1) % SPARKS;
    const a = Math.random() * Math.PI * 2;
    const sp = (2.5 + Math.random() * 4.5) * power;
    let vx = Math.sin(a) * sp;
    let vz = Math.cos(a) * sp;
    if (dir) {
      vx = vx * 0.45 + dir[0] * sp * 0.9;
      vz = vz * 0.45 + dir[1] * sp * 0.9;
    }
    o.p.set(x, y, z);
    o.v.set(vx, (1.5 + Math.random() * 4) * power, vz);
    o.max = o.life = 0.35 + Math.random() * 0.35 * power;
    o.s = (0.035 + Math.random() * 0.045) * Math.min(1.25, power);
    o.color.set(color);
  }
}

function Sparks() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => new THREE.OctahedronGeometry(1, 0), []);
  const mat = useMemo(
    () => new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    [],
  );
  const m4 = useMemo(() => new THREE.Matrix4(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const sc = useMemo(() => new THREE.Vector3(), []);
  const c = useMemo(() => new THREE.Color(), []);
  useFrame((_, dtRaw) => {
    const im = ref.current;
    if (!im) return;
    const dt = Math.min(dtRaw, 0.1);
    let n = 0;
    for (const o of sparks) {
      if (o.life <= 0) continue;
      o.life -= dt;
      if (o.life <= 0) continue;
      o.v.y -= 14 * dt;
      o.v.multiplyScalar(1 - dt * 1.5);
      o.p.addScaledVector(o.v, dt);
      if (o.p.y < 0.05) {
        o.p.y = 0.05;
        o.v.y = Math.abs(o.v.y) * 0.3;
      }
      const k = o.life / o.max;
      // allungate nella direzione in cui volano
      q.setFromUnitVectors(UP, sc.copy(o.v).normalize());
      const len = Math.min(3, 1 + o.v.length() * 0.18);
      sc.set(o.s * k, o.s * len * k, o.s * k);
      m4.compose(o.p, q, sc);
      im.setMatrixAt(n, m4);
      im.setColorAt(n, c.copy(o.color).multiplyScalar(0.6 + k));
      n++;
    }
    im.count = n;
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
  });
  return <instancedMesh ref={ref} args={[geo, mat, SPARKS]} frustumCulled={false} />;
}
const UP = new THREE.Vector3(0, 1, 0);

// --- fumo e polvere (colpi caricati, atterraggi dei boss) ----------------------------

interface Puff {
  life: number;
  max: number;
  p: THREE.Vector3;
  v: THREE.Vector3;
  s0: number;
  s1: number;
  color: THREE.Color;
}
const SMOKE = 48;
const puffs: Puff[] = Array.from({ length: SMOKE }, () => ({ life: 0, max: 1, p: new THREE.Vector3(), v: new THREE.Vector3(), s0: 1, s1: 2, color: new THREE.Color() }));
let puffNext = 0;

/** Colore della polvere dei colpi: sul fondo della Città Sommersa sono nuvole di bolle chiare. */
export const dustColor = () => (getGame().room.run?.mondo === CITTA ? '#cdf6ff' : '#8f8576');

/** Nuvole di fumo o polvere che si allargano, salgono piano e svaniscono. */
export function spawnSmoke(x: number, y: number, z: number, n: number, size = 1, color = '#8f8576') {
  for (let i = 0; i < n; i++) {
    const o = puffs[puffNext];
    puffNext = (puffNext + 1) % SMOKE;
    const a = Math.random() * Math.PI * 2;
    const sp = (0.8 + Math.random() * 1.6) * size;
    o.p.set(x + Math.sin(a) * 0.3 * size, y + Math.random() * 0.3, z + Math.cos(a) * 0.3 * size);
    o.v.set(Math.sin(a) * sp, 0.4 + Math.random() * 0.7, Math.cos(a) * sp);
    o.max = o.life = 0.7 + Math.random() * 0.6;
    o.s0 = (0.5 + Math.random() * 0.4) * size;
    o.s1 = o.s0 * (2.2 + Math.random());
    o.color.set(color);
  }
}

function Smoke() {
  const refs = useRef<(THREE.Sprite | null)[]>([]);
  const tex = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grd = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    grd.addColorStop(0, 'rgba(255,255,255,0.9)');
    grd.addColorStop(0.5, 'rgba(255,255,255,0.35)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }, []);
  const mats = useMemo(() => puffs.map(() => new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })), [tex]);
  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.1);
    puffs.forEach((o, i) => {
      const sp = refs.current[i];
      if (!sp) return;
      if (o.life > 0) o.life -= dt;
      sp.visible = o.life > 0;
      if (!sp.visible) return;
      o.v.multiplyScalar(1 - dt * 2.2);
      o.p.addScaledVector(o.v, dt);
      const k = 1 - o.life / o.max;
      sp.position.copy(o.p);
      sp.scale.setScalar(o.s0 + (o.s1 - o.s0) * Math.sqrt(k));
      mats[i].color.copy(o.color);
      mats[i].opacity = 0.55 * (1 - k) * Math.min(1, k * 6);
    });
  });
  return (
    <>
      {puffs.map((_, i) => (
        <sprite key={i} ref={(el) => void (refs.current[i] = el)} material={mats[i]} visible={false} />
      ))}
    </>
  );
}

// --- fulmini (Scintilla del Crocevia) ---------------------------------------------

interface Zap {
  t: number;
  a: THREE.Vector3;
  b: THREE.Vector3;
  color: THREE.Color;
}
const ZAPS = 6;
const ZAP_LIFE = 0.22;
const ZAP_SEG = 9;
const zaps: Zap[] = Array.from({ length: ZAPS }, () => ({ t: 1, a: new THREE.Vector3(), b: new THREE.Vector3(), color: new THREE.Color() }));
let zapNext = 0;

/** Un fulmine a zig-zag da `a` a `b`. */
export function spawnZap(a: Vec3, b: Vec3, color: string) {
  const z = zaps[zapNext];
  zapNext = (zapNext + 1) % ZAPS;
  z.t = 0;
  z.a.set(...a);
  z.b.set(...b);
  z.color.set(color);
}

function Zaps() {
  const lines = useMemo(
    () =>
      zaps.map(() => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((ZAP_SEG + 1) * 3), 3));
        const m = new THREE.LineBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
        const l = new THREE.Line(g, m);
        l.frustumCulled = false;
        l.visible = false;
        return l;
      }),
    [],
  );
  const tmp = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.1);
    zaps.forEach((z, i) => {
      const l = lines[i];
      z.t += dt;
      l.visible = z.t < ZAP_LIFE;
      if (!l.visible) return;
      const pos = l.geometry.getAttribute('position') as THREE.BufferAttribute;
      // il zig-zag cambia a ogni fotogramma: sembra vivo
      for (let k = 0; k <= ZAP_SEG; k++) {
        const f = k / ZAP_SEG;
        tmp.lerpVectors(z.a, z.b, f);
        if (k > 0 && k < ZAP_SEG) {
          const j = 0.35 * Math.sin(Math.PI * f);
          tmp.x += (Math.random() - 0.5) * j;
          tmp.y += (Math.random() - 0.5) * j;
          tmp.z += (Math.random() - 0.5) * j;
        }
        pos.setXYZ(k, tmp.x, tmp.y, tmp.z);
      }
      pos.needsUpdate = true;
      const m = l.material as THREE.LineBasicMaterial;
      m.color.copy(z.color);
      m.opacity = 1 - z.t / ZAP_LIFE;
    });
  });
  return (
    <>
      {lines.map((l, i) => (
        <primitive key={i} object={l} />
      ))}
    </>
  );
}

// --- colpo in carica: cerchio a terra che si riempie, scintille che salgono, luce ------

/** Lo aggiorna LocalPlayer a ogni fotogramma: level -1 = non si carica. */
export const chargeFx = { level: -1, x: 0, y: 0, z: 0, color: '#ffd25a' };

function ChargeFx() {
  const ring = useRef<THREE.Mesh>(null);
  const fill = useRef<THREE.Mesh>(null);
  const light = useRef<THREE.PointLight>(null);
  const mats = useMemo(
    () => ({
      ring: new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
      fill: new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    }),
    [],
  );
  const nextEmber = useRef(0);
  useFrame(({ clock }) => {
    const l = chargeFx.level;
    const on = l >= 0;
    const t = clock.elapsedTime;
    for (const m of [ring.current, fill.current]) if (m) m.visible = on;
    if (light.current) light.current.visible = on;
    if (!on) return;
    const full = l >= 1;
    mats.ring.color.set(chargeFx.color);
    mats.fill.color.set(chargeFx.color);
    mats.ring.opacity = full ? 0.75 + Math.sin(t * 14) * 0.2 : 0.5;
    mats.fill.opacity = 0.18 + 0.3 * l;
    ring.current!.position.set(chargeFx.x, chargeFx.y + 0.06, chargeFx.z);
    ring.current!.rotation.z = t * 2;
    fill.current!.position.set(chargeFx.x, chargeFx.y + 0.05, chargeFx.z);
    fill.current!.scale.setScalar(Math.max(0.01, l));
    light.current!.position.set(chargeFx.x, chargeFx.y + 1.2, chargeFx.z);
    light.current!.color.set(chargeFx.color);
    light.current!.intensity = (full ? 6 + Math.sin(t * 14) * 2 : 4 * l) + 0.5;
    // scintille che salgono attorno, sempre più fitte
    const now = performance.now();
    if (now > nextEmber.current) {
      nextEmber.current = now + (full ? 45 : 110 - 60 * l);
      const a = Math.random() * Math.PI * 2;
      const r = 0.6 + Math.random() * 0.6;
      spawnSparks(chargeFx.x + Math.sin(a) * r, chargeFx.y + 0.2, chargeFx.z + Math.cos(a) * r, chargeFx.color, 1, 0.45 + 0.3 * l);
    }
  });
  return (
    <>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} material={mats.ring} visible={false}>
        <ringGeometry args={[1.25, 1.4, 6]} />
      </mesh>
      <mesh ref={fill} rotation={[-Math.PI / 2, 0, 0]} material={mats.fill} visible={false}>
        <circleGeometry args={[1.25, 32]} />
      </mesh>
      <pointLight ref={light} distance={6} decay={1.6} visible={false} />
    </>
  );
}

// --- Lune d'ombra: sfere che girano attorno al giocatore ---------------------------

function Orbs() {
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  const geo = useMemo(() => new THREE.SphereGeometry(0.2, 12, 8), []);
  const halo = useMemo(() => new THREE.SphereGeometry(0.38, 12, 8), []);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#d9c4ff', toneMapped: false }), []);
  const haloMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: '#7a5cff', transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }),
    [],
  );
  useFrame(() => {
    for (let i = 0; i < 4; i++) {
      const m = refs.current[i];
      if (!m) continue;
      m.visible = i < orbState.n;
      if (m.visible) m.position.set(orbState.pos[i].x, orbState.pos[i].y, orbState.pos[i].z);
    }
  });
  return (
    <>
      {[0, 1, 2, 3].map((i) => (
        <mesh key={i} ref={(el) => void (refs.current[i] = el)} geometry={geo} material={mat} visible={false}>
          <mesh geometry={halo} material={haloMat} />
        </mesh>
      ))}
    </>
  );
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
      <Sparks />
      <Zaps />
      <Orbs />
      <ChargeFx />
      <Smoke />
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
