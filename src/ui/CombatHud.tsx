// Interfaccia del combattimento: vita, abilità con ricarica, Ultra, stato
// della Frattura, barra del boss, combo, schermata "a terra".

import { useEffect, useRef, useState } from 'react';
import { CLASSES, type ClassId } from '../game/constants';
import { useGame } from '../game/store';
import { abilityState } from '../combat/abilities';
import { CLASS_STATS, DOWN_SECONDS, ENEMIES, MODS, REVIVE_SECONDS, isBoss } from '../combat/defs';
import { VARIANT_INFO, combatRoomCount } from '../combat/dungeon';
import type { AbilitySlot } from '../combat/protocol';
import { combat } from '../combat/runtime';
import { press } from '../game/input';
import { Icon } from './Icon';
import { BoonStrip } from './BoonPanel';
import { useProgress } from '../progress/store';
import { classProgress } from '../progress/model';
import { nomeNemico, secondiRimasti, testoObiettivo } from '../narrator/core';
import { CITTA, OSSIGENO } from '../citta/core';

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
  const level = useProgress((s) => (cls ? classProgress(s.save, cls).level : 1));
  const inRun = !!run && run.phase !== 'countdown';
  const m = combat.me;
  const now = performance.now();

  return (
    <>
      {run?.phase === 'countdown' && <RunCountdown />}
      {inRun && (
        <div className={`vitals${touch ? ' touch' : ''}`}>
          <div className="hp-bar">
            <div className="hp-fill" style={{ width: `${(m.hp / m.maxHp) * 100}%` }} />
            {m.shield > 0 && now < m.shieldUntil && <div className="hp-shield" style={{ width: `${Math.min(1, m.shield / m.maxHp) * 100}%` }} />}
            <span>
              Liv. {level} · {Math.ceil(m.hp)} / {m.maxHp}
            </span>
          </div>
          {run?.mondo === CITTA && (
            <div className={`oxygen-bar${m.oxygen <= OSSIGENO.avviso ? ' low' : ''}`} title="Ossigeno: si ricarica nelle colonne di bolle">
              <Icon name="ossigeno" size={18} />
              <div className="oxygen-track">
                <div className="oxygen-fill" style={{ width: `${(m.oxygen / OSSIGENO.max) * 100}%` }} />
              </div>
            </div>
          )}
          {run?.mondo === CITTA && m.oxygen <= OSSIGENO.avviso && combat.alive && (
            <div className="oxygen-hint">{m.oxygen <= 0 ? 'Senza fiato! Cerca una colonna di bolle' : 'Poca aria: torna a una colonna di bolle'}</div>
          )}
          {m.potions > 0 && (
            <div className="potions">
              <Icon name="pozione" size={20} /> {m.potions}
              {!touch && <kbd>H</kbd>}
            </div>
          )}
          <BoonStrip />
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

/** Il conto alla rovescia resta al centro: è un momento solo, e dura 5 secondi. */
function RunCountdown() {
  const run = useGame((s) => s.room.run)!;
  const eco = useGame((s) => s.room.narrazione?.eco);
  const ecoLine = eco?.length ? eco[run.id % eco.length] : null;
  const seenAt = useRef(0);
  const runId = useRef(-1);
  if (runId.current !== run.id) {
    runId.current = run.id;
    seenAt.current = performance.now();
  }
  const left = Math.max(1, Math.ceil((5000 - (performance.now() - seenAt.current)) / 1000));
  return (
    <div className="run-countdown">
      <b>La Frattura si apre</b>
      <span className="count">{left}</span>
      <small>
        Grado {run.grado}
        {run.mods.length ? ` · ${run.mods.map((m) => MODS[m].name).join(' · ')}` : ''}
      </small>
      {run.missione && <small className="countdown-mission">📜 {run.missione.titolo}: {testoObiettivo(run.missione.obiettivo)}</small>}
      {ecoLine && <em className="eco-line">{ecoLine}</em>}
    </div>
  );
}

/** Lo stato della missione del giorno, in una riga. */
function MissionLine() {
  const m = useGame((s) => s.room.run?.missione);
  if (!m) return null;
  const failed = m.esito === 'fallita' || (!m.esito && m.fallita);
  let what: string;
  if (m.esito === 'compiuta') what = 'compiuta ✓';
  else if (failed) what = 'fallita ✗';
  else if (m.obiettivo.tipo === 'sconfiggi') what = `${Math.min(m.conta, m.obiettivo.quanti)}/${m.obiettivo.quanti} ${nomeNemico(m.obiettivo.nemico, true)}`;
  else if (m.obiettivo.tipo === 'veloce') {
    const left = secondiRimasti(m, Date.now()) ?? m.obiettivo.minuti * 60;
    what = left > 0 ? `⏱ ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : 'tempo scaduto ✗';
  } else what = m.obiettivo.tipo === 'nessuno_cade' ? 'nessuno deve cadere' : m.obiettivo.tipo === 'senza_pozioni' ? 'niente pozioni' : 'richiudete la Frattura';
  return (
    <div className={`mission-line${failed ? ' failed' : m.esito === 'compiuta' ? ' done' : ''}`} title={testoObiettivo(m.obiettivo)}>
      📜 {m.titolo} · {what}
    </div>
  );
}

/**
 * La colonna piccola in alto al centro: stato della Frattura in una riga,
 * barra del boss sottile, combo. Sotto ci vanno i messaggi (Hud).
 */
export function TopStatus() {
  usePoll(150);
  const run = useGame((s) => s.room.run);
  const combo = useGame((s) => s.combo);
  const inRun = !!run && run.phase !== 'countdown';
  return (
    <>
      {inRun && run && <RunLine />}
      {inRun && run && <RoomBanner />}
      {inRun && <MissionLine />}
      {inRun && <BossBar />}
      {combo && (
        <div className="combo-banner" key={combo.t0}>
          <small>COMBO</small> {combo.name}
        </div>
      )}
    </>
  );
}

function RunLine() {
  const run = useGame((s) => s.room.run)!;
  const total = combatRoomCount(run.grado) + 1;
  const done = Math.min(total, run.cleared - 1);
  const bossFight = run.fight === total;
  return (
    <div className="run-info">
      <span>
        Grado {run.grado} · {run.phase === 'complete' ? 'completata' : bossFight ? 'boss' : `stanze ${done}/${total}`}
        {run.fight >= 0 && run.phase !== 'complete' && <em> · combattimento</em>}
      </span>
      {run.mods.map((m) => (
        <i key={m} className="mod" title={MODS[m].desc}>
          {MODS[m].name}
        </i>
      ))}
    </div>
  );
}

/** Stanza speciale in corso: il suo nome, cosa fare e (nella Prova) il tempo che resta. */
function RoomBanner() {
  const run = useGame((s) => s.room.run)!;
  const d = combat.dungeon;
  if (!d || run.fight < 0 || run.phase === 'complete') return null;
  const r = d.rooms[run.fight];
  const v = r?.variant;
  if (!v || v === 'normale') return null;
  const info = VARIANT_INFO[v];
  const left = v === 'prova' && run.prova ? Math.ceil((run.prova - Date.now()) / 1000) : null;
  return (
    <div className={`room-banner v-${v}${left !== null && left <= 10 ? ' urgent' : ''}`}>
      <b>
        {info.glyph} {info.name}
        {left !== null && (left > 0 ? ` · ${left} s` : ' · tempo scaduto')}
      </b>
      <small>{info.hint}</small>
    </div>
  );
}

function BossBar() {
  const boss = [...combat.enemies.values()].find((e) => isBoss(e.type));
  if (!boss) return null;
  return (
    <div className="boss-bar">
      <span>{ENEMIES[boss.type].name}</span>
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
            <Icon name={`${cls}-${slot}`} size={32} className="ab-icon" />
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
