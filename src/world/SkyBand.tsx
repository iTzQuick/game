// Il cielo dipinto (Higgsfield): una fascia di nebulosa e nuvole avvolta attorno
// alla scena, con la luna a parte, così non si ripete con la fascia.

import { Billboard } from '@react-three/drei';
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
