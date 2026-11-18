// Pozze d'acqua della Frattura: disegno, schizzi dei passi e spruzzi dei colpi forti.
// Solo grafica: in rete non viaggia niente, ognuno vede i suoi schizzi (le pozze sono
// le stesse per tutti perché nascono dal seme della Frattura).

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { puddleAt, type Dungeon, type Puddle } from '../combat/dungeon';
import { combat } from '../combat/runtime';
import { getGame } from '../game/store';
import { CITTA } from '../citta/core';
import { spawnRing, spawnSmoke, spawnSparks } from './effects';

/** Nella Città Sommersa (sott'acqua) le pozze non ci sono. */
const wet = () => !!combat.dungeon && getGame().room.run?.mondo !== CITTA;

const lastStep = new Map<string, number>();

/** Passi nell'acqua: piccoli schizzi e un cerchio, più spesso se si corre. */
export function splashStep(key: string, x: number, z: number, speed: number) {
  if (speed < 1.2 || !wet()) return;
  const now = performance.now();
  const every = Math.max(160, 420 - speed * 40);
  if (now - (lastStep.get(key) ?? 0) < every) return;
  if (!puddleAt(combat.dungeon!, x, z)) return;
  lastStep.set(key, now);
  spawnSparks(x, 0.06, z, '#cdeeff', 4, 0.45);
  spawnRing(x, z, '#bfe8ff', 0.7, 0.55);
}

/** Spruzzo grande (colpi caricati, atterraggi dei boss, capriole nell'acqua). */
export function splashBig(x: number, z: number, power = 1) {
  if (!wet() || !puddleAt(combat.dungeon!, x, z)) return false;
  spawnSparks(x, 0.08, z, '#dff4ff', Math.round(16 + 16 * power), 1.1 + 0.6 * power);
  spawnRing(x, z, '#cfefff', 1.6 + 1.4 * power, 0.7);
  spawnRing(x, z, '#bfe8ff', 0.9 + 0.8 * power, 0.45);
  spawnSmoke(x, 0.15, z, Math.round(3 + 4 * power), 0.7 + 0.5 * power, '#d8eef8');
  return true;
}

/**
 * Acqua ferma: riflette i colori del cielo della Frattura (viola e blu) con un leggero
 * ondeggiare e qualche riflesso luminoso che scorre. Niente riflessi veri (costano troppo
 * sui telefoni): basta per leggerla come acqua.
 */
function waterMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    fog: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uDeep: { value: new THREE.Color('#120d2a') },
        uSky: { value: new THREE.Color('#5546b8') },
        uGlint: { value: new THREE.Color('#d9ccff') },
      },
    ]),
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      varying vec3 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uDeep;
      uniform vec3 uSky;
      uniform vec3 uGlint;
      varying vec3 vWorld;
      #include <fog_pars_fragment>
      float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1.0, 0.0)), f.x), mix(h(i + vec2(0.0, 1.0)), h(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      void main() {
        vec2 p = vWorld.xz;
        float w = n(p * 0.7 + vec2(uTime * 0.05, uTime * 0.03)) * 0.6 + n(p * 2.1 - uTime * 0.08) * 0.4;
        vec3 col = mix(uDeep, uSky, smoothstep(0.3, 0.9, w));
        float glint = smoothstep(0.8, 0.96, n(p * 3.3 + vec2(uTime * 0.13, -uTime * 0.07)));
        col += uGlint * glint * 0.55;
        gl_FragColor = vec4(col, 0.9);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
}

/** Forma irregolare della pozza (sempre la stessa per lo stesso seme). */
function puddleShape(p: Puddle, grow = 1): THREE.Shape {
  const shape = new THREE.Shape();
  const n = 28;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + 0.12 * Math.sin(3 * a + p.shape * 10) + 0.07 * Math.sin(5 * a + p.shape * 23) + 0.04 * Math.sin(8 * a + p.shape * 41);
    const x = Math.cos(a) * p.r * k * grow;
    const y = Math.sin(a) * p.r * k * grow;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  return shape;
}

export function Puddles({ d }: { d: Dungeon }) {
  const list = useMemo(() => d.rooms.flatMap((r) => r.puddles), [d]);
  const mats = useMemo(
    () => ({
      water: waterMaterial(),
      rim: new THREE.MeshStandardMaterial({
        color: '#120e1e',
        roughness: 0.35,
        metalness: 0.2,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
    }),
    [],
  );
  const geos = useMemo(
    () => list.map((p) => ({ water: new THREE.ShapeGeometry(puddleShape(p), 1), rim: new THREE.ShapeGeometry(puddleShape(p, 1.14), 1) })),
    [list],
  );
  // ogni tanto una goccia cade in una pozza: un cerchio che si allarga
  const nextDrop = useRef(0);
  useFrame(({ clock }) => {
    mats.water.uniforms.uTime.value = clock.elapsedTime;
    const now = performance.now();
    if (list.length && now > nextDrop.current) {
      nextDrop.current = now + 600 + Math.random() * 1400;
      const p = list[Math.floor(Math.random() * list.length)];
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * p.r * 0.7;
      spawnRing(p.x + Math.cos(a) * r, p.z + Math.sin(a) * r, '#9fd6ff', 0.45, 0.8);
    }
  });
  return (
    <group>
      {list.map((p, i) => (
        <group key={i} position={[p.x, 0, p.z]} rotation={[-Math.PI / 2, 0, 0]}>
          <mesh geometry={geos[i].rim} material={mats.rim} position={[0, 0, 0.012]} receiveShadow />
          <mesh geometry={geos[i].water} material={mats.water} position={[0, 0, 0.02]} receiveShadow />
        </group>
      ))}
    </group>
  );
}
