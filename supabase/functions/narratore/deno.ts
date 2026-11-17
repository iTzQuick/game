// Collegamento a Supabase e Claude (gira su Supabase, in Deno).
// Le chiavi NON stanno qui: SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY le mette
// Supabase da solo, ANTHROPIC_API_KEY è il segreto salvato nel pannello.

import Anthropic from 'npm:@anthropic-ai/sdk@1.9.0';
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { rispondi, type Archivio, type Claude, type RispostaClaude } from '../../../src/narrator/server.ts';
import { validaIndizio, type Indizio } from '../../../src/narrator/core.ts';

const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
  auth: { persistSession: false, autoRefreshToken: false },
});
const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY'), timeout: 110_000, maxRetries: 1 });

const adesso = () => new Date().toISOString();

const archivio: Archivio = {
  async utente(token) {
    const { data, error } = await db.auth.getUser(token);
    return error ? null : (data.user?.id ?? null);
  },
  async gruppo(codice) {
    const { data, error } = await db.from('groups').select('members, data').eq('code', codice).maybeSingle();
    if (error) throw error;
    return data ? { membri: (data.members ?? []) as string[], dati: data.data } : null;
  },
  async leggi(gruppo, chiave) {
    const { data, error } = await db.from('narratore').select('stato, dati, tentativi, aggiornato').eq('gruppo', gruppo).eq('chiave', chiave).maybeSingle();
    if (error) throw error;
    return data;
  },
  async crea(gruppo, chiave) {
    const { data, error } = await db
      .from('narratore')
      .upsert({ gruppo, chiave, stato: 'in_corso', tentativi: 1, aggiornato: adesso() }, { onConflict: 'gruppo,chiave', ignoreDuplicates: true })
      .select('gruppo');
    if (error) throw error;
    return (data?.length ?? 0) > 0;
  },
  async riprendi(gruppo, chiave, prima, tentativi) {
    const { data, error } = await db
      .from('narratore')
      .update({ stato: 'in_corso', tentativi, aggiornato: adesso() })
      .eq('gruppo', gruppo)
      .eq('chiave', chiave)
      .eq('aggiornato', prima)
      .select('gruppo');
    if (error) throw error;
    return (data?.length ?? 0) > 0;
  },
  async scrivi(gruppo, chiave, stato, dati) {
    const { error } = await db.from('narratore').update({ stato, dati, aggiornato: adesso() }).eq('gruppo', gruppo).eq('chiave', chiave);
    if (error) throw error;
  },
  async recenti() {
    const da = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { count, error } = await db.from('narratore').select('chiave', { count: 'exact', head: true }).gte('aggiornato', da);
    if (error) throw error;
    return count ?? 0;
  },
  async indizi(gruppo) {
    const { data, error } = await db.from('narratore').select('dati').eq('gruppo', gruppo).eq('stato', 'pronto').like('chiave', 'indizio-%');
    if (error) throw error;
    return (data ?? []).map((r) => validaIndizio(r.dati)).filter((i): i is Indizio => !!i);
  },
};

const claude: Claude = {
  async crea(params) {
    // con `betas` (riprova su un altro modello se i filtri rifiutano) serve l'indirizzo beta
    // deno-lint-ignore no-explicit-any
    const p = params as any;
    const r = p.betas ? await anthropic.beta.messages.create(p) : await anthropic.messages.create(p);
    return r as unknown as RispostaClaude;
  },
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? null;
  let corpo: unknown = null;
  try {
    corpo = await req.json();
  } catch {
    /* corpo vuoto o non valido: ci pensa rispondi */
  }
  let r;
  try {
    r = await rispondi({ metodo: req.method, token, corpo }, { archivio, claude });
  } catch (err) {
    console.error('Narratore: errore', err);
    r = { stato: 500, corpo: { ok: false, motivo: 'errore' } };
  }
  return new Response(JSON.stringify(r.corpo), { status: r.stato, headers: { ...CORS, 'Content-Type': 'application/json' } });
});
