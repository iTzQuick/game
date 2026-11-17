// Regole della stanza, senza dipendenze dalla rete: si testano da sole.
//
// Non c'è un server: ogni dispositivo calcola le stesse regole a partire dalla
// stessa lista di membri, così tutti arrivano alla stessa conclusione
// (chi è l'host, chi è entrato, chi è di troppo).

import type { ClassId } from '../game/constants';
import type { ModId } from '../combat/defs';
import type { BuildingId } from '../progress/defs';
import type { BuildingState, GroupData } from '../progress/model';
import type { Indizio, NemicoMissione, Narrazione, Obiettivo } from '../narrator/core';

/** Missione del giorno in corso nella Frattura: la tiene aggiornata l'host. */
export interface MissioneInCorso {
  id: string;
  titolo: string;
  obiettivo: Obiettivo;
  /** nemico che compare più spesso */
  nemico: NemicoMissione | null;
  /** nemici giusti sconfitti (obiettivo "sconfiggi") */
  conta: number;
  /** la regola è stata infranta (qualcuno è caduto, ha bevuto…) */
  fallita: boolean;
  /** quando è iniziata la Frattura (Date.now dell'host), per l'obiettivo "veloce" */
  inizio: number;
  /** a Frattura richiusa */
  esito?: 'compiuta' | 'fallita';
}

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

/** Una Frattura in corso. La decide e la aggiorna l'host. */
export interface RunState {
  /** Sale a ogni nuova Frattura. */
  id: number;
  seed: number;
  grado: number;
  mods: ModId[];
  /** countdown: si sta aprendo; active: in corso; complete: boss sconfitto. */
  phase: 'countdown' | 'active' | 'complete';
  /** Stanze ripulite: le porte fino a questa sono aperte (la stanza 0 è sicura). */
  cleared: number;
  /** Stanza in cui si combatte ora (-1 se nessuna). */
  fight: number;
  /** Ondata in corso nella stanza. */
  wave: number;
  /** Sale a ogni sconfitta di gruppo: tutti tornano al checkpoint. */
  wipes: number;
  /** Missione del giorno, se la Frattura è stata aperta per una missione. */
  missione?: MissioneInCorso | null;
}

export interface RoomState {
  /** Versione: sale a ogni modifica fatta dall'host. */
  v: number;
  classes: Record<string, ClassId>;
  /** Frattura in corso, oppure null se si è al Crocevia. */
  run?: RunState | null;
  /** Grado del gruppo: la prossima Frattura sarà di questo Grado. */
  grado?: number;
  /** Grado più alto completato (la "classifica interna"). */
  best?: number;
  /** Codice della compagnia di cui si usa la base. */
  group?: string | null;
  /** Edifici della base del Crocevia. */
  base?: Partial<Record<BuildingId, BuildingState>>;
  /** Imprese del gruppo (sala dei trofei, biblioteca). */
  gstats?: GroupData['stats'];
  /** Missioni e battute del giorno (narratore o riserva). */
  narrazione?: Narrazione | null;
  /** Missioni del giorno già compiute (id). */
  fatte?: string[];
  /** Indizi della Biblioteca scritti dal narratore. */
  indizi?: Indizio[];
  /** Ultime righe del diario della compagnia. */
  diario?: GroupData['diario'];
  /** Da dove vengono le missioni di oggi, in parole semplici (lo scrive l'host). */
  statoNarratore?: string;
}

export const emptyRoomState = (): RoomState => ({ v: 0, classes: {}, run: null, grado: 1, best: 0 });

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
  | { ok: false; reason: 'taken' | 'not-member' | 'in-run'; holder?: string };

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
  // la classe si cambia tra una missione e l'altra, non dentro una Frattura
  if (state.run && state.run.phase !== 'countdown') return { ok: false, reason: 'in-run' };
  if (cls) {
    const holder = classHolder(state, cls, playerId);
    if (holder) return { ok: false, reason: 'taken', holder };
  }
  const classes = { ...state.classes };
  if (cls) classes[playerId] = cls;
  else delete classes[playerId];
  return { ok: true, state: { ...state, v: state.v + 1, classes } };
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
  return same ? state : { ...state, v: state.v + 1, classes };
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
