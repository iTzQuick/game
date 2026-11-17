// Il cielo dipinto (Higgsfield): una fascia di nebulosa e nuvole avvolta attorno
// alla scena, con la luna a parte, così non si ripete con la fascia.

import { Billboard } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo } from 'react';
import * as THREE from 'three';
import { MODELS_ENABLED } from '../player/RiggedModel';
import { texUrl } from './textures';

const loader = new THREE.TextureLoader();
const bands = new Map<string, THREE.Texture>();
let moon: THREE.Texture | null = null;

function bandTexture(file: string) {
  let band = bands.get(file);
  if (!band) {
    band = loader.load(texUrl(file));
    band.colorSpace = THREE.SRGBColorSpace;
    band.wrapS = THREE.RepeatWrapping;
    band.repeat.set(3, 1);
    bands.set(file, band);
  }
  return band;
}

function moonTexture() {
  if (!moon) {
    moon = loader.load(texUrl('luna.webp'));
    moon.colorSpace = THREE.SRGBColorSpace;
  }
  return moon;
}

// La cupola dietro la fascia: sopra e sotto la fascia il cielo non è più nero.
// I colori ai bordi sono quelli della fascia stessa (misurati sulle immagini),
// così il passaggio non si vede.
const DOMES: Record<string, { top: string; zenith: string; accent: string; bottom: string; below: string; water: boolean }> = {
  'cielo.webp': { top: '#18143d', zenith: '#1a2a66', accent: '#5b3fae', bottom: '#4e3fa0', below: '#120d2c', water: false },
  'citta-fondale.webp': { top: '#5cd9d5', zenith: '#d8fdff', accent: '#9ff6ff', bottom: '#073a5c', below: '#021019', water: true },
};
// la fascia (raggio 230, da y -90 a 130) vista dal centro: seno dell'elevazione dei bordi
const SIN_TOP = 130 / Math.hypot(130, 230);
const SIN_BOTTOM = -90 / Math.hypot(90, 230);

const domeVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const domeFragment = /* glsl */ `
  uniform vec3 uTop, uZenith, uAccent, uBottom, uBelow;
  uniform float uSinTop, uSinBottom, uTime, uWater, uDim;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    vec3 col;
    if (d.y >= uSinBottom) {
      float t = smoothstep(uSinTop - 0.04, 1.0, d.y);
      col = mix(uTop, uZenith, pow(t, 0.7));
      // veli di nebulosa (o increspature della superficie dell'acqua)
      float a = atan(d.z, d.x);
      float n = sin(a * 3.0 + d.y * 6.0 + uTime * 0.01) * sin(a * 5.0 - d.y * 9.0) * 0.5 + 0.5;
      float w = sin(d.x * 28.0 + uTime * 0.6) * sin(d.z * 24.0 - uTime * 0.5) * 0.5 + 0.5;
      float k = mix(n * n * 0.45, w * 0.35, uWater) * smoothstep(uSinTop - 0.04, uSinTop + 0.25, d.y);
      col = mix(col, uAccent, k);
    } else {
      col = mix(uBottom, uBelow, smoothstep(uSinBottom, uSinBottom - 0.35, d.y));
    }
    gl_FragColor = vec4(col * uDim, 1.0);
    // come la fascia (MeshBasicMaterial): stessa resa dei colori, così il bordo non si vede
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function SkyDome({ file, dim }: { file: string; dim: number }) {
  const c = DOMES[file] ?? DOMES['cielo.webp'];
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: domeVertex,
        fragmentShader: domeFragment,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          uTop: { value: new THREE.Color(c.top) },
          uZenith: { value: new THREE.Color(c.zenith) },
          uAccent: { value: new THREE.Color(c.accent) },
          uBottom: { value: new THREE.Color(c.bottom) },
          uBelow: { value: new THREE.Color(c.below) },
          uSinTop: { value: SIN_TOP },
          uSinBottom: { value: SIN_BOTTOM },
          uTime: { value: 0 },
          uWater: { value: c.water ? 1 : 0 },
          uDim: { value: dim },
        },
      }),
    [c, dim],
  );
  useFrame(({ clock }) => {
    mat.uniforms.uTime.value = clock.elapsedTime;
  });
  return (
    <mesh material={mat} renderOrder={-11} position={[0, 2, 0]}>
      <sphereGeometry args={[245, 48, 24]} />
    </mesh>
  );
}

/**
 * `dim` scurisce il cielo (nella Frattura è più cupo).
 * Il cilindro è oltre la nebbia: i materiali ignorano la nebbia.
 */
export function SkyBand({ dim = 1, moonAt, file = 'cielo.webp' }: { dim?: number; moonAt?: [number, number, number]; file?: string }) {
  const bandMat = useMemo(() => {
    const c = new THREE.Color(dim, dim, dim);
    return new THREE.MeshBasicMaterial({ map: bandTexture(file), color: c, side: THREE.BackSide, fog: false, depthWrite: false });
  }, [dim, file]);
  const moonMat = useMemo(
    () => new THREE.MeshBasicMaterial({ map: moonTexture(), transparent: true, fog: false, depthWrite: false }),
    [],
  );
  if (!MODELS_ENABLED) return null;
  return (
    <group>
      <SkyDome file={file} dim={dim} />
      {/* alto 220 m, raggio 230: copre l'orizzonte da ogni punto dell'isola */}
      <mesh material={bandMat} position={[0, 20, 0]} renderOrder={-10}>
        <cylinderGeometry args={[230, 230, 220, 48, 1, true]} />
      </mesh>
      {moonAt && (
        <Billboard position={moonAt}>
          <mesh material={moonMat} renderOrder={-9}>
            <planeGeometry args={[34, 34]} />
          </mesh>
        </Billboard>
      )}
    </group>
  );
}
