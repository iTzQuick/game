// Account e salvataggi su Supabase (tabelle `saves` e `groups`, vedi
// supabase/schema.sql). La chiave usata è quella pubblica: ognuno può leggere
// e scrivere solo il proprio salvataggio e la propria compagnia (Row Level Security).

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseConfig } from '../net/room';
import { normalizeGroup, normalizeSave, type GroupData, type PlayerSave } from './model';

let client: SupabaseClient | null = null;

export async function cloud(): Promise<SupabaseClient | null> {
  const cfg = supabaseConfig();
  if (!cfg) return null;
  if (!client) {
    const { createClient } = await import('@supabase/supabase-js');
    client = createClient(cfg.url, cfg.key, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'fratture.auth' },
    });
  }
  return client;
}

export interface Account {
  userId: string;
  email: string;
}

export async function currentAccount(): Promise<Account | null> {
  const c = await cloud();
  if (!c) return null;
  const { data } = await c.auth.getSession();
  const u = data.session?.user;
  return u ? { userId: u.id, email: u.email ?? '' } : null;
}

/** Messaggi di errore comprensibili. */
function explain(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes('invalid login')) return 'Email o password sbagliate.';
  if (m.includes('already registered') || m.includes('already been registered')) return 'Questa email ha già un account: usa “Accedi”.';
  if (m.includes('password should be')) return 'La password deve avere almeno 6 caratteri.';
  if (m.includes('email not confirmed')) return 'Email da confermare: nelle impostazioni di Supabase va disattivata la conferma dell’email.';
  if (m.includes('unable to validate email') || m.includes('invalid format')) return 'L’email non sembra valida.';
  if (m.includes('rate limit')) return 'Troppi tentativi: riprova tra qualche minuto.';
  if ((m.includes('relation') && m.includes('does not exist')) || m.includes('could not find the table') || m.includes('could not find the function'))
    return 'Le tabelle dei salvataggi non ci sono ancora: va eseguito supabase/schema.sql nel SQL Editor di Supabase.';
  return msg;
}

export async function signIn(email: string, password: string): Promise<Account> {
  const c = await cloud();
  if (!c) throw new Error('Supabase non è configurato');
  const { data, error } = await c.auth.signInWithPassword({ email: email.trim(), password });
  if (error || !data.user) throw new Error(explain(error?.message ?? 'Accesso non riuscito'));
  return { userId: data.user.id, email: data.user.email ?? email };
}

export async function signUp(email: string, password: string): Promise<Account> {
  const c = await cloud();
  if (!c) throw new Error('Supabase non è configurato');
  const { data, error } = await c.auth.signUp({ email: email.trim(), password });
  if (error) throw new Error(explain(error.message));
  if (!data.session || !data.user) throw new Error(explain('email not confirmed'));
  return { userId: data.user.id, email: data.user.email ?? email };
}

export async function signOut() {
  const c = await cloud();
  await c?.auth.signOut();
}

// --- salvataggio del giocatore ---------------------------------------------------------

export async function loadCloudSave(userId: string): Promise<PlayerSave | null> {
  const c = await cloud();
  if (!c) return null;
  const { data, error } = await c.from('saves').select('data').eq('user_id', userId).maybeSingle();
  if (error) throw new Error(explain(error.message));
  return data ? normalizeSave(data.data) : null;
}

export async function writeCloudSave(userId: string, save: PlayerSave): Promise<void> {
  const c = await cloud();
  if (!c) return;
  const { error } = await c.from('saves').upsert({ user_id: userId, data: save, updated_at: new Date().toISOString() });
  if (error) throw new Error(explain(error.message));
}

// --- compagnia ---------------------------------------------------------------------------

export interface GroupRow {
  code: string;
  name: string;
  data: GroupData;
}

const toRow = (r: { code: string; name: string; data: unknown }): GroupRow => ({ code: r.code, name: r.name, data: normalizeGroup(r.data) });

export async function createCloudGroup(name: string): Promise<GroupRow> {
  const c = await cloud();
  if (!c) throw new Error('Supabase non è configurato');
  const { data, error } = await c.rpc('create_group', { gname: name });
  if (error) throw new Error(explain(error.message));
  return toRow(data);
}

export async function joinCloudGroup(code: string): Promise<GroupRow> {
  const c = await cloud();
  if (!c) throw new Error('Supabase non è configurato');
  const { data, error } = await c.rpc('join_group', { gcode: code });
  if (error) throw new Error(explain(error.message));
  return toRow(data);
}

export async function loadCloudGroup(code: string): Promise<GroupRow | null> {
  const c = await cloud();
  if (!c) return null;
  const { data, error } = await c.from('groups').select('code,name,data').eq('code', code).maybeSingle();
  if (error) throw new Error(explain(error.message));
  return data ? toRow(data) : null;
}

export async function writeCloudGroup(code: string, data: GroupData): Promise<void> {
  const c = await cloud();
  if (!c) return;
  const { error } = await c.from('groups').update({ data, updated_at: new Date().toISOString() }).eq('code', code);
  if (error) throw new Error(explain(error.message));
}
