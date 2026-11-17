// Statistiche per la verifica di fine tappa 3: "in 4 il gioco resta fluido?"
// Mostra FPS, latenza e tipo di collegamento verso ogni giocatore.

import { useEffect, useState } from 'react';
import { getRoom } from '../net/room';
import { displayName, useGame } from '../game/store';
import { MODELS_ENABLED, modelStatus } from '../player/RiggedModel';

export const frameStats = {
  frames: 0,
  acc: 0,
  fps: 0,
  worst: 0,
  worstAcc: 0,
  /** risoluzione attuale (pixel per punto) */
  dpr: 1,
  tick(dt: number) {
    this.frames++;
    this.acc += dt;
    this.worstAcc = Math.max(this.worstAcc, dt);
    if (this.acc >= 0.5) {
      this.fps = Math.round(this.frames / this.acc);
      this.worst = Math.round(this.worstAcc * 1000);
      this.frames = 0;
      this.acc = 0;
      this.worstAcc = 0;
    }
  },
};

export function StatsPanel() {
  const peers = useGame((s) => s.room.peers);
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 500);
    return () => clearInterval(id);
  }, []);
  const room = getRoom();
  return (
    <div className="stats">
      <div>
        <b>{frameStats.fps}</b> FPS · frame peggiore {frameStats.worst} ms · risoluzione ×{frameStats.dpr}
      </div>
      <div className="muted">
        {MODELS_ENABLED ? `modelli 3D pronti: ${modelStatus.ready.size}` : 'modelli 3D spenti (?modelli=0)'}
        {modelStatus.failed.size > 0 && ` · non caricati: ${modelStatus.failed.size}`}
      </div>
      {[...modelStatus.failed].map(([file, msg]) => (
        <div key={file} className="error-line">
          {file}: {msg}
        </div>
      ))}
      {Object.entries(peers).map(([id, p]) => (
        <div key={id}>
          {displayName(id)}: {linkLabel(p.link)}
          {p.rtt !== null && ` · ${p.rtt} ms`}
        </div>
      ))}
      {room && (
        <div className="muted">
          inviati P2P {room.stats.sentP2P} · relay {room.stats.sentRelay} · ricevuti {room.stats.recv}
        </div>
      )}
    </div>
  );
}

export function linkLabel(l: string): string {
  switch (l) {
    case 'p2p':
      return 'P2P';
    case 'relay':
      return 'relay';
    case 'local':
      return 'locale';
    default:
      return 'collegamento…';
  }
}
