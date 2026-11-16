-- Le Fratture: salvataggi (tappa 5).
-- Da eseguire UNA volta nel SQL Editor di Supabase (si può rieseguire senza danni).
--
--   saves  : un salvataggio per account (livelli, talenti, zaino, frammenti)
--   groups : la compagnia (base del Crocevia, Grado, record, diario del gruppo)
--
-- Sicurezza (Row Level Security): ognuno legge e scrive solo il proprio
-- salvataggio; una compagnia la leggono e la aggiornano solo i suoi membri.

create table if not exists public.saves (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint saves_size check (pg_column_size(data) < 300000)
);

alter table public.saves enable row level security;

drop policy if exists "saves: leggo il mio" on public.saves;
drop policy if exists "saves: creo il mio" on public.saves;
drop policy if exists "saves: aggiorno il mio" on public.saves;
create policy "saves: leggo il mio" on public.saves for select to authenticated using (auth.uid() = user_id);
create policy "saves: creo il mio" on public.saves for insert to authenticated with check (auth.uid() = user_id);
create policy "saves: aggiorno il mio" on public.saves for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null default 'La Compagnia',
  members uuid[] not null default '{}',
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint groups_size check (pg_column_size(data) < 300000),
  constraint groups_members check (cardinality(members) <= 8)
);

alter table public.groups enable row level security;

drop policy if exists "groups: i membri leggono" on public.groups;
drop policy if exists "groups: i membri aggiornano" on public.groups;
create policy "groups: i membri leggono" on public.groups for select to authenticated using (auth.uid() = any (members));
create policy "groups: i membri aggiornano" on public.groups for update to authenticated
  using (auth.uid() = any (members)) with check (auth.uid() = any (members));

-- Creare una compagnia ed entrarci passano da funzioni, così nessuno può
-- aggiungere altri o togliere membri a mano.

create or replace function public.create_group (gname text)
returns public.groups
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.groups;
  c text;
begin
  if auth.uid () is null then
    raise exception 'not authenticated';
  end if;
  loop
    c := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    exit when not exists (select 1 from public.groups where code = c);
  end loop;
  insert into public.groups (code, name, members)
    values (c, coalesce(nullif(trim(gname), ''), 'La Compagnia'), array[auth.uid ()])
    returning * into g;
  return g;
end;
$$;

create or replace function public.join_group (gcode text)
returns public.groups
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.groups;
begin
  if auth.uid () is null then
    raise exception 'not authenticated';
  end if;
  select * into g from public.groups where code = upper(trim(gcode));
  if g.id is null then
    raise exception 'compagnia non trovata';
  end if;
  if not (auth.uid () = any (g.members)) then
    if cardinality(g.members) >= 8 then
      raise exception 'compagnia piena';
    end if;
    update public.groups
      set members = array_append(members, auth.uid ()), updated_at = now()
      where id = g.id
      returning * into g;
  end if;
  return g;
end;
$$;

revoke all on function public.create_group (text) from public, anon;
revoke all on function public.join_group (text) from public, anon;
grant execute on function public.create_group (text) to authenticated;
grant execute on function public.join_group (text) to authenticated;
