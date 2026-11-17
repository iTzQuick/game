// La compagnia: base del Crocevia, Grado, record e diario del gruppo.
// La tiene l'host (come i nemici): la carica all'inizio, la aggiorna e la
// salva. Gli altri la vedono nello stato della stanza.

import { emitCombat, onCombat } from '../combat/bus';
import type { CombatMsg } from '../combat/protocol';
import { displayName, getGame } from '../game/store';
import { getRoom } from '../net/room';
import { createCloudGroup, joinCloudGroup, loadCloudGroup, writeCloudGroup } from './cloud';
import { addDiary, contribute, emptyGroup, normalizeGroup, type GroupData } from './model';
import { BUILDINGS } from './defs';
import { giornoRoma, narrazioneRiserva, testoObiettivo, validaNarrazione, type Narrazione } from '../narrator/core';
import { narrazioneDelGiorno, nuovoIndizio, spiegaMotivo } from '../narrator/client';
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

/** Righe del diario mostrate a tutti nella Sala dei trofei. */
const DIARIO_VISIBILE = 12;

class GroupKeeper {
  private data: GroupData | null = null;
  private code: string | null = null;
  private loading = false;
  private completedRun = -1;
  private timer: ReturnType<typeof setInterval> | null = null;
  private writeTimer: ReturnType<typeof setTimeout> | null = null;
  private unsub: (() => void) | null = null;
  /** narratore: una richiesta alla volta, con pause tra un tentativo e l'altro */
  private asking = false;
  private nextDayAsk = 0;
  private dayTries = 0;
  private nextClueAsk = 0;
  private clueTries = new Map<number, number>();
  private gaveUp = false;

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

  /** Una riga nel diario della compagnia (la legge il narratore). Solo l'host. */
  note(text: string) {
    const room = getRoom();
    if (!room?.isHost || !this.data) return;
    addDiary(this.data, text);
    const diario = this.data.diario.slice(-DIARIO_VISIBILE);
    room.updateRoom((s) => ({ ...s, diario }));
    this.saveSoon();
  }

  private cloudGroup() {
    return isCloud() && !!this.code && !this.code.startsWith('L');
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
        const d = this.data;
        room.updateRoom((s) => ({ ...s, indizi: d.indizi, diario: d.diario.slice(-DIARIO_VISIBILE) }));
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
      const record = (st.best ?? 0) > d.best;
      d.grado = st.grado ?? d.grado;
      d.best = st.best ?? d.best;
      if (record) addDiary(d, `Nuovo record della compagnia: Grado ${d.best}.`);
      // subito sul cloud: il narratore legge il record da lì per scrivere l'indizio
      void this.flush();
    }
    const run = st.run;
    if (run?.phase === 'complete' && this.completedRun !== run.id) {
      this.completedRun = run.id;
      d.stats = { ...d.stats, fratture: d.stats.fratture + 1, bosses: d.stats.bosses + 1 };
      const names = room.admittedIds.map((id) => displayName(id)).join(', ');
      addDiary(d, `Frattura di Grado ${run.grado} richiusa da ${names}${run.wipes ? ` (tutti a terra ${run.wipes === 1 ? 'una volta' : `${run.wipes} volte`})` : ', senza mai cadere tutti insieme'}.`);
      const m = run.missione;
      if (m?.esito === 'compiuta') {
        addDiary(d, `Missione «${m.titolo}» compiuta.`);
        const giorno = m.id.slice(0, 10);
        const fatte = d.missioni.giorno === giorno ? [...new Set([...d.missioni.fatte, m.id])] : [m.id];
        d.missioni = { giorno, fatte };
        if (st.narrazione?.giorno === giorno) room.updateRoom((s) => ({ ...s, fatte }));
      } else if (m?.esito === 'fallita') addDiary(d, `Missione «${m.titolo}» fallita: ${testoObiettivo(m.obiettivo).toLowerCase()} non è riuscito.`);
      const diario = d.diario.slice(-DIARIO_VISIBILE);
      room.updateRoom((s) => ({ ...s, gstats: d.stats, diario }));
      this.saveSoon();
    }
    this.tickNarrator(room, d);
  }

  /** Missioni del giorno e indizi: prima quelli di riserva, poi (se si può) quelli di Claude. */
  private tickNarrator(room: NonNullable<ReturnType<typeof getRoom>>, d: GroupData) {
    const st = room.roomState;
    const code = this.code!;
    const today = giornoRoma();
    if (st.narrazione?.giorno !== today) {
      const fatte = d.missioni.giorno === today ? d.missioni.fatte : [];
      const cached = readCachedDay(code, today);
      const stato = cached ? '' : this.cloudGroup() ? 'Il narratore sta scrivendo…' : spiegaMotivo(isCloud() ? 'locale' : 'ospite');
      room.updateRoom((s) => ({ ...s, narrazione: cached ?? narrazioneRiserva(today, code), fatte, statoNarratore: stato }));
      this.dayTries = 0;
      this.nextDayAsk = 0;
      return;
    }
    if (!this.cloudGroup() || this.asking || this.gaveUp) return;
    const now = Date.now();

    if (st.narrazione.fonte !== 'claude' && now >= this.nextDayAsk && this.dayTries < 4) {
      this.asking = true;
      this.dayTries++;
      void narrazioneDelGiorno(code)
        .then((r) => {
          const room2 = getRoom();
          if (!room2?.isHost || this.code !== code) return;
          if (r.ok) {
            writeCachedDay(code, r.dati);
            if (r.dati.giorno === today) room2.updateRoom((s) => ({ ...s, narrazione: r.dati, statoNarratore: '' }));
            return;
          }
          if (r.motivo === 'assente') this.gaveUp = true;
          // mentre un altro dispositivo la sta scrivendo si riprova presto
          this.nextDayAsk = Date.now() + (r.motivo === 'attendi' ? 20_000 : 5 * 60_000);
          if (r.motivo === 'esaurito' || r.motivo === 'limite') this.dayTries = 99;
          room2.updateRoom((s) => ({ ...s, statoNarratore: spiegaMotivo(r.motivo) }));
        })
        .finally(() => (this.asking = false));
      return;
    }

    // un indizio per ogni nuovo record (il narratore lo scrive una volta sola)
    const best = d.best;
    const tries = this.clueTries.get(best) ?? 0;
    if (best >= 1 && !d.indizi.some((i) => i.grado === best) && now >= this.nextClueAsk && tries < 3) {
      this.asking = true;
      this.clueTries.set(best, tries + 1);
      void nuovoIndizio(code, best)
        .then((r) => {
          const room2 = getRoom();
          if (!room2?.isHost || this.code !== code || !this.data) return;
          if (r.ok) {
            const data = this.data;
            if (data.indizi.some((i) => i.grado === r.dati.grado)) return;
            data.indizi = [...data.indizi, r.dati].sort((a, b) => a.grado - b.grado).slice(-40);
            addDiary(data, `In Biblioteca è comparso un nuovo indizio: «${r.dati.titolo}».`);
            const indizi = data.indizi;
            const diario = data.diario.slice(-DIARIO_VISIBILE);
            room2.updateRoom((s) => ({ ...s, indizi, diario }));
            this.saveSoon();
            return;
          }
          if (r.motivo === 'assente') this.gaveUp = true;
          this.nextClueAsk = Date.now() + (r.motivo === 'presto' || r.motivo === 'attendi' ? 15_000 : 5 * 60_000);
          if (r.motivo === 'esaurito' || r.motivo === 'limite') this.clueTries.set(best, 99);
        })
        .finally(() => (this.asking = false));
    }
  }

  private onMsg(from: string, msg: CombatMsg) {
    const room = getRoom();
    if (!room?.isHost || !this.data) return;
    if (msg.t === 'edie') {
      this.data.stats = { ...this.data.stats, kills: this.data.stats.kills + 1 };
      this.saveSoon();
    } else if (msg.t === 'contrib') {
      const wasBuilt = !!this.data.base[msg.b]?.u;
      const used = contribute(this.data, msg.b, msg.n);
      if (used > 0) {
        const base = this.data.base;
        room.updateRoom((s) => ({ ...s, base }));
        if (!wasBuilt && base[msg.b]?.u) {
          const def = BUILDINGS.find((b) => b.id === msg.b);
          this.note(`Costruita la ${def?.name ?? msg.b} del Crocevia, con l’ultimo contributo di ${displayName(from)}.`);
        }
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

// la narrazione del giorno resta sul dispositivo: chi diventa host la ritrova senza chiederla di nuovo
const dayKey = (code: string) => `fratture.narratore.${code}`;

function readCachedDay(code: string, giorno: string): Narrazione | null {
  try {
    const n = validaNarrazione(JSON.parse(localStorage.getItem(dayKey(code)) ?? 'null'));
    return n && n.giorno === giorno ? n : null;
  } catch {
    return null;
  }
}

function writeCachedDay(code: string, n: Narrazione) {
  try {
    localStorage.setItem(dayKey(code), JSON.stringify(n));
  } catch {
    /* ignorato */
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
