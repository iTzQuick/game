// Interfaccia del combattimento: vita, abilità con ricarica, Ultra, stato
// della Frattura, barra del boss, combo, schermata "a terra".

import { useEffect, useRef, useState } from 'react';
import { CLASSES, type ClassId } from '../game/constants';
import { useGame } from '../game/store';
import { abilityState } from '../combat/abilities';
import { CLASS_STATS, DOWN_SECONDS, ENEMIES, MODS, REVIVE_SECONDS } from '../combat/defs';
import { combatRoomCount } from '../combat/dungeon';
import type { AbilitySlot } from '../combat/protocol';
import { combat } from '../combat/runtime';
import { press } from '../game/input';
import { useProgress } from '../progress/store';
import { classProgress } from '../progress/model';

/** Ridisegna il componente ~10 volte al secondo (i valori vivono fuori da React). */
export function usePoll(ms = 100) {
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

export const SLOTS: AbilitySlot[] = ['Q', 'E', 'R', 'F'];

export function abilityName(cls: ClassId, slot: AbilitySlot): string {
  const c = CLASSES[cls];
  return slot === 'F' ? c.ultra : c.abilities['QER'.indexOf(slot)];
}

export function CombatHud({ touch }: { touch: boolean }) {
  usePoll(100);
  const run = useGame((s) => s.room.run);
  const cls = useGame((s) => s.room.classes[s.selfId] ?? null);
  const combo = useGame((s) => s.combo);
  const level = useProgress((s) => (cls ? classProgress(s.save, cls).level : 1));
  const inRun = !!run && run.phase !== 'countdown';
  const m = combat.me;
  const now = performance.now();

  return (
    <>
      {run && <RunBanner />}
      {inRun && <BossBar />}
      {combo && (
        <div className="combo-banner" key={combo.t0}>
          <small>COMBO</small>
          {combo.name}
        </div>
      )}
      {inRun && (
        <div className={`vitals${touch ? ' touch' : ''}`}>
          <div className="hp-bar">
            <div className="hp-fill" style={{ width: `${(m.hp / m.maxHp) * 100}%` }} />
            {m.shield > 0 && now < m.shieldUntil && <div className="hp-shield" style={{ width: `${Math.min(1, m.shield / m.maxHp) * 100}%` }} />}
            <span>
              Liv. {level} · {Math.ceil(m.hp)} / {m.maxHp}
            </span>
          </div>
          {m.potions > 0 && <div className="potions">🧪 {m.potions}{!touch && <kbd>H</kbd>}</div>}
        </div>
      )}
      {!touch && cls && <AbilityBar cls={cls} />}
      {inRun && !combat.alive && <DownOverlay />}
      {run?.phase === 'complete' && (
        <div className="run-complete">
          <b>La Frattura si richiude</b>
          <span>Grado {run.grado} superato · la prossima sarà di Grado {run.grado + 1}</span>
          <small>Raggiungi il portale dorato per tornare al Crocevia</small>
        </div>
      )}
      {!cls && inRun && <div className="hint-chip">Senza classe hai solo l’attacco base</div>}
      {/* il Bastione accumula danni: li mostriamo al Guardiano */}
      {now < m.bastionUntil && (
        <div className="bastion-chip">
          Bastione · {Math.ceil((m.bastionUntil - now) / 1000)}s · assorbiti {Math.round(m.bastionAbsorbed)}
        </div>
      )}
    </>
  );
}

function RunBanner() {
  const run = useGame((s) => s.room.run)!;
  const seenAt = useRef(0);
  const runId = useRef(-1);
  if (runId.current !== run.id) {
    runId.current = run.id;
    seenAt.current = performance.now();
  }
  if (run.phase === 'countdown') {
    const left = Math.max(1, Math.ceil((5000 - (performance.now() - seenAt.current)) / 1000));
    return (
      <div className="run-countdown">
        <b>La Frattura si apre</b>
        <span className="count">{left}</span>
        <small>
          Grado {run.grado}
          {run.mods.length ? ` · ${run.mods.map((m) => MODS[m].name).join(' · ')}` : ''}
        </small>
      </div>
    );
  }
  const total = combatRoomCount(run.grado) + 1;
  const done = Math.min(total, run.cleared - 1);
  const bossFight = run.fight === total;
  return (
    <div className="run-info">
      <b>Frattura · Grado {run.grado}</b>
      <span>
        {run.phase === 'complete' ? 'Completata' : bossFight ? 'Stanza del boss' : `Stanze ripulite ${done}/${total}`}
        {run.fight >= 0 && <em> · combattimento</em>}
      </span>
      {run.mods.length > 0 && (
        <span className="mods">
          {run.mods.map((m) => (
            <i key={m} title={MODS[m].desc}>
              {MODS[m].name}
            </i>
          ))}
        </span>
      )}
    </div>
  );
}

function BossBar() {
  const boss = [...combat.enemies.values()].find((e) => e.type === 'eco');
  if (!boss) return null;
  return (
    <div className="boss-bar">
      <span>{ENEMIES.eco.name}</span>
      <div className="boss-track">
        <div className="boss-fill" style={{ width: `${(boss.hp / boss.maxHp) * 100}%` }} />
      </div>
    </div>
  );
}

function AbilityBar({ cls }: { cls: ClassId }) {
  const now = performance.now();
  return (
    <div className="ability-bar">
      {SLOTS.map((slot) => {
        const st = abilityState(cls, slot, now);
        const ultra = slot === 'F';
        return (
          <button
            key={slot}
            className={`ability${st.ready ? ' ready' : ''}${ultra ? ' ultra' : ''}`}
            style={{ '--cls': CLASSES[cls].color, '--left': st.left } as React.CSSProperties}
            onClick={() => press(`ab${slot}` as 'abQ')}
            title={`${abilityName(cls, slot)} (${slot})`}
          >
            <kbd>{slot}</kbd>
            <span className="ab-name">{abilityName(cls, slot)}</span>
            {!st.ready && !ultra && st.seconds > 0 && <span className="ab-cd">{st.seconds}</span>}
            {ultra && !st.ready && <span className="ab-cd">{Math.round((1 - st.left) * 100)}%</span>}
          </button>
        );
      })}
      <span className="muted small-text cd-hint">Ricariche: {CLASS_STATS[cls].cd.join(' / ')} s</span>
    </div>
  );
}

function DownOverlay() {
  const m = combat.me;
  const now = performance.now();
  if (m.dead) {
    return (
      <div className="down-overlay dead">
        <b>Fuori combattimento</b>
        <span>Tornerai in piedi quando i compagni ripuliranno la stanza</span>
      </div>
    );
  }
  const left = Math.max(0, DOWN_SECONDS - (now - m.downAt) / 1000);
  return (
    <div className="down-overlay">
      <b>A terra · {Math.ceil(left)}s</b>
      <span>Un compagno può rialzarti restando vicino a te</span>
      <div className="revive-track">
        <div className="revive-fill" style={{ width: `${(m.revive / REVIVE_SECONDS) * 100}%` }} />
      </div>
    </div>
  );
}
