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
import { MOVE_DURATION, bodyOffset, dodgeOffset, type MoveStyle } from './moves';
import type { AbilitySlot } from '../combat/protocol';

export type Move = 'idle' | 'run' | 'down';

export interface ModelDef {
  url: string;
  /** altezza in metri nel gioco */
  height: number;
  /** rotazione per far guardare il modello verso +Z */
  yaw?: number;
  /** nomi dei clip nel file */
  clips: Partial<Record<ClipKey, string>>;
  /** velocità dei clip d'attacco diversi da `attack` (altrimenti attackSpeed) */
  speeds?: Partial<Record<AttackKey, number>>;
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
  /** eroi: il corpo fa i movimenti di attacchi e abilità (player/moves.ts) */
  moves?: boolean;
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
  /** movimento del corpo dell'ultimo attacco e numero del colpo nella combo */
  style: MoveStyle;
  combo: number;
  /** abilità usata (sceglie la sua animazione, se il modello ce l'ha) */
  slot: AbilitySlot | null;
}

export const newCtrl = (): ModelCtrl => ({ move: 'idle', speed: 0, attack: 0, visible: true, roll: -1, flash: 0, charge: 0, opacity: 1, style: 'swing', combo: 1, slot: null });

const url = (file: string) => `${import.meta.env.BASE_URL}models/${file}`;

/** Clip d'attacco: il colpo base (1°, 2°, 3° della combo) e uno per abilità. */
export type AttackKey = 'attack' | 'attack2' | 'attack3' | 'abQ' | 'abE' | 'abR' | 'abF';
const ATTACK_KEYS: AttackKey[] = ['attack', 'attack2', 'attack3', 'abQ', 'abE', 'abR', 'abF'];
export type ClipKey = 'idle' | 'run' | 'down' | 'dodge' | AttackKey;
type ActionKey = ClipKey | 'runLower';
/** Quanto dura la capriola disegnata (s): un po' più della schivata vera, così si vede tutta. */
const DODGE_ANIM = 0.5;
/** Ossa della parte alta (scheletro Meshy): busto, collo, testa, spalle e braccia. */
const UPPER_BODY = /Spine|neck|Neck|Head|Shoulder|Arm|Hand/;

/** Quali modelli sono pronti e quali hanno dato errore (si vede nelle statistiche). */
export const modelStatus = {
  ready: new Set<string>(),
  failed: new Map<string, string>(),
};
const fileOf = (u: string) => u.split('/').pop() ?? u;

/**
 * Comincia a scaricare i modelli prima che servano (eroi alla partenza, nemici
 * poco dopo), così quando scegli la classe o entri nella Frattura sono pronti.
 */
export function preloadModels() {
  if (!MODELS_ENABLED) return;
  const heroes = [...Object.values(HERO_MODELS).map((d) => d!.url), ...['spada', 'scudo', 'pugnale', 'bastone'].map((n) => PROP_MODELS[n]?.url)];
  for (const u of heroes) if (u) useGLTF.preload(u);
  setTimeout(() => {
    for (const d of Object.values(ENEMY_MODELS)) if (d) useGLTF.preload(d.url);
  }, 8000);
}

/** Eroi con il modello pronto. Le classi senza modello usano ancora l'eroe di forme semplici. */
export const HERO_MODELS: Partial<Record<ClassId, ModelDef>> = {};
export const ENEMY_MODELS: Partial<Record<EnemyType, ModelDef>> = {};
export interface PropDef {
  url: string;
  height: number;
  /** larghezza massima in metri (per oggetti bassi e larghi) */
  maxWidth?: number;
  yaw?: number;
}
export const PROP_MODELS: Record<string, PropDef> = {};

/**
 * `?modelli=0` nell'indirizzo gioca con le forme semplici: per i dispositivi
 * molto deboli e per i test con tante finestre senza scheda video.
 */
export const MODELS_ENABLED = typeof location === 'undefined' || new URLSearchParams(location.search).get('modelli') !== '0';

/** Registra i modelli (chiamato da models.ts, che elenca i file presenti). */
export function registerModels(m: {
  heroes?: Partial<Record<ClassId, Omit<ModelDef, 'url'> & { file: string }>>;
  enemies?: Partial<Record<EnemyType, Omit<ModelDef, 'url'> & { file: string }>>;
  props?: Record<string, Omit<PropDef, 'url'> & { file: string }>;
}) {
  if (!MODELS_ENABLED) return;
  for (const [k, v] of Object.entries(m.heroes ?? {})) if (v) HERO_MODELS[k as ClassId] = { moves: true, ...v, url: url(v.file) };
  for (const [k, v] of Object.entries(m.enemies ?? {})) if (v) ENEMY_MODELS[k as EnemyType] = { ...v, url: url(v.file) };
  for (const [k, v] of Object.entries(m.props ?? {})) PROP_MODELS[k] = { ...v, url: url(v.file) };
}

/** Scala e spostamento per avere l'altezza voluta (e al massimo la larghezza voluta) con i piedi a terra. */
function fit(object: THREE.Object3D, height: number, maxWidth?: number) {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  let s = size.y > 0 ? height / size.y : 1;
  const wide = Math.max(size.x, size.z);
  if (maxWidth && wide * s > maxWidth) s = maxWidth / wide;
  return { scale: s, y: -box.min.y * s };
}

export function RiggedModel({ def, ctrl, onReady }: { def: ModelDef; ctrl: ModelCtrl; onReady?: () => void }) {
  const gltf = useGLTF(def.url);
  modelStatus.ready.add(fileOf(def.url));
  const { scene, mats, mixer, actions, uppers, place, anchors } = useMemo(() => {
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
    const actions: Partial<Record<ActionKey, THREE.AnimationAction>> = {};
    /** versione "solo busto" dei clip d'attacco, per attaccare correndo */
    const uppers: Partial<Record<AttackKey, THREE.AnimationAction>> = {};
    const once = (a: THREE.AnimationAction) => {
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
      return a;
    };
    for (const [key, name] of Object.entries(def.clips)) {
      const clip = gltf.animations.find((a) => a.name === name);
      if (!clip) continue;
      const a = mixer.clipAction(clip);
      if (key !== 'idle' && key !== 'run') once(a);
      actions[key as ActionKey] = a;
    }
    // attacco in corsa: le gambe continuano a correre e il busto colpisce
    // (clip senza ossa in comune, così ognuna muove le sue al 100%)
    const run = actions.run?.getClip();
    if (run) {
      const upper = (t: THREE.KeyframeTrack) => UPPER_BODY.test(t.name.split('.')[0]);
      actions.runLower = mixer.clipAction(new THREE.AnimationClip('runLower', run.duration, run.tracks.filter((t) => !upper(t))));
      for (const k of ATTACK_KEYS) {
        const c = actions[k]?.getClip();
        if (c) uppers[k] = once(mixer.clipAction(new THREE.AnimationClip(`${k}Upper`, c.duration, c.tracks.filter(upper))));
      }
    }
    const place = fit(gltf.scene, def.height);
    return { scene, mats, mixer, actions, uppers, place, anchors: anchorGear(scene, def.gear ?? [], place.scale) };
  }, [gltf, def]);

  const roll = useRef<THREE.Group>(null);
  const act = useRef<THREE.Group>(null);
  const state = useRef({
    active: new Set<THREE.AnimationAction>(),
    attack: 0,
    attackUntil: 0,
    attackStart: 0,
    atkKey: 'attack' as AttackKey,
    dodgeUntil: 0,
    wasRolling: false,
    style: 'swing' as MoveStyle,
    combo: 1,
    opacity: 1,
  });

  useEffect(() => {
    const start = actions.idle ?? actions.run;
    start?.play();
    state.current.active = new Set(start ? [start] : []);
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
    if (ctrl.attack !== st.attack && actions.attack) {
      st.attack = ctrl.attack;
      st.attackStart = now;
      st.style = ctrl.style;
      st.combo = ctrl.combo;
      // l'animazione dell'abilità, o del 2°/3° colpo della combo, se il modello ce l'ha
      const abKey = ctrl.slot ? (`ab${ctrl.slot}` as AttackKey) : null;
      st.atkKey = abKey && actions[abKey] ? abKey : ctrl.combo === 2 && actions.attack2 ? 'attack2' : ctrl.combo === 3 && actions.attack3 ? 'attack3' : 'attack';
      const speed = (st.atkKey !== 'attack' ? def.speeds?.[st.atkKey] : undefined) ?? def.attackSpeed ?? 1.6; // i clip della libreria sono lenti
      for (const a of [actions[st.atkKey], uppers[st.atkKey]]) {
        if (!a) continue;
        a.reset();
        a.timeScale = speed;
        if (st.active.has(a)) a.setEffectiveWeight(1);
      }
      st.attackUntil = now + (actions[st.atkKey]!.getClip().duration / speed) * 1000 * 0.9;
    }
    // la capriola dura un po' più della schivata vera
    const rolling = ctrl.roll >= 0;
    if (rolling && !st.wasRolling && actions.dodge) {
      st.dodgeUntil = now + DODGE_ANIM * 1000;
      actions.dodge.reset();
      actions.dodge.timeScale = actions.dodge.getClip().duration / DODGE_ANIM;
      if (st.active.has(actions.dodge)) actions.dodge.setEffectiveWeight(1);
    }
    st.wasRolling = rolling;
    const attacking = now < st.attackUntil && !!actions.attack;
    const moving = ctrl.move === 'run' && !!actions.run;
    const atkFull = actions[st.atkKey];
    const atkUpper = uppers[st.atkKey];
    let want: (THREE.AnimationAction | undefined)[];
    if (ctrl.move === 'down' && actions.down) want = [actions.down];
    else if (actions.dodge && now < st.dodgeUntil) want = [actions.dodge];
    else if (attacking && moving && atkUpper && actions.runLower) want = [actions.runLower, atkUpper];
    else if (attacking) want = [atkFull];
    else if (moving) want = [actions.run];
    else want = [actions.idle ?? actions.run];

    // dissolvenze tra i clip; le gambe non saltano passando tra corsa intera e corsa "solo gambe"
    for (const a of [...Object.values(actions), ...Object.values(uppers)]) {
      if (!a) continue;
      const on = want.includes(a);
      if (on && !st.active.has(a)) {
        const keepTime = a === actions.runLower ? actions.run : a === actions.run ? actions.runLower : null;
        // attacchi e capriola sono già stati riavvolti quando sono partiti: qui non si ricomincia da capo
        const isAttack = a === actions.dodge || ATTACK_KEYS.some((k) => a === actions[k] || a === uppers[k]);
        if (!isAttack) a.reset();
        else {
          a.enabled = true;
          a.stopFading();
        }
        if (keepTime && st.active.has(keepTime)) a.time = keepTime.time;
        a.setEffectiveWeight(1).fadeIn(0.15).play();
        st.active.add(a);
      } else if (!on && st.active.has(a)) {
        a.fadeOut(0.15);
        st.active.delete(a);
      }
    }
    const runScale = Math.max(0.6, Math.min(1.6, ctrl.speed / (def.runSpeed ?? 6)));
    if (actions.run) actions.run.timeScale = runScale;
    if (actions.runLower) actions.runLower.timeScale = runScale;
    mixer.update(dt);

    if (roll.current) {
      roll.current.visible = ctrl.visible;
      roll.current.rotation.x = 0;
      roll.current.position.y = def.height * 0.45;
    }
    // movimenti del corpo: attacchi e abilità diversi, e la schivata come scatto basso
    if (act.current) {
      const g = act.current;
      let o = def.moves && st.attackStart ? bodyOffset(st.style, st.combo, (now - st.attackStart) / 1000 / MOVE_DURATION[st.style]) : null;
      // con un'animazione apposta (giravolte, salti) il movimento del corpo resta, ma più leggero
      if (o && st.atkKey !== 'attack') o = { rx: o.rx * 0.35, ry: 0, y: o.y * 0.5, z: o.z * 0.5, s: 1 + (o.s - 1) * 0.5 };
      // con la capriola vera il corpo non si china in più
      const d = ctrl.roll >= 0 && !actions.dodge ? dodgeOffset(ctrl.roll) : null;
      g.rotation.set((o?.rx ?? 0) + (d?.rx ?? 0), o?.ry ?? 0, 0);
      g.position.set(0, (o?.y ?? 0) + (d?.y ?? 0), o?.z ?? 0);
      g.scale.setScalar((o?.s ?? 1) * (d?.s ?? 1));
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
      <group ref={act}>
        <group position={[0, place.y - def.height * 0.45 + (def.lift ?? 0), 0]} rotation={[0, def.yaw ?? 0, 0]} scale={place.scale}>
          <primitive object={scene} />
        </group>
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

/**
 * Oggetto statico (portali, edifici, colonne, armi…). `height`/`maxWidth`
 * sostituiscono le misure registrate; `y` è l'altezza della base.
 */
export function PropModel({ name, height, maxWidth, y = 0 }: { name: string; height?: number; maxWidth?: number; y?: number }) {
  const def = PROP_MODELS[name];
  const gltf = useGLTF(def.url);
  modelStatus.ready.add(fileOf(def.url));
  const h = height ?? def.height;
  const w = maxWidth ?? def.maxWidth;
  const { scene, place } = useMemo(() => {
    const scene = gltf.scene.clone(true);
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    return { scene, place: fit(gltf.scene, h, w) };
  }, [gltf, h, w]);
  return (
    <group position={[0, place.y + y, 0]} rotation={[0, def.yaw ?? 0, 0]} scale={place.scale}>
      <primitive object={scene} />
    </group>
  );
}
