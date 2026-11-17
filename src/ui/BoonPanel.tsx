// Poteri della Frattura: dopo ogni stanza ripulita si sceglie 1 potere su 3.
// La scelta è di ognuno (non serve accordarsi); i poteri restano fino alla fine
// della Frattura.

import { useEffect } from 'react';
import { getGame, setGame, toast, useGame } from '../game/store';
import { combat } from '../combat/runtime';
import { BOON, BOONS, addBoon, boonLevel, myBoons, offerBoons, type BoonDef, type BoonId } from '../combat/boons';
import { sfx } from '../audio/sfx';
import { Icon } from './Icon';

const KIND_LABEL: Record<BoonDef['kind'], string> = {
  gioco: 'Cambia il combattimento',
  numeri: 'Bonus',
  classe: 'Della tua classe',
  subito: 'Subito',
};

function BoonIcon({ b, size = 44 }: { b: BoonDef; size?: number }) {
  if (b.icon) return <Icon name={b.icon} size={size} />;
  return (
    <span className="boon-glyph" style={{ width: size, height: size, fontSize: size * 0.55 }} aria-hidden>
      {b.glyph ?? '✦'}
    </span>
  );
}

function choose(id: BoonId) {
  const b = BOONS[id];
  if (id === 'sorso') {
    const m = combat.me;
    combat.healMe(m.maxHp * BOON.sorso.heal);
    m.potions++;
    toast(`${b.name}: vita recuperata e una pozione in più`);
  } else {
    addBoon(id);
    const l = boonLevel(id);
    toast(l > 1 ? `${b.name} sale al livello ${l}` : `Nuovo potere: ${b.name}`);
  }
  sfx.pickup();
  setGame({ boonOffer: null });
}

/** Apre la scelta quando la compagnia ripulisce una stanza (non quella del boss). */
export function useBoonOffers() {
  useEffect(() => {
    let last: { run: number; cleared: number } | null = null;
    return useGame.subscribe((s) => {
      const run = s.room.run;
      // Frattura finita (o mai iniziata): una scelta rimasta in sospeso non serve più
      if (s.boonOffer && (!run || run.phase !== 'active' || (last && last.run !== run.id))) setGame({ boonOffer: null });
      if (!run || run.phase === 'countdown') {
        last = null;
        return;
      }
      if (!last || last.run !== run.id) {
        last = { run: run.id, cleared: run.cleared };
        return;
      }
      if (run.cleared > last.cleared) {
        last.cleared = run.cleared;
        if (run.phase !== 'active' || !s.room.classes[s.selfId]) return;
        const hp = combat.me.maxHp ? combat.me.hp / combat.me.maxHp : 1;
        const offer = offerBoons(Math.random, s.room.classes[s.selfId] ?? null, myBoons(), hp);
        // un piccolo ritardo: prima si vede il nemico cadere
        setTimeout(() => {
          const now = getGame();
          if (now.room.run?.id === run.id) setGame({ boonOffer: offer });
        }, 900);
      }
    });
  }, []);
}

export function BoonPanel() {
  const offer = useGame((s) => s.boonOffer);
  useEffect(() => {
    if (!offer) return;
    // serve il mouse per scegliere; da tastiera bastano 1, 2, 3
    document.exitPointerLock?.();
    const onKey = (e: KeyboardEvent) => {
      const i = ['1', '2', '3'].indexOf(e.key);
      if (i >= 0 && offer[i]) {
        e.preventDefault();
        choose(offer[i]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [offer]);
  if (!offer) return null;
  return (
    <div className="modal-wrap boon-wrap">
      <div className="modal wide boon-modal">
        <h2>Scegli un potere</h2>
        <p className="muted small-text">Vale fino alla fine di questa Frattura. Se riprendi lo stesso potere, sale di livello. (Tasti 1, 2, 3)</p>
        <div className="boon-cards">
          {offer.map((id) => {
            const b = BOONS[id];
            const l = boonLevel(id);
            const next = b.kind === 'subito' ? 1 : l + 1;
            return (
              <button key={id} className={`boon-card kind-${b.kind}`} onClick={() => choose(id)} data-boon={id}>
                <BoonIcon b={b} />
                <b>{b.name}</b>
                <small className="boon-kind">
                  {KIND_LABEL[b.kind]}
                  {b.kind !== 'subito' && (l ? ` · livello ${l} → ${next}` : ' · nuovo')}
                </small>
                <span>{b.desc(next)}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** I poteri presi, in piccolo sopra le abilità. */
export function BoonStrip() {
  // si aggiorna quando si sceglie (boonOffer torna null) o cambia la Frattura
  useGame((s) => s.boonOffer);
  useGame((s) => s.room.run?.id);
  const have = myBoons();
  const ids = (Object.keys(have) as BoonId[]).filter((id) => have[id]);
  if (!ids.length) return null;
  return (
    <div className="boon-strip" aria-label="Poteri della Frattura">
      {ids.map((id) => (
        <span key={id} className="boon-chip" title={`${BOONS[id].name} (livello ${have[id]}): ${BOONS[id].desc(have[id] ?? 1)}`}>
          <BoonIcon b={BOONS[id]} size={22} />
          {(have[id] ?? 0) > 1 && <i>{have[id]}</i>}
        </span>
      ))}
    </div>
  );
}
