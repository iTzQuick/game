// Modelli 3D generati (Higgsfield/Meshy) con scheletro e animazioni.
// Ogni istanza è un clone con i suoi materiali, così il lampo quando un
// nemico viene colpito non accende anche gli altri.

import { useGLTF } from '@react-three/drei';
import { createPortal, useFrame } from '@react-three/fiber';
import { Fragment, useEffect, useMemo, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { ClassId } from '../game/constants';
import type { EnemyType } from '../combat/defs';

export type Move = 'idle' | 'run' | 'down';

export interface ModelDef {
  url: string;
  /** altezza in metri nel gioco */
  height: number;
  /** rotazione per far guardare il modello verso +Z */
  yaw?: number;
  /** nomi dei clip nel file */
  clips: Partial<Record<'idle' | 'run' | 'attack' | 'down', string>>;
  /** velocità (m/s) a cui il clip di corsa sembra giusto */
  runSpeed?: number;
  /** velocità del clip d'attacco (già ritagliato attorno al colpo) */
  attackSpeed?: number;
  /** oggetti agganciati alle ossa (armi, aureole…) */
  gear?: GearDef[];
  /** modello senza scheletro: lo muove il codice (vedi EnemyMesh) */
  rigid?: boolean;
  /** altezza da terra della base del modello (per chi vola) */
  lift?: number;
}

/**
 * Un oggetto agganciato a un osso. Posizione e rotazione si danno come se il
 * personaggio fosse nella posa di partenza (A), in metri e negli assi del
 * personaggio (+Z avanti, −X la sua destra), rispetto all'osso.
 */
export interface GearDef {
  bone: string;
  pos: [number, number, number];
  rot?: [number, number, number];
  node: ReactNode;
}

/** Comandi per l'animazione, aggiornati a ogni frame da chi usa il modello. */
export interface ModelCtrl {
  move: Move;
  speed: number;
  /** sale di 1 a ogni nuovo attacco */
  attack: number;
  visible: boolean;
  /** capriola della schivata: 0..1, -1 se non c'è */
  roll: number;
  /** 0..1: lampo bianco (colpito) */
  flash: number;
  /** rosso del preavviso d'attacco (nemici) */
  charge: number;
  /** 1 = pieno; meno di 1 = trasparente (i Velati sotto il velo) */
  opacity: number;
}

export const newCtrl = (): ModelCtrl => ({ move: 'idle', speed: 0, attack: 0, visible: true, roll: -1, flash: 0, charge: 0, opacity: 1 });

const url = (file: string) => `${import.meta.env.BASE_URL}models/${file}`;

/** Eroi con il modello pronto. Le classi senza modello usano ancora l'eroe di forme semplici. */
export const HERO_MODELS: Partial<Record<ClassId, ModelDef>> = {};
export const ENEMY_MODELS: Partial<Record<EnemyType, ModelDef>> = {};
export const PROP_MODELS: Record<string, { url: string; height: number; yaw?: number }> = {};

/**
 * `?modelli=0` nell'indirizzo gioca con le forme semplici: per i dispositivi
 * molto deboli e per i test con tante finestre senza scheda video.
 */
export const MODELS_ENABLED = typeof location === 'undefined' || new URLSearchParams(location.search).get('modelli') !== '0';

/** Registra i modelli (chiamato da models.ts, che elenca i file presenti). */
export function registerModels(m: {
  heroes?: Partial<Record<ClassId, Omit<ModelDef, 'url'> & { file: string }>>;
  enemies?: Partial<Record<EnemyType, Omit<ModelDef, 'url'> & { file: string }>>;
  props?: Record<string, { file: string; height: number; yaw?: number }>;
}) {
  if (!MODELS_ENABLED) return;
  for (const [k, v] of Object.entries(m.heroes ?? {})) if (v) HERO_MODELS[k as ClassId] = { ...v, url: url(v.file) };
  for (const [k, v] of Object.entries(m.enemies ?? {})) if (v) ENEMY_MODELS[k as EnemyType] = { ...v, url: url(v.file) };
  for (const [k, v] of Object.entries(m.props ?? {})) PROP_MODELS[k] = { ...v, url: url(v.file) };
}

/** Scala e spostamento per avere l'altezza voluta con i piedi a terra. */
function fit(object: THREE.Object3D, height: number) {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const s = size.y > 0 ? height / size.y : 1;
  return { scale: s, y: -box.min.y * s };
}

export function RiggedModel({ def, ctrl, onReady }: { def: ModelDef; ctrl: ModelCtrl; onReady?: () => void }) {
  const gltf = useGLTF(def.url);
  const { scene, mats, mixer, actions, place, anchors } = useMemo(() => {
    const scene = cloneSkinned(gltf.scene) as THREE.Object3D;
    const mats: THREE.MeshStandardMaterial[] = [];
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.frustumCulled = false; // le mesh con scheletro hanno box sbagliate durante le animazioni
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const cloned = list.map((m) => {
        const c = (m as THREE.MeshStandardMaterial).clone();
        c.emissive = new THREE.Color(0, 0, 0);
        mats.push(c);
        return c;
      });
      mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0];
    });
    const mixer = new THREE.AnimationMixer(scene);
    const actions: Partial<Record<'idle' | 'run' | 'attack' | 'down', THREE.AnimationAction>> = {};
    for (const [key, name] of Object.entries(def.clips)) {
      const clip = gltf.animations.find((a) => a.name === name);
      if (!clip) continue;
      const a = mixer.clipAction(clip);
      if (key === 'attack' || key === 'down') {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
      }
      actions[key as keyof typeof actions] = a;
    }
    const place = fit(gltf.scene, def.height);
    return { scene, mats, mixer, actions, place, anchors: anchorGear(scene, def.gear ?? [], place.scale) };
  }, [gltf, def]);

  const roll = useRef<THREE.Group>(null);
  const state = useRef<{ current: THREE.AnimationAction | null; attack: number; attackUntil: number; opacity: number }>({
    current: null,
    attack: 0,
    attackUntil: 0,
    opacity: 1,
  });

  useEffect(() => {
    const start = actions.idle ?? Object.values(actions)[0];
    start?.play();
    state.current.current = start ?? null;
    state.current.attack = ctrl.attack;
    onReady?.();
    return () => {
      mixer.stopAllAction();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mixer, actions]);

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.1);
    const st = state.current;
    const now = performance.now();
    let want: THREE.AnimationAction | undefined;
    if (ctrl.attack !== st.attack && actions.attack) {
      st.attack = ctrl.attack;
      const a = actions.attack;
      a.reset();
      a.timeScale = def.attackSpeed ?? 1.6; // i clip della libreria sono lenti per un gioco d'azione
      st.attackUntil = now + (a.getClip().duration / a.timeScale) * 1000 * 0.9;
    }
    if (ctrl.move === 'down' && actions.down) want = actions.down;
    else if (now < st.attackUntil && actions.attack) want = actions.attack;
    else if (ctrl.move === 'run' && actions.run) want = actions.run;
    else want = actions.idle ?? actions.run;

    if (want && want !== st.current) {
      want.reset().play();
      if (st.current) want.crossFadeFrom(st.current, 0.15, false);
      st.current = want;
    }
    if (actions.run) actions.run.timeScale = Math.max(0.6, Math.min(1.6, ctrl.speed / (def.runSpeed ?? 6)));
    mixer.update(dt);

    if (roll.current) {
      roll.current.visible = ctrl.visible;
      if (ctrl.roll >= 0) {
        const k = 1 - (1 - ctrl.roll) * (1 - ctrl.roll);
        roll.current.rotation.x = k * Math.PI * 2;
        roll.current.position.y = def.height * 0.45 + Math.sin(ctrl.roll * Math.PI) * 0.25;
      } else {
        roll.current.rotation.x = 0;
        roll.current.position.y = def.height * 0.45;
      }
    }
    // trasparenza (Velati): si accende solo quando serve, per non pesare sugli altri
    if (ctrl.opacity < 1 || st.opacity < 1) {
      const o = Math.max(0, Math.min(1, ctrl.opacity));
      for (const m of mats) {
        m.transparent = o < 1;
        m.depthWrite = o >= 1;
        m.opacity = o;
      }
      if (o >= 1 || (st.opacity >= 1) !== (o >= 1)) for (const m of mats) m.needsUpdate = true;
      st.opacity = o;
    }
    // lampo bianco quando colpito, rosso quando carica un attacco
    if (ctrl.flash > 0 || ctrl.charge > 0 || mats[0]?.emissiveIntensity) {
      for (const m of mats) {
        if (ctrl.flash > 0) {
          m.emissive.setRGB(1, 1, 1);
          m.emissiveIntensity = ctrl.flash * 0.8;
        } else if (ctrl.charge > 0) {
          m.emissive.setRGB(1, 0.1, 0.15);
          m.emissiveIntensity = ctrl.charge * 0.6;
        } else {
          m.emissiveIntensity = 0;
        }
      }
    }
  });

  // il gruppo "roll" ruota attorno al bacino (a metà altezza), il modello sotto è spostato di conseguenza
  return (
    <group ref={roll} position={[0, def.height * 0.45, 0]}>
      <group position={[0, place.y - def.height * 0.45 + (def.lift ?? 0), 0]} rotation={[0, def.yaw ?? 0, 0]} scale={place.scale}>
        <primitive object={scene} />
      </group>
      {anchors.map((a, i) => (
        <Fragment key={i}>
          {createPortal(
            <group position={a.position} quaternion={a.quaternion} scale={a.scale}>
              {a.node}
            </group>,
            a.bone,
          )}
        </Fragment>
      ))}
    </group>
  );
}

/**
 * Converte gli oggetti dati "nella posa di partenza, in metri" in trasformazioni
 * locali dell'osso, così poi seguono l'osso in ogni animazione.
 */
function anchorGear(scene: THREE.Object3D, gear: GearDef[], metersPerUnit: number) {
  scene.updateMatrixWorld(true);
  const out: { bone: THREE.Object3D; position: THREE.Vector3; quaternion: THREE.Quaternion; scale: number; node: ReactNode }[] = [];
  for (const g of gear) {
    const bone = scene.getObjectByName(g.bone);
    if (!bone) {
      console.warn(`osso ${g.bone} non trovato`);
      continue;
    }
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    bone.matrixWorld.decompose(p, q, s);
    const qi = q.clone().invert();
    const k = s.x * metersPerUnit; // metri per unità dell'osso
    out.push({
      bone,
      position: new THREE.Vector3(...g.pos).divideScalar(metersPerUnit).applyQuaternion(qi).divideScalar(s.x),
      quaternion: qi.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...(g.rot ?? [0, 0, 0])))),
      scale: 1 / k,
      node: g.node,
    });
  }
  return out;
}

/** Oggetto statico (portali, edifici…). */
export function PropModel({ name }: { name: string }) {
  const def = PROP_MODELS[name];
  const gltf = useGLTF(def.url);
  const { scene, place } = useMemo(() => {
    const scene = gltf.scene.clone(true);
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    return { scene, place: fit(gltf.scene, def.height) };
  }, [gltf, def]);
  return (
    <group position={[0, place.y, 0]} rotation={[0, def.yaw ?? 0, 0]} scale={place.scale}>
      <primitive object={scene} />
    </group>
  );
}
