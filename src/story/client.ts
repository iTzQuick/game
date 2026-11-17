// Le missioni dal punto di vista di ogni giocatore: la ricompensa quando una
// missione è compiuta, gli avvisi, e il racconto (la fine della missione del
// capitolo e l'inizio della prossima) quando si torna al Crocevia.

import { onCombat } from '../combat/bus';
import { getGame, openDialog, toast, useGame } from '../game/store';
import { gainXp } from '../progress/rewards';
import { mutate } from '../progress/store';
import { CHAPTER, currentChapterMission, goalText, sommersaOpen } from './core';
import { prefetchCustode } from './narrator';

export function initStoryClient(): () => void {
  /** racconti da mostrare appena si è al sicuro (al Crocevia, senza dialoghi aperti) */
  let tale: string[] = [];

  const off = onCombat((_, msg) => {
    if (msg.t !== 'mdone') return;
    gainXp(msg.xp);
    mutate((s) => (s.fragments += msg.frags));
    const kind = msg.tipo === 'storia' ? 'Missione' : 'Giornaliera';
    toast(`${kind} compiuta: ${msg.titolo} · +${msg.xp} esperienza, +${msg.frags} frammenti`, 5500);
    if (msg.tipo === 'storia') {
      tale.push(msg.fine);
      // la prossima missione del capitolo arriva con lo stato della stanza: si legge al momento del racconto
      tale.push('__next__');
    }
  });

  let wasOpen: boolean | null = null;
  const unsub = useGame.subscribe((s) => {
    if (s.room.status !== 'joined') return;
    // la Città Sommersa si apre: lo si dice una volta (non a chi la trova già aperta entrando)
    // (i numeri della compagnia sono buoni solo quando la compagnia è caricata)
    if (s.room.group) {
      const open = sommersaOpen(s.room.gstats);
      const justOpened = wasOpen === false && open;
      // prima si aggiorna, poi si avvisa: il toast cambia lo stato e richiama questa funzione
      wasOpen = open;
      if (justOpened) {
        tale.push('Al Crocevia, uno dei portali spenti ha preso a gocciolare luce verde. Dalla pietra sale un rumore d’acqua.');
        toast('Il portale della Città Sommersa si è acceso! Ascolta il Custode Muto', 6000);
      }
    }

    if (tale.length && !s.room.run && !s.dialog && !s.panel && !s.classPicker) {
      const lines: string[] = [];
      for (const t of tale) {
        if (t !== '__next__') lines.push(t);
        else {
          const next = s.room.storia ? currentChapterMission(s.room.storia) : null;
          if (next) lines.push(...next.intro, `Nuova missione: ${next.titolo}. ${goalText(next.goal)}.`);
          else lines.push(`L’Atto I è concluso: avete compiuto tutte le ${CHAPTER.length} missioni della Città Sommersa.`);
        }
      }
      tale = [];
      // dopo il cambio di stato, non dentro
      setTimeout(() => openDialog('Il narratore', lines), 0);
    }
  });

  // le prime battute del Custode, pronte per quando lo si ascolta
  const first = setTimeout(prefetchCustode, 4000);

  return () => {
    off();
    unsub();
    clearTimeout(first);
  };
}

/** Cosa dice il Custode Muto quando lo si ascolta: battute (di Claude o scritte) e la missione in corso. */
export function custodeBriefing(fallback: string[]): string[] {
  const s = getGame();
  const st = s.room.storia;
  const lines = [...fallback];
  if (!sommersaOpen(s.room.gstats)) {
    lines.push('«Richiudete la vostra prima Frattura. Poi qualcosa, laggiù, si sveglierà.»');
    return lines;
  }
  const cur = st ? currentChapterMission(st) : CHAPTER[0];
  if (cur) {
    const prog = st?.capProg ?? 0;
    lines.push(...cur.intro, `Missione: ${cur.titolo}. ${goalText(cur.goal)} (${prog}/${cur.goal.n}).`);
  } else lines.push('«La Città ha smesso di contare. Ma ci sono altri portali, e altri conti.»');
  return lines;
}
