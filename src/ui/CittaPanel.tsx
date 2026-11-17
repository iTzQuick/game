// La Città Sommersa: le missioni dell'Atto I (dal portale del Crocevia) e il
// voto della compagnia dopo la Campana.

import { useEffect, useRef, useState } from 'react';
import { getGame, openDialog, setGame, toast, useGame } from '../game/store';
import { emitCombat } from '../combat/bus';
import { getRoom } from '../net/room';
import { MODS } from '../combat/defs';
import { difficolta, testoObiettivo } from '../narrator/core';
import { RARITIES, missionReward } from '../progress/defs';
import { runRequest } from '../world/layout';
import { ATTO1, OSSIGENO, VERITA, VOTO, capitoloAtto } from '../citta/core';
import { Icon } from './Icon';
import { Modal, closePanel } from './Modal';

function start(id: string) {
  const s = getGame();
  if (!s.room.classes[s.selfId]) {
    toast('Scegli prima una classe');
    setGame({ panel: null, classPicker: true });
    return;
  }
  runRequest('start', id);
  closePanel();
}

export function CittaPanel() {
  const atto = useGame((s) => s.room.atto1);
  const busy = useGame((s) => !!s.room.run);
  const grado = useGame((s) => s.room.grado);
  return (
    <Modal title="La Città Sommersa · Atto I" wide>
      <p className="atto-intro muted">
        Laggiù l’aria finisce: l’ossigeno cala di continuo (un minuto abbondante) e si riprende nelle <b>colonne di bolle</b>. Gli Annegati, quando
        colpiscono, rubano il fiato.
      </p>
      <div className="missions">
        {ATTO1.map((m, i) => {
          const done = i < atto.fatte;
          const next = i === atto.fatte;
          const d = difficolta(m);
          const rw = missionReward(d, grado);
          if (!done && !next) {
            return (
              <article key={m.id} className="mission locked">
                <header>
                  <h3>🔒 {i + 1}. ???</h3>
                </header>
                <p className="small-text">Si apre dopo «{ATTO1[i - 1].titolo}».</p>
              </article>
            );
          }
          return (
            <article key={m.id} className={`mission${done ? ' done' : ''}`} data-mission={m.id}>
              <header>
                <h3>
                  {i + 1}. {m.titolo}
                </h3>
                {done && <span className="badge">Compiuta ✓</span>}
              </header>
              <p>{m.racconto}</p>
              <p className="mission-goal">{testoObiettivo(m.obiettivo)}</p>
              {m.modificatori.length > 0 && <p className="small-text muted">{m.modificatori.map((id) => MODS[id].name).join(' · ')}</p>}
              <div className="mission-foot">
                <span className="small-text">
                  +{rw.frags} frammenti
                  {rw.minRarity !== null ? ` e un oggetto ${RARITIES[rw.minRarity].name.toLowerCase()} o migliore` : ''}
                </span>
                <button className={next ? 'primary' : ''} disabled={busy} onClick={() => start(m.id)}>
                  {next ? 'Parti' : 'Rigioca'}
                </button>
              </div>
            </article>
          );
        })}
        {atto.fatte >= ATTO1.length && (
          <div className="verita">
            <h3>
              <Icon name="verita" size={24} /> {VERITA.titolo}
            </h3>
            {VERITA.testo.map((t, i) => (
              <p key={i}>{t}</p>
            ))}
            <p className="small-text">
              {atto.scelta === null ? 'La compagnia deve ancora decidere cosa fare della Campana.' : `La compagnia ha scelto: «${VOTO.opzioni[atto.scelta].titolo}».`}
            </p>
          </div>
        )}
      </div>
      <p className="small-text muted mission-source">
        Le missioni della storia valgono per tutta la compagnia. Ossigeno pieno: {OSSIGENO.max}; senza aria si perde vita.
      </p>
    </Modal>
  );
}

/** Il voto dopo la Campana: compare a tutti, sopra il gioco, quando non c'è un dialogo aperto. */
export function VotePanel() {
  const voto = useGame((s) => s.room.voto);
  const selfId = useGame((s) => s.selfId);
  const members = useGame((s) => s.room.members);
  const dialog = useGame((s) => s.dialog);
  const [hidden, setHidden] = useState(false);
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  if (!voto?.aperto || dialog || hidden) return null;
  const mine = voto.voti[selfId];
  const count = Object.keys(voto.voti).length;
  const left = Math.max(0, Math.ceil((voto.scade - Date.now()) / 1000));
  const vote = (v: 0 | 1) => {
    const host = getRoom()?.hostId;
    if (host) emitCombat({ t: 'voto', v }, { to: host });
  };
  return (
    <div className="modal-wrap">
      <div className="modal wide vote-modal">
        <div className="modal-head">
          <h2>
            <Icon name="voto" size={26} /> Il voto della compagnia
          </h2>
          <button className="small" onClick={() => setHidden(true)} aria-label="Più tardi">
            ✕
          </button>
        </div>
        <div className="verita">
          <h3>
            <Icon name="verita" size={24} /> {VERITA.titolo}
          </h3>
          {VERITA.testo.map((t, i) => (
            <p key={i}>{t}</p>
          ))}
        </div>
        <p>
          <b>{VOTO.domanda}</b>
        </p>
        <div className="vote-options">
          {VOTO.opzioni.map((o, i) => (
            <button key={i} className={mine === i ? 'chosen' : ''} onClick={() => vote(i as 0 | 1)}>
              <b>{o.titolo}</b>
              <small>{o.desc}</small>
            </button>
          ))}
        </div>
        <p className="small-text muted">
          Hanno votato {count} su {members.length}.{' '}
          {mine !== undefined ? 'Puoi ancora cambiare idea finché votano gli altri.' : 'Vince la maggioranza; in parità decide chi è entrato per primo.'}
          {count > 0 && left > 0 ? ` Si chiude tra ${left} s.` : ''}
        </p>
      </div>
    </div>
  );
}

/**
 * Racconto a fine missione della storia e annuncio del voto: li vedono tutti,
 * non solo l'host.
 */
export function useCittaStory() {
  const told = useRef(-1);
  const lastVote = useRef<string>('');
  useEffect(
    () =>
      useGame.subscribe((s) => {
        const run = s.room.run;
        const m = run?.missione;
        if (run && run.phase === 'complete' && m?.esito === 'compiuta' && m.id.startsWith('atto1-') && told.current !== run.id) {
          told.current = run.id;
          const cap = capitoloAtto(m.id);
          if (cap) setTimeout(() => openDialog(cap.titolo, cap.fine), 1200);
        }
        const v = s.room.voto;
        const key = v ? `${v.aperto}|${v.esito}` : '';
        if (key !== lastVote.current) {
          const was = lastVote.current;
          lastVote.current = key;
          if (v && !v.aperto && v.esito !== null && was.startsWith('true')) toast(`La compagnia ha scelto: «${VOTO.opzioni[v.esito].titolo}»`, 6000);
        }
      }),
    [],
  );
}
