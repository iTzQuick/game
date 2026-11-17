// Le missioni nell'interfaccia: un riquadro piccolo in alto a sinistra (sotto
// la stanza) e il pannello con i dettagli (tasto M, pulsante 📜).

import { setGame, useGame } from '../game/store';
import { CHAPTER, currentChapterMission, goalText, sommersaOpen, type Mission } from '../story/core';
import { narratorStatus } from '../story/narrator';

const openPanel = () => setGame((s) => ({ panel: s.panel === 'missioni' ? null : 'missioni' }));

/**
 * Al massimo quattro righe: la missione del capitolo e le giornaliere. Sul
 * telefono (`compact`) le giornaliere stanno in una riga sola, per non
 * scendere fino al joystick.
 */
export function MissionTracker({ compact = false }: { compact?: boolean }) {
  const storia = useGame((s) => s.room.storia);
  const open = useGame((s) => sommersaOpen(s.room.gstats));
  if (!storia) return null;
  const cur = open ? currentChapterMission(storia) : null;
  return (
    <button className="missions-mini" onClick={openPanel} title="Missioni (M)">
      {cur && (
        <span className="m-row story">
          <i aria-hidden>📖</i>
          <span className="m-title">{cur.titolo}</span>
          <b>
            {storia.capProg}/{cur.goal.n}
          </b>
        </span>
      )}
      {compact && storia.daily.length > 0 && (
        <span className="m-row">
          <i aria-hidden>☀</i>
          <span className="m-title">Giornaliere</span>
          <b>
            {storia.daily.filter((m, i) => (storia.dailyProg[i] ?? 0) >= m.goal.n).length}/{storia.daily.length}
          </b>
        </span>
      )}
      {!compact && storia.daily.map((m, i) => {
        const p = storia.dailyProg[i] ?? 0;
        const done = p >= m.goal.n;
        return (
          <span key={m.id} className={`m-row${done ? ' done' : ''}`}>
            <i aria-hidden>{done ? '✓' : '☀'}</i>
            <span className="m-title">{m.titolo}</span>
            {!done && (
              <b>
                {p}/{m.goal.n}
              </b>
            )}
          </span>
        );
      })}
    </button>
  );
}

function Reward({ m }: { m: Mission }) {
  return (
    <span className="m-reward">
      +{m.premio.xp} esperienza · +{m.premio.frammenti} frammenti
    </span>
  );
}

function Progress({ have, need }: { have: number; need: number }) {
  return (
    <div className="m-track" aria-label={`${have} su ${need}`}>
      <div className="m-fill" style={{ width: `${Math.min(1, have / need) * 100}%` }} />
      <span>
        {have}/{need}
      </span>
    </div>
  );
}

export function MissionsPanel() {
  const storia = useGame((s) => s.room.storia);
  const open = useGame((s) => sommersaOpen(s.room.gstats));
  const close = () => setGame({ panel: null });
  const cap = storia?.cap ?? 0;
  const cur = storia ? currentChapterMission(storia) : CHAPTER[0];
  const doneChapter = CHAPTER.slice(0, cap);

  return (
    <div className="modal-wrap" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal wide missions-panel">
        <div className="modal-head">
          <h2>Missioni</h2>
          <button className="small" onClick={close} aria-label="Chiudi">
            ✕
          </button>
        </div>

        <section>
          <h3>
            Atto I · La Città Sommersa <small className="muted">{Math.min(cap, CHAPTER.length)}/{CHAPTER.length}</small>
          </h3>
          {!open ? (
            <p className="muted">
              Il portale della Città Sommersa è spento. Si accenderà quando la vostra compagnia avrà richiuso la prima
              Frattura (la crepa sul bordo del Crocevia).
            </p>
          ) : cur ? (
            <div className="mission current">
              <div className="m-head">
                <b>{cur.titolo}</b>
                <Reward m={cur} />
              </div>
              {cur.intro.map((l, i) => (
                <p key={i} className="m-intro">
                  {l}
                </p>
              ))}
              <div className="m-goal">{goalText(cur.goal)}</div>
              <Progress have={storia?.capProg ?? 0} need={cur.goal.n} />
              <p className="muted small-text">Entra nella Città dal suo portale al Crocevia: le missioni dell’Atto contano solo lì.</p>
            </div>
          ) : (
            <p>L’Atto I è concluso. Il portale della Foresta dei Sussurri ha avuto un fremito…</p>
          )}
          {doneChapter.length > 0 && (
            <details className="tale">
              <summary>Il racconto finora ({doneChapter.length})</summary>
              {doneChapter.map((m) => (
                <p key={m.id}>
                  <b>{m.titolo}.</b> {m.fine}
                </p>
              ))}
            </details>
          )}
        </section>

        <section>
          <h3>
            Missioni di oggi{' '}
            <small className="muted">{storia?.fonte === 'claude' ? '· scritte dal narratore (Claude)' : '· dal libro di riserva'}</small>
          </h3>
          {!storia?.daily.length && <p className="muted">Il narratore sta scrivendo…</p>}
          {storia?.daily.map((m, i) => {
            const p = storia.dailyProg[i] ?? 0;
            const done = p >= m.goal.n;
            return (
              <div key={m.id} className={`mission${done ? ' done' : ''}`}>
                <div className="m-head">
                  <b>
                    {done ? '✓ ' : ''}
                    {m.titolo}
                  </b>
                  <Reward m={m} />
                </div>
                {m.intro.map((l, k) => (
                  <p key={k} className="m-intro">
                    {l}
                  </p>
                ))}
                {done ? <p className="m-intro">{m.fine}</p> : <div className="m-goal">{goalText(m.goal)}</div>}
                {!done && <Progress have={p} need={m.goal.n} />}
              </div>
            );
          })}
          <p className="muted small-text">
            Le giornaliere cambiano ogni giorno e valgono per tutta la compagnia, ovunque si combatta. Le conta l’host.
            {narratorStatus.last && narratorStatus.last !== 'ok' ? ` (Narratore: ${narratorStatus.last})` : ''}
          </p>
        </section>
      </div>
    </div>
  );
}
