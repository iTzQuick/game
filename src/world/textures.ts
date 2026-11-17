// Superfici dipinte (Higgsfield) per pavimenti, muri e rocce.
// Le texture si proiettano dall'alto e dai lati in coordinate del mondo
// ("triplanare"): vanno bene per pavimenti e muri di qualsiasi misura senza
// stirarsi, e senza dover preparare le coordinate di ogni forma.
// Con ?modelli=0 si torna alla pietra a tinta unita.

import * as THREE from 'three';
import { MODELS_ENABLED } from '../player/RiggedModel';
import { stone } from '../player/materials';

const loader = new THREE.TextureLoader();
const textures = new Map<string, THREE.Texture>();
const materials = new Map<string, THREE.MeshStandardMaterial>();

export const texUrl = (file: string) => `${import.meta.env.BASE_URL}textures/${file}`;

function texture(file: string, onError: () => void): THREE.Texture {
  let t = textures.get(file);
  if (!t) {
    t = loader.load(texUrl(file), undefined, undefined, () => {
      console.warn(`Texture ${file} non caricata, uso la pietra semplice`);
      onError();
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    textures.set(file, t);
  }
  return t;
}

/**
 * Materiale con texture proiettata in coordinate del mondo.
 * `scale` = ripetizioni per metro (0.2 = un'immagine ogni 5 m).
 * `fallback` = colore della pietra semplice se le texture sono spente o non arrivano.
 */
export function surface(file: string, scale: number, fallback: string, tint = '#ffffff'): THREE.MeshStandardMaterial {
  if (!MODELS_ENABLED) return stone(fallback);
  const key = `${file}|${scale}|${tint}`;
  let m = materials.get(key);
  if (m) return m;
  const mat = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.92, metalness: 0.04 });
  mat.map = texture(file, () => {
    mat.map = null;
    mat.color.set(fallback);
    mat.flatShading = true;
    mat.needsUpdate = true;
  });
  mat.customProgramCacheKey = () => 'triplanare';
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.tpScale = { value: scale };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTpPos;\nvarying vec3 vTpNormal;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        mat4 tpModel = modelMatrix;
        #ifdef USE_INSTANCING
          tpModel = modelMatrix * instanceMatrix;
        #endif
        vTpPos = (tpModel * vec4(transformed, 1.0)).xyz;
        vTpNormal = normalize(mat3(tpModel) * objectNormal);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTpPos;\nvarying vec3 vTpNormal;\nuniform float tpScale;')
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
          vec3 tpW = pow(abs(normalize(vTpNormal)), vec3(4.0));
          tpW /= (tpW.x + tpW.y + tpW.z);
          vec4 tpX = texture2D(map, vTpPos.zy * tpScale);
          vec4 tpY = texture2D(map, vTpPos.xz * tpScale);
          vec4 tpZ = texture2D(map, vTpPos.xy * tpScale);
          diffuseColor *= tpX * tpW.x + tpY * tpW.y + tpZ * tpW.z;
        #endif`,
      );
  };
  materials.set(key, mat);
  return mat;
}

/** Le superfici del gioco, in un posto solo. */
export const SURFACES = {
  /** pavimento del Crocevia */
  ground: (fallback = '#47404f', tint?: string) => surface('crocevia-suolo.webp', 0.16, fallback, tint),
  /** roccia sotto l'isola, sassi sospesi */
  rock: (fallback = '#2a2531') => surface('roccia.webp', 0.09, fallback),
  /** pavimento delle stanze della Frattura */
  dungeonFloor: (fallback = '#352f42', tint?: string) => surface('frattura-pavimento.webp', 0.22, fallback, tint),
  /** muri e colonne della Frattura */
  dungeonWall: (fallback = '#4a4355') => surface('frattura-muro.webp', 0.38, fallback),
};
