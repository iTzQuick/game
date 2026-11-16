// Rete peer-to-peer tra i giocatori (WebRTC DataChannel), al massimo 4 → 6
// collegamenti. Ogni coppia ha due canali:
//   's' (state)  – inaffidabile e senza ordine: posizioni, ~20 al secondo
//   'e' (events) – affidabile e ordinato: attacchi, emote, ping, classi
// La stretta di mano (offerta/risposta/ICE) passa dal canale di segnalazione.

export type LinkState = 'connecting' | 'open' | 'failed';

export interface RtcSignal {
  k: 'rtc';
  /** Generazione: sale a ogni tentativo, per ignorare messaggi vecchi. */
  g: number;
  d?: RTCSessionDescriptionInit;
  c?: RTCIceCandidateInit;
}

interface MeshHandlers {
  signal(to: string, msg: RtcSignal): void;
  data(from: string, msg: unknown): void;
  link(peerId: string, state: LinkState): void;
}

const MAX_ATTEMPTS = 6;
const RETRY_MS = 7000;

class Peer {
  pc!: RTCPeerConnection;
  state!: RTCDataChannel;
  events!: RTCDataChannel;
  gen = 0;
  attempts = 0;
  lastAttempt = 0;
  pendingCandidates: RTCIceCandidateInit[] = [];
  link: LinkState = 'connecting';

  constructor(
    readonly id: string,
    readonly initiator: boolean,
    private ice: RTCIceServer[],
    private h: MeshHandlers,
  ) {
    this.build();
  }

  private build() {
    this.pc = new RTCPeerConnection({ iceServers: this.ice });
    // Canali "negoziati": entrambi i lati li creano con lo stesso id, niente ondatachannel.
    this.state = this.pc.createDataChannel('s', { negotiated: true, id: 0, ordered: false, maxRetransmits: 0 });
    this.events = this.pc.createDataChannel('e', { negotiated: true, id: 1, ordered: true });
    for (const ch of [this.state, this.events]) {
      ch.onmessage = (ev) => {
        try {
          this.h.data(this.id, JSON.parse(ev.data as string));
        } catch {
          /* messaggio non valido: ignorato */
        }
      };
      ch.onopen = () => this.updateLink();
      ch.onclose = () => this.updateLink();
    }
    const pc = this.pc;
    pc.onicecandidate = (ev) => {
      if (ev.candidate && pc === this.pc) this.h.signal(this.id, { k: 'rtc', g: this.gen, c: ev.candidate.toJSON() });
    };
    pc.onconnectionstatechange = () => {
      if (pc !== this.pc) return;
      if (pc.connectionState === 'failed') this.setLink('failed');
      this.updateLink();
    };
    this.pendingCandidates = [];
    this.lastAttempt = performance.now();
  }

  private updateLink() {
    const open = this.state.readyState === 'open' && this.events.readyState === 'open';
    if (open) {
      this.attempts = 0;
      this.setLink('open');
    } else if (this.link === 'open') {
      this.setLink('connecting');
    }
  }

  private setLink(s: LinkState) {
    if (this.link === s) return;
    this.link = s;
    this.h.link(this.id, s);
  }

  get isOpen() {
    return this.link === 'open';
  }

  async offer() {
    if (!this.initiator) return;
    this.attempts++;
    this.lastAttempt = performance.now();
    const pc = this.pc;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    if (pc === this.pc) this.h.signal(this.id, { k: 'rtc', g: this.gen, d: pc.localDescription!.toJSON() });
  }

  /** Ricomincia da capo (dopo un fallimento o un'offerta rimasta senza risposta). */
  restart(gen?: number) {
    try {
      this.pc.close();
    } catch {
      /* già chiuso */
    }
    this.gen = gen ?? this.gen + 1;
    this.build();
    if (this.link !== 'failed') this.setLink('connecting');
  }

  async handle(msg: RtcSignal): Promise<void> {
    if (msg.g < this.gen) return; // messaggio di un tentativo vecchio
    if (msg.g > this.gen) {
      // L'altro lato ha ricominciato: lo seguiamo.
      if (this.initiator) return;
      this.restart(msg.g);
    }
    const pc = this.pc;
    if (msg.d) {
      if (msg.d.type === 'offer') {
        if (this.initiator) return;
        if (pc.signalingState !== 'stable' || pc.remoteDescription) {
          this.restart(msg.g);
          return this.handle(msg);
        }
        await pc.setRemoteDescription(msg.d);
        await this.flushCandidates();
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        if (pc === this.pc) this.h.signal(this.id, { k: 'rtc', g: this.gen, d: pc.localDescription!.toJSON() });
      } else if (msg.d.type === 'answer') {
        if (!this.initiator || pc.signalingState !== 'have-local-offer') return;
        await pc.setRemoteDescription(msg.d);
        await this.flushCandidates();
      }
    } else if (msg.c) {
      if (pc.remoteDescription) await pc.addIceCandidate(msg.c).catch(() => {});
      else this.pendingCandidates.push(msg.c);
    }
  }

  private async flushCandidates() {
    const list = this.pendingCandidates;
    this.pendingCandidates = [];
    for (const c of list) await this.pc.addIceCandidate(c).catch(() => {});
  }

  /** Chiamato periodicamente: riprova se la connessione non arriva. */
  watchdog(now: number) {
    if (!this.initiator || this.isOpen) return;
    if (this.attempts >= MAX_ATTEMPTS) {
      this.setLink('failed');
      return;
    }
    if (now - this.lastAttempt > RETRY_MS || this.pc.connectionState === 'failed') {
      this.restart();
      void this.offer().catch(() => {});
    }
  }

  send(msg: unknown, reliable: boolean): boolean {
    const ch = reliable ? this.events : this.state;
    if (ch.readyState !== 'open') return false;
    // Se il canale veloce è intasato (rete lenta) meglio saltare un'istantanea.
    if (!reliable && ch.bufferedAmount > 16_000) return true;
    ch.send(JSON.stringify(msg));
    return true;
  }

  close() {
    try {
      this.pc.close();
    } catch {
      /* già chiuso */
    }
  }
}

export class PeerMesh {
  private peers = new Map<string, Peer>();
  private everListed = new Set<string>();
  private timer: ReturnType<typeof setInterval>;

  constructor(
    private selfId: string,
    private ice: RTCIceServer[],
    private h: MeshHandlers,
  ) {
    this.timer = setInterval(() => {
      const now = performance.now();
      for (const p of this.peers.values()) p.watchdog(now);
    }, 1500);
  }

  static supported(): boolean {
    return typeof RTCPeerConnection !== 'undefined';
  }

  private ensure(id: string): Peer {
    let p = this.peers.get(id);
    if (!p) {
      // Chi ha l'id "minore" fa l'offerta: così non si scontrano due offerte.
      p = new Peer(id, this.selfId < id, this.ice, this.h);
      this.peers.set(id, p);
      this.h.link(id, 'connecting');
      void p.offer().catch(() => {});
    }
    return p;
  }

  /** Allinea i collegamenti con la lista dei giocatori in stanza. */
  sync(ids: string[]) {
    for (const id of ids) {
      if (id === this.selfId) continue;
      this.everListed.add(id);
      this.ensure(id);
    }
    for (const [id, p] of this.peers) {
      // Chiude solo chi era in lista ed è uscito (non chi ci ha appena scritto
      // prima che la sua presenza arrivasse).
      if (!ids.includes(id) && this.everListed.has(id)) {
        p.close();
        this.peers.delete(id);
        this.everListed.delete(id);
      }
    }
  }

  handleSignal(from: string, msg: RtcSignal) {
    void this.ensure(from)
      .handle(msg)
      .catch(() => {});
  }

  isOpen(id: string): boolean {
    return this.peers.get(id)?.isOpen ?? false;
  }

  send(id: string, msg: unknown, reliable: boolean): boolean {
    return this.peers.get(id)?.send(msg, reliable) ?? false;
  }

  close() {
    clearInterval(this.timer);
    for (const p of this.peers.values()) p.close();
    this.peers.clear();
  }
}

export function iceServersFromEnv(): RTCIceServer[] {
  const servers: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  const url = import.meta.env.VITE_TURN_URL as string | undefined;
  if (url) {
    servers.push({
      urls: url,
      username: import.meta.env.VITE_TURN_USERNAME as string | undefined,
      credential: import.meta.env.VITE_TURN_CREDENTIAL as string | undefined,
    });
  }
  return servers;
}
