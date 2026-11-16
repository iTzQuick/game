// Regole della stanza, senza dipendenze dalla rete: si testano da sole.
//
// Non c'è un server: ogni dispositivo calcola le stesse regole a partire dalla
// stessa lista di membri, così tutti arrivano alla stessa conclusione
// (chi è l'host, chi è entrato, chi è di troppo).

import type { ClassId } from '../game/constants';

export interface Member {
  id: string;
  name: string;
  /** Momento d'ingresso (orologio di chi entra). Decide l'ordine della stanza. */
  joinedAt: number;
  /** true quando il giocatore è entrato davvero (non è ancora in fase d'ingresso). */
  ok?: boolean;
}

/**
 * Orario d'ingresso da usare: dopo tutti quelli già confermati nella stanza.
 * Serve se l'orologio del nostro dispositivo è indietro. Chi sta entrando
 * insieme a noi (non ancora confermato) non conta, così l'ordine tra ingressi
 * contemporanei resta quello reale.
 */
export function queuedJoinTime(self: Member, members: Member[]): number {
  let latest = -Infinity;
  for (const m of members) if (m.id !== self.id && m.ok) latest = Math.max(latest, m.joinedAt);
  return latest >= self.joinedAt ? latest + 1 : self.joinedAt;
}

export interface RoomState {
  /** Versione: sale a ogni modifica fatta dall'host. */
  v: number;
  classes: Record<string, ClassId>;
}

export const emptyRoomState = (): RoomState => ({ v: 0, classes: {} });

export function orderMembers(members: Member[]): Member[] {
  return [...members].sort((a, b) => a.joinedAt - b.joinedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** I primi `max` entrati sono in partita; gli altri devono uscire. */
export function admittedMembers(members: Member[], max: number): Member[] {
  return orderMembers(members).slice(0, max);
}

export function isAdmitted(members: Member[], id: string, max: number): boolean {
  return admittedMembers(members, max).some((m) => m.id === id);
}

/** L'host è il primo entrato tra quelli ammessi. Se esce, tocca al successivo. */
export function electHost(members: Member[], max: number): string | null {
  return admittedMembers(members, max)[0]?.id ?? null;
}

/** Chi tiene già una classe, escluso `exceptId`. */
export function classHolder(state: RoomState, cls: ClassId, exceptId?: string): string | null {
  for (const [pid, c] of Object.entries(state.classes)) {
    if (c === cls && pid !== exceptId) return pid;
  }
  return null;
}

export type ClassRequestResult =
  | { ok: true; state: RoomState }
  | { ok: false; reason: 'taken' | 'not-member'; holder?: string };

/**
 * L'host applica una richiesta di classe. Nella stessa stanza una classe non
 * può esserci due volte. `cls = null` libera la classe.
 */
export function applyClassRequest(
  state: RoomState,
  playerId: string,
  cls: ClassId | null,
  memberIds: string[],
): ClassRequestResult {
  if (!memberIds.includes(playerId)) return { ok: false, reason: 'not-member' };
  const current = state.classes[playerId] ?? null;
  if (current === cls) return { ok: true, state };
  if (cls) {
    const holder = classHolder(state, cls, playerId);
    if (holder) return { ok: false, reason: 'taken', holder };
  }
  const classes = { ...state.classes };
  if (cls) classes[playerId] = cls;
  else delete classes[playerId];
  return { ok: true, state: { v: state.v + 1, classes } };
}

/**
 * Pulizia fatta dall'host: toglie chi è uscito e risolve eventuali doppioni
 * (possibili per un attimo durante un cambio di host). In caso di doppione
 * tiene la classe chi è entrato prima.
 */
export function normalizeRoomState(state: RoomState, orderedIds: string[]): RoomState {
  const classes: Record<string, ClassId> = {};
  const used = new Set<ClassId>();
  for (const id of orderedIds) {
    const c = state.classes[id];
    if (c && !used.has(c)) {
      classes[id] = c;
      used.add(c);
    }
  }
  const same =
    Object.keys(classes).length === Object.keys(state.classes).length &&
    Object.entries(classes).every(([k, c]) => state.classes[k] === c);
  return same ? state : { v: state.v + 1, classes };
}

/**
 * Accetta lo stato in arrivo se viene dall'host attuale e non è più vecchio
 * del nostro, oppure se (da chiunque) è più recente di quello che abbiamo.
 */
export function shouldAcceptRoomState(
  local: RoomState,
  incoming: RoomState,
  senderId: string,
  hostId: string | null,
): boolean {
  if (senderId === hostId) return incoming.v >= local.v;
  return incoming.v > local.v;
}

/**
 * L'host ci manda uno stato più vecchio del nostro: succede quando l'host è
 * appena cambiato e si era perso degli aggiornamenti. In quel caso gli
 * rimandiamo il nostro, così tutti convergono sulla versione più recente.
 */
export function hostIsBehind(local: RoomState, incoming: RoomState, senderId: string, hostId: string | null): boolean {
  return senderId === hostId && incoming.v < local.v;
}
