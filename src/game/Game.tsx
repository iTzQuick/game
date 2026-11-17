// La scena di gioco: canvas 3D con fisica, più l'interfaccia sopra.

import { Canvas, useFrame } from '@react-three/fiber';
import { Physics } from '@react-three/rapier';
import { PerformanceMonitor } from '@react-three/drei';
import { Suspense, useEffect, useRef, useState } from 'react';
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
import { preloadModels } from '../player/RiggedModel';
import '../player/models';
import { getRoom } from '../net/room';
import { dispatchCombat, isCombatMsg } from '../combat/bus';
import { director } from '../combat/director';
import { playRemoteAbility } from '../combat/abilities';
import { combat } from '../combat/runtime';
import { CombatView } from '../combat/view';
import { runRequest } from '../world/layout';
import { groupKeeper } from '../progress/group';
import { initRewards } from '../progress/rewards';
import { getProgress, mutate } from '../progress/store';

if (window.__fratture) Object.assign(window.__fratture, { local: localDebug, combat, director, runRequest, press, groupKeeper, getProgress, mutate });

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
    groupKeeper.start();
    const offRewards = initRewards();
    return () => {
      off?.();
      offRewards();
      groupKeeper.stop();
      director.stop();
      combat.onRemoteAbility = null;
      combat.clearWorld();
    };
  }, []);

  // Risoluzione: si parte dal massimo della qualità scelta e, se i fotogrammi
  // scendono, si abbassa da sola (e risale quando il gioco torna fluido).
  // Sui telefoni lo schermo ha 2-3 pixel per punto: sotto 1 l'immagine si sgrana.
  const screen = window.devicePixelRatio || 1;
  const maxDpr = Math.min(quality === 'bassa' ? 1.5 : quality === 'media' ? 1.75 : 2, screen);
  const minDpr = Math.min(1, maxDpr);
  const [dprScale, setDprScale] = useState(1);
  const dpr = Math.max(minDpr, Math.round(maxDpr * dprScale * 100) / 100);
  frameStats.dpr = dpr;
  useEffect(() => setDprScale(1), [quality]);
  useEffect(() => preloadModels(), []);

  return (
    <div className="game" ref={wrap}>
      <Canvas
        key={quality}
        shadows={quality === 'bassa' ? false : { type: quality === 'alta' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap }}
        dpr={dpr}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        camera={{ fov: 60, near: 0.1, far: 400, position: [0, 6, 18] }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.15;
        }}
      >
        <PerformanceMonitor
          flipflops={6}
          onDecline={() => setDprScale((s) => Math.max(0.5, s - 0.15))}
          onIncline={() => setDprScale((s) => Math.min(1, s + 0.1))}
          onFallback={() => setDprScale(0.5)}
        />
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
