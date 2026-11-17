// Le missioni del giorno (narratore o riserva): si sceglie e si parte.

import { getGame, setGame, toast, useGame } from '../game/store';
import { MODS } from '../combat/defs';
import { difficolta, testoObiettivo } from '../narrator/core';
import { RARITIES, missionReward } from '../progress/defs';
import { runRequest } from '../world/layout';
import { Modal, closePanel } from './Modal';

function startMission(id: string) {
  const s = getGame();
  if (!s.room.classes[s.selfId]) {
    toast('Scegli prima una classe');
    setGame({ panel: null, classPicker: true });
    return;
  }
  runRequest('start', id);
  closePanel();
}

export function MissionsPanel() {
  const nar = useGame((s) => s.room.narrazione);
  const fatte = useGame((s) => s.room.fatte);
  const stato = useGame((s) => s.room.statoNarratore);
  const busy = useGame((s) => !!s.room.run);
  const grado = useGame((s) => s.room.grado);
  return (
    <Modal title="Missioni di oggi" wide>
      {!nar ? (
        <p className="muted">Il Custode sta ancora decidendo…</p>
      ) : (
        <div className="missions">
          {nar.missioni.map((m) => {
            const done = fatte.includes(m.id);
            const d = difficolta(m);
            const rw = missionReward(d, grado);
            return (
              <article key={m.id} className={`mission${done ? ' done' : ''}`} data-mission={m.id}>
                <header>
                  <h3>{m.titolo}</h3>
                  <span className="stars" title={`Difficoltà ${d} su 4`} aria-label={`Difficoltà ${d} su 4`}>
                    {'★'.repeat(d)}
                    <span className="muted">{'☆'.repeat(4 - d)}</span>
                  </span>
                </header>
                <p>{m.racconto}</p>
                <p className="mission-goal">{testoObiettivo(m.obiettivo)}</p>
                {m.modificatori.length > 0 && <p className="small-text muted">{m.modificatori.map((id) => MODS[id].name).join(' · ')}</p>}
                <div className="mission-foot">
                  <span className="small-text">
                    +{rw.frags} frammenti
                    {rw.minRarity !== null ? ` e un oggetto ${RARITIES[rw.minRarity].name.toLowerCase()} o migliore` : ''}
                  </span>
                  {done ? (
                    <span className="badge">Compiuta ✓</span>
                  ) : (
                    <button className="primary" disabled={busy} onClick={() => startMission(m.id)}>
                      Parti
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
      <p className="small-text muted mission-source">
        {nar?.fonte === 'claude' ? 'Scritte dal narratore per la vostra compagnia. Domani ce ne saranno di nuove.' : stato || 'Missioni di riserva.'}
      </p>
    </Modal>
  );
}
