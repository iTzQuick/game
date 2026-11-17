// Il narratore dal lato del gioco: chiede a Claude (attraverso la funzione
// `narratore` su Supabase) le giornaliere e le battute del Custode.
//
// Se la funzione non c'è, non ha la chiave, ha raggiunto il limite o la rete
// manca, si torna null e il gioco usa i testi scritti a mano. Il gioco non
// aspetta mai Claude per andare avanti.

import { CLASSES, type ClassId } from '../game/constants';
import { getGame } from '../game/store';
import { supabaseConfig } from '../net/room';
import { cloud } from '../progress/cloud';
import { CHAPTER, currentChapterMission, goalText, sanitizeLines, sommersaOpen, type StoryState } from './core';

/** Ultimo esito, per le statistiche e per capire cosa succede. */
export const narratorStatus = { last: '' as string, claude: 0, riserva: 0 };

async function call(body: unknown, timeoutMs: number): Promise<unknown | null> {
  const cfg = supabaseConfig();
  // in modalità locale (più schede, test automatici) il narratore resta spento
  if (!cfg || getGame().room.mode !== 'online') return null;
  let token = cfg.key;
  try {
    const c = await cloud();
    const { data } = (await c?.auth.getSession()) ?? { data: { session: null } };
    if (data.session?.access_token) token = data.session.access_token;
  } catch {
    /* da ospite */
  }
  try {
    const res = await fetch(`${cfg.url}/functions/v1/narratore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: cfg.key, Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json = (await res.json().catch(() => null)) as { errore?: string } | null;
    if (!res.ok) {
      narratorStatus.last = `${res.status} ${json?.errore ?? ''}`.trim();
      return null;
    }
    narratorStatus.last = 'ok';
    return json;
  } catch (e) {
    narratorStatus.last = (e as Error).name === 'TimeoutError' ? 'tempo scaduto' : 'non raggiungibile';
    return null;
  }
}

/** Il punto del capitolo, in parole, per Claude. */
export function chapterText(st: StoryState | null, open: boolean): string {
  if (!open) return 'La Città Sommersa è ancora chiusa: si aprirà alla prima Frattura richiusa.';
  const cap = st?.cap ?? 0;
  const cur = st ? currentChapterMission(st) : CHAPTER[0];
  if (!cur) return 'Atto I, la Città Sommersa: concluso. L’Eco della Città è caduto; il portale della Foresta dei Sussurri ha avuto un fremito.';
  return `Atto I, la Città Sommersa: missione ${cap + 1} di ${CHAPTER.length}, «${cur.titolo}» (${goalText(cur.goal)}).`;
}

function baseContext() {
  const r = getGame().room;
  const open = sommersaOpen(r.gstats);
  return {
    grado: r.grado,
    record: r.best,
    stats: r.gstats,
    sommersaAperta: open,
    capitolo: chapterText(r.storia, open),
    classi: Object.values(r.classes).map((c) => CLASSES[c as ClassId]?.name ?? c),
    diario: r.diario,
  };
}

/** Le tre giornaliere scritte da Claude (grezze: vanno controllate con sanitizeDaily). */
export async function fetchDaily(day: string, group: string | null, diario: string[]): Promise<unknown | null> {
  return call({ tipo: 'giornaliere', giorno: day, compagnia: group ?? '', contesto: { ...baseContext(), diario } }, 90_000);
}

// --- battute del Custode ------------------------------------------------------------------------

let ready: string[] | null = null;
let busy = false;
let lastAsk = 0;

/** Chiede in anticipo le prossime battute, così quando il giocatore ascolta il Custode sono già pronte. */
export function prefetchCustode() {
  const now = Date.now();
  if (busy || ready || now - lastAsk < 20_000) return;
  busy = true;
  lastAsk = now;
  const g = getGame();
  const cls = g.room.classes[g.selfId];
  const st = g.room.storia;
  const cur = st ? currentChapterMission(st) : null;
  const daily = st?.daily.find((m, i) => (st.dailyProg[i] ?? 0) < m.goal.n);
  const mission = cur && sommersaOpen(g.room.gstats) ? cur : daily;
  void call(
    {
      tipo: 'custode',
      contesto: {
        ...baseContext(),
        giocatore: g.selfName,
        classe: cls ? CLASSES[cls].name : '',
        dove: g.room.run ? 'in una Frattura' : 'al Crocevia, davanti alla statua',
        missione: mission ? `«${mission.titolo}»: ${goalText(mission.goal)}` : '',
      },
    },
    25_000,
  )
    .then((raw) => {
      const lines = sanitizeLines(raw);
      if (lines) {
        ready = lines;
        narratorStatus.claude++;
      } else narratorStatus.riserva++;
    })
    .finally(() => (busy = false));
}

/** Battute pronte di Claude (una volta sola), oppure null. */
export function takeCustodeLines(): string[] | null {
  const l = ready;
  ready = null;
  return l;
}
