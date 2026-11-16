// Materiali condivisi. I personaggi usano un'ombreggiatura "cartoon" a 3 toni,
// il mondo un'ombreggiatura piatta e cupa: è il contrasto voluto dal design.

import * as THREE from 'three';

let gradient: THREE.DataTexture | null = null;

function toonGradient(): THREE.DataTexture {
  if (!gradient) {
    const data = new Uint8Array([70, 160, 255]);
    gradient = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
    gradient.minFilter = THREE.NearestFilter;
    gradient.magFilter = THREE.NearestFilter;
    gradient.generateMipmaps = false;
    gradient.needsUpdate = true;
  }
  return gradient;
}

const toonCache = new Map<string, THREE.MeshToonMaterial>();

export function toon(color: string, emissive?: string, emissiveIntensity = 1): THREE.MeshToonMaterial {
  const key = `${color}|${emissive ?? ''}|${emissiveIntensity}`;
  let m = toonCache.get(key);
  if (!m) {
    m = new THREE.MeshToonMaterial({ color, gradientMap: toonGradient() });
    if (emissive) {
      m.emissive = new THREE.Color(emissive);
      m.emissiveIntensity = emissiveIntensity;
    }
    toonCache.set(key, m);
  }
  return m;
}

const stoneCache = new Map<string, THREE.MeshStandardMaterial>();

export function stone(color: string, roughness = 0.95): THREE.MeshStandardMaterial {
  const key = `${color}|${roughness}`;
  let m = stoneCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.05, flatShading: true });
    stoneCache.set(key, m);
  }
  return m;
}

export const SKIN = '#f2c9a5';
export const NEUTRAL = '#8a8496';
