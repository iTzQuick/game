// La scena di gioco: canvas 3D con fisica, più l'interfaccia sopra.

import { Canvas, useFrame } from '@react-three/fiber';
import { Physics } from '@react-three/rapier';
import { Suspense, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { Effects } from '../fx/effects';
import { LocalPlayer, localDebug } from '../player/LocalPlayer';
import { RemotePlayers } from '../player/RemotePlayers';
import { Hud } from '../ui/Hud';
import { TouchControls } from '../ui/TouchControls';
import { Crocevia } from '../world/Crocevia';
import { Frattura } from '../world/Frattura';
import { installDesktopInput, press } from './input';
import { isTouchDevice, useGame } from './store';
import { frameStats } from '../ui/Stats';
import { getRoom } from '../net/room';
import { dispatchCombat, isCombatMsg } from '../combat/bus';
import { director } from '../combat/director';
import { playRemoteAbility } from '../combat/abilities';
import { combat } from '../combat/runtime';
import { CombatView } from '../combat/view';
import { runRequest } from '../world/layout';

if (window.__fratture) Object.assign(window.__fratture, { local: localDebug, combat, director, runRequest, press });

export function Game() {
  const quality = useGame((s) => s.settings.quality);
  const touchSetting = useGame((s) => s.settings.touch);
  const inRun = useGame((s) => !!s.room.run && s.room.run.phase !== 'countdown');
  const wrap = useRef<HTMLDivElement>(null);
  const touch = touchSetting === 'on' || (touchSetting === 'auto' && isTouchDevice());

  useEffect(() => {
    const canvas = wrap.current?.querySelector('canvas');
    if (!canvas) return;
    return installDesktopInput(canvas);
  }, [quality]);

  // combattimento: messaggi dalla rete, regia dell'host, effetti degli altri
  useEffect(() => {
    const room = getRoom();
    const off = room?.onEvent((from, ev) => {
      if (isCombatMsg(ev)) dispatchCombat(from, ev);
    });
    combat.onRemoteAbility = playRemoteAbility;
    director.start();
    return () => {
      off?.();
      director.stop();
      combat.onRemoteAbility = null;
      combat.clearWorld();
    };
  }, []);

  const dpr: [number, number] =
    quality === 'bassa' ? [0.75, 1] : quality === 'media' ? [1, Math.min(1.5, window.devicePixelRatio)] : [1, Math.min(2, window.devicePixelRatio)];

  return (
    <div className="game" ref={wrap}>
      <Canvas
        key={quality}
        shadows={quality === 'bassa' ? false : { type: quality === 'alta' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap }}
        dpr={dpr}
        gl={{ antialias: quality !== 'bassa', powerPreference: 'high-performance' }}
        camera={{ fov: 60, near: 0.1, far: 400, position: [0, 6, 18] }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.15;
        }}
      >
        <Suspense fallback={null}>
          <Physics gravity={[0, -20, 0]}>
            {inRun ? <Frattura quality={quality} /> : <Crocevia quality={quality} />}
            <LocalPlayer />
          </Physics>
          <RemotePlayers />
          <CombatView />
          <Effects />
          <FrameCounter />
        </Suspense>
      </Canvas>
      <Hud touch={touch} />
      {touch && <TouchControls />}
    </div>
  );
}

function FrameCounter() {
  useFrame((_, dt) => frameStats.tick(dt));
  return null;
}
