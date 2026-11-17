// Chiamate dal gioco alla funzione Supabase `narratore` (solo con un account e
// una compagnia sul cloud). Qualsiasi problema → si resta sulle missioni di
// riserva: il gioco non aspetta mai il narratore.

import { cloud } from '../progress/cloud';
import { validaIndizio, validaNarrazione, type Indizio, type Narrazione } from './core';

export type Esito<T> = { ok: true; dati: T } | { ok: false; motivo: Motivo };

/**
 * assente: la funzione non è pubblicata · accesso: serve un account ·
 * attendi/presto: riprovare tra poco · esaurito/limite: per oggi basta ·
 * claude/errore/rete: qualcosa è andato storto
 */
export type Motivo = 'assente' | 'accesso' | 'attendi' | 'presto' | 'esaurito' | 'limite' | 'claude' | 'errore' | 'rete' | 'formato';

/** Claude con il ragionamento può metterci un po': oltre questo si lascia perdere. */
const TEMPO_MAX = 150_000;

/** Per i test automatici: risposte finte al posto della funzione vera. */
export const narratorTest: { finto: ((body: Record<string, unknown>) => Promise<unknown>) | null } = { finto: null };

async function chiama(body: Record<string, unknown>): Promise<{ ok: boolean; motivo?: string; [k: string]: unknown }> {
  if (narratorTest.finto) return (await narratorTest.finto(body)) as { ok: boolean };
  const c = await cloud();
  if (!c) return { ok: false, motivo: 'rete' };
  const { data: sess } = await c.auth.getSession();
  if (!sess.session) return { ok: false, motivo: 'accesso' };
  const timeout = new Promise<{ data: null; error: Error }>((res) => setTimeout(() => res({ data: null, error: new Error('tempo scaduto') }), TEMPO_MAX));
  const { data, error } = await Promise.race([c.functions.invoke('narratore', { body }), timeout]);
  if (error) {
    const status = (error as { context?: { status?: number } }).context?.status;
    if (status === 404) return { ok: false, motivo: 'assente' };
    if (status === 401 || status === 403) return { ok: false, motivo: 'accesso' };
    console.warn('Narratore non raggiungibile', error);
    return { ok: false, motivo: status ? 'errore' : 'rete' };
  }
  return data && typeof data === 'object' ? (data as { ok: boolean }) : { ok: false, motivo: 'formato' };
}

const MOTIVI: Motivo[] = ['assente', 'accesso', 'attendi', 'presto', 'esaurito', 'limite', 'claude', 'errore', 'rete', 'formato'];
const motivo = (m: unknown): Motivo => (MOTIVI.includes(m as Motivo) ? (m as Motivo) : 'errore');

export async function narrazioneDelGiorno(gruppo: string): Promise<Esito<Narrazione>> {
  try {
    const r = await chiama({ azione: 'giorno', gruppo });
    if (!r.ok) return { ok: false, motivo: motivo(r.motivo) };
    // anche ciò che arriva dalla nostra funzione si controlla
    const n = validaNarrazione({ ...(r.narrazione as object), fonte: 'claude' });
    return n ? { ok: true, dati: n } : { ok: false, motivo: 'formato' };
  } catch (e) {
    console.warn('Narratore: errore', e);
    return { ok: false, motivo: 'rete' };
  }
}

export async function nuovoIndizio(gruppo: string, grado: number): Promise<Esito<Indizio>> {
  try {
    const r = await chiama({ azione: 'indizio', gruppo, grado });
    if (!r.ok) return { ok: false, motivo: motivo(r.motivo) };
    const i = validaIndizio(r.indizio);
    return i ? { ok: true, dati: i } : { ok: false, motivo: 'formato' };
  } catch (e) {
    console.warn('Narratore: errore', e);
    return { ok: false, motivo: 'rete' };
  }
}

/** Il motivo in parole semplici, per il pannello delle missioni. */
export function spiegaMotivo(m: Motivo | 'locale' | 'ospite'): string {
  switch (m) {
    case 'locale':
    case 'ospite':
      return 'Missioni di riserva: per quelle del narratore serve un account (Menu → Account).';
    case 'assente':
      return 'Missioni di riserva: il narratore non è ancora pubblicato su Supabase.';
    case 'accesso':
      return 'Missioni di riserva: il narratore non riconosce l’account, riprova a entrare.';
    case 'attendi':
    case 'presto':
      return 'Il narratore sta scrivendo…';
    case 'esaurito':
    case 'limite':
      return 'Missioni di riserva: per oggi il narratore ha finito l’inchiostro.';
    default:
      return 'Missioni di riserva: il narratore non ha risposto, riprova più tardi.';
  }
}
