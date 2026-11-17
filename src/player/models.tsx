// Elenco dei modelli 3D pronti (in public/models) e il loro uso nel gioco.
// Si aggiungono qui man mano che arrivano da Higgsfield.

import { Component, Suspense, useState, type ReactNode } from 'react';
import { registerModels, RiggedModel, PropModel, type ModelCtrl, type ModelDef } from './RiggedModel';

registerModels({
  heroes: {
    guardiano: { file: 'guardiano.glb', height: 1.85, clips: { idle: 'idle', run: 'run', attack: 'attack', down: 'down' }, runSpeed: 5.5 },
  },
  enemies: {
    ombra: { file: 'ombra.glb', height: 1.95, clips: { idle: 'idle', run: 'walk', attack: 'attack' }, runSpeed: 2.6 },
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
  return (
    <ModelBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <PropModel name={name} />
      </Suspense>
    </ModelBoundary>
  );
}
