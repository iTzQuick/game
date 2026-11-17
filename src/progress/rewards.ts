// Ricompense del giocatore: esperienza (nemici, stanze, Frattura), bottino e
// frammenti mandati dall'host, contributi alla base.

import { onCombat, emitCombat } from '../combat/bus';
import { ENEMIES } from '../combat/defs';
import { CLASSES } from '../game/constants';
import { getGame, toast, useGame } from '../game/store';
import { getRoom } from '../net/room';
import { BUILDINGS, RARITIES, XP, type BuildingId } from './defs';
import { addItems, addXp, classProgress } from './model';
import { getProgress, mutate } from './store';
import { joinRoomGroup } from './group';

/** Frammenti già promessi a un edificio, in attesa della conferma dell'host. */
let pendingContrib = 0;

export function availableFragments(): number {
  return getProgress().save.fragments - pendingContrib;
}

export function contributeTo(b: BuildingId, n: number) {
  const room = getRoom();
  const amount = Math.min(Math.floor(n), availableFragments());
  if (!room?.hostId || amount <= 0) return;
  pendingContrib += amount;
  emitCombat({ t: 'contrib', b, n: amount }, { to: room.hostId });
  // se l'host non risponde, i frammenti tornano disponibili
  setTimeout(() => (pendingContrib = Math.max(0, pendingContrib - amount)), 6000);
}

function gainXp(amount: number, reason?: string) {
  const g = getGame();
  const cls = g.room.classes[g.selfId];
  if (!cls || amount <= 0) return;
  const gained = mutate((s) => addXp(s, cls, amount));
  if (gained > 0) {
    const level = classProgress(getProgress().save, cls).level;
    toast(`${CLASSES[cls].name}: livello ${level}! Hai ${gained === 1 ? 'un punto' : `${gained} punti`} talento (tasto P)`, 4500);
  } else if (reason) toast(`+${amount} esperienza · ${reason}`, 2200);
}

/** Collega le ricompense agli eventi della partita. Restituisce la funzione di pulizia. */
export function initRewards(): () => void {
  const off = onCombat((_, msg) => {
    if (msg.t === 'edie') {
      const run = getGame().room.run;
      if (!run || run.phase === 'countdown') return;
      const boss = msg.type === 'eco';
      gainXp(XP.kill(ENEMIES[msg.type].cost, run.grado, boss));
      mutate((s) => {
        s.stats.kills++;
        if (boss) s.stats.bosses++;
      });
    } else if (msg.t === 'loot') {
      const r = mutate((s) => {
        const res = addItems(s, msg.items);
        s.fragments += msg.frags;
        return res;
      });
      const best = [...msg.items].sort((a, b) => b.rarity - a.rarity)[0];
      const what = best ? `${RARITIES[best.rarity].name}: ${best.name}` : '';
      toast(`Bottino! ${what}${msg.items.length > 1 ? ` e altri ${msg.items.length - 1}` : ''} · +${msg.frags} frammenti (tasto I)`, 4500);
      if (r.salvaged) toast(`Zaino pieno: smontati in ${r.salvaged} frammenti`);
    } else if (msg.t === 'contribok') {
      const used = msg.used;
      pendingContrib = Math.max(0, pendingContrib - used);
      if (used > 0) {
        mutate((s) => (s.fragments = Math.max(0, s.fragments - used)));
        const def = BUILDINGS.find((b) => b.id === msg.b);
        toast(`Hai versato ${used} frammenti: ${def?.name ?? ''}`);
      }
    }
  });

  // stanze ripulite, Frattura chiusa, edifici costruiti, compagnia della stanza
  let lastRun = -1;
  let lastCleared = 0;
  let completed = -1;
  let lastBase = getGame().room.base;
  let lastGroup = getGame().room.group;
  const unsub = useGame.subscribe((s) => {
    const run = s.room.run;
    if (run && run.phase !== 'countdown') {
      if (run.id !== lastRun) {
        lastRun = run.id;
        lastCleared = run.cleared;
      } else if (run.cleared > lastCleared) {
        lastCleared = run.cleared;
        gainXp(XP.room(run.grado), 'stanza ripulita');
      }
      if (run.phase === 'complete' && completed !== run.id) {
        completed = run.id;
        gainXp(XP.fractura(run.grado), 'Frattura richiusa');
        mutate((sv) => sv.stats.fratture++);
      }
    }
    if (s.room.base !== lastBase) {
      // prima si aggiorna, poi si avvisa: il toast cambia lo stato e richiama questa funzione
      const prevBase = lastBase;
      const sameGroup = s.room.group === lastGroup;
      lastBase = s.room.base;
      lastGroup = s.room.group;
      // solo le costruzioni appena finite, non quelle trovate entrando nella stanza
      if (sameGroup && s.room.status === 'joined') {
        for (const b of BUILDINGS) {
          if (s.room.base[b.id]?.u && !prevBase[b.id]?.u) toast(`${b.name} costruita! ${b.desc}`, 5000);
        }
      }
    }
    if (s.room.group && s.room.hostId !== s.selfId) void joinRoomGroup(s.room.group);
  });

  return () => {
    off();
    unsub();
  };
}
