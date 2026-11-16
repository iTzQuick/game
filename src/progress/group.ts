// La compagnia: base del Crocevia, Grado, record e diario del gruppo.
// La tiene l'host (come i nemici): la carica all'inizio, la aggiorna e la
// salva. Gli altri la vedono nello stato della stanza.

import { emitCombat, onCombat } from '../combat/bus';
import type { CombatMsg } from '../combat/protocol';
import { displayName, getGame } from '../game/store';
import { getRoom } from '../net/room';
import { createCloudGroup, joinCloudGroup, loadCloudGroup, writeCloudGroup } from './cloud';
import { addDiary, contribute, emptyGroup, normalizeGroup, type GroupData } from './model';
import { getProgress, mutate } from './store';

const localKey = (code: string) => `fratture.group.${code}`;

function readLocalGroup(code: string): GroupData | null {
  try {
    const raw = localStorage.getItem(localKey(code));
    return raw ? normalizeGroup(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function writeLocalGroup(code: string, data: GroupData) {
  try {
    localStorage.setItem(localKey(code), JSON.stringify(data));
  } catch {
    /* ignorato */
  }
}

const isCloud = () => getProgress().account.status === 'cloud';

/** La compagnia del giocatore: la carica o la crea. */
async function ownGroup(): Promise<{ code: string; data: GroupData }> {
  const save = getProgress().save;
  if (isCloud()) {
    let row = save.group ? await loadCloudGroup(save.group).catch(() => null) : null;
    if (!row) {
      row = await createCloudGroup('La Compagnia');
      const code = row.code;
      mutate((s) => (s.group = code));
    }
    return { code: row.code, data: row.data };
  }
  let code = save.group;
  if (!code) {
    code = `L${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const c = code;
    mutate((s) => (s.group = c));
  }
  return { code, data: readLocalGroup(code) ?? emptyGroup() };
}

/** Compagnia già in uso nella stanza (passaggio dell'host). */
async function adoptGroup(code: string): Promise<GroupData> {
  if (isCloud()) {
    try {
      await joinCloudGroup(code);
      const row = await loadCloudGroup(code);
      if (row) return row.data;
    } catch {
      /* compagnia locale o rete assente */
    }
  }
  return readLocalGroup(code) ?? emptyGroup();
}

class GroupKeeper {
  private data: GroupData | null = null;
  private code: string | null = null;
  private loading = false;
  private completedRun = -1;
  private timer: ReturnType<typeof setInterval> | null = null;
  private writeTimer: ReturnType<typeof setTimeout> | null = null;
  private unsub: (() => void) | null = null;

  start() {
    this.timer = setInterval(() => void this.tick(), 500);
    this.unsub = onCombat((from, msg) => this.onMsg(from, msg));
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.unsub?.();
    void this.flush();
    this.data = null;
    this.code = null;
  }

  /** Per i test automatici. */
  get debug() {
    return { code: this.code, data: this.data };
  }

  private async tick() {
    const room = getRoom();
    if (!room || !room.isHost || getGame().room.status !== 'joined') {
      if (this.data) void this.flush();
      this.data = null;
      this.code = null;
      return;
    }
    const st = room.roomState;
    if (!this.data) {
      if (this.loading) return;
      this.loading = true;
      try {
        if (st.group) {
          const data = await adoptGroup(st.group);
          this.code = st.group;
          // i valori della partita in corso sono quelli buoni
          this.data = {
            ...data,
            grado: st.grado ?? data.grado,
            best: st.best ?? data.best,
            base: st.base ?? data.base,
            stats: st.gstats ?? data.stats,
          };
        } else {
          const { code, data } = await ownGroup();
          this.code = code;
          this.data = data;
          room.updateRoom((s) => ({ ...s, group: code, grado: data.grado, best: data.best, base: data.base, gstats: data.stats }));
        }
      } catch (e) {
        console.warn('Compagnia non caricata', e);
        this.code = null;
        this.data = null;
      } finally {
        this.loading = false;
      }
      return;
    }

    const d = this.data;
    if ((st.grado ?? 1) !== d.grado || (st.best ?? 0) !== d.best) {
      d.grado = st.grado ?? d.grado;
      d.best = st.best ?? d.best;
      this.saveSoon();
    }
    const run = st.run;
    if (run?.phase === 'complete' && this.completedRun !== run.id) {
      this.completedRun = run.id;
      d.stats = { ...d.stats, fratture: d.stats.fratture + 1, bosses: d.stats.bosses + 1 };
      const names = room.admittedIds.map((id) => displayName(id)).join(', ');
      addDiary(d, `Frattura di Grado ${run.grado} richiusa da ${names}.`);
      room.updateRoom((s) => ({ ...s, gstats: d.stats }));
      this.saveSoon();
    }
  }

  private onMsg(from: string, msg: CombatMsg) {
    const room = getRoom();
    if (!room?.isHost || !this.data) return;
    if (msg.t === 'edie') {
      this.data.stats = { ...this.data.stats, kills: this.data.stats.kills + 1 };
      this.saveSoon();
    } else if (msg.t === 'contrib') {
      const used = contribute(this.data, msg.b, msg.n);
      if (used > 0) {
        const base = this.data.base;
        room.updateRoom((s) => ({ ...s, base }));
        this.saveSoon();
      }
      emitCombat({ t: 'contribok', b: msg.b, used }, { to: from });
    }
  }

  private saveSoon() {
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => void this.flush(), 2000);
  }

  private async flush() {
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = null;
    const { code, data } = this;
    if (!code || !data) return;
    writeLocalGroup(code, data);
    if (isCloud() && !code.startsWith('L')) {
      try {
        await writeCloudGroup(code, data);
      } catch (e) {
        console.warn('Compagnia non salvata sul cloud', e);
      }
    }
  }
}

export const groupKeeper = new GroupKeeper();

const triedJoin = new Set<string>();

/** Chi entra nella stanza di un'altra compagnia ci entra anche lui, se non ne ha una. */
export async function joinRoomGroup(code: string) {
  const save = getProgress().save;
  if (save.group || triedJoin.has(code)) return;
  triedJoin.add(code);
  if (isCloud()) {
    if (code.startsWith('L')) return; // compagnia di un ospite: solo locale
    try {
      await joinCloudGroup(code);
      mutate((s) => (s.group = code));
    } catch {
      /* ignorato */
    }
  } else mutate((s) => (s.group = code));
}
