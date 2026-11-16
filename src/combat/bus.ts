// Smistamento dei messaggi di combattimento: a chi li manda arrivano subito
// (in locale), agli altri via rete.

import { getGame } from '../game/store';
import { getRoom } from '../net/room';
import type { CombatMsg } from './protocol';
import { combat } from './runtime';

type Handler = (from: string, msg: CombatMsg) => void;
const handlers = new Set<Handler>();

const COMBAT_TYPES = new Set(['en', 'ea', 'epj', 'ecancel', 'edie', 'hit', 'zone', 'zlit', 'ab', 'heal', 'bless', 'alba', 'combo', 'runreq']);

export function isCombatMsg(m: { t: string }): m is CombatMsg {
  return COMBAT_TYPES.has(m.t);
}

export function onCombat(fn: Handler): () => void {
  handlers.add(fn);
  return () => handlers.delete(fn);
}

export function dispatchCombat(from: string, msg: CombatMsg) {
  combat.onNet(from, msg);
  for (const h of handlers) h(from, msg);
}

/** Invia a tutti (e a sé stessi). Con `to` solo a quel giocatore; `unreliable` per le istantanee. */
export function emitCombat(msg: CombatMsg, opts: { to?: string; unreliable?: boolean; skipSelf?: boolean } = {}) {
  const room = getRoom();
  const self = getGame().selfId;
  if (room) {
    if (opts.to) {
      if (opts.to !== self) room.sendEvent(msg, opts.to);
    } else if (opts.unreliable) room.sendUnreliable(msg);
    else room.emit(msg);
  }
  if (!opts.skipSelf && (!opts.to || opts.to === self)) dispatchCombat(self, msg);
}
