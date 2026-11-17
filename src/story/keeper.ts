// Le missioni del gruppo, tenute dall'host (come nemici e compagnia).
//
// L'host conta gli eventi (nemici sconfitti, stanze ripulite, Fratture
// richiuse, combo), fa avanzare le missioni e, quando una è compiuta, manda a
// tutti la ricompensa. Ogni giorno prende tre giornaliere: subito quelle di
// riserva, poi, se arrivano in tempo (prima che qualcuna avanzi), quelle
// scritte da Claude. Lo stato viaggia nello stato della stanza e si salva con
// la compagnia, quindi sopravvive a un cambio di host.

import { emitCombat, onCombat } from '../combat/bus';
import type { CombatMsg } from '../combat/protocol';
import { getGame } from '../game/store';
import { getRoom } from '../net/room';
import { groupKeeper } from '../progress/group';
import {
  applyEvent,
  dailyUntouched,
  emptyStory,
  fallbackDaily,
  normalizeStory,
  sanitizeDaily,
  sommersaOpen,
  today,
  withDaily,
  type Mission,
  type StoryEvent,
  type StoryState,
} from './core';
import { fetchDaily, narratorStatus } from './narrator';

class StoryKeeper {
  private timer: ReturnType<typeof setInterval> | null = null;
  private unsub: (() => void) | null = null;
  private runId = -1;
  private cleared = 0;
  private closed = -1;
  /** giorno per cui si sono già chieste le giornaliere a Claude */
  private askedFor = '';
  private asking = false;

  start() {
    this.timer = setInterval(() => this.tick(), 700);
    this.unsub = onCombat((_, msg) => this.onMsg(msg));
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.unsub?.();
    this.runId = -1;
  }

  /** Per i test automatici. */
  get debug() {
    return { feed: (ev: StoryEvent) => this.feed(ev) };
  }

  private isHost() {
    const room = getRoom();
    return !!room?.isHost && getGame().room.status === 'joined';
  }

  /** Lo stato delle missioni da usare: quello della stanza, o quello salvato con la compagnia. */
  private current(): StoryState | null {
    const room = getRoom();
    if (!room) return null;
    if (room.roomState.storia) return room.roomState.storia;
    const saved = groupKeeper.loaded;
    if (!saved) return null; // la compagnia si sta ancora caricando
    return saved.storia ? normalizeStory(saved.storia) : emptyStory();
  }

  private commit(st: StoryState) {
    const room = getRoom();
    if (!room) return;
    room.updateRoom((s) => ({ ...s, storia: st }));
    groupKeeper.setStoria(st);
  }

  private tick() {
    if (!this.isHost()) {
      this.runId = -1;
      return;
    }
    const room = getRoom()!;
    let st = this.current();
    if (!st) return;
    const day = today();
    if (st.day !== day) {
      st = withDaily(st, day, fallbackDaily(day, room.roomState.best ?? 0, room.roomState.group ?? ''), 'riserva');
      this.commit(st);
    } else if (!room.roomState.storia) this.commit(st);

    if (st.fonte === 'riserva' && dailyUntouched(st) && this.askedFor !== day && !this.asking) void this.askClaude(day);
    this.watchRun();
  }

  private async askClaude(day: string) {
    this.asking = true;
    this.askedFor = day;
    try {
      const room = getRoom();
      const diario = (groupKeeper.loaded?.diario ?? []).slice(-12).map((e) => e.text);
      const raw = await fetchDaily(day, room?.roomState.group ?? null, diario);
      if (!raw || !this.isHost()) return;
      const r = getRoom()!.roomState;
      const missions = sanitizeDaily(raw, day, r.best ?? 0, sommersaOpen(r.gstats ?? { fratture: 0 }));
      const st = this.current();
      // se nel frattempo qualcuno ha già fatto progressi, restano quelle di riserva
      if (!missions || !st || st.day !== day || !dailyUntouched(st)) return;
      this.commit(withDaily(st, day, missions, 'claude'));
      narratorStatus.claude++;
    } finally {
      this.asking = false;
    }
  }

  /** Stanze ripulite e Fratture richiuse, dallo stato della Frattura. */
  private watchRun() {
    const run = getRoom()!.roomState.run;
    if (!run || run.phase === 'countdown') return;
    if (run.id !== this.runId) {
      this.runId = run.id;
      this.cleared = run.cleared;
      return;
    }
    while (this.cleared < run.cleared) {
      this.cleared++;
      this.feed({ k: 'room', mondo: run.world, grado: run.grado });
    }
    if (run.phase === 'complete' && this.closed !== run.id) {
      this.closed = run.id;
      this.feed({ k: 'close', mondo: run.world, grado: run.grado, wipes: run.wipes });
    }
  }

  private onMsg(msg: CombatMsg) {
    if (!this.isHost()) return;
    const run = getRoom()!.roomState.run;
    if (!run || run.phase === 'countdown') return;
    if (msg.t === 'edie') this.feed({ k: 'kill', nemico: msg.type, mondo: run.world, grado: run.grado });
    else if (msg.t === 'combo') this.feed({ k: 'combo', mondo: run.world, grado: run.grado });
  }

  private feed(ev: StoryEvent) {
    const st = this.current();
    if (!st) return;
    const r = applyEvent(st, ev);
    if (r.st === st) return;
    this.commit(r.st);
    for (const m of r.done) this.complete(m);
  }

  private complete(m: Mission) {
    emitCombat({ t: 'mdone', id: m.id, tipo: m.tipo, titolo: m.titolo, fine: m.fine, xp: m.premio.xp, frags: m.premio.frammenti });
    groupKeeper.diary(m.tipo === 'storia' ? `Missione «${m.titolo}» compiuta. ${m.fine}` : `Giornaliera «${m.titolo}» compiuta.`);
  }
}

export const storyKeeper = new StoryKeeper();
