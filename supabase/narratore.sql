-- Le Fratture: memoria del narratore (tappa 6).
-- Da eseguire UNA volta nel SQL Editor di Supabase (si può rieseguire senza danni).
--
-- Una riga per compagnia e per lavoro: "giorno-AAAA-MM-GG" (missioni e battute
-- del giorno) oppure "indizio-N" (indizio della Biblioteca per il record N).
-- La legge e la scrive solo la funzione `narratore` (chiave di servizio):
-- nessuna regola di accesso per gli account, quindi dal gioco non si tocca.

create table if not exists public.narratore (
  gruppo text not null,
  chiave text not null,
  stato text not null default 'in_corso' check (stato in ('in_corso', 'pronto', 'errore')),
  dati jsonb,
  tentativi int not null default 1,
  creato timestamptz not null default now(),
  aggiornato timestamptz not null default now(),
  primary key (gruppo, chiave),
  constraint narratore_size check (pg_column_size(dati) < 60000)
);

create index if not exists narratore_aggiornato on public.narratore (aggiornato);

alter table public.narratore enable row level security;
revoke all on table public.narratore from anon, authenticated;
