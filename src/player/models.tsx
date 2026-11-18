// Elenco dei modelli 3D pronti (in public/models) e il loro uso nel gioco.
// Si aggiungono qui man mano che arrivano da Higgsfield.

import { Component, Suspense, useEffect, type ReactNode } from 'react';
import { modelStatus, registerModels, RiggedModel, PropModel, PROP_MODELS, type ModelCtrl, type ModelDef } from './RiggedModel';
import { Dagger, Halo, Orb, Shield, Staff, Sword } from './gear';

// lama in avanti e un po' in basso, come in guardia
const FORWARD: [number, number, number] = [Math.PI / 2 + 0.25, 0, 0];

/**
 * Arma generata da Higgsfield, con l'impugnatura sull'origine (dove c'è la mano);
 * se il modello non c'è, quella di forme semplici di gear.tsx.
 * `y` = dove sta la base del modello rispetto alla mano.
 */
const weapon = (name: string, y: number, fallback: ReactNode) => <PropOr name={name} y={y} fallback={fallback} />;

registerModels({
  heroes: {
    guardiano: {
      file: 'guardiano.glb', height: 1.85, runSpeed: 5.5, attackSpeed: 1.5,
      // 2° e 3° colpo, Colpo di scudo (Q), schianto per Barriera (R) e Bastione (F), capriola
      clips: { idle: 'idle', run: 'run', attack: 'attack', down: 'down', attack2: 'attack2', attack3: 'attack3', abQ: 'abQ', abR: 'abR', abF: 'abR', dodge: 'dodge' },
      speeds: { attack2: 2.0, attack3: 2.1, abQ: 1.8, abR: 2.1, abF: 1.9 },
      gear: [
        { bone: 'RightHand', pos: [-0.032, -0.067, 0.03], rot: FORWARD, node: weapon('spada', -0.12, <Sword />), trail: { a: 0.25, b: 0.85 } },
        // legato sul lato esterno dell'avambraccio, rivolto in fuori e un po' in avanti: il braccio non lo attraversa
        { bone: 'LeftForeArm', pos: [0.151, -0.06, 0.043], rot: [-1.372, 0.829, 1.199], node: weapon('scudo', -0.31, <Shield />) },
      ],
    },
    lama: {
      file: 'lama.glb', height: 1.75, runSpeed: 6, attackSpeed: 1.5,
      // combo a due lame, Scatto (Q), Lame vorticanti (E, anche nei Mille tagli), capriola
      clips: { idle: 'idle', run: 'run', attack: 'attack', down: 'down', attack2: 'attack2', attack3: 'attack3', abQ: 'abQ', abE: 'abE', abF: 'abE', dodge: 'dodge' },
      speeds: { attack2: 2.5, attack3: 2.9, abQ: 2.4, abE: 2.9, abF: 2.9 },
      gear: [
        { bone: 'RightHand', pos: [-0.022, -0.065, 0.025], rot: FORWARD, node: weapon('pugnale', -0.06, <Dagger />), trail: { a: 0.08, b: 0.38 } },
        { bone: 'LeftHand', pos: [0.023, -0.065, 0.025], rot: FORWARD, node: weapon('pugnale', -0.06, <Dagger />), trail: { a: 0.08, b: 0.38 } },
      ],
    },
    tessitore: {
      file: 'tessitore.glb', height: 1.95, runSpeed: 5.5, attackSpeed: 1.5,
      // Varco (Q), Trappola (E), Collasso (F), capriola; il Dardo (R) usa l'attacco
      clips: { idle: 'idle', run: 'run', attack: 'attack', down: 'down', abQ: 'abQ', abE: 'abE', abF: 'abF', dodge: 'dodge' },
      speeds: { abQ: 2.6, abE: 2.6, abF: 2.3 },
      gear: [{ bone: 'RightHand', pos: [-0.06, -0.14, 0.18], node: <Orb />, trail: { a: -0.06, b: 0.06 } }],
    },
    custode: {
      file: 'custode.glb', height: 1.8, runSpeed: 5.5, attackSpeed: 1.5,
      // Raggio (Q), Rivelazione e Benedizione (E, R), Alba (F), capriola
      clips: { idle: 'idle', run: 'run', attack: 'attack', down: 'down', abQ: 'abQ', abE: 'abR', abR: 'abR', abF: 'abF', dodge: 'dodge' },
      speeds: { abQ: 2.6, abE: 2.6, abR: 2.4, abF: 2.4 },
      gear: [
        { bone: 'RightHand', pos: [-0.038, -0.055, 0.04], node: weapon('bastone', -0.98, <Staff />), trail: { a: 0.55, b: 0.95 } },
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
    // Città Sommersa
    annegato: { file: 'annegato.glb', height: 1.85, clips: { idle: 'idle', run: 'walk', attack: 'attack' }, runSpeed: 2.0, attackSpeed: 0.81 },
    // senza scheletro: nuota serpeggiando e scatta (EnemyMesh)
    anguilla: { file: 'anguilla.glb', height: 0.9, clips: {}, rigid: true, lift: 0.55 },
    // il boss: una campana che galleggia e dondola
    campana: { file: 'campana.glb', height: 4.2, clips: {}, rigid: true, lift: 0.4 },
  },
  props: {
    portale: { file: 'portale.glb', height: 5.6 },
    'portale-citta-sommersa': { file: 'portale-citta-sommersa.glb', height: 5.6 },
    'portale-foresta-sussurri': { file: 'portale-foresta-sussurri.glb', height: 5.6 },
    'portale-metropoli-spenta': { file: 'portale-metropoli-spenta.glb', height: 5.6 },
    'portale-deserto-specchi': { file: 'portale-deserto-specchi.glb', height: 5.6 },
    // Crocevia
    'custode-muto': { file: 'custode-muto.glb', height: 3.0 },
    colonna: { file: 'colonna.glb', height: 3.6 },
    moncone: { file: 'moncone.glb', height: 1.6, maxWidth: 1.7 },
    piedistallo: { file: 'piedistallo.glb', height: 1.1, maxWidth: 1.5 },
    // edifici della base (stanno sulle fondamenta, larghe 4,4 m)
    forgia: { file: 'forgia.glb', height: 2.6, maxWidth: 3.6 },
    giardino: { file: 'giardino.glb', height: 1.6, maxWidth: 3.8 },
    biblioteca: { file: 'biblioteca.glb', height: 3.0, maxWidth: 3.8 },
    trofei: { file: 'trofei.glb', height: 3.0, maxWidth: 3.6 },
    osservatorio: { file: 'osservatorio.glb', height: 3.6, maxWidth: 3.4 },
    // Città Sommersa
    campanile: { file: 'campanile.glb', height: 7, maxWidth: 3.6 },
    // armi degli eroi (vedi gear.tsx)
    spada: { file: 'spada.glb', height: 0.9 },
    scudo: { file: 'scudo.glb', height: 0.62 },
    pugnale: { file: 'pugnale.glb', height: 0.38 },
    bastone: { file: 'bastone.glb', height: 1.78 },
  },
});

/** Se un modello non si carica, si torna alla versione di forme semplici. */
class ModelBoundary extends Component<{ children: ReactNode; fallback: ReactNode; file: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    console.warn(`Modello 3D ${this.props.file} non caricato, uso la versione semplice`, err);
    modelStatus.failed.set(this.props.file, err instanceof Error ? err.message.slice(0, 120) : String(err).slice(0, 120));
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
    <ModelBoundary fallback={<Reset onReady={onReady} />} file={def.url.split('/').pop() ?? def.url}>
      <Suspense fallback={null}>
        <RiggedModel def={def} ctrl={ctrl} onReady={() => onReady(true)} />
      </Suspense>
    </ModelBoundary>
  );
}

function Reset({ onReady }: { onReady: (r: boolean) => void }) {
  // una volta sola, quando il modello si arrende
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => onReady(false), []);
  return null;
}

export function PropOr({
  name,
  fallback,
  height,
  maxWidth,
  y,
}: {
  name: string;
  fallback: ReactNode;
  height?: number;
  maxWidth?: number;
  y?: number;
}) {
  if (!PROP_MODELS[name]) return <>{fallback}</>;
  return (
    <ModelBoundary fallback={fallback} file={PROP_MODELS[name].url.split('/').pop() ?? name}>
      <Suspense fallback={fallback}>
        <PropModel name={name} height={height} maxWidth={maxWidth} y={y} />
      </Suspense>
    </ModelBoundary>
  );
}
