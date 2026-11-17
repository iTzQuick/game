-- Le Fratture: il narratore (tappa 6).
-- Da eseguire UNA volta nel SQL Editor di Supabase (si può rieseguire senza danni),
-- dopo schema.sql.
--
--   narratore_cache : le missioni giornaliere già scritte da Claude (una volta
--                     per compagnia al giorno, poi si rileggono da qui)
--   narratore_uso   : quante richieste ha fatto ognuno oggi (limiti di spesa)
--
-- Le usa solo la funzione `narratore` con la chiave di servizio: nessuna
-- regola di accesso per i giocatori, quindi dal gioco non si leggono né si
-- scrivono.

create table if not exists public.narratore_cache (
  chiave text primary key,
  data jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.narratore_uso (
  giorno date not null,
  chi text not null,
  n integer not null default 0,
  primary key (giorno, chi)
);

alter table public.narratore_cache enable row level security;
alter table public.narratore_uso enable row level security;

-- Conta una richiesta. Restituisce true se si è ancora sotto il limite del giorno.
create or replace function public.narratore_conta (g date, c text, lim integer)
returns boolean
language sql
security definer
set search_path = public
as $$
  insert into public.narratore_uso as u (giorno, chi, n) values (g, c, 1)
  on conflict (giorno, chi) do update set n = u.n + 1 where u.n < lim
  returning true;
$$;

revoke all on function public.narratore_conta (date, text, integer) from public, anon, authenticated;
grant execute on function public.narratore_conta (date, text, integer) to service_role;

-- Pulizia: i conteggi e le missioni più vecchi di un mese non servono più.
delete from public.narratore_uso where giorno < current_date - 30;
delete from public.narratore_cache where created_at < now() - interval '30 days';
