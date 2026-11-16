// Il "canale di segnalazione" sa chi è nella stanza (presenza) e trasporta
// messaggi poco frequenti: richieste di classe, stato della stanza e la
// stretta di mano WebRTC. Il traffico continuo di posizioni passa invece in
// peer-to-peer (vedi mesh.ts), per stare nei limiti del piano gratuito di
// Supabase.

import type { Member } from './roomLogic';

export interface Signaling {
  readonly kind: 'local' | 'supabase';
  connect(self: Member): Promise<void>;
  /** Aggiorna i propri dati di presenza (per esempio l'orario d'ingresso). */
  update(self: Member): void;
  /** Senza `to` arriva a tutti gli altri, con `to` solo a quel giocatore. */
  send(data: unknown, to?: string): void;
  onMessage(cb: (from: string, data: unknown) => void): void;
  onMembers(cb: (members: Member[]) => void): void;
  close(): void;
}

// ---------------------------------------------------------------------------
// Locale: più schede dello stesso browser, senza server. Serve per provare il
// gioco in sviluppo (BroadcastChannel funziona solo sullo stesso dispositivo).

/** Una scheda occupata (o in secondo piano) può saltare qualche battito. */
const PRESENCE_TIMEOUT_MS = 6000;

type LocalWire =
  | { k: 'pres'; m: Member }
  | { k: 'bye'; id: string }
  | { k: 'msg'; from: string; to?: string; d: unknown };

export class LocalSignaling implements Signaling {
  readonly kind = 'local' as const;
  private ch: BroadcastChannel;
  private self: Member | null = null;
  private seen = new Map<string, { m: Member; last: number }>();
  private msgCb: (from: string, d: unknown) => void = () => {};
  private membersCb: (m: Member[]) => void = () => {};
  private timer: ReturnType<typeof setInterval> | null = null;
  private onHide = () => this.sayBye();

  constructor(code: string) {
    this.ch = new BroadcastChannel(`fratture-${code}`);
  }

  async connect(self: Member): Promise<void> {
    this.self = self;
    this.ch.onmessage = (ev: MessageEvent<LocalWire>) => this.receive(ev.data);
    this.seen.set(self.id, { m: self, last: Date.now() });
    this.announce();
    this.timer = setInterval(() => {
      this.announce();
      this.expire();
    }, 1000);
    window.addEventListener('pagehide', this.onHide);
    this.emitMembers();
  }

  update(self: Member) {
    this.self = self;
    this.seen.set(self.id, { m: self, last: Date.now() });
    this.announce();
    this.emitMembers();
  }

  private announce() {
    if (this.self) this.ch.postMessage({ k: 'pres', m: this.self } satisfies LocalWire);
  }

  private expire() {
    const now = Date.now();
    let changed = false;
    for (const [id, e] of this.seen) {
      if (id !== this.self?.id && now - e.last > PRESENCE_TIMEOUT_MS) {
        this.seen.delete(id);
        changed = true;
      }
    }
    if (changed) this.emitMembers();
  }

  private receive(w: LocalWire) {
    if (!this.self) return;
    if (w.k === 'pres') {
      const isNew = !this.seen.has(w.m.id);
      this.seen.set(w.m.id, { m: w.m, last: Date.now() });
      if (isNew) {
        this.announce(); // risponde subito, così chi entra ci vede senza aspettare
        this.emitMembers();
      }
    } else if (w.k === 'bye') {
      if (this.seen.delete(w.id)) this.emitMembers();
    } else if (w.k === 'msg') {
      if (w.to && w.to !== this.self.id) return;
      this.msgCb(w.from, w.d);
    }
  }

  private emitMembers() {
    this.membersCb([...this.seen.values()].map((e) => e.m));
  }

  send(d: unknown, to?: string) {
    if (!this.self) return;
    this.ch.postMessage({ k: 'msg', from: this.self.id, to, d } satisfies LocalWire);
  }

  onMessage(cb: (from: string, d: unknown) => void) {
    this.msgCb = cb;
  }

  onMembers(cb: (m: Member[]) => void) {
    this.membersCb = cb;
  }

  private sayBye() {
    if (this.self) this.ch.postMessage({ k: 'bye', id: this.self.id } satisfies LocalWire);
  }

  close() {
    this.sayBye();
    if (this.timer) clearInterval(this.timer);
    window.removeEventListener('pagehide', this.onHide);
    this.ch.close();
    this.self = null;
  }
}

// ---------------------------------------------------------------------------
// Online: Supabase Realtime (Presence + Broadcast). Nessuna tabella richiesta.

export class SupabaseSignaling implements Signaling {
  readonly kind = 'supabase' as const;
  private channel: import('@supabase/supabase-js').RealtimeChannel | null = null;
  private client: import('@supabase/supabase-js').SupabaseClient | null = null;
  private self: Member | null = null;
  private msgCb: (from: string, d: unknown) => void = () => {};
  private membersCb: (m: Member[]) => void = () => {};

  constructor(
    private code: string,
    private url: string,
    private key: string,
  ) {}

  async connect(self: Member): Promise<void> {
    this.self = self;
    const { createClient } = await import('@supabase/supabase-js');
    this.client = createClient(this.url, this.key, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 20 } },
    });
    const ch = this.client.channel(`fratture-${this.code}`, {
      config: { broadcast: { self: false, ack: false }, presence: { key: self.id } },
    });
    this.channel = ch;

    ch.on('presence', { event: 'sync' }, () => {
      const state = ch.presenceState<Member>();
      const members: Member[] = [];
      for (const metas of Object.values(state)) {
        const m = metas[0];
        if (m && typeof m.id === 'string') members.push({ id: m.id, name: m.name, joinedAt: m.joinedAt, ok: m.ok });
      }
      this.membersCb(members);
    });

    ch.on('broadcast', { event: 'm' }, ({ payload }) => {
      const p = payload as { from: string; to?: string; d: unknown };
      if (!this.self || (p.to && p.to !== this.self.id)) return;
      this.msgCb(p.from, p.d);
    });

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      ch.subscribe(async (status, err) => {
        if (status === 'SUBSCRIBED') {
          // Si ripete anche dopo una riconnessione: la presenza va ri-annunciata.
          const me = this.self ?? self;
          await ch.track({ id: me.id, name: me.name, joinedAt: me.joinedAt, ok: me.ok });
          if (!settled) {
            settled = true;
            resolve();
          }
        } else if ((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') && !settled) {
          settled = true;
          reject(err ?? new Error(`Supabase Realtime: ${status}`));
        }
      });
    });
  }

  update(self: Member) {
    this.self = self;
    void this.channel?.track({ id: self.id, name: self.name, joinedAt: self.joinedAt, ok: self.ok });
  }

  send(d: unknown, to?: string) {
    if (!this.channel || !this.self) return;
    void this.channel.send({ type: 'broadcast', event: 'm', payload: { from: this.self.id, to, d } });
  }

  onMessage(cb: (from: string, d: unknown) => void) {
    this.msgCb = cb;
  }

  onMembers(cb: (m: Member[]) => void) {
    this.membersCb = cb;
  }

  close() {
    if (this.channel) {
      void this.channel.untrack();
      void this.client?.removeChannel(this.channel);
    }
    this.channel = null;
    this.client = null;
    this.self = null;
  }
}
