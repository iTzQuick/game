// Elenco dei modelli 3D pronti (in public/models) e il loro uso nel gioco.
// Si aggiungono qui man mano che arrivano da Higgsfield.

import { Component, Suspense, useState, type ReactNode } from 'react';
import { registerModels, RiggedModel, PropModel, PROP_MODELS, type ModelCtrl, type ModelDef } from './RiggedModel';
import { Dagger, Halo, Orb, Shield, Staff, Sword } from './gear';

// lama in avanti e un po' in basso, come in guardia
const FORWARD: [number, number, number] = [Math.PI / 2 + 0.25, 0, 0];

registerModels({
  heroes: {
    guardiano: {
      file: 'guardiano.glb', height: 1.85, clips: { idle: 'idle', run: 'run', attack: 'attack', down: 'down' }, runSpeed: 5.5, attackSpeed: 1.5,
      gear: [
        { bone: 'RightHand', pos: [-0.032, -0.067, 0.03], rot: FORWARD, node: <Sword /> },
        { bone: 'LeftForeArm', pos: [0.09, -0.085, 0.12], rot: [0, 0.35, 0], node: <Shield /> },
      ],
    },
    lama: {
      file: 'lama.glb', height: 1.75, clips: { idle: 'idle', run: 'run', attack: 'attack', down: 'down' }, runSpeed: 6, attackSpeed: 1.5,
      gear: [
        { bone: 'RightHand', pos: [-0.022, -0.065, 0.025], rot: FORWARD, node: <Dagger /> },
        { bone: 'LeftHand', pos: [0.023, -0.065, 0.025], rot: FORWARD, node: <Dagger /> },
      ],
    },
    tessitore: {
      file: 'tessitore.glb', height: 1.95, clips: { idle: 'idle', run: 'run', attack: 'attack', down: 'down' }, runSpeed: 5.5, attackSpeed: 1.5,
      gear: [{ bone: 'RightHand', pos: [-0.06, -0.14, 0.18], node: <Orb /> }],
    },
    custode: {
      file: 'custode.glb', height: 1.8, clips: { idle: 'idle', run: 'run', attack: 'attack', down: 'down' }, runSpeed: 5.5, attackSpeed: 1.5,
      gear: [
        { bone: 'RightHand', pos: [-0.038, -0.055, 0.04], node: <Staff /> },
        { bone: 'Head', pos: [0, 0, 0], node: <Halo height={0.36} /> },
      ],
    },
  },
  enemies: {
    // l'attacco dura quanto il preavviso (0,55 s), così il colpo cade quando arriva il danno
    ombra: { file: 'ombra.glb', height: 1.95, clips: { idle: 'idle', run: 'walk', attack: 'attack' }, runSpeed: 2.6, attackSpeed: 1.1 },
    // senza scheletro: vola, ondeggia e si getta in avanti grazie al codice di EnemyMesh
    sciame: { file: 'sciame.glb', height: 0.42, clips: {}, rigid: true, lift: 0.75 },
    // attackSpeed = momento del colpo nel clip ritagliato / preavviso del nemico (defs.ts)
    riflesso: { file: 'riflesso.glb', height: 2.1, clips: { idle: 'idle', run: 'walk', attack: 'attack' }, runSpeed: 2.0, attackSpeed: 0.87 },
    bruto: { file: 'bruto.glb', height: 2.5, clips: { idle: 'idle', run: 'walk', attack: 'attack' }, runSpeed: 1.5, attackSpeed: 0.68 },
    velato: { file: 'velato.glb', height: 2.0, clips: { idle: 'idle', run: 'walk', attack: 'attack' }, runSpeed: 2.6, attackSpeed: 0.84 },
    eco: { file: 'eco.glb', height: 3.4, clips: { idle: 'idle', run: 'walk', attack: 'attack' }, runSpeed: 2.2, attackSpeed: 1.0 },
  },
  props: {
    portale: { file: 'portale.glb', height: 5.6 },
  },
});

/** Se un modello non si carica, si torna alla versione di forme semplici. */
class ModelBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    console.warn('Modello 3D non caricato, uso la versione semplice', err);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * Mostra il modello animato; finché non è pronto (o se non c'è) mostra `fallback`.
 * `onReady(true)` avvisa chi deve nascondere la versione semplice.
 */
export function ModelOr({ def, ctrl, onReady }: { def: ModelDef; ctrl: ModelCtrl; onReady: (ready: boolean) => void }) {
  return (
    <ModelBoundary fallback={<Reset onReady={onReady} />}>
      <Suspense fallback={null}>
        <RiggedModel def={def} ctrl={ctrl} onReady={() => onReady(true)} />
      </Suspense>
    </ModelBoundary>
  );
}

function Reset({ onReady }: { onReady: (r: boolean) => void }) {
  useState(() => {
    onReady(false);
    return 0;
  });
  return null;
}

export function PropOr({ name, fallback }: { name: string; fallback: ReactNode }) {
  if (!PROP_MODELS[name]) return <>{fallback}</>;
  return (
    <ModelBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <PropModel name={name} />
      </Suspense>
    </ModelBoundary>
  );
}
