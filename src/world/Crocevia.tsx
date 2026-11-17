// Il Crocevia: un'isola di pietra sospesa nel vuoto, con i portali spenti
// tutt'intorno, il Custode Muto al centro e gli altari delle quattro classi.

import { useFrame } from '@react-three/fiber';
import { Html, Sparkles, Stars } from '@react-three/drei';
import { CuboidCollider, CylinderCollider, RigidBody } from '@react-three/rapier';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { CLASSES, type ClassId } from '../game/constants';
import { useGame, type Quality } from '../game/store';
import { stone } from '../player/materials';
import { ALTARS, ISLAND_RADIUS, PILLARS, PORTALS, RIFT, seeded } from './layout';
import { Buildings } from './Buildings';
import { PropOr } from '../player/models';

/** Rumore ripetibile per posizione: i vertici condivisi restano attaccati. */
function hash3(x: number, y: number, z: number): number {
  const s = Math.sin(Math.round(x * 100) * 12.9898 + Math.round(y * 100) * 78.233 + Math.round(z * 100) * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

function jitter(geo: THREE.BufferGeometry, amount: number, keep: (v: THREE.Vector3) => boolean) {
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    if (keep(v)) continue;
    const n = hash3(v.x, v.y, v.z) - 0.5;
    const r = Math.hypot(v.x, v.z) || 1;
    v.x += (v.x / r) * n * amount;
    v.z += (v.z / r) * n * amount;
    v.y += (hash3(v.z, v.x, v.y) - 0.5) * amount * 0.6;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

export function Crocevia({ quality }: { quality: Quality }) {
  return (
    <group>
      <Sky quality={quality} />
      <Lights quality={quality} />
      <Island />
      <Custode quality={quality} />
      {ALTARS.map((a) => (
        <ClassAltar key={a.cls} cls={a.cls} x={a.x} z={a.z} quality={quality} />
      ))}
      {PORTALS.map((p) => (
        <Portal key={p.world.id} x={p.x} z={p.z} angle={p.angle} tint={p.world.tint} name={p.world.name} quality={quality} />
      ))}
      {PILLARS.map((p, i) => (
        <Pillar key={i} {...p} />
      ))}
      <Rift />
      <Buildings />
      <FloatingRocks count={quality === 'bassa' ? 14 : quality === 'media' ? 26 : 40} />
      <DistantRings />
    </group>
  );
}

function Sky({ quality }: { quality: Quality }) {
  return (
    <>
      <color attach="background" args={['#07060d']} />
      <fog attach="fog" args={['#140d24', 28, 125]} />
      <Stars radius={170} depth={50} count={quality === 'bassa' ? 1500 : 4000} factor={5} saturation={0.6} fade speed={0.4} />
      <Sparkles
        count={quality === 'bassa' ? 40 : quality === 'media' ? 110 : 220}
        scale={[48, 10, 48]}
        position={[0, 4, 0]}
        size={2.4}
        speed={0.25}
        opacity={0.55}
        color="#b9a4ff"
      />
    </>
  );
}

function Lights({ quality }: { quality: Quality }) {
  const shadows = quality !== 'bassa';
  const size = quality === 'alta' ? 2048 : 1024;
  return (
    <>
      <hemisphereLight args={['#6c5aa8', '#0a0612', 0.75]} />
      <ambientLight intensity={0.18} color="#8d7fc4" />
      <directionalLight
        position={[-18, 30, 12]}
        intensity={1.5}
        color="#c4ccff"
        castShadow={shadows}
        shadow-mapSize-width={size}
        shadow-mapSize-height={size}
        shadow-camera-left={-26}
        shadow-camera-right={26}
        shadow-camera-top={26}
        shadow-camera-bottom={-26}
        shadow-camera-near={1}
        shadow-camera-far={80}
        shadow-bias={-0.0005}
      />
    </>
  );
}

function Island() {
  const geos = useMemo(() => {
    const top = jitter(new THREE.CylinderGeometry(ISLAND_RADIUS, ISLAND_RADIUS - 3.5, 2.4, 44, 3), 1.6, (v) => v.y > 1.19);
    const under = jitter(new THREE.ConeGeometry(ISLAND_RADIUS - 3.6, 24, 18, 7), 3.2, (v) => v.y > 11.9);
    under.rotateX(Math.PI);
    const runeInner = new THREE.RingGeometry(3.55, 3.7, 72);
    const runeOuter = new THREE.RingGeometry(13.3, 13.45, 96);
    return { top, under, runeInner, runeOuter };
  }, []);

  const runeMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: '#7d5cff', transparent: true, opacity: 0.45, depthWrite: false }),
    [],
  );
  const leyMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: '#7d5cff', transparent: true, opacity: 0.22, depthWrite: false }),
    [],
  );
  useFrame(({ clock }) => {
    runeMat.opacity = 0.35 + Math.sin(clock.elapsedTime * 0.9) * 0.12;
    leyMat.opacity = 0.16 + Math.sin(clock.elapsedTime * 0.9 + 1.5) * 0.08;
  });

  // pietre del pavimento, sempre uguali per tutti
  const slabs = useMemo(() => {
    const rnd = seeded(7);
    const out: { x: number; z: number; r: number; s: number; c: string }[] = [];
    for (let i = 0; i < 70; i++) {
      const a = rnd() * Math.PI * 2;
      const d = 4.5 + rnd() * 15.5;
      out.push({ x: Math.sin(a) * d, z: Math.cos(a) * d, r: rnd() * Math.PI, s: 0.5 + rnd() * 1.1, c: rnd() > 0.5 ? '#4b4458' : '#3d3749' });
    }
    return out;
  }, []);

  return (
    <group>
      <RigidBody type="fixed" colliders={false}>
        <CylinderCollider args={[1.2, ISLAND_RADIUS - 0.4]} position={[0, -1.2, 0]} />
      </RigidBody>
      <mesh geometry={geos.top} material={stone('#47404f')} position={[0, -1.2, 0]} receiveShadow />
      <mesh geometry={geos.under} material={stone('#2a2531')} position={[0, -2.2 - 12, 0]} />
      <mesh geometry={geos.runeInner} material={runeMat} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} />
      <mesh geometry={geos.runeOuter} material={runeMat} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} />
      {PORTALS.map((p) => (
        <mesh key={p.world.id} material={leyMat} position={[Math.sin(p.angle) * 9.2, 0.021, Math.cos(p.angle) * 9.2]} rotation={[-Math.PI / 2, 0, p.angle]}>
          <planeGeometry args={[0.14, 10.6]} />
        </mesh>
      ))}
      {slabs.map((s, i) => (
        <mesh key={i} material={stone(s.c)} position={[s.x, 0.015, s.z]} rotation={[0, s.r, 0]} scale={[s.s, 1, s.s]} receiveShadow>
          <cylinderGeometry args={[1, 1, 0.05, 6]} />
        </mesh>
      ))}
    </group>
  );
}

function Custode({ quality }: { quality: Quality }) {
  const figure = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (figure.current) figure.current.position.y = 0.35 + Math.sin(clock.elapsedTime * 0.8) * 0.08;
  });
  const eyeMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#d9c8ff' }), []);
  return (
    <group>
      <RigidBody type="fixed" colliders={false}>
        <CylinderCollider args={[0.18, 2.4]} position={[0, 0.18, 0]} />
        <CylinderCollider args={[1.4, 0.9]} position={[0, 1.7, 0]} />
      </RigidBody>
      <mesh material={stone('#3a3443')} position={[0, 0.18, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[2.4, 2.6, 0.36, 10]} />
      </mesh>
      <group ref={figure}>
        {/* veste */}
        <mesh material={stone('#1c1726', 0.8)} position={[0, 1.3, 0]} castShadow>
          <coneGeometry args={[0.95, 2.6, 8]} />
        </mesh>
        {/* cappuccio */}
        <mesh material={stone('#1c1726', 0.8)} position={[0, 2.62, -0.05]} castShadow>
          <sphereGeometry args={[0.5, 8, 7]} />
        </mesh>
        {/* maschera pallida, senza bocca */}
        <mesh material={stone('#e6ddd2', 0.6)} position={[0, 2.58, 0.33]} scale={[0.27, 0.34, 0.12]}>
          <sphereGeometry args={[1, 10, 8]} />
        </mesh>
        <mesh material={eyeMat} position={[-0.09, 2.64, 0.45]}>
          <boxGeometry args={[0.09, 0.025, 0.02]} />
        </mesh>
        <mesh material={eyeMat} position={[0.09, 2.64, 0.45]}>
          <boxGeometry args={[0.09, 0.025, 0.02]} />
        </mesh>
      </group>
      {quality !== 'bassa' && <pointLight position={[0, 1.2, 1.4]} color="#9f7bff" intensity={6} distance={9} decay={1.6} />}
    </group>
  );
}

const EMBLEM_GEOS: Record<ClassId, () => THREE.BufferGeometry> = {
  guardiano: () => new THREE.CylinderGeometry(0.42, 0.42, 0.1, 6).rotateX(Math.PI / 2),
  lama: () => new THREE.OctahedronGeometry(0.42, 0).scale(0.38, 1.35, 0.14),
  tessitore: () => new THREE.TorusGeometry(0.36, 0.09, 8, 18),
  custode: () => new THREE.IcosahedronGeometry(0.38, 0),
};

function ClassAltar({ cls, x, z, quality }: { cls: ClassId; x: number; z: number; quality: Quality }) {
  const info = CLASSES[cls];
  const selfId = useGame((s) => s.selfId);
  const holder = useGame((s) => Object.entries(s.room.classes).find(([, c]) => c === cls)?.[0] ?? null);
  const holderName = useGame((s) => s.room.members.find((m) => m.id === holder)?.name);
  const mine = holder === selfId;
  const taken = holder !== null && !mine;

  const emblem = useRef<THREE.Mesh>(null);
  const geo = useMemo(() => EMBLEM_GEOS[cls](), [cls]);
  const mat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: info.color, emissive: info.color, emissiveIntensity: 1, roughness: 0.4, flatShading: true }),
    [info.color],
  );

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const m = emblem.current;
    if (!m) return;
    m.rotation.y = t * (mine ? 1.6 : 0.7);
    m.position.y = 1.75 + Math.sin(t * 1.3 + x) * 0.12;
    mat.emissiveIntensity = taken ? 0.12 : mine ? 1.8 : 0.7 + Math.sin(t * 2 + z) * 0.25;
    mat.color.set(taken ? '#555060' : info.color);
  });

  return (
    <group position={[x, 0, z]}>
      <RigidBody type="fixed" colliders={false}>
        <CylinderCollider args={[0.5, 0.72]} position={[0, 0.5, 0]} />
      </RigidBody>
      <mesh material={stone('#3d3747')} position={[0, 0.5, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.55, 0.75, 1, 6]} />
      </mesh>
      <mesh material={stone('#524a5e')} position={[0, 1.04, 0]}>
        <cylinderGeometry args={[0.68, 0.6, 0.1, 6]} />
      </mesh>
      <mesh ref={emblem} geometry={geo} material={mat} position={[0, 1.75, 0]} castShadow />
      {mine && quality !== 'bassa' && <pointLight position={[0, 1.8, 0]} color={info.color} intensity={4} distance={6} />}
      <Html position={[0, 2.55, 0]} center distanceFactor={7} zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
        <div className={`altar-label${taken ? ' taken' : ''}${mine ? ' mine' : ''}`} style={{ borderColor: info.color }}>
          <span>{info.icon}</span> {info.name}
          {taken && <small> · {holderName ?? '…'}</small>}
          {mine && <small> · tu</small>}
        </div>
      </Html>
    </group>
  );
}

function Portal({
  x,
  z,
  angle,
  tint,
  name,
  quality,
}: {
  x: number;
  z: number;
  angle: number;
  tint: string;
  name: string;
  quality: Quality;
}) {
  const ringGeo = useMemo(() => jitter(new THREE.TorusGeometry(2.35, 0.38, 5, 16), 0.18, () => false), []);
  // il velo dentro l'arco: rettangolo con la cima tonda (coordinate relative a y = 3)
  const archGeo = useMemo(() => {
    const w = 1.25;
    const shape = new THREE.Shape();
    shape.moveTo(-w, -1.9);
    shape.lineTo(w, -1.9);
    shape.lineTo(w, 0.45);
    shape.absarc(0, 0.45, w, 0, Math.PI, false);
    shape.lineTo(-w, -1.9);
    return new THREE.ShapeGeometry(shape, 16);
  }, []);
  const discMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#05040a', emissive: tint, emissiveIntensity: 0.08, roughness: 1, side: THREE.DoubleSide }),
    [tint],
  );
  const crackMat = useMemo(() => new THREE.MeshBasicMaterial({ color: tint, transparent: true, opacity: 0.5 }), [tint]);
  const shards = useRef<THREE.Group>(null);
  const shardData = useMemo(() => {
    const rnd = seeded(Math.round(angle * 1000) + 3);
    return Array.from({ length: 6 }, () => ({ a: rnd() * Math.PI * 2, r: 2.9 + rnd() * 0.9, y: rnd() * 1.2 - 0.6, s: 0.12 + rnd() * 0.18 }));
  }, [angle]);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    // un respiro debole: il portale è spento, non morto
    discMat.emissiveIntensity = 0.06 + Math.max(0, Math.sin(t * 0.6 + angle * 3)) ** 6 * 0.35;
    crackMat.opacity = 0.25 + Math.max(0, Math.sin(t * 0.6 + angle * 3)) ** 6 * 0.6;
    if (shards.current) shards.current.rotation.z = t * 0.08;
  });

  return (
    <group position={[x, 0, z]} rotation={[0, angle, 0]}>
      <RigidBody type="fixed" colliders={false}>
        <CylinderCollider args={[0.2, 3.2]} position={[0, 0.2, 0]} />
        <CuboidCollider args={[2.6, 2.7, 0.4]} position={[0, 3, 0]} />
      </RigidBody>
      <mesh material={stone('#3a3443')} position={[0, 0.2, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[3.2, 3.4, 0.4, 10]} />
      </mesh>
      {/* l'arco: modello 3D di Higgsfield, o le forme semplici se non c'è */}
      <group position={[0, 0.4, 0]}>
        <PropOr
          name="portale"
          fallback={
            <group>
              <mesh geometry={ringGeo} material={stone('#5a5266')} castShadow position={[0, 2.6, 0]} />
              {[-2.2, 2.2].map((px) => (
                <mesh key={px} material={stone('#4a4355')} position={[px, 0.5, 0]} castShadow>
                  <boxGeometry args={[0.9, 1.1, 0.9]} />
                </mesh>
              ))}
            </group>
          }
        />
      </group>
      <group position={[0, 3, 0]}>
        <mesh material={discMat} geometry={archGeo} />
        {/* le fratture */}
        {[
          [0.2, 0.3, 0.6, 2.6],
          [-0.4, -0.5, -0.9, 1.9],
          [0.7, -0.6, 0.25, 1.4],
        ].map(([cx, cy, rot, len], i) => (
          <mesh key={i} material={crackMat} position={[cx, cy, 0.02]} rotation={[0, 0, rot]}>
            <planeGeometry args={[0.05, len]} />
          </mesh>
        ))}
        <group ref={shards}>
          {shardData.map((s, i) => (
            <mesh key={i} material={stone('#5a5266')} position={[Math.cos(s.a) * s.r, Math.sin(s.a) * s.r, s.y]} scale={s.s} rotation={[s.a, s.a * 2, 0]}>
              <tetrahedronGeometry args={[1, 0]} />
            </mesh>
          ))}
        </group>
      </group>
      {quality === 'alta' && <pointLight position={[0, 2.5, -1.2]} color={tint} intensity={2} distance={7} />}
      <Html position={[0, 6, 0]} center distanceFactor={16} zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
        <div className="portal-label" style={{ color: tint }}>
          {name}
        </div>
      </Html>
    </group>
  );
}

/** La Frattura: una crepa verticale di luce. Pulsa quando si sta aprendo. */
function Rift() {
  const opening = useGame((s) => s.room.run?.phase === 'countdown');
  const grado = useGame((s) => s.room.grado);
  const group = useRef<THREE.Group>(null);
  const mat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: '#ff5fd2', transparent: true, opacity: 0.9, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }),
    [],
  );
  const shards = useMemo(() => {
    const rnd = seeded(99);
    let y = 0.2;
    let x = 0;
    return Array.from({ length: 9 }, () => {
      const h = 0.35 + rnd() * 0.35;
      const nx = (rnd() - 0.5) * 0.7;
      const s = { x: (x + nx) / 2, y: y + h / 2, h: Math.hypot(h, nx - x), rot: Math.atan2(nx - x, h), w: 0.08 + rnd() * 0.14 };
      x = nx;
      y += h;
      return s;
    });
  }, []);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    mat.opacity = opening ? 0.75 + Math.sin(t * 14) * 0.25 : 0.7 + Math.sin(t * 2.2) * 0.2;
    if (group.current) group.current.scale.x = opening ? 1.6 + Math.sin(t * 10) * 0.3 : 1 + Math.sin(t * 1.3) * 0.08;
  });
  const facing = Math.atan2(RIFT.x, RIFT.z);
  return (
    <group position={[RIFT.x, 0, RIFT.z]} rotation={[0, facing, 0]}>
      <group ref={group}>
        {shards.map((s, i) => (
          <mesh key={i} material={mat} position={[s.x, s.y, 0]} rotation={[0, 0, -s.rot]}>
            <planeGeometry args={[s.w, s.h]} />
          </mesh>
        ))}
      </group>
      <pointLight position={[0, 2, 1]} color="#ff5fd2" intensity={opening ? 14 : 6} distance={8} />
      <Sparkles count={30} scale={[2, 4, 2]} position={[0, 2, 0]} size={3} speed={opening ? 2 : 0.6} color="#ff8be0" />
      <Html position={[0, 5.4, 0]} center distanceFactor={14} zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
        <div className="portal-label" style={{ color: '#ff8be0', opacity: 0.85 }}>
          {opening ? 'La Frattura si apre…' : `Frattura · Grado ${grado}`}
        </div>
      </Html>
    </group>
  );
}

function Pillar({ x, z, h, fallen }: { x: number; z: number; h: number; fallen: boolean }) {
  if (fallen) {
    return (
      <group position={[x, 0.6, z]} rotation={[0, Math.atan2(x, z) + 0.6, Math.PI / 2]}>
        <RigidBody type="fixed" colliders={false}>
          <CylinderCollider args={[1.8, 0.62]} />
        </RigidBody>
        <mesh material={stone('#4a4355')} castShadow receiveShadow>
          <cylinderGeometry args={[0.6, 0.66, 3.6, 7]} />
        </mesh>
      </group>
    );
  }
  return (
    <group position={[x, 0, z]}>
      <RigidBody type="fixed" colliders={false}>
        <CylinderCollider args={[h / 2, 0.68]} position={[0, h / 2, 0]} />
      </RigidBody>
      <mesh material={stone('#4a4355')} position={[0, h / 2, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.6, 0.7, h, 7]} />
      </mesh>
      <mesh material={stone('#554d60')} position={[0, h + 0.08, 0]} rotation={[0.25, 0.4, 0.15]}>
        <cylinderGeometry args={[0.62, 0.6, 0.3, 7]} />
      </mesh>
    </group>
  );
}

function FloatingRocks({ count }: { count: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const data = useMemo(() => {
    const rnd = seeded(42);
    return Array.from({ length: count }, () => {
      const a = rnd() * Math.PI * 2;
      const d = 30 + rnd() * 55;
      return { x: Math.sin(a) * d, z: Math.cos(a) * d, y: -28 + rnd() * 50, s: 0.6 + rnd() * 3.6, ph: rnd() * 10, rs: (rnd() - 0.5) * 0.3 };
    });
  }, [count]);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const geo = useMemo(() => new THREE.DodecahedronGeometry(1, 0), []);

  useFrame(({ clock }) => {
    const m = ref.current;
    if (!m) return;
    const t = clock.elapsedTime;
    data.forEach((r, i) => {
      dummy.position.set(r.x, r.y + Math.sin(t * 0.3 + r.ph) * 0.8, r.z);
      dummy.rotation.set(r.ph + t * r.rs, r.ph * 2 + t * r.rs, 0);
      dummy.scale.setScalar(r.s);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  });

  return <instancedMesh ref={ref} args={[geo, stone('#3a3443'), count]} />;
}

/** Portali enormi e spezzati, lontanissimi: altri mondi, irraggiungibili. */
function DistantRings() {
  const group = useRef<THREE.Group>(null);
  const rings = useMemo(
    () => [
      { pos: [-90, 35, -110] as const, r: 22, arc: Math.PI * 1.55, color: '#5b3fd1', rot: 0.3 },
      { pos: [120, -10, -60] as const, r: 16, arc: Math.PI * 1.2, color: '#1fa38f', rot: -0.6 },
      { pos: [40, 55, 130] as const, r: 28, arc: Math.PI * 1.75, color: '#b8336f', rot: 1.1 },
    ],
    [],
  );
  useFrame(({ clock }) => {
    if (group.current) group.current.children.forEach((c, i) => (c.rotation.z = rings[i].rot + clock.elapsedTime * 0.01 * (i + 1)));
  });
  return (
    <group ref={group}>
      {rings.map((r, i) => (
        <mesh key={i} position={r.pos as unknown as [number, number, number]} rotation={[0.4 * i, i, r.rot]}>
          <torusGeometry args={[r.r, 0.6, 4, 48, r.arc]} />
          <meshBasicMaterial color={r.color} fog={false} transparent opacity={0.35} />
        </mesh>
      ))}
    </group>
  );
}
