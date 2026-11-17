// Eroe "di riserva" fatto di forme semplici, in attesa degli avatar generati
// dalle foto (tappa 5). Le animazioni sono procedurali: corsa, attacco,
// schivata (capriola), saluto e caduta.

import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { CLASSES, EMOTES, MOVE, type ClassId } from '../game/constants';
import { useGame } from '../game/store';
import type { AnimState } from '../net/interpolation';
import { getRoom } from '../net/room';
import { VF } from '../combat/protocol';
import { REVIVE_RADIUS } from '../combat/defs';
import { NEUTRAL, SKIN, toon } from './materials';
import { HERO_MODELS, newCtrl } from './RiggedModel';
import { ModelOr } from './models';
import { Icon } from '../ui/Icon';

export interface Pose {
  speed: number;
  anim: AnimState;
  /** Secondi dall'inizio dell'attacco, -1 se non attacca. */
  attackT: number;
  attackN: number;
  dodgeT: number;
  waveT: number;
  phase: number;
  /** Stati del combattimento (VF): a terra, velo, Bastione, scudo… */
  flags: number;
}

export const newPose = (): Pose => ({ speed: 0, anim: 'idle', attackT: -1, attackN: 1, dodgeT: -1, waveT: -1, phase: 0, flags: 0 });

/** Avanza i timer della posa. */
export function tickPose(p: Pose, dt: number) {
  if (p.attackT >= 0) {
    p.attackT += dt;
    if (p.attackT > MOVE.attackDuration) p.attackT = -1;
  }
  if (p.dodgeT >= 0) {
    p.dodgeT += dt;
    if (p.dodgeT > MOVE.dodgeTime + 0.08) p.dodgeT = -1;
  }
  if (p.waveT >= 0) {
    p.waveT += dt;
    if (p.waveT > 1.3) p.waveT = -1;
  }
}

const easeOut = (t: number) => 1 - (1 - t) * (1 - t);

interface AvatarProps {
  pose: Pose;
  classId: ClassId | null;
  playerId: string;
  name: string;
  isSelf?: boolean;
}

export function Avatar({ pose, classId, playerId, name, isSelf }: AvatarProps) {
  const cls = classId ? CLASSES[classId] : null;
  const color = cls?.color ?? NEUTRAL;
  const accent = cls?.accent ?? '#5d5868';

  const body = useRef<THREE.Group>(null);
  // modello 3D animato (Higgsfield) se la classe ce l'ha; finché non è pronto resta l'eroe di forme semplici
  const def = classId ? HERO_MODELS[classId] : undefined;
  // "pronto" vale per un file preciso: cambiando classe torna falso da solo, senza
  // un effetto che azzeri (gli effetti dei figli girano prima: con il modello già in
  // memoria l'azzeramento arrivava dopo il "pronto" e il modello restava nascosto)
  const [readyUrl, setReadyUrl] = useState<string | null>(null);
  const modelReady = !!def && readyUrl === def.url;
  const ctrl = useMemo(newCtrl, []);
  const prevAttack = useRef(-1);
  const legL = useRef<THREE.Group>(null);
  const legR = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const orb = useRef<THREE.Mesh>(null);
  const bastion = useRef<THREE.Mesh>(null);
  const shield = useRef<THREE.Mesh>(null);
  const veil = useRef<THREE.Mesh>(null);
  const downRing = useRef<THREE.Mesh>(null);
  const auraMats = useMemo(
    () => ({
      bastion: new THREE.MeshBasicMaterial({ color: '#ffd25a', transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending }),
      shield: new THREE.MeshBasicMaterial({ color: '#fff0b0', transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending }),
      veil: new THREE.MeshBasicMaterial({ color: '#b04dff', transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending }),
      down: new THREE.MeshBasicMaterial({ color: '#ff4f6d', transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide }),
    }),
    [],
  );

  const mats = useMemo(
    () => ({
      main: toon(color),
      accent: toon(accent),
      skin: toon(SKIN),
      dark: toon('#26222e'),
      white: toon('#ffffff'),
      steel: toon('#c3cddd'),
      mark: toon('#bfa8ff', '#a77dff', 2.2),
      glow: toon(cls?.accent ?? '#ffffff', cls?.color ?? '#ffffff', 1.6),
    }),
    [color, accent, cls],
  );

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const t = state.clock.elapsedTime;
    const p = pose;
    const run = Math.min(p.speed / MOVE.speed, 1.2);
    p.phase += dt * (4 + p.speed * 1.6);
    const s = Math.sin(p.phase);

    const b = body.current!;
    let legSwing = 0.85 * s * run;
    let armSwing = -0.65 * s * run;
    b.position.set(0, 0.86 + Math.abs(Math.cos(p.phase)) * 0.07 * run + Math.sin(t * 2.2) * 0.012 * (1 - run), 0);
    b.rotation.set(0.14 * run, 0, 0);
    b.scale.set(1, 1, 1);

    let armRx = armSwing;
    let armRz = -0.12;
    let armLx = -armSwing;
    let armLz = 0.12;

    const f = p.flags;
    const veiled = (f & VF.veil) !== 0;
    b.visible = !(def && modelReady) && (isSelf || !veiled); // gli altri non vedono chi è sotto il Velo
    // comandi per il modello animato
    ctrl.visible = isSelf || !veiled;
    ctrl.move = p.anim === 'down' ? 'down' : p.speed > 0.5 && p.dodgeT < 0 ? 'run' : 'idle';
    ctrl.speed = p.speed;
    ctrl.roll = p.dodgeT >= 0 && p.anim !== 'down' ? Math.min(1, p.dodgeT / MOVE.dodgeTime) : -1;
    if (p.attackT >= 0 && (prevAttack.current < 0 || p.attackT < prevAttack.current)) ctrl.attack++;
    prevAttack.current = p.attackT;
    if (bastion.current) {
      bastion.current.visible = (f & VF.bastion) !== 0;
      bastion.current.scale.setScalar(1 + Math.sin(t * 6) * 0.04);
    }
    if (shield.current) shield.current.visible = (f & VF.shield) !== 0;
    if (veil.current) {
      veil.current.visible = veiled;
      auraMats.veil.opacity = isSelf ? 0.18 : 0.05 + Math.abs(Math.sin(t * 2.5)) * 0.06;
    }
    if (downRing.current) {
      downRing.current.visible = (f & VF.down) !== 0;
      auraMats.down.opacity = 0.35 + Math.sin(t * 5) * 0.15;
    }

    if (p.anim === 'down') {
      // a terra, sulla schiena
      b.rotation.set(-1.45, 0, 0);
      b.position.set(0, 0.32, -0.3);
      legSwing = 0;
      armRx = -0.2;
      armLx = -0.2;
      armRz = -1.2;
      armLz = 1.2;
    } else if (p.anim === 'fall') {
      armRx = -2.8 + Math.sin(t * 18) * 0.4;
      armLx = -2.8 - Math.sin(t * 18) * 0.4;
      legSwing = Math.sin(t * 14) * 0.5;
    }

    if (p.dodgeT >= 0 && p.anim !== 'down') {
      // capriola in avanti
      const k = Math.min(p.dodgeT / MOVE.dodgeTime, 1);
      b.rotation.x = easeOut(k) * Math.PI * 2;
      b.position.y = 0.62 + Math.sin(k * Math.PI) * 0.25;
      b.scale.set(1.05, 0.85, 1.05);
      legSwing = -1.4;
      armRx = armLx = -1.6;
    }

    if (p.attackT >= 0 && p.anim !== 'down') {
      const k = Math.min(p.attackT / MOVE.attackDuration, 1);
      const e = easeOut(k);
      if (cls?.ranged) {
        armRx = -1.55 + Math.sin(k * Math.PI) * -0.25;
        armRz = -0.05;
      } else if (p.attackN === 1) {
        armRx = -2.7 + e * 3.2; // fendente dall'alto
      } else if (p.attackN === 2) {
        armRx = -1.4;
        armRz = 1.2 - e * 2.6; // colpo laterale
        b.rotation.y = 0.5 - e * 1.0;
      } else {
        armRx = -1.6; // affondo
        b.position.z = Math.sin(k * Math.PI) * 0.35;
      }
    }

    if (p.waveT >= 0) {
      armLz = 2.5 + Math.sin(p.waveT * 14) * 0.35;
      armLx = 0;
    }

    legL.current!.rotation.x = legSwing;
    legR.current!.rotation.x = -legSwing;
    armR.current!.rotation.set(armRx, 0, armRz);
    armL.current!.rotation.set(armLx, 0, armLz);
    head.current!.rotation.y = Math.sin(t * 0.7) * 0.08 * (1 - run);
    if (orb.current) {
      orb.current.position.set(0.05 + Math.sin(t * 3) * 0.04, -0.72 + Math.sin(t * 2.4) * 0.05, 0.22);
    }
  });

  const showName = !isSelf;

  return (
    <group>
      {def && <ModelOr key={classId ?? ''} def={def} ctrl={ctrl} onReady={(r) => setReadyUrl(r ? def.url : null)} />}
      <group ref={body}>
        {/* le coordinate qui sotto sono relative al bacino (y = 0.86) */}
        {/* gambe */}
        <group ref={legL} position={[0.15, -0.02, 0]}>
          <mesh material={mats.dark} position={[0, -0.32, 0]} castShadow>
            <capsuleGeometry args={[0.11, 0.42, 3, 8]} />
          </mesh>
          <mesh material={mats.accent} position={[0, -0.66, 0.06]} castShadow>
            <boxGeometry args={[0.2, 0.12, 0.3]} />
          </mesh>
        </group>
        <group ref={legR} position={[-0.15, -0.02, 0]}>
          <mesh material={mats.dark} position={[0, -0.32, 0]} castShadow>
            <capsuleGeometry args={[0.11, 0.42, 3, 8]} />
          </mesh>
          <mesh material={mats.accent} position={[0, -0.66, 0.06]} castShadow>
            <boxGeometry args={[0.2, 0.12, 0.3]} />
          </mesh>
        </group>

        {/* busto */}
        <mesh material={mats.main} position={[0, 0.24, 0]} castShadow>
          <capsuleGeometry args={[0.3, 0.32, 4, 10]} />
        </mesh>
        <mesh material={mats.accent} position={[0, 0.02, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.3, 0.05, 6, 16]} />
        </mesh>
        {(classId === 'tessitore' || classId === 'custode' || !classId) && (
          <mesh material={mats.main} position={[0, -0.18, 0]} castShadow>
            <coneGeometry args={[0.42, 0.75, 9, 1, true]} />
          </mesh>
        )}

        {/* testa grande, da cartoon */}
        <group ref={head} position={[0, 0.78, 0]}>
          <mesh material={mats.skin} castShadow>
            <sphereGeometry args={[0.34, 16, 12]} />
          </mesh>
          {[-1, 1].map((side) => (
            <group key={side} position={[0.12 * side, 0.02, 0.28]}>
              <mesh material={mats.white} scale={[1, 1.25, 0.6]}>
                <sphereGeometry args={[0.075, 10, 8]} />
              </mesh>
              <mesh material={mats.dark} position={[0, -0.005, 0.04]}>
                <sphereGeometry args={[0.04, 8, 6]} />
              </mesh>
            </group>
          ))}
          <Headgear classId={classId} mats={mats} />
        </group>

        {/* braccio destro (arma) */}
        <group ref={armR} position={[-0.42, 0.42, 0]}>
          <mesh material={mats.main} position={[0, -0.24, 0]} castShadow>
            <capsuleGeometry args={[0.085, 0.36, 3, 8]} />
          </mesh>
          <mesh material={mats.skin} position={[0, -0.5, 0]}>
            <sphereGeometry args={[0.1, 10, 8]} />
          </mesh>
          <RightHandGear classId={classId} mats={mats} orbRef={orb} />
        </group>

        {/* braccio sinistro, con il segno luminoso sul polso */}
        <group ref={armL} position={[0.42, 0.42, 0]}>
          <mesh material={mats.main} position={[0, -0.24, 0]} castShadow>
            <capsuleGeometry args={[0.085, 0.36, 3, 8]} />
          </mesh>
          <mesh material={mats.skin} position={[0, -0.5, 0]}>
            <sphereGeometry args={[0.1, 10, 8]} />
          </mesh>
          <mesh material={mats.mark} position={[0, -0.41, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.1, 0.028, 6, 14]} />
          </mesh>
          {classId === 'guardiano' && (
            <group position={[0.14, -0.3, 0.08]} rotation={[0, Math.PI / 2, 0]}>
              <mesh material={mats.main} rotation={[Math.PI / 2, 0, 0]} castShadow>
                <cylinderGeometry args={[0.34, 0.34, 0.07, 8]} />
              </mesh>
              <mesh material={mats.accent} position={[0, 0, 0.05]}>
                <sphereGeometry args={[0.09, 8, 6]} />
              </mesh>
            </group>
          )}
          {classId === 'lama' && <Dagger mats={mats} />}
        </group>
      </group>

      <mesh ref={bastion} material={auraMats.bastion} position={[0, 1, 0]} visible={false}>
        <sphereGeometry args={[1.25, 18, 12]} />
      </mesh>
      <mesh ref={shield} material={auraMats.shield} position={[0, 1, 0]} visible={false}>
        <sphereGeometry args={[1.05, 16, 10]} />
      </mesh>
      <mesh ref={veil} material={auraMats.veil} position={[0, 0.95, 0]} visible={false}>
        <capsuleGeometry args={[0.45, 0.9, 4, 10]} />
      </mesh>
      <mesh ref={downRing} material={auraMats.down} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]} visible={false}>
        <ringGeometry args={[REVIVE_RADIUS - 0.12, REVIVE_RADIUS, 40]} />
      </mesh>
      <NameTag playerId={playerId} name={name} icon={classId ? `classe-${classId}` : undefined} show={showName} />
    </group>
  );
}

type Mats = Record<'main' | 'accent' | 'skin' | 'dark' | 'white' | 'steel' | 'mark' | 'glow', THREE.Material>;

function Headgear({ classId, mats }: { classId: ClassId | null; mats: Mats }) {
  switch (classId) {
    case 'guardiano':
      return (
        <group>
          <mesh material={mats.steel} position={[0, 0.06, -0.02]} castShadow>
            <sphereGeometry args={[0.37, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
          </mesh>
          <mesh material={mats.accent} position={[0, 0.42, -0.02]}>
            <boxGeometry args={[0.07, 0.16, 0.5]} />
          </mesh>
        </group>
      );
    case 'lama':
      return (
        <group>
          <mesh material={mats.main} position={[0, 0.04, -0.05]} scale={[1.08, 1.1, 1.12]} castShadow>
            <sphereGeometry args={[0.36, 14, 10, Math.PI * 0.15, Math.PI * 1.7, 0, Math.PI * 0.62]} />
          </mesh>
          <mesh material={mats.accent} position={[0, -0.3, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.24, 0.07, 6, 14]} />
          </mesh>
        </group>
      );
    case 'tessitore':
      return (
        <group position={[0, 0.22, -0.03]} rotation={[-0.18, 0, 0.12]}>
          <mesh material={mats.main} position={[0, 0.34, 0]} castShadow>
            <coneGeometry args={[0.32, 0.8, 8]} />
          </mesh>
          <mesh material={mats.main} position={[0, -0.02, 0]}>
            <cylinderGeometry args={[0.5, 0.5, 0.05, 12]} />
          </mesh>
          <mesh material={mats.accent} position={[0, 0.05, 0]}>
            <cylinderGeometry args={[0.33, 0.33, 0.08, 10]} />
          </mesh>
        </group>
      );
    case 'custode':
      return (
        <mesh material={mats.glow} position={[0, 0.5, 0]} rotation={[Math.PI / 2 - 0.25, 0, 0]}>
          <torusGeometry args={[0.24, 0.035, 6, 20]} />
        </mesh>
      );
    default:
      // senza classe: cappuccio grigio, "senza ricordi"
      return (
        <mesh material={mats.main} position={[0, 0.03, -0.06]} scale={[1.08, 1.1, 1.1]} castShadow>
          <sphereGeometry args={[0.36, 14, 10, Math.PI * 0.2, Math.PI * 1.6, 0, Math.PI * 0.6]} />
        </mesh>
      );
  }
}

function Dagger({ mats }: { mats: Mats }) {
  return (
    <group position={[0, -0.55, 0.1]} rotation={[Math.PI / 2, 0, 0]}>
      <mesh material={mats.steel} position={[0, 0.25, 0]} scale={[0.3, 1, 0.1]}>
        <octahedronGeometry args={[0.28, 0]} />
      </mesh>
      <mesh material={mats.accent}>
        <boxGeometry args={[0.18, 0.04, 0.05]} />
      </mesh>
    </group>
  );
}

function RightHandGear({
  classId,
  mats,
  orbRef,
}: {
  classId: ClassId | null;
  mats: Mats;
  orbRef: React.RefObject<THREE.Mesh | null>;
}) {
  switch (classId) {
    case 'guardiano':
      return (
        <group position={[0, -0.55, 0.1]} rotation={[Math.PI / 2, 0, 0]}>
          <mesh material={mats.steel} position={[0, 0.38, 0]} castShadow>
            <boxGeometry args={[0.08, 0.62, 0.025]} />
          </mesh>
          <mesh material={mats.accent} position={[0, 0.05, 0]}>
            <boxGeometry args={[0.26, 0.05, 0.06]} />
          </mesh>
        </group>
      );
    case 'lama':
      return <Dagger mats={mats} />;
    case 'tessitore':
      return (
        <mesh ref={orbRef} material={mats.glow}>
          <icosahedronGeometry args={[0.12, 1]} />
        </mesh>
      );
    case 'custode':
      return (
        <group position={[0, -0.52, 0.05]}>
          <mesh material={mats.dark} position={[0, 0.2, 0]}>
            <cylinderGeometry args={[0.03, 0.035, 1.5, 6]} />
          </mesh>
          <mesh material={mats.glow} position={[0, 0.98, 0]}>
            <icosahedronGeometry args={[0.11, 0]} />
          </mesh>
        </group>
      );
    default:
      return null;
  }
}

function NameTag({ playerId, name, icon, show }: { playerId: string; name: string; icon?: string; show: boolean }) {
  const isHost = useGame((s) => s.room.hostId === playerId);
  const emote = useGame((s) => s.emotes[playerId]);
  if (!show && !emote) return null;
  const emoji = emote ? EMOTES[emote.e]?.icon : null;
  return (
    <Html position={[0, 2.45, 0]} center distanceFactor={9} zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
      <div className="nametag">
        {emoji && (
          <div className="emote-bubble" key={emote!.t0}>
            {emoji}
          </div>
        )}
        {show && (
          <div className="nametag-label">
            {isHost && <span title="Host">👑</span>}
            {icon && <Icon name={icon} size={16} />}
            <span>{name}</span>
          </div>
        )}
        {show && <HpBar playerId={playerId} />}
      </div>
    </Html>
  );
}

/** Vita del compagno sopra la testa (solo dentro la Frattura). */
function HpBar({ playerId }: { playerId: string }) {
  const inRun = useGame((s) => !!s.room.run && s.room.run.phase !== 'countdown');
  const fill = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!inRun) return;
    const t = setInterval(() => {
      const v = getRoom()?.vitals.get(playerId);
      if (!v || !fill.current || !wrap.current) return;
      const frac = Math.max(0, Math.min(1, v.hp / Math.max(1, v.mhp)));
      fill.current.style.width = `${frac * 100}%`;
      wrap.current.dataset.state = v.f & VF.dead ? 'dead' : v.f & VF.down ? 'down' : '';
    }, 150);
    return () => clearInterval(t);
  }, [inRun, playerId]);
  if (!inRun) return null;
  return (
    <div className="ally-hp" ref={wrap}>
      <div className="ally-hp-fill" ref={fill} />
    </div>
  );
}
