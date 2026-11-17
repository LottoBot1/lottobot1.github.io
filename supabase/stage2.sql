-- Typer49 – Etap 2: losowania w bazie, ranking, grupy, plan Premium, ochrona przed oszustwami.
-- Uruchom w Supabase: SQL Editor → wklej całość → Run. Skrypt jest idempotentny.

-- ================================================================ rozszerzenia
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- ================================================================ losowania
create table if not exists public.draws (
  game      text not null check (game in ('lotto', 'lottoplus')),
  no        int  not null,
  draw_date date not null,
  nums      smallint[] not null,
  draw_time timestamptz not null,           -- data losowania, godz. 22:00 czasu polskiego
  primary key (game, no)
);
create index if not exists draws_game_time_idx on public.draws (game, draw_time);
create index if not exists draws_game_date_idx on public.draws (game, draw_date);
alter table public.draws enable row level security;
drop policy if exists "losowania: odczyt dla wszystkich" on public.draws;
create policy "losowania: odczyt dla wszystkich" on public.draws for select to anon, authenticated using (true);
revoke all on public.draws from anon, authenticated;
grant select on public.draws to anon, authenticated;

-- Import: baza co 30 min pobiera pliki JSON z GitHub Pages (te same, z których korzysta aplikacja).
create table if not exists public.draw_import_requests (
  id           bigint primary key,
  game         text not null,
  requested_at timestamptz not null default now()
);
alter table public.draw_import_requests enable row level security;   -- brak polityk = brak dostępu z API
revoke all on public.draw_import_requests from anon, authenticated;

create or replace function public.request_draws() returns void
language plpgsql security definer set search_path = '' as $$
declare t text := extract(epoch from now())::bigint::text;
begin
  insert into public.draw_import_requests (id, game) values
    (net.http_get(url => 'https://lottobot1.github.io/data/lotto.json',     params => jsonb_build_object('t', t), timeout_milliseconds => 30000), 'lotto'),
    (net.http_get(url => 'https://lottobot1.github.io/data/lottoplus.json', params => jsonb_build_object('t', t), timeout_milliseconds => 30000), 'lottoplus');
end $$;

create or replace function public.process_draws() returns int
language plpgsql security definer set search_path = '' as $$
declare r record; total int := 0; n int; last_no int;
begin
  for r in
    select q.id, q.game, h.status_code, h.content
    from public.draw_import_requests q join net._http_response h on h.id = q.id
  loop
    if r.status_code = 200 and r.content is not null then
      select coalesce(max(d.no), 0) into last_no from public.draws d where d.game = r.game;
      insert into public.draws (game, no, draw_date, nums, draw_time)
      select r.game, (e->>0)::int, (e->>1)::date,
             array(select jsonb_array_elements_text(e->2)::smallint),
             ((e->>1)::date + time '22:00') at time zone 'Europe/Warsaw'
      from jsonb_array_elements(r.content::jsonb -> 'draws') e
      where (e->>0)::int > last_no
      on conflict (game, no) do nothing;
      get diagnostics n = row_count; total := total + n;
    end if;
    delete from public.draw_import_requests where id = r.id;
  end loop;
  delete from public.draw_import_requests where requested_at < now() - interval '1 day';
  return total;
end $$;
revoke all on function public.request_draws(), public.process_draws() from public, anon, authenticated;

-- harmonogram (najpierw przetwórz odpowiedzi, potem wyślij nowe zapytania)
select cron.unschedule(jobid) from cron.job where jobname in ('typer-draws-process', 'typer-draws-request');
select cron.schedule('typer-draws-process', '10,40 * * * *', 'select public.process_draws()');
select cron.schedule('typer-draws-request', '5,35 * * * *',  'select public.request_draws()');

-- ================================================================ profil: ranking i plan
alter table public.profiles add column if not exists public_ranking boolean not null default false;
alter table public.profiles add column if not exists plan text not null default 'free';
alter table public.profiles add column if not exists premium_until timestamptz;
alter table public.profiles drop constraint if exists profiles_plan_check;
alter table public.profiles add constraint profiles_plan_check check (plan in ('free', 'premium'));
-- użytkownik może zmienić tylko pseudonim i widoczność w rankingu (NIE plan!)
revoke update on public.profiles from authenticated;
grant update (nick, public_ranking) on public.profiles to authenticated;

-- ================================================================ ochrona rankingu przed oszustwami
-- Do rankingu liczy się tylko zakład zapisany w chmurze "na bieżąco" (max 15 min różnicy zegara)
-- i nigdy później niezmieniony (liczby/data). Import i zakłady dodane offline – bez rankingu.
alter table public.bets add column if not exists ranked boolean not null default false;

create or replace function public.bets_ranked() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.ranked := new.created_at between now() - interval '15 minutes' and now() + interval '15 minutes';
  elsif new.nums is distinct from old.nums or new.created_at is distinct from old.created_at then
    new.ranked := false;
  else
    new.ranked := old.ranked;
  end if;
  return new;
end $$;
drop trigger if exists bets_ranked_trg on public.bets;
create trigger bets_ranked_trg before insert or update on public.bets
  for each row execute function public.bets_ranked();

-- ================================================================ grupy
create table if not exists public.groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 3 and 40),
  owner_id    uuid not null references auth.users (id) on delete cascade,
  invite_code text not null unique default upper(substr(md5(gen_random_uuid()::text), 1, 8)),
  created_at  timestamptz not null default now()
);
create table if not exists public.group_members (
  group_id  uuid not null references public.groups (id) on delete cascade,
  user_id   uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index if not exists group_members_user_idx on public.group_members (user_id);

create or replace function public.is_group_member(g uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.group_members m where m.group_id = g and m.user_id = auth.uid());
$$;

alter table public.groups        enable row level security;
alter table public.group_members enable row level security;
drop policy if exists "grupy: odczyt członków"    on public.groups;
drop policy if exists "grupy: zmiana właściciela" on public.groups;
drop policy if exists "grupy: usuwanie właściciela" on public.groups;
create policy "grupy: odczyt członków" on public.groups for select to authenticated using (public.is_group_member(id));
create policy "grupy: zmiana właściciela" on public.groups for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "grupy: usuwanie właściciela" on public.groups for delete to authenticated using (owner_id = (select auth.uid()));
drop policy if exists "członkowie: odczyt w swoich grupach" on public.group_members;
drop policy if exists "członkowie: wyjście lub usunięcie"   on public.group_members;
create policy "członkowie: odczyt w swoich grupach" on public.group_members for select to authenticated using (public.is_group_member(group_id));
create policy "członkowie: wyjście lub usunięcie" on public.group_members for delete to authenticated using (
  user_id = (select auth.uid())
  or exists (select 1 from public.groups g where g.id = group_id and g.owner_id = (select auth.uid())));
revoke all on public.groups, public.group_members from anon, authenticated;
grant select, delete      on public.groups to authenticated;
grant update (name)       on public.groups to authenticated;
grant select, delete      on public.group_members to authenticated;

create or replace function public.create_group(p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare gid uuid;
begin
  if auth.uid() is null then raise exception 'Zaloguj się'; end if;
  if (select count(*) from public.groups where owner_id = auth.uid()) >= 10 then
    raise exception 'Możesz mieć maksymalnie 10 własnych grup';
  end if;
  insert into public.groups (name, owner_id) values (btrim(p_name), auth.uid()) returning id into gid;
  insert into public.group_members (group_id, user_id) values (gid, auth.uid());
  return gid;
end $$;

create or replace function public.join_group(p_code text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare gid uuid;
begin
  if auth.uid() is null then raise exception 'Zaloguj się'; end if;
  select id into gid from public.groups where invite_code = upper(btrim(p_code));
  if gid is null then raise exception 'Nie ma grupy o takim kodzie'; end if;
  if (select count(*) from public.group_members where group_id = gid) >= 50 then
    raise exception 'Grupa jest pełna (max 50 osób)';
  end if;
  if (select count(*) from public.group_members where user_id = auth.uid()) >= 20 then
    raise exception 'Możesz należeć do maksymalnie 20 grup';
  end if;
  insert into public.group_members (group_id, user_id) values (gid, auth.uid()) on conflict do nothing;
  return gid;
end $$;

create or replace function public.my_groups()
returns table (id uuid, name text, invite_code text, is_owner boolean, members int)
language sql stable security definer set search_path = '' as $$
  select g.id, g.name, g.invite_code, g.owner_id = auth.uid(),
         (select count(*)::int from public.group_members m2 where m2.group_id = g.id)
  from public.groups g join public.group_members m on m.group_id = g.id and m.user_id = auth.uid()
  order by g.created_at;
$$;

-- ================================================================ ranking
-- Wynik każdego rozliczonego zakładu: najlepsze trafienie z Lotto i (jeśli grał) Lotto Plus.
create or replace function public.bet_results(p_period text, p_group uuid, p_user uuid)
returns table (user_id uuid, best int)
language sql stable security definer set search_path = '' as $$
  select b.user_id,
         greatest(
           (select count(*) from unnest(b.nums) x where x = any (dl.nums)),
           coalesce((select count(*) from unnest(b.nums) x where x = any (dp.nums)), 0)
         )::int
  from public.bets b
  cross join lateral (
    select d.draw_date, d.nums from public.draws d
    where d.game = 'lotto' and d.draw_time > b.created_at
    order by d.draw_time limit 1
  ) dl
  left join lateral (
    select d.nums from public.draws d
    where b.plus and d.game = 'lottoplus' and d.draw_date = dl.draw_date limit 1
  ) dp on true
  where b.ranked
    and (p_user is null or b.user_id = p_user)
    and (p_group is null or b.user_id in (select gm.user_id from public.group_members gm where gm.group_id = p_group))
    and dl.draw_date >= case p_period when 'week' then current_date - 7
                                      when 'month' then current_date - 30
                                      else date '1900-01-01' end;
$$;
revoke all on function public.bet_results(text, uuid, uuid) from public, anon, authenticated;

create or replace function public.ranking(p_period text default 'month', p_group uuid default null)
returns table (pos int, nick text, is_me boolean, bets int, avg_hits numeric, best int, hits3 int)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if auth.uid() is null then raise exception 'Zaloguj się'; end if;
  if p_group is not null and not public.is_group_member(p_group) then
    raise exception 'Nie należysz do tej grupy';
  end if;
  return query
  with agg as (
    select r.user_id, count(*)::int as n, round(avg(r.best), 2) as av, max(r.best)::int as mx,
           (count(*) filter (where r.best >= 3))::int as h3
    from public.bet_results(p_period, p_group, null) r
    group by r.user_id
  )
  select (row_number() over (order by a.av desc, a.mx desc, a.n desc))::int,
         coalesce(p.nick, 'Gracz ' || upper(left(p.id::text, 4))),
         a.user_id = auth.uid(), a.n, a.av, a.mx, a.h3
  from agg a join public.profiles p on p.id = a.user_id
  where p_group is not null or (p.public_ranking and p.nick is not null and a.n >= 3)
  order by 1
  limit 100;
end $$;

create or replace function public.my_stats(p_period text default 'month')
returns table (bets int, avg_hits numeric, best int, hits3 int)
language sql stable security definer set search_path = '' as $$
  select count(*)::int, round(coalesce(avg(r.best), 0), 2), coalesce(max(r.best), 0)::int,
         (count(*) filter (where r.best >= 3))::int
  from public.bet_results(p_period, null, auth.uid()) r
  where auth.uid() is not null;
$$;

revoke all on function public.create_group(text), public.join_group(text), public.my_groups(),
  public.ranking(text, uuid), public.my_stats(text), public.is_group_member(uuid) from public, anon;
grant execute on function public.create_group(text), public.join_group(text), public.my_groups(),
  public.ranking(text, uuid), public.my_stats(text), public.is_group_member(uuid) to authenticated;

-- pierwsze pobranie losowań od razu
select public.request_draws();
select 'OK: Etap 2 zainstalowany' as wynik;
