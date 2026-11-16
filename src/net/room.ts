// Il cliente della stanza: tiene insieme presenza, host, classi e traffico.
//
// Modello (dal documento di design): chi crea la partita è l'host e decide
// le regole condivise (oggi: le classi; dalla tappa 4: nemici e bottino). Se
// l'host esce, il ruolo passa a chi è entrato subito dopo, senza interrompere.

import { NET, type ClassId } from '../game/constants';
import { displayName, emptyRoom, getGame, patchRoom, toast, type LinkKind, type PeerInfo } from '../game/store';
import { SnapshotBuffer, type AnimState } from './interpolation';
import { PeerMesh, iceServersFromEnv, type LinkState, type RtcSignal } from './mesh';
import {
  admittedMembers,
  applyClassRequest,
  classHolder,
  electHost,
  emptyRoomState,
  hostIsBehind,
  normalizeRoomState,
  queuedJoinTime,
  shouldAcceptRoomState,
  type Member,
  type RoomState,
} from './roomLogic';
import { LocalSignaling, SupabaseSignaling, type Signaling } from './signaling';
import type { CombatMsg } from '../combat/protocol';

type Vec3 = [number, number, number];

export type GameEvent =
  | { t: 'act'; a: 'attack'; n: number; p: Vec3; r: number }
  | { t: 'act'; a: 'dodge'; p: Vec3; r: number }
  | { t: 'emote'; e: number }
  | { t: 'ping'; p: Vec3 }
  | CombatMsg;

type NetMsg =
  | { t: 's'; ts: number; p: Vec3; r: number; a: AnimState; v: number; hp?: number; mhp?: number; f?: number }
  | { t: 'room'; st: RoomState }
  | { t: 'creq'; cls: ClassId | null }
  | { t: 'cden'; cls: ClassId; holder?: string }
  | { t: 'pi'; ts: number }
  | { t: 'po'; ts: number }
  /** "Esco davvero": la classe si libera subito, senza periodo di grazia. */
  | { t: 'bye' }
  | GameEvent;

export interface LocalState {
  p: Vec3;
  r: number;
  a: AnimState;
  v: number;
  hp: number;
  mhp: number;
  /** Stati del giocatore (VF in combat/protocol). */
  f: number;
}

export interface Vitals {
  hp: number;
  mhp: number;
  f: number;
  /** Ultima posizione ricevuta (senza ritardo di interpolazione): serve all'host per i nemici. */
  p: Vec3;
}

export function supabaseConfig(): { url: string; key: string } | null {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !key || url.includes('xxxxxxxx')) return null;
  return { url, key };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const EMPTY_BASE = {};
const EMPTY_STATS = { fratture: 0, bosses: 0, kills: 0 };

/**
 * Chi sparisce per poco (telefono in tasca, rete che cade) non perde subito la
 * classe: l'host gliela tiene per qualche secondo.
 */
const CLASS_GRACE_MS = 6000;
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface RoomOptions {
  code: string;
  selfId: string;
  name: string;
  /** Forza la modalità locale (più schede dello stesso browser). */
  forceLocal?: boolean;
  /** In locale usa comunque WebRTC: serve a provare il P2P su un solo computer. */
  forceP2P?: boolean;
}

export class RoomClient {
  self: Member;
  readonly code: string;
  readonly mode: 'local' | 'online';
  private sig: Signaling;
  private mesh: PeerMesh | null = null;
  private members: Member[] = [];
  private names = new Map<string, string>();
  admittedIds: string[] = [];
  hostId: string | null = null;
  roomState: RoomState = emptyRoomState();
  readonly remotes = new Map<string, SnapshotBuffer>();
  /** Vita e stati degli altri giocatori, dall'ultima posizione ricevuta. */
  readonly vitals = new Map<string, Vitals>();
  private links = new Map<string, LinkKind>();
  private rtt = new Map<string, number>();
  private listeners = new Set<(from: string, ev: GameEvent) => void>();
  private settled = false;
  private membersChangedAt = 0;
  private announced = false;
  private closed = false;
  private timers: ReturnType<typeof setInterval>[] = [];
  private lastRelayState = 0;
  private lastRelayUnreliable = 0;
  private rttTick = 0;
  private pending: { cls: ClassId | null; tries: number; timer?: ReturnType<typeof setTimeout> } | null = null;
  /** Ultima classe chiesta: se la perdiamo per una disconnessione, la richiediamo. */
  private wantedClass: ClassId | null = null;
  private goneAt = new Map<string, number>();
  private byeFrom = new Set<string>();
  private onPageHide = () => this.sendEvent({ t: 'bye' });
  /** Contatori per le statistiche di rete. */
  stats = { sentP2P: 0, sentRelay: 0, recv: 0 };

  constructor(opts: RoomOptions) {
    this.code = opts.code;
    this.self = { id: opts.selfId, name: opts.name, joinedAt: Date.now() };
    const cfg = opts.forceLocal ? null : supabaseConfig();
    this.mode = cfg ? 'online' : 'local';
    this.sig = cfg ? new SupabaseSignaling(opts.code, cfg.url, cfg.key) : new LocalSignaling(opts.code);
    const wantP2P = this.mode === 'online' || opts.forceP2P;
    if (wantP2P && PeerMesh.supported()) {
      this.mesh = new PeerMesh(this.self.id, iceServersFromEnv(), {
        signal: (to, msg) => this.sig.send(msg, to),
        data: (from, msg) => this.handle(from, msg as NetMsg),
        link: (id, s) => this.onLink(id, s),
      });
    }
    window.addEventListener('pagehide', this.onPageHide);
  }

  get isHost() {
    return this.hostId === this.self.id;
  }

  get others(): string[] {
    return this.admittedIds.filter((id) => id !== this.self.id);
  }

  /** Entra nella stanza. Restituisce false se è piena o se la connessione fallisce. */
  async connect(): Promise<boolean> {
    patchRoom({ ...emptyRoom(), code: this.code, mode: this.mode, status: 'connecting' });
    this.sig.onMembers((list) => this.onMembers(list));
    this.sig.onMessage((from, d) => {
      if (d && typeof d === 'object' && (d as RtcSignal).k === 'rtc') this.mesh?.handleSignal(from, d as RtcSignal);
      else this.handle(from, d as NetMsg);
    });
    try {
      await this.sig.connect(this.self);
    } catch (e) {
      patchRoom({ status: 'error', error: `Connessione non riuscita: ${(e as Error).message}` });
      this.close();
      return false;
    }

    // Aspetta che la lista dei presenti si stabilizzi (nessun cambiamento per un po').
    const start = performance.now();
    const minWait = this.mode === 'local' ? 700 : 1500;
    while (!this.closed) {
      await sleep(100);
      const t = performance.now();
      if (t - start >= minWait && t - this.membersChangedAt >= 400) break;
      if (t - start > minWait + 3000) break;
    }
    if (this.closed) return false;
    const queued = queuedJoinTime(this.self, this.members);
    if (queued !== this.self.joinedAt) {
      this.self = { ...this.self, joinedAt: queued };
      this.sig.update(this.self);
      await sleep(300);
    }

    this.settled = true;
    this.onMembers(this.members);
    if (!this.admittedIds.includes(this.self.id)) {
      patchRoom({ status: 'full', error: `La stanza ${this.code} è piena (${NET.maxPlayers}/${NET.maxPlayers}).` });
      this.close(false);
      return false;
    }
    // Da qui in poi siamo "confermati": chi entra dopo si mette in coda dopo di noi.
    this.self = { ...this.self, ok: true };
    this.sig.update(this.self);
    this.announced = true;
    patchRoom({ status: 'joined' });

    this.timers.push(
      setInterval(() => {
        if (!this.isHost) return;
        // libera le classi di chi non è tornato entro il periodo di grazia
        this.roomState = normalizeRoomState(this.roomState, this.retainedIds());
        this.broadcastRoomState();
        this.publish();
      }, NET.roomStateEveryMs),
      setInterval(() => this.measureRtt(), NET.rttEveryMs),
      setInterval(() => this.publish(), 1000),
    );
    return true;
  }

  // --- presenza e host ------------------------------------------------------

  private onMembers(list: Member[]) {
    if (this.closed) return;
    const sig = (l: Member[]) => l.map((m) => `${m.id}:${m.joinedAt}`).sort().join('|');
    if (sig(list) !== sig(this.members)) this.membersChangedAt = performance.now();
    const prevIds = this.admittedIds;
    const prevHost = this.hostId;
    this.members = list;
    for (const m of list) this.names.set(m.id, m.name);
    this.admittedIds = admittedMembers(list, NET.maxPlayers).map((m) => m.id);
    this.hostId = electHost(list, NET.maxPlayers);

    if (!this.settled) {
      this.publish();
      return;
    }

    if (this.announced && !this.admittedIds.includes(this.self.id)) {
      patchRoom({ status: 'full', error: `La stanza ${this.code} è piena (${NET.maxPlayers}/${NET.maxPlayers}).` });
      this.close(false);
      return;
    }

    const others = this.others;
    if (this.announced) {
      for (const id of others) if (!prevIds.includes(id)) toast(`${this.nameOf(id)} è arrivato al Crocevia`);
      for (const id of prevIds) {
        if (id !== this.self.id && !this.admittedIds.includes(id)) toast(`${this.nameOf(id)} se n'è andato`);
      }
      if (prevHost && prevHost !== this.hostId && this.hostId) {
        toast(this.isHost ? 'Ora sei tu l’host della partita' : `Ora l’host è ${this.nameOf(this.hostId)}`);
      }
    }

    const now = Date.now();
    for (const id of prevIds) if (!this.admittedIds.includes(id)) this.goneAt.set(id, now);
    for (const id of this.admittedIds) this.goneAt.delete(id);

    for (const id of [...this.remotes.keys()]) if (!others.includes(id)) this.remotes.delete(id);
    for (const id of [...this.vitals.keys()]) if (!others.includes(id)) this.vitals.delete(id);
    for (const id of [...this.links.keys()]) if (!others.includes(id)) this.links.delete(id);
    for (const id of others) {
      if (!this.links.has(id)) this.links.set(id, this.mesh ? 'connecting' : this.mode === 'local' ? 'local' : 'relay');
    }
    this.mesh?.sync(others);

    if (this.isHost) {
      // L'host fa pulizia (chi è uscito libera la classe) e informa tutti,
      // compresi i nuovi arrivati.
      this.roomState = normalizeRoomState(this.roomState, this.retainedIds());
      if (this.pending) {
        const cls = this.pending.cls;
        this.clearPending();
        this.applyClass(this.self.id, cls);
      }
      this.broadcastRoomState();
    } else if (this.pending && prevHost !== this.hostId) {
      this.sendClassRequest(); // la richiesta era per il vecchio host
    }
    this.publish();
  }

  /** Giocatori presenti + quelli usciti da poco (tengono ancora la classe). */
  private retainedIds(): string[] {
    const now = Date.now();
    const recent = [...this.goneAt]
      .filter(([id, t]) => now - t < CLASS_GRACE_MS && !this.byeFrom.has(id) && !this.admittedIds.includes(id))
      .map(([id]) => id);
    return [...this.admittedIds, ...recent];
  }

  private nameOf(id: string): string {
    return this.names.get(id) ?? displayName(id);
  }

  private onLink(id: string, s: LinkState) {
    this.links.set(id, s === 'open' ? 'p2p' : s === 'failed' ? 'relay' : 'connecting');
    this.publish();
  }

  /** Copia lo stato nello store di React (poche volte al secondo, non a ogni frame). */
  private publish() {
    if (this.closed) return;
    const peers: Record<string, PeerInfo> = {};
    for (const id of this.others) peers[id] = { link: this.links.get(id) ?? 'connecting', rtt: this.rtt.get(id) ?? null };
    const admitted = admittedMembers(this.members, NET.maxPlayers);
    const cur = getGame().room;
    const st = this.roomState;
    const same =
      cur.hostId === this.hostId &&
      cur.classes === st.classes &&
      cur.run === (st.run ?? null) &&
      cur.grado === (st.grado ?? 1) &&
      cur.best === (st.best ?? 0) &&
      cur.group === (st.group ?? null) &&
      cur.base === (st.base ?? EMPTY_BASE) &&
      cur.gstats === (st.gstats ?? EMPTY_STATS) &&
      cur.members.length === admitted.length &&
      cur.members.every((m, i) => m.id === admitted[i].id && m.name === admitted[i].name) &&
      JSON.stringify(cur.peers) === JSON.stringify(peers);
    if (!same) {
      patchRoom({
        members: admitted,
        hostId: this.hostId,
        classes: st.classes,
        run: st.run ?? null,
        grado: st.grado ?? 1,
        best: st.best ?? 0,
        group: st.group ?? null,
        base: st.base ?? EMPTY_BASE,
        gstats: st.gstats ?? EMPTY_STATS,
        peers,
      });
    }
  }

  // --- classi --------------------------------------------------------------

  requestClass(cls: ClassId | null) {
    this.wantedClass = cls;
    if (this.isHost) {
      this.applyClass(this.self.id, cls);
      return;
    }
    this.clearPending();
    this.pending = { cls, tries: 0 };
    this.sendClassRequest();
  }

  private sendClassRequest() {
    const p = this.pending;
    if (!p || !this.hostId) return;
    if (p.timer) clearTimeout(p.timer);
    p.tries++;
    this.sendEvent({ t: 'creq', cls: p.cls }, this.hostId);
    p.timer = setTimeout(() => {
      if (this.pending !== p) return;
      if ((this.roomState.classes[this.self.id] ?? null) === p.cls || p.tries >= 4) this.clearPending();
      else this.sendClassRequest();
    }, 1500);
  }

  private clearPending() {
    if (this.pending?.timer) clearTimeout(this.pending.timer);
    this.pending = null;
  }

  private applyClass(playerId: string, cls: ClassId | null) {
    const r = applyClassRequest(this.roomState, playerId, cls, this.admittedIds);
    if (r.ok) {
      if (r.state !== this.roomState) {
        this.roomState = r.state;
        this.broadcastRoomState();
        this.publish();
      }
    } else if (r.reason === 'taken' && cls) {
      if (playerId === this.self.id) toast(`Classe già scelta da ${this.nameOf(r.holder ?? '')}`);
      else this.sendEvent({ t: 'cden', cls, holder: r.holder }, playerId);
    } else if (r.reason === 'in-run' && playerId === this.self.id) {
      toast('La classe si cambia al Crocevia, non dentro una Frattura');
    }
  }

  private broadcastRoomState() {
    if (this.others.length) this.sendEvent({ t: 'room', st: this.roomState });
  }

  // --- invio ---------------------------------------------------------------

  /** Posizione del giocatore locale. La chiama LocalPlayer ~20 volte al secondo. */
  sendState(s: LocalState) {
    if (!this.settled || this.closed) return;
    const msg: NetMsg = {
      t: 's',
      ts: performance.now(),
      p: [r2(s.p[0]), r2(s.p[1]), r2(s.p[2])],
      r: r2(s.r),
      a: s.a,
      v: r2(s.v),
      hp: Math.round(s.hp),
      mhp: Math.round(s.mhp),
      f: s.f,
    };
    let needRelay = false;
    for (const id of this.others) {
      if (this.mesh?.send(id, msg, false)) this.stats.sentP2P++;
      else needRelay = true;
    }
    if (!needRelay) return;
    const now = performance.now();
    // Il relay di Supabase si paga a messaggio: si usa a frequenza ridotta.
    if (this.sig.kind === 'local' || now - this.lastRelayState >= 1000 / NET.relayHz) {
      this.lastRelayState = now;
      this.sig.send(msg);
      this.stats.sentRelay++;
    }
  }

  /** Evento affidabile (attacco, emote, ping...) a tutti o a un solo giocatore. */
  sendEvent(msg: NetMsg, to?: string) {
    if (this.closed) return;
    const targets = to ? [to] : this.others;
    const relay: string[] = [];
    for (const id of targets) {
      if (this.mesh?.send(id, msg, true)) this.stats.sentP2P++;
      else relay.push(id);
    }
    if (relay.length === 0) return;
    if (!to && relay.length === targets.length) this.sig.send(msg);
    else for (const id of relay) this.sig.send(msg, id);
    this.stats.sentRelay++;
  }

  emit(ev: GameEvent) {
    this.sendEvent(ev as NetMsg);
  }

  /** Messaggio frequente e "senza garanzia" a tutti (istantanee dei nemici). */
  sendUnreliable(msg: GameEvent) {
    if (!this.settled || this.closed) return;
    let needRelay = false;
    for (const id of this.others) {
      if (this.mesh?.send(id, msg, false)) this.stats.sentP2P++;
      else needRelay = true;
    }
    if (!needRelay) return;
    const now = performance.now();
    if (this.sig.kind === 'local' || now - this.lastRelayUnreliable >= 1000 / NET.relayHz) {
      this.lastRelayUnreliable = now;
      this.sig.send(msg);
      this.stats.sentRelay++;
    }
  }

  /** Solo l'host: modifica lo stato condiviso della stanza (per esempio la Frattura in corso). */
  updateRoom(fn: (s: RoomState) => RoomState): boolean {
    if (!this.isHost || this.closed) return false;
    const next = fn(this.roomState);
    if (next === this.roomState) return false;
    this.roomState = { ...next, v: this.roomState.v + 1 };
    this.broadcastRoomState();
    this.publish();
    return true;
  }

  private measureRtt() {
    this.rttTick++;
    const ts = performance.now();
    for (const id of this.others) {
      if (this.mesh?.isOpen(id)) this.mesh.send(id, { t: 'pi', ts }, false);
      else if (this.sig.kind === 'local' || this.rttTick % 3 === 0) this.sig.send({ t: 'pi', ts }, id);
    }
  }

  // --- ricezione -----------------------------------------------------------

  private handle(from: string, msg: NetMsg) {
    if (this.closed || !msg || typeof msg !== 'object') return;
    if (msg.t === 'bye') {
      // può arrivare dopo che la presenza l'ha già tolto: si gestisce comunque
      this.byeFrom.add(from);
      if (this.isHost) {
        this.roomState = normalizeRoomState(this.roomState, this.retainedIds());
        this.broadcastRoomState();
        this.publish();
      }
      return;
    }
    if (!this.members.some((m) => m.id === from)) return;
    this.stats.recv++;
    switch (msg.t) {
      case 's': {
        let b = this.remotes.get(from);
        if (!b) {
          b = new SnapshotBuffer(NET.maxExtrapolateMs);
          this.remotes.set(from, b);
        }
        b.push(msg.ts, performance.now(), { p: msg.p, r: msg.r, a: msg.a, s: msg.v });
        if (msg.hp !== undefined) this.vitals.set(from, { hp: msg.hp, mhp: msg.mhp ?? msg.hp, f: msg.f ?? 0, p: msg.p });
        break;
      }
      case 'room':
        if (hostIsBehind(this.roomState, msg.st, from, this.hostId)) {
          this.sendEvent({ t: 'room', st: this.roomState }, from);
        } else if (shouldAcceptRoomState(this.roomState, msg.st, from, this.hostId)) {
          this.roomState = msg.st;
          if (this.isHost) {
            // un altro aveva una versione più nuova: la adottiamo e la ridiffondiamo
            this.roomState = normalizeRoomState(this.roomState, this.retainedIds());
            this.broadcastRoomState();
          }
          if (this.pending && (msg.st.classes[this.self.id] ?? null) === this.pending.cls) this.clearPending();
          this.reclaimClass();
          this.publish();
        }
        break;
      case 'creq':
        if (this.isHost) this.applyClass(from, msg.cls);
        break;
      case 'cden':
        this.clearPending();
        toast(`Classe già scelta da ${this.nameOf(msg.holder ?? '')}`);
        break;
      case 'pi':
        if (this.mesh?.isOpen(from)) this.mesh.send(from, { t: 'po', ts: msg.ts }, false);
        else this.sig.send({ t: 'po', ts: msg.ts }, from);
        break;
      case 'po':
        this.rtt.set(from, Math.round(performance.now() - msg.ts));
        break;
      default:
        // eventi di gioco (azioni, emote, ping, combattimento)
        for (const l of this.listeners) l(from, msg as GameEvent);
        break;
    }
  }

  /** Dopo una disconnessione breve l'host può averci tolto la classe: la richiediamo se è ancora libera. */
  private reclaimClass() {
    if (this.isHost || this.pending || !this.wantedClass) return;
    const have = this.roomState.classes[this.self.id] ?? null;
    if (have === this.wantedClass) return;
    if (classHolder(this.roomState, this.wantedClass, this.self.id)) this.wantedClass = have;
    else this.requestClass(this.wantedClass);
  }

  onEvent(cb: (from: string, ev: GameEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  linkOf(id: string): LinkKind {
    return this.links.get(id) ?? 'connecting';
  }

  close(resetStore = true) {
    if (this.closed) return;
    if (this.settled) this.sendEvent({ t: 'bye' });
    window.removeEventListener('pagehide', this.onPageHide);
    this.closed = true;
    this.clearPending();
    for (const t of this.timers) clearInterval(t);
    this.mesh?.close();
    this.sig.close();
    this.listeners.clear();
    if (resetStore) patchRoom(emptyRoom());
  }
}

// --- sessione corrente -------------------------------------------------------

let current: RoomClient | null = null;

export const getRoom = () => current;

export function setRoom(r: RoomClient | null) {
  if (current && current !== r) current.close();
  current = r;
}
